import { Menu, SearchComponent, setIcon, setTooltip } from 'obsidian';

import {
	TASK_PRIORITIES,
	TASK_STATUSES,
	formatDay,
	isTaskPriority,
	isTaskStatus,
	resolveEntityRefs,
	taskOverdue,
	type Task,
	type TaskStatus,
} from '../domain';
import type { FilterRow } from './filter-rows';
import { grouped, renderEmptyLine } from './pane-parts';
import { refreshLoop } from './refresh-loop';
import { planCardRepaint } from './sticky-note-layout';
import {
	TASK_DUE_FILTERS,
	columnsOf,
	derivedTaskTarget,
	dropIndexAt,
	filterArchivedTasks,
	filterTaskCards,
	isTaskDueFilter,
	type SharedTaskFilters,
	taskCards,
	type TaskCard,
	type TaskFilterContext,
} from './task-board-rows';
import type {
	TaskBoardBridge,
	TaskBoardControls,
	TaskBoardReading,
} from './task-bridge';

/**
 * The Tasks face of the Task management pane: a Kanban of six columns, the
 * cards the plugin derives standing first in each and the author's own
 * tasks after them in the order the file holds them. The strip scrolls
 * sideways, every column scrolls down on its own under a head that stays
 * put, a card is dragged within a column to reorder and into another to
 * change its status, and the archive folds under the board the way the
 * sticky board's does.
 *
 * Built once and patched: the lanes live for the panel, and a paint brings
 * each lane's cards level with the reading in place, so a drag in flight,
 * the focus and the scroll positions all survive a read. A read that lands
 * mid-drag is painted when the drag ends.
 */

export interface TaskBoardHandle {
	refresh(): void;
	dispose(): void;
}

const TASK_DRAG_TYPE = 'application/x-snowflake-task';
/** How often the board checks whether the day has turned. */
const DAY_WATCH_MS = 60_000;

/**
 * One card on the board: its element, wired once, and the reading it
 * currently wears. The listeners read the card through the entry, so a
 * repaint redresses the element rather than wiring it again.
 */
interface CardEntry {
	el: HTMLElement;
	card: TaskCard;
}

/** One column: its head, its scrolling body, and the cards it shows by id. */
interface Lane {
	status: TaskStatus;
	count: HTMLElement;
	body: HTMLElement;
	/** The landing at the column's end, and the drop area of an empty column. */
	tail: HTMLElement;
	cards: Map<string, CardEntry>;
}

const cardId = (card: TaskCard): string =>
	card.origin === 'manual' ? card.task.id : `derived:${card.derived.key}`;

/** The mark each priority wears: a rising chevron pair for the urgent, a level pair of lines for the middle. */
const PRIORITY_ICONS: Record<Task['priority'], string> = {
	low: 'chevron-down',
	medium: 'equal',
	high: 'chevron-up',
	urgent: 'chevrons-up',
};

export function renderTaskBoard(
	container: HTMLElement,
	bridge: TaskBoardBridge,
	controls: TaskBoardControls,
): TaskBoardHandle {
	const t = bridge.t;
	const memory = controls.memory;
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-task-board',
	});
	const band = root.createDiv({ cls: 'snowflake-method-prose-controls' });
	const search = new SearchComponent(band);
	search.setPlaceholder(t('taskBoard.searchPlaceholder'));
	search.setValue(memory.query);
	search.onChange((next) => {
		memory.query = next;
		paint();
	});
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
	const stateText = band.createSpan({ cls: 'snowflake-method-prose-state' });
	const refreshButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-prose-refresh',
		attr: { type: 'button', 'aria-label': t('taskBoard.refresh') },
	});
	setIcon(refreshButton, 'refresh-cw');
	setTooltip(refreshButton, t('taskBoard.refresh'));
	const addButton = band.createEl('button', {
		cls: 'mod-cta snowflake-method-task-add',
		text: t('taskBoard.add'),
		attr: { type: 'button' },
	});
	addButton.disabled = true;

	let reading: TaskBoardReading | null = null;
	let readOnly = false;
	/** The card in flight, while one is; every read landing meanwhile waits. */
	let drag: { id: string } | null = null;
	let paintOwed = false;
	/** The element wearing the landing mark, while a drag is over a lane. */
	let mark: HTMLElement | null = null;

	// The two questions the board and the archive both ask.
	const priorityRow = (filters: SharedTaskFilters): FilterRow => ({
		label: t('taskBoard.priority'),
		placeholder: t('taskBoard.filterAllPriorities'),
		empty: '',
		options: () =>
			TASK_PRIORITIES.map((priority) => ({
				value: priority,
				label: t(`tasks.priority.${priority}`),
			})),
		value: filters.priority,
		apply: (value) => {
			filters.priority = isTaskPriority(value) ? value : '';
		},
	});
	const dueRow = (filters: SharedTaskFilters): FilterRow => ({
		label: t('taskBoard.filterDue'),
		placeholder: t('taskBoard.filterAllDue'),
		empty: '',
		options: () =>
			TASK_DUE_FILTERS.map((due) => ({ value: due, label: t(`taskBoard.due.${due}`) })),
		value: filters.due,
		apply: (value) => {
			filters.due = isTaskDueFilter(value) ? value : '';
		},
	});
	// The funnel's questions, in the dashboard's own popover.
	const filterRows = (): FilterRow[] => [
		{
			label: t('taskBoard.filterOrigin'),
			placeholder: t('taskBoard.filterAllOrigins'),
			empty: '',
			options: () => [
				{ value: 'manual', label: t('taskBoard.origin.manual') },
				{ value: 'derived', label: t('taskBoard.origin.derived') },
			],
			value: memory.origin,
			apply: (value) => {
				memory.origin = value === 'manual' || value === 'derived' ? value : '';
			},
		},
		priorityRow(memory),
		dueRow(memory),
	];
	const markFilterButton = (): void => {
		filterButton.toggleClass(
			'is-active',
			memory.origin !== '' || memory.priority !== '' || memory.due !== '',
		);
	};
	filterButton.addEventListener('click', () => {
		if (controls.popover.filterOpen()) {
			controls.popover.closeFilter();
			return;
		}
		controls.popover.openFilter(filterButton, filterRows(), () => {
			markFilterButton();
			paint();
		});
	});
	markFilterButton();

	// The lanes, built once for the panel's life.
	const frame = root.createDiv({ cls: 'snowflake-method-task-frame' });
	const strip = frame.createDiv({
		cls: 'snowflake-method-task-lanes',
		attr: { role: 'list' },
	});
	const lanes = new Map<TaskStatus, Lane>();
	/** Where each scroller stood, restored after the frame hands the board back. */
	const scrolls = new Map<TaskStatus, number>();
	let stripScroll = 0;
	for (const status of TASK_STATUSES) {
		const el = strip.createDiv({
			cls: 'snowflake-method-task-lane',
			attr: { 'data-status': status, role: 'listitem' },
		});
		const head = el.createDiv({ cls: 'snowflake-method-task-lane-head' });
		head.createSpan({
			cls: 'snowflake-method-task-lane-title',
			text: t(`tasks.status.${status}`),
		});
		const count = head.createSpan({
			cls: 'snowflake-method-step-indicator snowflake-method-task-lane-count',
			text: '0',
		});
		const body = el.createDiv({
			cls: 'snowflake-method-task-lane-body',
			attr: { role: 'list' },
		});
		const tail = body.createDiv({ cls: 'snowflake-method-task-lane-tail' });
		const lane: Lane = { status, count, body, tail, cards: new Map() };
		lanes.set(status, lane);
		body.addEventListener('scroll', () => {
			if (root.isConnected) scrolls.set(status, body.scrollTop);
		});
		wireDrop(lane);
	}
	strip.addEventListener('scroll', () => {
		if (root.isConnected) stripScroll = strip.scrollLeft;
	});
	const { line: emptyLine, text: emptyText } = renderEmptyLine(root, '');

	// The archive as the sticky board folds it: a toggle row with the count
	// in a badge, the way out for every task at the row's end, and the
	// set-aside cards in a scroller of their own.
	const archiveSection = root.createDiv({ cls: 'snowflake-method-task-archive' });
	const archiveToggle = archiveSection.createEl('button', {
		cls: 'snowflake-method-task-archive-toggle',
		attr: { type: 'button', 'aria-expanded': String(memory.archiveOpen) },
	});
	archiveToggle.createSpan({ text: t('taskBoard.archiveTitle') });
	const archiveCount = archiveToggle
		.createSpan({ cls: 'snowflake-method-task-archive-count' })
		.createSpan({ cls: 'snowflake-method-step-indicator' });
	const archiveBody = archiveSection.createDiv({ cls: 'snowflake-method-task-archive-body' });
	archiveBody.toggleClass('is-collapsed', !memory.archiveOpen);
	archiveToggle.addEventListener('click', () => {
		memory.archiveOpen = !memory.archiveOpen;
		archiveToggle.setAttribute('aria-expanded', String(memory.archiveOpen));
		archiveBody.toggleClass('is-collapsed', !memory.archiveOpen);
	});
	const archiveActions = archiveBody.createDiv({ cls: 'snowflake-method-task-archive-actions' });
	// The archive's own search and funnel, laid as the band above is, so a
	// long shelf is read the way the board is.
	const archiveSearch = new SearchComponent(archiveActions);
	archiveSearch.setPlaceholder(t('taskBoard.searchPlaceholder'));
	archiveSearch.setValue(memory.archive.query);
	archiveSearch.onChange((next) => {
		memory.archive.query = next;
		paint();
	});
	const archiveFilterButton = archiveActions.createEl('button', {
		cls: 'clickable-icon snowflake-method-filter-button',
		attr: {
			type: 'button',
			'aria-haspopup': 'dialog',
			'aria-label': t('table.filter'),
		},
	});
	setIcon(archiveFilterButton, 'funnel');
	setTooltip(archiveFilterButton, t('table.filter'));
	const archiveState = archiveActions.createSpan({ cls: 'snowflake-method-prose-state' });
	const archiveRefresh = archiveActions.createEl('button', {
		cls: 'clickable-icon snowflake-method-prose-refresh',
		attr: { type: 'button', 'aria-label': t('taskBoard.refresh') },
	});
	setIcon(archiveRefresh, 'refresh-cw');
	setTooltip(archiveRefresh, t('taskBoard.refresh'));
	archiveRefresh.addEventListener('click', () => {
		loop.refresh();
	});
	const emptyButton = archiveActions.createEl('button', {
		cls: 'mod-warning snowflake-method-task-empty-archive',
		text: t('taskBoard.emptyArchive'),
		attr: { type: 'button' },
	});
	emptyButton.disabled = true;
	const archiveList = archiveBody.createDiv({ cls: 'snowflake-method-task-archive-list' });
	const archiveGrid = archiveList.createDiv({
		cls: 'snowflake-method-task-archive-grid',
		attr: { role: 'list' },
	});
	const { line: archiveEmpty, text: archiveEmptyText } = renderEmptyLine(archiveList, '');
	const shelf = new Map<string, HTMLElement>();
	emptyButton.addEventListener('click', () => {
		if (reading === null) return;
		const ids = reading.tasks.filter((task) => task.archived).map((task) => task.id);
		act(bridge.emptyArchive(ids));
	});
	// The archive's funnel asks the board's two questions of the shelf alone.
	const archiveFilterRows = (): FilterRow[] => [
		{
			label: t('status.label'),
			placeholder: t('taskBoard.filterAllStatuses'),
			empty: '',
			options: () =>
				TASK_STATUSES.map((status) => ({ value: status, label: t(`tasks.status.${status}`) })),
			value: memory.archive.status,
			apply: (value) => {
				memory.archive.status = isTaskStatus(value) ? value : '';
			},
		},
		priorityRow(memory.archive),
		dueRow(memory.archive),
	];
	const markArchiveFilterButton = (): void => {
		archiveFilterButton.toggleClass(
			'is-active',
			memory.archive.status !== '' ||
				memory.archive.priority !== '' ||
				memory.archive.due !== '',
		);
	};
	archiveFilterButton.addEventListener('click', () => {
		if (controls.popover.filterOpen()) {
			controls.popover.closeFilter();
			return;
		}
		controls.popover.openFilter(archiveFilterButton, archiveFilterRows(), () => {
			markArchiveFilterButton();
			paint();
		});
	});
	markArchiveFilterButton();

	const show = (el: Element | null, shown: boolean): void => {
		el?.toggleClass('is-hidden', !shown);
	};

	/** A bridge answer landed: a refusal is said in the band, a failure as well. */
	const act = (outcome: Promise<boolean>): void => {
		void outcome
			.then((ok) => {
				if (!ok) stateText.setText(t('taskBoard.refused'));
			})
			.catch(() => {
				stateText.setText(t('taskBoard.refused'));
			});
	};

	const filterContext = (current: TaskBoardReading): TaskFilterContext => ({
		today: current.today,
		week: current.week,
		labels: {
			derived: (key) => t(`tasks.derived.${key}`),
			priority: (priority) => t(`tasks.priority.${priority}`),
		},
		relatedNames: (task) =>
			resolveEntityRefs(task.related, current.roster).map((ref) => ref.name),
	});

	/** The card's menu: its edit, a way to another column without a drag, the archive, and the delete behind its confirmation. */
	const openMenu = (event: MouseEvent, task: Task): void => {
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('taskBoard.edit'))
				.setIcon('pencil')
				.setDisabled(readOnly)
				.onClick(() => {
					void bridge.edit(task.id).catch(() => undefined);
				});
		});
		menu.addSeparator();
		for (const status of TASK_STATUSES) {
			if (status === task.status) continue;
			menu.addItem((item) => {
				item
					.setTitle(t('taskBoard.moveTo', { status: t(`tasks.status.${status}`) }))
					.setIcon('arrow-right')
					.setDisabled(readOnly)
					.onClick(() => {
						act(bridge.move(task.id, status, null));
					});
			});
		}
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('taskBoard.archive'))
				.setIcon('archive')
				.setDisabled(readOnly)
				.onClick(() => {
					act(bridge.archive(task.id));
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('actions.delete'))
				.setIcon('trash-2')
				.setWarning(true)
				.setDisabled(readOnly)
				.onClick(() => {
					act(bridge.deleteTask(task.id));
				});
		});
		menu.showAtMouseEvent(event);
	};

	/** The date on a card, said as the author writes dates, red when the day has passed. */
	/** The priority as its mark in colour and the word beside it. */
	const prioritySpan = (host: HTMLElement, priority: Task['priority']): void => {
		const span = host.createSpan({ cls: 'snowflake-method-task-priority' });
		const icon = span.createSpan({
			cls: 'snowflake-method-task-glyph',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, PRIORITY_ICONS[priority]);
		span.createSpan({ text: t(`tasks.priority.${priority}`) });
	};

	const dueSpan = (
		host: HTMLElement,
		task: Task,
		current: TaskBoardReading,
	): void => {
		if (task.dueDate === null) return;
		const overdue = taskOverdue(task, current.today);
		const due = host.createSpan({ cls: 'snowflake-method-task-due' });
		due.toggleClass('is-overdue', overdue);
		const icon = due.createSpan({
			cls: 'snowflake-method-task-glyph',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, 'calendar');
		const date = formatDay(task.dueDate, current.dateFormat);
		due.createSpan({ text: date });
		setTooltip(
			due,
			overdue ? `${t('taskBoard.overdue')} · ${t('taskBoard.due', { date })}` : t('taskBoard.due', { date }),
		);
	};

	/**
	 * Wires a card's element once, for the life of the card: what a click, a
	 * key, the context menu and a drag do, each reading the card the entry
	 * holds now. Derived and manual cards never trade ids, so the wiring is
	 * the origin's.
	 */
	const wireCard = (entry: CardEntry): void => {
		const el = entry.el;
		if (entry.card.origin === 'derived') {
			const open = (): void => {
				if (entry.card.origin === 'derived') {
					controls.navigate(derivedTaskTarget(entry.card.derived.key));
				}
			};
			el.addEventListener('click', open);
			el.addEventListener('keydown', (event) => {
				if (event.target !== el) return;
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				open();
			});
			return;
		}
		const taskOf = (): Task | null =>
			entry.card.origin === 'manual' ? entry.card.task : null;
		const edit = (): void => {
			const task = taskOf();
			if (task !== null) void bridge.edit(task.id).catch(() => undefined);
		};
		el.addEventListener('click', (event) => {
			const target = event.target;
			if (target instanceof Element && target.closest('.snowflake-method-task-more') !== null) {
				return;
			}
			edit();
		});
		// Only the card's own key: the More button inside it activates
		// itself, and a key that bubbled up from it would open the editor
		// and cancel the click the button was about to make of it.
		el.addEventListener('keydown', (event) => {
			if (event.target !== el) return;
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			edit();
		});
		el.addEventListener('contextmenu', (event) => {
			const task = taskOf();
			if (task === null) return;
			event.preventDefault();
			openMenu(event, task);
		});
		el.addEventListener('dragstart', (event) => {
			const task = taskOf();
			if (task === null || event.dataTransfer === null || readOnly) {
				event.preventDefault();
				return;
			}
			drag = { id: task.id };
			el.addClass('is-dragging');
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
		});
		// Fires on the source however the drag ends: dropped, dropped nowhere,
		// or cancelled. Everything the drag marked clears here.
		el.addEventListener('dragend', () => {
			el.removeClass('is-dragging');
			clearMark();
			drag = null;
			if (paintOwed) {
				paintOwed = false;
				paint();
			}
		});
	};

	/** Dresses a card's element from its reading, on the first paint and every one after. */
	const dressCard = (entry: CardEntry, current: TaskBoardReading): void => {
		const { el, card } = entry;
		el.empty();
		el.className = 'snowflake-method-task-card';
		el.setAttribute('role', 'listitem');
		el.setAttribute('tabindex', '0');
		if (card.origin === 'derived') {
			const derived = card.derived;
			el.setAttribute('data-id', cardId(card));
			el.setAttribute('data-origin', 'derived');
			el.setAttribute('data-key', derived.key);
			el.setAttribute('draggable', 'false');
			setTooltip(el, t('tasks.derived.tooltip'));
			const head = el.createDiv({ cls: 'snowflake-method-task-card-head' });
			head.createDiv({
				cls: 'snowflake-method-task-card-title',
				text: t(`tasks.derived.${derived.key}`),
			});
			if (derived.progress !== null) {
				head.createSpan({
					cls: 'snowflake-method-task-progress',
					text: t('tasks.derived.progress', {
						net: grouped(derived.progress.net),
						goal: grouped(derived.progress.goal),
					}),
				});
			} else if (derived.count !== null) {
				head.createSpan({
					cls: 'snowflake-method-step-indicator snowflake-method-task-count',
					text: String(derived.count),
				});
			}
			return;
		}
		const task = card.task;
		el.setAttribute('data-id', task.id);
		el.setAttribute('data-origin', 'manual');
		el.setAttribute('data-priority', task.priority);
		el.setAttribute('draggable', readOnly ? 'false' : 'true');
		const head = el.createDiv({ cls: 'snowflake-method-task-card-head' });
		const title = head.createDiv({ cls: 'snowflake-method-task-card-title', text: task.title });
		setTooltip(title, task.title);
		const more = head.createEl('button', {
			cls: 'clickable-icon snowflake-method-task-more',
			attr: { type: 'button', 'aria-label': t('taskBoard.more'), 'aria-haspopup': 'menu' },
		});
		setIcon(more, 'ellipsis');
		more.addEventListener('click', (event) => {
			event.stopPropagation();
			openMenu(event, task);
		});
		const meta = el.createDiv({ cls: 'snowflake-method-task-card-meta' });
		prioritySpan(meta, task.priority);
		dueSpan(meta, task, current);
	};

	/**
	 * An archived card: the board's own face, the column it left worn on
	 * its top edge as the lane wears it, and the two ways off the shelf
	 * beside the title where a board card keeps its menu.
	 */
	const fillArchivedCard = (el: HTMLElement, task: Task, current: TaskBoardReading): void => {
		el.empty();
		el.className = 'snowflake-method-task-card is-archived';
		el.setAttribute('role', 'listitem');
		el.setAttribute('data-id', task.id);
		el.setAttribute('data-origin', 'manual');
		el.setAttribute('data-status', task.status);
		el.setAttribute('data-priority', task.priority);
		setTooltip(el, t(`tasks.status.${task.status}`));
		const head = el.createDiv({ cls: 'snowflake-method-task-card-head' });
		const title = head.createDiv({ cls: 'snowflake-method-task-card-title', text: task.title });
		setTooltip(title, task.title);
		const actions = head.createDiv({ cls: 'snowflake-method-task-card-actions' });
		const restore = actions.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': t('taskBoard.restore') },
		});
		setIcon(restore, 'archive-restore');
		setTooltip(restore, t('taskBoard.restore'));
		restore.disabled = readOnly;
		restore.addEventListener('click', () => {
			act(bridge.restore(task.id));
		});
		const remove = actions.createEl('button', {
			cls: 'clickable-icon snowflake-method-task-delete',
			attr: { type: 'button', 'aria-label': t('actions.delete') },
		});
		setIcon(remove, 'trash-2');
		setTooltip(remove, t('actions.delete'));
		remove.disabled = readOnly;
		remove.addEventListener('click', () => {
			act(bridge.deleteTask(task.id));
		});
		const meta = el.createDiv({ cls: 'snowflake-method-task-card-meta' });
		prioritySpan(meta, task.priority);
		dueSpan(meta, task, current);
	};

	const clearMark = (): void => {
		mark?.removeClass('is-drop-before');
		mark = null;
	};
	const setMark = (el: HTMLElement): void => {
		if (mark === el) return;
		clearMark();
		mark = el;
		el.addClass('is-drop-before');
	};

	/**
	 * The lane body takes the drag: the mark moves from `dragover` alone,
	 * idempotently, since Chromium fires `dragleave` at every child edge,
	 * and the drop is worked out against the latest reading rather than the
	 * cards on screen.
	 */
	function wireDrop(lane: Lane): void {
		const manualCards = (): HTMLElement[] =>
			Array.from(lane.body.querySelectorAll<HTMLElement>('.snowflake-method-task-card')).filter(
				(el) =>
					el.getAttribute('data-origin') === 'manual' &&
					el.getAttribute('data-id') !== drag?.id,
			);
		lane.body.addEventListener('dragover', (event) => {
			if (drag === null) return;
			if (event.dataTransfer?.types.includes(TASK_DRAG_TYPE) !== true) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = 'move';
			const cards = manualCards();
			const midpoints = cards.map((el) => {
				const box = el.getBoundingClientRect();
				return box.top + box.height / 2;
			});
			setMark(cards[dropIndexAt(midpoints, event.clientY)] ?? lane.tail);
		});
		lane.body.addEventListener('drop', (event) => {
			const dragged = event.dataTransfer?.getData(TASK_DRAG_TYPE) ?? '';
			const landing = mark;
			clearMark();
			if (dragged.length === 0 || reading === null) return;
			if (!reading.tasks.some((task) => task.id === dragged && !task.archived)) return;
			event.preventDefault();
			const beforeId =
				landing === null || landing === lane.tail
					? null
					: landing.getAttribute('data-id');
			act(bridge.move(dragged, lane.status, beforeId === dragged ? null : beforeId));
		});
	}

	/** Brings one lane level with the cards it should show, in place. */
	const repaintLane = (lane: Lane, cards: readonly TaskCard[], current: TaskBoardReading): void => {
		const byId = new Map(cards.map((card) => [cardId(card), card] as const));
		const plan = planCardRepaint([...lane.cards.keys()], [...byId.keys()], []);
		for (const id of plan.remove) {
			lane.cards.get(id)?.el.remove();
			lane.cards.delete(id);
		}
		for (const id of plan.keep) {
			const entry = lane.cards.get(id);
			const card = byId.get(id);
			if (entry === undefined || card === undefined) continue;
			entry.card = card;
			dressCard(entry, current);
		}
		for (const id of plan.add) {
			const card = byId.get(id);
			if (card === undefined) continue;
			const entry: CardEntry = { el: lane.body.createDiv(), card };
			lane.cards.set(id, entry);
			wireCard(entry);
			dressCard(entry, current);
		}
		// Walked in order before the tail, which leaves them in that order.
		for (const id of plan.order) {
			const entry = lane.cards.get(id);
			if (entry !== undefined) lane.body.insertBefore(entry.el, lane.tail);
		}
		lane.count.setText(String(cards.length));
	};

	const repaintShelf = (archived: readonly Task[], current: TaskBoardReading): void => {
		const byId = new Map(archived.map((task) => [task.id, task] as const));
		const plan = planCardRepaint([...shelf.keys()], [...byId.keys()], []);
		for (const id of plan.remove) {
			shelf.get(id)?.remove();
			shelf.delete(id);
		}
		for (const id of plan.keep) {
			const el = shelf.get(id);
			const task = byId.get(id);
			if (el !== undefined && task !== undefined) fillArchivedCard(el, task, current);
		}
		for (const id of plan.add) {
			const task = byId.get(id);
			if (task === undefined) continue;
			const el = archiveGrid.createDiv();
			shelf.set(id, el);
			fillArchivedCard(el, task, current);
		}
		for (const id of plan.order) {
			const el = shelf.get(id);
			if (el !== undefined) archiveGrid.appendChild(el);
		}
	};

	const restoreScroll = (): void => {
		for (const lane of lanes.values()) {
			const top = scrolls.get(lane.status);
			if (top !== undefined && lane.body.scrollTop !== top) lane.body.scrollTop = top;
		}
		if (strip.scrollLeft !== stripScroll) strip.scrollLeft = stripScroll;
	};

	const paint = (): void => {
		if (loop.disposed) return;
		if (drag !== null) {
			paintOwed = true;
			return;
		}
		if (reading === null) {
			stateText.setText(
				t(
					loop.loading
						? 'taskBoard.loading'
						: loop.failed
							? 'taskBoard.loadFailed'
							: 'taskBoard.noProject',
				),
			);
			show(searchBox, false);
			show(filterButton, false);
			show(frame, false);
			show(archiveSection, false);
			show(emptyLine, false);
			addButton.disabled = true;
			return;
		}
		readOnly = reading.readOnly;
		addButton.disabled = readOnly;
		const cards = taskCards(reading.tasks, reading.derived);
		const context = filterContext(reading);
		const shown = filterTaskCards(cards, memory.query, memory, context);
		const columns = columnsOf(shown);
		for (const lane of lanes.values()) repaintLane(lane, columns[lane.status], reading);
		show(searchBox, cards.length > 0);
		show(filterButton, cards.length > 0);
		stateText.setText(
			reading.derivedFailed
				? t('taskBoard.derivedFailed')
				: shown.length === cards.length
					? ''
					: t('table.filteredCount', { shown: shown.length, total: cards.length }),
		);
		show(frame, true);
		const emptyKey =
			cards.length === 0
				? 'taskBoard.empty'
				: shown.length === 0
					? 'taskBoard.noMatch'
					: null;
		show(emptyLine, emptyKey !== null);
		if (emptyKey !== null) emptyText.setText(t(emptyKey));
		const archived = reading.tasks.filter((task) => task.archived);
		const shelved = filterArchivedTasks(archived, memory.archive.query, memory.archive, context);
		show(archiveSection, true);
		archiveCount.setText(String(archived.length));
		emptyButton.disabled = readOnly || archived.length === 0;
		repaintShelf(shelved, reading);
		archiveState.setText(
			shelved.length === archived.length
				? ''
				: t('table.filteredCount', { shown: shelved.length, total: archived.length }),
		);
		show(archiveGrid, shelved.length > 0);
		show(archiveEmpty, shelved.length === 0);
		if (shelved.length === 0) {
			archiveEmptyText.setText(
				t(archived.length === 0 ? 'taskBoard.archiveEmpty' : 'taskBoard.archiveNoMatch'),
			);
		}
		restoreScroll();
	};

	const loop = refreshLoop<TaskBoardReading | null>({
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
	const unsubscribe = bridge.subscribe(() => {
		loop.refresh();
	});
	// Midnight sends no event: the day is asked for once a minute, and a new
	// one re-reads, so goal cards and overdue marks turn with the calendar.
	const dayWatch = root.win.setInterval(() => {
		if (reading !== null && bridge.today() !== reading.today) loop.refresh();
	}, DAY_WATCH_MS);
	refreshButton.addEventListener('click', () => {
		loop.refresh();
	});
	addButton.addEventListener('click', () => {
		void bridge.add().catch(() => undefined);
	});
	loop.refresh();

	return {
		refresh: () => {
			restoreScroll();
			loop.refresh();
		},
		dispose: () => {
			controls.popover.closeFilter();
			root.win.clearInterval(dayWatch);
			loop.dispose();
			unsubscribe();
			root.remove();
		},
	};
}
