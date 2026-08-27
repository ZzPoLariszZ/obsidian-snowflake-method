import { describe, expect, it } from "vitest";

import { pluginWrittenRanges } from "../../src/templates";

const characterBody = [
  "# Alice",
  "",
  "<!-- snowflake:section:character-fields:start -->",
  "",
  "> [!info] Character overview",
  "> **Aliases**: Amy",
  "",
  "<!-- snowflake:section:character-fields:end -->",
  "",
  "Free prose after the block.",
].join("\n");

describe("plugin-written ranges", () => {
  it("bounds the generated block of a managed note", () => {
    const ranges = pluginWrittenRanges(characterBody, "character");
    expect(ranges).toHaveLength(1);
    const stretch = characterBody.slice(ranges[0]?.from, ranges[0]?.to);
    expect(stretch).toContain("[!info] Character overview");
    expect(stretch).not.toContain("Free prose");
  });

  it("sets nothing aside for a note of unknown type", () => {
    expect(pluginWrittenRanges(characterBody, null)).toEqual([]);
  });

  it("sets nothing aside in a chapter, which carries no managed sections", () => {
    expect(pluginWrittenRanges("Alice walked on.", "draft")).toEqual([]);
  });

  it("skips a section the note does not carry", () => {
    expect(pluginWrittenRanges("just prose", "character")).toEqual([]);
  });
});
