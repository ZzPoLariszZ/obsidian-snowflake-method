import { describe, expect, it } from "vitest";

import {
  characterRoleFromCategories,
  characterRoleName,
  characterStarterNames,
  checkDefinitionPath,
  definitionProseByPath,
  definitionRootFromValue,
  definitionRootName,
  isValidDefinitionSegment,
  legacyDefinitionFileName,
  MAX_DEFINITION_DEPTH,
  nodeLink,
  nodeNameFromValue,
  nodeSelfPath,
  parseDefinitionFile,
  parseDefinitionValue,
  taxonomyPathFromTarget,
  taxonomyPathFromValue,
} from "../../src/services/definition-files";

const sample = [
  "Intro text.",
  "",
  "# Character",
  "",
  "## Race",
  "",
  "Elves and dwarves live here.",
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
  });

  it("ignores headings inside code fences", () => {
    const tree = parseDefinitionFile("# Real\n\n```\n# Fenced\n```\n");
    expect(tree.entries.map((entry) => entry.heading)).toEqual(["Real"]);
  });

  it("maps each heading's prose to its path and leaves the intro behind", () => {
    const prose = definitionProseByPath(sample);
    expect(prose.get("Character/Race")).toBe("Elves and dwarves live here.");
    expect(prose.has("Character")).toBe(false);
    expect([...prose.keys()]).toEqual(["Character/Race"]);
  });
});

describe("checkDefinitionPath", () => {
  it("splits a typed path into trimmed segments", () => {
    expect(checkDefinitionPath(" Race / Elf ")).toEqual({
      ok: true,
      segments: ["Race", "Elf"],
    });
  });

  it("holds the line at the depth cap for managing", () => {
    const levels = (count: number): string =>
      Array.from({ length: count }, (_, index) => `Level ${index + 1}`).join(
        "/",
      );
    expect(checkDefinitionPath(levels(MAX_DEFINITION_DEPTH)).ok).toBe(true);
    expect(checkDefinitionPath(levels(MAX_DEFINITION_DEPTH + 1))).toEqual({
      ok: false,
      code: "too-deep",
      segment: levels(MAX_DEFINITION_DEPTH + 1),
    });
  });

  it("refuses segments no folder can be named after", () => {
    expect(checkDefinitionPath("Race/El:f")).toEqual({
      ok: false,
      code: "invalid-segment",
      segment: "El:f",
    });
    expect(checkDefinitionPath("")).toEqual({
      ok: false,
      code: "invalid-segment",
      segment: "",
    });
    expect(isValidDefinitionSegment("Fine name")).toBe(true);
    expect(isValidDefinitionSegment("bad|name")).toBe(false);
    expect(isValidDefinitionSegment("bad#name")).toBe(false);
    expect(isValidDefinitionSegment(".hidden")).toBe(false);
    expect(isValidDefinitionSegment("")).toBe(false);
  });

  it("reserves the node file's own name", () => {
    expect(isValidDefinitionSegment("_self")).toBe(false);
    expect(isValidDefinitionSegment("_SELF")).toBe(false);
    expect(checkDefinitionPath("Race/_self")).toEqual({
      ok: false,
      code: "invalid-segment",
      segment: "_self",
    });
  });
});

describe("node links", () => {
  const root = "Novel/20_Character/21_Category";

  it("links the node's own note with the taxonomy path as alias", () => {
    expect(nodeSelfPath(root, "Race/Elf")).toBe(`${root}/Race/Elf/_self`);
    expect(nodeLink(root, "Race/Elf")).toBe(
      `[[${root}/Race/Elf/_self|Race/Elf]]`,
    );
  });

  it("derives the taxonomy path from the target below its root", () => {
    expect(taxonomyPathFromTarget(`${root}/Race/Elf/_self`, root)).toBe(
      "Race/Elf",
    );
    expect(taxonomyPathFromTarget(`${root}/Race`, root)).toBe("Race");
    expect(taxonomyPathFromTarget(`${root}/Race/Elf/_self.md`, root)).toBe(
      "Race/Elf",
    );
    expect(taxonomyPathFromTarget("Elsewhere/Race/_self", root)).toBeNull();
    expect(taxonomyPathFromTarget(root, root)).toBeNull();
  });

  it("reads a stored value target first and alias second", () => {
    const raw = nodeLink(root, "Race/Elf");
    expect(taxonomyPathFromValue(raw, root)).toBe("Race/Elf");
    // A rename moved the target: the alias no longer decides.
    expect(
      taxonomyPathFromValue(`[[${root}/Race/Elder/_self|Race/Elf]]`, root),
    ).toBe("Race/Elder");
    // A target the root cannot explain falls back to the alias.
    expect(
      taxonomyPathFromValue("[[Elsewhere/Race/Elf/_self|Race/Elf]]", root),
    ).toBe("Race/Elf");
    expect(taxonomyPathFromValue(42, root)).toBeNull();
  });

  it("still reads the legacy heading form by its alias", () => {
    expect(
      taxonomyPathFromValue("[[Novel/20_Character/21_Category#Elf|Race/Elf]]", root),
    ).toBe("Race/Elf");
    expect(
      taxonomyPathFromValue("[[Novel/20_Character/21_Category#Elf]]", root),
    ).toBe("Elf");
  });

  it("takes a stored value apart whichever era wrote it", () => {
    expect(parseDefinitionValue(`[[${root}/Race/Elf/_self|Race/Elf]]`)).toEqual(
      { target: `${root}/Race/Elf/_self`, alias: "Race/Elf", legacyHeading: null },
    );
    expect(parseDefinitionValue(`[[${root}.md#Elf|Race/Elf]]`)).toEqual({
      target: root,
      alias: "Race/Elf",
      legacyHeading: "Elf",
    });
    expect(nodeNameFromValue(`[[${root}/Race/Elf/_self|Race/Elf]]`)).toBe("Elf");
    expect(nodeNameFromValue(`[[${root}#Elf|Race/Elf]]`)).toBe("Elf");
    expect(definitionRootFromValue(`[[${root}/Race/Elf/_self|Race/Elf]]`)).toBe(
      `${root}/Race`,
    );
    expect(definitionRootFromValue(`[[${root}/Major/_self|Major]]`)).toBe(root);
    expect(definitionRootFromValue(`[[${root}#Major|Major]]`)).toBe(root);
  });
});

describe("root names", () => {
  it("numbers each root after the folder it sits in", () => {
    // The folder's number gives up its trailing zero, or the position is
    // appended when there is none to give up.
    expect(definitionRootName("character", "category", "en")).toBe(
      "21_Category",
    );
    expect(definitionRootName("character", "world-status", "en")).toBe(
      "22_World_Status",
    );
    expect(definitionRootName("character", "relationship", "en")).toBe(
      "23_Relationship",
    );
    expect(definitionRootName("scene", "category", "en")).toBe("41_Category");
    expect(definitionRootName("time", "category", "en")).toBe("611_Category");
    expect(definitionRootName("location", "world-status", "en")).toBe(
      "622_World_Status",
    );
    expect(definitionRootName("item", "relationship", "en")).toBe(
      "633_Relationship",
    );
    expect(definitionRootName("character", "world-status", "zh-CN")).toBe(
      "22_状态",
    );
    expect(definitionRootName("location", "category", "zh-CN")).toBe(
      "621_类别",
    );
  });

  it("names the file the same tree lived in before folders", () => {
    expect(legacyDefinitionFileName("character", "category", "en")).toBe(
      "21_Category.md",
    );
    expect(legacyDefinitionFileName("time", "relationship", "zh-CN")).toBe(
      "613_关系.md",
    );
  });
});

describe("character roles", () => {
  it("names the seeded role node per language", () => {
    expect(characterRoleName("en", "major")).toBe("Major");
    expect(characterRoleName("zh-CN", "supporting")).toBe("配角");
  });

  it("seeds the character trees and only them", () => {
    expect(characterStarterNames("en", "category")).toEqual([
      "Major",
      "Supporting",
      "Minor",
    ]);
    expect(characterStarterNames("zh-CN", "category")).toEqual([
      "主角",
      "配角",
      "次要角色",
    ]);
    expect(characterStarterNames("en", "world-status")).toContain("Injured");
    expect(characterStarterNames("en", "relationship")).toContain("Family");
  });

  it("reads the role from category links of either era and language", () => {
    expect(
      characterRoleFromCategories([
        "[[P/20_Character/21_Category/Race/Elf/_self|Race/Elf]]",
        "[[P/20_Character/21_Category/Major/_self|Major]]",
      ]),
    ).toBe("major");
    expect(
      characterRoleFromCategories(["[[P/20_Character/21_Category#Major|Major]]"]),
    ).toBe("major");
    expect(
      characterRoleFromCategories(["[[P/20_角色/21_类别/配角/_self|配角]]"]),
    ).toBe("supporting");
    expect(
      characterRoleFromCategories(["[[P/21_Category/Race/Elf/_self|Race/Elf]]"]),
    ).toBeNull();
    expect(characterRoleFromCategories("not a list")).toBeNull();
  });

  it("does not read a deeper node named after a role as the role", () => {
    // An author is free to file houses under `Houses/Major`: that is an
    // ordinary category, not the author's role choice, in either era.
    expect(
      characterRoleFromCategories([
        "[[P/20_Character/21_Category/Houses/Major/_self|Houses/Major]]",
      ]),
    ).toBeNull();
    expect(
      characterRoleFromCategories([
        "[[P/20_Character/21_Category#Major|Houses/Major]]",
      ]),
    ).toBeNull();
    expect(
      characterRoleFromCategories([
        "[[P/20_角色/21_类别/家族/配角/_self|家族/配角]]",
      ]),
    ).toBeNull();
    // And a nested namesake never hides the real root role behind it.
    expect(
      characterRoleFromCategories([
        "[[P/20_Character/21_Category/Houses/Major/_self|Houses/Major]]",
        "[[P/20_Character/21_Category/Supporting/_self|Supporting]]",
      ]),
    ).toBe("supporting");
  });
});
