import { describe, expect, it } from "vitest";

import {
	builtinRuleFor,
	compileHiddenList,
	displayNameOf,
	isExplorerScope,
	isHiddenEntry,
	type ExplorerEntry,
	type ExplorerRules,
} from "../../src/services";

const entry = (path: string, isFolder = false): ExplorerEntry => ({
	path,
	name: path.slice(path.lastIndexOf("/") + 1),
	isFolder,
});

const rules = (overrides: Partial<ExplorerRules> = {}): ExplorerRules => ({
	hidePrefix: true,
	hideFiles: true,
	hideFolders: true,
	hiddenFiles: [],
	hiddenFolders: [],
	...overrides,
});

/** A tree as the explorer would ask after it: children by folder path. */
const treeOf = (paths: readonly string[]): ((folderPath: string) => ExplorerEntry[]) => {
	const folders = new Set<string>();
	for (const path of paths) {
		const segments = path.split("/");
		for (let depth = 1; depth < segments.length; depth++) {
			folders.add(segments.slice(0, depth).join("/"));
		}
	}
	const all = [
		...[...folders].map((path) => entry(path, true)),
		...paths.filter((path) => !folders.has(path)).map((path) => entry(path)),
	];
	return (folderPath) =>
		all.filter(
			(candidate) =>
				candidate.path.startsWith(`${folderPath}/`) &&
				!candidate.path.slice(folderPath.length + 1).includes("/"),
		);
};

describe("display names", () => {
	it("takes the ordering prefix off and nothing more", () => {
		expect(displayNameOf("50_Manuscript", true)).toBe("Manuscript");
		expect(displayNameOf("001_Project_Metadata", true)).toBe("Project_Metadata");
		expect(displayNameOf("6A1_Category", true)).toBe("Category");
		expect(displayNameOf("6A_Guild", true)).toBe("Guild");
		expect(displayNameOf("011_模板_一句话概述", true)).toBe("模板_一句话概述");
		expect(displayNameOf("01_Inbox", true)).toBe("Inbox");
		expect(displayNameOf("1_Draft", true)).toBe("Draft");
	});

	it("leaves a name alone when the prefix is not one, or is all there is, or hiding is off", () => {
		expect(displayNameOf("2026_08_dev_writing_session", true)).toBe("2026_08_dev_writing_session");
		expect(displayNameOf("11_", true)).toBe("11_");
		expect(displayNameOf("Chapter_01", true)).toBe("Chapter_01");
		expect(displayNameOf("Chapter 0001 Dawn", true)).toBe("Chapter 0001 Dawn");
		expect(displayNameOf("50_Manuscript", false)).toBe("50_Manuscript");
	});

	it("knows the two scopes", () => {
		expect(isExplorerScope("projects")).toBe(true);
		expect(isExplorerScope("vault")).toBe(true);
		expect(isExplorerScope("everywhere")).toBe(false);
	});
});

describe("the built-in rules", () => {
	const root = "Snowflake Projects/Novel";

	it("claims the system folder and all it holds, in both languages", () => {
		expect(builtinRuleFor(entry(`${root}/00_System`, true), root)).toBe("folder");
		expect(builtinRuleFor(entry(`${root}/00_System/001_Project_Metadata.md`), root)).toBe("folder");
		expect(builtinRuleFor(entry(`${root}/00_系统/011_模板_一句话概述.md`), root)).toBe("folder");
	});

	it("claims the definition trees under characters, scenes and every worldbuilding kind", () => {
		expect(builtinRuleFor(entry(`${root}/20_Character/21_Category`, true), root)).toBe("folder");
		expect(builtinRuleFor(entry(`${root}/20_Character/21_Category/Major/Major.md`), root)).toBe("folder");
		expect(builtinRuleFor(entry(`${root}/20_Character/24_Custom_Field`, true), root)).toBe("folder");
		expect(builtinRuleFor(entry(`${root}/40_Scene/43_Relationship`, true), root)).toBe("folder");
		expect(builtinRuleFor(entry(`${root}/60_Worldbuilding/62_Location/622_World_Status`, true), root)).toBe("folder");
		expect(builtinRuleFor(entry(`${root}/60_Worldbuilding/64_Faction/641_Category`, true), root)).toBe("folder");
		expect(builtinRuleFor(entry(`${root}/60_Worldbuilding/6A_Guild/6A4_Custom_Field`, true), root)).toBe("folder");
		expect(builtinRuleFor(entry(`${root}/20_角色/21_类别`, true), root)).toBe("folder");
		expect(builtinRuleFor(entry(`${root}/60_世界观/62_地点/624_自定义字段`, true), root)).toBe("folder");
	});

	it("claims the JSON files and the sticky notes under the tool folder, and nothing else there", () => {
		expect(builtinRuleFor(entry(`${root}/70_Tool/72_Task_Management/721_Task/tasks.json`), root)).toBe("file");
		expect(builtinRuleFor(entry(`${root}/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_08_dev_writing_session.json`), root)).toBe("file");
		expect(builtinRuleFor(entry(`${root}/70_Tool/72_Task_Management/724_Sticky_Note/1700000000.md`), root)).toBe("file");
		expect(builtinRuleFor(entry(`${root}/70_工具/73_可视化/733_时间线/timeline.json`), root)).toBe("file");
		expect(builtinRuleFor(entry(`${root}/70_Tool/73_Visualization/733_Timeline/Main.canvas`), root)).toBeNull();
		expect(builtinRuleFor(entry(`${root}/70_Tool/73_Visualization`, true), root)).toBeNull();
		expect(builtinRuleFor(entry(`${root}/70_Tool`, true), root)).toBeNull();
	});

	it("leaves the author's own entries, the project folder and anything outside a project alone", () => {
		expect(builtinRuleFor(entry(`${root}/20_Character/Alice.md`), root)).toBeNull();
		expect(builtinRuleFor(entry(`${root}/20_Character/Characters.base`), root)).toBeNull();
		expect(builtinRuleFor(entry(`${root}/50_Manuscript/Draft.md`), root)).toBeNull();
		expect(builtinRuleFor(entry(`${root}/80_Material`, true), root)).toBeNull();
		expect(builtinRuleFor(entry(`${root}/90_Archive`, true), root)).toBeNull();
		expect(builtinRuleFor(entry(root, true), root)).toBeNull();
		expect(builtinRuleFor(entry("Inbox/00_System/x.json"), null)).toBeNull();
		expect(builtinRuleFor(entry("Other/00_System"), root)).toBeNull();
	});
});

describe("the author's own lists", () => {
	it("reads a name per line, a path when there is a slash, and a star for any run short of a slash", () => {
		const patterns = compileHiddenList(" Scratch.md \n\n/Novel/80_Material/\nDraft*\n20_Character/2*_Category\n..\nbad\\name\na//b\n");
		expect(patterns.map((pattern) => [pattern.source, pattern.byPath])).toEqual([
			["Scratch.md", false],
			["Novel/80_Material", true],
			["Draft*", false],
			["20_Character/2*_Category", true],
		]);
		const [scratch, material, draft, category] = patterns;
		expect(scratch).toBeDefined();
		expect(material).toBeDefined();
		expect(draft).toBeDefined();
		expect(category).toBeDefined();
		if (!scratch || !material || !draft || !category) return;
		expect(scratch.test.test("scratch.MD")).toBe(true);
		expect(material.test.test("Novel/80_Material")).toBe(true);
		expect(material.test.test("Archive/Novel/80_Material")).toBe(true);
		expect(material.test.test("Novel/80_Material/x")).toBe(false);
		expect(draft.test.test("Draft 2.md")).toBe(true);
		expect(draft.test.test("A Draft.md")).toBe(false);
		expect(category.test.test("Novel/20_Character/21_Category")).toBe(true);
		expect(category.test.test("Novel/20_Character/deep/21_Category")).toBe(false);
	});
});

describe("hiding", () => {
	const root = "Novel";
	const tree = treeOf([
		"Novel/00_System/001_Project_Metadata.md",
		"Novel/10_Summary/11_One_Sentence_Summary.md",
		"Novel/20_Character/Alice.md",
		"Novel/20_Character/Characters.base",
		"Novel/20_Character/21_Category/Major/Major.md",
		"Novel/50_Manuscript/Draft.md",
		"Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_08_dev_writing_session.json",
		"Novel/70_Tool/72_Task_Management/721_Task/tasks.json",
		"Novel/70_Tool/72_Task_Management/724_Sticky_Note/1700000000.md",
		"Novel/70_Tool/73_Visualization/733_Timeline/timeline.json",
		"Novel/70_Tool/73_Visualization/733_Timeline/Main.canvas",
		"Novel/80_Material/map.png",
		"Novel/90_Archive",
		"Inbox/00_System/x.json",
		"Inbox/01_Notes/a.md",
	]);
	const hidden = (path: string, isFolder = false, options: ExplorerRules = rules(), projectRoot: string | null = root): boolean =>
		isHiddenEntry(entry(path, isFolder), projectRoot, options, tree);

	it("hides the scaffolding and keeps the author's entries, the bases and the canvases", () => {
		expect(hidden("Novel/00_System", true)).toBe(true);
		expect(hidden("Novel/20_Character/21_Category", true)).toBe(true);
		expect(hidden("Novel/20_Character/21_Category/Major/Major.md")).toBe(true);
		expect(hidden("Novel/70_Tool/72_Task_Management/721_Task/tasks.json")).toBe(true);
		expect(hidden("Novel/70_Tool/72_Task_Management/724_Sticky_Note/1700000000.md")).toBe(true);
		expect(hidden("Novel/10_Summary", true)).toBe(false);
		expect(hidden("Novel/20_Character/Alice.md")).toBe(false);
		expect(hidden("Novel/20_Character/Characters.base")).toBe(false);
		expect(hidden("Novel/50_Manuscript/Draft.md")).toBe(false);
		expect(hidden("Novel/70_Tool/73_Visualization/733_Timeline/Main.canvas")).toBe(false);
	});

	it("hides a folder left with nothing to show, and keeps one that is simply empty", () => {
		expect(hidden("Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026", true)).toBe(true);
		expect(hidden("Novel/70_Tool/71_Data_Statistics", true)).toBe(true);
		expect(hidden("Novel/70_Tool/72_Task_Management", true)).toBe(true);
		expect(hidden("Novel/70_Tool/73_Visualization/733_Timeline", true)).toBe(false);
		expect(hidden("Novel/70_Tool", true)).toBe(false);
		expect(hidden("Novel/90_Archive", true)).toBe(false);
		expect(hidden("Novel/80_Material", true)).toBe(false);
	});

	it("lets each rule be turned off on its own", () => {
		expect(hidden("Novel/00_System", true, rules({ hideFolders: false }))).toBe(false);
		expect(hidden("Novel/70_Tool/72_Task_Management/721_Task/tasks.json", false, rules({ hideFolders: false }))).toBe(true);
		expect(hidden("Novel/70_Tool/72_Task_Management/721_Task", true, rules({ hideFolders: false }))).toBe(false);
		expect(hidden("Novel/70_Tool/72_Task_Management/721_Task/tasks.json", false, rules({ hideFiles: false }))).toBe(false);
		expect(hidden("Novel/70_Tool/72_Task_Management", true, rules({ hideFiles: false }))).toBe(false);
		expect(hidden("Novel/00_System", true, rules({ hideFiles: false }))).toBe(true);
	});

	it("applies only the author's lists outside a project", () => {
		expect(hidden("Inbox/00_System", true, rules(), null)).toBe(false);
		expect(hidden("Inbox/00_System/x.json", false, rules(), null)).toBe(false);
		const listed = rules({
			hiddenFolders: compileHiddenList("00_System"),
			hiddenFiles: compileHiddenList("*.json"),
		});
		expect(hidden("Inbox/00_System", true, listed, null)).toBe(true);
		expect(hidden("Inbox/00_System/x.json", false, listed, null)).toBe(true);
		expect(hidden("Inbox/01_Notes/a.md", false, listed, null)).toBe(false);
		// A file line never hides a folder, and a folder line never hides a file.
		expect(hidden("Inbox/00_System", true, rules({ hiddenFiles: compileHiddenList("00_System") }), null)).toBe(false);
		expect(hidden("Inbox/00_System/x.json", false, rules({ hiddenFolders: compileHiddenList("x.json") }), null)).toBe(false);
	});

	it("remembers one pass's answers so a parent asks after each child once", () => {
		const memo = new Map<string, boolean>();
		expect(isHiddenEntry(entry("Novel/70_Tool", true), root, rules(), tree, memo)).toBe(false);
		expect(memo.get("Novel/70_Tool/72_Task_Management")).toBe(true);
		expect(memo.get("Novel/70_Tool/73_Visualization")).toBe(false);
	});
});
