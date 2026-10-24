import { beforeEach, describe, expect, it } from "vitest";

import {
	SCHEMA_VERSION,
	fingerprint,
	type HistoryEventMonthFile,
	type HistoryTallyReading,
	type NoteSnapshotMonthFile,
} from "../../src/domain";
import { isPathAtOrBelow } from "../../src/project-root";
import { parseMarkdownFrontmatter, type ManagedFrontmatter } from "../../src/repository";
import {
	HISTORY_FILES_QUIET_MS,
	LEDGER_FLUSH_QUIET_MS,
	ModificationHistoryService,
	SnowflakeProjectService,
	type ModificationHistoryEvent,
	type ProjectRef,
	type ProjectSnapshot,
	type WritingSessionEvent,
} from "../../src/services";
import { FakeSnapshotStore } from "../helpers/fake-snapshot-store";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const HOUR = 3_600_000;
const HISTORY_DIR = "70_Tool/71_Data_Statistics/714_Modification_History";
const SCENE = "40_Scene/Twelve.md";

describe("ModificationHistoryService", () => {
	let fakeVault: FakeVault;
	let projects: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let projectRefs: ProjectRef[];
	let store: FakeSnapshotStore;
	let service: ModificationHistoryService;
	let clock: number;
	let readerOn: boolean;
	let tallies: HistoryTallyReading[];
	let tallyReads: number;
	let sessionListeners: Set<(event: WritingSessionEvent) => void>;
	let events: ModificationHistoryEvent[];
	let timers: {
		handlers: Map<number, { ms: number; handler: () => void }>;
		delays: number[];
		next: number;
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

	const build = (): ModificationHistoryService => {
		let minted = 0;
		const built = new ModificationHistoryService({
			repository: projects.repository,
			writingCount: projects.writingCount,
			tallies: {
				fileTalliesBetween: async () => {
					tallyReads += 1;
					return tallies;
				},
				subscribe: (listener) => {
					sessionListeners.add(listener);
					return () => sessionListeners.delete(listener);
				},
			},
			reader: () => (readerOn ? store : null),
			projects: () => projectRefs,
			projectAtPath: (path) =>
				projectRefs.find((ref) => isPathAtOrBelow(path, ref.rootPath)) ?? null,
			frontmatterNow,
			countOptions: () => ({ mode: "ms-word", headings: "count" }),
			cursor: { load: () => null, save: () => undefined },
			pending: { load: () => null, save: () => undefined },
			mint: () => {
				minted += 1;
				return `history-event-${String(minted)}`;
			},
			deviceId: () => "device-a",
			timezone: () => "UTC",
			timers: {
				set: (handler, ms) => {
					timers.delays.push(ms);
					if (ms === 0) {
						handler();
						return 0;
					}
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
		store = new FakeSnapshotStore();
		clock = T0;
		readerOn = true;
		tallies = [];
		tallyReads = 0;
		sessionListeners = new Set();
		events = [];
		const handlers = new Map<number, { ms: number; handler: () => void }>();
		timers = {
			handlers,
			delays: [],
			next: 0,
			fire: async (ms) => {
				for (const [id, entry] of [...handlers]) {
					if (entry.ms !== ms) continue;
					handlers.delete(id);
					entry.handler();
				}
				await settle();
			},
		};
		service = build();
	});

	const at = (rel: string): string => `${project.rootPath}/${rel}`;
	const historyFile = (name: string): string => `${project.rootPath}/${HISTORY_DIR}/2026/${name}`;

	/** A note of the project as File recovery would hold it, frontmatter and all. */
	const note = (type: string, body: string): string =>
		[
			"---",
			`snowflake-schema: ${String(SCHEMA_VERSION)}`,
			`snowflake-document: ${type}`,
			`snowflake-project-id: ${project.id}`,
			"---",
			"",
			`${body}\n`,
		].join("\n");

	const snapshotFile = (
		snapshots: NoteSnapshotMonthFile["snapshots"],
	): string =>
		`${JSON.stringify({
			schemaVersion: 1,
			countMode: "ms-word",
			countHeadings: "count",
			snapshots,
		} satisfies NoteSnapshotMonthFile)}\n`;

	const eventFile = (file: HistoryEventMonthFile): string => `${JSON.stringify(file)}\n`;

	const kinds = (): string[] => events.map((event) => event.kind);

	it("lays two devices' versions, the ledger and the sessions into one reading", async () => {
		await fakeVault.seedFile(at(SCENE), note("scene", "one two three four five six"));
		await fakeVault.seedFile(
			historyFile("2026_10_device-a_note_snapshots.json"),
			snapshotFile([
				{ path: SCENE, kind: "scene", documentType: "scene", ts: T0, words: 3, delta: null, hash: "h1" },
				{ path: SCENE, kind: "scene", documentType: "scene", ts: T0 + HOUR, words: 5, delta: 2, prevTs: T0, hash: "h2" },
			]),
		);
		await fakeVault.seedFile(
			historyFile("2026_10_device-b_note_snapshots.json"),
			snapshotFile([
				// The same version as device-a's second, synced across: no third version.
				{ path: SCENE, kind: "scene", documentType: "scene", ts: T0 + HOUR + 1, words: 5, delta: null, hash: "h2" },
				{ path: SCENE, kind: "scene", documentType: "scene", ts: T0 + 2 * HOUR, words: 6, delta: null, hash: "h3" },
			]),
		);
		await fakeVault.seedFile(
			historyFile("2026_10_device-a_history_events.json"),
			eventFile({
				schemaVersion: 1,
				events: [
					{
						id: "history-event-created",
						ts: T0 - 1,
						event: "created",
						origin: "user",
						subject: { type: "note", path: SCENE, kind: "scene", documentType: "scene" },
						words: 0,
					},
					{
						id: "history-event-task",
						ts: T0 + 3 * HOUR,
						event: "task-created",
						origin: "user",
						subject: { type: "task", id: "task-1", title: "Fix the ending" },
					},
				],
			}),
		);
		tallies = [
			{
				id: "session-1",
				kind: "session",
				day: "2026-10-21",
				startedAt: T0,
				endedAt: T0 + HOUR,
				focusMs: HOUR,
				files: [{ path: SCENE, added: 2, deleted: 0, net: 2 }],
			},
		];

		const reading = await service.read(project, "2026-10-20", "2026-10-21");

		expect(reading.days.map((day) => day.day)).toEqual(["2026-10-20", "2026-10-21"]);
		const today = reading.days[1];
		expect(today?.words).toEqual({ added: 6, deleted: 0, net: 6 });
		expect(today?.versions).toBe(3);
		expect(today?.notes).toBe(1);
		expect(today?.sessions).toBe(1);
		expect(today?.entries.map((entry) => entry.kind)).toEqual(["note", "task"]);
		const entry = today?.entries[0];
		expect(entry?.kind === "note" ? entry.action : null).toBe("created");
		expect(entry?.kind === "note" ? entry.note : null).toEqual({
			path: SCENE,
			kind: "scene",
			documentType: "scene",
			exists: true,
		});
		expect(entry?.kind === "note" ? entry.sessions : null).toBe(1);
		expect(reading.summary.notes).toBe(1);
		expect(reading.summary.sources).toEqual(["snapshots"]);
	});

	it("keeps a reading until a file it read moves or a tally changes", async () => {
		await fakeVault.seedFile(
			historyFile("2026_10_device-a_note_snapshots.json"),
			snapshotFile([
				{ path: SCENE, kind: "scene", documentType: "scene", ts: T0, words: 3, delta: null, hash: "h1" },
			]),
		);
		const first = await service.read(project, "2026-10-21", "2026-10-21");
		expect(await service.read(project, "2026-10-21", "2026-10-21")).toBe(first);
		expect(tallyReads).toBe(2);

		// Another span is another reading, and coming back is read again:
		// one reading is kept per project.
		const other = await service.read(project, "2026-10-20", "2026-10-20");
		expect(other).not.toBe(first);

		// A file rewritten moves its stamp, so the span is merged afresh.
		await service.read(project, "2026-10-21", "2026-10-21");
		await projects.repository.updatePlainFile(
			historyFile("2026_10_device-a_note_snapshots.json"),
			() =>
				snapshotFile([
					{ path: SCENE, kind: "scene", documentType: "scene", ts: T0, words: 3, delta: null, hash: "h1" },
					{ path: SCENE, kind: "scene", documentType: "scene", ts: T0 + HOUR, words: 4, delta: 1, prevTs: T0, hash: "h2" },
				]),
		);
		const rewritten = await service.read(project, "2026-10-21", "2026-10-21");
		expect(rewritten).not.toBe(first);
		expect(rewritten.summary.versions).toBe(2);

		// So does a tally: a running session's clock moving on is new data.
		tallies = [
			{
				id: "session-1",
				kind: "session",
				day: "2026-10-21",
				startedAt: T0,
				endedAt: null,
				focusMs: 60_000,
				files: [],
			},
		];
		const withSession = await service.read(project, "2026-10-21", "2026-10-21");
		expect(withSession).not.toBe(rewritten);
		expect(withSession.summary.sessions).toBe(1);
	});

	it("tells a deletion another device replayed once, by the device each event file is named for", async () => {
		const deleted = (id: string, ts: number): HistoryEventMonthFile["events"][number] => ({
			id,
			ts,
			event: "deleted",
			origin: "user",
			subject: { type: "note", path: SCENE, kind: "scene" },
		});
		await fakeVault.seedFile(
			historyFile("2026_10_device-a_history_events.json"),
			eventFile({
				schemaVersion: 1,
				// Deleted, restored and deleted again by one device.
				events: [deleted("gone-1", T0), deleted("gone-2", T0 + 2 * HOUR)],
			}),
		);
		await fakeVault.seedFile(
			historyFile("2026_10_device-b_history_events.json"),
			eventFile({
				schemaVersion: 1,
				// Both deletions as the sync replayed them on the other device.
				events: [deleted("gone-1-b", T0 + 40_000), deleted("gone-2-b", T0 + 2 * HOUR + 40_000)],
			}),
		);
		const reading = await service.read(project, "2026-10-21", "2026-10-21");
		expect(reading.days[0]?.entries.map((entry) => entry.id)).toEqual([
			`2026-10-21:${SCENE}:deleted:gone-1`,
			`2026-10-21:${SCENE}:deleted:gone-2`,
		]);
	});

	it("says when there is something new to read, and when the copies' availability moved", async () => {
		await fakeVault.seedFile(at(SCENE), note("scene", "one two three"));
		store.add(at(SCENE), T0, note("scene", "one two three"));
		await service.refresh();
		// The pass announces itself as it begins and ends, and the rows once.
		expect(kinds()[0]).toBe("availability");
		expect(kinds().filter((kind) => kind === "data")).toEqual(["data"]);
		expect(service.status().readThrough).toBe(T0);
		expect(fakeVault.contents.has(historyFile("2026_10_device-a_note_snapshots.json"))).toBe(true);

		events.length = 0;
		service.start();
		service.noteCreated(at("20_Character/Ada.md"), note("character", "Ada"), true);
		await timers.fire(LEDGER_FLUSH_QUIET_MS);
		expect(kinds()).toEqual(["data"]);
		expect(fakeVault.contents.has(historyFile("2026_10_device-a_history_events.json"))).toBe(true);

		events.length = 0;
		for (const listener of sessionListeners) listener({ kind: "changed", counted: true });
		for (const listener of sessionListeners) listener({ kind: "started" });
		expect(kinds()).toEqual([]);
		for (const listener of sessionListeners) {
			listener({ kind: "stopped", record: null, reason: "manual" });
		}
		expect(kinds()).toEqual(["data"]);

		events.length = 0;
		readerOn = false;
		service.settingsChanged();
		expect(kinds()).toEqual(["availability"]);

		// Synced files are told once they settle, however many landed.
		events.length = 0;
		service.filesChanged();
		service.filesChanged();
		service.filesChanged();
		expect(timers.handlers.size).toBeGreaterThan(0);
		await timers.fire(HISTORY_FILES_QUIET_MS);
		expect(kinds()).toEqual(["data"]);
	});

	it("reads the store again when the copies become readable", async () => {
		readerOn = false;
		service.start();
		await timers.fire(30_000);
		expect(service.status().readThrough).toBeNull();
		store.add(at(SCENE), T0, note("scene", "one two three"));
		readerOn = true;
		service.availabilityChanged();
		await settle();
		expect(service.status().readThrough).toBe(T0);
	});

	it("passes a corrupt record file on, and chains an inferred rename into the ledger", async () => {
		await fakeVault.seedFile(historyFile("2026_10_device-a_history_events.json"), "{ not json");
		service.start();
		service.noteCreated(at("20_Character/Ada.md"), note("character", "Ada"), true);
		await timers.fire(LEDGER_FLUSH_QUIET_MS);
		expect(events).toContainEqual({
			kind: "corrupt-file-preserved",
			path: historyFile(`2026_10_device-a_history_events.corrupted-${String(T0)}.json`),
		});

		// A copy under a new path with exactly the text another path last
		// had, that path's note gone: the harvester tells the ledger.
		const text = note("scene", "one two three");
		await fakeVault.seedFile(at("40_Scene/Thirteen.md"), text);
		store.add(at(SCENE), T0, text);
		await service.refresh();
		store.add(at("40_Scene/Thirteen.md"), T0 + HOUR, text);
		await service.refresh();
		await timers.fire(LEDGER_FLUSH_QUIET_MS);
		const file = JSON.parse(
			fakeVault.contents.get(historyFile("2026_10_device-a_history_events.json")) ?? "null",
		) as HistoryEventMonthFile;
		expect(file.events.map((event) => [event.event, event.origin, event.from])).toContainEqual([
			"renamed",
			"inferred",
			SCENE,
		]);
		expect(fingerprint(text)).toBe(fingerprint(text));
	});

	it("tells the parts of a path renamed or gone, and nothing after dispose", async () => {
		service.start();
		await fakeVault.seedFile(at(SCENE), note("scene", "one two three"));
		store.add(at(SCENE), T0, note("scene", "one two three"));
		await service.refresh();
		events.length = 0;
		fakeVault.rename(at(SCENE), at("40_Scene/Thirteen.md"));
		service.notePathRenamed(at(SCENE), at("40_Scene/Thirteen.md"));
		await timers.fire(LEDGER_FLUSH_QUIET_MS);
		const renamed = JSON.parse(
			fakeVault.contents.get(historyFile("2026_10_device-a_history_events.json")) ?? "null",
		) as HistoryEventMonthFile;
		expect(renamed.events.map((event) => [event.event, event.from])).toEqual([["renamed", SCENE]]);

		service.dispose();
		events.length = 0;
		service.filesChanged();
		service.availabilityChanged();
		await timers.fire(HISTORY_FILES_QUIET_MS);
		expect(kinds()).toEqual([]);
	});
});
