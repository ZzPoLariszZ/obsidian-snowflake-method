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

const DOORS = [
	'open-story-structure',
	'open-ordered-corkboard',
	'open-freeform',
	'open-timeline',
	'open-beat-sheet',
	'open-relationship-graph',
];

/** The visualization workspace is offered with a project open, except on a phone. */
describe('the workspace commands', () => {
	it('are offered with a project open, and not on a phone', () => {
		const commands = new Map<string, { checkCallback?: (checking: boolean) => boolean }>();
		let phone = false;
		const settings = { recentProjectPath: 'Novel/00_System/001_Project_Metadata.md' as string | null };
		const plugin = Object.create(SnowflakeMethodPlugin.prototype) as { registerCommands(): void };
		Object.assign(plugin, {
			globalT: (key: string) => key,
			addCommand: (command: { id: string; checkCallback?: (checking: boolean) => boolean }) => {
				commands.set(command.id, command);
			},
			settings,
			app: {
				workspace: {
					containerEl: { doc: { body: { classList: { contains: (name: string) => name === 'is-phone' && phone } } } },
				},
			},
		});
		plugin.registerCommands();
		const offered = (id: string): boolean | undefined => commands.get(id)?.checkCallback?.(true);
		for (const id of DOORS) expect(offered(id), id).toBe(true);
		phone = true;
		for (const id of DOORS) expect(offered(id), id).toBe(false);
		// The scene graph is the app's own graph view, which a phone shows.
		expect(offered('open-scene-manuscript-graph')).toBe(true);
		phone = false;
		settings.recentProjectPath = null;
		for (const id of DOORS) expect(offered(id), id).toBe(false);
	});
});
