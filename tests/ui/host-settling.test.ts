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

import { EditorUnsavedError } from '../../api/index';
import SnowflakeMethodPlugin from '../../src/main';
import { DEFAULT_SETTINGS, type SnowflakeSettings } from '../../src/settings';
import { SnowflakeProjectService } from '../../src/services';
import { DASHBOARD_VIEW_TYPE, SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import { MANUSCRIPT_VIEW_TYPE, SnowflakeManuscriptView } from '../../src/ui/manuscript-view';
import { writeUnderWay, writesUnderWay } from '../../src/ui/pending-writes';
import { STORY_STRUCTURE_VIEW_TYPE, SnowflakeStoryStructureView } from '../../src/ui/story-structure-view';

/** What these tests reach of the plugin that its type keeps to itself. */
interface Host {
	settings: SnowflakeSettings;
	dashboardEpoch(): number;
	watchVault(): () => void;
	activateProject(path: string, locale: string, step: number): void;
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
	levelMarginRecords(path: string, body: string): Promise<void>;
	runCanvasExport(projectPath: string | null, plan: () => Promise<unknown>): Promise<void>;
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
	listProjects(): Promise<{ path: string; rootPath: string; title: string }[]>;
	listProjectsWithHealth(): Promise<{ rootPath: string; hasStructureIssues: boolean; hasMarkerIssues: boolean }[]>;
	knownProjectHealth(rootPath: string): { hasStructureIssues: boolean; hasMarkerIssues: boolean } | null;
	invalidateProjectHealth(path: string): void;
	drawDashboardsOnShow(): Promise<void>;
	streamsOnShowRead(): Promise<void>;
	releaseNotesForWriter(paths: readonly string[]): Promise<void>;
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
		fieldsReconcileHolds: 0,
		renameCarry: Promise.resolve(),
		projects: service,
		settings: { ...DEFAULT_SETTINGS, projectRoot: 'Novels' },
		saveData: (data: SnowflakeSettings) => {
			saved.push(data);
			return saving;
		},
		settingsSaveQueue: Promise.resolve(),
		settingsSaveTimer: null,
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
		projectHealthKnown: new Map(),
		// The layout is ready, and no scan is under way.
		projectScanReady: Promise.resolve(),
		projectDiscoveryPromise: null,
	});
	// The vault is listened to as the plugin listens to it when it loads.
	const stop = (plugin as unknown as Host).watchVault();
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

	it('does not count a manuscript cache written afresh, and counts one made, moved or taken away', async () => {
		const { plugin, env, service, stop } = await host();
		const at = (): number => plugin.dashboardEpoch();
		const index = 'Novels/Book/70_Tool/71_Data_Statistics/713_Entity_Tracking/desk_mention_index.json';
		const stats = 'Novels/Book/70_Tool/71_Data_Statistics/713_Entity_Tracking/desk_analysis_stats.json';
		// Made: the structure report says which caches stand, so this counts.
		let before = at();
		await env.fakeVault.seedFile(index, '{}');
		expect(at()).toBeGreaterThan(before);
		before = at();
		await env.fakeVault.seedFile(stats, '{}');
		expect(at()).toBeGreaterThan(before);

		// Written afresh, as five seconds after every pause in the typing:
		// nothing a dashboard draws is read from a cache's words.
		before = at();
		const tree = service.repository.treeVersion ?? -1;
		env.fakeVault.write(index, '{"notes":{}}');
		env.fakeVault.write(stats, '{"notes":{}}');
		expect(at()).toBe(before);
		// The repository's own count is of every change, these two included.
		expect(service.repository.treeVersion).toBe(tree + 2);

		// A file that only looks like one, in another folder, is a note like any other.
		await env.fakeVault.seedFile('Novels/Book/desk_mention_index.json', '{}');
		before = at();
		env.fakeVault.write('Novels/Book/desk_mention_index.json', '{"a":1}');
		expect(at()).toBeGreaterThan(before);

		// Moved or taken away, a cache counts again.
		before = at();
		env.fakeVault.rename(stats, 'Novels/Book/70_Tool/71_Data_Statistics/713_Entity_Tracking/laptop_analysis_stats.json');
		expect(at()).toBeGreaterThan(before);
		before = at();
		env.fakeVault.delete(index);
		expect(at()).toBeGreaterThan(before);
		stop();
		// Once the listening has stopped, nothing more is counted.
		before = at();
		await env.fakeVault.seedFile('Novels/After.md', 'a note');
		expect(at()).toBe(before);
	});

	it('remembers the step a tab is brought forward on without counting it, and counts another project', async () => {
		const { plugin, saved, stop } = await host();
		Object.assign(plugin, {
			rerenderStatisticsViews: vi.fn(),
			explorer: { followCurrentProject: vi.fn() },
			settings: { ...plugin.settings, recentProjectPath: 'Novels/Book/Project.md', recentStep: 2 },
			currentProjectLocale: 'en',
		});
		const before = plugin.dashboardEpoch();
		// A dashboard restored on another step than the one last saved.
		plugin.activateProject('Novels/Book/Project.md', 'en', 7);
		expect(plugin.settings.recentStep).toBe(7);
		expect(plugin.dashboardEpoch()).toBe(before);
		// Remembered a moment later, in one write.
		expect(saved).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(400);
		expect(saved).toHaveLength(1);
		expect(saved[0]?.recentStep).toBe(7);
		expect(plugin.dashboardEpoch()).toBe(before);

		// The very same again asks for nothing.
		plugin.activateProject('Novels/Book/Project.md', 'en', 7);
		await vi.advanceTimersByTimeAsync(1000);
		expect(saved).toHaveLength(1);

		// Another project is a change to what the dashboards draw, written at once.
		plugin.activateProject('Novels/Other/Project.md', 'en', 7);
		expect(plugin.dashboardEpoch()).toBeGreaterThan(before);
		await microtasks();
		expect(saved).toHaveLength(2);
		expect(saved[1]?.recentProjectPath).toBe('Novels/Other/Project.md');
		// And so is the same project in another language.
		const then = plugin.dashboardEpoch();
		plugin.activateProject('Novels/Other/Project.md', 'zh', 7);
		expect(plugin.dashboardEpoch()).toBeGreaterThan(then);
		await microtasks();
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

	it('remembers a step whether or not the settings can be written, and says a failure in the console', async () => {
		const { plugin, stop } = await host();
		const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		Object.assign(plugin, { saveData: () => Promise.reject(new Error('the disk said no')) });
		// The tap is answered at once and never fails: nothing drawn waits on the disk.
		await expect(plugin.selectStep(9)).resolves.toBeUndefined();
		expect(plugin.settings.recentStep).toBe(9);
		await vi.advanceTimersByTimeAsync(400);
		expect(said).toHaveBeenCalledTimes(1);
		said.mockRestore();
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

/**
 * A dashboard's frame waits on the list of projects, and the list used to
 * wait for the health of every project in the root: one warning icon a row
 * in the switcher, at the price of reading every note of every project. The
 * frame stood empty until the largest of them had been read, though its own
 * project was in hand, and under the picture of the last session the app
 * starts with from 1.15.1 that showed the dashboard, nothing, and the
 * dashboard again.
 */
describe('the projects a dashboard lists', () => {
	const HEALTHY = { hasStructureIssues: false, hasMarkerIssues: false };
	/** What a project wears once its first step's note is plain words: no longer a note of the plugin's. */
	const DAMAGED = { hasStructureIssues: true, hasMarkerIssues: false };

	/** Holds every reading of a project until let go, and counts them. */
	function holdReadings(service: SnowflakeProjectService) {
		const read = service.loadProject.bind(service);
		const gate = deferred();
		const loadProject = vi.spyOn(service, 'loadProject').mockImplementation(async (locator) => {
			await gate.promise;
			return read(locator);
		});
		return { loadProject, letGo: gate.resolve };
	}

	it('answers before any project has been read, and knows each one’s health once it has', async () => {
		const { plugin, service, stop } = await host();
		const alpha = await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
		const beta = await service.createProject({ name: 'Beta', rootPath: 'Novels', locale: 'en' });
		const { loadProject, letGo } = holdReadings(service);

		const listed = await plugin.listProjects();
		// The rows are whole, and nothing of them took reading a project.
		expect(listed).toEqual([
			{ path: alpha.projectFile, rootPath: alpha.rootPath, projectId: alpha.id, title: 'Alpha', readOnly: false, series: null },
			{ path: beta.projectFile, rootPath: beta.rootPath, projectId: beta.id, title: 'Beta', readOnly: false, series: null },
		]);
		// Each one is set being read all the same, once, and is not known yet.
		expect(loadProject).toHaveBeenCalledTimes(2);
		expect(plugin.knownProjectHealth(alpha.rootPath)).toBeNull();
		expect(plugin.knownProjectHealth(beta.rootPath)).toBeNull();

		letGo();
		await vi.waitFor(() => {
			expect(plugin.knownProjectHealth(alpha.rootPath)).toEqual(HEALTHY);
			expect(plugin.knownProjectHealth(beta.rootPath)).toEqual(HEALTHY);
		});
		// Listed again with nothing changed, no project is read again.
		await plugin.listProjects();
		expect(loadProject).toHaveBeenCalledTimes(2);
		stop();
	});

	it('keeps a project’s last known health while it is read again, and then says what the reading found', async () => {
		const { plugin, service, env, stop } = await host();
		const alpha = await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
		await plugin.listProjects();
		await vi.waitFor(() => expect(plugin.knownProjectHealth(alpha.rootPath)).toEqual(HEALTHY));

		// The first step's note is written over by hand: a fault the switcher warns of.
		const stepOne = alpha.artifacts[1]?.path ?? '';
		env.fakeVault.write(stepOne, 'One sentence, written by hand.');
		plugin.invalidateProjectHealth(stepOne);
		// Not read again yet: the row keeps what was last known, not a blank.
		expect(plugin.knownProjectHealth(alpha.rootPath)).toEqual(HEALTHY);

		const { letGo } = holdReadings(service);
		await plugin.listProjects();
		expect(plugin.knownProjectHealth(alpha.rootPath)).toEqual(HEALTHY);
		letGo();
		await vi.waitFor(() =>
			expect(plugin.knownProjectHealth(alpha.rootPath)).toEqual(DAMAGED),
		);
		stop();
	});

	it('does not take the word of a reading that a change has put aside', async () => {
		const { plugin, service, env, stop } = await host();
		const alpha = await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
		const { loadProject, letGo } = holdReadings(service);
		await plugin.listProjects();
		// The project changes while that reading is still out.
		const stepOne = alpha.artifacts[1]?.path ?? '';
		env.fakeVault.write(stepOne, 'One sentence, written by hand.');
		plugin.invalidateProjectHealth(stepOne);
		letGo();
		// That reading ends, having found the project as it stood at some
		// moment of the change: nothing is said from it.
		await loadProject.mock.results[0]?.value;
		await microtasks();
		expect(plugin.knownProjectHealth(alpha.rootPath)).toBeNull();
		// The reading after the change is the one that speaks.
		await plugin.listProjects();
		await vi.waitFor(() =>
			expect(plugin.knownProjectHealth(alpha.rootPath)).toEqual(DAMAGED),
		);
		stop();
	});

	it('waits for every project’s health for the manager, whose rows are drawn once', async () => {
		const { plugin, service, env, stop } = await host();
		const alpha = await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
		const beta = await service.createProject({ name: 'Beta', rootPath: 'Novels', locale: 'en' });
		env.fakeVault.write(beta.artifacts[1]?.path ?? '', 'One sentence, written by hand.');
		const { letGo } = holdReadings(service);

		let rows: Awaited<ReturnType<Host['listProjectsWithHealth']>> | null = null;
		void plugin.listProjectsWithHealth().then((listed) => {
			rows = listed;
		});
		await microtasks();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(rows).toBeNull();
		letGo();
		await vi.waitFor(() => expect(rows).not.toBeNull());
		expect(rows).toMatchObject([
			{ rootPath: alpha.rootPath, title: 'Alpha', ...HEALTHY },
			{ rootPath: beta.rootPath, title: 'Beta', ...DAMAGED },
		]);
		// What the manager waited for, the switcher knows as well.
		expect(plugin.knownProjectHealth(beta.rootPath)).toEqual(DAMAGED);
		stop();
	});

	it('forgets the health of a project that is no longer there', async () => {
		const { plugin, service, env, stop } = await host();
		const alpha = await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
		const beta = await service.createProject({ name: 'Beta', rootPath: 'Novels', locale: 'en' });
		await plugin.listProjects();
		await vi.waitFor(() => expect(plugin.knownProjectHealth(beta.rootPath)).toEqual(HEALTHY));
		env.fakeVault.delete(beta.rootPath);
		expect((await plugin.listProjects()).map((project) => project.rootPath)).toEqual([alpha.rootPath]);
		expect(plugin.knownProjectHealth(beta.rootPath)).toBeNull();
		expect(plugin.knownProjectHealth(alpha.rootPath)).toEqual(HEALTHY);
		stop();
	});
});

/**
 * From 1.15.1 the app covers the window with a picture of the workspace as
 * it last stood while it starts, and lifts it once the layout's callbacks
 * are done, counting whatever promise one hands back. The plugin hands back
 * these two, so the picture comes off panes that are drawn.
 */
describe('what the app’s picture of the last session waits for', () => {
	function dashboard(shown: boolean, draw: () => Promise<void>) {
		const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
		const refreshFromWorkspace = vi.fn(draw);
		Object.assign(view, { containerEl: { isShown: () => shown }, refreshFromWorkspace });
		return { leaf: { view, loadIfDeferred: vi.fn(() => Promise.resolve()) }, refreshFromWorkspace };
	}

	it('is done with the dashboards on show once each is drawn, and draws none that is put away', async () => {
		const { plugin, leaves, stop } = await host();
		const first = deferred();
		const second = deferred();
		const one = dashboard(true, () => first.promise);
		const two = dashboard(true, () => second.promise);
		const away = dashboard(false, () => Promise.resolve());
		// A tab the app has not loaded yet holds a placeholder, not a dashboard.
		const unloaded = { view: { containerEl: { isShown: () => true } }, loadIfDeferred: vi.fn(() => Promise.resolve()) };
		leaves.set(DASHBOARD_VIEW_TYPE, [one.leaf, away.leaf, two.leaf, unloaded]);

		let over = false;
		void plugin.drawDashboardsOnShow().then(() => {
			over = true;
		});
		await microtasks();
		expect(one.refreshFromWorkspace).toHaveBeenCalledOnce();
		expect(two.refreshFromWorkspace).toHaveBeenCalledOnce();
		expect(away.refreshFromWorkspace).not.toHaveBeenCalled();
		expect(away.leaf.loadIfDeferred).not.toHaveBeenCalled();
		expect(unloaded.loadIfDeferred).toHaveBeenCalledOnce();
		first.resolve();
		await microtasks();
		expect(over).toBe(false);
		second.resolve();
		await microtasks();
		expect(over).toBe(true);
		stop();
	});

	it('waits for a stream on show to end the reading it began, and asks it for no other', async () => {
		const { plugin, leaves, stop } = await host();
		const reading = deferred();
		const stream = (shown: boolean, refreshRun: Promise<void> | null) => {
			const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
			const refresh = vi.fn(() => Promise.resolve());
			Object.assign(view, { containerEl: { isShown: () => shown }, refreshRun, refresh });
			return { leaf: { view }, refresh };
		};
		const busy = stream(true, reading.promise);
		const idle = stream(true, null);
		// Put away, and still reading: nothing on show waits for it.
		const away = stream(false, new Promise<void>(() => undefined));
		leaves.set(MANUSCRIPT_VIEW_TYPE, [busy.leaf, idle.leaf, away.leaf, { view: { containerEl: { isShown: () => true } } }]);

		let over = false;
		void plugin.streamsOnShowRead().then(() => {
			over = true;
		});
		await microtasks();
		expect(over).toBe(false);
		reading.resolve();
		await microtasks();
		expect(over).toBe(true);
		for (const each of [busy, idle, away]) expect(each.refresh).not.toHaveBeenCalled();
		stop();
	});

	it('is not held up, or failed, by a stream whose reading failed', async () => {
		const { plugin, leaves, stop } = await host();
		const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
		const failing = Promise.reject(new Error('The manuscript could not be read.'));
		// The reading's own asker reports it; here it is only waited out.
		failing.catch(() => undefined);
		Object.assign(view, { containerEl: { isShown: () => true }, refreshRun: failing });
		leaves.set(MANUSCRIPT_VIEW_TYPE, [{ view }]);
		await expect(plugin.streamsOnShowRead()).resolves.toBeUndefined();
		// With no stream open at all, there is nothing to wait for.
		leaves.set(MANUSCRIPT_VIEW_TYPE, []);
		await expect(plugin.streamsOnShowRead()).resolves.toBeUndefined();
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
		expect(writesUnderWay()).not.toBeNull();
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
		// The first write has landed and nothing is noted: the hold stands.
		await vi.advanceTimersByTimeAsync(9);
		expect(env.fakeVault.contents.get('Novels/Loose.md')).toBe('a note!');
		expect(writesUnderWay()).toBeNull();
		expect(over).toBe(false);
		// The second is out now and held open, and so is the quit.
		await vi.advanceTimersByTimeAsync(500);
		expect(writesUnderWay()).not.toBeNull();
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

	it('asks the recorder only while it has something for a quit to wait for', async () => {
		const idle = await host();
		const settleIdle = vi.fn(() => Promise.resolve());
		Object.assign(idle.plugin, { recording: { holdsQuit: () => false, settle: settleIdle } });
		expect(idle.plugin.settleForQuit()).toBeNull();
		expect(settleIdle).not.toHaveBeenCalled();
		idle.stop();

		const { plugin, stop } = await host();
		const stopped = deferred();
		const settle = vi.fn(() => stopped.promise);
		Object.assign(plugin, { recording: { holdsQuit: () => true, settle } });
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		expect(settle).toHaveBeenCalledTimes(1);
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(over).toBe(false);
		stopped.resolve();
		await ended(settling);
		expect(over).toBe(true);
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
		expect(writesUnderWay()).not.toBeNull();
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

	it('holds for the levelling behind a save, and not for the reading it then asks of every dashboard', async () => {
		const { plugin, service, stop } = await host();
		const levelled = deferred();
		const announced = deferred();
		const store = { refreshAnchorsOnSave: vi.fn(async () => { await levelled.promise; return true; }) };
		Object.assign(service, { marginRecords: [store] });
		Object.assign(plugin, {
			projectRefAtPath: () => ({ rootPath: 'Novels/Alpha' }),
			announceMarginRecordsChanged: () => announced.promise,
		});
		const levelling = plugin.levelMarginRecords('Novels/Alpha/50_Manuscript/One.md', 'words');
		await microtasks();
		// The records are being written: a quit waits.
		expect(writesUnderWay()).not.toBeNull();
		levelled.resolve();
		await microtasks();
		// Written. What is told afterwards reads every project again, and is nobody's to wait for.
		expect(store.refreshAnchorsOnSave).toHaveBeenCalledTimes(1);
		expect(writesUnderWay()).toBeNull();
		expect(plugin.settleForQuit()).toBeNull();
		announced.resolve();
		await levelling;
		stop();
	});

	it('holds for a canvas being written once the author has answered, and not for the question', async () => {
		const { plugin, service, stop } = await host();
		const written = deferred();
		const write = vi.fn(() => written.promise);
		Object.assign(service, { canvasExporter: { write } });
		Object.assign(plugin, {
			resolveProject: () => Promise.resolve({ locale: 'en', readOnly: false }),
			translateForProject: (_locale: unknown, key: string) => key,
			canvasExportWords: () => ({}),
			openManagedFile: () => Promise.resolve(),
		});
		const exporting = plugin.runCanvasExport('Novels/Alpha/Project.md', () =>
			Promise.resolve({ kind: 'canvas', path: 'Novels/Alpha/Board.canvas', exists: false, unchanged: false }),
		);
		await microtasks();
		expect(write).toHaveBeenCalledTimes(1);
		expect(writesUnderWay()).not.toBeNull();
		written.resolve();
		await exporting;
		expect(writesUnderWay()).toBeNull();
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

describe('the one list a quit asks', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('holds for a fields reconcile sent on at the quit, for as long as it reads', async () => {
		const { plugin, stop } = await host();
		// The reconcile is still reading its notes and has written nothing:
		// no write of its own says it is running.
		const reading = deferred();
		const drained = vi.fn(() => reading.promise);
		Object.assign(plugin, {
			drainFieldsBlockReconciles: drained,
			fieldsReconcileTimer: window.setTimeout(() => undefined, 1000),
		});
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		expect(drained).toHaveBeenCalledTimes(1);
		expect(plugin.fieldsReconcileTimer).toBeNull();
		// Noted like any write, which is what holds the quit for it.
		expect(writesUnderWay()).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(over).toBe(false);
		reading.resolve();
		await ended(settling);
		expect(over).toBe(true);
		expect(writesUnderWay()).toBeNull();
		stop();
	});

	it('waits once for a settings write, however it came to be owed', async () => {
		const { plugin, saved, holdSaves, stop } = await host();
		const land = holdSaves();
		// One write waiting on its timer, sent on by the quit and noted once.
		plugin.saveSettingsSoon();
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(over).toBe(false);
		// Sent once, and not a second time for the hold looking again.
		expect(saved).toHaveLength(1);
		land();
		await ended(settling);
		expect(over).toBe(true);
		expect(saved).toHaveLength(1);
		expect(writesUnderWay()).toBeNull();
		stop();
	});

	it('is asked for a writer of any kind, with nothing more to wire', async () => {
		const { plugin, stop } = await host();
		expect(plugin.settleForQuit()).toBeNull();
		// A writer the host has never heard of notes itself, and is waited for.
		const stranger = deferred();
		void writeUnderWay(stranger.promise);
		const settling = plugin.settleForQuit();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(over).toBe(false);
		stranger.resolve();
		await ended(settling);
		expect(over).toBe(true);
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

	it('adds no task to a quit that owes nothing, and one that lasts as long as what is owed', async () => {
		const made = await host();
		made.plugin.registerSettling();
		// Nothing to save: no task, so the app shows no saving screen at all.
		expect(made.quit()).toHaveLength(0);
		expect(made.sessions.markShutdown).toHaveBeenCalledTimes(1);
		made.unhook();
		made.stop();

		const owed = await host();
		const landed = owed.holdSaves();
		await owed.plugin.selectStep(4);
		owed.plugin.registerSettling();
		const tasks = owed.quit();
		expect(tasks).toHaveLength(1);
		let over = false;
		void tasks[0]?.then(() => {
			over = true;
		});
		await vi.advanceTimersByTimeAsync(1000);
		// The settings write is still out: the window is held.
		expect(owed.saved).toHaveLength(1);
		expect(over).toBe(false);
		landed();
		await vi.advanceTimersByTimeAsync(200);
		expect(over).toBe(true);
		owed.unhook();
		owed.stop();
	});

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

describe('what a writer outside the plugin is told of the author’s editors', () => {
	const CHAPTER = 'Novels/Novel/50_Manuscript/Chapter 1.md';
	const stream = (answer: 'released' | 'unsaved' | 'absent') => {
		const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
		const releaseSegment = vi.fn(() => Promise.resolve(answer));
		Object.assign(view, { releaseSegment });
		return { view, releaseSegment };
	};

	it('goes on where every stream has given the note up or was not writing in it', async () => {
		const { plugin, leaves, stop } = await host();
		const writing = stream('released');
		const elsewhere = stream('absent');
		leaves.set(MANUSCRIPT_VIEW_TYPE, [{ view: writing.view }, { view: elsewhere.view }, { view: {} }]);
		await expect(plugin.releaseNotesForWriter([CHAPTER])).resolves.toBeUndefined();
		expect(writing.releaseSegment).toHaveBeenCalledWith(CHAPTER);
		expect(elsewhere.releaseSegment).toHaveBeenCalledWith(CHAPTER);
		stop();
	});

	it('is refused where a stream could not save what it holds, with the note named', async () => {
		const { plugin, leaves, stop } = await host();
		const kept = stream('unsaved');
		leaves.set(MANUSCRIPT_VIEW_TYPE, [{ view: kept.view }]);
		const refused = await plugin.releaseNotesForWriter([CHAPTER]).then(
			() => null,
			(error: unknown) => error,
		);
		expect(refused).toBeInstanceOf(EditorUnsavedError);
		expect((refused as EditorUnsavedError).path).toBe(CHAPTER);
		stop();
	});

	it('is refused where a sticky note’s editor could not save what it holds, and goes on where it could', async () => {
		const { plugin, service, stop } = await host();
		const STICKY = 'Novels/Novel/70_Tool/72_Task_Management/724_Sticky_Note/note.md';
		const reading = vi.spyOn(service.stickyNotes, 'read').mockResolvedValue({ id: 'sticky-note-1' } as never);
		const yieldTo = vi.fn<(id: string) => Promise<boolean>>(() => Promise.resolve(true));
		Object.assign((plugin as unknown as { stickyNoteHub: { claims: object } }).stickyNoteHub.claims, { yieldTo });
		await expect(plugin.releaseNotesForWriter([STICKY])).resolves.toBeUndefined();
		expect(yieldTo).toHaveBeenCalledWith('sticky-note-1');
		// A manuscript note is no sticky note's editor's to answer for.
		await plugin.releaseNotesForWriter([CHAPTER]);
		expect(yieldTo).toHaveBeenCalledTimes(1);

		yieldTo.mockResolvedValue(false);
		const refused = await plugin.releaseNotesForWriter([STICKY]).then(
			() => null,
			(error: unknown) => error,
		);
		expect(refused).toBeInstanceOf(EditorUnsavedError);
		expect((refused as EditorUnsavedError).path).toBe(STICKY);
		reading.mockRestore();
		stop();
	});
});
