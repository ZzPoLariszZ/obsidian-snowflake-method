import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		SearchComponent: class extends runtime.SearchComponent {
			setValue(): this { return this; }
		},
	};
});

// The real panel owns the active anchor, its aria state, and replacement.
// Suggestion widgets and screen positioning do not affect those behaviors.
vi.mock('../../src/ui/anchored-panel', () => ({ followAnchor: () => () => undefined }));
vi.mock('../../src/ui/option-picker', () => ({
	buildOptionField: () => ({ destroy: () => undefined }),
}));

import type { Task } from '../../src/domain';
import { FilterPanel } from '../../src/ui/filter-panel';
import { renderTaskBoard } from '../../src/ui/task-board';
import { taskBoardMemory } from '../../src/ui/task-board-rows';
import type { TaskBoardBridge } from '../../src/ui/task-bridge';

async function setup() {
	const dom = new CorkboardDom();
	Object.assign(dom.win, {
		activeDocument: dom.doc,
		setInterval: () => 1,
		clearInterval: () => undefined,
	});
	const panel = new FilterPanel({} as App, (key) => key);
	const task: Task = {
		id: 'task', title: 'Finish the chapter', description: '', status: 'todo', priority: 'medium',
		dueDate: null, related: [], archived: false, createdAt: 1, updatedAt: 1,
	};
	const bridge: TaskBoardBridge = {
		t: (key) => key,
		read: async () => ({
			projectPath: 'Novel/Project.md', locale: 'en', readOnly: false,
			today: '2026-09-08', week: { from: '2026-09-07', to: '2026-09-13' },
			dateFormat: 'YYYY-MM-DD', tasks: [task], derived: [], derivedFailed: false, roster: [],
		}),
		subscribe: () => () => undefined,
		today: () => '2026-09-08',
		add: async () => undefined, edit: async () => undefined,
		move: async () => true, archive: async () => true, restore: async () => true,
		deleteTask: async () => true, emptyArchive: async () => true,
	};
	const handle = renderTaskBoard(dom.container as unknown as HTMLElement, bridge, {
		memory: { ...taskBoardMemory(), archiveOpen: true },
		popover: panel.lend(), navigate: () => undefined,
	});
	await Promise.resolve();
	const buttons = dom.container.querySelectorAll('.snowflake-method-filter-button');
	expect(buttons).toHaveLength(2);
	expect(buttons[0]!.classes).not.toContain('is-hidden');
	const firstRowLabel = () => dom.container.querySelector('.snowflake-method-filter-label')?.textContent;
	return { dom, panel, handle, buttons, firstRowLabel };
}

// Native button activation by Enter/Space synthesizes click without mousedown.
function keyboardActivate(button: CorkboardElement): void {
	button.focus();
	button.dispatch('click');
}

describe('task board keyboard filter switching', () => {
	it.each([[0, 1], [1, 0]])('switches from funnel %i to %i in one activation', async (from, to) => {
		const fixture = await setup();
		try {
			const first = fixture.buttons[from]!;
			const second = fixture.buttons[to]!;
			keyboardActivate(first);
			expect(first.getAttribute('aria-expanded')).toBe('true');
			keyboardActivate(second);
			expect(fixture.panel.isOpen()).toBe(true);
			expect(first.getAttribute('aria-expanded')).toBe('false');
			expect(second.getAttribute('aria-expanded')).toBe('true');
			expect(fixture.firstRowLabel()).toBe(to === 0 ? 'taskBoard.filterOrigin' : 'status.label');
			expect(fixture.dom.doc.activeElement).toBe(second);
			keyboardActivate(second);
			expect(fixture.panel.isOpen()).toBe(false);
			keyboardActivate(second);
			expect(fixture.panel.isOpen()).toBe(true);
			fixture.panel.close();
			keyboardActivate(second);
			expect(fixture.panel.isOpen()).toBe(true);
		} finally {
			fixture.handle.dispose();
		}
	});

	it('replaces another shared panel instead of only dismissing it', async () => {
		const fixture = await setup();
		try {
			const boardFilter = fixture.buttons[0]!;
			keyboardActivate(boardFilter);
			const otherAnchor = fixture.dom.container.createEl('button');
			fixture.panel.open(otherAnchor as unknown as HTMLElement, [], () => undefined);
			keyboardActivate(boardFilter);
			expect(fixture.panel.isOpen()).toBe(true);
			expect(otherAnchor.getAttribute('aria-expanded')).toBe('false');
			expect(boardFilter.getAttribute('aria-expanded')).toBe('true');
			expect(fixture.firstRowLabel()).toBe('taskBoard.filterOrigin');
		} finally {
			fixture.handle.dispose();
		}
	});
});
