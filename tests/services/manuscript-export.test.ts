import { beforeEach, describe, expect, it } from "vitest";

import {
  ExportIntoManuscriptError,
  SnowflakeProjectService,
  projectExportRoot,
  type ManuscriptExportOptions,
  type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const DRAFT = "Snowflake Projects/Novel/50_Manuscript/Draft.md";

describe("ManuscriptExportService", () => {
  let fakeVault: FakeVault;
  let service: SnowflakeProjectService;
  let project: ProjectSnapshot;
  const options: ManuscriptExportOptions = {
    folder: "Out",
    format: "txt",
    indent: true,
    paragraphSpacing: true,
    layout: "single",
    separator: "rule",
  };

  beforeEach(async () => {
    const environment = createFakeEnvironment();
    fakeVault = environment.fakeVault;
    service = new SnowflakeProjectService(
      environment.vault,
      environment.fileManager,
      environment.metadataCache,
    );
    project = await service.createProject({ title: "Novel", locale: "en" });
    await service.manuscript.writeSegment(DRAFT, "# One\n\nFirst **bold** words.\n");
    const second = await service.manuscript.appendSegment(project, "Two");
    await service.manuscript.writeSegment(
      second,
      "# Two\n\nSee [[Character/Alice|Alice]] %% hidden %% now.\n\n\nAfter a gap.\n",
    );
  });

  it("writes the whole manuscript as one plain file in reading order", async () => {
    const plan = await service.exporter.plan(project, { kind: "manuscript" }, options);
    expect(plan.targets.map((target) => [target.path, target.exists])).toEqual([
      ["Out/Novel.txt", false],
    ]);
    const written = await service.exporter.write(plan);
    expect(written).toEqual(["Out/Novel.txt"]);
    expect(fakeVault.contents.get("Out/Novel.txt")).toBe(
      "One\n\n\u2003\u2003First bold words.\n\n----------\n\nTwo\n\n\u2003\u2003See Alice now.\n\n\n\u2003\u2003After a gap.\n",
    );
  });

  it("writes one numbered file per note in a folder named after the project", async () => {
    const plan = await service.exporter.plan(
      project,
      { kind: "manuscript" },
      { ...options, layout: "folder", format: "md", indent: false },
    );
    await service.exporter.write(plan);
    expect(plan.targets.map((target) => target.path)).toEqual([
      "Out/Novel/001 Draft.md",
      "Out/Novel/002 Two.md",
    ]);
    expect(fakeVault.contents.get("Out/Novel/001 Draft.md")).toBe(
      "One\n\nFirst bold words.\n",
    );
  });

  it("writes one note on its own, and copies the same text", async () => {
    const plan = await service.exporter.plan(
      project,
      { kind: "segment", path: DRAFT },
      { ...options, paragraphSpacing: false },
    );
    expect(plan.targets.map((target) => target.path)).toEqual(["Out/Novel/Draft.txt"]);
    await service.exporter.write(plan);
    expect(fakeVault.contents.get("Out/Novel/Draft.txt")).toBe("One\n\u2003\u2003First bold words.\n");
    expect(
      await service.exporter.segmentText(project, DRAFT, {
        ...options,
        paragraphSpacing: false,
      }),
    ).toBe("One\n\u2003\u2003First bold words.\n");
  });

  it("writes a passage under the first number its name has free, read as the note's words are", async () => {
    const name = (number: number): string => `Draft (excerpt ${number})`;
    const plan = await service.exporter.plan(
      project,
      { kind: "passage", name, text: "First **bold** words.\n\nSee [[Character/Alice|Alice]]." },
      options,
    );
    expect(plan.targets.map((target) => [target.path, target.exists])).toEqual([
      ["Out/Novel/Draft (excerpt 1).txt", false],
    ]);
    await service.exporter.write(plan);
    expect(fakeVault.contents.get("Out/Novel/Draft (excerpt 1).txt")).toBe(
      "\u2003\u2003First bold words.\n\n\u2003\u2003See Alice.\n",
    );
    // A second passage from the same place takes the next number.
    const second = await service.exporter.plan(project, { kind: "passage", name, text: "More." }, options);
    expect(second.targets.map((target) => [target.path, target.exists])).toEqual([
      ["Out/Novel/Draft (excerpt 2).txt", false],
    ]);
    // Words that come to nothing make no file.
    const empty = await service.exporter.plan(
      project,
      { kind: "passage", name, text: "%% hidden %%" },
      options,
    );
    expect(empty.targets).toEqual([]);
  });

  it("writes a note of no project straight into the export folder, indented as its words ask", async () => {
    await fakeVault.seedFile("Loose/Idea.md", "# Idea\n\nA **plain** thought.\n");
    await fakeVault.seedFile("Loose/想法.md", "# 想法\n\n一个**简单**的念头。\n");
    const plan = await service.exporter.plan(
      null,
      { kind: "segment", path: "Loose/Idea.md" },
      { ...options, paragraphSpacing: false },
    );
    expect(plan.targets.map((target) => [target.path, target.content])).toEqual([
      ["Out/Idea.txt", "Idea\n\u2003\u2003A plain thought.\n"],
    ]);
    expect(
      await service.exporter.segmentText(null, "Loose/想法.md", {
        indent: true,
        paragraphSpacing: false,
      }),
    ).toBe("想法\n\u3000\u3000一个简单的念头。\n");
    // A note of no project is never part of a manuscript.
    expect((await service.exporter.plan(null, { kind: "manuscript" }, options)).targets).toEqual([]);
  });

  it("leaves out the sections the plugin wrote by the kind the note declares", async () => {
    const path = "Snowflake Projects/Novel/20_Character/Alice.md";
    await fakeVault.seedFile(
      path,
      [
        "---",
        "snowflake-document: character",
        "---",
        "# Alice",
        "",
        "<!-- snowflake:section:character-fields:start -->",
        "> [!info] Character overview",
        "> **Role**: lead",
        "<!-- snowflake:section:character-fields:end -->",
        "",
        "She keeps the lighthouse.",
        "",
      ].join("\n"),
    );
    const plan = await service.exporter.plan(
      project,
      { kind: "segment", path },
      { ...options, paragraphSpacing: false },
    );
    expect(plan.targets.map((target) => [target.path, target.content])).toEqual([
      ["Out/Novel/Alice.txt", "Alice\n\u2003\u2003She keeps the lighthouse.\n"],
    ]);
  });

  it("exports a note whose frontmatter will not read, from past its closing fence", async () => {
    await fakeVault.seedFile("Loose/Broken.md", "---\ntitle: a: b\n---\nThe words stay.\n");
    const plan = await service.exporter.plan(
      null,
      { kind: "segment", path: "Loose/Broken.md" },
      { ...options, indent: false, paragraphSpacing: false },
    );
    expect(plan.targets.map((target) => [target.path, target.content])).toEqual([
      ["Out/Broken.txt", "The words stay.\n"],
    ]);
  });

  it("names a note after its folders when another note of the project shares its name", async () => {
    const alice = "Snowflake Projects/Novel/20_Character/Alice/Notes.md";
    const harbor = "Snowflake Projects/Novel/60_Worldbuilding/Harbor/Notes.md";
    await fakeVault.seedFile(alice, "She keeps the lighthouse.\n");
    await fakeVault.seedFile(harbor, "Boats come in at dusk.\n");
    const paths = async (path: string): Promise<string[]> =>
      (await service.exporter.plan(project, { kind: "segment", path }, options)).targets.map(
        (target) => target.path,
      );
    expect(await paths(alice)).toEqual(["Out/Novel/Notes (20_Character - Alice).txt"]);
    expect(await paths(harbor)).toEqual(["Out/Novel/Notes (60_Worldbuilding - Harbor).txt"]);
    // A name no other note shares stays as it is.
    expect(await paths(DRAFT)).toEqual(["Out/Novel/Draft.txt"]);
  });

  it("says which files already stand, and writes over them when told to", async () => {
    const first = await service.exporter.plan(project, { kind: "manuscript" }, options);
    await service.exporter.write(first);
    await service.manuscript.writeSegment(DRAFT, "# One\n\nChanged words.\n");
    const again = await service.exporter.plan(project, { kind: "manuscript" }, options);
    expect(again.targets[0]?.exists).toBe(true);
    await service.exporter.write(again);
    expect(fakeVault.contents.get("Out/Novel.txt")).toContain("Changed words.");
  });

  it("refuses a folder inside the manuscript before planning anything", async () => {
    await expect(
      service.exporter.plan(
        project,
        { kind: "manuscript" },
        { ...options, folder: "Snowflake Projects/Novel/50_Manuscript" },
      ),
    ).rejects.toBeInstanceOf(ExportIntoManuscriptError);
    await expect(
      service.exporter.plan(
        project,
        { kind: "manuscript" },
        { ...options, folder: "Snowflake Projects/Novel/50_Manuscript/Part One" },
      ),
    ).rejects.toThrow(/50_Manuscript/u);
  });

  it("takes the Vault root as a folder, and leaves out a note with nothing to say", async () => {
    const empty = await service.manuscript.appendSegment(project, "Empty");
    await service.manuscript.writeSegment(empty, "\n\n");
    const plan = await service.exporter.plan(
      project,
      { kind: "manuscript" },
      { ...options, folder: "/", layout: "folder" },
    );
    expect(plan.targets.map((target) => target.path)).toEqual([
      "Novel/001 Draft.txt",
      "Novel/002 Two.txt",
    ]);
    expect(
      (await service.exporter.plan(project, { kind: "segment", path: empty }, options))
        .targets,
    ).toEqual([]);
  });

  it("names the default export folder beside the projects", () => {
    expect(projectExportRoot("")).toBe("Snowflake Export");
    expect(projectExportRoot("Writing")).toBe("Writing/Snowflake Export");
  });

  it("indents a Chinese project with full-width spaces", async () => {
    const zh = await service.createProject({ title: "小说", locale: "zh-CN" });
    const draft = "Snowflake Projects/小说/50_正文/初稿.md";
    await service.manuscript.writeSegment(draft, "# 第一章\n\n第一段。\n");
    expect(
      await service.exporter.segmentText(zh, draft, {
        indent: true,
        paragraphSpacing: true,
      }),
    ).toBe("第一章\n\n　　第一段。\n");
  });
});
