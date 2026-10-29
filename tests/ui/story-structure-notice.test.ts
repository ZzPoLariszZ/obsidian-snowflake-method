// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { WorkspaceLeaf } from 'obsidian';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {
			app: unknown;
			constructor(public leaf: { app: unknown }) { this.app = leaf.app; }
			setState(): Promise<void> { return Promise.resolve(); }
			registerDomEvent(): void {}
		},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import { SnowflakeStoryStructureView } from '../../src/ui/story-structure-view';
import type { DashboardHost, ProjectDashboardModel } from '../../src/ui/view-model';
import { installObsidianDom } from '../helpers/obsidian-dom';

const PROJECT = 'Novel/00_System/001_Project_Metadata.md';

async function flush(): Promise<void> {
	for (let round = 0; round < 10; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The workspace tab says what it cannot draw on the notice pane every such
 * page stands on. With no project it says so where a board would stand,
 * under the family tabs, and leads to the project manager from under the
 * words. With a project whose structure cannot be read it says so in a
 * frame of its own, with no door.
 */
function mount(load: (path?: string | null) => Promise<ProjectDashboardModel | null>) {
	const throwing = (): never => {
		throw new Error('The frame is stubbed in this test.');
	};
	const openProjectManager = vi.fn(() => Promise.resolve());
	const view = new SnowflakeStoryStructureView(
		{ app: { scope: {}, workspace: { layoutReady: true, requestSaveLayout: vi.fn() } } } as unknown as WorkspaceLeaf,
		{
			host: {
				translateForProject: (_locale: unknown, key: string) => key,
				loadDashboardModel: load,
				openProjectManager,
				getRecentStep: () => 8,
			} as unknown as DashboardHost,
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
		},
	);
	const root = document.body.createDiv();
	const container = document.body.createDiv();
	Object.assign(view, { contentEl: root, containerEl: container, updateHeader: vi.fn() });
	return { view, root, openProjectManager };
}

describe('the workspace tab without a readable project', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	afterEach(() => {
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	it('says it waits for a project on the notice pane under the family tabs, with the project manager under the words', async () => {
		const fixture = mount(() => Promise.resolve(null));
		await fixture.view.setState({ projectPath: null }, { history: false });
		await fixture.view.onOpen();
		await flush();
		expect(fixture.root.querySelector('.snowflake-method-tabs')).not.toBeNull();
		const scroll = fixture.root.querySelector('[role="tabpanel"] > .snowflake-method-tab-scroll');
		expect(scroll?.classList.contains('is-self-scrolling')).toBe(true);
		const pane = fixture.root.querySelector('.snowflake-method-workspace-empty-pane');
		expect(pane?.parentElement).toBe(scroll);
		expect(pane?.classList.contains('snowflake-method-notice-pane')).toBe(true);
		expect(pane?.querySelector('.snowflake-method-workspace-empty-lead')?.textContent).toBe('storyStructure.noProject');
		expect(fixture.root.querySelector('.snowflake-method-tab-planned')).toBeNull();
		const button = pane?.querySelector<HTMLButtonElement>('.snowflake-method-workspace-empty-manage');
		expect(button?.textContent).toBe('commands.openProjectManager');
		expect(button?.classList.contains('mod-cta')).toBe(true);
		expect(button?.parentElement?.classList.contains('snowflake-method-workspace-empty-actions')).toBe(true);
		button?.click();
		expect(fixture.openProjectManager).toHaveBeenCalledExactlyOnceWith(null);
	});

	it('says the structure could not be read on the notice pane, in a frame of its own', async () => {
		const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const fixture = mount(() => Promise.reject(new Error('The structure is unreadable in this test.')));
		await fixture.view.setState({ projectPath: PROJECT }, { history: false });
		await fixture.view.onOpen();
		await flush();
		const pane = fixture.root.querySelector('.snowflake-method-workspace-failed-pane');
		expect(pane?.parentElement).toBe(fixture.root);
		expect(pane?.classList.contains('snowflake-method-notice-pane')).toBe(true);
		expect(pane?.querySelector('.snowflake-method-workspace-failed-lead')?.textContent).toBe('storyStructure.loadFailed');
		expect(pane?.querySelector('button')).toBeNull();
		expect(fixture.root.querySelector('[role="tabpanel"]')).toBeNull();
		expect(fixture.root.querySelector('.snowflake-method-tab-planned')).toBeNull();
		expect(quiet).toHaveBeenCalledOnce();
	});
});
