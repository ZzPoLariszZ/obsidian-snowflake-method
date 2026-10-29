import { Menu, Notice, setIcon, setTooltip } from 'obsidian';

import {
	type HistoryEntry,
	type HistoryNoteIdentity,
	type HistoryReading,
} from '../domain';
import type { TasksTab } from './dashboard-state';
import type { FilterRow, LentFilterPopover } from './filter-rows';
import type { HistoryAvailability, HistoryPanelBridge } from './history-bridge';
import {
	HISTORY_RANGE_UNITS,
	flattenHistoryRows,
	historyDayTitle,
	numeralRuns,
	historyKindOptions,
	historyRange,
	historyRangeTitle,
	historySentence,
	historyTime,
	historyWhat,
	isHistoryRangeUnit,
	kindRefOf,
	stepHistoryRange,
	type HistoryDateOptions,
	type HistoryFlatRow,
	type HistoryRange,
	type HistoryRangeUnit,
} from './history-rows';
import type { Translate } from './modals';
import { renderEmptyLine } from './pane-parts';
import { refreshLoop } from './refresh-loop';
import { VirtualTable, buildTableFrame } from './virtual-table';

/**
 * The Modification history face of the statistics pane: what happened to
 * the project, day by day, in the reader's own words. Under the prose
 * panel's control band stand the range the reader walks, a word about
 * File recovery where its copies are not being read, and the day list,
 * drawn a windowful at a time the way the foreshadowing table is.
 */

/** A window with the measuring tool the chooser is sized by, which every window has and the types name on none. */
type MeasuringWindow = Window & {
	ResizeObserver?: new (callback: () => void) => {
		observe(target: Element): void;
		disconnect(): void;
	};
};

/** How often the panel looks at the clock: for the day turning, and for a sitting still under way. */
export const HISTORY_CLOCK_MS = 60_000;

/** The range and the funnel outlive the panel, as the prose filters do. */
export interface HistoryFilterMemory {
	/** A kind key from the funnel, or '' for every kind. */
	kind: string;
	unit: HistoryRangeUnit;
	/** The day the range is cut around; null follows today, so a reopened tab shows the present. */
	anchor: string | null;
}

export interface HistoryPanelControls extends LentFilterPopover {
	filters: HistoryFilterMemory;
	/** Opens one tab of the Task management pane: where a task's or a thread's name leads. */
	openTasksTab(tab: TasksTab): void;
}

export interface HistoryPanelHandle {
	refresh(): void;
	dispose(): void;
}

const COLUMNS = ['time', 'activity', 'actions'] as const;
type Column = (typeof COLUMNS)[number];

/** The icons the entries that are no note wear. */
const ENTRY_ICONS = {
	renamed: 'pencil',
	imported: 'import',
	task: 'square-check',
	thread: 'route',
	revision: 'pen-line',
} as const;

/** Where a row's name leads: into a note, into a task tab, or nowhere. */
type RowTarget =
	| { kind: 'note'; note: HistoryNoteIdentity }
	| { kind: 'tasks'; tab: TasksTab }
	| null;

function targetOf(entry: HistoryEntry): RowTarget {
	switch (entry.kind) {
		case 'note':
		case 'revision':
			return { kind: 'note', note: entry.note };
		case 'renamed': {
			const one = entry.items.length === 1 ? entry.items[0] : undefined;
			return one === undefined ? null : { kind: 'note', note: one.note };
		}
		case 'imported':
			return null;
		case 'task':
			return { kind: 'tasks', tab: 'tasks' };
		case 'thread':
			return { kind: 'tasks', tab: 'foreshadowing' };
	}
}

function rangeIncludes(range: HistoryRange, day: string): boolean {
	return range.from <= day && day <= range.through;
}

/** The core plugin keeps copies this device can open: the dialog is there to open. */
function recoveryOpens(availability: HistoryAvailability): boolean {
	return availability.snapshots !== 'plugin-off' && availability.snapshots !== 'unsupported';
}

export function renderHistoryPanel(
	container: HTMLElement,
	bridge: HistoryPanelBridge,
	controls: HistoryPanelControls,
): HistoryPanelHandle {
	const t: Translate = bridge.t;
	const filters = controls.filters;
	// Read as the panel is built: the dashboard keys the panel by the
	// setting, so a toggle builds a fresh one rather than reshaping this.
	const withActions = bridge.showsActionsColumn();
	const columns: readonly Column[] = withActions
		? COLUMNS
		: COLUMNS.filter((column) => column !== 'actions');
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-history-panel',
	});

	// --- the control band: the gear, the funnel, the state, the refresh -----

	const band = root.createDiv({ cls: 'snowflake-method-prose-controls' });
	// The gear first: File recovery's own settings, where its interval and
	// history length live, or the core plugins where it is off.
	const settingsButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-history-settings',
		attr: { type: 'button', 'aria-label': t('history.settings') },
	});
	setIcon(settingsButton, 'settings');
	setTooltip(settingsButton, t('history.settings'));
	settingsButton.addEventListener('click', () => {
		bridge.openFileRecoverySettings();
	});
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
	const stateText = band.createSpan({ cls: 'snowflake-method-prose-state' });
	const refreshButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-prose-refresh',
		attr: { type: 'button', 'aria-label': t('history.refresh') },
	});
	setIcon(refreshButton, 'refresh-cw');
	setTooltip(refreshButton, t('history.refresh'));

	/** A kind key as the funnel names it. */
	const kindLabel = (key: string): string => {
		switch (key) {
			case 'task':
				return t('tasks.tab.tasks');
			case 'thread':
				return t('tasks.tab.foreshadowing');
			case 'revision':
				return t('tasks.tab.revision');
			default: {
				const ref = kindRefOf(key);
				return ref === null ? key : bridge.kindLabel(ref);
			}
		}
	};
	const filterRows = (): FilterRow[] => [
		{
			label: t('history.filter.kind'),
			placeholder: t('history.filter.allKinds'),
			empty: '',
			options: () =>
				historyKindOptions(reading).map((key) => ({ value: key, label: kindLabel(key) })),
			value: filters.kind,
			apply: (value) => {
				filters.kind = value;
			},
		},
	];
	const markFilterButton = (): void => {
		filterButton.toggleClass('is-active', filters.kind !== '');
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

	// --- the range row ------------------------------------------------------

	const rangeRow = root.createDiv({ cls: 'snowflake-method-history-range' });
	// The arrows and the title are one piece: a pane too narrow for the row
	// wraps the picks under them, never the step forward alone.
	const nav = rangeRow.createDiv({ cls: 'snowflake-method-history-range-nav' });
	const earlier = nav.createEl('button', {
		cls: 'clickable-icon snowflake-method-calendar-step',
		attr: { type: 'button', 'aria-label': t('history.range.previous') },
	});
	setIcon(earlier, 'chevron-left');
	setTooltip(earlier, t('history.range.previous'));
	const heading = nav.createDiv({ cls: 'snowflake-method-history-range-heading' });
	const rangeTitle = heading.createSpan({ cls: 'snowflake-method-history-range-title' });
	const later = nav.createEl('button', {
		cls: 'clickable-icon snowflake-method-calendar-step',
		attr: { type: 'button', 'aria-label': t('history.range.next') },
	});
	setIcon(later, 'chevron-right');
	setTooltip(later, t('history.range.next'));
	const picks = rangeRow.createDiv({ cls: 'snowflake-method-widget-picks' });
	const todayButton = picks.createEl('button', {
		cls: 'snowflake-method-history-today',
		text: t('sessionWidget.bands.today'),
		attr: { type: 'button' },
	});
	const unitPick = picks.createEl('select', {
		cls: 'dropdown snowflake-method-widget-pick',
		attr: { 'aria-label': t('history.range.unit') },
	});
	for (const unit of HISTORY_RANGE_UNITS) {
		unitPick.createEl('option', { value: unit, text: t(`history.range.${unit}`) });
	}
	// The chooser as wide as the band's three buttons together, so the two
	// rows end in one block: measured, since the buttons' width is the
	// theme's, and again whenever they are laid out anew.
	const fitUnitPick = (): void => {
		const buttons = [settingsButton, filterButton, refreshButton];
		const widths = buttons.map((button) => button.offsetWidth);
		if (widths.some((width) => !(width > 0))) return;
		const gap = parseFloat(band.win.getComputedStyle(band).columnGap);
		const width =
			widths.reduce((sum, each) => sum + each, 0) + (Number.isNaN(gap) ? 0 : gap) * (buttons.length - 1);
		rangeRow.style.setProperty('--snowflake-method-history-pick-width', `${String(Math.round(width))}px`);
	};
	fitUnitPick();
	const sizing = (band.win as MeasuringWindow).ResizeObserver;
	const bandWatch = sizing === undefined ? null : new sizing(fitUnitPick);
	bandWatch?.observe(settingsButton);

	let today = bridge.today();
	const dateOptions = (): HistoryDateOptions => ({
		t,
		locale: bridge.locale(),
		dateFormat: bridge.dateFormat(),
	});
	let range = historyRange(filters.anchor ?? today, filters.unit, bridge.weekStart());
	const rangeKey = (): string => `${range.from}..${range.through}`;
	const paintRange = (): void => {
		paintNumerals(rangeTitle, historyRangeTitle(range, today, dateOptions()));
		unitPick.value = range.unit;
		todayButton.disabled = rangeIncludes(range, today);
		// Nothing lies past today: the step forward goes grey on the span that holds it.
		later.disabled = range.through >= today;
	};
	/** A new range: the old reading is let go at once, so the title and the list never disagree. */
	const moveTo = (next: HistoryRange): void => {
		range = next;
		filters.unit = next.unit;
		filters.anchor = rangeIncludes(next, today) ? null : next.from;
		reading = null;
		heights.clear();
		paintRange();
		paint();
		loop.refresh();
	};
	earlier.addEventListener('click', () => {
		moveTo(stepHistoryRange(range, -1, bridge.weekStart()));
	});
	later.addEventListener('click', () => {
		moveTo(stepHistoryRange(range, 1, bridge.weekStart()));
	});
	todayButton.addEventListener('click', () => {
		moveTo(historyRange(today, range.unit, bridge.weekStart()));
	});
	unitPick.addEventListener('change', () => {
		const unit = unitPick.value;
		if (!isHistoryRangeUnit(unit)) return;
		moveTo(historyRange(filters.anchor ?? today, unit, bridge.weekStart()));
	});

	// --- the numerals of the titles and the times ---------------------------

	/**
	 * A text set with its numbers in the monospaced face and the words around
	 * them in the interface's own, so every figure on the tab shares one face
	 * and a column of them lines up digit under digit. Every run is its own
	 * span, in order, so the text reads back whole.
	 */
	const paintNumerals = (target: HTMLElement, text: string): void => {
		target.empty();
		for (const run of numeralRuns(text)) {
			target.createSpan({
				...(run.numeral ? { cls: 'snowflake-method-history-numeral' } : {}),
				text: run.text,
			});
		}
	};

	// --- the word about File recovery ---------------------------------------

	const notice = root.createDiv({ cls: 'snowflake-method-history-notice' });
	const noticeIcon = notice.createSpan({
		cls: 'snowflake-method-history-notice-icon',
		attr: { 'aria-hidden': 'true' },
	});
	const noticeText = notice.createSpan({ cls: 'snowflake-method-history-notice-text' });
	const noticeButton = notice.createEl('button', {
		cls: 'snowflake-method-history-notice-button',
		text: t('history.openSettings'),
		attr: { type: 'button' },
	});
	noticeButton.addEventListener('click', () => {
		bridge.openCorePluginSettings();
	});
	const paintNotice = (availability: HistoryAvailability): void => {
		const state = availability.snapshots;
		notice.toggleClass('is-hidden', state === 'reading');
		if (state === 'reading') return;
		const warning = state === 'plugin-off';
		notice.dataset.tone = warning ? 'warning' : 'muted';
		noticeIcon.empty();
		setIcon(noticeIcon, warning ? 'triangle-alert' : 'info');
		noticeText.setText(
			state === 'plugin-off'
				? t('history.recovery.off')
				: state === 'unsupported'
					? t('history.recovery.unsupported')
					: state === 'setting-off'
						? t('history.recovery.settingOff')
						: t('history.recovery.unreadable'),
		);
		// The button goes with the warning alone: the muted states name
		// nothing to open.
		noticeButton.toggleClass('is-hidden', !warning);
	};

	// --- the day list -------------------------------------------------------

	const columnLabel = (column: Column): string =>
		column === 'actions' ? t('table.actions') : t(`history.column.${column}`);
	const {
		wrap: tableWrap,
		bodyWrap,
		body: tableBody,
	} = buildTableFrame(root, {
		wrapCls: 'snowflake-method-history-table-wrap',
		tableCls: `snowflake-method-history-table${withActions ? ' has-actions-column' : ''}`,
		columns: columns.map((column) => `snowflake-method-history-column-${column}`),
		headers: columns.map((column) => ({
			cls: `snowflake-method-history-column-${column}`,
			text: columnLabel(column),
		})),
	});
	const { line: emptyLine } = renderEmptyLine(root, t('history.empty'));

	const heights = new Map<string, number>();
	let reading: HistoryReading | null = null;
	let rows: HistoryFlatRow[] = [];

	const opened = (work: Promise<void>): void => {
		void work.catch((error: unknown) => {
			new Notice(error instanceof Error ? error.message : t('errors.unknown'));
		});
	};
	const openTarget = (target: RowTarget): void => {
		if (target === null) return;
		if (target.kind === 'tasks') {
			controls.openTasksTab(target.tab);
			return;
		}
		if (!target.note.exists) {
			new Notice(t('history.noteGone'));
			return;
		}
		opened(bridge.openNote(target.note.path));
	};
	const openRecovery = (target: RowTarget): void => {
		if (target === null || target.kind !== 'note') return;
		switch (bridge.openFileRecovery(target.note.path)) {
			case 'opened':
				return;
			case 'off':
				new Notice(t('history.recovery.off'));
				return;
			case 'unsupported':
				new Notice(t('history.recovery.unsupported'));
				return;
			case 'no-project':
				new Notice(t('history.projectGone'));
		}
	};
	const labels = {
		what: (note: HistoryNoteIdentity): string =>
			historyWhat(t, note, (ref) => bridge.kindLabel(ref)),
		taskStatus: (status: string): string => t(`tasks.status.${status}`),
		threadStatus: (status: string): string => t(`foreshadowing.status.${status}`),
	};
	const iconOf = (entry: HistoryEntry): string =>
		entry.kind === 'note' ? bridge.kindIcon(entry.note) : ENTRY_ICONS[entry.kind];

	// The actions column is as wide as its one button and the cell's padding,
	// measured from the first row drawn, whatever the button's language says:
	// the fallback width leaves the button room until then, so nothing is
	// clipped on the way. A row drawn while the frame is hidden measures
	// nothing and the next row drawn tries again.
	let actionsFitted = false;
	const fitActionsColumn = (button: HTMLElement): void => {
		if (actionsFitted) return;
		const width = button.offsetWidth;
		if (!(width > 0)) return;
		const cell = button.closest('td');
		if (cell === null) return;
		const style = cell.win.getComputedStyle(cell);
		const padding = parseFloat(style.paddingInlineStart) + parseFloat(style.paddingInlineEnd);
		tableWrap.style.setProperty(
			'--snowflake-method-history-actions-width',
			`${String(Math.ceil(width + padding))}px`,
		);
		actionsFitted = true;
	};

	const virtual = new VirtualTable({
		scroller: bodyWrap,
		body: tableBody,
		columns: columns.length,
		estimatedRowHeight: 40,
		overscan: 8,
		rowKey: (index) => rows[index]?.key ?? `?${String(index)}`,
		heights,
		renderRow: (body, index) => {
			const row = rows[index];
			if (row === undefined) return;
			if (row.kind === 'day') {
				// One cell across the row: the day's name, which the narrow
				// layout shows as a bar between the cards rather than as a card
				// with a label.
				const tr = body.createEl('tr', { cls: 'snowflake-method-history-day' });
				const td = tr.createEl('td', {
					cls: 'snowflake-method-history-day-cell',
					attr: { colspan: String(columns.length) },
				});
				paintNumerals(
					td.createSpan({ cls: 'snowflake-method-history-day-title' }),
					historyDayTitle(row.day, today, dateOptions()),
				);
				return;
			}
			const { entry } = row;
			const target = targetOf(entry);
			const availability = bridge.availability();
			const tr = body.createEl('tr', {
				cls: 'snowflake-method-history-row',
				attr: { 'data-kind': entry.kind },
			});
			const cell = (column: Column): HTMLElement =>
				tr.createEl('td', {
					cls: `snowflake-method-history-column-${column}`,
					attr: { 'data-label': columnLabel(column) },
				});
			cell('time').setText(historyTime(entry, bridge.timeZone()));
			const activity = cell('activity');
			const line = activity.createDiv({ cls: 'snowflake-method-history-activity' });
			const icon = line.createSpan({
				cls: 'snowflake-method-history-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(icon, iconOf(entry));
			const sentence = historySentence(t, entry, labels);
			const text = line.createSpan({ cls: 'snowflake-method-history-sentence' });
			text.createSpan({ text: sentence.before });
			if (sentence.name !== null) {
				const openable =
					target !== null && (target.kind === 'tasks' || target.note.exists);
				const name = text.createSpan({
					cls: openable
						? 'snowflake-method-tracking-link'
						: 'snowflake-method-history-name is-missing',
					text: sentence.name,
				});
				if (openable) {
					name.addEventListener('click', () => {
						openTarget(target);
					});
				}
				text.createSpan({ text: sentence.after });
			}
			// A deleted note's copies outlive it: the dialog opens on them too.
			const canRecover = target !== null && target.kind === 'note' && recoveryOpens(availability);
			if (!withActions) {
				// No column: the dialog stands behind the ellipsis at the end
				// of the last cell, the member tables' own shape. The name in
				// the sentence is the way to the note or the task, so a row
				// with no note has nothing to offer and shows none.
				if (target === null || target.kind !== 'note') return;
				const more = activity.createEl('button', {
					cls: 'clickable-icon snowflake-method-table-more',
					attr: {
						type: 'button',
						'aria-haspopup': 'menu',
						'aria-label':
							sentence.name === null
								? t('table.actions')
								: t('table.options', { name: sentence.name }),
					},
				});
				setIcon(more, 'ellipsis');
				more.addEventListener('click', (event) => {
					const menu = new Menu();
					menu.setParentElement(more);
					menu.addItem((item) =>
						item
							.setTitle(t('history.openFileRecovery'))
							.setIcon('history')
							.setDisabled(!canRecover)
							.onClick(() => {
								openRecovery(target);
							}),
					);
					menu.showAtMouseEvent(event);
				});
				return;
			}
			// One button: the name in the sentence is the way to the note
			// or the task, and the dialog is the one way out it cannot be.
			const actions = cell('actions').createDiv({ cls: 'snowflake-method-table-actions' });
			const recover = actions.createEl('button', {
				cls: 'snowflake-method-history-recover',
				text: t('history.openFileRecovery'),
				attr: { type: 'button' },
			});
			recover.disabled = !canRecover;
			recover.addEventListener('click', () => {
				openRecovery(target);
			});
			fitActionsColumn(recover);
		},
		renderTail: () => undefined,
		onScroll: () => undefined,
		onMeasure: () => undefined,
	});

	/** What the frame shows: the table, the empty line, or the state alone. */
	const paint = (): void => {
		if (reading === null) {
			rows = [];
			tableWrap.addClass('is-hidden');
			emptyLine.addClass('is-hidden');
			virtual.setTotal(0);
			stateText.setText(
				loop.loading
					? t('history.loading')
					: loop.failed
						? t('history.loadFailed')
						: t('history.noProject'),
			);
			return;
		}
		rows = flattenHistoryRows(reading.days, filters.kind);
		const total = reading.days.reduce((carried, day) => carried + day.entries.length, 0);
		const shown = rows.filter((row) => row.kind === 'entry').length;
		stateText.setText(
			bridge.availability().harvesting
				? t('history.harvesting')
				: shown === total
					? ''
					: t('table.filteredCount', { shown, total }),
		);
		tableWrap.toggleClass('is-hidden', rows.length === 0);
		emptyLine.toggleClass('is-hidden', rows.length > 0);
		virtual.setTotal(rows.length);
	};

	const loop = refreshLoop<{ key: string; reading: HistoryReading | null }>({
		read: () => {
			const key = rangeKey();
			return bridge.read(range.from, range.through).then((next) => ({ key, reading: next }));
		},
		onStart: () => {
			if (reading === null) paint();
		},
		onRead: (next) => {
			// A reading for a range the reader has since left is let go; the
			// refresh queued behind it brings the one for where they are.
			if (next.key !== rangeKey()) return;
			reading = next.reading;
			heights.clear();
			paint();
		},
		onFail: () => {
			if (reading === null) paint();
			else stateText.setText(t('history.loadFailed'));
		},
	});
	const refresh = (): void => {
		loop.refresh();
	};
	refreshButton.addEventListener('click', () => {
		// The copies are read now, then the span again: a pass that found
		// nothing new fires no event, and the reader asked to see.
		void bridge.refresh().then(refresh, refresh);
	});

	// --- keeping current ----------------------------------------------------

	const unsubscribe = bridge.subscribe((change) => {
		if (change === 'data') {
			refresh();
			return;
		}
		paintNotice(bridge.availability());
		// The rows' buttons and the state read the availability: drawn again
		// from the reading standing, with no read.
		paint();
	});
	const clock = root.win.setInterval(() => {
		const now = bridge.today();
		const turned = now !== today;
		today = now;
		if (turned && filters.anchor === null) {
			moveTo(historyRange(today, range.unit, bridge.weekStart()));
			return;
		}
		if (turned) {
			paintRange();
			virtual.setTotal(rows.length);
		}
		// A sitting still under way moves the day's words; the span that
		// holds today is read again, cheaply where nothing moved.
		if (rangeIncludes(range, today)) refresh();
	}, HISTORY_CLOCK_MS);

	paintRange();
	paintNotice(bridge.availability());
	refresh();

	return {
		refresh,
		dispose: (): void => {
			root.win.clearInterval(clock);
			unsubscribe();
			bandWatch?.disconnect();
			loop.dispose();
			virtual.destroy();
			controls.closeFilter();
			root.remove();
		},
	};
}
