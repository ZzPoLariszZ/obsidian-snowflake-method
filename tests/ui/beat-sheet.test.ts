import { afterEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, CorkboardElement } from '../helpers/corkboard-dom';
import type { OptionFieldConfig } from '../../src/ui/option-picker';

const { menus, sheetFields, notices } = vi.hoisted(() => ({
	menus: [] as { title: string; disabled: boolean; click: () => void }[][],
	sheetFields: [] as OptionFieldConfig[],
	notices: vi.fn(),
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		modalEl = { addClass: (): void => undefined };
		setTitle(): void {}
		onClose(): void {}
	}
	class MenuItem {
		title = '';
		disabled = false;
		click: () => void = () => undefined;
		setTitle(title: string): this { this.title = title; return this; }
		setIcon(): this { return this; }
		setWarning(): this { return this; }
		setSection(): this { return this; }
		setDisabled(value: boolean): this { this.disabled = value; return this; }
		onClick(handler: () => void): this { this.click = handler; return this; }
	}
	class Menu {
		private readonly items: MenuItem[] = [];
		addItem(build: (item: MenuItem) => void): this {
			const item = new MenuItem();
			build(item);
			this.items.push(item);
			return this;
		}
		addSeparator(): this { return this; }
		setParentElement(): this { return this; }
		showAtMouseEvent(): this {
			menus.push(this.items.map((item) => ({ title: item.title, disabled: item.disabled, click: item.click })));
			return this;
		}
		hide(): this { return this; }
	}
	return {
		...runtime,
		Keymap: { isModifier: (event: { mod?: boolean }) => event.mod === true },
		getIcon: () => null,
		Modal,
		Menu,
		FuzzySuggestModal: class extends Modal { setPlaceholder(): void {} },
		SuggestModal: class extends Modal {},
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

// The sheet field is the real one; what the workspace hands it is kept, so a test can pick as the list would.
vi.mock('../../src/ui/option-picker', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/option-picker')>();
	return {
		...actual,
		buildOptionField: vi.fn((...args: Parameters<typeof actual.buildOptionField>) => {
			sheetFields.push(args[2]);
			return actual.buildOptionField(...args);
		}),
	};
});

vi.mock('../../src/ui/modals', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/modals')>();
	return { ...actual, promptForCustomFieldTemplate: vi.fn(() => Promise.resolve(null)) };
});

vi.mock('../../src/ui/timeline-forms', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/timeline-forms')>();
	return { ...actual, confirmTimelineAction: vi.fn(() => Promise.resolve(true)) };
});

import {
	addBeat,
	addBeatRow,
	addBeatSheetAct,
	beatSheetFromStructure,
	beatSheetStructureOf,
	builtInBeatSheetTemplate,
	createBeatSheet,
	deleteBeat,
	deleteBeatRow,
	deleteBeatSheet,
	deleteBeatSheetAct,
	deleteBeatSheetTemplate,
	editBeat,
	editBeatRow,
	emptyBeatSheetDocument,
	findBeatSheetTemplate,
	moveBeat,
	moveBeatRow,
	moveBeatSheetAct,
	placeBeatScene,
	relabelBeatSheetAct,
	removeBeatScene,
	renameBeatSheet,
	saveBeatSheetTemplate,
	setBeatSheetPresentation,
	setBeatSheetSubDescriptions,
	setLastBeatSheet,
	type Beat,
	type BeatRow,
	type BeatSheet,
	type BeatSheetAct,
	type BeatSheetDocument,
	type BeatSheetTemplate,
} from '../../src/domain';
import { Menu, type Modal } from 'obsidian';
import { MoveAfterModal, promptForCustomFieldTemplate } from '../../src/ui/modals';
import { renderBeatSheet } from '../../src/ui/beat-sheet';
import {
	BEAT_SHEET_ACT_DRAG_TYPE,
	BEAT_SHEET_BEAT_DRAG_TYPE,
	BEAT_SHEET_ROW_DRAG_TYPE,
	BEAT_SHEET_SCENE_DRAG_TYPE,
	type BeatSheetBridge,
	type BeatSheetControls,
	type BeatSheetTemplateChoice,
} from '../../src/ui/beat-sheet-bridge';
import { ActFormModal, AddBeatSheetModal, BeatFormModal, EditBeatSheetModal, type AddBeatSheetFormHandle } from '../../src/ui/beat-sheet-forms';
import { beatStackKey } from '../../src/ui/beat-sheet-layout';
import type { CorkboardControls, CorkboardVariant } from '../../src/ui/corkboard-bridge';
import { CorkboardDraftModal } from '../../src/ui/corkboard-draft-modal';
import { beatSheetMemory } from '../../src/ui/story-structure-state';
import { TimelineDraftModal, TimelineTimePickModal, confirmTimelineAction } from '../../src/ui/timeline-forms';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

// Obsidian's own DOM carries `instanceOf`, and a browser has `Element`; the
// drop targets read the one off the event target and name the other.
(CorkboardElement.prototype as unknown as { instanceOf: () => boolean }).instanceOf = () => true;
vi.stubGlobal('Element', class {});

async function settle(): Promise<void> {
	for (let at = 0; at < 40; at++) await Promise.resolve();
}

/** Fires an element's own listeners with the properties a drag carries. */
function fire(element: CorkboardElement, type: string, properties: Record<string, unknown>): void {
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
	};
}

/** Stands an element at a place on the page, for the midpoints a drop is worked out from. */
function standAt(element: CorkboardElement, top: number, height = 40): void {
	Object.assign(element as unknown as object, { getBoundingClientRect: () => ({ top, height, bottom: top + height, left: 0, right: 100 }) });
}

/** Calls an element's own key listeners, the way the fake's dispatch cannot. */
function press(element: CorkboardElement, key: string, extra: Record<string, unknown> = {}): void {
	for (const listener of element.listeners.get('keydown') ?? []) {
		listener({ target: element, ...{ key, ...extra }, preventDefault: () => undefined, stopPropagation: () => undefined });
	}
}

const row = (id: string, text: string, scenes: string[] = []): BeatRow => ({ id, text, scenes });
const beat = (id: string, name: string, extra: Partial<Beat> = {}): Beat => ({ id, name, description: '', rows: [], ...extra });
const act = (id: string, label: string, beats: Beat[] = []): BeatSheetAct => ({ id, label, beats });
const sheet = (id: string, acts: readonly BeatSheetAct[] = [], extra: Partial<BeatSheet> = {}): BeatSheet => ({
	id, name: `Sheet ${id}`, acts: [...acts], presentation: null, showSubDescriptions: true, createdAt: 1, updatedAt: 1, ...extra,
});
const template = (id: string, name: string): BeatSheetTemplate => ({
	id, name, description: '', createdAt: 1, updatedAt: 1,
	acts: [{ label: 'Opening', beats: [{ name: 'Hook', description: 'The first line.' }] }],
});
const scene = (id: string, title: string): SceneViewModel => ({
	id, path: `Scenes/${title}.md`, title, rank: 0, progressStatus: 'in-progress', aliases: [], categoryPaths: [],
	povPath: '', povName: '', povMissing: false, times: [], locations: [], characterPaths: [], conflict: '', color: null,
	linkedManuscript: [], worldStatus: [], relationships: [], events: '', customFields: '', revision: 'r', readOnly: false, healthIssues: [],
});

const submit = (form: unknown, value: unknown): Promise<void> =>
	(form as { submitHandler(value: unknown): Promise<void> }).submitHandler(value);

/** Keeps every form of a kind the workspace opens, in place of showing it. */
function watch<T extends Modal>(kind: { prototype: T }): T[] {
	const opened: T[] = [];
	vi.spyOn(kind.prototype as Modal, 'open').mockImplementation(function (this: Modal) { opened.push(this as T); });
	return opened;
}

function workspace(initial: Partial<BeatSheetDocument> = {}, options: { readOnly?: boolean; locale?: 'en' | 'zh-CN' } = {}) {
	const dom = new CorkboardDom();
	const locale = options.locale ?? 'en';
	let held: BeatSheetDocument = { ...emptyBeatSheetDocument(), ...initial };
	const listeners = new Set<() => void>();
	let serial = 0;
	const apply = (next: BeatSheetDocument | null): 'written' => {
		if (next !== null) held = next;
		return 'written';
	};
	const bridge = {
		t: (key: string): string => key,
		read: vi.fn(async () => ({ projectPath: 'P', locale, held })),
		subscribe: vi.fn((listener: () => void) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		}),
		createSheet: vi.fn(async (name: string, choice: BeatSheetTemplateChoice) => {
			const structure = choice.kind === 'built-in'
				? builtInBeatSheetTemplate(locale, choice.id).structure
				: findBeatSheetTemplate(held, choice.id);
			if (structure === undefined) return null;
			const id = `beat-sheet-${String(++serial)}`;
			apply(createBeatSheet(held, beatSheetFromStructure({ id, name, structure, now: 2 }, (kind) => `${kind}-${String(++serial)}`)));
			return id;
		}),
		renameSheet: vi.fn(async (id: string, name: string) => apply(renameBeatSheet(held, id, name, 2))),
		deleteSheet: vi.fn(async (id: string) => { apply(deleteBeatSheet(held, id)); return true; }),
		setLastSheet: vi.fn(async (id: string | null) => apply(setLastBeatSheet(held, id))),
		setPresentation: vi.fn(async (id: string, presentation: 'flat' | 'stack' | null) => apply(setBeatSheetPresentation(held, id, presentation, 2))),
		setSubDescriptions: vi.fn(async (id: string, shown: boolean) => apply(setBeatSheetSubDescriptions(held, id, shown, 2))),
		addAct: vi.fn(async (sheetId: string, label: string, beforeActId: string | null) => {
			const id = `act-${String(++serial)}`;
			apply(addBeatSheetAct(held, sheetId, { id, label }, beforeActId, 2));
			return id;
		}),
		relabelAct: vi.fn(async (sheetId: string, actId: string, label: string) => apply(relabelBeatSheetAct(held, sheetId, actId, label, 2))),
		moveAct: vi.fn(async (sheetId: string, actId: string, beforeActId: string | null) => apply(moveBeatSheetAct(held, sheetId, actId, beforeActId, 2))),
		deleteAct: vi.fn(async (sheetId: string, actId: string) => apply(deleteBeatSheetAct(held, sheetId, actId, 2))),
		addBeat: vi.fn(async (sheetId: string, actId: string, draft: { name: string; description: string }, beforeBeatId: string | null) => {
			const id = `beat-${String(++serial)}`;
			apply(addBeat(held, sheetId, actId, { id, ...draft }, beforeBeatId, 2));
			return id;
		}),
		editBeat: vi.fn(async (sheetId: string, beatId: string, change: { name?: string; description?: string }) =>
			apply(editBeat(held, sheetId, beatId, change, 2))),
		moveBeat: vi.fn(async (sheetId: string, beatId: string, toActId: string, beforeBeatId: string | null) =>
			apply(moveBeat(held, sheetId, beatId, toActId, beforeBeatId, 2))),
		deleteBeat: vi.fn(async (sheetId: string, beatId: string) => apply(deleteBeat(held, sheetId, beatId, 2))),
		addRow: vi.fn(async (sheetId: string, beatId: string, text: string, beforeRowId: string | null, scenes: string[] = []) => {
			const id = `row-${String(++serial)}`;
			const next = addBeatRow(held, sheetId, beatId, { id, text, scenes }, beforeRowId, 2);
			// As the service answers: a beat that has gone takes no row.
			if (next === null) return null;
			apply(next);
			return id;
		}),
		editRow: vi.fn(async (sheetId: string, rowId: string, text: string) => {
			const stands = held.sheets.find((candidate) => candidate.id === sheetId)?.acts
				.some((entry) => entry.beats.some((one) => one.rows.some((line) => line.id === rowId))) === true;
			if (!stands) return 'absent';
			return apply(editBeatRow(held, sheetId, rowId, text, 2));
		}),
		moveRow: vi.fn(async (sheetId: string, rowId: string, toBeatId: string, beforeRowId: string | null) =>
			apply(moveBeatRow(held, sheetId, rowId, toBeatId, beforeRowId, 2))),
		deleteRow: vi.fn(async (sheetId: string, rowId: string) => apply(deleteBeatRow(held, sheetId, rowId, 2))),
		placeScene: vi.fn(async (sheetId: string, sceneId: string, rowId: string, beforeSceneId: string | null) =>
			apply(placeBeatScene(held, sheetId, sceneId, rowId, beforeSceneId, 2))),
		removeScene: vi.fn(async (sheetId: string, sceneId: string) => apply(removeBeatScene(held, sheetId, sceneId, 2))),
		saveTemplate: vi.fn(async (sheetId: string, draft: { name: string; description: string }) => {
			const from = held.sheets.find((candidate) => candidate.id === sheetId);
			if (from === undefined) return 'absent';
			const id = `beat-sheet-template-${String(++serial)}`;
			return apply(saveBeatSheetTemplate(held, { id, ...draft, structure: beatSheetStructureOf(from) }, 2));
		}),
		deleteTemplate: vi.fn(async (id: string) => { apply(deleteBeatSheetTemplate(held, id)); return true; }),
		pruneMissing: vi.fn(async () => 'written' as const),
	} as unknown as BeatSheetBridge;
	let model = {
		path: 'P', projectId: 'p', locale, readOnly: options.readOnly === true,
		scenes: [scene('scene-1', 'Arrival'), scene('scene-2', 'Departure'), scene('scene-3', 'Return')],
		manuscriptPaths: [],
		characters: [],
		worldbuildingKinds: [],
		worldbuilding: {},
	} as unknown as ProjectDashboardModel;
	const memory = beatSheetMemory();
	const host = {
		openManagedFile: vi.fn(() => Promise.resolve()),
		openCharacterForm: vi.fn(() => Promise.resolve()),
		openSceneForm: vi.fn(() => Promise.resolve(null)),
		deleteScene: vi.fn(() => Promise.resolve()),
		patchScene: vi.fn(() => Promise.resolve('r2')),
	};
	let handle: ReturnType<typeof renderBeatSheet>;
	const refresh = vi.fn(async () => { handle.refresh(); });
	const poolHandle = { refresh: vi.fn(), reveal: vi.fn(), remeasure: vi.fn(), saveFocusedConflict: vi.fn(() => false), dispose: vi.fn() };
	const corkboard = vi.fn((_host: HTMLElement, _controls: CorkboardControls, _variant?: CorkboardVariant) => poolHandle);
	const remember = vi.fn();
	let projectPath: string | null = 'P';
	let unloading = false;
	const controls = {
		app: {}, host,
		t: (key: string, vars?: Record<string, string | number>): string =>
			vars === undefined ? key : `${key}(${Object.entries(vars).map(([name, value]) => `${name}=${String(value)}`).join(',')})`,
		model: () => model,
		projectPath: () => projectPath,
		activateProject: vi.fn(),
		refresh,
		popover: { closeFilter: vi.fn(), filterOpen: () => false, openFilter: vi.fn() },
		bridge: () => bridge,
		memory,
		remember,
		unloading: () => unloading,
		corkboard,
	} as unknown as BeatSheetControls;
	handle = renderBeatSheet(dom.container as unknown as HTMLElement, controls);
	const root = dom.container.querySelector('.snowflake-method-beat-sheet')!;
	const table = root.querySelector('.snowflake-method-timeline-table')!;
	const fixture = {
		dom, root, table, handle, bridge, memory, host, controls, refresh, corkboard, poolHandle, remember,
		remodel: (change: Partial<ProjectDashboardModel>) => { model = { ...model, ...change }; },
		moveProject: (path: string | null) => { projectPath = path; },
		unload: () => { unloading = true; },
		held: () => held,
		sheetHeld: (id: string): BeatSheet => held.sheets.find((candidate) => candidate.id === id)!,
		notify: () => { for (const listener of listeners) listener(); },
		listeners,
		sheetField: (): OptionFieldConfig => sheetFields[sheetFields.length - 1]!,
		select: (): CorkboardElement =>
			root.querySelector('.snowflake-method-beat-sheet-select')!.querySelector('.snowflake-method-option-picker-input')!,
		button: (cls: string): CorkboardElement => root.querySelector(`.${cls}`)!,
		emptyLine: (): CorkboardElement => root.children.find((child) => child.classes.has('snowflake-method-character-empty'))!,
		body: (): CorkboardElement => root.querySelector('.snowflake-method-timeline-body')!,
		acts: (): CorkboardElement[] => root.querySelectorAll('.snowflake-method-beat-sheet-act'),
		act: (id: string): CorkboardElement =>
			root.querySelectorAll('.snowflake-method-beat-sheet-act').find((candidate) => candidate.getAttribute('data-act-id') === id)!,
		foot: (id: string): CorkboardElement =>
			root.querySelectorAll('.snowflake-method-beat-sheet-act-foot').find((candidate) => candidate.getAttribute('data-act-id') === id)!,
		beats: (): CorkboardElement[] => root.querySelectorAll('.snowflake-method-beat-sheet-beat'),
		beat: (id: string): CorkboardElement =>
			root.querySelectorAll('.snowflake-method-beat-sheet-beat').find((candidate) => candidate.getAttribute('data-beat-id') === id)!,
		cell: (beatId: string): CorkboardElement =>
			root.querySelectorAll('.snowflake-method-timeline-cell').find((candidate) => candidate.getAttribute('data-beat-id') === beatId)!,
		/** What stands in the table, top to bottom, as kind and id. */
		order: (): string[] => table.children
			.filter((child) => child.getAttribute('data-entry-key') !== null)
			.map((child) => {
				if (child.classes.has('snowflake-method-beat-sheet-act')) return `act:${child.getAttribute('data-act-id') ?? ''}`;
				if (child.classes.has('snowflake-method-beat-sheet-act-foot')) return `foot:${child.getAttribute('data-act-id') ?? ''}`;
				return `beat:${child.getAttribute('data-beat-id') ?? ''}`;
			}),
		titles: (): string[] => root.querySelectorAll('.snowflake-method-beat-sheet-act-title').map((title) => title.textContent),
		cards: (): CorkboardElement[] => root.querySelectorAll('.snowflake-method-corkboard-card'),
		/** Stands every entry of the table forty pixels under the one before it. */
		standTable: (): void => {
			table.children.filter((child) => child.getAttribute('data-entry-key') !== null)
				.forEach((child, index) => { standAt(child, index * 40); });
		},
		menuOf: (element: CorkboardElement, cls: string) => {
			menus.length = 0;
			element.querySelector(`.${cls}`)!.dispatch('click');
			return menus[0]!;
		},
	};
	return fixture;
}

type Fixture = ReturnType<typeof workspace>;

const subrows = (cell: CorkboardElement): CorkboardElement[] =>
	cell.querySelector('.snowflake-method-timeline-rows')!.children;
const subrow = (cell: CorkboardElement, rowId: string): CorkboardElement =>
	cell.querySelectorAll('.snowflake-method-timeline-subrow').find((candidate) => candidate.getAttribute('data-row-id') === rowId)!;
const trailingInput = (cell: CorkboardElement): CorkboardElement =>
	cell.querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!;

/** Three acts: two beats, none, one. The first beat holds two rows, the first with a scene on it. */
const threeActs = (): BeatSheet => sheet('s', [
	act('a1', 'Setup', [
		beat('b1', 'Opening Image', { description: 'The ordinary world.', rows: [row('r1', 'Arrives', ['scene-1']), row('r2', 'Argues')] }),
		beat('b2', 'Catalyst'),
	]),
	act('a2', ''),
	act('a3', 'Resolution', [beat('b3', 'Final Image')]),
]);
const laid = (options: { readOnly?: boolean } = {}, extra: Partial<BeatSheetDocument> = {}): Fixture =>
	workspace({ sheets: [threeActs()], ...extra }, options);

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(confirmTimelineAction).mockReset();
	vi.mocked(confirmTimelineAction).mockImplementation(() => Promise.resolve(true));
	vi.mocked(promptForCustomFieldTemplate).mockReset();
	vi.mocked(promptForCustomFieldTemplate).mockImplementation(() => Promise.resolve(null));
	notices.mockClear();
	menus.length = 0;
});

describe('the beat sheet workspace', () => {
	it('reads the document, offers every sheet and lays the one opened last, in the timeline\'s own dress', async () => {
		const fixture = workspace({ sheets: [sheet('s1'), threeActs()], lastSheetId: 's' });
		expect(fixture.emptyLine().classes.has('is-hidden')).toBe(false);
		expect(fixture.emptyLine().querySelectorAll('span').map((span) => span.textContent)).toContain('beatSheet.loading');
		expect(fixture.root.classes.has('is-empty')).toBe(true);
		await settle();
		expect(fixture.root.classes.has('is-empty')).toBe(false);
		expect(fixture.body().classes.has('is-hidden')).toBe(false);
		expect(fixture.emptyLine().classes.has('is-hidden')).toBe(true);
		// A sheet looks as a view of one timeline does, by wearing what that wears.
		for (const cls of ['snowflake-method-timeline', 'snowflake-method-scene-cards', 'snowflake-method-prose-panel']) {
			expect(fixture.root.classes.has(cls), cls).toBe(true);
		}
		expect(fixture.root.dataset.layout).toBe('single');
		expect(fixture.root.dataset.presentation).toBe('flat');
		expect(fixture.root.dataset.mode).toBe('compact');
		expect(fixture.sheetField().options().map((option) => [option.value, option.label])).toEqual([['s1', 'Sheet s1'], ['s', 'Sheet s']]);
		expect(fixture.sheetField().value()).toBe('s');
		expect(fixture.select().value).toBe('Sheet s');
		expect(fixture.order()).toEqual(['act:a1', 'beat:b1', 'beat:b2', 'foot:a1', 'act:a2', 'foot:a2', 'act:a3', 'beat:b3', 'foot:a3']);
		// No head row stands over the table: the sheet is named in the toolbar's field.
		expect(fixture.root.querySelector('.snowflake-method-timeline-head')).toBeNull();
	});

	it('lays the toolbar out as the sheet, then at the end: edit, export, the words, the presentation, refresh, add act, add beat sheet', async () => {
		const fixture = laid();
		await settle();
		const order = [
			'snowflake-method-beat-sheet-select', 'snowflake-method-prose-state', 'snowflake-method-beat-sheet-edit',
			'snowflake-method-beat-sheet-export', 'snowflake-method-timeline-words', 'snowflake-method-timeline-presentation', 'snowflake-method-timeline-refresh',
			'snowflake-method-beat-sheet-add-act', 'snowflake-method-beat-sheet-add',
		];
		const toolbar = fixture.root.querySelector('.snowflake-method-timeline-toolbar')!;
		expect(toolbar.children.map((child, index) => child.classes.has(order[index]!))).toEqual(order.map(() => true));
		expect(toolbar.children).toHaveLength(order.length);
		expect(toolbar.getAttribute('aria-label')).toBe('beatSheet.toolbar');
		for (const [cls, words] of [['snowflake-method-beat-sheet-add-act', 'beatSheet.act.add'], ['snowflake-method-beat-sheet-add', 'beatSheet.sheet.add']] as const) {
			expect(fixture.button(cls).classes.has('mod-cta')).toBe(true);
			expect(fixture.button(cls).textContent).toBe(words);
		}
		// The timeline's "latest first" has no place here: an act's number is read off the order.
		expect(fixture.root.querySelector('.snowflake-method-timeline-order')).toBeNull();
	});

	it('says what is missing while there is nothing yet, and leaves the ways in to the toolbar', async () => {
		const none = workspace();
		await settle();
		expect(none.emptyLine().classes.has('is-hidden')).toBe(false);
		expect(none.emptyLine().querySelectorAll('span').map((span) => span.textContent)).toContain('beatSheet.empty.sheets');
		expect(none.emptyLine().querySelector('button')).toBeNull();
		expect(none.body().classes.has('is-hidden')).toBe(true);
		expect(none.select().disabled).toBe(true);
		expect(none.button('snowflake-method-beat-sheet-add').disabled).toBe(false);
		for (const cls of [
			'snowflake-method-beat-sheet-edit', 'snowflake-method-beat-sheet-export', 'snowflake-method-beat-sheet-add-act',
			'snowflake-method-timeline-words', 'snowflake-method-timeline-presentation',
		]) {
			expect(none.button(cls).disabled, cls).toBe(true);
		}
		// A sheet made from Blank holds no act, and says so under the toolbar in the same voice.
		const bare = workspace({ sheets: [sheet('s')] });
		await settle();
		expect(bare.body().classes.has('is-hidden')).toBe(false);
		const line = bare.root.querySelector('.snowflake-method-timeline-times-empty')!;
		expect(line.classes.has('is-hidden')).toBe(false);
		expect(line.querySelectorAll('span').map((span) => span.textContent)).toContain('beatSheet.empty.acts');
		expect(bare.button('snowflake-method-beat-sheet-add-act').disabled).toBe(false);
		const acted = laid();
		await settle();
		expect(acted.root.querySelector('.snowflake-method-timeline-times-empty')!.classes.has('is-hidden')).toBe(true);
	});

	it('says the sheets could not be read, and reads again when the project lands', async () => {
		const fixture = laid();
		await settle();
		const failures = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.mocked(fixture.bridge.read).mockRejectedValueOnce(new Error('The vault could not be read'));
		fixture.notify();
		await settle();
		expect(failures).toHaveBeenCalledTimes(1);
		expect(fixture.body().classes.has('is-hidden')).toBe(true);
		expect(fixture.emptyLine().querySelectorAll('span').map((span) => span.textContent)).toContain('beatSheet.loadFailed');
		expect(fixture.button('snowflake-method-beat-sheet-add').disabled).toBe(true);
		// The model landing is the word that the project may be there now.
		fixture.handle.refresh();
		await settle();
		expect(fixture.order()).toHaveLength(9);
	});

	it('reads again when the bridge rings, and no more once disposed', async () => {
		const fixture = laid();
		await settle();
		expect(fixture.bridge.read).toHaveBeenCalledTimes(1);
		expect(fixture.listeners.size).toBe(1);
		await fixture.bridge.relabelAct('s', 'a2', 'Confrontation');
		fixture.notify();
		await settle();
		expect(fixture.bridge.read).toHaveBeenCalledTimes(2);
		expect(fixture.titles()[1]).toBe('beatSheet.act.titleLabelled(number=2,label=Confrontation)');
		fixture.handle.dispose();
		expect(fixture.listeners.size).toBe(0);
		expect(fixture.dom.container.querySelector('.snowflake-method-beat-sheet')).toBeNull();
		fixture.notify();
		await settle();
		expect(fixture.bridge.read).toHaveBeenCalledTimes(2);
	});

	it('paints nothing when a read brings back the document already on screen', async () => {
		const fixture = laid();
		await settle();
		const painted = (): number => fixture.poolHandle.refresh.mock.calls.length;
		const before = painted();
		fixture.notify();
		await settle();
		expect(painted()).toBe(before);
		await fixture.bridge.renameSheet('s', 'Renamed');
		fixture.notify();
		await settle();
		expect(painted()).toBe(before + 1);
		expect(fixture.select().value).toBe('Renamed');
	});

	it('switches sheets from the field, remembering the one opened and painting once', async () => {
		const fixture = workspace({
			sheets: [threeActs(), sheet('other', [act('o1', 'Only', [beat('ob1', 'Alone')])], { presentation: 'stack' })],
			lastSheetId: 's',
		});
		await settle();
		const painted = (): number => fixture.poolHandle.refresh.mock.calls.length;
		const before = painted();
		fixture.sheetField().choose('other');
		expect(fixture.order()).toEqual(['act:o1', 'beat:ob1', 'foot:o1']);
		expect(fixture.root.dataset.presentation).toBe('stack');
		await settle();
		expect(fixture.bridge.setLastSheet).toHaveBeenCalledWith('other');
		expect(fixture.held().lastSheetId).toBe('other');
		// Which sheet was opened last is drawn from nowhere on screen, so its write paints nothing.
		expect(painted()).toBe(before + 1);
		// The sheet held now, picked again, writes nothing.
		fixture.sheetField().choose('other');
		await settle();
		expect(fixture.bridge.setLastSheet).toHaveBeenCalledTimes(1);
	});

	it('writes the two switches for the sheet, each press taking the value the document holds as it lands', async () => {
		const fixture = laid();
		await settle();
		const words = fixture.button('snowflake-method-timeline-words');
		expect(words.getAttribute('aria-pressed')).toBe('true');
		expect(words.getAttribute('aria-label')).toBe('timeline.view.subDescriptionsHide');
		words.dispatch('click');
		words.dispatch('click');
		await settle();
		expect(fixture.bridge.setSubDescriptions).toHaveBeenNthCalledWith(1, 's', false);
		expect(fixture.bridge.setSubDescriptions).toHaveBeenNthCalledWith(2, 's', true);
		expect(fixture.root.classes.has('is-words-hidden')).toBe(false);
		words.dispatch('click');
		await settle();
		expect(fixture.root.classes.has('is-words-hidden')).toBe(true);
		expect(words.getAttribute('aria-pressed')).toBe('false');
		expect(words.getAttribute('aria-label')).toBe('timeline.view.subDescriptions');
		const presentation = fixture.button('snowflake-method-timeline-presentation');
		expect(presentation.getAttribute('aria-label')).toBe('timeline.presentation.toStack');
		presentation.dispatch('click');
		await settle();
		expect(fixture.bridge.setPresentation).toHaveBeenCalledWith('s', 'stack');
		expect(fixture.root.dataset.presentation).toBe('stack');
		expect(presentation.getAttribute('aria-label')).toBe('timeline.presentation.toFlat');
	});

	it('sends a press waiting its turn to the sheet it was made on', async () => {
		const fixture = workspace({ sheets: [sheet('s1'), sheet('s2')], lastSheetId: 's1' });
		await settle();
		// The first press holds the queue, so the second waits behind it.
		let release: () => void = () => undefined;
		const waiting = new Promise<void>((resolve) => { release = resolve; });
		const write = vi.mocked(fixture.bridge.setSubDescriptions);
		const real = write.getMockImplementation()!;
		write.mockImplementationOnce(async (...args) => {
			await waiting;
			return real(...args);
		});
		fixture.button('snowflake-method-timeline-words').dispatch('click');
		await settle();
		fixture.button('snowflake-method-timeline-presentation').dispatch('click');
		// Another sheet is opened while that press is still waiting. The press
		// was made on the first, and the first is what it must answer for.
		fixture.sheetField().choose('s2');
		await settle();
		release();
		await settle();
		expect(fixture.bridge.setPresentation).toHaveBeenCalledWith('s1', 'stack');
		expect(fixture.bridge.setPresentation).not.toHaveBeenCalledWith('s2', 'stack');
		expect(fixture.sheetHeld('s1').presentation).toBe('stack');
		expect(fixture.sheetHeld('s2').presentation).toBeNull();
	});

	it('lays the workspace out again after a paint that threw partway', async () => {
		const fixture = laid();
		await settle();
		const painted = (): number => fixture.poolHandle.refresh.mock.calls.length;
		fixture.poolHandle.refresh.mockImplementationOnce(() => { throw new Error('The pool could not be painted'); });
		fixture.button('snowflake-method-timeline-words').dispatch('click');
		await settle();
		const after = painted();
		// The document has not moved since, but what stands on screen was never finished.
		fixture.notify();
		await settle();
		expect(painted()).toBe(after + 1);
	});

	it('refreshes the project and then reads the file again', async () => {
		const fixture = laid();
		await settle();
		fixture.button('snowflake-method-timeline-refresh').dispatch('click');
		await settle();
		expect(fixture.refresh).toHaveBeenCalledTimes(1);
		expect(fixture.bridge.read).toHaveBeenCalledTimes(2);
	});

	it('takes every way of writing away from a project that cannot be written, and gives them back when it can', async () => {
		const fixture = laid({ readOnly: true });
		await settle();
		expect(fixture.root.classes.has('is-read-only')).toBe(true);
		for (const cls of [
			'snowflake-method-beat-sheet-edit', 'snowflake-method-beat-sheet-export', 'snowflake-method-beat-sheet-add-act',
			'snowflake-method-beat-sheet-add', 'snowflake-method-timeline-words', 'snowflake-method-timeline-presentation',
		]) {
			expect(fixture.button(cls).disabled, cls).toBe(true);
		}
		const header = fixture.act('a1');
		for (const cls of ['snowflake-method-beat-sheet-act-handle', 'snowflake-method-beat-sheet-act-title', 'snowflake-method-beat-sheet-act-add']) {
			expect(header.querySelector(`.${cls}`)!.disabled, cls).toBe(true);
		}
		expect(header.querySelector('.snowflake-method-beat-sheet-act-handle')!.getAttribute('draggable')).toBe('false');
		const first = fixture.beat('b1');
		expect(first.querySelector('.snowflake-method-timeline-time-handle')!.getAttribute('draggable')).toBe('false');
		for (const cls of ['snowflake-method-timeline-time-label', 'snowflake-method-timeline-time-description', 'snowflake-method-timeline-seam-add']) {
			expect(first.querySelector(`.${cls}`)!.disabled, cls).toBe(true);
		}
		// The menus still open, to be read, with nothing in them to press.
		expect(fixture.menuOf(header, 'snowflake-method-beat-sheet-act-more').every((item) => item.disabled)).toBe(true);
		expect(fixture.menuOf(first, 'snowflake-method-timeline-time-more').every((item) => item.disabled)).toBe(true);
		// A drag that starts anyway is refused.
		const dataTransfer = transfer([BEAT_SHEET_BEAT_DRAG_TYPE]);
		fire(first.querySelector('.snowflake-method-timeline-time-handle')!, 'dragstart', { dataTransfer });
		expect(fixture.root.classes.has('is-time-drag')).toBe(false);
		// The model's word alone: the next refresh opens the controls, before the file is read again.
		fixture.remodel({ readOnly: false });
		fixture.handle.refresh();
		expect(fixture.root.classes.has('is-read-only')).toBe(false);
		expect(fixture.button('snowflake-method-beat-sheet-add-act').disabled).toBe(false);
		expect(fixture.act('a1').querySelector('.snowflake-method-beat-sheet-act-title')!.disabled).toBe(false);
	});
});

describe('the acts of a sheet', () => {
	it('heads each act as a group of scenes is headed: its handle, what it is called, a rule, its plus and its menu', async () => {
		const fixture = laid();
		await settle();
		const header = fixture.act('a1');
		expect(header.children.map((child) => [...child.classes].find((cls) => cls.startsWith('snowflake-method-')))).toEqual([
			'snowflake-method-beat-sheet-act-handle',
			'snowflake-method-corkboard-group-label',
			'snowflake-method-corkboard-group-rule',
			'snowflake-method-beat-sheet-act-add',
			'snowflake-method-beat-sheet-act-more',
		]);
		const label = header.querySelector('.snowflake-method-corkboard-group-label')!;
		expect(label.getAttribute('role')).toBe('heading');
		// The words are the way to the act's form, so they are a button, in the lane name's dress.
		const title = label.querySelector('.snowflake-method-beat-sheet-act-title')!;
		expect(title.tag).toBe('button');
		expect(title.classes.has('snowflake-method-timeline-lane-name')).toBe(true);
		expect(header.querySelector('.snowflake-method-beat-sheet-act-add')!.getAttribute('aria-label')).toBe(
			'beatSheet.act.addBeat(act=beatSheet.act.titleLabelled(number=1,label=Setup))',
		);
		expect(header.querySelector('.snowflake-method-beat-sheet-act-more')!.getAttribute('aria-haspopup')).toBe('menu');
	});

	it('numbers the acts by their place, with a label where an act has one, and numbers them again when one moves', async () => {
		const fixture = laid();
		await settle();
		expect(fixture.titles()).toEqual([
			'beatSheet.act.titleLabelled(number=1,label=Setup)',
			'beatSheet.act.title(number=2)',
			'beatSheet.act.titleLabelled(number=3,label=Resolution)',
		]);
		fixture.menuOf(fixture.act('a3'), 'snowflake-method-beat-sheet-act-more').find((item) => item.title === 'actions.moveUp')!.click();
		await settle();
		expect(fixture.bridge.moveAct).toHaveBeenCalledWith('s', 'a3', 'a2');
		expect(fixture.titles()).toEqual([
			'beatSheet.act.titleLabelled(number=1,label=Setup)',
			'beatSheet.act.titleLabelled(number=2,label=Resolution)',
			'beatSheet.act.title(number=3)',
		]);
		expect(fixture.order()).toEqual(['act:a1', 'beat:b1', 'beat:b2', 'foot:a1', 'act:a3', 'beat:b3', 'foot:a3', 'act:a2', 'foot:a2']);
	});

	it('says an act holds no beats on the line under it, and nothing under an act that holds some', async () => {
		const fixture = laid();
		await settle();
		const line = (id: string): CorkboardElement => fixture.foot(id).querySelector('.snowflake-method-character-empty')!;
		expect(line('a2').classes.has('is-hidden')).toBe(false);
		expect(line('a2').querySelectorAll('span').map((span) => span.textContent)).toContain('beatSheet.empty.beats');
		expect(fixture.foot('a2').classes.has('is-empty')).toBe(true);
		expect(fixture.act('a2').classes.has('is-empty')).toBe(true);
		expect(line('a1').classes.has('is-hidden')).toBe(true);
		expect(fixture.foot('a1').classes.has('is-empty')).toBe(false);
		await fixture.bridge.addBeat('s', 'a2', { name: 'Midpoint', description: '' }, null);
		fixture.notify();
		await settle();
		expect(line('a2').classes.has('is-hidden')).toBe(true);
	});

	it('adds an act at the end from the toolbar, through its form, with a label or without', async () => {
		const opened = watch(ActFormModal);
		const fixture = laid();
		await settle();
		fixture.button('snowflake-method-beat-sheet-add-act').dispatch('click');
		expect(opened).toHaveLength(1);
		await submit(opened[0], '');
		await settle();
		expect(fixture.bridge.addAct).toHaveBeenCalledWith('s', '', null);
		expect(fixture.titles()[3]).toBe('beatSheet.act.title(number=4)');
		expect(fixture.sheetHeld('s').acts.map((entry) => entry.label)).toEqual(['Setup', '', 'Resolution', '']);
	});

	it('opens an act\'s form from its words, on the label it has, and writes the new one', async () => {
		const opened = watch(ActFormModal);
		const fixture = laid();
		await settle();
		fixture.act('a1').querySelector('.snowflake-method-beat-sheet-act-title')!.dispatch('click');
		expect(opened).toHaveLength(1);
		expect((opened[0] as unknown as { label: string }).label).toBe('Setup');
		await submit(opened[0], 'Beginning');
		await settle();
		expect(fixture.bridge.relabelAct).toHaveBeenCalledWith('s', 'a1', 'Beginning');
		expect(fixture.titles()[0]).toBe('beatSheet.act.titleLabelled(number=1,label=Beginning)');
	});

	it('offers an act\'s menu in a card\'s order, with the sheet\'s two ends disabled', async () => {
		const fixture = laid();
		await settle();
		expect(fixture.menuOf(fixture.act('a1'), 'snowflake-method-beat-sheet-act-more').map((item) => [item.title, item.disabled])).toEqual([
			['actions.edit', false], ['actions.moveUp', true], ['actions.moveDown', false],
			['beatSheet.act.insertAfter', false], ['beatSheet.beat.add', false], ['beatSheet.act.delete', false],
		]);
		const last = fixture.menuOf(fixture.act('a3'), 'snowflake-method-beat-sheet-act-more');
		expect(last.find((item) => item.title === 'actions.moveUp')!.disabled).toBe(false);
		expect(last.find((item) => item.title === 'actions.moveDown')!.disabled).toBe(true);
		// The same menu answers a right click anywhere on the header.
		menus.length = 0;
		fire(fixture.act('a2'), 'contextmenu', {});
		expect(menus[0]!.map((item) => item.title)).toContain('beatSheet.act.insertAfter');
	});

	it('moves an act down from its menu, reading where it lands off the sheet as it stands when its turn comes', async () => {
		const fixture = laid();
		await settle();
		const down = fixture.menuOf(fixture.act('a1'), 'snowflake-method-beat-sheet-act-more').find((item) => item.title === 'actions.moveDown')!;
		// Another pane moves the last act to the head before the press is made good.
		await fixture.bridge.moveAct('s', 'a3', 'a1');
		fixture.notify();
		await settle();
		down.click();
		await settle();
		// One step down from where it stands now: past a2, to the end.
		expect(fixture.bridge.moveAct).toHaveBeenLastCalledWith('s', 'a1', null);
		expect(fixture.sheetHeld('s').acts.map((entry) => entry.id)).toEqual(['a3', 'a2', 'a1']);
	});

	it('puts a new act in after the one its menu was opened on', async () => {
		const opened = watch(ActFormModal);
		const fixture = laid();
		await settle();
		fixture.menuOf(fixture.act('a1'), 'snowflake-method-beat-sheet-act-more').find((item) => item.title === 'beatSheet.act.insertAfter')!.click();
		await submit(opened[0], 'Interlude');
		await settle();
		expect(fixture.bridge.addAct).toHaveBeenCalledWith('s', 'Interlude', 'a2');
		fixture.menuOf(fixture.act('a3'), 'snowflake-method-beat-sheet-act-more').find((item) => item.title === 'beatSheet.act.insertAfter')!.click();
		await submit(opened[1], 'Coda');
		await settle();
		expect(fixture.bridge.addAct).toHaveBeenLastCalledWith('s', 'Coda', null);
		expect(fixture.sheetHeld('s').acts.map((entry) => entry.label)).toEqual(['Setup', 'Interlude', '', 'Resolution', 'Coda']);
	});

	it('deletes a bare act at once, and asks first for one that holds beats, saying how much goes with it', async () => {
		const fixture = laid();
		await settle();
		fixture.menuOf(fixture.act('a2'), 'snowflake-method-beat-sheet-act-more').find((item) => item.title === 'beatSheet.act.delete')!.click();
		await settle();
		expect(confirmTimelineAction).not.toHaveBeenCalled();
		expect(fixture.bridge.deleteAct).toHaveBeenCalledWith('s', 'a2');
		vi.mocked(confirmTimelineAction).mockResolvedValueOnce(false);
		fixture.menuOf(fixture.act('a1'), 'snowflake-method-beat-sheet-act-more').find((item) => item.title === 'beatSheet.act.delete')!.click();
		await settle();
		expect(vi.mocked(confirmTimelineAction).mock.calls[0]![2]).toEqual({
			title: 'beatSheet.act.deleteTitle(act=beatSheet.act.titleLabelled(number=1,label=Setup))',
			lines: ['beatSheet.act.deleteDescription(beats=2,rows=2)'],
			label: 'actions.delete',
		});
		expect(fixture.bridge.deleteAct).toHaveBeenCalledTimes(1);
		fixture.menuOf(fixture.act('a1'), 'snowflake-method-beat-sheet-act-more').find((item) => item.title === 'beatSheet.act.delete')!.click();
		await settle();
		expect(fixture.bridge.deleteAct).toHaveBeenLastCalledWith('s', 'a1');
		expect(fixture.order()).toEqual(['act:a3', 'beat:b3', 'foot:a3']);
		expect(fixture.titles()).toEqual(['beatSheet.act.titleLabelled(number=1,label=Resolution)']);
	});

	it('drags an act by its handle to before another, the line on the act it lands before, judged by each act\'s whole group', async () => {
		const fixture = laid();
		await settle();
		// a1: 0-160 (header, two beats, foot), a2: 160-240, a3: 240-360.
		fixture.standTable();
		const handle = fixture.act('a3').querySelector('.snowflake-method-beat-sheet-act-handle')!;
		expect(handle.getAttribute('draggable')).toBe('true');
		const dataTransfer = transfer([BEAT_SHEET_ACT_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		expect(dataTransfer.getData(BEAT_SHEET_ACT_DRAG_TYPE)).toBe('a3');
		expect(fixture.root.classes.has('is-act-drag')).toBe(true);
		expect(fixture.act('a3').classes.has('is-dragging')).toBe(true);
		fire(fixture.table, 'dragover', { clientY: 10, dataTransfer });
		expect(dataTransfer.dropEffect).toBe('move');
		expect(fixture.act('a1').classes.has('is-drop-before')).toBe(true);
		// Past the middle of the first act's group, the act lands before the second.
		fire(fixture.table, 'dragover', { clientY: 130, dataTransfer });
		expect(fixture.act('a1').classes.has('is-drop-before')).toBe(false);
		expect(fixture.act('a2').classes.has('is-drop-before')).toBe(true);
		fire(fixture.table, 'drop', { dataTransfer });
		expect(fixture.act('a2').classes.has('is-drop-before')).toBe(false);
		fire(handle, 'dragend', {});
		expect(fixture.root.classes.has('is-act-drag')).toBe(false);
		expect(fixture.act('a3').classes.has('is-dragging')).toBe(false);
		await settle();
		expect(fixture.bridge.moveAct).toHaveBeenCalledWith('s', 'a3', 'a2');
		expect(fixture.sheetHeld('s').acts.map((entry) => entry.id)).toEqual(['a1', 'a3', 'a2']);
	});

	it('lands an act dropped past the last at the end, the line on the table\'s tail', async () => {
		const fixture = laid();
		await settle();
		fixture.standTable();
		const handle = fixture.act('a1').querySelector('.snowflake-method-beat-sheet-act-handle')!;
		const dataTransfer = transfer([BEAT_SHEET_ACT_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		fire(fixture.table, 'dragover', { clientY: 900, dataTransfer });
		expect(fixture.root.querySelector('.snowflake-method-timeline-tail')!.classes.has('is-drop-before')).toBe(true);
		fire(fixture.table, 'drop', { dataTransfer });
		fire(handle, 'dragend', {});
		await settle();
		expect(fixture.bridge.moveAct).toHaveBeenCalledWith('s', 'a1', null);
		// A beat's drag type lands nothing while an act is what is dragged.
		const stray = transfer([BEAT_SHEET_BEAT_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		fire(fixture.table, 'dragover', { clientY: 10, dataTransfer: stray });
		expect(stray.dropEffect).toBe('');
		fire(handle, 'dragend', {});
	});

	it('writes nothing from an act\'s form once another sheet is on show', async () => {
		const opened = watch(ActFormModal);
		const fixture = laid({}, { sheets: [threeActs(), sheet('other')] });
		await settle();
		fixture.button('snowflake-method-beat-sheet-add-act').dispatch('click');
		fixture.act('a1').querySelector('.snowflake-method-beat-sheet-act-title')!.dispatch('click');
		fixture.sheetField().choose('other');
		await settle();
		await submit(opened[0], 'Late');
		await submit(opened[1], 'Late');
		await settle();
		expect(fixture.bridge.addAct).not.toHaveBeenCalled();
		expect(fixture.bridge.relabelAct).not.toHaveBeenCalled();
	});
});

describe('the beats of an act', () => {
	it('lays a beat as a time is laid: its handle, its name, its description or the word that it has none, its menu, and a cell on the axis', async () => {
		const fixture = laid();
		await settle();
		const first = fixture.beat('b1');
		expect(first.classes.has('snowflake-method-timeline-row')).toBe(true);
		const time = first.querySelector('.snowflake-method-timeline-time')!;
		expect(time.children.map((child) => [...child.classes].find((cls) => cls.startsWith('snowflake-method-')))).toEqual([
			'snowflake-method-timeline-time-handle', 'snowflake-method-timeline-time-text',
			'snowflake-method-timeline-time-more', 'snowflake-method-timeline-seam',
		]);
		expect(first.querySelector('.snowflake-method-timeline-time-label')!.textContent).toBe('Opening Image');
		const description = first.querySelector('.snowflake-method-timeline-time-description')!;
		expect(description.textContent).toBe('The ordinary world.');
		expect(description.classes.has('is-empty')).toBe(false);
		const bare = fixture.beat('b2').querySelector('.snowflake-method-timeline-time-description')!;
		expect(bare.textContent).toBe('timeline.time.noDescription');
		expect(bare.classes.has('is-empty')).toBe(true);
		// A sheet is one lane, so every cell is the active lane's and none is ever absent.
		const cell = fixture.cell('b1');
		for (const cls of ['is-present', 'is-active-lane']) expect(cell.classes.has(cls), cls).toBe(true);
		expect(cell.querySelector('.snowflake-method-timeline-axis')).not.toBeNull();
		expect(cell.querySelector('.snowflake-method-timeline-rows')).not.toBeNull();
		expect(first.querySelector('.snowflake-method-timeline-seam-add')!.getAttribute('aria-label')).toBe('beatSheet.beat.insert(name=Opening Image)');
	});

	it('names a beat that has no name, in the row and wherever the row is named', async () => {
		const fixture = workspace({ sheets: [sheet('s', [act('a1', '', [beat('b1', '  ')])])] });
		await settle();
		expect(fixture.beat('b1').querySelector('.snowflake-method-timeline-time-label')!.textContent).toBe('beatSheet.beat.unnamed');
	});

	it('ends each act\'s axis at its first beat and its last, which only the painter can say', async () => {
		const fixture = laid();
		await settle();
		const ends = (id: string): [boolean, boolean] => [fixture.beat(id).classes.has('is-act-first'), fixture.beat(id).classes.has('is-act-last')];
		expect(ends('b1')).toEqual([true, false]);
		expect(ends('b2')).toEqual([false, true]);
		expect(ends('b3')).toEqual([true, true]);
		// A beat that comes to stand before the first takes the mark from it.
		await fixture.bridge.moveBeat('s', 'b2', 'a1', 'b1');
		fixture.notify();
		await settle();
		expect(ends('b2')).toEqual([true, false]);
		expect(ends('b1')).toEqual([false, true]);
	});

	it('adds a beat at an act\'s end from the act\'s plus, and before a beat from the plus on the rule above it', async () => {
		const opened = watch(BeatFormModal);
		const fixture = laid();
		await settle();
		fixture.act('a2').querySelector('.snowflake-method-beat-sheet-act-add')!.dispatch('click');
		expect(opened).toHaveLength(1);
		await submit(opened[0], { name: 'Midpoint', description: 'Everything turns.' });
		await settle();
		expect(fixture.bridge.addBeat).toHaveBeenCalledWith('s', 'a2', { name: 'Midpoint', description: 'Everything turns.' }, null);
		fixture.beat('b2').querySelector('.snowflake-method-timeline-seam-add')!.dispatch('click');
		await submit(opened[1], { name: 'Theme Stated', description: '' });
		await settle();
		expect(fixture.bridge.addBeat).toHaveBeenLastCalledWith('s', 'a1', { name: 'Theme Stated', description: '' }, 'b2');
		expect(fixture.sheetHeld('s').acts[0]!.beats.map((entry) => entry.name)).toEqual(['Opening Image', 'Theme Stated', 'Catalyst']);
		expect(fixture.order().slice(0, 5)).toEqual(['act:a1', 'beat:b1', 'beat:beat-2', 'beat:b2', 'foot:a1']);
	});

	it('leaves a beat\'s form standing over a write the project refused, since nowhere else holds its words', async () => {
		const opened = watch(BeatFormModal);
		const fixture = laid();
		await settle();
		fixture.act('a2').querySelector('.snowflake-method-beat-sheet-act-add')!.dispatch('click');
		vi.mocked(fixture.bridge.addBeat).mockResolvedValueOnce(null);
		await expect(submit(opened[0], { name: 'Midpoint', description: '' })).rejects.toThrow('beatSheet.beat.refused');
		await expect(submit(opened[0], { name: 'Midpoint', description: '' })).resolves.toBeUndefined();
		fixture.beat('b1').querySelector('.snowflake-method-timeline-time-label')!.dispatch('click');
		vi.mocked(fixture.bridge.editBeat).mockResolvedValueOnce('refused');
		await expect(submit(opened[1], { name: 'Opening', description: '' })).rejects.toThrow('beatSheet.beat.refused');
		// Another sheet on show is a refusal as well: the words stay in the form, which says so.
		fixture.moveProject('Elsewhere');
		await expect(submit(opened[1], { name: 'Opening', description: '' })).rejects.toThrow('beatSheet.beat.refused');
		expect(fixture.bridge.editBeat).toHaveBeenCalledTimes(1);
	});

	it('opens a beat\'s form from its name, and on the description when that was what was pressed', async () => {
		const opened = watch(BeatFormModal);
		const fixture = laid();
		await settle();
		const first = fixture.beat('b1');
		first.querySelector('.snowflake-method-timeline-time-label')!.dispatch('click');
		first.querySelector('.snowflake-method-timeline-time-description')!.dispatch('click');
		const options = (form: BeatFormModal): { mode: string; initial: unknown; reveal?: string } =>
			(form as unknown as { options: { mode: string; initial: unknown; reveal?: string } }).options;
		expect(options(opened[0]!)).toEqual({ mode: 'edit', initial: { name: 'Opening Image', description: 'The ordinary world.' } });
		expect(options(opened[1]!).reveal).toBe('description');
		await submit(opened[1], { name: 'Opening Image', description: 'A quiet street.' });
		await settle();
		expect(fixture.bridge.editBeat).toHaveBeenCalledWith('s', 'b1', { name: 'Opening Image', description: 'A quiet street.' });
		expect(first.querySelector('.snowflake-method-timeline-time-description')!.textContent).toBe('A quiet street.');
	});

	it('offers a beat\'s menu in a card\'s order, with the sheet\'s two ends disabled', async () => {
		const fixture = laid();
		await settle();
		expect(fixture.menuOf(fixture.beat('b1'), 'snowflake-method-timeline-time-more').map((item) => [item.title, item.disabled])).toEqual([
			['actions.edit', false], ['actions.moveUp', true], ['actions.moveDown', false],
			['beatSheet.beat.moveToAct', false], ['beatSheet.beat.insertAfter', false], ['beatSheet.beat.delete', false],
		]);
		const last = fixture.menuOf(fixture.beat('b3'), 'snowflake-method-timeline-time-more');
		expect(last.find((item) => item.title === 'actions.moveUp')!.disabled).toBe(false);
		expect(last.find((item) => item.title === 'actions.moveDown')!.disabled).toBe(true);
		// With one act there is no other to move to.
		const lone = workspace({ sheets: [sheet('s', [act('a1', '', [beat('b1', 'Alone')])])] });
		await settle();
		const menu = lone.menuOf(lone.beat('b1'), 'snowflake-method-timeline-time-more');
		expect(menu.filter((item) => item.disabled).map((item) => item.title)).toEqual(['actions.moveUp', 'actions.moveDown', 'beatSheet.beat.moveToAct']);
		// The same menu answers a right click on the beat's own cell of the column.
		menus.length = 0;
		fire(lone.beat('b1').querySelector('.snowflake-method-timeline-time')!, 'contextmenu', {});
		expect(menus[0]!.map((item) => item.title)).toContain('beatSheet.beat.moveToAct');
	});

	it('moves a beat a step at a time down the sheet as it is read: within its act, then across the act\'s edge, an empty act included', async () => {
		const fixture = laid();
		await settle();
		const step = async (id: string, title: string): Promise<void> => {
			fixture.menuOf(fixture.beat(id), 'snowflake-method-timeline-time-more').find((item) => item.title === title)!.click();
			await settle();
		};
		await step('b1', 'actions.moveDown');
		expect(fixture.bridge.moveBeat).toHaveBeenLastCalledWith('s', 'b1', 'a1', null);
		await step('b1', 'actions.moveDown');
		expect(fixture.bridge.moveBeat).toHaveBeenLastCalledWith('s', 'b1', 'a2', null);
		expect(fixture.order()).toEqual(['act:a1', 'beat:b2', 'foot:a1', 'act:a2', 'beat:b1', 'foot:a2', 'act:a3', 'beat:b3', 'foot:a3']);
		await step('b1', 'actions.moveDown');
		expect(fixture.bridge.moveBeat).toHaveBeenLastCalledWith('s', 'b1', 'a3', 'b3');
		await step('b3', 'actions.moveUp');
		expect(fixture.bridge.moveBeat).toHaveBeenLastCalledWith('s', 'b3', 'a3', 'b1');
		await step('b3', 'actions.moveUp');
		expect(fixture.bridge.moveBeat).toHaveBeenLastCalledWith('s', 'b3', 'a2', null);
		expect(fixture.sheetHeld('s').acts.map((entry) => entry.beats.map((one) => one.id))).toEqual([['b2'], ['b3'], ['b1']]);
	});

	it('keeps a beat\'s row, its cell and what is open in it when the beat moves to another act', async () => {
		const fixture = laid();
		await settle();
		const before = fixture.beat('b1');
		const label = subrow(fixture.cell('b1'), 'r2').querySelector('.snowflake-method-timeline-subrow-label')!;
		label.dispatch('click');
		const input = subrow(fixture.cell('b1'), 'r2').querySelector('.snowflake-method-timeline-subrow-input')!;
		input.value = 'Argues, and loses';
		await fixture.bridge.moveBeat('s', 'b1', 'a3', null);
		fixture.notify();
		await settle();
		expect(fixture.beat('b1')).toBe(before);
		expect(fixture.order()).toEqual(['act:a1', 'beat:b2', 'foot:a1', 'act:a2', 'foot:a2', 'act:a3', 'beat:b3', 'beat:b1', 'foot:a3']);
		const row = subrow(fixture.cell('b1'), 'r2');
		expect(row.classes.has('is-editing')).toBe(true);
		expect(row.querySelector('.snowflake-method-timeline-subrow-input')!.value).toBe('Argues, and loses');
		expect(fixture.bridge.editRow).not.toHaveBeenCalled();
	});

	it('sends a beat to another act from its menu, to that act\'s end, and ignores a pick made for a sheet no longer on show', async () => {
		const opened = watch(TimelineTimePickModal);
		const fixture = laid({}, { sheets: [threeActs(), sheet('other')] });
		await settle();
		fixture.menuOf(fixture.beat('b1'), 'snowflake-method-timeline-time-more').find((item) => item.title === 'beatSheet.beat.moveToAct')!.click();
		expect(opened).toHaveLength(1);
		const picker = opened[0]!;
		expect(picker.getItems().map((item) => [item.value, item.label])).toEqual([
			['a2', 'beatSheet.act.title(number=2)'],
			['a3', 'beatSheet.act.titleLabelled(number=3,label=Resolution)'],
		]);
		picker.onChooseItem(picker.getItems()[1]!);
		await settle();
		expect(fixture.bridge.moveBeat).toHaveBeenCalledWith('s', 'b1', 'a3', null);
		fixture.menuOf(fixture.beat('b2'), 'snowflake-method-timeline-time-more').find((item) => item.title === 'beatSheet.beat.moveToAct')!.click();
		fixture.sheetField().choose('other');
		await settle();
		opened[1]!.onChooseItem(opened[1]!.getItems()[0]!);
		await settle();
		expect(fixture.bridge.moveBeat).toHaveBeenCalledTimes(1);
	});

	it('puts a new beat in after the one its menu was opened on, in that beat\'s act', async () => {
		const opened = watch(BeatFormModal);
		const fixture = laid();
		await settle();
		const insert = (id: string): void => {
			fixture.menuOf(fixture.beat(id), 'snowflake-method-timeline-time-more').find((item) => item.title === 'beatSheet.beat.insertAfter')!.click();
		};
		insert('b1');
		await submit(opened[0], { name: 'Theme Stated', description: '' });
		await settle();
		expect(fixture.bridge.addBeat).toHaveBeenLastCalledWith('s', 'a1', { name: 'Theme Stated', description: '' }, 'b2');
		insert('b3');
		await submit(opened[1], { name: 'After', description: '' });
		await settle();
		expect(fixture.bridge.addBeat).toHaveBeenLastCalledWith('s', 'a3', { name: 'After', description: '' }, null);
	});

	it('deletes a bare beat at once, and asks first for one that holds sub-descriptions', async () => {
		const fixture = laid();
		await settle();
		const remove = (id: string): void => {
			fixture.menuOf(fixture.beat(id), 'snowflake-method-timeline-time-more').find((item) => item.title === 'beatSheet.beat.delete')!.click();
		};
		remove('b2');
		await settle();
		expect(confirmTimelineAction).not.toHaveBeenCalled();
		expect(fixture.bridge.deleteBeat).toHaveBeenCalledWith('s', 'b2');
		vi.mocked(confirmTimelineAction).mockResolvedValueOnce(false);
		remove('b1');
		await settle();
		expect(vi.mocked(confirmTimelineAction).mock.calls[0]![2]).toEqual({
			title: 'beatSheet.beat.deleteTitle(name=Opening Image)',
			lines: ['beatSheet.beat.deleteDescription(rows=2)'],
			label: 'actions.delete',
		});
		expect(fixture.bridge.deleteBeat).toHaveBeenCalledTimes(1);
		remove('b1');
		await settle();
		expect(fixture.bridge.deleteBeat).toHaveBeenLastCalledWith('s', 'b1');
		// The scene the beat held is the pool's again.
		const variant = fixture.corkboard.mock.calls[0]![2] as unknown as { include: (scene: { id: string }) => boolean };
		expect(variant.include({ id: 'scene-1' })).toBe(true);
	});

	it('drags a beat by its handle to before another, into another act, the line on the beat it lands before', async () => {
		const fixture = laid();
		await settle();
		// act a1 0, b1 40, b2 80, foot a1 120, act a2 160, foot a2 200, act a3 240, b3 280, foot a3 320.
		fixture.standTable();
		const handle = fixture.beat('b1').querySelector('.snowflake-method-timeline-time-handle')!;
		expect(handle.getAttribute('draggable')).toBe('true');
		const dataTransfer = transfer([BEAT_SHEET_BEAT_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		expect(dataTransfer.getData(BEAT_SHEET_BEAT_DRAG_TYPE)).toBe('b1');
		// The timeline's class for a time's drag dresses a beat's the same way.
		expect(fixture.root.classes.has('is-time-drag')).toBe(true);
		expect(fixture.beat('b1').classes.has('is-dragging')).toBe(true);
		fire(fixture.table, 'dragover', { clientY: 290, dataTransfer });
		expect(dataTransfer.dropEffect).toBe('move');
		expect(fixture.beat('b3').classes.has('is-drop-before')).toBe(true);
		fire(fixture.table, 'drop', { dataTransfer });
		expect(fixture.beat('b3').classes.has('is-drop-before')).toBe(false);
		fire(handle, 'dragend', {});
		expect(fixture.root.classes.has('is-time-drag')).toBe(false);
		expect(fixture.beat('b1').classes.has('is-dragging')).toBe(false);
		await settle();
		expect(fixture.bridge.moveBeat).toHaveBeenCalledWith('s', 'b1', 'a3', 'b3');
		expect(fixture.sheetHeld('s').acts.map((entry) => entry.beats.map((one) => one.id))).toEqual([['b2'], [], ['b1', 'b3']]);
	});

	it('lands a beat on an act\'s foot for the act\'s end, an empty act\'s included, and at the last act\'s end past everything', async () => {
		const fixture = laid();
		await settle();
		fixture.standTable();
		const handle = fixture.beat('b1').querySelector('.snowflake-method-timeline-time-handle')!;
		const dataTransfer = transfer([BEAT_SHEET_BEAT_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		// Under the last beat of its own act: the act's end.
		fire(fixture.table, 'dragover', { clientY: 125, dataTransfer });
		expect(fixture.foot('a1').classes.has('is-drop-before')).toBe(true);
		// Over the empty act: its foot is the only place in it.
		fire(fixture.table, 'dragover', { clientY: 190, dataTransfer });
		expect(fixture.foot('a1').classes.has('is-drop-before')).toBe(false);
		expect(fixture.foot('a2').classes.has('is-drop-before')).toBe(true);
		fire(fixture.table, 'drop', { dataTransfer });
		fire(handle, 'dragend', {});
		await settle();
		expect(fixture.bridge.moveBeat).toHaveBeenCalledWith('s', 'b1', 'a2', null);
		fixture.standTable();
		const again = transfer([BEAT_SHEET_BEAT_DRAG_TYPE]);
		const second = fixture.beat('b2').querySelector('.snowflake-method-timeline-time-handle')!;
		fire(second, 'dragstart', { dataTransfer: again });
		fire(fixture.table, 'dragover', { clientY: 900, dataTransfer: again });
		expect(fixture.foot('a3').classes.has('is-drop-before')).toBe(true);
		fire(fixture.table, 'drop', { dataTransfer: again });
		fire(second, 'dragend', {});
		await settle();
		expect(fixture.bridge.moveBeat).toHaveBeenLastCalledWith('s', 'b2', 'a3', null);
	});

	it('writes nothing for a beat dropped where it already stands', async () => {
		const fixture = laid();
		await settle();
		fixture.standTable();
		const handle = fixture.beat('b1').querySelector('.snowflake-method-timeline-time-handle')!;
		const dataTransfer = transfer([BEAT_SHEET_BEAT_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		// Before the beat that already follows it.
		fire(fixture.table, 'dragover', { clientY: 90, dataTransfer });
		expect(fixture.beat('b2').classes.has('is-drop-before')).toBe(true);
		fire(fixture.table, 'drop', { dataTransfer });
		fire(handle, 'dragend', {});
		await settle();
		expect(fixture.bridge.moveBeat).not.toHaveBeenCalled();
	});

	it('holds a paint the bell asks for while a beat is dragged, and makes it when the drag ends', async () => {
		const fixture = laid();
		await settle();
		const handle = fixture.beat('b1').querySelector('.snowflake-method-timeline-time-handle')!;
		fire(handle, 'dragstart', { dataTransfer: transfer([BEAT_SHEET_BEAT_DRAG_TYPE]) });
		await fixture.bridge.relabelAct('s', 'a2', 'Confrontation');
		fixture.notify();
		await settle();
		// The rows under the pointer stand as they stood when the drag began.
		expect(fixture.titles()[1]).toBe('beatSheet.act.title(number=2)');
		fire(handle, 'dragend', {});
		expect(fixture.titles()[1]).toBe('beatSheet.act.titleLabelled(number=2,label=Confrontation)');
	});
});

describe('sub-descriptions and scenes on a beat, through the cells a timeline shares', () => {
	it('makes a row from the words typed at a beat\'s foot, and edits one in place', async () => {
		const fixture = laid();
		await settle();
		const cell = fixture.cell('b2');
		const input = trailingInput(cell);
		expect(input.getAttribute('placeholder')).toBe('timeline.subrow.placeholder');
		input.focus();
		input.value = '  A letter comes  ';
		press(input, 'Enter', { mod: true });
		expect(subrows(cell)[0]!.classes.has('is-pending')).toBe(true);
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledWith('s', 'b2', 'A letter comes', null);
		expect(cell.querySelector('.snowflake-method-timeline-subrow.is-pending')).toBeNull();
		const first = subrow(fixture.cell('b1'), 'r1');
		first.querySelector('.snowflake-method-timeline-subrow-label')!.dispatch('click');
		const editor = first.querySelector('.snowflake-method-timeline-subrow-input')!;
		editor.value = 'Arrives late';
		press(editor, 'Enter', { mod: true });
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledWith('s', 'r1', 'Arrives late');
	});

	it('adds the way to another beat to a row\'s menu, naming each beat by its act and itself', async () => {
		const opened = watch(TimelineTimePickModal);
		const fixture = laid();
		await settle();
		const menu = fixture.menuOf(subrow(fixture.cell('b1'), 'r2'), 'snowflake-method-timeline-subrow-more');
		expect(menu.map((item) => item.title)).toContain('beatSheet.subrow.moveToBeat');
		expect(menu.map((item) => item.title)).not.toContain('timeline.subrow.moveToTime');
		menu.find((item) => item.title === 'beatSheet.subrow.moveToBeat')!.click();
		const picker = opened[0]!;
		expect(picker.getItems().map((item) => [item.value, item.label])).toEqual([
			['b2', 'beatSheet.act.titleLabelled(number=1,label=Setup) · Catalyst'],
			['b3', 'beatSheet.act.titleLabelled(number=3,label=Resolution) · Final Image'],
		]);
		picker.onChooseItem(picker.getItems()[1]!);
		await settle();
		expect(fixture.bridge.moveRow).toHaveBeenCalledWith('s', 'r2', 'b3', null);
		expect(fixture.sheetHeld('s').acts[2]!.beats[0]!.rows.map((entry) => entry.id)).toEqual(['r2']);
	});

	it('offers no other beat to a row of the only beat, and moves nothing for a row that went meanwhile', async () => {
		const opened = watch(TimelineTimePickModal);
		const lone = workspace({ sheets: [sheet('s', [act('a1', '', [beat('b1', 'Alone', { rows: [row('r1', 'Waits')] })])])] });
		await settle();
		const menu = lone.menuOf(subrow(lone.cell('b1'), 'r1'), 'snowflake-method-timeline-subrow-more');
		expect(menu.find((item) => item.title === 'beatSheet.subrow.moveToBeat')!.disabled).toBe(true);
		const fixture = laid();
		await settle();
		fixture.menuOf(subrow(fixture.cell('b1'), 'r2'), 'snowflake-method-timeline-subrow-more')
			.find((item) => item.title === 'beatSheet.subrow.moveToBeat')!.click();
		// The row is deleted from another pane while the picker stands.
		await fixture.bridge.deleteRow('s', 'r2');
		opened[0]!.onChooseItem(opened[0]!.getItems()[0]!);
		await settle();
		expect(fixture.bridge.moveRow).not.toHaveBeenCalled();
	});

	it('drags a row to another beat, under the beat sheet\'s own drag type', async () => {
		const fixture = laid();
		await settle();
		const handle = subrow(fixture.cell('b1'), 'r2').querySelector('.snowflake-method-timeline-subrow-handle')!;
		const dataTransfer = transfer([BEAT_SHEET_ROW_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		expect(dataTransfer.getData(BEAT_SHEET_ROW_DRAG_TYPE)).toBe('r2');
		expect(fixture.root.classes.has('is-row-drag')).toBe(true);
		fire(fixture.cell('b3'), 'dragover', { clientY: 10, dataTransfer });
		expect(dataTransfer.dropEffect).toBe('move');
		fire(fixture.cell('b3'), 'drop', { dataTransfer });
		fire(handle, 'dragend', {});
		expect(fixture.root.classes.has('is-row-drag')).toBe(false);
		await settle();
		expect(fixture.bridge.moveRow).toHaveBeenCalledWith('s', 'r2', 'b3', null);
	});

	it('deals the pool as the corkboard in one column, leaving out what the sheet on show has placed', async () => {
		const fixture = laid({}, { sheets: [threeActs(), sheet('other')] });
		await settle();
		const [host, poolControls, variant] = fixture.corkboard.mock.calls[0]! as unknown as [
			CorkboardElement,
			CorkboardControls,
			{ include: (scene: { id: string }) => boolean; addButton: string; columns: number; emptyText: string; modeShared: boolean },
		];
		expect(host.classes.has('snowflake-method-corkboard-host')).toBe(true);
		expect(poolControls.memory).toBe(fixture.memory.pool);
		expect(variant).toMatchObject({ addButton: 'icon', columns: 1, emptyText: 'beatSheet.pool.empty', modeShared: true });
		expect(['scene-1', 'scene-2', 'scene-3'].map((id) => variant.include({ id }))).toEqual([false, true, true]);
		expect(fixture.root.querySelector('.snowflake-method-timeline-pool-count')!.textContent).toBe('2');
		// A scene stands once per sheet: another sheet has placed nothing, so its pool holds them all.
		fixture.sheetField().choose('other');
		expect(['scene-1', 'scene-2', 'scene-3'].map((id) => variant.include({ id }))).toEqual([true, true, true]);
		expect(fixture.root.querySelector('.snowflake-method-timeline-pool-count')!.textContent).toBe('3');
	});

	it('places a pool scene on a row by drag, and takes a placed one back into the pool', async () => {
		const fixture = laid({}, { sheets: [sheet('s', threeActs().acts, { presentation: 'flat' })] });
		await settle();
		const variant = fixture.corkboard.mock.calls[0]![2] as unknown as {
			dragOut: { onStart: (sceneId: string, transfer: unknown) => void; onEnd: () => void };
			dropIn: { accepts: (types: readonly string[]) => boolean; onDrop: (transfer: unknown) => void };
		};
		const dataTransfer = transfer([BEAT_SHEET_SCENE_DRAG_TYPE]);
		dataTransfer.setData(BEAT_SHEET_SCENE_DRAG_TYPE, 'scene-2');
		variant.dragOut.onStart('scene-2', dataTransfer);
		expect(fixture.root.classes.has('is-scene-drag')).toBe(true);
		const card = fixture.cards().find((candidate) => candidate.getAttribute('data-id') === 'scene-1')!;
		standAt(card, 0);
		const box = subrow(fixture.cell('b1'), 'r1').querySelector('.snowflake-method-timeline-scenes')!;
		// One lane has the field's width, so a row's cards run across and a landing is read left to right.
		fire(fixture.cell('b1'), 'dragover', { target: box, clientX: 90, clientY: 10, dataTransfer });
		expect(card.classes.has('is-drop-after')).toBe(true);
		fire(fixture.cell('b1'), 'dragover', { target: box, clientX: 10, clientY: 10, dataTransfer });
		expect(dataTransfer.dropEffect).toBe('move');
		expect(card.classes.has('is-drop-after')).toBe(false);
		expect(card.classes.has('is-drop-before')).toBe(true);
		fire(fixture.cell('b1'), 'drop', { target: box, dataTransfer });
		variant.dragOut.onEnd();
		await settle();
		expect(fixture.bridge.placeScene).toHaveBeenCalledWith('s', 'scene-2', 'r1', 'scene-1');
		// The pool takes a beat sheet's scene and no timeline's.
		expect(variant.dropIn.accepts([BEAT_SHEET_SCENE_DRAG_TYPE])).toBe(false);
		const placed = fixture.cards().find((candidate) => candidate.getAttribute('data-id') === 'scene-1')!;
		const leaving = transfer([BEAT_SHEET_SCENE_DRAG_TYPE]);
		fire(placed, 'dragstart', { dataTransfer: leaving });
		expect(variant.dropIn.accepts([BEAT_SHEET_SCENE_DRAG_TYPE])).toBe(true);
		expect(variant.dropIn.accepts(['application/x-snowflake-timeline-scene'])).toBe(false);
		variant.dropIn.onDrop(leaving);
		fire(placed, 'dragend', {});
		await settle();
		expect(fixture.bridge.removeScene).toHaveBeenCalledWith('s', 'scene-1');
	});

	it('names the sheet, the act and the beat wherever a card\'s menu offers a place, and takes a scene off in the sheet\'s own words', async () => {
		const opened = watch(MoveAfterModal);
		const fixture = laid({}, { sheets: [sheet('s', threeActs().acts, { presentation: 'flat' })] });
		await settle();
		menus.length = 0;
		fixture.cards().find((card) => card.getAttribute('data-id') === 'scene-1')!
			.querySelector('.snowflake-method-corkboard-more')!.dispatch('click');
		const menu = menus[0]!;
		expect(menu.map((item) => item.title)).toContain('beatSheet.scene.remove');
		expect(menu.map((item) => item.title)).not.toContain('timeline.scene.remove');
		menu.find((item) => item.title === 'timeline.scene.moveTo')!.click();
		expect(opened[0]!.getItems().map((entry) => entry.label)).toEqual([
			'Sheet s · beatSheet.act.titleLabelled(number=1,label=Setup) · Opening Image / Arrives',
			'Sheet s · beatSheet.act.titleLabelled(number=1,label=Setup) · Opening Image / Argues',
			'Sheet s · beatSheet.act.titleLabelled(number=1,label=Setup) · Opening Image / timeline.scene.placeNewRow',
			'Sheet s · beatSheet.act.titleLabelled(number=1,label=Setup) · Catalyst / timeline.scene.placeNewRow',
			'Sheet s · beatSheet.act.titleLabelled(number=3,label=Resolution) · Final Image / timeline.scene.placeNewRow',
		]);
		menu.find((item) => item.title === 'beatSheet.scene.remove')!.click();
		await settle();
		expect(fixture.bridge.removeScene).toHaveBeenCalledWith('s', 'scene-1');
		// The pool's own menu places a scene the same way.
		menus.length = 0;
		const poolMenu = new Menu();
		fixture.corkboard.mock.calls[0]![2]!.menuItems!('scene-2', poolMenu);
		poolMenu.showAtMouseEvent({} as MouseEvent);
		expect(menus[0]!.map((item) => item.title)).toContain('timeline.scene.moveTo');
	});

	it('deals a row\'s scenes as a stack when the sheet says so, remembering the card on show under the sheet and the row', async () => {
		const fixture = laid({}, { sheets: [sheet('s', [act('a1', '', [beat('b1', 'One', { rows: [row('r1', 'Both', ['scene-1', 'scene-2'])] })])], { presentation: 'stack' })] });
		await settle();
		expect(fixture.root.dataset.presentation).toBe('stack');
		expect(fixture.cards().map((card) => card.getAttribute('data-id'))).toEqual(['scene-1']);
		fixture.cell('b1').querySelector('.snowflake-method-timeline-stack-next')!.dispatch('click');
		expect(fixture.cards().map((card) => card.getAttribute('data-id'))).toEqual(['scene-2']);
		expect([...fixture.memory.stackPositions.entries()]).toEqual([[beatStackKey('s', 'r1'), 1]]);
	});

	it('keeps words typed at a foot for that sheet and that beat, across a turn to another sheet and back', async () => {
		const fixture = laid({}, { sheets: [threeActs(), sheet('other', [act('o1', '', [beat('ob1', 'Alone')])])], lastSheetId: 's' });
		await settle();
		const input = trailingInput(fixture.cell('b2'));
		input.value = 'Half a thought';
		input.dispatch('input');
		fixture.sheetField().choose('other');
		await settle();
		expect(trailingInput(fixture.cell('ob1')).value).toBe('');
		fixture.sheetField().choose('s');
		await settle();
		expect(trailingInput(fixture.cell('b2')).value).toBe('Half a thought');
		expect(trailingInput(fixture.cell('b1')).value).toBe('');
		expect(fixture.bridge.addRow).not.toHaveBeenCalled();
	});

	it('shows the words at a foot for keeping when their beat is deleted from under them, since a beat has nothing to come back as', async () => {
		const opened = watch(TimelineDraftModal);
		const fixture = laid();
		await settle();
		const input = trailingInput(fixture.cell('b2'));
		input.value = 'Never sent anywhere';
		input.dispatch('input');
		await fixture.bridge.deleteBeat('s', 'b2');
		fixture.notify();
		await settle();
		expect(opened).toHaveLength(1);
		const drafts = (opened[0] as unknown as { drafts: { place: string; words: string }[] }).drafts;
		expect(drafts.map((draft) => draft.words)).toEqual(['Never sent anywhere']);
		// The beat has gone, so the place is named as far as it can still be.
		expect(drafts[0]!.place).toBe('Sheet s');
		expect(fixture.bridge.addRow).not.toHaveBeenCalled();
	});
});

describe('the beat sheet\'s two folds', () => {
	it('folds the beat column to its names and the pool away, remembering each', async () => {
		const fixture = laid();
		await settle();
		const beats = fixture.button('snowflake-method-timeline-time-toggle');
		const pool = fixture.button('snowflake-method-timeline-pool-toggle');
		expect(beats.getAttribute('aria-label')).toBe('beatSheet.beat.collapse');
		expect(beats.getAttribute('aria-expanded')).toBe('true');
		beats.dispatch('click');
		// The beat column folds as the timeline's time column does, by the same class.
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(true);
		expect(fixture.memory.beatsCollapsed).toBe(true);
		expect(beats.getAttribute('aria-label')).toBe('beatSheet.beat.expand');
		expect(beats.getAttribute('aria-expanded')).toBe('false');
		expect(fixture.remember).toHaveBeenCalledTimes(1);
		pool.dispatch('click');
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(true);
		expect(fixture.root.querySelector('.snowflake-method-timeline-pool')!.classes.has('is-hidden')).toBe(true);
		expect(fixture.memory.poolCollapsed).toBe(true);
		expect(pool.getAttribute('aria-label')).toBe('timeline.pool.expand');
		expect(fixture.poolHandle.remeasure).toHaveBeenCalled();
		// A card can only be shown in a pool that stands.
		fixture.handle.reveal('scene-2');
		expect(fixture.memory.poolCollapsed).toBe(false);
		expect(fixture.poolHandle.reveal).toHaveBeenCalledWith('scene-2');
	});

	it('folds both by its width alone when narrow, and brings back what was opened by hand until it is wide again', async () => {
		const fixture = laid();
		await settle();
		fixture.dom.resize(900);
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(true);
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(true);
		// The tab remembers nothing of a fold the width made.
		expect(fixture.memory.beatsCollapsed).toBe(false);
		expect(fixture.memory.poolCollapsed).toBe(false);
		fixture.button('snowflake-method-timeline-pool-toggle').dispatch('click');
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(false);
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(true);
		fixture.dom.resize(1600);
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(false);
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(false);
	});

	it('keeps where the sheet stands, so a turn away and back finds it there', async () => {
		const fixture = laid();
		await settle();
		const scroller = fixture.body().querySelector('.snowflake-method-timeline-scroll')!;
		scroller.scrollLeft = 120;
		scroller.scrollTop = 90;
		scroller.dispatch('scroll');
		expect(fixture.memory.scroll).toEqual({ left: 120, top: 90 });
	});
});

describe('the beat sheets\' own forms', () => {
	it('makes a sheet from a preset written in the project\'s language, and shows it', async () => {
		const opened = watch(AddBeatSheetModal);
		const fixture = workspace({ sheets: [sheet('s')] }, { locale: 'zh-CN' });
		await settle();
		fixture.button('snowflake-method-beat-sheet-add').dispatch('click');
		expect(opened).toHaveLength(1);
		const options = (opened[0] as unknown as { options: { takenNames: string[]; shelf: { builtIn: () => { name: string }[] } } }).options;
		expect(options.takenNames).toEqual(['Sheet s']);
		// The presets are offered in the words they will be written in: the project's, not the app's.
		expect(options.shelf.builtIn().map((preset) => preset.name)).toEqual(['空白', '三幕式', '起承转合', '故事圈', '救猫咪', '英雄之旅', '言情节拍']);
		await submit(opened[0], { name: '第二稿', template: { kind: 'built-in', id: 'kishotenketsu' } });
		await settle();
		expect(fixture.bridge.createSheet).toHaveBeenCalledWith('第二稿', { kind: 'built-in', id: 'kishotenketsu' });
		expect(fixture.sheetField().value()).toBe('beat-sheet-1');
		expect(fixture.select().value).toBe('第二稿');
		expect(fixture.held().lastSheetId).toBe('beat-sheet-1');
		expect(fixture.sheetHeld('beat-sheet-1').acts.map((entry) => entry.label)).toEqual(['起', '承', '转', '合']);
		expect(fixture.acts()).toHaveLength(4);
	});

	it('reads the project\'s own templates off the file as it stands, and leaves the form open over a refusal', async () => {
		const opened = watch(AddBeatSheetModal);
		const fixture = workspace({ sheets: [sheet('s')], templates: [template('tpl-1', 'My shape')] });
		await settle();
		fixture.button('snowflake-method-beat-sheet-add').dispatch('click');
		const shelf = (opened[0] as unknown as { options: { shelf: { project: () => readonly BeatSheetTemplate[] } } }).options.shelf;
		expect(shelf.project().map((entry) => entry.name)).toEqual(['My shape']);
		// A template exported from another pane while the form stands is on the shelf once the bell has rung.
		await fixture.bridge.saveTemplate('s', { name: 'Bare', description: '' });
		fixture.notify();
		await settle();
		expect(shelf.project().map((entry) => entry.name)).toEqual(['My shape', 'Bare']);
		vi.mocked(fixture.bridge.createSheet).mockResolvedValueOnce(null);
		await expect(submit(opened[0], { name: 'Refused', template: { kind: 'project', id: 'tpl-1' } })).rejects.toThrow('beatSheet.sheet.createRefused');
		await expect(submit(opened[0], { name: 'From mine', template: { kind: 'project', id: 'tpl-1' } })).resolves.toBeUndefined();
		await settle();
		expect(fixture.select().value).toBe('From mine');
		expect(fixture.titles()).toEqual(['beatSheet.act.titleLabelled(number=1,label=Opening)']);
		expect(fixture.beats().map((entry) => entry.querySelector('.snowflake-method-timeline-time-description')!.textContent)).toEqual(['The first line.']);
	});

	it('renames the sheet on show from its form, writing nothing for a name already so', async () => {
		const opened = watch(EditBeatSheetModal);
		const fixture = laid({}, { sheets: [threeActs(), sheet('other')] });
		await settle();
		fixture.button('snowflake-method-beat-sheet-edit').dispatch('click');
		const options = (opened[0] as unknown as { options: { initial: string; takenNames: string[] } }).options;
		expect(options).toMatchObject({ initial: 'Sheet s', takenNames: ['Sheet other'] });
		await submit(opened[0], 'Sheet s');
		await settle();
		expect(fixture.bridge.renameSheet).not.toHaveBeenCalled();
		await submit(opened[0], 'First draft');
		await settle();
		expect(fixture.bridge.renameSheet).toHaveBeenCalledWith('s', 'First draft');
		expect(fixture.select().value).toBe('First draft');
	});

	it('deletes the sheet from its form after asking, answering with what the file said, and shows the next', async () => {
		const opened = watch(EditBeatSheetModal);
		const fixture = laid({}, { sheets: [threeActs(), sheet('other')] });
		await settle();
		fixture.button('snowflake-method-beat-sheet-edit').dispatch('click');
		const remove = (opened[0] as unknown as { options: { deleteSheet: () => Promise<boolean> } }).options.deleteSheet;
		vi.mocked(confirmTimelineAction).mockResolvedValueOnce(false);
		await expect(remove()).resolves.toBe(false);
		expect(vi.mocked(confirmTimelineAction).mock.calls[0]![2]).toEqual({
			title: 'beatSheet.sheet.deleteTitle(name=Sheet s)',
			lines: ['beatSheet.sheet.deleteDescription(acts=3,beats=3,rows=2)'],
			label: 'actions.delete',
		});
		expect(fixture.bridge.deleteSheet).not.toHaveBeenCalled();
		// A sheet the project would not let go stands, and its form with it, saying so.
		vi.mocked(fixture.bridge.deleteSheet).mockResolvedValueOnce(false);
		await expect(remove()).resolves.toBe(false);
		expect(notices).toHaveBeenLastCalledWith('beatSheet.sheet.deleteRefused');
		await expect(remove()).resolves.toBe(true);
		await settle();
		expect(fixture.held().sheets.map((entry) => entry.id)).toEqual(['other']);
		expect(fixture.sheetField().value()).toBe('other');
	});
});

describe('the project\'s own templates', () => {
	type Asked = Parameters<typeof promptForCustomFieldTemplate>;
	/** Answers the template dialog by hand: what it was asked, and the way to answer it. */
	const dialog = () => {
		const asked: { options: Asked[2]; keep: Asked[3]; answer: (result: { name: string; description: string } | null) => void }[] = [];
		vi.mocked(promptForCustomFieldTemplate).mockImplementation((_app, _t, options, keep) =>
			new Promise((resolve) => {
				asked.push({ options, keep, answer: (result) => { resolve(result === null ? null : { ...result, fields: [] }); } });
			}));
		return asked;
	};

	it('exports the sheet on show from the toolbar as an entity\'s custom fields are exported: a name, a sentence, and nothing of what is written under the beats', async () => {
		const asked = dialog();
		const fixture = laid();
		await settle();
		const symbol = fixture.button('snowflake-method-beat-sheet-export');
		expect(symbol.getAttribute('aria-label')).toBe('modal.customFieldTemplate.exportTitle');
		symbol.dispatch('click');
		expect(asked).toHaveLength(1);
		expect(asked[0]!.options).toMatchObject({
			title: 'modal.customFieldTemplate.exportTitle', submitLabel: 'common.save', rows: null,
			initial: { name: 'Sheet s', description: '' },
		});
		expect(asked[0]!.options.objection('Anything')).toBeNull();
		expect(asked[0]!.options.advisory?.('Sheet s')).toBeNull();
		asked[0]!.answer({ name: 'My shape', description: 'Three acts, one hollow.' });
		await settle();
		expect(fixture.bridge.saveTemplate).toHaveBeenCalledExactlyOnceWith('s', { name: 'My shape', description: 'Three acts, one hollow.' });
		expect(notices).toHaveBeenLastCalledWith('notice.templateExported(name=My shape)');
		expect(fixture.held().templates.map((entry) => [entry.name, entry.description, entry.acts.map((one) => `${one.label}:${String(one.beats.length)}`)])).toEqual([
			['My shape', 'Three acts, one hollow.', ['Setup:2', ':0', 'Resolution:1']],
		]);
		// A beat's main description goes with it; the rows under it and their scenes do not.
		expect(fixture.held().templates[0]!.acts[0]!.beats[0]).toEqual({ name: 'Opening Image', description: 'The ordinary world.' });
	});

	it('says before it happens that a namesake will be replaced, however the name is cased', async () => {
		const asked = dialog();
		const fixture = laid({}, { templates: [template('tpl-1', 'My Shape')] });
		await settle();
		fixture.button('snowflake-method-beat-sheet-export').dispatch('click');
		expect(asked[0]!.options.advisory?.('my shape')).toBe('modal.customFieldTemplate.replaceNotice(name=My Shape)');
		expect(asked[0]!.options.advisory?.('Another')).toBeNull();
		asked[0]!.answer({ name: 'my shape', description: '' });
		await settle();
		// Replaced where it stands, under the id it had, in the name as typed.
		expect(fixture.held().templates.map((entry) => [entry.id, entry.name, entry.acts.length])).toEqual([['tpl-1', 'my shape', 3]]);
	});

	it('keeps the sheet the press was made on, whatever is on show by the time the name is typed', async () => {
		const asked = dialog();
		const fixture = laid({}, { sheets: [threeActs(), sheet('other', [act('o1', 'Only')])], lastSheetId: 's' });
		await settle();
		fixture.button('snowflake-method-beat-sheet-export').dispatch('click');
		fixture.sheetField().choose('other');
		await settle();
		asked[0]!.answer({ name: 'Kept', description: '' });
		await settle();
		expect(fixture.bridge.saveTemplate).toHaveBeenCalledExactlyOnceWith('s', { name: 'Kept', description: '' });
		expect(fixture.held().templates[0]!.acts).toHaveLength(3);
	});

	it('says so when the template could not be saved, and saves nothing for a dialog dismissed or a project no longer its own', async () => {
		const asked = dialog();
		const fixture = laid();
		await settle();
		const symbol = fixture.button('snowflake-method-beat-sheet-export');
		symbol.dispatch('click');
		asked[0]!.answer(null);
		await settle();
		expect(fixture.bridge.saveTemplate).not.toHaveBeenCalled();
		symbol.dispatch('click');
		vi.mocked(fixture.bridge.saveTemplate).mockResolvedValueOnce('refused');
		asked[1]!.answer({ name: 'Refused', description: '' });
		await settle();
		expect(notices).toHaveBeenLastCalledWith('beatSheet.template.exportRefused(name=Refused)');
		symbol.dispatch('click');
		fixture.moveProject('Elsewhere');
		asked[2]!.answer({ name: 'Late', description: '' });
		await settle();
		expect(fixture.bridge.saveTemplate).toHaveBeenCalledTimes(1);
	});

	it('owns the template dialog as it owns its forms: closed as the workspace goes, and answered by nothing after', async () => {
		const asked = dialog();
		const fixture = laid();
		await settle();
		fixture.button('snowflake-method-beat-sheet-export').dispatch('click');
		const standing = { close: vi.fn(), onClose: (): void => undefined };
		expect(asked[0]!.keep?.(standing as unknown as Modal)).toBe(standing);
		fixture.handle.dispose();
		expect(standing.close).toHaveBeenCalledTimes(1);
		asked[0]!.answer({ name: 'Late', description: '' });
		await settle();
		expect(fixture.bridge.saveTemplate).not.toHaveBeenCalled();
	});

	/** The Add beat sheet form as the workspace opens it, with what stands beside its template field built on a line of the test's own. */
	const besideTheField = async (fixture: Fixture, opened: AddBeatSheetModal[]) => {
		fixture.button('snowflake-method-beat-sheet-add').dispatch('click');
		const options = (opened[opened.length - 1] as unknown as { options: { templateActions: (line: HTMLElement, form: AddBeatSheetFormHandle) => void } }).options;
		let choice: BeatSheetTemplateChoice = { kind: 'built-in', id: 'blank' };
		let closed = false;
		const listeners: (() => void)[] = [];
		const form = {
			choice: () => choice,
			closed: () => closed,
			choose: vi.fn((next: BeatSheetTemplateChoice) => { choice = next; for (const listener of listeners) listener(); }),
			onChoice: (listener: () => void) => { listeners.push(listener); },
		};
		const line = new CorkboardDom().container;
		options.templateActions(line as unknown as HTMLElement, form);
		return {
			form,
			button: line.querySelector('.snowflake-method-beat-sheet-template-delete')!,
			pick: (next: BeatSheetTemplateChoice) => { choice = next; for (const listener of listeners) listener(); },
			close: () => { closed = true; },
		};
	};

	it('wakes the way to delete a template only for a pick of the project\'s own', async () => {
		const opened = watch(AddBeatSheetModal);
		const fixture = laid({}, { templates: [template('tpl-1', 'My shape')] });
		await settle();
		const beside = await besideTheField(fixture, opened);
		expect(beside.button.getAttribute('aria-label')).toBe('beatSheet.template.delete');
		expect(beside.button.disabled).toBe(true);
		beside.pick({ kind: 'project', id: 'tpl-1' });
		expect(beside.button.disabled).toBe(false);
		beside.pick({ kind: 'built-in', id: 'save-the-cat' });
		expect(beside.button.disabled).toBe(true);
		// Pressed all the same, a preset goes nowhere.
		beside.button.dispatch('click');
		await settle();
		expect(confirmTimelineAction).not.toHaveBeenCalled();
		expect(fixture.bridge.deleteTemplate).not.toHaveBeenCalled();
	});

	it('deletes the template picked after asking, and leaves the form on the barest start', async () => {
		const opened = watch(AddBeatSheetModal);
		const fixture = laid({}, { templates: [template('tpl-1', 'My shape'), template('tpl-2', 'Another')] });
		await settle();
		const beside = await besideTheField(fixture, opened);
		beside.pick({ kind: 'project', id: 'tpl-1' });
		vi.mocked(confirmTimelineAction).mockResolvedValueOnce(false);
		beside.button.dispatch('click');
		await settle();
		expect(vi.mocked(confirmTimelineAction).mock.calls[0]![2]).toEqual({
			title: 'beatSheet.template.deleteTitle(name=My shape)',
			lines: ['beatSheet.template.deleteDescription'],
			label: 'actions.delete',
		});
		expect(fixture.bridge.deleteTemplate).not.toHaveBeenCalled();
		beside.button.dispatch('click');
		await settle();
		expect(fixture.bridge.deleteTemplate).toHaveBeenCalledExactlyOnceWith('tpl-1');
		expect(fixture.held().templates.map((entry) => entry.id)).toEqual(['tpl-2']);
		expect(beside.form.choose).toHaveBeenCalledExactlyOnceWith({ kind: 'built-in', id: 'blank' });
		expect(beside.button.disabled).toBe(true);
		// The shelf the form reads is the file's, so the template is off it at once.
		const shelf = (opened[0] as unknown as { options: { shelf: { project: () => readonly BeatSheetTemplate[] } } }).options.shelf;
		expect(shelf.project().map((entry) => entry.id)).toEqual(['tpl-2']);
	});

	it('says so when the template would not go, and leaves a form alone that closed or moved on meanwhile', async () => {
		const opened = watch(AddBeatSheetModal);
		const fixture = laid({}, { templates: [template('tpl-1', 'My shape'), template('tpl-2', 'Another')] });
		await settle();
		const beside = await besideTheField(fixture, opened);
		beside.pick({ kind: 'project', id: 'tpl-1' });
		vi.mocked(fixture.bridge.deleteTemplate).mockResolvedValueOnce(false);
		beside.button.dispatch('click');
		await settle();
		expect(notices).toHaveBeenLastCalledWith('beatSheet.template.deleteRefused');
		expect(beside.form.choose).not.toHaveBeenCalled();
		// The pick moves on while the question stands: the template goes, the form keeps its new pick.
		let confirm!: (answer: boolean) => void;
		vi.mocked(confirmTimelineAction).mockImplementationOnce(() => new Promise<boolean>((resolve) => { confirm = resolve; }));
		beside.button.dispatch('click');
		await settle();
		beside.pick({ kind: 'project', id: 'tpl-2' });
		confirm(true);
		await settle();
		expect(fixture.held().templates.map((entry) => entry.id)).toEqual(['tpl-2']);
		expect(beside.form.choose).not.toHaveBeenCalled();
		// A form that closed while the question stood is not told to pick anything.
		vi.mocked(confirmTimelineAction).mockImplementationOnce(() => new Promise<boolean>((resolve) => { confirm = resolve; }));
		beside.button.dispatch('click');
		await settle();
		beside.close();
		confirm(true);
		await settle();
		expect(fixture.held().templates).toEqual([]);
		expect(beside.form.choose).not.toHaveBeenCalled();
	});
});

describe('the beat sheet workspace owns its dialogs and the words in it', () => {
	it('closes every form still standing as it goes, each on its own, and writes the words at a foot all the same', async () => {
		const acts = watch(ActFormModal);
		const beats = watch(BeatFormModal);
		const fixture = laid();
		await settle();
		fixture.button('snowflake-method-beat-sheet-add-act').dispatch('click');
		fixture.act('a1').querySelector('.snowflake-method-beat-sheet-act-add')!.dispatch('click');
		const closedAct = vi.spyOn(acts[0]!, 'close').mockImplementation(() => { throw new Error('The dialog would not close'); });
		const closedBeat = vi.spyOn(beats[0]!, 'close');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const input = trailingInput(fixture.cell('b2'));
		input.value = 'Written on the way out';
		input.dispatch('input');
		fixture.handle.dispose();
		expect(closedAct).toHaveBeenCalledTimes(1);
		expect(closedBeat).toHaveBeenCalledTimes(1);
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledWith('s', 'b2', 'Written on the way out', null);
		expect(fixture.poolHandle.dispose).toHaveBeenCalledTimes(1);
		// A form that outlived the workspace writes nothing.
		await submit(acts[0], 'Late');
		await submit(beats[0], { name: 'Late', description: '' });
		await settle();
		expect(fixture.bridge.addAct).not.toHaveBeenCalled();
		expect(fixture.bridge.addBeat).not.toHaveBeenCalled();
	});

	it('lets a dismissed form lie, and disposes once', async () => {
		const opened = watch(ActFormModal);
		const fixture = laid();
		await settle();
		fixture.button('snowflake-method-beat-sheet-add-act').dispatch('click');
		const dismissed = opened[0]!;
		Object.assign(dismissed, { contentEl: { empty: vi.fn() } });
		const close = vi.spyOn(dismissed, 'close').mockImplementation(() => { dismissed.onClose(); });
		dismissed.close();
		fixture.handle.dispose();
		fixture.handle.dispose();
		expect(close).toHaveBeenCalledTimes(1);
		expect(fixture.poolHandle.dispose).toHaveBeenCalledTimes(1);
	});

	it('tells the pool, the cells and the cards that the plugin is unloading, so a refusal opens no dialog it cannot own', async () => {
		const fixture = laid({}, { sheets: [sheet('s', threeActs().acts, { presentation: 'flat' })] });
		await settle();
		const poolControls = fixture.corkboard.mock.calls[0]![1];
		expect(poolControls.unloading?.()).toBe(false);
		fixture.unload();
		expect(poolControls.unloading?.()).toBe(true);
		const words = watch(TimelineDraftModal);
		const drafts = watch(CorkboardDraftModal);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		// Words at a foot the project refuses, and a card's draft it refuses, as the plugin goes.
		const foot = trailingInput(fixture.cell('b2'));
		foot.value = 'Words kept at unload';
		foot.dispatch('input');
		vi.mocked(fixture.bridge.addRow).mockResolvedValueOnce(null);
		const conflict = fixture.cards()[0]!.querySelector('.snowflake-method-corkboard-conflict')!;
		conflict.focus();
		conflict.value = 'Unsaved draft';
		conflict.dispatch('input');
		vi.mocked(fixture.host.patchScene).mockRejectedValueOnce(new Error('Revision conflict'));
		fixture.handle.dispose();
		await settle();
		expect(words).toHaveLength(0);
		expect(drafts).toHaveLength(0);
		expect(logged).toHaveBeenCalledWith(
			'Snowflake: sub-description words could not be written',
			{ place: 'Sheet s · beatSheet.act.titleLabelled(number=1,label=Setup) · Catalyst', words: 'Words kept at unload' },
		);
		expect(logged).toHaveBeenCalledWith(
			'Snowflake: a scene card’s words could not be written',
			expect.objectContaining({ conflict: 'Unsaved draft' }),
		);
	});

	it('saves the conflict box holding the focus on a placed card, or asks the pool', async () => {
		const fixture = laid({}, { sheets: [sheet('s', threeActs().acts, { presentation: 'flat' })] });
		await settle();
		expect(fixture.handle.saveFocusedConflict()).toBe(false);
		expect(fixture.poolHandle.saveFocusedConflict).toHaveBeenCalledTimes(1);
		const conflict = fixture.cards()[0]!.querySelector('.snowflake-method-corkboard-conflict')!;
		conflict.focus();
		expect(fixture.handle.saveFocusedConflict()).toBe(true);
		expect(fixture.poolHandle.saveFocusedConflict).toHaveBeenCalledTimes(1);
	});
});
