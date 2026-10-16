import { describe, expect, it } from 'vitest';

import {
	CORKBOARD_GROUP_FIELDS,
	CORKBOARD_MODES,
	STORY_STRUCTURE_FAMILIES,
	STORY_STRUCTURE_VISUALIZATIONS,
	beatSheetMemory,
	corkboardMemory,
	defaultBeatSheetSettings,
	defaultFreeformSettings,
	defaultRelationshipGraphSettings,
	defaultStoryStructureState,
	defaultTimelineSettings,
	familyVisualization,
	freeformMemory,
	isCorkboardGroupField,
	isCorkboardMode,
	isStoryStructureVisualization,
	mergeStoryStructureViewState,
	relationshipGraphMemory,
	visualizationFamily,
	corkboardViewAvailable,
	entityCorkboardMemory,
	isCorkboardView,
	type StoryStructureViewStateSnapshot,
} from '../../src/ui/story-structure-state';

const current: StoryStructureViewStateSnapshot = {
	projectPath: 'Novel/Novel.md',
	visualization: 'timeline',
	corkboard: { mode: 'compact', group: 'pov', reversed: true, view: 'scene', views: {} },
	timeline: { pool: { mode: 'extended', group: 'time', reversed: false }, poolCollapsed: true, timeCollapsed: false },
	beatSheet: { pool: { mode: 'standard', group: 'status', reversed: false }, poolCollapsed: false, beatsCollapsed: true },
	freeform: { viewId: 'freeform-view-a', minimap: true, snap: false, snapObjects: false, readOnly: false },
	relationshipGraph: { view: 'entities', controlsOpen: true },
};

describe('story structure restored state', () => {
	it("restores a visualization and the corkboard's mode, group and reversal", () => {
		expect(
			mergeStoryStructureViewState(defaultStoryStructureState(), {
				visualization: 'beat-sheet',
				corkboard: { mode: 'extended', group: 'color', reversed: true },
			}),
		).toEqual({
			state: {
				projectPath: null,
				visualization: 'beat-sheet',
				corkboard: { mode: 'extended', group: 'color', reversed: true, view: 'scene', views: {} },
				timeline: defaultTimelineSettings(),
				beatSheet: defaultBeatSheetSettings(),
				freeform: defaultFreeformSettings(),
				relationshipGraph: defaultRelationshipGraphSettings(),
			},
			changed: true,
		});
	});

	it.each(['mind-map', 'plotline'])('falls back to the corkboard for a visualization it does not know (%s)', (visualization) => {
		const update = mergeStoryStructureViewState(current, { visualization });
		expect(update.state.visualization).toBe('corkboard-ordered');
		expect(update.state.corkboard).toEqual(current.corkboard);
		expect(update.changed).toBe(true);
	});

	it('keeps the visualization when the restored state names none', () => {
		const update = mergeStoryStructureViewState(current, {
			corkboard: { group: '' },
		});
		expect(update.state).toEqual({
			projectPath: current.projectPath,
			visualization: 'timeline',
			corkboard: { mode: 'compact', group: '', reversed: true, view: 'scene', views: {} },
			timeline: current.timeline,
			beatSheet: current.beatSheet,
			freeform: current.freeform,
			relationshipGraph: current.relationshipGraph,
		});
		expect(update.changed).toBe(true);
	});

	it('restores the corkboard view, keeps the current one when none is named, and takes any kind id', () => {
		expect(mergeStoryStructureViewState(current, { corkboard: { view: 'character' } }).state.corkboard).toEqual({
			...current.corkboard, view: 'character',
		});
		expect(mergeStoryStructureViewState(current, { corkboard: { view: 'faction' } }).state.corkboard.view).toBe('faction');
		expect(mergeStoryStructureViewState(current, { corkboard: { view: 7 } }).state.corkboard.view).toBe('scene');
		expect(mergeStoryStructureViewState(current, { corkboard: { view: '' } }).state.corkboard.view).toBe('scene');
		expect(mergeStoryStructureViewState(current, { corkboard: { mode: 'extended' } }).state.corkboard.view).toBe('scene');
		const moved = mergeStoryStructureViewState(current, { corkboard: { view: 'location' } });
		expect(moved.changed).toBe(true);
		expect(mergeStoryStructureViewState(current, { corkboard: { view: 'scene' } }).changed).toBe(false);
	});

	it('offers the scene and character views always and a kind\'s only while the project has it', () => {
		const kinds = [{ id: 'time' }, { id: 'location' }, { id: 'faction' }];
		expect(corkboardViewAvailable('scene', [])).toBe(true);
		expect(corkboardViewAvailable('character', [])).toBe(true);
		expect(corkboardViewAvailable('faction', kinds)).toBe(true);
		expect(corkboardViewAvailable('faction', kinds.slice(0, 2))).toBe(false);
		expect(isCorkboardView('item')).toBe(true);
		expect(isCorkboardView('')).toBe(false);
		expect(isCorkboardView(null)).toBe(false);
	});

	it('restores every other view\'s settings by view, each field only when it is one of its own', () => {
		const restored = mergeStoryStructureViewState(current, {
			corkboard: {
				view: 'character',
				views: {
					character: { mode: 'gallery', group: 'role', reversed: true },
					location: { mode: 'wide', group: 'pov', reversed: 'yes' },
					scene: { mode: 'compact', group: 'status', reversed: false },
					'': { mode: 'compact' },
				},
			},
		});
		expect(restored.state.corkboard).toEqual({
			...current.corkboard,
			view: 'character',
			views: {
				character: { mode: 'gallery', group: 'role', reversed: true },
				location: { mode: 'standard', group: '', reversed: false },
			},
		});
		expect(restored.changed).toBe(true);
		// The views the tab holds stay under the ones a restored state names; the same settings move nothing.
		const held: StoryStructureViewStateSnapshot = { ...current, corkboard: { ...current.corkboard, views: { time: { mode: 'compact', group: 'timeKind', reversed: false } } } };
		const again = mergeStoryStructureViewState(held, { corkboard: { views: { item: { reversed: true } } } });
		expect(again.state.corkboard.views).toEqual({
			time: { mode: 'compact', group: 'timeKind', reversed: false },
			item: { mode: 'standard', group: '', reversed: true },
		});
		expect(mergeStoryStructureViewState(held, { corkboard: { views: { time: { group: 'timeKind' } } } }).changed).toBe(false);
	});

	it('makes an entity view its memory from its own settings, at rest otherwise', () => {
		const memory = entityCorkboardMemory('character', { mode: 'extended', group: 'role', reversed: true });
		expect(memory).toEqual({
			mode: 'extended', group: 'role', reversed: true, view: 'character', query: '', scrollTop: 0,
			filters: { status: 'all', category: '', color: '', role: '', timeKind: '' },
		});
	});

	it('restores project ownership independently of visualization settings', () => {
		const update = mergeStoryStructureViewState(current, {
			projectPath: 'Second/Second.md',
		});
		expect(update).toEqual({
			state: { ...current, projectPath: 'Second/Second.md' },
			changed: true,
		});
		expect(mergeStoryStructureViewState(current, { projectPath: null })).toEqual({
			state: { ...current, projectPath: null },
			changed: true,
		});
	});

	it('preserves project ownership for legacy or invalid saved project fields', () => {
		for (const value of [{}, { projectPath: undefined }, { projectPath: 7 }, { projectPath: {} }]) {
			expect(mergeStoryStructureViewState(current, value)).toEqual({
				state: current,
				changed: false,
			});
		}
		expect(mergeStoryStructureViewState(current, { projectPath: current.projectPath }).changed).toBe(false);
	});

	it('ignores invalid corkboard values without requesting a refresh', () => {
		expect(
			mergeStoryStructureViewState(current, {
				visualization: 'timeline',
				corkboard: { mode: 'huge', group: 'mood', reversed: 'yes' },
			}),
		).toEqual({ state: current, changed: false });
		expect(mergeStoryStructureViewState(current, { corkboard: 7 })).toEqual({
			state: current,
			changed: false,
		});
		expect(mergeStoryStructureViewState(current, null)).toEqual({
			state: current,
			changed: false,
		});
		expect(mergeStoryStructureViewState(current, 'timeline')).toEqual({
			state: current,
			changed: false,
		});
	});

	it("restores the timeline pool's settings one by one, ignoring what is not one of its own", () => {
		expect(
			mergeStoryStructureViewState(current, {
				timeline: { pool: { mode: 'compact', group: 'mood', reversed: true } },
			}),
		).toEqual({
			state: { ...current, timeline: { pool: { mode: 'compact', group: 'time', reversed: true }, poolCollapsed: true, timeCollapsed: false } },
			changed: true,
		});
		expect(mergeStoryStructureViewState(current, { timeline: 7 })).toEqual({ state: current, changed: false });
		expect(mergeStoryStructureViewState(current, { timeline: { pool: null } })).toEqual({ state: current, changed: false });
		// The pool's fold is a yes or a no; anything else keeps the current one.
		expect(mergeStoryStructureViewState(current, { timeline: { poolCollapsed: false } })).toEqual({
			state: { ...current, timeline: { ...current.timeline, poolCollapsed: false } },
			changed: true,
		});
		expect(mergeStoryStructureViewState(current, { timeline: { poolCollapsed: 'yes' } })).toEqual({ state: current, changed: false });
		expect(mergeStoryStructureViewState(current, { timeline: { timeCollapsed: true } })).toEqual({
			state: { ...current, timeline: { ...current.timeline, timeCollapsed: true } },
			changed: true,
		});
		expect(mergeStoryStructureViewState(current, { timeline: { timeCollapsed: 1 } })).toEqual({ state: current, changed: false });
		expect(defaultStoryStructureState().timeline).toEqual({ pool: { mode: 'compact', group: '', reversed: false }, poolCollapsed: false, timeCollapsed: false });
	});

	it("restores the beat sheet pool's settings and its two folds one by one, apart from the timeline's", () => {
		expect(
			mergeStoryStructureViewState(current, {
				beatSheet: { pool: { mode: 'compact', group: 'mood', reversed: true } },
			}),
		).toEqual({
			state: { ...current, beatSheet: { pool: { mode: 'compact', group: 'status', reversed: true }, poolCollapsed: false, beatsCollapsed: true } },
			changed: true,
		});
		expect(mergeStoryStructureViewState(current, { beatSheet: 7 })).toEqual({ state: current, changed: false });
		expect(mergeStoryStructureViewState(current, { beatSheet: { pool: null } })).toEqual({ state: current, changed: false });
		expect(mergeStoryStructureViewState(current, { beatSheet: { poolCollapsed: true } })).toEqual({
			state: { ...current, beatSheet: { ...current.beatSheet, poolCollapsed: true } },
			changed: true,
		});
		expect(mergeStoryStructureViewState(current, { beatSheet: { beatsCollapsed: false } })).toEqual({
			state: { ...current, beatSheet: { ...current.beatSheet, beatsCollapsed: false } },
			changed: true,
		});
		expect(mergeStoryStructureViewState(current, { beatSheet: { beatsCollapsed: 0 } })).toEqual({ state: current, changed: false });
		// The timeline's fold is the timeline's: naming it under the beat sheet moves nothing.
		expect(mergeStoryStructureViewState(current, { beatSheet: { timeCollapsed: true } })).toEqual({ state: current, changed: false });
		expect(defaultStoryStructureState().beatSheet).toEqual({ pool: { mode: 'compact', group: '', reversed: false }, poolCollapsed: false, beatsCollapsed: false });
	});

	it("restores the freeform canvas's view and its switches one by one, ignoring what is not one of its own", () => {
		expect(
			mergeStoryStructureViewState(current, {
				freeform: { viewId: 'freeform-view-b', minimap: 'yes', snap: true },
			}),
		).toEqual({
			state: { ...current, freeform: { viewId: 'freeform-view-b', minimap: true, snap: true, snapObjects: false, readOnly: false } },
			changed: true,
		});
		expect(mergeStoryStructureViewState(current, { freeform: { snapObjects: true, readOnly: true } })).toEqual({
			state: { ...current, freeform: { ...current.freeform, snapObjects: true, readOnly: true } },
			changed: true,
		});
		expect(mergeStoryStructureViewState(current, { freeform: { snapObjects: 'yes', readOnly: 1 } })).toEqual({ state: current, changed: false });
		// A tab may name no view, which is the word for the one changed last.
		expect(mergeStoryStructureViewState(current, { freeform: { viewId: null } })).toEqual({
			state: { ...current, freeform: { ...current.freeform, viewId: null } },
			changed: true,
		});
		for (const viewId of ['', 7, {}, undefined]) {
			expect(mergeStoryStructureViewState(current, { freeform: { viewId } })).toEqual({ state: current, changed: false });
		}
		expect(mergeStoryStructureViewState(current, { freeform: 7 })).toEqual({ state: current, changed: false });
		expect(mergeStoryStructureViewState(current, { freeform: { minimap: false } })).toEqual({
			state: { ...current, freeform: { ...current.freeform, minimap: false } },
			changed: true,
		});
		expect(mergeStoryStructureViewState(current, { freeform: { snap: 1 } })).toEqual({ state: current, changed: false });
		expect(defaultStoryStructureState().freeform).toEqual({ viewId: null, minimap: true, snap: false, snapObjects: false, readOnly: false });
	});

	it('starts a mount of the freeform canvas from what the tab kept, with nowhere looked at from yet', () => {
		const memory = freeformMemory(current.freeform);
		expect(memory).toMatchObject({ viewId: 'freeform-view-a', minimap: true, snap: false });
		expect(memory.viewports.size).toBe(0);
		expect(freeformMemory()).toMatchObject({ viewId: null, minimap: true, snap: false, snapObjects: false, readOnly: false });
		// Two mounts share nothing.
		expect(freeformMemory().viewports).not.toBe(freeformMemory().viewports);
	});

	it('starts a mount of the beat sheet from what the tab kept, with nothing of the session in it', () => {
		const memory = beatSheetMemory(current.beatSheet);
		expect(memory).toMatchObject({ poolCollapsed: false, beatsCollapsed: true, scroll: { left: 0, top: 0 } });
		expect(memory.pool).toMatchObject({ mode: 'standard', group: 'status', reversed: false, query: '', scrollTop: 0 });
		expect(memory.stackPositions.size).toBe(0);
		expect(beatSheetMemory().pool.mode).toBe('compact');
	});

	it('reports a change only when something moved', () => {
		expect(
			mergeStoryStructureViewState(current, {
				visualization: 'timeline',
				corkboard: { mode: 'compact', group: 'pov', reversed: true, view: 'scene' },
			}).changed,
		).toBe(false);
		expect(
			mergeStoryStructureViewState(current, {
				corkboard: { reversed: false },
			}).changed,
		).toBe(true);
	});

	it('leaves its input alone', () => {
		const before = JSON.stringify(current);
		mergeStoryStructureViewState(current, {
			visualization: 'beat-sheet',
			corkboard: { mode: 'standard', group: '', reversed: false },
		});
		expect(JSON.stringify(current)).toBe(before);
	});

	it('restores the relationship graph view and the fold of its controls, and ignores what it does not know', () => {
		expect(mergeStoryStructureViewState(current, { relationshipGraph: { view: 'scene-manuscript' } })).toEqual({
			state: { ...current, relationshipGraph: { view: 'scene-manuscript', controlsOpen: true } },
			changed: true,
		});
		expect(
			mergeStoryStructureViewState(current, { relationshipGraph: { controlsOpen: false } }).state.relationshipGraph,
		).toEqual({ view: 'entities', controlsOpen: false });
		expect(mergeStoryStructureViewState(current, { relationshipGraph: { view: 'tags', controlsOpen: 'yes' } })).toEqual({
			state: current,
			changed: false,
		});
		expect(mergeStoryStructureViewState(current, { relationshipGraph: 7 })).toEqual({ state: current, changed: false });
		expect(defaultStoryStructureState().relationshipGraph).toEqual({ view: 'entities', controlsOpen: true });
		expect(relationshipGraphMemory({ view: 'scene-manuscript', controlsOpen: false })).toEqual({
			view: 'scene-manuscript',
			controlsOpen: false,
			query: '',
			focus: null,
			positions: new Map(),
		});
	});

	it('maps every saved visualization to its peer tab and back', () => {
		expect(STORY_STRUCTURE_VISUALIZATIONS.map(visualizationFamily)).toEqual([
			'corkboard',
			'freeform',
			'timeline',
			'beat-sheet',
			'relationship-graph',
		]);
		expect(STORY_STRUCTURE_FAMILIES.map((family) => familyVisualization(family))).toEqual([
			'corkboard-ordered',
			'corkboard-freeform',
			'timeline',
			'beat-sheet',
			'relationship-graph',
		]);
		expect(STORY_STRUCTURE_FAMILIES.map(familyVisualization).map(visualizationFamily)).toEqual(
			STORY_STRUCTURE_FAMILIES,
		);
		expect(isStoryStructureVisualization('beat-sheet')).toBe(true);
		expect(isStoryStructureVisualization('plotline')).toBe(false);
		expect(isStoryStructureVisualization('corkboard')).toBe(false);
		expect([...CORKBOARD_MODES]).toEqual(['compact', 'standard', 'gallery', 'extended']);
		expect(isCorkboardMode('standard')).toBe(true);
		expect(isCorkboardMode('wide')).toBe(false);
		expect(CORKBOARD_GROUP_FIELDS).toHaveLength(8);
		expect(isCorkboardGroupField('linked')).toBe(true);
		expect(isCorkboardGroupField('')).toBe(false);
	});

	it('starts the corkboard memory at rest', () => {
		expect(corkboardMemory()).toEqual({
			mode: 'standard',
			group: '',
			reversed: false,
			view: 'scene',
			query: '',
			filters: {
				sceneMin: null,
				sceneMax: null,
				status: 'all',
				category: '',
				pov: '',
				time: '',
				location: '',
				character: '',
				color: '',
				linked: '',
			},
			scrollTop: 0,
		});
		expect(corkboardMemory(current.corkboard)).toMatchObject({ mode: 'compact', group: 'pov', reversed: true, view: 'scene' });
	});
});
