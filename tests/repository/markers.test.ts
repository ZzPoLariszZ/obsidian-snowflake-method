import { describe, expect, it } from "vitest";

import {
  findManagedMarkerIssues,
  getProtectedMarkerRanges,
  inspectManagedDocumentSections,
  inspectMarkedSection,
  readMarkedSection,
  renderMarkedSection,
  replaceMarkedSection,
} from "../../src/templates";

describe("managed Markdown sections", () => {
  it("updates only the bytes inside a unique marker pair", () => {
    const input = `User preface\n\n${renderMarkedSection("plot-synopsis", "Old text")}\n\nUser epilogue`;
    const result = replaceMarkedSection(input, "plot-synopsis", "New **Markdown**");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain("User preface");
    expect(result.content).toContain("User epilogue");
    expect(readMarkedSection(result.content, "plot-synopsis")).toBe("New **Markdown**");
  });

  it("reads a complete multi-paragraph section without truncating it", () => {
    const longParagraph = "完整内容".repeat(120);
    const source = `${longParagraph}\n\n第二个段落保留原有换行。`;
    const note = renderMarkedSection("one-sentence-summary", source);

    const extracted = readMarkedSection(note, "one-sentence-summary");

    expect(extracted).toBe(source);
    expect(extracted?.length).toBeGreaterThan(280);
    expect(extracted).toContain("\n\n第二个段落");
  });

  it("refuses missing, duplicated, and half-present markers", () => {
    expect(
      replaceMarkedSection("ordinary prose", "one-sentence-summary", "replacement").ok,
    ).toBe(false);
    expect(
      inspectMarkedSection(
        "<!-- snowflake:section:one-sentence-summary:start -->",
        "one-sentence-summary",
      ),
    ).toMatchObject({ status: "invalid", code: "missing-end" });
    expect(
      inspectMarkedSection(
        `${renderMarkedSection("one-sentence-summary")}\n${renderMarkedSection("one-sentence-summary")}`,
        "one-sentence-summary",
      ),
    ).toMatchObject({ status: "invalid", code: "duplicate-start" });
  });

  it("treats noncanonical marker-like text as a missing boundary", () => {
    const noncanonical = [
      "<!-- snowflake : section : plot-synopsis : start -->",
      "Draft",
      "<!-- snowflake:section:plot-synopsis:end -->",
    ].join("\n");
    expect(inspectMarkedSection(noncanonical, "plot-synopsis")).toMatchObject({
      status: "invalid",
      code: "missing-start",
    });

    expect(
      findManagedMarkerIssues(noncanonical, ["plot-synopsis"]).some(
        (issue) => issue.code === "missing-start",
      ),
    ).toBe(true);
  });

  it("reports unknown canonical markers without treating them as damage", () => {
    const source = [
      renderMarkedSection("plot-synopsis", "Known"),
      renderMarkedSection("future-section", "Keep this future data"),
    ].join("\n\n");
    const inspection = inspectManagedDocumentSections(
      source,
      ["plot-synopsis"],
      "30_Synopsis/31_Plot_Synopsis.md",
    );
    expect(inspection.sections).toMatchObject([
      {
        status: "present",
        code: null,
        path: "30_Synopsis/31_Plot_Synopsis.md",
        sectionId: "plot-synopsis",
      },
    ]);
    expect(inspection.issues).toContainEqual(
      expect.objectContaining({
        code: "unknown-section",
        sectionId: "future-section",
      }),
    );
    expect(
      inspection.issues.filter((issue) => issue.code !== "unknown-section"),
    ).toEqual([]);
  });

  it("does not invent structural errors for a mistyped unknown section id", () => {
    const source = [
      "<!-- snowflake:section:audiene-reason-1:start -->",
      "<!-- snowflake:section:audience-reason-1:end -->",
    ].join("\n");
    const issues = findManagedMarkerIssues(source, ["audience-reason-1"]);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "missing-start",
        sectionId: "audience-reason-1",
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "unknown-section",
        sectionId: "audiene-reason-1",
      }),
    );
    expect(issues).not.toContainEqual(
      expect.objectContaining({
        code: "missing-end",
        sectionId: "audiene-reason-1",
      }),
    );
  });

  it("ignores exact marker text embedded in prose as a boundary", () => {
    const markers = renderMarkedSection("plot-synopsis", "Draft").split("\n");
    const source = [
      `Do not use ${markers[0]} inline.`,
      "Draft",
      markers[2],
    ].join("\n");

    expect(inspectMarkedSection(source, "plot-synopsis")).toMatchObject({
      status: "invalid",
      code: "missing-start",
    });
    expect(findManagedMarkerIssues(source, ["plot-synopsis"])).toContainEqual(
      expect.objectContaining({
        code: "missing-start",
        sectionId: "plot-synopsis",
      }),
    );
  });

  it("reports overlapping sections with both stable ids", () => {
    const nested = [
      "<!-- snowflake:section:outer:start -->",
      "<!-- snowflake:section:inner:start -->",
      "Inside",
      "<!-- snowflake:section:inner:end -->",
      "<!-- snowflake:section:outer:end -->",
    ].join("\n");

    expect(findManagedMarkerIssues(nested, ["outer", "inner"])).toContainEqual(
      expect.objectContaining({
        code: "overlap",
        sectionId: "inner",
        relatedSectionId: "outer",
      }),
    );
  });

  it("returns complete CRLF line ranges only for canonical marker-only lines", () => {
    const start = "<!-- snowflake:section:plot-synopsis:start -->";
    const end = "<!-- snowflake:section:plot-synopsis:end -->";
    const source = [
      "Preface",
      `  ${start}  `,
      `An inline example ${start} is not protected.`,
      end,
      "After",
    ].join("\r\n");

    const ranges = getProtectedMarkerRanges(source);

    expect(ranges).toHaveLength(2);
    expect(ranges.map((range) => range.boundary)).toEqual(["start", "end"]);
    expect(source.slice(ranges[0]!.from, ranges[0]!.to)).toBe(`  ${start}  \r\n`);
    expect(source.slice(ranges[0]!.markerFrom, ranges[0]!.markerTo)).toBe(start);
    expect(source.slice(ranges[1]!.from, ranges[1]!.to)).toBe(`${end}\r\n`);
  });

  it("preserves CRLF when replacing managed sections", () => {
    const original = [
      "# Scene",
      renderMarkedSection("scene-events", "Old").replaceAll("\n", "\r\n"),
    ].join("\r\n");
    const replaced = replaceMarkedSection(
      original,
      "scene-events",
      "\r\nFirst\r\nSecond\r\n",
    );
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.content.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/u);
    expect(readMarkedSection(replaced.content, "scene-events")).toBe(
      "First\r\nSecond",
    );
  });

  // The tolerant marker pattern is /iu, so its id class also matches characters
  // that case-fold into a-z without lowercasing into it. Those ids used to reach
  // the strict ASCII sectionMarkers() and throw, from inside the scanner that
  // the editor's transaction filter runs on every keystroke.
  it("ignores marker ids that only case-fold into the ASCII id set", () => {
    // U+017F LATIN SMALL LETTER LONG S folds to "s" under /iu but lowercases to
    // itself, so it passed the tolerant pattern and then failed the strict one.
    const longS = "<!-- snowflake:section:teſt:start -->";
    const content = `${longS}\n\n${renderMarkedSection("plot-synopsis", "Body")}\n`;

    expect(() => getProtectedMarkerRanges(content)).not.toThrow();
    expect(() => findManagedMarkerIssues(content, ["plot-synopsis"])).not.toThrow();
    expect(() => readMarkedSection(content, "plot-synopsis")).not.toThrow();

    // The unmatched id is skipped, and the real markers around it still scan.
    expect(
      getProtectedMarkerRanges(content).map((range) => range.sectionId),
    ).toEqual(["plot-synopsis", "plot-synopsis"]);
    expect(readMarkedSection(content, "plot-synopsis")).toBe("Body");
  });
});
