import { normalizePath } from "obsidian";

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
  PathConflictError,
  UnsupportedSchemaError,
  projectIdOf,
  type ManagedEntryRecord,
  type VaultRepository,
} from "../repository";
import { fileStamp } from "./json-store";
import { firstHeading, manuscriptSegmentTemplate } from "../templates";
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

/** Where a new note goes: after a note, at the start, or at the end. */
export type SegmentPlacement =
  | { after: string }
  | { atStart: true }
  | { atEnd: true };

/** What a batch of renames did: each note's old and new path, and the notes left alone. */
export interface SegmentRenameOutcome {
  renamed: { from: string; to: string }[];
  /** Notes the plugin may not write to, left under their old names. */
  skipped: string[];
}

/** One rename of a batch, settled and ready to run. */
interface RenameStep {
  from: string;
  to: string;
  title: string;
  /** The name the note carries now, for the heading guard. */
  stem: string;
}

/** A batch settled before its first rename, in the order the renames run. */
interface RenamePlan {
  steps: RenameStep[];
  skipped: string[];
}

/** One rename done, with what it takes to put it back. */
interface RenameDone {
  from: string;
  to: string;
  /** The heading as it stood when the rename rewrote it; null when it was left alone. */
  heading: string | null;
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
   * Told when text crosses from one note into another, which a split and a
   * merge both do. Revisions listen: they are stored against a note and an
   * offset, so text that walks to a new file without saying so leaves every
   * proposal on it hunting for words that are no longer in the note named --
   * a conflict card whose only offer is to discard a proposal about text
   * that is alive and unchanged one note over.
   *
   * `body` is the departing note as it stood a moment before the write, `at`
   * where the travelling text starts in it, and `shift` how far its offsets
   * move: text at `p` in `body`, `p` at or after `at`, stands at `p - shift`
   * in `into`. The arithmetic lives here because the seam is tidied here, and
   * only this knows how much of it was closed up.
   *
   * The body is handed over rather than left to the listener to read back,
   * because by the time anyone could read it the note no longer holds this
   * text -- and a listener working from remembered offsets alone would sort
   * the travellers from the stayers by a memory of the note rather than by
   * the note itself.
   */
  onSegmentTextCarried:
    | ((
        from: string,
        into: string,
        body: string,
        at: number,
        shift: number,
      ) => void | Promise<void>)
    | null = null;

  /**
   * Told after a note's body reaches the file, with the body written. The
   * revisions listen: their stored offsets are brought level with the note
   * here, once, for every writer alike -- the stream's saves, an accepted
   * proposal, a link conversion, a split's remainder -- rather than by each
   * caller remembering to say so after its own write.
   */
  onSegmentWritten: ((path: string, body: string) => void) | null = null;

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
      stamp: fileStamp(record.file),
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
    return file === null ? null : fileStamp(file);
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
    this.onSegmentWritten?.(normalizePath(path), body);
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
    await this.cutInto(path, offset, created);
    return created;
  }

  /** The cut itself: what stands from `offset` on moves into `created`. */
  private async cutInto(path: string, offset: number, created: string): Promise<void> {
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
    // Everything from the cut down now lives in the new note, its offsets
    // shorter by the cut plus whatever blank lines the seam swallowed. The
    // carry goes first, and whole: levelling the head before the travellers
    // have left would re-anchor a tail occurrence onto the head's copy of
    // its words, wherever a plant and its payoff share a phrase.
    const tail = source.body.slice(cut);
    const lead = tail.length - tail.replace(/^\n+/u, "").length;
    await this.onSegmentTextCarried?.(
      source.path,
      created,
      source.body,
      cut,
      cut + lead,
    );
    // The note that was cut keeps its head: what stays is levelled against
    // what it now holds.
    this.onSegmentWritten?.(source.path, before);
  }

  /**
   * Makes a new note where `placement` says, renaming the notes after it as
   * `renames` says -- the renumbering that moves numbered notes up to make
   * room -- and answers with the new note's path and what was renamed. The
   * batch is settled first, the new note's own name counted as one no
   * rename may take; then the notes move, and the note is made among them,
   * so a note taking a bare number finds the name just vacated. A note that
   * cannot be made puts every rename back, so nothing is left half done and
   * the same names can be asked for again.
   */
  async createSegmentAt(
    project: ProjectRef,
    placement: SegmentPlacement,
    title: string,
    renames: readonly { path: string; title: string }[] = [],
  ): Promise<{ path: string; renumbered: SegmentRenameOutcome }> {
    const run = await this.runRenames(
      await this.planRenames(project, renames, [], [
        this.plannedSegmentPath(project, title),
      ]),
    );
    try {
      const path =
        "after" in placement
          ? await this.insertSegmentAfter(project, placement.after, title)
          : "atStart" in placement
            ? await this.prependSegment(project, title)
            : await this.appendSegment(project, title);
      return { path, renumbered: run.outcome };
    } catch (error) {
      await this.undoRenames(run.done);
      throw error;
    }
  }

  /** `splitSegment` with the renumbering `createSegmentAt` does, settled and undone the same way. */
  async splitSegmentAt(
    project: ProjectRef,
    path: string,
    offset: number,
    title: string,
    renames: readonly { path: string; title: string }[] = [],
  ): Promise<{ path: string; renumbered: SegmentRenameOutcome }> {
    const run = await this.runRenames(
      await this.planRenames(project, renames, [], [
        this.plannedSegmentPath(project, title),
      ]),
    );
    let created: string;
    try {
      created = await this.insertSegmentAfter(project, normalizePath(path), title);
    } catch (error) {
      await this.undoRenames(run.done);
      throw error;
    }
    await this.cutInto(path, offset, created);
    return { path: created, renumbered: run.outcome };
  }

  /**
   * Joins a note and the one after it into a single note.
   *
   * The earlier of the two survives, keeping its own frontmatter and so its own
   * position: the pair occupied one stretch of the manuscript and the merged
   * note takes the start of it, which is where a reader was already going to
   * meet this text. The later note goes to the trash with nothing in it that is
   * not now in the survivor.
   *
   * `renames` are the renumberings that follow the note going -- the numbered
   * notes after it moving down by one -- and they are settled before anything
   * is joined or thrown away, with the later note's own name counted as free
   * since it is about to be. A name the batch cannot take refuses the whole
   * merge with nothing done, the way it refuses a batch on its own.
   */
  async mergeWithNext(
    project: ProjectRef,
    path: string,
    renames: readonly { path: string; title: string }[] = [],
  ): Promise<{
    kept: string;
    removed: string;
    renumbered: SegmentRenameOutcome;
  } | null> {
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

    const plan = await this.planRenames(project, renames, [later.path]);
    const head = await this.readSegment(earlier.path);
    const tail = await this.readSegment(later.path);
    const joined = `${head.body.replace(/\n+$/u, "")}\n\n${tail.body.replace(
      /^\n+/u,
      "",
    )}`;
    await this.repository.replaceBody(earlier.path, joined, head.revision, {
      userInput: true,
    });
    // The later note's text now stands after the survivor's, one blank line
    // between them, so its offsets move forward rather than back.
    const prefix = head.body.replace(/\n+$/u, "").length + 2;
    const lead = tail.body.length - tail.body.replace(/^\n+/u, "").length;
    void this.onSegmentTextCarried?.(
      later.path,
      earlier.path,
      tail.body,
      0,
      lead - prefix,
    );
    // Reported before the trash, so the removal is credited from the body in
    // hand and the delete event that follows finds it already settled.
    this.onSegmentRemoved?.(later.path, tail.body);
    await this.repository.trashFile(later.path);
    const { outcome: renumbered } = await this.runRenames(plan);
    return { kept: earlier.path, removed: later.path, renumbered };
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

  /**
   * Renames manuscript notes in one batch, for the renumbering that follows a
   * chapter inserted among numbered ones or taken from among them. Each note
   * keeps its folder and its position; only its name changes -- and its
   * heading, where the heading is still the name the note was made under,
   * since a heading the author wrote is theirs.
   *
   * The batch is settled before the first rename: every destination is
   * checked against the Vault and against the batch itself, in the order the
   * renames will run. A destination that is not free refuses the whole batch
   * with nothing renamed. Notes the plugin may not write to are skipped and
   * named in the answer.
   */
  async renameSegments(
    project: ProjectRef,
    renames: readonly { path: string; title: string }[],
  ): Promise<SegmentRenameOutcome> {
    return (await this.runRenames(await this.planRenames(project, renames))).outcome;
  }

  /**
   * The batch settled: every rename checked, and put in the order it can
   * run. A note taking a name another note in the batch is giving up runs
   * after that note has given it up -- the last note first when the numbers
   * move up, the first note first when they move down -- which is read off
   * the names rather than told, so the same batch serves both. Two notes
   * trading names have no such order and refuse the batch. `freeing` names
   * paths the caller is about to vacate, counted as free here; `reserving`
   * names paths the caller is about to take itself, which no rename may.
   */
  private async planRenames(
    project: ProjectRef,
    renames: readonly { path: string; title: string }[],
    freeing: readonly string[] = [],
    reserving: readonly string[] = [],
  ): Promise<RenamePlan> {
    const skipped: string[] = [];
    const steps: RenameStep[] = [];
    if (renames.length === 0) return { steps, skipped };
    const ordered = await this.listSegmentsFromFiles(project);
    const pending: RenameStep[] = [];
    for (const rename of renames) {
      const from = normalizePath(rename.path);
      const segment = ordered.find((entry) => entry.path === from);
      if (segment === undefined) throw new ManagedFileNotFoundError(from);
      if (segment.readOnly) {
        skipped.push(from);
        continue;
      }
      const to = normalizePath(
        `${parentOf(from)}/${safeFileName(rename.title)}.md`,
      );
      if (to === from) continue;
      pending.push({ from, to, title: rename.title, stem: segment.title });
    }

    // Each step waits on the step, if any, that is giving up the name it
    // takes; the chain from a step to what it waits on runs deepest first.
    const bySource = new Map(pending.map((step) => [step.from, step]));
    const placed = new Set<RenameStep>();
    for (const start of pending) {
      const trail: RenameStep[] = [];
      const onTrail = new Set<RenameStep>();
      let step: RenameStep | undefined = start;
      while (step !== undefined && !placed.has(step)) {
        if (onTrail.has(step)) throw new PathConflictError(step.to);
        onTrail.add(step);
        trail.push(step);
        step = bySource.get(step.to);
      }
      for (const queued of trail.reverse()) {
        placed.add(queued);
        steps.push(queued);
      }
    }

    const freed = new Set(freeing.map((path) => normalizePath(path)));
    const taken = new Set(reserving.map((path) => normalizePath(path)));
    for (const step of steps) {
      const occupied =
        this.repository.get(step.to) !== null && !freed.has(step.to);
      if (occupied || taken.has(step.to)) throw new PathConflictError(step.to);
      taken.add(step.to);
      freed.add(step.from);
    }
    return { steps, skipped };
  }

  private async runRenames(
    plan: RenamePlan,
  ): Promise<{ outcome: SegmentRenameOutcome; done: RenameDone[] }> {
    const done: RenameDone[] = [];
    for (const step of plan.steps) {
      const record = await this.repository.readManaged(step.from);
      const to = await this.repository.renameFile(step.from, step.to);
      const heading = firstHeading(record.body);
      const own = headingNamesStem(heading, step.stem);
      done.push({ from: step.from, to, heading: own ? heading : null });
      if (own) {
        await this.repository.updateFirstHeading(to, step.title, {
          userInput: true,
        });
      }
    }
    return {
      outcome: {
        renamed: done.map(({ from, to }) => ({ from, to })),
        skipped: plan.skipped,
      },
      done,
    };
  }

  /** Puts a batch back, the last rename first, headings included. */
  private async undoRenames(done: readonly RenameDone[]): Promise<void> {
    for (const step of [...done].reverse()) {
      const from = await this.repository.renameFile(step.to, step.from);
      if (step.heading !== null) {
        await this.repository.updateFirstHeading(from, step.heading, {
          userInput: true,
        });
      }
    }
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
    const created = await this.repository.createManagedFile({
      path: this.plannedSegmentPath(project, name),
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

  /** Where a note of this title is made, before any clash moves it along. */
  private plannedSegmentPath(project: ProjectRef, title: string): string {
    const name = title.trim();
    if (!name) throw new Error("Segment title is required.");
    const layout = getProjectPathLayout(project.locale);
    return normalizePath(
      `${project.rootPath}/${layout.directories.draft}/${safeFileName(name)}.md`,
    );
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

/**
 * Whether a note's first heading is still the name the note was made under.
 * The heading holds the title as it was typed; the stem is what
 * `safeFileName` made of it, and a clash may have added " (2)", so the
 * heading is read the same way before the two are compared.
 */
function headingNamesStem(heading: string | null, stem: string): boolean {
  if (heading === null) return false;
  let safe: string;
  try {
    safe = safeFileName(heading);
  } catch {
    return false;
  }
  if (safe === stem) return true;
  const clashed = /^(.*) \(\d+\)$/u.exec(stem);
  return clashed !== null && clashed[1] === safe;
}

/** The folder a path stands in, or the empty string for the Vault root. */
function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}
