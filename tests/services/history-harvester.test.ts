import { beforeEach, describe, expect, it } from "vitest";

import { SCHEMA_VERSION, fingerprint, type NoteSnapshotMonthFile } from "../../src/domain";
import {
	HARVEST_BACKOFF_MAX_MS,
	HARVEST_FIRST_PASS_MS,
	HARVEST_INTERVAL_MOBILE_MS,
	HARVEST_INTERVAL_MS,
	SnapshotHarvester,
	SnowflakeProjectService,
	type HarvesterEvent,
	type NoteCountOptions,
	type ProjectRef,
	type ProjectSnapshot,
} from "../../src/services";
import { isPathAtOrBelow } from "../../src/project-root";
import { FakeSnapshotStore } from "../helpers/fake-snapshot-store";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const MINUTE = 60_000;
const HISTORY_DIR = "70_Tool/71_Data_Statistics/714_Modification_History";

describe("SnapshotHarvester", () => {
	let fakeVault: FakeVault;
	let projects: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let projectRefs: ProjectRef[];
	let store: FakeSnapshotStore;
	let harvester: SnapshotHarvester;
	let clock: number;
	/** How far the clock moves at every look, so a test can make the pass breathe. */
	let tickMs: number;
	let cursorStore: { value: unknown; saves: number };
	let readerOn: boolean;
	let timeZone: string;
	let activeCountOptions: NoteCountOptions;
	let frontmatterNow: Map<string, Record<string, unknown>>;
	let events: HarvesterEvent[];
	let onBreath: (() => void) | null;
	let intervalMs: (() => number) | undefined;
	let hidden: (() => boolean) | undefined;
	let timers: {
		handlers: Map<number, () => void>;
		delays: number[];
		flush: () => Promise<void>;
	};

	const settle = async (): Promise<void> => {
		for (let i = 0; i < 6; i += 1) {
			await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
		}
	};

	const buildHarvester = (): SnapshotHarvester => {
		const built = new SnapshotHarvester({
			repository: projects.repository,
			writingCount: projects.writingCount,
			reader: () => (readerOn ? store : null),
			projects: () => projectRefs,
			projectAtPath: (path) =>
				projectRefs.find((ref) => isPathAtOrBelow(path, ref.rootPath)) ?? null,
			frontmatterNow: (path) => frontmatterNow.get(path) ?? null,
			countOptions: () => activeCountOptions,
			cursor: {
				load: () => cursorStore.value,
				save: (cursor) => {
					cursorStore.value = JSON.parse(JSON.stringify(cursor));
					cursorStore.saves += 1;
				},
			},
			deviceId: () => "device-a",
			timezone: () => timeZone,
			...(intervalMs === undefined ? {} : { intervalMs }),
			...(hidden === undefined ? {} : { hidden }),
			now: () => {
				clock += tickMs;
				return clock;
			},
			timers: {
				set: (handler, ms) => {
					timers.delays.push(ms);
					if (ms === 0) {
						onBreath?.();
						handler();
						return 0;
					}
					const id = timers.handlers.size + 1;
					timers.handlers.set(id, handler);
					return id;
				},
				clear: (handle) => {
					timers.handlers.delete(handle as number);
				},
			},
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
		tickMs = 0;
		cursorStore = { value: null, saves: 0 };
		readerOn = true;
		timeZone = "UTC";
		activeCountOptions = { mode: "ms-word", headings: "count" };
		frontmatterNow = new Map();
		events = [];
		onBreath = null;
		intervalMs = undefined;
		hidden = undefined;
		const handlers = new Map<number, () => void>();
		timers = {
			handlers,
			delays: [],
			flush: async () => {
				const pending = [...handlers.values()];
				handlers.clear();
				for (const handler of pending) handler();
				await settle();
			},
		};
		harvester = buildHarvester();
	});

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

	const at = (rel: string): string => `${project.rootPath}/${rel}`;
	const SCENE = "40_Scene/Twelve.md";

	const monthFile = (month = "10", year = "2026", device = "device-a"): NoteSnapshotMonthFile | null => {
		const content = fakeVault.contents.get(
			`${project.rootPath}/${HISTORY_DIR}/${year}/${year}_${month}_${device}_note_snapshots.json`,
		);
		return content === undefined ? null : (JSON.parse(content) as NoteSnapshotMonthFile);
	};

	const cursor = () =>
		cursorStore.value as {
			watermark: number;
			projects: Record<string, { root: string; notes: Record<string, { ts: number; words: number; hash: string }> }>;
		};

	it("files a first version as a baseline and the next as a delta against it", async () => {
		const first = note("scene", "one two three");
		const second = note("scene", "one two three four five");
		store.add(at(SCENE), T0, first);
		store.add(at(SCENE), T0 + 5 * MINUTE, second);

		await harvester.harvestNow();

		expect(monthFile()).toEqual({
			schemaVersion: 1,
			countMode: "ms-word",
			countHeadings: "count",
			snapshots: [
				{ path: SCENE, kind: "scene", documentType: "scene", ts: T0, words: 3, delta: null, hash: fingerprint(first) },
				{
					path: SCENE,
					kind: "scene",
					documentType: "scene",
					ts: T0 + 5 * MINUTE,
					words: 5,
					delta: 2,
					prevTs: T0,
					hash: fingerprint(second),
				},
			],
		});
		expect(cursor().watermark).toBe(T0 + 5 * MINUTE);
		expect(cursor().projects[project.id]).toEqual({
			root: project.rootPath,
			notes: { [SCENE]: { ts: T0 + 5 * MINUTE, words: 5, hash: fingerprint(second), mode: "ms-word", headings: "count" } },
		});
		expect(events.filter((event) => event.kind === "harvested")).toEqual([{ kind: "harvested", rows: 2 }]);
		expect(harvester.status()).toEqual({
			running: false,
			readThrough: T0 + 5 * MINUTE,
			lastPassAt: clock,
			lastError: null,
		});
	});

	it("counts the same text kept again as a version, with nothing added", async () => {
		const text = note("scene", "one two three");
		store.add(at(SCENE), T0, text);
		store.add(at(SCENE), T0 + 5 * MINUTE, text);
		await harvester.harvestNow();
		// The core plugin's dialog lists both, so both count; the second changed nothing.
		expect(monthFile()?.snapshots.map(({ words, delta, prevTs }) => ({ words, delta, prevTs }))).toEqual([
			{ words: 3, delta: null, prevTs: undefined },
			{ words: 3, delta: 0, prevTs: T0 },
		]);
		expect(cursor().projects[project.id]?.notes[SCENE]?.ts).toBe(T0 + 5 * MINUTE);
		store.add(at(SCENE), T0 + 10 * MINUTE, note("scene", "one two"));
		await harvester.harvestNow();
		expect(monthFile()?.snapshots[2]).toMatchObject({ words: 2, delta: -1, prevTs: T0 + 5 * MINUTE });
	});

	it("reads no delta across a change of convention, and stamps the row", async () => {
		store.add(at(SCENE), T0, note("scene", "one two three"));
		await harvester.harvestNow();
		activeCountOptions = { mode: "jinjiang", headings: "count" };
		store.add(at(SCENE), T0 + 5 * MINUTE, note("scene", "one two three four"));
		await harvester.harvestNow();
		store.add(at(SCENE), T0 + 10 * MINUTE, note("scene", "one two three four five"));
		await harvester.harvestNow();
		const file = monthFile();
		expect(file?.countMode).toBe("ms-word");
		expect(file?.snapshots.map(({ words, delta, prevTs, countMode }) => ({ words, delta, prevTs, countMode }))).toEqual([
			{ words: 3, delta: null, prevTs: undefined, countMode: undefined },
			{ words: 15, delta: null, prevTs: undefined, countMode: "jinjiang" },
			{ words: 19, delta: 4, prevTs: T0 + 5 * MINUTE, countMode: "jinjiang" },
		]);
	});

	it("passes over what is not a note of a writable project, and still moves on", async () => {
		const shelved: ProjectRef = { ...project, rootPath: "Shelved", projectFile: "Shelved/00_System/001_Project_Metadata.md", id: "project-shelved", readOnly: true };
		projectRefs = [project, shelved];
		store.add(at("40_Scene/Board.canvas"), T0, "{}");
		store.add("Inbox/Loose.md", T0 + 1, "words nobody claimed");
		store.add(at("00_System/001_Project_Metadata.md"), T0 + 2, note("project-metadata", ""));
		store.add(at("70_Tool/72_Task_Management/724_Sticky_Note/1.md"), T0 + 3, note("sticky-note", "stuck"));
		store.add("Shelved/40_Scene/One.md", T0 + 4, "one two");
		store.add(at("20_Character/Ada.md"), T0 + 5, note("character", "one").replace(project.id, "project-other"));

		await harvester.harvestNow();

		expect(monthFile()).toBeNull();
		expect(cursor().watermark).toBe(T0 + 5);
		expect(events.filter((event) => event.kind === "harvested")).toEqual([]);
	});

	it("reads the store in batches, and saves the cursor once each", async () => {
		for (let i = 0; i < 450; i += 1) {
			store.add(at(`40_Scene/S${String(i)}.md`), T0 + i * 1000, note("scene", `scene ${String(i)}`));
		}
		await harvester.harvestNow();
		// A full reading holds its last moment back for the next, so each
		// batch is one row short of the limit and the next starts there.
		expect(store.readCalls.map((call) => call.limit)).toEqual([200, 200, 200]);
		expect(store.readCalls.map((call) => call.after)).toEqual([0, T0 + 198_000, T0 + 397_000]);
		expect(cursorStore.saves).toBe(3);
		expect(monthFile()?.snapshots).toHaveLength(450);
		expect(events.filter((event) => event.kind === "harvested")).toEqual([
			{ kind: "harvested", rows: 199 },
			{ kind: "harvested", rows: 199 },
			{ kind: "harvested", rows: 52 },
		]);
	});

	it("keeps what it could not file, and files it on the next pass", async () => {
		store.add(at(SCENE), T0, note("scene", "one two three"));
		fakeVault.failNextCreatePath = `${project.rootPath}/${HISTORY_DIR}/2026/2026_10_device-a_note_snapshots.json`;

		await harvester.harvestNow();
		expect(monthFile()).toBeNull();
		expect(cursorStore.saves).toBe(0);
		expect(harvester.status().lastError).not.toBeNull();

		await harvester.harvestNow();
		expect(monthFile()?.snapshots).toHaveLength(1);
		expect(cursor().watermark).toBe(T0);
		expect(harvester.status().lastError).toBeNull();
		// The rows were read once; the second pass filed what the first held.
		expect(store.readCalls).toHaveLength(2);
	});

	it("rebuilds the cursor from this device's own files, and harvests nothing twice", async () => {
		const text = note("scene", "one two three");
		await fakeVault.seedFile(
			`${project.rootPath}/${HISTORY_DIR}/2026/2026_10_device-a_note_snapshots.json`,
			JSON.stringify({
				schemaVersion: 1,
				countMode: "ms-word",
				countHeadings: "count",
				snapshots: [{ path: SCENE, kind: "scene", ts: T0, words: 3, delta: null, hash: fingerprint(text) }],
			}),
		);
		// Another device's file says nothing about this device's store.
		await fakeVault.seedFile(
			`${project.rootPath}/${HISTORY_DIR}/2026/2026_10_device-b_note_snapshots.json`,
			JSON.stringify({
				schemaVersion: 1,
				countMode: "ms-word",
				countHeadings: "count",
				snapshots: [{ path: SCENE, kind: "scene", ts: T0 + 60 * MINUTE, words: 9, delta: null, hash: "fp1-elsewhere" }],
			}),
		);
		store.add(at(SCENE), T0, text);
		store.add(at(SCENE), T0 + 5 * MINUTE, note("scene", "one two three four"));
		harvester = buildHarvester();

		await harvester.harvestNow();

		expect(store.readCalls[0]?.after).toBe(T0);
		expect(monthFile()?.snapshots).toEqual([
			{ path: SCENE, kind: "scene", ts: T0, words: 3, delta: null, hash: fingerprint(text) },
			expect.objectContaining({ ts: T0 + 5 * MINUTE, words: 4, delta: 1, prevTs: T0 }),
		]);
	});

	it("files the month by the day in the device zone", async () => {
		timeZone = "Asia/Shanghai";
		store.add(at(SCENE), Date.UTC(2026, 9, 31, 10), note("scene", "one"));
		store.add(at(SCENE), Date.UTC(2026, 9, 31, 20), note("scene", "one two"));
		await harvester.harvestNow();
		expect(monthFile("10")?.snapshots).toHaveLength(1);
		expect(monthFile("11")?.snapshots).toEqual([
			expect.objectContaining({ ts: Date.UTC(2026, 9, 31, 20), delta: 1, prevTs: Date.UTC(2026, 9, 31, 10) }),
		]);
	});

	it("moves a sighting with a rename and drops it with a deletion", async () => {
		const text = note("scene", "one two three");
		store.add(at(SCENE), T0, text);
		await harvester.harvestNow();

		harvester.notePathRenamed(at(SCENE), at("40_Scene/Thirteen.md"));
		expect(Object.keys(cursor().projects[project.id]?.notes ?? {})).toEqual(["40_Scene/Thirteen.md"]);
		// The same text under the new name is a version the dialog lists there, with nothing added.
		store.add(at("40_Scene/Thirteen.md"), T0 + 5 * MINUTE, text);
		await harvester.harvestNow();
		expect(monthFile()?.snapshots.map(({ path, delta, prevTs }) => ({ path, delta, prevTs }))).toEqual([
			{ path: SCENE, delta: null, prevTs: undefined },
			{ path: "40_Scene/Thirteen.md", delta: 0, prevTs: T0 },
		]);

		// A folder moves its notes with it; the project moving changes no path under it.
		harvester.notePathRenamed(at("40_Scene"), at("45_Scenes"));
		expect(Object.keys(cursor().projects[project.id]?.notes ?? {})).toEqual(["45_Scenes/Thirteen.md"]);
		harvester.notePathRenamed(project.rootPath, "Books/Novel");
		expect(cursor().projects[project.id]?.root).toBe("Books/Novel");
		harvester.notePathRenamed("Books/Novel", project.rootPath);

		// Out of the project, the sighting goes; and so with a deletion.
		harvester.notePathRenamed(at("45_Scenes/Thirteen.md"), "Inbox/Thirteen.md");
		expect(cursor().projects[project.id]?.notes).toEqual({});
		store.add(at(SCENE), T0 + 10 * MINUTE, text);
		await harvester.harvestNow();
		harvester.noteDeleted(at(SCENE));
		expect(cursor().projects[project.id]?.notes).toEqual({});
		store.add(at(SCENE), T0 + 15 * MINUTE, text);
		await harvester.harvestNow();
		expect(monthFile()?.snapshots.map((row) => row.delta)).toEqual([null, 0, null, null]);
		// A deleted project takes its whole entry with it.
		harvester.noteDeleted(project.rootPath, { children: true });
		expect(cursor().projects).toEqual({});
	});

	it("reads a note first seen with a gone note's text as that note renamed", async () => {
		const text = note("scene", "one two three");
		await fakeVault.seedFile(at(SCENE), text);
		store.add(at(SCENE), T0, text);
		await harvester.harvestNow();

		// The rename happened where the plugin could not see it: the old note
		// is gone, and the new one first appears with exactly its text.
		fakeVault.delete(at(SCENE));
		store.add(at("40_Scene/Thirteen.md"), T0 + 5 * MINUTE, text);
		store.add(at("40_Scene/Thirteen.md"), T0 + 10 * MINUTE, note("scene", "one two three four"));
		await harvester.harvestNow();

		expect(events.filter((event) => event.kind === "inferred-rename")).toEqual([
			{ kind: "inferred-rename", project, from: SCENE, to: "40_Scene/Thirteen.md", ts: T0 + 5 * MINUTE },
		]);
		expect(monthFile()?.snapshots).toEqual([
			expect.objectContaining({ path: SCENE, ts: T0, delta: null }),
			// The first row under the new name is a version its dialog lists, with nothing added.
			expect.objectContaining({ path: "40_Scene/Thirteen.md", ts: T0 + 5 * MINUTE, delta: 0, prevTs: T0 }),
			expect.objectContaining({ path: "40_Scene/Thirteen.md", ts: T0 + 10 * MINUTE, delta: 1, prevTs: T0 + 5 * MINUTE }),
		]);
		expect(Object.keys(cursor().projects[project.id]?.notes ?? {})).toEqual(["40_Scene/Thirteen.md"]);
	});

	it("reads a copy's own frontmatter before what the note says now", async () => {
		frontmatterNow.set(at("80_Material/Moved.md"), { "snowflake-document": "character" });
		store.add(at("80_Material/Moved.md"), T0, "no frontmatter at all");
		store.add(at("80_Material/Moved.md"), T0 + 5 * MINUTE, note("scene", "one two"));
		await harvester.harvestNow();
		expect(monthFile()?.snapshots.map((row) => row.kind)).toEqual(["character", "scene"]);
	});

	it("stops cleanly when disposed mid-pass", async () => {
		tickMs = 13;
		for (let i = 0; i < 3; i += 1) {
			store.add(at(`40_Scene/S${String(i)}.md`), T0 + i, note("scene", `scene ${String(i)}`));
		}
		let breaths = 0;
		onBreath = () => {
			breaths += 1;
			harvester.dispose();
		};
		await harvester.harvestNow();
		expect(breaths).toBe(1);
		expect(monthFile()).toBeNull();
		expect(cursorStore.saves).toBe(0);
		expect(timers.handlers.size).toBe(0);
	});

	it("backs off while the store cannot be read, and recovers", async () => {
		store.failNextRead(3);
		await harvester.harvestNow();
		expect(harvester.status().lastError).toBe("The store could not be read.");
		expect(timers.delays).toEqual([HARVEST_INTERVAL_MS]);
		await timers.flush();
		expect(timers.delays).toEqual([HARVEST_INTERVAL_MS, 2 * HARVEST_INTERVAL_MS]);
		await timers.flush();
		expect(timers.delays[2]).toBe(4 * HARVEST_INTERVAL_MS);
		await timers.flush();
		expect(timers.delays[3]).toBe(HARVEST_INTERVAL_MS);
		expect(harvester.status().lastError).toBeNull();
		expect(HARVEST_BACKOFF_MAX_MS).toBe(6 * HARVEST_INTERVAL_MS);
	});

	it("arms the first pass half a minute after the start, then every five minutes", async () => {
		harvester.start();
		expect(timers.delays).toEqual([HARVEST_FIRST_PASS_MS]);
		await timers.flush();
		expect(timers.delays).toEqual([HARVEST_FIRST_PASS_MS, HARVEST_INTERVAL_MS]);
		expect(harvester.status().lastPassAt).not.toBeNull();
	});

	it("reads nothing while there is nothing to read, and looks again on the interval", async () => {
		readerOn = false;
		store.add(at(SCENE), T0, note("scene", "one"));
		await harvester.harvestNow();
		expect(store.readCalls).toEqual([]);
		expect(harvester.status().lastPassAt).toBeNull();
		// The store came back with nothing else to say so: the next pass reads it.
		expect(timers.delays).toEqual([HARVEST_INTERVAL_MS]);
		readerOn = true;
		await timers.flush();
		expect(store.readCalls).toHaveLength(1);
		expect(harvester.status().lastPassAt).toBe(T0);
	});

	it("rests as long as it is told between passes: a phone's quarter hour", async () => {
		intervalMs = () => HARVEST_INTERVAL_MOBILE_MS;
		harvester = buildHarvester();
		harvester.start();
		await timers.flush();
		expect(timers.delays).toEqual([HARVEST_FIRST_PASS_MS, HARVEST_INTERVAL_MOBILE_MS]);
		expect(HARVEST_INTERVAL_MOBILE_MS).toBe(3 * HARVEST_INTERVAL_MS);
	});

	it("lets a pass due while the app is hidden wait for the next tick", async () => {
		let out = true;
		hidden = () => out;
		harvester = buildHarvester();
		store.add(at(SCENE), T0, note("scene", "one"));
		harvester.start();
		await timers.flush();
		expect(store.readCalls).toEqual([]);
		expect(harvester.status().lastPassAt).toBeNull();
		expect(timers.delays).toEqual([HARVEST_FIRST_PASS_MS, HARVEST_INTERVAL_MS]);
		out = false;
		await timers.flush();
		expect(store.readCalls).toHaveLength(1);
		expect(harvester.status().lastPassAt).toBe(T0);
		// Asked for outright, a pass runs hidden or not.
		out = true;
		await harvester.harvestNow();
		expect(store.readCalls).toHaveLength(2);
	});
});
