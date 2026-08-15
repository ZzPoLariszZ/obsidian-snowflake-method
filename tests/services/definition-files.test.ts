import { describe, expect, it } from "vitest";

import {
  appendDefinitionPath,
  characterRoleFromCategories,
  characterRolePath,
  definitionFileName,
  definitionFileTemplate,
  findDefinitionEntry,
  isValidDefinitionSegment,
  parseDefinitionFile,
  parseHeadingLink,
  renderHeadingLink,
} from "../../src/services/definition-files";

const sample = [
  "Intro text.",
  "",
  "# Character",
  "",
  "## Race",
  "",
  "### Elf",
  "",
  "### Dwarf",
  "",
  "## Gender",
  "",
  "# Item",
  "",
].join("\n");

describe("parseDefinitionFile", () => {
  it("reads the heading tree as slash paths", () => {
    const tree = parseDefinitionFile(sample);
    expect(tree.entries.map((entry) => entry.path)).toEqual([
      "Character",
      "Character/Race",
      "Character/Race/Elf",
      "Character/Race/Dwarf",
      "Character/Gender",
      "Item",
    ]);
    expect(tree.duplicates).toEqual([]);
    expect(findDefinitionEntry(tree, "Dwarf")?.path).toBe(
      "Character/Race/Dwarf",
    );
  });

  it("reports duplicate headings anywhere in the file", () => {
    const tree = parseDefinitionFile(
      "# Character\n\n## Elf\n\n# Item\n\n## Elf\n",
    );
    expect(tree.duplicates).toEqual(["Elf"]);
  });

  it("ignores headings inside code fences", () => {
    const tree = parseDefinitionFile("# Real\n\n```\n# Fenced\n```\n");
    expect(tree.entries.map((entry) => entry.heading)).toEqual(["Real"]);
  });
});

describe("appendDefinitionPath", () => {
  it("returns the content unchanged when the path already exists", () => {
    const result = appendDefinitionPath(sample, "Character/Race/Elf");
    expect(result).toEqual({
      ok: true,
      content: sample,
      addedHeadings: [],
    });
  });

  it("appends the missing tail at the end of its parent subtree", () => {
    const result = appendDefinitionPath(sample, "Character/Race/Orc");
    if (!result.ok) throw new Error("expected ok");
    expect(result.addedHeadings).toEqual(["Orc"]);
    const tree = parseDefinitionFile(result.content);
    expect(tree.entries.map((entry) => entry.path)).toEqual([
      "Character",
      "Character/Race",
      "Character/Race/Elf",
      "Character/Race/Dwarf",
      "Character/Race/Orc",
      "Character/Gender",
      "Item",
    ]);
  });

  it("creates a whole new tree at the end of the file", () => {
    const result = appendDefinitionPath(sample, "Location/Region/North");
    if (!result.ok) throw new Error("expected ok");
    expect(result.addedHeadings).toEqual(["Location", "Region", "North"]);
    const tree = parseDefinitionFile(result.content);
    expect(tree.entries[tree.entries.length - 1]?.path).toBe(
      "Location/Region/North",
    );
    expect(result.content.endsWith("\n")).toBe(true);
  });

  it("refuses a segment whose heading already names another path", () => {
    expect(appendDefinitionPath(sample, "Item/Origin/Elf")).toEqual({
      ok: false,
      code: "heading-taken",
      segment: "Elf",
    });
  });

  it("refuses segments that cannot anchor a link", () => {
    expect(appendDefinitionPath(sample, "Character/Ra#ce")).toEqual({
      ok: false,
      code: "invalid-segment",
      segment: "Ra#ce",
    });
    expect(isValidDefinitionSegment("Fine name")).toBe(true);
    expect(isValidDefinitionSegment("bad|name")).toBe(false);
    expect(isValidDefinitionSegment("")).toBe(false);
  });
});

describe("templates", () => {
  it("seeds the category namespaces with the three roles", () => {
    const en = parseDefinitionFile(definitionFileTemplate("category", "en"));
    expect(en.entries.map((entry) => entry.path)).toEqual([
      "Character",
      "Character/Major",
      "Character/Supporting",
      "Character/Minor",
      "Scene",
      "Time",
      "Location",
      "Item",
    ]);
    const zh = parseDefinitionFile(
      definitionFileTemplate("category", "zh-CN"),
    );
    expect(zh.entries.map((entry) => entry.path)).toEqual([
      "角色",
      "角色/主角",
      "角色/配角",
      "角色/次要角色",
      "场景",
      "时间",
      "地点",
      "物品",
    ]);
  });

  it("keeps every starter heading unique and names the files without spaces", () => {
    for (const language of ["en", "zh-CN"] as const) {
      for (const id of ["category", "world-status", "relationship"] as const) {
        const tree = parseDefinitionFile(definitionFileTemplate(id, language));
        expect(tree.duplicates).toEqual([]);
        expect(tree.entries.length).toBeGreaterThan(0);
        expect(definitionFileName(id, language)).not.toContain(" ");
      }
    }
    expect(definitionFileName("world-status", "en")).toBe("World_Status.md");
  });
});

describe("heading links", () => {
  it("round-trips a category link with its path alias", () => {
    const raw = renderHeadingLink(
      "Novel/60_Worldbuilding/Category.md",
      "Elf",
      "Character/Race/Elf",
    );
    expect(raw).toBe(
      "[[Novel/60_Worldbuilding/Category#Elf|Character/Race/Elf]]",
    );
    expect(parseHeadingLink(raw)).toEqual({
      path: "Novel/60_Worldbuilding/Category",
      heading: "Elf",
      display: "Character/Race/Elf",
    });
    expect(parseHeadingLink("[[No heading link]]")).toBeNull();
    expect(parseHeadingLink(42)).toBeNull();
  });
});

describe("character roles", () => {
  it("builds the seeded role path per language", () => {
    expect(characterRolePath("en", "major")).toBe("Character/Major");
    expect(characterRolePath("zh-CN", "supporting")).toBe("角色/配角");
  });

  it("reads the role from category links in either language", () => {
    expect(
      characterRoleFromCategories([
        "[[P/Category#Elf|Character/Race/Elf]]",
        "[[P/Category#Major|Character/Major]]",
      ]),
    ).toBe("major");
    expect(
      characterRoleFromCategories(["[[P/类别#配角|角色/配角]]"]),
    ).toBe("supporting");
    expect(characterRoleFromCategories(["[[P/Category#Elf|x]]"])).toBeNull();
    expect(characterRoleFromCategories("not a list")).toBeNull();
  });
});
