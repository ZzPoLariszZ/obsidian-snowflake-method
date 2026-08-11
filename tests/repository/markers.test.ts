import { describe, expect, it } from "vitest";

import {
  findManagedMarkerIssues,
  getProtectedMarkerRanges,
  insertMarkedSection,
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

  it("keeps a blank line on both sides of quote content and the markers", () => {
    const callout = "> [!info] Overview\n> **Time**: Dawn";
    const rendered = renderMarkedSection("scene-fields", callout);
    // Without the trailing blank, live preview folds the end marker into the
    // rendered callout and it disappears; the leading blank matches it so the
    // framing reads even.
    expect(rendered).toContain(
      "> **Time**: Dawn\n\n<!-- snowflake:section:scene-fields:end -->",
    );
    expect(rendered).toContain(
      "<!-- snowflake:section:scene-fields:start -->\n\n> [!info] Overview",
    );
    expect(readMarkedSection(rendered, "scene-fields")).toBe(`\n${callout}\n`);

    // Writing back what was read reproduces the same bytes.
    const replaced = replaceMarkedSection(
      rendered,
      "scene-fields",
      readMarkedSection(rendered, "scene-fields") ?? "",
    );
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.changed).toBe(false);

    // Prose keeps the tight framing it always had.
    expect(renderMarkedSection("scene-events", "Prose line")).toContain(
      "Prose line\n<!-- snowflake:section:scene-events:end -->",
    );
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

describe("insertMarkedSection", () => {
  const LAYOUT = [
    { id: "scene-fields", heading: "" },
    { id: "scene-events", heading: "## Events" },
    { id: "scene-planning", heading: "## Planning" },
  ];

  it("inserts after the closest earlier section that exists", () => {
    const content = `# Arrival\n\n${renderMarkedSection("scene-fields", "Block")}\n\n## Planning\n\n${renderMarkedSection("scene-planning", "Plan")}`;
    const next = insertMarkedSection(content, LAYOUT, "scene-events", "Gate closes.");

    expect(readMarkedSection(next, "scene-events")).toBe("Gate closes.");
    expect(next.indexOf("snowflake:section:scene-events:start")).toBeGreaterThan(
      next.indexOf("snowflake:section:scene-fields:end"),
    );
    expect(next.indexOf("snowflake:section:scene-events:end")).toBeLessThan(
      next.indexOf("## Planning"),
    );
    expect(next).toContain("## Events\n\n<!-- snowflake:section:scene-events:start -->");
  });

  it("inserts above a later section together with the heading sitting on it", () => {
    const content = `# Arrival\n\n## Events\n\n${renderMarkedSection("scene-events", "Gate closes.")}`;
    const next = insertMarkedSection(content, LAYOUT, "scene-fields", "> Block");

    expect(readMarkedSection(next, "scene-fields")).toBe("\n> Block\n");
    expect(next.indexOf("snowflake:section:scene-fields:end")).toBeLessThan(
      next.indexOf("## Events"),
    );
    expect(next).toContain("# Arrival\n\n<!-- snowflake:section:scene-fields:start -->");
  });

  it("does not move the insertion into a blank run that leads to prose", () => {
    const content = `# Arrival\n\nUser prose stays put.\n\n${renderMarkedSection("scene-events", "Gate")}`;
    const next = insertMarkedSection(content, LAYOUT, "scene-fields", "Block");

    expect(next).toContain(
      "User prose stays put.\n\n<!-- snowflake:section:scene-fields:start -->",
    );
    expect(next).not.toMatch(/\n{3,}/u);
  });

  it("lands after the first heading when the note has no managed sections", () => {
    const next = insertMarkedSection(
      "# Arrival\n\nUser prose.\n",
      LAYOUT,
      "scene-fields",
      "Block",
    );
    expect(next).toContain("# Arrival\n\n<!-- snowflake:section:scene-fields:start -->");
    expect(next).toContain("scene-fields:end -->\n\nUser prose.");
  });

  it("opens the body when there is neither a section nor a title", () => {
    const next = insertMarkedSection("Just prose.\n", LAYOUT, "scene-fields", "Block");
    expect(next.startsWith("<!-- snowflake:section:scene-fields:start -->")).toBe(true);
    expect(next).toContain("Just prose.");
  });

  it("never anchors on a heading inside the frontmatter", () => {
    const content = "---\ntitle: '# Not a title'\n---\nNo body title.\n";
    const bodyStart = content.indexOf("No body title.");
    const next = insertMarkedSection(content, LAYOUT, "scene-fields", "Block", bodyStart);
    expect(
      next.indexOf("snowflake:section:scene-fields:start"),
    ).toBeGreaterThanOrEqual(bodyStart);
  });

  it("emits the layout heading above the inserted markers", () => {
    const next = insertMarkedSection("# Arrival\n", LAYOUT, "scene-planning", "Plan");
    expect(next).toContain("## Planning\n\n<!-- snowflake:section:scene-planning:start -->");
  });

  it("keeps CRLF endings throughout the insertion", () => {
    const content = "# Arrival\r\n\r\nProse.\r\n";
    const next = insertMarkedSection(content, LAYOUT, "scene-fields", "One\nTwo");
    expect(next).toContain(
      "# Arrival\r\n\r\n<!-- snowflake:section:scene-fields:start -->\r\nOne\r\nTwo\r\n<!-- snowflake:section:scene-fields:end -->",
    );
  });

  it("refuses a section the layout does not know", () => {
    expect(() =>
      insertMarkedSection("# Arrival\n", LAYOUT, "unknown-section", "x"),
    ).toThrow(/not part of the layout/u);
  });
});
