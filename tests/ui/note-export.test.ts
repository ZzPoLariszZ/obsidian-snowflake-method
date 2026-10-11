import { beforeEach, describe, expect, it, vi } from 'vitest';

const notices = vi.hoisted(() => [] as string[]);

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		MarkdownView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		Notice: class {
			constructor(message: unknown) {
				notices.push(String(message));
			}
		},
	};
});

import SnowflakeMethodPlugin from '../../src/main';
import { SnowflakeProjectService } from '../../src/services';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { createFakeEnvironment } from '../helpers/fake-vault';

beforeEach(() => {
	notices.length = 0;
});

/**
 * The real plugin's note export over the real project service on the fake
 * vault, with the project the scan would have found: only the words are
 * stood in for, each message read back as its key and the path it names.
 */
async function setup() {
	const env = createFakeEnvironment();
	const service = new SnowflakeProjectService(env.vault, env.fileManager, env.metadataCache);
	const project = await service.createProject({ title: 'Novel', locale: 'en' });
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	const settings = {
		...DEFAULT_SETTINGS,
		exportFolder: 'Out',
		exportParagraphSpacing: false,
		recentProjectPath: null,
	};
	Object.assign(plugin, {
		app: { vault: env.vault, fileManager: env.fileManager, metadataCache: env.metadataCache },
		projects: service,
		settings,
		rosterScanned: true,
		projectLocalesByRoot: new Map([[project.rootPath, 'en']]),
		knownProjectRoots: new Set([project.rootPath]),
		externalDrafts: new Map<string, string>(),
		translateForProject: (_locale: unknown, key: string, vars?: Record<string, unknown>) =>
			typeof vars?.path === 'string' ? `${key} ${vars.path}` : key,
	});
	const host = plugin as unknown as {
		exportNote(path: string): Promise<void>;
		externalDrafts: Map<string, string>;
	};
	return { env, project, settings, host };
}

/**
 * One note of the app's own exported from the bar above it: under its
 * project's name, a project's draft linked from outside its folder
 * included; a note of no project straight into the export folder, and
 * never into a project's folder.
 */
describe('the export of one note from its bar', () => {
	it('writes a project’s note under its project’s name', async () => {
		const { env, project, host } = await setup();
		const path = `${project.rootPath}/20_Character/Alice.md`;
		await env.fakeVault.seedFile(path, '# Alice\n\nShe keeps the lighthouse.\n');
		await host.exportNote(path);
		expect(env.fakeVault.contents.get('Out/Novel/Alice.txt')).toBe(
			'Alice\n  She keeps the lighthouse.\n',
		);
		expect(notices).toEqual(['messages.exported Out/Novel/Alice.txt']);
	});

	it('writes a draft linked from outside its project under that project', async () => {
		const { env, project, host } = await setup();
		await env.fakeVault.seedFile('Drafts/Book.md', 'The first line.\n');
		host.externalDrafts.set(project.rootPath, 'Drafts/Book.md');
		await host.exportNote('Drafts/Book.md');
		expect(env.fakeVault.contents.get('Out/Novel/Book.txt')).toBe('  The first line.\n');
	});

	it('writes a note of no project straight into the export folder', async () => {
		const { env, host } = await setup();
		await env.fakeVault.seedFile('Loose/Idea.md', 'A plain thought.\n');
		await host.exportNote('Loose/Idea.md');
		expect(env.fakeVault.contents.get('Out/Idea.txt')).toBe('  A plain thought.\n');
		expect(notices).toEqual(['messages.exported Out/Idea.txt']);
	});

	it('keeps a note of no project out of every project’s folder', async () => {
		const { env, project, settings, host } = await setup();
		await env.fakeVault.seedFile('Loose/Idea.md', 'A plain thought.\n');
		settings.exportFolder = `${project.rootPath}/Exports`;
		await host.exportNote('Loose/Idea.md');
		expect(notices).toEqual([`errors.exportIntoProject ${project.rootPath}/Exports`]);
		expect([...env.fakeVault.contents.keys()].some((key) => key.endsWith('Idea.txt'))).toBe(false);
	});
});
