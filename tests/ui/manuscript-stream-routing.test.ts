import { describe, expect, it, vi } from 'vitest';

import type { ViewState } from 'obsidian';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import SnowflakeMethodPlugin from '../../src/main';
import {
	MANUSCRIPT_VIEW_TYPE,
	SnowflakeManuscriptView,
} from '../../src/ui/manuscript-view';

const projectPath = 'Novel/Novel.md';
const previousPath = 'Novel/50_Manuscript/Chapter 1.md';
const targetPath = 'Novel/50_Manuscript/Chapter 8.md';
const targetOffset = 1800;

function manuscriptLeaf(deferred = false) {
	let visible = false;
	const stream = {
		scrollTop: 240,
		getBoundingClientRect: () => ({ top: visible ? 60 : 0 }),
	};
	const target = {
		el: {
			getBoundingClientRect: () => ({
				top: visible ? 60 + targetOffset - stream.scrollTop : 0,
			}),
		},
	};
	const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
	// Keep the real revealSegment -> goTo -> scrollToActive path. Only note
	// mounting and browser layout are replaced: a hidden tab has zero geometry.
	Object.assign(view, {
		model: { segments: [{ path: previousPath }, { path: targetPath }] },
		activePath: previousPath,
		anchorPath: previousPath,
		streamEl: stream,
		mounted: new Map([[targetPath, target]]),
		deactivateSegment: vi.fn(() => Promise.resolve()),
		applyWindow: vi.fn(() => Promise.resolve()),
		quietly: (run: () => void) => run(),
	});
	let state: ViewState = {
		type: MANUSCRIPT_VIEW_TYPE,
		state: { projectPath, anchorPath: previousPath },
	};
	const leaf = {
		view: deferred ? {} : view,
		getViewState: () => state,
		setViewState: vi.fn((next: ViewState) => {
			state = next;
			return Promise.resolve();
		}),
		loadIfDeferred: vi.fn(async () => {
			await Promise.resolve();
			leaf.view = view;
		}),
	};
	return { leaf, view, stream, show: () => { visible = true; } };
}

function pluginWith(existing?: ReturnType<typeof manuscriptLeaf>) {
	const created = manuscriptLeaf(true);
	let activeLeaf: object = {};
	const workspace = {
		getLeavesOfType: vi.fn(() => existing === undefined ? [] : [existing.leaf]),
		setActiveLeaf: vi.fn((leaf: object) => { activeLeaf = leaf; }),
		revealLeaf: vi.fn(async (leaf: object) => {
			// Selecting the leaf alone does not finish revealing its layout.
			await Promise.resolve();
			if (leaf === existing?.leaf) existing.show();
			if (leaf === created.leaf) created.show();
		}),
	};
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	const createLeaf = vi.fn(() => created.leaf);
	const rememberedNote = vi.fn(() => previousPath);
	Object.assign(plugin, {
		app: { workspace },
		manuscriptLeaf: createLeaf,
		rememberedManuscriptNote: rememberedNote,
	});
	return { plugin, created, createLeaf, rememberedNote, activeLeaf: () => activeLeaf };
}

describe('opening the manuscript at a linked note', () => {
	it.each([false, true])('scrolls a reused hidden stream to the requested note (deferred: %s)', async (deferred) => {
		const existing = manuscriptLeaf(deferred);
		const { plugin, createLeaf, activeLeaf } = pluginWith(existing);

		await plugin.openManuscriptStream(projectPath, targetPath);

		expect(existing.view.activeSegment()).toBe(targetPath);
		expect(existing.stream.scrollTop).toBe(targetOffset);
		expect(existing.leaf.loadIfDeferred).toHaveBeenCalledOnce();
		expect(existing.leaf.setViewState).not.toHaveBeenCalled();
		expect(createLeaf).not.toHaveBeenCalled();
		expect(activeLeaf()).toBe(existing.leaf);
	});

	it('preserves the reading position when an existing stream is opened without a note', async () => {
		const existing = manuscriptLeaf();
		const { plugin, createLeaf, rememberedNote, activeLeaf } = pluginWith(existing);

		await plugin.openManuscriptStream(projectPath);

		expect(existing.view.activeSegment()).toBe(previousPath);
		expect(existing.stream.scrollTop).toBe(240);
		expect(existing.leaf.setViewState).not.toHaveBeenCalled();
		expect(createLeaf).not.toHaveBeenCalled();
		expect(rememberedNote).not.toHaveBeenCalled();
		expect(activeLeaf()).toBe(existing.leaf);
	});

	it('passes the requested note to a newly created stream', async () => {
		const { plugin, created, createLeaf, rememberedNote, activeLeaf } = pluginWith();

		await plugin.openManuscriptStream(projectPath, targetPath);

		expect(createLeaf).toHaveBeenCalledOnce();
		expect(created.leaf.setViewState).toHaveBeenCalledExactlyOnceWith({
			type: MANUSCRIPT_VIEW_TYPE,
			active: true,
			state: { projectPath, anchorPath: targetPath },
		});
		expect(rememberedNote).not.toHaveBeenCalled();
		expect(activeLeaf()).toBe(created.leaf);
	});
});
