import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

const { notices } = vi.hoisted(() => ({ notices: vi.fn() }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		SearchComponent: class extends runtime.SearchComponent {
			setValue(): this { return this; }
		},
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

import type { ScenePatch } from '../../src/services';
import { renderCorkboard } from '../../src/ui/corkboard';
import type { CorkboardControls, CorkboardHandle } from '../../src/ui/corkboard-bridge';
import { corkboardMemory, type CorkboardMemory } from '../../src/ui/story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

const PROJECT = 'First/Project.md';
const OTHER_PROJECT = 'Second/Project.md';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((settle) => { resolve = settle; });
	return { promise, resolve };
}

async function settle(): Promise<void> {
	for (let at = 0; at < 40; at++) await Promise.resolve();
}

function escape(element: CorkboardElement): void {
	for (const listener of element.listeners.get('keydown') ?? []) {
		listener({
			target: element, ...{ key: 'Escape' },
			preventDefault: () => undefined, stopPropagation: () => undefined,
		});
	}
}

function board(group: CorkboardMemory['group'] = '', scene: Partial<SceneViewModel> = {}) {
	const dom = new CorkboardDom();
	let stored: SceneViewModel = {
		id: 'scene', path: 'First/Scenes/Opening.md', title: 'Opening', rank: 0,
		progressStatus: 'in-progress', aliases: [], categoryPaths: [],
		povPath: 'First/Cast/Hero.md', povName: 'Hero', povMissing: false,
		times: [], locations: [], characterPaths: [], conflict: 'An obstacle', color: null,
		linkedManuscript: [], worldStatus: [], relationships: [], events: '',
		customFields: '', revision: 'initial', healthIssues: [], readOnly: false,
		...scene,
	};
	let model = {
		path: PROJECT, projectId: 'first', locale: 'en', scenes: [stored],
		characters: [{ id: 'hero', path: stored.povPath, name: 'Hero', readOnly: false, healthIssues: [] }],
		manuscriptPaths: [], readOnly: false,
	} as unknown as ProjectDashboardModel;
	let serial = 0;
	let writeGate: ReturnType<typeof deferred> | null = null;
	let refreshGate: ReturnType<typeof deferred> | null = null;
	let handle: CorkboardHandle;
	const host = {
		patchScene: vi.fn(async (id: string, patch: ScenePatch, projectPath: string) => {
			const gate = writeGate;
			writeGate = null;
			if (gate !== null) await gate.promise;
			if (id !== stored.id || projectPath !== PROJECT) throw new Error('Wrong project');
			if (patch.expectedRevision !== stored.revision) throw new Error('Revision conflict');
			stored = {
				...stored,
				title: patch.title ?? stored.title,
				conflict: patch.conflict ?? stored.conflict,
				progressStatus: patch.progressStatus ?? stored.progressStatus,
				revision: `saved-${String(++serial)}`,
			};
			return stored.revision;
		}),
		openCharacterForm: vi.fn(() => Promise.resolve()),
	};
	const activateProject = vi.fn();
	const refresh = vi.fn(async () => {
		const gate = refreshGate;
		refreshGate = null;
		if (gate !== null) await gate.promise;
		model = { ...model, scenes: [stored] };
		handle.refresh();
	});
	const controls = {
		app: { metadataCache: { getFirstLinkpathDest: () => null } },
		host, t: (key: string) => key, model: () => model,
		activateProject, refresh,
		popover: { closeFilter: vi.fn() }, memory: { ...corkboardMemory(), group }, remember: vi.fn(),
	} as unknown as CorkboardControls;
	handle = renderCorkboard(dom.container as unknown as HTMLElement, controls);
	const card = dom.container.querySelector('.snowflake-method-corkboard-card')!;
	const conflict = card.querySelector('.snowflake-method-corkboard-conflict')!;
	const title = card.querySelector('.snowflake-method-corkboard-title')!;
	const titleInput = card.querySelector('.snowflake-method-corkboard-title-input')!;
	const status = card.querySelector('.snowflake-method-corkboard-status-select')!;
	return {
		dom, card, conflict, title, titleInput, status, host, controls, handle, activateProject, refresh,
		stored: () => stored,
		external: (changes: Partial<SceneViewModel>) => {
			stored = { ...stored, ...changes };
			model = { ...model, scenes: [stored] };
			handle.refresh();
		},
		switchProject: () => { model = { ...model, path: OTHER_PROJECT }; },
		holdWrite: () => { writeGate = deferred(); return writeGate; },
		holdRefresh: () => { refreshGate = deferred(); return refreshGate; },
		typeConflict: (value: string) => {
			conflict.value = value;
			conflict.dispatch('input');
		},
		setStatus: (value: string) => {
			status.value = value;
			status.dispatch('change');
		},
	};
}

beforeEach(() => { vi.clearAllMocks(); });

describe('corkboard drafts across regrouping', () => {
	it.each(['conflict', 'title'] as const)('keeps a focused %s draft through its earlier status save', async (field) => {
		const fixture = board('status');
		const gate = fixture.holdWrite();
		fixture.setStatus('complete');
		await settle();
		const editor = field === 'conflict' ? fixture.conflict : fixture.titleInput;
		if (field === 'title') fixture.title.dispatch('click');
		editor.focus();
		editor.value = 'Unsaved local draft';
		editor.dispatch('input');
		gate.resolve();
		await settle();
		expect(fixture.card.getAttribute('data-key')).toBe('status:complete|scene');
		expect(fixture.dom.container.contains(editor)).toBe(true);
		expect(fixture.dom.doc.activeElement).toBe(editor);
		expect(editor.value).toBe('Unsaved local draft');
		editor.dispatch('blur');
		await settle();
		expect(fixture.host.patchScene).toHaveBeenLastCalledWith('scene', {
			[field]: 'Unsaved local draft', expectedRevision: 'saved-1',
		}, PROJECT);
		expect(fixture.stored()[field]).toBe('Unsaved local draft');
		expect(notices).not.toHaveBeenCalled();
		fixture.handle.dispose();
	});

	it.each(['conflict', 'title'] as const)('keeps a regrouped %s draft on its original external revision', async (field) => {
		const fixture = board('status');
		const editor = field === 'conflict' ? fixture.conflict : fixture.titleInput;
		if (field === 'title') fixture.title.dispatch('click');
		editor.focus();
		editor.value = 'Unsaved local draft';
		editor.dispatch('input');
		fixture.external({ progressStatus: 'complete', [field]: 'External edit', revision: 'external' });
		expect(fixture.dom.doc.activeElement).toBe(editor);
		expect(fixture.dom.container.contains(editor)).toBe(true);
		expect(editor.value).toBe('Unsaved local draft');
		editor.dispatch('blur');
		await settle();
		expect(fixture.host.patchScene).toHaveBeenLastCalledWith('scene', {
			[field]: 'Unsaved local draft', expectedRevision: 'initial',
		}, PROJECT);
		expect(fixture.stored()[field]).toBe('External edit');
		expect(notices).toHaveBeenCalledWith('Revision conflict');
		expect(editor.value).toBe('Unsaved local draft');
		escape(editor);
		fixture.handle.dispose();
	});

	it('lets a focused editor replace a clean copy in the surviving group', () => {
		const fixture = board('category', { categoryPaths: ['A', 'B'] });
		const copies = fixture.dom.container.querySelectorAll('.snowflake-method-corkboard-card');
		expect(copies).toHaveLength(2);
		fixture.conflict.focus();
		fixture.typeConflict('Draft from A');
		fixture.external({ categoryPaths: ['B'], revision: 'external' });
		expect(fixture.dom.container.querySelectorAll('.snowflake-method-corkboard-card')).toEqual([fixture.card]);
		expect(fixture.card.getAttribute('data-key')).toBe('category:B|scene');
		expect(fixture.dom.doc.activeElement).toBe(fixture.conflict);
		expect(fixture.conflict.value).toBe('Draft from A');
		escape(fixture.conflict);
		fixture.handle.dispose();
	});

	it('retains distinct drafts when their group copies collapse and restores them when they return', () => {
		const fixture = board('category', { categoryPaths: ['A', 'B'] });
		const other = fixture.dom.container.querySelectorAll('.snowflake-method-corkboard-conflict')[1]!;
		fixture.typeConflict('Draft from A');
		other.value = 'Draft from B';
		other.dispatch('input');
		other.focus();
		fixture.external({ categoryPaths: ['C'], revision: 'external' });
		expect(fixture.dom.container.contains(other)).toBe(true);
		expect(fixture.dom.doc.activeElement).toBe(other);
		expect(other.value).toBe('Draft from B');
		fixture.external({ categoryPaths: ['A', 'B'], revision: 'external-2' });
		expect(fixture.dom.container.contains(fixture.conflict)).toBe(true);
		expect(fixture.dom.container.contains(other)).toBe(true);
		expect(fixture.conflict.value).toBe('Draft from A');
		expect(other.value).toBe('Draft from B');
		expect(fixture.dom.doc.activeElement).toBe(other);
		escape(fixture.conflict);
		escape(other);
		fixture.handle.dispose();
	});

	it('restores a filtered-out dirty editor without dropping its draft', () => {
		const fixture = board();
		fixture.typeConflict('Hidden draft');
		fixture.controls.memory.query = 'no matching scene';
		fixture.handle.refresh();
		expect(fixture.dom.container.contains(fixture.conflict)).toBe(false);
		fixture.controls.memory.query = '';
		fixture.handle.refresh();
		expect(fixture.dom.container.contains(fixture.conflict)).toBe(true);
		expect(fixture.conflict.value).toBe('Hidden draft');
		escape(fixture.conflict);
		fixture.handle.dispose();
	});

	it('saves a retained hidden draft when the board closes', async () => {
		const fixture = board();
		fixture.typeConflict('Hidden draft');
		fixture.controls.memory.query = 'no matching scene';
		fixture.handle.refresh();
		fixture.handle.dispose();
		await settle();
		expect(fixture.host.patchScene).toHaveBeenCalledWith('scene', {
			conflict: 'Hidden draft', expectedRevision: 'initial',
		}, PROJECT);
		expect(fixture.stored().conflict).toBe('Hidden draft');
	});
});

describe('corkboard text revisions', () => {
	it('refreshes an untouched focused conflict without writing its old contents on blur', async () => {
		const fixture = board();
		fixture.conflict.focus();
		fixture.external({ conflict: 'External edit', revision: 'external' });
		expect(fixture.conflict.value).toBe('External edit');
		fixture.conflict.dispatch('blur');
		await settle();
		expect(fixture.host.patchScene).not.toHaveBeenCalled();
		expect(fixture.stored().conflict).toBe('External edit');
		fixture.handle.dispose();
	});

	it('keeps a dirty conflict on its original revision when another editor refreshes the scene', async () => {
		const fixture = board();
		fixture.typeConflict('My draft');
		fixture.external({ conflict: 'External edit', revision: 'external' });
		expect(fixture.conflict.value).toBe('My draft');
		fixture.conflict.dispatch('blur');
		await settle();
		expect(fixture.host.patchScene).toHaveBeenCalledWith('scene', {
			conflict: 'My draft', expectedRevision: 'initial',
		}, PROJECT);
		expect(fixture.stored().conflict).toBe('External edit');
		expect(notices).toHaveBeenCalledWith('Revision conflict');
		expect(fixture.conflict.value).toBe('My draft');
		fixture.conflict.dispatch('blur');
		await settle();
		expect(fixture.host.patchScene).toHaveBeenLastCalledWith('scene', {
			conflict: 'My draft', expectedRevision: 'initial',
		}, PROJECT);
		escape(fixture.conflict);
		expect(fixture.conflict.value).toBe('External edit');
		fixture.typeConflict('Resolved draft');
		fixture.conflict.dispatch('blur');
		await settle();
		expect(fixture.host.patchScene).toHaveBeenLastCalledWith('scene', {
			conflict: 'Resolved draft', expectedRevision: 'external',
		}, PROJECT);
		expect(fixture.stored().conflict).toBe('Resolved draft');
		fixture.handle.dispose();
	});

	it.each([false, true])('protects a title editor across external refresh (edited: %s)', async (edited) => {
		const fixture = board();
		fixture.title.dispatch('click');
		if (edited) fixture.titleInput.value = 'My title';
		fixture.external({ title: 'External title', revision: 'external' });
		fixture.titleInput.dispatch('blur');
		await settle();
		if (edited) {
			expect(fixture.host.patchScene).toHaveBeenCalledWith('scene', {
				title: 'My title', expectedRevision: 'initial',
			}, PROJECT);
			expect(notices).toHaveBeenCalledWith('Revision conflict');
			expect(fixture.titleInput.value).toBe('My title');
			expect(fixture.titleInput.classes.has('is-hidden')).toBe(false);
			escape(fixture.titleInput);
		} else {
			expect(fixture.host.patchScene).not.toHaveBeenCalled();
		}
		expect(fixture.stored().title).toBe('External title');
		expect(fixture.title.textContent).toBe('External title');
		fixture.handle.dispose();
	});

	it('adopts the latest conflict on blur when the author reverts an unfinished draft', async () => {
		const fixture = board();
		fixture.typeConflict('My draft');
		fixture.external({ conflict: 'External edit', revision: 'external' });
		fixture.typeConflict('An obstacle');
		fixture.conflict.dispatch('blur');
		await settle();
		expect(fixture.host.patchScene).not.toHaveBeenCalled();
		expect(fixture.conflict.value).toBe('External edit');
		fixture.handle.dispose();
	});

	it('advances a draft revision through an earlier successful status save', async () => {
		const fixture = board();
		const gate = fixture.holdWrite();
		fixture.setStatus('complete');
		await settle();
		fixture.typeConflict('My draft');
		gate.resolve();
		await settle();
		expect(fixture.conflict.value).toBe('My draft');
		fixture.conflict.dispatch('blur');
		await settle();
		expect(fixture.host.patchScene).toHaveBeenLastCalledWith('scene', {
			conflict: 'My draft', expectedRevision: 'saved-1',
		}, PROJECT);
		expect(fixture.stored().conflict).toBe('My draft');
		expect(notices).not.toHaveBeenCalled();
		fixture.handle.dispose();
	});

	it.each(['title', 'conflict'] as const)('keeps successive %s saves ordered and their latest value visible', async (field) => {
		const fixture = board();
		const gate = fixture.holdWrite();
		const commit = (value: string): void => {
			if (field === 'title') {
				fixture.title.dispatch('click');
				fixture.titleInput.value = value;
				fixture.titleInput.dispatch('blur');
			} else {
				fixture.typeConflict(value);
				fixture.conflict.dispatch('blur');
			}
		};
		commit('First draft');
		await settle();
		commit('Second draft');
		fixture.handle.refresh();
		expect(field === 'title' ? fixture.title.textContent : fixture.conflict.value).toBe('Second draft');
		gate.resolve();
		await settle();
		expect(fixture.host.patchScene).toHaveBeenCalledTimes(2);
		expect(fixture.host.patchScene).toHaveBeenLastCalledWith('scene', {
			[field]: 'Second draft', expectedRevision: 'saved-1',
		}, PROJECT);
		expect(fixture.stored()[field]).toBe('Second draft');
		expect(notices).not.toHaveBeenCalled();
		fixture.handle.dispose();
	});

	it('does not advance a draft through an external edit after its own preceding save', async () => {
		const fixture = board();
		const gate = fixture.holdRefresh();
		fixture.setStatus('complete');
		await settle();
		fixture.typeConflict('My draft');
		fixture.conflict.dispatch('blur');
		fixture.external({ conflict: 'External edit', revision: 'external' });
		gate.resolve();
		await settle();
		expect(fixture.host.patchScene).toHaveBeenLastCalledWith('scene', {
			conflict: 'My draft', expectedRevision: 'saved-1',
		}, PROJECT);
		expect(fixture.stored().conflict).toBe('External edit');
		expect(notices).toHaveBeenCalledWith('Revision conflict');
		fixture.handle.dispose();
	});
});

describe('corkboard disposal saves', () => {
	it('drains committed and final dirty conflicts in order for the original project', async () => {
		const fixture = board();
		const gate = fixture.holdWrite();
		fixture.setStatus('complete');
		await settle();
		fixture.typeConflict('Committed draft');
		fixture.conflict.dispatch('blur');
		fixture.typeConflict('Final draft');
		fixture.handle.dispose();
		fixture.switchProject();
		expect(fixture.host.patchScene).toHaveBeenCalledTimes(1);
		gate.resolve();
		await settle();
		expect(fixture.host.patchScene.mock.calls).toEqual([
			['scene', { progressStatus: 'complete', expectedRevision: 'initial' }, PROJECT],
			['scene', { conflict: 'Committed draft', expectedRevision: 'saved-1' }, PROJECT],
			['scene', { conflict: 'Final draft', expectedRevision: 'saved-2' }, PROJECT],
		]);
		expect(fixture.stored().conflict).toBe('Final draft');
		expect(fixture.activateProject).not.toHaveBeenCalled();
		expect(fixture.refresh).not.toHaveBeenCalled();
		expect(notices).not.toHaveBeenCalled();
	});

	it('saves an unfinished title on disposal once', async () => {
		const fixture = board();
		fixture.title.dispatch('click');
		fixture.titleInput.value = 'Final title';
		fixture.handle.dispose();
		fixture.handle.dispose();
		await settle();
		expect(fixture.host.patchScene).toHaveBeenCalledTimes(1);
		expect(fixture.stored().title).toBe('Final title');
	});

	it('keeps a queued status save after disposal while cancelling a queued character dialog', async () => {
		const fixture = board();
		const gate = fixture.holdWrite();
		fixture.setStatus('complete');
		await settle();
		fixture.card.querySelector('.snowflake-method-corkboard-pov')!.dispatch('click');
		fixture.setStatus('in-progress');
		fixture.handle.dispose();
		gate.resolve();
		await settle();
		expect(fixture.host.openCharacterForm).not.toHaveBeenCalled();
		expect(fixture.host.patchScene).toHaveBeenCalledTimes(2);
		expect(fixture.stored().progressStatus).toBe('in-progress');
		expect(notices).not.toHaveBeenCalled();
	});
});
