import { describe, expect, it } from "vitest";

import {
  characterRoleFromCategories,
  characterRoleName,
  characterStarterNames,
  checkDefinitionPath,
  customFieldRootNameForFolder,
  definitionRootFromValue,
  definitionRootName,
  isValidDefinitionSegment,
  MAX_DEFINITION_DEPTH,
  nodeLink,
  nodeNameFromValue,
  nodeSelfPath,
  parseDefinitionValue,
  taxonomyPathFromTarget,
  taxonomyPathFromValue,
} from "../../src/services/definition-files";

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

  it("reserves the name node notes wore in development", () => {
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
    expect(nodeSelfPath(root, "Race/Elf")).toBe(`${root}/Race/Elf/Elf`);
    expect(nodeLink(root, "Race/Elf")).toBe(
      `[[${root}/Race/Elf/Elf|Race/Elf]]`,
    );
  });

  it("derives the taxonomy path from the target below its root", () => {
    expect(taxonomyPathFromTarget(`${root}/Race/Elf/Elf`, root)).toBe(
      "Race/Elf",
    );
    expect(taxonomyPathFromTarget(`${root}/Race`, root)).toBe("Race");
    expect(taxonomyPathFromTarget(`${root}/Race/Elf/Elf.md`, root)).toBe(
      "Race/Elf",
    );
    expect(taxonomyPathFromTarget("Elsewhere/Race/Race", root)).toBeNull();
    expect(taxonomyPathFromTarget(root, root)).toBeNull();
  });

  it("reads a stored value target first and alias second", () => {
    const raw = nodeLink(root, "Race/Elf");
    expect(taxonomyPathFromValue(raw, root)).toBe("Race/Elf");
    // A rename moved the target: the alias no longer decides.
    expect(
      taxonomyPathFromValue(`[[${root}/Race/Elder/Elder|Race/Elf]]`, root),
    ).toBe("Race/Elder");
    // A target the root cannot explain falls back to the alias.
    expect(
      taxonomyPathFromValue("[[Elsewhere/Race/Elf/Elf|Race/Elf]]", root),
    ).toBe("Race/Elf");
    expect(taxonomyPathFromValue(42, root)).toBeNull();
  });

  it("takes a stored value apart, and refuses a heading link", () => {
    expect(parseDefinitionValue(`[[${root}/Race/Elf/Elf|Race/Elf]]`)).toEqual({
      target: `${root}/Race/Elf/Elf`,
      alias: "Race/Elf",
    });
    // Heading links are not definition values: 0.7.0, the last release
    // before nodes were notes, wrote no definition links at all.
    expect(parseDefinitionValue(`[[${root}.md#Elf|Race/Elf]]`)).toBeNull();
    expect(nodeNameFromValue(`[[${root}/Race/Elf/Elf|Race/Elf]]`)).toBe("Elf");
    expect(definitionRootFromValue(`[[${root}/Race/Elf/Elf|Race/Elf]]`)).toBe(
      `${root}/Race`,
    );
    expect(definitionRootFromValue(`[[${root}/Major/Major|Major]]`)).toBe(root);
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

  it("numbers the template folder as the position after the trees", () => {
    expect(customFieldRootNameForFolder("20_Character", "en")).toBe(
      "24_Custom_Field",
    );
    expect(customFieldRootNameForFolder("40_Scene", "en")).toBe(
      "44_Custom_Field",
    );
    expect(customFieldRootNameForFolder("61_Time", "en")).toBe(
      "614_Custom_Field",
    );
    expect(customFieldRootNameForFolder("62_Location", "en")).toBe(
      "624_Custom_Field",
    );
    expect(customFieldRootNameForFolder("63_Item", "en")).toBe(
      "634_Custom_Field",
    );
    expect(customFieldRootNameForFolder("64_Faction", "en")).toBe(
      "644_Custom_Field",
    );
    expect(customFieldRootNameForFolder("6A_Faction", "en")).toBe(
      "6A4_Custom_Field",
    );
    expect(customFieldRootNameForFolder("62_地点", "zh-CN")).toBe(
      "624_自定义字段",
    );
    // A folder wearing no number offers none to carry down.
    expect(customFieldRootNameForFolder("Faction", "en")).toBe("Custom_Field");
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
        "[[P/20_Character/21_Category/Race/Elf/Elf|Race/Elf]]",
        "[[P/20_Character/21_Category/Major/Major|Major]]",
      ]),
    ).toBe("major");
    expect(
      characterRoleFromCategories(["[[P/20_角色/21_类别/配角/配角|配角]]"]),
    ).toBe("supporting");
    expect(
      characterRoleFromCategories(["[[P/21_Category/Race/Elf/Elf|Race/Elf]]"]),
    ).toBeNull();
    expect(characterRoleFromCategories("not a list")).toBeNull();
  });

  it("does not read a deeper node named after a role as the role", () => {
    // An author is free to file houses under `Houses/Major`: that is an
    // ordinary category, not the author's role choice, in either era.
    expect(
      characterRoleFromCategories([
        "[[P/20_Character/21_Category/Houses/Major/Major|Houses/Major]]",
      ]),
    ).toBeNull();
    expect(
      characterRoleFromCategories([
        "[[P/20_角色/21_类别/家族/配角/配角|家族/配角]]",
      ]),
    ).toBeNull();
    // And a nested namesake never hides the real root role behind it.
    expect(
      characterRoleFromCategories([
        "[[P/20_Character/21_Category/Houses/Major/Major|Houses/Major]]",
        "[[P/20_Character/21_Category/Supporting/Supporting|Supporting]]",
      ]),
    ).toBe("supporting");
  });
});
