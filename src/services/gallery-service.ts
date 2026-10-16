/**
 * The pictures a character, a scene or a worldbuilding note keeps. Each kind
 * has a gallery folder inside its own folder, `25_Gallery` inside
 * `20_Character`, made the first time a picture lands in it and never by the
 * scaffold. A picture picked anywhere, in the vault or on the device, is
 * copied in under its own name; one already in the kind's gallery folder is
 * linked where it is, so two notes of a kind can share a picture. The note
 * itself records the links, and when a save takes a picture off a note the
 * file goes to the trash unless another note still names it: what the plugin
 * landed is the plugin's to tidy, and nothing outside a gallery folder is
 * ever touched. A picture picked under the name of one the same save takes
 * off gets that name, not a numbered one, once the other is in the trash.
 */

import { normalizePath, type TFile } from "obsidian";

import {
  composeGallery,
  galleryLinkTarget,
  galleryPicks,
  safeFileName,
  wikiLinkText,
  type EntityKindId,
  type GalleryDraft,
  type GalleryPictureSource,
} from "../domain";
import { ManagedFileNotFoundError, type VaultRepository } from "../repository";
import { galleryRootNameForFolder } from "./definition-files";
import { entityKindFolder, type KindScope } from "./types";

/** `…/20_Character/25_Gallery`: where a kind's pictures land, inside the project. */
export function galleryFolderPath(project: KindScope, kind: EntityKindId): string {
  const kindFolder = entityKindFolder(project, kind);
  return normalizePath(
    `${project.rootPath}/${kindFolder}/${galleryRootNameForFolder(kindFolder, project.locale)}`,
  );
}

/** One picture as a save landed it: the link the note records, where the file stands, and whether a file was made for it. */
export interface GalleryLanding {
  link: string;
  path: string;
  /** False where the picture already stood in the gallery folder and was linked where it is. */
  created: boolean;
  /**
   * Where the file moves once the save has landed, where its own name was
   * held by a picture the same save takes off: the note records this path,
   * and the file waits under a numbered name until the other is in the trash.
   */
  settles?: string;
}

/** The two keys a save writes, as the note's Input or Patch takes them. */
export interface GalleryWrite {
  gallery?: string[];
  galleryMain?: string | null;
}

/** What a save around a note write answers: the write's own answer, and the pictures that would not go to the trash. */
export interface GalleryCommit<T> {
  result: T;
  trashFailed: string[];
}

/** How long a save waits for the vault to let go of a trashed picture's name, in milliseconds, and how often it looks. */
const FREED_NAME_WAIT_MS = 50;
const FREED_NAME_LOOKS = 20;

const targetOf = (raw: string): string => galleryLinkTarget(raw) ?? raw.trim();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

export class GalleryService {
  constructor(private readonly repository: VaultRepository) {}

  folderPath(project: KindScope, kind: EntityKindId): string {
    return galleryFolderPath(project, kind);
  }

  /** Every gallery folder the project has: the characters', the scenes', and one per kind. */
  folderPaths(project: KindScope): string[] {
    const kinds: EntityKindId[] = [
      "character",
      "scene",
      ...project.worldbuildingKinds.map((kind) => kind.id),
    ];
    return kinds.map((kind) => this.folderPath(project, kind));
  }

  /**
   * Lands each source in the kind's gallery folder and answers one landing
   * per source, in order. A vault file already inside that folder is linked
   * where it is; any other is read and written under its own name, with a
   * ` (2)` on a name the folder already holds. A name in `freed` is held by
   * a picture the save is taking off: the first source that wants it lands
   * under the numbered name but is linked by its own, and moves there once
   * the save has landed. A write the vault refuses trashes what this call
   * landed before it, then rethrows, so a save that fails leaves no half of
   * itself behind.
   */
  async addPictures(
    project: KindScope,
    kind: EntityKindId,
    sources: readonly GalleryPictureSource[],
    freed: ReadonlySet<string> = new Set(),
  ): Promise<GalleryLanding[]> {
    const folder = this.folderPath(project, kind);
    const unclaimed = new Set(freed);
    const landed: GalleryLanding[] = [];
    try {
      for (const source of sources) {
        if (source.kind === "vault") {
          const path = normalizePath(source.path);
          const file = this.repository.vault.getFileByPath(path);
          if (file === null) throw new ManagedFileNotFoundError(path);
          if (path.startsWith(`${folder}/`)) {
            landed.push({ link: wikiLinkText(path), path, created: false });
            continue;
          }
          landed.push(
            await this.land(folder, file.name, await this.repository.vault.readBinary(file), unclaimed),
          );
        } else {
          landed.push(await this.land(folder, source.name, await source.read(), unclaimed));
        }
      }
    } catch (error) {
      await this.discardPictures(landed.filter((entry) => entry.created).map((entry) => entry.path));
      throw error;
    }
    return landed;
  }

  private async land(
    folder: string,
    name: string,
    data: ArrayBuffer,
    freed: Set<string>,
  ): Promise<GalleryLanding> {
    await this.repository.ensureFolder(folder);
    const wanted = normalizePath(`${folder}/${safeFileName(name)}`);
    const path = this.repository.resolveUniquePath(wanted);
    const file = await this.repository.vault.createBinary(path, data);
    // The name is a leaving picture's until that picture is in the trash:
    // the note records the name, and the file takes it once the save has landed.
    if (path !== wanted && freed.delete(wanted)) {
      return { link: wikiLinkText(wanted), path: file.path, created: true, settles: wanted };
    }
    return { link: wikiLinkText(file.path), path: file.path, created: true };
  }

  /**
   * Trashes files a save landed and then could not keep, as best it can:
   * the note write has already refused, and a second failure here is only
   * reported, never thrown over the first.
   */
  async discardPictures(paths: readonly string[]): Promise<string[]> {
    const failed: string[] = [];
    for (const path of paths) {
      try {
        await this.repository.trashFile(path);
      } catch {
        failed.push(path);
      }
    }
    return failed;
  }

  /**
   * The pictures among the given links the plugin may trash: a link that
   * resolves nowhere, or to a file outside every gallery folder of the
   * project, is left out; one inside a gallery folder is answered unless a
   * note other than the ones named still links to it. The saving or deleted
   * note is named in `exceptSources`, since the index reports its links as
   * they stood a moment before the write. Each file is answered once.
   */
  private orphansAmong(
    project: KindScope,
    links: readonly string[],
    sourcePath: string,
    exceptSources: readonly string[],
  ): TFile[] {
    const folders = this.folderPaths(project);
    const except = new Set(exceptSources.map((path) => normalizePath(path)));
    const resolved = this.repository.metadataCache.resolvedLinks;
    const orphans = new Map<string, TFile>();
    for (const raw of links) {
      const target = galleryLinkTarget(raw);
      if (target === null) continue;
      const file = this.repository.metadataCache.getFirstLinkpathDest(target, sourcePath);
      if (file === null || orphans.has(file.path)) continue;
      if (!folders.some((folder) => file.path.startsWith(`${folder}/`))) continue;
      const linkedElsewhere = Object.entries(resolved).some(
        ([source, targets]) => !except.has(source) && (targets[file.path] ?? 0) > 0,
      );
      if (!linkedElsewhere) orphans.set(file.path, file);
    }
    return [...orphans.values()];
  }

  /**
   * Trashes the pictures the given links name, where the plugin may, as
   * `orphansAmong` finds them. Never throws: the save has landed, and what
   * would not go is answered by name.
   */
  async trashOrphans(
    project: KindScope,
    links: readonly string[],
    sourcePath: string,
    exceptSources: readonly string[],
  ): Promise<{ trashed: string[]; failed: string[] }> {
    const trashed: string[] = [];
    const failed: string[] = [];
    for (const file of this.orphansAmong(project, links, sourcePath, exceptSources)) {
      try {
        await this.repository.trashFile(file.path);
        trashed.push(file.path);
      } catch {
        failed.push(file.name);
      }
    }
    return { trashed, failed };
  }

  /**
   * The names a save frees: the pictures the draft takes off that will go to
   * the trash, less any the draft picks again where they stand. A namesake
   * picked in the same save may take such a name once the save has landed.
   */
  private freedBy(
    project: KindScope,
    draft: GalleryDraft,
    picks: readonly GalleryPictureSource[],
    notePath: string,
  ): Set<string> {
    const inPlace = new Set(
      picks.flatMap((pick) => (pick.kind === "vault" ? [normalizePath(pick.path)] : [])),
    );
    const freed = new Set<string>();
    for (const file of this.orphansAmong(project, draft.removed, notePath, [notePath])) {
      if (!inPlace.has(file.path)) freed.add(file.path);
    }
    return freed;
  }

  /**
   * Moves each landed namesake onto the name the save freed, once the picture
   * that held it is in the trash and the vault has let go of the name. One
   * whose name is held still, the trash having refused, stays under its
   * numbered name and is answered by name, since the note records the name
   * it was to take.
   */
  private async settle(landed: readonly GalleryLanding[], trashed: readonly string[]): Promise<string[]> {
    const gone = new Set(trashed);
    const failed: string[] = [];
    for (const entry of landed) {
      if (entry.settles === undefined) continue;
      const name = entry.settles.slice(entry.settles.lastIndexOf("/") + 1);
      if (!gone.has(entry.settles)) {
        failed.push(name);
        continue;
      }
      try {
        for (let look = 0; look < FREED_NAME_LOOKS; look += 1) {
          if (this.repository.vault.getAbstractFileByPath(entry.settles) === null) break;
          await sleep(FREED_NAME_WAIT_MS);
        }
        await this.repository.renameFile(entry.path, entry.settles);
      } catch {
        failed.push(name);
      }
    }
    return failed;
  }

  /**
   * One save of a note's gallery around the note's own write: the draft's
   * picks are landed first, the composed list and main are handed to `write`
   * as the note's Input or Patch takes them, and the pictures the draft took
   * off go to the trash once the write has landed. A write that throws has
   * what was just landed discarded before the error goes on, and a form that
   * carries no draft writes with nothing and touches no file. `notePath` is
   * where the note stands before an update, which lets a picture picked under
   * a leaving picture's name take that name; a note yet to be made has
   * nothing to take off.
   */
  async commit<T>(
    project: KindScope,
    kind: EntityKindId,
    draft: GalleryDraft | undefined,
    write: (gallery: GalleryWrite) => Promise<T>,
    notePathOf: (result: T) => string,
    notePath?: string,
  ): Promise<GalleryCommit<T>> {
    if (draft === undefined) return { result: await write({}), trashFailed: [] };
    const picks = galleryPicks(draft);
    const freed = notePath === undefined ? new Set<string>() : this.freedBy(project, draft, picks, notePath);
    const landed = await this.addPictures(project, kind, picks, freed);
    const composed = composeGallery(draft, landed.map((entry) => entry.link));
    let result: T;
    try {
      result = await write(composed);
    } catch (error) {
      await this.discardPictures(landed.filter((entry) => entry.created).map((entry) => entry.path));
      throw error;
    }
    // A picture taken off and picked again in the same form is still the
    // note's; only what the saved list no longer names is tidied. A name a
    // landed namesake waits for is the leaving picture's still.
    const settling = new Set(
      landed.flatMap((entry) => (entry.settles === undefined ? [] : [targetOf(entry.link)])),
    );
    const kept = new Set(composed.gallery.map(targetOf).filter((target) => !settling.has(target)));
    const removed = draft.removed.filter((raw) => !kept.has(targetOf(raw)));
    const savedPath = notePathOf(result);
    // The note is excepted under both its paths: a save that renames it may
    // still be indexed under the old one, with the links it held before.
    const except = notePath === undefined || notePath === savedPath ? [savedPath] : [savedPath, notePath];
    const { trashed, failed } = await this.trashOrphans(project, removed, savedPath, except);
    const unsettled = await this.settle(landed, trashed);
    return { result, trashFailed: [...failed, ...unsettled] };
  }
}
