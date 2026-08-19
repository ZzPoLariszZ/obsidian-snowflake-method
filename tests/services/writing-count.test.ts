import { beforeEach, describe, expect, it } from "vitest";

import {
  SnowflakeProjectService,
  type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const DRAFT = "Snowflake Projects/Novel/50_Manuscript/Draft.md";

const CHARACTER_NOTE = `---
snowflake-schema: 3
snowflake-document: character
---

# Alice

<!-- snowflake:section:character-fields:start -->
> [!info] Fields
> **Storyline**: generated words that must never count
<!-- snowflake:section:character-fields:end -->

## World status

<!-- snowflake:section:world-status:start -->
- At dawn, [[Places/Harbor|the harbor]] holds.
<!-- snowflake:section:world-status:end -->

## Synopsis

<!-- snowflake:section:character-synopsis:start -->
Alice fights the tide.
<!-- snowflake:section:character-synopsis:end -->

Free words outside.
`;

/**
 * A note whose generated block sits inside a section the count reads, so the
 * section and the note have to agree about it, and whose synopsis carries a
 * heading of the author's own under the note's title.
 */
const NESTED_BODY = `# Alice

<!-- snowflake:section:character-synopsis:start -->
# Her winter

Alice fights the tide.

<!-- snowflake:section:character-fields:start -->
> [!info] Fields
> **Storyline**: generated words that must never count
<!-- snowflake:section:character-fields:end -->
<!-- snowflake:section:character-synopsis:end -->
`;

describe("WritingCountService", () => {
  let fakeVault: FakeVault;
  let service: SnowflakeProjectService;
  let project: ProjectSnapshot;

  const processor = { mode: "ms-word", headings: "count" } as const;
  const platform = { mode: "chenggua", headings: "count" } as const;
  const qidianMode = { mode: "qidian", headings: "count" } as const;
  const official = { mode: "jinjiang", headings: "count" } as const;

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

  it("counts a managed note without its plugin-written sections", async () => {
    const path = "Snowflake Projects/Novel/20_Character/Alice.md";
    await fakeVault.create(path, CHARACTER_NOTE);

    // Alice + World status + Synopsis + the synopsis prose + the free line;
    // the fields block and the record section stay out of the number.
    expect(await service.writingCount.countNote(path, processor)).toEqual({
      cjkCharacters: 0,
      words: 11,
      punctuationMarks: 0,
      charactersWithSpaces: 89,
      charactersNoSpaces: 60,
      total: 11,
    });
  });

  it("leaves the headings out when asked to, the note's own name first", async () => {
    const path = "Snowflake Projects/Novel/20_Character/Alice.md";
    await fakeVault.create(path, CHARACTER_NOTE);

    // The name at the top goes, the two section headings stay.
    expect(
      (await service.writingCount.countNote(path, {
        ...processor,
        headings: "skip-h1",
      }))?.total,
    ).toBe(10);
    // World status, Synopsis, and Alice, all three gone.
    expect(
      (await service.writingCount.countNote(path, {
        ...processor,
        headings: "skip-all",
      }))?.total,
    ).toBe(7);
  });

  it("counts an unmanaged note in full, markdown stripped", async () => {
    const path = "Snowflake Projects/Novel/Loose note.md";
    await fakeVault.create(path, "# Ideas\n\nSome **loose** thoughts.\n");

    expect(await service.writingCount.countNote(path, processor)).toEqual({
      cjkCharacters: 0,
      words: 4,
      punctuationMarks: 0,
      charactersWithSpaces: 29,
      charactersNoSpaces: 23,
      total: 4,
    });
  });

  it("counts a note by whichever convention it is asked for", async () => {
    const path = "Snowflake Projects/Novel/Loose note.md";
    await fakeVault.create(path, "你好——café, привет\n");

    // A word processor reads the dash as a separator worth nothing and every
    // script in words: 你好 and café, and привет.
    expect((await service.writingCount.countNote(path, processor))?.total).toBe(
      4,
    );
    // Chenggua counts the dash twice and Cyrillic by the character, while
    // café stays one Latin word.
    expect((await service.writingCount.countNote(path, platform))?.total).toBe(
      11,
    );
    // Qidian draws the same line at ASCII instead, so café parts into two
    // and the comma counts on its own.
    expect((await service.writingCount.countNote(path, qidianMode))?.total).toBe(
      13,
    );
    // Jinjiang counts what is on the page one character at a time.
    expect((await service.writingCount.countNote(path, official))?.total).toBe(
      15,
    );
  });

  describe("one section counted on its own", () => {
    const caretIn = (needle: string): number => NESTED_BODY.indexOf(needle);

    it("leaves out a plugin-written block nested inside it", () => {
      // Her winter, Alice fights the tide: the fields block is a view of the
      // properties wherever it sits, so the section can never come to more
      // than the note that holds it.
      expect(
        service.writingCount.countSectionAt(
          NESTED_BODY,
          "character",
          caretIn("fights"),
          processor,
        )?.total,
      ).toBe(6);
      expect(
        service.writingCount.countBody(NESTED_BODY, "character", processor)
          .total,
      ).toBe(7);
    });

    it("keeps the author's own heading and spends the title on the note's", () => {
      const options = { ...processor, headings: "skip-first-h1" } as const;
      // Alice goes as the note's title; Her winter is the author's and stays,
      // in the section exactly as in the note.
      expect(
        service.writingCount.countSectionAt(
          NESTED_BODY,
          "character",
          caretIn("fights"),
          options,
        )?.total,
      ).toBe(6);
      expect(
        service.writingCount.countBody(NESTED_BODY, "character", options).total,
      ).toBe(6);
    });

    it("names no section the note's own total leaves out", () => {
      // Outside every section the count reads, so the note answers instead.
      expect(
        service.writingCount.countSectionAt(
          NESTED_BODY,
          "character",
          caretIn("# Alice"),
          processor,
        ),
      ).toBeNull();
      // Inside the generated block, which is never a section of its own: the
      // one holding it answers, and answers without it.
      expect(
        service.writingCount.countSectionAt(
          NESTED_BODY,
          "character",
          caretIn("Storyline"),
          processor,
        )?.total,
      ).toBe(6);
    });
  });

  it("says how many notes a scope holds that would not read", async () => {
    const clean = await service.writingCount.countProject(
      project,
      "project",
      processor,
    );
    expect(clean.unreadable).toBe(0);

    await fakeVault.create(
      "Snowflake Projects/Novel/Broken.md",
      "---\n- not\n- a mapping\n---\n\nWords nobody will count.\n",
    );
    const counted = await service.writingCount.countProject(
      project,
      "project",
      processor,
    );

    // The words are missing from the totals either way; what must not go
    // missing with them is any sign that a note was left out.
    expect(counted.unreadable).toBe(1);
    expect(counted.notes).toBe(clean.notes);
    expect(counted.total).toBe(clean.total);
  });

  it("forgets a path so the next note there is not answered for the last", async () => {
    const path = "Snowflake Projects/Novel/Loose note.md";
    await fakeVault.create(path, "one two\n");
    expect((await service.writingCount.countNote(path, processor))?.total).toBe(2);

    // A rename carries a note's modified time and size with it, so the note
    // that moves into a path can stamp exactly as the one that moved out did.
    const file = fakeVault.getFileByPath(path);
    const stat = { ...file!.stat };
    fakeVault.contents.set(path, "one2two\n");
    file!.stat.mtime = stat.mtime;
    file!.stat.size = stat.size;

    service.repository.forget(path);
    expect((await service.writingCount.countNote(path, processor))?.total).toBe(2);
    service.writingCount.forget(path);
    expect((await service.writingCount.countNote(path, processor))?.total).toBe(1);
  });

  it("returns null for a note that is not there", async () => {
    expect(
      await service.writingCount.countNote("Nowhere/gone.md", processor),
    ).toBeNull();
  });

  it("recounts a note when its content changes", async () => {
    const path = "Snowflake Projects/Novel/Loose note.md";
    await fakeVault.create(path, "one two\n");
    expect((await service.writingCount.countNote(path, processor))?.total).toBe(2);

    fakeVault.contents.set(path, "one two three four\n");
    expect((await service.writingCount.countNote(path, processor))?.total).toBe(4);
  });

  it("counts the manuscript scope from every draft note", async () => {
    await service.manuscript.writeSegment(DRAFT, "Seven words are in this draft body.");
    const counted = await service.writingCount.countProject(
      project,
      "manuscript",
      processor,
    );

    expect(counted.scope).toBe("manuscript");
    expect(counted.notes).toBe(1);
    expect(counted.total).toBe(7);
  });

  /**
   * A file under the project folder proves nothing about whose writing it
   * holds. Only what a note declares does, so a note nobody's project made
   * and a note another project made are both outside this one's count.
   */
  it("counts only the notes the project itself declares", async () => {
    await service.manuscript.writeSegment(DRAFT, "Seven words are in this draft body.");
    const before = await service.writingCount.countProject(
      project,
      "project",
      processor,
    );

    await fakeVault.create(
      "Snowflake Projects/Novel/Loose note.md",
      "Four loose words here.\n",
    );
    await fakeVault.create(
      "Snowflake Projects/Novel/Borrowed.md",
      [
        "---",
        "snowflake-schema: 3",
        "snowflake-document: material",
        "snowflake-project-id: some-other-project",
        "---",
        "",
        "Words belonging to somebody else.\n",
      ].join("\n"),
    );

    const counted = await service.writingCount.countProject(
      project,
      "project",
      processor,
    );

    expect(counted.scope).toBe("project");
    expect(counted.notes).toBe(before.notes);
    expect(counted.total).toBe(before.total);
    // Neither is unreadable: both read perfectly well and simply are not this
    // project's writing.
    expect(counted.unreadable).toBe(0);
  });

  /**
   * The manuscript is the subset of the project it is, so both are read off
   * one walk and can never be counted at two different moments or by two
   * different rules.
   */
  it("reads both scopes from one walk and agrees with each on its own", async () => {
    await service.manuscript.writeSegment(DRAFT, "Seven words are in this draft body.");

    const scopes = await service.writingCount.countScopes(project, processor);
    expect(scopes.manuscript.notes).toBe(1);
    expect(scopes.manuscript.total).toBe(7);
    expect(scopes.project.notes).toBeGreaterThan(scopes.manuscript.notes);
    expect(scopes.project.total).toBeGreaterThanOrEqual(scopes.manuscript.total);

    for (const scope of ["project", "manuscript"] as const) {
      expect(
        await service.writingCount.countProject(project, scope, processor),
      ).toEqual(scopes[scope]);
    }
  });

  it("says which scopes hold one note, and which hold none", async () => {
    await service.manuscript.writeSegment(DRAFT, "Seven words are in this draft body.");
    await fakeVault.create(
      "Snowflake Projects/Novel/Loose note.md",
      "Four loose words here.\n",
    );

    const scopesOf = (path: string) =>
      service.writingCount.scopesOf(project, path);
    expect(await scopesOf(DRAFT)).toEqual(["project", "manuscript"]);
    expect(await scopesOf(`${project.rootPath}/00_System/001_Project_Metadata.md`)).toEqual([
      "project",
    ]);
    expect(await scopesOf("Snowflake Projects/Novel/Loose note.md")).toEqual([]);
    expect(await scopesOf("Elsewhere/Other.md")).toEqual([]);
  });
});
