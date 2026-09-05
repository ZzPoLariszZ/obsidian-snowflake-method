/**
 * The Revision face of the Task management pane: every standing revision of
 * the project in one table -- what it would do, what it covers, what it
 * proposes, the note it was written about -- with the Place column jumping to
 * the spot in the stream. Standing is derived here as everywhere: each row is
 * re-anchored against its chapter's body as read this moment, and a revision
 * the body no longer answers for shows as a conflict, whose place opens the
 * card pinned at its chapter's head and whose one action is discard.
 *
 * The frame is the Entity tracking face's: the search at the left of the band
 * under the tab strip, the state and the refresh at its right, and nothing of
 * the panel's own between the strip and the table.
 *
 * Mounted once and patched, the statistics panels' way: the dashboard hands
 * the panel back across frame rebuilds and calls `refresh()`.
 */

import { Notice, SearchComponent, setIcon, setTooltip } from 'obsidian';

import {
	REVISION_KINDS,
	anchorRevision,
	fileStem,
	orderRevisions,
	revealSpan,
	type Revision,
	type RevisionKind,
} from '../domain';
import type { FilterRow, LentFilterPopover } from './filter-rows';
import type { Translate } from './modals';
import { renderEmptyLine } from './pane-parts';
import { refreshLoop } from './refresh-loop';
import { VirtualTable, buildTableFrame } from './virtual-table';

/**
 * One chapter as the table needs it: its title and the body to anchor by. The
 * map that holds these carries the manuscript's own order in its keys, which
 * is where the rows take their order from, so no chapter carries a position
 * that could fall out of step with the order it was put in at.
 */
export interface RevisionNoteReading {
	title: string;
	/** The body as read; null where the note could not be read at all. */
	body: string | null;
}

export interface RevisionRow {
	id: string;
	path: string;
	title: string;
	kind: Revision['kind'];
	original: string;
	proposed: string;
	comment: string;
	status: 'live' | 'conflict';
	/** Where the revision stands now; the stored offsets for a conflict. */
	from: number;
	to: number;
	/**
	 * The stretch the reader can actually be shown, which for an insertion is
	 * the character its bar rides rather than the point itself. Null where the
	 * note could not be read, or holds nothing visible to borrow.
	 */
	reveal: { from: number; to: number } | null;
}

/**
 * Rows shaped from the store and the chapters' readings: manuscript order
 * first, then position in the chapter. Pure, so the shaping is testable
 * without a vault.
 */
export function revisionTableRows(
	revisions: readonly Revision[],
	notes: ReadonlyMap<string, RevisionNoteReading>,
): RevisionRow[] {
	// One order for the table and the cards alike, drawn by the comparator the
	// chevrons walk: the chapters in the order the map holds them, then the
	// strays it does not name at all -- a revision on a note the manuscript
	// never listed is still a row, and the row that discards it. Each row is
	// placed by where its words stand in the body read for it, which is what
	// the cards beside that note are placed by too, so the list reads in the
	// order the margin walks.
	const strays = revisions
		.map((revision) => revision.path)
		.filter((path) => !notes.has(path));
	const ordered = orderRevisions(
		revisions,
		[...notes.keys(), ...new Set(strays)],
		(path) => notes.get(path)?.body ?? null,
	);
	return ordered.map((revision): RevisionRow => {
		const note = notes.get(revision.path);
		const anchor =
			note === undefined || note.body === null
				? ({ state: 'conflict' } as const)
				: anchorRevision(note.body, revision);
		return {
			id: revision.id,
			path: revision.path,
			title: note?.title ?? fileStem(revision.path),
			kind: revision.kind,
			original: revision.originalText,
			proposed: revision.proposed,
			comment: revision.comment,
			status: anchor.state === 'conflict' ? 'conflict' : 'live',
			from: anchor.state === 'conflict' ? revision.from : anchor.from,
			to: anchor.state === 'conflict' ? revision.to : anchor.to,
			reveal:
				note?.body == null || anchor.state === 'conflict'
					? null
					: revealSpan(note.body, anchor.from, anchor.to),
		};
	});
}

/**
 * The search and the funnel over the table. The search is matched the way
 * the tracking pane's is: every word a row shows is searched, the kind it
 * wears included, so what is typed finds what is read. `kindOf` names a
 * row's kind in the reader's own language, which is the only part of a row
 * the table draws rather than holds. The funnel asks two things: the kind
 * to keep, and whether to keep only the rows the chapter no longer answers
 * for.
 */
export interface RevisionFilters {
	/** '' means the question is not being asked. */
	kind: RevisionKind | '';
	standing: 'conflict' | '';
}

const NO_REVISION_FILTERS: RevisionFilters = { kind: '', standing: '' };

export function filterRevisionRows(
	rows: readonly RevisionRow[],
	query: string,
	kindOf: (kind: Revision['kind']) => string,
	filters: RevisionFilters = NO_REVISION_FILTERS,
): RevisionRow[] {
	const held = rows.filter(
		(row) =>
			(filters.kind === '' || row.kind === filters.kind) &&
			(filters.standing === '' || row.status === 'conflict'),
	);
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return [...held];
	return held.filter((row) =>
		[row.original, row.proposed, row.comment, row.title, kindOf(row.kind)].some(
			(text) => text.toLowerCase().includes(needle),
		),
	);
}

export interface RevisionPanelBridge {
	t: Translate;
	/** Every row, freshly anchored; null while no project stands. */
	rows(): Promise<RevisionRow[] | null>;
	/** Opens the stream at one revision's spot and flashes it. */
	open(occurrence: { path: string; from: number; to: number }): Promise<void>;
	/**
	 * Opens the chapter a conflict was lost in and lights its card, pinned
	 * at the head of the chapter's rail, as the foreshadowing table does.
	 */
	openUnresolved(path: string, revisionId: string): Promise<void>;
	/**
	 * Takes one revision out, which is the conflict row's only action. False
	 * where the write never happened.
	 */
	discard(id: string): Promise<boolean>;
}

/** The filters, owned by the dashboard so they outlive the panel. */
export interface RevisionFilterMemory {
	/** One kind to keep alone; '' asks nothing. */
	kind: string;
	/** 'conflict' narrows to the rows the chapter no longer answers for; '' asks nothing. */
	standing: string;
}

/** What the dashboard lends the panel: its funnel popover and its memory. */
export interface RevisionPanelControls extends LentFilterPopover {
	filters: RevisionFilterMemory;
}

export interface RevisionPanelHandle {
	refresh(): void;
	dispose(): void;
}

const REVISION_COLUMNS = [
	'type',
	'original',
	'proposed',
	'comment',
	'place',
] as const;

export function renderRevisionPanel(
	container: HTMLElement,
	bridge: RevisionPanelBridge,
	controls: RevisionPanelControls,
): RevisionPanelHandle {
	const t = bridge.t;
	const filters = controls.filters;
	// The tracking panel's own root: the same relative box whose controls band
	// rides the gap under the tab strip, so this face is inset exactly as that
	// one is and the table starts where its folds do.
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-revision-panel',
	});
	const band = root.createDiv({ cls: 'snowflake-method-prose-controls' });
	let query = '';
	const search = new SearchComponent(band);
	search.setPlaceholder(t('revisionTable.searchPlaceholder'));
	search.onChange((next) => {
		query = next;
		paint();
	});
	// The box the component built inside the band, held so it can be taken
	// away: a project with no revisions has nothing to search, and a field
	// that can only ever come back empty is one more thing in the way of the
	// sentence saying so.
	const searchBox = band.querySelector('.search-input-container');
	const filterButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-filter-button',
		attr: {
			type: 'button',
			'aria-haspopup': 'dialog',
			'aria-label': t('table.filter'),
		},
	});
	setIcon(filterButton, 'funnel');
	setTooltip(filterButton, t('table.filter'));
	const stateText = band.createSpan({
		cls: 'snowflake-method-prose-state',
	});
	const refreshButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-prose-refresh',
		attr: { type: 'button', 'aria-label': t('revisionTable.refresh') },
	});
	setIcon(refreshButton, 'refresh-cw');
	setTooltip(refreshButton, t('revisionTable.refresh'));

	// The two questions the funnel asks, in the dashboard's own popover:
	// the kind, and the standing.
	const kindOf = (kind: Revision['kind']): string =>
		t(`manuscript.revision.kind.${kind}`);
	const asked = (): RevisionFilters => ({
		kind: REVISION_KINDS.find((kind) => kind === filters.kind) ?? '',
		standing: filters.standing === 'conflict' ? 'conflict' : '',
	});
	const filterRows = (): FilterRow[] => [
		{
			label: t('revisionTable.type'),
			placeholder: t('revisionTable.filterAllTypes'),
			empty: '',
			options: () =>
				REVISION_KINDS.map((kind) => ({ value: kind, label: kindOf(kind) })),
			value: filters.kind,
			apply: (value) => {
				filters.kind = value;
			},
		},
		{
			label: t('revisionTable.standing'),
			placeholder: t('revisionTable.filterAllStandings'),
			empty: '',
			options: () => [
				{ value: 'conflict', label: t('revisionTable.conflictOnly') },
			],
			value: filters.standing,
			apply: (value) => {
				filters.standing = value;
			},
		},
	];
	const markFilterButton = (): void => {
		const { kind, standing } = asked();
		filterButton.toggleClass('is-active', kind !== '' || standing !== '');
	};
	filterButton.addEventListener('click', () => {
		if (controls.filterOpen()) {
			controls.closeFilter();
			return;
		}
		controls.openFilter(filterButton, filterRows(), () => {
			markFilterButton();
			paint();
		});
	});
	markFilterButton();

	const {
		wrap: tableWrap,
		bodyWrap,
		body: tableBody,
	} = buildTableFrame(root, {
		wrapCls: 'snowflake-method-revision-table-wrap',
		tableCls: 'snowflake-method-revision-table',
		columns: REVISION_COLUMNS.map(
			(column) => `snowflake-method-revision-column-${column}`,
		),
		headers: REVISION_COLUMNS.map((column) => ({
			cls: `snowflake-method-revision-column-${column}`,
			text: t(`revisionTable.${column}`),
		})),
	});

	// The tracking sections' own empty sentence, shown in the table's place: a
	// grid with a header and no rows says less than one line saying so.
	const { line: emptyLine } = renderEmptyLine(root, t('revisionTable.empty'));

	const heights = new Map<string, number>();
	/** Everything read, and the part of it the search leaves standing. */
	let reading: RevisionRow[] | null = null;
	let shown: RevisionRow[] = [];
	const virtual = new VirtualTable({
		scroller: bodyWrap,
		body: tableBody,
		columns: REVISION_COLUMNS.length,
		estimatedRowHeight: 40,
		overscan: 8,
		rowKey: (index) => shown[index]?.id ?? `?${String(index)}`,
		heights,
		renderRow: (body, index) => {
			const row = shown[index];
			if (row === undefined) return;
			const tr = body.createEl('tr', { cls: 'snowflake-method-revision-row' });
			const cell = (
				column: (typeof REVISION_COLUMNS)[number],
				text = '',
			): HTMLElement =>
				tr.createEl('td', {
					cls: `snowflake-method-revision-column-${column}`,
					text,
					attr: { 'data-label': t(`revisionTable.${column}`) },
				});
			// What the revision would do, in the ink its card wears: a table
			// read down its first column says that much before a word of the
			// proposals is read.
			cell('type').createSpan({
				cls: 'snowflake-method-revision-type',
				text: kindOf(row.kind),
				attr: { 'data-kind': row.kind },
			});
			// Whole, all three of them, and empty where the kind leaves them
			// empty: a table that cut its texts would send the reader to the
			// card for what the row already held.
			cell('original', row.original);
			cell('proposed', row.proposed);
			cell('comment', row.comment);
			const line = cell('place').createDiv({
				cls: 'snowflake-method-tracking-scope-row',
			});
			if (row.status === 'conflict') {
				// A revision its chapter no longer answers for: the tracking
				// tables' warning ink, alert and all, and the one action left.
				// The warning is the link, as the foreshadowing table's is:
				// there is no passage left to flash, so it opens the chapter
				// the words were lost in and lights the card pinned at the
				// head of its rail.
				const warned = line.createSpan({
					cls: 'snowflake-method-revision-conflict is-link',
				});
				const icon = warned.createSpan({
					cls: 'snowflake-method-character-empty-icon',
					attr: { 'aria-hidden': 'true' },
				});
				setIcon(icon, 'triangle-alert');
				warned.createSpan({ text: row.title });
				setTooltip(warned, t('manuscript.revision.conflict'));
				warned.addEventListener('click', () => {
					void bridge.openUnresolved(row.path, row.id).catch(() => undefined);
				});
				const discard = line.createEl('button', {
					cls: 'clickable-icon snowflake-method-tracking-remove',
					attr: {
						type: 'button',
						'aria-label': t('manuscript.revision.discard'),
					},
				});
				setIcon(discard, 'trash-2');
				setTooltip(discard, t('manuscript.revision.discard'));
				discard.addEventListener('click', () => {
					void bridge
						.discard(row.id)
						.then((gone) => {
							// A refusal is said, as the card in the margin says
							// it: the row would otherwise come straight back
							// with nothing to explain why the click did nothing.
							// A discard that landed has already refreshed this
							// panel through the host, so nothing is read twice.
							if (!gone) new Notice(t('manuscript.revision.refused'));
						})
						.catch(() => undefined);
				});
				return;
			}
			// The chapter's name, in the ink everything clickable wears here.
			const jump = line.createSpan({
				cls: 'snowflake-method-tracking-link',
				text: row.title,
			});
			jump.addEventListener('click', () => {
				// An insertion is a point, and a point flashes nothing. The
				// character it borrows is chosen where the bar is drawn, so
				// the reader lands on the mark rather than beside it.
				const spot = row.reveal ?? { from: row.from, to: row.to };
				void bridge
					.open({ path: row.path, from: spot.from, to: spot.to })
					.catch(() => undefined);
			});
		},
		renderTail: () => undefined,
		onScroll: () => undefined,
		onMeasure: () => undefined,
	});


	/**
	 * What the frame shows: the table, the empty line, or neither. The window
	 * is sized last, because a hidden scroller has no height to measure and
	 * would draw no rows at all.
	 */
	const paint = (): void => {
		// The search stands only while there is something to search: what a
		// filter left empty keeps its field, so it can be cleared, but a
		// project holding no revisions at all shows the refresh alone.
		searchBox?.toggleClass('is-hidden', (reading?.length ?? 0) === 0);
		filterButton.toggleClass('is-hidden', (reading?.length ?? 0) === 0);
		if (reading === null) {
			// Null has three faces: still reading, a read that failed, and a
			// vault with no project. Only the last may claim so.
			shown = [];
			tableWrap.addClass('is-hidden');
			emptyLine.addClass('is-hidden');
			virtual.setTotal(0);
			stateText.setText(
				loop.loading
					? t('revisionTable.loading')
					: loop.failed
						? t('revisionTable.loadFailed')
						: t('revisionTable.noProject'),
			);
			return;
		}
		shown = filterRevisionRows(reading, query, kindOf, asked());
		stateText.setText(
			shown.length === reading.length
				? ''
				: t('table.filteredCount', { shown: shown.length, total: reading.length }),
		);
		tableWrap.toggleClass('is-hidden', shown.length === 0);
		emptyLine.toggleClass('is-hidden', shown.length > 0);
		virtual.setTotal(shown.length);
	};

	const loop = refreshLoop<RevisionRow[] | null>({
		read: () => bridge.rows(),
		onStart: () => {
			if (reading === null) paint();
		},
		onRead: (next) => {
			reading = next;
			// The rows are new text at new widths, so nothing measured of
			// the old ones is worth carrying.
			heights.clear();
			paint();
		},
		onFail: () => {
			if (reading === null) paint();
			else stateText.setText(t('revisionTable.loadFailed'));
		},
	});
	const refresh = (): void => {
		loop.refresh();
	};

	refreshButton.addEventListener('click', () => {
		refresh();
	});
	refresh();

	return {
		refresh,
		dispose: (): void => {
			loop.dispose();
			virtual.destroy();
			controls.closeFilter();
			root.remove();
		},
	};
}
