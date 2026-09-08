import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, Menu } from 'obsidian';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';
import { createFakeEnvironment } from '../helpers/fake-vault';

const { opened, menuClicks } = vi.hoisted(() => ({
	opened: [] as unknown[], menuClicks: new Map<string, () => void>(),
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		modalEl = { addClass: (): void => undefined };
		setTitle(): void {}
		setPlaceholder(): void {}
		open(): void { opened.push(this); }
	}
	class MenuItem {
		private title = '';
		setTitle(title: string): this { this.title = title; return this; }
		setIcon(): this { return this; }
		setDisabled(): this { return this; }
		setWarning(): this { return this; }
		onClick(click: () => void): this { menuClicks.set(this.title, click); return this; }
	}
	return {
		...runtime,
		Modal,
		FuzzySuggestModal: class extends Modal {},
		SuggestModal: class extends Modal {},
		Menu: class {
			addItem(build: (item: MenuItem) => void): this { build(new MenuItem()); return this; }
			addSeparator(): this { return this; }
			showAtMouseEvent(): void {}
		},
		Setting: class extends runtime.Setting {
			settingEl: CorkboardElement;
			controlEl: CorkboardElement;
			constructor(container: CorkboardElement) {
				super();
				this.settingEl = container.createDiv();
				this.controlEl = this.settingEl.createDiv();
			}
		},
		SearchComponent: class extends runtime.SearchComponent {
			setValue(): this { return this; }
		},
	};
});

import { parseWikiLink, wikiLinkLabel, wikiLinkText } from '../../src/domain/wikilink';
import { SnowflakeProjectService } from '../../src/services';
import { renderCorkboard } from '../../src/ui/corkboard';
import type { CorkboardControls } from '../../src/ui/corkboard-bridge';
import { orderLinkedManuscript } from '../../src/ui/linked-manuscript';
import { CreateSceneModal, type MemberFormContext } from '../../src/ui/modals';
import type { PickerOption } from '../../src/ui/option-picker';
import { addOrderMenuItems } from '../../src/ui/order-menu';
import { filterScenes, sceneFilters } from '../../src/ui/scene-filters';
import { corkboardMemory } from '../../src/ui/story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

type Picker = { getItems(): PickerOption[]; onChooseItem(option: PickerOption): void };
type FormInternals = {
	linkedManuscript: string[];
	buildLinkedManuscript(): void;
};

function linked(raw: string) {
	const parsed = parseWikiLink(raw)!;
	return { raw, linktext: parsed.linktext, target: parsed.target, label: wikiLinkLabel(raw) };
}

function scene(fields: Partial<SceneViewModel> = {}): SceneViewModel {
	return {
		id: 'scene', path: 'Novel/Scenes/Opening.md', title: 'Opening', rank: 1,
		progressStatus: 'not-started', aliases: [], categoryPaths: [], povPath: '', povName: '',
		povMissing: false, times: [], locations: [], characterPaths: [], conflict: '', color: null,
		linkedManuscript: [], worldStatus: [], relationships: [], events: '', customFields: '',
		revision: 'initial', readOnly: false, healthIssues: [], ...fields,
	};
}

function form(
	raw: string[],
	paths = ['Novel/Manuscript/Chapter 1.md'],
	context: Partial<Pick<MemberFormContext, 'linkedManuscriptMissing' | 'orderLinkedManuscript'>> = {},
) {
	const dom = new CorkboardDom();
	const instance = Object.create(CreateSceneModal.prototype) as FormInternals;
	Object.assign(instance, {
		app: {}, contentEl: dom.container, t: (key: string) => key, linkedManuscript: [...raw],
		formContext: {
			manuscriptNotes: () => paths.map((path) => ({ value: wikiLinkText(path), label: wikiLinkLabel(wikiLinkText(path)) })),
			orderLinkedManuscript: (values: string[]) => [...values],
			linkedManuscriptMissing: () => false,
			openLinkedManuscript: vi.fn(async () => undefined), notice: vi.fn(),
			...context,
		},
	});
	instance.buildLinkedManuscript();
	return {
		instance, dom,
		pickFrame: () => dom.container.querySelector('.snowflake-method-record-pick')!,
		rows: () => dom.container.querySelectorAll('.snowflake-method-record-line'),
		remove: (index: number) => dom.container.querySelectorAll('.snowflake-method-record-line-remove')[index]!.dispatch('click'),
	};
}

function board(fields: Partial<SceneViewModel> = {}, readOnly = false) {
	const dom = new CorkboardDom();
	let current = scene(fields);
	let model = {
		path: 'Novel/Project.md', projectId: 'novel', locale: 'en', scenes: [current],
		characters: [], manuscriptPaths: [], readOnly,
	} as unknown as ProjectDashboardModel;
	const host = {
		openSceneForm: vi.fn(async () => null),
		openManuscriptStream: vi.fn(async () => undefined),
	};
	const controls = {
		app: { metadataCache: { getFirstLinkpathDest: (target: string) => ({ path: `${target}.md` }) } },
		host, t: (key: string) => key, model: () => model, activateProject: vi.fn(),
		refresh: vi.fn(async () => undefined), popover: { closeFilter: vi.fn() },
		memory: corkboardMemory(), remember: vi.fn(),
	} as unknown as CorkboardControls;
	const handle = renderCorkboard(dom.container as unknown as HTMLElement, controls);
	return {
		dom, host, handle,
		refresh: (fields: Partial<SceneViewModel>) => {
			current = { ...current, ...fields };
			model = { ...model, scenes: [current] };
			handle.refresh();
		},
	};
}

beforeEach(() => { opened.length = 0; menuClicks.clear(); });
afterEach(() => vi.restoreAllMocks());

describe('linked manuscript correctness regressions', () => {
	it('filters a bare link only under the note the vault resolver chooses', () => {
		const stored = scene({ linkedManuscript: [linked('[[Chapter 08]]')] });
		const resolveLink = vi.fn(() => 'Novel/Manuscript/Part One/Chapter 08.md');
		for (const part of ['Part One', 'Part Two']) {
			const result = filterScenes([stored], '', {
				...sceneFilters(), linked: `Novel/Manuscript/${part}/Chapter 08`,
			}, { t: (key: string) => key, characterNames: new Map(), resolveLink });
			expect(result.map(({ scene }) => scene.id)).toEqual(part === 'Part One' ? ['scene'] : []);
		}
		expect(resolveLink).toHaveBeenCalledWith('Chapter 08', stored.path);
		stored.linkedManuscript = [linked('[[../Manuscript/Part One/Chapter 08]]')];
		expect(filterScenes([stored], '', {
			...sceneFilters(), linked: 'Novel/Manuscript/Part One/Chapter 08',
		}, { t: (key: string) => key, characterNames: new Map(), resolveLink })).toHaveLength(1);
		expect(resolveLink).toHaveBeenLastCalledWith('../Manuscript/Part One/Chapter 08', stored.path);
	});

	it('#15 re-offers a note already linked with an alias, but removing the new row preserves the alias', () => {
		const alias = '[[Novel/Manuscript/Chapter 1#The duel|the duel]]';
		const fixture = form([alias]);
		fixture.pickFrame().dispatch('click');
		const picker = opened[0] as Picker;
		expect(picker.getItems()).toEqual([{ value: '[[Novel/Manuscript/Chapter 1]]', label: 'Chapter 1' }]);
		picker.onChooseItem(picker.getItems()[0]!);
		expect(fixture.rows()).toHaveLength(2);
		fixture.remove(1);
		expect(fixture.instance.linkedManuscript).toEqual([alias]);
	});

	it.each([0, 1])('removes only occurrence %i of identical raw links after display sorting', (occurrence) => {
		const fixture = form(['[[Chapter 1]]', '[[Chapter 2]]', '[[Chapter 1]]'], [], {
			orderLinkedManuscript: (values) => [...values].sort(),
		});
		expect(fixture.rows()).toHaveLength(3);
		fixture.remove(occurrence);
		expect(fixture.instance.linkedManuscript).toEqual(occurrence === 0
			? ['[[Chapter 2]]', '[[Chapter 1]]']
			: ['[[Chapter 1]]', '[[Chapter 2]]']);
		expect(fixture.rows()).toHaveLength(2);
	});

	it('disables the exhausted picker and re-enables it after a link is removed', () => {
		const fixture = form([]);
		fixture.pickFrame().dispatch('click');
		const picker = opened[0] as Picker;
		picker.onChooseItem(picker.getItems()[0]!);
		fixture.pickFrame().dispatch('click');
		expect(opened).toHaveLength(1);
		expect(fixture.dom.container.querySelector('.snowflake-method-record-pick-placeholder')!.textContent)
			.toBe('modal.scene.linkedManuscriptAllLinked');
		expect(fixture.pickFrame().getAttribute('aria-disabled')).toBe('true');
		expect(fixture.dom.container.querySelector('.snowflake-method-option-picker-selector')!.disabled).toBe(true);
		fixture.remove(0);
		expect(fixture.dom.container.querySelector('.snowflake-method-option-picker-selector')!.disabled).toBe(false);
		expect(fixture.dom.container.querySelector('.snowflake-method-record-pick-placeholder')!.textContent)
			.toBe('modal.scene.linkedManuscriptPlaceholder');
		fixture.pickFrame().dispatch('click');
		expect(opened).toHaveLength(2);
	});

	it('disables an empty manuscript picker with different copy from an exhausted one', () => {
		const fixture = form([], []);
		expect(fixture.dom.container.querySelector('.snowflake-method-record-pick-placeholder')!.textContent)
			.toBe('modal.scene.linkedManuscriptEmpty');
		expect(fixture.dom.container.querySelector('.snowflake-method-option-picker-selector')!.disabled).toBe(true);
		fixture.pickFrame().dispatch('click');
		expect(opened).toHaveLength(0);
	});

	it('uses the scene-context resolver to distinguish missing links from shortened aliased links', () => {
		const missing = vi.fn((raw: string) => raw === '[[Deleted chapter]]');
		const fixture = form(['[[Deleted chapter]]', '[[Chapter 1#Duel|the duel]]'], undefined, {
			linkedManuscriptMissing: missing,
		});
		const values = fixture.dom.container.querySelectorAll('.snowflake-method-record-line-value');
		expect(values[0]!.classes).toContain('snowflake-method-option-picker-missing');
		expect(values[1]!.classes).not.toContain('snowflake-method-option-picker-missing');
		expect(missing).toHaveBeenCalledWith('[[Deleted chapter]]');
		expect(missing).toHaveBeenCalledWith('[[Chapter 1#Duel|the duel]]');
	});

	it.each([false, true])('keeps middle manuscript links reachable when project readOnly=%s', async (readOnly) => {
		const fixture = board({ linkedManuscript: ['[[One]]', '[[Two]]', '[[Three]]'].map(linked) }, readOnly);
		const more = fixture.dom.container.querySelector('.snowflake-method-corkboard-more-links')!;
		expect(fixture.dom.container.querySelectorAll('.snowflake-method-corkboard-link')).toHaveLength(2);
		expect(more.textContent).toBe('+1');
		expect(more.disabled).toBe(false);
		more.dispatch('click');
		if (readOnly) {
			expect([...menuClicks.keys()]).toEqual(['One', 'Two', 'Three']);
			menuClicks.get('Two')!();
			expect(fixture.host.openManuscriptStream).toHaveBeenCalledWith('Novel/Project.md', 'Two.md');
			expect(fixture.host.openSceneForm).not.toHaveBeenCalled();
		} else {
			await Promise.resolve();
			expect(fixture.host.openSceneForm).toHaveBeenCalledWith({
				mode: 'edit', id: 'scene', section: 'linked-manuscript',
			}, 'Novel/Project.md');
		}
		fixture.handle.dispose();
	});

	it('bounds the mounted board revision map across ordinary external revisions', () => {
		// eslint-disable-next-line @typescript-eslint/unbound-method -- called with its original Map receiver through .call().
		const original = Map.prototype.set;
		const observed = new Set<Map<unknown, unknown>>();
		vi.spyOn(Map.prototype, 'set').mockImplementation(function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
			if (value instanceof Set && key === 'initial') observed.add(this);
			return original.call(this, key, value);
		});
		const fixture = board();
		const revisionMap = [...observed][0];
		expect(revisionMap?.size).toBe(1);
		for (let index = 1; index <= 20; index++) fixture.refresh({ revision: `external-${String(index)}`, conflict: `Text ${String(index)}` });
		expect(revisionMap?.size).toBeLessThanOrEqual(2);
		expect(revisionMap?.has('external-20')).toBe(true);
		fixture.handle.dispose();
	});

	it('Part 3: encoded target handling belongs to the supplied resolver, not the ordering helper', () => {
		const raw = '[[First%20light|Sunrise]]';
		const resolve = vi.fn(() => null);
		orderLinkedManuscript([raw], ['Novel/First light.md'], resolve);
		expect(resolve).toHaveBeenCalledWith('First%20light');
		expect(wikiLinkText('Novel/First light.md')).toBe('[[Novel/First light]]');
	});

	it('queues Move to position behind an overlapping real scene save', async () => {
		const env = createFakeEnvironment();
		const service = new SnowflakeProjectService(env.vault, env.fileManager, env.metadataCache);
		const project = await service.createProject({ title: 'Order race', locale: 'en' });
		const created = await service.createScene(project, { title: 'Opening' });
		await service.createScene(project, { title: 'Later' });
		const before = (await service.loadProject(project)).scenes.find((entry) => entry.id === created.id)!;
		let resume!: () => void;
		let reached!: () => void;
		const pause = new Promise<void>((resolve) => { resume = resolve; });
		const paused = new Promise<void>((resolve) => { reached = resolve; });
		const process = env.fakeVault.process.bind(env.fakeVault);
		vi.spyOn(env.fakeVault, 'process').mockImplementation(async (file, callback) => {
			if (file.path === created.path) {
				reached();
				await pause;
			}
			return process(file, callback);
		});
		const saving = service.updateScene(project, created.sceneId, {
			expectedRevision: before.revision, progressStatus: 'complete',
		}).then(() => null, (error: unknown) => error);
		await paused;
		const clicks = new Map<string, () => void>();
		class Item {
			private title = '';
			setTitle(title: string): this { this.title = title; return this; }
			setIcon(): this { return this; }
			setDisabled(): this { return this; }
			onClick(click: () => void): this { clicks.set(this.title, click); return this; }
		}
		const menu = {
			addSeparator: () => undefined,
			addItem: (build: (item: Item) => void) => { build(new Item()); },
		} as unknown as Menu;
		const run = vi.fn();
		const mutate = vi.fn(async (action: () => Promise<void>) => { await saving; await action(); });
		const move = vi.fn(async (position: number) => { await service.reorderScene(project, created.sceneId, position); });
		addOrderMenuItems(menu, {
			app: {} as App, t: (key) => key, run, mutate, refresh: vi.fn(async () => undefined),
		}, {
			index: 0, total: 2, locked: false, readOnly: false, insertTitle: 'Insert', up: null, down: 1,
			options: () => [], reveal: vi.fn(), insert: vi.fn(),
			move,
		});
		let moving: Promise<void> | undefined;
		try {
			clicks.get('table.moveToPosition')!();
			const modal = opened[0] as { submitHandler(position: number): Promise<void> };
			moving = modal.submitHandler(1);
			expect(mutate).toHaveBeenCalledOnce();
			expect(move).not.toHaveBeenCalled();
			expect(run).not.toHaveBeenCalled();
		} finally {
			resume();
			await moving;
		}
		expect(await saving).toBeNull();
		const after = (await service.loadProject(project)).scenes;
		expect(after[1]?.sceneId).toBe(created.sceneId);
		expect(after[1]?.title).toBe('Opening');
		expect(after[1]?.progressStatus).toBe('complete');
	});

	it('returns a queued move failure to the dialog without refreshing or revealing', async () => {
		const clicks = new Map<string, () => void>();
		class Item {
			private title = '';
			setTitle(title: string): this { this.title = title; return this; }
			setIcon(): this { return this; }
			setDisabled(): this { return this; }
			onClick(click: () => void): this { clicks.set(this.title, click); return this; }
		}
		const menu = {
			addSeparator: () => undefined,
			addItem: (build: (item: Item) => void) => { build(new Item()); },
		} as unknown as Menu;
		const failure = new Error('The scene changed before it could move.');
		const refresh = vi.fn(async () => undefined);
		const reveal = vi.fn();
		addOrderMenuItems(menu, {
			app: {} as App, t: (key) => key, run: vi.fn(), refresh,
			mutate: async (action) => { await action(); },
		}, {
			index: 0, total: 2, locked: false, readOnly: false, insertTitle: 'Insert', up: null, down: 1,
			options: () => [], reveal, insert: vi.fn(),
			move: () => Promise.reject(failure),
		});
		clicks.get('table.moveToPosition')!();
		const modal = opened[0] as { submitHandler(position: number): Promise<void> };
		await expect(modal.submitHandler(1)).rejects.toBe(failure);
		expect(refresh).not.toHaveBeenCalled();
		expect(reveal).not.toHaveBeenCalled();
	});
});
