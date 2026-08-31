/**
 * The Revision face of the Task management pane: every standing revision of
 * the project in one table -- what it covers, what it proposes, the note it
 * was written about -- with the Place column jumping to the spot in the
 * stream. Standing is derived here as everywhere: each row is re-anchored
 * against its chapter's body as read this moment, and a revision the body no
 * longer answers for shows as a conflict whose one action is discard.
 *
 * Mounted once and patched, the statistics panels' way: the dashboard hands
 * the panel back across frame rebuilds and calls `refresh()`.
 */

import { setIcon, setTooltip } from 'obsidian';

import { anchorRevision, type Revision } from '../domain';
import { truncateEnd } from './mention-rows';
import type { Translate } from './modals';
import { VirtualTable } from './virtual-table';

/** One chapter as the table needs it: its title, order, and body to anchor by. */
export interface RevisionNoteReading {
	title: string;
	/** Manuscript position, for sorting rows the way the book reads. */
	ordinal: number;
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
	const rows = revisions.map((revision): RevisionRow => {
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
	rows.sort((left, right) => {
		const leftNote = notes.get(left.path)?.ordinal ?? Number.MAX_SAFE_INTEGER;
		const rightNote = notes.get(right.path)?.ordinal ?? Number.MAX_SAFE_INTEGER;
		return leftNote - rightNote || left.from - right.from;
	});
	return rows;
}

export interface RevisionPanelBridge {
	t: Translate;
	/** Every row, freshly anchored; null while no project stands. */
	rows(): Promise<RevisionRow[] | null>;
	/** Opens the stream at one revision's spot and flashes it. */
	open(occurrence: { path: string; from: number; to: number }): Promise<void>;
	/** Discards one revision: the conflict row's only action. */
	discard(id: string): Promise<void>;
}

export interface RevisionPanelHandle {
	refresh(): void;
	dispose(): void;
}

const REVISION_COLUMNS = ['original', 'proposed', 'comment', 'place'] as const;

export function renderRevisionPanel(
	container: HTMLElement,
	bridge: RevisionPanelBridge,
): RevisionPanelHandle {
	const t = bridge.t;
	const root = container.createDiv({ cls: 'snowflake-method-revision-panel' });
	const toolbar = root.createDiv({
		cls: 'snowflake-method-revision-panel-toolbar',
	});
	const stateText = toolbar.createSpan({
		cls: 'snowflake-method-revision-panel-state',
	});
	const refreshButton = toolbar.createEl('button', {
		cls: 'clickable-icon',
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
	const heights = new Map<string, number>();
	let rows: RevisionRow[] = [];
	let headCarried = '';
	const virtual = new VirtualTable({
		scroller: bodyWrap,
		body: tableBody,
		columns: REVISION_COLUMNS.length,
		estimatedRowHeight: 32,
		overscan: 8,
		rowKey: (index) => rows[index]?.id ?? `?${String(index)}`,
		heights,
		renderRow: (body, index) => {
			const row = rows[index];
			if (row === undefined) return;
			const tr = body.createEl('tr', { cls: 'snowflake-method-revision-row' });
			const cell = (
				column: (typeof REVISION_COLUMNS)[number],
				text: string,
			): HTMLElement =>
				tr.createEl('td', {
					cls: `snowflake-method-revision-column-${column}`,
					text,
					attr: { 'data-label': t(`revisionTable.${column}`) },
				});
			const original = cell(
				'original',
				row.kind === 'insert'
					? t('manuscript.revision.kind.insert')
					: truncateEnd(row.original, 60),
			);
			if (row.kind !== 'insert') {
				original.addClass('snowflake-method-revision-cell-original');
			}
			cell(
				'proposed',
				row.kind === 'delete'
					? t('manuscript.revision.kind.delete')
					: truncateEnd(row.proposed, 60),
			);
			cell('comment', truncateEnd(row.comment, 60));
			const place = cell('place', '');
			if (row.status === 'conflict') {
				place.createSpan({
					cls: 'snowflake-method-revision-badge',
					text: t('manuscript.revision.conflict'),
				});
				place.createSpan({
					cls: 'snowflake-method-revision-place-title',
					text: row.title,
				});
				const discard = place.createEl('button', {
					cls: 'snowflake-method-revision-action',
					attr: { type: 'button' },
					text: t('manuscript.revision.discard'),
				});
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
			const jump = place.createEl('button', {
				cls: 'snowflake-method-revision-place snowflake-method-table-primary',
				attr: { type: 'button' },
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
	let refreshAgain = false;
	let everLoaded = false;

	const paint = (next: RevisionRow[] | null): void => {
		if (next === null) {
			rows = [];
			virtual.setTotal(0);
			stateText.setText(t('revisionTable.noProject'));
			return;
		}
		rows = next;
		heights.clear();
		virtual.setTotal(rows.length);
		stateText.setText(rows.length === 0 ? t('revisionTable.empty') : '');
	};

	const refresh = (): void => {
		if (disposed) return;
		if (loading) {
			refreshAgain = true;
			return;
		}
		loading = true;
		if (!everLoaded) stateText.setText(t('revisionTable.loading'));
		void bridge
			.rows()
			.then((next) => {
				loading = false;
				if (disposed) return;
				everLoaded = true;
				paint(next);
				if (refreshAgain) {
					refreshAgain = false;
					refresh();
				}
			})
			.catch(() => {
				loading = false;
				if (disposed) return;
				stateText.setText(t('revisionTable.loadFailed'));
				if (refreshAgain) {
					refreshAgain = false;
					refresh();
				}
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
