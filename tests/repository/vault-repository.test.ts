import { beforeEach, describe, expect, it } from "vitest";

import { SCHEMA_VERSION, fingerprint } from "../../src/domain";
import {
  ConcurrentChangeError,
  InvalidManagedDocumentError,
  UnsupportedSchemaError,
  VaultRepository,
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

  it("uses a safe suffix and never overwrites a conflicting file", async () => {
    await fakeVault.seedFile("Characters/Ada.md", "personal note");
    const created = await repository.createManagedFile({
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
      repository.updateSection(file.path, "one-sentence-summary", "No"),
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
      repository.updateSection(file.path, "one-sentence-summary", "replace"),
    ).rejects.toBeInstanceOf(InvalidManagedDocumentError);
    expect(fakeVault.contents.get(file.path)).toContain("keep me");
  });

  it("does not allow a frontmatter patch to upgrade its own schema", async () => {
    const created = await repository.createManagedFile({
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

  it("reports missing sections without changing the original note", async () => {
    const created = await repository.createManagedFile({
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
    );
    expect(fakeVault.contents.get(created.path)).toContain("new summary");
    expect(fakeVault.contents.get(created.path)).toContain("new description");
  });

  it("rejects values that forge managed markers without writing any part of the batch", async () => {
    const created = await repository.createManagedFile({
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
      path: "Nested sections.md",
      template: { body: nested, sections: [] },
      frontmatter: {
        "snowflake-document": "one-paragraph-summary",
        "snowflake-project-id": "project-1",
      },
    });
    const before = fakeVault.contents.get(created.path) ?? "";

    await expect(
      repository.updateSections(created.path, { opening: "New", ending: "New" }),
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
      ),
    ).rejects.toMatchObject({ code: "unsafe-section" });
    expect(fakeVault.contents.get(created.path)).toBe(before);
  });

  it("refuses a stale upsert the way updateSections does", async () => {
    const created = await repository.createManagedFile({
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
      ),
    ).rejects.toBeInstanceOf(ConcurrentChangeError);
    expect(fakeVault.contents.get(created.path)).toContain("External line.");
  });

  it("forgets a path's record, and a folder's records with it", async () => {
    const managed = (name: string) => ({
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
});
