import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';
import { createFakeEnvironment } from '../helpers/fake-vault';

interface MenuEntry { title: string; disabled: boolean; click(): void }
const { notices, menuEntries, opened } = vi.hoisted(() => ({ notices: vi.fn(), menuEntries: [] as MenuEntry[], opened: [] as unknown[] }));
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		modalEl = { addClass: (): void => undefined };
		setTitle(): void {}
		override open(): void { opened.push(this); }
	}
	class Item implements MenuEntry {
		title = '';
		disabled = false;
		click = (): void => undefined;
		setTitle(title: string): this { this.title = title; return this; }
		setIcon(): this { return this; }
		setWarning(): this { return this; }
		setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
		onClick(click: () => void): this { this.click = click; return this; }
	}
	return {
		...runtime,
		Modal,
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		SearchComponent: class extends runtime.SearchComponent { setValue(): this { return this; } },
		Notice: class { constructor(message: string) { notices(message); } },
		Menu: class {
			addItem(build: (item: Item) => void): this { const item = new Item(); build(item); menuEntries.push(item); return this; }
			addSeparator(): this { return this; }
			showAtMouseEvent(): void {}
		},
	};
});

vi.mock('../../src/ui/anchored-panel', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../../src/ui/anchored-panel')>();
	return {
		...runtime,
		hangPanel: (anchor: HTMLElement, spec: Parameters<typeof runtime.hangPanel>[1]) => {
			const panel = (anchor as unknown as CorkboardElement).dom.container.createDiv({ cls: spec.cls });
			spec.build(panel as unknown as HTMLElement);
			return { el: panel, release: vi.fn() };
		},
	};
});

import { FRONTMATTER_KEYS, SnowflakeProjectService } from '../../src/services';
import { renderCorkboard } from '../../src/ui/corkboard';
import type { CorkboardControls, CorkboardHandle } from '../../src/ui/corkboard-bridge';
import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { FilterRow, FilterOptionRow } from '../../src/ui/filter-rows';
import { corkboardMemory, type CorkboardMemory } from '../../src/ui/story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

const PROJECT = 'First/Project.md';
const CHARACTER = 'First/Cast/Hero.md';
const scene = (id: string, overrides: Partial<SceneViewModel> = {}): SceneViewModel => ({
	id, path: `First/Scenes/${id}.md`, title: id, rank: 0,
	progressStatus: 'in-progress', aliases: [], categoryPaths: [],
	povPath: CHARACTER, povName: 'Hero', povMissing: false,
	times: [], locations: [], characterPaths: [], conflict: '', color: null,
	linkedManuscript: [], worldStatus: [], relationships: [], events: '',
	customFields: '', revision: 'initial', healthIssues: [], readOnly: false, ...overrides,
});
const link = (target: string, label = target.split('/').pop()!, alias = false) => ({
	raw: `[[${target}${alias ? `|${label}` : ''}]]`, target, linktext: target, label,
});
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((settle) => { resolve = settle; });
	return { promise, resolve };
}
async function settle(): Promise<void> { for (let at = 0; at < 50; at++) await Promise.resolve(); }

/** Host boundaries are controlled; renderer, menu wiring, queue, layout and filter rows are production. */
function board(scenes = [scene('A'), scene('B')], settings: Partial<CorkboardMemory> = {}, dom = new CorkboardDom()) {
	const container = dom.container.createDiv();
	const memory = Object.assign(corkboardMemory(), settings);
	let model = {
		path: PROJECT, projectId: 'first', locale: 'en', scenes,
		characters: [{ id: 'hero', path: CHARACTER, name: 'Hero', readOnly: false, healthIssues: [] }],
		worldbuilding: {}, manuscriptPaths: [], readOnly: false,
	} as unknown as ProjectDashboardModel;
	let handle: CorkboardHandle;
	let currentProject = PROJECT;
	let panel: { title: string; rows: readonly FilterRow[] } | null = null;
	let resolvedLink: boolean | string = false;
	const host = {
		patchScene: vi.fn(async () => 'saved'),
		reorderScene: vi.fn(async () => undefined),
		deleteScene: vi.fn(async () => undefined),
		openSceneForm: vi.fn(async () => null as string | null),
		openCharacterForm: vi.fn(async (): Promise<void> => undefined),
		listDefinitionPaths: vi.fn<CorkboardControls['host']['listDefinitionPaths']>(async () => []),
		listManuscriptNotes: vi.fn(async () => [] as { path: string; title: string }[]),
		openManuscriptStream: vi.fn(async () => undefined),
	};
	const refresh = vi.fn(async () => { handle.refresh(); });
	const activateProject = vi.fn(() => { currentProject = model.path; });
	const popover = {
		filterOpen: () => panel !== null,
		closeFilter: vi.fn(() => { panel = null; }),
		openFilter: vi.fn((_anchor: HTMLElement, rows: readonly FilterRow[], _changed: () => void, title: string = 'table.filter') => {
			// FilterPanel.open closes any previous panel; its drawing is tested separately.
			panel = { title, rows };
		}),
	};
	const controls = {
		app: { metadataCache: { getFirstLinkpathDest: () => resolvedLink ? {
			path: typeof resolvedLink === 'string' ? resolvedLink : 'First/Manuscript/Chapter.md',
		} : null } },
		host, t: (key: string) => key, model: () => model, activateProject, refresh,
		popover, memory, remember: vi.fn(),
	} as unknown as CorkboardControls;
	handle = renderCorkboard(container as unknown as HTMLElement, controls);
	const cards = () => container.querySelectorAll('.snowflake-method-corkboard-card');
	return {
		dom, container, cards, memory, host, refresh, activateProject, popover, handle,
		model: () => model,
		external: (changes: Partial<ProjectDashboardModel>) => { model = { ...model, ...changes }; handle.refresh(); },
		panel: () => panel,
		currentProject: () => currentProject,
		activateElsewhere: () => { currentProject = 'Second/Project.md'; },
		resolveLink: (value: boolean | string) => { resolvedLink = value; },
		button: (suffix: string) => container.querySelector(`.snowflake-method-${suffix}`)!,
	};
}
function menu(card: CorkboardElement): Map<string, MenuEntry> {
	menuEntries.length = 0;
	card.querySelector('.snowflake-method-corkboard-more')!.dispatch('click');
	return new Map(menuEntries.map((item) => [item.title, item]));
}

beforeEach(() => { vi.clearAllMocks(); menuEntries.length = 0; opened.length = 0; });

describe('corkboard correctness regressions', () => {
	it('#1 blocking scene damage disables editing and refuses dispatched edits', async () => {
		const fixture = board([scene('A', { healthIssues: [{ blocking: true, code: 'missing' }] as unknown as SceneViewModel['healthIssues'] })]);
		const conflict = fixture.button('corkboard-conflict');
		expect(fixture.cards()[0]!.classes.has('has-managed-section-issue')).toBe(true);
		expect(conflict.readOnly).toBe(true);
		expect(fixture.button('corkboard-title').disabled).toBe(true);
		expect(menu(fixture.cards()[0]!).get('actions.edit')!.disabled).toBe(true);
		conflict.value = 'New conflict'; conflict.dispatch('input'); conflict.dispatch('blur'); await settle();
		expect(fixture.host.patchScene).not.toHaveBeenCalled();
		fixture.handle.dispose();
	});

	it('#1 advisory scene health keeps editing available without the damage treatment', () => {
		const fixture = board([scene('A', { healthIssues: [{ blocking: false, code: 'unknown-section' }] as unknown as SceneViewModel['healthIssues'] })]);
		expect(fixture.cards()[0]!.classes.has('has-managed-section-issue')).toBe(false);
		expect(fixture.button('corkboard-conflict').readOnly).toBe(false);
		fixture.handle.dispose();
	});

	it.each(['damage', 'project-readonly', 'scene-readonly'])('closes an existing color panel when its scene becomes %s', async (change) => {
		const fixture = board();
		fixture.button('corkboard-color').dispatch('click');
		const panel = fixture.dom.container.querySelector('.snowflake-method-corkboard-color-panel')!;
		const buttons = panel.querySelectorAll('button');
		expect(panel.isConnected).toBe(true);
		if (change === 'project-readonly') fixture.external({ readOnly: true });
		else fixture.external({ scenes: [scene('A', change === 'scene-readonly' ? { readOnly: true } : {
			healthIssues: [{ blocking: true, code: 'missing' }] as unknown as SceneViewModel['healthIssues'],
		}), scene('B')] });
		expect(panel.isConnected).toBe(false);
		for (const button of buttons) button.dispatch('click');
		await settle();
		expect(fixture.host.patchScene).not.toHaveBeenCalled();
		fixture.handle.dispose();
	});

	it.each(['actions.delete', 'actions.moveDown'])('#3 completes a mutation waiting behind a save when disposed: %s', async (action) => {
		const fixture = board();
		const gate = deferred();
		fixture.host.patchScene.mockImplementationOnce(async () => { await gate.promise; return 'saved'; });
		const status = fixture.cards()[0]!.querySelector('.snowflake-method-corkboard-status-select')!;
		status.value = 'complete'; status.dispatch('change');
		await settle();
		menu(fixture.cards()[0]!).get(action)!.click();
		fixture.handle.dispose();
		gate.resolve(); await settle();
		if (action === 'actions.delete') expect(fixture.host.deleteScene).toHaveBeenCalledWith('A', 'saved', PROJECT);
		else expect(fixture.host.reorderScene).toHaveBeenCalledWith('A', expect.any(Function), PROJECT, expect.any(Function));
		expect(fixture.host.patchScene).toHaveBeenCalledOnce();
		expect(notices).not.toHaveBeenCalled();
	});

	it('#3 control: disposal does not cancel a reorder that has already started', async () => {
		const fixture = board();
		const gate = deferred();
		let completed = false;
		fixture.host.reorderScene.mockImplementationOnce(async () => { await gate.promise; completed = true; });
		menu(fixture.cards()[0]!).get('actions.moveDown')!.click();
		await settle();
		expect(fixture.host.reorderScene).toHaveBeenCalledOnce();
		fixture.handle.dispose();
		gate.resolve(); await settle();
		expect(completed).toBe(true);
		expect(notices).not.toHaveBeenCalled();
	});

	it('#3 control: a queued delete proceeds when the board stays mounted', async () => {
		const fixture = board();
		const gate = deferred();
		fixture.refresh.mockImplementationOnce(async () => { await gate.promise; });
		fixture.button('corkboard-pov').dispatch('click'); await settle();
		menu(fixture.cards()[0]!).get('actions.delete')!.click();
		expect(fixture.host.deleteScene).not.toHaveBeenCalled();
		gate.resolve(); await settle();
		expect(fixture.host.deleteScene).toHaveBeenCalledOnce();
		fixture.handle.dispose();
	});

	it('queues a positional move behind a card save and preserves later writes after its modal receives a rejection', async () => {
		const fixture = board();
		const gate = deferred();
		fixture.host.patchScene.mockImplementationOnce(async () => { await gate.promise; return 'saved'; });
		fixture.host.reorderScene.mockRejectedValueOnce(new Error('Move refused'));
		const card = fixture.cards()[0]!;
		const status = card.querySelector('.snowflake-method-corkboard-status-select')!;
		status.value = 'complete'; status.dispatch('change'); await settle();
		menu(card).get('table.moveToPosition')!.click();
		const modal = opened[0] as { submitHandler(position: number): Promise<void> };
		const moving = expect(modal.submitHandler(1)).rejects.toThrow('Move refused');
		menu(card).get('actions.delete')!.click();
		expect(fixture.host.reorderScene).not.toHaveBeenCalled();
		fixture.handle.dispose(); gate.resolve(); await moving; await settle();
		expect(fixture.host.reorderScene).toHaveBeenCalledWith('A', 1, PROJECT, expect.any(Function));
		expect(fixture.host.deleteScene).toHaveBeenCalledWith('A', 'saved', PROJECT);
		expect(notices).not.toHaveBeenCalled();
	});

	it('finishes a positional move reread before the next queued card save begins', async () => {
		const fixture = board();
		const gate = deferred();
		fixture.refresh.mockImplementationOnce(async () => { await gate.promise; });
		const card = fixture.cards()[0]!;
		menu(card).get('table.moveToPosition')!.click();
		const modal = opened[0] as { submitHandler(position: number): Promise<void> };
		const moving = modal.submitHandler(1); await settle();
		expect(fixture.host.reorderScene).toHaveBeenCalledOnce();
		expect(fixture.refresh).toHaveBeenCalledOnce();
		const status = card.querySelector('.snowflake-method-corkboard-status-select')!;
		status.value = 'complete'; status.dispatch('change'); await settle();
		expect(fixture.host.patchScene).not.toHaveBeenCalled();
		gate.resolve(); await moving; await settle();
		expect(fixture.host.patchScene).toHaveBeenCalledOnce();
		expect(fixture.refresh).toHaveBeenCalledTimes(2);
		fixture.handle.dispose();
	});

	it('retains shared revision bases until every queued save finishes after its card scrolls away', async () => {
		const fixture = board(Array.from({ length: 100 }, (_, index) => scene(`S${index}`)));
		const gate = deferred();
		let serial = 0;
		fixture.host.patchScene.mockImplementation(async () => {
			if (serial === 0) await gate.promise;
			return `saved-${String(++serial)}`;
		});
		const status = fixture.cards()[0]!.querySelector('.snowflake-method-corkboard-status-select')!;
		for (const value of ['complete', 'in-progress', 'complete']) {
			status.value = value; status.dispatch('change');
		}
		await settle();
		fixture.memory.scrollTop = 5000; fixture.handle.refresh();
		expect(fixture.container.contains(status)).toBe(false);
		gate.resolve(); await settle();
		expect(fixture.host.patchScene).toHaveBeenNthCalledWith(1, 'S0', { progressStatus: 'complete', expectedRevision: 'initial' }, PROJECT);
		expect(fixture.host.patchScene).toHaveBeenNthCalledWith(2, 'S0', { progressStatus: 'in-progress', expectedRevision: 'saved-1' }, PROJECT);
		expect(fixture.host.patchScene).toHaveBeenNthCalledWith(3, 'S0', { progressStatus: 'complete', expectedRevision: 'saved-2' }, PROJECT);
		fixture.handle.dispose();
	});

	it('#4 keeps the newly focused project active while queued work targets its captured project', async () => {
		const fixture = board();
		const gate = deferred();
		fixture.refresh.mockImplementationOnce(async () => { await gate.promise; });
		fixture.button('corkboard-pov').dispatch('click');
		await settle();
		menu(fixture.cards()[0]!).get('actions.moveDown')!.click();
		fixture.activateElsewhere();
		expect(fixture.currentProject()).toBe('Second/Project.md');
		gate.resolve(); await settle();
		expect(fixture.activateProject).not.toHaveBeenCalled();
		expect(fixture.currentProject()).toBe('Second/Project.md');
		expect(fixture.host.openCharacterForm).toHaveBeenCalledWith('hero', PROJECT);
		expect(fixture.host.reorderScene).toHaveBeenCalledWith('A', expect.any(Function), PROJECT, expect.any(Function));
		fixture.handle.dispose();
	});

	it('#7 duplicate derived location keys reserve one cell per scene', () => {
		const fixture = board([
			scene('A', { locations: ['[[Places/Tavern]]', '[[Inns/Tavern]]'] }),
			scene('B', { locations: ['[[Places/Tavern]]'] }),
		], { group: 'location' });
		expect(fixture.cards().map((card) => card.getAttribute('data-key'))).toEqual(['location:Tavern|A', 'location:Tavern|B']);
		expect(fixture.cards().map((card) => card.styles.transform)).toEqual(['translate(0px, 36px)', 'translate(346.67px, 36px)']);
		fixture.handle.dispose();
	});

	it('#7 same-note manuscript aliases occupy a single group cell', () => {
		const fixture = board([scene('A', { linkedManuscript: [link('Book/Ch 1'), link('Book/Ch 1', 'Opening', true)] })], { group: 'linked' });
		expect(fixture.cards()).toHaveLength(1);
		expect(fixture.cards()[0]!.styles.transform).toBe('translate(0px, 36px)');
		fixture.handle.dispose();
	});

	it('#7 normalized character aliases occupy a single group cell', async () => {
		const environment = createFakeEnvironment();
		const service = new SnowflakeProjectService(environment.vault, environment.fileManager, environment.metadataCache);
		const project = await service.createProject({ title: 'Group repro', locale: 'en' });
		const character = await service.createCharacter(project, 'Hero');
		const made = await service.createScene(project, 'Arrival');
		await service.updateManagedFrontmatter(made.path, { [FRONTMATTER_KEYS.sceneCharacters]: ['[[Hero]]', '[[Hero]]'] });
		expect((await service.loadProject(project)).scenes[0]!.characters).toEqual([character.path]);
		await service.updateManagedFrontmatter(made.path, { [FRONTMATTER_KEYS.sceneCharacters]: ['[[Hero]]', `[[${character.path.replace(/\.md$/u, '')}]]`] });
		const cast = (await service.loadProject(project)).scenes[0]!.characters;
		expect(cast).toEqual([character.path, character.path]);
		const fixture = board([scene('A', { characterPaths: cast })], { group: 'character' });
		expect(fixture.cards()).toHaveLength(1);
		expect(fixture.cards()[0]!.styles.transform).toBe('translate(0px, 36px)');
		fixture.handle.dispose();
	});

	it.each([false, true])('#8 raw-identical links refresh their resolved status: initially resolved %s', (initial) => {
		const fixture = board([scene('A', { linkedManuscript: [link('Chapter')] })]);
		if (initial) {
			fixture.resolveLink(true);
			fixture.external({ scenes: [scene('A', { linkedManuscript: [link('Chapter', 'Alias', true)] })] });
		}
		const chip = fixture.button('corkboard-link');
		expect(chip.classes.has('is-missing')).toBe(!initial);
		fixture.resolveLink(!initial);
		fixture.external({ scenes: fixture.model().scenes.map((value) => ({ ...value })) });
		const refreshed = fixture.button('corkboard-link');
		expect(refreshed.classes.has('is-missing')).toBe(initial);
		refreshed.dispatch('click');
		if (initial) expect(notices).toHaveBeenCalledWith('table.referenceMissing');
		else expect(fixture.host.openManuscriptStream).toHaveBeenCalledOnce();
		fixture.handle.dispose();
	});

	it.each(['', 'Existing'])('#10 reveals a newly created nonmatching scene under query %j', async (query) => {
		const fixture = board([scene('Existing')], { query });
		fixture.host.openSceneForm.mockImplementationOnce(async () => {
			fixture.external({ scenes: [...fixture.model().scenes, scene('Created')] });
			return 'Created';
		});
		const add = fixture.button('corkboard-add');
		expect(add.disabled).toBe(false);
		add.dispatch('click'); await settle();
		expect(fixture.model().scenes).toHaveLength(2);
		expect(fixture.cards().map((card) => card.dataset.id)).toEqual(['Existing', 'Created']);
		expect(fixture.dom.doc.activeElement?.dataset.id).toBe('Created');
		expect(fixture.memory.query).toBe('');
		fixture.handle.dispose();
	});

	it('#11 retained linked group heads adopt a changed alias on reversal', () => {
		const fixture = board([
			scene('A', { linkedManuscript: [link('Book/Ch 1')] }),
			scene('B', { linkedManuscript: [link('Book/Ch 2')] }),
			scene('C', { linkedManuscript: [link('Book/Ch 1', 'Prologue', true)] }),
		], { group: 'linked' });
		fixture.button('corkboard-direction').dispatch('click');
		const heads = fixture.container.querySelectorAll('.snowflake-method-corkboard-group');
		const first = heads.find((head) => head.dataset.key === 'head:linked:Book/Ch 1')!;
		expect(first.querySelector('.snowflake-method-corkboard-group-label')!.textContent).toBe('Prologue');
		expect(first.styles.transform).toBe('translate(0px, 316px)');
		fixture.handle.dispose();
	});

	it('#11 a character name changed without renaming its file updates the group heading', () => {
		const fixture = board([scene('A', { characterPaths: [CHARACTER] })], { group: 'character' });
		expect(fixture.button('corkboard-group-label').textContent).toBe('Hero');
		fixture.external({ characters: [{ ...fixture.model().characters[0]!, name: 'New name' }] });
		expect(fixture.button('corkboard-group-label').textContent).toBe('New name');
		fixture.handle.dispose();
	});

	it.each([false, true])('#12 menu and card plus agree on visual insertion direction: %s', async (reversed) => {
		const fixture = board(['A', 'B', 'C', 'D'].map((id) => scene(id)), { reversed });
		const card = fixture.cards().find((value) => value.dataset.id === 'C')!;
		card.querySelector('.snowflake-method-corkboard-insert-after')!.dispatch('click'); await settle();
		expect(fixture.host.openSceneForm).toHaveBeenLastCalledWith({ mode: 'create', afterIndex: reversed ? 1 : 2 }, PROJECT);
		menu(card).get('table.insertSceneAfter')!.click(); await settle();
		expect(fixture.host.openSceneForm).toHaveBeenLastCalledWith({ mode: 'create', afterIndex: reversed ? 1 : 2 }, PROJECT);
		fixture.handle.dispose();
	});

	it.each(['rename', 'deletion'])('clears a held manuscript filter after note %s and shows scenes again', (change) => {
		const original = 'First/Manuscript/Chapter';
		const renamed = 'First/Manuscript/Opening';
		const fixture = board([scene('A', { linkedManuscript: [link(original)] }), scene('B')]);
		fixture.external({ manuscriptPaths: [`${original}.md`] });
		fixture.resolveLink(`${original}.md`);
		fixture.memory.filters.linked = original;
		fixture.handle.refresh();
		expect(fixture.cards().map((card) => card.dataset.id)).toEqual(['A']);

		fixture.resolveLink(change === 'rename' ? `${renamed}.md` : false);
		fixture.external({
			manuscriptPaths: change === 'rename' ? [`${renamed}.md`] : [],
			scenes: [scene('A', { linkedManuscript: [link(change === 'rename' ? renamed : original)] }), scene('B')],
		});

		expect(fixture.memory.filters.linked).toBe('');
		expect(fixture.cards().map((card) => card.dataset.id)).toEqual(['A', 'B']);
		fixture.handle.dispose();
	});

	it('preserves a valid manuscript filter while picker options are unavailable', async () => {
		const target = 'First/Manuscript/Chapter';
		const fixture = board([scene('A', { linkedManuscript: [link(target)] }), scene('B')]);
		fixture.external({ manuscriptPaths: [`${target}.md`] });
		fixture.resolveLink(`${target}.md`);
		fixture.memory.filters.linked = target;
		fixture.host.listManuscriptNotes.mockRejectedValueOnce(new Error('Picker read failed'));
		fixture.button('filter-button').dispatch('click');
		await settle();
		fixture.handle.refresh();

		expect(fixture.memory.filters.linked).toBe(target);
		expect(fixture.cards().map((card) => card.dataset.id)).toEqual(['A']);
		fixture.handle.dispose();
	});

	it('#13 deleting a character clears a held cast filter', async () => {
		const environment = createFakeEnvironment();
		const service = new SnowflakeProjectService(environment.vault, environment.fileManager, environment.metadataCache);
		const project = await service.createProject({ title: 'Filter repro', locale: 'en' });
		const character = await service.createCharacter(project, 'Hero');
		await service.createScene(project, { title: 'Arrival', povPath: character.path, characters: [character.path] });
		const before = await service.loadProject(project);
		const recorded = before.scenes[0]!;
		const fixture = board([scene('A', { povPath: recorded.povPath!, characterPaths: recorded.characters })]);
		fixture.external({ characters: [{ id: character.id, path: character.path, name: character.name, healthIssues: [], readOnly: false }] as unknown as ProjectDashboardModel['characters'] });
		fixture.memory.filters.character = character.path; fixture.handle.refresh();
		expect(fixture.cards()).toHaveLength(1);
		environment.fakeVault.delete(character.path);
		const after = await service.loadProject(project);
		expect(after.scenes[0]!.characters).toEqual([character.path.replace(/\.md$/u, '')]);
		fixture.external({ characters: [], scenes: [scene('A', { povPath: after.scenes[0]!.povPath!, characterPaths: after.scenes[0]!.characters })] });
		expect(fixture.cards()).toHaveLength(1);
		fixture.button('filter-button').dispatch('click'); await settle();
		const row = fixture.panel()!.rows.find((value) => value.label === 'table.sceneCharacters') as FilterOptionRow;
		expect(row.value).toBe('');
		expect(row.options()).toEqual([]);
		row.apply(row.value);
		expect(fixture.memory.filters.character).toBe('');
		fixture.handle.dispose();
	});

	it('#13 changing projects resets the previous project query, filters and scroll', () => {
		const fixture = board([scene('A')], { query: 'A', scrollTop: 100 });
		fixture.memory.filters.pov = CHARACTER;
		fixture.memory.filters.status = 'complete';
		fixture.external({ projectId: 'second', path: 'Second/Project.md', scenes: [scene('B')] });
		expect(fixture.memory.query).toBe('');
		expect(fixture.memory.filters.pov).toBe('');
		expect(fixture.memory.filters.status).toBe('all');
		expect(fixture.memory.scrollTop).toBe(0);
		expect(fixture.cards().map((card) => card.dataset.id)).toEqual(['B']);
		fixture.handle.dispose();
	});

	it('#16 damaged POV is disabled without queueing a silently rejected form', async () => {
		const fixture = board();
		fixture.external({ characters: [{ ...fixture.model().characters[0]!, healthIssues: [{ blocking: true }] }] as ProjectDashboardModel['characters'] });
		const dashboard = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
		const dashboardRefresh = vi.fn(async () => undefined);
		const openCharacterEditor = vi.fn();
		Object.assign(dashboard, { refresh: dashboardRefresh, lastRender: { model: fixture.model() }, activateProjectContext: vi.fn(), openCharacterEditor });
		fixture.host.openCharacterForm.mockImplementationOnce(async () => dashboard.openCharacterForm('hero'));
		const pov = fixture.button('corkboard-pov');
		expect(pov.disabled).toBe(true);
		pov.dispatch('click'); await settle();
		expect(dashboardRefresh).not.toHaveBeenCalled();
		expect(fixture.refresh).not.toHaveBeenCalled();
		expect(openCharacterEditor).not.toHaveBeenCalled();
		expect(notices).not.toHaveBeenCalled();
		fixture.handle.dispose();
	});

	it('#17 a pending funnel read leaves a subsequently opened display panel intact', async () => {
		const fixture = board();
		const gate = deferred();
		fixture.host.listManuscriptNotes.mockImplementationOnce(async () => { await gate.promise; return []; });
		fixture.button('filter-button').dispatch('click');
		fixture.button('corkboard-display').dispatch('click');
		expect(fixture.panel()!.title).toBe('corkboard.display');
		gate.resolve(); await settle();
		expect(fixture.panel()!.title).toBe('corkboard.display');
		expect(fixture.popover.openFilter).toHaveBeenCalledOnce();
		fixture.handle.dispose();
	});

	it('#17 the funnel uses current character options after its asynchronous read', async () => {
		const fixture = board();
		const gate = deferred();
		fixture.host.listManuscriptNotes.mockImplementationOnce(async () => { await gate.promise; return []; });
		fixture.button('filter-button').dispatch('click');
		fixture.external({ characters: [{ ...fixture.model().characters[0]!, name: 'New name' }] });
		gate.resolve(); await settle();
		const row = fixture.panel()!.rows.find((value) => value.label === 'table.sceneCharacters') as FilterOptionRow;
		expect(row.options()).toEqual([{ value: CHARACTER, label: 'New name' }]);
		fixture.handle.dispose();
	});

	it('#17 disposal cancels a pending funnel request', async () => {
		const fixture = board();
		const gate = deferred();
		fixture.host.listManuscriptNotes.mockImplementationOnce(async () => { await gate.promise; return []; });
		fixture.button('filter-button').dispatch('click'); fixture.handle.dispose();
		gate.resolve(); await settle();
		expect(fixture.panel()).toBeNull();
		expect(fixture.popover.openFilter).not.toHaveBeenCalled();
	});

	it('#20 another board focus does not pin an offscreen card in this board', () => {
		const dom = new CorkboardDom();
		const scenes = Array.from({ length: 100 }, (_, index) => scene(`S${index}`));
		const first = board(scenes, {}, dom);
		const second = board(scenes, { scrollTop: 5000 }, dom);
		const count = first.cards().length;
		const elsewhere = second.cards()[0]!;
		expect(first.cards().some((card) => card.dataset.id === elsewhere.dataset.id)).toBe(false);
		elsewhere.focus(); first.handle.refresh();
		expect(first.cards()).toHaveLength(count);
		expect(dom.doc.activeElement).toBe(elsewhere);
		dom.doc.activeElement = dom.doc.body; first.handle.refresh();
		expect(first.cards()).toHaveLength(count);
		first.handle.dispose(); second.handle.dispose();
	});

	it('#21 keyboard-style clicks switch panel types on the first press', async () => {
		const fixture = board();
		fixture.button('filter-button').dispatch('click'); await settle();
		expect(fixture.panel()!.title).toBe('table.filter');
		fixture.button('corkboard-display').dispatch('click');
		expect(fixture.panel()!.title).toBe('corkboard.display');
		fixture.button('filter-button').dispatch('click'); await settle();
		expect(fixture.panel()!.title).toBe('table.filter');
		fixture.handle.dispose();
	});
});

describe('corkboard category filters', () => {
	const paths = ['Act I', 'Act I/Setup', 'Act I/Incident', 'Act II'];
	const scenes = () => [
		scene('A', { categoryPaths: ['Act I/Setup'] }),
		scene('B', { categoryPaths: ['Act I/Incident'] }),
		scene('C', { categoryPaths: ['Act II'] }),
	];
	const categoryRow = (fixture: ReturnType<typeof board>) =>
		fixture.panel()!.rows.find((row) => row.label === 'table.category') as FilterOptionRow;

	it('offers an unassigned parent and filters all of its descendants', async () => {
		const fixture = board(scenes());
		fixture.host.listDefinitionPaths.mockResolvedValueOnce(paths);
		fixture.button('filter-button').dispatch('click');
		await settle();
		const row = categoryRow(fixture);
		expect(row.options().map((option) => option.value)).toEqual(paths);
		row.apply('Act I');
		const openedFilters = fixture.popover.openFilter.mock.calls;
		openedFilters[openedFilters.length - 1]![2]();
		expect(fixture.cards().map((card) => card.dataset.id)).toEqual(['A', 'B']);
		fixture.handle.dispose();
	});

	it('reads the board project category tree while another project is active', async () => {
		const fixture = board(scenes());
		fixture.activateElsewhere();
		fixture.host.listDefinitionPaths.mockImplementation(async (_kind, _id, path) =>
			path === PROJECT ? paths : ['Other project category'],
		);
		fixture.button('filter-button').dispatch('click');
		await settle();
		expect(fixture.host.listDefinitionPaths).toHaveBeenCalledExactlyOnceWith('scene', 'category', PROJECT);
		expect(fixture.host.listManuscriptNotes).toHaveBeenCalledExactlyOnceWith(PROJECT);
		expect(categoryRow(fixture).options().map((option) => option.value)).toEqual(paths);
		expect(fixture.currentProject()).toBe('Second/Project.md');
		fixture.handle.dispose();
	});

	it('discards a category tree that arrives after the board changes projects', async () => {
		const fixture = board(scenes());
		const gate = deferred();
		fixture.host.listDefinitionPaths.mockImplementationOnce(async () => {
			await gate.promise;
			return paths;
		});
		fixture.button('filter-button').dispatch('click');
		fixture.external({ path: 'Second/Project.md', projectId: 'second' });
		gate.resolve();
		await settle();
		expect(fixture.popover.openFilter).not.toHaveBeenCalled();
		fixture.handle.dispose();
	});

	it('keeps known categories and manuscript options when the category read fails', async () => {
		const fixture = board(scenes());
		fixture.host.listDefinitionPaths.mockRejectedValueOnce(new Error('Tree unavailable'));
		fixture.host.listManuscriptNotes.mockResolvedValueOnce([{ path: 'First/Chapter.md', title: 'Chapter' }]);
		fixture.button('filter-button').dispatch('click');
		await settle();
		expect(categoryRow(fixture).options().map((option) => option.value)).toEqual([
			'Act I/Incident', 'Act I/Setup', 'Act II',
		]);
		const linked = fixture.panel()!.rows.find((row) => row.label === 'table.sceneLinked') as FilterOptionRow;
		expect(linked.options()).toEqual([{ value: 'First/Chapter', label: 'Chapter' }]);
		fixture.handle.dispose();
	});
});
