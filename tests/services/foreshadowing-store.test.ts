import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	captureOccurrence,
	type Foreshadowing,
	type ForeshadowingOccurrence,
} from "../../src/domain";
import {
	FORESHADOWING_STORE_SCHEMA_VERSION,
	ForeshadowingService,
	ForeshadowingStore,
	RevisionStore,
	SnowflakeProjectService,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const FILE =
	"Snowflake Projects/Novel/70_Tool/72_Task_Management/722_Foreshadowing/foreshadowing.json";
const REVISIONS =
	"Snowflake Projects/Novel/70_Tool/72_Task_Management/723_Revision/revisions.json";
const CHAPTER = "Snowflake Projects/Novel/50_Manuscript/Chapter 1.md";
const CHAPTER_TWO = "Snowflake Projects/Novel/50_Manuscript/Chapter 2.md";
const BODY = "The grey heron stood in the shallows, watching the water.";

const occurrence = (
	id: string,
	from: number,
	to: number,
	overrides: Partial<ForeshadowingOccurrence> = {},
): ForeshadowingOccurrence => ({
	...captureOccurrence(CHAPTER, BODY, from, to, "plant", "", id),
	...overrides,
});

const makeItem = (
	id: string,
	overrides: Partial<Foreshadowing> = {},
): Foreshadowing => ({
	id,
	name: "The missing key",
	description: "A key disappears.",
	status: "active",
	related: [{ kind: "character", id: "character-alice", name: "Alice" }],
	createdAt: 7,
	updatedAt: 7,
	occurrences: [occurrence(`${id}-occ`, 4, 14)],
	...overrides,
});

const fileOf = (fakeVault: FakeVault): { foreshadowings: unknown[] } =>
	JSON.parse(fakeVault.contents.get(FILE) ?? "{}") as { foreshadowings: unknown[] };

describe("ForeshadowingStore", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let store: ForeshadowingStore;
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
		store = new ForeshadowingStore({
			repository: service.repository,
			now: () => 1234,
			onCorrupt: (path) => asides.push(path),
			onForeign: (path, version) => foreign.push([path, version]),
		});
	});

	it("reads nothing where no file stands, and creates one on the first write", async () => {
		expect(await store.readForeshadowings(project)).toEqual([]);
		const item = makeItem("fs-1");
		expect(
			await store.updateForeshadowings(project, (standing) => [...standing, item]),
		).toBe(true);
		expect(fakeVault.contents.get(FILE)).toContain('"schemaVersion": 1');
		expect(fakeVault.contents.get(FILE)).toContain('"foreshadowings": [');
		expect(await store.readForeshadowings(project)).toEqual([item]);
	});

	it("stores under the task-management chain of the project's locale", () => {
		expect(store.foreshadowingPath(project)).toBe(FILE);
		expect(store.foreshadowingPath({ ...project, locale: "zh-CN" })).toBe(
			"Snowflake Projects/Novel/70_工具/72_任务管理/722_伏笔/foreshadowing.json",
		);
	});

	it("a mutate answering null leaves the file unwritten", async () => {
		expect(await store.updateForeshadowings(project, () => null)).toBe(false);
		expect(fakeVault.contents.has(FILE)).toBe(false);
	});

	it("re-reads when the file moved under it, and serves the memo while it holds", async () => {
		await store.updateForeshadowings(project, () => [makeItem("fs-1")]);
		expect(await store.readForeshadowings(project)).toHaveLength(1);
		fakeVault.contents.set(
			FILE,
			JSON.stringify({
				schemaVersion: FORESHADOWING_STORE_SCHEMA_VERSION,
				foreshadowings: [],
			}),
		);
		expect(await store.readForeshadowings(project)).toEqual([]);
	});

	it("drops malformed entries alone, keeping the readable ones", async () => {
		const item = makeItem("fs-1");
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: FORESHADOWING_STORE_SCHEMA_VERSION,
				foreshadowings: [item, { id: "broken" }, 7],
			}),
		);
		expect(await store.readForeshadowings(project)).toEqual([item]);
	});

	it("drops one malformed occurrence and serves the thread without it", async () => {
		const good = occurrence("good", 4, 14);
		const item = makeItem("fs-1", { occurrences: [good] });
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: FORESHADOWING_STORE_SCHEMA_VERSION,
				foreshadowings: [
					{ ...item, occurrences: [good, { ...occurrence("bent", 20, 28), role: "hint" }] },
				],
			}),
		);
		expect(await store.readForeshadowings(project)).toEqual([item]);
	});

	it("sets a file that will not parse aside whole and starts fresh", async () => {
		await fakeVault.seedFile(FILE, "{ not json");
		expect(await store.readForeshadowings(project)).toEqual([]);
		const aside = [...fakeVault.contents.keys()].find((path) =>
			path.includes("722_Foreshadowing/foreshadowing.corrupted-1234"),
		);
		expect(aside).toBeDefined();
		expect(fakeVault.contents.get(aside as string)).toBe("{ not json");
		expect(asides).toEqual([aside]);
	});

	it("leaves a schema it does not know exactly where it stands, and refuses to write over it", async () => {
		const written = JSON.stringify({
			schemaVersion: 99,
			foreshadowings: [makeItem("fs-1")],
		});
		await fakeVault.seedFile(FILE, written);
		expect(await store.readForeshadowings(project)).toEqual([]);
		expect(foreign).toEqual([[FILE, 99]]);
		expect(asides).toEqual([]);
		expect(
			await store.updateForeshadowings(project, (standing) => [
				...standing,
				makeItem("fs-2"),
			]),
		).toBe(false);
		expect(fakeVault.contents.get(FILE)).toBe(written);
		expect(
			[...fakeVault.contents.keys()].some((path) => path.includes(".corrupted-")),
		).toBe(false);
	});

	it("reads the schema line before the shape, so a newer layout is foreign", async () => {
		const written = JSON.stringify({ schemaVersion: 99, entries: [] });
		await fakeVault.seedFile(FILE, written);
		expect(await store.readForeshadowings(project)).toEqual([]);
		expect(foreign).toEqual([[FILE, 99]]);
		expect(asides).toEqual([]);
		expect(fakeVault.contents.get(FILE)).toBe(written);
	});

	it("a schema from before the first is damage, not the future", async () => {
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({ schemaVersion: 0, foreshadowings: [makeItem("fs-1")] }),
		);
		expect(await store.readForeshadowings(project)).toEqual([]);
		expect(foreign).toEqual([]);
		expect(asides).toHaveLength(1);
	});

	it("carries an entry it cannot read through every write, untouched", async () => {
		const bent = { ...makeItem("fs-bent"), createdAt: "yesterday" };
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: FORESHADOWING_STORE_SCHEMA_VERSION,
				foreshadowings: [makeItem("fs-1"), bent],
			}),
		);
		expect((await store.readForeshadowings(project)).map((kept) => kept.id)).toEqual([
			"fs-1",
		]);
		expect(
			await store.updateForeshadowings(project, (standing) => [
				...standing,
				makeItem("fs-2"),
			]),
		).toBe(true);
		const written = fileOf(fakeVault);
		expect(written.foreshadowings).toHaveLength(3);
		expect(written.foreshadowings).toContainEqual(bent);
		expect((await store.readForeshadowings(project)).map((kept) => kept.id)).toEqual([
			"fs-1",
			"fs-2",
		]);
	});

	it("a refused write and a write that changed nothing both keep the memo", async () => {
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({ schemaVersion: 99, foreshadowings: [makeItem("fs-1")] }),
		);
		await store.readForeshadowings(project);
		expect(foreign).toHaveLength(1);
		expect(await store.updateForeshadowings(project, () => [makeItem("fs-2")])).toBe(
			false,
		);
		expect(foreign).toHaveLength(2);
		await store.readForeshadowings(project);
		expect(foreign).toHaveLength(2);

		fakeVault.contents.set(
			FILE,
			JSON.stringify({
				schemaVersion: FORESHADOWING_STORE_SCHEMA_VERSION,
				foreshadowings: [makeItem("fs-1")],
			}),
		);
		await store.readForeshadowings(project);
		const reads = fakeVault.readCalls.filter((path) => path === FILE).length;
		expect(await store.updateForeshadowings(project, () => null)).toBe(false);
		await store.readForeshadowings(project);
		expect(fakeVault.readCalls.filter((path) => path === FILE)).toHaveLength(
			reads + 1,
		);
	});

	it("still sets aside a file that is damaged rather than merely newer", async () => {
		await fakeVault.seedFile(FILE, '{"schemaVersion": 1, "foreshadowings": 7}');
		expect(await store.readForeshadowings(project)).toEqual([]);
		expect(asides).toHaveLength(1);
		expect(foreign).toEqual([]);
	});

	it("evicts a memo for a root let go", async () => {
		const item = makeItem("fs-1");
		await store.updateForeshadowings(project, () => [item]);
		await store.readForeshadowings(project);
		store.evict(project.rootPath);
		expect(await store.readForeshadowings(project)).toEqual([item]);
	});

	it("shares no memo with the revision store", async () => {
		const revisions = new RevisionStore({ repository: service.repository, now: () => 1 });
		await store.updateForeshadowings(project, () => [makeItem("fs-1")]);
		expect(await store.readForeshadowings(project)).toHaveLength(1);
		expect(await revisions.readRevisions(project)).toEqual([]);
		expect(fakeVault.contents.has(REVISIONS)).toBe(false);
		fakeVault.contents.set(
			FILE,
			JSON.stringify({
				schemaVersion: FORESHADOWING_STORE_SCHEMA_VERSION,
				foreshadowings: [makeItem("fs-1"), makeItem("fs-2")],
			}),
		);
		expect(await store.readForeshadowings(project)).toHaveLength(2);
		expect(await revisions.readRevisions(project)).toEqual([]);
	});
});

describe("ForeshadowingService", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let threads: ForeshadowingService;
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
		threads = new ForeshadowingService(service.repository, { now: () => clock });
	});

	it("creates once per id and lists what stands", async () => {
		expect(await threads.create(project, makeItem("fs-1"))).toBe(true);
		expect(await threads.create(project, makeItem("fs-1"))).toBe(false);
		expect(await threads.create(project, makeItem("fs-2"))).toBe(true);
		expect((await threads.list(project)).map((item) => item.id)).toEqual(["fs-1", "fs-2"]);
	});

	it("edits a thread in one write, deleting what the form left out", async () => {
		const kept = occurrence("kept", 4, 14);
		const gone = occurrence("gone", 30, 38);
		await threads.create(project, makeItem("fs-1", { occurrences: [kept, gone] }));
		const writes = vi.spyOn(service.repository, "updatePlainFile");
		clock = 200;
		expect(
			await threads.edit(project, "fs-1", {
				name: "  The key  ",
				description: "It opens the cellar.",
				status: "resolved",
				related: [
					{ kind: "character", id: "character-alice", name: "Alice Grey" },
					{ kind: "item", id: "entity-key", name: "Silver key" },
				],
				occurrences: [
					{ id: "kept", role: "payoff", note: "  found  " },
					{ id: "never-there", role: "plant", note: "" },
				],
			}),
		).toBe("written");
		expect(writes).toHaveBeenCalledTimes(1);
		const [item] = await threads.list(project);
		expect(item).toMatchObject({
			name: "The key",
			description: "It opens the cellar.",
			status: "resolved",
			createdAt: 7,
			updatedAt: 200,
		});
		expect(item?.related.map((ref) => ref.name)).toEqual(["Alice Grey", "Silver key"]);
		expect(item?.occurrences).toEqual([{ ...kept, role: "payoff", note: "found" }]);
	});

	it("an edit saying what already stands writes nothing and still answers written", async () => {
		const item = makeItem("fs-1");
		await threads.create(project, item);
		const written = fakeVault.contents.get(FILE);
		clock = 200;
		expect(
			await threads.edit(project, "fs-1", {
				name: item.name,
				description: item.description,
				status: item.status,
				related: item.related,
				occurrences: item.occurrences.map(({ id, role, note }) => ({ id, role, note })),
			}),
		).toBe("written");
		expect(fakeVault.contents.get(FILE)).toBe(written);
		expect((await threads.list(project))[0]?.updatedAt).toBe(7);
	});

	it("tells a thread that is gone from a write the store refused", async () => {
		await threads.create(project, makeItem("fs-1"));
		const edit = {
			name: "x",
			description: "",
			status: "planned" as const,
			related: [],
			occurrences: [],
		};
		expect(await threads.edit(project, "fs-9", edit)).toBe("absent");
		expect(await threads.addOccurrence(project, "fs-9", occurrence("o", 4, 14))).toBe("absent");
		expect(await threads.deleteItem(project, "fs-9")).toBe("absent");
		fakeVault.contents.set(
			FILE,
			JSON.stringify({ schemaVersion: 99, foreshadowings: [makeItem("fs-1")] }),
		);
		expect(await threads.edit(project, "fs-1", edit)).toBe("refused");
		expect(await threads.deleteItem(project, "fs-1")).toBe("refused");
		expect(await threads.deleteOccurrence(project, "fs-1", "fs-1-occ")).toBe("refused");
	});

	it("deletes a thread with every occurrence it holds", async () => {
		await threads.create(project, makeItem("fs-1"));
		await threads.create(project, makeItem("fs-2"));
		expect(await threads.deleteItem(project, "fs-1")).toBe("deleted");
		expect((await threads.list(project)).map((item) => item.id)).toEqual(["fs-2"]);
		expect(await threads.deleteItem(project, "fs-1")).toBe("absent");
	});

	it("appends an occurrence and stamps the thread, leaving a standing id alone", async () => {
		await threads.create(project, makeItem("fs-1"));
		clock = 300;
		const added = occurrence("added", 30, 38, { role: "reinforce", note: "again" });
		expect(await threads.addOccurrence(project, "fs-1", added)).toBe("written");
		let [item] = await threads.list(project);
		expect(item?.occurrences.map((o) => o.id)).toEqual(["fs-1-occ", "added"]);
		expect(item?.updatedAt).toBe(300);
		clock = 400;
		expect(
			await threads.addOccurrence(project, "fs-1", { ...added, note: "changed" }),
		).toBe("written");
		[item] = await threads.list(project);
		expect(item?.occurrences[1]?.note).toBe("again");
		expect(item?.updatedAt).toBe(300);
	});

	it("changes an occurrence's role and note and nothing of its place", async () => {
		await threads.create(project, makeItem("fs-1"));
		clock = 300;
		expect(
			await threads.updateOccurrence(project, "fs-1", "fs-1-occ", {
				role: "payoff",
				note: "  paid off ",
			}),
		).toBe("written");
		const [item] = await threads.list(project);
		expect(item?.occurrences[0]).toEqual({
			...occurrence("fs-1-occ", 4, 14),
			role: "payoff",
			note: "paid off",
		});
		expect(item?.updatedAt).toBe(300);
		expect(
			await threads.updateOccurrence(project, "fs-1", "nope", { role: "plant", note: "" }),
		).toBe("absent");
	});

	it("deletes one occurrence and leaves the thread standing when it was the last", async () => {
		await threads.create(project, makeItem("fs-1"));
		expect(await threads.deleteOccurrence(project, "fs-1", "fs-1-occ")).toBe("deleted");
		const [item] = await threads.list(project);
		expect(item?.occurrences).toEqual([]);
		expect(item?.id).toBe("fs-1");
		expect(await threads.deleteOccurrence(project, "fs-1", "fs-1-occ")).toBe("absent");
	});

	it("relinks an occurrence to a fresh passage whole, keeping role and note", async () => {
		await threads.create(
			project,
			makeItem("fs-1", { occurrences: [occurrence("occ", 4, 14, { role: "payoff", note: "n" })] }),
		);
		const fresh = captureOccurrence(CHAPTER_TWO, "Nothing but the door.", 12, 16, "plant", "", "x");
		clock = 500;
		expect(
			await threads.relinkOccurrence(project, "fs-1", "occ", {
				path: fresh.path,
				from: fresh.from,
				to: fresh.to,
				originalText: fresh.originalText,
				before: fresh.before,
				after: fresh.after,
			}),
		).toBe("written");
		const [item] = await threads.list(project);
		expect(item?.occurrences[0]).toEqual({
			...fresh,
			id: "occ",
			role: "payoff",
			note: "n",
		});
		expect(item?.updatedAt).toBe(500);
	});

	it("levels one note's occurrences on save, once, and never touches the clock", async () => {
		await threads.create(project, makeItem("fs-1"));
		clock = 900;
		const grown = `Once, ${BODY}`;
		expect(await threads.refreshAnchorsOnSave(project, CHAPTER, grown)).toBe(true);
		const [item] = await threads.list(project);
		expect(item?.occurrences[0]).toMatchObject({ from: 10, to: 20 });
		expect(item?.updatedAt).toBe(7);
		expect(await threads.refreshAnchorsOnSave(project, CHAPTER, grown)).toBe(false);
		expect(await threads.refreshAnchorsOnSave(project, CHAPTER_TWO, "x")).toBe(false);
	});

	it("carries occurrences with a renamed note and a renamed folder, offsets untouched", async () => {
		const stranger = occurrence("far", 12, 16, {
			path: "Snowflake Projects/Other/50_Manuscript/One.md",
			originalText: "on s",
		});
		await threads.create(
			project,
			makeItem("fs-1", { occurrences: [occurrence("near", 4, 14), stranger] }),
		);
		const moved = "Snowflake Projects/Novel/50_Manuscript/Chapter One.md";
		expect(await threads.renameNotePaths(project, CHAPTER, moved)).toBe(true);
		expect(await threads.renameNotePaths(project, CHAPTER, moved)).toBe(false);
		let [item] = await threads.list(project);
		expect(item?.occurrences[0]).toEqual({ ...occurrence("near", 4, 14), path: moved });
		expect(item?.occurrences[1]).toEqual(stranger);
		expect(item?.updatedAt).toBe(7);
		expect(
			await threads.renameNotePaths(
				project,
				"Snowflake Projects/Novel/50_Manuscript",
				"Snowflake Projects/Novel/50_Draft",
			),
		).toBe(true);
		[item] = await threads.list(project);
		expect(item?.occurrences[0]?.path).toBe(
			"Snowflake Projects/Novel/50_Draft/Chapter One.md",
		);
	});

	it("carries what stands below a split to the new note, by where the words stand", async () => {
		const cut = BODY.indexOf("watching");
		const above = occurrence("above", 4, 14);
		const atCut = occurrence("at-cut", cut, cut + 8);
		const below = occurrence("below", BODY.indexOf("water"), BODY.indexOf("water") + 5);
		const straddling = occurrence("straddling", cut - 5, cut + 5);
		// Stored offsets from an older levelling: the words are found, and
		// where they are found is what decides.
		const stale = {
			...occurrence("stale", 0, 5),
			originalText: "water",
			before: "",
			after: "",
		};
		await threads.create(
			project,
			makeItem("fs-1", { occurrences: [above, atCut, below, straddling, stale] }),
		);
		await threads.create(project, makeItem("fs-2", { occurrences: [occurrence("other", 4, 14)] }));
		expect(
			await threads.carryTextBetweenNotes(project, CHAPTER, CHAPTER_TWO, BODY, cut, cut),
		).toBe(true);
		const [one, two] = await threads.list(project);
		const byId = new Map(one?.occurrences.map((o) => [o.id, o]));
		expect(byId.get("above")).toEqual(above);
		expect(byId.get("straddling")).toEqual(straddling);
		expect(byId.get("at-cut")).toMatchObject({ path: CHAPTER_TWO, from: 0, to: 8 });
		expect(byId.get("below")).toMatchObject({
			path: CHAPTER_TWO,
			from: BODY.indexOf("water") - cut,
			to: BODY.indexOf("water") - cut + 5,
		});
		expect(byId.get("stale")).toMatchObject({
			path: CHAPTER_TWO,
			from: BODY.indexOf("water") - cut,
			to: BODY.indexOf("water") - cut + 5,
		});
		expect(one?.updatedAt).toBe(7);
		expect(two?.occurrences[0]?.path).toBe(CHAPTER);
		expect(
			await threads.carryTextBetweenNotes(project, CHAPTER, CHAPTER_TWO, BODY, cut, cut),
		).toBe(false);
	});
});
