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

import { Keymap, Menu, Notice, SearchComponent, setIcon, setTooltip } from 'obsidian';

import { PROGRESS_STATUSES, isProgressStatus, type ProgressStatus } from '../domain';
import type { SceneMoveTarget, ScenePatch } from '../services';
import { hangPanel, type HungPanel } from './anchored-panel';
import type { CorkboardControls, CorkboardHandle } from './corkboard-bridge';
import { CorkboardDraftModal, type RecoveredCorkboardDraft } from './corkboard-draft-modal';
import {
	SCENE_DRAG_TYPE,
	adjacencyAllowed,
	buildLayout,
	cardPosition,
	columnsFor,
	corkboardMetrics,
	displayOrder,
	dropTargetAt,
	firstCardInView,
	insertBesideIndex,
	moveTargetIndex,
	revealScrollTop,
	statusOptions,
	titleTaken,
	visibleCards,
	visibleHeads,
	visibleLines,
	type CardSelectOption,
	type CorkboardLayout,
	type CorkboardMetrics,
	type DisplayOrder,
	type ShownScene,
} from './corkboard-layout';
import type { FilterRow } from './filter-rows';
import { linkedManuscriptPreview, orderManuscriptReferences } from './linked-manuscript';
import { addOrderMenuItems } from './order-menu';
import { paintCount, renderEmptyLine } from './pane-parts';
import { clearSceneFilters, filterScenes, reconcileSceneFilters, sceneFilterRows, sceneFiltered, sceneHasNonRangeFilters } from './scene-filters';
import { renderStickySwatches } from './sticky-note-card';
import { planCardMoves, planCardRepaint } from './sticky-note-layout';
import {
	CORKBOARD_GROUP_FIELDS,
	CORKBOARD_MODES,
	isCorkboardGroupField,
	isCorkboardMode,
} from './story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from './view-model';

const CARD_SELECTOR = '.snowflake-method-corkboard-card';
/** What a press on begins a text selection or a choice, never a drag. */
const CONTROL_SELECTOR = 'input, textarea, select, button, a';
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

/**
 * A card's element and the parts a dressing rewrites rather than remakes,
 * so a control holding the focus is still there, and still focused, after
 * a read redresses the card around it.
 */
interface CardEntry {
	/** The scene's id, or the group key and the id where a scene stands in several groups. */
	key: string;
	id: string;
	el: HTMLElement;
	scene: SceneViewModel;
	/** The scene's place in the narrative order. */
	index: number;
	/** The card's place on the canvas, or -1 while pinned off the window. */
	display: number;
	x: number;
	y: number;
	width: number;
	number: HTMLElement;
	title: HTMLButtonElement;
	titleText: string;
	titleInput: HTMLInputElement;
	editingTitle: boolean;
	titleOriginal: string;
	titleRevision: EditRevision;
	color: HTMLButtonElement;
	more: HTMLButtonElement;
	pov: HTMLButtonElement;
	status: HTMLSelectElement;
	statusSignature: string;
	conflict: HTMLTextAreaElement;
	conflictDirty: boolean;
	conflictOriginal: string;
	conflictRevision: EditRevision;
	chips: HTMLElement;
	moreLinks: HTMLButtonElement;
	linksSignature: string | null;
	insertBefore: HTMLButtonElement;
	insertAfter: HTMLButtonElement;
}

/** A draft's revision advances only when this board successfully writes it. */
interface EditRevision {
	revision: string;
}

interface PendingText {
	value: string;
	base: EditRevision;
	original: string;
	key: string;
}

type FocusPart =
	| 'card'
	| 'title'
	| 'pov'
	| 'status'
	| 'color'
	| 'more'
	| 'conflict'
	| 'insert-before'
	| 'insert-after'
	| 'more-links'
	| 'link';

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
	['title', 'snowflake-method-corkboard-title'],
	['title', 'snowflake-method-corkboard-title-input'],
	['pov', 'snowflake-method-corkboard-pov'],
	['status', 'snowflake-method-corkboard-status-select'],
	['color', 'snowflake-method-corkboard-color'],
	['more', 'snowflake-method-corkboard-more'],
	['conflict', 'snowflake-method-corkboard-conflict'],
	['insert-before', 'snowflake-method-corkboard-insert-before'],
	['insert-after', 'snowflake-method-corkboard-insert-after'],
	['more-links', 'snowflake-method-corkboard-more-links'],
	['link', 'snowflake-method-corkboard-link'],
];

const px = (value: number): string => `${String(Math.round(value * 100) / 100)}px`;

export function renderCorkboard(
	container: HTMLElement,
	controls: CorkboardControls,
): CorkboardHandle {
	const { app, host, t, memory } = controls;
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-corkboard',
	});
	root.dataset.mode = memory.mode;

	// -- The band ------------------------------------------------------------

	const band = root.createDiv({ cls: 'snowflake-method-prose-controls' });
	const search = new SearchComponent(band);
	search.setPlaceholder(t('table.searchScenes'));
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
	const addButton = band.createEl('button', {
		cls: 'mod-cta snowflake-method-corkboard-add',
		text: t('actions.addScene'),
		attr: { type: 'button' },
	});
	addButton.disabled = true;
	addButton.addEventListener('click', () => {
		insertAt(null);
	});

	const empty = renderEmptyLine(root, t('scenes.empty'));
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
	let orderedManuscriptLinks = new WeakMap<SceneViewModel, SceneViewModel['linkedManuscript']>();
	let resolvedManuscriptPaths = new Map<string, Map<string, string | null>>();
	let charactersByPath = new Map<string, ProjectDashboardModel['characters'][number]>();
	let scenesById = new Map<string, SceneViewModel>();
	let order: DisplayOrder = { groups: [], shown: 0 };
	let layout: CorkboardLayout | null = null;
	/** Every scene's id in narrative order. */
	let orderIds: string[] = [];
	/** Each card's key by display index, and each head's line by key. */
	let displayKeys: string[] = [];
	let headLines = new Map<string, number>();
	let adjacency = false;
	let readOnly = true;
	const cards = new Map<string, CardEntry>();
	// Shared across group copies and remounts while a scene's save is pending.
	const pendingStatuses = new Map<string, { value: ProgressStatus }>();
	const pendingTitles = new Map<string, PendingText>();
	const pendingConflicts = new Map<string, PendingText>();
	const revisions = new Map<string, Map<string, Set<EditRevision>>>();
	/** Own writes the displayed model has not yet caught up with, including unmounted cards. */
	const revisionTransitions = new Map<string, Map<string, string>>();
	const queuedRevisions = new Set<{ base: EditRevision }>();
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
	let colorPanel: { entry: CardEntry; hung: HungPanel } | null = null;
	/** True while a press on a card's control is held, when a card must not drag. */
	let pressed = false;
	let lastWidth = -1;
	let lastViewportHeight = -1;
	let queue: Promise<void> = Promise.resolve();
	let disposed = false;
	let popoverRequest = 0;
	let popoverKind: 'funnel' | 'display' | null = null;
	let recoveryDrafts: RecoveredCorkboardDraft[] = [];
	const recoveredTexts = new Set<string>();

	const recoverText = (scene: SceneViewModel, fields: Pick<RecoveredCorkboardDraft, 'title' | 'conflict'>): void => {
		const draft: RecoveredCorkboardDraft = { scene: scene.title };
		for (const field of ['title', 'conflict'] as const) {
			const value = fields[field];
			if (value === undefined) continue;
			const key = JSON.stringify([scene.path, field, value]);
			if (recoveredTexts.has(key)) continue;
			recoveredTexts.add(key);
			draft[field] = value;
		}
		if (draft.title === undefined && draft.conflict === undefined) return;
		if (recoveryDrafts.length === 0) {
			// Wait until the current paint has restored focus before opening.
			void Promise.resolve().then(() => {
				const drafts = recoveryDrafts;
				recoveryDrafts = [];
				recoveredTexts.clear();
				new CorkboardDraftModal(app, t, drafts).open();
			});
		}
		recoveryDrafts.push(draft);
	};

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

	/**
	 * Every change the board makes, one after another, each followed by a
	 * read of the project before the next runs: what makes a quick edit
	 * carry a fresh revision whatever came before it.
	 */
	const enqueue = (action: () => Promise<void>, options: {
		persist?: boolean;
		reportError?: boolean;
		shouldRefresh?: () => boolean;
	} = {}): Promise<void> => {
		const run = queue.then(async () => {
			if (disposed && options.persist !== true) return;
			try {
				await action();
			} catch (error) {
				if (options.reportError === false) throw error;
				notice(error);
			}
			if (!disposed && (options.shouldRefresh?.() ?? true)) await controls.refresh().then(() => revisionTransitions.clear()).catch((error: unknown) => {
				if (options.reportError === false) throw error;
				notice(error);
			});
		});
		// A modal receives its own rejection, without poisoning later writes.
		queue = run.catch(() => undefined);
		return run;
	};

	const openForm = (open: (onSaved: () => void) => Promise<unknown>): void => {
		let saved = false;
		void enqueue(async () => { await open(() => { saved = true; }); }, { shouldRefresh: () => saved });
	};

	/** Only mounted editors and accepted saves still need revision aliases. */
	const pruneRevisions = (): void => {
		const held = new Set([...queuedRevisions].map((pending) => pending.base));
		for (const card of cards.values()) {
			held.add(card.titleRevision);
			held.add(card.conflictRevision);
		}
		for (const pending of [...pendingTitles.values(), ...pendingConflicts.values()]) held.add(pending.base);
		for (const [id, byRevision] of revisions) {
			for (const [revision, bases] of byRevision) {
				for (const base of bases) if (!held.has(base)) bases.delete(base);
				if (bases.size === 0) byRevision.delete(revision);
			}
			if (byRevision.size === 0) revisions.delete(id);
		}
	};

	const editRevision = (scene: SceneViewModel): EditRevision => {
		const revision = revisionTransitions.get(scene.id)?.get(scene.revision) ?? scene.revision;
		let byRevision = revisions.get(scene.id);
		if (byRevision === undefined) {
			byRevision = new Map();
			revisions.set(scene.id, byRevision);
		}
		const standing = byRevision.get(revision)?.values().next().value;
		if (standing !== undefined) return standing;
		const base = { revision };
		byRevision.set(revision, new Set([base]));
		return base;
	};

	const advanceRevision = (id: string, before: string, after: string): void => {
		if (before === after) return;
		// A card can remount from the old model before the write's refresh
		// finishes. Resolve its revision even if its former editor was pruned.
		const transitions = revisionTransitions.get(id) ?? new Map<string, string>();
		for (const [origin, revision] of transitions) {
			if (revision === before) transitions.set(origin, after);
		}
		transitions.set(before, after);
		revisionTransitions.set(id, transitions);
		const byRevision = revisions.get(id);
		const bases = byRevision?.get(before);
		if (byRevision === undefined || bases === undefined) return;
		byRevision.delete(before);
		const next = byRevision.get(after) ?? new Set<EditRevision>();
		for (const base of bases) {
			base.revision = after;
			next.add(base);
		}
		byRevision.set(after, next);
	};

	/** Carry queued edits through our rank writes without adopting external revisions. */
	const reorderScene = (id: string, target: SceneMoveTarget, owningProject: string): Promise<void> =>
		host.reorderScene(id, target, owningProject, (change) => {
			advanceRevision(change.id, change.before, change.after);
			for (const card of cards.values()) {
				if (card.id === change.id && card.scene.revision === change.before) {
					card.scene = { ...card.scene, revision: change.after };
				}
			}
		});

	/** One field of one scene, under the revision the card holds now, which the write then moves on. */
	const patch = (
		entry: CardEntry,
		fields: Pick<ScenePatch, 'title' | 'conflict' | 'color' | 'progressStatus'>,
		base = editRevision(entry.scene),
	): Promise<boolean> => {
		const owningProject = projectPath;
		let saved = false;
		const queued = { base };
		queuedRevisions.add(queued);
		return enqueue(async () => {
			if (owningProject === null) return;
			const expectedRevision = base.revision;
			const revision = await host.patchScene(entry.id, {
				...fields,
				expectedRevision,
			}, owningProject);
			advanceRevision(entry.id, expectedRevision, revision);
			for (const card of new Set([entry, ...cards.values()])) {
				if (card.id === entry.id && card.scene.revision === expectedRevision) {
					card.scene = { ...card.scene, ...fields, revision };
				}
			}
			saved = true;
		}, { persist: true }).then(() => saved).finally(() => {
			queuedRevisions.delete(queued);
			pruneRevisions();
		});
	};

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
			previous.columns === columnsFor(metrics.width, metrics.minCardWidth, metrics.gap) &&
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
		orderedManuscriptLinks = new WeakMap();
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
		const shown: ShownScene[] = filterScenes(
			current.scenes,
			memory.query,
			memory.filters,
			{ t, characterNames, resolveLink: resolveManuscriptPath },
		);
		order = displayOrder(shown, memory.reversed, memory.group, {
			t,
			characters: current.characters,
			locale: current.locale,
			resolveLink: resolveManuscriptPath,
		});
		orderIds = current.scenes.map((scene) => scene.id);
		adjacency = adjacencyAllowed({
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
		const metrics = corkboardMetrics(canvas.clientWidth, memory.mode, rem, compactHeight());
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
						total: current.scenes.length,
					})
				: '',
		);
		markFilterButton();
		const none = current.scenes.length === 0;
		empty.line.toggleClass('is-hidden', !none);
		scroller.toggleClass('is-hidden', none);
		searchBox?.toggleClass('is-hidden', none);
		filterButton.toggleClass('is-hidden', none);
		displayButton.toggleClass('is-hidden', none);
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
		for (const entry of cards.values()) {
			recoverBlockedDraft(entry);
			entry.el.remove();
		}
		closeColorPanel();
		cards.clear();
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
		const focused = active === null || !root.contains(active) ? null : active.closest(CARD_SELECTOR);
		const focusedKey = focused?.getAttribute('data-key');
		if (focusedKey != null) pinned.push(focusedKey);
		for (const entry of cards.values()) {
			if (entry.editingTitle || entry.conflictDirty) pinned.push(entry.key);
		}
		for (const pending of [...pendingTitles.values(), ...pendingConflicts.values()]) {
			pinned.push(pending.key);
		}
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
			unmountCard(nextKey);
			cards.delete(key);
			entry.key = nextKey;
			entry.el.setAttribute('data-key', nextKey);
			cards.set(nextKey, entry);
			pinned.delete(key);
			pinned.add(nextKey);
			if (hold?.key === key) hold.key = nextKey;
			for (const pending of [pendingTitles.get(entry.id), pendingConflicts.get(entry.id)]) {
				if (pending?.key === key) pending.key = nextKey;
			}
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
		for (const key of plan.remove) unmountCard(key);
		for (const key of plan.keep) {
			const entry = cards.get(key);
			const display = wanted.get(key);
			if (entry === undefined) continue;
			if (display === undefined) {
				// A filter, or two distinct drafts collapsing into one group, may
				// leave no place for this editor. Keep it for remounting or disposal.
				entry.display = -1;
				const latest = scenesById.get(entry.id);
				if (latest !== undefined) entry.scene = latest;
				if (!editable(entry)) recoverBlockedDraft(entry);
				if (colorPanel?.entry === entry) closeColorPanel();
				entry.el.remove();
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
				head.createSpan({
					cls: 'snowflake-method-corkboard-group-label',
					text: found.label,
					attr: { role: 'heading', 'aria-level': '3' },
				});
				head.createSpan({ cls: 'snowflake-method-corkboard-group-rule' });
				heads.set(key, head);
			}
			const label = head.querySelector<HTMLElement>('.snowflake-method-corkboard-group-label');
			if (label !== null && label.textContent !== found.label) label.setText(found.label);
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
		dressCard(entry, scene, item.sceneIndex, display);
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

	const unmountCard = (key: string): void => {
		const entry = cards.get(key);
		if (entry === undefined) return;
		if (colorPanel?.entry === entry) closeColorPanel();
		// A deleted scene cannot accept the editor that was pinned to it.
		if (!scenesById.has(entry.id)) recoverBlockedDraft(entry);
		entry.el.remove();
		cards.delete(key);
	};

	const mountCard = (
		key: string,
		display: number,
		current: ProjectDashboardModel,
	): CardEntry | null => {
		const item = layout?.items[display];
		const scene = item === undefined ? undefined : current.scenes[item.sceneIndex];
		if (item === undefined || scene === undefined) return null;
		const el = canvas.createDiv({
			cls: 'snowflake-method-corkboard-card snowflake-method-sticky-tint',
			attr: { role: 'listitem', tabindex: '0', 'data-key': key, 'data-id': scene.id },
		});
		const entry = buildCard(el, key, scene, item.sceneIndex);
		cards.set(key, entry);
		wireCard(entry);
		return entry;
	};

	// -- A card --------------------------------------------------------------

	/** Builds a card's element once: the parts a dressing rewrites rather than remakes. */
	const buildCard = (
		el: HTMLElement,
		key: string,
		scene: SceneViewModel,
		index: number,
	): CardEntry => {
		const head = el.createDiv({ cls: 'snowflake-method-corkboard-head' });
		const number = head.createSpan({
			cls: 'snowflake-method-step-indicator snowflake-method-corkboard-number',
		});
		const title = head.createEl('button', {
			cls: 'snowflake-method-corkboard-title',
			attr: { type: 'button' },
		});
		const titleInput = head.createEl('input', {
			cls: 'snowflake-method-corkboard-title-input is-hidden',
			attr: { type: 'text', 'aria-label': t('corkboard.editName') },
		});
		const status = head.createEl('select', {
			cls: 'dropdown snowflake-method-entity-status snowflake-method-corkboard-status-select',
			attr: { 'aria-label': t('table.progressStatus') },
		});
		const body = el.createDiv({ cls: 'snowflake-method-corkboard-body' });
		const conflict = body.createEl('textarea', {
			cls: 'snowflake-method-corkboard-conflict',
			attr: {
				'aria-label': t('table.conflict'),
				placeholder: t('modal.scene.conflictPlaceholder'),
				rows: '3',
			},
		});
		const links = el.createDiv({
			cls: 'snowflake-method-corkboard-links',
			attr: { role: 'group', 'aria-label': t('table.sceneLinked') },
		});
		const chips = links.createDiv({ cls: 'snowflake-method-corkboard-chips' });
		const moreLinks = links.createEl('button', {
			cls: 'snowflake-method-corkboard-more-links is-hidden',
			attr: { type: 'button', 'aria-haspopup': 'dialog' },
		});
		const footer = el.createDiv({ cls: 'snowflake-method-corkboard-footer' });
		const footerRow = footer.createDiv({ cls: 'snowflake-method-corkboard-footer-row' });
		const pov = footerRow.createEl('button', {
			cls: 'snowflake-method-corkboard-pov',
			attr: { type: 'button', 'aria-haspopup': 'dialog' },
		});
		const actions = footerRow.createDiv({ cls: 'snowflake-method-corkboard-actions' });
		const color = actions.createEl('button', {
			cls: 'clickable-icon snowflake-method-corkboard-color',
			attr: { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
		});
		setIcon(color, 'palette');
		const more = actions.createEl('button', {
			cls: 'clickable-icon snowflake-method-corkboard-more',
			attr: {
				type: 'button',
				'aria-label': t('table.actions'),
				'aria-haspopup': 'menu',
			},
		});
		setIcon(more, 'ellipsis');
		setTooltip(more, t('table.actions'));
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
		return {
			key,
			id: scene.id,
			el,
			scene,
			index,
			display: -1,
			x: Number.NaN,
			y: Number.NaN,
			width: Number.NaN,
			number,
			title,
			titleText: '',
			titleInput,
			editingTitle: false,
			titleOriginal: scene.title,
			titleRevision: editRevision(scene),
			color,
			more,
			pov,
			status,
			statusSignature: '',
			conflict,
			conflictDirty: false,
			conflictOriginal: scene.conflict,
			conflictRevision: editRevision(scene),
			chips,
			moreLinks,
			linksSignature: null,
			insertBefore,
			insertAfter,
		};
	};

	const fillSelect = (
		select: HTMLSelectElement,
		options: readonly CardSelectOption[],
	): void => {
		select.empty();
		for (const option of options) {
			const el = select.createEl('option', {
				text: option.label,
				attr: { value: option.value },
			});
			if (option.disabled) el.disabled = true;
		}
	};

	const editable = (entry: CardEntry): boolean =>
		!readOnly && !entry.scene.readOnly && !entry.scene.healthIssues.some((issue) => issue.blocking);

	const recoverBlockedDraft = (entry: CardEntry): void => {
		const fields: Pick<RecoveredCorkboardDraft, 'title' | 'conflict'> = {};
		if (entry.editingTitle && entry.titleInput.value !== entry.titleOriginal) fields.title = entry.titleInput.value;
		if (entry.conflictDirty && entry.conflict.value !== entry.conflictOriginal) fields.conflict = entry.conflict.value;
		entry.conflictDirty = false;
		if (entry.editingTitle) endTitleEdit(entry, false);
		paintConflict(entry);
		recoverText(entry.scene, fields);
	};

	/** Text and color always represent the same selection, even during a save. */
	const paintStatus = (entry: CardEntry, value: ProgressStatus | null): void => {
		entry.status.value = value ?? '';
		for (const status of PROGRESS_STATUSES) {
			entry.status.toggleClass(`is-${status}`, value === status);
		}
	};

	const paintTitle = (entry: CardEntry): void => {
		if (entry.editingTitle) return;
		const title = pendingTitles.get(entry.id)?.value ?? entry.scene.title;
		if (entry.titleText === title) return;
		entry.titleText = title;
		entry.title.setText(title);
		setTooltip(entry.title, title);
	};

	const paintConflict = (entry: CardEntry): void => {
		if (entry.conflictDirty) return;
		const pending = pendingConflicts.get(entry.id);
		const value = pending?.value ?? entry.scene.conflict;
		if (entry.conflict.value !== value) entry.conflict.value = value;
		entry.conflictOriginal = value;
		entry.conflictRevision = pending?.base ?? editRevision(entry.scene);
	};

	/** Dresses the card from the model while preserving unfinished and pending edits. */
	const dressCard = (
		entry: CardEntry,
		scene: SceneViewModel,
		index: number,
		display: number,
	): void => {
		entry.scene = scene;
		entry.index = index;
		entry.display = display;
		const { el } = entry;
		const writable = editable(entry);
		if (!writable) recoverBlockedDraft(entry);
		if (!writable && colorPanel?.entry === entry) closeColorPanel();
		el.setAttribute('data-id', scene.id);
		el.setAttribute('aria-setsize', String(layout?.items.length ?? order.shown));
		el.setAttribute('aria-posinset', String(display + 1));
		if (scene.color === null) el.removeAttribute('data-color');
		else el.setAttribute('data-color', scene.color);
		el.toggleClass('is-read-only', !writable);
		el.toggleClass('has-managed-section-issue', scene.healthIssues.some((issue) => issue.blocking));
		el.setAttribute('draggable', adjacency && writable && !pressed ? 'true' : 'false');
		paintCount(entry.number, index + 1);
		entry.number.setAttribute(
			'aria-label',
			t('corkboard.position', { number: index + 1 }),
		);
		paintTitle(entry);
		entry.title.disabled = !writable;
		const colorLabel =
			scene.color === null
				? t('modal.scene.colorNone')
				: t(`stickyNotes.color.${scene.color}`);
		entry.color.setAttribute('aria-label', t('corkboard.colorLabel', { color: colorLabel }));
		setTooltip(entry.color, colorLabel);
		entry.color.disabled = !writable;
		const povLabel = t('corkboard.povLabel', { name: scene.povName || '—' });
		if (entry.pov.textContent !== povLabel) entry.pov.setText(povLabel);
		setTooltip(
			entry.pov,
			scene.povMissing
				? t('table.referenceMissing', { name: scene.povName })
				: povLabel,
		);
		entry.pov.toggleClass('is-missing', scene.povMissing);
		const character = charactersByPath.get(scene.povPath);
		entry.pov.disabled =
			readOnly || character === undefined || character.readOnly || character.healthIssues.some((issue) => issue.blocking);
		const shownStatus = pendingStatuses.get(scene.id)?.value ?? scene.progressStatus;
		const statuses = statusOptions(shownStatus, t);
		const statusSignature = statuses.map((option) => option.value).join('\n');
		if (statusSignature !== entry.statusSignature) {
			entry.statusSignature = statusSignature;
			fillSelect(entry.status, statuses);
		}
		paintStatus(entry, shownStatus);
		entry.status.disabled = !writable;
		paintConflict(entry);
		entry.conflict.readOnly = !writable;
		let links = orderedManuscriptLinks.get(scene);
		if (links === undefined) {
			links = orderManuscriptReferences(scene.linkedManuscript, manuscriptPositions, (link) =>
				resolveManuscriptPath(link.target, scene.path),
			);
			orderedManuscriptLinks.set(scene, links);
		}
		const linksSignature = JSON.stringify(links.map((link) => [link.raw,
			resolveManuscriptPath(link.target, scene.path)]));
		if (linksSignature !== entry.linksSignature) {
			entry.linksSignature = linksSignature;
			dressLinks(entry, scene, links);
		}
		entry.moreLinks.disabled = false;
		const canInsert = adjacency && writable;
		entry.insertBefore.toggleClass('is-hidden', !canInsert);
		entry.insertAfter.toggleClass('is-hidden', !canInsert);
	};

	const dressLinks = (
		entry: CardEntry,
		scene: SceneViewModel,
		orderedLinks: SceneViewModel['linkedManuscript'],
	): void => {
		entry.chips.empty();
		const { shown, remaining } = linkedManuscriptPreview(orderedLinks);
		entry.el.toggleClass('has-more-links', remaining > 0);
		entry.moreLinks.toggleClass('is-hidden', remaining === 0);
		entry.moreLinks.setText(`+${String(remaining)}`);
		const moreLabel = t(remaining === 1 ? 'corkboard.moreLinkedOne' : 'corkboard.moreLinked', { count: remaining });
		entry.moreLinks.setAttribute('aria-label', moreLabel);
		setTooltip(entry.moreLinks, moreLabel);
		if (scene.linkedManuscript.length === 0) {
			renderEmptyLine(entry.chips, t('corkboard.none.linked'));
		}
		for (const link of shown) {
			const missing =
				resolveManuscriptPath(link.target, scene.path) === null;
			const chip = entry.chips.createEl('button', {
				cls: `snowflake-method-corkboard-link${missing ? ' is-missing' : ''}`,
				attr: { type: 'button' },
			});
			if (missing) {
				const icon = chip.createSpan({
					cls: 'snowflake-method-corkboard-link-icon',
					attr: { 'aria-hidden': 'true' },
				});
				setIcon(icon, 'triangle-alert');
				setTooltip(chip, t('table.referenceMissing', { name: link.label }));
			} else {
				setTooltip(chip, link.linktext);
			}
			chip.createSpan({ cls: 'snowflake-method-corkboard-link-prefix', text: t('corkboard.linkedPrefix') });
			chip.createSpan({ cls: 'snowflake-method-corkboard-link-label', text: link.label });
			chip.addEventListener('click', (event) => {
				event.stopPropagation();
				const file = app.metadataCache.getFirstLinkpathDest(link.target, entry.scene.path);
				if (file === null) {
					new Notice(t('table.referenceMissing', { name: link.label }));
					return;
				}
				if (model !== null) void host.openManuscriptStream(model.path, file.path).catch(notice);
			});
		}
	};

	// -- Editing in place ----------------------------------------------------

	const beginTitleEdit = (entry: CardEntry): void => {
		if (!editable(entry) || entry.editingTitle) return;
		const pending = pendingTitles.get(entry.id);
		entry.editingTitle = true;
		entry.titleOriginal = pending?.value ?? entry.scene.title;
		entry.titleRevision = pending?.base ?? editRevision(entry.scene);
		entry.title.addClass('is-hidden');
		entry.titleInput.removeClass('is-hidden');
		entry.titleInput.value = entry.titleOriginal;
		entry.titleInput.focus();
		entry.titleInput.select();
	};

	const endTitleEdit = (entry: CardEntry, refocus: boolean): void => {
		entry.editingTitle = false;
		entry.titleInput.addClass('is-hidden');
		entry.title.removeClass('is-hidden');
		paintTitle(entry);
		if (refocus) entry.title.focus({ preventScroll: true });
	};

	const saveText = (
		entry: CardEntry,
		field: 'title' | 'conflict',
		pending: PendingText,
	): void => {
		const values = field === 'title' ? pendingTitles : pendingConflicts;
		const paint = field === 'title' ? paintTitle : paintConflict;
		values.set(entry.id, pending);
		for (const card of cards.values()) {
			if (card.id === entry.id) paint(card);
		}
		void patch(entry, { [field]: pending.value }, pending.base).then((saved) => {
			if (values.get(entry.id) !== pending) return;
			values.delete(entry.id);
			if (disposed) {
				if (!saved) recoverText(entry.scene, { [field]: pending.value });
				return;
			}
			if (!saved) {
				// A rejected revision leaves the local draft available to fix
				// or cancel with Escape; the refreshed model remains its own.
				const draft = cards.get(entry.key) ??
					[...cards.values()].find((card) => card.id === entry.id) ?? entry;
				if (!editable(draft) || !scenesById.has(entry.id)) {
					recoverText(entry.scene, { [field]: pending.value });
				} else if (field === 'conflict' && !draft.conflictDirty) {
					draft.conflict.value = pending.value;
					draft.conflictOriginal = pending.original;
					draft.conflictRevision = pending.base;
					draft.conflictDirty = true;
				} else if (field === 'title' && !draft.editingTitle) {
					draft.editingTitle = true;
					draft.titleOriginal = pending.original;
					draft.titleRevision = pending.base;
					draft.titleInput.value = pending.value;
					draft.title.addClass('is-hidden');
					draft.titleInput.removeClass('is-hidden');
				}
			}
			for (const card of cards.values()) {
				if (card.id === entry.id) paint(card);
			}
		});
	};

	/** The typed name, refused as the form refuses one: empty, or another scene's. */
	const commitTitle = (entry: CardEntry, refocus: boolean): void => {
		if (!entry.editingTitle) return;
		if (!editable(entry)) {
			recoverBlockedDraft(entry);
			return;
		}
		const typed = entry.titleInput.value.trim();
		if (typed === entry.titleOriginal) {
			endTitleEdit(entry, refocus);
			return;
		}
		if (typed.length === 0) {
			new Notice(t('modal.scene.nameRequired'));
			return;
		}
		if (
			typed !== entry.scene.title &&
			model !== null &&
			titleTaken(typed, entry.id, model.scenes)
		) {
			new Notice(t('modal.scene.nameTaken'));
			return;
		}
		endTitleEdit(entry, refocus);
		if (typed === entry.scene.title && !pendingTitles.has(entry.id)) return;
		saveText(entry, 'title', {
			value: typed, base: entry.titleRevision, original: entry.titleOriginal, key: entry.key,
		});
	};

	const commitConflict = (entry: CardEntry): void => {
		if (!editable(entry)) {
			recoverBlockedDraft(entry);
			return;
		}
		if (!entry.conflictDirty) {
			paintConflict(entry);
			return;
		}
		const value = entry.conflict.value;
		entry.conflictDirty = false;
		if (value === entry.scene.conflict && !pendingConflicts.has(entry.id)) {
			paintConflict(entry);
			return;
		}
		saveText(entry, 'conflict', {
			value, base: entry.conflictRevision, original: entry.conflictOriginal, key: entry.key,
		});
	};

	const closeColorPanel = (): void => {
		const open = colorPanel;
		if (open === null) return;
		colorPanel = null;
		open.hung.release();
		open.hung.el.remove();
	};

	const toggleColorPanel = (entry: CardEntry): void => {
		if (colorPanel?.entry === entry) {
			closeColorPanel();
			return;
		}
		closeColorPanel();
		if (!editable(entry)) return;
		const hung = hangPanel(entry.color, {
			cls: 'snowflake-method-corkboard-color-panel',
			label: t('stickyNotes.color'),
			build: (panel) => {
				renderStickySwatches(panel, {
					value: entry.scene.color ?? '',
					t,
					onPick: (value) => {
						closeColorPanel();
						if (editable(entry)) void patch(entry, { color: value });
					},
					none: {
						label: t('modal.scene.colorNone'),
						onPick: () => {
							closeColorPanel();
							if (editable(entry)) void patch(entry, { color: null });
						},
					},
				});
			},
			onClose: () => {
				closeColorPanel();
			},
		});
		colorPanel = { entry, hung };
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

	const isControl = (target: EventTarget | null): boolean => {
		if (target === null || !(target as Node).instanceOf(Element)) return false;
		return (target as Element).closest(CONTROL_SELECTOR) !== null;
	};

	const wireCard = (entry: CardEntry): void => {
		const { el } = entry;
		entry.title.addEventListener('click', () => {
			beginTitleEdit(entry);
		});
		entry.titleInput.addEventListener('keydown', (event) => {
			if (event.isComposing) return;
			if (event.key === 'Enter') {
				event.preventDefault();
				commitTitle(entry, true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				endTitleEdit(entry, true);
			}
		});
		entry.titleInput.addEventListener('blur', () => {
			commitTitle(entry, false);
		});
		entry.pov.addEventListener('click', (event) => {
			event.stopPropagation();
			const owningProject = projectPath;
			const character = charactersByPath.get(entry.scene.povPath);
			if (readOnly || owningProject === null || character === undefined || character.readOnly ||
				character.healthIssues.some((issue) => issue.blocking)) return;
			openForm((onSaved) => host.openCharacterForm(character.id, owningProject, onSaved));
		});
		entry.status.addEventListener('change', () => {
			const value = entry.status.value;
			if (!isProgressStatus(value) || !editable(entry)) return;
			const previous = pendingStatuses.get(entry.id)?.value ?? entry.scene.progressStatus;
			if (value === previous) return;
			const pending = { value };
			pendingStatuses.set(entry.id, pending);
			for (const card of cards.values()) {
				if (card.id === entry.id) paintStatus(card, value);
			}
			void patch(entry, { progressStatus: value }).then(() => {
				// Keep the selection through the refresh as well as the write.
				if (pendingStatuses.get(entry.id) === pending) pendingStatuses.delete(entry.id);
				if (!disposed) {
					for (const card of cards.values()) {
						if (card.id === entry.id) {
							paintStatus(card, pendingStatuses.get(card.id)?.value ?? card.scene.progressStatus);
						}
					}
				}
			});
		});
		entry.moreLinks.addEventListener('click', (event) => {
			event.stopPropagation();
			const owningProject = projectPath;
			if (owningProject === null) return;
			if (!editable(entry)) {
				const menu = new Menu();
				for (const link of entry.scene.linkedManuscript) {
					menu.addItem((item) => item.setTitle(link.label).setIcon('file-text').onClick(() => {
						const file = app.metadataCache.getFirstLinkpathDest(link.target, entry.scene.path);
						if (file === null) new Notice(t('table.referenceMissing', { name: link.label }));
						else void host.openManuscriptStream(owningProject, file.path).catch(notice);
					}));
				}
				menu.showAtMouseEvent(event);
				return;
			}
			openForm((onSaved) => host.openSceneForm({
				mode: 'edit',
				id: entry.id,
				section: 'linked-manuscript',
			}, owningProject, onSaved));
		});
		entry.conflict.addEventListener('input', () => {
			entry.conflictDirty = entry.conflict.value !== entry.conflictOriginal;
		});
		entry.conflict.addEventListener('blur', () => {
			commitConflict(entry);
		});
		entry.conflict.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && Keymap.isModifier(event, 'Mod')) {
				event.preventDefault();
				commitConflict(entry);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				entry.conflictDirty = false;
				paintConflict(entry);
				el.focus({ preventScroll: true });
			}
		});
		entry.color.addEventListener('click', (event) => {
			event.stopPropagation();
			toggleColorPanel(entry);
		});
		entry.more.addEventListener('click', (event) => {
			event.stopPropagation();
			openMenu(entry, event);
		});
		const wireInsert = (button: HTMLButtonElement, side: 'before' | 'after'): void => {
			button.addEventListener('click', (event) => {
				event.stopPropagation();
				if (!adjacency || !editable(entry)) return;
				insertAt({ id: entry.id, side });
			});
		};
		wireInsert(entry.insertBefore, 'before');
		wireInsert(entry.insertAfter, 'after');
		el.addEventListener('contextmenu', (event) => {
			if (isControl(event.target) && event.target !== entry.more) return;
			event.preventDefault();
			openMenu(entry, event);
		});
		// Only the card's own key: a control inside it answers its own.
		el.addEventListener('keydown', (event) => {
			if (event.target !== el) return;
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			void host.openManagedFile(entry.scene.path).catch(notice);
		});
		// A press on a control is a selection or a choice beginning, and a
		// card that drags under it would swallow both.
		el.addEventListener('mousedown', (event) => {
			if (!isControl(event.target)) return;
			pressed = true;
			el.setAttribute('draggable', 'false');
		});
		el.addEventListener('dragstart', (event) => {
			if (
				!adjacency ||
				!editable(entry) ||
				event.dataTransfer === null ||
				isControl(event.target)
			) {
				event.preventDefault();
				return;
			}
			drag = { key: entry.key, id: entry.id };
			dragRect = null;
			el.addClass('is-dragging');
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(SCENE_DRAG_TYPE, entry.id);
		});
		// Fires on the source however the drag ends: dropped, dropped nowhere,
		// or cancelled. Everything the drag marked clears here.
		el.addEventListener('dragend', () => {
			el.removeClass('is-dragging');
			clearMark();
			drag = null;
			dragRect = null;
			if (paintOwed) {
				paintOwed = false;
				paintAll();
			}
		});
	};

	const releasePress = (): void => {
		if (!pressed) return;
		pressed = false;
		for (const entry of cards.values()) {
			entry.el.setAttribute(
				'draggable',
				adjacency && editable(entry) ? 'true' : 'false',
			);
		}
	};
	let eventWindow = root.win;
	const invalidateDragRect = (): void => { dragRect = null; };
	const bindWindow = (win: Window): void => {
		win.addEventListener('mouseup', releasePress, true);
		win.addEventListener('scroll', invalidateDragRect, true);
		win.addEventListener('resize', invalidateDragRect);
	};
	const unbindWindow = (win: Window): void => {
		win.removeEventListener('mouseup', releasePress, true);
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
	canvas.addEventListener('dragover', (event) => {
		if (
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
		const card = active.closest(CARD_SELECTOR);
		if (card === null) return null;
		const key = card.getAttribute('data-key') ?? '';
		const part =
			PART_CLASSES.find(([, cls]) => active.classList.contains(cls))?.[0] ?? 'card';
		return { key, part, el: active, display: cards.get(key)?.display ?? -1 };
	};

	const partOf = (entry: CardEntry, part: FocusPart): Element => {
		switch (part) {
			case 'title':
				return entry.editingTitle ? entry.titleInput : entry.title;
			case 'pov':
				return entry.pov;
			case 'status':
				return entry.status;
			case 'color':
				return entry.color;
			case 'more':
				return entry.more;
			case 'conflict':
				return entry.conflict;
			case 'insert-before':
				return entry.insertBefore;
			case 'insert-after':
				return entry.insertAfter;
			case 'more-links':
				return entry.moreLinks;
			case 'link':
				return entry.chips.querySelector('button') ?? entry.el;
			case 'card':
				return entry.el;
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
			...new Set(current.scenes.flatMap((scene) => scene.categoryPaths)),
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
		const metrics = corkboardMetrics(width, memory.mode, remPx(), compactHeight());
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
		closeColorPanel();
		releasePress();
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
				commitConflict(entry);
				return true;
			}
			return false;
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			popoverRequest++;
			controls.popover.closeFilter();
			closeColorPanel();
			if (searchTimer !== null) searchWindow.clearTimeout(searchTimer);
			if (frame !== null) animationWindow.cancelAnimationFrame(frame);
			observer?.disconnect();
			stopMigration?.();
			unbindWindow(eventWindow);
			// Final drafts join accepted saves in the same order. They retain
			// this board's project and revisions after its view has gone away.
			for (const entry of cards.values()) {
				commitTitle(entry, false);
				commitConflict(entry);
				if (entry.editingTitle) recoverBlockedDraft(entry);
			}
			root.remove();
		},
	};
}
