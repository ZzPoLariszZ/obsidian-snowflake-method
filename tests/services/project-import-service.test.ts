import { beforeEach, describe, expect, it } from "vitest";

import {
	FORESHADOWING_STATUSES,
	FRONTMATTER_KEYS,
	SCHEMA_VERSION,
	TASK_PRIORITIES,
	TASK_STATUSES,
	captureOccurrence,
	captureRevision,
	type ImportInspection,
	type ImportPart,
	type ImportSelection,
} from "../../src/domain";
import { parseMarkdownFrontmatter } from "../../src/repository";
import {
	ImportRefusedError,
	SnowflakeProjectService,
	galleryFolderPath,
	type ImportReport,
	type ProjectSnapshot,
} from "../../src/services";
import { readMarkedSection, type RecordLine } from "../../src/templates";
import { createFakeEnvironment, type FakeFileManager, type FakeVault } from "../helpers/fake-vault";

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
const linkTarget = (path: string): string => path.replace(/\.md$/u, "");

const must = <T>(value: T | null | undefined): T => {
	if (value === null || value === undefined) throw new Error("The seed did not land.");
	return value;
};

/** The default ticks, plus whatever `also` says yes to: chapters, say. */
const selection = (
	inspection: ImportInspection,
	also: (part: ImportPart) => boolean = () => false,
	clashPolicy: ImportSelection["clashPolicy"] = "skip",
): ImportSelection => ({
	parts: new Set(inspection.parts.filter((part) => part.defaultSelected || also(part)).map((part) => part.key)),
	clashPolicy,
});

const chapters = (part: ImportPart): boolean => part.kind === "chapter" || part.kind === "revision";

const BODY_ONE = "# Chapter One\n\nThe crane flew over the harbor at dawn.\n";
const BODY_TWO = "# Chapter Two\n\nThe letter waited under the floor.\n";

const refusalOf = async (work: Promise<unknown>): Promise<string> => {
	try {
		await work;
	} catch (error) {
		if (error instanceof ImportRefusedError) return error.code;
		throw error;
	}
	throw new Error("Nothing was refused.");
};

/** What the source holds, by name, so the assertions can point at it. */
interface Seed {
	alice: { id: string; path: string };
	bob: { id: string; path: string };
	dawn: { id: string; path: string };
	harbor: { id: string; path: string };
	opening: { id: string; path: string };
	chapterOne: string;
	chapterTwo: string;
	viewId: string;
	laneId: string;
	sheetId: string;
	templatePath: string;
	picture: string;
}

describe("ProjectImportService", () => {
	let fakeVault: FakeVault;
	let fakeFileManager: FakeFileManager;
	let service: SnowflakeProjectService;
	let source: ProjectSnapshot;
	let target: ProjectSnapshot;

	const stored = (path: string): Record<string, unknown> =>
		parseMarkdownFrontmatter(fakeVault.contents.get(path) ?? "").frontmatter;
	const fresh = (project: ProjectSnapshot): Promise<ProjectSnapshot> => service.loadProject(project.projectFile);
	const contentsUnder = (root: string): Map<string, string> =>
		new Map([...fakeVault.contents].filter(([path]) => path.startsWith(`${root}/`)));

	const statusLine = (project: ProjectSnapshot, name: string, value = "", when: { path: string; name: string } | null = null): RecordLine => ({
		label: { path: `${project.rootPath}/20_Character/22_World_Status/${name}/${name}`, display: name },
		value,
		clauses: when === null ? [] : [{ kind: "when", term: { kind: "link", path: linkTarget(when.path), name: when.name } }],
	});
	const relationLine = (project: ProjectSnapshot, name: string, to: { path: string; name: string }): RecordLine => ({
		label: { path: `${project.rootPath}/20_Character/23_Relationship/${name}/${name}`, display: name },
		value: "",
		clauses: [{ kind: "target", term: { kind: "link", path: linkTarget(to.path), name: to.name } }],
	});

	/** An English book with one of everything an import carries. */
	async function seed(project: ProjectSnapshot): Promise<Seed> {
		const root = project.rootPath;
		const bob = await service.createCharacter(project, { name: "Bob", type: "supporting" });
		const spring = await service.createEntity(project, { kind: "time", name: "Spring", timeKind: "point" });
		const summer = await service.createEntity(project, { kind: "time", name: "Summer", timeKind: "point" });
		const dawn = await service.createEntity(project, {
			kind: "time",
			name: "Dawn",
			timeKind: "period",
			timeStart: `[[${linkTarget(spring.path)}|Spring]]`,
			timeEnd: `[[${linkTarget(summer.path)}|Summer]]`,
			description: "The first light.",
		});
		const harbor = await service.createEntity(project, { kind: "location", name: "Harbor", description: "Salt and rope." });
		await fakeVault.ensureFolders(`${root}/80_Material`);
		await fakeVault.createBinary(`${root}/80_Material/portrait.png`, bytes("portrait"));
		const [landed] = await service.gallery.addPictures(project, "character", [
			{ kind: "vault", path: `${root}/80_Material/portrait.png` },
		]);
		const alice = await service.createCharacter(project, {
			name: "Alice",
			type: "major",
			color: "macaron-2",
			aliases: ["Al"],
			categoryPaths: ["Kin/Elf"],
			oneSentenceStoryline: "Alice seeks the map.",
			worldStatus: [statusLine(project, "Injured", "a limp", { path: dawn.path, name: "Dawn" })],
			relationships: [relationLine(project, "Ally", { path: bob.path, name: "Bob" })],
			customFields: "### Eyes\n\ngrey\n",
			characterProfile: `She trusts [[${linkTarget(bob.path)}|Bob]].`,
			gallery: [must(landed).link],
			galleryMain: must(landed).link,
		});
		const chapterOne = await service.manuscript.appendSegment(project, "Chapter One");
		const bodyOne = BODY_ONE;
		await service.manuscript.writeSegment(chapterOne, bodyOne);
		const chapterTwo = await service.manuscript.appendSegment(project, "Chapter Two");
		const bodyTwo = BODY_TWO;
		await service.manuscript.writeSegment(chapterTwo, bodyTwo);
		const opening = await service.createScene(project, {
			title: "Opening",
			povPath: alice.path,
			characters: [alice.path, bob.path],
			times: [`[[${linkTarget(dawn.path)}|Dawn]]`],
			locations: [`[[${linkTarget(harbor.path)}|Harbor]]`],
			conflict: "The tide turns.",
			events: `Alice meets [[${linkTarget(bob.path)}]] on the quay.`,
			linkedManuscript: [`[[${linkTarget(chapterOne)}]]`],
		});
		expect(
			await service.tasks.create(project, {
				id: "task-tide",
				title: "Fix the tide",
				description: "",
				status: TASK_STATUSES[0],
				priority: TASK_PRIORITIES[0],
				dueDate: null,
				related: [{ kind: "character", id: alice.characterId, name: "Alice" }],
				archived: false,
				createdAt: 1,
				updatedAt: 1,
			}),
		).toBe(true);
		expect(
			await service.foreshadowing.create(project, {
				id: "thread-letter",
				name: "The letter",
				description: "",
				status: FORESHADOWING_STATUSES[0],
				related: [{ kind: "character", id: alice.characterId, name: "Alice" }],
				createdAt: 1,
				updatedAt: 1,
				occurrences: [
					captureOccurrence(chapterOne, bodyOne, bodyOne.indexOf("crane"), bodyOne.indexOf("crane") + 5, "plant", "", "occ-crane"),
					captureOccurrence(chapterTwo, bodyTwo, bodyTwo.indexOf("letter"), bodyTwo.indexOf("letter") + 6, "payoff", "", "occ-letter"),
				],
			}),
		).toBe(true);
		expect(
			await service.revisions.create(
				project,
				captureRevision(chapterOne, bodyOne, "replace", bodyOne.indexOf("crane"), bodyOne.indexOf("crane") + 5, "heron", "", "rev-crane", 1),
			),
		).toBe(true);
		expect(
			await service.revisions.create(
				project,
				captureRevision(chapterTwo, bodyTwo, "replace", bodyTwo.indexOf("floor"), bodyTwo.indexOf("floor") + 5, "boards", "", "rev-floor", 2),
			),
		).toBe(true);
		await service.stickyNotes.create(project, "macaron-5", new Date(Date.UTC(2026, 0, 2, 3, 4)), 0, "Remember the map.");
		const viewId = must(await service.freeform.createView(project, { name: "Board" }));
		const seeded = await fresh(project);
		expect(
			(
				await service.freeform.transact(seeded, viewId, [
					{
						do: "add",
						placements: [
							{ id: "p-alice", resource: { type: "entity", kind: "character", id: alice.characterId, name: "Alice" }, x: 0, y: 0 },
							{ id: "p-task", resource: { type: "task", id: "task-tide", name: "Fix the tide" }, x: 400, y: 0 },
						],
					},
				])
			).came,
		).toBe("written");
		const laneId = must(
			await service.timeline.createTimeline(seeded, {
				name: "Main lane",
				binding: { kind: "character", id: alice.characterId, name: "Alice" },
			}),
		);
		await service.timeline.addTime(seeded, laneId, dawn.entityId);
		must(await service.timeline.addRow(seeded, laneId, dawn.entityId, "First light", null, [opening.sceneId]));
		const sheetId = must(
			await service.beatSheet.createSheet(seeded, {
				name: "Three acts",
				source: { structure: { acts: [{ label: "Setup", beats: [{ name: "Hook", description: "Start" }] }] } },
			}),
		);
		const beat = must((await service.beatSheet.read(seeded)).sheets[0]?.acts[0]?.beats[0]);
		must(await service.beatSheet.addRow(seeded, sheetId, beat.id, "Row", null, [opening.sceneId]));
		expect(await service.beatSheet.saveTemplate(seeded, sheetId, { name: "Classic", description: "Three acts" })).toBe("written");
		const artifact = must(await service.loadArtifact(seeded, 1));
		await service.updateSections(artifact.path, { genre: "Fantasy", "one-sentence-summary": "A map of absence." }, artifact.revision);
		const saved = await service.saveCustomFieldTemplate(seeded, "character", {
			name: "Combatant",
			description: "For anyone who fights.",
			fields: [{ title: "Weapon", content: "" }],
		});
		if (!saved.ok) throw new Error("The template was refused.");
		await service.setKindTemplate(seeded, "character", linkTarget(saved.path));
		return {
			alice: { id: alice.characterId, path: alice.path },
			bob: { id: bob.characterId, path: bob.path },
			dawn: { id: dawn.entityId, path: dawn.path },
			harbor: { id: harbor.entityId, path: harbor.path },
			opening: { id: opening.sceneId, path: opening.path },
			chapterOne,
			chapterTwo,
			viewId,
			laneId,
			sheetId,
			templatePath: saved.path,
			picture: must(landed).path,
		};
	}

	const run = (
		from: ProjectSnapshot,
		into: ProjectSnapshot,
		also: (part: ImportPart) => boolean = () => false,
		clashPolicy: ImportSelection["clashPolicy"] = "skip",
	): Promise<ImportReport> =>
		service.importer
			.inspectSource(from, into)
			.then((inspection) => service.importer.runImport(from, into, selection(inspection, also, clashPolicy)));

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		fakeFileManager = environment.fakeFileManager;
		service = new SnowflakeProjectService(environment.vault, environment.fileManager, environment.metadataCache);
		source = await service.createProject({ title: "Book 1", locale: "en" });
		target = await service.createProject({ title: "Book 2", locale: "en" });
	});

	it("refuses a project as its own source, nested roots, and a project this build may not read or write", async () => {
		expect(await refusalOf(service.importer.inspectSource(source, source))).toBe("same-project");
		const inner = await service.createProject({ title: "Inner", locale: "en", rootPath: `${source.rootPath}/80_Material` });
		expect(await refusalOf(service.importer.runImport(inner, source, { parts: new Set(), clashPolicy: "skip" }))).toBe("nested");

		const content = fakeVault.contents.get(source.projectFile) ?? "";
		fakeVault.contents.set(
			source.projectFile,
			content.replace(`"${FRONTMATTER_KEYS.schema}": ${String(SCHEMA_VERSION)}`, `"${FRONTMATTER_KEYS.schema}": 99`),
		);
		expect(await refusalOf(service.importer.inspectSource(source.projectFile, target))).toBe("read-only-source");
		expect(await refusalOf(service.importer.inspectSource(target, source.projectFile))).toBe("read-only-target");
	});

	it("copies the design with fresh ids, every link pointed at the copy, and leaves the source as it was", async () => {
		const seeded = await seed(source);
		source = await fresh(source);
		const before = contentsUnder(source.rootPath);

		const report = await run(source, target);
		expect(report.failed).toEqual([]);
		expect(report.created.map((item) => item.kind)).toEqual(
			expect.arrayContaining(["character", "scene", "worldbuilding", "vocabulary", "custom-field-template", "picture", "step", "task", "foreshadowing", "sticky-note", "freeform-view", "timeline", "beat-sheet", "beat-sheet-template"]),
		);
		// The manuscript is off by default, so nothing anchored in it comes either.
		expect(report.created.some((item) => item.kind === "chapter" || item.kind === "revision")).toBe(false);
		expect(report.droppedLinks.map((drop) => [drop.owner.name, drop.field, drop.target])).toEqual(
			expect.arrayContaining([
				["Opening", "linked-manuscript", "Chapter One"],
				["The letter", "chapter", "Chapter One"],
			]),
		);

		const loaded = await fresh(target);
		expect(loaded.structureIssues).toEqual([]);
		const alice = must(loaded.characters.find((character) => character.name === "Alice"));
		const bob = must(loaded.characters.find((character) => character.name === "Bob"));
		const dawn = must(loaded.worldbuilding.time?.find((entity) => entity.name === "Dawn"));
		const opening = must(loaded.scenes.find((scene) => scene.title === "Opening"));
		expect(dawn.entityId).not.toBe(seeded.dawn.id);
		expect(dawn.timeStart).toBe(`[[${target.rootPath}/60_Worldbuilding/61_Time/Spring|Spring]]`);
		expect(dawn.timeEnd).toBe(`[[${target.rootPath}/60_Worldbuilding/61_Time/Summer|Summer]]`);
		expect(alice.characterId).not.toBe(seeded.alice.id);
		expect(alice.path).toBe(`${target.rootPath}/20_Character/Alice.md`);
		expect(alice).toMatchObject({ type: "major", color: "macaron-2", aliases: ["Al"], oneSentenceStoryline: "Alice seeks the map." });
		expect(alice.categories).toEqual([
			expect.stringContaining(`${target.rootPath}/20_Character/21_Category/Major/Major|Major`),
			expect.stringContaining(`${target.rootPath}/20_Character/21_Category/Kin/Elf/Elf|Kin/Elf`),
		]);
		expect(alice.worldStatus).toEqual([
			{
				label: { path: `${target.rootPath}/20_Character/22_World_Status/Injured/Injured`, display: "Injured" },
				value: "a limp",
				clauses: [{ kind: "when", term: { kind: "link", path: linkTarget(dawn.path), name: "Dawn" } }],
			},
		]);
		expect(alice.relationships[0]?.clauses).toEqual([
			{ kind: "target", term: { kind: "link", path: linkTarget(bob.path), name: "Bob" } },
		]);
		expect(alice.characterProfile).toContain(`[[${linkTarget(bob.path)}|Bob]]`);
		expect(alice.customFields).toContain("grey");
		expect(alice.gallery).toEqual([`[[${target.rootPath}/20_Character/25_Gallery/portrait.png]]`]);
		expect(fakeVault.binaryContents.has(`${target.rootPath}/20_Character/25_Gallery/portrait.png`)).toBe(true);
		expect(opening.povPath).toBe(alice.path);
		expect(opening.characters).toEqual([alice.path, bob.path]);
		expect(opening.times).toEqual([`[[${linkTarget(dawn.path)}|Dawn]]`]);
		expect(opening.events).toContain(`[[${linkTarget(bob.path)}]]`);
		expect(opening.linkedManuscript).toEqual([]);
		// Ranks continue after the target's own, in the source's order.
		expect(loaded.characters.map((character) => character.name)).toEqual(["Bob", "Alice"]);
		expect(bob.rank).toBeLessThan(alice.rank);
		const kinElf = `${target.rootPath}/20_Character/21_Category/Kin/Elf/Elf.md`;
		expect(fakeVault.getFileByPath(kinElf)).not.toBeNull();
		const template = `${target.rootPath}/20_Character/24_Custom_Field/Combatant.md`;
		expect(fakeVault.contents.get(template)).toContain("Weapon");
		expect(await service.kindTemplatePath(loaded, "character")).toBe(linkTarget(template));
		const artifact = must(await service.loadArtifact(loaded, 1));
		expect(readMarkedSection(artifact.content, "genre")).toBe("Fantasy");
		expect(readMarkedSection(artifact.content, "one-sentence-summary")).toBe("A map of absence.");

		expect(contentsUnder(source.rootPath)).toEqual(before);
		const document = await service.imports.readDocument(loaded);
		expect(document.entries.length).toBe(report.created.length);
		expect(document.entries.every((entry) => entry.sourceProjectId === source.id && entry.sourceHash.length > 0 && entry.copyHash.length > 0)).toBe(true);
		expect(document.lastChoices[source.id]?.clashPolicy).toBe("skip");
	});

	it("imports from an archived book", async () => {
		await seed(source);
		const archived = await service.archiveProject(source);
		// Obsidian repoints every link into a folder it moved; the fake leaves that to the test.
		for (const [path, content] of [...fakeVault.contents]) {
			if (!path.startsWith(`${archived.rootPath}/`)) continue;
			fakeVault.contents.set(path, content.split(`${source.rootPath}/`).join(`${archived.rootPath}/`));
		}
		const report = await run(await service.loadProject(archived.projectFile), target);
		expect(report.failed).toEqual([]);
		const loaded = await fresh(target);
		expect(loaded.characters.map((character) => character.name)).toEqual(["Bob", "Alice"]);
		expect(must(loaded.scenes[0]).characters[0]).toBe(`${target.rootPath}/20_Character/Alice.md`);
	});

	it("carries a Chinese book into an English one in the target's own folders and words", async () => {
		const zh = await service.createProject({ title: "第一卷", locale: "zh-CN" });
		const made = await service.createWorldbuildingKind(zh, "势力", { icon: "flag", description: "各方势力。" });
		expect(made.ok).toBe(true);
		let loadedZh = await fresh(zh);
		const bob = await service.createCharacter(loadedZh, { name: "鲍勃", type: "supporting" });
		const pack = await service.createEntity(loadedZh, { kind: "势力", name: "狼族", description: "北方的狼。", categoryPaths: ["部落"] });
		await fakeVault.ensureFolders(`${zh.rootPath}/80_素材`);
		await fakeVault.createBinary(`${zh.rootPath}/80_素材/portrait.png`, bytes("portrait"));
		const [landed] = await service.gallery.addPictures(loadedZh, "character", [{ kind: "vault", path: `${zh.rootPath}/80_素材/portrait.png` }]);
		await service.createCharacter(loadedZh, {
			name: "阿丽",
			type: "major",
			categoryPaths: ["种族/精灵"],
			worldStatus: [
				{ label: { path: `${zh.rootPath}/20_角色/22_状态/受伤/受伤`, display: "受伤" }, value: "瘸了", clauses: [] },
			],
			relationships: [
				{
					label: { path: `${zh.rootPath}/20_角色/23_关系/盟友/盟友`, display: "盟友" },
					value: "",
					clauses: [{ kind: "target", term: { kind: "link", path: linkTarget(bob.path), name: "鲍勃" } }],
				},
			],
			gallery: [must(landed).link],
			galleryMain: must(landed).link,
		});
		loadedZh = await fresh(zh);
		const saved = await service.saveCustomFieldTemplate(loadedZh, "character", {
			name: "基本资料",
			description: "每个角色都有的。",
			fields: [{ title: "武器", content: "" }],
		});
		if (!saved.ok) throw new Error("The template was refused.");
		await service.setKindTemplate(loadedZh, "character", linkTarget(saved.path));
		loadedZh = await fresh(zh);

		const report = await run(loadedZh, target);
		expect(report.failed).toEqual([]);
		expect(report.kindsCreated).toEqual(["势力"]);

		const loaded = await fresh(target);
		expect(loaded.structureIssues).toEqual([]);
		expect(loaded.worldbuildingKinds.map((kind) => [kind.id, kind.folderName, kind.icon, kind.description])).toContainEqual([
			"势力",
			"64_势力",
			"flag",
			"各方势力。",
		]);
		const alice = must(loaded.characters.find((character) => character.name === "阿丽"));
		expect(alice.path).toBe(`${target.rootPath}/20_Character/阿丽.md`);
		expect(alice.type).toBe("major");
		expect(alice.categories).toEqual([
			expect.stringContaining("21_Category/Major/Major|Major"),
			expect.stringContaining("21_Category/种族/精灵/精灵|种族/精灵"),
		]);
		// The seeded words cross by seat; the author's own cross as they are.
		expect(alice.worldStatus[0]?.label).toEqual({
			path: `${target.rootPath}/20_Character/22_World_Status/Injured/Injured`,
			display: "Injured",
		});
		expect(alice.worldStatus[0]?.value).toBe("瘸了");
		expect(alice.relationships[0]?.label.display).toBe("Ally");
		expect(alice.relationships[0]?.clauses[0]).toEqual({
			kind: "target",
			term: { kind: "link", path: `${target.rootPath}/20_Character/鲍勃`, name: "鲍勃" },
		});
		const content = fakeVault.contents.get(alice.path) ?? "";
		expect(content).toContain("World status");
		expect(content).toContain("Relationships");
		expect(alice.gallery).toEqual([`[[${target.rootPath}/20_Character/25_Gallery/portrait.png]]`]);
		const wolves = must(loaded.worldbuilding["势力"]?.find((entity) => entity.name === "狼族"));
		expect(wolves.path).toBe(`${target.rootPath}/60_Worldbuilding/64_势力/狼族.md`);
		expect(wolves.categories).toEqual([expect.stringContaining("641_Category/部落/部落|部落")]);
		expect(pack.entityId).not.toBe(wolves.entityId);
		expect(fakeVault.getFileByPath(`${target.rootPath}/60_Worldbuilding/64_势力/641_Category/部落/部落.md`)).not.toBeNull();
		const template = `${target.rootPath}/20_Character/24_Custom_Field/基本资料.md`;
		expect(fakeVault.contents.get(template)).toContain("武器");
		expect(await service.kindTemplatePath(loaded, "character")).toBe(linkTarget(template));
	});

	it("reuses a picture the target already holds under the same name and bytes, and numbers one that differs", async () => {
		await seed(source);
		const folder = galleryFolderPath(target, "character");
		await fakeVault.ensureFolders(folder);
		await fakeVault.createBinary(`${folder}/portrait.png`, bytes("portrait"));
		const same = await run(await fresh(source), target);
		expect(same.pictures).toEqual({ landed: 0, reused: 1 });
		// Found standing as the source has it, the picture is not reported as brought; the record pairs it with its source all the same.
		expect(same.created.some((item) => item.kind === "picture")).toBe(false);
		expect(same.skipped.map((item) => [item.kind, item.reason])).toContainEqual(["picture", "unchanged"]);
		expect((await service.imports.readDocument(await fresh(target))).entries.some((entry) => entry.kind === "picture")).toBe(true);
		expect(fakeVault.getFileByPath(`${folder}/portrait (2).png`)).toBeNull();

		const other = await service.createProject({ title: "Book 3", locale: "en" });
		await fakeVault.ensureFolders(galleryFolderPath(other, "character"));
		await fakeVault.createBinary(`${galleryFolderPath(other, "character")}/portrait.png`, bytes("another face"));
		const differs = await run(await fresh(source), other);
		expect(differs.pictures).toEqual({ landed: 1, reused: 0 });
		const alice = must((await fresh(other)).characters.find((character) => character.name === "Alice"));
		expect(alice.gallery).toEqual([`[[${galleryFolderPath(other, "character")}/portrait (2).png]]`]);
	});

	it("skips a namesake and points the links and records at the note already here", async () => {
		await seed(source);
		const own = await service.createCharacter(target, { name: "Alice", oneSentenceStoryline: "Our own Alice." });
		const report = await run(await fresh(source), target);
		expect(report.failed).toEqual([]);
		expect(report.skipped.filter((item) => item.reason !== "unchanged").map((item) => [item.name, item.reason])).toEqual([
			["Alice", "name-taken"],
		]);
		const loaded = await fresh(target);
		const alice = must(loaded.characters.find((character) => character.name === "Alice"));
		expect(alice.characterId).toBe(own.characterId);
		expect(alice.oneSentenceStoryline).toBe("Our own Alice.");
		expect(must(loaded.scenes[0]).povPath).toBe(own.path);
		expect(must(loaded.scenes[0]).characters[0]).toBe(own.path);
		const tasks = await service.tasks.list(loaded);
		expect(tasks.map((task) => [task.title, task.related[0]?.id])).toEqual([["Fix the tide", own.characterId]]);
		const lane = must((await service.timeline.read(loaded)).timelines.find((timeline) => timeline.name === "Main lane"));
		expect(lane.binding?.id).toBe(own.characterId);
		const view = must((await service.freeform.read(loaded)).views.find((candidate) => candidate.name === "Board"));
		expect(view.placements.map((placement) => placement.resource.type === "entity" ? placement.resource.id : placement.resource.type)).toEqual([
			own.characterId,
			"task",
		]);
	});

	it("replaces a namesake in place, keeping its id, path, rank and name", async () => {
		await seed(source);
		const own = await service.createCharacter(target, { name: "Alice", oneSentenceStoryline: "Our own Alice.", color: "macaron-7" });
		const other = await service.createCharacter(target, { name: "Zed" });
		const report = await run(await fresh(source), target, () => false, "replace");
		expect(report.failed).toEqual([]);
		expect(report.replaced.map((item) => item.name)).toEqual(["Alice"]);
		const loaded = await fresh(target);
		const alice = must(loaded.characters.find((character) => character.name === "Alice"));
		expect(alice.characterId).toBe(own.characterId);
		expect(alice.path).toBe(own.path);
		expect(alice.rank).toBe(own.rank);
		expect(alice.rank).toBeLessThan(other.rank);
		expect(alice).toMatchObject({ oneSentenceStoryline: "Alice seeks the map.", color: "macaron-2", type: "major" });
		expect(alice.worldStatus[0]?.value).toBe("a limp");
		expect(alice.customFields).toContain("grey");
		expect(alice.gallery).toHaveLength(1);
		const document = await service.imports.readDocument(loaded);
		expect(document.entries.find((entry) => entry.kind === "character" && entry.targetName === "Alice")?.targetId).toBe(own.characterId);
	});

	it("appends the manuscript after the target's own draft and re-anchors what the chapters hold", async () => {
		const seeded = await seed(source);
		const draftLink = stored(target.projectFile)[FRONTMATTER_KEYS.draft];
		const report = await run(await fresh(source), target, (part) => chapters(part) && !(part.kind === "chapter" && part.name === "Chapter Two"));
		expect(report.failed).toEqual([]);
		// The starter draft of the source clashes with the target's own and takes a number.
		expect(report.created.filter((item) => item.kind === "chapter").map((item) => [item.name, item.targetName])).toEqual([
			["Draft", "Draft 2"],
			["Chapter One", "Chapter One"],
		]);
		expect(report.skipped.map((item) => [item.kind, item.reason])).toContainEqual(["revision", "no-chapter"]);
		expect(report.droppedLinks.map((drop) => [drop.owner.name, drop.field, drop.target])).toContainEqual(["The letter", "chapter", "Chapter Two"]);

		const loaded = await fresh(target);
		expect(stored(loaded.projectFile)[FRONTMATTER_KEYS.draft]).toEqual(draftLink);
		const segments = await service.manuscript.listSegments(loaded);
		expect(segments.map((segment) => [segment.title, segment.sequence])).toEqual([
			["Draft", 1024],
			["Draft 2", 2048],
			["Chapter One", 3072],
		]);
		const copy = `${target.rootPath}/50_Manuscript/Chapter One.md`;
		const numbered = `${target.rootPath}/50_Manuscript/Draft 2.md`;
		expect((await service.manuscript.readSegment(copy)).body).toBe(BODY_ONE);
		expect((await service.manuscript.readSegment(numbered)).body).toContain("# Draft 2");
		const threads = await service.foreshadowing.list(loaded);
		expect(threads.map((thread) => thread.occurrences.map((occurrence) => [occurrence.path, occurrence.originalText, occurrence.from]))).toEqual([
			[[copy, "crane", BODY_ONE.indexOf("crane")]],
		]);
		expect(threads[0]?.id).not.toBe("thread-letter");
		const revisions = await service.revisions.list(loaded);
		expect(revisions.map((revision) => [revision.path, revision.originalText, revision.proposed])).toEqual([[copy, "crane", "heron"]]);
		expect(revisions[0]?.id).not.toBe("rev-crane");
		const opening = must(loaded.scenes[0]);
		expect(opening.linkedManuscript).toEqual([`[[${linkTarget(copy)}]]`]);
		expect(seeded.chapterOne).not.toBe(copy);
	});

	it("tells the progress chapter by chapter while the manuscript lands, and never counts back", async () => {
		await seed(source);
		const inspection = await service.importer.inspectSource(await fresh(source), target);
		const copies = ["Draft 2", "Chapter One", "Chapter Two"].map((title) => `${target.rootPath}/50_Manuscript/${title}.md`);
		const seen: [number, number][] = [];
		const report = await service.importer.runImport(await fresh(source), target, selection(inspection, chapters), {
			onProgress: (progress) => {
				if (progress.phase !== "chapters") return;
				seen.push([progress.done, copies.filter((path) => service.repository.getFile(path) !== null).length]);
			},
		});
		expect(report.failed).toEqual([]);
		// The first time each count is told, exactly that many chapters stand in the folder: the batch
		// tells each note as it lands, rather than all three once it is over.
		const first = must(seen[0])[0];
		const firstSight = new Map<number, number>();
		for (const [done, landed] of seen) if (!firstSight.has(done)) firstSight.set(done, landed);
		expect([...firstSight.entries()].map(([done, landed]) => [done - first, landed])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
		expect(seen.every(([done], index) => index === 0 || done >= must(seen[index - 1])[0])).toBe(true);
	});

	it("brings the sticky notes, the views, the timelines and the beat sheets over the copies", async () => {
		await seed(source);
		const report = await run(await fresh(source), target);
		expect(report.failed).toEqual([]);
		const loaded = await fresh(target);
		const alice = must(loaded.characters.find((character) => character.name === "Alice"));
		const dawn = must(loaded.worldbuilding.time?.find((entity) => entity.name === "Dawn"));
		const opening = must(loaded.scenes[0]);

		const notes = await service.stickyNotes.list(loaded);
		expect(notes.map((note) => [note.color, note.body.trim(), note.archived])).toEqual([["macaron-5", "Remember the map.", false]]);
		const tasks = await service.tasks.list(loaded);
		expect(tasks.map((task) => [task.title, task.related[0]?.id])).toEqual([["Fix the tide", alice.characterId]]);
		const view = must((await service.freeform.read(loaded)).views.find((candidate) => candidate.name === "Board"));
		expect(view.placements.map((placement) => placement.resource)).toEqual([
			{ type: "entity", kind: "character", id: alice.characterId, name: "Alice" },
			{ type: "task", id: must(tasks[0]).id, name: "Fix the tide" },
		]);
		expect(view.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
		const lane = must((await service.timeline.read(loaded)).timelines.find((timeline) => timeline.name === "Main lane"));
		expect(lane.binding).toEqual({ kind: "character", id: alice.characterId, name: "Alice" });
		expect(lane.times.map((time) => [time.timeId, time.rows.map((row) => [row.text, row.scenes])])).toEqual([
			[dawn.entityId, [["First light", [opening.sceneId]]]],
		]);
		const sheets = await service.beatSheet.read(loaded);
		const sheet = must(sheets.sheets.find((candidate) => candidate.name === "Three acts"));
		expect(sheet.acts[0]?.beats[0]?.rows.map((row) => [row.text, row.scenes])).toEqual([["Row", [opening.sceneId]]]);
		expect(sheets.templates.map((template) => template.name)).toEqual(["Classic"]);

		// A second run brings nothing twice: every one-shot part is remembered.
		const again = await run(await fresh(source), loaded);
		expect(again.created).toEqual([]);
		expect(again.skipped.filter((item) => item.reason !== "unchanged").map((item) => [item.kind, item.name, item.reason])).toEqual([]);
		expect((await service.stickyNotes.list(await fresh(target))).length).toBe(1);
	});

	it("fills a step's text, leaves it alone while unchanged, and replaces it only under replace", async () => {
		await seed(source);
		const first = await run(await fresh(source), target);
		expect(first.created.filter((item) => item.kind === "step").map((item) => item.name)).toEqual(["1"]);
		let artifact = must(await service.loadArtifact(await fresh(target), 1));
		expect(readMarkedSection(artifact.content, "genre")).toBe("Fantasy");

		const second = await run(await fresh(source), await fresh(target));
		expect(second.skipped.filter((item) => item.kind === "step").map((item) => item.reason)).toEqual(["unchanged"]);

		const sourceArtifact = must(await service.loadArtifact(await fresh(source), 1));
		await service.updateSections(sourceArtifact.path, { genre: "Mystery" }, sourceArtifact.revision);
		await service.updateSections(artifact.path, { genre: "Romance" }, artifact.revision);
		const inspection = await service.importer.inspectSource(await fresh(source), await fresh(target));
		expect(inspection.standing.get("step:1")?.kind).toBe("conflict");
		const kept = await run(await fresh(source), await fresh(target));
		expect(kept.skipped.filter((item) => item.kind === "step").map((item) => item.reason)).toEqual(["name-taken"]);
		artifact = must(await service.loadArtifact(await fresh(target), 1));
		expect(readMarkedSection(artifact.content, "genre")).toBe("Romance");
		const replaced = await run(await fresh(source), await fresh(target), () => false, "replace");
		expect(replaced.replaced.map((item) => item.kind)).toContain("step");
		artifact = must(await service.loadArtifact(await fresh(target), 1));
		expect(readMarkedSection(artifact.content, "genre")).toBe("Mystery");
	});

	it("tells a part the source changed from one edited here, lists what the source lost, and follows a rename", async () => {
		const seeded = await seed(source);
		const first = await run(await fresh(source), target);
		expect(first.failed).toEqual([]);
		const unchanged = await service.importer.inspectSource(await fresh(source), await fresh(target));
		expect(unchanged.standing.get(`character:${seeded.alice.id}`)?.kind).toBe("unchanged");
		expect(unchanged.gone).toEqual([]);

		// The source moves: the copy, untouched, is due an update.
		let sourceAlice = must((await fresh(source)).characters.find((character) => character.name === "Alice"));
		await service.updateCharacter(source, sourceAlice.characterId, { expectedRevision: sourceAlice.revision, motivation: "To find the map." });
		const moved = await service.importer.inspectSource(await fresh(source), await fresh(target));
		expect(moved.standing.get(`character:${seeded.alice.id}`)?.kind).toBe("update");
		// A rename elsewhere in the target rewrites the copy's clause and the scene's time, which is no edit of either.
		const targetDawn = must((await fresh(target)).worldbuilding.time?.find((entity) => entity.name === "Dawn"));
		await service.updateEntity(target, targetDawn.entityId, { expectedRevision: targetDawn.revision, name: "Daybreak" });
		const stillMoved = await service.importer.inspectSource(await fresh(source), await fresh(target));
		expect(stillMoved.standing.get(`character:${seeded.alice.id}`)?.kind).toBe("update");
		expect(stillMoved.standing.get(`scene:${seeded.opening.id}`)?.kind).toBe("unchanged");
		// The renamed copy itself has nothing to take while its source stands still.
		expect(stillMoved.standing.get(`worldbuilding:${seeded.dawn.id}`)?.kind).toBe("unchanged");

		// Both move: a conflict, kept under skip and written over under replace.
		const targetAlice = must((await fresh(target)).characters.find((character) => character.name === "Alice"));
		await service.updateCharacter(target, targetAlice.characterId, { expectedRevision: targetAlice.revision, goal: "Our own goal." });
		const both = await service.importer.inspectSource(await fresh(source), await fresh(target));
		expect(both.standing.get(`character:${seeded.alice.id}`)?.kind).toBe("conflict");
		const kept = await run(await fresh(source), await fresh(target));
		expect(kept.skipped.map((item) => [item.name, item.reason])).toContainEqual(["Alice", "name-taken"]);
		expect(must((await fresh(target)).characters.find((character) => character.name === "Alice")).goal).toBe("Our own goal.");

		// New in the source, gone from the source.
		await service.createCharacter(await fresh(source), { name: "Carol" });
		await service.repository.trashFile(seeded.bob.path);
		const changed = await service.importer.inspectSource(await fresh(source), await fresh(target));
		expect(changed.gone.map((part) => [part.kind, part.name])).toEqual([["character", "Bob"]]);
		const carol = must(changed.parts.find((part) => part.name === "Carol"));
		expect(changed.standing.get(carol.key)).toEqual({ kind: "new" });

		// A rename in the source carries to a copy that follows the source.
		sourceAlice = must((await fresh(source)).characters.find((character) => character.name === "Alice"));
		await service.updateCharacter(source, sourceAlice.characterId, { expectedRevision: sourceAlice.revision, name: "Alicia" });
		const renamed = await run(await fresh(source), await fresh(target), () => false, "replace");
		expect(renamed.replaced.map((item) => [item.name, item.targetName])).toContainEqual(["Alicia", "Alicia"]);
		const loaded = await fresh(target);
		const alicia = must(loaded.characters.find((character) => character.name === "Alicia"));
		expect(alicia.characterId).toBe(targetAlice.characterId);
		expect(alicia.path).toBe(`${target.rootPath}/20_Character/Alicia.md`);
		expect(alicia.motivation).toBe("To find the map.");
		expect(loaded.characters.map((character) => character.name)).toEqual(["Bob", "Alicia", "Carol"]);
	});

	it("replaces a scene whose note the rename before it rewrote", async () => {
		const seeded = await seed(source);
		expect((await run(await fresh(source), target)).failed).toEqual([]);
		// The source renames Alice and edits the scene that casts her: both are due an update, and replacing
		// Alicia first renames the copy's note, which rewrites the scene copy's cast before its own turn.
		const sourceAlice = must((await fresh(source)).characters.find((character) => character.characterId === seeded.alice.id));
		await service.updateCharacter(source, sourceAlice.characterId, { expectedRevision: sourceAlice.revision, name: "Alicia" });
		const sourceOpening = must((await fresh(source)).scenes.find((scene) => scene.sceneId === seeded.opening.id));
		await service.updateScene(source, sourceOpening.sceneId, { expectedRevision: sourceOpening.revision, conflict: "The tide turns twice." });
		const updated = await run(await fresh(source), await fresh(target), () => false, "replace");
		expect(updated.failed).toEqual([]);
		expect(updated.replaced.map((item) => [item.kind, item.targetName])).toEqual(
			expect.arrayContaining([
				["character", "Alicia"],
				["scene", "Opening"],
			]),
		);
		const opening = must((await fresh(target)).scenes.find((scene) => scene.title === "Opening"));
		expect(opening.conflict).toBe("The tide turns twice.");
		expect(opening.characters.some((link) => link.includes("Alicia"))).toBe(true);
	});

	it("fails the thread whose chapter copy cannot be read, and goes on to the rest", async () => {
		await seed(source);
		const inspection = await service.importer.inspectSource(await fresh(source), target);
		// Armed once, as the records begin: the chapters phase reads the copies itself while writing them.
		const chapterOne = service.manuscript.plannedSegmentPath(target, "Chapter One");
		let armed = false;
		const report = await service.importer.runImport(await fresh(source), target, selection(inspection, chapters), {
			onProgress: (progress) => {
				if (progress.phase !== "records" || armed) return;
				armed = true;
				fakeVault.failNextReadPath = chapterOne;
			},
		});
		expect(report.failed.map((item) => [item.kind, item.name])).toEqual([["foreshadowing", "The letter"]]);
		expect(report.created.map((item) => item.kind)).toEqual(
			expect.arrayContaining(["chapter", "revision", "sticky-note", "freeform-view", "timeline", "beat-sheet"]),
		);
	});

	it("lets the book copied from take back what its copy changed, and keeps both records agreeing", async () => {
		const seeded = await seed(source);
		expect((await run(await fresh(source), target)).failed).toEqual([]);
		// Book 2's copy of Alice moves. Book 1 never imported, yet reads Book 2's record from its end: its own Alice is due an update.
		const copy = must((await fresh(target)).characters.find((character) => character.name === "Alice"));
		await service.updateCharacter(target, copy.characterId, { expectedRevision: copy.revision, motivation: "To find the map." });
		const copyKey = `character:${copy.characterId}`;
		const back = await service.importer.inspectSource(await fresh(target), await fresh(source));
		expect(back.standing.get(copyKey)).toEqual({ kind: "update", targetId: seeded.alice.id, targetPath: seeded.alice.path, targetName: "Alice" });
		expect(back.reverse.has(copyKey)).toBe(true);
		const bobCopy = must((await fresh(target)).characters.find((character) => character.name === "Bob"));
		expect(back.standing.get(`character:${bobCopy.characterId}`)?.kind).toBe("unchanged");
		expect(back.gone).toEqual([]);

		// The update writes Book 1's Alice from the copy, in place, and refreshes Book 2's entry about that copy.
		const taken = await service.importer.runImport(await fresh(target), await fresh(source), { parts: new Set([copyKey]), clashPolicy: "replace" });
		expect(taken.failed).toEqual([]);
		expect(taken.replaced.map((item) => [item.name, item.targetName])).toEqual([["Alice", "Alice"]]);
		const original = must((await fresh(source)).characters.find((character) => character.name === "Alice"));
		expect(original.characterId).toBe(seeded.alice.id);
		expect(original.motivation).toBe("To find the map.");
		const theirs = await service.imports.readDocument(await fresh(target));
		const about = must(theirs.entries.find((held) => held.targetId === copy.characterId));
		expect(about.sourceProjectId).toBe(source.id);
		expect(about.sourceId).toBe(seeded.alice.id);
		const ours = await service.imports.readDocument(await fresh(source));
		expect(ours.entries.map((held) => [held.sourceProjectId, held.targetId])).toEqual([[target.id, seeded.alice.id]]);
		// So Book 2 reads its copy as unchanged, not as changed on both sides, and Book 1 has nothing more to take back.
		const forward = await service.importer.inspectSource(await fresh(source), await fresh(target));
		expect(forward.standing.get(`character:${seeded.alice.id}`)?.kind).toBe("unchanged");
		expect(forward.refresh).toEqual([]);
		expect((await service.importer.inspectSource(await fresh(target), await fresh(source))).standing.get(copyKey)?.kind).toBe("unchanged");

		// Both books write the same words by hand: nothing to bring over, the record learns it, and the next move is an update, not a conflict.
		const one = must((await fresh(source)).characters.find((character) => character.name === "Alice"));
		await service.updateCharacter(source, one.characterId, { expectedRevision: one.revision, goal: "The same goal." });
		const two = must((await fresh(target)).characters.find((character) => character.name === "Alice"));
		await service.updateCharacter(target, two.characterId, { expectedRevision: two.revision, goal: "The same goal." });
		const agreed = await service.importer.inspectSource(await fresh(source), await fresh(target));
		expect(agreed.standing.get(`character:${seeded.alice.id}`)?.kind).toBe("unchanged");
		expect(agreed.refresh.map((found) => found.record)).toEqual(["own"]);
		expect((await service.importer.inspectSource(await fresh(source), await fresh(target))).refresh).toEqual([]);
		const three = must((await fresh(source)).characters.find((character) => character.name === "Alice"));
		await service.updateCharacter(source, three.characterId, { expectedRevision: three.revision, goal: "A further goal." });
		expect((await service.importer.inspectSource(await fresh(source), await fresh(target))).standing.get(`character:${seeded.alice.id}`)?.kind).toBe("update");
	});

	const seededPicture = (project: ProjectSnapshot): string | null =>
		[...fakeVault.binaryContents.keys()].find((path) => path.startsWith(`${galleryFolderPath(project, "character")}/`)) ?? null;

	it("records what landed with both hashes even when a picture was refused", async () => {
		await seed(source);
		fakeVault.failNextCreateBinaryPath = `${galleryFolderPath(target, "character")}/portrait.png`;
		const report = await run(await fresh(source), target);
		expect(report.failed.map((item) => [item.kind, item.name])).toEqual([["picture", "portrait.png"]]);
		expect(report.created.some((item) => item.kind === "character")).toBe(true);
		const loaded = await fresh(target);
		expect(loaded.structureIssues).toEqual([]);
		const alice = must(loaded.characters.find((character) => character.name === "Alice"));
		expect(alice.gallery).toEqual([]);
		const document = await service.imports.readDocument(loaded);
		expect(document.entries.some((entry) => entry.kind === "picture")).toBe(false);
		const entry = must(document.entries.find((candidate) => candidate.kind === "character" && candidate.targetName === "Alice"));
		expect(entry.sourceHash).toMatch(/\S/u);
		expect(entry.copyHash).toMatch(/\S/u);
		expect(entry.targetId).toBe(alice.characterId);
		// The run is remembered as one that went by, so the next inspection reads the copies as unchanged.
		const sourceAlice = must((await fresh(source)).characters.find((character) => character.name === "Alice"));
		const again = await service.importer.inspectSource(await fresh(source), loaded);
		expect(again.standing.get(`character:${sourceAlice.characterId}`)?.kind).toBe("unchanged");
		expect(again.standing.get(`picture:${must(seededPicture(source))}`)?.kind).toBe("new");
	});

	it("credits nothing of an import to the author", async () => {
		await seed(source);
		const writes: { path: string; userInput: boolean }[] = [];
		service.repository.onBodyWrite = (path, _before, _after, userInput) => {
			writes.push({ path, userInput });
		};
		const report = await run(await fresh(source), target, chapters);
		expect(report.failed).toEqual([]);
		expect(writes.length).toBeGreaterThan(10);
		expect(writes.filter((write) => write.userInput).map((write) => write.path)).toEqual([]);
		expect(writes.every((write) => write.path.startsWith(`${target.rootPath}/`))).toBe(true);
	});

	it("tells the dialog how a selection comes out without writing anything", async () => {
		await seed(source);
		const inspection = await service.importer.inspectSource(await fresh(source), target);
		const everything = service.importer.plan(inspection, selection(inspection, chapters));
		expect(everything.counts.character).toEqual({ create: 2, replace: 0, skip: 0 });
		expect(everything.counts.chapter.create).toBe(3);
		expect(everything.droppedLinks).toEqual([]);
		const aliceOnly = service.importer.plan(inspection, {
			parts: new Set(inspection.parts.filter((part) => part.kind === "character" && part.name === "Alice").map((part) => part.key)),
			clashPolicy: "skip",
		});
		expect(aliceOnly.counts.character).toEqual({ create: 1, replace: 0, skip: 0 });
		// Bob is linked, not required: offered, never forced.
		expect(aliceOnly.unselectedLinks).toEqual(inspection.parts.filter((part) => part.name === "Bob" || part.name === "Dawn").map((part) => part.key));
		expect(aliceOnly.droppedLinks.map((drop) => drop.link.field)).toEqual(expect.arrayContaining(["record", "record"]));
		expect(fakeVault.contents.has(`${target.rootPath}/20_Character/Alice.md`)).toBe(false);
		expect(fakeVault.getFileByPath(service.imports.importPath(target))).toBeNull();
	});

	it("imports many notes for a few operations each, reading the metadata note only a handful of times", async () => {
		for (let index = 0; index < 50; index += 1) {
			await service.createCharacter(source, {
				name: `Character ${String(index).padStart(2, "0")}`,
				categoryPaths: [`Kin/${index % 2 === 0 ? "Elf" : "Dwarf"}`],
				worldStatus: [statusLine(source, "Injured", `wound ${String(index)}`)],
			});
		}
		const loadedSource = await fresh(source);
		const inspection = await service.importer.inspectSource(loadedSource, target);
		fakeVault.createCalls.length = 0;
		fakeVault.processCalls.length = 0;
		fakeVault.readCalls.length = 0;
		fakeFileManager.frontmatterCalls.length = 0;
		const report = await service.importer.runImport(loadedSource, target, selection(inspection));
		expect(report.failed).toEqual([]);
		expect(report.created.filter((item) => item.kind === "character")).toHaveLength(50);
		const operations = fakeVault.createCalls.length + fakeVault.processCalls.length + fakeFileManager.frontmatterCalls.length;
		expect(operations).toBeLessThanOrEqual(50 * 4 + 20);
		expect(fakeVault.readCalls.filter((path) => path === target.projectFile).length).toBeLessThanOrEqual(3);
		expect((await fresh(target)).characters).toHaveLength(50);
	});
});
