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
 * ever touched.
 */

import { normalizePath } from "obsidian";

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

/** One picture as a save landed it: the link the note records, and whether a file was made for it. */
export interface GalleryLanding {
  link: string;
  path: string;
  /** False where the picture already stood in the gallery folder and was linked where it is. */
  created: boolean;
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
   * ` (2)` on a name the folder already holds. A write the vault refuses
   * trashes what this call landed before it, then rethrows, so a save that
   * fails leaves no half of itself behind.
   */
  async addPictures(
    project: KindScope,
    kind: EntityKindId,
    sources: readonly GalleryPictureSource[],
  ): Promise<GalleryLanding[]> {
    const folder = this.folderPath(project, kind);
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
          landed.push(await this.land(folder, file.name, await this.repository.vault.readBinary(file)));
        } else {
          landed.push(await this.land(folder, source.name, await source.read()));
        }
      }
    } catch (error) {
      await this.discardPictures(landed.filter((entry) => entry.created).map((entry) => entry.path));
      throw error;
    }
    return landed;
  }

  private async land(folder: string, name: string, data: ArrayBuffer): Promise<GalleryLanding> {
    await this.repository.ensureFolder(folder);
    const path = this.repository.resolveUniquePath(`${folder}/${safeFileName(name)}`);
    const file = await this.repository.vault.createBinary(path, data);
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
   * Trashes the pictures the given links name, where the plugin may: a link
   * that resolves nowhere, or to a file outside every gallery folder of the
   * project, is left alone; one inside a gallery folder goes to the trash
   * unless a note other than the ones named still links to it. The saving
   * or deleted note is named in `exceptSources`, since the index reports
   * its links as they stood a moment before the write. Never throws: the
   * save has landed, and what would not go is answered by name.
   */
  async trashOrphans(
    project: KindScope,
    links: readonly string[],
    sourcePath: string,
    exceptSources: readonly string[],
  ): Promise<{ trashed: string[]; failed: string[] }> {
    const folders = this.folderPaths(project);
    const except = new Set(exceptSources.map((path) => normalizePath(path)));
    const resolved = this.repository.metadataCache.resolvedLinks;
    const trashed: string[] = [];
    const failed: string[] = [];
    for (const raw of links) {
      const target = galleryLinkTarget(raw);
      if (target === null) continue;
      const file = this.repository.metadataCache.getFirstLinkpathDest(target, sourcePath);
      if (file === null || !folders.some((folder) => file.path.startsWith(`${folder}/`))) continue;
      const linkedElsewhere = Object.entries(resolved).some(
        ([source, targets]) => !except.has(source) && (targets[file.path] ?? 0) > 0,
      );
      if (linkedElsewhere) continue;
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
   * One save of a note's gallery around the note's own write: the draft's
   * picks are landed first, the composed list and main are handed to `write`
   * as the note's Input or Patch takes them, and the pictures the draft took
   * off go to the trash once the write has landed. A write that throws has
   * what was just landed discarded before the error goes on, and a form that
   * carries no draft writes with nothing and touches no file.
   */
  async commit<T>(
    project: KindScope,
    kind: EntityKindId,
    draft: GalleryDraft | undefined,
    write: (gallery: GalleryWrite) => Promise<T>,
    notePathOf: (result: T) => string,
  ): Promise<GalleryCommit<T>> {
    if (draft === undefined) return { result: await write({}), trashFailed: [] };
    const landed = await this.addPictures(project, kind, galleryPicks(draft));
    const composed = composeGallery(draft, landed.map((entry) => entry.link));
    let result: T;
    try {
      result = await write(composed);
    } catch (error) {
      await this.discardPictures(landed.filter((entry) => entry.created).map((entry) => entry.path));
      throw error;
    }
    // A picture taken off and picked again in the same form is still the
    // note's; only what the saved list no longer names is tidied.
    const kept = new Set(composed.gallery.map((raw) => galleryLinkTarget(raw) ?? raw.trim()));
    const removed = draft.removed.filter((raw) => !kept.has(galleryLinkTarget(raw) ?? raw.trim()));
    const notePath = notePathOf(result);
    const { failed } = await this.trashOrphans(project, removed, notePath, [notePath]);
    return { result, trashFailed: failed };
  }
}
