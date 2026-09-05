/**
 * Tasks: the author's own to-do items, kept on the Kanban of a project's
 * task management beside the cards the plugin derives from its other
 * records.
 *
 * A manual task is one record -- a title, a note about it, where it stands
 * in the workflow, how pressing it is, when it is due, the entities it is
 * about -- and the project's task file holds them in the order the board
 * shows them: a column reads its tasks off the array as they come, so
 * moving a card is moving a record, and nothing numbers them. What this
 * module knows is that record: how it is read leniently from a file an
 * author may have edited by hand, how a move is worked out against a
 * neighbour rather than a position, and the rules every derived card is
 * computed by, which are never written anywhere.
 */

import { type EntityRef, isEntityRef } from './foreshadowing';

/** Where a task stands in the workflow, in column order. */
export const TASK_STATUSES = [
	'todo',
	'in-progress',
	'blocked',
	'in-review',
	'done',
	'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const DEFAULT_TASK_STATUS: TaskStatus = 'todo';

export function isTaskStatus(value: unknown): value is TaskStatus {
	return (TASK_STATUSES as readonly unknown[]).includes(value);
}

/** How pressing a task is, lowest first. */
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const DEFAULT_TASK_PRIORITY: TaskPriority = 'medium';

export function isTaskPriority(value: unknown): value is TaskPriority {
	return (TASK_PRIORITIES as readonly unknown[]).includes(value);
}

export interface Task {
	id: string;
	title: string;
	description: string;
	status: TaskStatus;
	priority: TaskPriority;
	/** A calendar day, `YYYY-MM-DD`, or null when the task has none. */
	dueDate: string | null;
	related: EntityRef[];
	/** Set aside without leaving the file: an archived task keeps its place. */
	archived: boolean;
	createdAt: number;
	/** Bumped by an author's edit or a change of column; a reorder never touches it. */
	updatedAt: number;
}

/** The limbs a form hands back: everything but what the record keeps for itself. */
export type TaskEdit = Pick<
	Task,
	'title' | 'description' | 'status' | 'priority' | 'dueDate' | 'related'
>;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A `YYYY-MM-DD` naming a day the calendar has. */
export function isTaskDay(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const match = DAY_PATTERN.exec(value);
	if (match === null) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

const refOf = (ref: EntityRef): EntityRef => ({
	kind: ref.kind,
	id: ref.id,
	name: ref.name,
});

const finiteOrZero = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * One stored entry read leniently: the id, the title and a status this build
 * knows must hold, and the rest is read as far as it goes -- an unknown
 * priority reads as the default, a due date that is not a day as none, a
 * related ref that will not read is dropped. Answers null where the task
 * itself will not read, and the store sets that entry aside as a stray: a
 * status this build has never heard of is a newer build's, and reading it
 * as any column would move the task somewhere its author never put it.
 */
export function readTask(value: unknown): Task | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	if (typeof entry.id !== 'string' || entry.id.length === 0) return null;
	if (typeof entry.title !== 'string') return null;
	if (!isTaskStatus(entry.status)) return null;
	return {
		id: entry.id,
		title: entry.title,
		description: typeof entry.description === 'string' ? entry.description : '',
		status: entry.status,
		priority: isTaskPriority(entry.priority)
			? entry.priority
			: DEFAULT_TASK_PRIORITY,
		dueDate: isTaskDay(entry.dueDate) ? entry.dueDate : null,
		related: Array.isArray(entry.related)
			? entry.related.filter(isEntityRef).map(refOf)
			: [],
		archived: entry.archived === true,
		createdAt: finiteOrZero(entry.createdAt),
		updatedAt: finiteOrZero(entry.updatedAt),
	};
}

const sameRef = (left: EntityRef, right: EntityRef): boolean =>
	left.kind === right.kind && left.id === right.id && left.name === right.name;

/** Whether a form's answer changes anything, so a Save that changes nothing writes nothing. */
export function sameTaskEdit(kept: Task, next: TaskEdit): boolean {
	return (
		kept.title === next.title &&
		kept.description === next.description &&
		kept.status === next.status &&
		kept.priority === next.priority &&
		kept.dueDate === next.dueDate &&
		kept.related.length === next.related.length &&
		kept.related.every((ref, index) => {
			const other = next.related[index];
			return other !== undefined && sameRef(ref, other);
		})
	);
}

/** A task past its day and still open: a look the board gives it, never a status. */
export function taskOverdue(
	task: Pick<Task, 'dueDate' | 'status'>,
	today: string,
): boolean {
	if (task.dueDate === null) return false;
	if (task.status === 'done' || task.status === 'cancelled') return false;
	return task.dueDate < today;
}

export function partitionTasks<T extends { archived: boolean }>(
	tasks: readonly T[],
): { active: T[]; archived: T[] } {
	const active: T[] = [];
	const archived: T[] = [];
	for (const task of tasks) (task.archived ? archived : active).push(task);
	return { active, archived };
}

/**
 * One task moved to a column, in front of a neighbour: the record is taken
 * out of the array and put back immediately before the named active task of
 * that column, or after the column's last active task when no neighbour is
 * named -- or when the one named has gone, been archived or moved on since
 * the board was painted, because a drop is worked out against the file as it
 * is when the write runs, not as it looked. A column with no task yet takes
 * it at the end of the array. A change of column stamps `updatedAt`; a
 * reorder is not news about the task. Answers null where nothing would
 * move, so the store writes nothing, and null for an id the file does not
 * hold.
 */
export function moveTaskBefore(
	tasks: readonly Task[],
	id: string,
	status: TaskStatus,
	beforeId: string | null,
	now: number,
): Task[] | null {
	const moving = tasks.find((task) => task.id === id);
	if (moving === undefined) return null;
	const rest = tasks.filter((task) => task.id !== id);
	const column = rest.filter(
		(task) => task.status === status && !task.archived,
	);
	const anchor =
		beforeId === null
			? undefined
			: column.find((task) => task.id === beforeId);
	let insertAt: number;
	if (anchor !== undefined) {
		insertAt = rest.indexOf(anchor);
	} else {
		const last = column[column.length - 1];
		insertAt = last === undefined ? rest.length : rest.indexOf(last) + 1;
	}
	const moved: Task =
		moving.status === status ? moving : { ...moving, status, updatedAt: now };
	const next = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
	if (moved === moving && next.every((task, index) => task === tasks[index])) {
		return null;
	}
	return next;
}

// --- derived cards ----------------------------------------------------------

/** The cards the plugin derives, in the order a column shows them. */
export const DERIVED_TASK_KEYS = [
	'dailyGoal',
	'weeklyGoal',
	'monthlyGoal',
	'unresolvedMentions',
	'sensitiveWords',
	'openForeshadowings',
	'unresolvedForeshadowings',
	'pendingRevisions',
	'unresolvedRevisions',
	'stickyNotes',
] as const;
export type DerivedTaskKey = (typeof DERIVED_TASK_KEYS)[number];

/** What the sources say at one reading; every number is the source tab's own. */
export interface DerivedTaskSources {
	/** Net words a day is aimed at; 0 turns the goal cards off. */
	dailyGoal: number;
	/** Net words written towards the goal today, this week and this month. */
	goalNet: { day: number; week: number; month: number };
	/** How many days this month holds, so its target is honest about the month it is. */
	daysInMonth: number;
	unresolvedMentions: number;
	sensitiveWords: number;
	openForeshadowings: number;
	unresolvedForeshadowings: number;
	pendingRevisions: number;
	unresolvedRevisions: number;
	stickyNotes: number;
}

export interface DerivedTask {
	key: DerivedTaskKey;
	status: TaskStatus;
	/** How many the source reports, on an issue card; null on a goal card. */
	count: number | null;
	/** Where the writing stands against the target, on a goal card; null on an issue card. */
	progress: { net: number; goal: number } | null;
}

/** Where a goal stands: nothing yet, under way, or reached. */
export function goalStatus(net: number, goal: number): TaskStatus {
	if (net <= 0) return 'todo';
	return net < goal ? 'in-progress' : 'done';
}

/**
 * The derived cards of one reading. A goal card is there while a goal is
 * set, and it says where the period stands: a period reached stays Done
 * until the period ends, and the next period is computed afresh. An issue
 * card is there while its source has something to show, and goes when the
 * count reaches nothing: it never passes through the columns between.
 */
export function deriveTasks(sources: DerivedTaskSources): DerivedTask[] {
	const cards: DerivedTask[] = [];
	if (sources.dailyGoal > 0) {
		const goals: [DerivedTaskKey, number, number][] = [
			['dailyGoal', sources.goalNet.day, sources.dailyGoal],
			['weeklyGoal', sources.goalNet.week, sources.dailyGoal * 7],
			[
				'monthlyGoal',
				sources.goalNet.month,
				sources.dailyGoal * sources.daysInMonth,
			],
		];
		for (const [key, net, goal] of goals) {
			cards.push({
				key,
				status: goalStatus(net, goal),
				count: null,
				progress: { net, goal },
			});
		}
	}
	const issues: [DerivedTaskKey, number][] = [
		['unresolvedMentions', sources.unresolvedMentions],
		['sensitiveWords', sources.sensitiveWords],
		['openForeshadowings', sources.openForeshadowings],
		['unresolvedForeshadowings', sources.unresolvedForeshadowings],
		['pendingRevisions', sources.pendingRevisions],
		['unresolvedRevisions', sources.unresolvedRevisions],
		['stickyNotes', sources.stickyNotes],
	];
	for (const [key, count] of issues) {
		if (count > 0) cards.push({ key, status: 'todo', count, progress: null });
	}
	return cards;
}
