import { describe, expect, it } from 'vitest';

import {
	CORKBOARD_GROUP_FIELDS,
	CORKBOARD_MODES,
	STORY_STRUCTURE_FAMILIES,
	STORY_STRUCTURE_VISUALIZATIONS,
	beatSheetMemory,
	corkboardMemory,
	defaultBeatSheetSettings,
	defaultStoryStructureState,
	defaultTimelineSettings,
	familyVisualization,
	isCorkboardGroupField,
	isCorkboardMode,
	isStoryStructureVisualization,
	mergeStoryStructureViewState,
	visualizationFamily,
	type StoryStructureViewStateSnapshot,
} from '../../src/ui/story-structure-state';

const current: StoryStructureViewStateSnapshot = {
	projectPath: 'Novel/Novel.md',
	visualization: 'timeline',
	corkboard: { mode: 'compact', group: 'pov', reversed: true },
	timeline: { pool: { mode: 'extended', group: 'time', reversed: false }, poolCollapsed: true, timeCollapsed: false },
	beatSheet: { pool: { mode: 'standard', group: 'status', reversed: false }, poolCollapsed: false, beatsCollapsed: true },
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
				corkboard: { mode: 'extended', group: 'color', reversed: true },
				timeline: defaultTimelineSettings(),
				beatSheet: defaultBeatSheetSettings(),
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
			corkboard: { mode: 'compact', group: '', reversed: true },
			timeline: current.timeline,
			beatSheet: current.beatSheet,
		});
		expect(update.changed).toBe(true);
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
				corkboard: { mode: 'compact', group: 'pov', reversed: true },
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

	it('maps every saved visualization to its peer tab and back', () => {
		expect(STORY_STRUCTURE_VISUALIZATIONS.map(visualizationFamily)).toEqual([
			'corkboard',
			'freeform',
			'timeline',
			'beat-sheet',
		]);
		expect(STORY_STRUCTURE_FAMILIES.map((family) => familyVisualization(family))).toEqual([
			'corkboard-ordered',
			'corkboard-freeform',
			'timeline',
			'beat-sheet',
		]);
		expect(STORY_STRUCTURE_FAMILIES.map(familyVisualization).map(visualizationFamily)).toEqual(
			STORY_STRUCTURE_FAMILIES,
		);
		expect(isStoryStructureVisualization('beat-sheet')).toBe(true);
		expect(isStoryStructureVisualization('plotline')).toBe(false);
		expect(isStoryStructureVisualization('corkboard')).toBe(false);
		expect([...CORKBOARD_MODES]).toEqual(['compact', 'standard', 'extended']);
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
		expect(corkboardMemory(current.corkboard)).toMatchObject(current.corkboard);
	});
});
