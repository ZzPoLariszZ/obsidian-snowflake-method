import { describe, expect, it, vi } from 'vitest';

// The real plugin registers its commands; nothing of Obsidian's is
// reached beyond what the module needs to load.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		MarkdownView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import SnowflakeMethodPlugin from '../../src/main';

/** The modification history has a command of its own, landing on its tab. */
describe('the open modification history command', () => {
	it('brings the dashboard forward on the history tab', async () => {
		const commands = new Map<string, { name: string; callback?: () => void }>();
		const shown: string[] = [];
		const view = {
			showStatisticsTab: vi.fn((tab: string) => {
				shown.push(tab);
				return Promise.resolve();
			}),
		};
		const revealed = vi.fn(() => Promise.resolve(view));
		const plugin = Object.create(SnowflakeMethodPlugin.prototype) as {
			registerCommands(): void;
		};
		Object.assign(plugin, {
			globalT: (key: string) => key,
			addCommand: (command: { id: string; name: string; callback?: () => void }) => {
				commands.set(command.id, command);
			},
			revealDashboard: revealed,
			showError: vi.fn(),
		});
		plugin.registerCommands();
		const command = commands.get('open-history');
		expect(command?.name).toBe('commands.openHistory');
		command?.callback?.();
		await Promise.resolve();
		await Promise.resolve();
		expect(revealed).toHaveBeenCalledTimes(1);
		expect(shown).toEqual(['history']);
	});

	it('does nothing more when no dashboard could be brought forward', async () => {
		const plugin = Object.create(SnowflakeMethodPlugin.prototype) as {
			openModificationHistory(): Promise<void>;
		};
		Object.assign(plugin, { revealDashboard: () => Promise.resolve(null) });
		await expect(plugin.openModificationHistory()).resolves.toBeUndefined();
	});
});
