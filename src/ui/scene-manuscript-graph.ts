/**
 * The keeper of the scenes-and-manuscript graph: it opens Obsidian's own
 * graph in a tab of its own with the project's options in place before the
 * view loads, and gives the user's own options back when the last of its
 * tabs closes.
 *
 * The graph's options are global, so the protocol is a loan. Before the
 * first of our tabs opens, the options as they stand are captured; each tab
 * we open is held by its leaf, and what its engine holds is taken down when
 * the user leaves the tab or closes it, and kept in the project's file for
 * the next open while it differs from the preset. The preset itself is
 * nothing to remember: a file that held it would offer a reset with nothing
 * to reset. When the last held tab goes, and the global options are still
 * the ones our tab last held, the captured set is written back. A tab of
 * the user's own that changed the options meanwhile is left alone.
 *
 * The capture and the held leaves are also kept in the app's local storage,
 * so a run cut short by a kill can be put right: on the next layout ready
 * the stored leaves are taken up again by id, and when none is alive the
 * captured options are restored. A quit flushes what is held and leaves the
 * storage for the restart; a plugin unload gives the options back at once.
 */

import type { App, EventRef, WorkspaceLeaf } from 'obsidian';

import {
	readNativeGraphOptions,
	type NativeGraphOptions,
	type ProjectLanguage,
	type SceneManuscriptGraphMemory,
} from '../domain';
import {
	buildSceneManuscriptPreset,
	graphPlugin,
	graphViewOptions,
	isGraphView,
	leafId,
	reprefixOptions,
	sameGraphOptions,
	type GraphPluginInstanceLike,
	type GraphViewLike,
	type SceneManuscriptColors,
	watchInternalPlugins,
} from './native-graph';

/** The local storage key the capture and the held leaves sleep under between runs. */
export const NATIVE_GRAPH_KEEPER_KEY = 'snowflake-method:native-graph';

/** How long the options are left to settle after a layout change before they are taken down. */
export const SCENE_MANUSCRIPT_SNAPSHOT_MS = 1500;

/** As much of a project as the keeper needs, and as much as the storage can hold. */
export interface SceneManuscriptProject {
	projectFile: string;
	rootPath: string;
	locale: ProjectLanguage;
	readOnly: boolean;
}

export type SceneManuscriptWrite = 'written' | 'absent' | 'refused';

export type SceneManuscriptOpening =
	/** A fresh graph tab, set to the project. */
	| 'opened'
	/** One of ours already showed the project and was brought to the front. */
	| 'revealed'
	/** The graph core plugin is turned off. */
	| 'disabled'
	/**
	 * A graph tab opened, but its view is not one the keeper knows, or the
	 * options as they stood could not be read to be given back; it stands
	 * as a plain graph.
	 */
	| 'unavailable';

export interface SceneManuscriptKeeperDeps {
	app: App;
	/** The options the project's file holds for the graph, or null. */
	stored(project: SceneManuscriptProject): Promise<SceneManuscriptGraphMemory | null>;
	/** Keeps what a held tab's engine holds; a refusal is the host's to report. */
	store(project: SceneManuscriptProject, options: NativeGraphOptions): Promise<SceneManuscriptWrite>;
	clear(project: SceneManuscriptProject): Promise<SceneManuscriptWrite>;
	/** The two group colours, read off the theme when a preset is built. */
	colors(): SceneManuscriptColors;
	/** A timer that can be cancelled; the window's by default. */
	later(callback: () => void, ms: number): () => void;
	/** Where a failure the keeper cannot show goes. */
	fail(error: unknown): void;
}

interface HeldLeaf {
	leaf: WorkspaceLeaf;
	view: GraphViewLike;
	id: string | null;
	project: SceneManuscriptProject;
	/** What the project's file holds for the graph, as the keeper last read or wrote it; null while it holds nothing. */
	kept: NativeGraphOptions | null;
	/** Set when the view told us it was going; the sweep drops the entry. */
	closed: boolean;
}

interface KeeperStorage {
	before: NativeGraphOptions | null;
	leaves: Record<string, SceneManuscriptProject>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const readProject = (value: unknown): SceneManuscriptProject | null => {
	if (!isRecord(value)) return null;
	const { projectFile, rootPath, locale, readOnly } = value;
	if (typeof projectFile !== 'string' || typeof rootPath !== 'string') return null;
	if (locale !== 'en' && locale !== 'zh-CN') return null;
	return { projectFile, rootPath, locale, readOnly: readOnly === true };
};

/** Whether two sets of options are the same to the last key, the zoom and the folds included. */
const sameOptionsEntirely = (a: NativeGraphOptions, b: NativeGraphOptions): boolean => {
	const entries = (options: NativeGraphOptions): string =>
		JSON.stringify(Object.keys(options).sort().map((key) => [key, options[key]]));
	return entries(a) === entries(b);
};

const readStorage = (value: unknown): KeeperStorage | null => {
	if (!isRecord(value)) return null;
	const before = readNativeGraphOptions(value.before);
	const leaves: Record<string, SceneManuscriptProject> = {};
	if (isRecord(value.leaves)) {
		for (const [id, project] of Object.entries(value.leaves)) {
			const read = readProject(project);
			if (read !== null) leaves[id] = read;
		}
	}
	if (before === null && Object.keys(leaves).length === 0) return null;
	return { before, leaves };
};

export class SceneManuscriptGraphKeeper {
	private readonly held: HeldLeaf[] = [];
	/** The user's own options, captured before the first of ours opened; null while none is on loan. */
	private before: NativeGraphOptions | null = null;
	/** What one of our engines last held, to tell our options from a later change of the user's. */
	private lastOurs: NativeGraphOptions | null = null;
	private readonly listeners = new Set<() => void>();
	private readonly refs: EventRef[] = [];
	/** Stops following the core plugins; set while the keeper runs. */
	private unwatchPlugins: (() => void) | null = null;
	private cancelSnapshot: (() => void) | null = null;
	private started = false;
	private quitting = false;
	private disposed = false;

	constructor(private readonly deps: SceneManuscriptKeeperDeps) {}

	private readonly fail = (error: unknown): void => {
		this.deps.fail(error);
	};

	/** Fires when a held tab opens or closes. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Whether the graph core plugin is there to open. */
	available(): boolean {
		return graphPlugin(this.deps.app) !== null;
	}

	/** Whether one of our tabs shows the project now. */
	isOpen(projectFile: string): boolean {
		return this.standing(projectFile) !== undefined;
	}

	/**
	 * Takes up the leaves a cut-short run left behind, or gives the captured
	 * options back when none is alive, and begins to follow the layout. Called
	 * once the workspace is laid out, since the leaves are not there before.
	 */
	start(): void {
		if (this.started || this.disposed) return;
		this.started = true;
		const { workspace } = this.deps.app;
		this.refs.push(
			workspace.on('layout-change', () => {
				this.sweep();
				this.scheduleSnapshot();
			}),
			workspace.on('active-leaf-change', (leaf) => {
				// Leaving a held tab is when its options are settled: they are
				// taken down at once, so the pane can offer the reset without a
				// wait. The tab that became active is left for later.
				for (const entry of this.held) {
					if (!entry.closed && entry.leaf !== leaf) void this.snapshot(entry).catch(this.fail);
				}
			}),
			workspace.on('quit', (tasks) => {
				this.quitting = true;
				tasks.add(() => this.flush());
			}),
		);
		// The graph core plugin turned off or on changes what the pane can
		// offer, so its listeners hear of it the moment it happens.
		this.unwatchPlugins = watchInternalPlugins(this.deps.app, () => {
			this.notify();
		});
		const kept = readStorage(this.deps.app.loadLocalStorage(NATIVE_GRAPH_KEEPER_KEY));
		if (kept === null) return;
		this.before = kept.before;
		for (const [id, project] of Object.entries(kept.leaves)) {
			const leaf = workspace.getLeafById(id);
			if (leaf === null || !isGraphView(leaf.view)) continue;
			const entry = this.adopt(leaf, leaf.view, project, null);
			// The global file may hold the user's own options again by now, so
			// the project's are set afresh from what its file remembers.
			void this.apply(entry).catch(this.fail);
		}
		if (this.held.length === 0) this.release([]);
		this.persist();
		this.notify();
	}

	/** Opens the project's graph, or brings the one already open to the front. */
	async open(project: SceneManuscriptProject): Promise<SceneManuscriptOpening> {
		const instance = graphPlugin(this.deps.app);
		if (instance === null) return 'disabled';
		const standing = this.standing(project.projectFile);
		if (standing !== undefined) {
			await this.deps.app.workspace.revealLeaf(standing.leaf);
			return 'revealed';
		}
		const { options, kept } = await this.projectOptions(project);
		if (this.held.length === 0 && this.before === null) {
			// The user's own options, to be given back when the loan ends: where
			// they cannot be read, nothing is borrowed, and a plain graph opens.
			const before = readNativeGraphOptions(instance.options);
			if (before === null) {
				await this.deps.app.workspace.getLeaf('tab').setViewState({ type: 'graph', active: true });
				return 'unavailable';
			}
			this.before = before;
		}
		// A graph view takes the plugin's options as it loads, so they are the
		// project's before the tab opens: it draws the project from its first
		// frame, rather than the whole vault and then the project.
		const previous = instance.options;
		instance.options = { ...options };
		const leaf = this.deps.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: 'graph', active: true });
		const view: unknown = leaf.view;
		if (!isGraphView(view)) {
			instance.options = previous;
			if (this.held.length === 0) this.before = null;
			this.persist();
			return 'unavailable';
		}
		this.set(view, options);
		this.adopt(leaf, view, project, kept);
		this.persist();
		this.notify();
		return 'opened';
	}

	/** Lets the project's remembered options go; a held tab of the project gets the preset at once. */
	async reset(project: SceneManuscriptProject): Promise<SceneManuscriptWrite> {
		const wrote = await this.deps.clear(project);
		if (wrote === 'refused') return wrote;
		const preset = buildSceneManuscriptPreset(project, this.deps.colors());
		for (const entry of this.held) {
			if (entry.closed || entry.project.projectFile !== project.projectFile) continue;
			entry.kept = null;
			this.set(entry.view, preset);
		}
		return wrote;
	}

	/** Takes down what every held tab holds now; what a quit waits for. */
	async flush(): Promise<void> {
		this.cancelPending();
		await Promise.all(this.held.filter((entry) => !entry.closed).map((entry) => this.snapshot(entry)));
	}

	/**
	 * The plugin is going: what is held is taken down, and unless the app is
	 * quitting (where the storage carries the loan over to the restart) the
	 * user's options are given back now.
	 */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancelPending();
		for (const ref of this.refs) this.deps.app.workspace.offref(ref);
		this.refs.length = 0;
		this.unwatchPlugins?.();
		this.unwatchPlugins = null;
		for (const entry of this.held) {
			if (!entry.closed) void this.snapshot(entry).catch(this.fail);
		}
		if (this.quitting) return;
		this.held.length = 0;
		this.release([]);
		this.persist();
		this.listeners.clear();
	}

	// --- holding ----------------------------------------------------------------

	private standing(projectFile: string): HeldLeaf | undefined {
		return this.held.find((entry) => !entry.closed && entry.project.projectFile === projectFile);
	}

	private adopt(
		leaf: WorkspaceLeaf,
		view: GraphViewLike,
		project: SceneManuscriptProject,
		kept: NativeGraphOptions | null,
	): HeldLeaf {
		const entry: HeldLeaf = { leaf, view, id: leafId(leaf), project, kept, closed: false };
		this.held.push(entry);
		// Registered on the view, so it runs as the view unloads and the engine
		// still holds the options: before the leaf is detached or shows
		// something else.
		view.register(() => {
			if (this.disposed || entry.closed) return;
			entry.closed = true;
			void this.snapshot(entry).catch(this.fail);
			this.sweep();
		});
		return entry;
	}

	/**
	 * The options the project's file remembers, re-prefixed for a moved root,
	 * else the preset; `kept` is what the file holds, read the same way, or
	 * null where it holds nothing.
	 */
	private async projectOptions(
		project: SceneManuscriptProject,
	): Promise<{ options: NativeGraphOptions; kept: NativeGraphOptions | null }> {
		const stored = await this.deps.stored(project);
		if (stored !== null) {
			const options = reprefixOptions(stored.options, stored.rootPath, project.rootPath);
			return { options, kept: options };
		}
		return { options: buildSceneManuscriptPreset(project, this.deps.colors()), kept: null };
	}

	private async apply(entry: HeldLeaf): Promise<void> {
		const { options, kept } = await this.projectOptions(entry.project);
		if (this.disposed || entry.closed) return;
		entry.kept = kept;
		this.set(entry.view, options);
	}

	/** Sets the options on a tab's engine unless it holds them already: set again, it would search the vault again. */
	private set(view: GraphViewLike, options: NativeGraphOptions): void {
		const held = graphViewOptions(view);
		if (held === null || !sameGraphOptions(held, options)) view.dataEngine.setOptions(options);
		this.lastOurs = options;
	}

	/**
	 * What the tab's engine holds, kept for the project while it differs
	 * from the preset: the file is written when the options moved from what
	 * it holds, and cleared once the tab is back on the preset. A read-only
	 * project keeps nothing.
	 */
	private async snapshot(entry: HeldLeaf): Promise<void> {
		const options = graphViewOptions(entry.view);
		if (options === null) return;
		this.lastOurs = options;
		if (entry.project.readOnly) return;
		if (sameGraphOptions(options, buildSceneManuscriptPreset(entry.project, this.deps.colors()))) {
			if (entry.kept === null) return;
			entry.kept = null;
			await this.deps.clear(entry.project);
			return;
		}
		if (entry.kept !== null && sameOptionsEntirely(entry.kept, options)) return;
		entry.kept = options;
		await this.deps.store(entry.project, options);
	}

	private scheduleSnapshot(): void {
		this.cancelPending();
		if (this.held.every((entry) => entry.closed)) return;
		this.cancelSnapshot = this.deps.later(() => {
			this.cancelSnapshot = null;
			for (const entry of this.held) {
				if (!entry.closed) void this.snapshot(entry).catch(this.fail);
			}
		}, SCENE_MANUSCRIPT_SNAPSHOT_MS);
	}

	private cancelPending(): void {
		if (this.cancelSnapshot === null) return;
		this.cancelSnapshot();
		this.cancelSnapshot = null;
	}

	/** Drops the held leaves that closed or no longer show a graph; the last one out gives the options back. */
	private sweep(): void {
		const { workspace } = this.deps.app;
		const gone = this.held.filter(
			(entry) =>
				entry.closed ||
				!isGraphView(entry.leaf.view) ||
				(entry.id !== null && workspace.getLeafById(entry.id) === null),
		);
		if (gone.length === 0) return;
		for (const entry of gone) this.held.splice(this.held.indexOf(entry), 1);
		// The leaves just dropped are closing or showing something else: there
		// is no graph on them to set.
		if (this.held.length === 0) this.release(gone.map((entry) => entry.leaf));
		this.persist();
		this.notify();
	}

	/**
	 * The captured options written back, unless the global set is no longer
	 * the one our tab last held: then a tab of the user's own changed it since,
	 * and it is theirs. Graph tabs still open are set to the restored options
	 * too, so none keeps showing the project's.
	 */
	private release(leaving: readonly WorkspaceLeaf[]): void {
		const before = this.before;
		if (before === null) return;
		const instance = graphPlugin(this.deps.app);
		// With the plugin turned off there is nothing to write to; the capture
		// stays in storage for the next run or open.
		if (instance === null) return;
		this.before = null;
		const current = readNativeGraphOptions(instance.options);
		if (current !== null && this.lastOurs !== null && !sameGraphOptions(current, this.lastOurs)) return;
		this.restore(instance, before, leaving);
	}

	private restore(
		instance: GraphPluginInstanceLike,
		before: NativeGraphOptions,
		leaving: readonly WorkspaceLeaf[],
	): void {
		instance.options = { ...before };
		instance.saveOptions();
		for (const leaf of this.deps.app.workspace.getLeavesOfType('graph')) {
			const view: unknown = leaf.view;
			if (!isGraphView(view) || leaving.includes(leaf)) continue;
			if (this.held.some((entry) => entry.leaf === leaf)) continue;
			view.dataEngine.setOptions(before);
		}
	}

	private persist(): void {
		const leaves: Record<string, SceneManuscriptProject> = {};
		for (const entry of this.held) {
			if (entry.id !== null && !entry.closed) leaves[entry.id] = entry.project;
		}
		const empty = this.before === null && Object.keys(leaves).length === 0;
		this.deps.app.saveLocalStorage(NATIVE_GRAPH_KEEPER_KEY, empty ? null : { before: this.before, leaves });
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}
