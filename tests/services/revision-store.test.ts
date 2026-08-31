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
		store = new RevisionStore({
			repository: service.repository,
			now: () => 1234,
			onCorrupt: (path) => asides.push(path),
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

	it("refuses a schema it does not write, preserving it aside on the next change", async () => {
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({ schemaVersion: 99, revisions: [makeRevision("rev-1")] }),
		);
		expect(await store.readRevisions(project)).toEqual([]);
		const revision = makeRevision("rev-2");
		expect(
			await store.updateRevisions(project, (standing) => [
				...standing,
				revision,
			]),
		).toBe(true);
		expect(
			[...fakeVault.contents.keys()].some((path) =>
				path.includes(".corrupted-1234"),
			),
		).toBe(true);
		expect(await store.readRevisions(project)).toEqual([revision]);
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
		expect(
			await revisions.update(project, "rev-1", {
				proposed: "white egret",
				comment: "closer",
			}),
		).toBe(false);
		expect(await revisions.update(project, "gone", { proposed: "x", comment: "" })).toBe(
			false,
		);
	});

	it("a deletion's proposed text stays empty through an edit", async () => {
		const revision = makeRevision("rev-1", {
			kind: "delete",
			proposed: "",
		});
		await revisions.create(project, revision);
		await revisions.update(project, "rev-1", {
			proposed: "smuggled",
			comment: "note",
		});
		const [kept] = await revisions.list(project);
		expect(kept).toMatchObject({ kind: "delete", proposed: "", comment: "note" });
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
