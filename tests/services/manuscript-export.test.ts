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
