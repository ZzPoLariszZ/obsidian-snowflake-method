import { describe, expect, it } from 'vitest';

import {
	CORKBOARD_GROUP_FIELDS,
	CORKBOARD_MODES,
	CORKBOARD_SIZE_LIMITS,
	CORKBOARD_SIZE_STOPS,
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
	timelineMemory,
	visualizationFamily,
	corkboardViewAvailable,
	entityCorkboardMemory,
	isCorkboardView,
	readCorkboardPreferences,
	readCorkboardSize,
	type StoryStructureViewStateSnapshot,
} from '../../src/ui/story-structure-state';

/** The three sizes at the board's own, as a layout that never moved a slider keeps them. */
const own = { cardWidth: 0, cardHeight: 0, textSize: 0 };

const current: StoryStructureViewStateSnapshot = {
	projectPath: 'Novel/Novel.md',
	visualization: 'timeline',
	corkboard: { mode: 'compact', group: 'pov', reversed: true, ...own, view: 'scene', views: {} },
	timeline: {
		pool: { mode: 'extended', group: 'time', reversed: false, ...own },
		lanes: { mode: 'standard', cardWidth: 300, cardHeight: 0, textSize: 16 },
		poolCollapsed: true,
		timeCollapsed: false,
	},
	beatSheet: {
		pool: { mode: 'standard', group: 'status', reversed: false, ...own },
		lanes: { mode: 'compact', ...own },
		poolCollapsed: false,
		beatsCollapsed: true,
	},
	freeform: { viewId: 'freeform-view-a', minimap: true, snap: false, snapObjects: false, readOnly: false },
	relationshipGraph: { view: 'entities', controlsOpen: true, timelineOpen: false },
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
				corkboard: { mode: 'extended', group: 'color', reversed: true, ...own, view: 'scene', views: {} },
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
			corkboard: { mode: 'compact', group: '', reversed: true, ...own, view: 'scene', views: {} },
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
				character: { mode: 'gallery', group: 'role', reversed: true, ...own },
				location: { mode: 'standard', group: '', reversed: false, ...own },
			},
		});
		expect(restored.changed).toBe(true);
		// The views the tab holds stay under the ones a restored state names; the same settings move nothing.
		const held: StoryStructureViewStateSnapshot = { ...current, corkboard: { ...current.corkboard, views: { time: { mode: 'compact', group: 'timeKind', reversed: false, ...own } } } };
		const again = mergeStoryStructureViewState(held, { corkboard: { views: { item: { reversed: true } } } });
		expect(again.state.corkboard.views).toEqual({
			time: { mode: 'compact', group: 'timeKind', reversed: false, ...own },
			item: { mode: 'standard', group: '', reversed: true, ...own },
		});
		expect(mergeStoryStructureViewState(held, { corkboard: { views: { time: { group: 'timeKind' } } } }).changed).toBe(false);
	});

	it('makes an entity view its memory from its own settings, at rest otherwise', () => {
		const memory = entityCorkboardMemory('character', { mode: 'extended', group: 'role', reversed: true });
		expect(memory).toEqual({
			mode: 'extended', group: 'role', reversed: true, ...own, view: 'character', query: '', scrollTop: 0,
			filters: { status: 'all', category: '', color: '', role: '', timeKind: '' },
		});
		// A view's own sizes come with it.
		expect(entityCorkboardMemory('character', { mode: 'standard', group: '', reversed: false, cardWidth: 320, cardHeight: 0, textSize: 16 }))
			.toMatchObject({ cardWidth: 320, cardHeight: 0, textSize: 16 });
	});

	it("restores the scene view's three sizes and every other view's, one by one", () => {
		const restored = mergeStoryStructureViewState(current, {
			corkboard: {
				cardWidth: 320,
				cardHeight: 'tall',
				textSize: 16,
				views: { character: { cardWidth: 480, cardHeight: 320 } },
			},
		});
		expect(restored.state.corkboard).toEqual({
			...current.corkboard,
			cardWidth: 320,
			textSize: 16,
			views: { character: { mode: 'standard', group: '', reversed: false, cardWidth: 480, cardHeight: 320, textSize: 0 } },
		});
		expect(restored.changed).toBe(true);
		// The same sizes move nothing, and one put back to the board's own does.
		expect(mergeStoryStructureViewState(restored.state, { corkboard: { cardWidth: 320 } }).changed).toBe(false);
		const back = mergeStoryStructureViewState(restored.state, { corkboard: { cardWidth: 0 } });
		expect(back.state.corkboard.cardWidth).toBe(0);
		expect(back.changed).toBe(true);
		expect(mergeStoryStructureViewState(restored.state, { corkboard: { views: { character: { textSize: 14 } } } }).changed).toBe(true);
		// A layout saved before the sliders names none, and keeps what is held.
		expect(mergeStoryStructureViewState(restored.state, { corkboard: { mode: 'compact' } }).state.corkboard).toMatchObject({ cardWidth: 320, textSize: 16 });
	});

	it("restores a pool's three sizes with its settings, the timeline's and the beat sheet's each its own", () => {
		const sized = mergeStoryStructureViewState(current, {
			timeline: { pool: { cardWidth: 320, cardHeight: 'tall', textSize: 18 } },
			beatSheet: { pool: { cardHeight: 400 } },
		});
		expect(sized.state.timeline.pool).toEqual({ ...current.timeline.pool, cardWidth: 320, textSize: 18 });
		expect(sized.state.beatSheet.pool).toEqual({ ...current.beatSheet.pool, cardHeight: 400 });
		expect(sized.changed).toBe(true);
		// The corkboard's own sizes are another board's, and are not moved by a pool's.
		expect(sized.state.corkboard).toEqual(current.corkboard);
		// The same sizes move nothing; one put back to the workspace's own does, and so does one of the other workspace's.
		expect(mergeStoryStructureViewState(sized.state, { timeline: { pool: { cardWidth: 320 } } }).changed).toBe(false);
		expect(mergeStoryStructureViewState(sized.state, { timeline: { pool: { cardWidth: 0 } } })).toMatchObject({
			state: { timeline: { pool: { cardWidth: 0, textSize: 18 } } },
			changed: true,
		});
		expect(mergeStoryStructureViewState(sized.state, { beatSheet: { pool: { textSize: 14 } } }).changed).toBe(true);
		// A layout saved before the sliders names none, and keeps what is held; a size past a slider's end is its end.
		expect(mergeStoryStructureViewState(sized.state, { timeline: { pool: { mode: 'compact' } } }).state.timeline.pool).toMatchObject({ cardWidth: 320, textSize: 18 });
		expect(mergeStoryStructureViewState(current, { timeline: { pool: { cardWidth: 9000, textSize: 4 } } }).state.timeline.pool).toMatchObject({
			cardWidth: CORKBOARD_SIZE_LIMITS.cardWidth.max,
			textSize: CORKBOARD_SIZE_LIMITS.textSize.min,
		});
		// The memory a workspace mounts with carries the sizes the layout kept.
		expect(timelineMemory(sized.state.timeline).pool).toMatchObject({ cardWidth: 320, cardHeight: 0, textSize: 18 });
		expect(beatSheetMemory(sized.state.beatSheet).pool).toMatchObject({ cardWidth: 0, cardHeight: 400, textSize: 0 });
	});

	it('offers a card from 240 to 720 px either way and type from 12 to 36, a pixel at a time', () => {
		expect(CORKBOARD_SIZE_LIMITS).toEqual({
			cardWidth: { min: 240, max: 720 },
			cardHeight: { min: 240, max: 720 },
			textSize: { min: 12, max: 36 },
		});
		// Every whole pixel between a slider's two ends is a place its handle may stand: no size is skipped.
		for (const key of ['cardWidth', 'cardHeight', 'textSize'] as const) {
			const { min, max } = CORKBOARD_SIZE_LIMITS[key];
			const stops = CORKBOARD_SIZE_STOPS[key];
			expect(stops).toHaveLength(max - min + 1);
			expect(stops[0]).toBe(min);
			expect(stops[stops.length - 1]).toBe(max);
			expect(stops.every((stop, at) => stop === min + at)).toBe(true);
		}
		expect(CORKBOARD_SIZE_STOPS.cardWidth).toHaveLength(481);
		expect(CORKBOARD_SIZE_STOPS.textSize).toHaveLength(25);
	});

	it('reads a size as a whole pixel between its slider\'s ends, the board\'s own for nothing or less, and no size for anything else', () => {
		expect(readCorkboardSize('cardWidth', 256)).toBe(256);
		// Any pixel is kept as it is: 250 is a width of its own, where it used to be drawn to the nearest of a few.
		expect(readCorkboardSize('cardWidth', 250)).toBe(250);
		expect(readCorkboardSize('cardWidth', 333)).toBe(333);
		expect(readCorkboardSize('cardWidth', 250.6)).toBe(251);
		// A size past either end is the end: a card set narrower or shorter than the standard one is the standard one.
		expect(readCorkboardSize('cardWidth', 100)).toBe(240);
		expect(readCorkboardSize('cardWidth', 9000)).toBe(720);
		expect(readCorkboardSize('cardHeight', 160)).toBe(240);
		expect(readCorkboardSize('cardHeight', 721)).toBe(720);
		expect(readCorkboardSize('cardHeight', 0)).toBe(0);
		expect(readCorkboardSize('cardHeight', -40)).toBe(0);
		expect(readCorkboardSize('textSize', 21)).toBe(21);
		expect(readCorkboardSize('textSize', 36)).toBe(36);
		expect(readCorkboardSize('textSize', 40)).toBe(36);
		expect(readCorkboardSize('textSize', 8)).toBe(12);
		for (const value of ['16', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
			expect(readCorkboardSize('textSize', value)).toBeUndefined();
		}
		// The project's defaults carry a size only where one was set.
		expect(readCorkboardPreferences({ mode: 'compact', cardWidth: 330, textSize: 'big' })).toEqual({ mode: 'compact', cardWidth: 330 });
		expect(readCorkboardPreferences({ reversed: true })).toEqual({ reversed: true });
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
				// A layout of this build names the lanes' look beside the pool's; this one has nothing new to say of it.
				timeline: { pool: { mode: 'compact', group: 'mood', reversed: true }, lanes: {} },
			}),
		).toEqual({
			state: { ...current, timeline: { ...current.timeline, pool: { mode: 'compact', group: 'time', reversed: true, ...own } } },
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
		expect(defaultStoryStructureState().timeline).toEqual({
			pool: { mode: 'compact', group: '', reversed: false, ...own },
			lanes: { mode: 'compact', ...own },
			poolCollapsed: false,
			timeCollapsed: false,
		});
	});

	it("restores the beat sheet pool's settings and its two folds one by one, apart from the timeline's", () => {
		expect(
			mergeStoryStructureViewState(current, {
				beatSheet: { pool: { mode: 'compact', group: 'mood', reversed: true }, lanes: {} },
			}),
		).toEqual({
			state: { ...current, beatSheet: { ...current.beatSheet, pool: { mode: 'compact', group: 'status', reversed: true, ...own } } },
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
		expect(defaultStoryStructureState().beatSheet).toEqual({
			pool: { mode: 'compact', group: '', reversed: false, ...own },
			lanes: { mode: 'compact', ...own },
			poolCollapsed: false,
			beatsCollapsed: false,
		});
	});

	it("restores the lanes' look apart from the pool's, and hands a layout that names none the pool's, which the lanes wore then", () => {
		// A layout of this build names both, and each is restored on its own.
		const named = mergeStoryStructureViewState(current, {
			timeline: { pool: { mode: 'compact', cardWidth: 280 }, lanes: { mode: 'gallery', cardWidth: 480, cardHeight: 'tall', textSize: 20 } },
			beatSheet: { lanes: { mode: 'extended', cardHeight: 400 } },
		});
		expect(named.state.timeline.pool).toEqual({ ...current.timeline.pool, mode: 'compact', cardWidth: 280 });
		expect(named.state.timeline.lanes).toEqual({ mode: 'gallery', cardWidth: 480, cardHeight: 0, textSize: 20 });
		expect(named.state.beatSheet.lanes).toEqual({ mode: 'extended', cardWidth: 0, cardHeight: 400, textSize: 0 });
		expect(named.state.beatSheet.pool).toEqual(current.beatSheet.pool);
		expect(named.changed).toBe(true);
		// The same look again moves nothing; a style or a size of it does, on either workspace.
		expect(mergeStoryStructureViewState(named.state, { timeline: { lanes: { mode: 'gallery', cardWidth: 480 } } }).changed).toBe(false);
		expect(mergeStoryStructureViewState(named.state, { timeline: { lanes: { textSize: 21 } } }).changed).toBe(true);
		expect(mergeStoryStructureViewState(named.state, { beatSheet: { lanes: { mode: 'compact' } } }).changed).toBe(true);
		// What is no style keeps the one held, and a size past a slider's end is its end.
		expect(mergeStoryStructureViewState(current, { timeline: { lanes: { mode: 'huge', cardWidth: 9000, textSize: 4 } } }).state.timeline.lanes).toEqual({
			mode: 'standard',
			cardWidth: CORKBOARD_SIZE_LIMITS.cardWidth.max,
			cardHeight: 0,
			textSize: CORKBOARD_SIZE_LIMITS.textSize.min,
		});
		expect(mergeStoryStructureViewState(current, { timeline: { lanes: 7 }, beatSheet: { lanes: null } })).toEqual({ state: current, changed: false });
		// A layout saved before the lanes had a look of their own names the pool's alone, which the lanes wore: they keep it.
		const older = mergeStoryStructureViewState(defaultStoryStructureState(), {
			timeline: { pool: { mode: 'extended', group: 'time', reversed: false, cardWidth: 320, cardHeight: 0, textSize: 18 } },
			beatSheet: { pool: { mode: 'standard', group: '', reversed: false } },
		});
		expect(older.state.timeline.lanes).toEqual({ mode: 'extended', cardWidth: 320, cardHeight: 0, textSize: 18 });
		expect(older.state.beatSheet.lanes).toEqual({ mode: 'standard', ...own });
		// The memory a workspace mounts with carries the look the layout kept, in an object of its own.
		const memory = timelineMemory(named.state.timeline);
		expect(memory.lanes).toEqual(named.state.timeline.lanes);
		expect(memory.lanes).not.toBe(named.state.timeline.lanes);
		expect(beatSheetMemory(named.state.beatSheet).lanes).toEqual({ mode: 'extended', cardWidth: 0, cardHeight: 400, textSize: 0 });
		expect(timelineMemory().lanes).toEqual({ mode: 'compact', ...own });
		expect(beatSheetMemory().lanes).toEqual({ mode: 'compact', ...own });
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

	it('restores the relationship graph view and the folds of its controls and its timeline, and ignores what it does not know', () => {
		expect(mergeStoryStructureViewState(current, { relationshipGraph: { view: 'scene-manuscript' } })).toEqual({
			state: { ...current, relationshipGraph: { view: 'scene-manuscript', controlsOpen: true, timelineOpen: false } },
			changed: true,
		});
		expect(
			mergeStoryStructureViewState(current, { relationshipGraph: { controlsOpen: false } }).state.relationshipGraph,
		).toEqual({ view: 'entities', controlsOpen: false, timelineOpen: false });
		expect(mergeStoryStructureViewState(current, { relationshipGraph: { timelineOpen: true } })).toEqual({
			state: { ...current, relationshipGraph: { view: 'entities', controlsOpen: true, timelineOpen: true } },
			changed: true,
		});
		expect(mergeStoryStructureViewState(current, { relationshipGraph: { view: 'tags', controlsOpen: 'yes', timelineOpen: 1 } })).toEqual({
			state: current,
			changed: false,
		});
		expect(mergeStoryStructureViewState(current, { relationshipGraph: 7 })).toEqual({ state: current, changed: false });
		// A tab opens with the whole graph: the timeline is folded until asked for.
		expect(defaultStoryStructureState().relationshipGraph).toEqual({ view: 'entities', controlsOpen: true, timelineOpen: false });
		expect(relationshipGraphMemory({ view: 'scene-manuscript', controlsOpen: false, timelineOpen: true })).toEqual({
			view: 'scene-manuscript',
			controlsOpen: false,
			timelineOpen: true,
			query: '',
			focus: null,
			time: null,
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
			...own,
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
		expect(corkboardMemory({ ...current.corkboard, cardHeight: 320 })).toMatchObject({ cardWidth: 0, cardHeight: 320, textSize: 0 });
		// A pool's memory, made from the three settings alone, holds the board's own sizes.
		expect(corkboardMemory({ mode: 'compact', group: '', reversed: false })).toMatchObject(own);
	});
});
