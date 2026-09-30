import { describe, expect, it, vi } from 'vitest';

// The real plugin routes the request; only the app's vault, its view
// registry and its workspace are stood in for.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import { TFile } from 'obsidian';

import SnowflakeMethodPlugin from '../../src/main';

function pluginWith(files: Record<string, { extension: string }>, options: { registered?: string[]; defaultApp?: boolean } = {}) {
	const vaultFiles = new Map(Object.entries(files).map(([path, spec]) => {
		const file = new TFile() as TFile & { path: string; extension: string };
		Object.assign(file, { path, extension: spec.extension });
		return [path, file] as const;
	}));
	const opened: unknown[] = [];
	const leaf = {
		openFile: vi.fn((file: unknown) => { opened.push(file); return Promise.resolve(); }),
	};
	const workspace = {
		getLeaf: vi.fn(() => leaf),
		revealLeaf: vi.fn(() => Promise.resolve()),
	};
	const registered = new Set(options.registered ?? ['png', 'pdf', 'mp3']);
	const app = {
		vault: { getFileByPath: (path: string) => vaultFiles.get(path) ?? null },
		workspace,
		viewRegistry: { getTypeByExtension: (extension: string) => (registered.has(extension) ? `${extension}-view` : undefined) },
		...(options.defaultApp === false ? {} : { openWithDefaultApp: vi.fn(() => Promise.resolve()) }),
	};
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	const openManagedFile = vi.fn(() => Promise.resolve());
	Object.assign(plugin, {
		app,
		settings: { locale: 'en' },
		t: (key: string, vars?: Record<string, string | number>) => `${key}${vars === undefined ? '' : JSON.stringify(vars)}`,
		openManagedFile,
	});
	return { plugin, app, leaf, workspace, opened, openManagedFile, file: (path: string) => vaultFiles.get(path) };
}

describe('opening any file of the project', () => {
	it('opens a note through the note pane, as a managed note is opened', async () => {
		const { plugin, openManagedFile, workspace } = pluginWith({ 'Novel/Notes/Plan.md': { extension: 'md' } });
		await plugin.openProjectFile('Novel/Notes/Plan.md');
		expect(openManagedFile).toHaveBeenCalledExactlyOnceWith('Novel/Notes/Plan.md');
		expect(workspace.getLeaf).not.toHaveBeenCalled();
	});

	it('opens a file the app has a view for in a tab of its own, and brings it forward', async () => {
		const { plugin, leaf, workspace, app, file } = pluginWith({ 'Novel/Material/map.png': { extension: 'png' } });
		await plugin.openProjectFile('Novel/Material/map.png');
		expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
		expect(leaf.openFile).toHaveBeenCalledWith(file('Novel/Material/map.png'), { active: true });
		expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
		expect((app as { openWithDefaultApp?: unknown }).openWithDefaultApp).not.toHaveBeenCalled();
	});

	it('hands a file the app cannot show to the machine’s own program for it, and to a tab where it cannot ask for one', async () => {
		const { plugin, app, leaf } = pluginWith({ 'Novel/Material/notes.zip': { extension: 'zip' } });
		await plugin.openProjectFile('Novel/Material/notes.zip');
		expect((app as { openWithDefaultApp: ReturnType<typeof vi.fn> }).openWithDefaultApp).toHaveBeenCalledWith('Novel/Material/notes.zip');
		expect(leaf.openFile).not.toHaveBeenCalled();
		const bare = pluginWith({ 'Novel/Material/notes.zip': { extension: 'zip' } }, { defaultApp: false });
		await bare.plugin.openProjectFile('Novel/Material/notes.zip');
		expect(bare.leaf.openFile).toHaveBeenCalledOnce();
	});

	it('says which file could not be found', async () => {
		const { plugin } = pluginWith({});
		await expect(plugin.openProjectFile('Novel/gone.png')).rejects.toThrow('errors.projectFileMissing{"path":"Novel/gone.png"}');
	});
});

describe('handing a web address to the app', () => {
	it('opens a web address in the window it was asked from, and refuses any other', () => {
		const { plugin } = pluginWith({});
		const open = vi.fn();
		const from = { win: { open } } as unknown as HTMLElement;
		plugin.openExternalLink('https://example.com/a?b=1', from);
		plugin.openExternalLink('HTTP://example.com', from);
		expect(open.mock.calls).toEqual([['https://example.com/a?b=1'], ['HTTP://example.com']]);
		for (const url of ['file:///etc/passwd', 'obsidian://open?vault=x', 'javascript:alert(1)', 'example.com', '']) {
			expect(() => { plugin.openExternalLink(url, from); }, url).toThrow('freeformCanvas.open.linkRefused');
		}
		expect(open).toHaveBeenCalledTimes(2);
	});
});
