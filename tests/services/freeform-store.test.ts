import { beforeEach, describe, expect, it } from "vitest";

import { MAIN_FREEFORM_VIEW_ID, newFreeformView, type FreeformStep, type FreeformView } from "../../src/domain";
import {
	FREEFORM_FOLDER_FILE_NAME,
	FREEFORM_STORE_SCHEMA_VERSION,
	FreeformService,
	FreeformStore,
	SnowflakeProjectService,
	freeformViewIdOfFileName,
	isFreeformFilePath,
	isFreeformViewFilePath,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const FOLDER = "Snowflake Projects/Novel/70_Tool/73_Visualization/732_Freeform";
const fileOf = (id: string): string => `${FOLDER}/${id}.json`;
/** The folder's own file, which says the author took every view away. */
const FOLDER_FILE = `${FOLDER}/${FREEFORM_FOLDER_FILE_NAME}`;

const makeView = (id: string, overrides: Partial<FreeformView> = {}): FreeformView => ({
	...newFreeformView({ id, name: `View ${id}`, now: 7 }),
	...overrides,
});

const stored = (fakeVault: FakeVault, id: string): Record<string, unknown> =>
	JSON.parse(fakeVault.contents.get(fileOf(id)) ?? "{}") as Record<string, unknown>;

const text = (id: string, x = 0, y = 0) => ({ id, resource: { type: "text" as const, text: id }, x, y });

describe("isFreeformViewFilePath", () => {
	it("knows a view's file of either language, and nothing that merely stands beside one", () => {
		expect(isFreeformViewFilePath(fileOf("freeform-view-1a2b"))).toBe(true);
		expect(
			isFreeformViewFilePath("Snowflake Projects/Novel/70_工具/73_可视化/732_自由画布/freeform-view-1a2b.json"),
		).toBe(true);
		expect(isFreeformViewFilePath(`${FOLDER}/freeform-view-1a2b.corrupted-1234.json`)).toBe(false);
		expect(isFreeformViewFilePath(`${FOLDER}/notes.json`)).toBe(false);
		// The folder's own file is the freeform's, and no view.
		expect(isFreeformViewFilePath(FOLDER_FILE)).toBe(false);
		expect(isFreeformViewFilePath(`${FOLDER}/freeform-view-1a2b.md`)).toBe(false);
		expect(isFreeformViewFilePath(`${FOLDER}/deeper/freeform-view-1a2b.json`)).toBe(false);
		expect(isFreeformViewFilePath("Snowflake Projects/Novel/732_Freeform/freeform-view-1a2b.json")).toBe(false);
		// The timeline's folder is the timeline's, whatever a file in it is called.
		expect(
			isFreeformViewFilePath("Snowflake Projects/Novel/70_Tool/73_Visualization/733_Timeline/freeform-view-1a2b.json"),
		).toBe(false);
		expect(isFreeformViewFilePath("freeform-view-1a2b.json")).toBe(false);
	});

	it("knows the folder's own file as the freeform's beside its views, and nothing else in the folder", () => {
		expect(isFreeformFilePath(FOLDER_FILE)).toBe(true);
		expect(isFreeformFilePath("Snowflake Projects/Novel/70_工具/73_可视化/732_自由画布/freeform.json")).toBe(true);
		expect(isFreeformFilePath(fileOf("freeform-view-1a2b"))).toBe(true);
		expect(isFreeformFilePath(`${FOLDER}/notes.json`)).toBe(false);
		expect(isFreeformFilePath(`${FOLDER}/freeform.corrupted-1234.json`)).toBe(false);
		expect(isFreeformFilePath(`${FOLDER}/freeform-view-1a2b.corrupted-1234.json`)).toBe(false);
		expect(isFreeformFilePath("Snowflake Projects/Novel/70_Tool/73_Visualization/733_Timeline/freeform.json")).toBe(false);
		expect(isFreeformFilePath("freeform.json")).toBe(false);
	});

	it("reads a view's id off its file's name", () => {
		expect(freeformViewIdOfFileName("freeform-view-6f1c2a9e-0b7d.json")).toBe("freeform-view-6f1c2a9e-0b7d");
		expect(freeformViewIdOfFileName("freeform-view-.json")).toBeNull();
		expect(freeformViewIdOfFileName("freeform-view-a b.json")).toBeNull();
		expect(freeformViewIdOfFileName("view-1.json")).toBeNull();
	});
});

describe("FreeformStore", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let store: FreeformStore;
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
		store = new FreeformStore({
			repository: service.repository,
			now: () => 1234,
			onCorrupt: (path) => asides.push(path),
			onForeign: (path, version) => foreign.push([path, version]),
		});
	});

	it("reads one fresh view named in the project's language where none was made, the same object every time, and makes a view's file on its first write", async () => {
		const fresh = await store.readDocument(project);
		expect(fresh.views.map((view) => [view.id, view.name, view.placements.length, view.createdAt])).toEqual([[MAIN_FREEFORM_VIEW_ID, "Main", 0, 0]]);
		expect(await store.readDocument(project)).toBe(fresh);
		expect((await store.readDocument({ ...project, locale: "zh-CN" })).views.map((view) => view.name)).toEqual(["主视图"]);
		// Nothing is written for the reading of it.
		expect(fakeVault.contents.has(fileOf(MAIN_FREEFORM_VIEW_ID))).toBe(false);
		const view = makeView("freeform-view-1");
		expect(await store.updateView(project, view.id, (held) => (held === null ? view : null))).toBe(true);
		const written = fakeVault.contents.get(fileOf(view.id)) ?? "";
		expect(written).toContain('"schemaVersion": 1');
		expect(written).toContain('"name": "View freeform-view-1"');
		expect(written).toContain('"placements": []');
		// What the store could not read is carried in place, never under a key of its own.
		expect(written).not.toContain("strays");
		expect(await store.readDocument(project)).toEqual({ views: [view] });
	});

	it("writes the fresh view's file on the first change meant for it, and reads the file from then on", async () => {
		const fresh = (await store.readDocument(project)).views[0]!;
		expect(await store.updateView(project, MAIN_FREEFORM_VIEW_ID, (held) => (held === null ? null : { ...held, name: "Opening", updatedAt: 9 }))).toBe(true);
		expect(fakeVault.contents.has(fileOf(MAIN_FREEFORM_VIEW_ID))).toBe(true);
		const read = await store.readDocument(project);
		expect(read.views.map((view) => [view.id, view.name])).toEqual([[MAIN_FREEFORM_VIEW_ID, "Opening"]]);
		expect(read.views[0]).not.toBe(fresh);
		// Beside a view of the project's own, the fresh one is no longer read.
		await store.updateView(project, "freeform-view-2", () => makeView("freeform-view-2", { createdAt: 3 }));
		expect((await store.readDocument(project)).views.map((view) => view.id)).toEqual([MAIN_FREEFORM_VIEW_ID, "freeform-view-2"]);
		// A change meant for a view that never was still makes nothing.
		expect(await store.updateView(project, "freeform-view-9", (held) => (held === null ? null : held))).toBe(false);
		// And one meant for the fresh view once it has gone, beside a view of the project's own, makes it again no more.
		expect(await store.trashView(project, MAIN_FREEFORM_VIEW_ID)).toBe("deleted");
		expect(await store.updateView(project, MAIN_FREEFORM_VIEW_ID, (held) => (held === null ? null : { ...held, name: "Back" }))).toBe(false);
		expect(fakeVault.contents.has(fileOf(MAIN_FREEFORM_VIEW_ID))).toBe(false);
	});

	it("writes nothing for a leave of the fresh view, while it is no file", async () => {
		expect(await store.updateView(project, MAIN_FREEFORM_VIEW_ID, (held) => (held === null ? null : { ...held, viewport: { x: 3, y: 4, zoom: 2 } }), false)).toBe(false);
		expect(fakeVault.contents.has(fileOf(MAIN_FREEFORM_VIEW_ID))).toBe(false);
		expect(fakeVault.contents.has(FOLDER_FILE)).toBe(false);
	});

	it("takes the fresh view away though it is no file, by saying in the folder that its views are gone", async () => {
		expect(await store.trashView(project, MAIN_FREEFORM_VIEW_ID)).toBe("deleted");
		expect(fakeVault.contents.has(fileOf(MAIN_FREEFORM_VIEW_ID))).toBe(false);
		expect(JSON.parse(fakeVault.contents.get(FOLDER_FILE)!)).toEqual({ schemaVersion: FREEFORM_STORE_SCHEMA_VERSION });
		// The project reads with no view from here on, the same object every time, and not as fresh again.
		const none = await store.readDocument(project);
		expect(none.views).toEqual([]);
		expect(await store.readDocument(project)).toBe(none);
		// A change meant for the fresh view finds nothing now, as one meant for any view that has gone does.
		expect(await store.updateView(project, MAIN_FREEFORM_VIEW_ID, (held) => (held === null ? null : { ...held, name: "Back" }))).toBe(false);
		expect(fakeVault.contents.has(fileOf(MAIN_FREEFORM_VIEW_ID))).toBe(false);
		// Taken away once, there is nothing to take again.
		expect(await store.trashView(project, MAIN_FREEFORM_VIEW_ID)).toBe("absent");
		// A view made after it stands beside the folder's file, which is no view.
		await store.updateView(project, "freeform-view-1", () => makeView("freeform-view-1"));
		expect((await store.readDocument(project)).views.map((view) => view.id)).toEqual(["freeform-view-1"]);
	});

	it("has nothing to trash for the fresh view beside a view of the project's own, and reads no view once the last of them is gone", async () => {
		await store.updateView(project, "freeform-view-1", () => makeView("freeform-view-1"));
		await store.updateView(project, "freeform-view-2", () => makeView("freeform-view-2"));
		expect((await store.readDocument(project)).views.map((view) => view.id)).toEqual(["freeform-view-1", "freeform-view-2"]);
		expect(await store.trashView(project, MAIN_FREEFORM_VIEW_ID)).toBe("absent");
		// One of two gone leaves the folder with a view, and nothing more is written.
		expect(await store.trashView(project, "freeform-view-1")).toBe("deleted");
		expect(fakeVault.contents.has(FOLDER_FILE)).toBe(false);
		// The last gone would leave the folder as it stood before anything was
		// written, and the fresh view would stand again; the folder says
		// instead that its views are gone.
		expect(await store.trashView(project, "freeform-view-2")).toBe("deleted");
		expect(fakeVault.contents.has(FOLDER_FILE)).toBe(true);
		expect((await store.readDocument(project)).views).toEqual([]);
	});

	it("stores under the visualization chain of the project's locale", () => {
		expect(store.viewPath(project, "freeform-view-1")).toBe(fileOf("freeform-view-1"));
		expect(store.viewPath({ ...project, locale: "zh-CN" }, "freeform-view-1")).toBe(
			"Snowflake Projects/Novel/70_工具/73_可视化/732_自由画布/freeform-view-1.json",
		);
	});

	it("makes the folder chain on the way to the first write, for a project that has none", async () => {
		fakeVault.delete("Snowflake Projects/Novel/70_Tool");
		const view = makeView("freeform-view-1");
		expect(await store.updateView(project, view.id, () => view)).toBe(true);
		expect(fakeVault.contents.has(fileOf(view.id))).toBe(true);
	});

	it("a mutate answering null leaves no file behind, so a view that has gone is never made again", async () => {
		expect(await store.updateView(project, "freeform-view-1", () => null)).toBe(false);
		expect(fakeVault.contents.has(fileOf("freeform-view-1"))).toBe(false);
	});

	it("lists the views in the order they were made, whatever their files are called", async () => {
		await store.updateView(project, "freeform-view-b", () => makeView("freeform-view-b", { createdAt: 1 }));
		await store.updateView(project, "freeform-view-a", () => makeView("freeform-view-a", { createdAt: 5 }));
		await store.updateView(project, "freeform-view-c", () => makeView("freeform-view-c", { createdAt: 5 }));
		expect((await store.readDocument(project)).views.map((view) => view.id)).toEqual([
			"freeform-view-b",
			"freeform-view-a",
			"freeform-view-c",
		]);
	});

	it("takes the view's id from its file, so a copy made by hand is another view", async () => {
		await store.updateView(project, "freeform-view-1", () => makeView("freeform-view-1"));
		await fakeVault.seedFile(fileOf("freeform-view-copy"), fakeVault.contents.get(fileOf("freeform-view-1")) ?? "");
		const views = (await store.readDocument(project)).views;
		expect(views.map((view) => view.id)).toEqual(["freeform-view-1", "freeform-view-copy"]);
		expect(views.map((view) => view.name)).toEqual(["View freeform-view-1", "View freeform-view-1"]);
	});

	it("passes over what stands in the folder and is no view", async () => {
		await store.updateView(project, "freeform-view-1", () => makeView("freeform-view-1"));
		await fakeVault.seedFile(`${FOLDER}/notes.json`, '{"schemaVersion": 1, "name": "Not a view"}');
		await fakeVault.seedFile(`${FOLDER}/Readme.md`, "words");
		expect((await store.readDocument(project)).views.map((view) => view.id)).toEqual(["freeform-view-1"]);
		expect(asides).toEqual([]);
	});

	it("answers with the same document while no file moved, and reads again only the file that did", async () => {
		await store.updateView(project, "freeform-view-1", () => makeView("freeform-view-1"));
		await store.updateView(project, "freeform-view-2", () => makeView("freeform-view-2"));
		const first = await store.readDocument(project);
		expect(await store.readDocument(project)).toBe(first);
		const reads = (id: string): number =>
			fakeVault.readCalls.filter((path) => path === fileOf(id)).length;
		await store.updateView(project, "freeform-view-2", (held) => ({ ...held!, name: "Renamed" }));
		const before = [reads("freeform-view-1"), reads("freeform-view-2")];
		const second = await store.readDocument(project);
		expect(second).not.toBe(first);
		expect(second.views[0]).toBe(first.views[0]);
		expect(second.views[1]?.name).toBe("Renamed");
		expect([reads("freeform-view-1"), reads("freeform-view-2")]).toEqual([before[0], before[1]! + 1]);
	});

	it("carries the entries it cannot read through every write, after the ones it can", async () => {
		await fakeVault.seedFile(
			fileOf("freeform-view-1"),
			JSON.stringify({
				schemaVersion: FREEFORM_STORE_SCHEMA_VERSION,
				name: "Overview",
				placements: [{ id: "p9", resource: { type: "hologram" }, x: 0, y: 0 }, text("p1")],
				frames: [{ title: "no id" }],
				edges: [{ id: "e9", source: "p1", target: "p9" }],
			}),
		);
		const held = (await store.readDocument(project)).views[0]!;
		expect(held.placements.map((placement) => placement.id)).toEqual(["p1"]);
		expect(held.strays.placements).toHaveLength(1);
		await store.updateView(project, held.id, (current) => ({ ...current!, name: "Renamed" }));
		const file = stored(fakeVault, "freeform-view-1");
		expect((file.placements as { id?: string }[]).map((entry) => entry.id)).toEqual(["p1", "p9"]);
		expect(file.frames).toEqual([{ title: "no id" }]);
		expect(file.edges).toEqual([{ id: "e9", source: "p1", target: "p9" }]);
	});

	it("leaves a view written to a newer schema as it stands, still serves the rest, and tells of it once a reading", async () => {
		const content = JSON.stringify({ schemaVersion: FREEFORM_STORE_SCHEMA_VERSION + 1, name: "Newer", layers: [] });
		await fakeVault.seedFile(fileOf("freeform-view-new"), content);
		await fakeVault.seedFile(fileOf("freeform-view-newer"), JSON.stringify({ schemaVersion: 9, name: "Newest" }));
		await store.updateView(project, "freeform-view-1", () => makeView("freeform-view-1"));
		expect((await store.readDocument(project)).views.map((view) => view.id)).toEqual(["freeform-view-1"]);
		// Two newer files met in one reading are one telling, of the newest.
		expect(foreign).toEqual([[FOLDER, 9]]);
		await store.readDocument(project);
		expect(foreign).toHaveLength(1);
		expect(await store.updateView(project, "freeform-view-new", () => makeView("freeform-view-new"))).toBe(false);
		expect(fakeVault.contents.get(fileOf("freeform-view-new"))).toBe(content);
		expect(foreign[1]).toEqual([fileOf("freeform-view-new"), 2]);
		expect(await store.trashView(project, "freeform-view-new")).toBe("refused");
		expect(fakeVault.contents.get(fileOf("freeform-view-new"))).toBe(content);
		expect(asides).toEqual([]);
	});

	it("sets a damaged view aside alone, and serves the others", async () => {
		await fakeVault.seedFile(fileOf("freeform-view-bad"), '{"schemaVersion": 1, "name": "Bad", "placements": 7}');
		await fakeVault.seedFile(fileOf("freeform-view-worse"), "not json at all");
		await store.updateView(project, "freeform-view-1", () => makeView("freeform-view-1"));
		expect((await store.readDocument(project)).views.map((view) => view.id)).toEqual(["freeform-view-1"]);
		expect(asides.sort()).toEqual([
			`${FOLDER}/freeform-view-bad.corrupted-1234.json`,
			`${FOLDER}/freeform-view-worse.corrupted-1234.json`,
		]);
		// What was set aside is no view at the next reading either.
		expect((await store.readDocument(project)).views).toHaveLength(1);
		expect(foreign).toEqual([]);
	});

	it("takes a view's file to the trash, and says when there was none to take", async () => {
		await store.updateView(project, "freeform-view-1", () => makeView("freeform-view-1"));
		await store.readDocument(project);
		expect(await store.trashView(project, "freeform-view-1")).toBe("deleted");
		expect(fakeVault.contents.has(fileOf("freeform-view-1"))).toBe(false);
		expect(await store.trashView(project, "freeform-view-1")).toBe("absent");
		// With its own view gone, the project reads with none, not as fresh again.
		expect((await store.readDocument(project)).views).toEqual([]);
	});

	it("says how the vault last saw a view's file, without opening it", async () => {
		expect(store.stamp(project, "freeform-view-1")).toBeNull();
		await store.updateView(project, "freeform-view-1", () => makeView("freeform-view-1"));
		const stamp = store.stamp(project, "freeform-view-1");
		expect(stamp).toMatch(/^\d+:\d+$/u);
		await store.updateView(project, "freeform-view-1", (held) => ({ ...held!, name: "Longer name than before" }));
		const reads = fakeVault.readCalls.length;
		expect(store.stamp(project, "freeform-view-1")).not.toBe(stamp);
		expect(fakeVault.readCalls).toHaveLength(reads);
	});

	it("lets a project's memos go", async () => {
		await store.updateView(project, "freeform-view-1", () => makeView("freeform-view-1"));
		const first = await store.readDocument(project);
		store.evict(project.rootPath);
		const second = await store.readDocument(project);
		expect(second).not.toBe(first);
		expect(second).toEqual(first);
	});
});

describe("FreeformService", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let views: FreeformService;
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
		views = new FreeformService(service.repository, {
			now: () => clock,
			mintId: (prefix) => `${prefix}-${String(++serial)}`,
			limits: { placements: 3, frames: 1, edges: 2, textLength: 20, labelLength: 10 },
		});
	});

	const writes = (id: string): number =>
		fakeVault.processCalls.filter((path) => path === fileOf(id)).length;

	it("makes a view under an id of its own, and mints what stands on it under each prefix", async () => {
		const id = await views.createView(project, { name: "Story overview" });
		expect(id).toBe("freeform-view-1");
		expect((await views.read(project)).views[0]).toMatchObject({
			id: "freeform-view-1", name: "Story overview", createdAt: 100, updatedAt: 100, placements: [],
		});
		expect(views.mint("placement")).toBe("freeform-placement-2");
		expect(views.mint("frame")).toBe("freeform-frame-3");
		expect(views.mint("edge")).toBe("freeform-edge-4");
		expect(views.viewPath(project, id!)).toBe(fileOf("freeform-view-1"));
		expect(views.limits().placements).toBe(3);
	});

	it("renames and deletes a view, and answers absent for one that is not there", async () => {
		const id = (await views.createView(project, { name: "Draft" }))!;
		clock = 200;
		expect(await views.renameView(project, id, "Story")).toBe("written");
		expect(await views.renameView(project, id, "Story")).toBe("written");
		expect(await views.renameView(project, "freeform-view-9", "Story")).toBe("absent");
		expect((await views.read(project)).views[0]).toMatchObject({ name: "Story", updatedAt: 200 });
		expect(fakeVault.contents.has(fileOf("freeform-view-9"))).toBe(false);
		expect(await views.deleteView(project, id)).toBe("deleted");
		expect(await views.deleteView(project, id)).toBe("absent");
		// The last view gone, the project reads with none.
		expect((await views.read(project)).views).toEqual([]);
	});

	it("takes a gesture as one write, and answers with what takes it back", async () => {
		const id = (await views.createView(project, { name: "Draft" }))!;
		const before = writes(id);
		clock = 200;
		const steps: FreeformStep[] = [
			{ do: "add-frames", frames: [{ id: "f1", title: "Act I", color: null, x: 0, y: 0, width: 500, height: 400 }] },
			{ do: "add", placements: [{ ...text("p1", 40, 80), frameId: "f1" }, text("p2", 200, 80)] },
			{ do: "connect", edges: [{ id: "e1", source: "p1", target: "p2" }] },
		];
		const done = await views.transact(project, id, steps);
		expect(done.came).toBe("written");
		expect(done.inverse.map((step) => step.do)).toEqual(["delete", "delete", "delete"]);
		expect(writes(id)).toBe(before + 1);
		const view = (await views.read(project)).views[0]!;
		expect(view.updatedAt).toBe(200);
		expect(view.placements.map((placement) => [placement.id, placement.frameId])).toEqual([["p1", "f1"], ["p2", null]]);
		const back = await views.transact(project, id, done.inverse);
		expect(back.came).toBe("written");
		expect((await views.read(project)).views[0]).toMatchObject({ placements: [], frames: [], edges: [] });
		// And what takes the undoing back puts it all there again.
		expect((await views.transact(project, id, back.inverse)).came).toBe("written");
		expect((await views.read(project)).views[0]?.edges).toHaveLength(1);
	});

	it("answers written, absent, full or refused, and leaves the file as it was for all but the first", async () => {
		const id = (await views.createView(project, { name: "Draft" }))!;
		await views.transact(project, id, [{ do: "add", placements: [text("p1"), text("p2")] }]);
		const content = fakeVault.contents.get(fileOf(id));
		expect(await views.transact(project, id, [{ do: "text", id: "gone", text: "x" }]))
			.toEqual({ came: "absent", inverse: [] });
		expect(await views.transact(project, id, [{ do: "add", placements: [text("p3"), text("p4")] }]))
			.toEqual({ came: "full", inverse: [] });
		expect(await views.transact(project, id, [{ do: "text", id: "p1", text: "x".repeat(21) }]))
			.toEqual({ came: "refused", inverse: [] });
		expect(await views.transact(project, "freeform-view-9", [{ do: "add", placements: [text("p3")] }]))
			.toEqual({ came: "absent", inverse: [] });
		expect(fakeVault.contents.has(fileOf("freeform-view-9"))).toBe(false);
		// A change that finds the view already as asked is written, with nothing to take back.
		expect(await views.transact(project, id, [{ do: "place", places: [{ id: "p1", x: 0, y: 0 }] }]))
			.toEqual({ came: "written", inverse: [] });
		expect(fakeVault.contents.get(fileOf(id))).toBe(content);
		fakeVault.contents.set(fileOf(id), JSON.stringify({ schemaVersion: 99 }));
		expect(await views.transact(project, id, [{ do: "add", placements: [text("p3")] }]))
			.toEqual({ came: "refused", inverse: [] });
		expect(await views.renameView(project, id, "Newer")).toBe("refused");
		expect(await views.deleteView(project, id)).toBe("refused");
	});

	it("writes where the leaf stands only with a change that landed, or as the view is left", async () => {
		const id = (await views.createView(project, { name: "Draft" }))!;
		await views.transact(project, id, [{ do: "add", placements: [text("p1")] }]);
		const before = writes(id);
		// Nothing moved, so the viewport is not written for itself.
		await views.transact(project, id, [{ do: "place", places: [{ id: "p1", x: 0, y: 0 }] }], { x: 5, y: 6, zoom: 2 });
		expect(writes(id)).toBe(before + 1);
		expect((await views.read(project)).views[0]?.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
		await views.transact(project, id, [{ do: "place", places: [{ id: "p1", x: 9, y: 9 }] }], { x: 5, y: 6, zoom: 2 });
		expect((await views.read(project)).views[0]?.viewport).toEqual({ x: 5, y: 6, zoom: 2 });
		clock = 900;
		expect(await views.leaveView(project, id, { viewport: { x: -1, y: -2, zoom: 0.5 } })).toBe("written");
		const left = (await views.read(project)).views[0]!;
		expect(left.viewport).toEqual({ x: -1, y: -2, zoom: 0.5 });
		// Looking about is no change to the view.
		expect(left.updatedAt).toBe(100);
		expect(await views.leaveView(project, "freeform-view-9", { viewport: { x: 0, y: 0, zoom: 1 } })).toBe("absent");
	});

	it("writes no file for a leave of the fresh view, and takes it away by the folder's own file", async () => {
		expect(await views.leaveView(project, MAIN_FREEFORM_VIEW_ID, { viewport: { x: 3, y: 4, zoom: 2 } })).toBe("absent");
		expect(fakeVault.contents.has(fileOf(MAIN_FREEFORM_VIEW_ID))).toBe(false);
		expect(await views.deleteView(project, MAIN_FREEFORM_VIEW_ID)).toBe("deleted");
		expect(fakeVault.contents.has(fileOf(MAIN_FREEFORM_VIEW_ID))).toBe(false);
		expect(fakeVault.contents.has(FOLDER_FILE)).toBe(true);
		expect((await views.read(project)).views).toEqual([]);
	});

	it("carries a file along with a renamed note and a renamed folder, once", async () => {
		const id = (await views.createView(project, { name: "Draft" }))!;
		const other = (await views.createView(project, { name: "Other" }))!;
		await views.transact(project, id, [{
			do: "add",
			placements: [
				{ id: "p1", resource: { type: "file", path: "80_Material/Maps/harbour.png" }, x: 0, y: 0 },
				{ id: "p2", resource: { type: "file", path: "80_Material/notes.md" }, x: 0, y: 0 },
			],
		}]);
		await views.transact(project, other, [{
			do: "add",
			placements: [{ id: "p1", resource: { type: "file", path: "80_Material/Maps/harbour.png" }, x: 0, y: 0 }],
		}]);
		const root = project.rootPath;
		expect(await views.renameFilePaths(project, `${root}/80_Material/Maps`, `${root}/80_Material/Charts`)).toBe(true);
		expect(await views.renameFilePaths(project, `${root}/80_Material/Maps`, `${root}/80_Material/Charts`)).toBe(false);
		expect(await views.renameFilePaths(project, `${root}/80_Material/notes.md`, `${root}/80_Material/ideas.md`)).toBe(true);
		const held = await views.read(project);
		expect(held.views[0]?.placements.map((placement) => placement.resource)).toEqual([
			{ type: "file", path: "80_Material/Charts/harbour.png" },
			{ type: "file", path: "80_Material/ideas.md" },
		]);
		expect(held.views[1]?.placements[0]?.resource).toEqual({ type: "file", path: "80_Material/Charts/harbour.png" });
		// The author moved nothing on the view.
		expect(held.views[0]?.updatedAt).toBe(100);
	});

	it("moves nothing for a rename of the project itself, and leaves a file carried out of it where it was kept", async () => {
		const id = (await views.createView(project, { name: "Draft" }))!;
		await views.transact(project, id, [{
			do: "add",
			placements: [{ id: "p1", resource: { type: "file", path: "80_Material/notes.md" }, x: 0, y: 0 }],
		}]);
		const root = project.rootPath;
		expect(await views.renameFilePaths(project, root, "Snowflake Projects/Renamed")).toBe(false);
		expect(await views.renameFilePaths(project, "Snowflake Projects", "Books")).toBe(false);
		expect(await views.renameFilePaths(project, `${root}/80_Material/notes.md`, "Elsewhere/notes.md")).toBe(false);
		expect((await views.read(project)).views[0]?.placements[0]?.resource).toEqual({
			type: "file", path: "80_Material/notes.md",
		});
	});
});
