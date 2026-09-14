import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom, CorkboardElement } from '../helpers/corkboard-dom';
import type { OptionFieldConfig } from '../../src/ui/option-picker';

const { menus, viewFields } = vi.hoisted(() => ({
	menus: [] as { title: string; disabled: boolean; click: () => void }[][],
	viewFields: [] as OptionFieldConfig[],
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
	};
});

// The view field is the real one; what the workspace hands it is kept, so a test can pick as the list would.
vi.mock('../../src/ui/option-picker', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/option-picker')>();
	return {
		...actual,
		buildOptionField: vi.fn((...args: Parameters<typeof actual.buildOptionField>) => {
			viewFields.push(args[2]);
			return actual.buildOptionField(...args);
		}),
	};
});

vi.mock('../../src/ui/modals', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/modals')>();
	return { ...actual, promptForEntityReference: vi.fn(() => Promise.resolve(null)) };
});

vi.mock('../../src/ui/timeline-forms', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/timeline-forms')>();
	return { ...actual, confirmTimelineAction: vi.fn(() => Promise.resolve(true)) };
});

import {
	addTimelineRow,
	addTimelineTime,
	bindTimeline,
	deleteTimelineRow,
	editTimelineRow,
	moveTimelineRow,
	createTimeline,
	moveTimelineInView,
	createTimelineView,
	deleteTimeline,
	deleteTimelineView,
	emptyTimelineDocument,
	pinTimeline,
	placeTimelineScene,
	removeTimelineScene,
	removeTimelineTime,
	renameTimeline,
	renameTimelineView,
	setLastTimelineView,
	setViewPresentation,
	setViewSubDescriptions,
	setViewTimeOrder,
	setViewTimelines,
	setViewTimesReversed,
	type Timeline,
	type TimelineDocument,
	type TimelineRow,
	type TimelineView,
} from '../../src/domain';
import { Menu } from 'obsidian';
import { MoveAfterModal, promptForEntityReference, type EntityReferenceSource } from '../../src/ui/modals';
import type { CorkboardControls, CorkboardVariant } from '../../src/ui/corkboard-bridge';
import { timelineMemory } from '../../src/ui/story-structure-state';
import { renderTimeline } from '../../src/ui/timeline';
import {
	TIMELINE_ROW_DRAG_TYPE,
	TIMELINE_SCENE_DRAG_TYPE,
	TIMELINE_TIME_DRAG_TYPE,
	type TimelineBridge,
	type TimelineControls,
} from '../../src/ui/timeline-bridge';
import { CorkboardDraftModal } from '../../src/ui/corkboard-draft-modal';
import { AddTimelineModal, TimelineDraftModal, TimelineTimePickModal, TimelineViewFormModal, confirmTimelineAction } from '../../src/ui/timeline-forms';
import type { ProjectDashboardModel, SceneViewModel, WorldbuildingEntityViewModel } from '../../src/ui/view-model';

const t = (key: string): string => key;

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

const timeline = (id: string, extra: Partial<Timeline> = {}): Timeline => ({
	id, name: `Timeline ${id}`, binding: null, times: [], createdAt: 1, updatedAt: 1, ...extra,
});
const view = (id: string, timelines: string[], extra: Partial<TimelineView> = {}): TimelineView => ({
	id, name: `View ${id}`, timelines, timeOrder: [], presentation: null, cardStyle: null, showSubDescriptions: true, timesReversed: false, createdAt: 1, updatedAt: 1, ...extra,
});

const submit = (form: unknown, value: unknown): Promise<void> =>
	(form as { submitHandler(value: unknown): Promise<void> }).submitHandler(value);
const row = (id: string, text: string, scenes: string[] = []): TimelineRow => ({ id, text, scenes });
const time = (id: string, name: string, description = ''): WorldbuildingEntityViewModel => ({
	id, path: `World/${name}.md`, name, kind: 'time', rank: 0, progressStatus: null, aliases: [], categoryPaths: [],
	description, timeKind: 'point', timeStart: '', timeEnd: '', timeStartMissing: false, timeEndMissing: false,
	worldStatus: [], relationships: [], customFields: '', revision: 'r', readOnly: false, healthIssues: [],
});
const scene = (id: string, title: string): SceneViewModel => ({
	id, path: `Scenes/${title}.md`, title, rank: 0, progressStatus: 'in-progress', aliases: [], categoryPaths: [],
	povPath: '', povName: '', povMissing: false, times: [], locations: [], characterPaths: [], conflict: '', color: null,
	linkedManuscript: [], worldStatus: [], relationships: [], events: '', customFields: '', revision: 'r', readOnly: false, healthIssues: [],
});

function workspace(initial: Partial<TimelineDocument> = {}, readOnly = false) {
	const dom = new CorkboardDom();
	let held: TimelineDocument = { ...emptyTimelineDocument(), ...initial };
	const listeners = new Set<() => void>();
	let serial = 0;
	const apply = (next: TimelineDocument | null): 'written' => {
		if (next !== null) held = next;
		return 'written';
	};
	const bridge = {
		t,
		read: vi.fn(async () => ({ projectPath: 'P', locale: 'en' as const, held })),
		subscribe: vi.fn((listener: () => void) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		}),
		createTimeline: vi.fn(async (name: string, binding: Timeline['binding']) => {
			const id = `timeline-${String(++serial)}`;
			apply(createTimeline(held, timeline(id, { name, binding })));
			return id;
		}),
		renameTimeline: vi.fn(async (id: string, name: string) => apply(renameTimeline(held, id, name, 2))),
		bindTimeline: vi.fn(async (id: string, binding: Timeline['binding']) => apply(bindTimeline(held, id, binding, 2))),
		deleteTimeline: vi.fn(async (id: string) => { apply(deleteTimeline(held, id)); return true; }),
		pinTimeline: vi.fn(async (id: string | null) => apply(pinTimeline(held, id))),
		createView: vi.fn(async (name: string, timelines: readonly string[]) => {
			const id = `timeline-view-${String(++serial)}`;
			apply(createTimelineView(held, view(id, [...timelines], { name })));
			return id;
		}),
		renameView: vi.fn(async (id: string, name: string) => apply(renameTimelineView(held, id, name, 2))),
		deleteView: vi.fn(async (id: string) => { apply(deleteTimelineView(held, id)); return true; }),
		setLastView: vi.fn(async (id: string | null) => apply(setLastTimelineView(held, id))),
		setViewTimelines: vi.fn(async (id: string, timelines: readonly string[]) => apply(setViewTimelines(held, id, timelines, 2))),
		moveTimelineInView: vi.fn(async (id: string, timelineId: string, beforeId: string | null) =>
			apply(moveTimelineInView(held, id, timelineId, beforeId, 2))),
		setTimeOrder: vi.fn(async (id: string, timeIds: readonly string[]) => apply(setViewTimeOrder(held, id, timeIds, 2))),
		setViewPresentation: vi.fn(async (id: string, presentation: 'flat' | 'stack' | null) => apply(setViewPresentation(held, id, presentation, 2))),
		setViewSubDescriptions: vi.fn(async (id: string, shown: boolean) => apply(setViewSubDescriptions(held, id, shown, 2))),
		setViewTimesReversed: vi.fn(async (id: string, reversed: boolean) => apply(setViewTimesReversed(held, id, reversed, 2))),
		addTime: vi.fn(async (timelineId: string, timeId: string) => apply(addTimelineTime(held, timelineId, timeId, 2))),
		removeTime: vi.fn(async (timelineId: string, timeId: string) => apply(removeTimelineTime(held, timelineId, timeId, 2))),
		addRow: vi.fn(async (timelineId: string, timeId: string, text: string, beforeRowId: string | null, scenes: string[] = []) => {
			const id = `timeline-row-${String(++serial)}`;
			apply(addTimelineRow(held, timelineId, timeId, { id, text, scenes }, beforeRowId, 2));
			return id;
		}),
		removeScene: vi.fn(async (timelineId: string, sceneId: string) => apply(removeTimelineScene(held, timelineId, sceneId, 2))),
		editRow: vi.fn(async (timelineId: string, rowId: string, text: string) => {
			// As the service answers: a row that has gone is absent, not a write of nothing.
			const lane = held.timelines.find((candidate) => candidate.id === timelineId);
			if (lane === undefined || !lane.times.some((time) => time.rows.some((entry) => entry.id === rowId))) return 'absent';
			return apply(editTimelineRow(held, timelineId, rowId, text, 2));
		}),
		moveRow: vi.fn(async (timelineId: string, rowId: string, toTimeId: string, beforeRowId: string | null) =>
			apply(moveTimelineRow(held, timelineId, rowId, toTimeId, beforeRowId, 2))),
		deleteRow: vi.fn(async (timelineId: string, rowId: string) => apply(deleteTimelineRow(held, timelineId, rowId, 2))),
		placeScene: vi.fn(async (timelineId: string, sceneId: string, rowId: string, beforeSceneId: string | null) =>
			apply(placeTimelineScene(held, timelineId, sceneId, rowId, beforeSceneId, 2))),
	} as unknown as TimelineBridge;
	const times = [time('time-1', 'Dawn', 'First light'), time('time-2', 'Dusk')];
	let model = {
		path: 'P', projectId: 'p', locale: 'en', readOnly,
		scenes: [scene('scene-1', 'Arrival'), scene('scene-2', 'Departure'), scene('scene-3', 'Return')],
		manuscriptPaths: [],
		characters: [{ id: 'character-alice', name: 'Alice', path: 'Cast/Alice.md', readOnly: false, healthIssues: [] }],
		worldbuildingKinds: [{ id: 'time' }, { id: 'location' }],
		worldbuilding: { time: times, location: [{ id: 'entity-london', name: 'London', path: 'World/London.md' }] },
	} as unknown as ProjectDashboardModel;
	const memory = timelineMemory();
	const host = {
		openManagedFile: vi.fn(() => Promise.resolve()),
		openCharacterForm: vi.fn(() => Promise.resolve()),
		openEntityForm: vi.fn(() => Promise.resolve('time-8')),
		openSceneForm: vi.fn(() => Promise.resolve(null)),
		deleteScene: vi.fn(() => Promise.resolve()),
		patchScene: vi.fn(() => Promise.resolve('r2')),
		opensFormWhenCreatingFromField: vi.fn(() => false),
		createEntity: vi.fn(async (request: { name: string }) => {
			times.push(time('time-9', request.name));
			return { id: 'time-9', path: `World/${request.name}.md` };
		}),
	};
	let handle: ReturnType<typeof renderTimeline>;
	const refresh = vi.fn(async () => { handle.refresh(); });
	const poolHandle = { refresh: vi.fn(), reveal: vi.fn(), remeasure: vi.fn(), saveFocusedConflict: vi.fn(() => false), dispose: vi.fn() };
	const corkboard = vi.fn((_host: HTMLElement, _controls: CorkboardControls, _variant?: CorkboardVariant) => poolHandle);
	const remember = vi.fn();
	const translate = vi.fn((key: string, _vars?: Record<string, string | number>): string => key);
	const controls = {
		app: {}, host, t: translate,
		model: () => model,
		projectPath: () => 'P',
		activateProject: vi.fn(),
		refresh,
		popover: { closeFilter: vi.fn(), filterOpen: () => false, openFilter: vi.fn() },
		bridge: () => bridge,
		memory,
		remember,
		corkboard,
	} as unknown as TimelineControls;
	handle = renderTimeline(dom.container as unknown as HTMLElement, controls);
	const root = dom.container.querySelector('.snowflake-method-timeline')!;
	return {
		dom, root, handle, bridge, memory, host, controls, refresh, corkboard, poolHandle, remember, translate,
		get model(): { readOnly: boolean } { return model; },
		/** Another model object, as a project refresh hands the workspace one. */
		remodel: (change: Partial<ProjectDashboardModel>) => { model = { ...model, ...change }; },
		held: () => held,
		notify: () => { for (const listener of listeners) listener(); },
		listeners,
		select: (): CorkboardElement =>
			root.querySelector('.snowflake-method-timeline-view-select')!.querySelector('.snowflake-method-option-picker-input')!,
		viewField: (): OptionFieldConfig => viewFields[viewFields.length - 1]!,
		heads: (): CorkboardElement[] => root.querySelectorAll('.snowflake-method-timeline-lane-head'),
		rows: (): CorkboardElement[] => root.querySelectorAll('.snowflake-method-timeline-row'),
		rowOf: (timeId: string): CorkboardElement =>
			root.querySelectorAll('.snowflake-method-timeline-row').find((candidate) => candidate.getAttribute('data-time-id') === timeId)!,
		cell: (timeId: string, timelineId: string): CorkboardElement =>
			root.querySelectorAll('.snowflake-method-timeline-cell').find((candidate) =>
				candidate.getAttribute('data-time-id') === timeId && candidate.getAttribute('data-timeline-id') === timelineId)!,
		cards: (): CorkboardElement[] => root.querySelectorAll('.snowflake-method-corkboard-card'),
		head: (id: string): CorkboardElement =>
			root.querySelectorAll('.snowflake-method-timeline-lane-head').find((head) => head.getAttribute('data-timeline-id') === id)!,
		emptyLine: (): CorkboardElement => root.querySelector('.snowflake-method-character-empty')!,
		body: (): CorkboardElement => root.querySelector('.snowflake-method-timeline-body')!,
		button: (cls: string): CorkboardElement => root.querySelector(`.${cls}`)!,
	};
}

describe('the timeline workspace', () => {
	it('reads the document, offers every view and lays the lanes of the one opened last', async () => {
		const fixture = workspace({
			timelines: [timeline('a'), timeline('b')],
			views: [view('v1', ['a']), view('v2', ['a', 'b'])],
			lastViewId: 'v2',
		});
		expect(fixture.emptyLine().classes.has('is-hidden')).toBe(false);
		expect(fixture.root.classes.has('is-empty')).toBe(true);
		await settle();
		expect(fixture.root.classes.has('is-empty')).toBe(false);
		expect(fixture.viewField().options().map((option) => option.value)).toEqual(['v1', 'v2']);
		expect(fixture.viewField().value()).toBe('v2');
		expect(fixture.select().value).toBe('View v2');
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['a', 'b']);
		expect(fixture.root.dataset.layout).toBe('multi');
		expect(fixture.root.dataset.presentation).toBe('stack');
		expect(fixture.root.dataset.mode).toBe('compact');
		expect(fixture.body().classes.has('is-hidden')).toBe(false);
		expect(fixture.emptyLine().classes.has('is-hidden')).toBe(true);
	});

	it('lays the toolbar out as the view, then at the end: edit, the words, the presentation, the order, refresh, add timeline, add view', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		const order = [
			'snowflake-method-timeline-view-select', 'snowflake-method-prose-state', 'snowflake-method-timeline-view-edit',
			'snowflake-method-timeline-words', 'snowflake-method-timeline-presentation', 'snowflake-method-timeline-order',
			'snowflake-method-timeline-refresh', 'snowflake-method-timeline-add-timeline', 'snowflake-method-timeline-view-add',
		];
		const toolbar = fixture.root.querySelector('.snowflake-method-timeline-toolbar')!;
		expect(toolbar.children.map((child, index) => child.classes.has(order[index]!))).toEqual(order.map(() => true));
		expect(toolbar.children).toHaveLength(order.length);
		const addView = fixture.button('snowflake-method-timeline-view-add');
		expect(addView.classes.has('mod-cta')).toBe(true);
		expect(addView.textContent).toBe('timeline.view.add');
	});

	it('puts the pinned lane first and makes it active, until a click chooses another', async () => {
		const fixture = workspace({
			timelines: [timeline('a'), timeline('b')],
			views: [view('v', ['a', 'b'])],
			pinnedTimelineId: 'b',
		});
		await settle();
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['b', 'a']);
		expect(fixture.head('b').classes.has('is-active')).toBe(true);
		expect(fixture.head('b').classes.has('is-pinned')).toBe(true);
		expect(fixture.head('b').querySelector('.snowflake-method-timeline-lane-name')!.getAttribute('aria-pressed')).toBe('true');
		// A click anywhere on the head is the lane's name: this one lands beside it.
		fixture.head('a').dispatch('click');
		expect(fixture.head('a').classes.has('is-active')).toBe(true);
		expect(fixture.head('b').classes.has('is-active')).toBe(false);
		expect(fixture.memory.activeTimeline.get('v')).toBe('a');
	});

	it('switches views from the select, remembering the one opened', async () => {
		const fixture = workspace({
			timelines: [timeline('a'), timeline('b')],
			views: [view('v1', ['a']), view('v2', ['a', 'b'])],
			lastViewId: 'v2',
		});
		await settle();
		fixture.viewField().choose('v1');
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['a']);
		expect(fixture.root.dataset.layout).toBe('single');
		expect(fixture.root.dataset.presentation).toBe('flat');
		expect(fixture.root.dataset.mode).toBe('compact');
		await settle();
		expect(fixture.bridge.setLastView).toHaveBeenCalledWith('v1');
		expect(fixture.held().lastViewId).toBe('v1');
	});

	it('says what is missing while there is nothing yet, and leaves the ways in to the toolbar', async () => {
		const none = workspace();
		await settle();
		expect(none.emptyLine().classes.has('is-hidden')).toBe(false);
		expect(none.emptyLine().querySelectorAll('span').map((span) => span.textContent)).toContain('timeline.empty.views');
		expect(none.emptyLine().querySelector('button')).toBeNull();
		expect(none.body().classes.has('is-hidden')).toBe(true);
		expect(none.select().disabled).toBe(true);
		const bare = workspace({ timelines: [timeline('a')], views: [view('v', [])] });
		await settle();
		expect(bare.emptyLine().querySelectorAll('span').map((span) => span.textContent)).toContain('timeline.empty.timelines');
		expect(bare.emptyLine().querySelector('button')).toBeNull();
		// Lanes without a time say so under the head in the same voice; the corner's plus is the way in.
		const timeless = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		const line = timeless.root.querySelector('.snowflake-method-timeline-times-empty')!;
		expect(line.classes.has('is-hidden')).toBe(false);
		expect(line.querySelectorAll('span').map((span) => span.textContent)).toContain('timeline.empty.times');
		expect(timeless.button('snowflake-method-timeline-time-add').disabled).toBe(false);
	});

	it('reads again when the bridge rings, and no more once disposed', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		expect(fixture.bridge.read).toHaveBeenCalledTimes(1);
		expect(fixture.listeners.size).toBe(1);
		fixture.notify();
		await settle();
		expect(fixture.bridge.read).toHaveBeenCalledTimes(2);
		fixture.handle.dispose();
		expect(fixture.listeners.size).toBe(0);
		expect(fixture.dom.container.querySelector('.snowflake-method-timeline')).toBeNull();
	});

	it('wears the bound entity on the lane, opening its note, and marks one the project lost', async () => {
		const fixture = workspace({
			timelines: [
				timeline('a', { binding: { kind: 'character', id: 'character-alice', name: 'Old name' } }),
				timeline('b', { binding: { kind: 'location', id: 'entity-gone', name: 'Atlantis' } }),
			],
			views: [view('v', ['a', 'b'])],
		});
		await settle();
		const alice = fixture.head('a').querySelector('.snowflake-method-timeline-lane-entity')!;
		expect(alice.classes.has('is-hidden')).toBe(false);
		expect(alice.textContent).toBe('Alice');
		alice.dispatch('click');
		expect(fixture.host.openCharacterForm).toHaveBeenCalledWith('character-alice', 'P');
		const gone = fixture.head('b').querySelector('.snowflake-method-timeline-lane-entity')!;
		expect(gone.textContent).toBe('Atlantis');
		expect(gone.classes.has('is-missing')).toBe(true);
		gone.dispatch('click');
		expect(fixture.host.openCharacterForm).toHaveBeenCalledTimes(1);
		expect(fixture.host.openEntityForm).not.toHaveBeenCalled();
	});

	it("offers the lane's menu: pin, remove from the view, delete", async () => {
		const fixture = workspace({ timelines: [timeline('a'), timeline('b')], views: [view('v', ['a', 'b'])] });
		await settle();
		menus.length = 0;
		fixture.head('a').querySelector('.snowflake-method-timeline-lane-more')!.dispatch('click');
		const menu = menus[0]!;
		expect(menu.map((item) => item.title)).toEqual([
			'timeline.timeline.rename',
			'timeline.timeline.bind',
			'timeline.timeline.pin',
			'timeline.timeline.moveLeft',
			'timeline.timeline.moveRight',
			'timeline.timeline.insertAfter',
			'timeline.timeline.addTime',
			'timeline.timeline.removeFromView',
			'timeline.timeline.delete',
		]);
		// First, there is no left to move to.
		expect(menu.filter((item) => item.disabled).map((item) => item.title)).toEqual(['timeline.timeline.moveLeft']);
		menu[4]!.click();
		await settle();
		expect(fixture.bridge.moveTimelineInView).toHaveBeenCalledWith('v', 'a', null);
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['b', 'a']);
		menus.length = 0;
		fixture.head('a').querySelector('.snowflake-method-timeline-lane-more')!.dispatch('click');
		expect(menus[0]!.filter((item) => item.disabled).map((item) => item.title)).toEqual(['timeline.timeline.moveRight']);
		menus[0]![3]!.click();
		await settle();
		expect(fixture.bridge.moveTimelineInView).toHaveBeenLastCalledWith('v', 'a', 'b');
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['a', 'b']);
		menu[2]!.click();
		await settle();
		expect(fixture.bridge.pinTimeline).toHaveBeenCalledWith('a');
		expect(fixture.head('a').classes.has('is-pinned')).toBe(true);
		menus.length = 0;
		fixture.head('b').querySelector('.snowflake-method-timeline-lane-more')!.dispatch('click');
		expect(menus[0]![2]!.title).toBe('timeline.timeline.pin');
		menus[0]![7]!.click();
		await settle();
		expect(fixture.bridge.setViewTimelines).toHaveBeenCalledWith('v', ['a']);
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['a']);
		menus.length = 0;
		fixture.head('a').querySelector('.snowflake-method-timeline-lane-more')!.dispatch('click');
		menus[0]![8]!.click();
		await settle();
		expect(fixture.bridge.deleteTimeline).toHaveBeenCalledWith('a');
		expect(fixture.held().timelines).toEqual([expect.objectContaining({ id: 'b' })]);
	});

	it('adds a view through its form and opens it', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		const opened: TimelineViewFormModal[] = [];
		vi.spyOn(TimelineViewFormModal.prototype, 'open').mockImplementation(function (this: TimelineViewFormModal) { opened.push(this); });
		fixture.button('snowflake-method-timeline-view-add').dispatch('click');
		expect(opened).toHaveLength(1);
		await submit(opened[0], { name: 'Everything', timelines: ['a'] });
		expect(fixture.bridge.createView).toHaveBeenCalledWith('Everything', ['a']);
		expect(fixture.bridge.setLastView).toHaveBeenCalledWith('timeline-view-1');
		expect(fixture.viewField().value()).toBe('timeline-view-1');
		expect(fixture.viewField().options()).toHaveLength(2);
		vi.restoreAllMocks();
	});

	it('keeps the sub-descriptions away when the view says so, and switches them from the toolbar', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r-1', 'one')] }] })],
			views: [view('v', ['a'], { showSubDescriptions: false })],
		});
		await settle();
		const eye = fixture.button('snowflake-method-timeline-words');
		expect(fixture.root.classes.has('is-words-hidden')).toBe(true);
		expect(eye.getAttribute('aria-pressed')).toBe('false');
		expect(eye.getAttribute('aria-label')).toBe('timeline.view.subDescriptions');
		eye.dispatch('click');
		await settle();
		expect(fixture.bridge.setViewSubDescriptions).toHaveBeenCalledWith('v', true);
		expect(fixture.root.classes.has('is-words-hidden')).toBe(false);
		expect(eye.getAttribute('aria-pressed')).toBe('true');
		expect(eye.getAttribute('aria-label')).toBe('timeline.view.subDescriptionsHide');
		eye.dispatch('click');
		await settle();
		expect(fixture.bridge.setViewSubDescriptions).toHaveBeenLastCalledWith('v', false);
		expect(fixture.root.classes.has('is-words-hidden')).toBe(true);
		vi.restoreAllMocks();
	});

	it('answers each press of a symbol with the one before it, however fast the presses come', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r-1', 'one')] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		// Two presses in a breath: the second takes what the first wrote, not what
		// stood when it was pressed, so the pair answer each other and the view is
		// left where it started.
		const eye = fixture.button('snowflake-method-timeline-words');
		eye.dispatch('click');
		eye.dispatch('click');
		await settle();
		expect(fixture.bridge.setViewSubDescriptions).toHaveBeenNthCalledWith(1, 'v', false);
		expect(fixture.bridge.setViewSubDescriptions).toHaveBeenNthCalledWith(2, 'v', true);
		expect(fixture.held().views[0]!.showSubDescriptions).toBe(true);
		expect(fixture.root.classes.has('is-words-hidden')).toBe(false);
		const order = fixture.button('snowflake-method-timeline-order');
		order.dispatch('click');
		order.dispatch('click');
		await settle();
		expect(fixture.bridge.setViewTimesReversed).toHaveBeenNthCalledWith(1, 'v', true);
		expect(fixture.bridge.setViewTimesReversed).toHaveBeenNthCalledWith(2, 'v', false);
		expect(fixture.held().views[0]!.timesReversed).toBe(false);
		expect(order.getAttribute('aria-pressed')).toBe('false');
		const shape = fixture.button('snowflake-method-timeline-presentation');
		shape.dispatch('click');
		shape.dispatch('click');
		await settle();
		expect(fixture.bridge.setViewPresentation).toHaveBeenNthCalledWith(1, 'v', 'stack');
		expect(fixture.bridge.setViewPresentation).toHaveBeenNthCalledWith(2, 'v', 'flat');
		expect(fixture.root.dataset.presentation).toBe('flat');
	});

	it('sends a press waiting its turn to the view it was made on', async () => {
		const fixture = workspace({
			timelines: [timeline('a')],
			views: [view('v1', ['a']), view('v2', ['a'])],
			lastViewId: 'v1',
		});
		await settle();
		// The first press holds the queue, so the second waits behind it.
		let release: () => void = () => undefined;
		const waiting = new Promise<void>((resolve) => { release = resolve; });
		const write = vi.mocked(fixture.bridge.setViewSubDescriptions);
		const real = write.getMockImplementation()!;
		write.mockImplementationOnce(async (...args) => {
			await waiting;
			return real(...args);
		});
		fixture.button('snowflake-method-timeline-words').dispatch('click');
		await settle();
		fixture.button('snowflake-method-timeline-order').dispatch('click');
		// Another view is opened while that press is still waiting. The press
		// was made on the first, and the first is what it must answer for.
		fixture.viewField().choose('v2');
		await settle();
		release();
		await settle();
		expect(fixture.bridge.setViewTimesReversed).toHaveBeenCalledWith('v1', true);
		expect(fixture.bridge.setViewTimesReversed).not.toHaveBeenCalledWith('v2', true);
		expect(fixture.held().views[0]!.timesReversed).toBe(true);
		expect(fixture.held().views[1]!.timesReversed).toBe(false);
	});

	it('lays the workspace out again after a paint that threw with nothing moved since', async () => {
		const fixture = workspace({ timelines: [timeline('a'), timeline('b')], views: [view('v', ['a', 'b'])] });
		await settle();
		const painted = (): number => fixture.poolHandle.refresh.mock.calls.length;
		fixture.poolHandle.refresh.mockImplementationOnce(() => { throw new Error('The pool could not be painted'); });
		// Choosing a lane asks for a paint of the workspace's own: the document
		// and the model stand where they stood, so the pair the paint was made
		// from says nothing about how far it got.
		expect(() => { fixture.head('b').dispatch('click'); }).toThrow();
		expect(fixture.head('b').classes.has('is-active')).toBe(true);
		const after = painted();
		fixture.notify();
		await settle();
		expect(painted()).toBe(after + 1);
	});

	it('lays the workspace out again after a paint that threw partway', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		const painted = (): number => fixture.poolHandle.refresh.mock.calls.length;
		// A change the workspace made, whose paint throws once it is under way.
		fixture.poolHandle.refresh.mockImplementationOnce(() => { throw new Error('The pool could not be painted'); });
		fixture.button('snowflake-method-timeline-words').dispatch('click');
		await settle();
		const after = painted();
		// The document has not moved since, but what stands on screen was never
		// finished, so the bell must lay it out again rather than count it made.
		fixture.notify();
		await settle();
		expect(painted()).toBe(after + 1);
	});

	it('paints nothing when a read brings back the document already on screen', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		const painted = (): number => fixture.poolHandle.refresh.mock.calls.length;
		const before = painted();
		// The plugin rings its bell a moment after every write the workspace
		// makes itself, and the read that follows brings back what is shown.
		fixture.notify();
		await settle();
		expect(painted()).toBe(before);
		// A document that has moved is painted as ever.
		await fixture.bridge.renameTimeline('a', 'Renamed');
		fixture.notify();
		await settle();
		expect(painted()).toBe(before + 1);
		expect(fixture.heads()[0]!.querySelector('.snowflake-method-timeline-lane-name')!.textContent).toBe('Renamed');
	});

	it('paints once when the view is switched, since only the view opened last is written', async () => {
		const fixture = workspace({
			timelines: [timeline('a'), timeline('b')],
			views: [view('v1', ['a']), view('v2', ['b'])],
			lastViewId: 'v1',
		});
		await settle();
		const before = fixture.poolHandle.refresh.mock.calls.length;
		fixture.viewField().choose('v2');
		await settle();
		expect(fixture.bridge.setLastView).toHaveBeenCalledWith('v2');
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['b']);
		expect(fixture.poolHandle.refresh.mock.calls.length).toBe(before + 1);
	});

	it('reads the document again when the model lands on a project it could not read', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		expect(fixture.root.classes.has('is-empty')).toBe(false);
		// A rename takes the project out from under the read: nothing stands.
		vi.mocked(fixture.bridge.read).mockResolvedValueOnce(null);
		fixture.notify();
		await settle();
		expect(fixture.root.classes.has('is-empty')).toBe(true);
		expect(fixture.bridge.read).toHaveBeenCalledTimes(2);
		// The model landing is the word that the project may be there again, so
		// the refresh asks for the document rather than painting what it has.
		fixture.handle.refresh();
		await settle();
		expect(fixture.bridge.read).toHaveBeenCalledTimes(3);
		expect(fixture.root.classes.has('is-empty')).toBe(false);
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['a']);
	});

	it('keeps the view form open when the view could not be deleted, and answers true once it goes', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		const opened: TimelineViewFormModal[] = [];
		vi.spyOn(TimelineViewFormModal.prototype, 'open').mockImplementation(function (this: TimelineViewFormModal) { opened.push(this); });
		fixture.button('snowflake-method-timeline-view-edit').dispatch('click');
		expect(opened).toHaveLength(1);
		const form = opened[0] as unknown as { options: { deleteView?: () => Promise<boolean> } };
		// Refused, the answer is the file's and not the asking, so the form stays
		// open on the view that is still there.
		vi.mocked(fixture.bridge.deleteView).mockResolvedValueOnce(false);
		await expect(form.options.deleteView!()).resolves.toBe(false);
		expect(fixture.held().views.map((candidate) => candidate.id)).toEqual(['v']);
		await expect(form.options.deleteView!()).resolves.toBe(true);
		expect(fixture.held().views).toHaveLength(0);
		// The confirmation is a module mock, and the tests that follow count its
		// calls: this one leaves the count where it found it.
		vi.mocked(confirmTimelineAction).mockClear();
		vi.restoreAllMocks();
	});

	it('goes on naming the view\'s lanes while the document cannot be read, so a save does not empty it', async () => {
		const fixture = workspace({ timelines: [timeline('a'), timeline('b')], views: [view('v', ['a', 'b'])] });
		await settle();
		const opened: TimelineViewFormModal[] = [];
		vi.spyOn(TimelineViewFormModal.prototype, 'open').mockImplementation(function (this: TimelineViewFormModal) { opened.push(this); });
		fixture.button('snowflake-method-timeline-view-edit').dispatch('click');
		const form = opened[0] as unknown as { options: { timelines: () => readonly Timeline[] } };
		expect(form.options.timelines().map((lane) => lane.id)).toEqual(['a', 'b']);
		// A read that found nothing is not a project without lanes. Answered so,
		// the form drops every line it shows and its save writes the view empty.
		vi.mocked(fixture.bridge.read).mockResolvedValueOnce(null);
		fixture.notify();
		await settle();
		expect(form.options.timelines().map((lane) => lane.id)).toEqual(['a', 'b']);
		vi.restoreAllMocks();
	});

	it('names a lane made while the form stood open, once a read has failed too', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		const opened: TimelineViewFormModal[] = [];
		vi.spyOn(TimelineViewFormModal.prototype, 'open').mockImplementation(function (this: TimelineViewFormModal) { opened.push(this); });
		fixture.button('snowflake-method-timeline-view-edit').dispatch('click');
		const form = opened[0] as unknown as { options: { timelines: () => readonly Timeline[] } };
		// A lane made while the form stands open is one of the project's, and
		// the form opened before it, so what it opened on is no longer the whole
		// story: the last read that came back is.
		await fixture.bridge.createTimeline('Second', null);
		fixture.notify();
		await settle();
		vi.mocked(fixture.bridge.read).mockResolvedValueOnce(null);
		fixture.notify();
		await settle();
		expect(form.options.timelines().map((lane) => lane.id)).toEqual(['a', 'timeline-1']);
		vi.restoreAllMocks();
	});

	it('goes on naming the lanes for a new view while the document cannot be read', async () => {
		const fixture = workspace({ timelines: [timeline('a'), timeline('b')], views: [view('v', ['a'])] });
		await settle();
		const opened: TimelineViewFormModal[] = [];
		vi.spyOn(TimelineViewFormModal.prototype, 'open').mockImplementation(function (this: TimelineViewFormModal) { opened.push(this); });
		fixture.button('snowflake-method-timeline-view-add').dispatch('click');
		const form = opened[0] as unknown as { options: { timelines: () => readonly Timeline[] } };
		// Answered with none, the form would show none to choose from and save
		// the new view holding none of the project's lanes.
		vi.mocked(fixture.bridge.read).mockResolvedValueOnce(null);
		fixture.notify();
		await settle();
		expect(form.options.timelines().map((lane) => lane.id)).toEqual(['a', 'b']);
		vi.restoreAllMocks();
	});

	it('hands the view form a timeline made inside it only once the document holds it, with the bell already ringing', async () => {
		const fixture = workspace({ timelines: [], views: [] });
		await settle();
		// The plugin rings the bell as the write lands, and that read is still on
		// its way when the queue asks for its own: the form must wait for it.
		let release: () => void = () => undefined;
		vi.mocked(fixture.bridge.read).mockImplementationOnce(() => new Promise((resolve) => {
			release = () => { resolve({ projectPath: 'P', locale: 'en', held: fixture.held() }); };
		}));
		const made = vi.mocked(fixture.bridge.createTimeline).getMockImplementation()!;
		vi.mocked(fixture.bridge.createTimeline).mockImplementation(async (name, binding) => {
			const id = await made(name, binding);
			fixture.notify();
			return id;
		});
		const views: TimelineViewFormModal[] = [];
		const timelines: AddTimelineModal[] = [];
		vi.spyOn(TimelineViewFormModal.prototype, 'open').mockImplementation(function (this: TimelineViewFormModal) { views.push(this); });
		vi.spyOn(AddTimelineModal.prototype, 'open').mockImplementation(function (this: AddTimelineModal) { timelines.push(this); });
		fixture.button('snowflake-method-timeline-view-add').dispatch('click');
		const form = views[0] as unknown as { options: { addTimeline: () => Promise<string | null>; timelines: () => readonly Timeline[] } };
		const pending = form.options.addTimeline();
		// What the view form sees at the moment the id is handed back.
		const seen = pending.then(() => form.options.timelines().map((candidate) => candidate.id));
		await settle();
		expect(timelines).toHaveLength(1);
		const submitting = submit(timelines[0], { name: 'Alice', binding: null, addToView: false });
		// The real form closes after its handler; the stub's close() runs no lifecycle.
		void submitting.then(() => {
			(timelines[0] as unknown as { contentEl: { empty: () => void } }).contentEl = { empty: () => undefined };
			timelines[0]!.onClose();
		});
		await settle();
		release();
		await submitting;
		await expect(pending).resolves.toBe('timeline-1');
		await expect(seen).resolves.toEqual(['timeline-1']);
		vi.restoreAllMocks();
	});

	it('adds a timeline through its form, joining the open view', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		const opened: AddTimelineModal[] = [];
		vi.spyOn(AddTimelineModal.prototype, 'open').mockImplementation(function (this: AddTimelineModal) { opened.push(this); });
		fixture.button('snowflake-method-timeline-add-timeline').dispatch('click');
		expect(opened).toHaveLength(1);
		await submit(opened[0], { name: 'Bob', binding: null, addToView: true });
		expect(fixture.bridge.createTimeline).toHaveBeenCalledWith('Bob', null);
		expect(fixture.bridge.setViewTimelines).toHaveBeenCalledWith('v', ['a', 'timeline-1']);
		expect(fixture.heads().map((head) => head.querySelector('.snowflake-method-timeline-lane-name')!.textContent)).toEqual(['Timeline a', 'Bob']);
		expect(fixture.root.dataset.layout).toBe('multi');
		vi.restoreAllMocks();
	});

	it('keeps every change off a project that cannot be written', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] }, true);
		await settle();
		expect(fixture.root.classes.has('is-read-only')).toBe(true);
		expect(fixture.button('snowflake-method-timeline-add-timeline').disabled).toBe(true);
		expect(fixture.button('snowflake-method-timeline-view-add').disabled).toBe(true);
		expect(fixture.button('snowflake-method-timeline-view-edit').disabled).toBe(true);
		menus.length = 0;
		fixture.head('a').querySelector('.snowflake-method-timeline-lane-more')!.dispatch('click');
		expect(menus[0]!.every((item) => item.disabled)).toBe(true);
	});

	it('closes the way out of a missing scene on a project that cannot be written', async () => {
		const held = {
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-gone'])] }] })],
			views: [view('v', ['a'])],
		};
		const removeIn = (fixture: ReturnType<typeof workspace>): CorkboardElement =>
			fixture.cell('time-1', 'a')
				.querySelector('.snowflake-method-timeline-scene-missing')!
				.querySelector('.snowflake-method-timeline-scene-missing-remove')!;
		const open = workspace(held);
		await settle();
		expect(removeIn(open).disabled).toBe(false);
		const shut = workspace(held, true);
		await settle();
		expect(removeIn(shut).disabled).toBe(true);
	});
});

describe('the times and the lanes', () => {
	const laid = () => workspace({
		timelines: [
			timeline('a', { times: [{ timeId: 'time-2', rows: [row('r1', 'Arrives', ['scene-1', 'scene-gone']), row('r2', '')] }] }),
			timeline('b', { times: [{ timeId: 'time-1', rows: [] }, { timeId: 'time-lost', rows: [row('r3', 'Waits')] }] }),
		],
		views: [view('v', ['a', 'b'], { timeOrder: ['time-2'], presentation: 'flat' })],
	});

	it('invites the first sub-description at an empty foot, and more of them under rows', async () => {
		const fixture = laid();
		await settle();
		const foot = (timeId: string, timelineId: string): string | null =>
			fixture.cell(timeId, timelineId).querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!.getAttribute('placeholder');
		expect(foot('time-2', 'a')).toBe('timeline.subrow.placeholderMore');
		expect(foot('time-1', 'b')).toBe('timeline.subrow.placeholder');
		// Only the wording follows the rows. The foot itself carries no mark: the
		// stylesheet keeps every one of them out of the way alike.
	});

	it('keeps where the lanes stand, so a turn away and back finds them there', async () => {
		const fixture = laid();
		await settle();
		const scroller = fixture.body().querySelector('.snowflake-method-timeline-scroll')!;
		expect(fixture.memory.scroll).toEqual({ left: 0, top: 0 });
		scroller.scrollLeft = 220;
		scroller.scrollTop = 90;
		scroller.dispatch('scroll');
		expect(fixture.memory.scroll).toEqual({ left: 220, top: 90 });
	});

	it('stands in for the scroller\'s own bars with two of its own, kept in step both ways', async () => {
		const fixture = laid();
		await settle();
		const scroller = fixture.body().querySelector('.snowflake-method-timeline-scroll')!;
		const across = fixture.body().querySelector('.snowflake-method-timeline-scrollbar.is-across')!;
		const down = fixture.body().querySelector('.snowflake-method-timeline-scrollbar.is-down')!;
		expect(across.getAttribute('aria-hidden')).toBe('true');
		scroller.scrollLeft = 120;
		scroller.scrollTop = 40;
		scroller.dispatch('scroll');
		expect(across.scrollLeft).toBe(120);
		expect(down.scrollTop).toBe(40);
		across.scrollLeft = 60;
		across.dispatch('scroll');
		expect(scroller.scrollLeft).toBe(60);
		down.scrollTop = 10;
		down.dispatch('scroll');
		expect(scroller.scrollTop).toBe(10);
	});

	it('measures the frozen columns from their boxes, so a fit made while scrolled keeps the pin and starts the bar past it', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [] }] }), timeline('b', { times: [{ timeId: 'time-1', rows: [] }] })],
			views: [view('v', ['a', 'b'])],
			pinnedTimelineId: 'b',
		});
		await settle();
		fixture.root.querySelector('.snowflake-method-timeline-corner')!.offsetWidth = 328;
		for (const head of fixture.heads()) head.offsetWidth = 616;
		const scroller = fixture.body().querySelector('.snowflake-method-timeline-scroll')!;
		const across = fixture.body().querySelector('.snowflake-method-timeline-scrollbar.is-across')!;
		fixture.dom.scrollWidth = 1584;
		scroller.scrollLeft = 200;
		scroller.dispatch('scroll');
		fixture.dom.resize(1300);
		expect(fixture.root.classes.has('is-pin-loose')).toBe(false);
		expect(across.classes.has('is-hidden')).toBe(false);
		expect(across.styles.insetInlineStart).toBe('956px');
		expect(across.scrollLeft).toBe(200);
		// Less room past the pin, and the bar is shorter: it never runs under a lane that stands still.
		fixture.dom.resize(1100);
		expect(fixture.root.classes.has('is-pin-loose')).toBe(false);
		expect(across.classes.has('is-hidden')).toBe(false);
		expect(across.styles.insetInlineStart).toBe('956px');
		// Too little room for a bar to take hold of, and the field goes without one; the pin holds.
		fixture.dom.resize(980);
		expect(fixture.root.classes.has('is-pin-loose')).toBe(false);
		expect(across.classes.has('is-hidden')).toBe(true);
		// A field too narrow to show the pinned lane whole lets the pin go, for the while, and the bar starts after the time column.
		fixture.dom.resize(900);
		expect(fixture.root.classes.has('is-pin-loose')).toBe(true);
		expect(across.classes.has('is-hidden')).toBe(false);
		expect(across.styles.insetInlineStart).toBe('328px');
		fixture.dom.resize(1300);
		expect(fixture.root.classes.has('is-pin-loose')).toBe(false);
		expect(across.styles.insetInlineStart).toBe('956px');
	});

	it("marks the pinned lane's head and cells, which keep their place beside the time column", async () => {
		const fixture = workspace({
			timelines: [
				timeline('a', { times: [{ timeId: 'time-2', rows: [] }] }),
				timeline('b', { times: [{ timeId: 'time-2', rows: [] }] }),
			],
			views: [view('v', ['a', 'b'])],
			pinnedTimelineId: 'b',
		});
		await settle();
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['b', 'a']);
		expect(fixture.head('b').classes.has('is-pinned')).toBe(true);
		expect(fixture.cell('time-2', 'b').classes.has('is-pinned')).toBe(true);
		expect(fixture.cell('time-2', 'a').classes.has('is-pinned')).toBe(false);
		const pin = fixture.head('b').querySelector('.snowflake-method-timeline-lane-pin')!;
		expect(pin.getAttribute('role')).toBe('img');
		expect(pin.getAttribute('aria-label')).toBe('timeline.timeline.pinned');
		expect(pin.classes.has('is-hidden')).toBe(false);
		expect(fixture.head('a').querySelector('.snowflake-method-timeline-lane-pin')!.classes.has('is-hidden')).toBe(true);
		await fixture.bridge.pinTimeline(null);
		fixture.notify();
		await settle();
		expect(fixture.head('b').classes.has('is-pinned')).toBe(false);
		expect(fixture.cell('time-2', 'b').classes.has('is-pinned')).toBe(false);
		expect(pin.classes.has('is-hidden')).toBe(true);
	});

	it("keeps a lane's pin, name and bound note in one box, which holds at the frozen edge as the axis does", async () => {
		const fixture = workspace({
			timelines: [timeline('a', { binding: { kind: 'character', id: 'character-alice', name: 'Alice' } })],
			views: [view('v', ['a'])],
		});
		await settle();
		const head = fixture.head('a');
		const lead = head.children[0]!;
		expect(lead.classes.has('snowflake-method-timeline-lane-lead')).toBe(true);
		const title = lead.children[0]!;
		expect(title.classes.has('snowflake-method-timeline-lane-title')).toBe(true);
		expect(title.children.map((child) => [...child.classes].find((cls) => cls.startsWith('snowflake-method-timeline-lane-')))).toEqual([
			'snowflake-method-timeline-lane-pin', 'snowflake-method-timeline-lane-name', 'snowflake-method-timeline-lane-entity',
		]);
		expect(head.children[1]!.classes.has('snowflake-method-timeline-lane-more')).toBe(true);
		expect(head.children).toHaveLength(2);
	});

	it("keeps a row's handle in its words' box, which holds at the frozen edge with the axis", async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r-1', 'one')] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		const cell = fixture.cell('time-1', 'a');
		const subrow = cell.querySelector('.snowflake-method-timeline-subrow')!;
		const text = subrow.querySelector('.snowflake-method-timeline-subrow-text')!;
		expect(subrow.children[0]).toBe(text);
		expect(text.children[0]!.classes.has('snowflake-method-timeline-subrow-handle')).toBe(true);
		const trailing = cell.querySelector('.snowflake-method-timeline-subrow.is-trailing')!;
		expect(trailing.children[0]!.classes.has('snowflake-method-timeline-subrow-text')).toBe(true);
		expect(trailing.children[0]!.children[0]!.classes.has('snowflake-method-timeline-subrow-handle-space')).toBe(true);
	});

	it('lays the union of the lanes\' times as rows in the view\'s order, empty where a lane lacks the time', async () => {
		const fixture = laid();
		await settle();
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-2', 'time-1', 'time-lost']);
		expect(fixture.cell('time-2', 'a').classes.has('is-present')).toBe(true);
		expect(fixture.cell('time-2', 'b').classes.has('is-absent')).toBe(true);
		expect(fixture.cell('time-1', 'a').classes.has('is-absent')).toBe(true);
		expect(fixture.cell('time-1', 'b').classes.has('is-present')).toBe(true);
		expect(fixture.cell('time-2', 'a').classes.has('is-active-lane')).toBe(true);
		expect(fixture.cell('time-2', 'b').classes.has('is-active-lane')).toBe(false);
		const labels = fixture.cell('time-2', 'a').querySelectorAll('.snowflake-method-timeline-subrow-label');
		expect(labels.map((label) => label.textContent)).toEqual(['Arrives', 'timeline.subrow.empty']);
		expect(labels[1]!.classes.has('is-empty')).toBe(true);
		expect(fixture.root.querySelector('.snowflake-method-timeline-times-empty')!.classes.has('is-hidden')).toBe(true);
	});

	it('names the times from their notes, marking one the project lost, and opens a note or its form', async () => {
		const fixture = laid();
		await settle();
		const dawn = fixture.rowOf('time-1');
		expect(dawn.querySelector('.snowflake-method-timeline-time-label')!.textContent).toBe('Dawn');
		expect(dawn.querySelector('.snowflake-method-timeline-time-description')!.textContent).toBe('First light');
		const dusk = fixture.rowOf('time-2');
		const description = dusk.querySelector('.snowflake-method-timeline-time-description')!;
		expect(description.textContent).toBe('timeline.time.noDescription');
		expect(description.classes.has('is-empty')).toBe(true);
		const lost = fixture.rowOf('time-lost');
		expect(lost.classes.has('is-missing')).toBe(true);
		expect(lost.querySelector('.snowflake-method-timeline-time-label')!.textContent).toBe('timeline.time.missing');
		expect(lost.querySelector('.snowflake-method-timeline-time-description')!.classes.has('is-hidden')).toBe(true);
		dawn.querySelector('.snowflake-method-timeline-time-label')!.dispatch('click');
		expect(fixture.host.openManagedFile).toHaveBeenCalledWith('World/Dawn.md');
		description.dispatch('click');
		await settle();
		expect(fixture.host.openEntityForm).toHaveBeenCalledWith(
			{ mode: 'edit', id: 'time-2', section: 'description' }, 'P', expect.any(Function),
		);
	});

	it('adds a time to a lane from an empty cell, and from the header menu through the picker', async () => {
		const fixture = laid();
		await settle();
		fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-cell-add')!.dispatch('click');
		await settle();
		expect(fixture.bridge.addTime).toHaveBeenCalledWith('a', 'time-1');
		expect(fixture.cell('time-1', 'a').classes.has('is-present')).toBe(true);
		const prompt = vi.mocked(promptForEntityReference);
		prompt.mockImplementationOnce(async (_app, _t, source: EntityReferenceSource) => {
			expect(source.groups().map((group) => group.id)).toEqual(['time-point', 'time-period']);
			expect(source.entitiesIn('time-point').map((option) => option.value)).toEqual(['time-2']);
			return { group: 'time-point', option: { value: 'time-2', label: 'Dusk' } };
		});
		menus.length = 0;
		fixture.head('b').querySelector('.snowflake-method-timeline-lane-more')!.dispatch('click');
		menus[0]!.find((item) => item.title === 'timeline.timeline.addTime')!.click();
		await settle();
		expect(fixture.bridge.addTime).toHaveBeenCalledWith('b', 'time-2');
		expect(fixture.cell('time-2', 'b').classes.has('is-present')).toBe(true);
	});

	it('puts a time on the active lane from the corner, after the rest, and from a seam, before the row under it', async () => {
		const fixture = laid();
		await settle();
		const prompt = vi.mocked(promptForEntityReference);
		prompt.mockImplementationOnce(async () => ({ group: 'time-point', option: { value: 'time-1', label: 'Dawn' } }));
		fixture.button('snowflake-method-timeline-time-add').dispatch('click');
		await settle();
		expect(fixture.bridge.addTime).toHaveBeenCalledWith('a', 'time-1');
		expect(fixture.bridge.setTimeOrder).not.toHaveBeenCalled();
		prompt.mockImplementationOnce(async () => ({ group: 'time-point', option: { value: 'time-7', label: 'Night' } }));
		fixture.rowOf('time-1').querySelector('.snowflake-method-timeline-seam-add')!.dispatch('click');
		await settle();
		expect(fixture.bridge.addTime).toHaveBeenCalledWith('a', 'time-7');
		expect(fixture.bridge.setTimeOrder).toHaveBeenCalledWith('v', ['time-2', 'time-7', 'time-1', 'time-lost']);
		expect(fixture.rows().map((row) => row.getAttribute('data-time-id'))).toEqual(['time-2', 'time-7', 'time-1', 'time-lost']);
		// A lane's own seam puts the time on that lane, before the row as well.
		prompt.mockImplementationOnce(async () => ({ group: 'time-point', option: { value: 'time-8', label: 'Dusk' } }));
		fixture.cell('time-1', 'b').querySelector('.snowflake-method-timeline-seam-add')!.dispatch('click');
		await settle();
		expect(fixture.bridge.addTime).toHaveBeenCalledWith('b', 'time-8');
		expect(fixture.bridge.setTimeOrder).toHaveBeenLastCalledWith('v', ['time-2', 'time-7', 'time-8', 'time-1', 'time-lost']);
	});

	it('makes a time from the name typed, through the note or the form as the setting says', async () => {
		const fixture = laid();
		await settle();
		const prompt = vi.mocked(promptForEntityReference);
		prompt.mockImplementationOnce(async (_app, _t, source: EntityReferenceSource) => {
			const made = await source.createIn!('time-point', 'Noon');
			return made === null ? null : { group: 'time-point', option: made };
		});
		menus.length = 0;
		fixture.head('a').querySelector('.snowflake-method-timeline-lane-more')!.dispatch('click');
		menus[0]!.find((item) => item.title === 'timeline.timeline.addTime')!.click();
		await settle();
		expect(fixture.host.createEntity).toHaveBeenCalledWith(expect.objectContaining({ kind: 'time', name: 'Noon', timeKind: 'point' }), 'P');
		expect(fixture.refresh).toHaveBeenCalled();
		expect(fixture.bridge.addTime).toHaveBeenCalledWith('a', 'time-9');
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toContain('time-9');
		fixture.host.opensFormWhenCreatingFromField.mockReturnValue(true);
		prompt.mockImplementationOnce(async (_app, _t, source: EntityReferenceSource) => {
			const made = await source.createIn!('time-period', 'Winter');
			return made === null ? null : { group: 'time-period', option: made };
		});
		menus.length = 0;
		fixture.head('a').querySelector('.snowflake-method-timeline-lane-more')!.dispatch('click');
		menus[0]!.find((item) => item.title === 'timeline.timeline.addTime')!.click();
		await settle();
		expect(fixture.host.openEntityForm).toHaveBeenCalledWith(
			{ mode: 'create', kind: 'time', preset: { name: 'Winter', timeKind: 'period', lockTimeKind: true } }, 'P',
		);
		expect(fixture.bridge.addTime).toHaveBeenCalledWith('a', 'time-8');
	});

	it('takes a time off the active lane from its menu, asking first when it holds rows', async () => {
		const fixture = laid();
		await settle();
		menus.length = 0;
		fixture.rowOf('time-2').querySelector('.snowflake-method-timeline-time-more')!.dispatch('click');
		expect(menus[0]!.map((item) => item.title)).toEqual([
			'actions.edit', 'common.open', 'actions.moveUp', 'actions.moveDown', 'timeline.time.insertAfter', 'timeline.time.remove',
		]);
		menus[0]![5]!.click();
		await settle();
		expect(confirmTimelineAction).toHaveBeenCalledOnce();
		expect(fixture.bridge.removeTime).toHaveBeenCalledWith('a', 'time-2');
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-1', 'time-lost']);
		menus.length = 0;
		fixture.rowOf('time-1').querySelector('.snowflake-method-timeline-time-more')!.dispatch('click');
		expect(menus[0]![5]!.disabled).toBe(true);
		fixture.head('b').querySelector('.snowflake-method-timeline-lane-name')!.dispatch('click');
		menus.length = 0;
		fixture.rowOf('time-1').querySelector('.snowflake-method-timeline-time-more')!.dispatch('click');
		menus[0]![5]!.click();
		await settle();
		expect(confirmTimelineAction).toHaveBeenCalledOnce();
		expect(fixture.bridge.removeTime).toHaveBeenCalledWith('b', 'time-1');
	});

	it('deals the placed scenes as cards, takes one off from its menu, and stands in for a scene the project lost', async () => {
		const fixture = laid();
		await settle();
		const scenes = fixture.cell('time-2', 'a').querySelector('.snowflake-method-timeline-scenes')!;
		expect(scenes.children.map((child) => child.getAttribute('data-key'))).toEqual(['r1|scene-1', 'r1|scene-gone']);
		const card = fixture.cards()[0]!;
		expect(card.getAttribute('data-id')).toBe('scene-1');
		expect(card.querySelector('.snowflake-method-corkboard-title')!.textContent).toBe('Arrival');
		expect(card.getAttribute('draggable')).toBe('true');
		const missing = scenes.querySelector('.snowflake-method-timeline-scene-missing')!;
		expect(missing.querySelectorAll('span')[0]!.textContent).toBe('timeline.scene.missing');
		missing.querySelector('button')!.dispatch('click');
		await settle();
		expect(fixture.bridge.removeScene).toHaveBeenCalledWith('a', 'scene-gone');
		expect(scenes.querySelector('.snowflake-method-timeline-scene-missing')).toBeNull();
		menus.length = 0;
		card.querySelector('.snowflake-method-corkboard-more')!.dispatch('click');
		expect(menus[0]!.map((item) => item.title)).toEqual([
			'actions.edit', 'common.open', 'actions.moveUp', 'actions.moveDown',
			'timeline.scene.moveTo', 'timeline.scene.remove', 'actions.delete',
		]);
		menus[0]!.find((item) => item.title === 'timeline.scene.remove')!.click();
		await settle();
		expect(fixture.bridge.removeScene).toHaveBeenCalledWith('a', 'scene-1');
		expect(fixture.cards()).toHaveLength(0);
	});

	it('takes a scene off a row whose id carries the mark keys are joined on, or the escape', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [
				row('r\\1', 'Arrives', ['scene-1']),
				row('r|2', 'Argues', ['scene-2']),
			] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		const cardOf = (id: string): CorkboardElement =>
			fixture.cards().find((card) => card.getAttribute('data-id') === id)!;
		// The key the card wears is the joined one; the row it belongs to is
		// read back out of it the same way, never by cutting it at the mark.
		for (const [sceneId, rowId] of [['scene-1', 'r\\1'], ['scene-2', 'r|2']] as const) {
			menus.length = 0;
			cardOf(sceneId).querySelector('.snowflake-method-corkboard-more')!.dispatch('click');
			const remove = menus[0]!.find((item) => item.title === 'timeline.scene.remove')!;
			expect(remove.disabled).toBe(false);
			remove.click();
			await settle();
			expect(fixture.bridge.removeScene).toHaveBeenCalledWith('a', sceneId);
			expect(fixture.held().timelines[0]!.times[0]!.rows.find((entry) => entry.id === rowId)!.scenes).toEqual([]);
		}
	});
});

describe('writing sub-descriptions', () => {
	const laid = (readOnly = false) => workspace({
		timelines: [
			timeline('a', { times: [{ timeId: 'time-2', rows: [row('r1', 'Arrives', ['scene-1']), row('r2', 'Argues')] }] }),
		],
		views: [view('v', ['a'])],
	}, readOnly);
	const subrows = (cell: CorkboardElement): CorkboardElement[] =>
		cell.querySelector('.snowflake-method-timeline-rows')!.children;
	const trailingInput = (cell: CorkboardElement): CorkboardElement =>
		cell.querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!;

	it('makes a row from the words typed at the foot, shows it at once, and keeps the focus for the next', async () => {
		const fixture = laid();
		await settle();
		const cell = fixture.cell('time-2', 'a');
		const input = trailingInput(cell);
		expect(subrows(cell).map((child) => child.getAttribute('data-row-id') ?? child.classes.has('is-trailing'))).toEqual(['r1', 'r2', true]);
		input.focus();
		input.value = '  Leaves  ';
		// Enter alone breaks a paragraph; the words are written on Mod+Enter.
		press(input, 'Enter');
		expect(input.value).toBe('  Leaves  ');
		expect(subrows(cell)).toHaveLength(3);
		press(input, 'Enter', { mod: true });
		expect(input.value).toBe('');
		expect(fixture.dom.doc.activeElement).toBe(input);
		const pending = subrows(cell)[2]!;
		expect(pending.classes.has('is-pending')).toBe(true);
		expect(pending.querySelector('button')!.textContent).toBe('Leaves');
		expect(subrows(cell)[3]!.classes.has('is-trailing')).toBe(true);
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledWith('a', 'time-2', 'Leaves', null);
		const labels = subrows(cell).filter((child) => child.getAttribute('data-row-id') !== null)
			.map((child) => child.querySelector('.snowflake-method-timeline-subrow-label')!.textContent);
		expect(labels).toEqual(['Arrives', 'Argues', 'Leaves']);
		expect(cell.querySelector('.snowflake-method-timeline-subrow.is-pending')).toBeNull();
		expect(subrows(cell)[3]!.classes.has('is-trailing')).toBe(true);
	});

	it('discards the trailing words on Escape, writes nothing for an empty leave, and commits a full one', async () => {
		const fixture = laid();
		await settle();
		const input = trailingInput(fixture.cell('time-2', 'a'));
		input.value = 'Half';
		press(input, 'Escape');
		expect(input.value).toBe('');
		input.dispatch('blur');
		await settle();
		expect(fixture.bridge.addRow).not.toHaveBeenCalled();
		input.value = 'Whole';
		input.dispatch('blur');
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledWith('a', 'time-2', 'Whole', null);
	});

	it('edits a row in place: Mod+Enter writes the words, Escape reverts, leaving the box commits', async () => {
		const fixture = laid();
		await settle();
		const cell = fixture.cell('time-2', 'a');
		const first = subrows(cell)[0]!;
		const label = first.querySelector('.snowflake-method-timeline-subrow-label')!;
		const input = first.querySelector('.snowflake-method-timeline-subrow-input')!;
		label.dispatch('click');
		expect(first.classes.has('is-editing')).toBe(true);
		expect(label.classes.has('is-hidden')).toBe(true);
		expect(input.classes.has('is-hidden')).toBe(false);
		expect(input.value).toBe('Arrives');
		expect(fixture.dom.doc.activeElement).toBe(input);
		input.value = 'Arrives\nlate';
		press(input, 'Enter');
		expect(first.classes.has('is-editing')).toBe(true);
		press(input, 'Enter', { mod: true });
		expect(first.classes.has('is-editing')).toBe(false);
		expect(label.textContent).toBe('Arrives\nlate');
		expect(fixture.dom.doc.activeElement).toBe(label);
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledWith('a', 'r1', 'Arrives\nlate');
		label.dispatch('click');
		input.value = 'Nope';
		press(input, 'Escape');
		expect(label.textContent).toBe('Arrives\nlate');
		expect(fixture.bridge.editRow).toHaveBeenCalledTimes(1);
		label.dispatch('click');
		input.value = 'Arrives early';
		input.dispatch('blur');
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledWith('a', 'r1', 'Arrives early');
		expect(label.textContent).toBe('Arrives early');
	});

	it("offers a row's menu: move up and down among its time's rows, and remove, asking first when it holds scenes", async () => {
		const fixture = laid();
		await settle();
		vi.mocked(confirmTimelineAction).mockClear();
		const cell = fixture.cell('time-2', 'a');
		menus.length = 0;
		subrows(cell)[0]!.querySelector('.snowflake-method-timeline-subrow-more')!.dispatch('click');
		expect(menus[0]!.map((item) => [item.title, item.disabled])).toEqual([
			['actions.moveUp', true], ['actions.moveDown', false], ['timeline.subrow.moveToTime', true], ['timeline.subrow.remove', false],
		]);
		menus[0]![1]!.click();
		await settle();
		expect(fixture.bridge.moveRow).toHaveBeenCalledWith('a', 'r1', 'time-2', null);
		expect(subrows(cell).slice(0, 2).map((child) => child.getAttribute('data-row-id'))).toEqual(['r2', 'r1']);
		menus.length = 0;
		subrows(cell)[1]!.querySelector('.snowflake-method-timeline-subrow-more')!.dispatch('click');
		menus[0]![0]!.click();
		await settle();
		expect(fixture.bridge.moveRow).toHaveBeenCalledWith('a', 'r1', 'time-2', 'r2');
		expect(subrows(cell).slice(0, 2).map((child) => child.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
		menus.length = 0;
		subrows(cell)[1]!.querySelector('.snowflake-method-timeline-subrow-more')!.dispatch('click');
		menus[0]!.find((item) => item.title === 'timeline.subrow.remove')!.click();
		await settle();
		expect(confirmTimelineAction).not.toHaveBeenCalled();
		expect(fixture.bridge.deleteRow).toHaveBeenCalledWith('a', 'r2');
		menus.length = 0;
		subrows(cell)[0]!.querySelector('.snowflake-method-timeline-subrow-more')!.dispatch('click');
		menus[0]!.find((item) => item.title === 'timeline.subrow.remove')!.click();
		await settle();
		expect(confirmTimelineAction).toHaveBeenCalledOnce();
		expect(fixture.bridge.deleteRow).toHaveBeenCalledWith('a', 'r1');
		expect(subrows(cell).filter((child) => child.getAttribute('data-row-id') !== null)).toHaveLength(0);
	});

	it('keeps the words as they are on a project that cannot be written', async () => {
		const fixture = laid(true);
		await settle();
		const cell = fixture.cell('time-2', 'a');
		expect(cell.querySelector('.snowflake-method-timeline-subrow.is-trailing')!.classes.has('is-hidden')).toBe(true);
		const first = subrows(cell)[0]!;
		expect(first.querySelector('.snowflake-method-timeline-subrow-input')!.readOnly).toBe(true);
		expect(first.querySelector('.snowflake-method-timeline-subrow-more')!.disabled).toBe(true);
		first.querySelector('.snowflake-method-timeline-subrow-label')!.dispatch('click');
		expect(first.classes.has('is-editing')).toBe(false);
	});
});

describe('moving sub-descriptions to another time from the menu', () => {
	const laid = (readOnly = false) => workspace({
		timelines: [
			timeline('a', { times: [
				{ timeId: 'time-1', rows: [row('first', 'Already here')] },
				{ timeId: 'time-2', rows: [row('moving', 'Arrives', ['scene-1', 'scene-2'])] },
				{ timeId: 'time-lost', rows: [] },
			] }),
			timeline('b', { times: [{ timeId: 'time-other-lane', rows: [] }] }),
		],
		views: [view('v', ['a', 'b'], { timeOrder: ['time-lost', 'time-2', 'time-1'], presentation: 'flat' })],
	}, readOnly);
	const menuForRow = (fixture: ReturnType<typeof laid>) => {
		menus.length = 0;
		fixture.cell('time-2', 'a').querySelector('.snowflake-method-timeline-subrow-more')!.dispatch('click');
		return menus[0]!.find((item) => item.title === 'timeline.subrow.moveToTime')!;
	};
	const openPicker = (fixture: ReturnType<typeof laid>): TimelineTimePickModal => {
		const opened: TimelineTimePickModal[] = [];
		const spy = vi.spyOn(TimelineTimePickModal.prototype, 'open').mockImplementation(function (this: TimelineTimePickModal) {
			opened.push(this);
		});
		try {
			menuForRow(fixture).click();
			expect(opened).toHaveLength(1);
			return opened[0]!;
		} finally {
			spy.mockRestore();
		}
	};

	it('offers only other times on the same lane in displayed order and moves the row with its scenes and open edit', async () => {
		const fixture = laid();
		await settle();
		const entry = fixture.cell('time-2', 'a').querySelector('.snowflake-method-timeline-subrow')!;
		entry.querySelector('.snowflake-method-timeline-subrow-label')!.dispatch('click');
		const input = entry.querySelector('.snowflake-method-timeline-subrow-input')!;
		input.value = 'Still writing';
		const picker = openPicker(fixture);
		expect(picker.getItems()).toEqual([
			{ value: 'time-lost', label: 'timeline.time.missing' },
			{ value: 'time-1', label: 'Dawn' },
		]);
		expect(picker.getItemText(picker.getItems()[1]!)).toBe('Dawn');
		picker.onChooseItem(picker.getItems()[1]!);
		await settle();
		expect(fixture.bridge.moveRow).toHaveBeenCalledWith('a', 'moving', 'time-1', null);
		expect(fixture.held().timelines[0]!.times[0]!.rows).toEqual([
			row('first', 'Already here'), row('moving', 'Arrives', ['scene-1', 'scene-2']),
		]);
		const moved = fixture.cell('time-1', 'a').querySelectorAll('.snowflake-method-timeline-subrow')
			.find((candidate) => candidate.getAttribute('data-row-id') === 'moving')!;
		expect(moved).toBe(entry);
		expect(moved.querySelector('.snowflake-method-timeline-subrow-input')!.value).toBe('Still writing');
		expect(fixture.bridge.deleteRow).not.toHaveBeenCalled();
		expect(fixture.bridge.placeScene).not.toHaveBeenCalled();
	});

	it('disables the move when read-only or when the lane has no other time', async () => {
		const fixture = laid(true);
		await settle();
		const open = vi.spyOn(TimelineTimePickModal.prototype, 'open').mockImplementation(() => undefined);
		try {
			expect(menuForRow(fixture).disabled).toBe(true);
			menuForRow(fixture).click();
			expect(open).not.toHaveBeenCalled();
			const alone = workspace({
				timelines: [timeline('a', { times: [{ timeId: 'time-2', rows: [row('moving', '')] }] })],
				views: [view('v', ['a'])],
			});
			await settle();
			expect(menuForRow(alone).disabled).toBe(true);
			menuForRow(alone).click();
			expect(open).not.toHaveBeenCalled();
		} finally {
			open.mockRestore();
		}
	});

	it.each(['destination removed', 'row removed', 'row moved', 'lane removed from view', 'read-only', 'project switched', 'view switched', 'disposed'])(
		'ignores a stale selection after %s', async (change) => {
			const fixture = laid();
			await settle();
			const picker = openPicker(fixture);
			if (change === 'destination removed') await fixture.bridge.removeTime('a', 'time-1');
			if (change === 'row removed') await fixture.bridge.deleteRow('a', 'moving');
			if (change === 'row moved') await fixture.bridge.moveRow('a', 'moving', 'time-lost', null);
			if (change === 'lane removed from view') await fixture.bridge.setViewTimelines('v', ['b']);
			if (change === 'read-only') { fixture.model.readOnly = true; fixture.handle.refresh(); }
			if (change === 'project switched') fixture.controls.projectPath = () => 'Q';
			if (change === 'view switched') {
				const other = await fixture.bridge.createView('Other', ['a']);
				fixture.notify();
				await settle();
				fixture.viewField().choose(other!);
				await settle();
			}
			if (change === 'disposed') fixture.handle.dispose();
			vi.mocked(fixture.bridge.moveRow).mockClear();
			picker.onChooseItem(picker.getItems()[1]!);
			await settle();
			expect(fixture.bridge.moveRow).not.toHaveBeenCalled();
		},
	);
});

describe('dragging times and rows', () => {
	const laid = () => workspace({
		timelines: [
			timeline('a', { times: [
				{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-1'])] },
				{ timeId: 'time-2', rows: [row('r2', 'Argues'), row('r3', 'Leaves')] },
			] }),
			timeline('b', { times: [{ timeId: 'time-1', rows: [row('r4', 'Waits')] }, { timeId: 'time-lost', rows: [] }] }),
		],
		views: [view('v', ['a', 'b'], { timeOrder: ['time-2'] })],
	});
	const subrow = (fixture: ReturnType<typeof workspace>, timeId: string, timelineId: string, rowId: string): CorkboardElement =>
		fixture.cell(timeId, timelineId).querySelectorAll('.snowflake-method-timeline-subrow')
			.find((candidate) => candidate.getAttribute('data-row-id') === rowId)!;

	it('makes a lane active from a click anywhere on it, not only from its head', async () => {
		const fixture = laid();
		await settle();
		expect(fixture.head('a').classes.has('is-active')).toBe(true);
		fixture.cell('time-1', 'b').dispatch('click');
		expect(fixture.head('b').classes.has('is-active')).toBe(true);
		expect(fixture.head('a').classes.has('is-active')).toBe(false);
		expect(fixture.cell('time-1', 'b').classes.has('is-active-lane')).toBe(true);
		expect(fixture.cell('time-2', 'a').classes.has('is-active-lane')).toBe(false);
		// An absent cell of the lane counts as much as one with rows.
		fixture.cell('time-1', 'a').dispatch('click');
		expect(fixture.head('a').classes.has('is-active')).toBe(true);
		expect(fixture.cell('time-2', 'a').classes.has('is-active-lane')).toBe(true);
	});

	it('drags a time row to a new place in the view, the line across the workspace, and writes the order', async () => {
		const fixture = laid();
		await settle();
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-2', 'time-1', 'time-lost']);
		fixture.rows().forEach((entry, index) => standAt(entry, index * 40));
		const table = fixture.root.querySelector('.snowflake-method-timeline-table')!;
		const handle = fixture.rowOf('time-lost').querySelector('.snowflake-method-timeline-time-handle')!;
		expect(handle.getAttribute('draggable')).toBe('true');
		const dataTransfer = transfer([TIMELINE_TIME_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		expect(dataTransfer.getData(TIMELINE_TIME_DRAG_TYPE)).toBe('time-lost');
		expect(fixture.root.classes.has('is-time-drag')).toBe(true);
		expect(fixture.rowOf('time-lost').classes.has('is-dragging')).toBe(true);
		fire(table, 'dragover', { clientY: 10, dataTransfer });
		expect(dataTransfer.dropEffect).toBe('move');
		expect(fixture.rowOf('time-2').classes.has('is-drop-before')).toBe(true);
		fire(table, 'dragover', { clientY: 50, dataTransfer });
		expect(fixture.rowOf('time-2').classes.has('is-drop-before')).toBe(false);
		expect(fixture.rowOf('time-1').classes.has('is-drop-before')).toBe(true);
		fire(table, 'dragover', { clientY: 10, dataTransfer });
		fire(table, 'drop', { dataTransfer });
		expect(fixture.rowOf('time-2').classes.has('is-drop-before')).toBe(false);
		fire(handle, 'dragend', {});
		expect(fixture.root.classes.has('is-time-drag')).toBe(false);
		expect(fixture.rowOf('time-lost').classes.has('is-dragging')).toBe(false);
		await settle();
		expect(fixture.bridge.setTimeOrder).toHaveBeenCalledWith('v', ['time-lost', 'time-2', 'time-1']);
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-lost', 'time-2', 'time-1']);
	});

	it('runs the times latest first when the view says so, and writes every move in the order the view keeps', async () => {
		const fixture = workspace({
			timelines: [
				timeline('a', { times: [{ timeId: 'time-2', rows: [row('r1', 'Arrives')] }] }),
				timeline('b', { times: [{ timeId: 'time-1', rows: [] }, { timeId: 'time-lost', rows: [] }] }),
			],
			views: [view('v', ['a', 'b'], { timeOrder: ['time-2'], timesReversed: true })],
		});
		await settle();
		const order = fixture.button('snowflake-method-timeline-order');
		expect(order.getAttribute('aria-pressed')).toBe('true');
		expect(order.getAttribute('aria-label')).toBe('timeline.order.restore');
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-lost', 'time-1', 'time-2']);
		// The rows under a time keep their order: the reversal is the times' alone.
		expect(fixture.cell('time-2', 'a').querySelectorAll('.snowflake-method-timeline-subrow-label').map((label) => label.textContent)).toEqual(['Arrives']);
		// Up on the screen is later in the order the view keeps.
		menus.length = 0;
		fixture.rowOf('time-1').querySelector('.snowflake-method-timeline-time-more')!.dispatch('click');
		menus[0]!.find((item) => item.title === 'actions.moveUp')!.click();
		await settle();
		expect(fixture.bridge.setTimeOrder).toHaveBeenLastCalledWith('v', ['time-2', 'time-lost', 'time-1']);
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-1', 'time-lost', 'time-2']);
		// A drop past the foot puts the time first in the order the view keeps.
		fixture.rows().forEach((entry, index) => standAt(entry, index * 40));
		const table = fixture.root.querySelector('.snowflake-method-timeline-table')!;
		const handle = fixture.rowOf('time-1').querySelector('.snowflake-method-timeline-time-handle')!;
		const dataTransfer = transfer([TIMELINE_TIME_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		fire(table, 'dragover', { clientY: 500, dataTransfer });
		fire(table, 'drop', { dataTransfer });
		fire(handle, 'dragend', {});
		await settle();
		expect(fixture.bridge.setTimeOrder).toHaveBeenLastCalledWith('v', ['time-1', 'time-2', 'time-lost']);
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-lost', 'time-2', 'time-1']);
		order.dispatch('click');
		await settle();
		expect(fixture.bridge.setViewTimesReversed).toHaveBeenCalledWith('v', false);
		expect(order.getAttribute('aria-pressed')).toBe('false');
		expect(order.getAttribute('aria-label')).toBe('timeline.order.reverse');
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-1', 'time-2', 'time-lost']);
	});

	it('moves a time up or down from its menu, and past the foot with a drop on the tail', async () => {
		const fixture = laid();
		await settle();
		menus.length = 0;
		fixture.rowOf('time-1').querySelector('.snowflake-method-timeline-time-more')!.dispatch('click');
		const up = menus[0]!.find((item) => item.title === 'actions.moveUp')!;
		expect(up.disabled).toBe(false);
		up.click();
		await settle();
		expect(fixture.bridge.setTimeOrder).toHaveBeenCalledWith('v', ['time-1', 'time-2', 'time-lost']);
		menus.length = 0;
		fixture.rowOf('time-1').querySelector('.snowflake-method-timeline-time-more')!.dispatch('click');
		expect(menus[0]!.find((item) => item.title === 'actions.moveUp')!.disabled).toBe(true);
		menus[0]!.find((item) => item.title === 'actions.moveDown')!.click();
		await settle();
		expect(fixture.bridge.setTimeOrder).toHaveBeenLastCalledWith('v', ['time-2', 'time-1', 'time-lost']);
		fixture.rows().forEach((entry, index) => standAt(entry, index * 40));
		const table = fixture.root.querySelector('.snowflake-method-timeline-table')!;
		const handle = fixture.rowOf('time-2').querySelector('.snowflake-method-timeline-time-handle')!;
		const dataTransfer = transfer([TIMELINE_TIME_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		fire(table, 'dragover', { clientY: 500, dataTransfer });
		expect(fixture.root.querySelector('.snowflake-method-timeline-tail')!.classes.has('is-drop-before')).toBe(true);
		fire(table, 'drop', { dataTransfer });
		fire(handle, 'dragend', {});
		await settle();
		expect(fixture.bridge.setTimeOrder).toHaveBeenLastCalledWith('v', ['time-1', 'time-lost', 'time-2']);
	});

	it('drags a row to another time of its own lane, before the row under the pointer, while another lane says no', async () => {
		const fixture = laid();
		await settle();
		const handle = subrow(fixture, 'time-2', 'a', 'r3').querySelector('.snowflake-method-timeline-subrow-handle')!;
		const dataTransfer = transfer([TIMELINE_ROW_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		expect(dataTransfer.getData(TIMELINE_ROW_DRAG_TYPE)).toBe('r3');
		expect(fixture.root.classes.has('is-row-drag')).toBe(true);
		expect(fixture.cell('time-1', 'a').classes.has('is-drag-lane')).toBe(true);
		expect(fixture.cell('time-1', 'b').classes.has('is-locked-out')).toBe(true);
		expect(fixture.head('b').classes.has('is-locked-out')).toBe(true);
		const foreign = transfer([TIMELINE_ROW_DRAG_TYPE]);
		fire(fixture.cell('time-1', 'b'), 'dragover', { clientY: 10, dataTransfer: foreign });
		expect(foreign.dropEffect).toBe('none');
		expect(subrow(fixture, 'time-1', 'b', 'r4').classes.has('is-drop-before')).toBe(false);
		fire(fixture.cell('time-1', 'b'), 'drop', { dataTransfer });
		expect(fixture.bridge.moveRow).not.toHaveBeenCalled();
		standAt(subrow(fixture, 'time-1', 'a', 'r1'), 0);
		fire(fixture.cell('time-1', 'a'), 'dragover', { clientY: 10, dataTransfer });
		expect(dataTransfer.dropEffect).toBe('move');
		expect(subrow(fixture, 'time-1', 'a', 'r1').classes.has('is-drop-before')).toBe(true);
		fire(fixture.cell('time-1', 'a'), 'dragover', { clientY: 100, dataTransfer });
		expect(subrow(fixture, 'time-1', 'a', 'r1').classes.has('is-drop-before')).toBe(false);
		expect(fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-subrow.is-trailing')!.classes.has('is-drop-before')).toBe(true);
		fire(fixture.cell('time-1', 'a'), 'dragover', { clientY: 10, dataTransfer });
		fire(fixture.cell('time-1', 'a'), 'drop', { dataTransfer });
		fire(handle, 'dragend', {});
		expect(fixture.root.classes.has('is-row-drag')).toBe(false);
		expect(fixture.cell('time-1', 'b').classes.has('is-locked-out')).toBe(false);
		await settle();
		expect(fixture.bridge.moveRow).toHaveBeenCalledWith('a', 'r3', 'time-1', 'r1');
		expect(fixture.cell('time-1', 'a').querySelectorAll('.snowflake-method-timeline-subrow')
			.map((candidate) => candidate.getAttribute('data-row-id')).filter((id) => id !== null)).toEqual(['r3', 'r1']);
	});

	it('takes the line with it when the pointer moves on to a lane that will not have the row', async () => {
		const fixture = laid();
		await settle();
		const handle = subrow(fixture, 'time-2', 'a', 'r3').querySelector('.snowflake-method-timeline-subrow-handle')!;
		const dataTransfer = transfer([TIMELINE_ROW_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		standAt(subrow(fixture, 'time-1', 'a', 'r1'), 0);
		fire(fixture.cell('time-1', 'a'), 'dragover', { clientY: 10, dataTransfer });
		expect(subrow(fixture, 'time-1', 'a', 'r1').classes.has('is-drop-before')).toBe(true);
		// The line was drawn on the lane the pointer came from; a lane that
		// refuses the row takes it away rather than leaving it standing.
		const foreign = transfer([TIMELINE_ROW_DRAG_TYPE]);
		fire(fixture.cell('time-1', 'b'), 'dragover', { clientY: 10, dataTransfer: foreign });
		expect(foreign.dropEffect).toBe('none');
		expect(subrow(fixture, 'time-1', 'a', 'r1').classes.has('is-drop-before')).toBe(false);
		// Back on its own lane the row lands as it did before.
		fire(fixture.cell('time-1', 'a'), 'dragover', { clientY: 10, dataTransfer });
		expect(subrow(fixture, 'time-1', 'a', 'r1').classes.has('is-drop-before')).toBe(true);
		fire(fixture.cell('time-1', 'a'), 'drop', { dataTransfer });
		fire(handle, 'dragend', {});
		await settle();
		expect(fixture.bridge.moveRow).toHaveBeenCalledWith('a', 'r3', 'time-1', 'r1');
	});
});

describe('the scene pool', () => {
	const laid = () => workspace({
		timelines: [
			timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-1'])] }] }),
			timeline('b', { times: [{ timeId: 'time-1', rows: [] }] }),
		],
		views: [view('v', ['a', 'b'])],
	});

	it('stands beside the lanes as the corkboard in one column, leaving out what the active lane has placed', async () => {
		const fixture = laid();
		await settle();
		const pool = fixture.root.querySelector('.snowflake-method-timeline-pool')!;
		expect(fixture.corkboard).toHaveBeenCalledOnce();
		const [host, poolControls, variant] = fixture.corkboard.mock.calls[0]! as unknown as [CorkboardElement, TimelineControls & { memory: unknown; remember: () => void }, { include: (scene: { id: string }) => boolean; addButton: string; columns: number; gap: number; emptyText: string; modeShared: boolean }];
		expect(host).toBe(pool.querySelector('.snowflake-method-corkboard-host'));
		expect(variant.addButton).toBe('icon');
		expect(variant.columns).toBe(1);
		expect(variant.gap).toBe(0.75);
		expect(variant.emptyText).toBe('timeline.pool.empty');
		// The style it chooses dresses the lanes, so the control outlives an emptied pool.
		expect(variant.modeShared).toBe(true);
		expect(variant.include({ id: 'scene-1' })).toBe(false);
		expect(variant.include({ id: 'scene-2' })).toBe(true);
		// Its head names it and counts what it holds, which follows the active lane.
		const poolHead = pool.querySelector('.snowflake-method-timeline-pool-head')!;
		expect(pool.children[0]).toBe(poolHead);
		expect(poolHead.querySelector('.snowflake-method-timeline-pool-name')!.textContent).toBe('timeline.pool');
		expect(poolHead.querySelector('.snowflake-method-timeline-pool-count')!.textContent).toBe('2');
		fixture.head('b').dispatch('click');
		expect(poolHead.querySelector('.snowflake-method-timeline-pool-count')!.textContent).toBe('3');
		expect(poolControls.memory).toBe(fixture.memory.pool);
		poolControls.remember();
		expect(fixture.remember).toHaveBeenCalledOnce();
		expect(fixture.poolHandle.refresh).toHaveBeenCalled();
		// The card style the pool's control chooses dresses the lanes as well.
		expect(fixture.root.dataset.mode).toBe('compact');
		fixture.memory.pool.mode = 'extended';
		poolControls.remember();
		expect(fixture.root.dataset.mode).toBe('extended');
	});

	it('follows the active lane, and hands the pool its reveals, measures and disposal', async () => {
		const fixture = laid();
		await settle();
		const variant = fixture.corkboard.mock.calls[0]![2] as unknown as { include: (scene: { id: string }) => boolean };
		const paints = fixture.poolHandle.refresh.mock.calls.length;
		fixture.head('b').querySelector('.snowflake-method-timeline-lane-name')!.dispatch('click');
		expect(variant.include({ id: 'scene-1' })).toBe(true);
		expect(fixture.poolHandle.refresh.mock.calls.length).toBe(paints + 1);
		fixture.handle.reveal('scene-2');
		expect(fixture.poolHandle.reveal).toHaveBeenCalledWith('scene-2');
		fixture.handle.remeasure();
		expect(fixture.poolHandle.remeasure).toHaveBeenCalledOnce();
		expect(fixture.handle.saveFocusedConflict()).toBe(false);
		expect(fixture.poolHandle.saveFocusedConflict).toHaveBeenCalledOnce();
		fixture.handle.dispose();
		expect(fixture.poolHandle.dispose).toHaveBeenCalledOnce();
	});

	it('folds the pool away from the toolbar, remembers it, and brings it back for a reveal', async () => {
		const fixture = laid();
		await settle();
		const toggle = fixture.button('snowflake-method-timeline-pool-toggle');
		const pool = fixture.root.querySelector('.snowflake-method-timeline-pool')!;
		// The toggle stands in the frame's right corner, outside the toolbar.
		expect(toggle.parent!.classes.has('snowflake-method-timeline-fold')).toBe(true);
		expect(toggle.parent!.classes.has('is-end')).toBe(true);
		expect(toggle.parent!.parent).toBe(fixture.root);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.getAttribute('aria-label')).toBe('timeline.pool.collapse');
		toggle.dispatch('click');
		expect(fixture.memory.poolCollapsed).toBe(true);
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(true);
		expect(pool.classes.has('is-hidden')).toBe(true);
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(toggle.getAttribute('aria-label')).toBe('timeline.pool.expand');
		expect(fixture.remember).toHaveBeenCalledOnce();
		expect(fixture.poolHandle.remeasure).toHaveBeenCalledOnce();
		// A card can only be shown in a pool that stands.
		fixture.handle.reveal('scene-2');
		expect(fixture.memory.poolCollapsed).toBe(false);
		expect(pool.classes.has('is-hidden')).toBe(false);
		expect(fixture.poolHandle.reveal).toHaveBeenCalledWith('scene-2');
		expect(fixture.remember).toHaveBeenCalledTimes(2);
		// A restored state hands the fold to the memory; the next paint wears it.
		fixture.memory.poolCollapsed = true;
		fixture.handle.refresh();
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(true);
		expect(pool.classes.has('is-hidden')).toBe(true);
	});

	it("folds the time column to its names from the frame's left corner, and remembers it", async () => {
		const fixture = laid();
		await settle();
		const toggle = fixture.button('snowflake-method-timeline-time-toggle');
		expect(toggle.parent!.classes.has('snowflake-method-timeline-fold')).toBe(true);
		expect(toggle.parent!.classes.has('is-start')).toBe(true);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.getAttribute('aria-label')).toBe('timeline.time.collapse');
		toggle.dispatch('click');
		expect(fixture.memory.timeCollapsed).toBe(true);
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(true);
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(toggle.getAttribute('aria-label')).toBe('timeline.time.expand');
		expect(fixture.remember).toHaveBeenCalledOnce();
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(false);
		toggle.dispatch('click');
		expect(fixture.memory.timeCollapsed).toBe(false);
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(false);
		fixture.memory.timeCollapsed = true;
		fixture.handle.refresh();
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(true);
	});

	it('folds both by width alone when the workspace is narrow, and brings them back as it widens', async () => {
		const fixture = laid();
		await settle();
		const timeToggle = fixture.button('snowflake-method-timeline-time-toggle');
		const poolToggle = fixture.button('snowflake-method-timeline-pool-toggle');
		fixture.dom.resize(1200);
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(true);
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(true);
		expect(timeToggle.getAttribute('aria-expanded')).toBe('false');
		expect(poolToggle.getAttribute('aria-expanded')).toBe('false');
		// Nothing was chosen: the tab's memory is untouched and nothing is saved.
		expect(fixture.memory.timeCollapsed).toBe(false);
		expect(fixture.memory.poolCollapsed).toBe(false);
		expect(fixture.remember).not.toHaveBeenCalled();
		// A part brought back by hand while narrow stands, until the workspace widens and narrows again.
		poolToggle.dispatch('click');
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(false);
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(true);
		expect(fixture.memory.poolCollapsed).toBe(false);
		fixture.dom.resize(1600);
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(false);
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(false);
		fixture.dom.resize(1200);
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(true);
		// A part folded by choice stays folded whatever the width.
		fixture.dom.resize(1600);
		timeToggle.dispatch('click');
		expect(fixture.memory.timeCollapsed).toBe(true);
		fixture.dom.resize(1200);
		fixture.dom.resize(1600);
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(true);
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(false);
	});
});

describe('placing and moving scenes without a drag', () => {
	const laid = (readOnly = false) => workspace({
		timelines: [
			timeline('a', { times: [
				{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-1', 'scene-2'])] },
				{ timeId: 'time-2', rows: [row('r2', 'Argues')] },
			] }),
			timeline('b', { times: [{ timeId: 'time-1', rows: [row('r3', 'Waits', ['scene-3'])] }] }),
		],
		views: [view('v', ['a', 'b'], { presentation: 'flat' }), view('other', ['a'])],
	}, readOnly);
	const menuOf = (fixture: ReturnType<typeof workspace>, sceneId: string) => {
		menus.length = 0;
		fixture.cards().find((card) => card.getAttribute('data-id') === sceneId)!
			.querySelector('.snowflake-method-corkboard-more')!.dispatch('click');
		return menus[0]!;
	};
	const poolMenu = (fixture: ReturnType<typeof workspace>, sceneId: string) => {
		menus.length = 0;
		const menu = new Menu();
		fixture.corkboard.mock.calls[0]![2]!.menuItems!(sceneId, menu);
		menu.showAtMouseEvent({} as MouseEvent);
		return menus[0]!;
	};
	const capturePicker = () => {
		const opened: MoveAfterModal[] = [];
		vi.spyOn(MoveAfterModal.prototype, 'open').mockImplementation(function (this: MoveAfterModal) { opened.push(this); });
		return opened;
	};
	const choose = (modal: MoveAfterModal, id: string) => {
		modal.onChooseItem(modal.getItems().find((entry) => entry.id === id)!);
	};
	const scenesAt = (fixture: ReturnType<typeof workspace>, rowId: string): readonly string[] =>
		fixture.held().timelines.flatMap((lane) => lane.times).flatMap((time) => time.rows)
			.find((candidate) => candidate.id === rowId)!.scenes;

	it('offers one menu for moving placed scenes, with the row boundaries disabled', async () => {
		const fixture = laid();
		await settle();
		expect(menuOf(fixture, 'scene-1').map((item) => [item.title, item.disabled])).toEqual([
			['actions.edit', false], ['common.open', false], ['actions.moveUp', true], ['actions.moveDown', false],
			['timeline.scene.moveTo', false], ['timeline.scene.remove', false], ['actions.delete', false],
		]);
		menuOf(fixture, 'scene-2').find((item) => item.title === 'actions.moveUp')!.click();
		await settle();
		expect(fixture.bridge.placeScene).toHaveBeenLastCalledWith('a', 'scene-2', 'r1', 'scene-1');
		expect(scenesAt(fixture, 'r1')).toEqual(['scene-2', 'scene-1']);
		const menu = menuOf(fixture, 'scene-2');
		expect(menu.find((item) => item.title === 'actions.moveUp')!.disabled).toBe(true);
		menu.find((item) => item.title === 'actions.moveDown')!.click();
		await settle();
		expect(fixture.bridge.placeScene).toHaveBeenLastCalledWith('a', 'scene-2', 'r1', null);
		expect(scenesAt(fixture, 'r1')).toEqual(['scene-1', 'scene-2']);
		expect(menuOf(fixture, 'scene-2').find((item) => item.title === 'actions.moveDown')!.disabled).toBe(true);
	});

	it('moves a placed scene to an existing row and places a pool scene in a new row', async () => {
		const opened = capturePicker();
		const fixture = laid();
		await settle();
		menuOf(fixture, 'scene-1').find((item) => item.title === 'timeline.scene.moveTo')!.click();
		expect(opened[0]!.getItems().map((entry) => [entry.id, entry.label])).toEqual([
			['row:r1', 'Timeline a · Dawn / Arrives'], ['time:time-1', 'Timeline a · Dawn / timeline.scene.placeNewRow'],
			['row:r2', 'Timeline a · Dusk / Argues'], ['time:time-2', 'Timeline a · Dusk / timeline.scene.placeNewRow'],
		]);
		choose(opened[0]!, 'row:r2');
		await settle();
		expect(fixture.bridge.placeScene).toHaveBeenCalledWith('a', 'scene-1', 'r2', null);
		expect(scenesAt(fixture, 'r1')).toEqual(['scene-2']);
		expect(scenesAt(fixture, 'r2')).toEqual(['scene-1']);
		const pool = poolMenu(fixture, 'scene-3');
		expect(pool.map((item) => [item.title, item.disabled])).toEqual([['timeline.scene.moveTo', false]]);
		pool[0]!.click();
		choose(opened[1]!, 'time:time-2');
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledWith('a', 'time-2', '', null, ['scene-3']);
		const time = fixture.held().timelines[0]!.times[1]!;
		expect(time.rows.map((row) => row.scenes)).toEqual([['scene-1'], ['scene-3']]);
		expect(scenesAt(fixture, 'r3')).toEqual(['scene-3']);
	});

	it('places a pool scene in an existing row, then moves it to a new row without duplicating it', async () => {
		const opened = capturePicker();
		const fixture = laid();
		await settle();
		poolMenu(fixture, 'scene-3')[0]!.click();
		choose(opened[0]!, 'row:r1');
		await settle();
		expect(fixture.bridge.placeScene).toHaveBeenCalledWith('a', 'scene-3', 'r1', null);
		expect(scenesAt(fixture, 'r1')).toEqual(['scene-1', 'scene-2', 'scene-3']);
		menuOf(fixture, 'scene-3').find((item) => item.title === 'timeline.scene.moveTo')!.click();
		choose(opened[1]!, 'time:time-2');
		await settle();
		expect(scenesAt(fixture, 'r1')).toEqual(['scene-1', 'scene-2']);
		expect(fixture.held().timelines[0]!.times.flatMap((time) => time.rows).flatMap((row) => row.scenes))
			.toEqual(['scene-1', 'scene-2', 'scene-3']);
	});

	it('resolves repeated queued moves from the current row order', async () => {
		const fixture = laid();
		await settle();
		await fixture.bridge.placeScene('a', 'scene-3', 'r1', null);
		fixture.notify();
		await settle();
		vi.mocked(fixture.bridge.placeScene).mockClear();
		const up = menuOf(fixture, 'scene-3').find((item) => item.title === 'actions.moveUp')!;
		up.click();
		up.click();
		await settle();
		expect(vi.mocked(fixture.bridge.placeScene).mock.calls).toEqual([
			['a', 'scene-3', 'r1', 'scene-2'], ['a', 'scene-3', 'r1', 'scene-1'],
		]);
		expect(scenesAt(fixture, 'r1')).toEqual(['scene-3', 'scene-1', 'scene-2']);
	});

	it('keeps inactive-lane and read-only scene actions disabled even if their callbacks are invoked', async () => {
		const opened = capturePicker();
		for (const readOnly of [false, true]) {
			const fixture = laid(readOnly);
			await settle();
			const actions = menuOf(fixture, readOnly ? 'scene-1' : 'scene-3')
				.filter((item) => ['actions.moveUp', 'actions.moveDown', 'timeline.scene.moveTo'].includes(item.title));
			expect(actions.map((item) => item.disabled)).toEqual([true, true, true]);
			for (const action of actions) action.click();
			if (readOnly) {
				const pool = poolMenu(fixture, 'scene-3')[0]!;
				expect(pool.disabled).toBe(true);
				pool.click();
			}
			await settle();
			expect(fixture.bridge.placeScene).not.toHaveBeenCalled();
			expect(fixture.bridge.addRow).not.toHaveBeenCalled();
		}
		expect(opened).toHaveLength(0);
	});

	it('disables pool placement when there is no active lane or the lane has no times', async () => {
		for (const fixture of [workspace(), workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] })]) {
			await settle();
			expect(poolMenu(fixture, 'scene-1')[0]!.disabled).toBe(true);
		}
	});

	it('can move a scene whose note is read-only because placement writes the timeline', async () => {
		const fixture = laid();
		fixture.remodel({ scenes: [{ ...scene('scene-1', 'Arrival'), readOnly: true }, scene('scene-2', 'Departure')] });
		fixture.handle.refresh();
		await settle();
		const menu = menuOf(fixture, 'scene-1');
		expect(menu.find((item) => item.title === 'actions.edit')!.disabled).toBe(true);
		const down = menu.find((item) => item.title === 'actions.moveDown')!;
		expect(down.disabled).toBe(false);
		down.click();
		await settle();
		expect(fixture.bridge.placeScene).toHaveBeenCalledWith('a', 'scene-1', 'r1', null);
	});

	it.each([
		['active lane', async (fixture: ReturnType<typeof laid>) => { fixture.head('b').dispatch('click'); }],
		['view', async (fixture: ReturnType<typeof laid>) => { fixture.viewField().choose('other'); }],
		['project', async (fixture: ReturnType<typeof laid>) => { fixture.controls.projectPath = () => 'Other'; }],
		['read-only project', async (fixture: ReturnType<typeof laid>) => { fixture.remodel({ readOnly: true }); }],
		['source row', async (fixture: ReturnType<typeof laid>) => { await fixture.bridge.removeScene('a', 'scene-1'); fixture.notify(); }],
		['target row', async (fixture: ReturnType<typeof laid>) => { await fixture.bridge.deleteRow('a', 'r2'); fixture.notify(); }],
		['target time', async (fixture: ReturnType<typeof laid>) => { await fixture.bridge.removeTime('a', 'time-2'); fixture.notify(); }],
		['deleted scene', async (fixture: ReturnType<typeof laid>) => { fixture.remodel({ scenes: [scene('scene-2', 'Departure')] }); }],
		['disposed workspace', async (fixture: ReturnType<typeof laid>) => { fixture.handle.dispose(); }],
	] as const)('rejects a picker choice after its %s changes', async (_name, change) => {
		const opened = capturePicker();
		const fixture = laid();
		await settle();
		menuOf(fixture, 'scene-1').find((item) => item.title === 'timeline.scene.moveTo')!.click();
		const close = vi.spyOn(opened[0]!, 'close');
		await change(fixture);
		await settle();
		if (_name === 'disposed workspace') expect(close).toHaveBeenCalledOnce();
		choose(opened[0]!, 'row:r2');
		await settle();
		expect(fixture.bridge.placeScene).not.toHaveBeenCalled();
		expect(fixture.bridge.addRow).not.toHaveBeenCalled();
	});

	it('rechecks the lane after a picker choice waits in the write queue', async () => {
		const opened = capturePicker();
		const fixture = laid();
		await settle();
		poolMenu(fixture, 'scene-3')[0]!.click();
		choose(opened[0]!, 'time:time-2');
		fixture.head('b').dispatch('click');
		await settle();
		expect(fixture.bridge.addRow).not.toHaveBeenCalled();
	});

	it('does not recreate a time removed while the picker was open, before its notification arrives', async () => {
		const opened = capturePicker();
		const fixture = laid();
		await settle();
		poolMenu(fixture, 'scene-3')[0]!.click();
		await fixture.bridge.removeTime('a', 'time-2');
		choose(opened[0]!, 'time:time-2');
		await settle();
		expect(fixture.bridge.addRow).not.toHaveBeenCalled();
		expect(fixture.held().timelines[0]!.times.map((time) => time.timeId)).toEqual(['time-1']);
	});

	it('leaves a pool scene alone if it was placed while its picker was open, before the notification arrives', async () => {
		const opened = capturePicker();
		const fixture = laid();
		await settle();
		poolMenu(fixture, 'scene-3')[0]!.click();
		await fixture.bridge.placeScene('a', 'scene-3', 'r1', null);
		vi.mocked(fixture.bridge.placeScene).mockClear();
		choose(opened[0]!, 'row:r2');
		await settle();
		expect(fixture.bridge.placeScene).not.toHaveBeenCalled();
		expect(scenesAt(fixture, 'r1')).toEqual(['scene-1', 'scene-2', 'scene-3']);
	});
});

describe('dragging scenes', () => {
	const laid = (readOnly = false) => workspace({
		timelines: [
			timeline('a', { times: [
				{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-1'])] },
				{ timeId: 'time-2', rows: [row('r2', 'Argues')] },
			] }),
			timeline('b', { times: [{ timeId: 'time-1', rows: [row('r3', 'Waits', ['scene-3'])] }] }),
		],
		views: [view('v', ['a', 'b'], { presentation: 'flat' })],
	}, readOnly);
	type Variant = {
		dragOut: { onStart: (sceneId: string, transfer: unknown) => void; onEnd: () => void };
		dropIn: { accepts: (types: readonly string[]) => boolean; onDrop: (transfer: unknown) => void };
	};
	const variantOf = (fixture: ReturnType<typeof workspace>): Variant =>
		fixture.corkboard.mock.calls[0]![2] as unknown as Variant;
	const scenesOf = (fixture: ReturnType<typeof workspace>, timeId: string, timelineId: string, rowId: string): CorkboardElement =>
		fixture.cell(timeId, timelineId).querySelectorAll('.snowflake-method-timeline-subrow')
			.find((candidate) => candidate.getAttribute('data-row-id') === rowId)!
			.querySelector('.snowflake-method-timeline-scenes')!;
	const cardOf = (fixture: ReturnType<typeof workspace>, sceneId: string): CorkboardElement =>
		fixture.cards().find((candidate) => candidate.getAttribute('data-id') === sceneId)!;
	const dragging = (sceneId: string) => {
		const dataTransfer = transfer([TIMELINE_SCENE_DRAG_TYPE]);
		dataTransfer.setData(TIMELINE_SCENE_DRAG_TYPE, sceneId);
		return dataTransfer;
	};

	it('takes the mark with it when the pointer moves on to a lane locked out of the drag', async () => {
		const fixture = laid();
		await settle();
		const variant = variantOf(fixture);
		const dataTransfer = dragging('scene-2');
		variant.dragOut.onStart('scene-2', dataTransfer);
		const card = cardOf(fixture, 'scene-1');
		standAt(card, 0);
		const box = scenesOf(fixture, 'time-1', 'a', 'r1');
		fire(fixture.cell('time-1', 'a'), 'dragover', { target: box, clientX: 50, clientY: 10, dataTransfer });
		expect(card.classes.has('is-drop-before')).toBe(true);
		// A lane locked out of the drag takes the mark away with its refusal, as
		// a row with no place under the pointer already does.
		const foreign = dragging('scene-2');
		const foreignBox = scenesOf(fixture, 'time-1', 'b', 'r3');
		fire(fixture.cell('time-1', 'b'), 'dragover', { target: foreignBox, clientX: 10, clientY: 10, dataTransfer: foreign });
		expect(foreign.dropEffect).toBe('none');
		expect(card.classes.has('is-drop-before')).toBe(false);
		variant.dragOut.onEnd();
	});

	it('takes a pool card onto the active lane alone, before or after the card under the pointer', async () => {
		const fixture = laid();
		await settle();
		const variant = variantOf(fixture);
		const dataTransfer = dragging('scene-2');
		variant.dragOut.onStart('scene-2', dataTransfer);
		expect(fixture.root.classes.has('is-scene-drag')).toBe(true);
		expect(fixture.head('b').classes.has('is-locked-out')).toBe(true);
		expect(fixture.cell('time-1', 'b').classes.has('is-locked-out')).toBe(true);
		expect(fixture.cell('time-1', 'a').classes.has('is-drag-lane')).toBe(true);
		const foreign = dragging('scene-2');
		const foreignBox = scenesOf(fixture, 'time-1', 'b', 'r3');
		fire(fixture.cell('time-1', 'b'), 'dragover', { target: foreignBox, clientX: 10, clientY: 10, dataTransfer: foreign });
		expect(foreign.dropEffect).toBe('none');
		fire(fixture.cell('time-1', 'b'), 'drop', { target: foreignBox, dataTransfer: foreign });
		expect(fixture.bridge.placeScene).not.toHaveBeenCalled();
		const card = cardOf(fixture, 'scene-1');
		standAt(card, 0);
		const box = scenesOf(fixture, 'time-1', 'a', 'r1');
		fire(fixture.cell('time-1', 'a'), 'dragover', { target: box, clientX: 50, clientY: 10, dataTransfer });
		expect(dataTransfer.dropEffect).toBe('move');
		expect(card.classes.has('is-drop-before')).toBe(true);
		fire(fixture.cell('time-1', 'a'), 'dragover', { target: box, clientX: 50, clientY: 35, dataTransfer });
		expect(card.classes.has('is-drop-before')).toBe(false);
		expect(card.classes.has('is-drop-after')).toBe(true);
		fire(fixture.cell('time-1', 'a'), 'dragover', { target: box, clientX: 50, clientY: 10, dataTransfer });
		fire(fixture.cell('time-1', 'a'), 'drop', { target: box, dataTransfer });
		variant.dragOut.onEnd();
		expect(fixture.root.classes.has('is-scene-drag')).toBe(false);
		expect(fixture.head('b').classes.has('is-locked-out')).toBe(false);
		expect(card.classes.has('is-drop-before')).toBe(false);
		await settle();
		expect(fixture.bridge.placeScene).toHaveBeenCalledWith('a', 'scene-2', 'r1', 'scene-1');
		expect(scenesOf(fixture, 'time-1', 'a', 'r1').children.map((child) => child.getAttribute('data-id'))).toEqual(['scene-2', 'scene-1']);
	});

	it('makes a row of its own for a scene dropped on the trailing row', async () => {
		const fixture = laid();
		await settle();
		const variant = variantOf(fixture);
		const dataTransfer = dragging('scene-2');
		variant.dragOut.onStart('scene-2', dataTransfer);
		const cell = fixture.cell('time-2', 'a');
		const trailingBox = cell.querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('.snowflake-method-timeline-scenes')!;
		fire(cell, 'dragover', { target: trailingBox, clientX: 10, clientY: 10, dataTransfer });
		expect(trailingBox.classes.has('is-drop-target')).toBe(true);
		fire(cell, 'drop', { target: trailingBox, dataTransfer });
		variant.dragOut.onEnd();
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledWith('a', 'time-2', '', null, ['scene-2']);
		const rows = cell.querySelectorAll('.snowflake-method-timeline-subrow').filter((candidate) => !candidate.classes.has('is-trailing'));
		expect(rows).toHaveLength(2);
		expect(rows[1]!.querySelector('.snowflake-method-corkboard-card')!.getAttribute('data-id')).toBe('scene-2');
	});

	it('holds a card still while a control on it is pressed, and lets it drag again once the press is released', async () => {
		const fixture = laid();
		await settle();
		const card = cardOf(fixture, 'scene-1');
		expect(card.getAttribute('draggable')).toBe('true');
		// A press on the title is a click still to come, and the card stays draggable under it.
		fire(card, 'mousedown', { target: card.querySelector('.snowflake-method-corkboard-title')! });
		expect(card.getAttribute('draggable')).toBe('true');
		fire(card, 'mousedown', { target: card.querySelector('select')! });
		expect(card.getAttribute('draggable')).toBe('false');
		expect(fixture.dom.windowListeners.get('mouseup')!.map((entry) => entry.capture)).toEqual([true]);
		fixture.dom.dispatchWindow('mouseup');
		expect(card.getAttribute('draggable')).toBe('true');
	});

	it("moves a lane's card to another row of the same lane, and back to the pool", async () => {
		const fixture = laid();
		await settle();
		const variant = variantOf(fixture);
		const card = cardOf(fixture, 'scene-1');
		expect(card.getAttribute('draggable')).toBe('true');
		expect(cardOf(fixture, 'scene-3').getAttribute('draggable')).toBe('false');
		const dataTransfer = transfer([TIMELINE_SCENE_DRAG_TYPE]);
		fire(card, 'dragstart', { target: null, dataTransfer });
		expect(dataTransfer.getData(TIMELINE_SCENE_DRAG_TYPE)).toBe('scene-1');
		expect(card.classes.has('is-dragging')).toBe(true);
		expect(fixture.root.classes.has('is-scene-drag')).toBe(true);
		expect(variant.dropIn.accepts([TIMELINE_SCENE_DRAG_TYPE])).toBe(true);
		expect(variant.dropIn.accepts(['text/plain'])).toBe(false);
		const box = scenesOf(fixture, 'time-2', 'a', 'r2');
		fire(fixture.cell('time-2', 'a'), 'dragover', { target: box, clientX: 10, clientY: 10, dataTransfer });
		expect(box.classes.has('is-drop-target')).toBe(true);
		fire(fixture.cell('time-2', 'a'), 'drop', { target: box, dataTransfer });
		fire(card, 'dragend', {});
		expect(card.classes.has('is-dragging')).toBe(false);
		expect(fixture.root.classes.has('is-scene-drag')).toBe(false);
		await settle();
		expect(fixture.bridge.placeScene).toHaveBeenCalledWith('a', 'scene-1', 'r2', null);
		expect(scenesOf(fixture, 'time-2', 'a', 'r2').children.map((child) => child.getAttribute('data-id'))).toEqual(['scene-1']);
		expect(scenesOf(fixture, 'time-1', 'a', 'r1').children).toHaveLength(0);
		const moved = cardOf(fixture, 'scene-1');
		fire(moved, 'dragstart', { target: null, dataTransfer: transfer([TIMELINE_SCENE_DRAG_TYPE]) });
		variant.dropIn.onDrop(dataTransfer);
		fire(moved, 'dragend', {});
		await settle();
		expect(fixture.bridge.removeScene).toHaveBeenCalledWith('a', 'scene-1');
		expect(fixture.cards().some((candidate) => candidate.getAttribute('data-id') === 'scene-1')).toBe(false);
	});

	it('takes no scene anywhere on a project that cannot be written', async () => {
		const fixture = laid(true);
		await settle();
		const variant = variantOf(fixture);
		variant.dragOut.onStart('scene-2', dragging('scene-2'));
		expect(fixture.root.classes.has('is-scene-drag')).toBe(false);
		expect(variant.dropIn.accepts([TIMELINE_SCENE_DRAG_TYPE])).toBe(false);
		expect(fixture.cards().every((candidate) => candidate.getAttribute('draggable') === 'false')).toBe(true);
	});
});

describe('stacking scenes', () => {
	const laid = (readOnly = false) => workspace({
		timelines: [
			timeline('a', { times: [
				{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-1', 'scene-2', 'scene-3'])] },
				{ timeId: 'time-2', rows: [row('r2', 'Argues')] },
			] }),
			timeline('b', { times: [{ timeId: 'time-1', rows: [] }] }),
		],
		views: [view('v', ['a', 'b'])],
	}, readOnly);
	const boxOf = (fixture: ReturnType<typeof workspace>, timeId: string, rowId: string): CorkboardElement =>
		fixture.cell(timeId, 'a').querySelectorAll('.snowflake-method-timeline-subrow')
			.find((candidate) => candidate.getAttribute('data-row-id') === rowId)!
			.querySelector('.snowflake-method-timeline-scenes')!;
	const stackOf = (fixture: ReturnType<typeof workspace>, timeId: string, rowId: string): CorkboardElement =>
		boxOf(fixture, timeId, rowId).querySelector('.snowflake-method-timeline-stack')!;
	const shownIn = (stack: CorkboardElement): string | null =>
		stack.querySelector('.snowflake-method-corkboard-card')?.getAttribute('data-id') ?? null;
	const control = (stack: CorkboardElement, name: string): CorkboardElement =>
		stack.querySelector(`.snowflake-method-timeline-stack-${name}`)!;

	it('takes the card in front down when its scene has gone from the project', async () => {
		const fixture = laid();
		await settle();
		expect(shownIn(stackOf(fixture, 'time-1', 'r1'))).toBe('scene-1');
		// The scene in front goes from the project. Its card is nobody's to
		// reach any more: the stand-in takes the place it held, rather than
		// standing beside a card that outlived its scene.
		fixture.remodel({ scenes: [scene('scene-2', 'Departure'), scene('scene-3', 'Return')] });
		fixture.handle.refresh();
		await settle();
		expect(fixture.cards()).toHaveLength(0);
		expect(stackOf(fixture, 'time-1', 'r1').querySelectorAll('.snowflake-method-timeline-scene-missing')).toHaveLength(1);
	});

	it('shows one card of the row with the rest counted behind it, and walks them round without a write', async () => {
		const fixture = laid();
		await settle();
		expect(fixture.root.dataset.presentation).toBe('stack');
		const stack = stackOf(fixture, 'time-1', 'r1');
		expect(stack.dataset.total).toBe('3');
		expect(fixture.cards()).toHaveLength(1);
		expect(shownIn(stack)).toBe('scene-1');
		expect(fixture.translate).toHaveBeenCalledWith('timeline.stack.position', { position: 1, total: 3 });
		expect(control(stack, 'reset').disabled).toBe(true);
		expect(control(stack, 'previous').disabled).toBe(false);
		expect(control(stack, 'next').disabled).toBe(false);
		// The walk comes round: back from the first is the last, on from the last is the first.
		control(stack, 'previous').dispatch('click');
		expect(shownIn(stack)).toBe('scene-3');
		control(stack, 'next').dispatch('click');
		expect(shownIn(stack)).toBe('scene-1');
		control(stack, 'next').dispatch('click');
		expect(shownIn(stack)).toBe('scene-2');
		expect(fixture.cards()).toHaveLength(1);
		expect(control(stack, 'reset').disabled).toBe(false);
		control(stack, 'next').dispatch('click');
		expect(shownIn(stack)).toBe('scene-3');
		expect(control(stack, 'next').disabled).toBe(false);
		expect(fixture.translate).toHaveBeenCalledWith('timeline.stack.position', { position: 3, total: 3 });
		expect(fixture.memory.stackPositions.get('v|a|r1')).toBe(2);
		fixture.notify();
		await settle();
		expect(shownIn(stackOf(fixture, 'time-1', 'r1'))).toBe('scene-3');
		control(stack, 'previous').dispatch('click');
		expect(shownIn(stack)).toBe('scene-2');
		control(stack, 'reset').dispatch('click');
		expect(shownIn(stack)).toBe('scene-1');
		expect(stackOf(fixture, 'time-2', 'r2').dataset.total).toBe('0');
		expect(fixture.bridge.setViewPresentation).not.toHaveBeenCalled();
		expect(fixture.bridge.placeScene).not.toHaveBeenCalled();
	});

	it('keeps the place within the cards left, and puts the controls away for a stack of one', async () => {
		const fixture = laid();
		await settle();
		const stack = stackOf(fixture, 'time-1', 'r1');
		control(stack, 'next').dispatch('click');
		control(stack, 'next').dispatch('click');
		expect(shownIn(stack)).toBe('scene-3');
		expect(control(stack, 'controls').classes.has('is-alone')).toBe(false);
		await fixture.bridge.removeScene('a', 'scene-3');
		fixture.notify();
		await settle();
		expect(stack.dataset.total).toBe('2');
		expect(shownIn(stack)).toBe('scene-2');
		expect(fixture.memory.stackPositions.get('v|a|r1')).toBe(1);
		await fixture.bridge.removeScene('a', 'scene-2');
		fixture.notify();
		await settle();
		expect(stack.dataset.total).toBe('1');
		expect(shownIn(stack)).toBe('scene-1');
		expect(control(stack, 'controls').classes.has('is-alone')).toBe(true);
	});

	it('switches the presentation from its symbol, laying the cards flat and stacking them again', async () => {
		const fixture = laid();
		await settle();
		const button = fixture.button('snowflake-method-timeline-presentation');
		// Stacked, the symbol says so and a press lays the cards flat.
		expect(button.getAttribute('aria-label')).toBe('timeline.presentation.toFlat');
		button.dispatch('click');
		await settle();
		expect(fixture.bridge.setViewPresentation).toHaveBeenCalledWith('v', 'flat');
		expect(fixture.root.dataset.presentation).toBe('flat');
		expect(button.getAttribute('aria-label')).toBe('timeline.presentation.toStack');
		const box = boxOf(fixture, 'time-1', 'r1');
		expect(box.querySelector('.snowflake-method-timeline-stack')).toBeNull();
		expect(fixture.cards()).toHaveLength(3);
		expect(box.children.map((child) => child.getAttribute('data-id'))).toEqual(['scene-1', 'scene-2', 'scene-3']);
		button.dispatch('click');
		await settle();
		expect(fixture.bridge.setViewPresentation).toHaveBeenLastCalledWith('v', 'stack');
		expect(fixture.root.dataset.presentation).toBe('stack');
		expect(fixture.cards()).toHaveLength(1);
		expect(stackOf(fixture, 'time-1', 'r1').dataset.total).toBe('3');
	});

	it('refuses a scene back onto its own stack, and takes it at the back of another', async () => {
		const fixture = laid();
		await settle();
		const card = fixture.cards()[0]!;
		expect(card.getAttribute('data-id')).toBe('scene-1');
		expect(card.getAttribute('draggable')).toBe('true');
		const dataTransfer = transfer([TIMELINE_SCENE_DRAG_TYPE]);
		fire(card, 'dragstart', { target: null, dataTransfer });
		const own = boxOf(fixture, 'time-1', 'r1');
		fire(fixture.cell('time-1', 'a'), 'dragover', { target: own, clientX: 10, clientY: 10, dataTransfer });
		expect(dataTransfer.dropEffect).toBe('none');
		expect(own.classes.has('is-drop-target')).toBe(false);
		fire(fixture.cell('time-1', 'a'), 'drop', { target: own, dataTransfer });
		expect(fixture.bridge.placeScene).not.toHaveBeenCalled();
		const other = boxOf(fixture, 'time-2', 'r2');
		fire(fixture.cell('time-2', 'a'), 'dragover', { target: other, clientX: 10, clientY: 10, dataTransfer });
		expect(dataTransfer.dropEffect).toBe('move');
		expect(other.classes.has('is-drop-target')).toBe(true);
		fire(fixture.cell('time-2', 'a'), 'drop', { target: other, dataTransfer });
		fire(card, 'dragend', {});
		await settle();
		expect(fixture.bridge.placeScene).toHaveBeenCalledWith('a', 'scene-1', 'r2', null);
		expect(stackOf(fixture, 'time-1', 'r1').dataset.total).toBe('2');
		expect(shownIn(stackOf(fixture, 'time-1', 'r1'))).toBe('scene-2');
		expect(stackOf(fixture, 'time-2', 'r2').dataset.total).toBe('1');
		expect(shownIn(stackOf(fixture, 'time-2', 'r2'))).toBe('scene-1');
	});

	it('still walks a stack on a project that cannot be written, and changes nothing else', async () => {
		const fixture = laid(true);
		await settle();
		expect(fixture.button('snowflake-method-timeline-presentation').disabled).toBe(true);
		expect(fixture.button('snowflake-method-timeline-words').disabled).toBe(true);
		const stack = stackOf(fixture, 'time-1', 'r1');
		control(stack, 'next').dispatch('click');
		expect(shownIn(stack)).toBe('scene-2');
		expect(fixture.cards()[0]!.getAttribute('draggable')).toBe('false');
	});
});

describe('a row moved to a time painted earlier', () => {
	const laid = (presentation: 'flat' | 'stack') => workspace({
		timelines: [timeline('a', { times: [
			{ timeId: 'time-1', rows: [] },
			{ timeId: 'time-2', rows: [row('r1', 'Arrives', ['scene-1'])] },
		] })],
		views: [view('v', ['a'], { presentation })],
	});
	const cardsIn = (el: CorkboardElement): CorkboardElement[] => el.querySelectorAll('.snowflake-method-corkboard-card');
	const labelsIn = (el: CorkboardElement): (string | null)[] =>
		el.querySelectorAll('.snowflake-method-timeline-subrow-label').map((label) => label.textContent);

	it.each(['flat', 'stack'] as const)('%s: a change read from the file stands the same card under the destination at once', async (presentation) => {
		const fixture = laid(presentation);
		await settle();
		const card = cardsIn(fixture.cell('time-2', 'a'))[0]!;
		await fixture.bridge.moveRow('a', 'r1', 'time-1', null);
		fixture.notify();
		await settle();
		expect(cardsIn(fixture.cell('time-1', 'a'))).toHaveLength(1);
		expect(cardsIn(fixture.cell('time-1', 'a'))[0]).toBe(card);
		expect(labelsIn(fixture.cell('time-1', 'a'))).toEqual(['Arrives']);
		expect(labelsIn(fixture.cell('time-2', 'a'))).toEqual([]);
		expect(fixture.cards()).toHaveLength(1);
	});

	it('flat: a drag to the time above keeps the card through the write and the read that follows', async () => {
		const fixture = laid('flat');
		await settle();
		const source = fixture.cell('time-2', 'a');
		const card = cardsIn(source)[0]!;
		const handle = source.querySelector('.snowflake-method-timeline-subrow-handle')!;
		const target = fixture.cell('time-1', 'a');
		const dataTransfer = transfer([TIMELINE_ROW_DRAG_TYPE]);
		fire(handle, 'dragstart', { dataTransfer });
		fire(target, 'dragover', { clientY: 10, dataTransfer });
		fire(target, 'drop', { dataTransfer });
		fire(handle, 'dragend', {});
		await settle();
		expect(fixture.bridge.moveRow).toHaveBeenCalledWith('a', 'r1', 'time-1', null);
		expect(cardsIn(fixture.cell('time-1', 'a'))[0]).toBe(card);
		expect(fixture.cards()).toHaveLength(1);
		fixture.notify();
		await settle();
		expect(cardsIn(fixture.cell('time-1', 'a'))[0]).toBe(card);
		expect(fixture.cards()).toHaveLength(1);
	});
});

describe('a time put in after the last row', () => {
	it('stands after it in a fresh view, whatever its rank, and the order is written', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-2', rows: [] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-2']);
		vi.mocked(promptForEntityReference).mockResolvedValueOnce({ option: { value: 'time-1' } } as never);
		menus.length = 0;
		fixture.rowOf('time-2').querySelector('.snowflake-method-timeline-time-more')!.dispatch('click');
		menus[0]!.find((item) => item.title === 'timeline.time.insertAfter')!.click();
		await settle();
		expect(fixture.bridge.addTime).toHaveBeenCalledWith('a', 'time-1');
		expect(fixture.bridge.setTimeOrder).toHaveBeenCalledWith('v', ['time-2', 'time-1']);
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-2', 'time-1']);
	});

	it('writes the order the view keeps as the picker closes, not the one it kept when it opened', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-2', rows: [] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		// The picker stands open, as it may for as long as the author takes.
		let release: (picked: unknown) => void = () => undefined;
		vi.mocked(promptForEntityReference).mockReturnValueOnce(
			new Promise<unknown>((resolve) => { release = resolve; }) as never,
		);
		menus.length = 0;
		fixture.rowOf('time-2').querySelector('.snowflake-method-timeline-time-more')!.dispatch('click');
		menus[0]!.find((item) => item.title === 'timeline.time.insertAfter')!.click();
		await settle();
		// While it stands open the times are turned about, so the rows on screen
		// are no longer the rows the order was read from.
		fixture.button('snowflake-method-timeline-order').dispatch('click');
		await settle();
		expect(fixture.held().views[0]!.timesReversed).toBe(true);
		release({ option: { value: 'time-1' } });
		await settle();
		expect(fixture.bridge.addTime).toHaveBeenCalledWith('a', 'time-1');
		// Turned about, the foot is the place meant, and the order is written the
		// way the view keeps it now: the time picked last, the rest where they were.
		expect(fixture.bridge.setTimeOrder).toHaveBeenLastCalledWith('v', ['time-1', 'time-2']);
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-2', 'time-1']);
	});

	it('leaves a time added from the corner of the frame to its rank, as before', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-2', rows: [] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		vi.mocked(promptForEntityReference).mockResolvedValueOnce({ option: { value: 'time-1' } } as never);
		fixture.button('snowflake-method-timeline-time-add').dispatch('click');
		await settle();
		expect(fixture.bridge.addTime).toHaveBeenCalledWith('a', 'time-1');
		expect(fixture.bridge.setTimeOrder).not.toHaveBeenCalled();
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-1', 'time-2']);
	});
});

describe('a project written again', () => {
	it('opens the controls on the next refresh, before the document is read again', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] }, true);
		await settle();
		expect(fixture.root.classes.has('is-read-only')).toBe(true);
		expect(fixture.button('snowflake-method-timeline-add-timeline').disabled).toBe(true);
		fixture.model.readOnly = false;
		fixture.handle.refresh();
		expect(fixture.bridge.read).toHaveBeenCalledOnce();
		expect(fixture.root.classes.has('is-read-only')).toBe(false);
		expect(fixture.button('snowflake-method-timeline-add-timeline').disabled).toBe(false);
		expect(fixture.button('snowflake-method-timeline-view-add').disabled).toBe(false);
		fixture.model.readOnly = true;
		fixture.handle.refresh();
		expect(fixture.root.classes.has('is-read-only')).toBe(true);
		expect(fixture.button('snowflake-method-timeline-add-timeline').disabled).toBe(true);
	});
});

describe('a row moved while a conflict is being written on one of its cards', () => {
	const laid = (presentation: 'flat' | 'stack', order: 'down' | 'up') => workspace({
		timelines: [timeline('a', { times: order === 'down'
			? [{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-1'])] }, { timeId: 'time-2', rows: [] }]
			: [{ timeId: 'time-1', rows: [] }, { timeId: 'time-2', rows: [row('r1', 'Arrives', ['scene-1'])] }],
		})],
		views: [view('v', ['a'], { presentation })],
	});
	const cardsIn = (el: CorkboardElement): CorkboardElement[] => el.querySelectorAll('.snowflake-method-corkboard-card');
	const conflictOf = (card: CorkboardElement): CorkboardElement => card.querySelector('.snowflake-method-corkboard-conflict')!;

	it.each([
		['flat', 'down'], ['stack', 'down'], ['flat', 'up'], ['stack', 'up'],
	] as const)('%s, moved %s: the draft, its card and the focus go over to the destination unsaved', async (presentation, order) => {
		const fixture = laid(presentation, order);
		await settle();
		const [from, to] = order === 'down' ? ['time-1', 'time-2'] : ['time-2', 'time-1'];
		const card = cardsIn(fixture.cell(from, 'a'))[0]!;
		conflictOf(card).focus();
		conflictOf(card).value = 'Unsaved draft';
		conflictOf(card).dispatch('input');
		await fixture.bridge.moveRow('a', 'r1', to, null);
		fixture.notify();
		await settle();
		expect(cardsIn(fixture.cell(to, 'a'))[0]).toBe(card);
		expect(fixture.cards()).toHaveLength(1);
		expect(conflictOf(card).value).toBe('Unsaved draft');
		expect(fixture.dom.doc.activeElement).toBe(conflictOf(card));
		expect(fixture.host.patchScene).not.toHaveBeenCalled();
	});

	it('saves the draft when the placement itself goes from under it', async () => {
		const fixture = laid('flat', 'down');
		await settle();
		const card = cardsIn(fixture.cell('time-1', 'a'))[0]!;
		conflictOf(card).value = 'Unsaved draft';
		conflictOf(card).dispatch('input');
		await fixture.bridge.deleteRow('a', 'r1');
		fixture.notify();
		await settle();
		expect(fixture.cards()).toHaveLength(0);
		expect(fixture.host.patchScene).toHaveBeenCalledOnce();
		const patch = vi.mocked(fixture.host.patchScene).mock.calls[0]!.find((arg) => typeof arg === 'object' && arg !== null && 'conflict' in arg);
		expect(patch).toMatchObject({ conflict: 'Unsaved draft' });
	});
});

describe('a placement taken away while a conflict is being written on its card', () => {
	const laid = (presentation: 'flat' | 'stack') => workspace({
		timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-1', 'scene-2'])] }] })],
		views: [view('v', ['a'], { presentation })],
	});
	const conflictOf = (card: CorkboardElement): CorkboardElement => card.querySelector('.snowflake-method-corkboard-conflict')!;
	const savedConflict = (fixture: ReturnType<typeof workspace>): unknown =>
		vi.mocked(fixture.host.patchScene).mock.calls[0]!.find((arg) => typeof arg === 'object' && arg !== null && 'conflict' in arg);

	it.each(['flat', 'stack'] as const)('%s: the draft is saved before the card comes down', async (presentation) => {
		const fixture = laid(presentation);
		await settle();
		const card = fixture.cards().find((candidate) => candidate.getAttribute('data-id') === 'scene-1')!;
		conflictOf(card).focus();
		conflictOf(card).value = 'Unsaved draft';
		conflictOf(card).dispatch('input');
		await fixture.bridge.removeScene('a', 'scene-1');
		fixture.notify();
		await settle();
		expect(fixture.cards().map((candidate) => candidate.getAttribute('data-id'))).toEqual(['scene-2']);
		expect(fixture.host.patchScene).toHaveBeenCalledOnce();
		expect(savedConflict(fixture)).toMatchObject({ conflict: 'Unsaved draft' });
	});

	it('stack: walking on from a card with a draft saves it as the card comes down', async () => {
		const fixture = laid('stack');
		await settle();
		const card = fixture.cards()[0]!;
		expect(card.getAttribute('data-id')).toBe('scene-1');
		conflictOf(card).value = 'Unsaved draft';
		conflictOf(card).dispatch('input');
		fixture.root.querySelector('.snowflake-method-timeline-stack-next')!.dispatch('click');
		expect(fixture.cards().map((candidate) => candidate.getAttribute('data-id'))).toEqual(['scene-2']);
		await settle();
		expect(fixture.host.patchScene).toHaveBeenCalledOnce();
		expect(savedConflict(fixture)).toMatchObject({ conflict: 'Unsaved draft' });
	});

	it('keeps the draft for the writer when the scene itself has gone, without a write that can only fail', async () => {
		const fixture = laid('flat');
		await settle();
		const card = fixture.cards().find((candidate) => candidate.getAttribute('data-id') === 'scene-1')!;
		conflictOf(card).focus();
		conflictOf(card).value = 'Unsaved draft';
		conflictOf(card).dispatch('input');
		const opened: CorkboardDraftModal[] = [];
		vi.spyOn(CorkboardDraftModal.prototype, 'open').mockImplementation(function (this: CorkboardDraftModal) { opened.push(this); });
		// The note goes, not the placement alone: the model no longer holds it,
		// so a write of the draft could only come back as an error.
		// A project refresh hands the workspace another model, as it does in the
		// app: the scenes this one holds are not the scenes the last one held.
		const scenes = (fixture.model as unknown as ProjectDashboardModel).scenes
			.filter((scene) => scene.id !== 'scene-1');
		fixture.remodel({ scenes });
		fixture.handle.refresh();
		await settle();
		expect(fixture.host.patchScene).not.toHaveBeenCalled();
		expect(opened).toHaveLength(1);
		expect(fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-scene-missing')).not.toBeNull();
		vi.restoreAllMocks();
	});
});

describe('words typed at the foot of a cell whose write does not land', () => {
	const laid = () => workspace({
		timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Arrives')] }] })],
		views: [view('v', ['a'])],
	});
	const subrows = (cell: CorkboardElement): CorkboardElement[] =>
		cell.querySelector('.snowflake-method-timeline-rows')!.children;
	const trailingInput = (cell: CorkboardElement): CorkboardElement =>
		cell.querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!;
	/** The words a recovery dialog was opened on, in the order it shows them. */
	const recovered = (modal: TimelineDraftModal): { place: string; words: string }[] =>
		(modal as unknown as { drafts: { place: string; words: string }[] }).drafts;
	const watchRecovery = (): TimelineDraftModal[] => {
		const opened: TimelineDraftModal[] = [];
		vi.spyOn(TimelineDraftModal.prototype, 'open').mockImplementation(function (this: TimelineDraftModal) { opened.push(this); });
		return opened;
	};

	it.each([
		['refused', (fixture: ReturnType<typeof workspace>) => { vi.mocked(fixture.bridge.addRow).mockResolvedValueOnce(null); }],
		['failed', (fixture: ReturnType<typeof workspace>) => { vi.mocked(fixture.bridge.addRow).mockRejectedValueOnce(new Error('The vault could not be written')); }],
	] as const)('%s: the pending row comes down and the words go back to the input', async (_case, arrange) => {
		const fixture = laid();
		await settle();
		const cell = fixture.cell('time-1', 'a');
		const input = trailingInput(cell);
		arrange(fixture);
		input.focus();
		input.value = 'Leaves';
		press(input, 'Enter', { mod: true });
		expect(input.value).toBe('');
		expect(cell.querySelector('.snowflake-method-timeline-subrow.is-pending')).not.toBeNull();
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledWith('a', 'time-1', 'Leaves', null);
		expect(cell.querySelector('.snowflake-method-timeline-subrow.is-pending')).toBeNull();
		expect(subrows(cell).map((child) => child.getAttribute('data-row-id') ?? child.classes.has('is-trailing'))).toEqual(['r1', true]);
		expect(input.value).toBe('Leaves');
		expect(fixture.dom.doc.activeElement).toBe(input);
		expect(fixture.held().timelines[0]!.times[0]!.rows.map((entry) => entry.text)).toEqual(['Arrives']);
	});

	it('puts the words back ahead of what was typed since', async () => {
		const fixture = laid();
		await settle();
		const cell = fixture.cell('time-1', 'a');
		const input = trailingInput(cell);
		vi.mocked(fixture.bridge.addRow).mockResolvedValueOnce(null);
		input.value = 'Leaves';
		press(input, 'Enter', { mod: true });
		input.value = 'Returns';
		await settle();
		expect(input.value).toBe('Leaves\nReturns');
	});

	it('takes the pending row down only once a written row has been read back', async () => {
		const fixture = laid();
		await settle();
		const cell = fixture.cell('time-1', 'a');
		const input = trailingInput(cell);
		input.value = 'Leaves';
		press(input, 'Enter', { mod: true });
		await settle();
		expect(input.value).toBe('');
		expect(subrows(cell).map((child) => child.getAttribute('data-row-id') ?? child.classes.has('is-trailing'))).toEqual(['r1', 'timeline-row-1', true]);
	});

	it('shows the words for keeping when the lane they were typed on has gone', async () => {
		const fixture = laid();
		await settle();
		const input = trailingInput(fixture.cell('time-1', 'a'));
		const opened: TimelineDraftModal[] = [];
		vi.spyOn(TimelineDraftModal.prototype, 'open').mockImplementation(function (this: TimelineDraftModal) { opened.push(this); });
		// The lane goes while the write is on its way, so there is no foot for
		// the words to come back to, at this paint or at any after it.
		vi.mocked(fixture.bridge.addRow).mockImplementationOnce(async () => {
			await fixture.bridge.deleteTimeline('a');
			return null;
		});
		input.value = 'Leaves';
		press(input, 'Enter', { mod: true });
		await settle();
		expect(fixture.held().timelines).toHaveLength(0);
		expect(opened).toHaveLength(1);
		vi.restoreAllMocks();
	});

	it('takes the pending row down even when the paint after the write throws', async () => {
		const fixture = laid();
		await settle();
		const cell = fixture.cell('time-1', 'a');
		const input = trailingInput(cell);
		fixture.poolHandle.refresh.mockImplementationOnce(() => { throw new Error('The pool could not be painted'); });
		input.value = 'Leaves';
		press(input, 'Enter', { mod: true });
		await settle();
		// The write landed and the paint after it did not. The row that stood in
		// for the write must still come down, or it stands beside the real one.
		expect(fixture.bridge.addRow).toHaveBeenCalledOnce();
		expect(cell.querySelector('.snowflake-method-timeline-subrow.is-pending')).toBeNull();
	});

	it('leaves words being composed in the foot alone, and puts the refused ones in once it ends', async () => {
		const fixture = laid();
		await settle();
		const input = trailingInput(fixture.cell('time-1', 'a'));
		vi.mocked(fixture.bridge.addRow).mockResolvedValueOnce(null);
		input.value = 'Leaves';
		press(input, 'Enter', { mod: true });
		// The next words are being composed when the refusal comes back.
		input.dispatch('compositionstart');
		input.value = 'ni';
		await settle();
		expect(input.value).toBe('ni');
		input.dispatch('compositionend');
		expect(input.value).toBe('Leaves\nni');
	});

	it('writes the words to the lane they were typed on, where a lane\'s id carries the mark keys are joined on', async () => {
		const fixture = workspace({
			timelines: [
				timeline('a', { times: [{ timeId: 'time-1', rows: [] }] }),
				timeline('a|b', { times: [{ timeId: 'time-1', rows: [] }] }),
			],
			views: [view('v', ['a', 'a|b'])],
		});
		await settle();
		const input = fixture.cell('time-1', 'a|b')
			.querySelector('.snowflake-method-timeline-subrow.is-trailing')!
			.querySelector('textarea')!;
		input.value = 'Belongs to the second lane';
		input.dispatch('input');
		fixture.handle.dispose();
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledWith('a|b', 'time-1', 'Belongs to the second lane', null);
		expect(fixture.bridge.addRow).not.toHaveBeenCalledWith('a', 'b|time-1', 'Belongs to the second lane', null);
	});

	it('shows the words typed since along with the refused ones when the lane has gone', async () => {
		const fixture = laid();
		await settle();
		const input = trailingInput(fixture.cell('time-1', 'a'));
		const opened = watchRecovery();
		vi.mocked(fixture.bridge.addRow).mockImplementationOnce(async () => {
			await fixture.bridge.deleteTimeline('a');
			return null;
		});
		input.value = 'First submitted words';
		press(input, 'Enter', { mod: true });
		// The foot is emptied by the submission and written in again while it is away.
		input.value = 'Later unsubmitted words';
		input.dispatch('input');
		await settle();
		// Both are the author's, and neither has a foot to go back to.
		expect(opened).toHaveLength(1);
		expect(recovered(opened[0]!).map((draft) => draft.words)).toEqual(['First submitted words\nLater unsubmitted words']);
		vi.restoreAllMocks();
	});

	it('shows words never submitted for keeping as soon as their lane has gone', async () => {
		const fixture = laid();
		await settle();
		const input = trailingInput(fixture.cell('time-1', 'a'));
		const opened = watchRecovery();
		input.value = 'Never sent anywhere';
		input.dispatch('input');
		// The lane goes from another pane. There is no foot for these words at
		// this paint or any after it, so they are not left until the tab closes.
		await fixture.bridge.deleteTimeline('a');
		fixture.notify();
		await settle();
		expect(opened).toHaveLength(1);
		expect(recovered(opened[0]!).map((draft) => draft.words)).toEqual(['Never sent anywhere']);
		vi.restoreAllMocks();
	});

	it('shows the words typed since for keeping when the lane goes while a write that landed was away', async () => {
		const fixture = laid();
		await settle();
		const input = trailingInput(fixture.cell('time-1', 'a'));
		const opened = watchRecovery();
		const real = vi.mocked(fixture.bridge.addRow).getMockImplementation()!;
		// The row is written, and the lane goes from another pane before the
		// read that follows the write comes back.
		vi.mocked(fixture.bridge.addRow).mockImplementationOnce(async (...args) => {
			const id = await real(...args);
			await fixture.bridge.deleteTimeline('a');
			return id;
		});
		input.value = 'Successfully submitted';
		press(input, 'Enter', { mod: true });
		input.value = 'Later words need recovery';
		input.dispatch('input');
		await settle();
		// The words that were written went with the lane, and are not the
		// author's to keep twice; the ones never sent are theirs and are shown.
		expect(opened).toHaveLength(1);
		expect(recovered(opened[0]!).map((draft) => draft.words)).toEqual(['Later words need recovery']);
		vi.restoreAllMocks();
	});

	it('writes the words a composition held back when the workspace goes', async () => {
		const fixture = laid();
		await settle();
		const input = trailingInput(fixture.cell('time-1', 'a'));
		vi.mocked(fixture.bridge.addRow).mockResolvedValueOnce(null);
		input.value = 'Must survive';
		press(input, 'Enter', { mod: true });
		input.dispatch('compositionstart');
		input.value = 'ni';
		input.dispatch('input');
		await settle();
		// The refused words wait on the composition, which the closing tab ends.
		expect(input.value).toBe('ni');
		fixture.handle.dispose();
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenLastCalledWith('a', 'time-1', 'Must survive\nni', null);
	});

	it('gives the words a composition held back to the foot built after it', async () => {
		const fixture = laid();
		await settle();
		const input = trailingInput(fixture.cell('time-1', 'a'));
		vi.mocked(fixture.bridge.addRow).mockResolvedValueOnce(null);
		input.value = 'Deferred before rebuild';
		press(input, 'Enter', { mod: true });
		input.dispatch('compositionstart');
		input.value = 'ni';
		input.dispatch('input');
		await settle();
		// The time is taken off the lane from another pane and put back: the
		// cell, and the foot standing in it, are built afresh.
		await fixture.bridge.removeTime('a', 'time-1');
		fixture.notify();
		await settle();
		await fixture.bridge.addTime('a', 'time-1');
		fixture.notify();
		await settle();
		expect(trailingInput(fixture.cell('time-1', 'a')).value).toBe('Deferred before rebuild\nni');
	});
});

describe('a draft whose save fails once its card has come down', () => {
	const laid = (presentation: 'flat' | 'stack') => workspace({
		timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-1'])] }] })],
		views: [view('v', ['a'], { presentation })],
	});

	it.each(['flat', 'stack'] as const)('%s: goes to the recovery dialog rather than into the card nobody can reach', async (presentation) => {
		const opened: CorkboardDraftModal[] = [];
		const open = vi.spyOn(CorkboardDraftModal.prototype, 'open').mockImplementation(function (this: CorkboardDraftModal) { opened.push(this); });
		try {
			const fixture = laid(presentation);
			await settle();
			const card = fixture.cards()[0]!;
			const conflict = card.querySelector('.snowflake-method-corkboard-conflict')!;
			conflict.focus();
			conflict.value = 'Unsaved draft';
			conflict.dispatch('input');
			vi.mocked(fixture.host.patchScene).mockRejectedValueOnce(new Error('Revision conflict'));
			await fixture.bridge.removeScene('a', 'scene-1');
			fixture.notify();
			await settle();
			expect(fixture.cards()).toHaveLength(0);
			expect(fixture.host.patchScene).toHaveBeenCalledOnce();
			expect(opened).toHaveLength(1);
			const recoveryDom = new CorkboardDom();
			Object.assign(opened[0]!, { contentEl: recoveryDom.container, setTitle: vi.fn() });
			opened[0]!.onOpen();
			expect(recoveryDom.container.querySelector('textarea')!.value).toBe('Unsaved draft');
		} finally {
			open.mockRestore();
		}
	});
});

describe('words typed at a cell\'s foot whose write fails after the view has changed', () => {
	it('come back to the foot of that cell whenever its view is shown, until written or cleared', async () => {
		const fixture = workspace({
			timelines: [
				timeline('a', { times: [{ timeId: 'time-1', rows: [] }] }),
				timeline('b', { times: [{ timeId: 'time-1', rows: [] }] }),
			],
			views: [view('va', ['a']), view('vb', ['b'])],
			lastViewId: 'va',
		});
		await settle();
		const trailingOf = (timelineId: string): CorkboardElement =>
			fixture.cell('time-1', timelineId).querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!;
		let refuse!: (value: null) => void;
		vi.mocked(fixture.bridge.addRow).mockImplementationOnce(() => new Promise<null>((resolve) => { refuse = resolve; }));
		const first = trailingOf('a');
		first.value = 'Leaves before sunrise';
		first.dispatch('blur');
		await settle();
		expect(fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-subrow.is-pending')).not.toBeNull();
		fixture.viewField().choose('vb');
		await settle();
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['b']);
		refuse(null);
		await settle();
		expect(trailingOf('b').value).toBe('');
		fixture.viewField().choose('va');
		await settle();
		const again = trailingOf('a');
		expect(again).not.toBe(first);
		expect(again.value).toBe('Leaves before sunrise');
		expect(fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-subrow.is-pending')).toBeNull();
		expect(fixture.bridge.addRow).toHaveBeenCalledOnce();
		// Shown again is not spent: another round trip, untouched, still shows the words.
		fixture.viewField().choose('vb');
		await settle();
		fixture.viewField().choose('va');
		await settle();
		expect(trailingOf('a').value).toBe('Leaves before sunrise');
		// Words typed since go with them, and Escape clears them for good.
		const edited = trailingOf('a');
		edited.value = 'Leaves before sunrise, alone';
		edited.dispatch('input');
		fixture.viewField().choose('vb');
		await settle();
		fixture.viewField().choose('va');
		await settle();
		expect(trailingOf('a').value).toBe('Leaves before sunrise, alone');
		press(trailingOf('a'), 'Escape');
		fixture.viewField().choose('vb');
		await settle();
		fixture.viewField().choose('va');
		await settle();
		expect(trailingOf('a').value).toBe('');
		// Written, the words are a row and the foot stays empty across a rebuild.
		const last = trailingOf('a');
		last.value = 'Returns at dusk';
		last.dispatch('input');
		last.dispatch('blur');
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledTimes(2);
		fixture.viewField().choose('vb');
		await settle();
		fixture.viewField().choose('va');
		await settle();
		expect(trailingOf('a').value).toBe('');
		expect(fixture.held().timelines[0]!.times[0]!.rows.map((entry) => entry.text)).toEqual(['Returns at dusk']);
	});
});

describe('an edit of an existing sub-description whose write does not land', () => {
	const laid = () => workspace({
		timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Arrives')] }] })],
		views: [view('v', ['a'])],
	});
	const rowEl = (fixture: ReturnType<typeof workspace>): CorkboardElement =>
		fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-rows')!.children[0]!;
	const labelOf = (fixture: ReturnType<typeof workspace>): CorkboardElement => rowEl(fixture).querySelector('.snowflake-method-timeline-subrow-label')!;
	const inputOf = (fixture: ReturnType<typeof workspace>): CorkboardElement => rowEl(fixture).querySelector('.snowflake-method-timeline-subrow-input')!;

	it.each([
		['refused', (fixture: ReturnType<typeof workspace>) => { vi.mocked(fixture.bridge.editRow).mockResolvedValueOnce('refused'); }],
		['failed', (fixture: ReturnType<typeof workspace>) => { vi.mocked(fixture.bridge.editRow).mockRejectedValueOnce(new Error('The vault could not be written')); }],
	] as const)('%s: the label shows the stored words, the next edit opens on the typed ones, and they write on the next try', async (_case, arrange) => {
		const fixture = laid();
		await settle();
		arrange(fixture);
		labelOf(fixture).dispatch('click');
		inputOf(fixture).value = 'Author new paragraphs';
		press(inputOf(fixture), 'Enter', { mod: true });
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledWith('a', 'r1', 'Author new paragraphs');
		expect(labelOf(fixture).textContent).toBe('Arrives');
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Arrives');
		labelOf(fixture).dispatch('click');
		expect(inputOf(fixture).value).toBe('Author new paragraphs');
		press(inputOf(fixture), 'Enter', { mod: true });
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledTimes(2);
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Author new paragraphs');
		expect(labelOf(fixture).textContent).toBe('Author new paragraphs');
		labelOf(fixture).dispatch('click');
		expect(inputOf(fixture).value).toBe('Author new paragraphs');
	});

	it('lets the kept words go on Escape, and on a commit back to the stored words', async () => {
		const fixture = laid();
		await settle();
		vi.mocked(fixture.bridge.editRow).mockResolvedValueOnce('refused');
		labelOf(fixture).dispatch('click');
		inputOf(fixture).value = 'Author new paragraphs';
		press(inputOf(fixture), 'Enter', { mod: true });
		await settle();
		labelOf(fixture).dispatch('click');
		expect(inputOf(fixture).value).toBe('Author new paragraphs');
		press(inputOf(fixture), 'Escape');
		labelOf(fixture).dispatch('click');
		expect(inputOf(fixture).value).toBe('Arrives');
		press(inputOf(fixture), 'Escape');
		vi.mocked(fixture.bridge.editRow).mockResolvedValueOnce('refused');
		labelOf(fixture).dispatch('click');
		inputOf(fixture).value = 'Once more';
		press(inputOf(fixture), 'Enter', { mod: true });
		await settle();
		labelOf(fixture).dispatch('click');
		expect(inputOf(fixture).value).toBe('Once more');
		inputOf(fixture).value = 'Arrives';
		press(inputOf(fixture), 'Enter', { mod: true });
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledTimes(2);
		labelOf(fixture).dispatch('click');
		expect(inputOf(fixture).value).toBe('Arrives');
	});
});

describe('the timeline workspace owns its dialogs', () => {
	it('closes nested forms, settles the creation promise, and refuses their stale submissions', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		const views: TimelineViewFormModal[] = [];
		const timelines: AddTimelineModal[] = [];
		const viewOpen = vi.spyOn(TimelineViewFormModal.prototype, 'open').mockImplementation(function (this: TimelineViewFormModal) {
			Object.assign(this, { contentEl: { empty: vi.fn() } });
			views.push(this);
		});
		const timelineOpen = vi.spyOn(AddTimelineModal.prototype, 'open').mockImplementation(function (this: AddTimelineModal) {
			Object.assign(this, { contentEl: { empty: vi.fn() } });
			timelines.push(this);
		});
		try {
			fixture.button('snowflake-method-timeline-view-add').dispatch('click');
			const form = views[0]!;
			const options = (form as unknown as { options: { addTimeline: () => Promise<string | null> } }).options;
			const pending = options.addTimeline();
			const nested = timelines[0]!;
			const closeView = vi.spyOn(form, 'close').mockImplementation(() => { form.onClose(); });
			const closeTimeline = vi.spyOn(nested, 'close').mockImplementation(() => { nested.onClose(); });
			fixture.handle.dispose();
			fixture.handle.dispose();
			await expect(pending).resolves.toBeNull();
			expect(closeView).toHaveBeenCalledOnce();
			expect(closeTimeline).toHaveBeenCalledOnce();
			await submit(form, { name: 'Too late', timelines: ['a'] });
			await submit(nested, { name: 'Too late', binding: null, addToView: true });
			await expect(options.addTimeline()).resolves.toBeNull();
			expect(fixture.bridge.createView).not.toHaveBeenCalled();
			expect(fixture.bridge.createTimeline).not.toHaveBeenCalled();
			expect(fixture.bridge.setLastView).not.toHaveBeenCalled();
			expect(timelines).toHaveLength(1);
		} finally {
			viewOpen.mockRestore();
			timelineOpen.mockRestore();
		}
	});

	it('writes the words at a foot even when a standing dialog throws on the way out', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		const opened: TimelineViewFormModal[] = [];
		const open = vi.spyOn(TimelineViewFormModal.prototype, 'open').mockImplementation(function (this: TimelineViewFormModal) {
			Object.assign(this, { contentEl: { empty: vi.fn() } });
			opened.push(this);
		});
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			fixture.button('snowflake-method-timeline-view-edit').dispatch('click');
			const form = opened[0]!;
			vi.spyOn(form, 'close').mockImplementation(() => { throw new Error('The dialog would not close'); });
			const foot = fixture.cell('time-1', 'a')
				.querySelector('.snowflake-method-timeline-subrow.is-trailing')!
				.querySelector('textarea')!;
			foot.value = 'Words behind a stuck dialog';
			foot.dispatch('input');
			// The dialog throws as the workspace goes, and the words are settled
			// after it in dispose. They are the author's, with no second chance,
			// so a dialog that will not close must not carry them off.
			fixture.handle.dispose();
			await settle();
			expect(fixture.bridge.addRow).toHaveBeenCalledWith('a', 'time-1', 'Words behind a stuck dialog', null);
			expect(logged).toHaveBeenCalledWith('Snowflake: a timeline dialog could not be closed', expect.any(Error));
		} finally {
			open.mockRestore();
			logged.mockRestore();
		}
	});

	it('closes the form still standing, and lets a dismissed one lie', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		const opened: TimelineViewFormModal[] = [];
		const open = vi.spyOn(TimelineViewFormModal.prototype, 'open').mockImplementation(function (this: TimelineViewFormModal) {
			Object.assign(this, { contentEl: { empty: vi.fn() } });
			opened.push(this);
		});
		try {
			fixture.button('snowflake-method-timeline-view-edit').dispatch('click');
			const dismissed = opened[0]!;
			const closeDismissed = vi.spyOn(dismissed, 'close').mockImplementation(() => { dismissed.onClose(); });
			dismissed.close();
			// A second form is still open when the workspace goes: that one is
			// closed, and the one already dismissed is not closed a second time.
			fixture.button('snowflake-method-timeline-view-edit').dispatch('click');
			const still = opened[1]!;
			const closeStill = vi.spyOn(still, 'close').mockImplementation(() => { still.onClose(); });
			fixture.handle.dispose();
			expect(closeStill).toHaveBeenCalledOnce();
			expect(closeDismissed).toHaveBeenCalledOnce();
		} finally {
			open.mockRestore();
		}
	});

	it('closes a standing confirmation as a decline', async () => {
		const fixture = workspace({ timelines: [timeline('a')], views: [view('v', ['a'])] });
		await settle();
		const actual = await vi.importActual<typeof import('../../src/ui/timeline-forms')>('../../src/ui/timeline-forms');
		const confirmations: import('obsidian').Modal[] = [];
		const closes: ReturnType<typeof vi.spyOn>[] = [];
		vi.mocked(confirmTimelineAction).mockImplementationOnce((app, translate, spec, keep) =>
			actual.confirmTimelineAction(app, translate, spec, (modal) => {
				Object.assign(modal, { contentEl: { empty: vi.fn() } });
				const owned: import('obsidian').Modal = modal;
				vi.spyOn(owned, 'open').mockImplementation(() => undefined);
				closes.push(vi.spyOn(owned, 'close').mockImplementation(() => { owned.onClose(); }));
				confirmations.push(modal);
				return keep!(modal);
			}));
		const forms: TimelineViewFormModal[] = [];
		const open = vi.spyOn(TimelineViewFormModal.prototype, 'open').mockImplementation(function (this: TimelineViewFormModal) {
			Object.assign(this, { contentEl: { empty: vi.fn() } });
			vi.spyOn(this, 'close').mockImplementation(() => { this.onClose(); });
			forms.push(this);
		});
		try {
			fixture.button('snowflake-method-timeline-view-edit').dispatch('click');
			const options = (forms[0] as unknown as { options: { deleteView: () => Promise<boolean> } }).options;
			const pending = options.deleteView();
			expect(confirmations).toHaveLength(1);
			fixture.handle.dispose();
			await expect(pending).resolves.toBe(false);
			expect(closes[0]).toHaveBeenCalledOnce();
			expect(fixture.bridge.deleteView).not.toHaveBeenCalled();
		} finally {
			open.mockRestore();
			vi.mocked(confirmTimelineAction).mockClear();
		}
	});
});

describe('words still being written when the workspace goes', () => {
	const laid = () => workspace({
		timelines: [
			timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Arrives')] }] }),
			timeline('b', { times: [{ timeId: 'time-1', rows: [] }] }),
		],
		views: [view('va', ['a']), view('vb', ['b'])],
		lastViewId: 'va',
	});
	const trailingOf = (fixture: ReturnType<typeof workspace>, timelineId: string): CorkboardElement =>
		fixture.cell('time-1', timelineId).querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!;

	it('writes an open edit of a row without a blur', async () => {
		const fixture = laid();
		await settle();
		const first = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-rows')!.children[0]!;
		first.querySelector('.snowflake-method-timeline-subrow-label')!.dispatch('click');
		const input = first.querySelector('.snowflake-method-timeline-subrow-input')!;
		input.value = 'Author new paragraphs';
		fixture.handle.dispose();
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledWith('a', 'r1', 'Author new paragraphs');
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Author new paragraphs');
	});

	it('writes the words at a shown foot and those kept for a foot not shown', async () => {
		const fixture = laid();
		await settle();
		const foot = trailingOf(fixture, 'a');
		foot.value = 'Leaves before sunrise';
		foot.dispatch('input');
		fixture.viewField().choose('vb');
		await settle();
		const other = trailingOf(fixture, 'b');
		other.value = 'Waits';
		other.dispatch('input');
		fixture.handle.dispose();
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledTimes(2);
		expect(fixture.bridge.addRow).toHaveBeenCalledWith('a', 'time-1', 'Leaves before sunrise', null);
		expect(fixture.bridge.addRow).toHaveBeenCalledWith('b', 'time-1', 'Waits', null);
		expect(fixture.held().timelines[0]!.times[0]!.rows.map((entry) => entry.text)).toEqual(['Arrives', 'Leaves before sunrise']);
		expect(fixture.held().timelines[1]!.times[0]!.rows.map((entry) => entry.text)).toEqual(['Waits']);
	});

	it('writes nothing when nothing was being written', async () => {
		const fixture = laid();
		await settle();
		fixture.handle.dispose();
		await settle();
		expect(fixture.bridge.editRow).not.toHaveBeenCalled();
		expect(fixture.bridge.addRow).not.toHaveBeenCalled();
	});
});

describe('an older edit of a row failing after a newer one', () => {
	it('keeps nothing: the newer words stand in the document and open the editor', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Original')] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		const rowEl = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-rows')!.children[0]!;
		const label = rowEl.querySelector('.snowflake-method-timeline-subrow-label')!;
		const input = rowEl.querySelector('.snowflake-method-timeline-subrow-input')!;
		let finishA!: (result: 'refused') => void;
		vi.mocked(fixture.bridge.editRow).mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve; }));
		label.dispatch('click');
		input.value = 'Earlier edit A';
		press(input, 'Enter', { mod: true });
		await settle();
		label.dispatch('click');
		input.value = 'Later edit B';
		press(input, 'Enter', { mod: true });
		await settle();
		finishA('refused');
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledTimes(2);
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Later edit B');
		expect(label.textContent).toBe('Later edit B');
		label.dispatch('click');
		expect(input.value).toBe('Later edit B');
	});
});

describe('words kept from a row\'s failed write when the workspace goes', () => {
	it('are written once more at disposal, with the editor closed', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Arrives')] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		const rowEl = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-rows')!.children[0]!;
		const label = rowEl.querySelector('.snowflake-method-timeline-subrow-label')!;
		const input = rowEl.querySelector('.snowflake-method-timeline-subrow-input')!;
		vi.mocked(fixture.bridge.editRow).mockResolvedValueOnce('refused');
		label.dispatch('click');
		input.value = 'Unwritten row draft';
		press(input, 'Enter', { mod: true });
		await settle();
		expect(rowEl.classes.has('is-editing')).toBe(false);
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Arrives');
		fixture.handle.dispose();
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledTimes(2);
		expect(fixture.bridge.editRow).toHaveBeenLastCalledWith('a', 'r1', 'Unwritten row draft');
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Unwritten row draft');
	});
});

describe('a final write that fails once the workspace has gone', () => {
	const laid = () => workspace({
		timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Arrives')] }] })],
		views: [view('v', ['a'])],
	});
	const watching = () => {
		const opened: TimelineDraftModal[] = [];
		const open = vi.spyOn(TimelineDraftModal.prototype, 'open').mockImplementation(function (this: TimelineDraftModal) { opened.push(this); });
		const shown = (): { place: string; words: string }[] => {
			const dom = new CorkboardDom();
			Object.assign(opened[0]!, { contentEl: dom.container, setTitle: vi.fn() });
			opened[0]!.onOpen();
			const places = dom.container.querySelectorAll('h3').map((heading) => heading.textContent ?? '');
			const words = dom.container.querySelectorAll('textarea').map((area) => area.value);
			return places.map((place, at) => ({ place, words: words[at]! }));
		};
		return { opened, shown, done: () => open.mockRestore() };
	};

	it('sends the words at a foot to a dialog that outlives it', async () => {
		const watch = watching();
		try {
			const fixture = laid();
			await settle();
			const foot = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!;
			foot.value = 'Refused footer at disposal';
			foot.dispatch('input');
			vi.mocked(fixture.bridge.addRow).mockResolvedValueOnce(null);
			fixture.handle.dispose();
			await settle();
			expect(fixture.bridge.addRow).toHaveBeenCalledWith('a', 'time-1', 'Refused footer at disposal', null);
			expect(watch.opened).toHaveLength(1);
			expect(watch.shown()).toEqual([{ place: 'Timeline a · Dawn', words: 'Refused footer at disposal' }]);
		} finally {
			watch.done();
		}
	});

	it('sends an open row edit, and words kept from an earlier failure, to the dialog together', async () => {
		const watch = watching();
		try {
			const fixture = laid();
			await settle();
			const rowEl = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-rows')!.children[0]!;
			const label = rowEl.querySelector('.snowflake-method-timeline-subrow-label')!;
			const input = rowEl.querySelector('.snowflake-method-timeline-subrow-input')!;
			vi.mocked(fixture.bridge.editRow).mockResolvedValue('refused');
			label.dispatch('click');
			input.value = 'Kept from before';
			press(input, 'Enter', { mod: true });
			await settle();
			expect(watch.opened).toHaveLength(0);
			label.dispatch('click');
			expect(input.value).toBe('Kept from before');
			input.value = 'Open at the end';
			fixture.handle.dispose();
			await settle();
			expect(fixture.bridge.editRow).toHaveBeenCalledTimes(2);
			expect(fixture.bridge.editRow).toHaveBeenLastCalledWith('a', 'r1', 'Open at the end');
			expect(watch.opened).toHaveLength(1);
			expect(watch.shown()).toEqual([{ place: 'Timeline a · Dawn', words: 'Open at the end' }]);
		} finally {
			watch.done();
		}
	});

	it('opens nothing when the final writes land', async () => {
		const watch = watching();
		try {
			const fixture = laid();
			await settle();
			const foot = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!;
			foot.value = 'Lands';
			foot.dispatch('input');
			fixture.handle.dispose();
			await settle();
			expect(fixture.held().timelines[0]!.times[0]!.rows.map((entry) => entry.text)).toEqual(['Arrives', 'Lands']);
			expect(watch.opened).toHaveLength(0);
		} finally {
			watch.done();
		}
	});
});

describe('timeline words during plugin unload', () => {
	it.each(['refused foot', 'refused row', 'read-only foot', 'unload before recovery'] as const)(
		'keeps %s recoverable in the console without a dialog', async (scenario) => {
			const fixture = workspace({
				timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Stored')] }] })],
				views: [view('v', ['a'])],
			});
			await settle();
			let unloading = scenario !== 'unload before recovery';
			fixture.controls.unloading = () => unloading;
			const open = vi.spyOn(TimelineDraftModal.prototype, 'open').mockImplementation(() => undefined);
			const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			try {
				const cell = fixture.cell('time-1', 'a');
				if (scenario === 'refused row') {
					const rowEl = cell.querySelector('.snowflake-method-timeline-rows')!.children[0]!;
					rowEl.querySelector('.snowflake-method-timeline-subrow-label')!.dispatch('click');
					rowEl.querySelector('.snowflake-method-timeline-subrow-input')!.value = 'Words kept at unload';
					vi.mocked(fixture.bridge.editRow).mockResolvedValueOnce('refused');
				} else {
					const foot = cell.querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!;
					foot.value = 'Words kept at unload';
					foot.dispatch('input');
					if (scenario === 'refused foot') vi.mocked(fixture.bridge.addRow).mockResolvedValueOnce(null);
					else {
						fixture.model.readOnly = true;
						fixture.handle.refresh();
						await settle();
					}
				}
				fixture.handle.dispose();
				unloading = true;
				await settle();
				expect(open).not.toHaveBeenCalled();
				expect(logged).toHaveBeenCalledExactlyOnceWith(
					'Snowflake: sub-description words could not be written',
					{ place: 'Timeline a · Dawn', words: 'Words kept at unload' },
				);
				if (scenario === 'read-only foot' || scenario === 'unload before recovery') {
					expect(fixture.bridge.addRow).not.toHaveBeenCalled();
				}
			} finally {
				open.mockRestore();
				logged.mockRestore();
			}
		},
	);

	it('still writes accepted typed words while unloading', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		fixture.controls.unloading = () => true;
		const foot = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!;
		foot.value = 'Settled at unload';
		foot.dispatch('input');
		fixture.handle.dispose();
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledWith('a', 'time-1', 'Settled at unload', null);
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Settled at unload');
	});
});

describe('a sub-description being edited when its row moves to another time', () => {
	const laid = (order: 'down' | 'up') => workspace({
		timelines: [timeline('a', { times: order === 'down'
			? [{ timeId: 'time-1', rows: [row('r1', 'Stored', ['scene-1'])] }, { timeId: 'time-2', rows: [] }]
			: [{ timeId: 'time-1', rows: [] }, { timeId: 'time-2', rows: [row('r1', 'Stored', ['scene-1'])] }],
		})],
		views: [view('v', ['a'])],
	});
	const rowIn = (fixture: ReturnType<typeof workspace>, timeId: string): CorkboardElement | undefined =>
		fixture.cell(timeId, 'a').querySelector('.snowflake-method-timeline-rows')!.children.find((child) => child.getAttribute('data-row-id') === 'r1');

	it.each(['down', 'up'] as const)('moved %s: the editor, its words, its caret and its cards go with the row', async (order) => {
		const fixture = laid(order);
		await settle();
		const [from, to] = order === 'down' ? ['time-1', 'time-2'] : ['time-2', 'time-1'];
		const rowEl = rowIn(fixture, from)!;
		const label = rowEl.querySelector('.snowflake-method-timeline-subrow-label')!;
		const input = rowEl.querySelector('.snowflake-method-timeline-subrow-input')!;
		const card = rowEl.querySelector('.snowflake-method-corkboard-card')!;
		label.dispatch('click');
		input.value = 'Unsaved author draft';
		input.dispatch('input');
		await fixture.bridge.moveRow('a', 'r1', to, null);
		fixture.notify();
		await settle();
		expect(rowIn(fixture, from)).toBeUndefined();
		expect(rowIn(fixture, to)).toBe(rowEl);
		expect(rowEl.classes.has('is-editing')).toBe(true);
		expect(input.value).toBe('Unsaved author draft');
		expect(fixture.dom.doc.activeElement).toBe(input);
		expect(rowEl.querySelector('.snowflake-method-corkboard-card')).toBe(card);
		expect(fixture.bridge.editRow).not.toHaveBeenCalled();
		press(input, 'Enter', { mod: true });
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledWith('a', 'r1', 'Unsaved author draft');
		expect(fixture.held().timelines[0]!.times.find((time) => time.timeId === to)!.rows[0]!.text).toBe('Unsaved author draft');
	});

	it('shows the words for keeping when the row goes from under the editor instead', async () => {
		const opened: TimelineDraftModal[] = [];
		const open = vi.spyOn(TimelineDraftModal.prototype, 'open').mockImplementation(function (this: TimelineDraftModal) { opened.push(this); });
		try {
			const fixture = laid('down');
			await settle();
			const rowEl = rowIn(fixture, 'time-1')!;
			rowEl.querySelector('.snowflake-method-timeline-subrow-label')!.dispatch('click');
			const input = rowEl.querySelector('.snowflake-method-timeline-subrow-input')!;
			input.value = 'Unsaved author draft';
			input.dispatch('input');
			await fixture.bridge.deleteRow('a', 'r1');
			fixture.notify();
			await settle();
			expect(rowIn(fixture, 'time-1')).toBeUndefined();
			// The write is tried, comes back absent, and the words go to the dialog at once: there is no next edit of a row that has gone.
			expect(fixture.bridge.editRow).toHaveBeenCalledWith('a', 'r1', 'Unsaved author draft');
			expect(fixture.held().timelines[0]!.times[0]!.rows).toEqual([]);
			expect(opened).toHaveLength(1);
			const dom = new CorkboardDom();
			Object.assign(opened[0]!, { contentEl: dom.container, setTitle: vi.fn() });
			opened[0]!.onOpen();
			expect(dom.container.querySelectorAll('h3').map((heading) => heading.textContent)).toEqual(['Timeline a']);
			expect(dom.container.querySelectorAll('textarea').map((area) => area.value)).toEqual(['Unsaved author draft']);
			// Nothing waits for a next edit, and closing the workspace writes nothing more.
			fixture.handle.dispose();
			await settle();
			expect(fixture.bridge.editRow).toHaveBeenCalledOnce();
			expect(opened).toHaveLength(1);
		} finally {
			open.mockRestore();
		}
	});
});

describe('words being written when the project turns read-only', () => {
	const laid = () => workspace({
		timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Original')] }] })],
		views: [view('v', ['a'])],
	});
	const watching = () => {
		const opened: TimelineDraftModal[] = [];
		const open = vi.spyOn(TimelineDraftModal.prototype, 'open').mockImplementation(function (this: TimelineDraftModal) { opened.push(this); });
		const shown = (): { place: string; words: string }[] => {
			const dom = new CorkboardDom();
			Object.assign(opened[0]!, { contentEl: dom.container, setTitle: vi.fn() });
			opened[0]!.onOpen();
			const places = dom.container.querySelectorAll('h3').map((heading) => heading.textContent ?? '');
			const words = dom.container.querySelectorAll('textarea').map((area) => area.value);
			return places.map((place, at) => ({ place, words: words[at]! }));
		};
		return { opened, shown, done: () => open.mockRestore() };
	};

	it('keeps an open edit for the next edit, and shows it for keeping when the workspace goes', async () => {
		const watch = watching();
		try {
			const fixture = laid();
			await settle();
			const rowEl = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-rows')!.children[0]!;
			const label = rowEl.querySelector('.snowflake-method-timeline-subrow-label')!;
			const input = rowEl.querySelector('.snowflake-method-timeline-subrow-input')!;
			label.dispatch('click');
			input.value = 'Author new draft';
			input.dispatch('input');
			fixture.model.readOnly = true;
			fixture.handle.refresh();
			expect(fixture.root.classes.has('is-read-only')).toBe(true);
			press(input, 'Enter', { mod: true });
			await settle();
			expect(fixture.bridge.editRow).not.toHaveBeenCalled();
			expect(label.textContent).toBe('Original');
			expect(watch.opened).toHaveLength(0);
			// Writable again, the next edit opens on the kept words.
			fixture.model.readOnly = false;
			fixture.handle.refresh();
			label.dispatch('click');
			expect(input.value).toBe('Author new draft');
			press(input, 'Escape');
			// Read-only once more, an edit still open at the end goes to the dialog, and nothing is written.
			label.dispatch('click');
			input.value = 'Author new draft';
			input.dispatch('input');
			fixture.model.readOnly = true;
			fixture.handle.refresh();
			fixture.handle.dispose();
			await settle();
			expect(fixture.bridge.editRow).not.toHaveBeenCalled();
			expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Original');
			expect(watch.shown()).toEqual([{ place: 'Timeline a · Dawn', words: 'Author new draft' }]);
		} finally {
			watch.done();
		}
	});

	it('shows the words at a foot for keeping when the workspace goes, and writes nothing', async () => {
		const watch = watching();
		try {
			const fixture = laid();
			await settle();
			const foot = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!;
			foot.value = 'Leaves';
			foot.dispatch('input');
			fixture.model.readOnly = true;
			fixture.handle.refresh();
			fixture.handle.dispose();
			await settle();
			expect(fixture.bridge.addRow).not.toHaveBeenCalled();
			expect(watch.shown()).toEqual([{ place: 'Timeline a · Dawn', words: 'Leaves' }]);
		} finally {
			watch.done();
		}
	});
});

describe('a row edited again while its first write is on its way', () => {
	it('opens on the words on their way, and writes a return to the stored words', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Original')] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		const rowEl = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-rows')!.children[0]!;
		const label = rowEl.querySelector('.snowflake-method-timeline-subrow-label')!;
		const input = rowEl.querySelector('.snowflake-method-timeline-subrow-input')!;
		let release!: (result: 'written') => void;
		vi.mocked(fixture.bridge.editRow).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
		label.dispatch('click');
		input.value = 'New words';
		press(input, 'Enter', { mod: true });
		await settle();
		label.dispatch('click');
		expect(input.value).toBe('New words');
		input.value = 'Original';
		press(input, 'Enter', { mod: true });
		await settle();
		release('written');
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledTimes(2);
		expect(fixture.bridge.editRow).toHaveBeenLastCalledWith('a', 'r1', 'Original');
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Original');
		label.dispatch('click');
		expect(input.value).toBe('Original');
	});
});

describe('words sent, refused, and saved again unchanged', () => {
	it('are written once more, not taken for already written', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Original')] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		const rowEl = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-rows')!.children[0]!;
		const label = rowEl.querySelector('.snowflake-method-timeline-subrow-label')!;
		const input = rowEl.querySelector('.snowflake-method-timeline-subrow-input')!;
		let refuse!: (result: 'refused') => void;
		vi.mocked(fixture.bridge.editRow).mockImplementationOnce(() => new Promise((resolve) => { refuse = resolve; }));
		label.dispatch('click');
		input.value = 'B';
		press(input, 'Enter', { mod: true });
		await settle();
		label.dispatch('click');
		expect(input.value).toBe('B');
		refuse('refused');
		await settle();
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Original');
		// Saved again as it stands, B is still not in the file: it is sent again.
		press(input, 'Enter', { mod: true });
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledTimes(2);
		expect(fixture.bridge.editRow).toHaveBeenLastCalledWith('a', 'r1', 'B');
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('B');
		label.dispatch('click');
		expect(input.value).toBe('B');
	});
});

describe('an older write failing after newer words were kept in read-only', () => {
	it('keeps nothing over them', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Original')] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		const rowEl = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-rows')!.children[0]!;
		const label = rowEl.querySelector('.snowflake-method-timeline-subrow-label')!;
		const input = rowEl.querySelector('.snowflake-method-timeline-subrow-input')!;
		let refuse!: (result: 'refused') => void;
		vi.mocked(fixture.bridge.editRow).mockImplementationOnce(() => new Promise((resolve) => { refuse = resolve; }));
		label.dispatch('click');
		input.value = 'Older draft A';
		press(input, 'Enter', { mod: true });
		await settle();
		label.dispatch('click');
		input.value = 'Newer draft B';
		input.dispatch('input');
		fixture.model.readOnly = true;
		fixture.handle.refresh();
		press(input, 'Enter', { mod: true });
		await settle();
		refuse('refused');
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledOnce();
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Original');
		fixture.model.readOnly = false;
		fixture.handle.refresh();
		label.dispatch('click');
		expect(input.value).toBe('Newer draft B');
	});
});

describe('an editor opened on the file\'s words and left as it was', () => {
	const laid = () => workspace({
		timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Original')] }] })],
		views: [view('v', ['a'])],
	});
	const parts = (fixture: ReturnType<typeof workspace>) => {
		const rowEl = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-rows')!.children[0]!;
		return { label: rowEl.querySelector('.snowflake-method-timeline-subrow-label')!, input: rowEl.querySelector('.snowflake-method-timeline-subrow-input')! };
	};

	it('writes nothing over words another writer put in the file meanwhile', async () => {
		const fixture = laid();
		await settle();
		const { label, input } = parts(fixture);
		label.dispatch('click');
		expect(input.value).toBe('Original');
		await fixture.bridge.editRow('a', 'r1', 'External update');
		vi.mocked(fixture.bridge.editRow).mockClear();
		fixture.notify();
		await settle();
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('External update');
		expect(input.value).toBe('Original');
		input.dispatch('blur');
		await settle();
		expect(fixture.bridge.editRow).not.toHaveBeenCalled();
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('External update');
		expect(label.textContent).toBe('External update');
	});

	it('still writes words the writer changed, and nothing for words the file already says', async () => {
		const fixture = laid();
		await settle();
		const { label, input } = parts(fixture);
		label.dispatch('click');
		await fixture.bridge.editRow('a', 'r1', 'External update');
		vi.mocked(fixture.bridge.editRow).mockClear();
		fixture.notify();
		await settle();
		input.value = 'Mine';
		press(input, 'Enter', { mod: true });
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledWith('a', 'r1', 'Mine');
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('Mine');
		label.dispatch('click');
		input.value = 'Mine';
		input.dispatch('blur');
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledOnce();
	});
});

describe('an editor opened on words on their way, which then land', () => {
	it('writes nothing over words another writer put in the file after that', async () => {
		const fixture = workspace({
			timelines: [timeline('a', { times: [{ timeId: 'time-1', rows: [row('r1', 'Original')] }] })],
			views: [view('v', ['a'])],
		});
		await settle();
		const rowEl = fixture.cell('time-1', 'a').querySelector('.snowflake-method-timeline-rows')!.children[0]!;
		const label = rowEl.querySelector('.snowflake-method-timeline-subrow-label')!;
		const input = rowEl.querySelector('.snowflake-method-timeline-subrow-input')!;
		const write = vi.mocked(fixture.bridge.editRow).getMockImplementation()!;
		let release!: () => void;
		vi.mocked(fixture.bridge.editRow).mockImplementationOnce((timelineId, rowId, text) => new Promise((resolve) => {
			release = () => { void write(timelineId, rowId, text).then(() => resolve('written')); };
		}));
		label.dispatch('click');
		input.value = 'B';
		press(input, 'Enter', { mod: true });
		await settle();
		label.dispatch('click');
		expect(input.value).toBe('B');
		release();
		await settle();
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('B');
		await fixture.bridge.editRow('a', 'r1', 'C');
		vi.mocked(fixture.bridge.editRow).mockClear();
		fixture.notify();
		await settle();
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('C');
		expect(input.value).toBe('B');
		input.dispatch('blur');
		await settle();
		expect(fixture.bridge.editRow).not.toHaveBeenCalled();
		expect(fixture.held().timelines[0]!.times[0]!.rows[0]!.text).toBe('C');
		expect(label.textContent).toBe('C');
	});
});
