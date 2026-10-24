import { describe, expect, it, vi } from 'vitest';

import {
	addDays,
	monthTitle,
	type HistoryDay,
	type HistoryEntry,
	type HistoryNoteEntry,
	type HistoryNoteIdentity,
	type HistoryNoteKind,
	type HistoryReading,
	type HistoryTotals,
} from '../../src/domain';
import { t as translate } from '../../src/i18n';
import type { HistoryAvailability, HistoryChange, HistoryPanelBridge } from '../../src/ui/history-bridge';
import { renderHistoryPanel, type HistoryFilterMemory } from '../../src/ui/history-panel';
import { historyKindLabel } from '../../src/ui/kind-word';
import type { Translate } from '../../src/ui/modals';
import type { FilterRow } from '../../src/ui/filter-rows';
import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

interface ShownItem {
	title: string;
	disabled: boolean;
	click: (() => void) | null;
}

const notices = vi.hoisted(() => [] as string[]);
const shownMenus = vi.hoisted(() => [] as { title: string; disabled: boolean; click: (() => void) | null }[][]);

// The notices the panel shows and the menus it opens, kept where a test can
// read them back.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class RecordingMenu {
		private readonly items: ShownItem[] = [];
		addItem(build: (item: unknown) => void): this {
			const entry: ShownItem = { title: '', disabled: false, click: null };
			const handle = {
				setTitle: (title: string) => ((entry.title = title), handle),
				setIcon: () => handle,
				setSection: () => handle,
				setWarning: () => handle,
				setChecked: () => handle,
				setIsLabel: () => handle,
				setDisabled: (disabled: boolean) => ((entry.disabled = disabled), handle),
				onClick: (click: () => void) => ((entry.click = click), handle),
			};
			build(handle);
			this.items.push(entry);
			return this;
		}
		addSeparator(): this {
			return this;
		}
		setParentElement(): this {
			return this;
		}
		showAtMouseEvent(): this {
			shownMenus.push(this.items);
			return this;
		}
	}
	class RecordingNotice {
		constructor(message: string) {
			notices.push(message);
		}
	}
	return { ...runtime, Menu: RecordingMenu, Notice: RecordingNotice };
});

/**
 * The Modification history panel over the plain-element fake: the range it
 * reads, the rows it draws, the word about File recovery, the ways out of a
 * row, and how it keeps itself current.
 */

const en: Translate = (key, vars) => translate('en', key, vars);
const TODAY = '2026-10-21';
const ADA = '20_Character/Ada.md';
const CHAPTER = '50_Manuscript/Chapter 3.md';
const OLD = '40_Scene/Old.md';

const at = (day: string, clock: string): number => Date.parse(`${day}T${clock}:00Z`);

const note = (
	path: string,
	kind: HistoryNoteKind,
	over: Partial<HistoryNoteIdentity> = {},
): HistoryNoteIdentity => ({ path, kind, exists: true, ...over });

const totals = (over: Partial<HistoryTotals> = {}): HistoryTotals => ({
	words: { added: 0, deleted: 0, net: 0 },
	versions: 0,
	notes: 0,
	sessions: 0,
	events: 0,
	sources: [],
	...over,
});

const noteEntry = (
	id: string,
	day: string,
	clock: string,
	subject: HistoryNoteIdentity,
	over: Partial<HistoryNoteEntry> = {},
): HistoryNoteEntry => ({
	id,
	kind: 'note',
	action: 'edited',
	day,
	at: at(day, clock),
	until: at(day, clock),
	note: subject,
	versions: 0,
	words: { added: 0, deleted: 0, net: 0 },
	source: 'ledger',
	sessions: 0,
	...over,
});

const TASK: HistoryEntry = {
	id: 'task-created',
	kind: 'task',
	event: 'task-created',
	day: TODAY,
	at: at(TODAY, '10:00'),
	until: at(TODAY, '10:00'),
	task: { id: 'task-1', title: 'Fix the ending' },
};

/** Every day of a span, the two with something to tell filled in. */
const reading = (from: string, through: string): HistoryReading => {
	const days: HistoryDay[] = [];
	for (let day = from; day <= through; day = addDays(day, 1)) {
		if (day === TODAY) {
			days.push({
				...totals({ notes: 1, versions: 1, words: { added: 120, deleted: 0, net: 120 } }),
				day,
				entries: [
					noteEntry('created', day, '09:10', note(ADA, 'character'), {
						action: 'created',
						versions: 1,
						words: { added: 120, deleted: 0, net: 120 },
						source: 'snapshots',
					}),
					TASK,
				],
			});
		} else if (day === '2026-10-20') {
			days.push({
				...totals({ notes: 2, versions: 3, words: { added: 150, deleted: 230, net: -80 } }),
				day,
				entries: [
					noteEntry('edited', day, '09:00', note(CHAPTER, 'manuscript'), {
						until: at(day, '10:30'),
						versions: 3,
						words: { added: 150, deleted: 30, net: 120 },
						source: 'snapshots',
					}),
					noteEntry('deleted', day, '11:00', note(OLD, 'scene', { exists: false }), {
						action: 'deleted',
						words: { added: 0, deleted: 200, net: -200 },
					}),
				],
			});
		} else {
			days.push({ ...totals(), day, entries: [] });
		}
	}
	return {
		days,
		summary: {
			...totals({
				words: { added: 270, deleted: 230, net: 40 },
				versions: 4,
				notes: 3,
				sessions: 1,
			}),
		},
	};
};

/** The text an element shows, its own and its children's, in order. */
const textOf = (element: CorkboardElement | null): string =>
	element === null
		? ''
		: `${element.textContent}${element.children.map((child) => textOf(child)).join('')}`;

const flush = async (): Promise<void> => {
	await new Promise((resolve) => setTimeout(resolve, 0));
};

function setup(options: { withActions?: boolean; deferred?: boolean } = {}) {
	notices.length = 0;
	shownMenus.length = 0;
	const dom = new CorkboardDom();
	dom.resize(1000, 800);
	let today = TODAY;
	const avail: HistoryAvailability = {
		snapshots: 'reading',
		intervalMinutes: 5,
		keepDays: 7,
		harvesting: false,
		readThrough: null,
	};
	const listeners = new Set<(change: HistoryChange) => void>();
	const reads: [string, string][] = [];
	const pending: ((value: HistoryReading | null) => void)[] = [];
	let recovery: ReturnType<HistoryPanelBridge['openFileRecovery']> = 'opened';
	const bridge = {
		t: en,
		locale: () => 'en',
		weekStart: () => 'monday' as const,
		dateFormat: () => 'YYYY-MM-DD' as const,
		today: () => today,
		timeZone: () => 'UTC',
		availability: () => ({ ...avail }),
		read: vi.fn((from: string, through: string): Promise<HistoryReading | null> => {
			reads.push([from, through]);
			if (options.deferred === true) {
				return new Promise((resolve) => {
					pending.push(resolve);
				});
			}
			return Promise.resolve(reading(from, through));
		}),
		refresh: vi.fn(() => Promise.resolve()),
		openNote: vi.fn(() => Promise.resolve()),
		openFileRecovery: vi.fn(() => recovery),
		openCorePluginSettings: vi.fn(() => true),
		openFileRecoverySettings: vi.fn(() => true),
		subscribe: (listener: (change: HistoryChange) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		kindLabel: (ref: HistoryNoteIdentity) => historyKindLabel(en, ref),
		kindIcon: () => 'file-text',
		showsActionsColumn: () => options.withActions !== false,
	};
	const filters: HistoryFilterMemory = { kind: '', unit: 'week', anchor: null };
	let filterOpen = false;
	let lastRows: readonly FilterRow[] = [];
	let lastChanged: (() => void) | null = null;
	const controls = {
		filters,
		filterOpen: () => filterOpen,
		openFilter: vi.fn((_anchor: HTMLElement, rows: readonly FilterRow[], changed: () => void) => {
			filterOpen = true;
			lastRows = rows;
			lastChanged = changed;
		}),
		closeFilter: vi.fn(() => {
			filterOpen = false;
		}),
		openTasksTab: vi.fn(),
	};
	const handle = renderHistoryPanel(
		dom.container as unknown as HTMLElement,
		bridge,
		controls,
	);
	const root = dom.container;
	const rows = (): CorkboardElement[] =>
		root.querySelectorAll('.snowflake-method-history-day, .snowflake-method-history-row');
	const entryRows = (): CorkboardElement[] => root.querySelectorAll('.snowflake-method-history-row');
	const rowOf = (id: string): CorkboardElement => {
		const row = entryRows().find((tr) =>
			textOf(tr.querySelector('.snowflake-method-history-sentence')).includes(id),
		);
		if (row === undefined) throw new Error(`No row saying ${id}`);
		return row;
	};
	const emit = (change: HistoryChange): void => {
		for (const listener of listeners) listener(change);
	};
	return {
		dom,
		root,
		bridge,
		controls,
		filters,
		handle,
		avail,
		reads,
		pending,
		listeners,
		rows,
		entryRows,
		rowOf,
		emit,
		setToday: (day: string) => {
			today = day;
		},
		setRecovery: (result: typeof recovery) => {
			recovery = result;
		},
		filterRows: () => lastRows,
		filterChanged: () => lastChanged,
		state: () => root.querySelector('.snowflake-method-prose-state')?.textContent ?? '',
		title: () => textOf(root.querySelector('.snowflake-method-history-range-title')),
		notice: () => {
			const box = root.querySelector('.snowflake-method-history-notice');
			if (box === null) throw new Error('No notice');
			return box;
		},
		button: (cls: string, index = 0): CorkboardElement => {
			const found = root.querySelectorAll(cls)[index];
			if (found === undefined) throw new Error(`No ${cls}`);
			return found;
		},
	};
}

describe('the modification history panel', () => {
	it('reads the week around today and heads each day over its entries, newest first', async () => {
		const panel = setup();
		expect(panel.state()).toBe('Reading the history…');
		await flush();
		expect(panel.reads).toEqual([['2026-10-19', '2026-10-25']]);
		expect(panel.title()).toBe('2026-10-19 – 2026-10-25');
		expect(panel.state()).toBe('');
		const kinds = panel.rows().map((tr) =>
			tr.classList.contains('snowflake-method-history-day')
				? `day:${textOf(tr.querySelector('.snowflake-method-history-day-title'))}`
				: textOf(tr.querySelector('.snowflake-method-history-sentence')),
		);
		expect(kinds).toEqual([
			'day:Today',
			'Created the character “Ada”',
			'Added the task “Fix the ending”',
			'day:Yesterday',
			'Edited the manuscript note “Chapter 3”',
			'Deleted the scene “Old”',
		]);
		const edited = panel.rowOf('Chapter 3');
		expect(edited.querySelector('.snowflake-method-history-column-time')?.textContent).toBe(
			'09:00–10:30',
		);
		// The activity line is the kind's icon and the sentence, no figure after it.
		const activity = edited.querySelector('.snowflake-method-history-activity');
		expect(activity?.children.map((child) => child.className)).toEqual([
			'snowflake-method-history-icon',
			'snowflake-method-history-sentence',
		]);
		expect(textOf(edited.querySelector('.snowflake-method-history-sentence'))).toBe(
			'Edited the manuscript note “Chapter 3”',
		);
		expect(panel.root.querySelector('.snowflake-method-history-versions')).toBeNull();
		// The range title's two days in the same face, the dash between them in the interface's own.
		expect(
			panel.root
				.querySelector('.snowflake-method-history-range-title')
				?.querySelectorAll('.snowflake-method-history-numeral')
				.map((numeral) => numeral.textContent),
		).toEqual(['2026-10-19', '2026-10-25']);
		// Every cell of an entry wears its label for the card layout; a
		// day's one cell spans the row and wears none.
		for (const tr of panel.entryRows()) {
			const cells = tr.querySelectorAll('td');
			expect(cells.length).toBe(3);
			expect(cells.every((td) => (td.getAttribute('data-label') ?? '') !== '')).toBe(true);
		}
		const dayCells = panel.rows()[0]?.querySelectorAll('td') ?? [];
		expect(dayCells.length).toBe(1);
		expect(dayCells[0]?.getAttribute('colspan')).toBe('3');
		expect(dayCells[0]?.getAttribute('data-label')).toBeNull();
		// The day's one cell holds its name and no figure, and the range title
		// stands alone: nothing on the tab counts.
		expect((dayCells[0]?.children ?? []).map((child) => child.className)).toEqual([
			'snowflake-method-history-day-title',
		]);
		expect(panel.root.querySelector('.snowflake-method-history-day-figures')).toBeNull();
		expect(panel.root.querySelector('.snowflake-method-history-range-figures')).toBeNull();
	});

	it('says why the copies are not being counted, and only then', async () => {
		const panel = setup();
		await flush();
		expect(panel.notice().classList.contains('is-hidden')).toBe(true);
		panel.avail.snapshots = 'plugin-off';
		panel.emit('availability');
		expect(panel.notice().classList.contains('is-hidden')).toBe(false);
		expect(panel.notice().dataset.tone).toBe('warning');
		expect(panel.notice().querySelector('.snowflake-method-history-notice-text')?.textContent).toBe(
			en('history.recovery.off'),
		);
		const button = panel.button('.snowflake-method-history-notice-button');
		expect(button.classList.contains('is-hidden')).toBe(false);
		button.dispatch('click');
		expect(panel.bridge.openCorePluginSettings).toHaveBeenCalledTimes(1);
		// The gear stands first in the band, before the funnel, and opens File recovery's own settings.
		expect(
			panel.root.querySelector('.snowflake-method-prose-controls')?.children.map((child) => child.className),
		).toEqual([
			'clickable-icon snowflake-method-history-settings',
			'clickable-icon snowflake-method-filter-button',
			'snowflake-method-prose-state',
			'clickable-icon snowflake-method-prose-refresh',
		]);
		panel.button('.snowflake-method-history-settings').dispatch('click');
		expect(panel.bridge.openFileRecoverySettings).toHaveBeenCalledTimes(1);
		// Availability alone repaints; nothing is read again.
		expect(panel.reads.length).toBe(1);
		panel.avail.snapshots = 'setting-off';
		panel.emit('availability');
		expect(panel.notice().dataset.tone).toBe('muted');
		expect(panel.notice().querySelector('.snowflake-method-history-notice-text')?.textContent).toBe(
			en('history.recovery.settingOff'),
		);
		expect(button.classList.contains('is-hidden')).toBe(true);
		panel.avail.snapshots = 'unsupported';
		panel.emit('availability');
		expect(panel.notice().querySelector('.snowflake-method-history-notice-text')?.textContent).toBe(
			en('history.recovery.unsupported'),
		);
		panel.avail.snapshots = 'reading';
		panel.avail.harvesting = true;
		panel.emit('availability');
		expect(panel.notice().classList.contains('is-hidden')).toBe(true);
		expect(panel.state()).toBe('Reading snapshots…');
		expect(panel.reads.length).toBe(1);
	});

	it('walks the range by its unit and comes back to today', async () => {
		const panel = setup();
		await flush();
		const today = panel.button('.snowflake-method-history-today');
		const later = panel.button('.snowflake-method-calendar-step', 1);
		expect(today.disabled).toBe(true);
		// Nothing lies past today: the step forward is grey on the span that holds it.
		expect(later.disabled).toBe(true);
		panel.button('.snowflake-method-calendar-step', 0).dispatch('click');
		// The old reading goes at once, so the title and the list agree.
		expect(panel.rows()).toEqual([]);
		expect(panel.title()).toBe('2026-10-12 – 2026-10-18');
		await flush();
		expect(panel.reads[1]).toEqual(['2026-10-12', '2026-10-18']);
		expect(panel.filters.anchor).toBe('2026-10-12');
		expect(today.disabled).toBe(false);
		expect(later.disabled).toBe(false);
		expect(panel.state()).toBe('');
		expect(panel.root.querySelector('.snowflake-method-character-empty')?.classList.contains('is-hidden')).toBe(false);
		panel.button('.snowflake-method-calendar-step', 1).dispatch('click');
		await flush();
		expect(panel.reads[2]).toEqual(['2026-10-19', '2026-10-25']);
		expect(panel.filters.anchor).toBeNull();
		expect(later.disabled).toBe(true);
		panel.button('.snowflake-method-calendar-step', 0).dispatch('click');
		today.dispatch('click');
		await flush();
		expect(panel.reads[panel.reads.length - 1]).toEqual(['2026-10-19', '2026-10-25']);
		const pick = panel.button('select');
		pick.value = 'month';
		pick.dispatch('change');
		await flush();
		expect(panel.reads[panel.reads.length - 1]).toEqual(['2026-10-01', '2026-10-31']);
		expect(panel.filters.unit).toBe('month');
		expect(panel.title()).toBe(monthTitle('2026-10-01', 'en'));
		expect(later.disabled).toBe(true);
		pick.value = 'day';
		pick.dispatch('change');
		await flush();
		expect(panel.reads[panel.reads.length - 1]).toEqual([TODAY, TODAY]);
		expect(panel.title()).toBe('Today');
	});

	it('opens a note, a task tab and Obsidian’s own dialog, and says when it cannot', async () => {
		const panel = setup();
		await flush();
		// The name in the sentence is the way to the note; the one button
		// is the dialog.
		const ada = panel.rowOf('Ada');
		expect(ada.querySelectorAll('button').map((button) => button.className)).toEqual([
			'snowflake-method-history-recover',
		]);
		ada.querySelector('.snowflake-method-tracking-link')?.dispatch('click');
		expect(panel.bridge.openNote).toHaveBeenCalledWith(ADA);
		ada.querySelector('.snowflake-method-history-recover')?.dispatch('click');
		expect(panel.bridge.openFileRecovery).toHaveBeenCalledWith(ADA);
		expect(notices).toEqual([]);
		const task = panel.rowOf('Fix the ending');
		task.querySelector('.snowflake-method-tracking-link')?.dispatch('click');
		expect(panel.controls.openTasksTab).toHaveBeenCalledWith('tasks');
		expect(task.querySelector('.snowflake-method-history-recover')?.disabled).toBe(true);
		// A gone note has no way in, and its copies outlive it: the dialog opens on them.
		const gone = panel.rowOf('Old');
		expect(gone.querySelector('.snowflake-method-tracking-link')).toBeNull();
		expect(gone.querySelector('.snowflake-method-history-name')?.classList.contains('is-missing')).toBe(true);
		expect(gone.querySelector('.snowflake-method-history-recover')?.disabled).toBe(false);
		gone.querySelector('.snowflake-method-history-recover')?.dispatch('click');
		expect(panel.bridge.openFileRecovery).toHaveBeenLastCalledWith(OLD);
		expect(notices).toEqual([]);
		panel.setRecovery('off');
		panel.rowOf('Chapter 3').querySelector('.snowflake-method-history-recover')?.dispatch('click');
		expect(notices).toEqual([en('history.recovery.off')]);
		panel.setRecovery('no-project');
		panel.rowOf('Chapter 3').querySelector('.snowflake-method-history-recover')?.dispatch('click');
		expect(notices[1]).toBe(en('history.projectGone'));
		// The core plugin turned off: the dialog's button goes grey on every row.
		panel.avail.snapshots = 'plugin-off';
		panel.emit('availability');
		expect(
			panel.entryRows().map((tr) => tr.querySelector('.snowflake-method-history-recover')?.disabled),
		).toEqual([true, true, true, true]);
		expect(panel.rowOf('Ada').querySelector('.snowflake-method-tracking-link')).not.toBeNull();
	});

	it('puts the dialog behind the ellipsis without the column, on note rows alone', async () => {
		const panel = setup({ withActions: false });
		await flush();
		expect(panel.root.querySelectorAll('.snowflake-method-history-column-actions')).toEqual([]);
		for (const tr of panel.entryRows()) expect(tr.querySelectorAll('td').length).toBe(2);
		expect(panel.rows()[0]?.querySelector('td')?.getAttribute('colspan')).toBe('2');
		// A task's row has nothing behind an ellipsis: its name is the way in.
		expect(panel.rowOf('Fix the ending').querySelector('.snowflake-method-table-more')).toBeNull();
		panel.rowOf('Chapter 3').querySelector('.snowflake-method-table-more')?.dispatch('click');
		expect(shownMenus[0]?.map((item) => [item.title, item.disabled])).toEqual([
			['Open File recovery', false],
		]);
		shownMenus[0]?.[0]?.click?.();
		expect(panel.bridge.openFileRecovery).toHaveBeenCalledWith(CHAPTER);
		// A gone note keeps its ellipsis, and the dialog behind it: its copies outlive it.
		panel.rowOf('Old').querySelector('.snowflake-method-table-more')?.dispatch('click');
		expect(shownMenus[1]?.map((item) => [item.title, item.disabled])).toEqual([
			['Open File recovery', false],
		]);
	});

	it('narrows the list by kind through the lent funnel', async () => {
		const panel = setup();
		await flush();
		const funnel = panel.button('.snowflake-method-filter-button');
		expect(funnel.classList.contains('is-active')).toBe(false);
		funnel.dispatch('click');
		expect(panel.controls.openFilter).toHaveBeenCalledTimes(1);
		const row = panel.filterRows()[0];
		if (row === undefined || !('options' in row)) throw new Error('No kind row');
		expect(row.label).toBe('Kind');
		const options = row.options();
		expect(options.map((option) => option.value)).toContain('manuscript');
		expect(options.find((option) => option.value === 'task')?.label).toBe('Tasks');
		expect(options.find((option) => option.value === 'wb:time')?.label).toBe('Time');
		row.apply('task');
		panel.filterChanged()?.();
		expect(panel.filters.kind).toBe('task');
		expect(funnel.classList.contains('is-active')).toBe(true);
		expect(panel.rows().length).toBe(2);
		expect(textOf(panel.entryRows()[0]?.querySelector('.snowflake-method-history-sentence') ?? null)).toBe(
			'Added the task “Fix the ending”',
		);
		expect(panel.state()).toBe('1 / 4');
		// The funnel open, the button closes it instead.
		funnel.dispatch('click');
		expect(panel.controls.closeFilter).toHaveBeenCalledTimes(1);
	});

	it('re-reads on the plugin’s word and on its clock, and lets go when disposed', async () => {
		const panel = setup();
		await flush();
		expect(panel.reads.length).toBe(1);
		panel.emit('data');
		await flush();
		expect(panel.reads.length).toBe(2);
		panel.button('.snowflake-method-prose-refresh').dispatch('click');
		await flush();
		expect(panel.bridge.refresh).toHaveBeenCalledTimes(1);
		expect(panel.reads.length).toBe(3);
		// A minute passes with today in the range: read again, cheaply.
		panel.dom.tick();
		await flush();
		expect(panel.reads.length).toBe(4);
		// The day turns: the heads are named afresh.
		panel.setToday('2026-10-22');
		panel.dom.tick();
		await flush();
		expect(panel.reads.length).toBe(5);
		expect(
			panel.rows().filter((tr) => tr.classList.contains('snowflake-method-history-day')).map((tr) =>
				textOf(tr.querySelector('.snowflake-method-history-day-title')),
			),
		).toEqual(['Yesterday', '2026-10-20 Tue']);
		panel.handle.dispose();
		expect(panel.listeners.size).toBe(0);
		expect(panel.dom.intervals.size).toBe(0);
		expect(panel.controls.closeFilter).toHaveBeenCalled();
		expect(panel.root.children.length).toBe(0);
		panel.emit('data');
		await flush();
		expect(panel.reads.length).toBe(5);
	});

	it('lets go of a reading for a range the reader has since left', async () => {
		const panel = setup({ deferred: true });
		await flush();
		expect(panel.reads.length).toBe(1);
		panel.button('.snowflake-method-calendar-step', 0).dispatch('click');
		expect(panel.title()).toBe('2026-10-12 – 2026-10-18');
		// The first read lands late, for the week the reader left: nothing of
		// it is drawn, and the read queued behind it asks for the right week.
		panel.pending[0]?.(reading('2026-10-19', '2026-10-25'));
		await flush();
		expect(panel.rows()).toEqual([]);
		expect(panel.reads.length).toBe(2);
		expect(panel.reads[1]).toEqual(['2026-10-12', '2026-10-18']);
		panel.pending[1]?.(reading('2026-10-12', '2026-10-18'));
		await flush();
		expect(panel.state()).toBe('');
		expect(panel.rows()).toEqual([]);
		expect(panel.root.querySelector('.snowflake-method-character-empty')?.classList.contains('is-hidden')).toBe(false);
	});
});
