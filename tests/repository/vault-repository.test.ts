import { beforeEach, describe, expect, it } from "vitest";

import { SCHEMA_VERSION, fingerprint } from "../../src/domain";
import {
  ConcurrentChangeError,
  InvalidManagedDocumentError,
  ManagedFileNotFoundError,
  PathConflictError,
  UnsupportedSchemaError,
  VaultRepository,
  parseMarkdownFrontmatter,
} from "../../src/repository";
import { renderMarkedSection } from "../../src/templates";
import { createFakeEnvironment, type FakeFileManager, type FakeVault } from "../helpers/fake-vault";

describe("VaultRepository", () => {
  let fakeVault: FakeVault;
  let fakeFileManager: FakeFileManager;
  let repository: VaultRepository;

  beforeEach(() => {
    const environment = createFakeEnvironment();
    fakeVault = environment.fakeVault;
    fakeFileManager = environment.fakeFileManager;
    repository = new VaultRepository(
      environment.vault,
      environment.fileManager,
      environment.metadataCache,
    );
  });

  it("creates folders and managed files through Vault and processFrontMatter", async () => {
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Projects/Novel/10_Summary/11_One_Sentence_Summary.md",
      template: {
        body: `# One-Sentence Summary\n\n${renderMarkedSection("one-sentence-summary")}\n`,
        sections: [],
      },
      frontmatter: {
        "snowflake-document": "one-sentence-summary",
        "snowflake-project-id": "project-1",
      },
    });

    expect(created.path).toBe("Projects/Novel/10_Summary/11_One_Sentence_Summary.md");
    expect(fakeFileManager.frontmatterCalls).toEqual([created.path]);
    const record = await repository.readManaged(created.path);
    expect(record.frontmatter["snowflake-schema"]).toBe(SCHEMA_VERSION);
    expect(record.body).toContain("# One-Sentence Summary");
  });

  it("tells a managed note's observers once, with the note as it stands", async () => {
    const created: [string, string, boolean][] = [];
    const bodies: [string, string, string, boolean][] = [];
    repository.onManagedFileCreated = (path, content, userInput) => {
      created.push([path, content, userInput]);
    };
    repository.onBodyWrite = (path, before, after, userInput) => {
      bodies.push([path, before, after, userInput]);
    };

    const made = await repository.createManagedFile({
      userInput: true,
      path: "Projects/Novel/20_Character/Ada.md",
      template: { body: "# Ada\n", sections: [] },
      frontmatter: {
        "snowflake-document": "character",
        "snowflake-project-id": "project-1",
      },
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.[0]).toBe(made.path);
    expect(created[0]?.[2]).toBe(true);
    // Both observers see the one read, the note as it stands after its frontmatter.
    const content = created[0]?.[1] ?? "";
    expect(bodies).toEqual([[made.path, "", content, true]]);
    expect(parseMarkdownFrontmatter(content).frontmatter["snowflake-document"]).toBe("character");
    expect(content).toContain("# Ada");
  });

  it("renames and trashes folders with their whole subtrees", async () => {
    await fakeVault.seedFile("Novel/21_Category/Race/_self.md", "race");
    await fakeVault.seedFile("Novel/21_Category/Race/Elf/_self.md", "elf");

    await repository.renameFolder(
      "Novel/21_Category/Race",
      "Novel/21_Category/Kind",
    );
    expect(fakeVault.contents.has("Novel/21_Category/Kind/_self.md")).toBe(true);
    expect(fakeVault.contents.has("Novel/21_Category/Kind/Elf/_self.md")).toBe(
      true,
    );
    expect(fakeVault.contents.has("Novel/21_Category/Race/_self.md")).toBe(
      false,
    );
    expect(fakeFileManager.renameCalls).toEqual([
      { from: "Novel/21_Category/Race", to: "Novel/21_Category/Kind" },
    ]);

    // A destination already standing is a conflict, never an overwrite.
    await fakeVault.seedFile("Novel/21_Category/Old/_self.md", "old");
    await expect(
      repository.renameFolder("Novel/21_Category/Kind", "Novel/21_Category/Old"),
    ).rejects.toThrow(PathConflictError);

    await repository.trashFolder("Novel/21_Category/Kind");
    expect(fakeVault.contents.has("Novel/21_Category/Kind/_self.md")).toBe(
      false,
    );
    expect(fakeVault.contents.has("Novel/21_Category/Kind/Elf/_self.md")).toBe(
      false,
    );
    expect(fakeVault.getAbstractFileByPath("Novel/21_Category/Kind/Elf")).toBeNull();
    expect(fakeVault.contents.has("Novel/21_Category/Old/_self.md")).toBe(true);
    await expect(repository.trashFolder("Novel/21_Category/Kind")).rejects.toThrow(
      ManagedFileNotFoundError,
    );
  });

  it("uses a safe suffix and never overwrites a conflicting file", async () => {
    await fakeVault.seedFile("Characters/Ada.md", "personal note");
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Characters/Ada.md",
      uniqueOnConflict: true,
      template: { body: "# Ada\n", sections: [] },
      frontmatter: {
        "snowflake-document": "character",
        "snowflake-project-id": "project-1",
      },
    });

    expect(created.path).toBe("Characters/Ada (2).md");
    expect(fakeVault.contents.get("Characters/Ada.md")).toBe("personal note");
  });

  it("suffixes an invalid-YAML collision instead of touching or parsing it", async () => {
    const original = "---\n: invalid: yaml\n---\nPrivate notes";
    await fakeVault.seedFile("10_Summary/11_One_Sentence_Summary.md", original);
    const ensured = await repository.ensureManagedFile({
      userInput: false,
      path: "10_Summary/11_One_Sentence_Summary.md",
      uniqueOnConflict: true,
      template: { body: "# One-Sentence Summary\n", sections: [] },
      frontmatter: {
        "snowflake-document": "one-sentence-summary",
        "snowflake-project-id": "project-1",
      },
    });

    expect(ensured.path).toBe("10_Summary/11_One_Sentence_Summary (2).md");
    expect(fakeVault.contents.get("10_Summary/11_One_Sentence_Summary.md")).toBe(original);
  });

  it("rejects frontmatter and section writes for a newer schema", async () => {
    const file = await fakeVault.seedFile(
      "Future.md",
      `---\n${JSON.stringify({
        "snowflake-schema": SCHEMA_VERSION + 1,
        "snowflake-document": "one-sentence-summary",
        "snowflake-project-id": "p",
      })}\n---\n${renderMarkedSection("one-sentence-summary", "future")}`,
    );

    await expect(repository.updateFrontmatter(file.path, { title: "No" })).rejects.toBeInstanceOf(
      UnsupportedSchemaError,
    );
    await expect(
      repository.updateSection(file.path, "one-sentence-summary", "No", {
        userInput: false,
      }),
    ).rejects.toBeInstanceOf(
      UnsupportedSchemaError,
    );
    expect(fakeVault.contents.get(file.path)).toContain("future");
  });

  it("treats an explicitly invalid schema as read-only instead of repairing through it", async () => {
    const file = await fakeVault.seedFile(
      "Invalid.md",
      `---\n${JSON.stringify({
        "snowflake-schema": "not-a-version",
        "snowflake-document": "one-sentence-summary",
        "snowflake-project-id": "p",
      })}\n---\n${renderMarkedSection("one-sentence-summary", "keep me")}`,
    );

    expect((await repository.readManaged(file.path)).readOnly).toBe(true);
    await expect(
      repository.updateSection(file.path, "one-sentence-summary", "replace", {
        userInput: false,
      }),
    ).rejects.toBeInstanceOf(InvalidManagedDocumentError);
    expect(fakeVault.contents.get(file.path)).toContain("keep me");
  });

  it("does not allow a frontmatter patch to upgrade its own schema", async () => {
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Current.md",
      template: { body: "# Current\n", sections: [] },
      frontmatter: {
        "snowflake-document": "project-metadata",
        "snowflake-project-id": "current",
      },
    });

    await expect(
      repository.updateFrontmatter(created.path, { "snowflake-schema": SCHEMA_VERSION + 1 }),
    ).rejects.toBeInstanceOf(UnsupportedSchemaError);
    expect((await repository.readManaged(created.path)).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("reports only the revisions inside an atomic frontmatter write across external edits", async () => {
    const body = "\n# Scene\n\nUser prose with trailing spaces.  \n\n";
    const file = await fakeVault.seedFile(
      "Ranked scene.md",
      `---\nsnowflake-schema: ${SCHEMA_VERSION}\nsnowflake-rank: 1024\ncustom: keep\n---\n${body}`,
    );
    const initial = fakeVault.contents.get(file.path)!;
    const externalBefore = `${initial}External edit before the rank write.\n`;
    const originalProcess = fakeVault.process.bind(fakeVault);
    let processed = "";
    fakeVault.process = async (target, callback) => {
      fakeVault.contents.set(target.path, externalBefore);
      processed = await originalProcess(target, callback);
      fakeVault.contents.set(target.path, `${processed}External edit after the rank write.\n`);
      return processed;
    };

    const revisions = await repository.updateFrontmatterWithRevision(file.path, {
      "snowflake-rank": 2048,
    });

    expect(revisions).toEqual({
      before: fingerprint(externalBefore),
      after: fingerprint(processed),
    });
    expect(revisions.before).not.toBe(fingerprint(initial));
    expect(revisions.after).not.toBe(fingerprint(fakeVault.contents.get(file.path)));
    expect(parseMarkdownFrontmatter(processed)).toMatchObject({
      frontmatter: { "snowflake-rank": 2048, custom: "keep" },
      body: `${body}External edit before the rank write.\n`,
    });
    expect(fakeVault.processCalls).toEqual([file.path]);
    expect(fakeFileManager.frontmatterCalls).toEqual([]);
  });

  it.each([
    { bom: "", newline: "\n", closingNewline: "\n", body: "\n# Scene\n\nProse.  \n" },
    { bom: "\uFEFF", newline: "\r\n", closingNewline: "\r\n", body: "\r\n# Scene\r\n\r\nProse.  \r\n" },
    { bom: "\uFEFF", newline: "\r\n", closingNewline: "\n", body: "\n# Mixed endings\r\nKeep these bytes.\n" },
    { bom: "\uFEFF", newline: "\r\n", closingNewline: "", body: "" },
  ])("preserves frontmatter fences and body bytes in a revision-tracked rank write: $newline / $closingNewline", async ({ bom, newline, closingNewline, body }) => {
    const opening = `${bom}--- \t${newline}`;
    const closing = `${newline}---\t ${closingNewline}`;
    const yaml = `snowflake-schema: ${SCHEMA_VERSION}${newline}snowflake-rank: 1024${newline}custom: keep`;
    const original = `${opening}${yaml}${closing}${body}`;
    const file = await fakeVault.seedFile("Preserved rank.md", original);

    const revisions = await repository.updateFrontmatterWithRevision(file.path, { "snowflake-rank": 2048 });

    const expected = `${opening}${yaml.replace("1024", "2048")}${closing}${body}`;
    expect(fakeVault.contents.get(file.path)).toBe(expected);
    expect(parseMarkdownFrontmatter(expected).body).toBe(body);
    expect(revisions).toEqual({ before: fingerprint(original), after: fingerprint(expected) });
  });

  it.each([
    { schema: SCHEMA_VERSION + 1, patch: { "snowflake-rank": 2048 }, error: UnsupportedSchemaError },
    { schema: "invalid", patch: { "snowflake-rank": 2048 }, error: InvalidManagedDocumentError },
    { schema: SCHEMA_VERSION, patch: { "snowflake-schema": SCHEMA_VERSION + 1 }, error: UnsupportedSchemaError },
  ])("rejects unsafe schemas in revision-tracked frontmatter writes: $schema / $patch", async ({ schema, patch, error }) => {
    const original = `---\n${JSON.stringify({ "snowflake-schema": schema, "snowflake-rank": 1024 })}\n---\nKeep this body.\n`;
    const file = await fakeVault.seedFile("Protected rank.md", original);

    await expect(repository.updateFrontmatterWithRevision(file.path, patch)).rejects.toBeInstanceOf(error);

    expect(fakeVault.contents.get(file.path)).toBe(original);
    expect(fakeVault.processCalls).toEqual([]);
    expect(fakeFileManager.frontmatterCalls).toEqual([]);
  });

  it("reports missing sections without changing the original note", async () => {
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Scene.md",
      template: { body: "# Scene\n\nUser notes.\n", sections: [] },
      frontmatter: {
        "snowflake-document": "scene",
        "snowflake-project-id": "project-1",
      },
    });
    const before = fakeVault.contents.get(created.path);
    const processCount = fakeVault.processCalls.length;
    const result = await repository.checkSections(created.path, [
      { id: "scene-planning", heading: "## Scene Planning" },
    ]);

    expect(result.unchanged).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ sectionId: "scene-planning", code: "missing" }),
    ]);
    expect(fakeVault.contents.get(created.path)).toBe(before);
    expect(fakeVault.processCalls).toHaveLength(processCount);
  });

  it("reports only the sections affected by an overlapping layout as conflicts", async () => {
    const source = [
      "# Sections",
      "<!-- snowflake:section:outer:start -->",
      "<!-- snowflake:section:inner:start -->",
      "Nested",
      "<!-- snowflake:section:inner:end -->",
      "<!-- snowflake:section:outer:end -->",
      renderMarkedSection("healthy", "Keep"),
    ].join("\n");
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Precise conflicts.md",
      template: { body: source, sections: [] },
      frontmatter: {
        "snowflake-document": "scene",
        "snowflake-project-id": "project-1",
      },
    });

    const repair = await repository.checkSections(created.path, [
      { id: "outer", heading: "## Outer" },
      { id: "inner", heading: "## Inner" },
      { id: "healthy", heading: "## Healthy" },
    ]);

    expect(repair.conflicts.map((entry) => entry.sectionId).sort()).toEqual([
      "inner",
      "outer",
    ]);
    expect(repair.unchanged).toEqual(["healthy"]);
  });

  it("reports a missing canonical boundary without changing the note", async () => {
    const noncanonical = [
      "# Plot synopsis",
      "<!-- snowflake : section : plot-synopsis : start -->",
      "User synopsis.",
      "<!-- snowflake:section:plot-synopsis:end -->",
      "",
    ].join("\n");
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Noncanonical synopsis.md",
      template: { body: noncanonical, sections: [] },
      frontmatter: {
        "snowflake-document": "plot-synopsis",
        "snowflake-project-id": "project-1",
      },
    });
    const before = fakeVault.contents.get(created.path);

    const repair = await repository.checkSections(created.path, [
      { id: "plot-synopsis", heading: "## Plot Synopsis" },
    ]);

    expect(repair.conflicts).toEqual([
      expect.objectContaining({
        sectionId: "plot-synopsis",
        markerSectionId: "plot-synopsis",
        code: "missing-start",
      }),
    ]);
    expect(fakeVault.contents.get(created.path)).toBe(before);
  });

  it("preserves a valid unknown section while reporting a missing known section", async () => {
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Future scene.md",
      template: {
        body: `# Scene\n\n${renderMarkedSection("future-section", "Future data")}\n`,
        sections: [],
      },
      frontmatter: {
        "snowflake-document": "scene",
        "snowflake-project-id": "project-1",
      },
    });

    const before = fakeVault.contents.get(created.path);
    const repair = await repository.checkSections(created.path, [
      { id: "scene-planning", heading: "## Scene Planning" },
    ]);

    expect(repair.unchanged).toEqual([]);
    expect(repair.conflicts).toEqual([
      expect.objectContaining({ sectionId: "scene-planning", code: "missing" }),
    ]);
    expect(fakeVault.contents.get(created.path)).toBe(before);
  });

  it("checks marker damage without entering a Vault.process write cycle", async () => {
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Concurrent repair.md",
      template: { body: "# Scene\n\nUser prose.\n", sections: [] },
      frontmatter: {
        "snowflake-document": "scene",
        "snowflake-project-id": "project-1",
      },
    });
    const concurrentNestedLayout = [
      "<!-- snowflake:section:outer:start -->",
      "<!-- snowflake:section:inner:start -->",
      "Concurrent data",
      "<!-- snowflake:section:inner:end -->",
      "<!-- snowflake:section:outer:end -->",
    ].join("\n");
    const originalProcess = fakeVault.process.bind(fakeVault);
    let injected = false;
    fakeVault.process = async (file, callback) => {
      if (!injected) {
        injected = true;
        const current = fakeVault.contents.get(file.path) ?? "";
        fakeVault.contents.set(file.path, `${current}\n${concurrentNestedLayout}\n`);
      }
      return originalProcess(file, callback);
    };

    const repair = await repository.checkSections(created.path, [
      { id: "scene-planning", heading: "## Scene Planning" },
    ]);

    expect(repair.conflicts).toEqual([
      expect.objectContaining({
        sectionId: "scene-planning",
        code: "missing",
      }),
    ]);
    expect(injected).toBe(false);
    expect(fakeVault.contents.get(created.path)).not.toContain("Concurrent data");
    expect(fakeVault.contents.get(created.path)).not.toContain(
      "snowflake:section:scene-planning",
    );
  });

  it("updates several marked sections atomically and rejects a stale form", async () => {
    const created = await repository.createManagedFile({
      userInput: false,
      path: "One Paragraph Summary.md",
      template: {
        body: `${renderMarkedSection("one-paragraph-summary", "old summary")}\n${renderMarkedSection("description", "old description")}`,
        sections: [],
      },
      frontmatter: {
        "snowflake-document": "one-paragraph-summary",
        "snowflake-project-id": "project-1",
      },
    });
    const opened = fakeVault.contents.get(created.path) ?? "";
    fakeVault.contents.set(created.path, opened.replace("old description", "external description"));

    await expect(
      repository.updateSections(
        created.path,
        {
          "one-paragraph-summary": "stale summary",
          description: "stale description",
        },
        fingerprint(opened),
        { userInput: false },
      ),
    ).rejects.toBeInstanceOf(ConcurrentChangeError);
    expect(fakeVault.contents.get(created.path)).toContain("external description");
    expect(fakeVault.contents.get(created.path)).toContain("old summary");

    const current = fakeVault.contents.get(created.path) ?? "";
    await repository.updateSections(
      created.path,
      {
        "one-paragraph-summary": "new summary",
        description: "new description",
      },
      fingerprint(current),
      { userInput: false },
    );
    expect(fakeVault.contents.get(created.path)).toContain("new summary");
    expect(fakeVault.contents.get(created.path)).toContain("new description");
  });

  it("rejects values that forge managed markers without writing any part of the batch", async () => {
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Step One.md",
      template: {
        body: `${renderMarkedSection("genre", "Mystery")}\n${renderMarkedSection("one-sentence-summary", "Original sentence")}`,
        sections: [],
      },
      frontmatter: {
        "snowflake-document": "one-sentence-summary",
        "snowflake-project-id": "project-1",
      },
    });
    const before = fakeVault.contents.get(created.path) ?? "";
    const processCount = fakeVault.processCalls.length;

    await expect(
      repository.updateSections(
        created.path,
        {
          genre: `Safe prose\n\n${renderMarkedSection("one-sentence-summary", "Forged content")}`,
          "one-sentence-summary": "A stale replacement that must not be written.",
        },
        fingerprint(before),
        { userInput: false },
      ),
    ).rejects.toMatchObject({ code: "unsafe-section" });

    expect(fakeVault.contents.get(created.path)).toBe(before);
    expect(fakeVault.processCalls).toHaveLength(processCount);
  });

  it("rejects nested managed sections during update and repair", async () => {
    const nested = [
      "<!-- snowflake:section:opening:start -->",
      "Opening",
      "<!-- snowflake:section:ending:start -->",
      "Ending",
      "<!-- snowflake:section:opening:end -->",
      "<!-- snowflake:section:ending:end -->",
    ].join("\n");
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Nested sections.md",
      template: { body: nested, sections: [] },
      frontmatter: {
        "snowflake-document": "one-paragraph-summary",
        "snowflake-project-id": "project-1",
      },
    });
    const before = fakeVault.contents.get(created.path) ?? "";

    await expect(
      repository.updateSections(created.path, { opening: "New", ending: "New" }, undefined, {
        userInput: false,
      }),
    ).rejects.toMatchObject({ code: "unsafe-section" });
    const repair = await repository.checkSections(created.path, [
      { id: "opening", heading: "## Opening" },
      { id: "ending", heading: "## Ending" },
    ]);

    expect(repair.conflicts).toHaveLength(2);
    expect(repair.conflicts[0]?.code).toBe("overlap");
    expect(repair.conflicts[0]?.reason).toMatch(/overlap|nested/u);
    expect(fakeVault.contents.get(created.path)).toBe(before);
  });

  it("reports frontmatter repair separately and leaves section repair to the service", async () => {
    const file = await fakeVault.seedFile(
      "Plot/04 Plot Synopsis.md",
      `---\n${JSON.stringify({
        "snowflake-document": "plot-synopsis",
        "snowflake-project-id": "project-1",
      })}\n---\n# Existing synopsis\n\nUser prose.\n`,
    );
    const template = {
      body: "# Plot synopsis\n",
      sections: [{ id: "plot-synopsis", heading: "## Plot synopsis" }],
    };

    const ensured = await repository.ensureManagedFile({
      userInput: false,
      path: file.path,
      template,
      frontmatter: {
        "snowflake-document": "plot-synopsis",
        "snowflake-project-id": "project-1",
      },
    });

    expect(ensured.frontmatterRepaired).toBe(true);
    expect(fakeVault.contents.get(file.path)).not.toContain("snowflake:section:plot-synopsis");
    const checked = await repository.checkSections(file.path, template.sections);
    expect(checked.conflicts).toEqual([
      expect.objectContaining({ sectionId: "plot-synopsis", code: "missing" }),
    ]);
    expect(fakeVault.contents.get(file.path)).toContain("User prose.");
    expect(fakeVault.contents.get(file.path)).not.toContain(
      "snowflake:section:plot-synopsis",
    );
  });

  it("upserts sections, replacing what exists and inserting the rest in layout order", async () => {
    const layout = [
      { id: "scene-fields", heading: "" },
      { id: "scene-events", heading: "## Events" },
      { id: "scene-planning", heading: "## Planning" },
    ];
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Upsert.md",
      template: {
        body: `# Arrival\n\n## Events\n\n${renderMarkedSection("scene-events", "The gate closes.")}\n`,
        sections: [],
      },
      frontmatter: {
        "snowflake-document": "scene",
        "snowflake-project-id": "project-1",
      },
    });

    await repository.upsertSections(
      created.path,
      {
        "scene-fields": "> [!info] Scene overview",
        "scene-events": "The gate reopens.",
        "scene-planning": "Reveal the pass.",
      },
      layout,
      undefined,
      { userInput: false },
    );

    const content = fakeVault.contents.get(created.path) ?? "";
    const order = [
      content.indexOf("# Arrival"),
      content.indexOf("snowflake:section:scene-fields:start"),
      content.indexOf("## Events"),
      content.indexOf("The gate reopens."),
      content.indexOf("## Planning"),
      content.indexOf("Reveal the pass."),
    ];
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    expect(content).not.toContain("The gate closes.");
    // The block went above the heading that sits on the events section, not
    // between that heading and its markers.
    expect(content.indexOf("snowflake:section:scene-fields:end")).toBeLessThan(
      content.indexOf("## Events"),
    );
  });

  it("refuses an upsert when a requested section's markers are damaged", async () => {
    const damaged = [
      "# Arrival",
      "<!-- snowflake:section:scene-events:start -->",
      "<!-- snowflake:section:scene-events:start -->",
      "Twice opened",
      "<!-- snowflake:section:scene-events:end -->",
    ].join("\n");
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Damaged upsert.md",
      template: { body: damaged, sections: [] },
      frontmatter: {
        "snowflake-document": "scene",
        "snowflake-project-id": "project-1",
      },
    });
    const before = fakeVault.contents.get(created.path) ?? "";

    await expect(
      repository.upsertSections(
        created.path,
        { "scene-events": "New", "scene-fields": "Block" },
        [
          { id: "scene-fields", heading: "" },
          { id: "scene-events", heading: "## Events" },
        ],
        undefined,
        { userInput: false },
      ),
    ).rejects.toMatchObject({ code: "unsafe-section" });
    expect(fakeVault.contents.get(created.path)).toBe(before);
  });

  it("refuses a stale upsert the way updateSections does", async () => {
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Stale upsert.md",
      template: { body: "# Arrival\n", sections: [] },
      frontmatter: {
        "snowflake-document": "scene",
        "snowflake-project-id": "project-1",
      },
    });
    const opened = fakeVault.contents.get(created.path) ?? "";
    fakeVault.contents.set(created.path, `${opened}\nExternal line.\n`);

    await expect(
      repository.upsertSections(
        created.path,
        { "scene-fields": "Block" },
        [{ id: "scene-fields", heading: "" }],
        fingerprint(opened),
        { userInput: false },
      ),
    ).rejects.toBeInstanceOf(ConcurrentChangeError);
    expect(fakeVault.contents.get(created.path)).toContain("External line.");
  });

  it("forgets a path's record, and a folder's records with it", async () => {
    const managed = (name: string) => ({
      userInput: false,
      path: name,
      template: { body: "# Note\n", sections: [] },
      frontmatter: {
        "snowflake-document": "scene",
        "snowflake-project-id": "project-1",
      },
    });
    const inside = await repository.createManagedFile(
      managed("Projects/Novel/40_Scene/One.md"),
    );
    const sibling = await repository.createManagedFile(
      managed("Projects/Novel/40_Scene/Two.md"),
    );
    const outside = await repository.createManagedFile(
      managed("Projects/Novel/10_Summary/Note.md"),
    );

    // A record is shared while its file stands: the same object comes back.
    const kept = await repository.readManaged(inside.path);
    expect(await repository.readManaged(inside.path)).toBe(kept);

    // Forgetting the exact path parses afresh on the next read.
    repository.forget(inside.path);
    const reread = await repository.readManaged(inside.path);
    expect(reread).not.toBe(kept);
    expect(reread.content).toBe(kept.content);

    // Forgetting a folder sweeps what is under it and nothing beside it.
    const keptSibling = await repository.readManaged(sibling.path);
    const keptOutside = await repository.readManaged(outside.path);
    repository.forget("Projects/Novel/40_Scene", { children: true });
    expect(await repository.readManaged(reread.path)).not.toBe(reread);
    expect(await repository.readManaged(sibling.path)).not.toBe(keptSibling);
    expect(await repository.readManaged(outside.path)).toBe(keptOutside);
  });

  it("hands a walk every folder and file below a folder, once each, and nothing above it", async () => {
    await fakeVault.seedFile("Projects/Novel/40_Scene/One.md", "one");
    await fakeVault.seedFile("Projects/Novel/40_Scene/Deep/Down/Two.md", "two");
    await fakeVault.seedFile("Projects/Novel/Loose.canvas", "{}");
    await fakeVault.seedFile("Projects/Other/Elsewhere.md", "no");
    const folders: string[] = [];
    const files: string[] = [];
    repository.visitBelow(
      "Projects/Novel",
      (folder) => folders.push(folder.path),
      (file) => files.push(file.path),
    );
    expect(folders.sort()).toEqual([
      "Projects/Novel/40_Scene",
      "Projects/Novel/40_Scene/Deep",
      "Projects/Novel/40_Scene/Deep/Down",
    ]);
    expect(files.sort()).toEqual([
      "Projects/Novel/40_Scene/Deep/Down/Two.md",
      "Projects/Novel/40_Scene/One.md",
      "Projects/Novel/Loose.canvas",
    ]);
    // The same files the sorted listing names, which the walk replaces where order is nothing.
    expect(files).toEqual(repository.listFilesBelow("Projects/Novel").map((file) => file.path));
    const nothing: string[] = [];
    repository.visitBelow("Projects/Missing", (folder) => nothing.push(folder.path), (file) => nothing.push(file.path));
    expect(nothing).toEqual([]);
  });

  it("counts the vault's changes while it listens, and says it cannot once it stops", async () => {
    expect(repository.treeVersion).toBeNull();
    await fakeVault.seedFile("Projects/Novel/One.md", "one");
    expect(repository.treeVersion).toBeNull();
    const stop = repository.watch();
    expect(repository.treeVersion).toBe(0);
    fakeVault.write("Projects/Novel/One.md", "one!");
    expect(repository.treeVersion).toBe(1);
    await repository.updatePlainFile("Projects/Novel/One.md", (text) => `${text}?`);
    expect(repository.treeVersion).toBe(2);
    // A transform that hands its input back writes nothing, and moves nothing.
    await repository.updatePlainFile("Projects/Novel/One.md", (text) => text);
    expect(repository.treeVersion).toBe(2);
    stop();
    expect(repository.treeVersion).toBeNull();
    fakeVault.write("Projects/Novel/One.md", "one!!");
    expect(repository.treeVersion).toBeNull();
    expect(fakeVault.listenerCount()).toBe(0);
  });

  it("says while a change is on its way to the vault, and when every one has landed", async () => {
    await fakeVault.seedFile("Projects/Novel/One.md", "one");
    await fakeVault.seedFile("Projects/Novel/Two.md", "two");
    expect(repository.writing).toBe(false);
    await repository.whenWritten();

    const first = repository.updatePlainFile("Projects/Novel/One.md", (text) => `${text}!`);
    const second = repository.updatePlainFile("Projects/Novel/Two.md", (text) => `${text}!`);
    expect(repository.writing).toBe(true);
    let landed = false;
    const waited = repository.whenWritten().then(() => {
      landed = true;
    });
    await first;
    await second;
    await waited;
    expect(landed).toBe(true);
    expect(repository.writing).toBe(false);
    expect(fakeVault.contents.get("Projects/Novel/One.md")).toBe("one!");
    expect(fakeVault.contents.get("Projects/Novel/Two.md")).toBe("two!");

    // A write that fails is over all the same: nothing waits on it for good.
    fakeVault.failNextProcessPath = "Projects/Novel/One.md";
    const failing = repository.updatePlainFile("Projects/Novel/One.md", (text) => `${text}?`);
    expect(repository.writing).toBe(true);
    await expect(failing).rejects.toThrow(/Simulated process failure/u);
    expect(repository.writing).toBe(false);
    await repository.whenWritten();

    // Managed writes, creations and folders are counted the same way.
    const created = repository.createManagedFile({
      userInput: false,
      path: "Projects/Novel/40_Scene/Made.md",
      template: { body: "# Made\n", sections: [] },
      frontmatter: { "snowflake-document": "scene", "snowflake-project-id": "project-1" },
    });
    expect(repository.writing).toBe(true);
    await created;
    expect(repository.writing).toBe(false);
  });

  it("counts a change that reaches the vault by another road", async () => {
    let land = (): void => undefined;
    const moving = new Promise<void>((resolve) => {
      land = resolve;
    });
    // A folder renamed through the file manager, a picture written as bytes.
    const counted = repository.counted(() => moving);
    expect(repository.writing).toBe(true);
    let landed = false;
    const waited = repository.whenWritten().then(() => {
      landed = true;
    });
    await Promise.resolve();
    expect(landed).toBe(false);
    land();
    await counted;
    await waited;
    expect(repository.writing).toBe(false);

    // One that fails is counted no longer either.
    const failing = repository.counted(() => Promise.reject(new Error("the disk said no")));
    expect(repository.writing).toBe(true);
    await expect(failing).rejects.toThrow("the disk said no");
    expect(repository.writing).toBe(false);
  });

  it("tells a record a write has overtaken from the note as it stands", async () => {
    const created = await repository.createManagedFile({
      userInput: false,
      path: "Projects/Novel/40_Scene/One.md",
      template: { body: "# One\n", sections: [] },
      frontmatter: { "snowflake-document": "scene", "snowflake-project-id": "project-1" },
    });
    const record = await repository.readManaged(created.path);
    expect(repository.isCurrent(record)).toBe(true);
    fakeVault.write(created.path, `${fakeVault.contents.get(created.path) ?? ""}more\n`);
    expect(repository.isCurrent(record)).toBe(false);
    const reread = await repository.readManaged(created.path);
    expect(repository.isCurrent(reread)).toBe(true);
    expect(repository.isCurrent(record)).toBe(false);
    // A note that has gone is not current, though its record is still kept.
    fakeVault.delete(created.path);
    expect(repository.isCurrent(reread)).toBe(false);
    repository.forget(created.path);
    expect(repository.isCurrent(reread)).toBe(false);
  });

  it("counts every kind of change it makes for as long as that change is out", async () => {
    const made = await repository.createManagedFile({
      userInput: false,
      path: "Projects/Novel/40_Scene/Held.md",
      template: { body: "# Held\n", sections: [] },
      frontmatter: { "snowflake-document": "scene", "snowflake-project-id": "project-1" },
    });
    await fakeVault.seedFile("Projects/Novel/Plain.md", "plain");
    await fakeVault.createFolder("Projects/Novel/Kept");
    await fakeVault.createFolder("Projects/Novel/Going");

    /** Holds the next call of one of the fake's writes open until released. */
    const hold = (target: object, method: string) => {
      const real = (target as Record<string, (...args: unknown[]) => Promise<unknown>>)[method]!;
      let reach = (): void => undefined;
      let release = (): void => undefined;
      const reached = new Promise<void>((resolve) => {
        reach = resolve;
      });
      const let_go = new Promise<void>((resolve) => {
        release = resolve;
      });
      (target as Record<string, unknown>)[method] = async (...args: unknown[]) => {
        (target as Record<string, unknown>)[method] = real;
        reach();
        await let_go;
        return real.apply(target, args);
      };
      return { reached, release };
    };

    const kinds: Array<[string, object, string, () => Promise<unknown>]> = [
      ["a note's properties", fakeFileManager, "processFrontMatter", () => repository.updateFrontmatter(made.path, { "snowflake-rank": 2048 })],
      ["a note's first heading", fakeVault, "process", () => repository.updateFirstHeading(made.path, "Held, renamed", { userInput: false })],
      ["a plain file's text", fakeVault, "process", () => repository.updatePlainFile("Projects/Novel/Plain.md", (text) => `${text}!`)],
      ["a plain file made", fakeVault, "create", () => repository.createPlainFile("Projects/Novel/Kept/New.md", "new")],
      ["a managed note made", fakeVault, "create", () => repository.createManagedFile({
        userInput: false,
        path: "Projects/Novel/40_Scene/Another.md",
        template: { body: "# Another\n", sections: [] },
        frontmatter: { "snowflake-document": "scene", "snowflake-project-id": "project-1" },
      })],
      ["a folder made", fakeVault, "createFolder", () => repository.ensureFolder("Projects/Novel/Fresh")],
      ["a note renamed", fakeFileManager, "renameFile", () => repository.renameFile("Projects/Novel/Plain.md", "Projects/Novel/Kept/Plain.md")],
      ["a folder renamed", fakeFileManager, "renameFile", () => repository.renameFolder("Projects/Novel/Going", "Projects/Novel/Gone")],
      ["a note sent to the trash", fakeFileManager, "trashFile", () => repository.trashFile("Projects/Novel/Kept/Plain.md")],
      ["a folder sent to the trash", fakeFileManager, "trashFile", () => repository.trashFolder("Projects/Novel/Gone")],
    ];
    for (const [what, target, method, change] of kinds) {
      expect(repository.writing, what).toBe(false);
      const held = hold(target, method);
      const changing = change();
      await held.reached;
      expect(repository.writing, what).toBe(true);
      let landed = false;
      const waited = repository.whenWritten().then(() => {
        landed = true;
      });
      for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
      expect(landed, what).toBe(false);
      held.release();
      await changing;
      await waited;
      expect(repository.writing, what).toBe(false);
    }
  });

  it("keeps one entry for a note while the index keeps one parse of it", async () => {
    // The app's index hands back the same parsed object until it reads the
    // note again; the fake's makes a new one per asking. This stands in for
    // the app's, so that what is kept can be told from what is made.
    const environment = createFakeEnvironment();
    const parses = new Map<string, Record<string, unknown>>();
    const parse = (path: string, fields: Record<string, unknown>): void => {
      parses.set(path, { ...fields, position: { start: { line: 0 }, end: { line: 3 } } });
    };
    const indexed = new VaultRepository(environment.vault, environment.fileManager, {
      getFileCache: (file: { path: string }) => {
        const frontmatter = parses.get(file.path);
        return frontmatter === undefined ? null : { frontmatter };
      },
      getFirstLinkpathDest: () => null,
    } as never);
    const fields = { "snowflake-document": "draft", "snowflake-project-id": "project-1", "snowflake-schema": SCHEMA_VERSION };
    await environment.fakeVault.seedFile("Novel/50_Manuscript/One.md", "---\n{}\n---\none");
    await environment.fakeVault.seedFile("Novel/50_Manuscript/Two.md", "---\n{}\n---\ntwo");
    parse("Novel/50_Manuscript/One.md", fields);
    parse("Novel/50_Manuscript/Two.md", fields);

    const first = await indexed.listManagedEntriesBelow("Novel/50_Manuscript", "draft", "project-1");
    const again = await indexed.listManagedEntriesBelow("Novel/50_Manuscript", "draft", "project-1");
    expect(first.map((entry) => entry.path)).toEqual(["Novel/50_Manuscript/One.md", "Novel/50_Manuscript/Two.md"]);
    expect(again[0]).toBe(first[0]);
    expect(again[1]).toBe(first[1]);
    // The block's own position never reaches an entry.
    expect(first[0]?.frontmatter).toEqual(fields);

    // The index read one note again: that note's entry is made anew, and says the new thing.
    parse("Novel/50_Manuscript/One.md", { ...fields, "snowflake-sequence": 7 });
    const after = await indexed.listManagedEntriesBelow("Novel/50_Manuscript", "draft", "project-1");
    expect(after[0]).not.toBe(first[0]);
    expect(after[0]?.frontmatter["snowflake-sequence"]).toBe(7);
    expect(after[1]).toBe(first[1]);

    // A renamed file keeps its parse, and its entry must still name it rightly.
    environment.fakeVault.rename("Novel/50_Manuscript/Two.md", "Novel/50_Manuscript/Zed.md");
    parses.set("Novel/50_Manuscript/Zed.md", parses.get("Novel/50_Manuscript/Two.md") ?? {});
    parses.delete("Novel/50_Manuscript/Two.md");
    const renamed = await indexed.listManagedEntriesBelow("Novel/50_Manuscript", "draft", "project-1");
    expect(renamed.map((entry) => entry.path)).toEqual(["Novel/50_Manuscript/One.md", "Novel/50_Manuscript/Zed.md"]);
    expect(renamed[1]).not.toBe(first[1]);
  });
});
