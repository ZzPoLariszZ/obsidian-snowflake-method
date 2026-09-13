import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom, CorkboardElement } from '../helpers/corkboard-dom';

const { menus } = vi.hoisted(() => ({
	menus: [] as { title: string; disabled: boolean; click: () => void }[][],
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
		Modal,
		Menu,
		FuzzySuggestModal: class extends Modal {},
		SuggestModal: class extends Modal {},
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
	setViewTimeOrder,
	setViewTimelines,
	type Timeline,
	type TimelineDocument,
	type TimelineRow,
	type TimelineView,
} from '../../src/domain';
import { promptForEntityReference, type EntityReferenceSource } from '../../src/ui/modals';
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
import { AddTimelineModal, TimelineViewFormModal, confirmTimelineAction } from '../../src/ui/timeline-forms';
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
function press(element: CorkboardElement, key: string): void {
	for (const listener of element.listeners.get('keydown') ?? []) {
		listener({ target: element, ...{ key }, preventDefault: () => undefined, stopPropagation: () => undefined });
	}
}

const timeline = (id: string, extra: Partial<Timeline> = {}): Timeline => ({
	id, name: `Timeline ${id}`, binding: null, times: [], createdAt: 1, updatedAt: 1, ...extra,
});
const view = (id: string, timelines: string[], extra: Partial<TimelineView> = {}): TimelineView => ({
	id, name: `View ${id}`, timelines, timeOrder: [], presentation: null, cardStyle: null, createdAt: 1, updatedAt: 1, ...extra,
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
		read: vi.fn(async () => ({ projectPath: 'P', locale: 'en' as const, readOnly, held })),
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
		setTimeOrder: vi.fn(async (id: string, timeIds: readonly string[]) => apply(setViewTimeOrder(held, id, timeIds, 2))),
		setViewPresentation: vi.fn(async (id: string, presentation: 'flat' | 'stack' | null) => apply(setViewPresentation(held, id, presentation, 2))),
		addTime: vi.fn(async (timelineId: string, timeId: string) => apply(addTimelineTime(held, timelineId, timeId, 2))),
		removeTime: vi.fn(async (timelineId: string, timeId: string) => apply(removeTimelineTime(held, timelineId, timeId, 2))),
		addRow: vi.fn(async (timelineId: string, timeId: string, text: string, beforeRowId: string | null, scenes: string[] = []) => {
			const id = `timeline-row-${String(++serial)}`;
			apply(addTimelineRow(held, timelineId, timeId, { id, text, scenes }, beforeRowId, 2));
			return id;
		}),
		removeScene: vi.fn(async (timelineId: string, sceneId: string) => apply(removeTimelineScene(held, timelineId, sceneId, 2))),
		editRow: vi.fn(async (timelineId: string, rowId: string, text: string) => apply(editTimelineRow(held, timelineId, rowId, text, 2))),
		moveRow: vi.fn(async (timelineId: string, rowId: string, toTimeId: string, beforeRowId: string | null) =>
			apply(moveTimelineRow(held, timelineId, rowId, toTimeId, beforeRowId, 2))),
		deleteRow: vi.fn(async (timelineId: string, rowId: string) => apply(deleteTimelineRow(held, timelineId, rowId, 2))),
		placeScene: vi.fn(async (timelineId: string, sceneId: string, rowId: string, beforeSceneId: string | null) =>
			apply(placeTimelineScene(held, timelineId, sceneId, rowId, beforeSceneId, 2))),
	} as unknown as TimelineBridge;
	const times = [time('time-1', 'Dawn', 'First light'), time('time-2', 'Dusk')];
	const model = {
		path: 'P', projectId: 'p', locale: 'en', readOnly: false,
		scenes: [scene('scene-1', 'Arrival'), scene('scene-2', 'Departure'), scene('scene-3', 'Return')],
		manuscriptPaths: [],
		characters: [{ id: 'character-alice', name: 'Alice', path: 'Cast/Alice.md', readOnly: false, healthIssues: [] }],
		worldbuildingKinds: [{ id: 'time' }, { id: 'location' }],
		worldbuilding: { time: times, location: [{ id: 'entity-london', name: 'London', path: 'World/London.md' }] },
	} as unknown as ProjectDashboardModel;
	const memory = timelineMemory();
	const host = {
		openManagedFile: vi.fn(() => Promise.resolve()),
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
		held: () => held,
		notify: () => { for (const listener of listeners) listener(); },
		listeners,
		select: (): CorkboardElement => root.querySelector('.snowflake-method-timeline-view-select')!,
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
		await settle();
		expect(fixture.select().querySelectorAll('option').map((option) => option.getAttribute('value'))).toEqual(['v1', 'v2']);
		expect(fixture.select().value).toBe('v2');
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['a', 'b']);
		expect(fixture.root.dataset.layout).toBe('multi');
		expect(fixture.root.dataset.presentation).toBe('stack');
		expect(fixture.root.dataset.mode).toBe('compact');
		expect(fixture.body().classes.has('is-hidden')).toBe(false);
		expect(fixture.emptyLine().classes.has('is-hidden')).toBe(true);
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
		fixture.head('a').querySelector('.snowflake-method-timeline-lane-name')!.dispatch('click');
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
		fixture.select().value = 'v1';
		fixture.select().dispatch('change');
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['a']);
		expect(fixture.root.dataset.layout).toBe('single');
		expect(fixture.root.dataset.presentation).toBe('flat');
		expect(fixture.root.dataset.mode).toBe('standard');
		await settle();
		expect(fixture.bridge.setLastView).toHaveBeenCalledWith('v1');
		expect(fixture.held().lastViewId).toBe('v1');
	});

	it('shows the way in while there is nothing yet', async () => {
		const none = workspace();
		await settle();
		expect(none.emptyLine().classes.has('is-hidden')).toBe(false);
		expect(none.emptyLine().querySelectorAll('span').map((span) => span.textContent)).toContain('timeline.empty.views');
		expect(none.button('snowflake-method-timeline-empty-action').textContent).toBe('timeline.view.add');
		expect(none.body().classes.has('is-hidden')).toBe(true);
		expect(none.select().disabled).toBe(true);
		const bare = workspace({ timelines: [timeline('a')], views: [view('v', [])] });
		await settle();
		expect(bare.emptyLine().querySelectorAll('span').map((span) => span.textContent)).toContain('timeline.empty.timelines');
		expect(bare.button('snowflake-method-timeline-empty-action').textContent).toBe('timeline.addTimeline');
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
		expect(fixture.host.openManagedFile).toHaveBeenCalledWith('Cast/Alice.md');
		const gone = fixture.head('b').querySelector('.snowflake-method-timeline-lane-entity')!;
		expect(gone.textContent).toBe('Atlantis');
		expect(gone.classes.has('is-missing')).toBe(true);
		gone.dispatch('click');
		expect(fixture.host.openManagedFile).toHaveBeenCalledTimes(1);
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
			'timeline.timeline.addTime',
			'timeline.timeline.removeFromView',
			'timeline.timeline.delete',
		]);
		expect(menu.every((item) => !item.disabled)).toBe(true);
		menu[2]!.click();
		await settle();
		expect(fixture.bridge.pinTimeline).toHaveBeenCalledWith('a');
		expect(fixture.head('a').classes.has('is-pinned')).toBe(true);
		menus.length = 0;
		fixture.head('b').querySelector('.snowflake-method-timeline-lane-more')!.dispatch('click');
		expect(menus[0]![2]!.title).toBe('timeline.timeline.pin');
		menus[0]![4]!.click();
		await settle();
		expect(fixture.bridge.setViewTimelines).toHaveBeenCalledWith('v', ['a']);
		expect(fixture.heads().map((head) => head.getAttribute('data-timeline-id'))).toEqual(['a']);
		menus.length = 0;
		fixture.head('a').querySelector('.snowflake-method-timeline-lane-more')!.dispatch('click');
		menus[0]![5]!.click();
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
		expect(fixture.select().value).toBe('timeline-view-1');
		expect(fixture.select().querySelectorAll('option')).toHaveLength(2);
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
		expect(fixture.button('snowflake-method-timeline-view-manage').disabled).toBe(true);
		menus.length = 0;
		fixture.head('a').querySelector('.snowflake-method-timeline-lane-more')!.dispatch('click');
		expect(menus[0]!.every((item) => item.disabled)).toBe(true);
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
			'actions.openNote', 'actions.edit', 'actions.moveUp', 'actions.moveDown', 'timeline.time.remove',
		]);
		menus[0]![4]!.click();
		await settle();
		expect(confirmTimelineAction).toHaveBeenCalledOnce();
		expect(fixture.bridge.removeTime).toHaveBeenCalledWith('a', 'time-2');
		expect(fixture.rows().map((entry) => entry.getAttribute('data-time-id'))).toEqual(['time-1', 'time-lost']);
		menus.length = 0;
		fixture.rowOf('time-1').querySelector('.snowflake-method-timeline-time-more')!.dispatch('click');
		expect(menus[0]![4]!.disabled).toBe(true);
		fixture.head('b').querySelector('.snowflake-method-timeline-lane-name')!.dispatch('click');
		menus.length = 0;
		fixture.rowOf('time-1').querySelector('.snowflake-method-timeline-time-more')!.dispatch('click');
		menus[0]![4]!.click();
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
		expect(menus[0]!.map((item) => item.title)).toEqual(['actions.edit', 'common.open', 'timeline.scene.remove', 'actions.delete']);
		menus[0]![2]!.click();
		await settle();
		expect(fixture.bridge.removeScene).toHaveBeenCalledWith('a', 'scene-1');
		expect(fixture.cards()).toHaveLength(0);
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
		cell.querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('input')!;

	it('makes a row from the words typed at the foot, shows it at once, and keeps the focus for the next', async () => {
		const fixture = laid();
		await settle();
		const cell = fixture.cell('time-2', 'a');
		const input = trailingInput(cell);
		expect(subrows(cell).map((child) => child.getAttribute('data-row-id') ?? child.classes.has('is-trailing'))).toEqual(['r1', 'r2', true]);
		input.focus();
		input.value = '  Leaves  ';
		press(input, 'Enter');
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

	it('edits a row in place: Enter writes the words, Escape reverts, leaving the box commits', async () => {
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
		input.value = 'Arrives late';
		press(input, 'Enter');
		expect(first.classes.has('is-editing')).toBe(false);
		expect(label.textContent).toBe('Arrives late');
		expect(fixture.dom.doc.activeElement).toBe(label);
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledWith('a', 'r1', 'Arrives late');
		label.dispatch('click');
		input.value = 'Nope';
		press(input, 'Escape');
		expect(label.textContent).toBe('Arrives late');
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
			['actions.moveUp', true], ['actions.moveDown', false], ['timeline.subrow.remove', false],
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
		menus[0]![2]!.click();
		await settle();
		expect(confirmTimelineAction).not.toHaveBeenCalled();
		expect(fixture.bridge.deleteRow).toHaveBeenCalledWith('a', 'r2');
		menus.length = 0;
		subrows(cell)[0]!.querySelector('.snowflake-method-timeline-subrow-more')!.dispatch('click');
		menus[0]![2]!.click();
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
		expect(pool.querySelector('.snowflake-method-timeline-pool-name')!.textContent).toBe('timeline.pool');
		expect(pool.querySelector('.snowflake-method-timeline-pool-count')!.textContent).toBe('2');
		expect(fixture.corkboard).toHaveBeenCalledOnce();
		const [host, poolControls, variant] = fixture.corkboard.mock.calls[0]! as unknown as [CorkboardElement, TimelineControls & { memory: unknown; remember: () => void }, { include: (scene: { id: string }) => boolean; addButton: string; columns: number; emptyText: string }];
		expect(host).toBe(pool.querySelector('.snowflake-method-corkboard-host'));
		expect(variant.addButton).toBe('icon');
		expect(variant.columns).toBe(1);
		expect(variant.emptyText).toBe('timeline.pool.empty');
		expect(variant.include({ id: 'scene-1' })).toBe(false);
		expect(variant.include({ id: 'scene-2' })).toBe(true);
		expect(poolControls.memory).toBe(fixture.memory.pool);
		poolControls.remember();
		expect(fixture.remember).toHaveBeenCalledOnce();
		expect(fixture.poolHandle.refresh).toHaveBeenCalled();
	});

	it('follows the active lane, and hands the pool its reveals, measures and disposal', async () => {
		const fixture = laid();
		await settle();
		const variant = fixture.corkboard.mock.calls[0]![2] as unknown as { include: (scene: { id: string }) => boolean };
		const paints = fixture.poolHandle.refresh.mock.calls.length;
		fixture.head('b').querySelector('.snowflake-method-timeline-lane-name')!.dispatch('click');
		expect(variant.include({ id: 'scene-1' })).toBe(true);
		expect(fixture.root.querySelector('.snowflake-method-timeline-pool-count')!.textContent).toBe('3');
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

	it('shows one card of the row with the rest counted behind it, and walks them without a write', async () => {
		const fixture = laid();
		await settle();
		expect(fixture.root.dataset.presentation).toBe('stack');
		const stack = stackOf(fixture, 'time-1', 'r1');
		expect(stack.dataset.total).toBe('3');
		expect(fixture.cards()).toHaveLength(1);
		expect(shownIn(stack)).toBe('scene-1');
		expect(fixture.translate).toHaveBeenCalledWith('timeline.stack.position', { position: 1, total: 3 });
		expect(control(stack, 'previous').disabled).toBe(true);
		expect(control(stack, 'reset').disabled).toBe(true);
		expect(control(stack, 'next').disabled).toBe(false);
		control(stack, 'next').dispatch('click');
		expect(shownIn(stack)).toBe('scene-2');
		expect(fixture.cards()).toHaveLength(1);
		expect(control(stack, 'previous').disabled).toBe(false);
		control(stack, 'next').dispatch('click');
		expect(shownIn(stack)).toBe('scene-3');
		expect(control(stack, 'next').disabled).toBe(true);
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
		expect(control(stack, 'controls').classes.has('is-hidden')).toBe(false);
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
		expect(control(stack, 'controls').classes.has('is-hidden')).toBe(true);
	});

	it('writes the presentation from the control, laying the cards flat and stacking them again', async () => {
		const fixture = laid();
		await settle();
		const radios = fixture.root.querySelectorAll('.snowflake-method-timeline-presentation-option');
		expect(radios.map((radio) => radio.getAttribute('data-value'))).toEqual(['flat', 'stack']);
		expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true']);
		expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0]);
		radios[1]!.dispatch('click');
		expect(fixture.bridge.setViewPresentation).not.toHaveBeenCalled();
		radios[0]!.dispatch('click');
		await settle();
		expect(fixture.bridge.setViewPresentation).toHaveBeenCalledWith('v', 'flat');
		expect(fixture.root.dataset.presentation).toBe('flat');
		expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false']);
		const box = boxOf(fixture, 'time-1', 'r1');
		expect(box.querySelector('.snowflake-method-timeline-stack')).toBeNull();
		expect(fixture.cards()).toHaveLength(3);
		expect(box.children.map((child) => child.getAttribute('data-id'))).toEqual(['scene-1', 'scene-2', 'scene-3']);
		press(radios[0]!, 'ArrowRight');
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
		const radios = fixture.root.querySelectorAll('.snowflake-method-timeline-presentation-option');
		expect(radios.every((radio) => radio.disabled)).toBe(true);
		const stack = stackOf(fixture, 'time-1', 'r1');
		control(stack, 'next').dispatch('click');
		expect(shownIn(stack)).toBe('scene-2');
		expect(fixture.cards()[0]!.getAttribute('draggable')).toBe('false');
	});
});
