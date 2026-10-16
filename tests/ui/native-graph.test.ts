import { describe, expect, it, vi } from 'vitest';

import type { NativeGraphOptions } from '../../src/domain';
import {
	buildSceneManuscriptPreset,
	buildSceneManuscriptQuery,
	graphPlugin,
	isGraphView,
	leafId,
	packRgbTriplet,
	reprefixOptions,
	reprefixQuery,
	sameGraphOptions,
	sceneManuscriptFolders,
	SCENE_MANUSCRIPT_FALLBACK_COLORS,
	watchInternalPlugins,
} from '../../src/ui/native-graph';

const DEMO = { rootPath: 'Demo', locale: 'en' as const };
const YANSHI = { rootPath: '演示', locale: 'zh-CN' as const };

const options = (overrides: Partial<NativeGraphOptions> = {}): NativeGraphOptions => ({
	...buildSceneManuscriptPreset(DEMO, SCENE_MANUSCRIPT_FALLBACK_COLORS),
	...overrides,
});

describe('the scenes and manuscript preset', () => {
	it('filters an English project to its scene and manuscript folders, less the vocabulary folders and the files that are not notes', () => {
		expect(buildSceneManuscriptQuery(sceneManuscriptFolders(DEMO))).toBe(
			'(path:"Demo/40_Scene" OR path:"Demo/50_Manuscript")' +
				' -path:"Demo/40_Scene/41_Category" -path:"Demo/40_Scene/42_World_Status"' +
				' -path:"Demo/40_Scene/43_Relationship" -path:"Demo/40_Scene/44_Custom_Field"' +
				' -path:"Demo/40_Scene/45_Gallery" -path:".base" -path:".canvas"',
		);
	});

	it('writes the Chinese folders for a Chinese project', () => {
		expect(buildSceneManuscriptQuery(sceneManuscriptFolders(YANSHI))).toBe(
			'(path:"演示/40_场景" OR path:"演示/50_正文")' +
				' -path:"演示/40_场景/41_类别" -path:"演示/40_场景/42_状态"' +
				' -path:"演示/40_场景/43_关系" -path:"演示/40_场景/44_自定义字段"' +
				' -path:"演示/40_场景/45_图库" -path:".base" -path:".canvas"',
		);
	});

	it('quotes a root that holds a space', () => {
		const folders = sceneManuscriptFolders({ rootPath: 'Novels/My Book', locale: 'en' });
		expect(folders.scenes).toBe('Novels/My Book/40_Scene');
		expect(buildSceneManuscriptQuery(folders).startsWith('(path:"Novels/My Book/40_Scene" OR ')).toBe(true);
	});

	it('colours scenes orange and the manuscript blue, shows arrows and hides what is not a note', () => {
		const preset = buildSceneManuscriptPreset(DEMO, { scenes: 0x112233, manuscript: 0x445566 });
		expect(preset.colorGroups).toEqual([
			{ query: 'path:"Demo/40_Scene"', color: { a: 1, rgb: 0x112233 } },
			{ query: 'path:"Demo/50_Manuscript"', color: { a: 1, rgb: 0x445566 } },
		]);
		expect(preset).toMatchObject({
			showTags: false,
			showAttachments: false,
			hideUnresolved: true,
			showOrphans: true,
			showArrow: true,
			textFadeMultiplier: 0,
			nodeSizeMultiplier: 1,
			lineSizeMultiplier: 1,
			repelStrength: 10,
			linkStrength: 1,
			linkDistance: 250,
		});
		expect(preset.centerStrength).toBeCloseTo(0.5187, 4);
		expect('scale' in preset).toBe(false);
		expect(Object.keys(preset).some((key) => key.startsWith('collapse-'))).toBe(false);
	});

	it('packs the theme triplet and falls back on anything else', () => {
		expect(packRgbTriplet('233, 151, 63', 0)).toBe(0xe9973f);
		expect(packRgbTriplet(' 8,109,221 ', 0)).toBe(0x086ddd);
		expect(packRgbTriplet('', 0xabcdef)).toBe(0xabcdef);
		expect(packRgbTriplet('#e9973f', 0xabcdef)).toBe(0xabcdef);
		expect(packRgbTriplet('300, 0, 0', 0xabcdef)).toBe(0xabcdef);
	});
});

describe('re-prefixing after a root rename', () => {
	it('rewrites every path term for the old root and leaves other roots alone', () => {
		const text = '(path:"Demo/40_Scene" OR path:"Demo/50_Manuscript") -path:"Demo" -path:"Demonstration/40_Scene"';
		expect(reprefixQuery(text, 'Demo', 'Novels/Demo')).toBe(
			'(path:"Novels/Demo/40_Scene" OR path:"Novels/Demo/50_Manuscript") -path:"Novels/Demo" -path:"Demonstration/40_Scene"',
		);
		expect(reprefixQuery(text, 'Demo', 'Demo')).toBe(text);
	});

	it('rewrites the search and every colour group, or hands the options back as they were', () => {
		const held = options();
		expect(reprefixOptions(held, 'Demo', 'Demo')).toBe(held);
		const moved = reprefixOptions(held, 'Demo', 'Books/Demo');
		expect(moved.search.startsWith('(path:"Books/Demo/40_Scene" OR path:"Books/Demo/50_Manuscript")')).toBe(true);
		expect(moved.colorGroups.map((group) => group.query)).toEqual([
			'path:"Books/Demo/40_Scene"',
			'path:"Books/Demo/50_Manuscript"',
		]);
	});
});

describe('telling two sets of options apart', () => {
	it('ignores the zoom, the panel fold and every section fold', () => {
		const a = options({ scale: 1.5, close: true, 'collapse-filter': true });
		const b = options({ scale: 0.25, close: false, 'collapse-filter': false, 'collapse-forces': true });
		expect(sameGraphOptions(a, b)).toBe(true);
	});

	it('sees a changed force, a changed filter or a changed colour', () => {
		const held = options();
		expect(sameGraphOptions(held, options({ repelStrength: 5 }))).toBe(false);
		expect(sameGraphOptions(held, options({ search: '' }))).toBe(false);
		expect(
			sameGraphOptions(
				held,
				options({ colorGroups: [{ query: 'path:"Demo/40_Scene"', color: { a: 1, rgb: 1 } }] }),
			),
		).toBe(false);
	});
});

describe('the guards on the private surface', () => {
	const engine = { getOptions: () => ({}), setOptions: () => undefined };

	it('knows a graph view by its type and its engine', () => {
		expect(isGraphView({ getViewType: () => 'graph', dataEngine: engine })).toBe(true);
		expect(isGraphView({ getViewType: () => 'markdown', dataEngine: engine })).toBe(false);
		expect(isGraphView({ getViewType: () => 'graph', dataEngine: { getOptions: () => ({}) } })).toBe(false);
		expect(isGraphView({ getViewType: () => 'graph' })).toBe(false);
		expect(isGraphView(null)).toBe(false);
	});

	it('finds the enabled graph plugin, handed back bare or wrapped, and nothing else', () => {
		const instance = { options: {}, saveOptions: () => undefined };
		const app = (plugin: unknown) => ({ internalPlugins: { getEnabledPluginById: () => plugin } }) as never;
		expect(graphPlugin(app(instance))).toBe(instance);
		expect(graphPlugin(app({ instance }))).toBe(instance);
		expect(graphPlugin(app(null))).toBeNull();
		expect(graphPlugin(app({ options: {} }))).toBeNull();
		expect(graphPlugin(app({ instance: { options: {} } }))).toBeNull();
		expect(graphPlugin({} as never)).toBeNull();
	});

	it('reads a leaf id only where Obsidian keeps one', () => {
		expect(leafId({ id: 'abc123' } as never)).toBe('abc123');
		expect(leafId({ id: '' } as never)).toBeNull();
		expect(leafId({} as never)).toBeNull();
	});

	it('follows the core plugins where Obsidian announces their changes, and is quiet elsewhere', () => {
		const handlers = new Set<() => void>();
		const app = {
			internalPlugins: {
				on: (name: string, handler: () => void) => {
					if (name === 'change') handlers.add(handler);
					return handler;
				},
				offref: (ref: () => void) => {
					handlers.delete(ref);
				},
			},
		} as never;
		const heard = vi.fn();
		const stop = watchInternalPlugins(app, heard);
		for (const handler of handlers) handler();
		expect(heard).toHaveBeenCalledTimes(1);
		stop();
		expect(handlers.size).toBe(0);
		expect(() => watchInternalPlugins({} as never, heard)()).not.toThrow();
		expect(heard).toHaveBeenCalledTimes(1);
	});
});
