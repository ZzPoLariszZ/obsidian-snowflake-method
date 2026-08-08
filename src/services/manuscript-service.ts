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
  async listStoredSegments(project: ProjectRef): Promise<StoredSegment[]> {
    return (await this.collect(project)).map(asStored);
  }

  /**
   * Every note of the manuscript, read once.
   *
   * A manuscript is what is in the manuscript folder, at any depth, and nothing
   * else. Notes were once also found by following the project's own link, which
   * let one live anywhere in the Vault; that made the link load-bearing and the
   * manuscript's contents depend on a field nobody types.
   */
  private async collect(project: ProjectRef): Promise<ManagedFileRecord[]> {
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
    return [...records.values()];
  }

  async listSegments(
    project: ProjectRef,
  ): Promise<ManuscriptSegmentRecord[]> {
    const records = await this.collect(project);
    const readOnly = new Map(
      records.map((record) => [record.path, record.readOnly] as const),
    );
    return resolveSegments(records.map(asStored)).map((segment) => ({
      ...segment,
      readOnly: readOnly.get(segment.path) ?? false,
    }));
  }

/** Whether a note sits in one of the folders a manuscript is scanned from. */
  isInManuscriptFolder(project: ProjectRef, path: string): boolean {
    const note = normalizePath(path);
    return draftFolders(project).some(
      (folder) => note === folder || note.startsWith(`${folder}/`),
    );
  }

  async findSequenceIssues(project: ProjectRef): Promise<SequenceIssues> {
    return findSequenceIssues(await this.listStoredSegments(project));
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
    title: string,
  ): Promise<string> {
    const segments = await this.settleOrder(project);
    return this.createSegment(project, title, sequenceAtEnd(segments));
  }

  async prependSegment(
    project: ProjectRef,
    title: string,
  ): Promise<string> {
    const segments = await this.roomyOrder(project, (ordered) =>
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
    const segments = await this.roomyOrder(project, (ordered) => {
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
    path: string,
  ): Promise<{ kept: string; removed: string } | null> {
    const segments = await this.listSegments(project);
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
    path: string,
    toIndex: number,
  ): Promise<void> {
    const before = await this.listSegments(project);
    await this.persistSequences(
      before,
      moveSegment(before, normalizePath(path), toIndex),
    );
  }

  /** Regular intervals in the manuscript's current order. Returns what changed. */
  async repairSequences(project: ProjectRef): Promise<string[]> {
    const before = await this.listSegments(project);
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
    room: (ordered: readonly ManuscriptSegmentRecord[]) => number | null,
  ): Promise<ManuscriptSegmentRecord[]> {
    const segments = await this.settleOrder(project);
    if (segments.length === 0 || room(segments) !== null) return segments;
    await this.repairSequences(project);
    return this.listSegments(project);
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
  ): Promise<ManuscriptSegmentRecord[]> {
    const segments = await this.listSegments(project);
    if (segments.every((segment) => segment.hasStoredSequence)) return segments;
    await this.persistSequences(segments, segments);
    return this.listSegments(project);
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

function asStored(record: ManagedFileRecord): StoredSegment {
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

