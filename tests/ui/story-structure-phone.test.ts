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
 * The workspace is not offered on a phone: a tab that opens there all the
 * same, kept from a wider screen, shows a note and the way to the dashboard
 * and draws no board. Elsewhere the board is drawn, and a device class that
 * flips while the tab stands, an iPad split to a phone's width and widened
 * again, puts the board away and brings it back.
 */
function mount(phone: () => boolean) {
	const throwing = (): never => {
		throw new Error('The frame is stubbed in this test.');
	};
	const handle = { refresh: vi.fn(), reveal: vi.fn(), remeasure: vi.fn(), saveFocusedBody: () => false, dispose: vi.fn() };
	const corkboard = vi.fn(() => handle);
	const selectProject = vi.fn(() => Promise.resolve());
	const view = new SnowflakeStoryStructureView(
		{ app: { scope: {}, workspace: { layoutReady: true, requestSaveLayout: vi.fn() } } } as unknown as WorkspaceLeaf,
		{
			host: {
				translateForProject: (_locale: unknown, key: string) => key,
				loadDashboardModel: () =>
					Promise.resolve({ path: PROJECT, projectId: 'novel', title: 'Novel', locale: 'en', worldbuildingKinds: [] } as unknown as ProjectDashboardModel),
				selectProject,
				getRecentStep: () => 8,
			} as unknown as DashboardHost,
			fingerprint: () => 'en|',
			recentProjectPath: () => PROJECT,
			corkboardPreferences: () => ({}),
			rememberCorkboardPreferences: () => undefined,
			corkboard,
			timeline: throwing,
			beatSheet: throwing,
			freeform: throwing,
			freeformCanvas: throwing,
			relationshipGraph: throwing,
			relationshipGraphCanvas: throwing,
			phone,
		},
	);
	const root = document.body.createDiv();
	const container = document.body.createDiv();
	Object.assign(view, { contentEl: root, containerEl: container, updateHeader: vi.fn() });
	return { view, root, corkboard, handle, selectProject };
}

async function open(fixture: ReturnType<typeof mount>): Promise<void> {
	await fixture.view.setState({ projectPath: PROJECT }, { history: false });
	await fixture.view.onOpen();
}

describe('the workspace tab on a phone', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it('shows its note and the way to the dashboard, and draws no board', async () => {
		const fixture = mount(() => true);
		await open(fixture);
		const note = fixture.root.querySelector('.snowflake-method-workspace-phone-pane');
		expect(note?.classList.contains('snowflake-method-notice-pane')).toBe(true);
		expect(note?.querySelector('.snowflake-method-workspace-phone-lead')?.textContent).toBe('storyStructure.phone');
		expect(fixture.root.querySelector('[role="tabpanel"]')).toBeNull();
		expect(fixture.corkboard).not.toHaveBeenCalled();
		const button = note?.querySelector<HTMLButtonElement>('.snowflake-method-workspace-phone-open');
		expect(button?.textContent).toBe('commands.openDashboard');
		expect(button?.classList.contains('mod-cta')).toBe(true);
		expect(button?.parentElement?.classList.contains('snowflake-method-workspace-phone-actions')).toBe(true);
		button?.click();
		expect(fixture.selectProject).toHaveBeenCalledExactlyOnceWith(PROJECT);
	});

	it('draws its board elsewhere', async () => {
		const fixture = mount(() => false);
		await open(fixture);
		expect(fixture.corkboard).toHaveBeenCalledOnce();
		expect(fixture.root.querySelector('.snowflake-method-workspace-phone-pane')).toBeNull();
		expect(fixture.root.querySelector('[role="tabpanel"]')).not.toBeNull();
	});

	it('puts the board away when the device class flips to a phone, and brings it back', async () => {
		let phone = false;
		const fixture = mount(() => phone);
		await open(fixture);
		expect(fixture.corkboard).toHaveBeenCalledOnce();
		phone = true;
		fixture.view.deviceClassChanged();
		await flush();
		expect(fixture.handle.dispose).toHaveBeenCalledOnce();
		expect(fixture.root.querySelector('.snowflake-method-workspace-phone-pane')).not.toBeNull();
		phone = false;
		fixture.view.deviceClassChanged();
		await flush();
		expect(fixture.corkboard).toHaveBeenCalledTimes(2);
		expect(fixture.root.querySelector('.snowflake-method-workspace-phone-pane')).toBeNull();
	});
});
