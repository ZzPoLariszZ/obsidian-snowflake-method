import { describe, expect, it } from "vitest";
import { normalizePath as normalizeVaultPath } from "obsidian";

import { normalizePath } from "../../src/repository";

describe("the remembered path normaliser", () => {
  const spellings = [
    "Novel/20_Character/Ada.md",
    "/Novel//20_Character///Ada.md/",
    "Novel\\20_Character\\Ada.md",
    "Novel/20 Character/Ada Lovelace.md",
    "钟楼雪/20_人物/阿达.md",
    "café/note.md",
    "",
    "/",
    "a",
  ];

  it("answers every spelling as the app's own function does, the first time and after", () => {
    for (let round = 0; round < 3; round += 1) {
      for (const spelling of spellings) {
        expect(normalizePath(spelling), JSON.stringify(spelling)).toBe(
          normalizeVaultPath(spelling),
        );
      }
    }
  });

  it("goes on answering rightly once it has started over", () => {
    // Past its limit the memo lets everything go and begins again.
    for (let index = 0; index < 45_000; index += 1) {
      const spelling = `Flood//note-${String(index)}.md`;
      if (index % 9_000 === 0) expect(normalizePath(spelling)).toBe(normalizeVaultPath(spelling));
      else normalizePath(spelling);
    }
    for (const spelling of spellings) {
      expect(normalizePath(spelling)).toBe(normalizeVaultPath(spelling));
    }
  });
});
