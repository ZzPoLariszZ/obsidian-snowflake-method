import { describe, expect, it } from "vitest";

import type { ProjectWorldbuildingKind } from "../../src/domain";
import { classifyHistoryPath, type HistoryProject } from "../../src/services";

const kind = (
	id: string,
	folderName: string,
	custom = false,
): ProjectWorldbuildingKind => ({ id, folderName, custom, icon: null, description: null });

const project: HistoryProject = {
	id: "project-1",
	worldbuildingKinds: [
		kind("time", "61_Time"),
		kind("location", "62_Location"),
		kind("item", "63_Item"),
		kind("Faction", "64_Faction", true),
	],
};

const typed = (type: string, extra: Record<string, unknown> = {}) => ({
	"snowflake-document": type,
	"snowflake-project-id": "project-1",
	...extra,
});

const classify = (path: string, ...frontmatters: (Record<string, unknown> | null)[]) =>
	classifyHistoryPath(project, path, frontmatters);

describe("what a note is to the history", () => {
	it("takes the document type's word over the folder's", () => {
		// A character note the author filed among the materials is still a
		// character note; the frontmatter is the authority everywhere.
		expect(classify("80_Material/Moved.md", typed("character"))).toEqual({
			path: "80_Material/Moved.md",
			kind: "character",
			documentType: "character",
		});
		expect(classify("20_Character/Twelve.md", typed("scene"))).toEqual({
			path: "20_Character/Twelve.md",
			kind: "scene",
			documentType: "scene",
		});
	});

	it("reads a draft as the manuscript only where the manuscript is read from", () => {
		expect(classify("50_Manuscript/Three.md", typed("draft"))).toEqual({
			path: "50_Manuscript/Three.md",
			kind: "manuscript",
			documentType: "draft",
		});
		// Either language's folder, whatever the project's own language.
		expect(classify("50_正文/三.md", typed("draft"))).toMatchObject({ kind: "manuscript" });
		expect(classify("80_Material/Old draft.md", typed("draft"))).toEqual({
			path: "80_Material/Old draft.md",
			kind: "other",
			documentType: "draft",
		});
	});

	it("names a worldbuilding note's kind from its frontmatter, then its folder", () => {
		expect(
			classify(
				"60_Worldbuilding/64_Faction/Guild.md",
				typed("worldbuilding", { "snowflake-worldbuilding-kind": "Faction" }),
			),
		).toEqual({
			path: "60_Worldbuilding/64_Faction/Guild.md",
			kind: "worldbuilding",
			wbKind: "Faction",
			documentType: "worldbuilding",
		});
		// The key wins over the folder where the two disagree.
		expect(
			classify(
				"60_Worldbuilding/61_Time/Dawn.md",
				typed("worldbuilding", { "snowflake-worldbuilding-kind": "item" }),
			),
		).toMatchObject({ wbKind: "item" });
		// Without the key: the registry's id for the folder, the built-in id
		// for a built-in folder in either language, and the folder's own name
		// for one the registry does not list.
		expect(classify("60_Worldbuilding/64_Faction/Guild.md", typed("worldbuilding"))).toMatchObject({
			wbKind: "Faction",
		});
		expect(classify("60_Worldbuilding/61_Time/Dawn.md", typed("worldbuilding"))).toMatchObject({
			wbKind: "time",
		});
		expect(classify("60_世界观/62_地点/港.md", typed("worldbuilding"))).toMatchObject({
			wbKind: "location",
		});
		expect(classify("60_Worldbuilding/65_Religion/Faith.md", typed("worldbuilding"))).toMatchObject({
			wbKind: "Religion",
		});
		// Straight under the worldbuilding folder, no folder names a kind.
		expect(classify("60_Worldbuilding/Loose.md", typed("worldbuilding"))).toEqual({
			path: "60_Worldbuilding/Loose.md",
			kind: "worldbuilding",
			documentType: "worldbuilding",
		});
	});

	it.each([
		["one-sentence-summary", 1],
		["one-paragraph-summary", 2],
		["plot-synopsis", 4],
		["long-synopsis", 6],
	])("reads a %s note as step %i", (type, step) => {
		expect(classify("10_Summary/Note.md", typed(type))).toEqual({
			path: "10_Summary/Note.md",
			kind: "step",
			step,
			documentType: type,
		});
	});

	it("files the materials, the archive and a type it does not know among the other notes", () => {
		expect(classify("80_Material/Clippings.md", typed("material"))).toEqual({
			path: "80_Material/Clippings.md",
			kind: "other",
			documentType: "material",
		});
		expect(classify("90_Archive/Cut.md", typed("archive"))).toMatchObject({
			kind: "other",
			documentType: "archive",
		});
		expect(classify("20_Character/Ode.md", typed("poem"))).toEqual({
			path: "20_Character/Ode.md",
			kind: "other",
		});
	});

	it.each(["en", "zh-CN"] as const)("falls back to the folder under the %s layout", (locale) => {
		const folders =
			locale === "en"
				? {
						draft: "50_Manuscript",
						characters: "20_Character",
						scenes: "40_Scene",
						worldbuilding: "60_Worldbuilding",
						summaries: "10_Summary",
						materials: "80_Material",
					}
				: {
						draft: "50_正文",
						characters: "20_角色",
						scenes: "40_场景",
						worldbuilding: "60_世界观",
						summaries: "10_概述",
						materials: "80_素材",
					};
		expect(classify(`${folders.draft}/One.md`)).toEqual({ path: `${folders.draft}/One.md`, kind: "manuscript" });
		expect(classify(`${folders.draft}/Part/One.md`)).toMatchObject({ kind: "manuscript" });
		expect(classify(`${folders.characters}/Ada.md`)).toEqual({ path: `${folders.characters}/Ada.md`, kind: "character" });
		expect(classify(`${folders.scenes}/Twelve.md`)).toEqual({ path: `${folders.scenes}/Twelve.md`, kind: "scene" });
		expect(classify(`${folders.worldbuilding}/64_Faction/Guild.md`)).toEqual({
			path: `${folders.worldbuilding}/64_Faction/Guild.md`,
			kind: "worldbuilding",
			wbKind: "Faction",
		});
		expect(classify(`${folders.worldbuilding}/Loose.md`)).toEqual({
			path: `${folders.worldbuilding}/Loose.md`,
			kind: "worldbuilding",
		});
		// No frontmatter says which step a note in the summaries folder is.
		expect(classify(`${folders.summaries}/Note.md`)).toEqual({ path: `${folders.summaries}/Note.md`, kind: "other" });
		expect(classify(`${folders.materials}/Clippings.md`)).toMatchObject({ kind: "other" });
		expect(classify("Loose.md")).toEqual({ path: "Loose.md", kind: "other" });
		// Frontmatter with no type at all is no authority either.
		expect(classify(`${folders.scenes}/Twelve.md`, { aliases: ["XII"] })).toMatchObject({ kind: "scene" });
	});

	it("takes the first frontmatter that declares a type", () => {
		// A version from before the plugin stamped the note has none; what the
		// note says now does.
		expect(classify("80_Material/Moved.md", null, {}, typed("character"), typed("scene"))).toMatchObject({
			kind: "character",
		});
		expect(classify("80_Material/Moved.md", null, null)).toMatchObject({ kind: "other" });
	});

	it.each([
		["a canvas", "40_Scene/Board.canvas", null],
		["a base", "20_Character/Characters.base", null],
		["the metadata note", "00_System/001_Project_Metadata.md", typed("project-metadata")],
		["a template", "00_System/011_Template_One_Sentence_Summary.md", typed("template")],
		["the system folder in Chinese", "00_系统/011_模板_一句话概述.md", null],
		["a sticky note", "70_Tool/72_Task_Management/724_Sticky_Note/1700000000.md", typed("sticky-note")],
		["a stray note under the tool folder", "70_Tool/Notes.md", null],
		["a stray note under the Chinese tool folder", "70_工具/笔记.md", typed("scene")],
		["a definition node", "20_Character/21_Category/Major/Major.md", typed("definition")],
		["a definition node told by its folder alone", "60_Worldbuilding/62_Location/622_World_Status/Open.md", null],
		["a custom field root", "20_Character/24_Custom_Field/Eyes.md", null],
		["a metadata type anywhere", "80_Material/Copy.md", typed("project-metadata")],
		["a definition type anywhere", "80_Material/Copy.md", typed("definition")],
		["a template type anywhere", "80_Material/Copy.md", typed("template")],
		["a sticky note type anywhere", "80_Material/Copy.md", typed("sticky-note")],
		["another project's note", "20_Character/Ada.md", { ...typed("character"), "snowflake-project-id": "project-2" }],
	])("passes over %s", (_what, path, frontmatter) => {
		expect(classify(path, frontmatter)).toBeNull();
	});

	it("lets a note with no project id stand as this project's", () => {
		expect(classify("20_Character/Ada.md", { "snowflake-document": "character" })).toMatchObject({
			kind: "character",
		});
	});
});
