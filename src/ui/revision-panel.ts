/**
 * The Revision face of the Task management pane: every standing revision of
 * the project in one table -- what it would do, what it covers, what it
 * proposes, the note it was written about -- with the Place column jumping to
 * the spot in the stream. Standing is derived here as everywhere: each row is
 * re-anchored against its chapter's body as read this moment, and a revision
 * the body no longer answers for shows as a conflict whose one action is
 * discard.
 *
 * The frame is the Entity tracking face's: the search at the left of the band
 * under the tab strip, the state and the refresh at its right, and nothing of
 * the panel's own between the strip and the table.
 *
 * Mounted once and patched, the statistics panels' way: the dashboard hands
 * the panel back across frame rebuilds and calls `refresh()`.
 */

import { SearchComponent, setIcon, setTooltip } from 'obsidian';

import { anchorRevision, orderRevisions, type Revision } from '../domain';
import type { Translate } from './modals';
import { VirtualTable } from './virtual-table';

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
	// never listed is still a row, and the row that discards it. Stored
	// offsets order it, which is `orderRevisions`'s own rule: a table sorted by
	// where a revision stands now and cards stepped through by where it was
	// filed would send the reader two ways through the same list.
	const strays = revisions
		.map((revision) => revision.path)
		.filter((path) => !notes.has(path));
	const ordered = orderRevisions(revisions, [
		...notes.keys(),
		...new Set(strays),
	]);
	return ordered.map((revision): RevisionRow => {
		const note = notes.get(revision.path);
		const anchor =
			note === undefined || note.body === null
				? ({ state: 'conflict' } as const)
				: anchorRevision(note.body, revision);
		return {
			id: revision.id,
			path: revision.path,
			title: note?.title ?? revision.path.split('/').pop() ?? revision.path,
			kind: revision.kind,
			original: revision.originalText,
			proposed: revision.proposed,
			comment: revision.comment,
			status: anchor.state === 'conflict' ? 'conflict' : 'live',
			from: anchor.state === 'conflict' ? revision.from : anchor.from,
			to: anchor.state === 'conflict' ? revision.to : anchor.to,
		};
	});
}

/**
 * The one filter over the table, matched the way the tracking pane's is:
 * every word a row shows is searched, the kind it wears included, so what is
 * typed finds what is read. `kindOf` names a row's kind in the reader's own
 * language, which is the only part of a row the table draws rather than holds.
 */
export function filterRevisionRows(
	rows: readonly RevisionRow[],
	query: string,
	kindOf: (kind: Revision['kind']) => string,
): RevisionRow[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return [...rows];
	return rows.filter((row) =>
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
	 * Takes one revision out, which is the conflict row's only action. False
	 * where the write never happened.
	 */
	discard(id: string): Promise<boolean>;
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
): RevisionPanelHandle {
	const t = bridge.t;
	// The tracking panel's own root: the same relative box whose controls band
	// rides the gap under the tab strip, so this face is inset exactly as that
	// one is and the table starts where its folds do.
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-revision-panel',
	});
	const controls = root.createDiv({ cls: 'snowflake-method-prose-controls' });
	let query = '';
	const search = new SearchComponent(controls);
	search.setPlaceholder(t('revisionTable.searchPlaceholder'));
	search.onChange((next) => {
		query = next;
		paint();
	});
	// The box the component built inside the band, held so it can be taken
	// away: a project with no revisions has nothing to search, and a field
	// that can only ever come back empty is one more thing in the way of the
	// sentence saying so.
	const searchBox = controls.querySelector('.search-input-container');
	const stateText = controls.createSpan({
		cls: 'snowflake-method-prose-state',
	});
	const refreshButton = controls.createEl('button', {
		cls: 'clickable-icon snowflake-method-prose-refresh',
		attr: { type: 'button', 'aria-label': t('revisionTable.refresh') },
	});
	setIcon(refreshButton, 'refresh-cw');
	setTooltip(refreshButton, t('revisionTable.refresh'));

	const tableWrap = root.createDiv({
		cls: 'snowflake-method-table-wrap snowflake-method-revision-table-wrap',
	});
	const headWrap = tableWrap.createDiv({ cls: 'snowflake-method-table-head' });
	const bodyWrap = tableWrap.createDiv({ cls: 'snowflake-method-table-body' });
	const tableClasses = 'snowflake-method-table snowflake-method-revision-table';
	const headTable = headWrap.createEl('table', { cls: tableClasses });
	const bodyTable = bodyWrap.createEl('table', { cls: tableClasses });
	for (const table of [headTable, bodyTable]) {
		const columns = table.createEl('colgroup');
		for (const column of REVISION_COLUMNS) {
			columns.createEl('col', {
				cls: `snowflake-method-revision-column-${column}`,
			});
		}
	}
	const headRow = headTable.createEl('thead').createEl('tr');
	for (const column of REVISION_COLUMNS) {
		headRow.createEl('th', {
			cls: `snowflake-method-revision-column-${column}`,
			text: t(`revisionTable.${column}`),
		});
	}
	const tableBody = bodyTable.createEl('tbody');

	// The tracking sections' own empty sentence, shown in the table's place: a
	// grid with a header and no rows says less than one line saying so.
	const emptyLine = root.createEl('p', {
		cls: 'snowflake-method-character-empty',
	});
	const emptyIcon = emptyLine.createSpan({
		cls: 'snowflake-method-character-empty-icon',
		attr: { 'aria-hidden': 'true' },
	});
	setIcon(emptyIcon, 'triangle-alert');
	emptyLine.createSpan({ text: t('revisionTable.empty') });

	const heights = new Map<string, number>();
	/** Everything read, and the part of it the search leaves standing. */
	let reading: RevisionRow[] | null = null;
	let shown: RevisionRow[] = [];
	let headCarried = '';
	const kindOf = (kind: Revision['kind']): string =>
		t(`manuscript.revision.kind.${kind}`);
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
				const warned = line.createSpan({
					cls: 'snowflake-method-revision-conflict',
				});
				const icon = warned.createSpan({
					cls: 'snowflake-method-character-empty-icon',
					attr: { 'aria-hidden': 'true' },
				});
				setIcon(icon, 'triangle-alert');
				warned.createSpan({ text: row.title });
				setTooltip(warned, t('manuscript.revision.conflict'));
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
						.then(() => {
							refresh();
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
				// An insertion is a point, and a point flashes nothing: the
				// jump borrows the character after it, the way its mark does.
				const to = row.from === row.to ? row.to + 1 : row.to;
				void bridge
					.open({ path: row.path, from: row.from, to })
					.catch(() => undefined);
			});
		},
		renderTail: () => undefined,
		onScroll: () => {
			const carried = `translateX(${String(-bodyWrap.scrollLeft)}px)`;
			if (carried !== headCarried) {
				headCarried = carried;
				headTable.style.transform = carried;
			}
		},
		onMeasure: () => undefined,
	});

	let disposed = false;
	let loading = false;
	let failed = false;
	let refreshAgain = false;

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
		if (reading === null) {
			// Null has three faces: still reading, a read that failed, and a
			// vault with no project. Only the last may claim so.
			shown = [];
			tableWrap.addClass('is-hidden');
			emptyLine.addClass('is-hidden');
			virtual.setTotal(0);
			stateText.setText(
				loading
					? t('revisionTable.loading')
					: failed
						? t('revisionTable.loadFailed')
						: t('revisionTable.noProject'),
			);
			return;
		}
		stateText.setText('');
		shown = filterRevisionRows(reading, query, kindOf);
		tableWrap.toggleClass('is-hidden', shown.length === 0);
		emptyLine.toggleClass('is-hidden', shown.length > 0);
		virtual.setTotal(shown.length);
	};

	const refresh = (): void => {
		if (disposed) return;
		if (loading) {
			refreshAgain = true;
			return;
		}
		loading = true;
		if (reading === null) paint();
		void bridge
			.rows()
			.then((next) => {
				loading = false;
				failed = false;
				if (disposed) return;
				reading = next;
				// The rows are new text at new widths, so nothing measured of
				// the old ones is worth carrying.
				heights.clear();
				paint();
				if (refreshAgain) {
					refreshAgain = false;
					refresh();
				}
			})
			.catch(() => {
				// A failed read may not wear the reading label forever, and a
				// refresh queued behind it still deserves its turn.
				loading = false;
				failed = true;
				if (disposed) return;
				if (refreshAgain) {
					refreshAgain = false;
					refresh();
					return;
				}
				if (reading === null) paint();
				else stateText.setText(t('revisionTable.loadFailed'));
			});
	};

	refreshButton.addEventListener('click', () => {
		refresh();
	});
	refresh();

	return {
		refresh,
		dispose: (): void => {
			disposed = true;
			virtual.destroy();
			root.remove();
		},
	};
}
