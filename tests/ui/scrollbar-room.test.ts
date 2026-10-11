import { describe, expect, it, vi } from 'vitest';

// The real plugin hears a settings change it did not make; nothing of
// Obsidian's is reached beyond what the module needs to load.
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

/** The room the scrollbars take, published again when the settings change from outside. */
describe('a settings change from outside', () => {
	it('publishes the room the bars take when the settings change from outside', async () => {
		const calls: string[] = [];
		const plugin = Object.create(SnowflakeMethodPlugin.prototype) as {
			onExternalSettingsChange(): Promise<void>;
		};
		Object.assign(plugin, {
			settings: { manuscriptFocusLevel: 'off' },
			loadSettings: () => {
				calls.push('load');
				return Promise.resolve();
			},
			applyBodyPreferences: () => calls.push('dress'),
			publishScrollbarWidth: () => calls.push('room'),
			syncCurrentProjectLocale: () => Promise.resolve(),
			syncExplorer: () => undefined,
			refreshDashboards: () => Promise.resolve(),
		});
		await plugin.onExternalSettingsChange();
		expect(calls).toEqual(['load', 'dress', 'room']);
	});
});
