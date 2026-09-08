import { describe, expect, it } from 'vitest';

import {
	CORKBOARD_GROUP_FIELDS,
	CORKBOARD_MODES,
	STORY_STRUCTURE_FAMILIES,
	STORY_STRUCTURE_VISUALIZATIONS,
	corkboardMemory,
	defaultStoryStructureState,
	familyVisualization,
	isCorkboardGroupField,
	isCorkboardMode,
	isStoryStructureVisualization,
	mergeStoryStructureViewState,
	visualizationFamily,
	type StoryStructureViewStateSnapshot,
} from '../../src/ui/story-structure-state';

const current: StoryStructureViewStateSnapshot = {
	visualization: 'timeline',
	corkboard: { mode: 'compact', group: 'pov', reversed: true },
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
				visualization: 'beat-sheet',
				corkboard: { mode: 'extended', group: 'color', reversed: true },
			},
			changed: true,
		});
	});

	it('falls back to the ordered corkboard for a visualization it does not know', () => {
		const update = mergeStoryStructureViewState(current, {
			visualization: 'mind-map',
		});
		expect(update.state.visualization).toBe('corkboard-ordered');
		expect(update.state.corkboard).toEqual(current.corkboard);
		expect(update.changed).toBe(true);
	});

	it('keeps the visualization when the restored state names none', () => {
		const update = mergeStoryStructureViewState(current, {
			corkboard: { group: '' },
		});
		expect(update.state).toEqual({
			visualization: 'timeline',
			corkboard: { mode: 'compact', group: '', reversed: true },
		});
		expect(update.changed).toBe(true);
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
			visualization: 'plotline',
			corkboard: { mode: 'standard', group: '', reversed: false },
		});
		expect(JSON.stringify(current)).toBe(before);
	});

	it('maps every saved visualization to its peer tab and back', () => {
		expect(STORY_STRUCTURE_VISUALIZATIONS.map(visualizationFamily)).toEqual([
			'corkboard',
			'freeform',
			'beat-sheet',
			'timeline',
			'plotline',
		]);
		expect(STORY_STRUCTURE_FAMILIES.map((family) => familyVisualization(family))).toEqual([
			'corkboard-ordered',
			'corkboard-freeform',
			'beat-sheet',
			'timeline',
			'plotline',
		]);
		expect(STORY_STRUCTURE_FAMILIES.map(familyVisualization).map(visualizationFamily)).toEqual(
			STORY_STRUCTURE_FAMILIES,
		);
		expect(isStoryStructureVisualization('plotline')).toBe(true);
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
