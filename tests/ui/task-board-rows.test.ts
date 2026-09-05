import { describe, expect, it } from 'vitest';

import { DERIVED_TASK_KEYS, type DerivedTask, type Task } from '../../src/domain';
import {
	columnsOf,
	derivedTaskTarget,
	dropIndexAt,
	filterArchivedTasks,
	filterTaskCards,
	taskBoardMemory,
	taskCards,
	type TaskBoardFilters,
	type TaskCard,
	type TaskFilterContext,
} from '../../src/ui/task-board-rows';

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
	id,
	title: `Task ${id}`,
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

const derived = (
	key: DerivedTask['key'],
	overrides: Partial<DerivedTask> = {},
): DerivedTask => ({
	key,
	status: 'todo',
	count: 1,
	progress: null,
	...overrides,
});

const none: TaskBoardFilters = { origin: '', priority: '', due: '' };

const context: TaskFilterContext = {
	today: '2026-09-05',
	week: { from: '2026-08-31', to: '2026-09-06' },
	labels: {
		derived: (key) => `derived:${key}`,
		priority: (priority) => `priority:${priority}`,
	},
	relatedNames: (entry) => entry.related.map((ref) => `now:${ref.name}`),
};

const ids = (cards: readonly TaskCard[]): string[] =>
	cards.map((card) => (card.origin === 'manual' ? card.task.id : card.derived.key));

describe('the cards of a reading', () => {
	it('puts the derived cards first and leaves the archived tasks out', () => {
		const cards = taskCards(
			[task('a'), task('b', { archived: true }), task('c')],
			[derived('stickyNotes')],
		);
		expect(ids(cards)).toEqual(['stickyNotes', 'a', 'c']);
	});

	it('remembers nothing until asked', () => {
		expect(taskBoardMemory()).toEqual({
			query: '',
			origin: '',
			priority: '',
			due: '',
			archiveOpen: false,
			archive: { query: '', status: '', priority: '', due: '' },
		});
	});
});

describe('searching and filtering the board', () => {
	const cards = (): TaskCard[] =>
		taskCards(
			[
				task('ferry', {
					title: 'Fix the ferry scene',
					description: 'The tide is wrong.',
					priority: 'urgent',
					dueDate: '2026-09-04',
					related: [{ kind: 'scene', id: 'scene-9', name: 'Old ferry name' }],
				}),
				task('today', { dueDate: '2026-09-05', priority: 'low' }),
				task('week', { dueDate: '2026-09-06', status: 'blocked' }),
				task('later', { dueDate: '2026-10-01', status: 'done' }),
				task('bare', { status: 'in-review' }),
			],
			[derived('sensitiveWords', { count: 3 }), derived('dailyGoal', { status: 'done' })],
		);

	it('keeps everything while nothing is asked', () => {
		expect(ids(filterTaskCards(cards(), '  ', none, context))).toEqual([
			'sensitiveWords',
			'dailyGoal',
			'ferry',
			'today',
			'week',
			'later',
			'bare',
		]);
	});

	it('finds a task by what the reader can see, every word required', () => {
		const by = (query: string): string[] =>
			ids(filterTaskCards(cards(), query, none, context));
		expect(by('ferry')).toEqual(['ferry']);
		expect(by('TIDE wrong')).toEqual(['ferry']);
		expect(by('tide calm')).toEqual([]);
		// The related name a task shows is the entity's current one, not the stored one.
		expect(by('now:old')).toEqual(['ferry']);
		expect(by('priority:urgent')).toEqual(['ferry']);
		expect(by('derived:sensitive')).toEqual(['sensitiveWords']);
	});

	it('narrows by origin', () => {
		expect(ids(filterTaskCards(cards(), '', { ...none, origin: 'derived' }, context))).toEqual([
			'sensitiveWords',
			'dailyGoal',
		]);
		expect(ids(filterTaskCards(cards(), '', { ...none, origin: 'manual' }, context))).toEqual([
			'ferry',
			'today',
			'week',
			'later',
			'bare',
		]);
	});

	it('a question a derived card cannot answer drops it', () => {
		expect(ids(filterTaskCards(cards(), '', { ...none, priority: 'urgent' }, context))).toEqual([
			'ferry',
		]);
		expect(ids(filterTaskCards(cards(), '', { ...none, due: 'none' }, context))).toEqual(['bare']);
	});

	it('reads a due date against the day and the week', () => {
		const due = (filter: TaskBoardFilters['due']): string[] =>
			ids(filterTaskCards(cards(), '', { ...none, due: filter }, context));
		expect(due('overdue')).toEqual(['ferry']);
		expect(due('today')).toEqual(['today']);
		expect(due('week')).toEqual(['ferry', 'today', 'week']);
		expect(due('none')).toEqual(['bare']);
	});

	it('composes the questions and leaves its input alone', () => {
		const input = cards();
		const before = JSON.stringify(input);
		expect(
			ids(
				filterTaskCards(
					input,
					'task',
					{ ...none, origin: 'manual', due: 'week', priority: 'low' },
					context,
				),
			),
		).toEqual(['today']);
		expect(JSON.stringify(input)).toBe(before);
	});
});

describe('the columns', () => {
	it('lays the derived cards first in the fixed order, then the tasks as the file holds them', () => {
		const columns = columnsOf(
			taskCards(
				[
					task('c', { status: 'done' }),
					task('a'),
					task('b'),
					task('shelved', { archived: true }),
				],
				[
					derived('stickyNotes'),
					derived('unresolvedMentions'),
					derived('dailyGoal', { status: 'done' }),
				],
			),
		);
		expect(ids(columns.todo)).toEqual(['unresolvedMentions', 'stickyNotes', 'a', 'b']);
		expect(ids(columns.done)).toEqual(['dailyGoal', 'c']);
		expect(ids(columns['in-progress'])).toEqual([]);
		expect(ids(columns.blocked)).toEqual([]);
		expect(ids(columns['in-review'])).toEqual([]);
		expect(ids(columns.cancelled)).toEqual([]);
	});
});

describe('where a drop lands', () => {
	it('is before the first card whose middle is below the pointer, else after them all', () => {
		expect(dropIndexAt([], 10)).toBe(0);
		expect(dropIndexAt([20, 60, 100], 5)).toBe(0);
		expect(dropIndexAt([20, 60, 100], 40)).toBe(1);
		expect(dropIndexAt([20, 60, 100], 60)).toBe(2);
		expect(dropIndexAt([20, 60, 100], 500)).toBe(3);
	});
});

describe('where a derived card opens', () => {
	it('names a pane, a tab and the narrowing for every key', () => {
		expect(derivedTaskTarget('dailyGoal')).toEqual({ kind: 'sessions' });
		expect(derivedTaskTarget('weeklyGoal')).toEqual({ kind: 'sessions' });
		expect(derivedTaskTarget('monthlyGoal')).toEqual({ kind: 'sessions' });
		expect(derivedTaskTarget('unresolvedMentions')).toEqual({
			kind: 'tracking',
			section: 'unresolved',
		});
		expect(derivedTaskTarget('sensitiveWords')).toEqual({
			kind: 'tracking',
			section: 'sensitive',
		});
		expect(derivedTaskTarget('openForeshadowings')).toEqual({
			kind: 'foreshadowing',
			status: 'active',
			standing: '',
		});
		expect(derivedTaskTarget('unresolvedForeshadowings')).toEqual({
			kind: 'foreshadowing',
			status: '',
			standing: 'unresolved',
		});
		expect(derivedTaskTarget('pendingRevisions')).toEqual({ kind: 'revision', standing: '' });
		expect(derivedTaskTarget('unresolvedRevisions')).toEqual({
			kind: 'revision',
			standing: 'conflict',
		});
		expect(derivedTaskTarget('stickyNotes')).toEqual({ kind: 'stickyNotes' });
		expect(DERIVED_TASK_KEYS.every((key) => derivedTaskTarget(key) !== undefined)).toBe(true);
	});
});

describe('the shelf', () => {
	it('keeps the set-aside tasks its own search and funnel leave', () => {
		const tasks = [
			task('a', { archived: true, title: 'Ferry tide' }),
			task('b', { archived: true, priority: 'high', status: 'done' }),
			task('c', { title: 'Ferry lamp' }),
		];
		const shelf = (query: string, priority: '' | 'high', status: '' | 'done' = ''): string[] =>
			filterArchivedTasks(tasks, query, { status, priority, due: '' }, context).map(
				(entry) => entry.id,
			);
		expect(shelf('', '')).toEqual(['a', 'b']);
		expect(shelf('ferry', '')).toEqual(['a']);
		expect(shelf('', 'high')).toEqual(['b']);
		expect(shelf('', '', 'done')).toEqual(['b']);
	});
});
