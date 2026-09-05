import {
	DERIVED_TASK_KEYS,
	TASK_STATUSES,
	taskOverdue,
	type DerivedTask,
	type DerivedTaskKey,
	type Task,
	type TaskPriority,
	type TaskStatus,
} from '../domain';
import type { TaskNavigationTarget } from './task-bridge';

/**
 * The pure half of the task board: the cards shaped from the store and the
 * derived readings, the search and the funnel over them, the columns they
 * fall into, and the arithmetic of a drop. Nothing here touches the DOM, so
 * all of it runs under the node test runtime; the board beside it only
 * draws.
 */

/** One card of the board: a task the author wrote, or one the plugin derived. */
export type TaskCard =
	| { origin: 'manual'; task: Task }
	| { origin: 'derived'; derived: DerivedTask };

export const TASK_DUE_FILTERS = ['overdue', 'today', 'week', 'none'] as const;
export type TaskDueFilter = (typeof TASK_DUE_FILTERS)[number];

export function isTaskDueFilter(value: unknown): value is TaskDueFilter {
	return (TASK_DUE_FILTERS as readonly unknown[]).includes(value);
}

/** The funnel's questions; '' means one is not being asked. */
export interface TaskBoardFilters {
	origin: '' | 'manual' | 'derived';
	priority: '' | TaskPriority;
	due: '' | TaskDueFilter;
}

/** The two questions the board's funnel and the archive's both ask. */
export type SharedTaskFilters = Pick<TaskBoardFilters, 'priority' | 'due'>;

/** The archive's own questions: the shared two and the column a task left, never the origin, since every set-aside task is the author's. */
export interface ArchiveFilters extends SharedTaskFilters {
	/** The column a task left; '' when not asked. */
	status: '' | TaskStatus;
}

/** What the archive remembers: its search and its funnel. */
export interface ArchiveMemory extends ArchiveFilters {
	query: string;
}

/** What the board remembers across rebuilds: its search, its funnel, and the archive's, and whether the archive is open. */
export interface TaskBoardMemory extends TaskBoardFilters {
	query: string;
	archiveOpen: boolean;
	archive: ArchiveMemory;
}

export const taskBoardMemory = (): TaskBoardMemory => ({
	query: '',
	origin: '',
	priority: '',
	due: '',
	archiveOpen: false,
	archive: { query: '', status: '', priority: '', due: '' },
});

/** What the search reads a card by, in the reader's own words. */
export interface TaskFilterContext {
	today: string;
	/** The current week, first day through last. */
	week: { from: string; to: string };
	labels: {
		derived: (key: DerivedTaskKey) => string;
		priority: (priority: TaskPriority) => string;
	};
	/** The names a task's related entities go by now. */
	relatedNames: (task: Task) => string[];
}

/** The cards of one reading: the derived ones, then every task not set aside. */
export function taskCards(
	tasks: readonly Task[],
	derived: readonly DerivedTask[],
): TaskCard[] {
	return [
		...derived.map((entry): TaskCard => ({ origin: 'derived', derived: entry })),
		...tasks
			.filter((task) => !task.archived)
			.map((task): TaskCard => ({ origin: 'manual', task })),
	];
}

const dueAnswers = (
	task: Task,
	due: TaskDueFilter,
	context: TaskFilterContext,
): boolean => {
	switch (due) {
		case 'overdue':
			return taskOverdue(task, context.today);
		case 'today':
			return task.dueDate === context.today;
		case 'week':
			return (
				task.dueDate !== null &&
				task.dueDate >= context.week.from &&
				task.dueDate <= context.week.to
			);
		case 'none':
			return task.dueDate === null;
	}
};

/**
 * The search and the funnel together. Every word typed has to be found in
 * what the card shows -- a task's title, its description, the names it is
 * about and its priority; a derived card's label. A funnel question a
 * derived card has no field to answer drops it: a filter on priority, on a
 * due date or on an entity is a filter over the author's own tasks.
 */
export function filterTaskCards(
	cards: readonly TaskCard[],
	query: string,
	filters: TaskBoardFilters,
	context: TaskFilterContext,
): TaskCard[] {
	const terms = query
		.split(/\s+/u)
		.map((term) => term.trim().toLocaleLowerCase())
		.filter((term) => term.length > 0);
	const holds = (text: string): boolean => {
		const haystack = text.toLocaleLowerCase();
		return terms.every((term) => haystack.includes(term));
	};
	return cards.filter((card) => {
		if (filters.origin !== '' && card.origin !== filters.origin) return false;
		if (card.origin === 'derived') {
			if (filters.priority !== '' || filters.due !== '') return false;
			return holds(context.labels.derived(card.derived.key));
		}
		const task = card.task;
		if (filters.priority !== '' && task.priority !== filters.priority) return false;
		if (filters.due !== '' && !dueAnswers(task, filters.due, context)) return false;
		return holds(
			[
				task.title,
				task.description,
				...context.relatedNames(task),
				context.labels.priority(task.priority),
			].join('\n'),
		);
	});
}

/**
 * The cards of each column: the derived ones first, in the fixed order the
 * plugin lists them, then the author's in the order the file holds them.
 */
export function columnsOf(cards: readonly TaskCard[]): Record<TaskStatus, TaskCard[]> {
	const columns = {} as Record<TaskStatus, TaskCard[]>;
	for (const status of TASK_STATUSES) columns[status] = [];
	const rank = (card: TaskCard): number =>
		card.origin === 'derived' ? DERIVED_TASK_KEYS.indexOf(card.derived.key) : -1;
	const derived = cards
		.filter((card) => card.origin === 'derived')
		.sort((left, right) => rank(left) - rank(right));
	for (const card of derived) columns[card.derived.status].push(card);
	for (const card of cards) {
		if (card.origin !== 'manual' || card.task.archived) continue;
		columns[card.task.status].push(card);
	}
	return columns;
}

/**
 * Where a drop lands among the cards a column shows, from where the pointer
 * is: before the first card whose middle is below it, or after them all.
 * The midpoints come in the column's own order.
 */
export function dropIndexAt(midpoints: readonly number[], y: number): number {
	const index = midpoints.findIndex((midpoint) => midpoint > y);
	return index === -1 ? midpoints.length : index;
}

/** Where a derived card opens: its source tab, narrowed to what the card counts. */
export function derivedTaskTarget(key: DerivedTaskKey): TaskNavigationTarget {
	switch (key) {
		case 'dailyGoal':
		case 'weeklyGoal':
		case 'monthlyGoal':
			return { kind: 'sessions' };
		case 'unresolvedMentions':
			return { kind: 'tracking', section: 'unresolved' };
		case 'sensitiveWords':
			return { kind: 'tracking', section: 'sensitive' };
		case 'openForeshadowings':
			return { kind: 'foreshadowing', status: ['planned', 'active'], standing: '' };
		case 'unresolvedForeshadowings':
			return { kind: 'foreshadowing', status: [], standing: 'unresolved' };
		case 'pendingRevisions':
			return { kind: 'revision', standing: '' };
		case 'unresolvedRevisions':
			return { kind: 'revision', standing: 'conflict' };
		case 'stickyNotes':
			return { kind: 'stickyNotes' };
	}
}

/** The set-aside tasks the archive's search and funnel leave, in their stored order. */
export function filterArchivedTasks(
	tasks: readonly Task[],
	query: string,
	filters: ArchiveFilters,
	context: TaskFilterContext,
): Task[] {
	const cards: TaskCard[] = tasks
		.filter((task) => task.archived && (filters.status === '' || task.status === filters.status))
		.map((task) => ({ origin: 'manual', task }));
	const asked: TaskBoardFilters = { origin: 'manual', priority: filters.priority, due: filters.due };
	return filterTaskCards(cards, query, asked, context).flatMap((card) =>
		card.origin === 'manual' ? [card.task] : [],
	);
}
