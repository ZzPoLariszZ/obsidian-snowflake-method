import { beforeEach, describe, expect, it } from "vitest";

import { captureRevision, type Revision } from "../../src/domain";
import {
	REVISION_STORE_SCHEMA_VERSION,
	RevisionService,
	RevisionStore,
	SnowflakeProjectService,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const FILE =
	"Snowflake Projects/Novel/70_Tool/72_Task_Management/723_Revision/revisions.json";
const CHAPTER = "Snowflake Projects/Novel/50_Manuscript/Chapter 1.md";
const BODY = "The grey heron stood in the shallows, watching the water.";

const makeRevision = (id: string, overrides: Partial<Revision> = {}): Revision => ({
	...captureRevision(CHAPTER, BODY, "replace", 4, 14, "blue crane", "why", id, 7),
	...overrides,
});

describe("RevisionStore", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let store: RevisionStore;
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
		store = new RevisionStore({
			repository: service.repository,
			now: () => 1234,
			onCorrupt: (path) => asides.push(path),
			onForeign: (path, version) => foreign.push([path, version]),
		});
	});

	it("reads nothing where no file stands, and creates one on the first write", async () => {
		expect(await store.readRevisions(project)).toEqual([]);
		const revision = makeRevision("rev-1");
		expect(
			await store.updateRevisions(project, (standing) => [
				...standing,
				revision,
			]),
		).toBe(true);
		expect(fakeVault.contents.get(FILE)).toContain('"kind": "replace"');
		expect(await store.readRevisions(project)).toEqual([revision]);
	});

	it("stores under the task-management chain of the project's locale", () => {
		// The English chain is pinned by FILE above; the Chinese chain is a
		// path computation alone, so it needs no second vault.
		expect(store.revisionsPath({ ...project, locale: "zh-CN" })).toBe(
			"Snowflake Projects/Novel/70_工具/72_任务管理/723_修订/revisions.json",
		);
	});

	it("a mutate answering null leaves the file unwritten", async () => {
		expect(await store.updateRevisions(project, () => null)).toBe(false);
		expect(fakeVault.contents.has(FILE)).toBe(false);
	});

	it("re-reads when the file moved under it, and serves the memo while it holds", async () => {
		const revision = makeRevision("rev-1");
		await store.updateRevisions(project, () => [revision]);
		expect(await store.readRevisions(project)).toHaveLength(1);
		fakeVault.contents.set(
			FILE,
			JSON.stringify({
				schemaVersion: REVISION_STORE_SCHEMA_VERSION,
				revisions: [],
			}),
		);
		expect(await store.readRevisions(project)).toEqual([]);
	});

	it("drops malformed entries alone, keeping the readable ones", async () => {
		const revision = makeRevision("rev-1");
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: REVISION_STORE_SCHEMA_VERSION,
				revisions: [revision, { id: "broken" }, 7],
			}),
		);
		expect(await store.readRevisions(project)).toEqual([revision]);
	});

	it("sets a file that will not parse aside whole and starts fresh", async () => {
		await fakeVault.seedFile(FILE, "{ not json");
		expect(await store.readRevisions(project)).toEqual([]);
		const aside = [...fakeVault.contents.keys()].find((path) =>
			path.includes("723_Revision/revisions.corrupted-1234"),
		);
		expect(aside).toBeDefined();
		expect(fakeVault.contents.get(aside as string)).toBe("{ not json");
		expect(asides).toEqual([aside]);
	});

	it("leaves a schema it does not know exactly where it stands", async () => {
		// A synced vault where one device updated first. Setting the newer
		// build's file aside would take every proposal the author has standing
		// with it, and sync would carry the rename back to the device that
		// could read them.
		const written = JSON.stringify({
			schemaVersion: 99,
			revisions: [makeRevision("rev-1")],
		});
		await fakeVault.seedFile(FILE, written);
		expect(await store.readRevisions(project)).toEqual([]);
		expect(foreign).toEqual([[FILE, 99]]);
		expect(asides).toEqual([]);
		expect(fakeVault.contents.get(FILE)).toBe(written);
	});

	it("refuses to write over a schema it does not know", async () => {
		const written = JSON.stringify({
			schemaVersion: 99,
			revisions: [makeRevision("rev-1")],
		});
		await fakeVault.seedFile(FILE, written);
		expect(
			await store.updateRevisions(project, (standing) => [
				...standing,
				makeRevision("rev-2"),
			]),
		).toBe(false);
		expect(fakeVault.contents.get(FILE)).toBe(written);
		expect(
			[...fakeVault.contents.keys()].some((path) =>
				path.includes(".corrupted-"),
			),
		).toBe(false);
	});

	it("still sets aside a file that is damaged rather than merely newer", async () => {
		await fakeVault.seedFile(FILE, '{"schemaVersion": 1, "revisions": 7}');
		expect(await store.readRevisions(project)).toEqual([]);
		expect(asides).toHaveLength(1);
		expect(foreign).toEqual([]);
	});

	it("evicts a memo for a root let go", async () => {
		const revision = makeRevision("rev-1");
		await store.updateRevisions(project, () => [revision]);
		await store.readRevisions(project);
		store.evict(project.rootPath);
		// No behavioural probe is honest here beyond a clean re-read.
		expect(await store.readRevisions(project)).toEqual([revision]);
	});
});

describe("RevisionService", () => {
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let revisions: RevisionService;
	let fakeVault: FakeVault;

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await service.createProject({ title: "Novel", locale: "en" });
		revisions = service.revisions;
	});

	it("creates once per id and lists what stands", async () => {
		const revision = makeRevision("rev-1");
		expect(await revisions.create(project, revision)).toBe(true);
		expect(await revisions.create(project, revision)).toBe(false);
		expect(await revisions.list(project)).toEqual([revision]);
	});

	it("updates proposed text and comment, and nothing else", async () => {
		const revision = makeRevision("rev-1");
		await revisions.create(project, revision);
		expect(
			await revisions.update(project, "rev-1", {
				proposed: "white egret",
				comment: "closer",
			}),
		).toBe(true);
		const [kept] = await revisions.list(project);
		expect(kept).toMatchObject({
			proposed: "white egret",
			comment: "closer",
			originalText: "grey heron",
			from: 4,
			to: 14,
		});
		// Answered on whether the record now says what was asked, not on
		// whether a write was needed: re-typing a proposal into the same words
		// is a finished edit, and the card in the margin closes on this.
		expect(
			await revisions.update(project, "rev-1", {
				proposed: "white egret",
				comment: "closer",
			}),
		).toBe(true);
		expect(await revisions.update(project, "gone", { proposed: "x", comment: "" })).toBe(
			false,
		);
	});

	it("a deletion given words back becomes a replacement", async () => {
		await revisions.create(
			project,
			makeRevision("rev-1", { kind: "delete", proposed: "" }),
		);
		await revisions.update(project, "rev-1", {
			proposed: "a white egret",
			comment: "note",
		});
		const [kept] = await revisions.list(project);
		expect(kept).toMatchObject({
			kind: "replace",
			proposed: "a white egret",
			comment: "note",
		});
	});

	it("a replacement emptied becomes a deletion", async () => {
		await revisions.create(
			project,
			makeRevision("rev-1", { kind: "replace", proposed: "a white egret" }),
		);
		await revisions.update(project, "rev-1", { proposed: "", comment: "cut" });
		const [kept] = await revisions.list(project);
		expect(kept).toMatchObject({ kind: "delete", proposed: "", comment: "cut" });
	});

	it("an insertion stays an insertion whatever it proposes", async () => {
		await revisions.create(
			project,
			makeRevision("rev-1", {
				kind: "insert",
				from: 4,
				to: 4,
				originalText: "",
				proposed: "a heron",
			}),
		);
		await revisions.update(project, "rev-1", { proposed: "", comment: "" });
		const [kept] = await revisions.list(project);
		expect(kept).toMatchObject({ kind: "insert", proposed: "" });
	});

	it("removes for accept, reject and discard alike", async () => {
		await revisions.create(project, makeRevision("rev-1"));
		expect(await revisions.remove(project, "rev-1")).toBe(true);
		expect(await revisions.remove(project, "rev-1")).toBe(false);
		expect(await revisions.list(project)).toEqual([]);
	});

	it("brings stored offsets level with a saved body, once", async () => {
		await revisions.create(project, makeRevision("rev-1"));
		await revisions.create(
			project,
			makeRevision("rev-2", { path: "Snowflake Projects/Novel/50_Manuscript/Chapter 2.md" }),
		);
		const grown = `Early. ${BODY}`;
		expect(await revisions.refreshAnchorsOnSave(project, CHAPTER, grown)).toBe(true);
		const listed = await revisions.list(project);
		expect(listed.find((kept) => kept.id === "rev-1")).toMatchObject({
			from: 11,
			to: 21,
		});
		// The other note's revision is untouched by this note's save.
		expect(listed.find((kept) => kept.id === "rev-2")).toMatchObject({
			from: 4,
			to: 14,
		});
		expect(await revisions.refreshAnchorsOnSave(project, CHAPTER, grown)).toBe(false);
	});

	it("a save touching a note without revisions writes nothing", async () => {
		await revisions.create(project, makeRevision("rev-1"));
		const stamp = fakeVault.contents.get(FILE);
		expect(
			await revisions.refreshAnchorsOnSave(
				project,
				"Snowflake Projects/Novel/50_Manuscript/Chapter 9.md",
				"anything",
			),
		).toBe(false);
		expect(fakeVault.contents.get(FILE)).toBe(stamp);
	});
});

describe("RevisionService carry between notes", () => {
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	const OTHER = "Snowflake Projects/Novel/50_Manuscript/Chapter 2.md";

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await service.createProject({ title: "Novel", locale: "en" });
	});

	it("a split sends what stood below the cut after its words", async () => {
		await service.revisions.create(project, makeRevision("rev-1"));
		expect(
			await service.revisions.carryTextBetweenNotes(
				project,
				CHAPTER,
				OTHER,
				BODY,
				0,
				0,
			),
		).toBe(true);
		const [kept] = await service.revisions.list(project);
		expect(kept).toMatchObject({ path: OTHER, from: 4, to: 14 });
	});

	it("offsets move by the distance the text moved", async () => {
		await service.revisions.create(project, makeRevision("rev-1"));
		expect(
			await service.revisions.carryTextBetweenNotes(
				project,
				CHAPTER,
				OTHER,
				BODY,
				4,
				3,
			),
		).toBe(true);
		const [kept] = await service.revisions.list(project);
		expect(kept).toMatchObject({ path: OTHER, from: 1, to: 11 });
	});

	it("a merge carries forward, the offsets growing", async () => {
		await service.revisions.create(project, makeRevision("rev-1"));
		// The absorbed note's text now stands after the survivor's.
		expect(
			await service.revisions.carryTextBetweenNotes(
				project,
				CHAPTER,
				OTHER,
				BODY,
				0,
				-20,
			),
		).toBe(true);
		const [kept] = await service.revisions.list(project);
		expect(kept).toMatchObject({ path: OTHER, from: 24, to: 34 });
	});

	it("what stands above the departure point stays where it is", async () => {
		await service.revisions.create(project, makeRevision("rev-1"));
		// A revision at 4..14 with the cut at 30: its words did not travel.
		expect(
			await service.revisions.carryTextBetweenNotes(
				project,
				CHAPTER,
				OTHER,
				BODY,
				30,
				30,
			),
		).toBe(false);
		const [kept] = await service.revisions.list(project);
		expect(kept).toMatchObject({ path: CHAPTER, from: 4, to: 14 });
	});

	it("keeps its width when it lands at the head of the new note", async () => {
		// A seam that swallowed blank lines can send a revision past the start
		// of the note it arrives in. Clamped end by end it would come to rest
		// narrower than the text it remembers, and the store's own reader
		// drops an entry whose offsets stop agreeing with its original.
		await service.revisions.create(project, makeRevision("rev-1"));
		expect(
			await service.revisions.carryTextBetweenNotes(
				project,
				CHAPTER,
				OTHER,
				BODY,
				4,
				10,
			),
		).toBe(true);
		const [kept] = await service.revisions.list(project);
		expect(kept).toMatchObject({ path: OTHER, from: 0, to: 10 });
		// Which is to say it survived the read at all.
		expect(kept?.to ?? 0).toBe((kept?.from ?? 0) + "grey heron".length);
	});

	it("sorts the travellers by where their words stand, not by the store", async () => {
		// The levelling behind a save is a quiet errand, and a split does not
		// wait for it: an author who types a paragraph and cuts below it has a
		// store still describing the note as it was before the typing. Read
		// that way, a proposal whose words went into the new note is left
		// behind on the old one, pointing at whatever now stands there.
		const GROWN = `Some words typed above. ${BODY}`;
		await service.revisions.create(project, makeRevision("rev-1"));
		expect(
			await service.revisions.carryTextBetweenNotes(
				project,
				CHAPTER,
				OTHER,
				GROWN,
				20,
				20,
			),
		).toBe(true);
		const [kept] = await service.revisions.list(project);
		// 24 + 4 in the note it left, so 8 in the note it arrives in.
		expect(kept).toMatchObject({ path: OTHER, from: 8, to: 18 });
		expect(GROWN.slice(20).slice(8, 18)).toBe("grey heron");
	});

	it("leaves behind what the store thought had travelled", async () => {
		// The same mistrust the other way: offsets that overstate where a
		// revision stands would send it after text it is not part of.
		await service.revisions.create(
			project,
			makeRevision("rev-1", { from: 40, to: 50 }),
		);
		expect(
			await service.revisions.carryTextBetweenNotes(
				project,
				CHAPTER,
				OTHER,
				BODY,
				20,
				20,
			),
		).toBe(false);
		const [kept] = await service.revisions.list(project);
		expect(kept).toMatchObject({ path: CHAPTER });
	});

	it("carries a revision whose words are already gone, rather than stranding it", async () => {
		// A merge takes the whole of the absorbed note and then trashes it. A
		// proposal that cannot find its words there has only its stored
		// offsets to travel on, and travelling is still better than being left
		// on a note that is about to stop existing.
		await service.revisions.create(project, makeRevision("rev-1"));
		expect(
			await service.revisions.carryTextBetweenNotes(
				project,
				CHAPTER,
				OTHER,
				"Nothing of the sort stands here any more.",
				0,
				-20,
			),
		).toBe(true);
		const [kept] = await service.revisions.list(project);
		expect(kept).toMatchObject({ path: OTHER, from: 24, to: 34 });
	});

	it("a note that carried nothing leaves the file alone", async () => {
		await service.revisions.create(project, makeRevision("rev-1"));
		expect(
			await service.revisions.carryTextBetweenNotes(
				project,
				OTHER,
				CHAPTER,
				BODY,
				0,
				0,
			),
		).toBe(false);
	});
});

describe("RevisionService rename carry", () => {
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await service.createProject({ title: "Novel", locale: "en" });
	});

	it("carries a note's revisions to its new path, offsets untouched", async () => {
		await service.revisions.create(project, makeRevision("rev-1"));
		expect(
			await service.revisions.renameNotePaths(
				project,
				CHAPTER,
				"Snowflake Projects/Novel/50_Manuscript/Opening.md",
			),
		).toBe(true);
		const [kept] = await service.revisions.list(project);
		expect(kept).toMatchObject({
			path: "Snowflake Projects/Novel/50_Manuscript/Opening.md",
			from: 4,
			to: 14,
		});
	});

	it("carries a whole folder's revisions and leaves strangers alone", async () => {
		await service.revisions.create(project, makeRevision("rev-1"));
		expect(
			await service.revisions.renameNotePaths(
				project,
				"Snowflake Projects/Novel/50_Manuscript",
				"Snowflake Projects/Novel/50_Chapters",
			),
		).toBe(true);
		const [kept] = await service.revisions.list(project);
		expect(kept?.path).toBe(
			"Snowflake Projects/Novel/50_Chapters/Chapter 1.md",
		);
		expect(
			await service.revisions.renameNotePaths(
				project,
				"Snowflake Projects/Novel/40_Scene",
				"Snowflake Projects/Novel/40_Scenes",
			),
		).toBe(false);
	});
});
