import { describe, expect, it } from "vitest";

import { ENTITY_KINDS } from "../../src/domain";
import {
  appendDefinitionPath,
  characterRoleFromCategories,
  characterRoleHeading,
  definitionFileName,
  definitionFileTemplate,
  findDefinitionEntry,
  isValidDefinitionSegment,
  MAX_DEFINITION_DEPTH,
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

  it("refuses a path with more levels than a heading tree can hold", () => {
    const deep = Array.from(
      { length: MAX_DEFINITION_DEPTH + 1 },
      (_, index) => `Level ${index + 1}`,
    ).join("/");
    expect(appendDefinitionPath(sample, deep)).toEqual({
      ok: false,
      code: "too-deep",
      segment: deep,
    });
    // One level shallower is still a path this file can hold.
    const allowed = Array.from(
      { length: MAX_DEFINITION_DEPTH },
      (_, index) => `Level ${index + 1}`,
    ).join("/");
    expect(appendDefinitionPath(sample, allowed).ok).toBe(true);
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
  it("seeds the character category file with the three roles as whole paths", () => {
    const en = parseDefinitionFile(
      definitionFileTemplate("character", "category", "en"),
    );
    expect(en.entries.map((entry) => entry.path)).toEqual([
      "Major",
      "Supporting",
      "Minor",
    ]);
    const zh = parseDefinitionFile(
      definitionFileTemplate("character", "category", "zh-CN"),
    );
    expect(zh.entries.map((entry) => entry.path)).toEqual([
      "主角",
      "配角",
      "次要角色",
    ]);
  });

  it("starts every other kind with an empty tree of its own", () => {
    for (const language of ["en", "zh-CN"] as const) {
      for (const kind of ENTITY_KINDS) {
        for (const id of [
          "category",
          "world-status",
          "relationship",
        ] as const) {
          const template = definitionFileTemplate(kind, id, language);
          const tree = parseDefinitionFile(template);
          expect(tree.duplicates).toEqual([]);
          if (kind === "character") {
            expect(tree.entries.length).toBeGreaterThan(0);
            expect(tree.entries.every((entry) => entry.level === 1)).toBe(true);
          } else {
            expect(tree.entries).toEqual([]);
            expect(template.trim().length).toBeGreaterThan(0);
          }
          expect(definitionFileName(kind, id, language)).not.toContain(" ");
        }
      }
    }
  });

  it("numbers each file after the folder it sits in", () => {
    // The folder's number gives up its trailing zero, or the position is
    // appended when there is none to give up.
    expect(definitionFileName("character", "category", "en")).toBe(
      "21_Category.md",
    );
    expect(definitionFileName("character", "world-status", "en")).toBe(
      "22_World_Status.md",
    );
    expect(definitionFileName("character", "relationship", "en")).toBe(
      "23_Relationship.md",
    );
    expect(definitionFileName("scene", "category", "en")).toBe("41_Category.md");
    expect(definitionFileName("time", "category", "en")).toBe("611_Category.md");
    expect(definitionFileName("location", "world-status", "en")).toBe(
      "622_World_Status.md",
    );
    expect(definitionFileName("item", "relationship", "en")).toBe(
      "633_Relationship.md",
    );
    expect(definitionFileName("character", "world-status", "zh-CN")).toBe(
      "22_状态.md",
    );
    expect(definitionFileName("location", "category", "zh-CN")).toBe(
      "621_类别.md",
    );
  });
});

describe("heading links", () => {
  it("round-trips a category link with its path alias", () => {
    const raw = renderHeadingLink(
      "Novel/20_Character/Category.md",
      "Elf",
      "Race/Elf",
    );
    expect(raw).toBe("[[Novel/20_Character/Category#Elf|Race/Elf]]");
    expect(parseHeadingLink(raw)).toEqual({
      path: "Novel/20_Character/Category",
      heading: "Elf",
      display: "Race/Elf",
    });
    expect(parseHeadingLink("[[No heading link]]")).toBeNull();
    expect(parseHeadingLink(42)).toBeNull();
  });
});

describe("character roles", () => {
  it("names the seeded role heading per language", () => {
    expect(characterRoleHeading("en", "major")).toBe("Major");
    expect(characterRoleHeading("zh-CN", "supporting")).toBe("配角");
  });

  it("reads the role from category links in either language", () => {
    expect(
      characterRoleFromCategories([
        "[[P/20_Character/Category#Elf|Race/Elf]]",
        "[[P/20_Character/Category#Major|Major]]",
      ]),
    ).toBe("major");
    expect(
      characterRoleFromCategories(["[[P/20_角色/类别#配角|配角]]"]),
    ).toBe("supporting");
    expect(characterRoleFromCategories(["[[P/Category#Elf|x]]"])).toBeNull();
    expect(characterRoleFromCategories("not a list")).toBeNull();
  });
});
