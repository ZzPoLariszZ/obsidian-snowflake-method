/**
 * Obsidian's own graph, as far as the scenes-and-manuscript view reaches
 * into it. The graph is a core plugin whose options are global: one set in
 * `.obsidian/graph.json`, applied to every graph tab as it opens and written
 * back by whichever tab was last changed. A tab's view carries a data engine
 * that hands the options out and takes a new set. None of this is in the
 * public typings, so every reach goes through a guard here and a mismatch
 * reads as "not a graph" rather than a throw.
 *
 * The preset built here shows one project's scene and manuscript notes and
 * nothing else: a `path:` filter on the two folders, less the vocabulary
 * folders that live under the scene folder, two colour groups to tell the
 * folders apart, and arrows on the lines, which are the notes' own
 * `snowflake-linked-manuscript` links.
 */

import type { App, View, WorkspaceLeaf } from 'obsidian';

import {
	readNativeGraphOptions,
	type NativeGraphColorGroup,
	type NativeGraphOptions,
	type ProjectLanguage,
} from '../domain';
import {
	customFieldRootNameForFolder,
	definitionRootNameForFolder,
	galleryRootNameForFolder,
	getProjectPathLayout,
} from '../services';

// --- the private surface ------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** The engine behind a graph view: the options as it holds them, and a way to set some. */
export interface GraphDataEngineLike {
	getOptions(): unknown;
	setOptions(options: Partial<NativeGraphOptions>): void;
}

export interface GraphViewLike extends View {
	dataEngine: GraphDataEngineLike;
}

/** The core plugin's instance: the global options and the call that writes them to disk. */
export interface GraphPluginInstanceLike {
	options: Record<string, unknown>;
	saveOptions(): void;
}

/** True for a graph view whose engine answers the two calls the keeper makes. */
export function isGraphView(view: unknown): view is GraphViewLike {
	if (!isRecord(view) || typeof view.getViewType !== 'function') return false;
	if ((view.getViewType as () => unknown)() !== 'graph') return false;
	const engine = view.dataEngine;
	return (
		isRecord(engine) &&
		typeof engine.getOptions === 'function' &&
		typeof engine.setOptions === 'function'
	);
}

/** The graph core plugin's instance while the plugin is enabled, else null. */
export function graphPlugin(app: App): GraphPluginInstanceLike | null {
	const plugins = (app as unknown as { internalPlugins?: unknown }).internalPlugins;
	if (!isRecord(plugins) || typeof plugins.getEnabledPluginById !== 'function') return null;
	const plugin = (plugins.getEnabledPluginById as (id: string) => unknown)('graph');
	if (!isRecord(plugin)) return null;
	// Obsidian 1.14 answers with the instance itself; a wrapper that holds it
	// under `instance` is read the same, should a build hand that back instead.
	const instance = isRecord(plugin.instance) ? plugin.instance : plugin;
	if (!isRecord(instance.options) || typeof instance.saveOptions !== 'function') return null;
	return instance as unknown as GraphPluginInstanceLike;
}

/**
 * Follows the core plugins as they are turned on and off, which Obsidian
 * announces on its internal plugins; nothing to follow where that surface is
 * missing, and then the listener is simply never called.
 */
export function watchInternalPlugins(app: App, listener: () => void): () => void {
	const plugins = (app as unknown as { internalPlugins?: unknown }).internalPlugins;
	if (!isRecord(plugins) || typeof plugins.on !== 'function' || typeof plugins.offref !== 'function') return () => undefined;
	const ref: unknown = (plugins.on as (name: string, callback: () => void) => unknown)('change', listener);
	return () => {
		(plugins.offref as (ref: unknown) => void)(ref);
	};
}

/** The options a graph view's engine holds, read by shape; null where the engine's answer is not a set of options. */
export function graphViewOptions(view: GraphViewLike): NativeGraphOptions | null {
	return readNativeGraphOptions(view.dataEngine.getOptions());
}

/** A leaf's id, which Obsidian keeps but does not type; null where there is none to keep. */
export function leafId(leaf: WorkspaceLeaf): string | null {
	const id = (leaf as unknown as { id?: unknown }).id;
	return typeof id === 'string' && id.length > 0 ? id : null;
}

// --- the preset -------------------------------------------------------------

/** The folders the preset shows and the ones it hides, as vault paths. */
export interface SceneManuscriptFolders {
	rootPath: string;
	scenes: string;
	manuscript: string;
	/** The vocabulary folders under the scene folder, which hold no scenes. */
	hidden: readonly string[];
}

export interface SceneManuscriptColors {
	/** Packed `0xRRGGBB`. */
	scenes: number;
	manuscript: number;
}

/** The theme's orange and blue, used when the body gives no triplet to read. */
export const SCENE_MANUSCRIPT_FALLBACK_COLORS: SceneManuscriptColors = {
	scenes: 0xe9973f,
	manuscript: 0x086ddd,
};

export function sceneManuscriptFolders(project: {
	rootPath: string;
	locale: ProjectLanguage;
}): SceneManuscriptFolders {
	const layout = getProjectPathLayout(project.locale);
	const sceneFolder = layout.directories.scenes;
	const scenes = `${project.rootPath}/${sceneFolder}`;
	const names = [
		definitionRootNameForFolder(sceneFolder, 'category', project.locale),
		definitionRootNameForFolder(sceneFolder, 'world-status', project.locale),
		definitionRootNameForFolder(sceneFolder, 'relationship', project.locale),
		customFieldRootNameForFolder(sceneFolder, project.locale),
		galleryRootNameForFolder(sceneFolder, project.locale),
	];
	return {
		rootPath: project.rootPath,
		scenes,
		manuscript: `${project.rootPath}/${layout.directories.draft}`,
		hidden: names.map((name) => `${scenes}/${name}`),
	};
}

const pathTerm = (path: string): string => `path:"${path}"`;

/**
 * The file kinds Obsidian's graph draws besides notes even with attachments
 * hidden, which hold no scene and no chapter: the folders' own bases, and any
 * canvas kept among the notes.
 */
export const SCENE_MANUSCRIPT_HIDDEN_EXTENSIONS: readonly string[] = ['base', 'canvas'];

/**
 * The filter: both folders, less the vocabulary folders and the file kinds
 * that are not notes. Paths are quoted, since a project may hold a space.
 */
export function buildSceneManuscriptQuery(folders: SceneManuscriptFolders): string {
	const shown = `(${pathTerm(folders.scenes)} OR ${pathTerm(folders.manuscript)})`;
	const hidden = folders.hidden.map((path) => `-${pathTerm(path)}`);
	const kinds = SCENE_MANUSCRIPT_HIDDEN_EXTENSIONS.map((extension) => `-${pathTerm(`.${extension}`)}`);
	return [shown, ...hidden, ...kinds].join(' ');
}

/**
 * The options set on a fresh graph tab for a project. Display and forces
 * stand at Obsidian's own defaults; the fold of each controls section is
 * left to the engine, so the user's folds stay as they were.
 */
export function buildSceneManuscriptPreset(
	project: { rootPath: string; locale: ProjectLanguage },
	colors: SceneManuscriptColors,
): NativeGraphOptions {
	const folders = sceneManuscriptFolders(project);
	const colorGroups: NativeGraphColorGroup[] = [
		{ query: pathTerm(folders.scenes), color: { a: 1, rgb: colors.scenes } },
		{ query: pathTerm(folders.manuscript), color: { a: 1, rgb: colors.manuscript } },
	];
	return {
		search: buildSceneManuscriptQuery(folders),
		showTags: false,
		showAttachments: false,
		hideUnresolved: true,
		showOrphans: true,
		colorGroups,
		showArrow: true,
		textFadeMultiplier: 0,
		nodeSizeMultiplier: 1,
		lineSizeMultiplier: 1,
		centerStrength: 0.518713248970312,
		repelStrength: 10,
		linkStrength: 1,
		linkDistance: 250,
	};
}

/** Every `path:` term written for one root rewritten for another; the text as it was when the roots agree. */
export function reprefixQuery(text: string, oldRoot: string, newRoot: string): string {
	if (oldRoot === newRoot || oldRoot.length === 0) return text;
	return text
		.split(`path:"${oldRoot}/`)
		.join(`path:"${newRoot}/`)
		.split(`path:"${oldRoot}"`)
		.join(`path:"${newRoot}"`);
}

export function reprefixOptions(
	options: NativeGraphOptions,
	oldRoot: string,
	newRoot: string,
): NativeGraphOptions {
	if (oldRoot === newRoot) return options;
	return {
		...options,
		search: reprefixQuery(options.search, oldRoot, newRoot),
		colorGroups: options.colorGroups.map((group) => ({
			...group,
			query: reprefixQuery(group.query, oldRoot, newRoot),
		})),
	};
}

const UNCOMPARED_KEYS = new Set(['scale', 'close']);

const comparable = (options: NativeGraphOptions): string => {
	const keys = Object.keys(options)
		.filter((key) => !UNCOMPARED_KEYS.has(key) && !key.startsWith('collapse-'))
		.sort();
	return JSON.stringify(keys.map((key) => [key, options[key]]));
};

/**
 * Whether two sets of options draw the same graph: the zoom, the panel's
 * fold and the fold of each section are how the graph is looked at, not what
 * it shows, so they are left out.
 */
export function sameGraphOptions(a: NativeGraphOptions, b: NativeGraphOptions): boolean {
	return comparable(a) === comparable(b);
}

/**
 * A theme's `--color-*-rgb` triplet (`233, 151, 63`) packed as the engine
 * wants it; the fallback where the text is not three channels.
 */
export function packRgbTriplet(text: string, fallback: number): number {
	const parts = text.trim().split(/\s*,\s*|\s+/);
	if (parts.length !== 3) return fallback;
	const channels = parts.map((part) => Number(part));
	if (!channels.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
		return fallback;
	}
	const [r, g, b] = channels as [number, number, number];
	return (r << 16) | (g << 8) | b;
}
