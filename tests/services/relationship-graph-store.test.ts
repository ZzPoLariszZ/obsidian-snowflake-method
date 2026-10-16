import { beforeEach, describe, expect, it } from "vitest";

import { defaultEntityGraphState, type NativeGraphOptions } from "../../src/domain";
import {
	RELATIONSHIP_GRAPH_STORE_SCHEMA_VERSION,
	RelationshipGraphService,
	RelationshipGraphStore,
	SnowflakeProjectService,
	isRelationshipGraphFilePath,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const FILE =
	"Snowflake Projects/Novel/70_Tool/73_Visualization/735_Relationship_Graph/relationship-graph.json";

const OPTIONS: NativeGraphOptions = {
	search: '(path:"Snowflake Projects/Novel/40_Scene" OR path:"Snowflake Projects/Novel/50_Manuscript")',
	showTags: false,
	showAttachments: false,
	hideUnresolved: true,
	showOrphans: true,
	colorGroups: [],
	showArrow: true,
	textFadeMultiplier: 0,
	nodeSizeMultiplier: 1,
	lineSizeMultiplier: 1,
	centerStrength: 0.5,
	repelStrength: 10,
	linkStrength: 1,
	linkDistance: 250,
};

const fileOf = (fakeVault: FakeVault): Record<string, unknown> =>
	JSON.parse(fakeVault.contents.get(FILE) ?? "{}") as Record<string, unknown>;

describe("isRelationshipGraphFilePath", () => {
	it("knows the relationship graph file of either language, and nothing that merely shares its name", () => {
		expect(isRelationshipGraphFilePath(FILE)).toBe(true);
		expect(
			isRelationshipGraphFilePath(
				"Snowflake Projects/Novel/70_工具/73_可视化/735_关系图/relationship-graph.json",
			),
		).toBe(true);
		expect(
			isRelationshipGraphFilePath("Snowflake Projects/Novel/735_Relationship_Graph/relationship-graph.json"),
		).toBe(false);
		expect(
			isRelationshipGraphFilePath(
				"Snowflake Projects/Novel/70_Tool/73_Visualization/735_Relationship_Graph/relationship-graph.corrupted-1234.json",
			),
		).toBe(false);
		// The beat sheet's folder is the beat sheet's, whatever a file in it is called.
		expect(
			isRelationshipGraphFilePath(
				"Snowflake Projects/Novel/70_Tool/73_Visualization/734_Beat_Sheet/relationship-graph.json",
			),
		).toBe(false);
		expect(isRelationshipGraphFilePath("relationship-graph.json")).toBe(false);
	});
});

describe("RelationshipGraphStore", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let store: RelationshipGraphStore;
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
		store = new RelationshipGraphStore({
			repository: service.repository,
			now: () => 1234,
			onCorrupt: (path) => asides.push(path),
			onForeign: (path, version) => foreign.push([path, version]),
		});
	});

	it("reads the default document where no file stands, in either language, and creates the file on the first write", async () => {
		const fresh = { sceneManuscript: null, entities: defaultEntityGraphState(), strays: {} };
		expect(await store.readDocument(project)).toEqual(fresh);
		expect(await store.readDocument({ ...project, locale: "zh-CN" })).toEqual(fresh);
		expect(fakeVault.contents.has(FILE)).toBe(false);
		expect(
			await store.updateDocument(project, (held) => ({
				...held,
				sceneManuscript: { options: OPTIONS, rootPath: project.rootPath, updatedAt: 1234 },
			})),
		).toBe(true);
		const written = fakeVault.contents.get(FILE) ?? "";
		expect(written).toContain('"schemaVersion": 1');
		expect(written).toContain('"sceneManuscript": {');
		expect(written).toContain('"entities": {');
		expect(written).not.toContain("strays");
		expect((await store.readDocument(project)).sceneManuscript?.rootPath).toBe(project.rootPath);
	});

	it("stores under the visualization chain of the project's locale", () => {
		expect(store.relationshipGraphPath(project)).toBe(FILE);
		expect(store.relationshipGraphPath({ ...project, locale: "zh-CN" })).toBe(
			"Snowflake Projects/Novel/70_工具/73_可视化/735_关系图/relationship-graph.json",
		);
	});

	it("a mutate answering null leaves the file unwritten", async () => {
		expect(await store.updateDocument(project, () => null)).toBe(false);
		expect(fakeVault.contents.has(FILE)).toBe(false);
	});

	it("carries the keys it does not know through every write", async () => {
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: RELATIONSHIP_GRAPH_STORE_SCHEMA_VERSION,
				sceneManuscript: null,
				entities: { display: { arrows: false } },
				laterKey: { kept: true },
			}),
		);
		const held = await store.readDocument(project);
		expect(held.entities.display.arrows).toBe(false);
		expect(held.strays).toEqual({ laterKey: { kept: true } });
		await store.updateDocument(project, (current) => ({
			...current,
			entities: { ...current.entities, display: { ...current.entities.display, arrows: true } },
		}));
		expect(fileOf(fakeVault)).toMatchObject({ laterKey: { kept: true } });
		expect((await store.readDocument(project)).entities.display.arrows).toBe(true);
	});

	it("sets a file it cannot read aside and starts again", async () => {
		await fakeVault.seedFile(FILE, "{not json");
		expect(await store.readDocument(project)).toEqual({
			sceneManuscript: null,
			entities: defaultEntityGraphState(),
			strays: {},
		});
		expect(asides).toHaveLength(1);
		expect(asides[0]).toMatch(/relationship-graph\.corrupted-\d+\.json$/);
		expect(fakeVault.contents.has(FILE)).toBe(false);
	});

	it("leaves a file written to a newer schema exactly as it is, and refuses to write over it", async () => {
		const content = JSON.stringify({ schemaVersion: 7, sceneManuscript: null, entities: {}, later: true });
		await fakeVault.seedFile(FILE, content);
		expect(await store.readDocument(project)).toEqual({
			sceneManuscript: null,
			entities: defaultEntityGraphState(),
			strays: {},
		});
		expect(foreign).toEqual([[FILE, 7]]);
		expect(await store.updateDocument(project, (held) => ({ ...held, sceneManuscript: null }))).toBe(false);
		expect(fakeVault.contents.get(FILE)).toBe(content);
		expect(asides).toEqual([]);
	});
});

describe("RelationshipGraphService", () => {
	let fakeVault: FakeVault;
	let project: ProjectSnapshot;
	let graphs: RelationshipGraphService;
	let now: number;

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		const service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await service.createProject({ title: "Novel", locale: "en" });
		now = 1000;
		graphs = new RelationshipGraphService(service.repository, { now: () => now });
	});

	it("remembers the native options for the project's root, once per change", async () => {
		expect(await graphs.saveSceneManuscriptOptions(project, OPTIONS)).toBe("written");
		expect((await graphs.read(project)).sceneManuscript).toEqual({
			options: OPTIONS,
			rootPath: project.rootPath,
			updatedAt: 1000,
		});
		const written = fakeVault.contents.get(FILE);
		now = 2000;
		expect(await graphs.saveSceneManuscriptOptions(project, OPTIONS)).toBe("written");
		expect(fakeVault.contents.get(FILE)).toBe(written);
		expect(await graphs.saveSceneManuscriptOptions(project, { ...OPTIONS, linkDistance: 100 })).toBe("written");
		expect((await graphs.read(project)).sceneManuscript).toMatchObject({
			options: { linkDistance: 100 },
			updatedAt: 2000,
		});
	});

	it("forgets the native options, and writes nothing when there are none to forget", async () => {
		expect(await graphs.clearSceneManuscriptOptions(project)).toBe("written");
		expect(fakeVault.contents.has(FILE)).toBe(false);
		await graphs.saveSceneManuscriptOptions(project, OPTIONS);
		expect(await graphs.clearSceneManuscriptOptions(project)).toBe("written");
		expect((await graphs.read(project)).sceneManuscript).toBeNull();
	});

	it("patches the entity view a part at a time and keeps the rest", async () => {
		const base = defaultEntityGraphState();
		expect(await graphs.updateEntities(project, { display: { ...base.display, arrows: false } })).toBe("written");
		expect(await graphs.updateEntities(project, { viewport: { x: 3, y: 4, k: 2 } })).toBe("written");
		const held = await graphs.read(project);
		expect(held.entities.display.arrows).toBe(false);
		expect(held.entities.viewport).toEqual({ x: 3, y: 4, k: 2 });
		expect(held.entities.filters).toEqual(base.filters);
		const written = fakeVault.contents.get(FILE);
		expect(await graphs.updateEntities(project, { viewport: { x: 3, y: 4, k: 2 } })).toBe("written");
		expect(fakeVault.contents.get(FILE)).toBe(written);
	});

	it("refuses every write over a file written to a newer schema", async () => {
		await fakeVault.seedFile(FILE, JSON.stringify({ schemaVersion: 9 }));
		expect(await graphs.saveSceneManuscriptOptions(project, OPTIONS)).toBe("refused");
		expect(await graphs.clearSceneManuscriptOptions(project)).toBe("refused");
		expect(await graphs.updateEntities(project, { viewport: null })).toBe("refused");
	});

	it("is attached to the project service beside the timeline's", async () => {
		const environment = createFakeEnvironment();
		const service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		const made = await service.createProject({ title: "Novel", locale: "en" });
		expect(service.relationshipGraph.relationshipGraphPath(made)).toBe(FILE);
	});
});
