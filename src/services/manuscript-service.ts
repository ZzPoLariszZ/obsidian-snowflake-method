import { normalizePath } from "obsidian";

import {
  FRONTMATTER_KEYS,
  SCHEMA_VERSION,
  fileStem,
  fingerprint,
  findSequenceIssues,
  moveSegment,
  safeFileName,
  repairSequences,
  resolveSegments,
  sequenceAtEnd,
  sequenceBetween,
  type ManuscriptSegment,
  type SequenceIssues,
  type StoredSegment,
} from "../domain";
import {
  ManagedFileNotFoundError,
  UnsupportedSchemaError,
  documentTypeOf,
  projectIdOf,
  type ManagedFileRecord,
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
}

export interface ManuscriptSegmentContent {
  path: string;
  title: string;
  /** Everything below the frontmatter. The frontmatter is never shown. */
  body: string;
  /** Fingerprint of the whole file, so a save can refuse to clobber. */
  revision: string;
  readOnly: boolean;
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
   * Every note of the manuscript, as its frontmatter has it, before the order
   * is worked out. The health check reads this: it has to see a position that
   * is missing or unusable, which a resolved segment has already papered over.
   */
  async listStoredSegments(
    project: ProjectRef,
    draftPath: string | null,
  ): Promise<StoredSegment[]> {
    const records = new Map<string, ManagedFileRecord>();
    for (const folder of draftFolders(project)) {
      for (const record of await this.repository.findManagedFilesBelow(
        folder,
        "draft",
        project.id,
      )) {
        records.set(record.path, record);
      }
    }

    // A draft the project links to from outside its manuscript folder is still
    // the opening of the manuscript. That link is the one thing that has always
    // been allowed to point anywhere, and taking it away here would lose the
    // draft rather than move it.
    if (draftPath !== null && !records.has(normalizePath(draftPath))) {
      const outside = await this.repository.tryReadManaged(draftPath);
      if (
        outside !== null &&
        documentTypeOf(outside.frontmatter) === "draft" &&
        projectIdOf(outside.frontmatter) === project.id
      ) {
        records.set(outside.path, outside);
      }
    }

    return [...records.values()].map((record) => ({
      path: record.path,
      projectId: project.id,
      title: fileStem(record.path),
      storedSequence: record.frontmatter[FRONTMATTER_KEYS.manuscriptSequence],
    }));
  }

  async listSegments(
    project: ProjectRef,
    draftPath: string | null,
  ): Promise<ManuscriptSegmentRecord[]> {
    const stored = await this.listStoredSegments(project, draftPath);
    const readOnly = new Map<string, boolean>();
    for (const entry of stored) {
      const record = await this.repository.tryReadManaged(entry.path);
      readOnly.set(entry.path, record?.readOnly ?? false);
    }
    return resolveSegments(stored).map((segment) => ({
      ...segment,
      readOnly: readOnly.get(segment.path) ?? false,
    }));
  }

  async findSequenceIssues(
    project: ProjectRef,
    draftPath: string | null,
  ): Promise<SequenceIssues> {
    return findSequenceIssues(await this.listStoredSegments(project, draftPath));
  }

  /** Everything below the frontmatter of one segment, ready to render or edit. */
  async readSegment(path: string): Promise<ManuscriptSegmentContent> {
    const record = await this.repository.readManaged(path);
    return {
      path: record.path,
      title: fileStem(record.path),
      body: record.body,
      revision: fingerprint(record.content),
      readOnly: record.readOnly,
    };
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
    await this.repository.replaceBody(path, body, expectedRevision);
  }

  async appendSegment(
    project: ProjectRef,
    draftPath: string | null,
    title: string,
  ): Promise<string> {
    const segments = await this.settleOrder(project, draftPath);
    return this.createSegment(project, title, sequenceAtEnd(segments));
  }

  async prependSegment(
    project: ProjectRef,
    draftPath: string | null,
    title: string,
  ): Promise<string> {
    const segments = await this.roomyOrder(project, draftPath, (ordered) =>
      sequenceBetween(null, ordered[0]?.sequence),
    );
    const sequence = sequenceBetween(null, segments[0]?.sequence);
    if (sequence === null) throw new Error("Cannot place a segment here.");
    return this.createSegment(project, title, sequence);
  }

  async insertSegmentAfter(
    project: ProjectRef,
    draftPath: string | null,
    afterPath: string,
    title: string,
  ): Promise<string> {
    const target = normalizePath(afterPath);
    const segments = await this.roomyOrder(project, draftPath, (ordered) => {
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
    draftPath: string | null,
    path: string,
    offset: number,
    title: string,
  ): Promise<string> {
    // Placed first, because placing it may write a position into the note being
    // split, and the revision guarding the write below has to be read after
    // that rather than before it.
    const created = await this.insertSegmentAfter(
      project,
      draftPath,
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

    await this.repository.replaceBody(created, after);
    await this.repository.replaceBody(source.path, before, source.revision);
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
    draftPath: string | null,
    path: string,
  ): Promise<{ kept: string; removed: string } | null> {
    const segments = await this.listSegments(project, draftPath);
    const index = segments.findIndex(
      (segment) => segment.path === normalizePath(path),
    );
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
    await this.repository.replaceBody(earlier.path, joined, head.revision);
    await this.repository.trashFile(later.path);
    return { kept: earlier.path, removed: later.path };
  }

  async moveSegment(
    project: ProjectRef,
    draftPath: string | null,
    path: string,
    toIndex: number,
  ): Promise<void> {
    const before = await this.listSegments(project, draftPath);
    await this.persistSequences(
      before,
      moveSegment(before, normalizePath(path), toIndex),
    );
  }

  /** Regular intervals in the manuscript's current order. Returns what changed. */
  async repairSequences(
    project: ProjectRef,
    draftPath: string | null,
  ): Promise<string[]> {
    const before = await this.listSegments(project, draftPath);
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
    draftPath: string | null,
    room: (ordered: readonly ManuscriptSegmentRecord[]) => number | null,
  ): Promise<ManuscriptSegmentRecord[]> {
    const segments = await this.settleOrder(project, draftPath);
    if (segments.length === 0 || room(segments) !== null) return segments;
    await this.repairSequences(project, draftPath);
    return this.listSegments(project, draftPath);
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
    draftPath: string | null,
  ): Promise<ManuscriptSegmentRecord[]> {
    const segments = await this.listSegments(project, draftPath);
    if (segments.every((segment) => segment.hasStoredSequence)) return segments;
    await this.persistSequences(segments, segments);
    return this.listSegments(project, draftPath);
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

