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

import { t } from '../../src/i18n';
import { FilterPanel } from '../../src/ui/filter-panel';
import { renderTaskBoard } from '../../src/ui/task-board';
import { taskBoardMemory } from '../../src/ui/task-board-rows';
import type { TaskBoardBridge } from '../../src/ui/task-bridge';

/**
 * The board over one goal card, the project written in English and the
 * interface speaking `locale`: the reading's language and the board's part
 * here, and the figures must follow the board's.
 */
async function goalBadge(locale: string): Promise<string> {
	const dom = new CorkboardDom();
	Object.assign(dom.win, { activeDocument: dom.doc, setInterval: () => 1, clearInterval: () => undefined });
	const panel = new FilterPanel({} as App, (key) => key);
	const bridge: TaskBoardBridge = {
		t: (key, vars) => t('de', key, vars),
		locale: () => locale,
		read: async () => ({
			projectPath: 'Novel/Project.md', locale: 'en', readOnly: false,
			today: '2026-09-08', week: { from: '2026-09-07', to: '2026-09-13' },
			dateFormat: 'YYYY-MM-DD', tasks: [], roster: [], derivedFailed: false,
			derived: [{ key: 'dailyGoal', status: 'todo', count: null, progress: { net: 0, goal: 4000 } }],
		}),
		subscribe: () => () => undefined,
		today: () => '2026-09-08',
		add: async () => undefined, edit: async () => undefined,
		move: async () => true, archive: async () => true, restore: async () => true,
		deleteTask: async () => true, emptyArchive: async () => true,
	};
	const handle = renderTaskBoard(dom.container as unknown as HTMLElement, bridge, {
		memory: taskBoardMemory(), popover: panel.lend(), navigate: () => undefined,
	});
	for (let at = 0; at < 10; at += 1) await Promise.resolve();
	const badge = dom.container.querySelector('.snowflake-method-task-progress');
	handle.dispose();
	return badge?.textContent ?? '';
}

describe('a goal card’s figures', () => {
	it('are written in the language the board speaks, not the project’s', async () => {
		await expect(goalBadge('de')).resolves.toBe('0 / 4.000');
		await expect(goalBadge('es')).resolves.toBe('0 / 4000');
		await expect(goalBadge('en')).resolves.toBe('0 / 4,000');
	});
});
