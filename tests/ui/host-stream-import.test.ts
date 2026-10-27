import { afterEach, describe, expect, it, vi } from 'vitest';

// The real plugin builds the explorer's menu and runs the import; the
// confirmation, the notices and the services are stood in for.
const { notices, asked, answer } = vi.hoisted(() => ({
	notices: [] as string[],
	asked: [] as unknown[],
	answer: { value: true },
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		Notice: class {
			constructor(message: string) {
				notices.push(message);
			}
		},
	};
});

vi.mock('../../src/ui/modals', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/modals')>();
	return {
		...actual,
		confirmStreamImport: (_app: unknown, _t: unknown, summary: unknown): Promise<boolean> => {
			asked.push(summary);
			return Promise.resolve(answer.value);
		},
	};
});

import type { Menu, TAbstractFile } from 'obsidian';

import SnowflakeMethodPlugin from '../../src/main';
import { EXPLORER_MENU_SOURCE } from '../../src/ui/file-explorer';
import { FakeFiles } from '../helpers/explorer-fake';

type FileMenuHandler = (menu: Menu, file: TAbstractFile, source: string) => void;
type FilesMenuHandler = (menu: Menu, files: TAbstractFile[], source: string) => void;

interface MenuEntry {
	title: string;
	icon: string | null;
	label: boolean;
	click: (() => void) | null;
}

/** A menu that keeps what was added to it, so a test can read the items and press one. */
class CapturingMenu {
	readonly items: MenuEntry[] = [];
	addItem(build: (item: unknown) => void): this {
		const entry: MenuEntry = { title: '', icon: null, label: false, click: null };
		const item = {
			setSection: (): unknown => item,
			setTitle: (title: string): unknown => {
				entry.title = title;
				return item;
			},
			setIcon: (icon: string): unknown => {
				entry.icon = icon;
				return item;
			},
			setIsLabel: (label: boolean): unknown => {
				entry.label = label;
				return item;
			},
			setDisabled: (): unknown => item,
			onClick: (callback: () => void): unknown => {
				entry.click = callback;
				return item;
			},
		};
		build(item);
		this.items.push(entry);
		return this;
	}
	titles(): string[] {
		return this.items.map((item) => item.title);
	}
	press(title: string): void {
		const entry = this.items.find((item) => item.title === title);
		if (entry?.click == null) throw new Error(`no item ${title}`);
		entry.click();
	}
}

const PROJECT = 'Novel/00_System/001_Project_Metadata.md';
const IMPORT = 'en:manuscript.menu.importToStream';
const HEADING = 'en:plugin.name';

type ImportNotes = (
	project: unknown,
	sources: readonly string[],
	onCreated?: (path: string) => void,
) => Promise<string[]>;

/** Where the fake import lands each source: a note of the same name in the manuscript folder. */
const landing = (sources: readonly string[]): string[] =>
	sources.map((source) => `Novel/50_Manuscript/${source.slice(source.lastIndexOf('/') + 1)}`);

/** An import that lands the sources given, telling `onCreated` of each as the service does. */
const importing =
	(lands: (sources: readonly string[]) => string[]): ImportNotes =>
	(_project, sources, onCreated) => {
		const paths = lands(sources);
		for (const path of paths) onCreated?.(path);
		return Promise.resolve(paths);
	};

function pluginWith(options: {
	current?: string | null;
	readOnly?: boolean;
	paths: string[];
	/** The language of the project an entry is in, as the plugin reads it from the path. */
	localeOf?: (path: string) => string;
}) {
	const files = new FakeFiles();
	for (const path of options.paths) {
		if (path.endsWith('/')) files.folder(path.slice(0, -1));
		else files.file(path);
	}
	const handlers: Record<string, FileMenuHandler | FilesMenuHandler> = {};
	const ref = {
		projectFile: PROJECT,
		rootPath: 'Novel',
		id: 'novel',
		title: 'Novel',
		locale: 'en',
		readOnly: options.readOnly ?? false,
		series: null,
		worldbuildingKinds: [],
	};
	const manuscript = {
		inManuscriptFolderOf: () => (path: string) => path.startsWith('Novel/50_Manuscript/'),
		importNotes: vi.fn(importing(landing)),
	};
	const addProjectMenuSection = vi.fn();
	const refreshManuscriptStreams = vi.fn(() => Promise.resolve());
	const showError = vi.fn();
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	Object.assign(plugin, {
		app: {
			workspace: {
				on: (name: string, callback: FileMenuHandler | FilesMenuHandler) => {
					handlers[name] = callback;
					return {};
				},
				getLeavesOfType: () => [],
			},
			vault: { getRoot: () => files.root },
		},
		registerEvent: () => undefined,
		settings: { recentProjectPath: options.current === undefined ? PROJECT : options.current },
		knownProjectsByRoot: new Map([['Novel', ref]]),
		explorer: null,
		projects: { manuscript, loadProject: vi.fn(() => Promise.resolve(ref)) },
		touchesProject: (path: string) => path.startsWith('Novel/'),
		projectLocaleOfPath: options.localeOf ?? (() => 'en'),
		translateForProject: (locale: string, key: string, vars?: Record<string, string | number>) =>
			`${locale}:${key}${vars === undefined ? '' : JSON.stringify(vars)}`,
		addProjectMenuSection,
		refreshManuscriptStreams,
		showError,
	});
	(plugin as unknown as { registerFileMenu(): void }).registerFileMenu();
	const fileMenu = handlers['file-menu'] as FileMenuHandler;
	const filesMenu = handlers['files-menu'] as FilesMenuHandler;
	const entry = (path: string): TAbstractFile => {
		const found = files.get(path);
		if (found === null) throw new Error(`no entry ${path}`);
		return found;
	};
	const over = (path: string, source = EXPLORER_MENU_SOURCE): CapturingMenu => {
		const menu = new CapturingMenu();
		fileMenu(menu as unknown as Menu, entry(path), source);
		return menu;
	};
	const overAll = (paths: string[], source = EXPLORER_MENU_SOURCE): CapturingMenu => {
		const menu = new CapturingMenu();
		filesMenu(menu as unknown as Menu, paths.map(entry), source);
		return menu;
	};
	return { plugin, files, manuscript, addProjectMenuSection, refreshManuscriptStreams, showError, over, overAll };
}

/** Lets the pressed item's promise chain run to its end. */
async function settle(): Promise<void> {
	for (let at = 0; at < 20; at++) await Promise.resolve();
}

afterEach(() => {
	notices.length = 0;
	asked.length = 0;
	answer.value = true;
});

describe('the explorer’s import into the stream', () => {
	const PATHS = [
		'Inbox/b.md',
		'Inbox/a.md',
		'Inbox/pic.png',
		'Inbox/Sub/c.md',
		'Novel/50_Manuscript/Draft.md',
		'Novel/80_Material/Idea.md',
		PROJECT,
	];

	it('offers the item under the plugin’s heading over a folder outside every project, and over several entries at once', () => {
		const { over, overAll } = pluginWith({ paths: PATHS });
		const folder = over('Inbox');
		expect(folder.titles()).toEqual([HEADING, IMPORT]);
		expect(folder.items[0]?.label).toBe(true);
		expect(folder.items[1]?.icon).toBe('file-input');
		expect(overAll(['Inbox/a.md', 'Inbox/b.md']).titles()).toEqual([HEADING, IMPORT]);
	});

	it('words the heading and the item in the language of the project the notes land in, whatever project the entry is in', () => {
		const { over } = pluginWith({
			paths: [...PATHS, 'Other/note.md'],
			// The entry belongs to a Chinese project; the notes land in the English one.
			localeOf: (path) => (path.startsWith('Other/') ? 'zh-CN' : 'en'),
		});
		expect(over('Other/note.md').titles()).toEqual([HEADING, IMPORT]);
	});

	it('joins the project section over a project note without a second heading', () => {
		const { over, addProjectMenuSection } = pluginWith({ paths: PATHS });
		const menu = over('Novel/80_Material/Idea.md');
		expect(addProjectMenuSection).toHaveBeenCalledTimes(1);
		expect(menu.titles()).toEqual([IMPORT]);
	});

	it('stays away from other menus, from a selection with no note to bring, and from a note the stream holds', () => {
		const { over, overAll } = pluginWith({ paths: PATHS });
		expect(over('Inbox', 'tab-header').titles()).toEqual([]);
		expect(over('Inbox/pic.png').titles()).toEqual([]);
		expect(over('Novel/50_Manuscript/Draft.md').titles()).toEqual([]);
		expect(overAll(['Inbox/pic.png', 'Novel/50_Manuscript/Draft.md']).titles()).toEqual([]);
	});

	it('stays away while no project is current, and while the current one cannot be written', () => {
		expect(pluginWith({ paths: PATHS, current: null }).over('Inbox').titles()).toEqual([]);
		expect(pluginWith({ paths: PATHS, readOnly: true }).over('Inbox').titles()).toEqual([]);
	});

	it('asks first, naming the project and the counts, then copies the notes in the explorer’s order and says what landed', async () => {
		const { overAll, manuscript, refreshManuscriptStreams, showError } = pluginWith({ paths: PATHS });
		// Picked out of order, with a picture and a stream note among them.
		overAll(['Novel/50_Manuscript/Draft.md', 'Inbox/Sub/c.md', 'Inbox/pic.png', 'Inbox']).press(IMPORT);
		await settle();
		expect(asked).toEqual([{ project: 'Novel', count: 3, skipped: 1, inStream: 1 }]);
		expect(manuscript.importNotes).toHaveBeenCalledTimes(1);
		expect(manuscript.importNotes.mock.calls[0]?.[1]).toEqual(['Inbox/Sub/c.md', 'Inbox/a.md', 'Inbox/b.md']);
		expect(refreshManuscriptStreams).toHaveBeenCalledTimes(1);
		expect(notices).toEqual(['en:messages.streamImportedSkipped{"count":3,"project":"Novel","skipped":2}']);
		expect(showError).not.toHaveBeenCalled();
	});

	it('says it plainly for one note with nothing skipped', async () => {
		const { over } = pluginWith({ paths: PATHS });
		over('Inbox/a.md').press(IMPORT);
		await settle();
		expect(asked).toEqual([{ project: 'Novel', count: 1, skipped: 0, inStream: 0 }]);
		expect(notices).toEqual(['en:messages.streamImportedOne{"count":1,"project":"Novel","skipped":0}']);
	});

	it('draws the plan up when the item is chosen, from the vault as it stands then', async () => {
		const { over, files, manuscript } = pluginWith({ paths: PATHS });
		const menu = over('Inbox');
		// A note that arrived after the menu opened goes with the rest.
		files.file('Inbox/late.md');
		menu.press(IMPORT);
		await settle();
		expect(asked).toEqual([{ project: 'Novel', count: 4, skipped: 1, inStream: 0 }]);
		expect(manuscript.importNotes.mock.calls[0]?.[1]).toEqual([
			'Inbox/Sub/c.md',
			'Inbox/a.md',
			'Inbox/b.md',
			'Inbox/late.md',
		]);
	});

	it('counts a note gone before the import among the skipped', async () => {
		const { over, manuscript } = pluginWith({ paths: PATHS });
		// The first of the three notes planned has gone by the time the import runs.
		manuscript.importNotes.mockImplementationOnce(importing((sources) => landing(sources.slice(1))));
		over('Inbox').press(IMPORT);
		await settle();
		expect(asked).toEqual([{ project: 'Novel', count: 3, skipped: 1, inStream: 0 }]);
		expect(notices).toEqual(['en:messages.streamImportedSkipped{"count":2,"project":"Novel","skipped":2}']);
	});

	it('says nothing landed when every note chosen had gone', async () => {
		const { over, manuscript, refreshManuscriptStreams } = pluginWith({ paths: PATHS });
		manuscript.importNotes.mockImplementationOnce(importing(() => []));
		over('Inbox').press(IMPORT);
		await settle();
		expect(refreshManuscriptStreams).toHaveBeenCalledTimes(1);
		expect(notices).toEqual(['en:messages.streamImportedNone{"project":"Novel"}']);
	});

	it('tells the streams and says what landed when the import stops partway', async () => {
		const { over, manuscript, refreshManuscriptStreams, showError } = pluginWith({ paths: PATHS });
		// The first note lands, then the disk refuses the second.
		manuscript.importNotes.mockImplementationOnce((_project, sources, onCreated) => {
			for (const path of landing(sources.slice(0, 1))) onCreated?.(path);
			return Promise.reject(new Error('disk full'));
		});
		over('Inbox').press(IMPORT);
		await settle();
		expect(refreshManuscriptStreams).toHaveBeenCalledTimes(1);
		expect(notices).toEqual(['en:messages.streamImportStoppedOne{"count":1,"project":"Novel"}']);
		expect(showError).toHaveBeenCalledTimes(1);
		expect((showError.mock.calls[0]?.[0] as Error).message).toBe('disk full');
	});

	it('says nothing of what landed when the import stops before its first note', async () => {
		const { over, manuscript, refreshManuscriptStreams, showError } = pluginWith({ paths: PATHS });
		manuscript.importNotes.mockImplementationOnce(() => Promise.reject(new Error('locked')));
		over('Inbox').press(IMPORT);
		await settle();
		expect(refreshManuscriptStreams).toHaveBeenCalledTimes(1);
		expect(notices).toEqual([]);
		expect(showError).toHaveBeenCalledTimes(1);
	});

	it('writes nothing when the author declines', async () => {
		answer.value = false;
		const { over, manuscript, refreshManuscriptStreams } = pluginWith({ paths: PATHS });
		over('Inbox').press(IMPORT);
		await settle();
		expect(asked).toHaveLength(1);
		expect(manuscript.importNotes).not.toHaveBeenCalled();
		expect(refreshManuscriptStreams).not.toHaveBeenCalled();
		expect(notices).toEqual([]);
	});
});
