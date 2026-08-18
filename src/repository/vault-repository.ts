import {
  getLinkpath,
  normalizePath,
  stringifyYaml,
  type FileManager,
  type MetadataCache,
  type TAbstractFile,
  type TFile,
  type TFolder,
  type Vault,
} from "obsidian";

import { SCHEMA_VERSION, fingerprint } from "../domain";
import {
  SECTION_MARKER_PREFIX,
  findManagedMarkerIssues,
  insertMarkedSection,
  inspectMarkedSection,
  removeMarkedSection,
  replaceMarkedSection,
  type ManagedMarkerIssue,
  type ManagedSectionDefinition,
  type MarkerIssueCode,
  type MarkdownTemplate,
  type SectionLayoutEntry,
} from "../templates";
import {
  ConcurrentChangeError,
  InvalidManagedDocumentError,
  ManagedFileNotFoundError,
  PathConflictError,
  UnsafeSectionError,
} from "./errors";
import {
  assertWritableSchema,
  documentTypeOf,
  isManagedFrontmatter,
  isReadOnlySchema,
  orderFrontmatterKeys,
  parseMarkdownFrontmatter,
  projectIdOf,
  schemaVersionOf,
  type ManagedFrontmatter,
} from "./frontmatter";

export interface ManagedFileRecord {
  file: TFile;
  path: string;
  content: string;
  body: string;
  frontmatter: ManagedFrontmatter;
  schemaVersion: number | null;
  readOnly: boolean;
}

/**
 * What a note declares, without its prose.
 *
 * Everything the plugin stores about a note lives in its frontmatter, so a
 * question about where a note sits or which project owns it can be answered
 * without loading what the author wrote in it.
 */
export interface ManagedEntryRecord {
  file: TFile;
  path: string;
  frontmatter: ManagedFrontmatter;
  schemaVersion: number | null;
  readOnly: boolean;
}

export interface CreateManagedFileOptions {
  path: string;
  template: MarkdownTemplate;
  frontmatter: ManagedFrontmatter;
  uniqueOnConflict?: boolean;
}

export interface CreateManagedFileResult {
  path: string;
  file: TFile;
  created: boolean;
  frontmatterRepaired: boolean;
}

export interface RepairSectionConflict {
  sectionId: string;
  code: MarkerIssueCode;
  reason: string;
  markerSectionId?: string;
  relatedSectionId?: string;
}

export interface SectionCheckResult {
  unchanged: string[];
  conflicts: RepairSectionConflict[];
}

export type FrontmatterUpdater = (
  current: Readonly<ManagedFrontmatter>,
) => ManagedFrontmatter;

/**
 * Thin, mobile-safe persistence layer. All content mutations are performed with
 * Vault.process and all frontmatter mutations with FileManager.processFrontMatter.
 */
export class VaultRepository {
  /**
   * Records already parsed, kept until the file itself changes.
   *
   * A project load reads every character, scene and step note it owns, and a
   * member-heavy project pays a full read and parse for each on every
   * refresh — a second per load at three thousand scenes, spent almost
   * entirely on files that have not changed. A record is reused while the
   * file's modification time, size and identity all stand; any write moves
   * them, and the next read parses afresh. Records are shared, never edited:
   * every writer goes through the vault and reads back.
   */
  private readonly records = new Map<
    string,
    { mtime: number; size: number; record: ManagedFileRecord }
  >();

  constructor(
    readonly vault: Vault,
    readonly fileManager: FileManager,
    readonly metadataCache: MetadataCache,
  ) {}

  normalize(path: string): string {
    const trimmed = path.trim();
    return trimmed ? normalizePath(trimmed) : "";
  }

  get(path: string): TAbstractFile | null {
    return this.vault.getAbstractFileByPath(this.normalize(path));
  }

  getFile(path: string): TFile | null {
    const node = this.get(path);
    return isFile(node) ? node : null;
  }

  /**
   * The note a stored link points at, resolved the way Obsidian resolves it.
   *
   * A link is not a Vault path. Obsidian rewrites every link into a note or
   * folder it renames -- including the ones this plugin wrote, and including
   * the rename behind Rename project -- and its rewrite drops the ".md" and may
   * shorten the path to whatever is unambiguous. Looking a stored link up as a
   * path therefore stops finding a file that is sitting right where the link
   * says it is.
   */
  resolveLink(link: string, sourcePath: string): TFile | null {
    const target = getLinkpath(link.trim());
    if (!target) return null;
    return this.metadataCache.getFirstLinkpathDest(
      target,
      this.normalize(sourcePath),
    );
  }

  /**
   * The same, looked for inside one folder.
   *
   * Obsidian shortens a link to whatever was unambiguous when it wrote it, so a
   * character's link can end up as nothing but a file name. A second project
   * with a character of the same name makes that name ambiguous afterwards, and
   * Obsidian then answers with whichever of them it reaches first -- which is
   * how one project's scene comes to name another project's character. Nothing
   * in the link says which was meant, so the folder it was written in decides.
   */
  resolveLinkWithin(
    link: string,
    sourcePath: string,
    folder: string,
  ): TFile | null {
    const target = getLinkpath(link.trim());
    if (!target) return null;
    const scope = this.normalize(folder);
    const anywhere = this.resolveLink(target, sourcePath);
    if (anywhere !== null && isAtOrBelow(anywhere.path, scope)) return anywhere;
    const root = this.getFolder(scope);
    if (root === null) return null;
    const wanted = this.normalize(target).endsWith(".md")
      ? this.normalize(target)
      : `${this.normalize(target)}.md`;
    // The nearest note wins, as it does for a link Obsidian can place itself.
    let nearest: TFile | null = null;
    const visit = (node: TFolder): void => {
      for (const child of node.children) {
        if (isFolder(child)) {
          visit(child);
        } else if (
          isFile(child) &&
          (child.path === wanted || child.path.endsWith(`/${wanted}`)) &&
          (nearest === null || child.path.length < nearest.path.length)
        ) {
          nearest = child;
        }
      }
    };
    visit(root);
    return nearest;
  }

  getFolder(path: string): TFolder | null {
    const node = this.get(path);
    return isFolder(node) ? node : null;
  }

  async ensureFolder(path: string): Promise<TFolder> {
    const normalized = this.normalize(path);
    if (!normalized) {
      const root = this.vault.getRoot();
      return root;
    }

    const pieces = normalized.split("/").filter(Boolean);
    let current = "";
    for (const piece of pieces) {
      current = current ? `${current}/${piece}` : piece;
      const existing = this.vault.getAbstractFileByPath(current);
      if (existing) {
        if (!isFolder(existing)) throw new PathConflictError(current);
        continue;
      }
      try {
        await this.vault.createFolder(current);
      } catch (error) {
        // A concurrent creator may have won the race. Re-read before failing.
        const raced = this.vault.getAbstractFileByPath(current);
        if (!isFolder(raced)) throw error;
      }
    }

    const folder = this.getFolder(normalized);
    if (!folder) throw new PathConflictError(normalized);
    return folder;
  }

  async renameFile(path: string, destination: string): Promise<string> {
    const sourcePath = this.normalize(path);
    const destinationPath = this.normalize(destination);
    const file = this.getFile(sourcePath);
    if (!file) throw new ManagedFileNotFoundError(sourcePath);
    if (sourcePath === destinationPath) return sourcePath;
    if (this.get(destinationPath)) throw new PathConflictError(destinationPath);
    await this.ensureFolder(parentOf(destinationPath));
    try {
      await this.fileManager.renameFile(file, destinationPath);
    } catch (error) {
      if (this.get(destinationPath)) throw new PathConflictError(destinationPath);
      throw error;
    }
    return destinationPath;
  }

  async trashFile(path: string): Promise<void> {
    const normalized = this.normalize(path);
    const file = this.getFile(normalized);
    if (!file) throw new ManagedFileNotFoundError(normalized);
    await this.fileManager.trashFile(file);
  }

  /**
   * The folder counterparts, through the same manager calls: a folder rename
   * moves its whole subtree, and trashing one takes the subtree with it.
   * Obsidian's own link updater may rewrite links into a renamed folder, but
   * only when the user has that setting on -- a caller that needs the links
   * moved must move them itself.
   */
  async renameFolder(path: string, destination: string): Promise<string> {
    const sourcePath = this.normalize(path);
    const destinationPath = this.normalize(destination);
    const folder = this.getFolder(sourcePath);
    if (!folder) throw new ManagedFileNotFoundError(sourcePath);
    if (sourcePath === destinationPath) return sourcePath;
    if (this.get(destinationPath)) throw new PathConflictError(destinationPath);
    await this.ensureFolder(parentOf(destinationPath));
    try {
      await this.fileManager.renameFile(folder, destinationPath);
    } catch (error) {
      if (this.get(destinationPath)) throw new PathConflictError(destinationPath);
      throw error;
    }
    return destinationPath;
  }

  async trashFolder(path: string): Promise<void> {
    const normalized = this.normalize(path);
    const folder = this.getFolder(normalized);
    if (!folder) throw new ManagedFileNotFoundError(normalized);
    await this.fileManager.trashFile(folder);
  }

  /**
   * Whether this repository is writing the path right now. The editor's
   * protection filter asks, because a write to an open note lands in its
   * editor as a transaction: without this, the plugin's own dashboard save
   * would be refused as if a person had typed into a protected range, and
   * the stale buffer would then save the change away again.
   */
  isWritingPath(path: string): boolean {
    return this.writingPaths.has(this.normalize(path));
  }

  private readonly writingPaths = new Set<string>();

  private async withWriteMark<T>(
    path: string,
    write: () => Promise<T>,
  ): Promise<T> {
    this.writingPaths.add(path);
    try {
      return await write();
    } finally {
      this.writingPaths.delete(path);
    }
  }

  private async processMarked(
    file: TFile,
    normalized: string,
    transform: (current: string) => string,
  ): Promise<void> {
    await this.withWriteMark(normalized, () =>
      this.vault.process(file, transform),
    );
  }

  async readManaged(path: string): Promise<ManagedFileRecord> {
    const normalized = this.normalize(path);
    const file = this.getFile(normalized);
    if (!file) throw new ManagedFileNotFoundError(normalized);
    const kept = this.records.get(normalized);
    if (
      kept !== undefined &&
      kept.mtime === file.stat.mtime &&
      kept.size === file.stat.size &&
      kept.record.file === file
    ) {
      return kept.record;
    }
    const content = await this.vault.read(file);
    const parsed = parseMarkdownFrontmatter(content);
    const schemaVersion = schemaVersionOf(parsed.frontmatter);
    const record: ManagedFileRecord = {
      file,
      path: normalized,
      content,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      schemaVersion,
      readOnly: isReadOnlySchema(parsed.frontmatter),
    };
    this.records.set(normalized, {
      mtime: file.stat.mtime,
      size: file.stat.size,
      record,
    });
    return record;
  }

  /**
   * Lets go of what the cache holds for a path the vault no longer has: a
   * deleted file's record, or with `children`, every record under a folder
   * that was renamed or deleted. Records hold their file's whole text, so a
   * session of renames would otherwise keep every old copy until the plugin
   * reloads. Reads cannot be affected: a stale record is already refused by
   * the identity check above, so forgetting one only returns the memory.
   */
  forget(path: string, { children = false } = {}): void {
    const normalized = this.normalize(path);
    this.records.delete(normalized);
    if (!children) return;
    const prefix = `${normalized}/`;
    for (const key of this.records.keys()) {
      if (key.startsWith(prefix)) this.records.delete(key);
    }
  }

  async tryReadManaged(path: string): Promise<ManagedFileRecord | null> {
    try {
      return await this.readManaged(path);
    } catch (error) {
      if (error instanceof ManagedFileNotFoundError || error instanceof InvalidManagedDocumentError) {
        return null;
      }
      throw error;
    }
  }

  async createManagedFile(options: CreateManagedFileOptions): Promise<CreateManagedFileResult> {
    const requestedPath = this.normalize(options.path);
    const parentPath = parentOf(requestedPath);
    await this.ensureFolder(parentPath);

    const existing = this.get(requestedPath);
    if (existing && !options.uniqueOnConflict) {
      throw new PathConflictError(requestedPath);
    }
    const path = existing ? this.resolveUniquePath(requestedPath) : requestedPath;

    const file = await this.vault.create(path, options.template.body);
    await this.updateFrontmatter(file.path, {
      ...options.frontmatter,
      "snowflake-schema": SCHEMA_VERSION,
    });
    return { path: file.path, file, created: true, frontmatterRepaired: false };
  }

  /** Rewrites a plain generated file, such as a base view, atomically. */
  async updatePlainFile(
    path: string,
    transform: (current: string) => string,
  ): Promise<void> {
    const normalized = this.normalize(path);
    const file = this.getFile(normalized);
    if (!file) throw new ManagedFileNotFoundError(normalized);
    await this.vault.process(file, transform);
  }

  /** Reads a plain generated file whole, or null when it is not there. */
  async readPlainFile(path: string): Promise<string | null> {
    const file = this.getFile(this.normalize(path));
    return file === null ? null : this.vault.read(file);
  }

  async createPlainFile(
    path: string,
    content: string,
    uniqueOnConflict = false,
  ): Promise<TFile> {
    const requestedPath = this.normalize(path);
    await this.ensureFolder(parentOf(requestedPath));
    const existing = this.get(requestedPath);
    if (existing && !uniqueOnConflict) {
      throw new PathConflictError(requestedPath);
    }
    const destination = existing
      ? this.resolveUniquePath(requestedPath)
      : requestedPath;
    return this.vault.create(destination, content);
  }

  async replaceManagedFile(
    path: string,
    template: MarkdownTemplate,
    frontmatter: ManagedFrontmatter,
  ): Promise<void> {
    const normalized = this.normalize(path);
    const file = this.getFile(normalized);
    if (!file) throw new ManagedFileNotFoundError(normalized);
    const yaml = stringifyYaml({
      ...frontmatter,
      "snowflake-schema": SCHEMA_VERSION,
    }).trimEnd();
    await this.processMarked(
      file,
      normalized,
      () => `---\n${yaml}\n---\n${template.body}`,
    );
  }

  async ensureManagedFile(options: CreateManagedFileOptions): Promise<CreateManagedFileResult> {
    const requestedPath = this.normalize(options.path);
    const existing = this.get(requestedPath);
    if (!existing) return this.createManagedFile(options);
    if (!isFile(existing)) {
      if (options.uniqueOnConflict) {
        return this.createManagedFile({ ...options, path: this.resolveUniquePath(requestedPath) });
      }
      throw new PathConflictError(requestedPath);
    }

    let record: ManagedFileRecord;
    try {
      record = await this.readManaged(existing.path);
    } catch (error) {
      if (options.uniqueOnConflict && error instanceof InvalidManagedDocumentError) {
        return this.createManagedFile({ ...options, path: this.resolveUniquePath(requestedPath) });
      }
      throw error;
    }
    const rawDocument = options.frontmatter["snowflake-document"];
    const rawProject = options.frontmatter["snowflake-project-id"];
    const expectedDocument = typeof rawDocument === "string" ? rawDocument : "";
    const expectedProject = typeof rawProject === "string" ? rawProject : "";
    if (
      documentTypeOf(record.frontmatter) !== expectedDocument ||
      projectIdOf(record.frontmatter) !== expectedProject
    ) {
      if (options.uniqueOnConflict) {
        return this.createManagedFile({ ...options, path: this.resolveUniquePath(requestedPath) });
      }
      throw new PathConflictError(requestedPath);
    }

    assertWritableSchema(record.path, record.frontmatter);
    const missing: ManagedFrontmatter = {};
    for (const [key, value] of Object.entries(options.frontmatter)) {
      if (!(key in record.frontmatter)) missing[key] = value;
    }
    if (!("snowflake-schema" in record.frontmatter)) missing["snowflake-schema"] = SCHEMA_VERSION;
    const frontmatterRepaired = Object.keys(missing).length > 0;
    if (frontmatterRepaired) await this.updateFrontmatter(record.path, missing);
    return { path: record.path, file: record.file, created: false, frontmatterRepaired };
  }

  /**
   * `order` names the keys whose sequence the note holds to. Frontmatter is
   * written in the order it was first given, so a key a note gains later --
   * an alias added long after it was created -- would otherwise settle at the
   * end, behind fields it belongs in front of. Keys the order does not name
   * keep their own sequence after it, so a property an author added by hand is
   * never reshuffled away from where they put it.
   */
  async updateFrontmatter(
    path: string,
    patch: ManagedFrontmatter,
    order?: readonly string[],
  ): Promise<void> {
    await this.updateFrontmatterAtomic(path, () => patch, order);
  }

  async updateFrontmatterAtomic(
    path: string,
    updater: FrontmatterUpdater,
    order?: readonly string[],
  ): Promise<void> {
    const normalized = this.normalize(path);
    const file = this.getFile(normalized);
    if (!file) throw new ManagedFileNotFoundError(normalized);

    await this.withWriteMark(normalized, () =>
      this.fileManager.processFrontMatter(file, (frontmatter) => {
        const mutable = frontmatter as ManagedFrontmatter;
        assertWritableSchema(normalized, mutable);
        const patch = updater({ ...mutable });
        assertWritableSchema(normalized, { ...mutable, ...patch });
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete mutable[key];
          else mutable[key] = value;
        }
        if (order !== undefined) orderFrontmatterKeys(mutable, order);
      }),
    );
  }

  async updateFirstHeading(path: string, title: string): Promise<void> {
    const normalized = this.normalize(path);
    const file = this.getFile(normalized);
    if (!file) throw new ManagedFileNotFoundError(normalized);
    const normalizedTitle = title.replace(/\s+/gu, " ").trim();
    if (!normalizedTitle) throw new Error("Document title is required.");

    await this.processMarked(file, normalized, (current) => {
      const parsed = parseMarkdownFrontmatter(current);
      assertWritableSchema(normalized, parsed.frontmatter);
      const bodyOffset = current.length - parsed.body.length;
      const prefix = current.slice(0, bodyOffset);
      const heading = `# ${normalizedTitle}`;
      const match = /^#(?:[ \t]+).*$/mu.exec(parsed.body);
      if (match) {
        return `${prefix}${parsed.body.slice(0, match.index)}${heading}${parsed.body.slice(
          match.index + match[0].length,
        )}`;
      }
      const body = parsed.body.replace(/^(?:\r?\n)+/u, "");
      return `${prefix}${heading}${body ? `\n\n${body}` : "\n"}`;
    });
  }

  /**
   * Replaces everything below the frontmatter, leaving the frontmatter itself
   * exactly as it was.
   *
   * Written for the manuscript, where the note is prose the plugin has no
   * business inside: it stores a position in the frontmatter and hands the rest
   * of the file to the author. `expectedRevision` is how a save refuses to land
   * on top of a change that arrived from somewhere else in the meantime.
   */
  async replaceBody(
    path: string,
    body: string,
    expectedRevision?: string,
  ): Promise<void> {
    const normalized = this.normalize(path);
    const file = this.getFile(normalized);
    if (!file) throw new ManagedFileNotFoundError(normalized);

    await this.processMarked(file, normalized, (current) => {
      const parsed = parseMarkdownFrontmatter(current);
      assertWritableSchema(normalized, parsed.frontmatter);
      const actualRevision = fingerprint(current);
      if (expectedRevision !== undefined && expectedRevision !== actualRevision) {
        throw new ConcurrentChangeError(normalized, expectedRevision, actualRevision);
      }
      const prefix = current.slice(0, current.length - parsed.body.length);
      return `${prefix}${body}`;
    });
  }

  async updateSection(path: string, sectionId: string, value: string): Promise<void> {
    await this.updateSections(path, { [sectionId]: value });
  }

  async updateSections(
    path: string,
    values: Readonly<Record<string, string>>,
    expectedRevision?: string,
  ): Promise<void> {
    const normalized = this.normalize(path);
    const file = this.getFile(normalized);
    if (!file) throw new ManagedFileNotFoundError(normalized);

    await this.processMarked(file, normalized, (current) => {
      const parsed = parseMarkdownFrontmatter(current);
      assertWritableSchema(normalized, parsed.frontmatter);
      const actualRevision = fingerprint(current);
      if (expectedRevision !== undefined && expectedRevision !== actualRevision) {
        throw new ConcurrentChangeError(normalized, expectedRevision, actualRevision);
      }
      const sectionIds = Object.keys(values);
      for (const [sectionId, value] of Object.entries(values)) {
        if (value.includes(`<!-- ${SECTION_MARKER_PREFIX}:`)) {
          throw new UnsafeSectionError(
            normalized,
            sectionId,
            "Managed section markers cannot be entered as field content.",
          );
        }
      }
      for (const sectionId of sectionIds) {
        const inspection = inspectMarkedSection(current, sectionId);
        if (inspection.status !== "present") {
          throw new UnsafeSectionError(
            normalized,
            sectionId,
            inspection.status === "invalid"
              ? inspection.reason
              : `Section "${sectionId}" is missing its managed markers.`,
          );
        }
      }
      const layoutIssue = findSectionLayoutIssue(current, sectionIds);
      if (layoutIssue) {
        throw new UnsafeSectionError(
          normalized,
          layoutIssue.sectionId ?? sectionIds[0] ?? "unknown",
          layoutIssue.reason,
        );
      }
      let next = current;
      for (const [sectionId, value] of Object.entries(values)) {
        const result = replaceMarkedSection(next, sectionId, value);
        if (!result.ok) throw new UnsafeSectionError(normalized, sectionId, result.reason);
        next = result.content;
      }
      const nextLayoutIssue = findSectionLayoutIssue(next, sectionIds);
      if (nextLayoutIssue) {
        throw new UnsafeSectionError(
          normalized,
          nextLayoutIssue.sectionId ?? sectionIds[0] ?? "unknown",
          nextLayoutIssue.reason,
        );
      }
      return next;
    });
  }

  /**
   * The migration write: retires legacy sections and upserts the rest, in one
   * Vault.process so a note is either reshaped whole or left alone. Damage to
   * any involved section refuses the write, exactly as updateSections would.
   */
  async reshapeSections(
    path: string,
    options: {
      values: Readonly<Record<string, string>>;
      layout: readonly SectionLayoutEntry[];
      remove?: readonly { sectionId: string; headings: readonly string[] }[];
      expectedRevision?: string;
    },
  ): Promise<void> {
    const normalized = this.normalize(path);
    const file = this.getFile(normalized);
    if (!file) throw new ManagedFileNotFoundError(normalized);
    const removals = options.remove ?? [];

    await this.processMarked(file, normalized, (current) => {
      const parsed = parseMarkdownFrontmatter(current);
      assertWritableSchema(normalized, parsed.frontmatter);
      const actualRevision = fingerprint(current);
      if (
        options.expectedRevision !== undefined &&
        options.expectedRevision !== actualRevision
      ) {
        throw new ConcurrentChangeError(
          normalized,
          options.expectedRevision,
          actualRevision,
        );
      }
      const requested = Object.keys(options.values);
      const involved = [
        ...requested,
        ...removals.map((removal) => removal.sectionId),
      ];
      for (const [sectionId, value] of Object.entries(options.values)) {
        if (value.includes(`<!-- ${SECTION_MARKER_PREFIX}:`)) {
          throw new UnsafeSectionError(
            normalized,
            sectionId,
            "Managed section markers cannot be entered as field content.",
          );
        }
      }
      const layoutIssue = findSectionLayoutIssue(current, involved);
      if (layoutIssue) {
        throw new UnsafeSectionError(
          normalized,
          layoutIssue.sectionId ?? involved[0] ?? "unknown",
          layoutIssue.reason,
        );
      }

      let next = current;
      for (const removal of removals) {
        next = removeMarkedSection(next, removal.sectionId, removal.headings);
      }
      const order = new Map(
        options.layout.map((entry, index) => [entry.id, index]),
      );
      const sorted = [...requested].sort(
        (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
      );
      const bodyStart = next.length - parseMarkdownFrontmatter(next).body.length;
      for (const sectionId of sorted) {
        const value = options.values[sectionId] ?? "";
        const inspection = inspectMarkedSection(next, sectionId);
        if (inspection.status === "invalid") {
          throw new UnsafeSectionError(normalized, sectionId, inspection.reason);
        }
        if (inspection.status === "present") {
          const result = replaceMarkedSection(next, sectionId, value);
          if (!result.ok) {
            throw new UnsafeSectionError(normalized, sectionId, result.reason);
          }
          next = result.content;
        } else {
          next = insertMarkedSection(
            next,
            options.layout,
            sectionId,
            value,
            bodyStart,
          );
        }
      }
      const nextLayoutIssue = findSectionLayoutIssue(next, requested);
      if (nextLayoutIssue) {
        throw new UnsafeSectionError(
          normalized,
          nextLayoutIssue.sectionId ?? requested[0] ?? "unknown",
          nextLayoutIssue.reason,
        );
      }
      return next;
    });
  }

  /**
   * updateSections for notes that may not carry every requested section yet:
   * a section that exists is replaced, one that is missing is inserted at its
   * canonical place in `layout`. Damage still refuses the whole write, so an
   * upsert can never sew a second copy into a note whose markers are broken.
   */
  async upsertSections(
    path: string,
    values: Readonly<Record<string, string>>,
    layout: readonly SectionLayoutEntry[],
    expectedRevision?: string,
  ): Promise<void> {
    const normalized = this.normalize(path);
    const file = this.getFile(normalized);
    if (!file) throw new ManagedFileNotFoundError(normalized);

    await this.processMarked(file, normalized, (current) => {
      const parsed = parseMarkdownFrontmatter(current);
      assertWritableSchema(normalized, parsed.frontmatter);
      const actualRevision = fingerprint(current);
      if (expectedRevision !== undefined && expectedRevision !== actualRevision) {
        throw new ConcurrentChangeError(normalized, expectedRevision, actualRevision);
      }
      const requested = Object.keys(values);
      for (const [sectionId, value] of Object.entries(values)) {
        if (value.includes(`<!-- ${SECTION_MARKER_PREFIX}:`)) {
          throw new UnsafeSectionError(
            normalized,
            sectionId,
            "Managed section markers cannot be entered as field content.",
          );
        }
      }
      const layoutIssue = findSectionLayoutIssue(current, requested);
      if (layoutIssue) {
        throw new UnsafeSectionError(
          normalized,
          layoutIssue.sectionId ?? requested[0] ?? "unknown",
          layoutIssue.reason,
        );
      }

      // Layout order, so an earlier section inserted in this same write is
      // already in place to anchor a later one.
      const order = new Map(layout.map((entry, index) => [entry.id, index]));
      const sorted = [...requested].sort(
        (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
      );
      const bodyStart = current.length - parsed.body.length;
      let next = current;
      for (const sectionId of sorted) {
        const value = values[sectionId] ?? "";
        const inspection = inspectMarkedSection(next, sectionId);
        if (inspection.status === "invalid") {
          throw new UnsafeSectionError(normalized, sectionId, inspection.reason);
        }
        if (inspection.status === "present") {
          const result = replaceMarkedSection(next, sectionId, value);
          if (!result.ok) {
            throw new UnsafeSectionError(normalized, sectionId, result.reason);
          }
          next = result.content;
        } else {
          next = insertMarkedSection(next, layout, sectionId, value, bodyStart);
        }
      }
      const nextLayoutIssue = findSectionLayoutIssue(next, requested);
      if (nextLayoutIssue) {
        throw new UnsafeSectionError(
          normalized,
          nextLayoutIssue.sectionId ?? requested[0] ?? "unknown",
          nextLayoutIssue.reason,
        );
      }
      return next;
    });
  }

  async checkSections(
    path: string,
    sections: ManagedSectionDefinition[],
    optionalIds: ReadonlySet<string> = new Set(),
  ): Promise<SectionCheckResult> {
    if (sections.length === 0) {
      return { unchanged: [], conflicts: [] };
    }
    const normalized = this.normalize(path);
    const file = this.getFile(normalized);
    if (!file) throw new ManagedFileNotFoundError(normalized);
    const sectionIds = sections.map((section) => section.id);
    const current = await this.vault.read(file);
    const parsed = parseMarkdownFrontmatter(current);
    assertWritableSchema(normalized, parsed.frontmatter);
    // An optional section's absence is a state the note is allowed to be in --
    // a fields block not migrated in yet, or a legacy section migration has
    // already removed -- so only its damage counts, never its missingness.
    const blockingIssues = findManagedMarkerIssues(current, sectionIds).filter(
      (issue) =>
        issue.code !== "unknown-section" &&
        !(
          issue.code === "missing" &&
          issue.sectionId !== null &&
          optionalIds.has(issue.sectionId)
        ),
    );
    const health = new Map(
      sectionIds.map((sectionId) => [
        sectionId,
        inspectMarkedSection(current, sectionId, normalized),
      ]),
    );

    return blockingIssues.length > 0
      ? classifySectionConflicts(sections, health, blockingIssues, optionalIds)
      : { unchanged: sectionIds, conflicts: [] };
  }

  listDirectFiles(folderPath: string): TFile[] {
    const folder = this.getFolder(folderPath);
    if (!folder) return [];
    return folder.children.filter(isFile);
  }

  /**
   * Every file at or below a folder, in path order.
   *
   * The project directories the plugin writes are flat, so the direct listing
   * answers for them. A manuscript is the exception: an author files chapters
   * into parts and volumes, and a chapter is no less part of the book for
   * sitting one folder further down.
   */
  listFilesBelow(folderPath: string): TFile[] {
    const root = this.getFolder(folderPath);
    if (!root) return [];
    const files: TFile[] = [];
    const visit = (node: TFolder): void => {
      for (const child of node.children) {
        if (isFolder(child)) visit(child);
        else if (isFile(child)) files.push(child);
      }
    };
    visit(root);
    return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  }

  listDirectFolders(folderPath: string): TFolder[] {
    const folder = this.getFolder(folderPath);
    if (!folder) return [];
    return folder.children.filter(isFolder);
  }

  async findManagedFiles(
    folderPath: string,
    documentType?: string,
    projectId?: string,
  ): Promise<ManagedFileRecord[]> {
    return this.matchManagedFiles(
      this.listDirectFiles(folderPath),
      documentType,
      projectId,
    );
  }

  /** findManagedFiles, over every subfolder as well. */
  async findManagedFilesBelow(
    folderPath: string,
    documentType?: string,
    projectId?: string,
  ): Promise<ManagedFileRecord[]> {
    return this.matchManagedFiles(
      this.listFilesBelow(folderPath),
      documentType,
      projectId,
    );
  }

  /**
   * findManagedFilesBelow, answered from what Obsidian has already parsed.
   *
   * Reading a note to find out where it sits means loading its prose, parsing
   * its YAML and throwing both away -- for every note, every time. Obsidian
   * indexes the frontmatter of every file in the Vault as it changes, with the
   * same `parseYaml` this repository uses, so the answer is already sitting in
   * memory: a manuscript of fifty notes costs 0.3 ms this way against 20 ms
   * read from disk, and stops growing with the book.
   *
   * The index is a beat behind a write, so this is for reading only. Anything
   * that works out a new value from the current one reads the files.
   */
  async listManagedEntriesBelow(
    folderPath: string,
    documentType?: string,
    projectId?: string,
  ): Promise<ManagedEntryRecord[]> {
    const matches: ManagedEntryRecord[] = [];
    for (const file of this.listFilesBelow(folderPath)) {
      if (file.extension !== "md") continue;
      const entry = await this.entryOf(file);
      if (entry === null) continue;
      if (!isManagedFrontmatter(entry.frontmatter)) continue;
      if (documentType && documentTypeOf(entry.frontmatter) !== documentType) continue;
      if (projectId && projectIdOf(entry.frontmatter) !== projectId) continue;
      matches.push(entry);
    }
    return matches;
  }

  /**
   * What one note declares, from the index where the index knows it.
   *
   * Two answers mean the index cannot say, and a note passes through both in
   * the moment after it is created: no cache entry at all, and a cache entry
   * with no frontmatter in it -- which is what a file indexed after it was
   * written but before its frontmatter was put in looks like. Either way the
   * note is read rather than taken at its word, because a segment that drops
   * out of its own manuscript for a frame takes the reader's place in the book
   * with it: the stream cannot find the note it was centred on, falls back to
   * the first in the manuscript, and a reader five hundred chapters in is put
   * back at chapter one.
   *
   * A note that really has no frontmatter is opened every time, which is what
   * happened to every note before the index was used at all. Manuscript folders
   * do not usually hold any.
   */
  private async entryOf(file: TFile): Promise<ManagedEntryRecord | null> {
    const cached = this.metadataCache.getFileCache(file);
    if (cached?.frontmatter === undefined) {
      const record = await this.tryReadManaged(file.path);
      return record === null ? null : toEntry(record);
    }
    // Obsidian hangs the frontmatter block's own position off the object it
    // parsed. Left in, it would be a key nothing wrote and nothing should see.
    const { position, ...frontmatter } = cached.frontmatter;
    void position;
    return {
      file,
      path: file.path,
      frontmatter,
      schemaVersion: schemaVersionOf(frontmatter),
      readOnly: isReadOnlySchema(frontmatter),
    };
  }

  private async matchManagedFiles(
    files: readonly TFile[],
    documentType?: string,
    projectId?: string,
  ): Promise<ManagedFileRecord[]> {
    const matches: ManagedFileRecord[] = [];
    for (const file of files) {
      if (file.extension !== "md") continue;
      const record = await this.tryReadManaged(file.path);
      if (!record) continue;
      if (!isManagedFrontmatter(record.frontmatter)) continue;
      if (documentType && documentTypeOf(record.frontmatter) !== documentType) continue;
      if (projectId && projectIdOf(record.frontmatter) !== projectId) continue;
      matches.push(record);
    }
    return matches;
  }

  resolveUniquePath(path: string): string {
    const normalized = this.normalize(path);
    if (!this.get(normalized)) return normalized;
    const slash = normalized.lastIndexOf("/");
    const folder = slash >= 0 ? normalized.slice(0, slash + 1) : "";
    const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";

    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${folder}${stem} (${index})${extension}`;
      if (!this.get(candidate)) return candidate;
    }
    throw new PathConflictError(normalized);
  }
}

function toEntry(record: ManagedFileRecord): ManagedEntryRecord {
  return {
    file: record.file,
    path: record.path,
    frontmatter: record.frontmatter,
    schemaVersion: record.schemaVersion,
    readOnly: record.readOnly,
  };
}

function findSectionLayoutIssue(
  content: string,
  sectionIds: readonly string[],
): ManagedMarkerIssue | null {
  return (
    findManagedMarkerIssues(content, sectionIds).find(
      (issue) =>
        issue.code !== "missing" && issue.code !== "unknown-section",
    ) ?? null
  );
}

function repairConflictFromIssue(
  sectionId: string,
  issue: ManagedMarkerIssue,
): RepairSectionConflict {
  const conflict: RepairSectionConflict = {
    sectionId,
    code: issue.code,
    reason: issue.reason,
  };
  if (issue.sectionId !== null) conflict.markerSectionId = issue.sectionId;
  if (issue.relatedSectionId !== undefined) {
    conflict.relatedSectionId = issue.relatedSectionId;
  }
  return conflict;
}

function classifySectionConflicts(
  sections: readonly ManagedSectionDefinition[],
  health: ReadonlyMap<string, ReturnType<typeof inspectMarkedSection>>,
  blockingIssues: readonly ManagedMarkerIssue[],
  optionalIds: ReadonlySet<string> = new Set(),
): SectionCheckResult {
  const result: SectionCheckResult = {
    unchanged: [],
    conflicts: [],
  };
  for (const section of sections) {
    const inspection = health.get(section.id);
    const directIssue = blockingIssues.find(
      (issue) =>
        issue.sectionId === section.id ||
        issue.relatedSectionId === section.id,
    );
    if (directIssue !== undefined) {
      result.conflicts.push(repairConflictFromIssue(section.id, directIssue));
    } else if (inspection?.status === "present") {
      result.unchanged.push(section.id);
    } else if (
      inspection?.status === "missing" &&
      optionalIds.has(section.id)
    ) {
      result.unchanged.push(section.id);
    } else {
      const blockingIssue = blockingIssues[0];
      if (blockingIssue !== undefined) {
        result.conflicts.push(
          repairConflictFromIssue(section.id, blockingIssue),
        );
      } else if (inspection?.status === "invalid") {
        result.conflicts.push({
          sectionId: section.id,
          code: inspection.code,
          reason: inspection.reason,
        });
      } else {
        result.conflicts.push({
          sectionId: section.id,
          code: "missing",
          reason: `Section "${section.id}" could not be repaired safely.`,
        });
      }
    }
  }
  return result;
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function isAtOrBelow(path: string, folder: string): boolean {
  return folder.length === 0 || path === folder || path.startsWith(`${folder}/`);
}

function isFile(node: TAbstractFile | null): node is TFile {
  return node != null && "extension" in node;
}

function isFolder(node: TAbstractFile | null): node is TFolder {
  return node != null && "children" in node;
}
