import { normalizePath, type TFile } from "obsidian";

import {
  FRONTMATTER_KEYS,
  SCHEMA_VERSION,
  fileStem,
  fingerprint,
  moveSegment,
  safeFileName,
  repairSequences,
  resolveSegments,
  sequenceAtEnd,
  sequenceBetween,
  type ManuscriptSegment,
  type StoredSegment,
} from "../domain";
import {
  ManagedFileNotFoundError,
  UnsupportedSchemaError,
  projectIdOf,
  type ManagedEntryRecord,
  type VaultRepository,
} from "../repository";
import { manuscriptSegmentTemplate } from "../templates";
import {
  PROJECT_PATH_LAYOUTS,
  getProjectPathLayout,
  type ProjectRef,
} from "./types";

export interface ManuscriptSegmentRecord extends ManuscriptSegment {
  /** True when the note declares a schema this build cannot write. */
  readOnly: boolean;
  /**
   * The position as the frontmatter writes it, kept beside the one the
   * manuscript resolved. The health check has to see a value that is missing or
   * unusable, which a resolved position has already papered over -- carrying it
   * here is what lets one pass over the notes answer both questions.
   */
  storedSequence: unknown;
}

export interface ManuscriptSegmentContent {
  path: string;
  title: string;
  /** Everything below the frontmatter. The frontmatter is never shown. */
  body: string;
  /** Fingerprint of the whole file, so a save can refuse to clobber. */
  revision: string;
  /** What the Vault says about the file, so an unchanged one can be left. */
  stamp: string;
  readOnly: boolean;
}

/**
 * The notes an operation is about to compute a new position from, named from
 * the manuscript's order. Everything else about that order can be taken on the
 * index's word; these have to be read.
 */
type Interest = (
  ordered: readonly ManuscriptSegmentRecord[],
) => readonly (string | undefined)[];

const firstOf: Interest = (ordered) => [ordered[0]?.path];

const lastOf: Interest = (ordered) => [ordered[ordered.length - 1]?.path];

/** A note and the one after it, which is what goes between or joins together. */
function pairAt(target: string): Interest {
  return (ordered) => {
    const index = ordered.findIndex((segment) => segment.path === target);
    return index === -1 ? [] : [ordered[index]?.path, ordered[index + 1]?.path];
  };
}

/**
 * A project's manuscript: the notes it is written in, and the order they are
 * read in.
 *
 * Kept apart from SnowflakeProjectService because it answers a different
 * question. That service owns the ten steps and the notes that plan a novel,
 * every one of which the plugin writes into and reads structure out of. A
 * manuscript note is prose. The only thing stored about it is where it sits,
 * and the only thing done to it is putting text back where the author left it.
 */
export class ManuscriptService {
  constructor(readonly repository: VaultRepository) {}

  /**
   * Told when a merge trashes the absorbed note, with the body it held. The
   * writing-session service listens: a vault delete event cannot say what
   * the note contained, and without this a merge outside a session would
   * credit the absorbed text as newly written while the removal credited
   * nothing -- the day would gain a segment nobody wrote.
   */
  onSegmentRemoved: ((path: string, body: string) => void) | null = null;

  /**
   * Every note of the manuscript, in the order it reads in.
   *
   * A manuscript is what is in the manuscript folder, at any depth, and nothing
   * else. Notes were once also found by following the project's own link, which
   * let one live anywhere in the Vault; that made the link load-bearing and the
   * manuscript's contents depend on a field nobody types.
   */
  async listSegments(project: ProjectRef): Promise<ManuscriptSegmentRecord[]> {
    return resolve(await this.declared(project));
  }

  /**
   * The same manuscript, read from the notes rather than from the index.
   *
   * Everything that works out a new position from the positions already there
   * comes through here, and so does anything deciding whether a note needs
   * writing at all. The index is a beat behind the file it describes, and a
   * beat is long enough to place a note twice or to number one on top of
   * another. Reading is different: it happens on every Vault event and can
   * afford to be a beat behind, because the next event brings it level again.
   */
  async listSegmentsFromFiles(
    project: ProjectRef,
  ): Promise<ManuscriptSegmentRecord[]> {
    return resolve(await this.collect(project));
  }

  /** The manuscript's notes as Obsidian has already parsed them. */
  private async declared(project: ProjectRef): Promise<ManagedEntryRecord[]> {
    return this.gather(project, (folder) =>
      this.repository.listManagedEntriesBelow(folder, "draft", project.id),
    );
  }

  /** The manuscript's notes as the notes themselves have them. */
  private async collect(project: ProjectRef): Promise<ManagedEntryRecord[]> {
    return this.gather(project, (folder) =>
      this.repository.findManagedFilesBelow(folder, "draft", project.id),
    );
  }

  private async gather(
    project: ProjectRef,
    from: (folder: string) => Promise<readonly ManagedEntryRecord[]>,
  ): Promise<ManagedEntryRecord[]> {
    const records = new Map<string, ManagedEntryRecord>();
    for (const folder of draftFolders(project)) {
      for (const record of await from(folder)) records.set(record.path, record);
    }
    return [...records.values()];
  }

  /** Whether a note sits in one of the folders a manuscript is scanned from. */
  isInManuscriptFolder(project: ProjectRef, path: string): boolean {
    const note = normalizePath(path);
    return draftFolders(project).some(
      (folder) => note === folder || note.startsWith(`${folder}/`),
    );
  }

  /** Everything below the frontmatter of one segment, ready to render or edit. */
  async readSegment(path: string): Promise<ManuscriptSegmentContent> {
    const record = await this.repository.readManaged(path);
    return {
      path: record.path,
      title: fileStem(record.path),
      body: record.body,
      revision: fingerprint(record.content),
      stamp: stampOf(record.file),
      readOnly: record.readOnly,
    };
  }

  /**
   * How the Vault last saw a segment's file, without opening it.
   *
   * A stream holds a dozen notes at once and is redrawn on every Vault event.
   * Reading all of them back to find out that none of them moved is the whole
   * of that work wasted; what changes when a note is written is its size or the
   * moment it was written, and both are already in memory.
   */
  segmentStamp(path: string): string | null {
    const file = this.repository.getFile(path);
    return file === null ? null : stampOf(file);
  }

  /**
   * Puts text back into one segment, and only that segment. The frontmatter is
   * untouched, and a revision that no longer matches means somebody else wrote
   * to the file first, so the save is refused rather than allowed to win.
   */
  async writeSegment(
    path: string,
    body: string,
    expectedRevision?: string,
  ): Promise<void> {
    await this.repository.replaceBody(path, body, expectedRevision, {
      userInput: true,
    });
  }

  async appendSegment(
    project: ProjectRef,
    title: string,
  ): Promise<string> {
    const segments = await this.settleOrder(project, lastOf);
    return this.createSegment(project, title, sequenceAtEnd(segments));
  }

  async prependSegment(
    project: ProjectRef,
    title: string,
  ): Promise<string> {
    const segments = await this.roomyOrder(project, firstOf, (ordered) =>
      sequenceBetween(null, ordered[0]?.sequence),
    );
    const sequence = sequenceBetween(null, segments[0]?.sequence);
    if (sequence === null) throw new Error("Cannot place a segment here.");
    return this.createSegment(project, title, sequence);
  }

  async insertSegmentAfter(
    project: ProjectRef,
    afterPath: string,
    title: string,
  ): Promise<string> {
    const target = normalizePath(afterPath);
    const segments = await this.roomyOrder(project, pairAt(target), (ordered) => {
      const index = ordered.findIndex((segment) => segment.path === target);
      if (index === -1) return null;
      return sequenceBetween(
        ordered[index]?.sequence,
        ordered[index + 1]?.sequence,
      );
    });
    const index = segments.findIndex((segment) => segment.path === target);
    if (index === -1) throw new ManagedFileNotFoundError(target);
    const sequence = sequenceBetween(
      segments[index]?.sequence,
      segments[index + 1]?.sequence,
    );
    if (sequence === null) throw new Error("Cannot place a segment here.");
    return this.createSegment(project, title, sequence);
  }

  /**
   * Cuts one segment in two at the caret, the remainder becoming a new segment
   * immediately after it. The seam is tidied to one blank line, which is the
   * only thing about the author's text this changes.
   */
  async splitSegment(
    project: ProjectRef,
    path: string,
    offset: number,
    title: string,
  ): Promise<string> {
    // Placed first, because placing it may write a position into the note being
    // split, and the revision guarding the write below has to be read after
    // that rather than before it.
    const created = await this.insertSegmentAfter(
      project,
      normalizePath(path),
      title,
    );
    const source = await this.readSegment(path);
    const cut = Math.max(0, Math.min(offset, source.body.length));
    // Blank lines at the seam are closed up and nothing else is touched --
    // indentation on the first line that carries over is the author's, and a
    // code block would not survive being tidied any harder than this.
    const before = `${source.body.slice(0, cut).replace(/\n+$/u, "")}\n`;
    const after = `${source.body.slice(cut).replace(/^\n+/u, "").replace(/\n+$/u, "")}\n`;

    await this.repository.replaceBody(created, after, undefined, {
      userInput: true,
    });
    await this.repository.replaceBody(source.path, before, source.revision, {
      userInput: true,
    });
    return created;
  }

  /**
   * Joins a note and the one after it into a single note.
   *
   * The earlier of the two survives, keeping its own frontmatter and so its own
   * position: the pair occupied one stretch of the manuscript and the merged
   * note takes the start of it, which is where a reader was already going to
   * meet this text. The later note goes to the trash with nothing in it that is
   * not now in the survivor.
   */
  async mergeWithNext(
    project: ProjectRef,
    path: string,
  ): Promise<{ kept: string; removed: string } | null> {
    const target = normalizePath(path);
    const segments = await this.orderAround(project, pairAt(target));
    const index = segments.findIndex((segment) => segment.path === target);
    const earlier = segments[index];
    const later = segments[index + 1];
    if (earlier === undefined || later === undefined) return null;
    if (earlier.readOnly || later.readOnly) {
      throw new UnsupportedSchemaError(
        earlier.readOnly ? earlier.path : later.path,
        SCHEMA_VERSION + 1,
        SCHEMA_VERSION,
      );
    }

    const head = await this.readSegment(earlier.path);
    const tail = await this.readSegment(later.path);
    const joined = `${head.body.replace(/\n+$/u, "")}\n\n${tail.body.replace(
      /^\n+/u,
      "",
    )}`;
    await this.repository.replaceBody(earlier.path, joined, head.revision, {
      userInput: true,
    });
    // Reported before the trash, so the removal is credited from the body in
    // hand and the delete event that follows finds it already settled.
    this.onSegmentRemoved?.(later.path, tail.body);
    await this.repository.trashFile(later.path);
    return { kept: earlier.path, removed: later.path };
  }

  /**
   * Moving and repairing read the manuscript rather than the index, and are the
   * only two things that do. Both may renumber the whole run, so every position
   * is one the answer is computed from -- there is no handful to check instead.
   * Both are also rare, and already write about as much as they read.
   */
  async moveSegment(
    project: ProjectRef,
    path: string,
    toIndex: number,
  ): Promise<void> {
    const before = await this.listSegmentsFromFiles(project);
    await this.persistSequences(
      before,
      moveSegment(before, normalizePath(path), toIndex),
    );
  }

  /** Regular intervals in the manuscript's current order. Returns what changed. */
  async repairSequences(project: ProjectRef): Promise<string[]> {
    const before = await this.listSegmentsFromFiles(project);
    return this.persistSequences(before, repairSequences(before));
  }

  private async createSegment(
    project: ProjectRef,
    title: string,
    sequence: number,
  ): Promise<string> {
    const name = title.trim();
    if (!name) throw new Error("Segment title is required.");
    const layout = getProjectPathLayout(project.locale);
    const created = await this.repository.createManagedFile({
      path: normalizePath(
        `${project.rootPath}/${layout.directories.draft}/${safeFileName(name)}.md`,
      ),
      uniqueOnConflict: true,
      userInput: true,
      template: manuscriptSegmentTemplate(name, project.locale),
      frontmatter: {
        [FRONTMATTER_KEYS.schema]: SCHEMA_VERSION,
        [FRONTMATTER_KEYS.document]: "draft",
        [FRONTMATTER_KEYS.projectId]: project.id,
        [FRONTMATTER_KEYS.manuscriptSequence]: sequence,
      },
    });
    return created.path;
  }

  /**
   * The manuscript's order, renumbered first if the caller cannot find room in
   * it. Insertions eventually exhaust the integer gap between two neighbours;
   * spreading everything back onto regular intervals is what makes room, and it
   * moves nothing and rewrites no prose.
   */
  private async roomyOrder(
    project: ProjectRef,
    interest: Interest,
    room: (ordered: readonly ManuscriptSegmentRecord[]) => number | null,
  ): Promise<ManuscriptSegmentRecord[]> {
    const segments = await this.settleOrder(project, interest);
    if (segments.length === 0 || room(segments) !== null) return segments;
    await this.repairSequences(project);
    return this.listSegmentsFromFiles(project);
  }

  /**
   * The manuscript in reading order, with the positions a new one is about to
   * be worked out from checked against the notes holding them.
   *
   * Opening a whole book to place one chapter in it costs a second on a long
   * one, and all but a few bytes of that is spent confirming what the index
   * already said. What has to be exactly right is the handful of positions the
   * arithmetic actually touches — the neighbours a new position goes between —
   * so those are read, and any disagreement hands the whole question back to
   * the notes. That is enough because the index only ever runs behind a note:
   * it can fail to have caught a position, but it cannot invent one, so a
   * position it agrees on is a position that is really there.
   *
   * The two ways this plugin can leave the index behind are both covered. A
   * note it has just made has no entry at all, and is read for that reason
   * alone; a run it has just renumbered was renumbered whole, so the
   * neighbours are always among the notes that moved. What is left over is a
   * position typed into a note by hand, elsewhere in the book, within the
   * moment before Obsidian reads it back -- that can produce two notes in one
   * place, which is what `duplicate-manuscript-sequence` is for and what two
   * devices syncing would produce anyway.
   */
  private async orderAround(
    project: ProjectRef,
    interest: Interest,
  ): Promise<ManuscriptSegmentRecord[]> {
    const ordered = await this.listSegments(project);
    for (const path of interest(ordered)) {
      if (path === undefined) continue;
      const record = await this.repository.tryReadManaged(path);
      if (record === null) return this.listSegmentsFromFiles(project);
      const declared = ordered.find((segment) => segment.path === path);
      if (
        record.frontmatter[FRONTMATTER_KEYS.manuscriptSequence] !==
        declared?.storedSequence
      ) {
        return this.listSegmentsFromFiles(project);
      }
    }
    return ordered;
  }

  /**
   * Writes down the order the manuscript already reads in, wherever a note was
   * only being held in place by the fallback.
   *
   * This is what makes the single-draft project every author already has grow
   * into a manuscript correctly. Its draft stores no position and needs none
   * while it is the whole book; the moment a second note is placed beside it,
   * an unwritten position would be recomputed from the notes that do have one
   * and the draft would slide to the end of its own manuscript.
   */
  private async settleOrder(
    project: ProjectRef,
    interest: Interest,
  ): Promise<ManuscriptSegmentRecord[]> {
    // Every position accounted for is a settled manuscript, and the index can
    // say so on its own: a note it has a position for has that position written
    // in it. Only the other answer needs the notes opened, because a position
    // the index has not caught yet looks exactly like one that was never
    // written -- and an unwritten position sends its note to the back of the
    // book, which is the one mistake here that moves an author's chapter.
    const declared = await this.orderAround(project, interest);
    if (declared.every((segment) => segment.hasStoredSequence)) return declared;

    const segments = await this.listSegmentsFromFiles(project);
    if (segments.every((segment) => segment.hasStoredSequence)) return segments;
    await this.persistSequences(segments, segments);
    return this.listSegmentsFromFiles(project);
  }

  /**
   * Writes back the positions an ordering change produced. A note that stored
   * none is always written even when its computed position is unchanged: what
   * it had was only the fallback, so skipping it would drop the order on the
   * next load.
   */
  private async persistSequences(
    before: readonly ManuscriptSegmentRecord[],
    after: readonly ManuscriptSegment[],
  ): Promise<string[]> {
    const previous = new Map(before.map((segment) => [segment.path, segment]));
    const written: string[] = [];
    for (const segment of after) {
      const stored = previous.get(segment.path);
      if (stored?.readOnly === true) continue;
      if (
        stored?.hasStoredSequence === true &&
        stored.sequence === segment.sequence
      ) {
        continue;
      }
      await this.repository.updateFrontmatter(segment.path, {
        [FRONTMATTER_KEYS.manuscriptSequence]: segment.sequence,
      });
      written.push(segment.path);
    }
    return written;
  }
}

/**
 * Discovered notes as a manuscript: sorted, positions filled in where none was
 * stored, and each note still carrying what its own frontmatter said.
 */
function resolve(
  records: readonly ManagedEntryRecord[],
): ManuscriptSegmentRecord[] {
  const found = new Map(records.map((record) => [record.path, record] as const));
  return resolveSegments(records.map(asStored)).map((segment) => {
    const record = found.get(segment.path);
    return {
      ...segment,
      readOnly: record?.readOnly ?? false,
      storedSequence:
        record?.frontmatter[FRONTMATTER_KEYS.manuscriptSequence],
    };
  });
}

function stampOf(file: TFile): string {
  return `${file.stat.mtime}:${file.stat.size}`;
}

function asStored(record: ManagedEntryRecord): StoredSegment {
  return {
    path: record.path,
    projectId: projectIdOf(record.frontmatter) ?? "",
    title: fileStem(record.path),
    storedSequence: record.frontmatter[FRONTMATTER_KEYS.manuscriptSequence],
  };
}

/**
 * Both languages' manuscript folder names, because a project keeps its notes
 * under the layout of the language it was made in and may be opened under the
 * other -- the same reason the rest of the service looks in both.
 */
function draftFolders(project: ProjectRef): string[] {
  const primary = getProjectPathLayout(project.locale).directories.draft;
  const names = new Set([
    primary,
    ...Object.values(PROJECT_PATH_LAYOUTS).map(
      (layout) => layout.directories.draft,
    ),
  ]);
  return [...names].map((name) =>
    normalizePath(`${project.rootPath}/${name}`),
  );
}

