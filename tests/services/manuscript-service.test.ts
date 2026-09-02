import { beforeEach, describe, expect, it } from "vitest";

import { FRONTMATTER_KEYS, findSequenceIssues } from "../../src/domain";
import { parseMarkdownFrontmatter } from "../../src/repository";
import {
  SnowflakeProjectService,
  type ProjectSnapshot,
} from "../../src/services";
import {
  createFakeEnvironment,
  type FakeMetadataCache,
  type FakeVault,
} from "../helpers/fake-vault";

describe("ManuscriptService", () => {
  let fakeVault: FakeVault;
  let service: SnowflakeProjectService;
  let project: ProjectSnapshot;

  const manuscript = (): Promise<
    Awaited<ReturnType<SnowflakeProjectService["manuscript"]["listSegments"]>>
  > => service.manuscript.listSegments(project);

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
    expect(findSequenceIssues(await manuscript())).toEqual({
      missing: [],
      invalid: [],
      duplicate: [],
    });
    expect(project.structureIssues).toEqual([]);
  });

  it("writes down the existing order before placing a second segment", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    const added = await service.manuscript.appendSegment(
      project,
      "Chapter Two",
    );

    // The draft would slide to the end of its own manuscript if its position
    // were still only a fallback when the second note arrived.
    expect(await titles()).toEqual(["Draft", "Chapter Two"]);
    expect(sequenceOf(draft)).toBe(1024);
    expect(sequenceOf(added)).toBe(2048);
  });

  it("places a segment between two neighbours", async () => {
    await service.manuscript.appendSegment(project, "Three");
    const between = await service.manuscript.insertSegmentAfter(
      project,
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
    await service.manuscript.appendSegment(other, "Draft");

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

  it("says when a note's body reached the file, for every writer alike", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    const written: [string, string][] = [];
    service.manuscript.onSegmentWritten = (path, body) => {
      written.push([path, body]);
    };
    await service.manuscript.writeSegment(draft, "# Draft\n\nWords.\n");
    expect(written).toEqual([[draft, "# Draft\n\nWords.\n"]]);
    // A split writes the note it cut too, and says so for that one; the
    // remainder is reported by the carry, which knows what moved.
    const source = await service.manuscript.readSegment(draft);
    await service.manuscript.splitSegment(project, draft, source.body.length, "Two");
    expect(written[written.length - 1]?.[0]).toBe(draft);
  });

  it("says where a split sent the text, and how far its offsets moved", async () => {
    // Revisions are stored against a note and an offset, so text that walks
    // to a new file without saying so leaves every proposal on it hunting
    // for words the note it names no longer holds.
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    await service.manuscript.writeSegment(
      draft,
      "# Draft\n\nBefore the cut.\n\nAfter the cut.\n",
    );
    const source = await service.manuscript.readSegment(draft);
    const cut = source.body.indexOf("After the cut.");
    const carried: unknown[] = [];
    service.manuscript.onSegmentTextCarried = (from, into, body, at, shift) => {
      carried.push({ from, into, body, at, shift });
    };

    const created = await service.manuscript.splitSegment(
      project,
      draft,
      cut,
      "Chapter Two",
    );

    // The seam swallowed no blank lines here: the cut is already the first
    // character of the text that travels.
    expect(carried).toEqual([
      { from: draft, into: created, body: source.body, at: cut, shift: cut },
    ]);
    // And the arithmetic it reports is true of the bodies that were written.
    const after = (await service.manuscript.readSegment(created)).body;
    expect(after.slice(0, 5)).toBe(source.body.slice(cut, cut + 5));
  });

  it("counts the blank lines a split's seam closes up", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    await service.manuscript.writeSegment(
      draft,
      "# Draft\n\nBefore the cut.\n\nAfter the cut.\n",
    );
    const source = await service.manuscript.readSegment(draft);
    // Cut on the blank line, so the tail opens with newlines that are tidied
    // away: the text travels further than the cut alone would say.
    const cut = source.body.indexOf("After the cut.") - 1;
    const carried: { at: number; shift: number }[] = [];
    service.manuscript.onSegmentTextCarried = (_from, _into, _body, at, shift) => {
      carried.push({ at, shift });
    };

    await service.manuscript.splitSegment(project, draft, cut, "Chapter Two");

    expect(carried).toEqual([{ at: cut, shift: cut + 1 }]);
  });

  it("says where a merge sent the absorbed note's text", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    const two = await service.manuscript.appendSegment(project, "Two");
    await service.manuscript.writeSegment(draft, "# Draft\n\nThe opening.\n");
    await service.manuscript.writeSegment(two, "# Two\n\nWhat follows.\n");
    const carried: {
      from: string;
      into: string;
      body: string;
      shift: number;
    }[] = [];
    service.manuscript.onSegmentTextCarried = (from, into, body, _at, shift) => {
      carried.push({ from, into, body, shift });
    };

    await service.mergeManuscriptSegments(project.projectFile, draft);

    // Forward, not back: a negative shift, since the absorbed text now
    // stands after the survivor's own. And the body reported is the absorbed
    // note's own, which is what a listener sorts its records against.
    expect(carried).toEqual([
      {
        from: two,
        into: draft,
        body: "# Two\n\nWhat follows.\n",
        shift: -"# Draft\n\nThe opening.".length - 2,
      },
    ]);
    // Which is exactly where the tail landed in the joined body.
    const joined = (await service.manuscript.readSegment(draft)).body;
    expect(joined.indexOf("# Two")).toBe("# Draft\n\nThe opening.".length + 2);
  });

  it("merges a segment into the one before it, keeping the earlier place", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    const two = await service.manuscript.appendSegment(
      project,
      "Two",
    );
    await service.manuscript.appendSegment(project, "Three");
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
      "Prologue",
    );

    await service.mergeManuscriptSegments(project.projectFile, opening);

    const reloaded = await service.loadProject(project.projectFile);
    expect(reloaded.links.draft).toBe(opening);
    expect(fakeVault.getFileByPath(draft)).toBeNull();
    expect(reloaded.structureIssues).toEqual([]);
  });

  it("refuses to merge the last segment, which has nothing after it", async () => {
    await service.manuscript.appendSegment(project, "Two");

    await expect(
      service.mergeManuscriptSegments(
        project.projectFile,
        "Snowflake Projects/Novel/50_Manuscript/Two.md",
      ),
    ).rejects.toThrow(/no manuscript note after/iu);
  });

  it("keeps the project pointing at whatever note now comes first", async () => {
    const link = async (): Promise<unknown> =>
      (await service.readManagedFrontmatter(project.projectFile))[
        FRONTMATTER_KEYS.draft
      ];
    expect(await link()).toBe(
      "[[Snowflake Projects/Novel/50_Manuscript/Draft|Draft]]",
    );

    // A note written before the opening one takes its place at the front, and
    // the project has to follow it there.
    const prologue = await service.manuscript.prependSegment(
      project,
      "Prologue",
    );
    const reloaded = await service.loadProject(project.projectFile);
    expect(reloaded.links.draft).toBe(prologue);
    expect(await link()).toBe(
      "[[Snowflake Projects/Novel/50_Manuscript/Prologue|Prologue]]",
    );

    // Merging it away hands the front back to the note behind it.
    await service.mergeManuscriptSegments(project.projectFile, prologue);
    const merged = await service.loadProject(project.projectFile);
    expect(merged.links.draft).toBe(prologue);

    // And moving a later note to the front is followed too.
    const three = await service.manuscript.appendSegment(
      project,
      "Three",
    );
    await service.manuscript.moveSegment(merged, three, 0);
    const moved = await service.loadProject(project.projectFile);
    expect(moved.links.draft).toBe(three);
  });

  it("brings a draft kept outside the manuscript folder into it", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    // The author files their only draft somewhere else. Obsidian rewrites the
    // project's link to follow it, so the project still names it -- but a
    // manuscript is the manuscript folder, so the manuscript is now empty.
    await service.repository.renameFile(
      draft,
      "Snowflake Projects/Novel/80_Material/Draft.md",
    );
    await service.repository.updateFrontmatter(project.projectFile, {
      [FRONTMATTER_KEYS.draft]:
        "[[Snowflake Projects/Novel/80_Material/Draft|Draft]]",
    });
    await service.manuscript.writeSegment(
      "Snowflake Projects/Novel/80_Material/Draft.md",
      "# Draft\n\nProse the author would rather keep.\n",
    );

    const reported = await service.loadProject(project.projectFile);
    expect(reported.structureIssues.map((issue) => issue.code)).toContain(
      "missing-artifact",
    );

    const repaired = await service.repairMissingStructureItem(
      project.projectFile,
      `${project.rootPath}/50_Manuscript/Draft.md`,
    );

    // Brought home rather than left orphaned beside a fresh empty draft.
    expect(repaired.links.draft).toBe(draft);
    expect((await service.manuscript.readSegment(draft)).body).toBe(
      "# Draft\n\nProse the author would rather keep.\n",
    );
    expect(
      fakeVault.getFileByPath("Snowflake Projects/Novel/80_Material/Draft.md"),
    ).toBeNull();
    expect(repaired.structureIssues).toEqual([]);
  });

  it("moves a segment without touching what any of them say", async () => {
    await service.manuscript.appendSegment(project, "Two");
    const three = await service.manuscript.appendSegment(
      project,
      "Three",
    );
    const bodyBefore = (await service.manuscript.readSegment(three)).body;

    await service.manuscript.moveSegment(
      project,
      three,
      0,
    );

    expect(await titles()).toEqual(["Three", "Draft", "Two"]);
    expect((await service.manuscript.readSegment(three)).body).toBe(bodyBefore);
  });

  it("keeps the frontmatter when text is written back", async () => {
    const draft = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
    await service.manuscript.appendSegment(project, "Two");

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
    await service.manuscript.appendSegment(project, "Two");
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
    expect(issue?.names).toEqual(["50_Manuscript/Two"]);
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
    // One to a line in the report, and each by where it is filed.
    expect(issue?.names).toEqual(["50_Manuscript/Draft", "50_Manuscript/Two"]);
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
      (await service.manuscript.listSegments(project)).map(
        ({ sequence }) => sequence,
      ),
    ).toEqual([1024, 2048]);
  });
});

describe("what a manuscript costs to read", () => {
  let fakeVault: FakeVault;
  let fakeMetadataCache: FakeMetadataCache;
  let service: SnowflakeProjectService;
  let project: ProjectSnapshot;

  const reads = (): string[] =>
    fakeVault.readCalls.filter((path) => path.includes("/50_Manuscript/"));

  const sequenceOf = (path: string): unknown =>
    parseMarkdownFrontmatter(fakeVault.contents.get(path) ?? "").frontmatter[
      FRONTMATTER_KEYS.manuscriptSequence
    ];

  /**
   * Moves every manuscript note's stat without changing a byte, the state a
   * renumbering or an outside edit leaves behind: whatever was read before
   * can no longer be trusted, and the repository's record of it goes stale.
   */
  const ageManuscript = (): void => {
    for (const path of [...fakeVault.contents.keys()]) {
      if (path.includes("/50_Manuscript/")) {
        fakeVault.write(path, fakeVault.contents.get(path) ?? "");
      }
    }
  };

  beforeEach(async () => {
    const environment = createFakeEnvironment();
    fakeVault = environment.fakeVault;
    fakeMetadataCache = environment.fakeMetadataCache;
    service = new SnowflakeProjectService(
      environment.vault,
      environment.fileManager,
      environment.metadataCache,
    );
    project = await service.createProject({ title: "Novel", locale: "en" });
    for (const title of ["Two", "Three", "Four"]) {
      await service.manuscript.appendSegment(project, title);
    }
    project = await service.loadProject(project.projectFile);
  });

  it("opens no note to say what order the manuscript reads in", async () => {
    fakeVault.readCalls.length = 0;
    const segments = await service.manuscript.listSegments(project);

    expect(segments.map(({ title }) => title)).toEqual([
      "Draft",
      "Two",
      "Three",
      "Four",
    ]);
    expect(reads()).toEqual([]);
  });

  it("opens every note when the answer is about to be written back", async () => {
    // Aged first: a record still fresh is as good as the file, so only notes
    // that have moved since they were last read cost anything to consult.
    ageManuscript();
    fakeVault.readCalls.length = 0;
    await service.manuscript.listSegmentsFromFiles(project);

    expect(new Set(reads()).size).toBe(4);
  });

  it("re-opens nothing it already holds, when nothing has moved", async () => {
    await service.manuscript.listSegmentsFromFiles(project);
    fakeVault.readCalls.length = 0;
    await service.manuscript.listSegmentsFromFiles(project);

    expect(reads()).toEqual([]);
  });

  it("goes over the manuscript once to load a project, not twice", async () => {
    fakeVault.readCalls.length = 0;
    fakeMetadataCache.getFileCacheCalls.length = 0;
    // The snapshot cache would answer for free; the question here is what a
    // real rebuild pays, so it is made to happen.
    service.forgetSnapshots();
    await service.loadProject(project.projectFile);

    // Both questions a load asks of the manuscript -- what order it reads in,
    // and whether anything is wrong with that order -- come off one pass.
    expect(fakeMetadataCache.getFileCacheCalls).toHaveLength(4);
    // Step 10's artifact is the opening note, which is read for its content on
    // any project. Nothing else in the manuscript is opened at all.
    expect(new Set(reads())).toEqual(
      new Set(["Snowflake Projects/Novel/50_Manuscript/Draft.md"]),
    );
  });

  it("finds a note the index has not caught up with", async () => {
    const three = "Snowflake Projects/Novel/50_Manuscript/Three.md";
    fakeMetadataCache.unindexed.add(three);

    const segments = await service.manuscript.listSegments(project);

    expect(segments.map(({ title }) => title)).toEqual([
      "Draft",
      "Two",
      "Three",
      "Four",
    ]);
    expect(segments[2]?.hasStoredSequence).toBe(true);
    // Found by opening it, which is the price of the index not knowing it yet.
    expect(reads()).toContain(three);
  });

  it("finds a note the index has an entry for but no frontmatter in", async () => {
    // The state a note passes through between being written and having its
    // frontmatter put in. Taken at its word, the note drops out of its own
    // manuscript, and a stream centred on it loses the reader's place.
    const three = "Snowflake Projects/Novel/50_Manuscript/Three.md";
    fakeMetadataCache.halfSeen.add(three);

    const segments = await service.manuscript.listSegments(project);

    expect(segments.map(({ title }) => title)).toEqual([
      "Draft",
      "Two",
      "Three",
      "Four",
    ]);
    expect(segments[2]?.hasStoredSequence).toBe(true);
    expect(reads()).toContain(three);
  });

  it("keeps a note the index has only half seen right after it was made", async () => {
    const created = await service.manuscript.insertSegmentAfter(
      project,
      "Snowflake Projects/Novel/50_Manuscript/Two.md",
      "Two And A Half",
    );
    fakeMetadataCache.halfSeen.add(created);

    expect(
      (await service.manuscript.listSegments(project)).map(({ title }) => title),
    ).toEqual(["Draft", "Two", "Two And A Half", "Three", "Four"]);
  });

  it("reports a place the index has not caught up with as it is written", async () => {
    const two = "Snowflake Projects/Novel/50_Manuscript/Two.md";
    await service.repository.updateFrontmatter(two, {
      [FRONTMATTER_KEYS.manuscriptSequence]: "second",
    });
    fakeMetadataCache.unindexed.add(two);

    const snapshot = await service.loadProject(project.projectFile);

    expect(snapshot.structureIssues.map((issue) => issue.code)).toContain(
      "invalid-manuscript-sequence",
    );
  });

  it("opens two notes to place a chapter between them, not the book", async () => {
    // Every note aged, so any the insertion consulted would show in the
    // count: the book staying closed is the point.
    ageManuscript();
    fakeVault.readCalls.length = 0;
    const placed = await service.manuscript.insertSegmentAfter(
      project,
      "Snowflake Projects/Novel/50_Manuscript/Two.md",
      "Two And A Half",
    );

    expect(
      (await service.manuscript.listSegments(project)).map(
        ({ title }) => title,
      ),
    ).toEqual(["Draft", "Two", "Two And A Half", "Three", "Four"]);
    // Only the pair the new place goes between, and the note being created.
    expect(new Set(reads())).toEqual(
      new Set([
        "Snowflake Projects/Novel/50_Manuscript/Two.md",
        "Snowflake Projects/Novel/50_Manuscript/Three.md",
        placed,
      ]),
    );
  });

  it("opens one note to add a chapter at the end", async () => {
    fakeVault.readCalls.length = 0;
    const added = await service.manuscript.appendSegment(project, "Five");

    expect(new Set(reads())).toEqual(
      new Set(["Snowflake Projects/Novel/50_Manuscript/Four.md", added]),
    );
    expect(sequenceOf(added)).toBe(5 * 1024);
  });

  it("goes back to the notes when the index is behind on a place it needs", async () => {
    // What a renumbering leaves behind: the run was rewritten whole, so the
    // index is behind on the very notes the new place goes between.
    const stale = (path: string, sequence: number): void => {
      fakeMetadataCache.behind.set(path, {
        "snowflake-schema": 1,
        "snowflake-document": "draft",
        "snowflake-project-id": project.id,
        [FRONTMATTER_KEYS.manuscriptSequence]: sequence,
      });
    };
    stale("Snowflake Projects/Novel/50_Manuscript/Two.md", 2000);
    stale("Snowflake Projects/Novel/50_Manuscript/Three.md", 3000);
    // The rewrite moved the files as well, so the repository's records of
    // them are as far behind as the index.
    ageManuscript();
    fakeVault.readCalls.length = 0;

    const placed = await service.manuscript.insertSegmentAfter(
      project,
      "Snowflake Projects/Novel/50_Manuscript/Two.md",
      "Two And A Half",
    );

    // Every note opened, because one answer being wrong makes all of them
    // suspect -- and the place is worked out from what the notes really say,
    // not from the 2500 the index would have given.
    expect(new Set(reads()).size).toBeGreaterThan(4);
    expect(sequenceOf(placed)).toBe(2560);
    expect(
      (await service.manuscript.listSegmentsFromFiles(project)).map(
        ({ title }) => title,
      ),
    ).toEqual(["Draft", "Two", "Two And A Half", "Three", "Four"]);
  });

  it("places a chapter beside one the index has never seen", async () => {
    const three = "Snowflake Projects/Novel/50_Manuscript/Three.md";
    fakeMetadataCache.unindexed.add(three);

    const placed = await service.manuscript.insertSegmentAfter(
      project,
      three,
      "Three And A Half",
    );

    expect(sequenceOf(placed)).toBe(3584);
    expect(
      (await service.manuscript.listSegments(project)).map(({ title }) => title),
    ).toEqual(["Draft", "Two", "Three", "Three And A Half", "Four"]);
  });

  it("goes back to the notes when a place has not been written down yet", async () => {
    // A manuscript grown from the single draft every older project has: the
    // index cannot tell a place it has not caught from one that was never
    // written, and the second would send that note to the back of the book.
    const environment = createFakeEnvironment();
    const grown = new SnowflakeProjectService(
      environment.vault,
      environment.fileManager,
      environment.metadataCache,
    );
    const fresh = await grown.createProject({ title: "Grown", locale: "en" });
    environment.fakeVault.readCalls.length = 0;

    await grown.manuscript.appendSegment(fresh, "Chapter Two");

    expect(
      (await grown.manuscript.listSegments(fresh)).map(({ title }) => title),
    ).toEqual(["Draft", "Chapter Two"]);
    expect(
      environment.fakeVault.readCalls.some((path) => path.endsWith("Draft.md")),
    ).toBe(true);
  });

  it("says how a note stands without opening it", async () => {
    const two = "Snowflake Projects/Novel/50_Manuscript/Two.md";
    const before = service.manuscript.segmentStamp(two);
    fakeVault.readCalls.length = 0;

    expect(service.manuscript.segmentStamp(two)).toBe(before);
    expect(reads()).toEqual([]);

    await service.manuscript.writeSegment(two, "# Two\n\nRewritten.\n");

    expect(service.manuscript.segmentStamp(two)).not.toBe(before);
    expect(service.manuscript.segmentStamp("Nowhere.md")).toBeNull();
  });
});

describe("renaming manuscript notes in a batch", () => {
  let fakeVault: FakeVault;
  let renameCalls: Array<{ from: string; to: string }>;
  let service: SnowflakeProjectService;
  let project: ProjectSnapshot;
  const folder = "Snowflake Projects/Novel/50_Manuscript";

  const titles = async (): Promise<string[]> =>
    (await service.manuscript.listSegments(project)).map(({ title }) => title);
  const bodyOf = (path: string): string =>
    parseMarkdownFrontmatter(fakeVault.contents.get(path) ?? "").body;
  const sequenceOf = (path: string): unknown =>
    parseMarkdownFrontmatter(fakeVault.contents.get(path) ?? "").frontmatter[
      FRONTMATTER_KEYS.manuscriptSequence
    ];

  beforeEach(async () => {
    const environment = createFakeEnvironment();
    fakeVault = environment.fakeVault;
    renameCalls = environment.fakeFileManager.renameCalls;
    service = new SnowflakeProjectService(
      environment.vault,
      environment.fileManager,
      environment.metadataCache,
    );
    project = await service.createProject({ title: "Novel", locale: "en" });
    for (const title of ["Chapter 3", "Chapter 4", "Chapter 5"]) {
      await service.manuscript.appendSegment(project, title);
    }
  });

  it("moves every note up by one, the last first, so no name is ever taken twice", async () => {
    const before = renameCalls.length;
    const sequences = [3, 4, 5].map((n) => sequenceOf(`${folder}/Chapter ${n}.md`));

    const outcome = await service.manuscript.renameSegments(project, [
      { path: `${folder}/Chapter 3.md`, title: "Chapter 4" },
      { path: `${folder}/Chapter 4.md`, title: "Chapter 5" },
      { path: `${folder}/Chapter 5.md`, title: "Chapter 6" },
    ]);

    expect(renameCalls.slice(before).map((call) => call.to.split("/").pop())).toEqual([
      "Chapter 6.md",
      "Chapter 5.md",
      "Chapter 4.md",
    ]);
    expect(outcome).toEqual({
      renamed: [
        { from: `${folder}/Chapter 5.md`, to: `${folder}/Chapter 6.md` },
        { from: `${folder}/Chapter 4.md`, to: `${folder}/Chapter 5.md` },
        { from: `${folder}/Chapter 3.md`, to: `${folder}/Chapter 4.md` },
      ],
      skipped: [],
    });
    expect(await titles()).toEqual(["Draft", "Chapter 4", "Chapter 5", "Chapter 6"]);
    // The positions are the notes' own and never move with a name.
    expect([4, 5, 6].map((n) => sequenceOf(`${folder}/Chapter ${n}.md`))).toEqual(
      sequences,
    );
  });

  it("rewrites the heading only where it still is the name the note was made under", async () => {
    // One author kept the heading the template wrote; another wrote their own.
    await service.manuscript.writeSegment(
      `${folder}/Chapter 4.md`,
      "# The Long Road\n\nWords.\n",
    );

    await service.manuscript.renameSegments(project, [
      { path: `${folder}/Chapter 3.md`, title: "Chapter 4" },
      { path: `${folder}/Chapter 4.md`, title: "Chapter 5" },
      { path: `${folder}/Chapter 5.md`, title: "Chapter 6" },
    ]);

    expect(bodyOf(`${folder}/Chapter 4.md`)).toContain("# Chapter 4\n");
    expect(bodyOf(`${folder}/Chapter 4.md`)).not.toContain("# Chapter 3");
    expect(bodyOf(`${folder}/Chapter 5.md`)).toContain("# The Long Road\n");
    expect(bodyOf(`${folder}/Chapter 6.md`)).toContain("# Chapter 6\n");
  });

  it("refuses the whole batch when a name it needs is taken by a note outside it", async () => {
    await fakeVault.create(`${folder}/Chapter 6.md`, "# Stray\n\nNot a draft.\n");
    const before = renameCalls.length;

    await expect(
      service.manuscript.renameSegments(project, [
        { path: `${folder}/Chapter 4.md`, title: "Chapter 5" },
        { path: `${folder}/Chapter 5.md`, title: "Chapter 6" },
      ]),
    ).rejects.toThrow(/Chapter 6\.md/u);

    expect(renameCalls.length).toBe(before);
    expect(await titles()).toEqual(["Draft", "Chapter 3", "Chapter 4", "Chapter 5"]);
  });

  it("refuses a batch that would give two notes one name", async () => {
    const before = renameCalls.length;
    await expect(
      service.manuscript.renameSegments(project, [
        { path: `${folder}/Chapter 3.md`, title: "Chapter 9" },
        { path: `${folder}/Chapter 4.md`, title: "Chapter 9" },
      ]),
    ).rejects.toThrow(/Chapter 9\.md/u);
    expect(renameCalls.length).toBe(before);
  });

  it("moves every note down by one, the first first, so each takes the name the note before it gave up", async () => {
    const before = renameCalls.length;

    const outcome = await service.manuscript.renameSegments(project, [
      { path: `${folder}/Chapter 3.md`, title: "Chapter 2" },
      { path: `${folder}/Chapter 4.md`, title: "Chapter 3" },
      { path: `${folder}/Chapter 5.md`, title: "Chapter 4" },
    ]);

    expect(renameCalls.slice(before).map((call) => call.to.split("/").pop())).toEqual([
      "Chapter 2.md",
      "Chapter 3.md",
      "Chapter 4.md",
    ]);
    expect(outcome.renamed.map(({ to }) => to.split("/").pop())).toEqual([
      "Chapter 2.md",
      "Chapter 3.md",
      "Chapter 4.md",
    ]);
    expect(await titles()).toEqual(["Draft", "Chapter 2", "Chapter 3", "Chapter 4"]);
    expect(bodyOf(`${folder}/Chapter 2.md`)).toContain("# Chapter 2\n");
  });

  it("reads the order off the names, however the batch is written", async () => {
    const before = renameCalls.length;

    await service.manuscript.renameSegments(project, [
      { path: `${folder}/Chapter 5.md`, title: "Chapter 4" },
      { path: `${folder}/Chapter 4.md`, title: "Chapter 3" },
      { path: `${folder}/Chapter 3.md`, title: "Chapter 2" },
    ]);

    expect(renameCalls.slice(before).map((call) => call.to.split("/").pop())).toEqual([
      "Chapter 2.md",
      "Chapter 3.md",
      "Chapter 4.md",
    ]);
  });

  it("refuses a batch in which two notes would trade names", async () => {
    const before = renameCalls.length;
    await expect(
      service.manuscript.renameSegments(project, [
        { path: `${folder}/Chapter 3.md`, title: "Chapter 4" },
        { path: `${folder}/Chapter 4.md`, title: "Chapter 3" },
      ]),
    ).rejects.toThrow(/Chapter [34]\.md/u);
    expect(renameCalls.length).toBe(before);
    expect(await titles()).toEqual(["Draft", "Chapter 3", "Chapter 4", "Chapter 5"]);
  });

  it("closes the gap a merged note leaves, the freed name taken first", async () => {
    const before = renameCalls.length;

    const { renumbered } = await service.mergeManuscriptSegments(
      project.projectFile,
      `${folder}/Draft.md`,
      [
        { path: `${folder}/Chapter 4.md`, title: "Chapter 3" },
        { path: `${folder}/Chapter 5.md`, title: "Chapter 4" },
      ],
    );

    expect(renumbered.renamed.map(({ to }) => to.split("/").pop())).toEqual([
      "Chapter 3.md",
      "Chapter 4.md",
    ]);
    expect(renameCalls.slice(before).map((call) => call.to.split("/").pop())).toEqual([
      "Chapter 3.md",
      "Chapter 4.md",
    ]);
    expect(await titles()).toEqual(["Draft", "Chapter 3", "Chapter 4"]);
    // The absorbed text is in the survivor, and the note that took the freed
    // name carries it as its heading too.
    expect(bodyOf(`${folder}/Draft.md`)).toContain("# Chapter 3\n");
    expect(bodyOf(`${folder}/Chapter 3.md`)).toContain("# Chapter 3\n");
    expect(bodyOf(`${folder}/Chapter 3.md`)).not.toContain("# Chapter 4");
  });

  it("refuses the whole merge when a name the renumbering needs is taken, nothing joined", async () => {
    await fakeVault.create(`${folder}/Chapter 2.md`, "# Stray\n\nNot a draft.\n");
    const before = renameCalls.length;

    await expect(
      service.mergeManuscriptSegments(project.projectFile, `${folder}/Chapter 3.md`, [
        { path: `${folder}/Chapter 5.md`, title: "Chapter 2" },
      ]),
    ).rejects.toThrow(/Chapter 2\.md/u);

    expect(renameCalls.length).toBe(before);
    expect(await titles()).toEqual(["Draft", "Chapter 3", "Chapter 4", "Chapter 5"]);
    expect(fakeVault.getFileByPath(`${folder}/Chapter 4.md`)).not.toBeNull();
  });

  it("leaves a note alone whose name does not change, and answers nothing for an empty batch", async () => {
    expect(await service.manuscript.renameSegments(project, [])).toEqual({
      renamed: [],
      skipped: [],
    });
    const before = renameCalls.length;
    expect(
      await service.manuscript.renameSegments(project, [
        { path: `${folder}/Chapter 3.md`, title: "Chapter 3" },
      ]),
    ).toEqual({ renamed: [], skipped: [] });
    expect(renameCalls.length).toBe(before);
  });
});
