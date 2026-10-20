import { beforeEach, describe, expect, it } from "vitest";

import { emptyImportProvenanceDocument, type ImportProvenanceEntry } from "../../src/domain";
import {
	IMPORT_STORE_SCHEMA_VERSION,
	ImportStore,
	SnowflakeProjectService,
	isImportFilePath,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const FILE = "Snowflake Projects/Novel/70_Tool/74_Import/imports.json";

const entry: ImportProvenanceEntry = {
	kind: "scene",
	targetId: "scene-copy",
	targetPath: "Snowflake Projects/Novel/40_Scene/Opening.md",
	targetName: "Opening",
	sourceProjectId: "project-elsewhere",
	sourceId: "scene-source",
	sourcePath: "Snowflake Projects/Other/40_Scene/Opening.md",
	sourceHash: "fp1-a",
	copyHash: "fp1-b",
	importedAt: 1234,
};

const fileOf = (fakeVault: FakeVault): Record<string, unknown> =>
	JSON.parse(fakeVault.contents.get(FILE) ?? "{}") as Record<string, unknown>;

describe("isImportFilePath", () => {
	it("knows the import file of either language, and nothing that merely shares its name", () => {
		expect(isImportFilePath(FILE)).toBe(true);
		expect(isImportFilePath("Snowflake Projects/Novel/70_工具/74_导入/imports.json")).toBe(true);
		expect(isImportFilePath("Snowflake Projects/Novel/74_Import/imports.json")).toBe(false);
		expect(isImportFilePath("Snowflake Projects/Novel/70_Tool/74_Import/imports.corrupted-1234.json")).toBe(false);
		expect(isImportFilePath("Snowflake Projects/Novel/70_Tool/73_Visualization/734_Beat_Sheet/imports.json")).toBe(false);
		expect(isImportFilePath("imports.json")).toBe(false);
	});
});

describe("ImportStore", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let store: ImportStore;
	let asides: string[];
	let foreign: [string, number][];

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		service = new SnowflakeProjectService(environment.vault, environment.fileManager, environment.metadataCache);
		project = await service.createProject({ title: "Novel", locale: "en" });
		asides = [];
		foreign = [];
		store = new ImportStore({
			repository: service.repository,
			now: () => 1234,
			onCorrupt: (path) => asides.push(path),
			onForeign: (path, version) => foreign.push([path, version]),
		});
	});

	it("stores under the import chain of the project's locale", () => {
		expect(store.importPath(project)).toBe(FILE);
		expect(store.importPath({ ...project, locale: "zh-CN" })).toBe("Snowflake Projects/Novel/70_工具/74_导入/imports.json");
	});

	it("reads the empty document where no file stands and creates the file on the first write", async () => {
		expect(await store.readDocument(project)).toEqual(emptyImportProvenanceDocument());
		expect(fakeVault.contents.has(FILE)).toBe(false);
		expect(await store.updateDocument(project, (held) => ({ ...held, entries: [entry] }))).toBe(true);
		const written = fakeVault.contents.get(FILE) ?? "";
		expect(written).toContain(`"schemaVersion": ${IMPORT_STORE_SCHEMA_VERSION}`);
		expect(written).toContain('"entries": [');
		expect(written).not.toContain("strays");
		expect((await store.readDocument(project)).entries).toEqual([entry]);
	});

	it("a mutate answering null leaves the file unwritten", async () => {
		expect(await store.updateDocument(project, () => null)).toBe(false);
		expect(fakeVault.contents.has(FILE)).toBe(false);
	});

	it("carries entries and choices it cannot read through every write", async () => {
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: IMPORT_STORE_SCHEMA_VERSION,
				entries: [entry, { kind: "later-kind" }],
				lastChoices: { "project-elsewhere": { parts: "all" } },
			}),
		);
		const held = await store.readDocument(project);
		expect(held.entries).toEqual([entry]);
		expect(held.strays).toEqual({ entries: [{ kind: "later-kind" }], choices: { "project-elsewhere": { parts: "all" } } });
		await store.updateDocument(project, (current) => ({
			...current,
			lastChoices: { "project-other": { parts: [], clashPolicy: "skip", at: 1 } },
		}));
		expect(fileOf(fakeVault)).toMatchObject({
			entries: [entry, { kind: "later-kind" }],
			lastChoices: { "project-elsewhere": { parts: "all" }, "project-other": { parts: [], clashPolicy: "skip", at: 1 } },
		});
	});

	it("sets a file it cannot read aside and starts again", async () => {
		await fakeVault.seedFile(FILE, "{not json");
		expect(await store.readDocument(project)).toEqual(emptyImportProvenanceDocument());
		expect(asides).toHaveLength(1);
		expect(asides[0]).toMatch(/imports\.corrupted-\d+\.json$/);
	});

	it("leaves a file of a schema it does not know alone", async () => {
		const later = JSON.stringify({ schemaVersion: IMPORT_STORE_SCHEMA_VERSION + 1, entries: [entry] });
		await fakeVault.seedFile(FILE, later);
		expect(await store.readDocument(project)).toEqual(emptyImportProvenanceDocument());
		expect(foreign).toEqual([[FILE, IMPORT_STORE_SCHEMA_VERSION + 1]]);
		expect(await store.updateDocument(project, (held) => ({ ...held, entries: [entry] }))).toBe(false);
		expect(fakeVault.contents.get(FILE)).toBe(later);
	});

	it("forgets a project's memo on evict and reads the file afresh", async () => {
		await store.updateDocument(project, (held) => ({ ...held, entries: [entry] }));
		fakeVault.write(FILE, JSON.stringify({ schemaVersion: IMPORT_STORE_SCHEMA_VERSION, entries: [], lastChoices: {} }));
		store.evict(project.rootPath);
		expect((await store.readDocument(project)).entries).toEqual([]);
	});
});
