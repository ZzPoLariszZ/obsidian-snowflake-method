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

import type { CharacterPatch, EntityPatch } from '../../src/services';
import { CorkboardDraftModal } from '../../src/ui/corkboard-draft-modal';
import {
	createEntityCardDeck,
	kindOf,
	type EntityCard,
	type EntityCardDeck,
	type EntityMember,
} from '../../src/ui/entity-card';
import type { CharacterViewModel, WorldbuildingEntityViewModel } from '../../src/ui/view-model';

(CorkboardElement.prototype as unknown as { instanceOf: () => boolean }).instanceOf = () => true;
vi.stubGlobal('Element', class {});

const PROJECT = 'First/Project.md';
const el = (node: unknown): CorkboardElement => node as CorkboardElement;

async function settle(): Promise<void> {
	for (let at = 0; at < 40; at++) await Promise.resolve();
}

const character = (overrides: Partial<CharacterViewModel> = {}): CharacterViewModel => ({
	id: 'ada', path: 'First/20_Character/Ada.md', name: 'Ada', rank: 0, type: 'major', progressStatus: 'in-progress',
	aliases: [], categoryPaths: [], oneSentenceStoryline: 'Seeks the crown', oneParagraphStoryline: '', motivation: '',
	goal: '', conflict: '', growth: '', color: null, worldStatus: [], relationships: [], customFields: '',
	gallery: [], galleryMain: null, revision: 'initial', readOnly: false, healthIssues: [], ...overrides,
});

const location = (overrides: Partial<WorldbuildingEntityViewModel> = {}): WorldbuildingEntityViewModel => ({
	id: 'harbour', path: 'First/60_Worldbuilding/62_Location/Harbour.md', name: 'Harbour', kind: 'location', rank: 0,
	progressStatus: null, aliases: [], categoryPaths: [], description: 'Where the ships come in', timeKind: null,
	timeStart: '', timeEnd: '', timeStartMissing: false, timeEndMissing: false, color: 'macaron-2', worldStatus: [],
	relationships: [], customFields: '', gallery: [], galleryMain: null, revision: 'initial', readOnly: false,
	healthIssues: [], ...overrides,
});

interface FakeFile { path: string; name: string; stat: { mtime: number } }

function deal(initial: EntityMember[], options: { symbol?: string | ((member: EntityMember) => string); bodyReadOnly?: boolean; titleReadOnly?: boolean } = {}) {
	const dom = new CorkboardDom();
	let members = [...initial];
	const files = new Map<string, FakeFile>();
	let serial = 0;
	let readOnly = false;
	const apply = (member: EntityMember, patch: CharacterPatch | EntityPatch): EntityMember => {
		if (patch.expectedRevision !== member.revision) throw new Error('Revision conflict');
		const revision = `saved-${String(++serial)}`;
		if (kindOf(member) === 'character') {
			const next: CharacterViewModel = { ...(member as CharacterViewModel), revision };
			const fields = patch as CharacterPatch;
			if (fields.name !== undefined) next.name = fields.name;
			if (fields.oneSentenceStoryline !== undefined) next.oneSentenceStoryline = fields.oneSentenceStoryline;
			if (fields.progressStatus !== undefined && fields.progressStatus !== null) next.progressStatus = fields.progressStatus;
			if (fields.color !== undefined) next.color = fields.color;
			return next;
		}
		const next: WorldbuildingEntityViewModel = { ...(member as WorldbuildingEntityViewModel), revision };
		const fields = patch as EntityPatch;
		if (fields.name !== undefined) next.name = fields.name;
		if (fields.description !== undefined) next.description = fields.description;
		if (fields.progressStatus !== undefined && fields.progressStatus !== null) next.progressStatus = fields.progressStatus;
		if (fields.color !== undefined) next.color = fields.color;
		return next;
	};
	const write = (id: string, patch: CharacterPatch | EntityPatch, projectPath: string): string => {
		if (projectPath !== PROJECT) throw new Error('Wrong project');
		const member = members.find((candidate) => candidate.id === id);
		if (member === undefined) throw new Error('Gone');
		const next = apply(member, patch);
		members = members.map((candidate) => (candidate.id === id ? next : candidate));
		return next.revision;
	};
	const host = {
		patchCharacter: vi.fn((id: string, patch: CharacterPatch, projectPath: string) => Promise.resolve(write(id, patch, projectPath))),
		patchEntity: vi.fn((id: string, patch: EntityPatch, projectPath: string) => Promise.resolve(write(id, patch, projectPath))),
		openManagedFile: vi.fn(() => Promise.resolve()),
	};
	const menu = vi.fn();
	const notice = vi.fn();
	const refresh = vi.fn(async () => {
		for (const card of deck.cards.values()) {
			const latest = members.find((candidate) => candidate.id === card.id);
			if (latest !== undefined) deck.dress(card, latest, 0, { position: 1, size: members.length });
		}
	});
	const deck: EntityCardDeck<EntityCard> = createEntityCardDeck<EntityCard>({
		app: {
			vault: { getResourcePath: (file: FakeFile) => `app://fake/${file.path}?${String(file.stat.mtime)}` },
			metadataCache: { getFirstLinkpathDest: (target: string) => files.get(target) ?? null },
		} as unknown as App,
		host,
		t: (key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key}:${Object.values(vars).join('/')}`),
		refresh,
		notice,
		projectPath: () => PROJECT,
		readOnly: () => readOnly,
		membersById: () => new Map(members.map((member) => [member.id, member])),
		nameTaken: (member, name) => members.some((candidate) => candidate.id !== member.id && kindOf(candidate) === kindOf(member) && candidate.name === name),
		footWord: (member) => `word:${kindOf(member)}`,
		icon: (member) => (kindOf(member) === 'character' ? 'user' : 'map-pin'),
		dragAllowed: () => true,
		menu,
		extend: (card) => card,
		...options,
	});
	const mount = (id: string, key = id): EntityCard => {
		const member = members.find((candidate) => candidate.id === id)!;
		const card = deck.mount(dom.container as unknown as HTMLElement, key, member, 0);
		deck.dress(card, member, 0, { position: 1, size: members.length });
		return card;
	};
	return {
		dom, deck, host, refresh, menu, notice, mount, files,
		stored: (id: string) => members.find((candidate) => candidate.id === id)!,
		setReadOnly: (value: boolean) => { readOnly = value; },
		external: (id: string, changes: Partial<CharacterViewModel> | Partial<WorldbuildingEntityViewModel>) => {
			members = members.map((candidate) => (candidate.id === id ? ({ ...candidate, ...changes }) : candidate));
		},
		remove: (id: string) => { members = members.filter((candidate) => candidate.id !== id); },
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	notices.mockClear();
});

describe('an entity card dealt from the deck', () => {
	it('wears the scene card\'s shape with a picture pane above the words and a word on the foot', () => {
		const fixture = deal([character(), location()]);
		const card = fixture.mount('ada');
		const root = fixture.dom.container.querySelector('.snowflake-method-corkboard-card')!;
		expect(root.getAttribute('data-id')).toBe('ada');
		for (const part of ['grip', 'head', 'number', 'title', 'title-input', 'status-select', 'picture', 'body', 'body-text', 'footer', 'word', 'color', 'more']) {
			expect(root.querySelector(`.snowflake-method-corkboard-${part}`), part).not.toBeNull();
		}
		// The pane stands between the head and the words, the word ahead of the actions.
		const order = root.children.map((child) => child.className.split(' ')[0]);
		expect(order.indexOf('snowflake-method-corkboard-picture')).toBe(order.indexOf('snowflake-method-corkboard-head') + 1);
		expect(order.indexOf('snowflake-method-corkboard-body')).toBe(order.indexOf('snowflake-method-corkboard-picture') + 1);
		const footRow = root.querySelector('.snowflake-method-corkboard-footer-row')!;
		expect(footRow.children.map((child) => child.className.split(' ')[0])).toEqual(['snowflake-method-corkboard-word', 'snowflake-method-corkboard-actions']);
		expect(el(card.number).textContent).toBe('1');
		expect(el(card.title).textContent).toBe('Ada');
		expect(el(card.body).value).toBe('Seeks the crown');
		expect(el(card.body).getAttribute('aria-label')).toBe('modal.character.oneSentenceStoryline');
		expect(el(card.body).getAttribute('placeholder')).toBe('modal.character.oneSentenceStorylinePlaceholder');
		expect(el(card.word).textContent).toBe('word:character');
		expect(el(card.status).value).toBe('in-progress');
		expect(root.getAttribute('data-color')).toBeNull();

		const place = fixture.mount('harbour');
		expect(el(place.body).value).toBe('Where the ships come in');
		expect(el(place.body).getAttribute('aria-label')).toBe('form.description');
		expect(el(place.body).getAttribute('placeholder')).toBe('form.description.placeholder');
		expect(el(place.el).getAttribute('data-color')).toBe('macaron-2');
		expect(el(place.word).textContent).toBe('word:location');
	});

	it('wears one symbol per note where the surface reads them off the note, and keeps the words read-only where it says so', () => {
		const fixture = deal([character(), location()], { symbol: (member) => (kindOf(member) === 'character' ? 'user' : 'map-pin'), bodyReadOnly: true, titleReadOnly: true });
		const card = fixture.mount('ada');
		expect(el(card.number).classes.has('snowflake-method-corkboard-symbol')).toBe(true);
		expect(card.symbolIcon).toBe('user');
		expect(fixture.mount('harbour').symbolIcon).toBe('map-pin');
		expect(el(card.body).readOnly).toBe(true);
		expect(el(card.body).getAttribute('placeholder')).toBeNull();
		expect(el(card.title).disabled).toBe(true);
	});

	it('shows the gallery\'s main picture in the pane, the kind\'s symbol without one, and redraws only when the picture moves', () => {
		const fixture = deal([character({ gallery: ['[[First/20_Character/25_Gallery/face.png]]', '[[First/20_Character/25_Gallery/back.png]]'], galleryMain: '[[First/20_Character/25_Gallery/back.png]]' })]);
		fixture.files.set('First/20_Character/25_Gallery/back.png', { path: 'First/20_Character/25_Gallery/back.png', name: 'back.png', stat: { mtime: 7 } });
		fixture.files.set('First/20_Character/25_Gallery/face.png', { path: 'First/20_Character/25_Gallery/face.png', name: 'face.png', stat: { mtime: 3 } });
		const card = fixture.mount('ada');
		const pane = el(card.picture);
		expect(pane.classes.has('is-empty')).toBe(false);
		const img = pane.querySelector('img')!;
		expect(img.getAttribute('src')).toBe('app://fake/First/20_Character/25_Gallery/back.png?7');
		expect(img.getAttribute('alt')).toBe('Ada');
		expect(img.getAttribute('loading')).toBe('lazy');

		// Dressed again with nothing moved, the same element stands; renamed, only its words move.
		fixture.external('ada', { name: 'Ada the Bold' });
		fixture.deck.dress(card, fixture.stored('ada'), 0, { position: 1, size: 1 });
		expect(pane.querySelector('img')).toBe(img);
		expect(img.getAttribute('alt')).toBe('Ada the Bold');

		// The main picture let go: the first of the list stands in.
		fixture.external('ada', { galleryMain: null });
		fixture.deck.dress(card, fixture.stored('ada'), 0, { position: 1, size: 1 });
		expect(pane.querySelector('img')!.getAttribute('src')).toBe('app://fake/First/20_Character/25_Gallery/face.png?3');

		// A file replaced moves its stamp, which redraws; a gallery emptied shows the symbol.
		fixture.files.set('First/20_Character/25_Gallery/face.png', { path: 'First/20_Character/25_Gallery/face.png', name: 'face.png', stat: { mtime: 9 } });
		fixture.deck.dress(card, fixture.stored('ada'), 0, { position: 1, size: 1 });
		expect(pane.querySelector('img')!.getAttribute('src')).toBe('app://fake/First/20_Character/25_Gallery/face.png?9');
		fixture.external('ada', { gallery: [], galleryMain: null });
		fixture.deck.dress(card, fixture.stored('ada'), 0, { position: 1, size: 1 });
		expect(pane.classes.has('is-empty')).toBe(true);
		expect(pane.querySelector('img')).toBeNull();
		expect(pane.querySelector('.snowflake-method-corkboard-picture-symbol')).not.toBeNull();

		// A link to a picture that has gone shows the symbol too.
		fixture.external('ada', { gallery: ['[[First/20_Character/25_Gallery/lost.png]]'], galleryMain: null });
		fixture.deck.dress(card, fixture.stored('ada'), 0, { position: 1, size: 1 });
		expect(pane.classes.has('is-empty')).toBe(true);
	});

	it('writes the name and the storyline of a character, and the name and description of a worldbuilding note, under the revision each card holds', async () => {
		const fixture = deal([character(), location()]);
		const card = fixture.mount('ada');
		el(card.title).dispatch('click');
		el(card.titleInput).value = 'Ada the Bold';
		el(card.titleInput).dispatch('blur');
		await settle();
		expect(fixture.host.patchCharacter).toHaveBeenCalledWith('ada', { expectedRevision: 'initial', name: 'Ada the Bold' }, PROJECT);
		expect(fixture.stored('ada').name).toBe('Ada the Bold');
		el(card.body).value = 'Seeks the crown and finds the sea';
		el(card.body).dispatch('input');
		el(card.body).dispatch('blur');
		await settle();
		expect(fixture.host.patchCharacter).toHaveBeenLastCalledWith('ada', { expectedRevision: 'saved-1', oneSentenceStoryline: 'Seeks the crown and finds the sea' }, PROJECT);
		expect(fixture.stored('ada').revision).toBe('saved-2');

		const place = fixture.mount('harbour');
		el(place.body).value = 'Where the ships leave';
		el(place.body).dispatch('input');
		el(place.body).dispatch('blur');
		await settle();
		expect(fixture.host.patchEntity).toHaveBeenCalledWith('harbour', { expectedRevision: 'initial', description: 'Where the ships leave' }, PROJECT);
		el(place.status).value = 'complete';
		el(place.status).dispatch('change');
		await settle();
		expect(fixture.host.patchEntity).toHaveBeenLastCalledWith('harbour', { expectedRevision: 'saved-3', progressStatus: 'complete' }, PROJECT);
		el(place.color).dispatch('click');
		const swatch = fixture.dom.container.querySelector('.snowflake-method-corkboard-color-panel')!.querySelectorAll('button')
			.find((button) => button.getAttribute('data-color') === 'macaron-5' || button.getAttribute('aria-label')?.includes('macaron-5'));
		expect(swatch).toBeDefined();
	});

	it('refuses an empty name and one another note of the kind bears, with the kind\'s own words', async () => {
		const fixture = deal([character(), character({ id: 'lin', path: 'First/20_Character/Lin.md', name: 'Lin' }), location()]);
		const card = fixture.mount('ada');
		el(card.title).dispatch('click');
		el(card.titleInput).value = '   ';
		el(card.titleInput).dispatch('blur');
		await settle();
		expect(notices).toHaveBeenLastCalledWith('modal.character.nameRequired');
		el(card.titleInput).value = 'Lin';
		el(card.titleInput).dispatch('blur');
		await settle();
		expect(notices).toHaveBeenLastCalledWith('modal.character.nameTaken');
		expect(fixture.host.patchCharacter).not.toHaveBeenCalled();
		// A location may be called Lin: the names are the kind's own.
		const place = fixture.mount('harbour');
		el(place.title).dispatch('click');
		el(place.titleInput).value = 'Lin';
		el(place.titleInput).dispatch('blur');
		await settle();
		expect(fixture.host.patchEntity).toHaveBeenCalledWith('harbour', { expectedRevision: 'initial', name: 'Lin' }, PROJECT);
	});

	it('keeps a refused draft for the writer in the recovery dialog, naming the body by the kind\'s word', async () => {
		const open = vi.spyOn(CorkboardDraftModal.prototype, 'open').mockImplementation(() => undefined);
		const fixture = deal([character()]);
		const card = fixture.mount('ada');
		el(card.body).value = 'Unsaved words';
		el(card.body).dispatch('input');
		fixture.remove('ada');
		fixture.deck.unmount('ada');
		await settle();
		expect(open).toHaveBeenCalledOnce();
		const drafts = (open.mock.instances[0] as { drafts: readonly { name: string; body?: string; bodyLabel: string }[] }).drafts;
		expect(drafts).toEqual([{ name: 'Ada', body: 'Unsaved words', bodyLabel: 'modal.character.oneSentenceStoryline' }]);
	});

	it('opens the note on Enter and leaves a read-only note alone', async () => {
		const fixture = deal([location({ readOnly: true })]);
		const card = fixture.mount('harbour');
		expect(el(card.el).classes.has('is-read-only')).toBe(true);
		expect(el(card.body).readOnly).toBe(true);
		expect(el(card.title).disabled).toBe(true);
		for (const listener of el(card.el).listeners.get('keydown') ?? []) {
			listener({ target: el(card.el), ...{ key: 'Enter' }, preventDefault: () => undefined, stopPropagation: () => undefined });
		}
		await settle();
		expect(fixture.host.openManagedFile).toHaveBeenCalledWith('First/60_Worldbuilding/62_Location/Harbour.md');
	});
});
