import { normalizePath } from "obsidian";

import {
  exportFileName,
  exportProse,
  joinChapters,
  safeFileName,
  type ExportFormat,
  type ExportLayout,
  type ExportSeparator,
} from "../domain";
import type { VaultRepository } from "../repository";
import { pluginWrittenRanges } from "../templates";
import { createOrUpdatePlainFile } from "./json-store";
import type { ManuscriptService } from "./manuscript-service";
import type { ProjectRef } from "./types";

/** Everything an export is asked: where, in what shape, and how the text is laid out. */
export interface ManuscriptExportOptions {
  /** The Vault folder the files go under; the empty string is the Vault root. */
  folder: string;
  format: ExportFormat;
  indent: boolean;
  paragraphSpacing: boolean;
  layout: ExportLayout;
  separator: ExportSeparator;
}

export type ManuscriptExportScope =
  | { kind: "manuscript" }
  | { kind: "segment"; path: string };

/** One file an export will write: its path, whether it stands already, its text. */
export interface ManuscriptExportTarget {
  path: string;
  exists: boolean;
  content: string;
}

export interface ManuscriptExportPlan {
  targets: ManuscriptExportTarget[];
}

/** The export folder lies inside the project, where a written file would read as one of its notes. */
export class ExportIntoManuscriptError extends Error {
  constructor(readonly path: string) {
    super(`The export folder "${path}" lies inside the project.`);
    this.name = "ExportIntoManuscriptError";
  }
}

/**
 * The manuscript as plain text files in the Vault: one note, the whole book
 * as one file, or the whole book as one file per note in a folder. The text
 * is the count's own reading of each note (`exportProse`), the same
 * extraction the word count and the analysis read through, laid out under
 * the reader's indent and spacing choices. Planning and writing are two
 * steps, so whoever asks can see which files already stand before anything
 * is written over.
 */
export class ManuscriptExportService {
  constructor(
    private readonly repository: VaultRepository,
    private readonly manuscript: ManuscriptService,
  ) {}

  /** One note's plain text under the options: what the copy button puts on the clipboard. */
  async segmentText(
    project: ProjectRef,
    path: string,
    options: Pick<ManuscriptExportOptions, "indent" | "paragraphSpacing">,
  ): Promise<string> {
    const segment = await this.manuscript.readSegment(path);
    return this.textOf(project, segment.body, options);
  }

  /**
   * The files an export would write, each with its text, and whether a file
   * already stands at its path. A note with no writing in it makes no file;
   * a single file made of nothing makes none either.
   */
  async plan(
    project: ProjectRef,
    scope: ManuscriptExportScope,
    options: ManuscriptExportOptions,
  ): Promise<ManuscriptExportPlan> {
    const folder = normalizeFolder(options.folder);
    const base = folder.length === 0 ? "" : `${folder}/`;
    if (this.insideProject(project, folder)) {
      throw new ExportIntoManuscriptError(folder);
    }
    const title = safeFileName(project.title);
    const target = (path: string, content: string): ManuscriptExportTarget => ({
      path,
      exists: this.repository.getFile(path) !== null,
      content,
    });
    if (scope.kind === "segment") {
      const segment = await this.manuscript.readSegment(scope.path);
      const content = this.textOf(project, segment.body, options);
      if (content.length === 0) return { targets: [] };
      return {
        targets: [
          target(
            normalizePath(
              `${base}${title}/${safeFileName(segment.title)}.${options.format}`,
            ),
            content,
          ),
        ],
      };
    }
    const chapters: { title: string; text: string }[] = [];
    for (const segment of await this.manuscript.listSegments(project)) {
      const content = await this.manuscript.readSegment(segment.path);
      chapters.push({
        title: segment.title,
        text: this.textOf(project, content.body, options),
      });
    }
    if (options.layout === "single") {
      const content = joinChapters(
        chapters.map((chapter) => chapter.text),
        options.separator,
      );
      if (content.length === 0) return { targets: [] };
      return {
        targets: [target(normalizePath(`${base}${title}.${options.format}`), content)],
      };
    }
    const targets: ManuscriptExportTarget[] = [];
    chapters.forEach((chapter, index) => {
      if (chapter.text.length === 0) return;
      targets.push(
        target(
          normalizePath(
            `${base}${title}/${exportFileName(
              index,
              chapters.length,
              safeFileName(chapter.title),
              options.format,
            )}`,
          ),
          chapter.text,
        ),
      );
    });
    return { targets };
  }

  /** Writes every file the plan holds, over any that stands, and answers their paths. */
  async write(plan: ManuscriptExportPlan): Promise<string[]> {
    for (const target of plan.targets) {
      await createOrUpdatePlainFile(this.repository, target.path, target.content);
    }
    return plan.targets.map((target) => target.path);
  }

  /**
   * Whether the folder lies inside the project -- at or below the project's
   * own folder -- where anything written is read as the project's: a folder
   * made under a definition tree is raised as a node of it, a note under the
   * manuscript as a chapter. A project standing at the Vault root has no
   * folder of its own to keep out of, so there the manuscript folders alone
   * are refused.
   */
  private insideProject(project: ProjectRef, folder: string): boolean {
    const root = normalizeFolder(project.rootPath);
    if (root.length === 0) {
      const base = folder.length === 0 ? "" : `${folder}/`;
      return this.manuscript.isInManuscriptFolder(project, `${base}export.md`);
    }
    return folder === root || folder.startsWith(`${root}/`);
  }

  private textOf(
    project: ProjectRef,
    body: string,
    options: Pick<ManuscriptExportOptions, "indent" | "paragraphSpacing">,
  ): string {
    return exportProse(body, pluginWrittenRanges(body, "draft"), {
      indent: options.indent,
      paragraphSpacing: options.paragraphSpacing,
      script: project.locale === "zh-CN" ? "cjk" : "latin",
    });
  }
}

/** A folder as stored: no leading or trailing slashes, the root as nothing. */
function normalizeFolder(folder: string): string {
  const trimmed = folder.trim();
  if (trimmed.length === 0 || /^\/+$/u.test(trimmed)) return "";
  return normalizePath(trimmed);
}
