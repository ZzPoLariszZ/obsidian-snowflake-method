import { beforeEach, describe, expect, it } from "vitest";

import {
	parseHistoryEventMonthFile,
	type Foreshadowing,
	type HistoryEventRecord,
	type Revision,
	type Task,
	type TaskEdit,
} from "../../src/domain";
import { isPathAtOrBelow } from "../../src/project-root";
import { parseMarkdownFrontmatter, type ManagedFrontmatter } from "../../src/repository";
import {
	HistoryLedger,
	LEDGER_FLUSH_MAX_MS,
	LEDGER_FLUSH_QUIET_MS,
	SnowflakeProjectService,
	type LedgerEvent,
	type PendingHistoryFile,
	type ProjectRef,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const HISTORY_DIR = "70_Tool/71_Data_Statistics/714_Modification_History";
const EVENT_FILE = "2026/2026_10_device-a_history_events.json";

const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
	id,
	title: `Task ${id}`,
	description: "",
	status: "todo",
	priority: "medium",
	dueDate: null,
	related: [],
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

const makeThread = (id: string): Foreshadowing => ({
	id,
	name: `Thread ${id}`,
	description: "",
	status: "planned",
	related: [],
	createdAt: 7,
	updatedAt: 7,
	occurrences: [],
});

const makeRevision = (id: string, path: string): Revision => ({
	id,
	path,
	kind: "replace",
	from: 0,
	to: 4,
	originalText: "grey",
	before: "",
	after: "",
	proposed: "white",
	comment: "",
	createdAt: 7,
});

const folderOf = (path: string): string => path.slice(0, path.lastIndexOf("/"));

describe("HistoryLedger", () => {
	let fakeVault: FakeVault;
	let projects: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let projectRefs: ProjectRef[];
	let ledger: HistoryLedger;
	let clock: number;
	let pendingStore: { value: PendingHistoryFile | null; saves: number };
	let minted: number;
	let events: LedgerEvent[];
	let createdCalls: number;
	let timers: {
		handlers: Map<number, { ms: number; handler: () => void }>;
		delays: number[];
		next: number;
		flush: () => Promise<void>;
		fire: (ms: number) => Promise<void>;
	};

	const settle = async (): Promise<void> => {
		for (let i = 0; i < 6; i += 1) {
			await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
		}
	};

	const frontmatterNow = (path: string): ManagedFrontmatter | null => {
		const content = fakeVault.contents.get(path);
		if (content === undefined) return null;
		try {
			const parsed = parseMarkdownFrontmatter(content);
			return parsed.hasFrontmatter ? parsed.frontmatter : null;
		} catch {
			return null;
		}
	};

	const buildLedger = (): HistoryLedger => {
		const built = new HistoryLedger({
			repository: projects.repository,
			writingCount: projects.writingCount,
			projects: () => projectRefs,
			projectAtPath: (path) =>
				projectRefs.find((ref) => isPathAtOrBelow(path, ref.rootPath)) ?? null,
			frontmatterNow,
			countOptions: () => ({ mode: "ms-word", headings: "count" }),
			pending: {
				load: () => pendingStore.value,
				save: (pending) => {
					pendingStore.value =
						pending === null ? null : (JSON.parse(JSON.stringify(pending)) as PendingHistoryFile);
					pendingStore.saves += 1;
				},
			},
			mint: () => {
				minted += 1;
				return `history-event-${String(minted)}`;
			},
			deviceId: () => "device-a",
			timezone: () => "UTC",
			timers: {
				set: (handler, ms) => {
					timers.delays.push(ms);
					timers.next += 1;
					timers.handlers.set(timers.next, { ms, handler });
					return timers.next;
				},
				clear: (handle) => {
					timers.handlers.delete(handle as number);
				},
			},
			now: () => clock,
		});
		built.subscribe((event) => events.push(event));
		return built;
	};

	/** The services and the repository tell the ledger, as the plugin wires them. */
	const wire = (): void => {
		projects.repository.onManagedFileCreated = (path, content, userInput) => {
			createdCalls += 1;
			ledger.noteCreated(path, content, userInput);
		};
		projects.tasks.onEvent = (ref, event) => {
			ledger.taskEvent(ref, event);
		};
		projects.foreshadowing.onEvent = (ref, event) => {
			ledger.threadEvent(ref, event);
		};
		projects.revisions.onEvent = (ref, event) => {
			ledger.revisionEvent(ref, event);
		};
	};

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		projects = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await projects.createProject({ title: "Novel", locale: "en" });
		projectRefs = [project];
		clock = T0;
		pendingStore = { value: null, saves: 0 };
		minted = 0;
		events = [];
		createdCalls = 0;
		const handlers = new Map<number, { ms: number; handler: () => void }>();
		timers = {
			handlers,
			delays: [],
			next: 0,
			flush: async () => {
				const pending = [...handlers.values()];
				handlers.clear();
				for (const { handler } of pending) handler();
				await settle();
			},
			fire: async (ms) => {
				for (const [id, entry] of [...handlers]) {
					if (entry.ms !== ms) continue;
					handlers.delete(id);
					entry.handler();
				}
				await settle();
			},
		};
		ledger = buildLedger();
		wire();
	});

	const eventFilePath = (): string => `${project.rootPath}/${HISTORY_DIR}/${EVENT_FILE}`;

	/** The month file's events, or null while there is no file. */
	const filed = (): HistoryEventRecord[] | null => {
		const content = fakeVault.contents.get(eventFilePath());
		if (content === undefined) return null;
		const file = parseHistoryEventMonthFile(JSON.parse(content));
		if (file === null) throw new Error("The month file does not parse");
		return file.events;
	};

	const rel = (path: string): string => path.slice(project.rootPath.length + 1);

	/** The event filed last, or undefined while there is none. */
	const last = (): HistoryEventRecord | undefined => {
		const all = filed();
		return all === null ? undefined : all[all.length - 1];
	};

	it("writes down a character the author made, once the quiet moment passes", async () => {
		const character = await projects.createCharacter(project, { name: "Ada" });

		expect(createdCalls).toBe(1);
		expect(filed()).toBeNull();
		expect(timers.delays).toEqual([LEDGER_FLUSH_QUIET_MS, LEDGER_FLUSH_MAX_MS]);
		expect(pendingStore.value?.events).toHaveLength(1);

		await timers.flush();
		const [event] = filed() ?? [];
		expect(event).toMatchObject({
			id: "history-event-1",
			ts: T0,
			event: "created",
			origin: "user",
			subject: {
				type: "note",
				path: rel(character.path),
				kind: "character",
				documentType: "character",
			},
		});
		expect(event?.words).toBeGreaterThanOrEqual(0);
		expect(pendingStore.value).toBeNull();
		expect(events).toEqual([{ kind: "recorded", events: 1 }]);
	});

	it("tells a note the plugin made from one the author did", async () => {
		await projects.createCharacterIn(project, { name: "Bot" }, { userInput: false });
		await ledger.flushNow();
		expect(filed()?.map((event) => event.origin)).toEqual(["plugin"]);
	});

	it("passes over what the history has nothing to say about", async () => {
		ledger.noteCreated(
			`${project.rootPath}/70_Tool/Note.md`,
			"---\nsnowflake-document: sticky-note\n---\n\nhello\n",
			true,
		);
		ledger.noteCreated("Elsewhere/Note.md", "hello\n", true);
		ledger.noteCreated(`${project.rootPath}/picture.png`, "", true);
		projectRefs = [{ ...project, readOnly: true }];
		ledger.noteCreated(
			`${project.rootPath}/40_Scene/Read only.md`,
			"---\nsnowflake-document: scene\n---\n\nhello\n",
			true,
		);
		ledger.taskEvent(projectRefs[0] as ProjectRef, { kind: "created", tasks: [makeTask("task-1")] });

		expect(pendingStore.value).toBeNull();
		expect(timers.delays).toEqual([]);
	});

	it("stamps what an import did with where it came from, and the notes it wrote over", async () => {
		const scene = await projects.createScene(project, { title: "Arrival" });
		await ledger.flushNow();

		ledger.beginImport();
		const character = await projects.createCharacter(project, { name: "Ada" });
		// Held until the import ends: the event waits in the store, not the queue.
		expect(filed()).toHaveLength(1);
		expect(pendingStore.value?.events).toHaveLength(1);
		expect(timers.delays).toHaveLength(2);
		ledger.endImport({
			source: { id: "book-1", title: "Book One" },
			target: { projectFile: project.projectFile },
			created: [{ targetPath: character.path }, { targetPath: null }],
			replaced: [
				{ targetPath: scene.path },
				{ targetPath: `${project.rootPath}/${HISTORY_DIR}/kept.json` },
			],
		});
		await ledger.flushNow();

		expect(
			filed()?.map((event) => [event.event, event.origin, event.subject, event.importedFrom]),
		).toEqual([
			["created", "user", { type: "note", path: rel(scene.path), kind: "scene", documentType: "scene" }, undefined],
			[
				"created",
				"import",
				{ type: "note", path: rel(character.path), kind: "character", documentType: "character" },
				{ projectId: "book-1", title: "Book One" },
			],
			[
				"imported",
				"import",
				{ type: "note", path: rel(scene.path), kind: "scene", documentType: "scene" },
				{ projectId: "book-1", title: "Book One" },
			],
		]);
	});

	it("files what an import did when the run failed partway", async () => {
		ledger.beginImport();
		await projects.createCharacter(project, { name: "Ada" });
		ledger.endImport(null);
		await ledger.flushNow();
		expect(filed()?.map((event) => [event.origin, event.importedFrom])).toEqual([
			["import", undefined],
		]);
	});

	it("tells a rename within the project from a move out of it, and lets a moved project be", async () => {
		const scene = await projects.createScene(project, { title: "Arrival" });
		await ledger.flushNow();

		const renamed = `${folderOf(scene.path)}/Landing.md`;
		fakeVault.rename(scene.path, renamed);
		ledger.noteRenamed(scene.path, renamed);
		await ledger.flushNow();
		expect(last()).toMatchObject({
			event: "renamed",
			origin: "user",
			from: rel(scene.path),
			subject: { type: "note", path: rel(renamed), kind: "scene", documentType: "scene" },
		});

		fakeVault.rename(renamed, "Landing.md");
		ledger.noteRenamed(renamed, "Landing.md");
		await ledger.flushNow();
		expect(last()).toMatchObject({
			event: "deleted",
			subject: { type: "note", path: rel(renamed), kind: "scene", documentType: "scene" },
		});

		// A note arriving from outside is the harvester's to meet.
		await fakeVault.seedFile("Stray.md", "stray\n");
		const arrived = `${folderOf(scene.path)}/Stray.md`;
		fakeVault.rename("Stray.md", arrived);
		ledger.noteRenamed("Stray.md", arrived);
		expect(pendingStore.value).toBeNull();

		// The project itself moving changes nothing of the book; what waits follows it.
		await projects.createScene(project, { title: "Second" });
		ledger.noteRenamed(project.rootPath, "Moved");
		expect(pendingStore.value?.events.map((entry) => entry.path)).toEqual([
			`Moved/${HISTORY_DIR}/${EVENT_FILE}`,
		]);
		expect(filed()).toHaveLength(3);
	});

	it("writes a folder's move down once for each note, however it is told", async () => {
		const first = await projects.createScene(project, { title: "A" });
		const second = await projects.createScene(project, { title: "B" });
		await ledger.flushNow();

		const folder = folderOf(first.path);
		const moved = `${project.rootPath}/Scenes moved`;
		fakeVault.rename(folder, moved);
		const movedFirst = `${moved}/${first.path.slice(folder.length + 1)}`;
		const movedSecond = `${moved}/${second.path.slice(folder.length + 1)}`;
		// The folder's own event, then one for each note, as Obsidian tells them.
		ledger.noteRenamed(folder, moved);
		ledger.noteRenamed(first.path, movedFirst);
		ledger.noteRenamed(second.path, movedSecond);
		await ledger.flushNow();

		expect(filed()?.slice(2).map((event) => [event.event, event.from, event.subject])).toEqual([
			["renamed", rel(first.path), { type: "note", path: rel(movedFirst), kind: "scene", documentType: "scene" }],
			["renamed", rel(second.path), { type: "note", path: rel(movedSecond), kind: "scene", documentType: "scene" }],
		]);
	});

	it("writes an inferred rename down as nobody's doing", async () => {
		const scene = await projects.createScene(project, { title: "Arrival" });
		await ledger.flushNow();
		ledger.beginImport();
		ledger.noteRenameInferred(project, "40_Scene/Before.md", rel(scene.path), T0 + 5);
		ledger.endImport(null);
		await ledger.flushNow();
		expect(last()).toMatchObject({
			ts: T0 + 5,
			event: "renamed",
			origin: "inferred",
			from: "40_Scene/Before.md",
			subject: { type: "note", path: rel(scene.path), kind: "scene" },
		});
	});

	it("writes a deleted note down, and lets a deleted project go", async () => {
		const scene = await projects.createScene(project, { title: "Arrival" });
		const other = await projects.createScene(project, { title: "Other" });
		await ledger.flushNow();

		fakeVault.delete(scene.path);
		ledger.noteDeleted(scene.path);
		await ledger.flushNow();
		// The frontmatter went with the note; the folder still says what it was.
		expect(last()).toMatchObject({
			event: "deleted",
			subject: { type: "note", path: rel(scene.path), kind: "scene" },
		});
		expect(last()?.subject).not.toHaveProperty("documentType");

		const folder = folderOf(other.path);
		fakeVault.delete(folder);
		ledger.noteDeleted(folder, { children: [other.path, `${folder}/cover.png`] });
		await ledger.flushNow();
		expect(last()).toMatchObject({
			event: "deleted",
			subject: { type: "note", path: rel(other.path), kind: "scene" },
		});
		expect(filed()).toHaveLength(4);
		// Told once more for the note itself, as a folder's deletion may be, it stands once.
		ledger.noteDeleted(other.path);
		expect(pendingStore.value).toBeNull();
		await ledger.flushNow();
		expect(filed()).toHaveLength(4);

		await projects.createCharacter(project, { name: "Ada" });
		expect(pendingStore.value?.events).toHaveLength(1);
		ledger.noteDeleted(project.rootPath, { children: [] });
		expect(pendingStore.value).toBeNull();
		await ledger.flushNow();
		expect(filed()).toHaveLength(4);
	});

	it("follows a task through its columns, its archive and its end", async () => {
		const task = makeTask("task-1");
		await projects.tasks.create(project, task);
		await projects.tasks.createMany(project, [makeTask("task-2"), makeTask("task-2")]);
		// A reorder within the column is no event; a move to another is.
		await projects.tasks.move(project, "task-1", "todo", null);
		await projects.tasks.move(project, "task-1", "done", null);
		await projects.tasks.edit(project, "task-1", editOf(task, { status: "done", title: "Renamed" }));
		await projects.tasks.edit(project, "task-1", editOf(task, { status: "blocked", title: "Renamed" }));
		await projects.tasks.setArchived(project, "task-1", true);
		await projects.tasks.setArchived(project, "task-1", true);
		await projects.tasks.setArchived(project, "task-1", false);
		await projects.tasks.remove(project, ["task-1", "task-9"]);
		await ledger.flushNow();

		expect(
			filed()?.map((event) => [event.event, event.status ?? null, event.subject]),
		).toEqual([
			["task-created", null, { type: "task", id: "task-1", title: "Task task-1" }],
			["task-created", null, { type: "task", id: "task-2", title: "Task task-2" }],
			["task-status", "done", { type: "task", id: "task-1", title: "Task task-1" }],
			["task-status", "blocked", { type: "task", id: "task-1", title: "Renamed" }],
			["task-archived", null, { type: "task", id: "task-1", title: "Renamed" }],
			["task-deleted", null, { type: "task", id: "task-1", title: "Renamed" }],
		]);
	});

	it("follows a thread through its life", async () => {
		await projects.foreshadowing.create(project, makeThread("fs-1"));
		const edit = {
			name: "Renamed",
			description: "",
			status: "planned" as const,
			related: [],
			occurrences: [],
			removed: [],
		};
		await projects.foreshadowing.edit(project, "fs-1", edit);
		await projects.foreshadowing.edit(project, "fs-1", { ...edit, status: "resolved" });
		await projects.foreshadowing.deleteItem(project, "fs-1");
		await projects.foreshadowing.deleteItem(project, "fs-1");
		await ledger.flushNow();

		expect(
			filed()?.map((event) => [event.event, event.status ?? null, event.subject]),
		).toEqual([
			["thread-created", null, { type: "thread", id: "fs-1", name: "Thread fs-1" }],
			["thread-status", "resolved", { type: "thread", id: "fs-1", name: "Renamed" }],
			["thread-deleted", null, { type: "thread", id: "fs-1", name: "Renamed" }],
		]);
	});

	it("writes a revision down when it is proposed, and how it went out", async () => {
		const scene = await projects.createScene(project, { title: "Arrival" });
		await projects.revisions.create(project, makeRevision("rev-1", scene.path));
		await projects.revisions.remove(project, "rev-1", "accepted");
		await projects.revisions.createMany(project, [makeRevision("rev-2", scene.path)]);
		await projects.revisions.remove(project, "rev-2");
		await projects.revisions.remove(project, "rev-2");
		await ledger.flushNow();

		const note = { path: rel(scene.path), kind: "scene", documentType: "scene" };
		expect(filed()?.slice(1).map((event) => [event.event, event.subject])).toEqual([
			["revision-proposed", { type: "revision", id: "rev-1", note }],
			["revision-accepted", { type: "revision", id: "rev-1", note }],
			["revision-proposed", { type: "revision", id: "rev-2", note }],
			["revision-discarded", { type: "revision", id: "rev-2", note }],
		]);
	});

	it("files a burst in one write, and never waits past the ceiling", async () => {
		await projects.tasks.create(project, makeTask("task-1"));
		await projects.tasks.create(project, makeTask("task-2"));
		// The quiet tick is armed afresh at every event; the ceiling once.
		expect(timers.delays).toEqual([LEDGER_FLUSH_QUIET_MS, LEDGER_FLUSH_MAX_MS, LEDGER_FLUSH_QUIET_MS]);
		expect([...timers.handlers.values()].map((entry) => entry.ms)).toEqual([
			LEDGER_FLUSH_MAX_MS,
			LEDGER_FLUSH_QUIET_MS,
		]);
		await timers.fire(LEDGER_FLUSH_QUIET_MS);
		expect(filed()).toHaveLength(2);
		expect(timers.handlers.size).toBe(0);
		expect(events).toEqual([{ kind: "recorded", events: 2 }]);

		await projects.tasks.create(project, makeTask("task-3"));
		await projects.tasks.create(project, makeTask("task-4"));
		await timers.fire(LEDGER_FLUSH_MAX_MS);
		expect(filed()).toHaveLength(4);
		expect(timers.handlers.size).toBe(0);
	});

	it("keeps what it could not file, and files it on the next flush", async () => {
		fakeVault.failNextCreatePath = eventFilePath();
		await projects.tasks.create(project, makeTask("task-1"));
		await ledger.flushNow();
		expect(filed()).toBeNull();
		expect(pendingStore.value?.events).toHaveLength(1);
		// Armed afresh for another try.
		expect(timers.delays.slice(-2)).toEqual([LEDGER_FLUSH_QUIET_MS, LEDGER_FLUSH_MAX_MS]);
		expect(events).toEqual([]);

		await ledger.flushNow();
		expect(filed()).toHaveLength(1);
		expect(pendingStore.value).toBeNull();
		expect(events).toEqual([{ kind: "recorded", events: 1 }]);
	});

	it("takes up what a crashed session left, and files nothing twice", async () => {
		await projects.tasks.create(project, makeTask("task-1"));
		const left = pendingStore.value;
		expect(left?.events).toHaveLength(1);
		ledger.dispose();

		ledger = buildLedger();
		ledger.start();
		expect(timers.delays.slice(-2)).toEqual([LEDGER_FLUSH_QUIET_MS, LEDGER_FLUSH_MAX_MS]);
		await timers.flush();
		expect(filed()).toHaveLength(1);
		expect(pendingStore.value).toBeNull();

		// The same event stored again, as a crash after the write leaves it, stands once.
		pendingStore.value = left;
		ledger = buildLedger();
		ledger.start();
		await timers.flush();
		expect(filed()).toHaveLength(1);

		// A store this build cannot read is left alone.
		const delays = timers.delays.length;
		pendingStore.value = {
			schemaVersion: 1,
			events: [{ path: "x", record: { nonsense: true } as unknown as HistoryEventRecord }],
		};
		ledger = buildLedger();
		ledger.start();
		expect(timers.delays).toHaveLength(delays);
	});

	it("keeps what a previous session left under an event told before start", async () => {
		await projects.tasks.create(project, makeTask("task-1"));
		ledger.dispose();

		// The plugin wires the services before it starts the ledger; a task
		// made in between saves the store, with what waited there still in it.
		ledger = buildLedger();
		await projects.tasks.create(project, makeTask("task-2"));
		expect(pendingStore.value?.events.map((entry) => entry.record.subject)).toEqual([
			{ type: "task", id: "task-1", title: "Task task-1" },
			{ type: "task", id: "task-2", title: "Task task-2" },
		]);
		ledger.start();
		await timers.flush();
		expect(filed()).toHaveLength(2);
		expect(pendingStore.value).toBeNull();
	});

	it("sets a month file that will not parse aside, and starts afresh", async () => {
		await fakeVault.seedFile(eventFilePath(), "{ not json");
		await projects.tasks.create(project, makeTask("task-1"));
		await ledger.flushNow();
		const aside = eventFilePath().replace(/\.json$/u, `.corrupted-${String(T0)}.json`);
		expect(events).toEqual([
			{ kind: "corrupt-file-preserved", path: aside },
			{ kind: "recorded", events: 1 },
		]);
		expect(fakeVault.contents.get(aside)).toBe("{ not json");
		expect(filed()).toHaveLength(1);
	});

	it("records nothing once disposed", async () => {
		ledger.dispose();
		await projects.tasks.create(project, makeTask("task-1"));
		expect(pendingStore.value).toBeNull();
		expect(timers.delays).toEqual([]);
	});
});
