import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_STICKY_NOTE_COLOR, FRONTMATTER_KEYS, SCHEMA_VERSION } from "../../src/domain";
import {
	ConcurrentChangeError,
	parseMarkdownFrontmatter,
} from "../../src/repository";
import {
	SnowflakeProjectService,
	isStickyNotePath,
	type ProjectSnapshot,
	type StickyNoteRecord,
} from "../../src/services";
import {
	createFakeEnvironment,
	type FakeFileManager,
	type FakeVault,
} from "../helpers/fake-vault";

const FOLDER =
	"Snowflake Projects/Novel/70_Tool/72_Task_Management/724_Sticky_Note";
const INSTANT = new Date(Date.UTC(2026, 8, 4, 5, 14, 32, 123));
const LATER = new Date(INSTANT.getTime() + 60_000);
const PATH = `${FOLDER}/20260904T061432.123+0100.md`;

describe("StickyNoteService", () => {
	let fakeVault: FakeVault;
	let fakeFileManager: FakeFileManager;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;

	const sticky = (): SnowflakeProjectService["stickyNotes"] => service.stickyNotes;
	const create = (now: Date = INSTANT): Promise<StickyNoteRecord> =>
		sticky().create(project, undefined, now, -60);
	const frontmatterOf = (path: string): Record<string, unknown> =>
		parseMarkdownFrontmatter(fakeVault.contents.get(path) ?? "").frontmatter;
	// The fake file manager speaks JSON between the fences, which the real
	// YAML reader reads just as well.
	const seed = async (
		path: string,
		frontmatter: Record<string, unknown>,
		body: string,
	): Promise<void> => {
		await fakeVault.create(path, `---\n${JSON.stringify(frontmatter)}\n---\n${body}`);
	};

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		fakeFileManager = environment.fakeFileManager;
		service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await service.createProject({ title: "Novel", locale: "en" });
	});

	it("keeps its notes in the task-management chain of either language", async () => {
		expect(sticky().folderOf(project)).toBe(FOLDER);
		const zh = await service.createProject({ title: "小说", locale: "zh-CN" });
		expect(sticky().folderOf(zh)).toBe(`${zh.rootPath}/70_工具/72_任务管理/724_便签`);
	});

	it("tells a sticky note's path from any other by the whole chain", () => {
		expect(isStickyNotePath(PATH)).toBe(true);
		expect(isStickyNotePath("Novel/70_工具/72_任务管理/724_便签/x.md")).toBe(true);
		expect(isStickyNotePath("Novel/50_Manuscript/724_Sticky_Note/x.md")).toBe(false);
		expect(isStickyNotePath("Elsewhere/724_Sticky_Note/x.md")).toBe(false);
		expect(isStickyNotePath(FOLDER)).toBe(false);
		expect(isStickyNotePath(`${FOLDER}/deeper/x.md`)).toBe(false);
	});

	it("writes a new note named for its moment, with its keys in order and nothing below them", async () => {
		const note = await create();

		expect(note.path).toBe(PATH);
		expect(note.id.startsWith("sticky-note-")).toBe(true);
		expect(note.color).toBe("macaron-3");
		expect(note.createdAt).toBe(INSTANT.getTime());
		expect(note.archived).toBe(false);
		expect(note.body).toBe("");
		expect(note.readOnly).toBe(false);
		expect(note.revision.length).toBeGreaterThan(0);
		expect(note.stamp).toMatch(/^\d+:\d+$/u);
		const frontmatter = frontmatterOf(PATH);
		expect(Object.keys(frontmatter)).toEqual([
			FRONTMATTER_KEYS.schema,
			FRONTMATTER_KEYS.document,
			FRONTMATTER_KEYS.projectId,
			FRONTMATTER_KEYS.stickyNoteId,
			FRONTMATTER_KEYS.stickyNoteColor,
			FRONTMATTER_KEYS.created,
			FRONTMATTER_KEYS.archived,
		]);
		expect(frontmatter[FRONTMATTER_KEYS.document]).toBe("sticky-note");
		expect(frontmatter[FRONTMATTER_KEYS.projectId]).toBe(project.id);
		expect(frontmatter[FRONTMATTER_KEYS.stickyNoteId]).toBe(note.id);
		expect(frontmatter[FRONTMATTER_KEYS.created]).toBe("2026-09-04T06:14:32.123+01:00");
		expect(frontmatter[FRONTMATTER_KEYS.archived]).toBe(false);
		expect(parseMarkdownFrontmatter(fakeVault.contents.get(PATH) ?? "").body).toBe("");
	});

	it("numbers a second note born in the same millisecond, and makes the folder on the way", async () => {
		fakeVault.delete(FOLDER);
		const first = await create();
		const second = await create();

		expect(first.path).toBe(PATH);
		expect(second.path).toBe(`${FOLDER}/20260904T061432.123+0100 (2).md`);
		expect(second.id).not.toBe(first.id);
		expect(fakeVault.getAbstractFileByPath(FOLDER)).not.toBeNull();
	});

	it("lists only the sticky notes, in path order, past a stranger and a broken note", async () => {
		const later = await create(LATER);
		const earlier = await create();
		await seed(`${FOLDER}/aaa-stranger.md`, { "snowflake-document": "character" }, "hello");
		await fakeVault.create(`${FOLDER}/aab-broken.md`, "---\nsnowflake-document: [unclosed\n---\nhello");
		await fakeVault.create(`${FOLDER}/aac-notes.txt`, "not a note");

		const listed = await sticky().list(project);

		expect(listed.map((note) => note.path)).toEqual([earlier.path, later.path]);
	});

	it("reads an unchanged folder again without opening a file", async () => {
		await create();
		await create(LATER);
		await sticky().list(project);
		const reads = fakeVault.readCalls.length;

		const again = await sticky().list(project);

		expect(again).toHaveLength(2);
		expect(fakeVault.readCalls).toHaveLength(reads);
	});

	it("sees a hand edit in a fresh stamp and revision", async () => {
		const note = await create();
		fakeVault.contents.set(PATH, `${fakeVault.contents.get(PATH) ?? ""}typed by hand`);

		const seen = await sticky().read(PATH);

		expect(seen?.body).toBe("typed by hand");
		expect(seen?.stamp).not.toBe(note.stamp);
		expect(seen?.revision).not.toBe(note.revision);
		expect(sticky().stamp(PATH)).toBe(seen?.stamp);
		expect(sticky().stamp(`${FOLDER}/missing.md`)).toBeNull();
	});

	it("writes the body under a matching revision and keeps the frontmatter to the byte", async () => {
		const note = await create();
		const before = fakeVault.contents.get(PATH) ?? "";

		const written = await sticky().writeBody(PATH, "Remember the heron.\n", note.revision);

		expect(written.body).toBe("Remember the heron.\n");
		expect(written.revision).not.toBe(note.revision);
		expect(fakeVault.contents.get(PATH)).toBe(`${before}Remember the heron.\n`);
	});

	it("refuses a body whose revision the file has moved past, writing nothing", async () => {
		const note = await create();
		await sticky().writeBody(PATH, "first", note.revision);
		const held = fakeVault.contents.get(PATH);

		await expect(sticky().writeBody(PATH, "second", note.revision)).rejects.toBeInstanceOf(
			ConcurrentChangeError,
		);
		expect(fakeVault.contents.get(PATH)).toBe(held);
	});

	it("patches the colour and the flag, settling a hand-scrambled note into order", async () => {
		const path = `${FOLDER}/scrambled.md`;
		await seed(
			path,
			{
				"snowflake-schema": 1,
				"snowflake-sticky-note-id": "sticky-note-s",
				"snowflake-archived": false,
				"snowflake-document": "sticky-note",
				"snowflake-project-id": project.id,
				"snowflake-created": "2026-09-04T06:14:32.123+01:00",
				"snowflake-sticky-note-color": "macaron-2",
			},
			"body",
		);

		await sticky().setColor(path, "macaron-7");
		expect(Object.keys(frontmatterOf(path))).toEqual([
			FRONTMATTER_KEYS.schema,
			FRONTMATTER_KEYS.document,
			FRONTMATTER_KEYS.projectId,
			FRONTMATTER_KEYS.stickyNoteId,
			FRONTMATTER_KEYS.stickyNoteColor,
			FRONTMATTER_KEYS.created,
			FRONTMATTER_KEYS.archived,
		]);
		expect((await sticky().read(path))?.color).toBe("macaron-7");

		await sticky().setArchived(path, true);
		expect((await sticky().read(path))?.archived).toBe(true);
		await sticky().setArchived(path, false);
		expect(frontmatterOf(path)[FRONTMATTER_KEYS.archived]).toBe(false);
		expect((await sticky().read(path))?.archived).toBe(false);
		expect((await sticky().read(path))?.body).toBe("body");
	});

	it("trashes a note through the file manager", async () => {
		await create();

		await sticky().trash(PATH);

		expect(fakeFileManager.trashCalls).toContain(PATH);
		expect(fakeVault.contents.has(PATH)).toBe(false);
		expect(await sticky().read(PATH)).toBeNull();
	});

	it("dates a note without a stamp by its file's birth", async () => {
		const path = `${FOLDER}/undated.md`;
		await seed(
			path,
			{ "snowflake-document": "sticky-note", "snowflake-sticky-note-id": "sticky-note-u" },
			"",
		);
		const file = fakeVault.getFileByPath(path);
		expect(file).not.toBeNull();
		if (file !== null) file.stat.ctime = 1234;

		const note = await sticky().read(path);

		expect(note?.createdAt).toBe(1234);
		expect(note?.color).toBe("macaron-3");
	});

	it("is inspected by the health report like a member, and repaired without touching the body", async () => {
		const note = await create();
		await sticky().writeBody(note.path, "Keep me", note.revision);
		// A note of the author's own in the folder says nothing of the kind and is left alone.
		await seed(`${FOLDER}/mine.md`, { title: "mine" }, "Not a sticky note");
		const healthy = await service.loadProject(project.projectFile);
		expect(
			healthy.structureIssues.filter((issue) => issue.expected === "sticky-note"),
		).toEqual([]);

		await fakeFileManager.processFrontMatter(
			fakeVault.getFileByPath(note.path)!,
			(frontmatter) => {
				delete frontmatter[FRONTMATTER_KEYS.schema];
				delete frontmatter[FRONTMATTER_KEYS.stickyNoteId];
				frontmatter[FRONTMATTER_KEYS.stickyNoteColor] = "neon";
				frontmatter[FRONTMATTER_KEYS.created] = "yesterday";
				frontmatter[FRONTMATTER_KEYS.archived] = "true";
			},
		);
		const damaged = await service.loadProject(project.projectFile);
		expect(damaged.structureIssues).toContainEqual(
			expect.objectContaining({
				code: "invalid-artifact-metadata",
				path: note.path,
				expected: "sticky-note",
				stepIds: [],
				repairable: true,
			}),
		);

		const repaired = await service.repairMissingStructureItem(project.projectFile, note.path);
		const after = parseMarkdownFrontmatter(fakeVault.contents.get(note.path) ?? "");
		expect(after.body.trim()).toBe("Keep me");
		expect(after.frontmatter[FRONTMATTER_KEYS.schema]).toBe(SCHEMA_VERSION);
		expect(after.frontmatter[FRONTMATTER_KEYS.document]).toBe("sticky-note");
		expect(after.frontmatter[FRONTMATTER_KEYS.projectId]).toBe(project.id);
		expect(String(after.frontmatter[FRONTMATTER_KEYS.stickyNoteId])).toMatch(/^sticky-note-/);
		expect(after.frontmatter[FRONTMATTER_KEYS.stickyNoteColor]).toBe(DEFAULT_STICKY_NOTE_COLOR);
		expect(typeof after.frontmatter[FRONTMATTER_KEYS.created]).toBe("string");
		expect(after.frontmatter[FRONTMATTER_KEYS.archived]).toBe(true);
		expect(Object.keys(after.frontmatter)).toEqual([
			FRONTMATTER_KEYS.schema,
			FRONTMATTER_KEYS.document,
			FRONTMATTER_KEYS.projectId,
			FRONTMATTER_KEYS.stickyNoteId,
			FRONTMATTER_KEYS.stickyNoteColor,
			FRONTMATTER_KEYS.created,
			FRONTMATTER_KEYS.archived,
		]);
		expect(repaired.structureIssues).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ path: note.path })]),
		);
		const listed = await sticky().list(project);
		expect(listed.map((entry) => entry.path)).toEqual([note.path]);
		expect(listed[0]?.archived).toBe(true);
	});

	it("reports the later of two notes sharing an id and gives it one of its own", async () => {
		const first = await create();
		const second = await create(LATER);
		await fakeFileManager.processFrontMatter(
			fakeVault.getFileByPath(second.path)!,
			(frontmatter) => {
				frontmatter[FRONTMATTER_KEYS.stickyNoteId] = first.id;
			},
		);
		const damaged = await service.loadProject(project.projectFile);
		const flagged = damaged.structureIssues.filter((issue) => issue.expected === "sticky-note");
		expect(flagged.map((issue) => issue.path)).toEqual([second.path]);

		await service.repairMissingStructureItem(project.projectFile, second.path);
		const ids = (await sticky().list(project)).map((entry) => entry.id);
		expect(new Set(ids).size).toBe(2);
		expect(ids).toContain(first.id);
	});
});
