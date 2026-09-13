import { beforeEach, describe, expect, it } from "vitest";

import { MAIN_TIMELINE_VIEW_ID, type Timeline, type TimelineView } from "../../src/domain";
import {
	SnowflakeProjectService,
	TIMELINE_STORE_SCHEMA_VERSION,
	TimelineService,
	TimelineStore,
	isTimelineFilePath,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const FILE =
	"Snowflake Projects/Novel/70_Tool/73_Visualization/733_Timeline/timeline.json";

const makeTimeline = (id: string, overrides: Partial<Timeline> = {}): Timeline => ({
	id,
	name: `Timeline ${id}`,
	binding: null,
	times: [],
	createdAt: 7,
	updatedAt: 7,
	...overrides,
});

const makeView = (id: string, overrides: Partial<TimelineView> = {}): TimelineView => ({
	id,
	name: `View ${id}`,
	timelines: [],
	timeOrder: [],
	presentation: null,
	cardStyle: null,
	showSubDescriptions: true,
	timesReversed: false,
	createdAt: 7,
	updatedAt: 7,
	...overrides,
});

/** The view a test made, by id: the project's own Main view stands first. */
const viewOf = (held: { views: readonly TimelineView[] }, id: string): TimelineView | undefined =>
	held.views.find((view) => view.id === id);

const fileOf = (fakeVault: FakeVault): Record<string, unknown> =>
	JSON.parse(fakeVault.contents.get(FILE) ?? "{}") as Record<string, unknown>;

describe("isTimelineFilePath", () => {
	it("knows the timeline file of either language, and nothing that merely shares its name", () => {
		expect(isTimelineFilePath(FILE)).toBe(true);
		expect(
			isTimelineFilePath("Snowflake Projects/Novel/70_工具/73_可视化/733_时间线/timeline.json"),
		).toBe(true);
		expect(isTimelineFilePath("Snowflake Projects/Novel/733_Timeline/timeline.json")).toBe(false);
		expect(
			isTimelineFilePath(
				"Snowflake Projects/Novel/70_Tool/73_Visualization/733_Timeline/notes.json",
			),
		).toBe(false);
		expect(isTimelineFilePath("timeline.json")).toBe(false);
	});
});

describe("TimelineStore", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let store: TimelineStore;
	let asides: string[];
	let foreign: [string, number][];

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await service.createProject({ title: "Novel", locale: "en" });
		asides = [];
		foreign = [];
		store = new TimelineStore({
			repository: service.repository,
			now: () => 1234,
			onCorrupt: (path) => asides.push(path),
			onForeign: (path, version) => foreign.push([path, version]),
		});
	});

	it("reads a fresh document where no file stands, one view named in the project's language, and creates the file on the first write", async () => {
		expect(await store.readDocument(project)).toEqual({
			timelines: [],
			views: [expect.objectContaining({ id: MAIN_TIMELINE_VIEW_ID, name: "Main", timelines: [] })],
			pinnedTimelineId: null,
			lastViewId: null,
			strays: { timelines: [], views: [] },
		});
		expect((await store.readDocument({ ...project, locale: "zh-CN" })).views[0]?.name).toBe("主视图");
		const timeline = makeTimeline("tl-1");
		expect(
			await store.updateDocument(project, (held) => ({
				...held,
				timelines: [timeline],
				pinnedTimelineId: "tl-1",
			})),
		).toBe(true);
		const written = fakeVault.contents.get(FILE) ?? "";
		expect(written).toContain('"schemaVersion": 1');
		expect(written).toContain('"timelines": [');
		expect(written).toContain('"name": "Main"');
		expect(written).toContain('"pinnedTimelineId": "tl-1"');
		expect(written).toContain('"lastViewId": null');
		expect(await store.readDocument(project)).toMatchObject({
			timelines: [timeline],
			pinnedTimelineId: "tl-1",
		});
	});

	it("stores under the visualization chain of the project's locale", () => {
		expect(store.timelinePath(project)).toBe(FILE);
		expect(store.timelinePath({ ...project, locale: "zh-CN" })).toBe(
			"Snowflake Projects/Novel/70_工具/73_可视化/733_时间线/timeline.json",
		);
	});

	it("a mutate answering null leaves the file unwritten", async () => {
		expect(await store.updateDocument(project, () => null)).toBe(false);
		expect(fakeVault.contents.has(FILE)).toBe(false);
	});

	it("carries the entries it cannot read through every write, after the ones it can", async () => {
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: TIMELINE_STORE_SCHEMA_VERSION,
				timelines: [{ name: "nameless" }, makeTimeline("tl-1")],
				views: [makeView("v-1"), { id: 7 }],
				pinnedTimelineId: null,
				lastViewId: null,
			}),
		);
		const held = await store.readDocument(project);
		expect(held.timelines.map((timeline) => timeline.id)).toEqual(["tl-1"]);
		expect(held.views.map((view) => view.id)).toEqual(["v-1"]);
		expect(held.strays).toEqual({ timelines: [{ name: "nameless" }], views: [{ id: 7 }] });
		await store.updateDocument(project, (current) => ({
			...current,
			timelines: [...current.timelines, makeTimeline("tl-2")],
		}));
		const file = fileOf(fakeVault);
		expect((file.timelines as unknown[]).map((entry) => (entry as { id?: string }).id)).toEqual([
			"tl-1",
			"tl-2",
			undefined,
		]);
		expect(file.views).toEqual([makeView("v-1"), { id: 7 }]);
	});

	it("leaves a file written to a newer schema as it stands, refusing to write over it", async () => {
		const content = JSON.stringify({
			schemaVersion: TIMELINE_STORE_SCHEMA_VERSION + 1,
			lanes: [],
		});
		await fakeVault.seedFile(FILE, content);
		expect((await store.readDocument(project)).timelines).toEqual([]);
		await store.readDocument(project);
		expect(foreign).toEqual([[FILE, 2]]);
		expect(
			await store.updateDocument(project, (held) => ({
				...held,
				timelines: [makeTimeline("tl-1")],
			})),
		).toBe(false);
		expect(fakeVault.contents.get(FILE)).toBe(content);
		expect(foreign).toHaveLength(2);
		expect(asides).toEqual([]);
	});

	it("sets a damaged file aside, and one from before the first schema likewise", async () => {
		await fakeVault.seedFile(FILE, '{"schemaVersion": 1, "timelines": 7, "views": []}');
		expect((await store.readDocument(project)).timelines).toEqual([]);
		expect(asides).toEqual([FILE.replace(/\.json$/u, ".corrupted-1234.json")]);
		expect(foreign).toEqual([]);
		fakeVault.contents.delete(FILE);
		await fakeVault.seedFile(FILE, '{"schemaVersion": 0, "timelines": [], "views": []}');
		store.evict(project.rootPath);
		expect(asides).toHaveLength(1);
	});

	it("keeps its memo through a refused write and a write that changed nothing", async () => {
		await store.updateDocument(project, (held) => ({ ...held, timelines: [makeTimeline("tl-1")] }));
		await store.readDocument(project);
		const reads = fakeVault.readCalls.filter((path) => path === FILE).length;
		expect(await store.updateDocument(project, () => null)).toBe(false);
		await store.readDocument(project);
		expect(fakeVault.readCalls.filter((path) => path === FILE)).toHaveLength(reads + 1);
	});
});

describe("TimelineService", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let timelines: TimelineService;
	let clock: number;
	let serial: number;

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await service.createProject({ title: "Novel", locale: "en" });
		clock = 100;
		serial = 0;
		timelines = new TimelineService(service.repository, {
			now: () => clock,
			mintId: (prefix) => `${prefix}-${String(++serial)}`,
		});
	});

	it("mints ids of its own for timelines, views and rows", async () => {
		const timelineId = await timelines.createTimeline(project, { name: "Main", binding: null });
		expect(timelineId).toBe("timeline-1");
		const viewId = await timelines.createView(project, { name: "All", timelines: [timelineId!] });
		expect(viewId).toBe("timeline-view-2");
		const rowId = await timelines.addRow(project, timelineId!, "time-1", "Arrives", null);
		expect(rowId).toBe("timeline-row-3");
		const held = await timelines.read(project);
		expect(held.timelines[0]).toMatchObject({
			id: "timeline-1",
			name: "Main",
			times: [{ timeId: "time-1", rows: [{ id: "timeline-row-3", text: "Arrives", scenes: [] }] }],
			createdAt: 100,
			updatedAt: 100,
		});
		expect(viewOf(held, "timeline-view-2")).toMatchObject({ id: "timeline-view-2", timelines: ["timeline-1"] });
	});

	it("answers written, absent or refused, and writes once per change", async () => {
		const id = (await timelines.createTimeline(project, { name: "Main", binding: null }))!;
		const before = fakeVault.processCalls.filter((path) => path === FILE).length;
		clock = 200;
		expect(await timelines.renameTimeline(project, id, "Story")).toBe("written");
		expect(await timelines.renameTimeline(project, id, "Story")).toBe("written");
		expect(await timelines.renameTimeline(project, "timeline-9", "Story")).toBe("absent");
		expect(fakeVault.processCalls.filter((path) => path === FILE)).toHaveLength(before + 3);
		expect((await timelines.read(project)).timelines[0]).toMatchObject({ name: "Story", updatedAt: 200 });
		await fakeVault.seedFile(
			`${project.rootPath}/70_Tool/73_Visualization/733_Timeline/timeline.corrupted-0.json`,
			"",
		);
		fakeVault.contents.set(FILE, JSON.stringify({ schemaVersion: 99 }));
		expect(await timelines.renameTimeline(project, id, "Newer")).toBe("refused");
		expect(await timelines.deleteTimeline(project, id)).toBe("refused");
		expect(await timelines.createView(project, { name: "x", timelines: [] })).toBeNull();
	});

	it("refuses to bind a scene or a time before the store is asked", async () => {
		const id = (await timelines.createTimeline(project, { name: "Main", binding: null }))!;
		const before = fakeVault.processCalls.length;
		expect(await timelines.bindTimeline(project, id, { kind: "time", id: "t", name: "T" })).toBe("refused");
		expect(await timelines.bindTimeline(project, id, { kind: "scene", id: "s", name: "S" })).toBe("refused");
		expect(fakeVault.processCalls).toHaveLength(before);
		expect(await timelines.createTimeline(project, { name: "x", binding: { kind: "scene", id: "s", name: "S" } })).toBeNull();
		expect(
			await timelines.bindTimeline(project, id, { kind: "character", id: "c", name: "Alice", extra: 1 } as never),
		).toBe("written");
		expect((await timelines.read(project)).timelines[0]?.binding).toEqual({ kind: "character", id: "c", name: "Alice" });
	});

	it("deletes a timeline out of its views and the pin, and a view without its timelines", async () => {
		const a = (await timelines.createTimeline(project, { name: "A", binding: null }))!;
		const b = (await timelines.createTimeline(project, { name: "B", binding: null }))!;
		const viewId = (await timelines.createView(project, { name: "Both", timelines: [a, b] }))!;
		expect(await timelines.pinTimeline(project, a)).toBe("written");
		expect(await timelines.pinTimeline(project, "timeline-9")).toBe("absent");
		expect(await timelines.setLastView(project, viewId)).toBe("written");
		expect(await timelines.deleteTimeline(project, a)).toBe("deleted");
		expect(await timelines.deleteTimeline(project, a)).toBe("absent");
		let held = await timelines.read(project);
		expect(held.timelines.map((timeline) => timeline.id)).toEqual([b]);
		expect(viewOf(held, viewId)?.timelines).toEqual([b]);
		expect(held.pinnedTimelineId).toBeNull();
		expect(await timelines.deleteView(project, viewId)).toBe("deleted");
		held = await timelines.read(project);
		expect(held.views.map((view) => view.id)).toEqual([MAIN_TIMELINE_VIEW_ID]);
		expect(held.lastViewId).toBeNull();
		expect(held.timelines).toHaveLength(1);
	});

	it("moves rows and scenes within one timeline, and orders a view's times and lanes", async () => {
		const a = (await timelines.createTimeline(project, { name: "A", binding: null }))!;
		const b = (await timelines.createTimeline(project, { name: "B", binding: null }))!;
		const viewId = (await timelines.createView(project, { name: "Both", timelines: [a, b] }))!;
		const first = (await timelines.addRow(project, a, "time-1", "one", null))!;
		const second = (await timelines.addRow(project, a, "time-1", "two", null, ["scene-1", "scene-2"]))!;
		expect(await timelines.placeScene(project, a, "scene-3", first, null)).toBe("written");
		expect(await timelines.placeScene(project, a, "scene-1", first, "scene-3")).toBe("written");
		expect(await timelines.moveRow(project, a, second, "time-2", null)).toBe("written");
		expect(await timelines.removeScene(project, a, "scene-2")).toBe("written");
		expect(await timelines.editRow(project, a, first, "once")).toBe("written");
		expect(await timelines.editRow(project, a, "timeline-row-9", "x")).toBe("written");
		expect(await timelines.moveTimelineInView(project, viewId, b, a)).toBe("written");
		expect(await timelines.setTimeOrder(project, viewId, ["time-2", "time-1"])).toBe("written");
		expect(await timelines.setViewPresentation(project, viewId, "flat")).toBe("written");
		expect(await timelines.setViewCardStyle(project, viewId, "extended")).toBe("written");
		expect(await timelines.setViewSubDescriptions(project, viewId, false)).toBe("written");
		expect(await timelines.setViewTimelines(project, "timeline-view-9", [a])).toBe("absent");
		const held = await timelines.read(project);
		expect(held.timelines[0]?.times).toEqual([
			{ timeId: "time-1", rows: [{ id: first, text: "once", scenes: ["scene-1", "scene-3"] }] },
			{ timeId: "time-2", rows: [{ id: second, text: "two", scenes: [] }] },
		]);
		expect(viewOf(held, viewId)).toMatchObject({
			timelines: [b, a],
			timeOrder: ["time-2", "time-1"],
			presentation: "flat",
			cardStyle: "extended",
			showSubDescriptions: false,
		});
		expect(await timelines.removeTime(project, a, "time-2")).toBe("written");
		expect(await timelines.addTime(project, a, "time-3")).toBe("written");
		expect(await timelines.deleteRow(project, a, first)).toBe("written");
		expect((await timelines.read(project)).timelines[0]?.times).toEqual([
			{ timeId: "time-1", rows: [] },
			{ timeId: "time-3", rows: [] },
		]);
		expect(await timelines.pruneMissing(project, { timeIds: new Set(["time-1"]) })).toBe("written");
		expect(viewOf(await timelines.read(project), viewId)?.timeOrder).toEqual(["time-1"]);
	});
});
