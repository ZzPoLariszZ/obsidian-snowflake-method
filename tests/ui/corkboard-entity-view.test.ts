import { afterEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, CorkboardElement } from '../helpers/corkboard-dom';

const { fields } = vi.hoisted(() => ({ fields: [] as { options(): { value: string; label: string }[]; value(): string; choose(value: string): void }[] }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		Keymap: { isModifier: () => true },
		SearchComponent: class extends runtime.SearchComponent {
			inputEl: CorkboardElement;
			constructor(container: CorkboardElement) {
				super(container);
				this.inputEl = container.createEl('input');
			}
			setValue(): this { return this; }
		},
	};
});

vi.mock('../../src/ui/option-picker', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../../src/ui/option-picker')>();
	return {
		...runtime,
		buildOptionField: (_app: unknown, container: CorkboardElement, config: { options(): { value: string; label: string }[]; value(): string; choose(value: string): void }) => {
			fields.push(config);
			container.createEl('input', { cls: 'fake-view-field' });
			return { refresh: vi.fn(), destroy: vi.fn() };
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

import type { CharacterPatch, EntityPatch } from '../../src/services';
import { renderCorkboard } from '../../src/ui/corkboard';
import type { CorkboardControls, CorkboardHandle } from '../../src/ui/corkboard-bridge';
import { corkboardMemory, entityCorkboardMemory, type CorkboardView } from '../../src/ui/story-structure-state';
import type { CharacterViewModel, ProjectDashboardModel, WorldbuildingEntityViewModel } from '../../src/ui/view-model';

(CorkboardElement.prototype as unknown as { instanceOf: () => boolean }).instanceOf = () => true;
vi.stubGlobal('Element', class {});

const PROJECT = 'First/Project.md';

async function settle(): Promise<void> {
	for (let at = 0; at < 40; at++) await Promise.resolve();
}

const character = (id: string, overrides: Partial<CharacterViewModel> = {}): CharacterViewModel => ({
	id, path: `First/20_Character/${id}.md`, name: id, rank: 0, type: null, progressStatus: null,
	aliases: [], categoryPaths: [], oneSentenceStoryline: `${id} wants something`, oneParagraphStoryline: '', motivation: '',
	goal: '', conflict: '', growth: '', color: null, worldStatus: [], relationships: [], customFields: '',
	gallery: [], galleryMain: null, revision: 'initial', readOnly: false, healthIssues: [], ...overrides,
});

const place = (id: string, overrides: Partial<WorldbuildingEntityViewModel> = {}): WorldbuildingEntityViewModel => ({
	id, path: `First/60_Worldbuilding/62_Location/${id}.md`, name: id, kind: 'location', rank: 0, progressStatus: null,
	aliases: [], categoryPaths: [], description: `About ${id}`, timeKind: null, timeStart: '', timeEnd: '',
	timeStartMissing: false, timeEndMissing: false, color: null, worldStatus: [], relationships: [], customFields: '',
	gallery: [], galleryMain: null, revision: 'initial', readOnly: false, healthIssues: [], ...overrides,
});

function board(view: CorkboardView, options: { characters?: CharacterViewModel[]; locations?: WorldbuildingEntityViewModel[]; views?: boolean } = {}) {
	const dom = new CorkboardDom();
	fields.length = 0;
	let characters = options.characters ?? [character('Ada', { type: 'major' }), character('Lin', { type: 'minor' }), character('Mo')];
	let locations = options.locations ?? [place('Harbour'), place('Market')];
	const model = (): ProjectDashboardModel => ({
		path: PROJECT, projectId: 'first', locale: 'en', readOnly: false,
		scenes: [], characters, manuscriptPaths: [],
		worldbuildingKinds: [
			{ id: 'time', folderName: '61_Time', custom: false, icon: null, description: null },
			{ id: 'location', folderName: '62_Location', custom: false, icon: null, description: null },
			{ id: 'faction', folderName: '64_Faction', custom: true, icon: 'shield', description: null },
		],
		worldbuilding: { location: locations },
		definitions: { category: {} },
	}) as unknown as ProjectDashboardModel;
	let serial = 0;
	const reorder = (members: readonly { id: string }[], id: string, index: number): typeof members => {
		const moving = members.find((member) => member.id === id)!;
		const rest = members.filter((member) => member.id !== id);
		rest.splice(index, 0, moving);
		return rest;
	};
	const host = {
		patchCharacter: vi.fn((id: string, patch: CharacterPatch) => {
			const revision = `saved-${String(++serial)}`;
			characters = characters.map((member) => (member.id === id ? { ...member, ...(patch.name === undefined ? {} : { name: patch.name }), ...(patch.oneSentenceStoryline === undefined ? {} : { oneSentenceStoryline: patch.oneSentenceStoryline }), revision } : member));
			return Promise.resolve(revision);
		}),
		patchEntity: vi.fn((id: string, patch: EntityPatch) => {
			const revision = `saved-${String(++serial)}`;
			locations = locations.map((member) => (member.id === id ? { ...member, ...(patch.description === undefined ? {} : { description: patch.description }), revision } : member));
			return Promise.resolve(revision);
		}),
		reorderCharacter: vi.fn((id: string, index: number, _path: string, adopt?: (change: { id: string; before: string; after: string }) => void) => {
			characters = reorder(characters, id, index) as CharacterViewModel[];
			adopt?.({ id, before: 'initial', after: 'ranked' });
			return Promise.resolve();
		}),
		reorderEntity: vi.fn((_kind: string, id: string, index: number) => {
			locations = reorder(locations, id, index) as WorldbuildingEntityViewModel[];
			return Promise.resolve();
		}),
		openCreateCharacterForm: vi.fn(() => Promise.resolve(null)),
		openEntityForm: vi.fn(() => Promise.resolve(null)),
		openCharacterForm: vi.fn(() => Promise.resolve()),
		openManagedFile: vi.fn(() => Promise.resolve()),
		deleteCharacter: vi.fn(() => Promise.resolve()),
		deleteEntity: vi.fn(() => Promise.resolve()),
		listDefinitionPaths: vi.fn(() => Promise.resolve(['Race', 'Race/Elf'])),
	};
	let handle: CorkboardHandle;
	const refresh = vi.fn(async () => { handle.refresh(); });
	const choose = vi.fn();
	const memory = view === 'scene' ? corkboardMemory() : entityCorkboardMemory(view, { mode: 'standard', reversed: false });
	const controls = {
		app: { metadataCache: { getFirstLinkpathDest: () => null }, vault: { getResourcePath: () => '' } },
		host, t: (key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key}:${Object.values(vars).join('/')}`),
		model, activateProject: vi.fn(), refresh,
		popover: { closeFilter: vi.fn(), filterOpen: () => false, openFilter: vi.fn() },
		memory, remember: vi.fn(),
		...(options.views === false ? {} : { views: { choose } }),
	} as unknown as CorkboardControls;
	handle = renderCorkboard(dom.container as unknown as HTMLElement, controls);
	return {
		dom, handle, host, memory, choose, refresh,
		cards: () => dom.container.querySelectorAll('.snowflake-method-corkboard-card'),
		titles: () => dom.container.querySelectorAll('.snowflake-method-corkboard-title').map((title) => title.textContent),
		heads: () => dom.container.querySelectorAll('.snowflake-method-corkboard-group-label').map((label) => label.textContent),
		field: () => {
			const field = fields[fields.length - 1];
			if (field === undefined) throw new Error('no view field was built');
			return field;
		},
	};
}

afterEach(() => { vi.restoreAllMocks(); });

describe('the corkboard\'s views', () => {
	it('offers the scene view, the character view and one per kind at the band\'s start, and tells the tab which was chosen', () => {
		const fixture = board('scene');
		expect(fixture.dom.container.querySelector('.snowflake-method-corkboard-view-select')).not.toBeNull();
		const field = fixture.field();
		expect(field.options().map((option) => [option.value, option.label])).toEqual([
			['scene', 'corkboard.view.scene'],
			['character', 'corkboard.view.character'],
			['time', 'corkboard.view.kind:worldbuilding.kind.time'],
			['location', 'corkboard.view.kind:worldbuilding.kind.location'],
			['faction', 'corkboard.view.kind:faction'],
		]);
		expect(field.value()).toBe('scene');
		field.choose('scene');
		expect(fixture.choose).not.toHaveBeenCalled();
		field.choose('character');
		expect(fixture.choose).toHaveBeenCalledExactlyOnceWith('character');
	});

	it('shows no field where the tab offers no views, as the pools do', () => {
		const fixture = board('scene', { views: false });
		expect(fixture.dom.container.querySelector('.snowflake-method-corkboard-view-select')).toBeNull();
		expect(fields).toHaveLength(0);
	});

	it('deals the characters in rank order, their storylines in the body and the role on the foot, and writes edits to the character', async () => {
		const fixture = board('character');
		expect(fixture.titles()).toEqual(['Ada', 'Lin', 'Mo']);
		const first = fixture.cards()[0]!;
		expect(first.querySelector('.snowflake-method-corkboard-body-text')!.value).toBe('Ada wants something');
		expect(first.querySelector('.snowflake-method-corkboard-word')!.textContent).toBe('Major');
		expect(fixture.cards()[2]!.querySelector('.snowflake-method-corkboard-word')!.textContent).toBe('');
		expect(fixture.dom.container.querySelector('.snowflake-method-corkboard-add')!.textContent).toBe('actions.addCharacter');
		const body = first.querySelector('.snowflake-method-corkboard-body-text')!;
		body.value = 'Ada wants the crown';
		body.dispatch('input');
		body.dispatch('blur');
		await settle();
		expect(fixture.host.patchCharacter).toHaveBeenCalledWith('Ada', { expectedRevision: 'initial', oneSentenceStoryline: 'Ada wants the crown' }, PROJECT);
	});

	it('gathers the characters by role with the role\'s words and a group for those without one', () => {
		const fixture = board('character');
		fixture.memory.group = 'role';
		fixture.handle.refresh();
		expect(fixture.heads()).toEqual(['Major', 'Minor', 'corkboard.none.role']);
	});

	it('moves a card by the order menu through the character reorder, adopting the rank revision, and inserts after it through the create form', async () => {
		const fixture = board('character');
		fixture.cards()[0]!.querySelector('.snowflake-method-corkboard-insert-after')!.dispatch('click');
		await settle();
		expect(fixture.host.openCreateCharacterForm).toHaveBeenCalledWith(0, PROJECT, expect.any(Function));
		fixture.dom.container.querySelector('.snowflake-method-corkboard-add')!.dispatch('click');
		await settle();
		expect(fixture.host.openCreateCharacterForm).toHaveBeenLastCalledWith(null, PROJECT, expect.any(Function));
	});

	it('deals one worldbuilding kind with its description, its categories on the foot and its own create form', async () => {
		const fixture = board('location', { locations: [place('Harbour', { categoryPaths: ['Region/North', 'Trade'] }), place('Market')] });
		expect(fixture.titles()).toEqual(['Harbour', 'Market']);
		const first = fixture.cards()[0]!;
		expect(first.querySelector('.snowflake-method-corkboard-body-text')!.value).toBe('About Harbour');
		expect(first.querySelector('.snowflake-method-corkboard-word')!.textContent).toBe('North, Trade');
		expect(fixture.dom.container.querySelector('.snowflake-method-corkboard-add')!.textContent).toBe('worldbuilding.add.location');
		fixture.cards()[1]!.querySelector('.snowflake-method-corkboard-insert-before')!.dispatch('click');
		await settle();
		expect(fixture.host.openEntityForm).toHaveBeenCalledWith({ mode: 'create', kind: 'location', afterIndex: 0 }, PROJECT, expect.any(Function));
		const body = first.querySelector('.snowflake-method-corkboard-body-text')!;
		body.value = 'Where the ships come in';
		body.dispatch('input');
		body.dispatch('blur');
		await settle();
		expect(fixture.host.patchEntity).toHaveBeenCalledWith('Harbour', { expectedRevision: 'initial', description: 'Where the ships come in' }, PROJECT);
	});
});
