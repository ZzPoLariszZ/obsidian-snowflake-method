// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeEnvironment } from '../helpers/fake-vault';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {
			app: unknown;
			constructor(public leaf: { app: unknown }) { this.app = leaf.app; }
		},
		Scope: class { register(): void {} },
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import { FileSystemAdapter } from 'obsidian';

import SnowflakeMethodPlugin from '../../src/main';
import { DEFAULT_SETTINGS, type SnowflakeSettings } from '../../src/settings';
import { SnowflakeProjectService } from '../../src/services';
import { MANUSCRIPT_VIEW_TYPE, SnowflakeManuscriptView } from '../../src/ui/manuscript-view';
import { writeUnderWay } from '../../src/ui/pending-writes';
import { STORY_STRUCTURE_VIEW_TYPE, SnowflakeStoryStructureView } from '../../src/ui/story-structure-view';

/** What these tests reach of the plugin that its type keeps to itself. */
interface Host {
	settings: SnowflakeSettings;
	dashboardEpoch(): number;
	selectStep(step: number): Promise<void>;
	saveSettings(): Promise<void>;
	saveSettingsSoon(): void;
	scanProjects(): Promise<unknown[]>;
	onExternalSettingsChange(): Promise<void>;
	syncCertificateCelebration(projectId: string, complete: boolean): Promise<boolean>;
	currentProjectLocale: string | null;
	settleForQuit(): Promise<void> | null;
	settleOutOfSight(): void;
	registerSettling(): void;
	requireProject(projectPath?: string): Promise<unknown>;
	handleVaultRename(file: unknown, oldPath: string): Promise<void>;
	scheduleFieldsBlockReconcile(path: string): void;
	fieldsReconcileTimer: number | null;
	mutateDocument<T>(
		bell: { ring(): void },
		projectPath: string | null,
		work: (project: unknown) => Promise<{ result: T; changed: boolean }>,
		refused: T,
	): Promise<T>;
	scheduleRefresh(): void;
	refreshTimer: number | null;
	rosterSignature: string | null;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = (): void => undefined;
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

async function microtasks(): Promise<void> {
	for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

/**
 * Lets a held quit run to its end. A hold believes nothing more is coming
 * only after a rest on the clock, and these tests hold the clock still.
 */
async function ended(settling: Promise<void> | null): Promise<void> {
	await vi.advanceTimersByTimeAsync(200);
	await settling;
}

async function host() {
	const env = createFakeEnvironment();
	const service = new SnowflakeProjectService(env.vault, env.fileManager, env.metadataCache);
	const stop = service.repository.watch();
	const saved: SnowflakeSettings[] = [];
	const leaves = new Map<string, { view: unknown }[]>();
	const sessions = { markShutdown: vi.fn(), checkpoint: vi.fn(), notePathRenamed: vi.fn() };
	const explorer = { projectsChanged: vi.fn() };
	const dressNotes = vi.fn();
	const refreshParagraphLineEditors = vi.fn();
	const settleAll = vi.fn<() => Promise<void> | null>(() => null);
	let graphWrite: Promise<void> | null = null;
	let saving: Promise<void> = Promise.resolve();
	// What the plugin listens to, as the app would hand it over: the quit the
	// workspace announces, and the page's own events.
	const quitListeners: ((tasks: { add(callback: () => Promise<unknown>): void }) => void)[] = [];
	const heard: { target: EventTarget; type: string; listener: EventListener }[] = [];
	const vault: { adapter: object } = { adapter: {} };
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	Object.assign(plugin, {
		app: {
			vault,
			workspace: {
				getLeavesOfType: (type: string) => leaves.get(type) ?? [],
				containerEl: { win: window, doc: document },
				on: (name: string, listener: (typeof quitListeners)[number]) => {
					if (name === 'quit') quitListeners.push(listener);
					return {};
				},
			},
		},
		registerEvent: () => undefined,
		registerDomEvent: (target: EventTarget, type: string, listener: EventListener) => {
			target.addEventListener(type, listener);
			heard.push({ target, type, listener });
		},
		pageLeaving: false,
		// What a rename tells besides the records it carries: nothing these
		// tests look at, and nothing that reads or writes.
		history: { notePathRenamed: vi.fn() },
		carryExplorerChoices: vi.fn(),
		carryRosterThroughRename: vi.fn(),
		scheduleStickyNoteNotify: vi.fn(),
		scheduleProjectRescan: vi.fn(),
		scheduleDefinitionMaterialize: vi.fn(),
		invalidateProjectDiscovery: vi.fn(),
		holdsProjectMetadata: () => false,
		detachProjectViews: vi.fn(),
		fieldsReconcilePaused: false,
		renameCarry: Promise.resolve(),
		projects: service,
		settings: { ...DEFAULT_SETTINGS, projectRoot: 'Novels' },
		saveData: (data: SnowflakeSettings) => {
			saved.push(data);
			return saving;
		},
		settingsSaveQueue: Promise.resolve(),
		settingsSaveTimer: null,
		settingsWrites: 0,
		dashboardDataChanges: 0,
		rosterSignature: null,
		refreshTimer: null,
		refreshProjectLocales: false,
		fieldsReconcileTimer: null,
		pendingFieldsReconciles: new Set<string>(),
		recording: null,
		unloading: false,
		sessions,
		stickyLayers: new Map(),
		stickyNoteHub: { claims: { settleAll } },
		sceneManuscriptGraph: { settleForQuit: () => graphWrite },
		explorer,
		dressNotes,
		refreshParagraphLineEditors,
		projectLocalesById: new Map(),
		knownProjectRoots: new Set(),
		projectLocalesByRoot: new Map(),
		knownProjectsByRoot: new Map(),
		externalDrafts: new Map(),
		explorerRoots: new Set(),
		updatableSiblingsByProject: new Map(),
		projectHealth: new Map(),
	});
	return {
		env,
		service,
		stop,
		plugin: plugin as unknown as Host,
		saved,
		leaves,
		sessions,
		explorer,
		dressNotes,
		refreshParagraphLineEditors,
		settleAll,
		oweGraph: (write: Promise<void>): void => {
			graphWrite = write;
		},
		holdSaves: (): (() => void) => {
			const gate = deferred();
			saving = gate.promise;
			return gate.resolve;
		},
		/** The vault is a folder on this computer's disk, as on the desktop. */
		onDisk: (): void => {
			vault.adapter = new FileSystemAdapter();
		},
		/** The app announces its quit, and hands over the list a listener adds its tasks to. */
		quit: (): Promise<unknown>[] => {
			const tasks: Promise<unknown>[] = [];
			for (const listener of quitListeners) {
				listener({ add: (callback) => void tasks.push(callback()) });
			}
			return tasks;
		},
		/** Takes the plugin's listeners off the page these tests share. */
		unhook: (): void => {
			for (const { target, type, listener } of heard) target.removeEventListener(type, listener);
		},
	};
}

/** The page reports itself hidden, or shown again. */
function setHidden(hidden: boolean): void {
	Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
	document.dispatchEvent(new Event('visibilitychange'));
}

describe('what the host counts as a change to what a dashboard draws', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('moves with the vault, with a setting saved and with a refresh asked for, and stands still otherwise', async () => {
		const { plugin, env, stop } = await host();
		const at = (): number => plugin.dashboardEpoch();
		let before = at();
		expect(at()).toBe(before);

		await env.fakeVault.seedFile('Novels/Loose.md', 'a note');
		expect(at()).toBeGreaterThan(before);
		before = at();
		env.fakeVault.write('Novels/Loose.md', 'a note, written again');
		expect(at()).toBeGreaterThan(before);
		before = at();
		env.fakeVault.rename('Novels/Loose.md', 'Novels/Looser.md');
		expect(at()).toBeGreaterThan(before);
		before = at();
		env.fakeVault.delete('Novels/Looser.md');
		expect(at()).toBeGreaterThan(before);

		before = at();
		await plugin.saveSettings();
		expect(at()).toBeGreaterThan(before);
		before = at();
		plugin.saveSettingsSoon();
		expect(at()).toBeGreaterThan(before);
		before = at();
		plugin.scheduleRefresh();
		expect(at()).toBeGreaterThan(before);
		window.clearTimeout(plugin.refreshTimer ?? undefined);

		// And nothing else moves it: asked twice, it says the same.
		before = at();
		expect(at()).toBe(before);
		stop();
	});

	it('remembers a step without moving the count, and without a write per step', async () => {
		const { plugin, saved, stop } = await host();
		const before = plugin.dashboardEpoch();
		await plugin.selectStep(4);
		await plugin.selectStep(5);
		await plugin.selectStep(6);
		// Chosen at once, in memory; nothing has gone to the disk for it yet.
		expect(plugin.settings.recentStep).toBe(6);
		expect(saved).toHaveLength(0);
		expect(plugin.dashboardEpoch()).toBe(before);

		await vi.advanceTimersByTimeAsync(399);
		expect(saved).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		// One write for the whole walk through the steps, holding the last.
		expect(saved).toHaveLength(1);
		expect(saved[0]?.recentStep).toBe(6);
		// The write itself is no change to what a dashboard draws either.
		expect(plugin.dashboardEpoch()).toBe(before);

		// The step already remembered asks for nothing at all.
		await plugin.selectStep(6);
		await vi.advanceTimersByTimeAsync(1000);
		expect(saved).toHaveLength(1);
		stop();
	});

	it('writes the celebration’s flag at once without counting it as a change', async () => {
		const { plugin, saved, stop } = await host();
		const before = plugin.dashboardEpoch();
		// Asked from inside the drawing of the last step: a count moved here
		// sent that very drawing off to read the project again.
		expect(await plugin.syncCertificateCelebration('novel', true)).toBe(true);
		expect(saved).toHaveLength(1);
		expect(saved[0]?.certificateCelebrations).toEqual({ novel: true });
		expect(plugin.dashboardEpoch()).toBe(before);
		// Asked again, it has nothing to write.
		expect(await plugin.syncCertificateCelebration('novel', true)).toBe(false);
		expect(saved).toHaveLength(1);
		stop();
	});

	it('tells the roster’s followers only when the roster moved', async () => {
		const { plugin, service, env, explorer, dressNotes, refreshParagraphLineEditors, stop } = await host();
		const alpha = await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
		await plugin.scanProjects();
		expect(explorer.projectsChanged).toHaveBeenCalledTimes(1);
		expect(dressNotes).toHaveBeenCalledTimes(1);
		expect(refreshParagraphLineEditors).toHaveBeenCalledTimes(1);

		// The same projects found again: nobody is told, however often.
		await plugin.scanProjects();
		await plugin.scanProjects();
		// A note written inside a project is no change to the roster.
		await service.createCharacter(alpha.projectFile, 'Ada');
		await plugin.scanProjects();
		expect(explorer.projectsChanged).toHaveBeenCalledTimes(1);
		expect(dressNotes).toHaveBeenCalledTimes(1);
		expect(refreshParagraphLineEditors).toHaveBeenCalledTimes(1);

		// A project more, a project renamed, a project gone: each is told.
		await service.createProject({ name: 'Beta', rootPath: 'Novels', locale: 'zh-CN' });
		await plugin.scanProjects();
		expect(explorer.projectsChanged).toHaveBeenCalledTimes(2);
		await service.renameProject(alpha.projectFile, 'Alpha, renamed');
		await plugin.scanProjects();
		expect(explorer.projectsChanged).toHaveBeenCalledTimes(3);
		env.fakeVault.delete('Novels/Beta');
		await plugin.scanProjects();
		expect(explorer.projectsChanged).toHaveBeenCalledTimes(4);
		expect(dressNotes).toHaveBeenCalledTimes(4);

		// Tools made after a scan have heard nothing: the next scan tells them.
		plugin.rosterSignature = null;
		await plugin.scanProjects();
		expect(explorer.projectsChanged).toHaveBeenCalledTimes(5);
		stop();
	});

	it('tells them again when settings arrive from outside, the roster standing as it was', async () => {
		const { plugin, service, explorer, dressNotes, refreshParagraphLineEditors, stop } = await host();
		await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
		await plugin.scanProjects();
		expect(dressNotes).toHaveBeenCalledTimes(1);

		// Another device's settings land: a new size for the page, focus mode
		// turned off. No project came or went.
		const arrived = { ...plugin.settings, manuscriptFontSize: 24, manuscriptFocusLevel: 'off' };
		Object.assign(plugin, {
			loadData: () => Promise.resolve(arrived),
			projectScanReady: Promise.resolve(),
			projectDiscoveryPromise: null,
			applyBodyPreferences: vi.fn(),
			publishScrollbarWidth: vi.fn(),
			rerenderStatisticsViews: vi.fn(),
			syncExplorer: vi.fn(),
			refreshDashboards: vi.fn(() => Promise.resolve()),
		});
		await plugin.onExternalSettingsChange();
		// The open notes are dressed by what arrived, and their lines marked by it.
		expect(dressNotes).toHaveBeenCalledTimes(2);
		expect(refreshParagraphLineEditors).toHaveBeenCalledTimes(2);
		expect(explorer.projectsChanged).toHaveBeenCalledTimes(2);

		// And only once: the scans after it find nothing moved.
		await plugin.scanProjects();
		expect(dressNotes).toHaveBeenCalledTimes(2);
		stop();
	});

	it('tells them when the current project or its language moves', async () => {
		const { plugin, service, explorer, dressNotes, stop } = await host();
		const alpha = await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
		await plugin.scanProjects();
		expect(explorer.projectsChanged).toHaveBeenCalledTimes(1);
		// The explorer's cover follows the current project.
		plugin.settings.recentProjectPath = alpha.projectFile;
		await plugin.scanProjects();
		expect(explorer.projectsChanged).toHaveBeenCalledTimes(2);
		// The bars over notes of no project speak its language.
		plugin.currentProjectLocale = 'zh-CN';
		await plugin.scanProjects();
		expect(explorer.projectsChanged).toHaveBeenCalledTimes(3);
		expect(dressNotes).toHaveBeenCalledTimes(3);
		await plugin.scanProjects();
		expect(explorer.projectsChanged).toHaveBeenCalledTimes(3);
		stop();
	});
});

describe('what a quit waits for', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('waits for nothing where nothing is owed, and still takes the session’s snapshot', async () => {
		const { plugin, sessions, saved, stop } = await host();
		// Null is what keeps the app's saving screen away.
		expect(plugin.settleForQuit()).toBeNull();
		expect(sessions.markShutdown).toHaveBeenCalledTimes(1);
		expect(saved).toHaveLength(0);
		stop();
	});

	it('writes a setting still waiting on its timer, and waits for the write', async () => {
		const { plugin, saved, holdSaves, stop } = await host();
		const landed = holdSaves();
		await plugin.selectStep(7);
		expect(saved).toHaveLength(0);
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await microtasks();
		// Sent at once, not when its timer would have fired.
		expect(saved).toHaveLength(1);
		expect(saved[0]?.recentStep).toBe(7);
		expect(over).toBe(false);
		landed();
		await ended(settling);
		expect(over).toBe(true);
		// The timer that was waiting is gone: nothing is written twice.
		await vi.advanceTimersByTimeAsync(1000);
		expect(saved).toHaveLength(1);
		stop();
	});

	it('waits for a settings write already on its way', async () => {
		const { plugin, saved, holdSaves, stop } = await host();
		const landed = holdSaves();
		void plugin.saveSettings();
		await microtasks();
		expect(saved).toHaveLength(1);
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await microtasks();
		expect(over).toBe(false);
		landed();
		await ended(settling);
		expect(over).toBe(true);
		stop();
	});

	it('sends every stream’s unwritten words and every sticky note’s, and waits for them', async () => {
		const { plugin, leaves, settleAll, stop } = await host();
		const streamWrite = deferred();
		const noteWrite = deferred();
		const owing = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
		const settleSaves = vi.fn(() => streamWrite.promise);
		Object.assign(owing, { settleSaves });
		const clean = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
		Object.assign(clean, { settleSaves: () => null });
		leaves.set(MANUSCRIPT_VIEW_TYPE, [{ view: owing }, { view: clean }, { view: {} }]);
		settleAll.mockReturnValue(noteWrite.promise);

		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		expect(settleSaves).toHaveBeenCalledTimes(1);
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		streamWrite.resolve();
		await microtasks();
		expect(over).toBe(false);
		settleAll.mockReturnValue(null);
		noteWrite.resolve();
		await ended(settling);
		expect(over).toBe(true);
		stop();
	});

	it('settles the workspaces as an unload does, and waits for the writes they queue', async () => {
		const { plugin, leaves, stop } = await host();
		const queued = deferred();
		const board = Object.create(SnowflakeStoryStructureView.prototype) as SnowflakeStoryStructureView;
		const settleForUnload = vi.fn(() => {
			// A board commits the words open in it without waiting for the write.
			void writeUnderWay(queued.promise);
		});
		Object.assign(board, { settleForUnload });
		leaves.set(STORY_STRUCTURE_VIEW_TYPE, [{ view: board }]);

		const settling = plugin.settleForQuit();
		expect(settleForUnload).toHaveBeenCalledTimes(1);
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await microtasks();
		expect(over).toBe(false);
		queued.resolve();
		await ended(settling);
		expect(over).toBe(true);
		stop();
	});

	it('is not stopped by one surface that fails to answer', async () => {
		const { plugin, leaves, sessions, saved, stop } = await host();
		const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const broken = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
		Object.assign(broken, {
			settleSaves: () => {
				throw new Error('this stream is in a bad way');
			},
		});
		const streamWrite = deferred();
		const sound = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
		const settleSaves = vi.fn(() => streamWrite.promise);
		Object.assign(sound, { settleSaves });
		leaves.set(MANUSCRIPT_VIEW_TYPE, [{ view: broken }, { view: sound }]);
		const board = Object.create(SnowflakeStoryStructureView.prototype) as SnowflakeStoryStructureView;
		Object.assign(board, {
			settleForUnload: () => {
				throw new Error('this board is in a bad way');
			},
		});
		leaves.set(STORY_STRUCTURE_VIEW_TYPE, [{ view: board }]);
		sessions.markShutdown.mockImplementation(() => {
			throw new Error('the session store is in a bad way');
		});
		await plugin.selectStep(8);

		const settling = plugin.settleForQuit();
		// The sound stream and the settings were still sent, and are waited for.
		expect(settling).not.toBeNull();
		expect(settleSaves).toHaveBeenCalledTimes(1);
		await microtasks();
		expect(saved).toHaveLength(1);
		streamWrite.resolve();
		await ended(settling);
		expect(said).toHaveBeenCalledTimes(3);
		said.mockRestore();
		stop();
	});

	it('waits for the native graph’s options where a tab holds some its file does not', async () => {
		const { plugin, oweGraph, stop } = await host();
		const write = deferred();
		oweGraph(write.promise);
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await microtasks();
		expect(over).toBe(false);
		write.resolve();
		await ended(settling);
		expect(over).toBe(true);
		stop();
	});

	it('waits for a write the repository has on its way', async () => {
		const { plugin, service, env, stop } = await host();
		await env.fakeVault.seedFile('Novels/Loose.md', 'a note');
		const landing = deferred();
		const process = env.fakeVault.process.bind(env.fakeVault);
		env.fakeVault.process = async (file, callback) => {
			await landing.promise;
			return process(file, callback);
		};
		const write = service.repository.updatePlainFile('Novels/Loose.md', (text) => `${text}!`);
		expect(service.repository.writing).toBe(true);
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		// Still out: the hold stands however long the clock runs.
		expect(over).toBe(false);
		expect(env.fakeVault.contents.get('Novels/Loose.md')).toBe('a note');
		landing.resolve();
		await ended(settling);
		expect(over).toBe(true);
		expect(env.fakeVault.contents.get('Novels/Loose.md')).toBe('a note!');
		await write;
		stop();
	});

	it('does not let go between two writes of one change', async () => {
		const { plugin, service, env, stop } = await host();
		await env.fakeVault.seedFile('Novels/Loose.md', 'a note');
		const second = deferred();
		const process = env.fakeVault.process.bind(env.fakeVault);
		let writes = 0;
		env.fakeVault.process = async (file, callback) => {
			writes += 1;
			if (writes === 2) await second.promise;
			return process(file, callback);
		};
		// One change of two writes, nobody having said it is under way, with
		// the note read back from the disk between them as a save reads it.
		const change = (async () => {
			await service.repository.updatePlainFile('Novels/Loose.md', (text) => `${text}!`);
			await new Promise<void>((resolve) => {
				window.setTimeout(resolve, 10);
			});
			await service.repository.updatePlainFile('Novels/Loose.md', (text) => `${text}?`);
		})();
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		// The first write has landed and nothing is counted: the hold stands.
		await vi.advanceTimersByTimeAsync(9);
		expect(env.fakeVault.contents.get('Novels/Loose.md')).toBe('a note!');
		expect(service.repository.writing).toBe(false);
		expect(over).toBe(false);
		// The second is out now and held open, and so is the quit.
		await vi.advanceTimersByTimeAsync(500);
		expect(service.repository.writing).toBe(true);
		expect(over).toBe(false);
		second.resolve();
		await ended(settling);
		expect(over).toBe(true);
		expect(env.fakeVault.contents.get('Novels/Loose.md')).toBe('a note!?');
		await change;
		stop();
	});

	it('holds a change from the fetching of its project, before anything is written', async () => {
		const { plugin, service, stop } = await host();
		const alpha = await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
		const fetched = deferred();
		const load = service.loadProject.bind(service);
		const loading = vi.spyOn(service, 'loadProject').mockImplementationOnce(async (locator) => {
			await fetched.promise;
			return load(locator);
		});
		// A save begins by fetching the project it is to change.
		const fetching = plugin.requireProject(alpha.projectFile);
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(over).toBe(false);
		fetched.resolve();
		await fetching;
		await ended(settling);
		expect(over).toBe(true);
		loading.mockRestore();
		stop();
	});

	it('holds a change made through a document’s gate for all of it', async () => {
		const { plugin, service, stop } = await host();
		const alpha = await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
		const written = deferred();
		const bell = { ring: vi.fn() };
		// The board that asks does not wait for the answer.
		const answer = plugin.mutateDocument(
			bell,
			alpha.projectFile,
			async () => {
				await written.promise;
				return { result: 'took', changed: true };
			},
			'refused',
		);
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		// Its project is fetched and its write is not out yet: still held.
		expect(over).toBe(false);
		written.resolve();
		await ended(settling);
		expect(over).toBe(true);
		expect(await answer).toBe('took');
		expect(bell.ring).toHaveBeenCalledTimes(1);
		stop();
	});

	it('holds while a project’s folder is being moved, and for the name written after it', async () => {
		const { plugin, service, env, stop } = await host();
		const alpha = await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
		const moved = deferred();
		const moving = deferred();
		const rename = env.fakeFileManager.renameFile.bind(env.fakeFileManager);
		env.fakeFileManager.renameFile = async (file, to) => {
			// The app moves the folder and rewrites every link into it before it answers.
			moving.resolve();
			await moved.promise;
			return rename(file, to);
		};
		const renaming = service.renameProject(alpha.projectFile, 'Beta');
		await moving.promise;
		expect(service.repository.writing).toBe(true);
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(over).toBe(false);
		moved.resolve();
		await ended(settling);
		expect(over).toBe(true);
		// The whole rename landed inside the hold: the folder, and the name in it.
		const renamed = await renaming;
		expect(renamed.rootPath).toBe('Novels/Beta');
		expect(renamed.title).toBe('Beta');
		stop();
	});

	it('holds for what a rename still has to carry', async () => {
		const { plugin, env, stop } = await host();
		const file = await env.fakeVault.seedFile('Elsewhere/Chapter.md', 'words');
		const crossed = deferred();
		const carried: string[] = [];
		Object.assign(plugin, {
			// The carry reads the projects before it files anything under the new name.
			projectsCrossedByRename: async (from: string, to: string) => {
				await crossed.promise;
				carried.push(`${from} -> ${to}`);
				return [];
			},
		});
		env.fakeVault.rename('Elsewhere/Chapter.md', 'Elsewhere/Chapter 1.md');
		await plugin.handleVaultRename(file, 'Elsewhere/Chapter.md');
		// The listener has answered, and nothing has been written yet.
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(over).toBe(false);
		crossed.resolve();
		await ended(settling);
		expect(over).toBe(true);
		expect(carried).toEqual(['Elsewhere/Chapter.md -> Elsewhere/Chapter 1.md']);
		stop();
	});

	it('owes the settings from the moment the projects’ root moves with its folder', async () => {
		const { plugin, env, saved, stop } = await host();
		await env.fakeVault.createFolder('Novels');
		const followed = deferred();
		Object.assign(plugin, {
			projectsCrossedByRename: async () => [],
			// The views follow the folder, which reads their projects again.
			renameProjectViews: () => followed.promise,
		});
		env.fakeVault.rename('Novels', 'Books');
		const folder = env.fakeVault.getAbstractFileByPath('Books');
		const handling = plugin.handleVaultRename(folder, 'Novels');
		await microtasks();
		expect(plugin.settings.projectRoot).toBe('Books');
		expect(saved).toHaveLength(0);
		// A quit in that reading sends the new root on its way.
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		await microtasks();
		expect(saved).toHaveLength(1);
		expect(saved[0]?.projectRoot).toBe('Books');
		followed.resolve();
		await handling;
		await ended(settling);
		// The handler's own save found nothing left waiting on the timer.
		await vi.advanceTimersByTimeAsync(1000);
		expect(saved.every((written) => written.projectRoot === 'Books')).toBe(true);
		window.clearTimeout(plugin.refreshTimer ?? undefined);
		stop();
	});

	it('holds for a fields reconcile that has already begun', async () => {
		const { plugin, stop } = await host();
		const drained = deferred();
		Object.assign(plugin, { drainFieldsBlockReconciles: () => drained.promise });
		plugin.scheduleFieldsBlockReconcile('Novels/Alpha/20_Characters/Ada.md');
		await vi.advanceTimersByTimeAsync(1000);
		// The timer has fired and is gone: the pass is reading, and nothing
		// but its own note of itself says so.
		expect(plugin.fieldsReconcileTimer).toBeNull();
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(over).toBe(false);
		drained.resolve();
		await ended(settling);
		expect(over).toBe(true);
		stop();
	});

	it('drains a fields reconcile that the hold’s own writes ask for', async () => {
		const { plugin, stop } = await host();
		const drained = vi.fn(async () => undefined);
		Object.assign(plugin, { drainFieldsBlockReconciles: drained });
		// A write the quit sent rings for the reconcile a second later, which
		// a closing window would not live to see.
		const queued = deferred();
		void writeUnderWay(queued.promise);
		const settling = plugin.settleForQuit();
		expect(drained).not.toHaveBeenCalled();
		Object.assign(plugin, { fieldsReconcileTimer: window.setTimeout(() => undefined, 1000) });
		queued.resolve();
		await ended(settling);
		expect(drained).toHaveBeenCalledTimes(1);
		expect((plugin as unknown as { fieldsReconcileTimer: number | null }).fieldsReconcileTimer).toBeNull();
		stop();
	});
});

describe('what the host does as the app goes out of sight', () => {
	it('sends what was typed to the disk and takes nothing down', async () => {
		vi.useFakeTimers();
		const { plugin, leaves, sessions, saved, settleAll, stop } = await host();
		const stream = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
		const settleSaves = vi.fn(() => Promise.resolve());
		Object.assign(stream, { settleSaves });
		leaves.set(MANUSCRIPT_VIEW_TYPE, [{ view: stream }]);
		const board = Object.create(SnowflakeStoryStructureView.prototype) as SnowflakeStoryStructureView;
		const settleForUnload = vi.fn();
		const keepBoard = vi.fn();
		Object.assign(board, { settleForUnload, settleOutOfSight: keepBoard });
		// One board that cannot answer does not leave the next one unasked.
		const broken = Object.create(SnowflakeStoryStructureView.prototype) as SnowflakeStoryStructureView;
		Object.assign(broken, {
			settleOutOfSight: () => {
				throw new Error('this board is in a bad way');
			},
		});
		leaves.set(STORY_STRUCTURE_VIEW_TYPE, [{ view: broken }, { view: board }]);
		const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const drained = vi.fn(() => Promise.resolve());
		Object.assign(plugin, {
			drainFieldsBlockReconciles: drained,
			fieldsReconcileTimer: window.setTimeout(() => undefined, 1000),
		});
		await plugin.selectStep(2);

		plugin.settleOutOfSight();
		await microtasks();
		expect(settleSaves).toHaveBeenCalledTimes(1);
		expect(settleAll).toHaveBeenCalledTimes(1);
		expect(saved).toHaveLength(1);
		// A checkpoint, which ends nothing: the app usually comes back.
		expect(sessions.checkpoint).toHaveBeenCalledTimes(1);
		expect(sessions.markShutdown).not.toHaveBeenCalled();
		// The boards keep what is typed on them, and are not taken down.
		expect(keepBoard).toHaveBeenCalledTimes(1);
		expect(settleForUnload).not.toHaveBeenCalled();
		expect(said).toHaveBeenCalledTimes(1);
		// The reconcile a note's write asked for is run, its timer gone.
		expect(drained).toHaveBeenCalledTimes(1);
		expect(plugin.fieldsReconcileTimer).toBeNull();
		said.mockRestore();
		stop();
		vi.useRealTimers();
	});
});

describe('what the host hears of the page going out of sight, and of its going for good', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		setHidden(false);
		vi.useRealTimers();
	});

	/** A stream holding words its note does not, and a setting waiting on its timer. */
	async function owing() {
		const made = await host();
		const stream = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
		const settleSaves = vi.fn(() => Promise.resolve());
		Object.assign(stream, { settleSaves });
		made.leaves.set(MANUSCRIPT_VIEW_TYPE, [{ view: stream }]);
		await made.plugin.selectStep(3);
		made.plugin.registerSettling();
		return { ...made, settleSaves };
	}

	it('settles what was typed when the page is hidden, and not when it is shown again', async () => {
		const { settleSaves, saved, unhook, stop } = await owing();
		setHidden(true);
		await microtasks();
		expect(settleSaves).toHaveBeenCalledTimes(1);
		expect(saved).toHaveLength(1);
		setHidden(false);
		await microtasks();
		expect(settleSaves).toHaveBeenCalledTimes(1);
		unhook();
		stop();
	});

	it('starts nothing in a page that is being reloaded or closed', async () => {
		const { settleSaves, settleAll, sessions, saved, unhook, stop } = await owing();
		// A page on its way out says so first, and only then reports itself
		// hidden. No quit is announced for a reload.
		window.dispatchEvent(new Event('pagehide'));
		setHidden(true);
		await microtasks();
		expect(saved).toHaveLength(0);
		expect(settleSaves).not.toHaveBeenCalled();
		expect(settleAll).not.toHaveBeenCalled();
		expect(sessions.checkpoint).not.toHaveBeenCalled();
		unhook();
		stop();
	});

	it('still settles as a page set aside for a return goes out of sight', async () => {
		const { settleSaves, saved, unhook, stop } = await owing();
		// Kept whole, to be shown again: not a page on its way out.
		const kept = new Event('pagehide');
		Object.defineProperty(kept, 'persisted', { value: true });
		window.dispatchEvent(kept);
		setHidden(true);
		await microtasks();
		expect(settleSaves).toHaveBeenCalledTimes(1);
		expect(saved).toHaveLength(1);
		unhook();
		stop();
	});

	it('starts nothing more once a quit has been announced', async () => {
		const { quit, settleSaves, saved, unhook, stop } = await owing();
		const tasks = quit();
		await microtasks();
		// The quit itself sent what was owed, once.
		expect(tasks).toHaveLength(1);
		expect(settleSaves).toHaveBeenCalledTimes(1);
		expect(saved).toHaveLength(1);
		// The window then goes, and is hidden as it does.
		setHidden(true);
		await microtasks();
		expect(settleSaves).toHaveBeenCalledTimes(1);
		expect(saved).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(3000);
		await Promise.all(tasks);
		unhook();
		stop();
	});

	it('leaves the settings file to its timer where the vault is on this computer’s disk', async () => {
		const { onDisk, settleSaves, saved, unhook, stop } = await owing();
		onDisk();
		setHidden(true);
		await microtasks();
		// The words still go to their notes, whose saves read before they write.
		expect(settleSaves).toHaveBeenCalledTimes(1);
		// The settings file is written in place, and is not begun here.
		expect(saved).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(400);
		expect(saved).toHaveLength(1);
		expect(saved[0]?.recentStep).toBe(3);
		unhook();
		stop();
	});
});
