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
	settleForQuit(): Promise<void> | null;
	settleOutOfSight(): void;
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

async function host() {
	const env = createFakeEnvironment();
	const service = new SnowflakeProjectService(env.vault, env.fileManager, env.metadataCache);
	const stop = service.repository.watch();
	const saved: SnowflakeSettings[] = [];
	const leaves = new Map<string, { view: unknown }[]>();
	const sessions = { markShutdown: vi.fn(), checkpoint: vi.fn() };
	const explorer = { projectsChanged: vi.fn() };
	const dressNotes = vi.fn();
	const refreshParagraphLineEditors = vi.fn();
	const settleAll = vi.fn<() => Promise<void> | null>(() => null);
	let graphWrite: Promise<void> | null = null;
	let saving: Promise<void> = Promise.resolve();
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	Object.assign(plugin, {
		app: {
			workspace: {
				getLeavesOfType: (type: string) => leaves.get(type) ?? [],
				containerEl: { win: window, doc: document },
			},
		},
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
	};
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
		await settling;
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
		await settling;
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
		await settling;
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
		await settling;
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
		await settling;
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
		await settling;
		expect(over).toBe(true);
		stop();
	});

	it('waits for a write the repository has on its way, and for one that follows it', async () => {
		const { plugin, service, env, stop } = await host();
		await env.fakeVault.seedFile('Novels/Loose.md', 'a note');
		const first = service.repository.updatePlainFile('Novels/Loose.md', (text) => `${text}!`);
		expect(service.repository.writing).toBe(true);
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		// A write set going by the first one's landing, as a save sets its levelling going.
		const second = first.then(() => service.repository.updatePlainFile('Novels/Loose.md', (text) => `${text}?`));
		await settling;
		await second;
		expect(env.fakeVault.contents.get('Novels/Loose.md')).toBe('a note!?');
		expect(service.repository.writing).toBe(false);
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
		Object.assign(board, { settleForUnload });
		leaves.set(STORY_STRUCTURE_VIEW_TYPE, [{ view: board }]);
		await plugin.selectStep(2);

		plugin.settleOutOfSight();
		await microtasks();
		expect(settleSaves).toHaveBeenCalledTimes(1);
		expect(settleAll).toHaveBeenCalledTimes(1);
		expect(saved).toHaveLength(1);
		// A checkpoint, which ends nothing: the app usually comes back.
		expect(sessions.checkpoint).toHaveBeenCalledTimes(1);
		expect(sessions.markShutdown).not.toHaveBeenCalled();
		expect(settleForUnload).not.toHaveBeenCalled();
		stop();
		vi.useRealTimers();
	});
});
