import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		SearchComponent: class extends runtime.SearchComponent {
			setValue(): this { return this; }
		},
	};
});

import { renderCorkboard } from '../../src/ui/corkboard';
import { CorkboardDraftModal } from '../../src/ui/corkboard-draft-modal';
import type { CorkboardControls, CorkboardVariant } from '../../src/ui/corkboard-bridge';
import { corkboardMemory } from '../../src/ui/story-structure-state';
import type { ManagedSectionIssueViewModel, ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

const PROJECT = 'First/Project.md';
const POOL_TYPE = 'application/x-test-pool';

async function settle(): Promise<void> {
	for (let at = 0; at < 40; at++) await Promise.resolve();
}

function event(element: CorkboardElement, type: string, properties: Record<string, unknown>): void {
	for (const listener of element.listeners.get(type) ?? []) {
		listener({ target: element, preventDefault: () => undefined, stopPropagation: () => undefined, ...properties });
	}
}

function transfer(types: string[]) {
	const data = new Map<string, string>();
	return {
		types,
		effectAllowed: '',
		dropEffect: '',
		setData: (type: string, value: string) => { data.set(type, value); },
		getData: (type: string) => data.get(type) ?? '',
		data,
	};
}

function scene(index: number): SceneViewModel {
	const letter = 'abcde'[index]!;
	return {
		id: `scene-${letter}`, path: `First/Scenes/${letter}.md`, title: `Scene ${letter.toUpperCase()}`, rank: index,
		progressStatus: 'in-progress', aliases: [], categoryPaths: [],
		povPath: 'First/Cast/Hero.md', povName: 'Hero', povMissing: false,
		times: [], locations: [], characterPaths: [], conflict: '', color: null,
		linkedManuscript: [], worldStatus: [], relationships: [], events: '',
		customFields: '', revision: 'initial', healthIssues: [], readOnly: false,
	};
}

function pool(variant: CorkboardVariant, scenes = [0, 1, 2, 3, 4].map(scene), readOnly = false) {
	const dom = new CorkboardDom();
	let model = {
		path: PROJECT, projectId: 'first', locale: 'en', scenes,
		characters: [{ id: 'hero', path: 'First/Cast/Hero.md', name: 'Hero', readOnly: false, healthIssues: [] }],
		manuscriptPaths: [], readOnly,
	} as unknown as ProjectDashboardModel;
	const host = {
		openSceneForm: vi.fn(() => Promise.resolve(null)),
		reorderScene: vi.fn(() => Promise.resolve()),
		patchScene: vi.fn(() => Promise.resolve('next')),
	};
	const controls = {
		app: { metadataCache: { getFirstLinkpathDest: () => null } },
		host, t: (key: string) => key, model: () => model,
		activateProject: vi.fn(), refresh: vi.fn(async () => { handle.refresh(); }),
		popover: { closeFilter: vi.fn(), filterOpen: () => false, openFilter: vi.fn() },
		memory: corkboardMemory(), remember: vi.fn(),
	} as unknown as CorkboardControls;
	const handle = renderCorkboard(dom.container as unknown as HTMLElement, controls, variant);
	const cards = (): CorkboardElement[] => dom.container.querySelectorAll('.snowflake-method-corkboard-card');
	return {
		dom, host, handle,
		cards,
		root: dom.container.querySelector('.snowflake-method-corkboard')!,
		display: dom.container.querySelector('.snowflake-method-corkboard-display')!,
		scroller: dom.container.querySelector('.snowflake-method-corkboard-scroll')!,
		canvas: dom.container.querySelector('.snowflake-method-corkboard-canvas')!,
		add: dom.container.querySelector('.snowflake-method-corkboard-add')!,
		empty: dom.container.querySelector('.snowflake-method-character-empty')!,
		rename: (id: string, title: string) => {
			model = { ...model, scenes: model.scenes.map((candidate) => (candidate.id === id ? { ...candidate, title } : candidate)) };
		},
	};
}

describe('the corkboard as a pool', () => {
	it('shows the scenes included, numbered by their narrative place, in one column', () => {
		const fixture = pool({ include: (candidate) => candidate.id === 'scene-b' || candidate.id === 'scene-d', columns: 1 });
		const numbers = fixture.cards().map((card) => card.querySelector('.snowflake-method-corkboard-number')!.textContent);
		expect(numbers).toEqual(['2', '4']);
		expect(fixture.cards().map((card) => card.styles.transform?.startsWith('translate(0px'))).toEqual([true, true]);
		for (const card of fixture.cards()) {
			for (const insert of card.querySelectorAll('.snowflake-method-corkboard-insert')) {
				expect(insert.classes.has('is-hidden')).toBe(true);
			}
		}
	});

	it('stands its cards as close as it is told, having no insertion buttons to make room for', () => {
		const fixture = pool({ include: () => true, columns: 1, gap: 0.75 });
		expect(fixture.cards().slice(0, 2).map((card) => card.styles.transform)).toEqual(['translate(0px, 0px)', 'translate(0px, 252px)']);
		expect(fixture.dom.container.querySelector('.snowflake-method-corkboard')!.styles['--snowflake-method-corkboard-gap']).toBe('12px');
	});

	it('offers the add button as a plus alone, still making a scene at the end', async () => {
		const fixture = pool({ include: () => true, addButton: 'icon' });
		expect(fixture.add.classes.has('clickable-icon')).toBe(true);
		expect(fixture.add.classes.has('mod-cta')).toBe(false);
		expect(fixture.add.textContent).toBe('');
		expect(fixture.add.getAttribute('aria-label')).toBe('actions.addScene');
		fixture.add.dispatch('click');
		await settle();
		expect(fixture.host.openSceneForm).toHaveBeenCalledWith({ mode: 'create', afterIndex: null }, PROJECT, expect.any(Function));
	});

	it('says its own line when nothing is included', () => {
		const fixture = pool({ include: () => false, emptyText: 'Every scene is placed' });
		expect(fixture.cards()).toHaveLength(0);
		expect(fixture.empty.classes.has('is-hidden')).toBe(false);
		const spans = fixture.empty.querySelectorAll('span');
		expect(spans[spans.length - 1]?.textContent).toBe('Every scene is placed');
		expect(fixture.scroller.classes.has('is-hidden')).toBe(true);
		expect(fixture.display.classes.has('is-hidden')).toBe(true);
	});

	it('keeps the display control on an empty board whose card style dresses another surface', () => {
		const fixture = pool({ include: () => false, emptyText: 'Every scene is placed', modeShared: true });
		expect(fixture.scroller.classes.has('is-hidden')).toBe(true);
		expect(fixture.display.classes.has('is-hidden')).toBe(false);
		expect(fixture.dom.container.querySelector('.snowflake-method-filter-button')!.classes.has('is-hidden')).toBe(true);
		expect(fixture.dom.container.querySelector('.snowflake-method-corkboard-direction')!.classes.has('is-hidden')).toBe(true);
	});

	it('keeps its cards still on a project that cannot be written, for all that it offers a way out', () => {
		const onStart = vi.fn();
		const fixture = pool(
			{ include: () => true, dragOut: { type: POOL_TYPE, onStart, onEnd: vi.fn() } },
			[0, 1, 2].map(scene),
			true,
		);
		const card = fixture.cards()[0]!;
		expect(card.getAttribute('draggable')).toBe('false');
		const dataTransfer = transfer([]);
		event(card, 'dragstart', { target: null, dataTransfer });
		expect(onStart).not.toHaveBeenCalled();
		expect(dataTransfer.data.get(POOL_TYPE)).toBeUndefined();
		expect(card.classes.has('is-dragging')).toBe(false);
	});

	it('lets a scene whose note is damaged leave a project that can be written', () => {
		const damaged: ManagedSectionIssueViewModel = {
			path: 'First/Scenes/a.md', sectionId: null, sectionLabel: 'Scene', code: 'missing',
			message: 'The managed section is missing.', names: [], action: null,
			blocking: true, kind: 'section', stepIds: [], canOpen: true, repairable: false, repairField: null,
		};
		const scenes = [0, 1, 2, 3, 4].map(scene);
		scenes[0] = { ...scenes[0]!, healthIssues: [damaged] };
		const onStart = vi.fn();
		const fixture = pool({ include: () => true, dragOut: { type: POOL_TYPE, onStart, onEnd: vi.fn() } }, scenes);
		const card = fixture.cards()[0]!;
		// The card goes where it is placed by writing the timeline's own file,
		// never this note, so the note's damage is no reason to hold it still.
		expect(card.getAttribute('draggable')).toBe('true');
		const dataTransfer = transfer([]);
		event(card, 'dragstart', { target: null, dataTransfer });
		expect(dataTransfer.data.get(POOL_TYPE)).toBe('scene-a');
		expect(onStart).toHaveBeenCalledWith('scene-a', dataTransfer);
	});

	it('lets a card leave under the given type, and holds a paint until the drag has ended', () => {
		const onStart = vi.fn();
		const onEnd = vi.fn();
		const fixture = pool({ include: () => true, dragOut: { type: POOL_TYPE, onStart, onEnd } });
		const card = fixture.cards()[0]!;
		expect(card.getAttribute('draggable')).toBe('true');
		const dataTransfer = transfer([]);
		event(card, 'dragstart', { target: null, dataTransfer });
		expect(dataTransfer.data.get(POOL_TYPE)).toBe('scene-a');
		expect(onStart).toHaveBeenCalledWith('scene-a', dataTransfer);
		expect(card.classes.has('is-dragging')).toBe(true);
		fixture.rename('scene-a', 'Renamed');
		fixture.handle.refresh();
		expect(card.querySelector('.snowflake-method-corkboard-title')!.textContent).toBe('Scene A');
		event(card, 'dragend', {});
		expect(onEnd).toHaveBeenCalledOnce();
		expect(card.classes.has('is-dragging')).toBe(false);
		expect(fixture.cards()[0]!.querySelector('.snowflake-method-corkboard-title')!.textContent).toBe('Renamed');
	});

	it('takes another surface\'s drop as a whole, and never reorders for it', () => {
		const onDrop = vi.fn();
		const fixture = pool({
			include: () => true,
			dragOut: { type: POOL_TYPE, onStart: vi.fn(), onEnd: vi.fn() },
			dropIn: { accepts: (types) => types.includes('application/x-test-lane'), onDrop },
		});
		const dataTransfer = transfer(['application/x-test-lane']);
		event(fixture.root, 'dragover', { clientX: 10, clientY: 10, dataTransfer });
		expect(fixture.root.classes.has('is-drop-target')).toBe(true);
		expect(dataTransfer.dropEffect).toBe('move');
		event(fixture.root, 'drop', { dataTransfer });
		expect(onDrop).toHaveBeenCalledWith(dataTransfer);
		expect(fixture.root.classes.has('is-drop-target')).toBe(false);
		expect(fixture.host.reorderScene).not.toHaveBeenCalled();
		const foreign = transfer(['text/plain']);
		event(fixture.root, 'dragover', { clientX: 10, clientY: 10, dataTransfer: foreign });
		expect(fixture.root.classes.has('is-drop-target')).toBe(false);
		// The board's own reorder never takes such a drop, and a drop on the canvas is left to bubble.
		event(fixture.canvas, 'drop', { dataTransfer });
		expect(onDrop).toHaveBeenCalledOnce();
	});

	it('takes the drop on an empty pool too, where the scroller is hidden and only the empty line shows', () => {
		const onDrop = vi.fn();
		const fixture = pool({
			include: () => false,
			emptyText: 'Every scene is placed',
			dragOut: { type: POOL_TYPE, onStart: vi.fn(), onEnd: vi.fn() },
			dropIn: { accepts: (types) => types.includes('application/x-test-lane'), onDrop },
		});
		expect(fixture.scroller.classes.has('is-hidden')).toBe(true);
		expect(fixture.empty.classes.has('is-hidden')).toBe(false);
		const dataTransfer = transfer(['application/x-test-lane']);
		event(fixture.root, 'dragover', { clientX: 10, clientY: 10, dataTransfer });
		expect(fixture.root.classes.has('is-drop-target')).toBe(true);
		event(fixture.root, 'dragleave', { relatedTarget: null });
		expect(fixture.root.classes.has('is-drop-target')).toBe(false);
		event(fixture.root, 'dragover', { clientX: 10, clientY: 10, dataTransfer });
		event(fixture.root, 'drop', { dataTransfer });
		expect(onDrop).toHaveBeenCalledWith(dataTransfer);
		expect(fixture.root.classes.has('is-drop-target')).toBe(false);
	});

	it('keeps a refused draft for the writer when the card it belongs to has been parked', async () => {
		let placed = false;
		const opened: CorkboardDraftModal[] = [];
		vi.spyOn(CorkboardDraftModal.prototype, 'open').mockImplementation(function (this: CorkboardDraftModal) { opened.push(this); });
		const fixture = pool({ include: (candidate) => !(placed && candidate.id === 'scene-a') });
		fixture.host.patchScene.mockRejectedValueOnce(new Error('The scene has moved on'));
		const card = fixture.cards()[0]!;
		expect(card.getAttribute('data-id')).toBe('scene-a');
		const conflict = card.querySelector('.snowflake-method-corkboard-conflict')!;
		conflict.value = 'Unsaved draft';
		conflict.dispatch('input');
		conflict.dispatch('blur');
		// The scene leaves the pool while its write is on its way, so its card is
		// parked off the page with nowhere to show the words that come back.
		placed = true;
		fixture.handle.refresh();
		await settle();
		expect(fixture.cards().map((candidate) => candidate.getAttribute('data-id'))).not.toContain('scene-a');
		expect(opened).toHaveLength(1);
		vi.restoreAllMocks();
	});

	it('leaves a drop on its band alone, where a card let go is a slip and not a placement', () => {
		const onDrop = vi.fn();
		const fixture = pool({
			include: () => true,
			dragOut: { type: POOL_TYPE, onStart: vi.fn(), onEnd: vi.fn() },
			dropIn: { accepts: (types) => types.includes('application/x-test-lane'), onDrop },
		});
		const dataTransfer = transfer(['application/x-test-lane']);
		event(fixture.root, 'dragover', { clientX: 10, clientY: 10, dataTransfer });
		expect(fixture.root.classes.has('is-drop-target')).toBe(true);
		// Over the band the board is no target, and the mark goes with it.
		event(fixture.root, 'dragover', { target: fixture.display, clientX: 10, clientY: 10, dataTransfer });
		expect(fixture.root.classes.has('is-drop-target')).toBe(false);
		event(fixture.root, 'drop', { target: fixture.display, dataTransfer });
		expect(onDrop).not.toHaveBeenCalled();
		// On the field below, the drop lands as it did before.
		event(fixture.root, 'drop', { dataTransfer });
		expect(onDrop).toHaveBeenCalledWith(dataTransfer);
	});
});
