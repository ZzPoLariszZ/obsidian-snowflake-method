import { afterEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, CorkboardElement } from '../helpers/corkboard-dom';

const { notices } = vi.hoisted(() => ({ notices: vi.fn() }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		Keymap: { isModifier: () => true },
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

vi.mock('../../src/ui/anchored-panel', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../../src/ui/anchored-panel')>();
	return {
		...runtime,
		hangPanel: (anchor: HTMLElement, spec: Parameters<typeof runtime.hangPanel>[1]) => {
			const el = (anchor as unknown as CorkboardElement).dom.container.createDiv({ cls: spec.cls });
			spec.build(el as unknown as HTMLElement);
			return { el, release: vi.fn() };
		},
	};
});

import type { App } from 'obsidian';

import { MACARON_COLORS } from '../../src/domain';
import type { ScenePatch } from '../../src/services';
import { CorkboardDraftModal } from '../../src/ui/corkboard-draft-modal';
import {
	createSceneCardDeck,
	type SceneCard,
	type SceneCardDeck,
} from '../../src/ui/scene-card';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

// Obsidian's own DOM carries `instanceOf`, and a browser has `Element`; the
// control check reads the one off the event target and names the other.
(CorkboardElement.prototype as unknown as { instanceOf: () => boolean }).instanceOf = () => true;
vi.stubGlobal('Element', class {});

const PROJECT = 'First/Project.md';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((settle) => { resolve = settle; });
	return { promise, resolve };
}

async function settle(): Promise<void> {
	for (let at = 0; at < 40; at++) await Promise.resolve();
}

/** Calls an element's own listeners for a key, the way the board's tests do. */
function press(element: CorkboardElement, key: string): void {
	for (const listener of element.listeners.get('keydown') ?? []) {
		listener({ target: element, ...{ key }, preventDefault: () => undefined, stopPropagation: () => undefined });
	}
}

/** Fires a card's listener with another element as the target, which the fake's dispatch cannot. */
function fireOn(element: CorkboardElement, type: string, target: CorkboardElement): void {
	for (const listener of element.listeners.get(type) ?? []) {
		listener({ target, preventDefault: () => undefined, stopPropagation: () => undefined });
	}
}

const el = (node: unknown): CorkboardElement => node as CorkboardElement;

function deal(scene: Partial<SceneViewModel> = {}) {
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
	const other: SceneViewModel = { ...stored, id: 'other', path: 'First/Scenes/Other.md', title: 'Other' };
	let scenes: SceneViewModel[] = [stored, other];
	let model = {
		path: PROJECT, projectId: 'first', locale: 'en', scenes,
		characters: [{ id: 'hero', path: stored.povPath, name: 'Hero', readOnly: false, healthIssues: [] }],
		manuscriptPaths: [], readOnly: false,
	} as unknown as ProjectDashboardModel;
	let serial = 0;
	let readOnly = false;
	let dragAllowed = true;
	let writeGate: ReturnType<typeof deferred> | null = null;
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
				color: patch.color === undefined ? stored.color : patch.color,
				revision: `saved-${String(++serial)}`,
			};
			scenes = scenes.map((candidate) => (candidate.id === stored.id ? stored : candidate));
			return stored.revision;
		}),
		openCharacterForm: vi.fn(() => Promise.resolve()),
		openSceneForm: vi.fn(() => Promise.resolve(null)),
		openManagedFile: vi.fn(() => Promise.resolve()),
		openManuscriptStream: vi.fn(() => Promise.resolve()),
	};
	const menu = vi.fn();
	const notice = vi.fn();
	const refresh = vi.fn(async () => {
		model = { ...model, scenes };
		for (const card of deck.cards.values()) {
			const latest = scenes.find((candidate) => candidate.id === card.id);
			if (latest !== undefined) deck.dress(card, latest, 0, { position: 1, size: scenes.length });
		}
	});
	const deck: SceneCardDeck<SceneCard> = createSceneCardDeck<SceneCard>({
		app: { metadataCache: { getFirstLinkpathDest: () => null } } as unknown as App,
		host,
		t: (key: string) => key,
		refresh,
		notice,
		model: () => model,
		projectPath: () => PROJECT,
		readOnly: () => readOnly,
		charactersByPath: () => new Map(model.characters.map((character) => [character.path, character])),
		scenesById: () => new Map(model.scenes.map((candidate) => [candidate.id, candidate])),
		manuscriptPositions: () => new Map(),
		resolveManuscriptPath: () => null,
		dragAllowed: () => dragAllowed,
		menu,
		extend: (card) => card,
	});
	const mount = (key = stored.id): SceneCard => {
		const card = deck.mount(dom.container as unknown as HTMLElement, key, stored, 0);
		deck.dress(card, stored, 0, { position: 1, size: scenes.length });
		return card;
	};
	return {
		dom, deck, host, refresh, menu, notice, mount,
		stored: () => stored,
		setReadOnly: (value: boolean) => { readOnly = value; },
		setDragAllowed: (value: boolean) => { dragAllowed = value; },
		holdWrite: () => { writeGate = deferred(); return writeGate; },
		external: (changes: Partial<SceneViewModel>) => {
			stored = { ...stored, ...changes };
			scenes = scenes.map((candidate) => (candidate.id === stored.id ? stored : candidate));
			model = { ...model, scenes };
		},
		remove: () => {
			scenes = scenes.filter((candidate) => candidate.id !== stored.id);
			model = { ...model, scenes };
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	notices.mockClear();
});

describe('a scene card dealt from the deck', () => {
	it('stands under the parent with every part, keyed and numbered', () => {
		const { dom, deck, mount } = deal();
		const card = mount();
		const root = dom.container.querySelector('.snowflake-method-corkboard-card')!;
		expect(el(card.el)).toBe(root);
		expect(root.getAttribute('role')).toBe('listitem');
		expect(root.getAttribute('data-key')).toBe('scene');
		expect(root.getAttribute('data-id')).toBe('scene');
		expect(root.getAttribute('aria-posinset')).toBe('1');
		expect(root.getAttribute('aria-setsize')).toBe('2');
		expect(root.getAttribute('draggable')).toBe('true');
		for (const part of ['grip', 'head', 'title', 'title-input', 'status-select', 'body', 'conflict', 'links', 'chips', 'footer', 'pov', 'color', 'more']) {
			expect(root.querySelector(`.snowflake-method-corkboard-${part}`), part).not.toBeNull();
		}
		expect(el(card.number).textContent).toBe('1');
		expect(el(card.title).textContent).toBe('Opening');
		expect(el(card.conflict).value).toBe('An obstacle');
		expect(el(card.status).value).toBe('in-progress');
		expect(deck.cards.get('scene')).toBe(card);
	});

	it('dresses again without rewriting what has not moved', () => {
		const { deck, mount, stored } = deal();
		const card = mount();
		const before = [el(card.title).textWrites, el(card.pov).textWrites, el(card.moreLinks).textWrites];
		deck.dress(card, stored(), 0, { position: 1, size: 2 });
		expect([el(card.title).textWrites, el(card.pov).textWrites, el(card.moreLinks).textWrites]).toEqual(before);
		expect(el(card.conflict).value).toBe('An obstacle');
	});

	it('edits the name in place, refusing an empty one and one another scene answers to', async () => {
		const { deck, dom, host, mount, stored } = deal();
		const card = mount();
		const input = el(card.titleInput);
		deck.beginTitleEdit(card);
		expect(card.editingTitle).toBe(true);
		expect(el(card.title).classes.has('is-hidden')).toBe(true);
		expect(input.classes.has('is-hidden')).toBe(false);
		expect(input.value).toBe('Opening');
		expect(dom.doc.activeElement).toBe(input);
		input.value = '   ';
		press(input, 'Enter');
		expect(notices).toHaveBeenLastCalledWith('modal.scene.nameRequired');
		expect(card.editingTitle).toBe(true);
		input.value = 'Other';
		press(input, 'Enter');
		expect(notices).toHaveBeenLastCalledWith('modal.scene.nameTaken');
		expect(host.patchScene).not.toHaveBeenCalled();
		input.value = 'Renamed';
		press(input, 'Enter');
		expect(card.editingTitle).toBe(false);
		expect(el(card.title).textContent).toBe('Renamed');
		await settle();
		expect(host.patchScene).toHaveBeenCalledWith('scene', { title: 'Renamed', expectedRevision: 'initial' }, PROJECT);
		expect(stored().title).toBe('Renamed');
		deck.beginTitleEdit(card);
		input.value = 'Nope';
		press(input, 'Escape');
		expect(card.editingTitle).toBe(false);
		expect(el(card.title).textContent).toBe('Renamed');
		expect(host.patchScene).toHaveBeenCalledTimes(1);
	});

	it('saves the conflict when its box is left, and on the chord', async () => {
		const { host, mount, stored, refresh } = deal();
		const card = mount();
		const conflict = el(card.conflict);
		conflict.value = 'Changed';
		conflict.dispatch('input');
		expect(card.conflictDirty).toBe(true);
		conflict.dispatch('blur');
		await settle();
		expect(host.patchScene).toHaveBeenLastCalledWith('scene', { conflict: 'Changed', expectedRevision: 'initial' }, PROJECT);
		expect(refresh).toHaveBeenCalledTimes(1);
		conflict.value = 'Again';
		conflict.dispatch('input');
		press(conflict, 'Enter');
		await settle();
		expect(host.patchScene).toHaveBeenLastCalledWith('scene', { conflict: 'Again', expectedRevision: 'saved-1' }, PROJECT);
		expect(stored().conflict).toBe('Again');
		expect(card.conflictDirty).toBe(false);
	});

	it('paints a pending status on every copy of the scene until the write lands', async () => {
		const { host, mount, holdWrite } = deal();
		const first = mount('a|scene');
		const second = mount('b|scene');
		const gate = holdWrite();
		el(first.status).value = 'complete';
		el(first.status).dispatch('change');
		expect(el(second.status).value).toBe('complete');
		expect(el(second.status).classes.has('is-complete')).toBe(true);
		await settle();
		expect(host.patchScene).toHaveBeenCalledWith('scene', { progressStatus: 'complete', expectedRevision: 'initial' }, PROJECT);
		gate.resolve();
		await settle();
		expect(el(first.status).value).toBe('complete');
		expect(el(second.status).value).toBe('complete');
	});

	it("carries an editor's revision through the board's own rank write", async () => {
		const { deck, host, mount, external } = deal();
		const card = mount();
		deck.beginTitleEdit(card);
		external({ revision: 'ranked' });
		deck.adoptRevision({ id: 'scene', before: 'initial', after: 'ranked' });
		el(card.titleInput).value = 'Moved';
		press(el(card.titleInput), 'Enter');
		await settle();
		expect(host.patchScene).toHaveBeenCalledWith('scene', { title: 'Moved', expectedRevision: 'ranked' }, PROJECT);
	});

	it('moves a pending text with its card under a new key', async () => {
		const { deck, mount, holdWrite } = deal();
		const card = mount();
		const gate = holdWrite();
		deck.beginTitleEdit(card);
		el(card.titleInput).value = 'Renamed';
		press(el(card.titleInput), 'Enter');
		expect(deck.editingKeys()).toEqual(['scene']);
		deck.rekey(card, 'g|scene');
		expect(deck.cards.get('g|scene')).toBe(card);
		expect(deck.cards.has('scene')).toBe(false);
		expect(el(card.el).getAttribute('data-key')).toBe('g|scene');
		expect(deck.editingKeys()).toEqual(['g|scene']);
		gate.resolve();
		await settle();
		expect(deck.editingKeys()).toEqual([]);
	});

	it('parks a draft the window left no place for, and recovers it once the scene cannot be written', async () => {
		const { deck, mount, setReadOnly } = deal();
		const opened: CorkboardDraftModal[] = [];
		vi.spyOn(CorkboardDraftModal.prototype, 'open').mockImplementation(function (this: CorkboardDraftModal) { opened.push(this); });
		const card = mount();
		el(card.conflict).value = 'Draft';
		el(card.conflict).dispatch('input');
		deck.park(card);
		expect(el(card.el).isConnected).toBe(false);
		expect(deck.cards.get('scene')).toBe(card);
		expect(card.conflictDirty).toBe(true);
		expect(deck.editingKeys()).toEqual(['scene']);
		setReadOnly(true);
		deck.park(card);
		await settle();
		expect(opened).toHaveLength(1);
		expect(card.conflictDirty).toBe(false);
		expect(el(card.conflict).value).toBe('An obstacle');
	});

	it('recovers the draft of a scene that went when its card comes down', async () => {
		const { deck, mount, remove } = deal();
		const opened: CorkboardDraftModal[] = [];
		vi.spyOn(CorkboardDraftModal.prototype, 'open').mockImplementation(function (this: CorkboardDraftModal) { opened.push(this); });
		const card = mount();
		deck.beginTitleEdit(card);
		el(card.titleInput).value = 'Typed';
		remove();
		deck.unmount('scene');
		await settle();
		expect(deck.cards.size).toBe(0);
		expect(el(card.el).isConnected).toBe(false);
		expect(opened).toHaveLength(1);
	});

	it('names the part the focus stands on', () => {
		const { deck, mount } = deal();
		const card = mount();
		expect(deck.partOf(card, 'title')).toBe(card.title);
		deck.beginTitleEdit(card);
		expect(deck.partOf(card, 'title')).toBe(card.titleInput);
		expect(deck.partOf(card, 'pov')).toBe(card.pov);
		expect(deck.partOf(card, 'status')).toBe(card.status);
		expect(deck.partOf(card, 'color')).toBe(card.color);
		expect(deck.partOf(card, 'more')).toBe(card.more);
		expect(deck.partOf(card, 'conflict')).toBe(card.conflict);
		expect(deck.partOf(card, 'more-links')).toBe(card.moreLinks);
		expect(deck.partOf(card, 'link')).toBe(card.el);
		expect(deck.partOf(card, 'card')).toBe(card.el);
	});

	it('tints the scene from the colour panel, and puts the panel away', async () => {
		const { deck, dom, host, mount } = deal();
		const card = mount();
		el(card.color).dispatch('click');
		const panel = dom.container.querySelector('.snowflake-method-corkboard-color-panel');
		expect(panel).not.toBeNull();
		const swatches = panel!.querySelectorAll('.snowflake-method-sticky-swatch');
		expect(swatches.length).toBeGreaterThan(1);
		swatches[1]!.dispatch('click');
		expect(dom.container.querySelector('.snowflake-method-corkboard-color-panel')).toBeNull();
		await settle();
		expect(host.patchScene).toHaveBeenCalledWith('scene', { color: MACARON_COLORS[0], expectedRevision: 'initial' }, PROJECT);
		el(card.color).dispatch('click');
		expect(dom.container.querySelector('.snowflake-method-corkboard-color-panel')).not.toBeNull();
		deck.closeColorPanel();
		expect(dom.container.querySelector('.snowflake-method-corkboard-color-panel')).toBeNull();
	});

	it("answers the board's menu from the ellipsis and from a right click off any control", () => {
		const { menu, mount } = deal();
		const card = mount();
		el(card.more).dispatch('click');
		expect(menu).toHaveBeenCalledTimes(1);
		expect(menu.mock.calls[0]?.[0]).toBe(card);
		fireOn(el(card.el), 'contextmenu', el(card.el));
		expect(menu).toHaveBeenCalledTimes(2);
		fireOn(el(card.el), 'contextmenu', el(card.status));
		expect(menu).toHaveBeenCalledTimes(2);
	});

	it('lets the card drag again once a press on a control has ended', () => {
		const { deck, mount, setDragAllowed, stored } = deal();
		const card = mount();
		expect(el(card.el).getAttribute('draggable')).toBe('true');
		fireOn(el(card.el), 'mousedown', el(card.status));
		expect(el(card.el).getAttribute('draggable')).toBe('false');
		deck.releasePress();
		expect(el(card.el).getAttribute('draggable')).toBe('true');
		setDragAllowed(false);
		deck.dress(card, stored(), 0, { position: 1, size: 2 });
		expect(el(card.el).getAttribute('draggable')).toBe('false');
	});

	it('drains a dirty conflict into the queue when disposed, without a read', async () => {
		const { deck, host, mount, refresh } = deal();
		const card = mount();
		el(card.conflict).value = 'Late';
		el(card.conflict).dispatch('input');
		deck.dispose();
		await settle();
		expect(host.patchScene).toHaveBeenCalledWith('scene', { conflict: 'Late', expectedRevision: 'initial' }, PROJECT);
		expect(refresh).not.toHaveBeenCalled();
	});
});
