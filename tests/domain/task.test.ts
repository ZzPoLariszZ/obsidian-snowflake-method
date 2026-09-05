import { describe, expect, it } from 'vitest';

import {
	DEFAULT_TASK_PRIORITY,
	DERIVED_TASK_KEYS,
	TASK_PRIORITIES,
	TASK_STATUSES,
	deriveTasks,
	goalNetSince,
	goalStatus,
	isTaskDay,
	isTaskPriority,
	isTaskStatus,
	moveTaskBefore,
	partitionTasks,
	readTask,
	sameTaskEdit,
	taskOverdue,
	type DerivedTaskSources,
	type Task,
} from '../../src/domain';

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
	id,
	title: id,
	description: '',
	status: 'todo',
	priority: 'medium',
	dueDate: null,
	related: [],
	archived: false,
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

const sources = (
	overrides: Partial<DerivedTaskSources> = {},
): DerivedTaskSources => ({
	dailyGoal: 0,
	goalNet: { day: 0, week: 0, month: 0 },
	daysInMonth: 30,
	unresolvedMentions: 0,
	sensitiveWords: 0,
	openForeshadowings: 0,
	unresolvedForeshadowings: 0,
	pendingRevisions: 0,
	unresolvedRevisions: 0,
	stickyNotes: 0,
	...overrides,
});

describe('the task vocabularies', () => {
	it('names six columns and four priorities, and guards both', () => {
		expect(TASK_STATUSES).toEqual([
			'todo',
			'in-progress',
			'blocked',
			'in-review',
			'done',
			'cancelled',
		]);
		expect(TASK_PRIORITIES).toEqual(['low', 'medium', 'high', 'urgent']);
		expect(DEFAULT_TASK_PRIORITY).toBe('medium');
		expect(isTaskStatus('blocked')).toBe(true);
		expect(isTaskStatus('open')).toBe(false);
		expect(isTaskPriority('urgent')).toBe(true);
		expect(isTaskPriority('')).toBe(false);
	});

	it('knows a calendar day from a string that only looks like one', () => {
		expect(isTaskDay('2026-09-05')).toBe(true);
		expect(isTaskDay('2024-02-29')).toBe(true);
		expect(isTaskDay('2026-02-30')).toBe(false);
		expect(isTaskDay('2026-13-01')).toBe(false);
		expect(isTaskDay('2026-9-5')).toBe(false);
		expect(isTaskDay('')).toBe(false);
		expect(isTaskDay(20260905)).toBe(false);
	});
});

describe('reading stored tasks', () => {
	const stored = {
		id: 'task-1',
		title: 'Fix the ferry scene',
		description: 'The tide is wrong.',
		status: 'in-review',
		priority: 'high',
		dueDate: '2026-09-10',
		related: [{ kind: 'scene', id: 'scene-9', name: 'The ferry' }],
		archived: false,
		createdAt: 10,
		updatedAt: 20,
	};

	it('accepts what the service writes', () => {
		expect(readTask(stored)).toEqual(stored);
	});

	it('refuses an entry without an id, a title or a known status', () => {
		expect(readTask({ ...stored, id: '' })).toBeNull();
		expect(readTask({ ...stored, title: 7 })).toBeNull();
		expect(readTask({ ...stored, status: 'open' })).toBeNull();
		expect(readTask(null)).toBeNull();
		expect(readTask('task')).toBeNull();
	});

	it('reads the rest as far as it goes', () => {
		const read = readTask({
			id: 'task-2',
			title: 'Bare',
			status: 'todo',
			priority: 'critical',
			dueDate: 'next week',
			related: [
				{ kind: 'character', id: 'character-1', name: 'Ann', extra: true },
				{ kind: '', id: 'x', name: 'y' },
				'nothing',
			],
			archived: 'true',
			createdAt: 'yesterday',
		});
		expect(read).toEqual({
			id: 'task-2',
			title: 'Bare',
			description: '',
			status: 'todo',
			priority: 'medium',
			dueDate: null,
			related: [{ kind: 'character', id: 'character-1', name: 'Ann' }],
			archived: false,
			createdAt: 0,
			updatedAt: 0,
		});
	});

	it('keeps a missing entity by its stored name', () => {
		const read = readTask({
			...stored,
			related: [{ kind: 'character', id: 'character-gone', name: 'Old name' }],
		});
		expect(read?.related).toEqual([
			{ kind: 'character', id: 'character-gone', name: 'Old name' },
		]);
	});
});

describe('what an edit changes', () => {
	const kept = task('a', {
		description: 'd',
		dueDate: '2026-09-10',
		related: [{ kind: 'scene', id: 's', name: 'S' }],
	});
	const edit = {
		title: 'a',
		description: 'd',
		status: 'todo' as const,
		priority: 'medium' as const,
		dueDate: '2026-09-10',
		related: [{ kind: 'scene', id: 's', name: 'S' }],
	};

	it('is nothing when every limb is the same', () => {
		expect(sameTaskEdit(kept, edit)).toBe(true);
	});

	it('is something when any limb moved, the related names included', () => {
		expect(sameTaskEdit(kept, { ...edit, title: 'b' })).toBe(false);
		expect(sameTaskEdit(kept, { ...edit, priority: 'low' })).toBe(false);
		expect(sameTaskEdit(kept, { ...edit, dueDate: null })).toBe(false);
		expect(sameTaskEdit(kept, { ...edit, related: [] })).toBe(false);
		expect(
			sameTaskEdit(kept, {
				...edit,
				related: [{ kind: 'scene', id: 's', name: 'Renamed' }],
			}),
		).toBe(false);
	});
});

describe('overdue', () => {
	const today = '2026-09-05';

	it('is a task past its day and still open', () => {
		expect(taskOverdue(task('a', { dueDate: '2026-09-04' }), today)).toBe(true);
		expect(taskOverdue(task('a', { dueDate: '2026-09-05' }), today)).toBe(false);
		expect(taskOverdue(task('a', { dueDate: '2026-09-06' }), today)).toBe(false);
		expect(taskOverdue(task('a'), today)).toBe(false);
	});

	it('never marks a task that is done or cancelled', () => {
		expect(
			taskOverdue(task('a', { dueDate: '2026-01-01', status: 'done' }), today),
		).toBe(false);
		expect(
			taskOverdue(
				task('a', { dueDate: '2026-01-01', status: 'cancelled' }),
				today,
			),
		).toBe(false);
		expect(
			taskOverdue(task('a', { dueDate: '2026-01-01', status: 'blocked' }), today),
		).toBe(true);
	});
});

describe('partitioning', () => {
	it('splits the archived tasks off, keeping the order of both', () => {
		const tasks = [
			task('a'),
			task('b', { archived: true }),
			task('c'),
			task('d', { archived: true }),
		];
		const { active, archived } = partitionTasks(tasks);
		expect(active.map((entry) => entry.id)).toEqual(['a', 'c']);
		expect(archived.map((entry) => entry.id)).toEqual(['b', 'd']);
	});
});

describe('moving a task', () => {
	const board = (): Task[] => [
		task('t1'),
		task('p1', { status: 'in-progress' }),
		task('t2'),
		task('t3'),
		task('b1', { status: 'blocked' }),
		task('shelved', { status: 'in-progress', archived: true }),
	];
	const ids = (tasks: readonly Task[] | null): string[] =>
		(tasks ?? []).map((entry) => entry.id);

	it('puts the task before the named neighbour of its own column', () => {
		expect(ids(moveTaskBefore(board(), 't3', 'todo', 't1', 99))).toEqual([
			't3',
			't1',
			'p1',
			't2',
			'b1',
			'shelved',
		]);
		expect(ids(moveTaskBefore(board(), 't1', 'todo', 't3', 99))).toEqual([
			'p1',
			't2',
			't1',
			't3',
			'b1',
			'shelved',
		]);
	});

	it('leaves updatedAt alone on a reorder', () => {
		const moved = moveTaskBefore(board(), 't3', 'todo', 't1', 99);
		expect(moved?.find((entry) => entry.id === 't3')?.updatedAt).toBe(1);
	});

	it('changes the column and stamps updatedAt across columns', () => {
		const moved = moveTaskBefore(board(), 't2', 'in-progress', 'p1', 99);
		expect(ids(moved)).toEqual(['t1', 't2', 'p1', 't3', 'b1', 'shelved']);
		expect(moved?.find((entry) => entry.id === 't2')).toMatchObject({
			status: 'in-progress',
			updatedAt: 99,
		});
	});

	it('lands after the last active task of the column when no neighbour is named', () => {
		expect(ids(moveTaskBefore(board(), 't1', 'in-progress', null, 99))).toEqual([
			'p1',
			't1',
			't2',
			't3',
			'b1',
			'shelved',
		]);
		// The empty column takes it at the end of the array.
		expect(ids(moveTaskBefore(board(), 't1', 'done', null, 99))).toEqual([
			'p1',
			't2',
			't3',
			'b1',
			'shelved',
			't1',
		]);
	});

	it('falls back to the end of the column for a neighbour that is gone, archived or elsewhere', () => {
		const end = ['p1', 't2', 't3', 't1', 'b1', 'shelved'];
		expect(ids(moveTaskBefore(board(), 't1', 'todo', 'missing', 99))).toEqual(end);
		expect(ids(moveTaskBefore(board(), 't1', 'in-progress', 'shelved', 99))).toEqual([
			'p1',
			't1',
			't2',
			't3',
			'b1',
			'shelved',
		]);
		expect(ids(moveTaskBefore(board(), 't1', 'todo', 'b1', 99))).toEqual(end);
	});

	it('answers null for an unknown id and for a move that changes nothing', () => {
		expect(moveTaskBefore(board(), 'nobody', 'todo', null, 99)).toBeNull();
		expect(moveTaskBefore(board(), 't3', 'todo', null, 99)).toBeNull();
		expect(moveTaskBefore(board(), 't2', 'todo', 't3', 99)).toBeNull();
	});

	it('leaves the input alone', () => {
		const before = board();
		const snapshot = ids(before);
		moveTaskBefore(before, 't3', 'todo', 't1', 99);
		expect(ids(before)).toEqual(snapshot);
	});
});

describe('derived cards', () => {
	it('shows no goal card without a goal, and no issue card at nothing', () => {
		expect(deriveTasks(sources())).toEqual([]);
	});

	it('reads a goal card against the day, the week and the month', () => {
		const cards = deriveTasks(
			sources({
				dailyGoal: 1000,
				goalNet: { day: 0, week: 2500, month: 31000 },
				daysInMonth: 31,
			}),
		);
		expect(cards).toEqual([
			{ key: 'dailyGoal', status: 'todo', count: null, progress: { net: 0, goal: 1000 } },
			{ key: 'weeklyGoal', status: 'in-progress', count: null, progress: { net: 2500, goal: 7000 } },
			{ key: 'monthlyGoal', status: 'done', count: null, progress: { net: 31000, goal: 31000 } },
		]);
	});

	it('shows an issue card in To do while its count stands, in the fixed order', () => {
		const cards = deriveTasks(
			sources({
				dailyGoal: 500,
				stickyNotes: 2,
				unresolvedMentions: 3,
				sensitiveWords: 1,
				openForeshadowings: 4,
				unresolvedForeshadowings: 1,
				pendingRevisions: 6,
				unresolvedRevisions: 2,
			}),
		);
		expect(cards.map((card) => card.key)).toEqual([...DERIVED_TASK_KEYS]);
		expect(cards.slice(3).every((card) => card.status === 'todo')).toBe(true);
		expect(cards.find((card) => card.key === 'pendingRevisions')).toEqual({
			key: 'pendingRevisions',
			status: 'todo',
			count: 6,
			progress: null,
		});
	});

	it('places a goal by its net words', () => {
		expect(goalStatus(-40, 1000)).toBe('todo');
		expect(goalStatus(0, 1000)).toBe('todo');
		expect(goalStatus(1, 1000)).toBe('in-progress');
		expect(goalStatus(999, 1000)).toBe('in-progress');
		expect(goalStatus(1000, 1000)).toBe('done');
		expect(goalStatus(1400, 1000)).toBe('done');
	});

	it('adds a stretch up from the day it starts', () => {
		const history = [
			{ day: '2026-08-31', goalNet: 100 },
			{ day: '2026-09-01', goalNet: 200 },
			{ day: '2026-09-02', goalNet: -50 },
		];
		expect(goalNetSince(history, '2026-09-01')).toBe(150);
		expect(goalNetSince(history, '2026-08-01')).toBe(250);
		expect(goalNetSince(history, '2026-09-03')).toBe(0);
		expect(goalNetSince([], '2026-09-01')).toBe(0);
	});
});
