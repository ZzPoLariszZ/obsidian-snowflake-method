import { beforeEach, describe, expect, it } from "vitest";

import { builtInBeatSheetTemplate, findBeat, type BeatSheet } from "../../src/domain";
import {
	BEAT_SHEET_STORE_SCHEMA_VERSION,
	BeatSheetService,
	BeatSheetStore,
	SnowflakeProjectService,
	isBeatSheetFilePath,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const FILE =
	"Snowflake Projects/Novel/70_Tool/73_Visualization/734_Beat_Sheet/beat-sheet.json";

const makeSheet = (id: string, overrides: Partial<BeatSheet> = {}): BeatSheet => ({
	id,
	name: `Sheet ${id}`,
	acts: [],
	presentation: null,
	showSubDescriptions: true,
	createdAt: 7,
	updatedAt: 7,
	...overrides,
});

const fileOf = (fakeVault: FakeVault): Record<string, unknown> =>
	JSON.parse(fakeVault.contents.get(FILE) ?? "{}") as Record<string, unknown>;

describe("isBeatSheetFilePath", () => {
	it("knows the beat sheet file of either language, and nothing that merely shares its name", () => {
		expect(isBeatSheetFilePath(FILE)).toBe(true);
		expect(
			isBeatSheetFilePath("Snowflake Projects/Novel/70_工具/73_可视化/734_节拍表/beat-sheet.json"),
		).toBe(true);
		expect(isBeatSheetFilePath("Snowflake Projects/Novel/734_Beat_Sheet/beat-sheet.json")).toBe(false);
		expect(
			isBeatSheetFilePath(
				"Snowflake Projects/Novel/70_Tool/73_Visualization/734_Beat_Sheet/beat-sheet.corrupted-1234.json",
			),
		).toBe(false);
		// The timeline's folder is the timeline's, whatever a file in it is called.
		expect(
			isBeatSheetFilePath("Snowflake Projects/Novel/70_Tool/73_Visualization/733_Timeline/beat-sheet.json"),
		).toBe(false);
		expect(isBeatSheetFilePath("beat-sheet.json")).toBe(false);
	});
});

describe("BeatSheetStore", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let store: BeatSheetStore;
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
		store = new BeatSheetStore({
			repository: service.repository,
			now: () => 1234,
			onCorrupt: (path) => asides.push(path),
			onForeign: (path, version) => foreign.push([path, version]),
		});
	});

	it("reads no sheet at all where no file stands, in either language, and creates the file on the first write", async () => {
		const fresh = { sheets: [], templates: [], lastSheetId: null, strays: { sheets: [], templates: [] } };
		expect(await store.readDocument(project)).toEqual(fresh);
		expect(await store.readDocument({ ...project, locale: "zh-CN" })).toEqual(fresh);
		expect(fakeVault.contents.has(FILE)).toBe(false);
		const sheet = makeSheet("sheet-1");
		expect(
			await store.updateDocument(project, (held) => ({ ...held, sheets: [sheet], lastSheetId: "sheet-1" })),
		).toBe(true);
		const written = fakeVault.contents.get(FILE) ?? "";
		expect(written).toContain('"schemaVersion": 1');
		expect(written).toContain('"sheets": [');
		expect(written).toContain('"templates": []');
		expect(written).toContain('"lastSheetId": "sheet-1"');
		// What the store could not read is carried in place, never under a key of its own.
		expect(written).not.toContain("strays");
		expect(await store.readDocument(project)).toMatchObject({ sheets: [sheet], lastSheetId: "sheet-1" });
	});

	it("stores under the visualization chain of the project's locale", () => {
		expect(store.beatSheetPath(project)).toBe(FILE);
		expect(store.beatSheetPath({ ...project, locale: "zh-CN" })).toBe(
			"Snowflake Projects/Novel/70_工具/73_可视化/734_节拍表/beat-sheet.json",
		);
	});

	it("a mutate answering null leaves the file unwritten", async () => {
		expect(await store.updateDocument(project, () => null)).toBe(false);
		expect(fakeVault.contents.has(FILE)).toBe(false);
	});

	it("carries the entries it cannot read through every write, after the ones it can", async () => {
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({
				schemaVersion: BEAT_SHEET_STORE_SCHEMA_VERSION,
				sheets: [{ name: "nameless" }, makeSheet("sheet-1")],
				templates: [{ id: "template-1", name: "Mine", acts: [] }, { id: 7 }],
				lastSheetId: null,
			}),
		);
		const held = await store.readDocument(project);
		expect(held.sheets.map((sheet) => sheet.id)).toEqual(["sheet-1"]);
		expect(held.templates.map((template) => template.id)).toEqual(["template-1"]);
		expect(held.strays).toEqual({ sheets: [{ name: "nameless" }], templates: [{ id: 7 }] });
		await store.updateDocument(project, (current) => ({
			...current,
			sheets: [...current.sheets, makeSheet("sheet-2")],
		}));
		const file = fileOf(fakeVault);
		expect((file.sheets as unknown[]).map((entry) => (entry as { id?: string }).id)).toEqual([
			"sheet-1",
			"sheet-2",
			undefined,
		]);
		expect((file.templates as unknown[]).map((entry) => (entry as { id?: unknown }).id)).toEqual(["template-1", 7]);
	});

	it("leaves a file written to a newer schema as it stands, refusing to write over it", async () => {
		const content = JSON.stringify({ schemaVersion: BEAT_SHEET_STORE_SCHEMA_VERSION + 1, boards: [] });
		await fakeVault.seedFile(FILE, content);
		expect((await store.readDocument(project)).sheets).toEqual([]);
		await store.readDocument(project);
		expect(foreign).toEqual([[FILE, 2]]);
		expect(
			await store.updateDocument(project, (held) => ({ ...held, sheets: [makeSheet("sheet-1")] })),
		).toBe(false);
		expect(fakeVault.contents.get(FILE)).toBe(content);
		expect(foreign).toHaveLength(2);
		expect(asides).toEqual([]);
	});

	it("sets a damaged file aside, and one with no templates at all likewise", async () => {
		await fakeVault.seedFile(FILE, '{"schemaVersion": 1, "sheets": 7, "templates": []}');
		expect((await store.readDocument(project)).sheets).toEqual([]);
		expect(asides).toEqual([FILE.replace(/\.json$/u, ".corrupted-1234.json")]);
		expect(foreign).toEqual([]);
	});

	it("keeps its memo through a refused write and a write that changed nothing", async () => {
		await store.updateDocument(project, (held) => ({ ...held, sheets: [makeSheet("sheet-1")] }));
		await store.readDocument(project);
		const reads = fakeVault.readCalls.filter((path) => path === FILE).length;
		expect(await store.updateDocument(project, () => null)).toBe(false);
		await store.readDocument(project);
		expect(fakeVault.readCalls.filter((path) => path === FILE)).toHaveLength(reads + 1);
	});
});

describe("BeatSheetService", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let sheets: BeatSheetService;
	let clock: number;
	let serial: number;

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
		serial = 0;
		sheets = new BeatSheetService(service.repository, {
			now: () => clock,
			mintId: (prefix) => `${prefix}-${String(++serial)}`,
		});
	});

	const threeAct = () => ({ structure: builtInBeatSheetTemplate("en", "three-act").structure });

	it("makes a sheet from a structure with ids of its own under every prefix, and opens on it", async () => {
		const id = await sheets.createSheet(project, { name: "Draft one", source: threeAct() });
		expect(id).toBe("beat-sheet-1");
		const held = await sheets.read(project);
		expect(held.lastSheetId).toBe("beat-sheet-1");
		const sheet = held.sheets[0]!;
		expect(sheet).toMatchObject({ id: "beat-sheet-1", name: "Draft one", createdAt: 100, updatedAt: 100 });
		expect(sheet.acts.map((act) => act.label)).toEqual(["Setup", "Confrontation", "Resolution"]);
		expect(sheet.acts.every((act) => act.id.startsWith("beat-sheet-act-"))).toBe(true);
		expect(sheet.acts.flatMap((act) => act.beats).every((beat) => /^beat-\d+$/u.test(beat.id))).toBe(true);
		const ids = [sheet.id, ...sheet.acts.flatMap((act) => [act.id, ...act.beats.map((beat) => beat.id)])];
		expect(new Set(ids).size).toBe(1 + 3 + 10);
		const beatId = sheet.acts[0]!.beats[0]!.id;
		expect(await sheets.addRow(project, id!, beatId, "Arrives", null)).toMatch(/^beat-sheet-row-\d+$/u);
		expect(await sheets.addAct(project, id!, "Coda", null)).toMatch(/^beat-sheet-act-\d+$/u);
	});

	it("starts a Blank sheet on no act, and lets the last act go", async () => {
		const id = (await sheets.createSheet(project, { name: "Empty", source: { structure: { acts: [] } } }))!;
		expect((await sheets.read(project)).sheets[0]?.acts).toEqual([]);
		const actId = (await sheets.addAct(project, id, "", null))!;
		expect(await sheets.deleteAct(project, id, actId)).toBe("written");
		expect((await sheets.read(project)).sheets[0]?.acts).toEqual([]);
	});

	it("answers written, absent or refused, and writes once per change", async () => {
		const id = (await sheets.createSheet(project, { name: "Draft", source: threeAct() }))!;
		const before = fakeVault.processCalls.filter((path) => path === FILE).length;
		clock = 200;
		expect(await sheets.renameSheet(project, id, "Story")).toBe("written");
		expect(await sheets.renameSheet(project, id, "Story")).toBe("written");
		expect(await sheets.renameSheet(project, "beat-sheet-9", "Story")).toBe("absent");
		expect(fakeVault.processCalls.filter((path) => path === FILE)).toHaveLength(before + 3);
		expect((await sheets.read(project)).sheets[0]).toMatchObject({ name: "Story", updatedAt: 200 });
		fakeVault.contents.set(FILE, JSON.stringify({ schemaVersion: 99 }));
		expect(await sheets.renameSheet(project, id, "Newer")).toBe("refused");
		expect(await sheets.deleteSheet(project, id)).toBe("refused");
		expect(await sheets.createSheet(project, { name: "x", source: threeAct() })).toBeNull();
		expect(await sheets.addAct(project, id, "", null)).toBeNull();
	});

	it("says absent for what a change names and the file no longer has, and written for a removal already made", async () => {
		const id = (await sheets.createSheet(project, { name: "Draft", source: threeAct() }))!;
		const sheet = (await sheets.read(project)).sheets[0]!;
		const [first, second] = sheet.acts;
		const beatId = first!.beats[0]!.id;
		expect(await sheets.relabelAct(project, id, "gone", "X")).toBe("absent");
		expect(await sheets.moveAct(project, id, "gone", null)).toBe("absent");
		expect(await sheets.addBeat(project, id, "gone", { name: "X", description: "" }, null)).toBeNull();
		expect(await sheets.editBeat(project, id, "gone", { name: "X" })).toBe("absent");
		expect(await sheets.moveBeat(project, id, beatId, "gone", null)).toBe("absent");
		expect(await sheets.moveBeat(project, id, "gone", second!.id, null)).toBe("absent");
		expect(await sheets.addRow(project, id, "gone", "Words", null)).toBeNull();
		expect(await sheets.editRow(project, id, "gone", "Words")).toBe("absent");
		expect(await sheets.moveRow(project, id, "gone", beatId, null)).toBe("absent");
		expect(await sheets.placeScene(project, id, "scene-1", "gone", null)).toBe("absent");
		expect(await sheets.setLastSheet(project, "gone")).toBe("absent");
		// A thing already gone is what a removal asked for.
		expect(await sheets.deleteAct(project, id, "gone")).toBe("written");
		expect(await sheets.deleteBeat(project, id, "gone")).toBe("written");
		expect(await sheets.deleteRow(project, id, "gone")).toBe("written");
		expect(await sheets.removeScene(project, id, "scene-1")).toBe("written");
		expect(await sheets.deleteSheet(project, "gone")).toBe("absent");
	});

	it("moves beats across acts, rows across beats and scenes across rows, each scene standing once in the sheet", async () => {
		const id = (await sheets.createSheet(project, { name: "Draft", source: threeAct() }))!;
		const [first, second] = (await sheets.read(project)).sheets[0]!.acts;
		const opening = first!.beats[0]!.id;
		const rising = second!.beats[0]!.id;
		const rowId = (await sheets.addRow(project, id, opening, "Arrives", null, ["scene-1"]))!;
		const otherRow = (await sheets.addRow(project, id, rising, "Climbs", null))!;
		expect(await sheets.placeScene(project, id, "scene-1", otherRow, null)).toBe("written");
		expect(await sheets.moveRow(project, id, rowId, rising, otherRow)).toBe("written");
		expect(await sheets.moveBeat(project, id, rising, first!.id, opening)).toBe("written");
		const sheet = (await sheets.read(project)).sheets[0]!;
		expect(sheet.acts[0]!.beats.map((beat) => beat.id).slice(0, 2)).toEqual([rising, opening]);
		expect(findBeat(sheet, rising)!.beat.rows.map((row) => [row.text, row.scenes])).toEqual([
			["Arrives", []],
			["Climbs", ["scene-1"]],
		]);
		expect(await sheets.editBeat(project, id, opening, { description: "Where it begins" })).toBe("written");
		expect(findBeat((await sheets.read(project)).sheets[0]!, opening)!.beat).toMatchObject({ name: "Setup", description: "Where it begins" });
	});

	it("keeps a sheet's acts and beats as a template, replaces a namesake, and starts a later sheet from it", async () => {
		const id = (await sheets.createSheet(project, { name: "Draft", source: threeAct() }))!;
		const opening = (await sheets.read(project)).sheets[0]!.acts[0]!.beats[0]!.id;
		await sheets.addRow(project, id, opening, "A sub-description", null, ["scene-1"]);
		await sheets.editBeat(project, id, opening, { description: "Where it begins" });
		expect(await sheets.saveTemplate(project, id, { name: "  ", description: "" })).toBe("refused");
		expect(await sheets.saveTemplate(project, "gone", { name: "Mine", description: "" })).toBe("absent");
		expect(await sheets.saveTemplate(project, id, { name: "Mine", description: "My own three acts" })).toBe("written");
		let held = await sheets.read(project);
		expect(held.templates).toHaveLength(1);
		const templateId = held.templates[0]!.id;
		expect(templateId).toMatch(/^beat-sheet-template-\d+$/u);
		expect(held.templates[0]!.acts[0]!.beats[0]).toEqual({ name: "Setup", description: "Where it begins" });
		// What was written under the beats stays with the sheet.
		expect(JSON.stringify(held.templates)).not.toContain("A sub-description");
		expect(JSON.stringify(held.templates)).not.toContain("scene-1");

		await sheets.relabelAct(project, id, held.sheets[0]!.acts[0]!.id, "Opening act");
		clock = 300;
		expect(await sheets.saveTemplate(project, id, { name: "mine", description: "Again" })).toBe("written");
		held = await sheets.read(project);
		expect(held.templates).toHaveLength(1);
		expect(held.templates[0]).toMatchObject({ id: templateId, name: "mine", description: "Again", createdAt: 100, updatedAt: 300 });
		expect(held.templates[0]!.acts[0]!.label).toBe("Opening act");

		const made = (await sheets.createSheet(project, { name: "From mine", source: { templateId } }))!;
		held = await sheets.read(project);
		const fresh = held.sheets.find((sheet) => sheet.id === made)!;
		expect(fresh.acts.map((act) => act.label)).toEqual(["Opening act", "Confrontation", "Resolution"]);
		expect(fresh.acts[0]!.beats[0]).toMatchObject({ name: "Setup", description: "Where it begins", rows: [] });
		expect(fresh.acts[0]!.id).not.toBe(held.sheets[0]!.acts[0]!.id);

		expect(await sheets.deleteTemplate(project, templateId)).toBe("deleted");
		expect(await sheets.deleteTemplate(project, templateId)).toBe("absent");
		expect(await sheets.createSheet(project, { name: "From nothing", source: { templateId } })).toBeNull();
		expect((await sheets.read(project)).sheets.map((sheet) => sheet.name)).toEqual(["Draft", "From mine"]);
	});

	it("takes out what points at scenes the project no longer has, only when asked", async () => {
		const id = (await sheets.createSheet(project, { name: "Draft", source: threeAct() }))!;
		const opening = (await sheets.read(project)).sheets[0]!.acts[0]!.beats[0]!.id;
		await sheets.addRow(project, id, opening, "Arrives", null, ["scene-1", "scene-gone"]);
		expect(await sheets.pruneMissing(project, { sceneIds: new Set(["scene-1"]) })).toBe("written");
		expect(findBeat((await sheets.read(project)).sheets[0]!, opening)!.beat.rows[0]!.scenes).toEqual(["scene-1"]);
	});
});
