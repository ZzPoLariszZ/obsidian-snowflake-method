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
		showAtMouseEvent(): this {
			menus.push(this.items.map((item) => ({ title: item.title, disabled: item.disabled, click: item.click })));
			return this;
		}
	}
	return {
		...runtime,
		Keymap: { isModifier: (event: { mod?: boolean }) => event.mod === true },
		Modal,
		Menu,
		FuzzySuggestModal: class extends Modal { setPlaceholder(): void {} },
		SuggestModal: class extends Modal {},
	};
});

vi.mock('../../src/ui/timeline-forms', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/timeline-forms')>();
	return { ...actual, confirmTimelineAction: vi.fn(() => Promise.resolve(true)) };
});

import { Menu, type App, type Modal } from 'obsidian';

import {
	addTimelineRow,
	deleteTimelineRow,
	editTimelineRow,
	emptyTimelineDocument,
	moveTimelineRow,
	placeTimelineScene,
	removeTimelineScene,
	type ScenePresentation,
	type Timeline,
	type TimelineDocument,
	type TimelineRow,
	type TimelineTime,
} from '../../src/domain';
import { createLaneCells, type Lane, type LaneCell, type LaneCells, type LaneCellsDeps } from '../../src/ui/lane-cells';
import { createSceneCardDeck, type SceneCard, type SceneCardDeck } from '../../src/ui/scene-card';
import { TimelineDraftModal } from '../../src/ui/timeline-forms';
import { joinKey } from '../../src/ui/timeline-layout';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

// Obsidian's own DOM carries `instanceOf`, and a browser has `Element`; the
// drop targets read the one off the event target and name the other.
(CorkboardElement.prototype as unknown as { instanceOf: () => boolean }).instanceOf = () => true;
vi.stubGlobal('Element', class {});

interface Reading { held: TimelineDocument }

const t = (key: string): string => key;
const ROW_TYPE = 'application/x-test-row';
const SCENE_TYPE = 'application/x-test-scene';

async function settle(): Promise<void> {
	for (let at = 0; at < 40; at++) await Promise.resolve();
}

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

function press(element: CorkboardElement, key: string, extra: Record<string, unknown> = {}): void {
	for (const listener of element.listeners.get('keydown') ?? []) {
		listener({ target: element, ...{ key, ...extra }, preventDefault: () => undefined, stopPropagation: () => undefined });
	}
}

const row = (id: string, text: string, scenes: string[] = []): TimelineRow => ({ id, text, scenes });
const lane = (id: string, times: Timeline['times']): Timeline => ({
	id, name: `Lane ${id}`, binding: null, times, createdAt: 1, updatedAt: 1,
});
const scene = (id: string, title: string): SceneViewModel => ({
	id, path: `Scenes/${title}.md`, title, rank: 0, progressStatus: 'in-progress', aliases: [], categoryPaths: [],
	povPath: '', povName: '', povMissing: false, times: [], locations: [], characterPaths: [], conflict: '', color: null,
	linkedManuscript: [], worldStatus: [], relationships: [], events: '', customFields: '', revision: 'r', readOnly: false, healthIssues: [],
});

/**
 * A workspace reduced to what the cells ask of one: a box per lane and
 * time, a paint that keeps the protocol (homeless feet first, the sweep
 * last), and a queue that paints after every change.
 */
function standing(lanes: Timeline[], overrides: Partial<LaneCellsDeps<Reading>> = {}) {
	const dom = new CorkboardDom();
	const root = dom.container.createDiv();
	const ground = root.createDiv();
	let held: TimelineDocument = { ...emptyTimelineDocument(), timelines: lanes };
	let readOnly = false;
	let disposed = false;
	let unloading = false;
	let presentation: ScenePresentation = 'flat';
	let activeId: string | null = lanes[0]?.id ?? null;
	let serial = 0;
	const scenes = [scene('scene-1', 'Arrival'), scene('scene-2', 'Departure'), scene('scene-3', 'Return')];
	const scenesById = new Map(scenes.map((entry) => [entry.id, entry]));
	const sceneIndex = new Map(scenes.map((entry, index) => [entry.id, index]));
	const model = { path: 'P', projectId: 'p', locale: 'en', readOnly: false, scenes, characters: [], manuscriptPaths: [] } as unknown as ProjectDashboardModel;
	const apply = (next: TimelineDocument | null): 'written' => {
		if (next !== null) held = next;
		return 'written';
	};
	const bridge = {
		read: vi.fn(async () => ({ held })),
		addRow: vi.fn(async (laneId: string, timeId: string, text: string, beforeRowId: string | null, rowScenes: readonly string[] = []): Promise<string | null> => {
			const id = `row-${String(++serial)}`;
			apply(addTimelineRow(held, laneId, timeId, { id, text, scenes: rowScenes }, beforeRowId, 2));
			return id;
		}),
		editRow: vi.fn(async (laneId: string, rowId: string, text: string) => apply(editTimelineRow(held, laneId, rowId, text, 2))),
		moveRow: vi.fn(async (laneId: string, rowId: string, toTimeId: string, beforeRowId: string | null) =>
			apply(moveTimelineRow(held, laneId, rowId, toTimeId, beforeRowId, 2))),
		deleteRow: vi.fn(async (laneId: string, rowId: string) => apply(deleteTimelineRow(held, laneId, rowId, 2))),
		placeScene: vi.fn(async (laneId: string, sceneId: string, rowId: string, beforeSceneId: string | null) =>
			apply(placeTimelineScene(held, laneId, sceneId, rowId, beforeSceneId, 2))),
		removeScene: vi.fn(async (laneId: string, sceneId: string) => apply(removeTimelineScene(held, laneId, sceneId, 2))),
	};
	const notice = vi.fn();
	const kept: Modal[] = [];
	const dragPhase = vi.fn();
	const stackPositions = new Map<string, number>();
	const boxes = new Map<string, { el: CorkboardElement; cell: LaneCell }>();
	const host = {
		openManagedFile: vi.fn(() => Promise.resolve()),
		openManuscriptStream: vi.fn(() => Promise.resolve()),
		openSceneForm: vi.fn(() => Promise.resolve(null)),
		openCharacterForm: vi.fn(() => Promise.resolve()),
		patchScene: vi.fn(() => Promise.resolve('r2')),
		deleteScene: vi.fn(() => Promise.resolve()),
	};
	const deck: SceneCardDeck<SceneCard> = createSceneCardDeck<SceneCard>({
		app: {} as App,
		host,
		t,
		notice,
		refresh: () => Promise.resolve(),
		model: () => model,
		projectPath: () => 'P',
		readOnly: () => readOnly,
		charactersByPath: () => new Map(),
		scenesById: () => scenesById,
		manuscriptPositions: () => new Map(),
		resolveManuscriptPath: () => null,
		dragAllowed: (card) => cells.dragAllowed(card),
		menu: (card, event) => { cells.openCardMenu(card, event); },
		extend: (card) => card,
	});
	const paint = (): void => {
		cells.recoverHomelessFeet();
		const wanted = new Set<string>();
		for (const entry of held.timelines) {
			for (const time of entry.times) {
				const key = joinKey(entry.id, time.timeId);
				wanted.add(key);
				let box = boxes.get(key);
				if (box === undefined) {
					const el = ground.createDiv({ cls: 'snowflake-method-timeline-cell' });
					box = { el, cell: cells.mountCell(el as unknown as HTMLElement, entry.id, time.timeId) };
					boxes.set(key, box);
				}
				cells.dressCell(box.cell, time, entry);
			}
		}
		for (const [key, box] of [...boxes]) {
			if (wanted.has(key)) continue;
			cells.unmountCell(box.cell);
			box.el.remove();
			boxes.delete(key);
		}
		cells.sweep();
	};
	let queue: Promise<void> = Promise.resolve();
	const enqueue = (action: () => Promise<void>): Promise<void> => {
		const run = queue.then(async () => {
			try {
				await action();
			} catch (error) {
				if (!disposed) notice(error);
			}
			if (!disposed) paint();
		});
		queue = run.catch(() => undefined);
		return run;
	};
	const endDrag = vi.fn(() => {
		cells.dragEnded();
		cells.paintDragPhase();
	});
	const cells: LaneCells = createLaneCells<Reading>({
		app: {} as App,
		t,
		host,
		notice,
		keep: (modal) => { kept.push(modal); return modal; },
		enqueue,
		bridge: () => bridge,
		unloading: () => unloading,
		disposed: () => disposed,
		readOnly: () => readOnly,
		projectPath: () => 'P',
		root: root as unknown as HTMLElement,
		ground: ground as unknown as HTMLElement,
		deck,
		lanes: () => held.timelines,
		documentLanes: () => held.timelines,
		cellStands: (laneId) => held.timelines.some((entry) => entry.id === laneId),
		activeId: () => activeId,
		presentation: () => presentation,
		laneAxis: () => 'across',
		scenesById: () => scenesById,
		sceneIndex: () => sceneIndex,
		stackKey: (laneId, rowId) => joinKey('view', laneId, rowId),
		stackPositions: () => stackPositions,
		placeName: (laneId, timeId) => (timeId === null ? laneId : `${laneId} · ${timeId}`),
		sceneScope: (sceneId, rowId) => ({
			laneId: activeId ?? '',
			sceneId,
			rowId,
			lane: (read) => (read === undefined ? held : read?.held)?.timelines.find((entry) => entry.id === activeId) ?? null,
		}),
		words: { editGone: 'host.editGone', sceneRemove: 'host.sceneRemove' },
		dragTypes: { row: ROW_TYPE, scene: SCENE_TYPE },
		dragPhase,
		endDrag,
		...overrides,
	});
	paint();
	const cellEl = (laneId: string, timeId: string): CorkboardElement => boxes.get(joinKey(laneId, timeId))!.el;
	return {
		dom, root, ground, cells, deck, bridge, notice, kept, dragPhase, endDrag, stackPositions, paint, boxes,
		held: () => held,
		lose: (laneId: string) => { held = { ...held, timelines: held.timelines.filter((entry) => entry.id !== laneId) }; },
		readOnly: (value: boolean) => { readOnly = value; },
		dispose: () => { disposed = true; },
		unload: () => { unloading = true; },
		present: (value: ScenePresentation) => { presentation = value; },
		activate: (id: string | null) => { activeId = id; },
		cellEl,
		foot: (laneId: string, timeId: string): CorkboardElement =>
			cellEl(laneId, timeId).querySelector('.snowflake-method-timeline-subrow.is-trailing')!.querySelector('textarea')!,
		subrows: (laneId: string, timeId: string): CorkboardElement[] =>
			cellEl(laneId, timeId).querySelectorAll('.snowflake-method-timeline-subrow')
				.filter((entry) => entry.getAttribute('data-row-id') !== null),
		cards: (): CorkboardElement[] => ground.querySelectorAll('.snowflake-method-corkboard-card'),
	};
}

const oneLane = (): Timeline[] => [lane('a', [
	{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-1'])] },
	{ timeId: 'time-2', rows: [] },
])];

describe('what stands in a cell', () => {
	it('builds the rows and a foot where the lane holds the time, and takes them down where it does not', () => {
		const fixture = standing(oneLane());
		const cell = fixture.boxes.get(joinKey('a', 'time-1'))!.cell;
		expect(fixture.subrows('a', 'time-1')).toHaveLength(1);
		expect(fixture.foot('a', 'time-1')).toBeDefined();
		fixture.cells.dressCell(cell, null, fixture.held().timelines[0]!);
		expect(fixture.cellEl('a', 'time-1').querySelector('.snowflake-method-timeline-rows')).toBeNull();
		expect(cell.rows).toBeNull();
		expect(cell.trailing).toBeNull();
	});

	it('invites the first sub-description, then more of them, and hides the foot from a project that cannot be written', () => {
		const fixture = standing(oneLane());
		expect(fixture.foot('a', 'time-2').getAttribute('placeholder')).toBe('timeline.subrow.placeholder');
		expect(fixture.foot('a', 'time-1').getAttribute('placeholder')).toBe('timeline.subrow.placeholderMore');
		fixture.readOnly(true);
		fixture.paint();
		expect(fixture.foot('a', 'time-1').disabled).toBe(true);
	});

	it('forgets a cell that went with its box, so words refused after it look for no foot there', async () => {
		const opened: TimelineDraftModal[] = [];
		const open = vi.spyOn(TimelineDraftModal.prototype, 'open').mockImplementation(function (this: TimelineDraftModal) { opened.push(this); });
		try {
			const fixture = standing(oneLane());
			const foot = fixture.foot('a', 'time-2');
			foot.value = 'Kept a while';
			foot.dispatch('input');
			fixture.bridge.addRow.mockResolvedValueOnce(null);
			fixture.lose('a');
			foot.dispatch('blur');
			await settle();
			// The lane has gone, and with it the cell: the words have no foot to come
			// back to, so they are shown for keeping under the host's name for the place.
			expect(fixture.boxes.size).toBe(0);
			expect(fixture.notice).toHaveBeenCalledOnce();
			expect(opened).toHaveLength(1);
			expect((opened[0] as unknown as { drafts: unknown }).drafts).toEqual([{ place: 'a · time-2', words: 'Kept a while' }]);
		} finally {
			open.mockRestore();
		}
	});
});

describe('words typed at a cell\'s foot', () => {
	it('become a row through the queue, and leave the foot empty for the next', async () => {
		const fixture = standing(oneLane());
		const foot = fixture.foot('a', 'time-2');
		foot.value = 'Departs';
		foot.dispatch('input');
		press(foot, 'Enter', { mod: true });
		await settle();
		expect(fixture.bridge.addRow).toHaveBeenCalledExactlyOnceWith('a', 'time-2', 'Departs', null);
		expect(fixture.subrows('a', 'time-2').map((entry) => entry.querySelector('.snowflake-method-timeline-subrow-label')!.textContent)).toEqual(['Departs']);
		expect(fixture.foot('a', 'time-2').value).toBe('');
	});

	it('come back to the foot ahead of what was typed since, when the write is refused', async () => {
		const fixture = standing(oneLane());
		const foot = fixture.foot('a', 'time-2');
		foot.value = 'Refused words';
		foot.dispatch('input');
		fixture.bridge.addRow.mockResolvedValueOnce(null);
		press(foot, 'Enter', { mod: true });
		foot.value = 'typed since';
		foot.dispatch('input');
		await settle();
		expect(fixture.foot('a', 'time-2').value).toBe('Refused words\ntyped since');
		expect(fixture.notice).toHaveBeenCalledOnce();
	});

	it('are shown for keeping at once when the host says their cell no longer stands', async () => {
		const open = vi.spyOn(TimelineDraftModal.prototype, 'open').mockImplementation(() => undefined);
		try {
			// A host whose cells can go while their lane stands, as a beat can leave its sheet.
			let beatGone = false;
			const fixture = standing(oneLane(), { cellStands: (_laneId, timeId) => !(beatGone && timeId === 'time-2') });
			const foot = fixture.foot('a', 'time-2');
			foot.value = 'Words with no home';
			foot.dispatch('input');
			beatGone = true;
			fixture.paint();
			await settle();
			expect(open).toHaveBeenCalledOnce();
		} finally {
			open.mockRestore();
		}
	});

	it('waits for a document before calling any words homeless', async () => {
		const open = vi.spyOn(TimelineDraftModal.prototype, 'open').mockImplementation(() => undefined);
		try {
			let read = true;
			const fixture = standing(oneLane(), {
				documentLanes: () => (read ? oneLane() : null),
				cellStands: () => read,
			});
			const foot = fixture.foot('a', 'time-2');
			foot.value = 'Written while unread';
			foot.dispatch('input');
			read = false;
			press(foot, 'Enter', { mod: true });
			await settle();
			// The write landed; with nothing read, nobody goes looking for homeless feet.
			expect(fixture.bridge.addRow).toHaveBeenCalledOnce();
			expect(open).not.toHaveBeenCalled();
		} finally {
			open.mockRestore();
		}
	});
});

describe('a row\'s menu', () => {
	it('puts what the host offers between the moves and the removal, and says the host\'s own words', async () => {
		const offered = vi.fn((menu: Menu, _lane: Lane, _time: TimelineTime, _rowId: string) => {
			menu.addItem((item) => { item.setTitle('Move elsewhere'); });
		});
		const fixture = standing(oneLane(), { subrowMenuItems: offered });
		menus.length = 0;
		const more = fixture.subrows('a', 'time-1')[0]!.querySelector('.snowflake-method-timeline-subrow-more')!;
		fire(more, 'click', {});
		expect(menus[0]!.map((item) => item.title)).toEqual([
			'actions.moveUp', 'actions.moveDown', 'Move elsewhere', 'timeline.subrow.remove',
		]);
		expect(offered).toHaveBeenCalledOnce();
		expect(offered.mock.calls[0]![1]).toMatchObject({ id: 'a' });
		expect(offered.mock.calls[0]![2]).toMatchObject({ timeId: 'time-1' });
		expect(offered.mock.calls[0]![3]).toBe('r1');
	});

	it('offers the moves and the removal alone to a host with nothing to add', () => {
		const fixture = standing(oneLane());
		menus.length = 0;
		fire(fixture.subrows('a', 'time-1')[0]!.querySelector('.snowflake-method-timeline-subrow-more')!, 'click', {});
		expect(menus[0]!.map((item) => item.title)).toEqual(['actions.moveUp', 'actions.moveDown', 'timeline.subrow.remove']);
	});
});

describe('a row moved to another cell of its lane', () => {
	it('lands by a drag under the host\'s own type, and is taken over by the cell it moved to as it stands', async () => {
		const fixture = standing(oneLane());
		const handle = fixture.subrows('a', 'time-1')[0]!.querySelector('.snowflake-method-timeline-subrow-handle')!;
		const data = transfer([ROW_TYPE]);
		fire(handle, 'dragstart', { dataTransfer: data });
		expect(data.getData(ROW_TYPE)).toBe('r1');
		expect(fixture.cells.dragging()).toBe(true);
		expect(fixture.root.classes.has('is-row-drag')).toBe(true);
		const card = fixture.cards()[0]!;
		const target = fixture.cellEl('a', 'time-2');
		fire(target, 'dragover', { dataTransfer: data, clientY: 0 });
		fire(target, 'drop', { dataTransfer: data, clientY: 0 });
		fire(handle, 'dragend', {});
		await settle();
		expect(fixture.bridge.moveRow).toHaveBeenCalledExactlyOnceWith('a', 'r1', 'time-2', null);
		expect(fixture.endDrag).toHaveBeenCalledOnce();
		expect(fixture.cells.dragging()).toBe(false);
		expect(fixture.root.classes.has('is-row-drag')).toBe(false);
		// The same card stands in the other cell: the sub-row came over whole.
		expect(fixture.subrows('a', 'time-2')).toHaveLength(1);
		expect(fixture.cards()[0]).toBe(card);
		expect(target.contains(card)).toBe(true);
	});

	it('hands the phase of a drag to the host for the parts that are the host\'s', () => {
		const fixture = standing([...oneLane(), lane('b', [{ timeId: 'time-1', rows: [] }])]);
		fixture.dragPhase.mockClear();
		const handle = fixture.subrows('a', 'time-1')[0]!.querySelector('.snowflake-method-timeline-subrow-handle')!;
		fire(handle, 'dragstart', { dataTransfer: transfer([ROW_TYPE]) });
		const stateOf = fixture.dragPhase.mock.calls[0]![0] as (laneId: string) => string;
		expect(stateOf('a')).toBe('lane');
		expect(stateOf('b')).toBe('locked');
		expect(fixture.cellEl('a', 'time-1').classes.has('is-drag-lane')).toBe(true);
		expect(fixture.cellEl('b', 'time-1').classes.has('is-locked-out')).toBe(true);
		fire(handle, 'dragend', {});
		expect(fixture.cellEl('b', 'time-1').classes.has('is-locked-out')).toBe(false);
	});
});

describe('scenes on a row', () => {
	it('deals a card per scene placed, and one card in front once the rows are stacked, and lays them flat again', () => {
		const fixture = standing([lane('a', [{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-1', 'scene-2'])] }])]);
		expect(fixture.cards()).toHaveLength(2);
		fixture.present('stack');
		fixture.paint();
		expect(fixture.cards()).toHaveLength(1);
		expect(fixture.cellEl('a', 'time-1').querySelector('.snowflake-method-timeline-stack-position')!.textContent).toBe('timeline.stack.position');
		// The place walked to is remembered under the key the host made.
		fire(fixture.cellEl('a', 'time-1').querySelector('.snowflake-method-timeline-stack-next')!, 'click', {});
		expect(fixture.stackPositions.get(joinKey('view', 'a', 'r1'))).toBe(1);
		fixture.present('flat');
		fixture.paint();
		expect(fixture.cards()).toHaveLength(2);
		expect(fixture.cellEl('a', 'time-1').querySelector('.snowflake-method-timeline-stack')).toBeNull();
	});

	it('stands in for a scene the project no longer has, under the host\'s own words for taking it off', async () => {
		const fixture = standing([lane('a', [{ timeId: 'time-1', rows: [row('r1', 'Arrives', ['scene-gone'])] }])]);
		const remove = fixture.cellEl('a', 'time-1').querySelector('.snowflake-method-timeline-scene-missing-remove')!;
		expect(remove.getAttribute('aria-label')).toBe('host.sceneRemove');
		fire(remove, 'click', {});
		await settle();
		expect(fixture.bridge.removeScene).toHaveBeenCalledExactlyOnceWith('a', 'scene-gone');
	});

	it('lets a card drag from the active lane alone, and from none on a project that cannot be written', () => {
		const fixture = standing(oneLane());
		const card = [...fixture.deck.cards.values()][0]!;
		expect(fixture.cells.dragAllowed(card)).toBe(true);
		fixture.activate('elsewhere');
		expect(fixture.cells.dragAllowed(card)).toBe(false);
		fixture.activate('a');
		fixture.readOnly(true);
		expect(fixture.cells.dragAllowed(card)).toBe(false);
	});
});

describe('what the scene pool is dealt', () => {
	it('sends a pool card out under the host\'s type, locks the active lane, and ends through the host', () => {
		const fixture = standing(oneLane());
		const variant = fixture.cells.poolVariant();
		expect(variant.dragOut!.type).toBe(SCENE_TYPE);
		variant.dragOut!.onStart('scene-2', transfer([SCENE_TYPE]) as unknown as DataTransfer);
		expect(fixture.cells.dragging()).toBe(true);
		expect(fixture.root.classes.has('is-scene-drag')).toBe(true);
		// A card that came from the pool is not the pool's to take back.
		expect(variant.dropIn!.accepts([SCENE_TYPE])).toBe(false);
		variant.dragOut!.onEnd();
		expect(fixture.endDrag).toHaveBeenCalledOnce();
		expect(fixture.cells.dragging()).toBe(false);
	});

	it('takes a lane\'s card back, giving up its place on the lane', async () => {
		const fixture = standing(oneLane());
		const card = fixture.cards()[0]!;
		const data = transfer([SCENE_TYPE]);
		fire(card, 'dragstart', { dataTransfer: data, target: card });
		const variant = fixture.cells.poolVariant();
		expect(variant.dropIn!.accepts([SCENE_TYPE])).toBe(true);
		expect(variant.dropIn!.accepts(['text/plain'])).toBe(false);
		variant.dropIn!.onDrop(data as unknown as DataTransfer);
		fire(card, 'dragend', {});
		await settle();
		expect(fixture.bridge.removeScene).toHaveBeenCalledExactlyOnceWith('a', 'scene-1');
		expect(fixture.cards()).toHaveLength(0);
	});

	it('gives a pool card\'s menu the way onto a row that a drag would take', () => {
		const fixture = standing(oneLane());
		const menu = new Menu();
		fixture.cells.poolVariant().menuItems!('scene-2', menu);
		menu.showAtMouseEvent({} as MouseEvent);
		expect(menus[menus.length - 1]!.map((item) => item.title)).toEqual(['timeline.scene.moveTo']);
	});
});

describe('the mark a drop would land on', () => {
	it('is one for the cells and the host alike, moved from element to element and taken off whole', () => {
		const fixture = standing(oneLane());
		const first = fixture.cellEl('a', 'time-1');
		const second = fixture.cellEl('a', 'time-2');
		fixture.cells.setMark(first as unknown as HTMLElement, 'is-drop-before');
		fixture.cells.setMark(second as unknown as HTMLElement, 'is-drop-target');
		expect(first.classes.has('is-drop-before')).toBe(false);
		expect(second.classes.has('is-drop-target')).toBe(true);
		fixture.cells.clearMark();
		expect(second.classes.has('is-drop-target')).toBe(false);
	});
});

describe('words still being written as the workspace goes', () => {
	it('writes what stands at a foot and an edit left open, the way a leave sends them', async () => {
		const fixture = standing(oneLane());
		const foot = fixture.foot('a', 'time-2');
		foot.value = 'Left at the foot';
		foot.dispatch('input');
		const subrow = fixture.subrows('a', 'time-1')[0]!;
		subrow.querySelector('.snowflake-method-timeline-subrow-label')!.dispatch('click');
		subrow.querySelector('.snowflake-method-timeline-subrow-input')!.value = 'Left open';
		fixture.dispose();
		fixture.cells.settle();
		await settle();
		expect(fixture.bridge.editRow).toHaveBeenCalledExactlyOnceWith('a', 'r1', 'Left open');
		expect(fixture.bridge.addRow).toHaveBeenCalledExactlyOnceWith('a', 'time-2', 'Left at the foot', null);
	});

	it('shows refused words in a dialog that outlives the workspace, under the host\'s name for the place', async () => {
		const opened: TimelineDraftModal[] = [];
		const open = vi.spyOn(TimelineDraftModal.prototype, 'open').mockImplementation(function (this: TimelineDraftModal) { opened.push(this); });
		try {
			const fixture = standing(oneLane());
			const foot = fixture.foot('a', 'time-2');
			foot.value = 'Refused at the end';
			foot.dispatch('input');
			fixture.bridge.addRow.mockResolvedValueOnce(null);
			fixture.dispose();
			fixture.cells.settle();
			await settle();
			expect(opened).toHaveLength(1);
			expect((opened[0] as unknown as { drafts: unknown }).drafts).toEqual([{ place: 'a · time-2', words: 'Refused at the end' }]);
		} finally {
			open.mockRestore();
		}
	});

	it('keeps them in the console instead while the plugin is unloading', async () => {
		const open = vi.spyOn(TimelineDraftModal.prototype, 'open').mockImplementation(() => undefined);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const fixture = standing(oneLane());
			fixture.readOnly(true);
			const foot = fixture.foot('a', 'time-2');
			foot.value = 'Kept at unload';
			foot.dispatch('input');
			fixture.unload();
			fixture.dispose();
			fixture.cells.settle();
			await settle();
			expect(open).not.toHaveBeenCalled();
			expect(fixture.bridge.addRow).not.toHaveBeenCalled();
			expect(logged).toHaveBeenCalledExactlyOnceWith(
				'Snowflake: sub-description words could not be written',
				{ place: 'a · time-2', words: 'Kept at unload' },
			);
		} finally {
			open.mockRestore();
			logged.mockRestore();
		}
	});
});
