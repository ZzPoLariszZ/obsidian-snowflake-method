import { beforeEach, describe, expect, it } from "vitest";

import {
	FORESHADOWING_STATUSES,
	FRONTMATTER_KEYS,
	MAIN_FREEFORM_VIEW_ID,
	MAIN_TIMELINE_VIEW_ID,
	SCHEMA_VERSION,
	TASK_PRIORITIES,
	TASK_STATUSES,
	captureRevision,
	fileStem,
	type CanvasExportWords,
} from "../../src/domain";
import { UnsupportedSchemaError } from "../../src/repository";
import {
	SnowflakeProjectService,
	type CanvasExportPlan,
	type CanvasExportTarget,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const ROOT = "Snowflake Projects/Novel";
const FREEFORM = `${ROOT}/70_Tool/73_Visualization/732_Freeform`;
const TIMELINE = `${ROOT}/70_Tool/73_Visualization/733_Timeline`;
const BEAT_SHEET = `${ROOT}/70_Tool/73_Visualization/734_Beat_Sheet`;

const words: CanvasExportWords = {
	missing: (of, kind) => `missing:${of}:${kind}`,
	lastSeen: (name) => `lastSeen:${name}`,
	missingScene: "missing:scene",
	missingTime: "missing:time",
	untitledBeat: "untitled:beat",
	actTitle: (number, label) => (label.length === 0 ? `Act ${String(number)}` : `Act ${String(number)} - ${label}`),
	recordKind: (type) => `kind:${type}`,
};

interface Record {
	type: string;
	file?: string;
	text?: string;
	label?: string;
	color?: string;
	x: number;
	y: number;
}

const planned = (plan: CanvasExportPlan): CanvasExportTarget => {
	if (plan.kind !== "planned") throw new Error("The plan found nothing to export.");
	return plan;
};

const nodesOf = (target: CanvasExportTarget): Record[] =>
	(JSON.parse(target.content) as { nodes: Record[] }).nodes;

const must = <T>(value: T | null | undefined): T => {
	if (value === null || value === undefined) throw new Error("The seed did not land.");
	return value;
};

describe("CanvasExportService", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await service.createProject({ title: "Novel", locale: "en" });
	});

	const fresh = (): Promise<ProjectSnapshot> => service.loadProject(project.projectFile);

	it("plans a freeform view into the freeform folder under the view's name, and writes what it planned", async () => {
		const scene = await service.createScene(project, { title: "One", color: "macaron-2" });
		const note = await service.stickyNotes.create(project, "macaron-5");
		expect(await service.tasks.create(project, {
			id: "task-1", title: "Do the thing", description: "", status: TASK_STATUSES[0], priority: TASK_PRIORITIES[0],
			dueDate: null, related: [], archived: false, createdAt: 1, updatedAt: 1,
		})).toBe(true);
		const seeded = await fresh();
		const done = await service.freeform.transact(seeded, MAIN_FREEFORM_VIEW_ID, [
			{
				do: "add",
				placements: [
					{ id: "p-scene", resource: { type: "entity", kind: "scene", id: scene.sceneId, name: "One" }, x: 10, y: 20 },
					{ id: "p-text", resource: { type: "text", text: "Hello" }, x: 300, y: 20 },
					{ id: "p-task", resource: { type: "task", id: "task-1", name: "Do" }, x: 600, y: 20 },
					{ id: "p-thread", resource: { type: "foreshadowing", id: "thread-gone", name: "Old thread" }, x: 600, y: 400 },
					{ id: "p-note", resource: { type: "sticky-note", id: note.id, name: "" }, x: 900, y: 20 },
					{ id: "p-gone", resource: { type: "entity", kind: "scene", id: "scene-gone", name: "Old" }, x: 10, y: 400 },
					{ id: "p-file", resource: { type: "file", path: "80_Material/map.png" }, x: 300, y: 400 },
				],
			},
			{
				do: "connect",
				edges: [
					{ id: "e-1", source: "p-scene", target: "p-text", label: "leads" },
					{ id: "e-2", source: "p-task", target: "p-text" },
				],
			},
		]);
		expect(done.came).toBe("written");

		const plan = planned(await service.canvasExporter.planFreeform(seeded, MAIN_FREEFORM_VIEW_ID, words));
		expect(plan).toMatchObject({ path: `${FREEFORM}/Main.canvas`, exists: false, unchanged: false });
		expect(await service.canvasExporter.write(plan)).toBe("written");
		expect(fakeVault.contents.get(plan.path)).toBe(plan.content);
		expect(nodesOf(plan).map((node) => [node.type, node.file ?? node.text, node.color])).toEqual([
			["file", scene.path, "2"],
			["text", "Hello", undefined],
			["text", "**kind:task**\n\nDo the thing", undefined],
			["text", "missing:foreshadowing:foreshadowing\n\nlastSeen:Old thread", undefined],
			["file", note.path, "5"],
			["text", "missing:entity:scene\n\nlastSeen:Old", undefined],
			["file", `${ROOT}/80_Material/map.png`, undefined],
		]);
		const { edges } = JSON.parse(plan.content) as { edges: { label?: string }[] };
		expect(edges).toHaveLength(2);
		expect(edges[0]).toMatchObject({ label: "leads" });
	});

	it("names a thread by its name, and a revision by its first plain words or by its chapter where it has none", async () => {
		const chapter = await service.manuscript.appendSegment(project, "Two");
		const body = "# Two\n\nThe crane flew.\n";
		await service.manuscript.writeSegment(chapter, body);
		expect(await service.foreshadowing.create(project, {
			id: "thread-1", name: "A hidden letter", description: "", status: FORESHADOWING_STATUSES[0], related: [],
			createdAt: 1, updatedAt: 1, occurrences: [],
		})).toBe(true);
		// Made over "The crane": called by the words it was made over.
		expect(await service.revisions.create(project, captureRevision(chapter, body, "replace", 7, 16, "A heron", "", "rev-words", 1))).toBe(true);
		// An insertion of marks alone has no plain word to go by, so the chapter names it, as the view's face does.
		expect(await service.revisions.create(project, captureRevision(chapter, body, "insert", 7, 7, "**", "", "rev-marks", 2))).toBe(true);
		const seeded = await fresh();
		const done = await service.freeform.transact(seeded, MAIN_FREEFORM_VIEW_ID, [{
			do: "add",
			placements: [
				{ id: "p-thread", resource: { type: "foreshadowing", id: "thread-1", name: "Letter" }, x: 0, y: 0 },
				{ id: "p-words", resource: { type: "revision", id: "rev-words", name: "Crane" }, x: 400, y: 0 },
				{ id: "p-marks", resource: { type: "revision", id: "rev-marks", name: "Marks" }, x: 800, y: 0 },
			],
		}]);
		expect(done.came).toBe("written");
		const plan = planned(await service.canvasExporter.planFreeform(seeded, MAIN_FREEFORM_VIEW_ID, words));
		expect(nodesOf(plan).map((node) => node.text)).toEqual([
			"**kind:foreshadowing**\n\nA hidden letter",
			"**kind:revision**\n\nThe crane",
			`**kind:revision**\n\n${fileStem(chapter)}`,
		]);
	});

	it("writes a timeline view into the timeline folder, its times in the project's order, and a beat sheet into the beat sheet folder", async () => {
		const scene = await service.createScene(project, { title: "One", color: "macaron-1" });
		const dawn = await service.createEntity(project, { kind: "time", name: "Dawn" });
		const dusk = await service.createEntity(project, { kind: "time", name: "Dusk" });
		const laneId = must(await service.timeline.createTimeline(project, { name: "Main lane", binding: null }));
		await service.timeline.setViewTimelines(project, MAIN_TIMELINE_VIEW_ID, [laneId]);
		await service.timeline.addTime(project, laneId, dusk.entityId);
		await service.timeline.addTime(project, laneId, dawn.entityId);
		must(await service.timeline.addRow(project, laneId, dawn.entityId, "First light", null, [scene.sceneId]));
		const seeded = await fresh();

		const timeline = planned(await service.canvasExporter.planTimeline(seeded, MAIN_TIMELINE_VIEW_ID, words));
		expect(timeline.path).toBe(`${TIMELINE}/Main.canvas`);
		expect(nodesOf(timeline).map((node) => [node.type, node.label ?? node.file ?? node.text, node.y])).toEqual([
			["group", "Main lane", 0],
			["file", dawn.path, 40],
			["text", "First light", 40],
			["file", scene.path, 40],
			["file", dusk.path, 380],
		]);
		await service.timeline.setViewTimesReversed(project, MAIN_TIMELINE_VIEW_ID, true);
		await service.timeline.setViewPresentation(project, MAIN_TIMELINE_VIEW_ID, "stack");
		await service.timeline.setViewSubDescriptions(project, MAIN_TIMELINE_VIEW_ID, false);
		const switched = planned(await service.canvasExporter.planTimeline(seeded, MAIN_TIMELINE_VIEW_ID, words));
		expect(switched.content).toBe(timeline.content);

		const sheetId = must(
			await service.beatSheet.createSheet(project, {
				name: "Three acts",
				source: { structure: { acts: [{ label: "Setup", beats: [{ name: "Opening", description: "Start" }] }] } },
			}),
		);
		const held = await service.beatSheet.read(project);
		const beat = must(held.sheets[0]?.acts[0]?.beats[0]);
		must(await service.beatSheet.addRow(project, sheetId, beat.id, "Row", null, [scene.sceneId]));
		const sheet = planned(await service.canvasExporter.planBeatSheet(seeded, sheetId, words));
		expect(sheet.path).toBe(`${BEAT_SHEET}/Three acts.canvas`);
		expect(nodesOf(sheet).map((node) => [node.type, node.label ?? node.file ?? node.text, node.color])).toEqual([
			["group", "Act 1 - Setup", undefined],
			["text", "## Opening\n\nStart", undefined],
			["text", "Row", undefined],
			["file", scene.path, "1"],
		]);
		expect(await service.canvasExporter.write(sheet)).toBe("written");
		expect(fakeVault.getFileByPath(sheet.path)).not.toBeNull();
	});

	it("uses the Chinese folder names and view name for a Chinese project", async () => {
		const chinese = await service.createProject({ title: "小说", locale: "zh-CN" });
		const plan = planned(await service.canvasExporter.planFreeform(chinese, MAIN_FREEFORM_VIEW_ID, words));
		expect(plan.path).toBe(`${chinese.rootPath}/70_工具/73_可视化/732_自由画布/主视图.canvas`);
		expect(plan.content).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
	});

	it("names the file as a file can be named, and by the view's id where no safe name is left", async () => {
		const odd = must(await service.freeform.createView(project, { name: "A/B: C?" }));
		const dots = must(await service.freeform.createView(project, { name: "..." }));
		// A name that begins with a dot would make a hidden file, one Obsidian never lists, so the dot goes.
		const hidden = must(await service.freeform.createView(project, { name: ".drafts" }));
		const seeded = await fresh();
		expect(planned(await service.canvasExporter.planFreeform(seeded, odd, words)).path).toBe(`${FREEFORM}/A-B- C-.canvas`);
		expect(planned(await service.canvasExporter.planFreeform(seeded, dots, words)).path).toBe(`${FREEFORM}/${dots}.canvas`);
		expect(planned(await service.canvasExporter.planFreeform(seeded, hidden, words)).path).toBe(`${FREEFORM}/drafts.canvas`);
	});

	it("writes nothing over a canvas that says the same already, even one Obsidian saved again with its metadata", async () => {
		await service.freeform.transact(project, MAIN_FREEFORM_VIEW_ID, [
			{ do: "add", placements: [{ id: "p-text", resource: { type: "text", text: "Hello" }, x: 0, y: 0 }] },
		]);
		const seeded = await fresh();
		const first = planned(await service.canvasExporter.planFreeform(seeded, MAIN_FREEFORM_VIEW_ID, words));
		await service.canvasExporter.write(first);
		const stamp = fakeVault.getFileByPath(first.path)!.stat.mtime;

		const again = planned(await service.canvasExporter.planFreeform(seeded, MAIN_FREEFORM_VIEW_ID, words));
		expect(again).toMatchObject({ exists: true, unchanged: true });
		expect(await service.canvasExporter.write(again)).toBe("unchanged");
		expect(fakeVault.getFileByPath(first.path)!.stat.mtime).toBe(stamp);
		expect(fakeVault.processCalls).not.toContain(first.path);

		fakeVault.write(
			first.path,
			first.content.replace(/\n\}$/u, ',\n\t"metadata":{\n\t\t"version":"1.0-1.0",\n\t\t"frontmatter":{}\n\t}\n}'),
		);
		const resaved = planned(await service.canvasExporter.planFreeform(seeded, MAIN_FREEFORM_VIEW_ID, words));
		expect(resaved).toMatchObject({ exists: true, unchanged: true });

		await service.freeform.transact(project, MAIN_FREEFORM_VIEW_ID, [{ do: "text", id: "p-text", text: "Changed" }]);
		const changed = planned(await service.canvasExporter.planFreeform(seeded, MAIN_FREEFORM_VIEW_ID, words));
		expect(changed).toMatchObject({ exists: true, unchanged: false });
		expect(await service.canvasExporter.write(changed)).toBe("written");
		expect(fakeVault.contents.get(first.path)).toBe(changed.content);
		expect(fakeVault.getFileByPath(first.path)!.stat.mtime).toBeGreaterThan(stamp);
	});

	it("finds nothing to export for a view or a sheet that is not there", async () => {
		const seeded = await fresh();
		expect(await service.canvasExporter.planFreeform(seeded, "freeform-view-nobody", words)).toEqual({ kind: "absent" });
		expect(await service.canvasExporter.planTimeline(seeded, "timeline-view-nobody", words)).toEqual({ kind: "absent" });
		expect(await service.canvasExporter.planBeatSheet(seeded, "beat-sheet-nobody", words)).toEqual({ kind: "absent" });
	});

	it("refuses a project this build may not write to", async () => {
		const content = fakeVault.contents.get(project.projectFile) ?? "";
		fakeVault.contents.set(
			project.projectFile,
			content.replace(`"${FRONTMATTER_KEYS.schema}": ${String(SCHEMA_VERSION)}`, `"${FRONTMATTER_KEYS.schema}": 99`),
		);
		const locked = await fresh();
		expect(locked.readOnly).toBe(true);
		await expect(service.canvasExporter.planFreeform(locked, MAIN_FREEFORM_VIEW_ID, words)).rejects.toBeInstanceOf(
			UnsupportedSchemaError,
		);
		expect(fakeVault.getFileByPath(`${FREEFORM}/Main.canvas`)).toBeNull();
	});
});
