import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceLeaf } from 'obsidian';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {
			app: unknown;
			contentEl = { addClass: (): void => undefined, dataset: {} as Record<string, string> };
			constructor(public leaf: { app: unknown }) { this.app = leaf.app; }
			setState(): Promise<void> { return Promise.resolve(); }
			registerDomEvent(): void {}
		},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import { SnowflakeStoryStructureView } from '../../src/ui/story-structure-view';
import type { DashboardHost } from '../../src/ui/view-model';

/**
 * A new workspace tab on a phone starts the timeline's and the beat sheet's
 * pools folded away: a lane and a pool do not both fit a phone's width, and
 * the lane is what the tab was opened for. Elsewhere the pools start open,
 * and a tab restored from the layout keeps what it stored either way.
 */
function mount(phone: boolean): SnowflakeStoryStructureView {
	const throwing = (): never => {
		throw new Error('The frame is stubbed in this test.');
	};
	return new SnowflakeStoryStructureView({ app: { scope: {}, workspace: { requestSaveLayout: (): void => undefined } } } as unknown as WorkspaceLeaf, {
		host: { translateForProject: (_locale: unknown, key: string) => key } as unknown as DashboardHost,
		fingerprint: () => 'en|',
		recentProjectPath: () => null,
		corkboardPreferences: () => ({}),
		rememberCorkboardPreferences: () => undefined,
		corkboard: throwing,
		timeline: throwing,
		beatSheet: throwing,
		freeform: throwing,
		freeformCanvas: throwing,
		relationshipGraph: throwing,
		relationshipGraphCanvas: throwing,
		phone: () => phone,
	});
}

describe('the workspace pools on a phone', () => {
	it('start folded on a phone', () => {
		const state = mount(true).getState() as { timeline: { poolCollapsed: boolean }; beatSheet: { poolCollapsed: boolean } };
		expect(state.timeline.poolCollapsed).toBe(true);
		expect(state.beatSheet.poolCollapsed).toBe(true);
	});

	it('start open elsewhere', () => {
		const state = mount(false).getState() as { timeline: { poolCollapsed: boolean }; beatSheet: { poolCollapsed: boolean } };
		expect(state.timeline.poolCollapsed).toBe(false);
		expect(state.beatSheet.poolCollapsed).toBe(false);
	});

	it('keep what a restored layout stored', async () => {
		const view = mount(true);
		await view.setState(
			{ timeline: { pool: { mode: 'compact', group: '', reversed: false }, poolCollapsed: false, timeCollapsed: false } },
			{ history: false },
		);
		const state = view.getState() as { timeline: { poolCollapsed: boolean }; beatSheet: { poolCollapsed: boolean } };
		expect(state.timeline.poolCollapsed).toBe(false);
		expect(state.beatSheet.poolCollapsed).toBe(true);
	});
});
