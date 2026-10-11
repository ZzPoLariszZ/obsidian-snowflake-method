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

/** Typewriter scrolling acts in the notes the typography reaches, and is offered there. */
describe('the typewriter command', () => {
	it('offers typewriter scrolling in a note the typography reaches as well as in the stream', () => {
		const commands = new Map<string, { checkCallback?: (checking: boolean) => boolean }>();
		const toggled: string[] = [];
		let path = 'Novel/50_Manuscript/Chapter 1.md';
		const plugin = Object.create(SnowflakeMethodPlugin.prototype) as { registerCommands(): void };
		Object.assign(plugin, {
			globalT: (key: string) => key,
			addCommand: (command: { id: string; checkCallback?: (checking: boolean) => boolean }) => {
				commands.set(command.id, command);
			},
			activeManuscriptView: () => null,
			app: { workspace: { getActiveViewOfType: () => ({ file: { path } }) } },
			notePresentation: { wears: (at: string) => at.startsWith('Novel/') },
			toggleManuscriptMode: (mode: string) => {
				toggled.push(mode);
				return Promise.resolve();
			},
		});
		plugin.registerCommands();
		const check = commands.get('toggle-typewriter-scrolling')?.checkCallback;
		expect(check?.(true)).toBe(true);
		expect(check?.(false)).toBe(true);
		expect(toggled).toEqual(['typewriter']);
		path = 'Loose/Idea.md';
		expect(check?.(true)).toBe(false);
	});
});
