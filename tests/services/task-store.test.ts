import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task, TaskEdit } from "../../src/domain";
import {
	RevisionStore,
	SnowflakeProjectService,
	TASK_STORE_SCHEMA_VERSION,
	TaskService,
	TaskStore,
	isTaskFilePath,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const FILE =
	"Snowflake Projects/Novel/70_Tool/72_Task_Management/721_Task/tasks.json";
const REVISIONS =
	"Snowflake Projects/Novel/70_Tool/72_Task_Management/723_Revision/revisions.json";

const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
	id,
	title: `Task ${id}`,
	description: "",
	status: "todo",
	priority: "medium",
	dueDate: null,
	related: [{ kind: "character", id: "character-alice", name: "Alice" }],
	archived: false,
	createdAt: 7,
	updatedAt: 7,
	...overrides,
});

const editOf = (task: Task, overrides: Partial<TaskEdit> = {}): TaskEdit => ({
	title: task.title,
	description: task.description,
	status: task.status,
	priority: task.priority,
	dueDate: task.dueDate,
	related: task.related,
	...overrides,
});

const fileOf = (fakeVault: FakeVault): { tasks: unknown[] } =>
	JSON.parse(fakeVault.contents.get(FILE) ?? "{}") as { tasks: unknown[] };

const ids = (tasks: readonly Task[]): string[] => tasks.map((task) => task.id);

describe("isTaskFilePath", () => {
	it("knows the task file of either language, and nothing that merely shares its name", () => {
		expect(isTaskFilePath(FILE)).toBe(true);
		expect(
			isTaskFilePath("Snowflake Projects/Novel/70_工具/72_任务管理/721_任务/tasks.json"),
		).toBe(true);
		expect(isTaskFilePath("Snowflake Projects/Novel/721_Task/tasks.json")).toBe(false);
		expect(
			isTaskFilePath(
				"Snowflake Projects/Novel/70_Tool/72_Task_Management/721_Task/notes.json",
			),
		).toBe(false);
		expect(isTaskFilePath("tasks.json")).toBe(false);
	});
});

describe("TaskStore", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let store: TaskStore;
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
		store = new TaskStore({
			repository: service.repository,
			now: () => 1234,
			onCorrupt: (path) => asides.push(path),
			onForeign: (path, version) => foreign.push([path, version]),
		});
	});

	it("reads nothing where no file stands, and creates one on the first write", async () => {
		expect(await store.readTasks(project)).toEqual([]);
		const task = makeTask("t-1");
		expect(await store.updateTasks(project, (standing) => [...standing, task])).toBe(
			true,
		);
		expect(fakeVault.contents.get(FILE)).toContain('"schemaVersion": 1');
		expect(fakeVault.contents.get(FILE)).toContain('"tasks": [');
		expect(await store.readTasks(project)).toEqual([task]);
	});

	it("stores under the task-management chain of the project's locale", () => {
		expect(store.tasksPath(project)).toBe(FILE);
		expect(store.tasksPath({ ...project, locale: "zh-CN" })).toBe(
			"Snowflake Projects/Novel/70_工具/72_任务管理/721_任务/tasks.json",
		);
	});

	it("a mutate answering null leaves the file unwritten", async () => {
		expect(await store.updateTasks(project, () => null)).toBe(false);
		expect(fakeVault.contents.has(FILE)).toBe(false);
	});

	it("re-reads when the file moved under it, and serves the memo while it holds", async () => {
		await store.updateTasks(project, () => [makeTask("t-1")]);
		expect(await store.readTasks(project)).toHaveLength(1);
		fakeVault.contents.set(
			FILE,
			JSON.stringify({ schemaVersion: TASK_STORE_SCHEMA_VERSION, tasks: [] }),
		);
		expect(await store.readTasks(project)).toEqual([]);
	});

	it("drops malformed entries alone, keeping the readable ones", async () => {
		const task = makeTask("t-1");
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: TASK_STORE_SCHEMA_VERSION,
				tasks: [task, { id: "broken" }, 7],
			}),
		);
		expect(await store.readTasks(project)).toEqual([task]);
	});

	it("reads a task as far as it goes where a limb will not read", async () => {
		const task = makeTask("t-1");
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: TASK_STORE_SCHEMA_VERSION,
				tasks: [{ ...task, priority: "critical", dueDate: "soon" }],
			}),
		);
		expect(await store.readTasks(project)).toEqual([
			{ ...task, priority: "medium", dueDate: null },
		]);
	});

	it("sets a file that will not parse aside whole and starts fresh", async () => {
		await fakeVault.seedFile(FILE, "{ not json");
		expect(await store.readTasks(project)).toEqual([]);
		const aside = [...fakeVault.contents.keys()].find((path) =>
			path.includes("721_Task/tasks.corrupted-1234"),
		);
		expect(aside).toBeDefined();
		expect(fakeVault.contents.get(aside as string)).toBe("{ not json");
		expect(asides).toEqual([aside]);
	});

	it("leaves a schema it does not know exactly where it stands, and refuses to write over it", async () => {
		const written = JSON.stringify({ schemaVersion: 99, tasks: [makeTask("t-1")] });
		await fakeVault.seedFile(FILE, written);
		expect(await store.readTasks(project)).toEqual([]);
		expect(foreign).toEqual([[FILE, 99]]);
		expect(asides).toEqual([]);
		expect(
			await store.updateTasks(project, (standing) => [...standing, makeTask("t-2")]),
		).toBe(false);
		expect(fakeVault.contents.get(FILE)).toBe(written);
		expect(
			[...fakeVault.contents.keys()].some((path) => path.includes(".corrupted-")),
		).toBe(false);
	});

	it("reads the schema line before the shape, so a newer layout is foreign", async () => {
		const written = JSON.stringify({ schemaVersion: 99, entries: [] });
		await fakeVault.seedFile(FILE, written);
		expect(await store.readTasks(project)).toEqual([]);
		expect(foreign).toEqual([[FILE, 99]]);
		expect(asides).toEqual([]);
		expect(fakeVault.contents.get(FILE)).toBe(written);
	});

	it("a schema from before the first is damage, not the future", async () => {
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({ schemaVersion: 0, tasks: [makeTask("t-1")] }),
		);
		expect(await store.readTasks(project)).toEqual([]);
		expect(foreign).toEqual([]);
		expect(asides).toHaveLength(1);
	});

	it("carries an entry standing in a column it does not know through every write, untouched", async () => {
		const bent = { ...makeTask("t-bent"), status: "someday" };
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: TASK_STORE_SCHEMA_VERSION,
				tasks: [makeTask("t-1"), bent],
			}),
		);
		expect(ids(await store.readTasks(project))).toEqual(["t-1"]);
		expect(
			await store.updateTasks(project, (standing) => [...standing, makeTask("t-2")]),
		).toBe(true);
		const written = fileOf(fakeVault);
		expect(written.tasks).toHaveLength(3);
		expect(written.tasks[2]).toEqual(bent);
		expect(ids(await store.readTasks(project))).toEqual(["t-1", "t-2"]);
	});

	it("a refused write and a write that changed nothing both keep the memo", async () => {
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({ schemaVersion: 99, tasks: [makeTask("t-1")] }),
		);
		await store.readTasks(project);
		expect(foreign).toHaveLength(1);
		expect(await store.updateTasks(project, () => [makeTask("t-2")])).toBe(false);
		expect(foreign).toHaveLength(2);
		await store.readTasks(project);
		expect(foreign).toHaveLength(2);

		fakeVault.contents.set(
			FILE,
			JSON.stringify({
				schemaVersion: TASK_STORE_SCHEMA_VERSION,
				tasks: [makeTask("t-1")],
			}),
		);
		await store.readTasks(project);
		const reads = fakeVault.readCalls.filter((path) => path === FILE).length;
		expect(await store.updateTasks(project, () => null)).toBe(false);
		await store.readTasks(project);
		expect(fakeVault.readCalls.filter((path) => path === FILE)).toHaveLength(
			reads + 1,
		);
	});

	it("still sets aside a file that is damaged rather than merely newer", async () => {
		await fakeVault.seedFile(FILE, '{"schemaVersion": 1, "tasks": 7}');
		expect(await store.readTasks(project)).toEqual([]);
		expect(asides).toHaveLength(1);
		expect(foreign).toEqual([]);
	});

	it("evicts a memo for a root let go", async () => {
		const task = makeTask("t-1");
		await store.updateTasks(project, () => [task]);
		await store.readTasks(project);
		store.evict(project.rootPath);
		expect(await store.readTasks(project)).toEqual([task]);
	});

	it("shares no memo with the revision store", async () => {
		const revisions = new RevisionStore({ repository: service.repository, now: () => 1 });
		await store.updateTasks(project, () => [makeTask("t-1")]);
		expect(await store.readTasks(project)).toHaveLength(1);
		expect(await revisions.readRevisions(project)).toEqual([]);
		expect(fakeVault.contents.has(REVISIONS)).toBe(false);
		fakeVault.contents.set(
			FILE,
			JSON.stringify({
				schemaVersion: TASK_STORE_SCHEMA_VERSION,
				tasks: [makeTask("t-1"), makeTask("t-2")],
			}),
		);
		expect(await store.readTasks(project)).toHaveLength(2);
		expect(await revisions.readRevisions(project)).toEqual([]);
	});
});

describe("TaskService", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let tasks: TaskService;
	let clock: number;

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
		tasks = new TaskService(service.repository, { now: () => clock });
	});

	it("creates once per id, appending, and lists what stands in order", async () => {
		expect(await tasks.create(project, makeTask("t-1"))).toBe(true);
		expect(await tasks.create(project, makeTask("t-1"))).toBe(false);
		expect(await tasks.create(project, makeTask("t-2"))).toBe(true);
		expect(ids(await tasks.list(project))).toEqual(["t-1", "t-2"]);
	});

	it("edits a task in one write and stamps the clock", async () => {
		await tasks.create(project, makeTask("t-1"));
		const writes = vi.spyOn(service.repository, "updatePlainFile");
		clock = 200;
		expect(
			await tasks.edit(project, "t-1", {
				title: "Rework the ferry",
				description: "The tide is wrong.",
				status: "todo",
				priority: "urgent",
				dueDate: "2026-09-10",
				related: [{ kind: "scene", id: "scene-9", name: "The ferry" }],
			}),
		).toBe("written");
		expect(writes).toHaveBeenCalledTimes(1);
		const [task] = await tasks.list(project);
		expect(task).toEqual({
			...makeTask("t-1"),
			title: "Rework the ferry",
			description: "The tide is wrong.",
			priority: "urgent",
			dueDate: "2026-09-10",
			related: [{ kind: "scene", id: "scene-9", name: "The ferry" }],
			updatedAt: 200,
		});
	});

	it("an edit saying what already stands writes nothing and still answers written", async () => {
		const task = makeTask("t-1");
		await tasks.create(project, task);
		const written = fakeVault.contents.get(FILE);
		clock = 200;
		expect(await tasks.edit(project, "t-1", editOf(task))).toBe("written");
		expect(fakeVault.contents.get(FILE)).toBe(written);
		expect((await tasks.list(project))[0]?.updatedAt).toBe(7);
	});

	it("an edit that changes the column lands the task at that column's end", async () => {
		await tasks.create(project, makeTask("a"));
		await tasks.create(project, makeTask("b", { status: "done" }));
		await tasks.create(project, makeTask("c"));
		clock = 300;
		expect(
			await tasks.edit(project, "a", editOf(makeTask("a"), { status: "done" })),
		).toBe("written");
		const standing = await tasks.list(project);
		expect(ids(standing)).toEqual(["b", "a", "c"]);
		expect(standing[1]).toMatchObject({ status: "done", updatedAt: 300 });
	});

	it("moves a task before a neighbour, keeping the clock within a column", async () => {
		await tasks.create(project, makeTask("a"));
		await tasks.create(project, makeTask("b"));
		await tasks.create(project, makeTask("c"));
		clock = 300;
		const writes = vi.spyOn(service.repository, "updatePlainFile");
		expect(await tasks.move(project, "c", "todo", "a")).toBe("written");
		expect(writes).toHaveBeenCalledTimes(1);
		const standing = await tasks.list(project);
		expect(ids(standing)).toEqual(["c", "a", "b"]);
		expect(standing[0]?.updatedAt).toBe(7);
	});

	it("moves a task across columns and stamps the clock", async () => {
		await tasks.create(project, makeTask("a"));
		await tasks.create(project, makeTask("b", { status: "blocked" }));
		clock = 300;
		expect(await tasks.move(project, "a", "blocked", null)).toBe("written");
		const standing = await tasks.list(project);
		expect(ids(standing)).toEqual(["b", "a"]);
		expect(standing[1]).toMatchObject({ status: "blocked", updatedAt: 300 });
	});

	it("a move that changes nothing writes nothing", async () => {
		await tasks.create(project, makeTask("a"));
		await tasks.create(project, makeTask("b"));
		const written = fakeVault.contents.get(FILE);
		expect(await tasks.move(project, "b", "todo", null)).toBe("written");
		expect(fakeVault.contents.get(FILE)).toBe(written);
	});

	it("carries a task of a column it does not know through a move, as it came", async () => {
		const bent = { ...makeTask("t-bent"), status: "someday" };
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: TASK_STORE_SCHEMA_VERSION,
				tasks: [makeTask("a"), makeTask("b"), bent],
			}),
		);
		expect(await tasks.move(project, "b", "todo", "a")).toBe("written");
		const written = fileOf(fakeVault);
		expect((written.tasks as { id: string }[]).map((task) => task.id)).toEqual([
			"b",
			"a",
			"t-bent",
		]);
		expect(written.tasks[2]).toEqual(bent);
	});

	it("sets a task aside and brings it back, stamping the clock each way", async () => {
		await tasks.create(project, makeTask("a"));
		clock = 300;
		expect(await tasks.setArchived(project, "a", true)).toBe("written");
		expect((await tasks.list(project))[0]).toMatchObject({ archived: true, updatedAt: 300 });
		const written = fakeVault.contents.get(FILE);
		expect(await tasks.setArchived(project, "a", true)).toBe("written");
		expect(fakeVault.contents.get(FILE)).toBe(written);
		clock = 400;
		expect(await tasks.setArchived(project, "a", false)).toBe("written");
		expect((await tasks.list(project))[0]).toMatchObject({ archived: false, updatedAt: 400 });
	});

	it("removes one task or several in one write", async () => {
		await tasks.create(project, makeTask("a"));
		await tasks.create(project, makeTask("b"));
		await tasks.create(project, makeTask("c"));
		expect(await tasks.remove(project, ["a"])).toBe("deleted");
		expect(ids(await tasks.list(project))).toEqual(["b", "c"]);
		const writes = vi.spyOn(service.repository, "updatePlainFile");
		expect(await tasks.remove(project, ["b", "c", "never"])).toBe("deleted");
		expect(writes).toHaveBeenCalledTimes(1);
		expect(await tasks.list(project)).toEqual([]);
		expect(await tasks.remove(project, ["a"])).toBe("absent");
	});

	it("emptying the archive spares a task brought back while the question stood", async () => {
		await tasks.create(project, makeTask("keep-me", { archived: true }));
		await tasks.create(project, makeTask("gone", { archived: true }));
		await tasks.create(project, makeTask("late", { archived: false }));
		await tasks.create(project, makeTask("active"));
		// What the board gathered before the confirmation opened.
		const standing = (await tasks.list(project))
			.filter((task) => task.archived)
			.map((task) => task.id);
		expect(standing).toEqual(["keep-me", "gone"]);
		// While it stood: one restored elsewhere, one archived elsewhere.
		expect(await tasks.setArchived(project, "keep-me", false)).toBe("written");
		expect(await tasks.setArchived(project, "late", true)).toBe("written");
		expect(await tasks.remove(project, standing, { archivedOnly: true })).toBe("deleted");
		expect(
			(await tasks.list(project)).map((task) => [task.id, task.archived]),
		).toEqual([
			["keep-me", false],
			["late", true],
			["active", false],
		]);
		// Nothing archived left among the named: no write, and absent says so.
		expect(await tasks.remove(project, ["keep-me", "active"], { archivedOnly: true })).toBe(
			"absent",
		);
		expect(ids(await tasks.list(project))).toEqual(["keep-me", "late", "active"]);
		// A plain delete still takes an active task, as the card's own Delete does.
		expect(await tasks.remove(project, ["active"])).toBe("deleted");
		expect(ids(await tasks.list(project))).toEqual(["keep-me", "late"]);
	});

	it("tells a task that is gone from a write the store refused", async () => {
		await tasks.create(project, makeTask("a"));
		const edit = editOf(makeTask("a"), { title: "x" });
		expect(await tasks.edit(project, "nobody", edit)).toBe("absent");
		expect(await tasks.move(project, "nobody", "done", null)).toBe("absent");
		expect(await tasks.setArchived(project, "nobody", true)).toBe("absent");
		fakeVault.contents.set(
			FILE,
			JSON.stringify({ schemaVersion: 99, tasks: [makeTask("a")] }),
		);
		expect(await tasks.edit(project, "a", edit)).toBe("refused");
		expect(await tasks.move(project, "a", "done", null)).toBe("refused");
		expect(await tasks.setArchived(project, "a", true)).toBe("refused");
		expect(await tasks.remove(project, ["a"])).toBe("refused");
	});
});
