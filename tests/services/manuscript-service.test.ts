import { beforeEach, describe, expect, it } from "vitest";

import { FRONTMATTER_KEYS } from "../../src/domain";
import { parseMarkdownFrontmatter } from "../../src/repository";
import {
  SnowflakeProjectService,
  type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

describe("ManuscriptService", () => {
  let fakeVault: FakeVault;
  let service: SnowflakeProjectService;
  let project: ProjectSnapshot;

  const manuscript = (): Promise<
    Awaited<ReturnType<SnowflakeProjectService["manuscript"]["listSegments"]>>
  > => service.manuscript.listSegments(project, project.links.draft);

  const titles = async (): Promise<string[]> =>
    (await manuscript()).map(({ title }) => title);

  const sequenceOf = (path: string): unknown =>
    parseMarkdownFrontmatter(fakeVault.contents.get(path) ?? "").frontmatter[
      FRONTMATTER_KEYS.manuscriptSequence
    ];

  beforeEach(async () => {
    const environment = createFakeEnvironment();
    fakeVault = environment.fakeVault;
    service = new SnowflakeProjectService(
      environment.vault,
      environment.fileManager,
      environment.metadataCache,
    );
    project = await service.createProject({ title: "Novel", locale: "en" });
  });

  it("reads a project made before manuscripts as a manuscript of one", async () => {
    const segments = await manuscript();

    expect(segments).toHaveLength(1);
    expect(segments[0]?.path).toBe(
      "Snowflake Projects/Novel/50_Manuscript/Draft.md",
    );
    // Nothing was written into the draft to make this true.
    expect(segments[0]?.hasStoredSequence).toBe(false);
    expect(sequenceOf(segments[0]?.path ?? "")).toBeUndefined();
  });

  it("reports nothing wrong with a manuscript of one", async () => {
    const issues = await service.manuscript.findSequenceIssues(
      project,
      project.links.draft,
    );
    expect(issues).toEqual({ missing: [], invalid: [], duplicate: [] });
    expect(project.structureIssues).toEqual([]);
  });

  it("writes down the existing order before placing a second segment", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    const added = await service.manuscript.appendSegment(
      project,
      project.links.draft,
      "Chapter Two",
    );

    // The draft would slide to the end of its own manuscript if its position
    // were still only a fallback when the second note arrived.
    expect(await titles()).toEqual(["Draft", "Chapter Two"]);
    expect(sequenceOf(draft)).toBe(1024);
    expect(sequenceOf(added)).toBe(2048);
  });

  it("places a segment between two neighbours", async () => {
    await service.manuscript.appendSegment(project, project.links.draft, "Three");
    const between = await service.manuscript.insertSegmentAfter(
      project,
      project.links.draft,
      "Snowflake Projects/Novel/50_Manuscript/Draft.md",
      "Two",
    );

    expect(await titles()).toEqual(["Draft", "Two", "Three"]);
    expect(sequenceOf(between)).toBe(1536);
  });

  it("renumbers when no whole number is left between neighbours", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    const second = await service.manuscript.appendSegment(
      project,
      project.links.draft,
      "Second",
    );
    await service.repository.updateFrontmatter(draft, {
      [FRONTMATTER_KEYS.manuscriptSequence]: 1,
    });
    await service.repository.updateFrontmatter(second, {
      [FRONTMATTER_KEYS.manuscriptSequence]: 2,
    });

    const wedged = await service.manuscript.insertSegmentAfter(
      project,
      project.links.draft,
      draft,
      "Wedged",
    );

    expect(await titles()).toEqual(["Draft", "Wedged", "Second"]);
    expect(sequenceOf(draft)).toBe(1024);
    expect(sequenceOf(wedged)).toBe(1536);
    expect(sequenceOf(second)).toBe(2048);
  });

  it("puts a segment before the opening one", async () => {
    const opening = await service.manuscript.prependSegment(
      project,
      project.links.draft,
      "Prologue",
    );
    expect(await titles()).toEqual(["Prologue", "Draft"]);
    expect(sequenceOf(opening)).toBe(0);
  });

  it("finds segments filed into subfolders of the manuscript", async () => {
    await service.repository.createPlainFile(
      "Snowflake Projects/Novel/50_Manuscript/Part One/Arrival.md",
      [
        "---",
        JSON.stringify({
          "snowflake-schema": 1,
          "snowflake-document": "draft",
          "snowflake-project-id": project.id,
          "snowflake-manuscript-sequence": 512,
        }),
        "---",
        "# Arrival",
      ].join("\n"),
    );

    expect(await titles()).toEqual(["Arrival", "Draft"]);
  });

  it("ignores a manuscript note belonging to another project", async () => {
    const other = await service.createProject({ title: "Other", locale: "en" });
    await service.manuscript.appendSegment(other, other.links.draft, "Draft");

    expect((await manuscript()).map(({ path }) => path)).toEqual([
      "Snowflake Projects/Novel/50_Manuscript/Draft.md",
    ]);
  });

  it("splits a segment at the cursor, keeping the text on both sides", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    await service.manuscript.writeSegment(
      draft,
      "# Draft\n\nBefore the cut.\n\nAfter the cut.\n",
    );
    const source = await service.manuscript.readSegment(draft);
    const cut = source.body.indexOf("After the cut.");

    const created = await service.manuscript.splitSegment(
      project,
      project.links.draft,
      draft,
      cut,
      "Chapter Two",
    );

    expect(await titles()).toEqual(["Draft", "Chapter Two"]);
    expect((await service.manuscript.readSegment(draft)).body).toBe(
      "# Draft\n\nBefore the cut.\n",
    );
    expect((await service.manuscript.readSegment(created)).body).toBe(
      "After the cut.\n",
    );
  });

  it("merges a segment into the one before it, keeping the earlier place", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    const two = await service.manuscript.appendSegment(
      project,
      project.links.draft,
      "Two",
    );
    await service.manuscript.appendSegment(project, project.links.draft, "Three");
    await service.manuscript.writeSegment(draft, "# Draft\n\nThe opening.\n");
    await service.manuscript.writeSegment(two, "# Two\n\nWhat follows.\n");

    await service.mergeManuscriptSegments(project.projectFile, draft);

    expect(await titles()).toEqual(["Draft", "Three"]);
    expect((await service.manuscript.readSegment(draft)).body).toBe(
      "# Draft\n\nThe opening.\n\n# Two\n\nWhat follows.\n",
    );
    // The survivor keeps its own place, so the merged text is read where the
    // earlier of the two was.
    expect(sequenceOf(draft)).toBe(1024);
    expect(fakeVault.getFileByPath(two)).toBeNull();
  });

  it("keeps the draft pointed somewhere when its note is merged away", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    const opening = await service.manuscript.prependSegment(
      project,
      project.links.draft,
      "Prologue",
    );

    await service.mergeManuscriptSegments(project.projectFile, opening);

    const reloaded = await service.loadProject(project.projectFile);
    expect(reloaded.links.draft).toBe(opening);
    expect(fakeVault.getFileByPath(draft)).toBeNull();
    expect(reloaded.structureIssues).toEqual([]);
  });

  it("refuses to merge the last segment, which has nothing after it", async () => {
    await service.manuscript.appendSegment(project, project.links.draft, "Two");

    await expect(
      service.mergeManuscriptSegments(
        project.projectFile,
        "Snowflake Projects/Novel/50_Manuscript/Two.md",
      ),
    ).rejects.toThrow(/no manuscript note after/iu);
  });

  it("moves a segment without touching what any of them say", async () => {
    await service.manuscript.appendSegment(project, project.links.draft, "Two");
    const three = await service.manuscript.appendSegment(
      project,
      project.links.draft,
      "Three",
    );
    const bodyBefore = (await service.manuscript.readSegment(three)).body;

    await service.manuscript.moveSegment(
      project,
      project.links.draft,
      three,
      0,
    );

    expect(await titles()).toEqual(["Three", "Draft", "Two"]);
    expect((await service.manuscript.readSegment(three)).body).toBe(bodyBefore);
  });

  it("keeps the frontmatter when text is written back", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    await service.manuscript.appendSegment(project, project.links.draft, "Two");

    await service.manuscript.writeSegment(draft, "# Draft\n\nRewritten.\n");

    expect(sequenceOf(draft)).toBe(1024);
    expect(fakeVault.contents.get(draft)).toContain("Rewritten.");
  });

  it("refuses a save aimed at a revision the file has moved past", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    const stale = (await service.manuscript.readSegment(draft)).revision;
    await service.manuscript.writeSegment(draft, "# Draft\n\nSomebody else.\n");

    await expect(
      service.manuscript.writeSegment(draft, "# Draft\n\nMine.\n", stale),
    ).rejects.toThrow(/changed/iu);
    expect(fakeVault.contents.get(draft)).toContain("Somebody else.");
  });
});

describe("manuscript health checks", () => {
  let fakeVault: FakeVault;
  let service: SnowflakeProjectService;
  let project: ProjectSnapshot;

  beforeEach(async () => {
    const environment = createFakeEnvironment();
    fakeVault = environment.fakeVault;
    service = new SnowflakeProjectService(
      environment.vault,
      environment.fileManager,
      environment.metadataCache,
    );
    project = await service.createProject({ title: "Novel", locale: "en" });
    await service.manuscript.appendSegment(project, project.links.draft, "Two");
    project = await service.loadProject(project.projectFile);
  });

  const codes = (snapshot: ProjectSnapshot): string[] =>
    snapshot.structureIssues.map((issue) => issue.code);

  it("reports a manuscript note that stores no place", async () => {
    await service.repository.updateFrontmatter(
      "Snowflake Projects/Novel/50_Manuscript/Two.md",
      { [FRONTMATTER_KEYS.manuscriptSequence]: undefined },
    );
    const snapshot = await service.loadProject(project.projectFile);

    expect(codes(snapshot)).toContain("missing-manuscript-sequence");
    const issue = snapshot.structureIssues.find(
      (candidate) => candidate.code === "missing-manuscript-sequence",
    );
    expect(issue?.path).toBe("Snowflake Projects/Novel/50_Manuscript/Two.md");
    expect(issue?.expected).toBe("Two");
    expect(issue?.repairable).toBe(true);
  });

  it("tells an unreadable place apart from a missing one", async () => {
    await service.repository.updateFrontmatter(
      "Snowflake Projects/Novel/50_Manuscript/Two.md",
      { [FRONTMATTER_KEYS.manuscriptSequence]: "second" },
    );
    const snapshot = await service.loadProject(project.projectFile);

    expect(codes(snapshot)).toContain("invalid-manuscript-sequence");
    expect(codes(snapshot)).not.toContain("missing-manuscript-sequence");
  });

  it("reports two notes claiming the same place", async () => {
    await service.repository.updateFrontmatter(
      "Snowflake Projects/Novel/50_Manuscript/Two.md",
      { [FRONTMATTER_KEYS.manuscriptSequence]: 1024 },
    );
    const snapshot = await service.loadProject(project.projectFile);

    const issue = snapshot.structureIssues.find(
      (candidate) => candidate.code === "duplicate-manuscript-sequence",
    );
    expect(issue?.expected).toBe("Draft, Two");
  });

  it("repairs by renumbering, leaving every word where it was", async () => {
    const two = "Snowflake Projects/Novel/50_Manuscript/Two.md";
    await service.manuscript.writeSegment(two, "# Two\n\nThe second chapter.\n");
    await service.repository.updateFrontmatter(two, {
      [FRONTMATTER_KEYS.manuscriptSequence]: 1024,
    });
    const snapshot = await service.loadProject(project.projectFile);
    const issue = snapshot.structureIssues.find(
      (candidate) => candidate.code === "duplicate-manuscript-sequence",
    );

    const repaired = await service.repairMissingStructureItem(
      project.projectFile,
      issue?.path ?? "",
    );

    expect(
      repaired.structureIssues.map((candidate) => candidate.code),
    ).not.toContain("duplicate-manuscript-sequence");
    expect(fakeVault.contents.get(two)).toContain("The second chapter.");
    expect(
      (await service.manuscript.listSegments(project, project.links.draft)).map(
        ({ sequence }) => sequence,
      ),
    ).toEqual([1024, 2048]);
  });
});
