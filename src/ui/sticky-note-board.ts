/**
 * The sticky notes of one project laid out as cards: on the dashboard's tab
 * in a grid with the archive under it, in the sidebar as a single column.
 * The board reads through the bridge, listens to the hub for every change
 * anywhere, and repaints only what moved: a card whose note still stands is
 * updated in place, a card being edited is pinned through a filter that
 * dropped it, and new cards go up a batch a frame so a long list opens
 * without a stall. The archive is a second lane of the same cards with
 * controls of its own, set aside rather than gone.
 */

import { SearchComponent, setIcon, setTooltip, type App, type Component } from 'obsidian';

import {
	filterStickyNotes,
	partitionStickyNotes,
	sortStickyNotes,
	type StickyNoteColor,
	type StickyNoteSort,
} from '../domain';
import type { StickyNoteRecord } from '../services';
import { hangPanel } from './anchored-panel';
import type { Translate } from './modals';
import { renderEmptyLine } from './pane-parts';
import { refreshLoop } from './refresh-loop';
import { PublicCodeMirrorBackend } from './segment-editor-backend';
import type { StickyNoteBridge, StickyNoteReading } from './sticky-note-bridge';
import {
	renderStickyNoteCard,
	renderStickySwatches,
	type StickyNoteCardHandle,
	type StickyNoteSurface,
} from './sticky-note-card';
import { batchSchedule, planCardMoves, planCardRepaint } from './sticky-note-layout';

/** What one row of controls narrows a lane by: the words, the colour, the order. */
export interface StickyNoteBoardLens {
	query: string;
	color: StickyNoteColor | '';
	sort: StickyNoteSort;
}

/** What the board remembers across rebuilds: a lens for each lane, and whether the archive is open. */
export interface StickyNoteBoardMemory {
	live: StickyNoteBoardLens;
	archive: StickyNoteBoardLens;
	archiveOpen: boolean;
}

const stickyBoardLens = (): StickyNoteBoardLens => ({ query: '', color: '', sort: 'newest' });

export const stickyBoardMemory = (): StickyNoteBoardMemory => ({
	live: stickyBoardLens(),
	archive: stickyBoardLens(),
	archiveOpen: false,
});

export interface StickyNoteBoardOptions {
	app: App;
	surface: Exclude<StickyNoteSurface, 'floating'>;
	compact: boolean;
	/** The archive under the cards; the dashboard's board only. */
	archive: boolean;
	/** The dashboard lays its controls over the tab strip's row; the sidebar in a row of their own. */
	controls: 'band' | 'inline';
	memory: StickyNoteBoardMemory;
	/** What the rendered Markdown lives under: the view. */
	component: Component;
	locale: string;
}

export interface StickyNoteBoardHandle {
	refresh(): void;
	/** After the board was handed back into a rebuilt frame with an editor mounted. */
	remeasure(): void;
	dispose(): void;
}

const CARDS_PER_FRAME = 24;

let boardCount = 0;

interface ControlsHandle {
	band: HTMLElement;
	searchBox: Element | null;
	filterButton: HTMLElement;
	stateText: HTMLElement;
	closeFilterPanel(): void;
}

/**
 * One row of controls over a lane: the search, the sort, the funnel with the
 * colour strip in the shared filter panel (a draft until confirmed), the
 * state, and the refresh. Whatever else a lane wants at the row's end is
 * appended by the caller.
 */
function renderControls(
	host: HTMLElement,
	spec: {
		cls: string;
		lens: StickyNoteBoardLens;
		t: Translate;
		onChange(): void;
		onRefresh(): void;
	},
): ControlsHandle {
	const { lens, t } = spec;
	const band = host.createDiv({ cls: spec.cls });
	const search = new SearchComponent(band);
	search.setPlaceholder(t('stickyNotes.searchPlaceholder'));
	search.setValue(lens.query);
	search.onChange((next) => {
		lens.query = next;
		spec.onChange();
	});
	const searchBox = band.querySelector('.search-input-container');
	const sortButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-sticky-sort',
		attr: { type: 'button' },
	});
	const paintSort = (): void => {
		const newest = lens.sort === 'newest';
		setIcon(sortButton, newest ? 'arrow-down-narrow-wide' : 'arrow-up-narrow-wide');
		const label = t(newest ? 'stickyNotes.sortNewest' : 'stickyNotes.sortOldest');
		sortButton.setAttribute('aria-label', label);
		setTooltip(sortButton, label);
	};
	paintSort();
	sortButton.addEventListener('click', () => {
		lens.sort = lens.sort === 'newest' ? 'oldest' : 'newest';
		paintSort();
		spec.onChange();
	});
	const filterButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-filter-button snowflake-method-sticky-filter',
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
		filterButton.toggleClass('is-active', lens.color !== '');
	};
	markFilterButton();
	let filterPanel: { el: HTMLElement; release(): void } | null = null;
	const closeFilterPanel = (): void => {
		const open = filterPanel;
		if (open === null) return;
		filterPanel = null;
		open.release();
		open.el.remove();
	};
	const openFilterPanel = (anchor: HTMLElement): void => {
		closeFilterPanel();
		// Held on an object: the button is made inside the build and focused after.
		const focus: { button: HTMLButtonElement | null } = { button: null };
		filterPanel = hangPanel(anchor, {
			cls: 'snowflake-method-filter-panel snowflake-method-sticky-filter-panel',
			label: t('table.filter'),
			build: (panel) => {
				panel.createDiv({
					cls: 'snowflake-method-filter-panel-title',
					text: t('table.filter'),
				});
				const body = panel.createDiv({ cls: 'snowflake-method-filter-panel-body' });
				const field = body.createDiv({ cls: 'snowflake-method-filter-row' });
				field.createDiv({
					cls: 'snowflake-method-filter-label',
					text: t('stickyNotes.color'),
				});
				// A swatch chosen once narrows to its colour; chosen again it
				// lets go, and with none chosen every colour shows.
				let draft = lens.color;
				const strip = renderStickySwatches(field, {
					value: draft,
					t,
					onPick: (value) => {
						draft = draft === value ? '' : value;
						strip.sync(draft);
					},
				});
				const actions = panel.createDiv({
					cls: 'snowflake-method-filter-panel-actions',
				});
				const reset = actions.createEl('button', {
					cls: 'snowflake-method-filter-reset',
					text: t('table.filterReset'),
					attr: { type: 'button' },
				});
				reset.addEventListener('click', () => {
					draft = '';
					strip.sync(draft);
				});
				const confirm = actions.createEl('button', {
					cls: 'mod-cta',
					text: t('table.filterConfirm'),
					attr: { type: 'button' },
				});
				focus.button = confirm;
				confirm.addEventListener('click', () => {
					lens.color = draft;
					closeFilterPanel();
					markFilterButton();
					spec.onChange();
				});
			},
			onClose: closeFilterPanel,
		});
		focus.button?.focus();
	};
	filterButton.addEventListener('click', () => {
		if (filterPanel !== null) closeFilterPanel();
		else openFilterPanel(filterButton);
	});
	const stateText = band.createSpan({ cls: 'snowflake-method-prose-state' });
	const refreshButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-prose-refresh',
		attr: { type: 'button', 'aria-label': t('stickyNotes.refresh') },
	});
	setIcon(refreshButton, 'refresh-cw');
	setTooltip(refreshButton, t('stickyNotes.refresh'));
	refreshButton.addEventListener('click', () => {
		spec.onRefresh();
	});
	return { band, searchBox, filterButton, stateText, closeFilterPanel };
}

export function renderStickyNoteBoard(
	container: HTMLElement,
	bridge: StickyNoteBridge,
	options: StickyNoteBoardOptions,
): StickyNoteBoardHandle {
	const t = bridge.t;
	const memory = options.memory;
	boardCount += 1;
	const ownerId = `${options.surface}-${String(boardCount)}`;
	const backend = new PublicCodeMirrorBackend();
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-sticky-board',
	});
	root.toggleClass('is-compact', options.compact);

	const controls = renderControls(root, {
		cls:
			options.controls === 'band'
				? 'snowflake-method-prose-controls'
				: 'snowflake-method-sticky-controls',
		lens: memory.live,
		t,
		onChange: () => {
			paint();
		},
		onRefresh: () => {
			loop.refresh();
		},
	});
	const { searchBox, filterButton, stateText } = controls;
	const band = controls.band;
	const addButton = options.compact
		? band.createEl('button', {
				cls: 'clickable-icon snowflake-method-sticky-add',
				attr: { type: 'button', 'aria-label': t('stickyNotes.add') },
			})
		: band.createEl('button', {
				cls: 'mod-cta snowflake-method-sticky-add',
				text: t('stickyNotes.add'),
				attr: { type: 'button' },
			});
	if (options.compact) {
		setIcon(addButton, 'plus');
		setTooltip(addButton, t('stickyNotes.add'));
	}
	addButton.disabled = true;
	addButton.addEventListener('click', () => {
		void bridge
			.create()
			.then((note) => {
				if (note === null) return;
				return bridge.float(note.id, root.win, { mode: 'editing', focus: true });
			})
			.catch(() => {
				stateText.setText(t('stickyNotes.refused'));
			});
	});

	// The cards scroll in a scroller of their own under the band, so the
	// search and its buttons stay put however far the board runs.
	const scroll = root.createDiv({ cls: 'snowflake-method-sticky-scroll' });
	const grid = scroll.createDiv({
		cls: 'snowflake-method-sticky-grid',
		attr: { role: 'list' },
	});
	const { line: emptyLine, text: emptyText } = renderEmptyLine(scroll, '');

	// The archive as the project manager pins its archived projects: a
	// section under the scrolling cards, a toggle row with the count in a
	// badge, and under it a row of controls of its own over a list in a
	// scroller of its own, so the row stays put while the list runs.
	let archive: {
		section: HTMLElement;
		count: HTMLElement;
		controls: ControlsHandle;
		emptyButton: HTMLButtonElement;
		grid: HTMLElement;
		empty: HTMLElement;
		emptyText: HTMLElement;
	} | null = null;
	if (options.archive) {
		const section = root.createDiv({ cls: 'snowflake-method-sticky-archive' });
		const toggle = section.createEl('button', {
			cls: 'snowflake-method-sticky-archive-toggle',
			attr: { type: 'button', 'aria-expanded': String(memory.archiveOpen) },
		});
		toggle.createSpan({ text: t('stickyNotes.archiveTitle') });
		const count = toggle
			.createSpan({ cls: 'snowflake-method-sticky-archive-count' })
			.createSpan({ cls: 'snowflake-method-step-indicator' });
		const body = section.createDiv({ cls: 'snowflake-method-sticky-archive-body' });
		body.toggleClass('is-collapsed', !memory.archiveOpen);
		toggle.addEventListener('click', () => {
			memory.archiveOpen = !memory.archiveOpen;
			toggle.setAttribute('aria-expanded', String(memory.archiveOpen));
			body.toggleClass('is-collapsed', !memory.archiveOpen);
		});
		const archiveControls = renderControls(body, {
			cls: 'snowflake-method-sticky-controls snowflake-method-sticky-archive-controls',
			lens: memory.archive,
			t,
			onChange: () => {
				paint();
			},
			onRefresh: () => {
				loop.refresh();
			},
		});
		// The way out for every note set aside at once, behind one confirmation.
		const emptyButton = archiveControls.band.createEl('button', {
			cls: 'mod-warning snowflake-method-sticky-empty-archive',
			text: t('stickyNotes.emptyArchive'),
			attr: { type: 'button' },
		});
		emptyButton.disabled = true;
		// One width for the two text buttons: the wider of their own natural
		// widths, measured on a stand-in for the one still folded away, rather
		// than a fixed measure that pads a short label out to a long one.
		if (!options.compact) {
			const standIn = band.createEl('button', {
				cls: 'mod-warning snowflake-method-sticky-empty-archive snowflake-method-sticky-measure',
				text: t('stickyNotes.emptyArchive'),
				attr: { type: 'button', 'aria-hidden': 'true' },
			});
			const width = Math.max(addButton.offsetWidth, standIn.offsetWidth);
			standIn.remove();
			if (width > 0) {
				root.setCssProps({ '--snowflake-method-sticky-action-width': `${String(width)}px` });
			}
		}
		emptyButton.addEventListener('click', () => {
			told(
				bridge.deleteArchived(
					archivedNotes.map((note) => ({ id: note.id, path: note.path })),
				),
			);
		});
		const list = body.createDiv({ cls: 'snowflake-method-sticky-archive-list' });
		const shelfGrid = list.createDiv({
			cls: 'snowflake-method-sticky-grid snowflake-method-sticky-archive-grid',
			attr: { role: 'list' },
		});
		const { line: empty, text: archiveEmptyText } = renderEmptyLine(list, '');
		archive = {
			section,
			count,
			controls: archiveControls,
			emptyButton,
			grid: shelfGrid,
			empty,
			emptyText: archiveEmptyText,
		};
	}

	let reading: StickyNoteReading | null = null;
	let readOnly = false;
	/** The notes set aside as the last reading had them: what the empty button takes out. */
	let archivedNotes: readonly StickyNoteRecord[] = [];

	/** A refused change is said in the state text, as the tables say theirs. */
	const told = (work: Promise<boolean>): void => {
		void work
			.then((took) => {
				if (!took) stateText.setText(t('stickyNotes.refused'));
			})
			.catch(() => {
				stateText.setText(t('stickyNotes.refused'));
			});
	};

	/** A grid of cards keyed by note id, laid down a batch a frame: the board's, and the archive's. */
	interface Lane {
		grid: HTMLElement;
		cards: Map<string, StickyNoteCardHandle>;
		pass: number;
		cancel: (() => void) | null;
		archived: boolean;
	}
	const lane = (laneGrid: HTMLElement, archived: boolean): Lane => ({
		grid: laneGrid,
		cards: new Map(),
		pass: 0,
		cancel: null,
		archived,
	});
	const live = lane(grid, false);
	const shelf = archive === null ? null : lane(archive.grid, true);
	const lanes = shelf === null ? [live] : [live, shelf];

	const cardDeps = (): Parameters<typeof renderStickyNoteCard>[2] => ({
		app: options.app,
		t,
		bridge,
		component: options.component,
		backend,
		locale: options.locale,
		readOnly,
		ownerId,
	});

	const takeDown = (from: Lane, id: string): void => {
		const card = from.cards.get(id);
		if (card === undefined) return;
		from.cards.delete(id);
		void card.dispose();
	};

	/** Puts a new card where the order says, before the next card that stands. */
	const place = (from: Lane, el: HTMLElement, id: string, order: readonly string[]): void => {
		const at = order.indexOf(id);
		for (let index = at + 1; index < order.length; index += 1) {
			const next = from.cards.get(order[index] ?? '');
			if (next !== undefined) {
				from.grid.insertBefore(el, next.el);
				return;
			}
		}
		from.grid.appendChild(el);
	};

	const show = (el: Element | null, shown: boolean): void => {
		el?.toggleClass('is-hidden', !shown);
	};

	/** A lane's notes through its lens: the words, the colour, the order. */
	const through = (
		lens: StickyNoteBoardLens,
		notes: readonly StickyNoteRecord[],
	): StickyNoteRecord[] =>
		sortStickyNotes(
			filterStickyNotes(notes, lens.query, lens.color === '' ? null : lens.color),
			lens.sort,
		);

	/**
	 * Brings a lane level with `shown`: cards gone come down, cards standing
	 * take their note and their place, cards new go up a batch a frame. A
	 * pinned card stays though the filter dropped it.
	 */
	const repaint = (
		from: Lane,
		shown: readonly StickyNoteRecord[],
		pinned: readonly string[],
		anyById: ReadonlyMap<string, StickyNoteRecord>,
	): void => {
		const byId = new Map(shown.map((note) => [note.id, note] as const));
		const plan = planCardRepaint([...from.cards.keys()], shown.map((note) => note.id), pinned);
		for (const id of plan.remove) takeDown(from, id);
		for (const id of plan.keep) {
			const card = from.cards.get(id);
			const note = byId.get(id) ?? anyById.get(id);
			if (card === undefined || note === undefined) continue;
			card.update(note);
			card.el.toggleClass('is-pinned', !byId.has(id));
		}
		// The standing cards brought into the order, moving only the ones out
		// of place: a card moved in the DOM drops the document's focus, with
		// no blur to say so, and the card being typed in is in this order
		// every time the bell rings. Whatever held the focus and is still on
		// the grid afterwards is given it back.
		const doc = from.grid.doc;
		const active = doc.activeElement;
		const present = Array.from(from.grid.children).map(
			(child) => child.getAttribute('data-id') ?? '',
		);
		for (const move of planCardMoves(present, plan.order)) {
			const card = from.cards.get(move.id);
			if (card === undefined) continue;
			from.grid.insertBefore(card.el, from.cards.get(move.before)?.el ?? null);
		}
		if (
			active !== null &&
			doc.activeElement !== active &&
			from.grid.contains(active) &&
			'focus' in active
		) {
			(active as HTMLElement).focus({ preventScroll: true });
		}
		from.cancel?.();
		from.pass += 1;
		const current = from.pass;
		from.cancel = batchSchedule(
			plan.add,
			CARDS_PER_FRAME,
			(id) => {
				const note = byId.get(id);
				if (note === undefined || from.cards.has(id)) return;
				const card = renderStickyNoteCard(from.grid, note, cardDeps(), {
					surface: options.surface,
					archived: from.archived,
				});
				from.cards.set(id, card);
				place(from, card.el, id, plan.order);
			},
			(callback) => from.grid.win.requestAnimationFrame(callback),
			() => from.pass === current && from.grid.isConnected,
		);
	};

	const paint = (): void => {
		if (loop.disposed) return;
		if (reading === null) {
			stateText.setText(
				t(
					loop.loading
						? 'stickyNotes.loading'
						: loop.failed
							? 'stickyNotes.loadFailed'
							: 'stickyNotes.noProject',
				),
			);
			show(searchBox, false);
			show(filterButton, false);
			show(grid, false);
			show(archive?.section ?? null, false);
			show(emptyLine, false);
			addButton.disabled = true;
			return;
		}
		if (reading.readOnly !== readOnly) {
			// The gate moved: every card was built for the other answer.
			readOnly = reading.readOnly;
			for (const from of lanes) {
				for (const id of [...from.cards.keys()]) takeDown(from, id);
			}
		}
		addButton.disabled = readOnly;
		const { active, archived } = partitionStickyNotes(reading.notes);
		const activeIds = new Set(active.map((note) => note.id));
		const shown = through(memory.live, active);
		show(searchBox, active.length > 0);
		show(filterButton, active.length > 0);
		stateText.setText(
			shown.length === active.length
				? ''
				: t('table.filteredCount', { shown: shown.length, total: active.length }),
		);
		const anyById = new Map(reading.notes.map((note) => [note.id, note] as const));
		// Only a card whose note still stands may hold its place against the
		// filter: an editing card of a note set aside comes down like any other.
		const pinned = [...live.cards.values()]
			.filter((card) => card.mode === 'editing' && activeIds.has(card.id))
			.map((card) => card.id);
		repaint(live, shown, pinned, anyById);
		show(grid, shown.length > 0 || pinned.length > 0);
		const emptyKey =
			active.length === 0
				? 'stickyNotes.empty'
				: shown.length === 0
					? 'stickyNotes.noMatch'
					: null;
		show(emptyLine, emptyKey !== null);
		if (emptyKey !== null) emptyText.setText(t(emptyKey));
		paintArchive(archived, anyById);
	};

	/** The fold's cards: the same cards, set aside, through the archive's own lens. */
	const paintArchive = (
		archived: readonly StickyNoteRecord[],
		anyById: ReadonlyMap<string, StickyNoteRecord>,
	): void => {
		if (archive === null || shelf === null) return;
		archivedNotes = archived;
		show(archive.section, true);
		archive.count.setText(String(archived.length));
		const shown = through(memory.archive, archived);
		show(archive.controls.searchBox, archived.length > 0);
		show(archive.controls.filterButton, archived.length > 0);
		archive.controls.stateText.setText(
			shown.length === archived.length
				? ''
				: t('table.filteredCount', { shown: shown.length, total: archived.length }),
		);
		archive.emptyButton.disabled = readOnly || archived.length === 0;
		repaint(shelf, shown, [], anyById);
		show(archive.grid, shown.length > 0);
		const emptyKey =
			archived.length === 0
				? 'stickyNotes.archiveEmpty'
				: shown.length === 0
					? 'stickyNotes.noMatch'
					: null;
		show(archive.empty, emptyKey !== null);
		if (emptyKey !== null) archive.emptyText.setText(t(emptyKey));
	};

	const loop = refreshLoop<StickyNoteReading | null>({
		read: () => bridge.read(),
		onStart: () => {
			if (reading === null) paint();
		},
		onRead: (next) => {
			reading = next;
			paint();
		},
		onFail: () => {
			reading = null;
			paint();
		},
	});
	const unsubscribe = bridge.hub.subscribe(() => {
		loop.refresh();
	});
	loop.refresh();

	return {
		refresh: () => {
			loop.refresh();
		},
		remeasure: () => {
			for (const from of lanes) {
				for (const card of from.cards.values()) card.remeasure();
			}
		},
		dispose: () => {
			controls.closeFilterPanel();
			archive?.controls.closeFilterPanel();
			loop.dispose();
			unsubscribe();
			for (const from of lanes) {
				from.cancel?.();
				for (const id of [...from.cards.keys()]) takeDown(from, id);
			}
			backend.destroyAll();
			root.remove();
		},
	};
}
