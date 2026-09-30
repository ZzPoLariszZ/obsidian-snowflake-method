import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom } from '../helpers/corkboard-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		SearchComponent: class extends runtime.SearchComponent {
			value = '';
			setValue(value: string): this { this.value = value; return this; }
		},
	};
});

vi.mock('../../src/ui/anchored-panel', () => ({ followAnchor: () => () => undefined }));
vi.mock('../../src/ui/option-picker', () => ({
	buildOptionField: () => ({ destroy: () => undefined }),
}));

import type { Task } from '../../src/domain';
import { FilterPanel } from '../../src/ui/filter-panel';
import { renderTaskBoard } from '../../src/ui/task-board';
import { taskBoardMemory, type TaskBoardMemory } from '../../src/ui/task-board-rows';
import type { TaskBoardBridge } from '../../src/ui/task-bridge';

const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
	id, title, description: '', status: 'todo', priority: 'medium',
	dueDate: null, related: [], archived: false, createdAt: 1, updatedAt: 1, ...extra,
});

async function board(memory: TaskBoardMemory = taskBoardMemory()) {
	const dom = new CorkboardDom();
	Object.assign(dom.win, { activeDocument: dom.doc, setInterval: () => 1, clearInterval: () => undefined });
	const panel = new FilterPanel({} as App, (key) => key);
	const bridge: TaskBoardBridge = {
		t: (key) => key,
		read: async () => ({
			projectPath: 'Novel/Project.md', locale: 'en', readOnly: false,
			today: '2026-09-08', week: { from: '2026-09-07', to: '2026-09-13' },
			dateFormat: 'YYYY-MM-DD',
			tasks: [task('a', 'Finish the chapter'), task('b', 'Cut the prologue', { priority: 'high' }), task('c', 'Old one', { archived: true })],
			derived: [], derivedFailed: false, roster: [],
		}),
		subscribe: () => () => undefined,
		today: () => '2026-09-08',
		add: async () => undefined, edit: async () => undefined,
		move: async () => true, archive: async () => true, restore: async () => true,
		deleteTask: async () => true, emptyArchive: async () => true,
	};
	const handle = renderTaskBoard(dom.container as unknown as HTMLElement, bridge, {
		memory, popover: panel.lend(), navigate: () => undefined,
	});
	for (let at = 0; at < 10; at += 1) await Promise.resolve();
	// The fake reads no attribute selector: the cards are found by their id attribute.
	const card = (id: string) => dom.container.querySelectorAll('.snowflake-method-task-card').find((el) => el.getAttribute('data-id') === id) ?? null;
	return { dom, handle, memory, card };
}

describe('revealing one task on the board', () => {
	it('brings the card into sight and gives it the focus', async () => {
		const { dom, handle, card } = await board();
		expect(card('a')).not.toBeNull();
		expect(handle.reveal('a')).toBe(true);
		expect(dom.doc.activeElement).toBe(card('a'));
		expect(dom.operations.some((op) => op.kind === 'scroll' && op.property === 'scrollIntoView' && op.target === card('a'))).toBe(true);
	});

	it('clears the search and the funnel that hid the card, then reveals it', async () => {
		const memory = { ...taskBoardMemory(), query: 'prologue', priority: 'high' as const };
		const { dom, handle, card } = await board(memory);
		expect(card('a')).toBeNull();
		expect(card('b')).not.toBeNull();
		expect(handle.reveal('a')).toBe(true);
		expect(memory.query).toBe('');
		expect(memory.priority).toBe('');
		expect(card('a')).not.toBeNull();
		expect(dom.doc.activeElement).toBe(card('a'));
		expect(dom.container.querySelector('.snowflake-method-filter-button')!.classes.has('is-active')).toBe(false);
	});

	it('reveals nothing for a task archived or gone, and touches no filter for it', async () => {
		const memory = { ...taskBoardMemory(), query: 'prologue' };
		const { handle, card } = await board(memory);
		expect(handle.reveal('c')).toBe(false);
		expect(handle.reveal('nowhere')).toBe(false);
		expect(memory.query).toBe('prologue');
		expect(card('a')).toBeNull();
		handle.dispose();
		expect(handle.reveal('b')).toBe(false);
	});
});
