/**
 * The corkboard: the scenes as cards in narrative order, on one
 * scrolling canvas of fixed-size cards, edited in place, dragged into a new
 * order, gathered by a field or run backwards. What the board computes is in
 * `corkboard-layout.ts`; this is the drawing, and the rules of the drawing:
 *
 * - The canvas is windowed. Only the cards the scroller shows stand in the
 *   DOM, each placed by a transform, keyed by scene so a paint dresses a
 *   standing card rather than remaking it. A card that is being dragged,
 *   edited or focused is pinned: it stays mounted wherever the window is.
 * - Every write goes through one queue, one after another, each followed by
 *   a read of the project. A quick edit reads its scene's revision when its
 *   turn comes, and adopts the fresh one the write answers with, so two
 *   edits in quick succession never carry the revision a card was drawn
 *   under. A change from elsewhere still refuses the write, as a notice.
 * - A paint asked for while a drag is in flight waits for the drag to end.
 */

import { Menu, Notice, SearchComponent, setIcon, setTooltip } from 'obsidian';

import type { SceneMoveTarget } from '../services';
import type { CorkboardControls, CorkboardHandle, CorkboardVariant } from './corkboard-bridge';
import {
	SCENE_DRAG_TYPE,
	adjacencyAllowed,
	buildLayout,
	cardPosition,
	corkboardMetrics,
	displayOrder,
	dropTargetAt,
	firstCardInView,
	insertBesideIndex,
	layoutColumns,
	moveTargetIndex,
	revealScrollTop,
	visibleCards,
	visibleHeads,
	visibleLines,
	type CorkboardLayout,
	type CorkboardMetrics,
	type DisplayOrder,
	type ShownScene,
} from './corkboard-layout';
import type { FilterRow } from './filter-rows';
import { addOrderMenuItems } from './order-menu';
import { renderEmptyLine } from './pane-parts';
import { clearSceneFilters, filterScenes, reconcileSceneFilters, sceneFilterRows, sceneFiltered, sceneHasNonRangeFilters } from './scene-filters';
import {
	SCENE_CARD_PART_CLASSES,
	SCENE_CARD_SELECTOR,
	createSceneCardDeck,
	pressWithin,
	type SceneCard,
	type SceneCardDeck,
	type SceneCardPart,
} from './scene-card';
import { planCardMoves, planCardRepaint } from './sticky-note-layout';
import {
	CORKBOARD_GROUP_FIELDS,
	CORKBOARD_MODES,
	isCorkboardGroupField,
	isCorkboardMode,
} from './story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from './view-model';

const SEARCH_DEBOUNCE_MS = 150;
const OVERSCAN_LINES = 2;

const GROUP_LABEL_KEYS = {
	pov: 'table.scenePov',
	status: 'table.progressStatus',
	category: 'table.category',
	time: 'table.sceneTime',
	location: 'table.sceneLocation',
	character: 'table.sceneCharacters',
	color: 'stickyNotes.color',
	linked: 'table.sceneLinked',
} as const;

/** What a corkboard card carries beyond the scene card: its place on the canvas, and the two insertion buttons. */
interface CorkboardCardExtras {
	/** The card's place on the canvas, or -1 while pinned off the window. */
	display: number;
	x: number;
	y: number;
	width: number;
	insertBefore: HTMLButtonElement;
	insertAfter: HTMLButtonElement;
}

type CardEntry = SceneCard & CorkboardCardExtras;

type FocusPart = SceneCardPart | 'insert-before' | 'insert-after';

interface ViewportMeasure {
	top: number;
	height: number;
	/** Apply a resize anchor after all card geometry has been written. */
	scrollTo?: number;
}

interface FocusHold {
	key: string;
	part: FocusPart;
	el: Element;
	display: number;
}

const PART_CLASSES: readonly [FocusPart, string][] = [
	...SCENE_CARD_PART_CLASSES,
	['insert-before', 'snowflake-method-corkboard-insert-before'],
	['insert-after', 'snowflake-method-corkboard-insert-after'],
];

const px = (value: number): string => `${String(Math.round(value * 100) / 100)}px`;

export function renderCorkboard(
	container: HTMLElement,
	controls: CorkboardControls,
	variant: CorkboardVariant = {},
): CorkboardHandle {
	const { app, host, t, memory } = controls;
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-corkboard snowflake-method-scene-cards',
	});
	root.dataset.mode = memory.mode;

	// -- The band ------------------------------------------------------------

	const band = root.createDiv({ cls: 'snowflake-method-prose-controls' });
	const search = new SearchComponent(band);
	if (variant.searchLabel === 'quiet') {
		// A placeholder that says nothing rather than none at all: Obsidian hides
		// the field's clear button with `:placeholder-shown`, which matches nothing
		// where there is no placeholder to show, and the button would then stand on
		// an empty field. The name the field no longer writes goes where a screen
		// reader reads it and where the pointer rests.
		search.setPlaceholder(' ');
		search.inputEl.setAttribute('aria-label', t('table.searchScenes'));
		setTooltip(search.inputEl, t('table.searchScenes'));
	} else {
		search.setPlaceholder(t('table.searchScenes'));
	}
	search.setValue(memory.query);
	let searchTimer: number | null = null;
	let searchWindow = root.win;
	search.onChange((next) => {
		memory.query = next;
		if (searchTimer !== null) searchWindow.clearTimeout(searchTimer);
		searchWindow = root.win;
		searchTimer = searchWindow.setTimeout(() => {
			searchTimer = null;
			paintAll({ resetScroll: true });
		}, SEARCH_DEBOUNCE_MS);
	});
	const searchBox = band.querySelector('.search-input-container');
	const displayButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-corkboard-display',
		attr: {
			type: 'button',
			'aria-haspopup': 'dialog',
			'aria-expanded': 'false',
			'aria-label': t('corkboard.display'),
		},
	});
	setIcon(displayButton, 'sliders-horizontal');
	setTooltip(displayButton, t('corkboard.display'));
	displayButton.addEventListener('click', () => {
		openDisplay();
	});
	const directionButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-corkboard-direction',
		attr: { type: 'button' },
	});
	const paintDirection = (): void => {
		setIcon(
			directionButton,
			memory.reversed ? 'arrow-up-narrow-wide' : 'arrow-down-narrow-wide',
		);
		const label = t(
			memory.reversed ? 'corkboard.order.reversed' : 'corkboard.order.normal',
		);
		directionButton.setAttribute('aria-label', label);
		setTooltip(directionButton, label);
	};
	paintDirection();
	directionButton.addEventListener('click', () => {
		memory.reversed = !memory.reversed;
		controls.remember({ reversed: memory.reversed });
		paintDirection();
		paintAll({ resetScroll: true });
	});
	const filterButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-filter-button',
		attr: {
			type: 'button',
			'aria-haspopup': 'dialog',
			'aria-expanded': 'false',
			'aria-label': t('table.filter'),
		},
	});
	setIcon(filterButton, 'funnel');
	setTooltip(filterButton, t('table.filter'));
	const markFilterButton = (): void => {
		filterButton.toggleClass('is-active', sceneFiltered(memory.filters));
	};
	filterButton.addEventListener('click', () => {
		void openFunnel();
	});
	const stateText = band.createSpan({ cls: 'snowflake-method-prose-state' });
	const refreshButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-prose-refresh',
		attr: { type: 'button', 'aria-label': t('corkboard.refresh') },
	});
	setIcon(refreshButton, 'refresh-cw');
	setTooltip(refreshButton, t('corkboard.refresh'));
	refreshButton.addEventListener('click', () => {
		void controls.refresh().catch(notice);
	});
	const addButton = variant.addButton === 'icon'
		? band.createEl('button', {
			cls: 'clickable-icon snowflake-method-corkboard-add',
			attr: { type: 'button', 'aria-label': t('actions.addScene') },
		})
		: band.createEl('button', {
			cls: 'mod-cta snowflake-method-corkboard-add',
			text: t('actions.addScene'),
			attr: { type: 'button' },
		});
	if (variant.addButton === 'icon') {
		setIcon(addButton, 'plus');
		setTooltip(addButton, t('actions.addScene'));
	}
	addButton.disabled = true;
	addButton.addEventListener('click', () => {
		insertAt(null);
	});

	const empty = renderEmptyLine(root, variant.emptyText ?? t('scenes.empty'));
	empty.line.addClass('is-hidden');
	const scroller = root.createDiv({
		cls: 'snowflake-method-corkboard-scroll',
		attr: { tabindex: '-1' },
	});
	const canvas = scroller.createDiv({
		cls: 'snowflake-method-corkboard-canvas',
		attr: { role: 'list' },
	});

	// -- State ---------------------------------------------------------------

	let model: ProjectDashboardModel | null = null;
	let projectPath: string | null = null;
	let projectId: string | null = null;
	let manuscriptPositions = new Map<string, number>();
	let resolvedManuscriptPaths = new Map<string, Map<string, string | null>>();
	let charactersByPath = new Map<string, ProjectDashboardModel['characters'][number]>();
	let scenesById = new Map<string, SceneViewModel>();
	/** The scenes the board may show at all: every scene, or the variant's subset. */
	let pool: SceneViewModel[] = [];
	let order: DisplayOrder = { groups: [], shown: 0 };
	let layout: CorkboardLayout | null = null;
	/** Every scene's id in narrative order. */
	let orderIds: string[] = [];
	/** Each card's key by display index, and each head's line by key. */
	let displayKeys: string[] = [];
	let headLines = new Map<string, number>();
	let adjacency = false;
	let readOnly = true;
	const heads = new Map<string, HTMLElement>();
	/** The card in flight, while one is; every paint asked meanwhile waits. */
	let drag: { key: string; id: string } | null = null;
	let paintOwed = false;
	/** Where a drop would land: a display index, the count meaning after the last card. */
	let mark: number | null = null;
	let frame: number | null = null;
	let animationWindow = root.win;
	let dragRect: DOMRect | null = null;
	let measureOwed = false;
	let windowOwed = false;
	let lastWidth = -1;
	let lastViewportHeight = -1;
	let disposed = false;
	let popoverRequest = 0;
	let popoverKind: 'funnel' | 'display' | null = null;
	/** One resolution per target/source during a full paint, also shared with grouping. */
	const resolveManuscriptPath = (target: string, sourcePath: string): string | null => {
		let paths = resolvedManuscriptPaths.get(sourcePath);
		if (paths === undefined) {
			paths = new Map();
			resolvedManuscriptPaths.set(sourcePath, paths);
		}
		if (!paths.has(target)) paths.set(target, app.metadataCache.getFirstLinkpathDest(target, sourcePath)?.path ?? null);
		return paths.get(target) ?? null;
	};

	const notice = (error: unknown): void => {
		new Notice(error instanceof Error ? error.message : t('errors.unknown'));
	};

	const deck: SceneCardDeck<CardEntry> = createSceneCardDeck<CardEntry>({
		app,
		host,
		t,
		notice,
		refresh: () => controls.refresh(),
		model: () => model,
		projectPath: () => projectPath,
		readOnly: () => readOnly,
		unloading: () => controls.unloading?.() === true,
		charactersByPath: () => charactersByPath,
		scenesById: () => scenesById,
		manuscriptPositions: () => manuscriptPositions,
		resolveManuscriptPath,
		dragAllowed: (card) => mayDrag(card),
		menu: (card, event) => {
			openMenu(card, event);
		},
		// The board's own parts: the card's place on the canvas, and the two
		// insertion buttons the gaps beside it hold.
		extend: (card) => Object.assign(card, {
			display: -1,
			x: Number.NaN,
			y: Number.NaN,
			width: Number.NaN,
			...buildInsertButtons(card.el),
		}),
	});
	const cards = deck.cards;
	const enqueue = deck.enqueue;
	const openForm = deck.openForm;
	const editable = deck.editable;
	/**
	 * Whether a card may be taken hold of at all. A pool's card leaves the board
	 * rather than moving within it, so it drags where adjacency alone would not
	 * let it -- and what that drag changes is the timeline's own file, not the
	 * scene's note, so the project's word is the whole of the question. A card
	 * moved within a board writes the note itself, and asks the note's leave
	 * as well as the project's.
	 */
	const mayDrag = (card: CardEntry): boolean =>
		variant.dragOut !== undefined ? !readOnly : adjacency && editable(card);
	const pruneRevisions = deck.prune;

	/** Carry queued edits through our rank writes without adopting external revisions. */
	const reorderScene = (id: string, target: SceneMoveTarget, owningProject: string): Promise<void> =>
		host.reorderScene(id, target, owningProject, (change) => {
			deck.adoptRevision(change);
		});

	// -- Measures ------------------------------------------------------------

	const remPx = (): number => {
		const size = Number.parseFloat(
			root.win.getComputedStyle(root.doc.documentElement).fontSize,
		);
		return Number.isFinite(size) && size > 0 ? size : 16;
	};

	const compactHeight = (): number | undefined => {
		if (memory.mode !== 'compact') return undefined;
		for (const { el } of cards.values()) {
			if (!el.isConnected) continue;
			const head = el.querySelector<HTMLElement>('.snowflake-method-corkboard-head');
			const footer = el.querySelector<HTMLElement>('.snowflake-method-corkboard-footer');
			if (head === null || footer === null) continue;
			const headHeight = head.getBoundingClientRect().height;
			const footerHeight = footer.getBoundingClientRect().height;
			if (headHeight === 0 || footerHeight === 0) continue;
			const style = root.win.getComputedStyle(el);
			return headHeight + footerHeight +
				(Number.parseFloat(style.borderTopWidth) || 0) +
				(Number.parseFloat(style.borderBottomWidth) || 0);
		}
		return undefined;
	};

	const keyOf = (groupKey: string, sceneId: string): string =>
		groupKey === '' ? sceneId : `${groupKey}|${sceneId}`;

	const displayOf = (key: string): number => displayKeys.indexOf(key);

	const displayOfScene = (id: string): number =>
		displayKeys.findIndex((key) => key === id || key.endsWith(`|${id}`));

	const sceneAt = (display: number): SceneViewModel | null => {
		const item = layout?.items[display];
		return item === undefined ? null : (model?.scenes[item.sceneIndex] ?? null);
	};

	// -- Painting ------------------------------------------------------------

	/** Geometry changes do not change the scenes admitted by the filter or their order. */
	const arrange = (metrics: CorkboardMetrics, reuseRows = false): boolean => {
		const previous = layout;
		const sameRows = reuseRows && previous !== null &&
			previous.columns === layoutColumns(metrics) &&
			previous.gap === metrics.gap && previous.cardHeight === metrics.cardHeight &&
			previous.headHeight === metrics.headHeight;
		if (sameRows) {
			layout = {
				...previous,
				cardWidth: (metrics.width - (previous.columns - 1) * metrics.gap) / previous.columns,
			};
		} else {
			layout = buildLayout(order, metrics);
			headLines = new Map();
			layout.lines.forEach((line, at) => {
				if (line.kind === 'head') headLines.set(line.key, at);
			});
		}
		lastWidth = metrics.width;
		const properties: Record<string, string> = {};
		if (previous?.gap !== layout.gap) properties['--snowflake-method-corkboard-gap'] = px(layout.gap);
		if (previous?.cardHeight !== layout.cardHeight) {
			properties['--snowflake-method-corkboard-card-height'] = px(layout.cardHeight);
		}
		if (previous?.headHeight !== layout.headHeight) {
			properties['--snowflake-method-corkboard-head-height'] = px(layout.headHeight);
		}
		if (Object.keys(properties).length > 0) root.setCssProps(properties);
		if (previous?.height !== layout.height) canvas.setCssStyles({ height: px(layout.height) });
		return !sameRows;
	};

	/**
	 * Lays the board out again from the model the view holds: the funnel and
	 * the search, the grouping and the direction, the measures, the chrome,
	 * then the window. Deferred while a drag is in flight.
	 */
	const paintAll = (
		options: { resetScroll?: boolean; keepFirst?: boolean } = {},
	): void => {
		if (disposed) return;
		if (drag !== null) {
			paintOwed = true;
			return;
		}
		dragRect = null;
		// A refresh can follow metadata resolution even with the same model object.
		resolvedManuscriptPaths = new Map();
		deck.beginPaint();
		const keepId =
			options.keepFirst === true && layout !== null
				? (sceneAt(firstCardInView(layout, scroller.scrollTop) ?? -1)?.id ?? null)
				: null;
		const nextModel = controls.model();
		if (nextModel !== model) {
			manuscriptPositions = new Map(nextModel?.manuscriptPaths.map((path, index) => [path, index]));
		}
		model = nextModel;
		if (model === null) {
			charactersByPath.clear();
			scenesById.clear();
			clearCanvas();
			stateText.setText('');
			empty.line.addClass('is-hidden');
			addButton.disabled = true;
			return;
		}
		const current = model;
		if (projectId !== null && projectId !== current.projectId) {
			memory.query = '';
			search.setValue('');
			clearSceneFilters(memory.filters);
			memory.scrollTop = 0;
		}
		projectId = current.projectId;
		// A project rename refreshes this board in place. New edits follow its
		// current path; patch() keeps the owner already captured by queued saves.
		projectPath = current.path;
		readOnly = current.readOnly;
		charactersByPath = new Map(current.characters.map((character) => [character.path, character]));
		scenesById = new Map(current.scenes.map((scene) => [scene.id, scene]));
		const characterNames = new Map(
			current.characters.map((character) => [character.path, character.name]),
		);
		reconcileSceneFilters(memory.filters, current);
		pool = variant.include === undefined ? current.scenes : current.scenes.filter(variant.include);
		// The subset is taken after the funnel, which numbers the scenes by
		// their place in the list it is given: a card keeps its narrative number.
		const shown: ShownScene[] = filterScenes(
			current.scenes,
			memory.query,
			memory.filters,
			{ t, characterNames, resolveLink: resolveManuscriptPath },
		).filter((entry) => variant.include?.(entry.scene) ?? true);
		order = displayOrder(shown, memory.reversed, memory.group, {
			t,
			characters: current.characters,
			locale: current.locale,
			resolveLink: resolveManuscriptPath,
		});
		orderIds = current.scenes.map((scene) => scene.id);
		// A subset is never contiguous, and a card that leaves under another
		// surface's drag is not one the board reorders.
		adjacency = variant.include === undefined && variant.dragOut === undefined && adjacencyAllowed({
			filtered: sceneHasNonRangeFilters(memory.filters),
			query: memory.query,
			group: memory.group,
			readOnly,
			anySceneReadOnly: current.scenes.some((scene) => scene.readOnly),
		});
		root.dataset.mode = memory.mode;
		const rem = remPx();
		// The scroller extends past the frame for its scrollbar; the canvas
		// keeps the same content edges as the toolbar above it.
		const metrics = corkboardMetrics(canvas.clientWidth, memory.mode, rem, compactHeight(), variant.columns, variant.gap);
		arrange(metrics);
		displayKeys = [];
		for (const group of order.groups) {
			for (const item of group.items) {
				displayKeys.push(keyOf(group.key, orderIds[item.sceneIndex] ?? ''));
			}
		}
		const narrowed =
			memory.query.trim().length > 0 || sceneFiltered(memory.filters);
		stateText.setText(
			narrowed
				? t('table.filteredCount', {
						shown: order.shown,
						total: pool.length,
					})
				: '',
		);
		markFilterButton();
		const none = pool.length === 0;
		empty.line.toggleClass('is-hidden', !none);
		scroller.toggleClass('is-hidden', none);
		searchBox?.toggleClass('is-hidden', none);
		filterButton.toggleClass('is-hidden', none);
		// A style shared with another surface is still someone's to choose.
		displayButton.toggleClass('is-hidden', none && variant.modeShared !== true);
		directionButton.toggleClass('is-hidden', none);
		addButton.disabled = readOnly;
		if (options.resetScroll === true) {
			scroller.scrollTop = 0;
		} else if (keepId !== null) {
			const display = displayOfScene(keepId);
			if (display !== -1 && layout !== null) scroller.scrollTop = cardPosition(layout, display).y;
		} else if (scroller.scrollTop !== memory.scrollTop) {
			scroller.scrollTop = memory.scrollTop;
		}
		memory.scrollTop = scroller.scrollTop;
		paintWindow(true);
		// The first render supplies the themed header/footer measurements.
		const measuredHeight = compactHeight();
		if (measuredHeight !== undefined && Math.abs(measuredHeight - metrics.cardHeight) > 0.5) {
			paintAll({ keepFirst: true });
		}
	};

	const clearCanvas = (): void => {
		deck.clear();
		for (const head of heads.values()) head.remove();
		heads.clear();
		layout = null;
		displayKeys = [];
		canvas.setCssStyles({ height: '0px' });
		pruneRevisions();
	};

	/** The cards that must stay mounted wherever the window is. */
	const pinnedKeys = (): string[] => {
		const pinned: string[] = [];
		if (drag !== null) pinned.push(drag.key);
		const active = root.doc.activeElement;
		const focused = active === null || !root.contains(active) ? null : active.closest(SCENE_CARD_SELECTOR);
		const focusedKey = focused?.getAttribute('data-key');
		if (focusedKey != null) pinned.push(focusedKey);
		pinned.push(...deck.editingKeys());
		return pinned;
	};

	/** Move an editor with its scene when a refresh gives its group a different key. */
	const rekeyPinnedCards = (pinned: Set<string>, hold: FocusHold | null): void => {
		for (const key of [...pinned]) {
			if (displayOf(key) !== -1) continue;
			const entry = cards.get(key);
			if (entry === undefined) continue;
			const destinations = displayKeys.filter((_, display) => sceneAt(display)?.id === entry.id);
			const nextKey = destinations.find((candidate) => !cards.has(candidate)) ??
				destinations.find((candidate) => {
					const standing = cards.get(candidate);
					return standing !== undefined && !pinned.has(candidate) &&
						!standing.editingTitle && !standing.conflictDirty;
				});
			if (nextKey === undefined) continue;
			// A clean group copy can give its place to the actual editor, preserving
			// the draft, its revision, the selection and the control's event handlers.
			deck.unmount(nextKey);
			deck.rekey(entry, nextKey);
			pinned.delete(key);
			pinned.add(nextKey);
			if (hold?.key === key) hold.key = nextKey;
		}
	};

	/** Brings the mounted cards level with the window: the ones in it, and the pinned ones wherever they are. */
	const paintWindow = (refreshContent = false, viewport?: ViewportMeasure): void => {
		if (disposed || layout === null || model === null) return;
		const lay = layout;
		const current = model;
		const measured = viewport ?? { top: scroller.scrollTop, height: scroller.clientHeight };
		lastViewportHeight = measured.height;
		const lines = visibleLines(
			lay,
			measured.top,
			lastViewportHeight,
			OVERSCAN_LINES,
		);
		const hold = holdFocus();
		const pinned = new Set(pinnedKeys());
		rekeyPinnedCards(pinned, hold);
		const wanted = new Map<string, number>();
		for (const display of visibleCards(lay, lines)) {
			const key = displayKeys[display];
			if (key !== undefined) wanted.set(key, display);
		}
		for (const key of pinned) {
			if (wanted.has(key)) continue;
			const display = displayOf(key);
			if (display !== -1) wanted.set(key, display);
		}
		const retained = [...pinned].filter((key) =>
			!wanted.has(key) && current.scenes.some((scene) => scene.id === cards.get(key)?.id),
		);
		const plan = planCardRepaint([...cards.keys()], [...wanted.keys()], retained);
		for (const key of plan.remove) deck.unmount(key);
		for (const key of plan.keep) {
			const entry = cards.get(key);
			const display = wanted.get(key);
			if (entry === undefined) continue;
			if (display === undefined) {
				// A filter, or two distinct drafts collapsing into one group, may
				// leave no place for this editor. Keep it for remounting or disposal.
				entry.display = -1;
				deck.park(entry);
				continue;
			}
			if (!entry.el.isConnected) canvas.insertBefore(entry.el, null);
			if (refreshContent) dressAt(entry, display, current);
			else placeCard(entry, display);
		}
		for (const key of plan.add) {
			const display = wanted.get(key);
			if (display === undefined) continue;
			const entry = mountCard(key, display, current);
			if (entry !== null) dressAt(entry, display, current);
		}
		// Only the cards out of place move: a card moved in the DOM drops
		// the document's focus with no blur to say so. Heads stand between
		// them carrying keys of their own, which the plan steps over.
		const ordered = [...wanted.entries()]
			.sort((a, b) => a[1] - b[1])
			.map(([key]) => key);
		const present = Array.from(canvas.children).map(
			(child) => child.getAttribute('data-key') ?? '',
		);
		for (const move of planCardMoves(present, ordered)) {
			const el = cards.get(move.id)?.el;
			if (el === undefined) continue;
			canvas.insertBefore(el, cards.get(move.before)?.el ?? null);
		}
		const wantedHeads = new Set(visibleHeads(lay, lines));
		for (const [key, head] of heads) {
			if (wantedHeads.has(key)) continue;
			head.remove();
			heads.delete(key);
		}
		for (const key of wantedHeads) {
			const line = headLines.get(key);
			const found = lay.lines[line ?? -1];
			if (line === undefined || found === undefined || found.kind !== 'head') continue;
			let head = heads.get(key);
			if (head === undefined) {
				head = canvas.createDiv({
					cls: 'snowflake-method-corkboard-group',
					attr: { 'data-key': `head:${key}` },
				});
				const name = head.createSpan({
					cls: 'snowflake-method-corkboard-group-label',
					text: found.label,
					attr: { role: 'heading', 'aria-level': '3' },
				});
				// A name wider than the board is trimmed to it, so the whole of one
				// waits under the pointer, as a card's title does.
				setTooltip(name, found.label);
				head.createSpan({ cls: 'snowflake-method-corkboard-group-rule' });
				heads.set(key, head);
			}
			const label = head.querySelector<HTMLElement>('.snowflake-method-corkboard-group-label');
			if (label !== null && label.textContent !== found.label) {
				label.setText(found.label);
				setTooltip(label, found.label);
			}
			head.setCssStyles({
				transform: `translate(0px, ${px(lay.offsets[line] ?? 0)})`,
			});
		}
		applyMark();
		giveFocusBack(hold);
		pruneRevisions();
	};

	const dressAt = (
		entry: CardEntry,
		display: number,
		current: ProjectDashboardModel,
	): void => {
		const item = layout?.items[display];
		const scene = item === undefined ? undefined : current.scenes[item.sceneIndex];
		if (item === undefined || scene === undefined) return;
		entry.display = display;
		deck.dress(entry, scene, item.sceneIndex, {
			position: display + 1,
			size: layout?.items.length ?? order.shown,
		});
		const canInsert = adjacency && editable(entry);
		entry.insertBefore.toggleClass('is-hidden', !canInsert);
		entry.insertAfter.toggleClass('is-hidden', !canInsert);
		placeCard(entry, display);
	};

	const placeCard = (entry: CardEntry, display: number): void => {
		if (layout === null) return;
		// Width belongs only to the card. An inherited custom property on the
		// board makes every descendant recompute its style throughout a resize.
		if (entry.width !== layout.cardWidth) {
			entry.width = layout.cardWidth;
			entry.el.setCssStyles({ width: px(entry.width) });
		}
		entry.insertBefore.toggleClass('is-row-start', layout.places[display]?.column === 0);
		entry.insertAfter.toggleClass(
			'is-row-end',
			layout.places[display]?.column === layout.columns - 1,
		);
		const { x, y } = cardPosition(layout, display);
		if (x === entry.x && y === entry.y) return;
		entry.x = x;
		entry.y = y;
		entry.el.setCssStyles({ transform: `translate(${px(x)}, ${px(y)})` });
	};

	const mountCard = (
		key: string,
		display: number,
		current: ProjectDashboardModel,
	): CardEntry | null => {
		const item = layout?.items[display];
		const scene = item === undefined ? undefined : current.scenes[item.sceneIndex];
		if (item === undefined || scene === undefined) return null;
		const entry = deck.mount(canvas, key, scene, item.sceneIndex);
		wireInsert(entry, entry.insertBefore, 'before');
		wireInsert(entry, entry.insertAfter, 'after');
		wireDrag(entry);
		return entry;
	};

	// -- What a card carries on this board ------------------------------------

	/** The two insertion buttons in the gaps beside a card, built once with the card. */
	const buildInsertButtons = (
		el: HTMLElement,
	): Pick<CorkboardCardExtras, 'insertBefore' | 'insertAfter'> => {
		const insertBefore = el.createEl('button', {
			cls: 'clickable-icon snowflake-method-corkboard-insert snowflake-method-corkboard-insert-before is-hidden',
			attr: { type: 'button', 'aria-label': t('table.insertSceneBefore') },
		});
		setIcon(insertBefore, 'plus');
		setTooltip(insertBefore, t('table.insertSceneBefore'));
		const insertAfter = el.createEl('button', {
			cls: 'clickable-icon snowflake-method-corkboard-insert snowflake-method-corkboard-insert-after is-hidden',
			attr: { type: 'button', 'aria-label': t('table.insertSceneAfter') },
		});
		setIcon(insertAfter, 'plus');
		setTooltip(insertAfter, t('table.insertSceneAfter'));
		return { insertBefore, insertAfter };
	};

	// -- The menu, and the ways in and out of the sequence --------------------

	const openMenu = (entry: CardEntry, event: MouseEvent): void => {
		const current = model;
		if (current === null) return;
		const scene = entry.scene;
		const total = current.scenes.length;
		const writable = editable(entry);
		const reorderLocked =
			readOnly || current.scenes.some((candidate) => candidate.readOnly);
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('actions.edit'))
				.setIcon('pencil')
				.setDisabled(!writable)
				.onClick(() => {
					openForm((onSaved) => host.openSceneForm({ mode: 'edit', id: entry.id }, current.path, onSaved));
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('common.open'))
				.setIcon('file-text')
				.onClick(() => {
					void host.openManagedFile(scene.path).catch(notice);
				});
		});
		addOrderMenuItems(
			menu,
			{
				app, t,
				run: (action) => enqueue(action, { persist: true }),
				mutate: (action) => enqueue(action, { persist: true, reportError: false }),
				refresh: () => controls.refresh(),
			},
			{
				index: entry.index,
				total,
				locked: reorderLocked,
				readOnly,
				insertTitle: t('table.insertSceneAfter'),
				...(adjacency
					? {
						up: layout?.items[entry.display - 1]?.sceneIndex ?? null,
						down: layout?.items[entry.display + 1]?.sceneIndex ?? null,
					}
					: { up: null, down: null }),
				options: () =>
					current.scenes
						.map((candidate, at) => ({
							id: candidate.id,
							index: at,
							label: `${String(at + 1)}. ${candidate.title}`,
						}))
						.filter((candidate) => candidate.id !== entry.id),
				move: (toIndex) => reorderScene(entry.id, toIndex, current.path),
				moveBeside: (id, side) => reorderScene(
					entry.id,
					(ids) => moveTargetIndex(ids, entry.id, id, side === 'after'),
					current.path,
				),
				reveal: () => {
					reveal(entry.id);
				},
				insert: () => {
					insertAt({ id: entry.id, side: 'after' });
				},
			},
		);
		variant.menuItems?.(entry.id, menu);
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('actions.delete'))
				.setIcon('trash-2')
				.setWarning(true)
				.setDisabled(readOnly || scene.readOnly)
				.onClick(() => {
					void enqueue(() => host.deleteScene(entry.id, entry.scene.revision, current.path), { persist: true });
				});
		});
		menu.showAtMouseEvent(event);
	};

	/** A scene made beside the clicked card, or at the narrative end for null, then shown. */
	const insertAt = (anchor: { id: string; side: 'before' | 'after' } | null): void => {
		const owningProject = projectPath;
		if (readOnly || owningProject === null) return;
		const reversed = memory.reversed;
		let created: string | null = null;
		let saved = false;
		void enqueue(async () => {
			const current = controls.model();
			if (current === null || current.path !== owningProject || current.readOnly) return;
			// Earlier queued reorders may have moved the anchor. Resolve its
			// position now, keeping the direction the author clicked in.
			const afterIndex = anchor === null ? null : insertBesideIndex(
				current.scenes.map((scene) => scene.id), anchor.id, anchor.side, reversed,
			);
			if (anchor !== null && afterIndex === null) return;
			created = await host.openSceneForm({ mode: 'create', afterIndex }, owningProject, () => { saved = true; });
		}, { shouldRefresh: () => saved || created !== null }).then(() => {
			if (created === null || disposed || projectPath !== owningProject) return;
			if (displayOfScene(created) === -1) {
				memory.query = '';
				search.setValue('');
				clearSceneFilters(memory.filters);
				paintAll();
			}
			reveal(created);
		});
	};

	// -- Wiring --------------------------------------------------------------


	const wireInsert = (entry: CardEntry, button: HTMLButtonElement, side: 'before' | 'after'): void => {
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			if (!adjacency || !editable(entry)) return;
			insertAt({ id: entry.id, side });
		});
	};

	const wireDrag = (entry: CardEntry): void => {
		const { el } = entry;
		const out = variant.dragOut;
		el.addEventListener('dragstart', (event) => {
			if (!mayDrag(entry) || event.dataTransfer === null || pressWithin(event.target)) {
				event.preventDefault();
				return;
			}
			drag = { key: entry.key, id: entry.id };
			dragRect = null;
			el.addClass('is-dragging');
			event.dataTransfer.effectAllowed = 'move';
			if (out === undefined) {
				event.dataTransfer.setData(SCENE_DRAG_TYPE, entry.id);
			} else {
				event.dataTransfer.setData(out.type, entry.id);
				out.onStart(entry.id, event.dataTransfer);
			}
		});
		// Fires on the source however the drag ends: dropped, dropped nowhere,
		// or cancelled. Everything the drag marked clears here.
		el.addEventListener('dragend', () => {
			el.removeClass('is-dragging');
			clearMark();
			drag = null;
			dragRect = null;
			out?.onEnd();
			if (paintOwed) {
				paintOwed = false;
				paintAll();
			}
		});
	};

	let eventWindow = root.win;
	const invalidateDragRect = (): void => { dragRect = null; };
	const bindWindow = (win: Window): void => {
		win.addEventListener('mouseup', deck.releasePress, true);
		win.addEventListener('scroll', invalidateDragRect, true);
		win.addEventListener('resize', invalidateDragRect);
	};
	const unbindWindow = (win: Window): void => {
		win.removeEventListener('mouseup', deck.releasePress, true);
		win.removeEventListener('scroll', invalidateDragRect, true);
		win.removeEventListener('resize', invalidateDragRect);
	};
	bindWindow(eventWindow);

	// -- Drag and drop on the canvas -----------------------------------------

	const applyMark = (): void => {
		const count = layout?.items.length ?? 0;
		for (const entry of cards.values()) {
			entry.el.toggleClass('is-drop-before', mark !== null && entry.display === mark);
			entry.el.toggleClass(
				'is-drop-after',
				mark !== null && mark === count && entry.display === count - 1,
			);
		}
	};
	const setMark = (before: number | null): void => {
		if (mark === before) return;
		mark = before;
		applyMark();
	};
	const clearMark = (): void => {
		setMark(null);
	};
	// The mark moves from dragover alone: Chromium fires dragleave at every
	// child boundary, and a mark cleared there flickers with every card.
	/** Whether a drag over the board is one the variant takes as a whole. */
	const takenIn = (transfer: DataTransfer | null): boolean =>
		variant.dropIn !== undefined && transfer !== null && variant.dropIn.accepts(Array.from(transfer.types));
	// The board as a whole takes such a drop, its empty line included: the
	// scroller is hidden while it shows nothing, and a scene sent back to a
	// pool that stands empty must still have somewhere to land. The band is
	// no part of that field: a card let go over the search box or a control
	// is a slip, and a slip must not place or unplace a scene.
	/** Whether the pointer stands on the band rather than the field below it. */
	const overBand = (target: EventTarget | null): boolean =>
		target !== null && (target === band || band.contains(target as Node));
	root.addEventListener('dragleave', (event) => {
		const next = event.relatedTarget;
		if (next === null || !root.contains(next as Node)) root.removeClass('is-drop-target');
	});
	root.addEventListener('dragover', (event) => {
		if (!takenIn(event.dataTransfer)) return;
		if (overBand(event.target)) {
			root.removeClass('is-drop-target');
			return;
		}
		event.preventDefault();
		if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
		root.addClass('is-drop-target');
	});
	root.addEventListener('drop', (event) => {
		if (!takenIn(event.dataTransfer) || event.dataTransfer === null || overBand(event.target)) return;
		event.preventDefault();
		root.removeClass('is-drop-target');
		variant.dropIn?.onDrop(event.dataTransfer);
	});
	canvas.addEventListener('dragover', (event) => {
		if (
			variant.dragOut !== undefined ||
			drag === null ||
			layout === null ||
			event.dataTransfer?.types.includes(SCENE_DRAG_TYPE) !== true
		) {
			return;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		const rect = dragRect ??= canvas.getBoundingClientRect();
		const landing = dropTargetAt(layout, {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
		});
		setMark(landing?.before ?? null);
	});
	canvas.addEventListener('drop', (event) => {
		if (variant.dragOut !== undefined) return;
		const dragged = event.dataTransfer?.getData(SCENE_DRAG_TYPE) ?? '';
		if (dragged.length === 0 || drag?.id !== dragged || layout === null) return;
		event.preventDefault();
		const before = mark;
		clearMark();
		if (before === null) return;
		const beforeId =
			before >= layout.items.length ? null : (sceneAt(before)?.id ?? null);
		const lastShownId = sceneAt(layout.items.length - 1)?.id ?? null;
		if (beforeId === dragged || (beforeId === null && lastShownId === dragged)) return;
		const reversed = memory.reversed;
		// Keep the scene the author dropped beside, not its old position.
		// The service resolves it after earlier queued writes have landed,
		// even when this board has closed and can no longer refresh.
		const target = (ids: readonly string[]): number | null =>
			moveTargetIndex(ids, dragged, beforeId, reversed, lastShownId);
		const owningProject = projectPath;
		if (owningProject !== null) void enqueue(() => reorderScene(dragged, target, owningProject), { persist: true });
	});

	// -- Focus custody -------------------------------------------------------

	const holdFocus = (): FocusHold | null => {
		const active = root.doc.activeElement;
		if (active === null || !root.contains(active)) return null;
		const card = active.closest(SCENE_CARD_SELECTOR);
		if (card === null) return null;
		const key = card.getAttribute('data-key') ?? '';
		const part =
			PART_CLASSES.find(([, cls]) => active.classList.contains(cls))?.[0] ?? 'card';
		return { key, part, el: active, display: cards.get(key)?.display ?? -1 };
	};

	const partOf = (entry: CardEntry, part: FocusPart): Element => {
		switch (part) {
			case 'insert-before':
				return entry.insertBefore;
			case 'insert-after':
				return entry.insertAfter;
			default:
				return deck.partOf(entry, part);
		}
	};

	/**
	 * Gives the focus back after a paint that took it: to the control where
	 * it still stands, to the same part of the same card where the card was
	 * remade, else to the card now standing where it stood, else to the
	 * scroller. Never scrolls: the author did not ask to go anywhere.
	 */
	const giveFocusBack = (hold: FocusHold | null): void => {
		if (hold === null) return;
		const doc = root.doc;
		const active = doc.activeElement;
		if (active !== null && active !== doc.body && root.contains(active)) return;
		const entry = cards.get(hold.key);
		let target: Element | null = root.contains(hold.el) ? hold.el : null;
		if (target === null && entry?.el.isConnected === true) target = partOf(entry, hold.part);
		if (target === null) {
			const mounted = [...cards.values()].filter((card) => card.el.isConnected);
			const standing =
				mounted.find((candidate) => candidate.display === hold.display) ??
				mounted[mounted.length - 1] ??
				null;
			target = standing?.el ?? scroller;
		}
		(target as HTMLElement).focus({ preventScroll: true });
	};

	// -- The popovers --------------------------------------------------------

	const openFunnel = async (): Promise<void> => {
		const request = ++popoverRequest;
		if (controls.popover.filterOpen() && popoverKind === 'funnel') {
			controls.popover.closeFilter();
			popoverKind = null;
			return;
		}
		const owningProject = model?.path;
		if (owningProject === undefined) return;
		controls.popover.closeFilter();
		popoverKind = 'funnel';
		const [categories, manuscripts] = await Promise.allSettled([
			host.listDefinitionPaths('scene', 'category', owningProject),
			host.listManuscriptNotes(owningProject),
		]);
		if (disposed || request !== popoverRequest || !filterButton.isConnected || model?.path !== owningProject) return;
		const current = model;
		// Parent definitions remain useful filters even when scenes are filed
		// only under their descendants. Keep the known assignments if the tree
		// cannot be read, without losing the other filter options.
		const categoryPaths = categories.status === 'fulfilled' ? categories.value : [
			...new Set(pool.flatMap((scene) => scene.categoryPaths)),
		].sort((a, b) => a.localeCompare(b, current.locale));
		const manuscriptNotes = manuscripts.status === 'fulfilled' ? manuscripts.value : [];
		controls.popover.openFilter(
			filterButton,
			sceneFilterRows(t, current, memory.filters, { categoryPaths, manuscriptNotes }),
			() => {
				markFilterButton();
				paintAll({ resetScroll: true });
			},
		);
	};

	const displayRows = (): FilterRow[] => [
		{
			label: t('corkboard.cards'),
			placeholder: t('corkboard.cards.standard'),
			empty: 'standard',
			options: () =>
				CORKBOARD_MODES.filter((mode) => mode !== 'standard').map((mode) => ({
					value: mode,
					label: t(`corkboard.cards.${mode}`),
				})),
			value: memory.mode,
			apply: (value) => {
				memory.mode = isCorkboardMode(value) ? value : 'standard';
			},
		},
		{
			label: t('corkboard.groupBy'),
			placeholder: t('common.none'),
			empty: '',
			options: () =>
				CORKBOARD_GROUP_FIELDS.map((field) => ({
					value: field,
					label: t(GROUP_LABEL_KEYS[field]),
				})),
			value: memory.group,
			apply: (value) => {
				memory.group = isCorkboardGroupField(value) ? value : '';
			},
		},
	];

	const openDisplay = (): void => {
		popoverRequest++;
		if (controls.popover.filterOpen() && popoverKind === 'display') {
			controls.popover.closeFilter();
			popoverKind = null;
			return;
		}
		popoverKind = 'display';
		const before = { mode: memory.mode, group: memory.group };
		controls.popover.openFilter(
			displayButton,
			displayRows(),
			() => {
				controls.remember(memory.mode !== before.mode ? { mode: memory.mode } : undefined);
				paintAll(
					memory.group === before.group ? { keepFirst: true } : { resetScroll: true },
				);
			},
			t('corkboard.display'),
		);
	};

	// -- Scrolling, resizing, revealing --------------------------------------

	/** Obsidian and ResizeObserver can report the same sidebar animation step. */
	const scheduleFrame = (): void => {
		if (disposed || frame !== null) return;
		animationWindow = root.win;
		frame = animationWindow.requestAnimationFrame(() => {
			frame = null;
			const repaint = windowOwed;
			windowOwed = false;
			let viewport: ViewportMeasure | null = null;
			if (measureOwed) {
				measureOwed = false;
				viewport = reflow(repaint);
			} else if (repaint) {
				viewport = { top: scroller.scrollTop, height: scroller.clientHeight };
			}
			if (viewport === null) return;
			paintWindow(false, viewport);
			// Reading or setting scrollTop after changing card width forces layout. Do
			// it only for a new row arrangement, after every card has its final geometry.
			if (viewport.scrollTo !== undefined) scroller.scrollTop = viewport.scrollTo;
		});
	};

	scroller.addEventListener('scroll', () => {
		dragRect = null;
		memory.scrollTop = scroller.scrollTop;
		windowOwed = true;
		scheduleFrame();
	});

	const reveal = (id: string): void => {
		if (disposed || layout === null) return;
		const display = displayOfScene(id);
		if (display === -1) return;
		scroller.scrollTop = revealScrollTop(layout, display, scroller.clientHeight);
		memory.scrollTop = scroller.scrollTop;
		paintWindow();
		const key = displayKeys[display];
		const entry = key === undefined ? undefined : cards.get(key);
		entry?.el.focus({ preventScroll: true });
	};

	/** Reuse the ordered scenes and card contents while only the available space changes. */
	const reflow = (repaint: boolean): ViewportMeasure | null => {
		if (disposed || layout === null) return null;
		const width = canvas.clientWidth;
		// Hidden workspace tabs have no useful geometry; their next reveal measures again.
		if (width <= 0) return null;
		const viewport: ViewportMeasure = { top: scroller.scrollTop, height: scroller.clientHeight };
		const metrics = corkboardMetrics(width, memory.mode, remPx(), compactHeight(), variant.columns, variant.gap);
		if (Math.abs(metrics.cardHeight - layout.cardHeight) <= 0.5) {
			metrics.cardHeight = layout.cardHeight;
		}
		const unchanged = width === lastWidth && metrics.cardHeight === layout.cardHeight &&
			metrics.gap === layout.gap && metrics.headHeight === layout.headHeight;
		if (unchanged) return repaint || viewport.height !== lastViewportHeight ? viewport : null;
		if (drag !== null) {
			paintOwed = true;
			return repaint ? viewport : null;
		}
		const previous = layout;
		const first = firstCardInView(previous, viewport.top);
		const key = first === null ? undefined : displayKeys[first];
		const offset = first === null ? 0 : viewport.top - cardPosition(previous, first).y;
		// Capture the scroller's padding before the CSS writes so clamping the new
		// anchor does not need a scrollHeight read in the middle of card placement.
		const scrollInset = scroller.scrollHeight - previous.height;
		const changedRows = arrange(metrics, true);
		if (changedRows && key !== undefined && layout !== null) {
			const display = displayOf(key);
			if (display !== -1) {
				const maximum = Math.max(0, layout.height + scrollInset - viewport.height);
				const top = Math.max(0, Math.min(cardPosition(layout, display).y + offset, maximum));
				if (top !== viewport.top) viewport.scrollTo = top;
				viewport.top = top;
			}
		}
		memory.scrollTop = viewport.top;
		// A theme may wrap compact controls at the new width. Measure their settled
		// height next frame instead of forcing another layout after these writes.
		if (memory.mode === 'compact') remeasure();
		return viewport;
	};

	const remeasure = (): void => {
		if (disposed || layout === null) return;
		dragRect = null;
		measureOwed = true;
		scheduleFrame();
	};
	const frameWindow = root.ownerDocument.defaultView;
	const observer =
		frameWindow === null ? null : new frameWindow.ResizeObserver(() => remeasure());
	observer?.observe(scroller);
	const stopMigration = root.onWindowMigrated?.((win) => {
		unbindWindow(eventWindow);
		eventWindow = win;
		bindWindow(eventWindow);
		deck.closeColorPanel();
		deck.releasePress();
		dragRect = null;
		if (frame !== null) {
			animationWindow.cancelAnimationFrame(frame);
			frame = null;
		}
		if (searchTimer !== null) {
			searchWindow.clearTimeout(searchTimer);
			searchTimer = null;
			paintAll({ resetScroll: true });
		}
		remeasure();
	});

	paintAll();

	return {
		refresh: () => {
			paintAll();
		},
		reveal,
		remeasure,
		saveFocusedConflict: () => {
			const active = root.doc.activeElement;
			for (const entry of cards.values()) {
				if (entry.conflict !== active) continue;
				deck.commitConflict(entry);
				return true;
			}
			return false;
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			popoverRequest++;
			controls.popover.closeFilter();
			deck.closeColorPanel();
			if (searchTimer !== null) searchWindow.clearTimeout(searchTimer);
			if (frame !== null) animationWindow.cancelAnimationFrame(frame);
			observer?.disconnect();
			stopMigration?.();
			unbindWindow(eventWindow);
			// Final drafts join accepted saves in the same order. They retain
			// this board's project and revisions after its view has gone away.
			deck.dispose();
			root.remove();
		},
	};
}
