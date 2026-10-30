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
			registerDomEvent(target: EventTarget, type: string, listener: EventListener): void { target.addEventListener(type, listener); }
		},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import type { CorkboardControls } from '../../src/ui/corkboard-bridge';
import { SnowflakeStoryStructureView } from '../../src/ui/story-structure-view';
import type { DashboardHost, ProjectDashboardModel } from '../../src/ui/view-model';
import { installObsidianDom } from '../helpers/obsidian-dom';

const PROJECT = 'Novel/00_System/001_Project_Metadata.md';

async function flush(): Promise<void> {
	for (let round = 0; round < 10; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A sidebar as the workspace keeps one: folded or not, and told to fold or to open. */
function sidebar(collapsed: boolean) {
	const side = {
		collapsed,
		collapse: vi.fn(() => {
			side.collapsed = true;
		}),
		expand: vi.fn(() => {
			side.collapsed = false;
		}),
	};
	return side;
}

/**
 * Full screen is the view's answer to a board's toolbar: the leaf wears the
 * class the chrome is put away by, its tab group the one a tablet's tab bar
 * goes by, the window's sidebars fold and come back as they stood, and the
 * window is handed back by Escape, by the tab leaving the screen or closing.
 */
function mount(sides: { left: boolean; right: boolean } = { left: false, right: false }) {
	const throwing = (): never => {
		throw new Error('The frame is stubbed in this test.');
	};
	const handle = { refresh: vi.fn(), reveal: vi.fn(), remeasure: vi.fn(), saveFocusedBody: () => false, dispose: vi.fn() };
	let controls: CorkboardControls | null = null;
	const corkboard = vi.fn((_host: HTMLElement, given: CorkboardControls) => {
		controls = given;
		return handle;
	});
	const listeners = new Map<string, Set<() => void>>();
	const workspace = {
		layoutReady: true,
		requestSaveLayout: vi.fn(),
		leftSplit: sidebar(sides.left),
		rightSplit: sidebar(sides.right),
		on: vi.fn((name: string, listener: () => void) => {
			const held = listeners.get(name) ?? new Set<() => void>();
			held.add(listener);
			listeners.set(name, held);
			return { name, listener };
		}),
		offref: vi.fn((ref: { name: string; listener: () => void }) => {
			listeners.get(ref.name)?.delete(ref.listener);
		}),
		trigger: (name: string): void => {
			for (const listener of listeners.get(name) ?? []) listener();
		},
		listening: (name: string): number => listeners.get(name)?.size ?? 0,
	};
	const leaf = { app: { scope: {}, workspace }, getRoot: () => ({}) };
	const view = new SnowflakeStoryStructureView(
		leaf as unknown as WorkspaceLeaf,
		{
			host: {
				translateForProject: (_locale: unknown, key: string) => key,
				loadDashboardModel: () =>
					Promise.resolve({ path: PROJECT, projectId: 'novel', title: 'Novel', locale: 'en', worldbuildingKinds: [] } as unknown as ProjectDashboardModel),
				selectProject: vi.fn(() => Promise.resolve()),
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
			phone: () => false,
		},
	);
	// The leaf as the workspace stands it: in a tab group, with the leaf's content under it.
	const group = document.body.createDiv({ cls: 'workspace-tabs' });
	const leafEl = group.createDiv({ cls: 'workspace-tab-container' }).createDiv({ cls: 'workspace-leaf' });
	const container = leafEl.createDiv({ cls: 'workspace-leaf-content' });
	container.createDiv({ cls: 'view-header' });
	const root = container.createDiv({ cls: 'view-content' });
	Object.assign(view, { contentEl: root, containerEl: container, updateHeader: vi.fn() });
	return {
		view, root, container, group, handle, workspace,
		controls: (): CorkboardControls => {
			if (controls === null) throw new Error('No board was drawn.');
			return controls;
		},
	};
}

async function open(fixture: ReturnType<typeof mount>): Promise<void> {
	await fixture.view.setState({ projectPath: PROJECT, visualization: 'corkboard-ordered' }, { history: false });
	await fixture.view.onOpen();
	await flush();
}

beforeAll(() => {
	installObsidianDom(window);
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('full screen in the visualization workspace', () => {
	it('hands the board a control, and fills the window from it: the leaf and its group wear the classes, the sidebars fold, and the board measures again', async () => {
		const fixture = mount();
		await open(fixture);
		const control = fixture.controls().fullScreen!;
		expect(control.active()).toBe(false);
		control.toggle();
		expect(control.active()).toBe(true);
		expect(fixture.container.classList.contains('snowflake-method-full-screen')).toBe(true);
		expect(fixture.group.classList.contains('snowflake-method-full-screen-group')).toBe(true);
		expect(fixture.workspace.leftSplit.collapse).toHaveBeenCalledTimes(1);
		expect(fixture.workspace.rightSplit.collapse).toHaveBeenCalledTimes(1);
		expect(fixture.handle.remeasure).toHaveBeenCalled();
		expect(fixture.workspace.listening('active-leaf-change')).toBe(1);
		expect(fixture.workspace.listening('layout-change')).toBe(1);
	});

	it('hands the window back as it stood: a sidebar the author had folded stays folded, and the classes and the listening go', async () => {
		const fixture = mount({ left: true, right: false });
		await open(fixture);
		const control = fixture.controls().fullScreen!;
		const heard = vi.fn();
		control.changed(heard);
		control.toggle();
		expect(heard).toHaveBeenCalledTimes(1);
		control.toggle();
		expect(heard).toHaveBeenCalledTimes(2);
		expect(control.active()).toBe(false);
		expect(fixture.container.classList.contains('snowflake-method-full-screen')).toBe(false);
		expect(fixture.group.classList.contains('snowflake-method-full-screen-group')).toBe(false);
		expect(fixture.workspace.leftSplit.expand).not.toHaveBeenCalled();
		expect(fixture.workspace.rightSplit.expand).toHaveBeenCalledTimes(1);
		expect(fixture.workspace.listening('active-leaf-change')).toBe(0);
		expect(fixture.workspace.listening('layout-change')).toBe(0);
	});

	it('leaves full screen on Escape, but not an Escape a box of words took or one something inside answered', async () => {
		const fixture = mount();
		await open(fixture);
		const control = fixture.controls().fullScreen!;
		control.toggle();
		const box = fixture.root.createEl('textarea');
		box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		expect(control.active()).toBe(true);
		const answered = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		answered.preventDefault();
		fixture.root.dispatchEvent(answered);
		expect(control.active()).toBe(true);
		const plain = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		fixture.root.dispatchEvent(plain);
		expect(control.active()).toBe(false);
		expect(plain.defaultPrevented).toBe(true);
		// Outside full screen the key is left alone.
		const later = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		fixture.root.dispatchEvent(later);
		expect(later.defaultPrevented).toBe(false);
	});

	it('hands the window back when the tab leaves the screen, and marks the group the tab moved to while it stays shown', async () => {
		const fixture = mount();
		await open(fixture);
		const control = fixture.controls().fullScreen!;
		control.toggle();
		// Moved to another group, still shown: the new group is the marked one.
		const other = document.body.createDiv({ cls: 'workspace-tabs' });
		other.createDiv({ cls: 'workspace-tab-container' }).appendChild(fixture.container.parentElement!);
		fixture.workspace.trigger('layout-change');
		expect(control.active()).toBe(true);
		expect(fixture.group.classList.contains('snowflake-method-full-screen-group')).toBe(false);
		expect(other.classList.contains('snowflake-method-full-screen-group')).toBe(true);
		// Another tab in front: the window goes back.
		fixture.container.hidden = true;
		fixture.workspace.trigger('active-leaf-change');
		expect(control.active()).toBe(false);
		expect(other.classList.contains('snowflake-method-full-screen-group')).toBe(false);
		expect(fixture.workspace.leftSplit.expand).toHaveBeenCalledTimes(1);
	});

	it('hands the window back as the tab closes', async () => {
		const fixture = mount();
		await open(fixture);
		const control = fixture.controls().fullScreen!;
		control.toggle();
		await fixture.view.onClose();
		expect(fixture.container.classList.contains('snowflake-method-full-screen')).toBe(false);
		expect(fixture.group.classList.contains('snowflake-method-full-screen-group')).toBe(false);
		expect(fixture.workspace.leftSplit.expand).toHaveBeenCalledTimes(1);
		expect(fixture.workspace.rightSplit.expand).toHaveBeenCalledTimes(1);
	});
});
