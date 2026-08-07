import {
  normalizePath,
  type FileManager,
  type MetadataCache,
  type Vault,
} from "obsidian";

import {
  RANK_GAP,
  SCHEMA_VERSION,
  STEP_IDS,
  managedSectionsForDocument,
  areStepPrerequisitesComplete,
  assertStepStatus,
  calculateContextNeedsReview,
  canSetStepStatus,
  createDefaultStepStatuses,
  enforceStepStatusDependencies,
  fingerprint,
  foldName,
  isDocumentType,
  isCharacterType,
  isNameTaken,
  isProjectLanguage,
  isScenePovMode,
  isStepStatus,
  moveScene,
  reviewContextFingerprint,
  setStepStatus,
  sortScenesByRank,
  SCENE_POV_OMNISCIENT,
  type CharacterType,
  type DocumentType,
  type ProjectLanguage,
  type StepFingerprintMap,
  type StepId,
  type StepStatus,
  type StepStatusMap,
} from "../domain";
import {
  ConcurrentChangeError,
  InvalidManagedDocumentError,
  ManagedFileNotFoundError,
  PathConflictError,
  UnsupportedSchemaError,
  VaultRepository,
  documentTypeOf,
  projectIdOf,
  schemaVersionOf,
  type ManagedFileRecord,
  type ManagedFrontmatter,
} from "../repository";
import {
  characterTemplate,
  getProjectBases,
  getStoryArtifacts,
  getSystemTemplates,
  draftTemplate,
  storyArtifactTemplate,
  projectTemplate,
  inspectManagedDocumentSections,
  readMarkedSection,
  sceneTemplate,
  type MarkdownTemplate,
  type ProjectBaseDefinition,
  type ProjectBaseId,
  type SystemTemplateDefinition,
} from "../templates";
import {
  DEFAULT_PROJECT_ROOT,
  FRONTMATTER_KEYS,
  PROJECT_DIRECTORY_KEYS,
  PROJECT_PATH_LAYOUTS,
  getProjectMetadataRelativePath,
  getProjectPathLayout,
  type ArtifactSnapshot,
  type CharacterInput,
  type CharacterPatch,
  type CharacterRecord,
  type CreateProjectOptions,
  type ProjectFrontmatterPatch,
  type ProjectDirectoryKey,
  type ProjectLocator,
  type ProjectRef,
  type ProjectSnapshot,
  type ProjectStructureIssue,
  type RepairResult,
  type SceneInput,
  type ScenePatch,
  type SceneRecord,
} from "./types";

const STATIC_DOCUMENT_BY_STEP: Partial<Record<StepId, DocumentType>> = {
  1: "one-sentence-summary",
  2: "one-paragraph-summary",
  4: "plot-synopsis",
  6: "long-synopsis",
  10: "draft",
};

export class ProjectCreationInterruptedError extends Error {
  constructor(
    readonly projectPath: string,
    readonly originalError: unknown,
  ) {
    super(
      `Project creation was interrupted after "${projectPath}" was created: ${
        originalError instanceof Error ? originalError.message : String(originalError)
      }`,
    );
    this.name = "ProjectCreationInterruptedError";
  }
}

export type NamedRecordKind = "character" | "scene" | "project";

/**
 * A name another record of the same kind already answers to — a character or
 * scene within one project, or a project within one root folder.
 *
 * Rejected rather than numbered like a file name, because a name is the whole of
 * what the plugin shows: a scene's point of view, its cast tags, the project
 * switcher, and the Bases views all present the name alone, so two that match
 * leave the author choosing between rows they cannot tell apart. The folders and
 * notes would disagree with it too — the second lands at "Ada (2)" while its
 * frontmatter still reads "Ada", so the file explorer and the dashboard stop
 * naming the same thing.
 */
export class DuplicateNameError extends Error {
  constructor(
    readonly kind: NamedRecordKind,
    readonly requestedName: string,
  ) {
    super(
      kind === "project"
        ? `A project named "${requestedName}" already exists.`
        : `A ${kind} named "${requestedName}" already exists in this project.`,
    );
    this.name = "DuplicateNameError";
  }
}

export class SnowflakeProjectService {
  readonly repository: VaultRepository;

  constructor(
    vault: Vault,
    fileManager: FileManager,
    metadataCache: MetadataCache,
    readonly defaultRoot = DEFAULT_PROJECT_ROOT,
  ) {
    this.repository = new VaultRepository(vault, fileManager, metadataCache);
  }

  async discoverProjects(rootPath = this.defaultRoot): Promise<ProjectRef[]> {
    const root = normalizePath(rootPath);
    const projects: ProjectRef[] = [];

    // Deliberately inspect only the direct child folders of the configured root.
    for (const folder of this.repository.listDirectFolders(root)) {
      const candidatesByPath = new Map<string, ManagedFileRecord>();
      const metadataFolders = Object.values(PROJECT_PATH_LAYOUTS).map((layout) =>
        normalizePath(`${folder.path}/${layout.directories.system}`),
      );
      for (const metadataFolder of new Set(metadataFolders)) {
        for (const candidate of await this.repository.findManagedFiles(
          metadataFolder,
          "project-metadata",
        )) {
          candidatesByPath.set(candidate.path, candidate);
        }
      }
      const candidates = [...candidatesByPath.values()];
      for (const candidate of candidates) {
        try {
          projects.push(await this.toInspectableProjectRef(candidate, folder.path));
        } catch (error) {
          if (!(error instanceof InvalidManagedDocumentError)) throw error;
        }
      }

      // A damaged project document may have lost its document type or project
      // id and therefore cannot be returned by findManagedFiles(). Keep the
      // canonical metadata note discoverable so the UI can explain and repair
      // the problem instead of silently dropping the project from the list.
      if (candidates.length === 0) {
        for (const layout of Object.values(PROJECT_PATH_LAYOUTS)) {
          const path = normalizePath(
            `${folder.path}/${layout.directories.system}/${layout.projectFileName}`,
          );
          const candidate = await this.repository.tryReadManaged(path);
          if (candidate === null) continue;
          projects.push(await this.toInspectableProjectRef(candidate, folder.path));
          break;
        }
      }
    }

    return projects.sort((left, right) =>
      left.title.localeCompare(right.title, undefined, { numeric: true }),
    );
  }

  async loadProject(locator: ProjectLocator): Promise<ProjectSnapshot> {
    const record = await this.resolveProjectRecord(locator);
    const project = await this.toInspectableProjectRef(
      record,
      projectRootForMetadataPath(record.path),
    );
    const steps = readStepStatuses(record.frontmatter[FRONTMATTER_KEYS.stepStatuses]);
    const links = {
      draft: this.linkedPath(
        asOptionalString(record.frontmatter[FRONTMATTER_KEYS.draft]),
        record.path,
      ),
    };
    const reviewedFingerprints = readFingerprints(
      record.frontmatter[FRONTMATTER_KEYS.reviewedFingerprints],
    );
    const fingerprintCalculation = await this.calculateProjectFingerprints(
      project,
      links.draft,
    );
    const currentFingerprints = fingerprintCalculation.fingerprints;
    const structureIssues = await this.inspectProjectStructure(
      project,
      record,
      links.draft,
    );
    return {
      ...project,
      readOnly: project.readOnly || fingerprintCalculation.hasUnsupportedChildren,
      steps,
      links,
      reviewedFingerprints,
      currentFingerprints,
      needsReview: calculateContextNeedsReview(currentFingerprints, reviewedFingerprints),
      schemaVersion: record.schemaVersion,
      characters: fingerprintCalculation.characters,
      scenes: fingerprintCalculation.scenes,
      artifacts: fingerprintCalculation.artifacts,
      structureIssues,
    };
  }

  async reconcileRevisionStatuses(
    projectLocator: ProjectLocator,
  ): Promise<ProjectSnapshot> {
    let locator: ProjectLocator = projectLocator;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const project = await this.loadProject(locator);
      locator = project.projectFile;
      if (
        project.readOnly ||
        project.structureIssues.length > 0 ||
        this.projectHasBlockingManagedSectionIssues(project) ||
        project.needsReview.length === 0
      ) {
        return project;
      }

      const outdated = new Set(project.needsReview);
      const expectedStatuses = project.steps;
      const expectedReviewed = project.reviewedFingerprints;
      const currentFingerprints = project.currentFingerprints;

      // A step left in-revision keeps its stale reviewed fingerprint, so it
      // stays in needsReview indefinitely while having nothing left to
      // reconcile. Trying the pass against the snapshot first keeps that
      // steady state from rewriting the metadata note on every dashboard
      // load, which the Vault "modify" listener would turn straight back
      // into another refresh.
      if (
        !reconcileRevisionFrontmatter(
          expectedStatuses,
          expectedReviewed,
          outdated,
          currentFingerprints,
        ).changed
      ) {
        return project;
      }

      let applied = false;
      await this.repository.updateFrontmatterAtomic(project.projectFile, (frontmatter) => {
        const steps = readStepStatuses(frontmatter[FRONTMATTER_KEYS.stepStatuses]);
        const reviewed = readFingerprints(
          frontmatter[FRONTMATTER_KEYS.reviewedFingerprints],
        );
        // Reconcile only the steps whose stored state still matches the
        // snapshot the decision above was made from.
        const unchangedSinceSnapshot = new Set(
          [...outdated].filter(
            (step) =>
              steps[step] === expectedStatuses[step] &&
              reviewed[step] === expectedReviewed[step],
          ),
        );
        const result = reconcileRevisionFrontmatter(
          steps,
          reviewed,
          unchangedSinceSnapshot,
          currentFingerprints,
        );

        if (!result.changed) return {};
        applied = true;
        return {
          [FRONTMATTER_KEYS.stepStatuses]: result.steps,
          [FRONTMATTER_KEYS.reviewedFingerprints]: result.reviewed,
        };
      });

      if (applied) return this.loadProject(project.projectFile);
    }
    return this.loadProject(locator);
  }

  async createProject(options: CreateProjectOptions): Promise<ProjectSnapshot> {
    const title = (options.name ?? options.title ?? "").trim();
    if (!title) throw new Error("Project name is required.");
    const locale = options.locale ?? options.language ?? "en";
    if (!isProjectLanguage(locale)) throw new Error(`Unsupported project language: ${String(locale)}`);

    const root = normalizePath(options.rootPath ?? this.defaultRoot);
    // Scoped to the root the project is being made in, which is the only place
    // its folder and its name can collide with anything.
    this.assertNameAvailable(
      "project",
      (await this.discoverProjects(root)).map((candidate) => candidate.title),
      title,
    );
    await this.repository.ensureFolder(root);
    const requestedFolder = normalizePath(`${root}/${safeFileName(title)}`);
    const rootPath = this.repository.resolveUniquePath(requestedFolder);
    await this.repository.ensureFolder(rootPath);

    const projectId = createStableId("project");
    const projectPath = normalizePath(
      `${rootPath}/${getProjectMetadataRelativePath(locale)}`,
    );
    await this.repository.createManagedFile({
      path: projectPath,
      template: projectTemplate(title, locale),
      frontmatter: projectFrontmatter(
        projectId,
        title,
        locale,
      ),
    });

    // Repair is intentionally the same operation used after interrupted creation.
    try {
      await this.repairProject(rootPath);
      return await this.loadProject(projectPath);
    } catch (error) {
      throw new ProjectCreationInterruptedError(projectPath, error);
    }
  }

  async renameProject(
    projectLocator: ProjectLocator,
    title: string,
  ): Promise<ProjectSnapshot> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const nextTitle = title.trim();
    if (!nextTitle) throw new Error("Project name is required.");
    // Keeping its own name is not taking one, so only a change is checked --
    // and against the siblings under its own root, where the folder would land.
    const root = parentOf(project.rootPath);
    if (foldName(nextTitle) !== foldName(project.title)) {
      this.assertNameAvailable(
        "project",
        (await this.discoverProjects(root))
          .filter((candidate) => candidate.id !== project.id)
          .map((candidate) => candidate.title),
        nextTitle,
      );
    }

    const destinationRoot = normalizePath(`${root}/${safeFileName(nextTitle)}`);
    if (destinationRoot !== project.rootPath && this.repository.get(destinationRoot)) {
      throw new PathConflictError(destinationRoot);
    }

    let projectFile = project.projectFile;
    if (destinationRoot !== project.rootPath) {
      const folder = this.repository.getFolder(project.rootPath);
      if (!folder) throw new ManagedFileNotFoundError(project.rootPath);
      await this.repository.fileManager.renameFile(folder, destinationRoot);
      projectFile = normalizePath(
        `${destinationRoot}/${relativeToRoot(project.projectFile, project.rootPath)}`,
      );
    }

    await this.repository.updateFrontmatter(projectFile, {
      [FRONTMATTER_KEYS.projectName]: nextTitle,
    });
    await this.repository.updateFirstHeading(projectFile, nextTitle);
    return this.loadProject(projectFile);
  }

  async repairProject(path: string): Promise<RepairResult> {
    const normalized = normalizePath(path);
    const existingFile = this.repository.getFile(normalized);
    const rootPath = existingFile
      ? projectRootForMetadataPath(normalized)
      : normalized;
    await this.repository.ensureFolder(rootPath);

    const result: Omit<RepairResult, "project"> = {
      created: [],
      repaired: [],
      unchanged: [],
      conflicts: [],
      sectionResults: [],
    };

    let projectRecord = await this.findRepairableProjectRecord(rootPath);
    if (!projectRecord) {
      const title = basename(rootPath) || "Snowflake Project";
      const projectId = createStableId("project");
      const layout = getProjectPathLayout("en");
      const created = await this.repository.createManagedFile({
        path: normalizePath(
          `${rootPath}/${layout.directories.system}/${layout.projectFileName}`,
        ),
        template: projectTemplate(title, "en"),
        frontmatter: projectFrontmatter(projectId, title, "en"),
        uniqueOnConflict: true,
      });
      markCreated(result, created.path);
      projectRecord = await this.repository.readManaged(created.path);
    }

    if (projectRecord.readOnly) {
      throw new UnsupportedSchemaError(
        projectRecord.path,
        projectRecord.schemaVersion ?? SCHEMA_VERSION + 1,
        SCHEMA_VERSION,
      );
    }

    const rawProjectId = projectRecord.frontmatter[FRONTMATTER_KEYS.projectId];
    const repairedProjectId =
      normalizeStableId(rawProjectId) ??
      (await this.recoverProjectId(rootPath)) ??
      createStableId("project");
    const projectLanguageValue = projectRecord.frontmatter[FRONTMATTER_KEYS.projectLanguage];
    const repairedProjectLanguage: ProjectLanguage = isProjectLanguage(projectLanguageValue)
      ? projectLanguageValue
      : "en";
    const repairedProjectTitle =
      asOptionalString(projectRecord.frontmatter[FRONTMATTER_KEYS.projectName]) ??
      (basename(rootPath) || "Snowflake Project");
    const repairedProjectMetadata: ManagedFrontmatter = {};
    if (!hasOwn(projectRecord.frontmatter, FRONTMATTER_KEYS.schema)) {
      repairedProjectMetadata[FRONTMATTER_KEYS.schema] = SCHEMA_VERSION;
    }
    if (rawProjectId !== repairedProjectId) {
      repairedProjectMetadata[FRONTMATTER_KEYS.projectId] = repairedProjectId;
    }
    if (projectRecord.frontmatter[FRONTMATTER_KEYS.projectName] !== repairedProjectTitle) {
      repairedProjectMetadata[FRONTMATTER_KEYS.projectName] = repairedProjectTitle;
    }
    if (projectLanguageValue !== repairedProjectLanguage) {
      repairedProjectMetadata[FRONTMATTER_KEYS.projectLanguage] = repairedProjectLanguage;
    }
    const repairedStatuses = readStepStatuses(projectRecord.frontmatter[FRONTMATTER_KEYS.stepStatuses]);
    if (
      fingerprint(projectRecord.frontmatter[FRONTMATTER_KEYS.stepStatuses]) !==
      fingerprint(repairedStatuses)
    ) {
      repairedProjectMetadata[FRONTMATTER_KEYS.stepStatuses] = repairedStatuses;
    }
    const repairedReviewMap = readRepairFingerprints(
      projectRecord.frontmatter[FRONTMATTER_KEYS.reviewedFingerprints],
    );
    if (
      fingerprint(projectRecord.frontmatter[FRONTMATTER_KEYS.reviewedFingerprints]) !==
      fingerprint(repairedReviewMap)
    ) {
      repairedProjectMetadata[FRONTMATTER_KEYS.reviewedFingerprints] = repairedReviewMap;
    }
    if (!hasOwn(projectRecord.frontmatter, FRONTMATTER_KEYS.draft)) {
      repairedProjectMetadata[FRONTMATTER_KEYS.draft] = "";
    }
    if (Object.keys(repairedProjectMetadata).length > 0) {
      await this.repository.updateFrontmatter(projectRecord.path, repairedProjectMetadata);
      markRepaired(result, projectRecord.path);
      projectRecord = await this.repository.readManaged(projectRecord.path);
    }

    const project = this.toProjectRef(projectRecord, rootPath);
    const layout = getProjectPathLayout(project.locale);
    const commonFolders = Object.values(layout.directories).map((folder) =>
      normalizePath(`${rootPath}/${folder}`),
    );
    for (const folder of commonFolders) {
      const existed = this.repository.getFolder(folder) != null;
      await this.repository.ensureFolder(folder);
      if (existed) markUnchanged(result, folder);
      else markCreated(result, folder);
    }

    const managedTypesByDirectory: Record<
      ProjectDirectoryKey,
      ReadonlySet<DocumentType>
    > = {
      system: new Set([
        "project-metadata",
        "one-sentence-summary",
        "one-paragraph-summary",
        "plot-synopsis",
        "long-synopsis",
        "character",
        "scene",
        "draft",
        "material",
        "archive",
      ]),
      summaries: new Set([
        "one-sentence-summary",
        "one-paragraph-summary",
      ]),
      synopses: new Set([
        "plot-synopsis",
        "long-synopsis",
      ]),
      characters: new Set(["character"]),
      scenes: new Set(["scene"]),
      draft: new Set(["draft"]),
      materials: new Set(),
      archive: new Set(),
    };
    for (const directory of Object.keys(
      managedTypesByDirectory,
    ) as ProjectDirectoryKey[]) {
      for (const folderName of this.getProjectDirectoryNames(project, directory)) {
        await this.repairFolderOwnership(
          normalizePath(`${rootPath}/${folderName}`),
          managedTypesByDirectory[directory],
          project.id,
          result,
        );
      }
    }

    for (const systemTemplate of getSystemTemplates(project.locale)) {
      const path = normalizePath(
        `${rootPath}/${layout.directories.system}/${systemTemplate.fileName}`,
      );
      const frontmatter = systemTemplateFrontmatter(systemTemplate, project);
      const existing = this.repository.get(path);
      if (existing === null) {
        await this.repository.createManagedFile({
          path,
          template: systemTemplate.template,
          frontmatter,
        });
        markCreated(result, path);
      } else if (this.repository.getFile(path) !== null) {
        const record = await this.repository.tryReadManaged(path);
        if (
          record !== null &&
          isCurrentSystemTemplate(record, systemTemplate, frontmatter)
        ) {
          markUnchanged(result, path);
        } else {
          markConflict(result, path, `The system template at "${path}" is out of date.`);
        }
      } else {
        markConflict(result, path, `A folder already exists at "${path}".`);
      }
    }

    // Only the existence of a base is a contract. Its views, column order, and
    // widths belong to the author, and Obsidian itself rewrites the file when a
    // column is resized, so a content check would report ordinary use as damage.
    for (const base of getProjectBases(project.id, project.locale)) {
      const path = normalizePath(
        `${rootPath}/${layout.directories[base.id]}/${base.fileName}`,
      );
      const existing = this.repository.get(path);
      if (existing === null) {
        await this.repository.createPlainFile(path, base.content);
        markCreated(result, path);
      } else if (this.repository.getFile(path) !== null) {
        markUnchanged(result, path);
      } else {
        markConflict(result, path, `A folder already exists at "${path}".`);
      }
    }

    for (const artifact of getStoryArtifacts(project.locale)) {
      const template = storyArtifactTemplate(artifact.step, project.locale);
      await this.ensureArtifact(
        project,
        artifact.document,
        artifact.relativePath,
        template,
        result,
      );
    }

    const characterRecords = await this.findManagedFilesInProjectDirectories(
      project,
      "characters",
      "character",
      project.id,
    );
    const usedCharacterIds = new Set<string>();
    const usedCharacterRanks = new Set<number>();
    for (let character of characterRecords) {
      const metadata = this.repairCharacterMetadata(
        character,
        usedCharacterIds,
        usedCharacterRanks,
      );
      if (Object.keys(metadata.patch).length > 0) {
        await this.repository.updateFrontmatter(character.path, metadata.patch);
        markRepaired(result, character.path);
        character = await this.repository.readManaged(character.path);
      }
      await this.checkDocumentSections(
        character,
        characterTemplate(metadata.name, project.locale),
        result,
      );
    }

    const sceneRecords = await this.findManagedFilesInProjectDirectories(
      project,
      "scenes",
      "scene",
      project.id,
    );
    const usedSceneIds = new Set<string>();
    const usedSceneRanks = new Set<number>();
    for (let scene of sceneRecords) {
      const metadata = this.repairSceneMetadata(scene, usedSceneIds, usedSceneRanks);
      if (Object.keys(metadata.patch).length > 0) {
        await this.repository.updateFrontmatter(scene.path, metadata.patch);
        markRepaired(result, scene.path);
        scene = await this.repository.readManaged(scene.path);
      }
      await this.checkDocumentSections(
        scene,
        sceneTemplate(metadata.title, project.locale),
        result,
      );
    }

    const draftLink = asOptionalString(
      projectRecord.frontmatter[FRONTMATTER_KEYS.draft],
    );
    if (
      !draftLink ||
      this.missingLink(draftLink, projectRecord.path) !== null
    ) {
      await this.restoreDraft(project, result);
    }

    return { project: await this.loadProject(project.projectFile), ...result };
  }

  /**
   * Gives a project back a draft to point at: the managed draft already in its
   * draft folder when one is there, and a new draft beside whatever else is
   * there when none is. Both repairs go through here so a link that leads
   * nowhere is mended the same way whichever side asks for it -- in particular
   * neither leaves a second draft behind when the first one is still present.
   */
  private async restoreDraft(
    project: ProjectRef,
    result: Omit<RepairResult, "project">,
  ): Promise<string> {
    const layout = getProjectPathLayout(project.locale);
    const draft = await this.ensureArtifact(
      project,
      "draft",
      `${layout.directories.draft}/${layout.draftFileName}`,
      draftTemplate(project.title, project.locale),
      result,
    );
    await this.repository.updateFrontmatter(project.projectFile, {
      [FRONTMATTER_KEYS.draft]: toWikiLink(draft),
    });
    markRepaired(result, project.projectFile);
    return draft;
  }

  /**
   * Repairs exactly one user-selected missing folder, canonical note, or
   * system template.
   * Health checks never call this method; it is only used by an explicit
   * per-item Repair button after the current snapshot confirms the problem.
   */
  async repairMissingStructureItem(
    projectLocator: ProjectLocator,
    path: string,
    field?: string,
  ): Promise<ProjectSnapshot> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const normalized = normalizePath(path);
    const issue = project.structureIssues.find(
      (candidate) =>
        candidate.path === normalized &&
        (field === undefined ? candidate.field === undefined : candidate.field === field) &&
        candidate.repairable,
    );
    if (issue === undefined) {
      throw new Error(`No repairable missing project item was found at "${normalized}".`);
    }

    if (issue.code === "missing-directory") {
      await this.repository.ensureFolder(normalized);
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "missing-system-template") {
      const layout = getProjectPathLayout(project.locale);
      const template = getSystemTemplates(project.locale).find(
        (candidate) =>
          normalizePath(
            `${project.rootPath}/${layout.directories.system}/${candidate.fileName}`,
          ) === normalized,
      );
      if (!template) {
        throw new Error(`No canonical system template was found for "${normalized}".`);
      }
      await this.repository.createManagedFile({
        path: normalized,
        template: template.template,
        frontmatter: systemTemplateFrontmatter(template, project),
      });
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "missing-base") {
      const layout = getProjectPathLayout(project.locale);
      const base = getProjectBases(project.id, project.locale).find(
        (candidate) =>
          normalizePath(
            `${project.rootPath}/${layout.directories[candidate.id]}/${candidate.fileName}`,
          ) === normalized,
      );
      if (!base) {
        throw new Error(`No canonical project base was found for "${normalized}".`);
      }
      await this.repository.createPlainFile(normalized, base.content);
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "mismatched-note-title") {
      // Frontmatter is the name the dashboard shows, so it wins; the heading and
      // file name are brought to it rather than the other way around.
      // safeFileName is lossy, so a file name cannot reconstruct a title.
      const record = await this.repository.readManaged(normalized);
      const title =
        asOptionalString(record.frontmatter[FRONTMATTER_KEYS.characterName]) ??
        asOptionalString(record.frontmatter[FRONTMATTER_KEYS.sceneTitle]);
      if (title === null) {
        throw new Error(`No stored name was found for "${normalized}".`);
      }
      await this.syncNoteHeading(normalized, title);
      const renamed = await this.renameManagedNote(normalized, title);
      if (documentTypeOf(record.frontmatter) === "character") {
        await this.refreshCharacterReferences(project, normalized, renamed, title);
      }
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "invalid-system-template") {
      const layout = getProjectPathLayout(project.locale);
      const template = getSystemTemplates(project.locale).find(
        (candidate) =>
          normalizePath(
            `${project.rootPath}/${layout.directories.system}/${candidate.fileName}`,
          ) === normalized,
      );
      if (!template) {
        throw new Error(`No canonical system template was found for "${normalized}".`);
      }
      await this.repository.replaceManagedFile(
        normalized,
        template.template,
        systemTemplateFrontmatter(template, project),
      );
      return this.loadProject(project.projectFile);
    }

    if (
      issue.code === "missing-metadata-field" ||
      issue.code === "invalid-metadata-field"
    ) {
      const projectRecord = await this.repository.readManaged(project.projectFile);
      const patch = await this.safeProjectMetadataRepairPatch(
        project,
        projectRecord,
        issue,
      );
      if (patch === null || Object.keys(patch).length === 0) {
        throw new Error(`The project metadata issue at "${normalized}" cannot be repaired safely.`);
      }
      await this.repository.updateFrontmatter(project.projectFile, patch);
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "dangling-scene-character") {
      // Only the entries whose notes are gone are dropped. The rest of the cast,
      // and every other field on the scene, is left exactly as the author wrote
      // it. A dangling point of view is deliberately not repaired here.
      const record = await this.repository.readManaged(normalized);
      const stored = record.frontmatter[FRONTMATTER_KEYS.sceneCharacters];
      const rawCharacters: unknown[] = Array.isArray(stored)
        ? (stored as unknown[])
        : typeof stored === "string"
          ? [stored]
          : [];
      const next = rawCharacters.filter(
        (entry) =>
          this.missingCharacterLink(asOptionalString(entry), normalized) === null,
      );
      if (next.length === rawCharacters.length) {
        throw new Error(`No missing character link was found in "${normalized}".`);
      }
      await this.repository.updateFrontmatter(normalized, {
        [FRONTMATTER_KEYS.sceneCharacters]: next,
      });
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "invalid-artifact-metadata") {
      const patch = await this.safeArtifactMetadataRepairPatch(project, issue);
      if (patch === null || Object.keys(patch).length === 0) {
        throw new Error(`The note metadata issue at "${normalized}" cannot be repaired safely.`);
      }
      await this.repository.updateFrontmatter(normalized, patch);
      return this.loadProject(project.projectFile);
    }

    const artifact = getStoryArtifacts(project.locale).find(
      (candidate) =>
        normalizePath(`${project.rootPath}/${candidate.relativePath}`) === normalized,
    );
    if (artifact !== undefined) {
      await this.repository.createManagedFile({
        path: normalized,
        template: storyArtifactTemplate(artifact.step, project.locale),
        frontmatter: commonFrontmatter(artifact.document, project.id),
      });
      return this.loadProject(project.projectFile);
    }

    if (issue.expected === "draft") {
      // The reported path is wherever the stored link led, which need not be
      // anywhere this project would keep a draft, so the repair works from the
      // project rather than from that path. What it records along the way is of
      // no interest here: this repair reports itself by the issue it settles.
      await this.restoreDraft(project, {
        created: [],
        repaired: [],
        unchanged: [],
        conflicts: [],
        sectionResults: [],
      });
      return this.loadProject(project.projectFile);
    }

    throw new Error(`The missing project item at "${normalized}" cannot be repaired automatically.`);
  }

  private async safeProjectMetadataRepairPatch(
    project: ProjectRef,
    record: ManagedFileRecord,
    issue: ProjectStructureIssue,
  ): Promise<ManagedFrontmatter | null> {
    if (!issue.field) return null;
    const frontmatter = record.frontmatter;
    if (!schemaCanBeSafelyPatched(frontmatter)) return null;

    switch (issue.field) {
      case FRONTMATTER_KEYS.schema:
        return hasOwn(frontmatter, FRONTMATTER_KEYS.schema)
          ? null
          : { [FRONTMATTER_KEYS.schema]: SCHEMA_VERSION };
      case FRONTMATTER_KEYS.document:
        return { [FRONTMATTER_KEYS.document]: "project-metadata" };
      case FRONTMATTER_KEYS.projectId: {
        const recovered = await this.recoverProjectId(project.rootPath);
        return recovered === null
          ? null
          : { [FRONTMATTER_KEYS.projectId]: recovered };
      }
      case FRONTMATTER_KEYS.projectName:
        return { [FRONTMATTER_KEYS.projectName]: basename(project.rootPath) };
      case FRONTMATTER_KEYS.projectLanguage:
        return { [FRONTMATTER_KEYS.projectLanguage]: project.locale };
      case FRONTMATTER_KEYS.draft:
        return hasOwn(frontmatter, FRONTMATTER_KEYS.draft)
          ? null
          : { [FRONTMATTER_KEYS.draft]: "" };
      default:
        return null;
    }
  }

  private async safeArtifactMetadataRepairPatch(
    project: ProjectRef,
    issue: ProjectStructureIssue,
  ): Promise<ManagedFrontmatter | null> {
    const record = await this.repository.readManaged(issue.path);
    const expected = issue.expected;
    if (!expected || !isDocumentType(expected)) return null;

    if (expected !== "character" && expected !== "scene") {
      return safeCommonMetadataRepairPatch(record, expected, project.id);
    }

    const folder = parentOf(record.path);
    const usedIds = new Set<string>();
    const usedRanks = new Set<number>();
    for (const file of this.repository.listDirectFiles(folder)) {
      if (file.extension !== "md" || file.path === record.path) continue;
      const candidate = await this.repository.tryReadManaged(file.path);
      if (!candidate) continue;
      const id = normalizeStableId(
        candidate.frontmatter[
          expected === "character"
            ? FRONTMATTER_KEYS.characterId
            : FRONTMATTER_KEYS.sceneId
        ],
      );
      if (id) usedIds.add(id);
      const rank = candidate.frontmatter[FRONTMATTER_KEYS.rank];
      if (typeof rank === "number" && Number.isSafeInteger(rank)) usedRanks.add(rank);
    }

    return expected === "character"
      ? safeCharacterMetadataRepairPatch(record, project.id, usedIds, usedRanks)
      : safeSceneMetadataRepairPatch(record, project.id, usedIds, usedRanks);
  }

  async readManagedFrontmatter(path: string): Promise<ManagedFrontmatter> {
    return { ...(await this.repository.readManaged(path)).frontmatter };
  }

  async updateManagedFrontmatter(path: string, patch: ManagedFrontmatter): Promise<void> {
    const record = await this.repository.readManaged(path);
    if (
      record.schemaVersion == null ||
      documentTypeOf(record.frontmatter) == null ||
      projectIdOf(record.frontmatter) == null
    ) {
      throw new InvalidManagedDocumentError(`"${record.path}" is not a managed Snowflake note.`, record.path);
    }
    await this.repository.updateFrontmatter(path, patch);
  }

  async updateProjectFrontmatter(
    projectLocator: ProjectLocator,
    patch: ProjectFrontmatterPatch | ManagedFrontmatter,
  ): Promise<void> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const normalized = isProjectPatch(patch) ? encodeProjectPatch(project, patch) : patch;
    await this.repository.updateFrontmatter(project.projectFile, normalized);
  }

  async updateStepStatus(
    projectLocator: ProjectLocator,
    step: StepId,
    status: StepStatus,
  ): Promise<void> {
    assertStepStatus(step, status);
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const reviewedContext = reviewContextFingerprint(step, project.currentFingerprints);
    await this.repository.updateFrontmatterAtomic(project.projectFile, (frontmatter) => {
      const steps = readStepStatuses(frontmatter[FRONTMATTER_KEYS.stepStatuses]);
      const nextSteps = setStepStatus(steps, step, status);
      const reviewed = readFingerprints(frontmatter[FRONTMATTER_KEYS.reviewedFingerprints]);
      const actualStatus = nextSteps[step];
      if (actualStatus === "not-started") delete reviewed[step];
      else if (actualStatus === "complete" || actualStatus === "skipped") {
        reviewed[step] = reviewedContext;
      }
      for (const candidate of STEP_IDS) {
        if (steps[candidate] !== nextSteps[candidate] && nextSteps[candidate] === "not-started") {
          delete reviewed[candidate];
        }
      }
      return {
        [FRONTMATTER_KEYS.stepStatuses]: nextSteps,
        [FRONTMATTER_KEYS.reviewedFingerprints]: reviewed,
      };
    });
  }

  async createCharacter(
    projectLocator: ProjectLocator,
    inputOrName: CharacterInput | string,
    characterType: CharacterType = "major",
  ): Promise<CharacterRecord> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const input: CharacterInput =
      typeof inputOrName === "string" ? { name: inputOrName, type: characterType } : inputOrName;
    const name = input.name.trim();
    if (!name) throw new Error("Character name is required.");
    this.assertNameAvailable(
      "character",
      project.characters.map((candidate) => candidate.name),
      name,
    );
    const resolvedType = input.type ?? "major";
    if (!isCharacterType(resolvedType)) {
      throw new Error(`Unsupported character type: ${String(resolvedType)}`);
    }

    const characterId = createStableId("character");
    const characters = project.characters;
    const rank =
      characters.length === 0
        ? RANK_GAP
        : characters[characters.length - 1]!.rank + RANK_GAP;
    if (!Number.isSafeInteger(rank)) throw new RangeError("Cannot assign a safe character rank.");
    const layout = getProjectPathLayout(project.locale);
    const requested = normalizePath(
      `${project.rootPath}/${layout.directories.characters}/${safeFileName(name)}.md`,
    );
    const created = await this.repository.createManagedFile({
      path: requested,
      uniqueOnConflict: true,
      template: characterTemplate(name, project.locale, {
        oneParagraphStoryline: input.oneParagraphStoryline,
        characterSynopsis: input.characterSynopsis,
        characterProfile: input.characterProfile,
      }),
      frontmatter: {
        ...commonFrontmatter("character", project.id),
        [FRONTMATTER_KEYS.characterId]: characterId,
        [FRONTMATTER_KEYS.characterName]: name,
        [FRONTMATTER_KEYS.rank]: rank,
        [FRONTMATTER_KEYS.characterType]: resolvedType,
        [FRONTMATTER_KEYS.oneSentenceStoryline]: input.oneSentenceStoryline ?? "",
        [FRONTMATTER_KEYS.motivation]: input.motivation ?? "",
        [FRONTMATTER_KEYS.goal]: input.goal ?? "",
        [FRONTMATTER_KEYS.conflict]: input.conflict ?? "",
        [FRONTMATTER_KEYS.growth]: input.growth ?? "",
      },
    });
    return this.characterFromRecord(await this.repository.readManaged(created.path));
  }

  async listCharacters(projectLocator: ProjectLocator): Promise<CharacterRecord[]> {
    const project = await this.resolveProjectForRead(projectLocator);
    const records = await this.findManagedFilesInProjectDirectories(
      project,
      "characters",
      "character",
      project.id,
    );
    const characters: CharacterRecord[] = [];
    for (const record of records) {
      try {
        characters.push(this.characterFromRecord(record));
      } catch (error) {
        if (!(record.readOnly && error instanceof InvalidManagedDocumentError)) throw error;
      }
    }
    if (characters.every((character) => character.hasStoredRank)) {
      return [...characters].sort(compareCharactersByRank);
    }
    return [...characters]
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
      .map((character, index) => ({ ...character, rank: (index + 1) * RANK_GAP }));
  }

  async reorderCharacter(
    projectLocator: ProjectLocator,
    characterId: string,
    targetIndex: number,
  ): Promise<CharacterRecord[]> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    // moveScene orders by the shared rank contract; characters reach it by
    // presenting their own stable id as the ranked id.
    const ranked = project.characters.map((character) => ({
      ...character,
      sceneId: character.characterId,
    }));
    await this.persistReorderedRanks(
      ranked,
      moveScene(ranked, characterId, targetIndex),
    );
    return this.listCharacters(project);
  }

  async updateCharacter(
    projectLocator: ProjectLocator,
    characterId: string,
    patch: CharacterPatch,
  ): Promise<CharacterRecord> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const character = project.characters.find(
      (candidate) => candidate.characterId === characterId,
    );
    if (!character) throw new ManagedFileNotFoundError(`character:${characterId}`);
    if (character.readOnly) throw new UnsupportedSchemaError(character.path, SCHEMA_VERSION + 1, SCHEMA_VERSION);
    assertExpectedRevision(character.path, patch.expectedRevision, character.revision);
    // Before the write rather than beside the rename below: the rename is the
    // last thing this does, so a name refused there would already have saved
    // every other field of a form the author was told had failed.
    //
    // Keeping the name it already has is never taking one, so a character that
    // duplicates another from before this was refused is still free to have the
    // rest of its form edited -- it is only the taking that is stopped.
    const nextName = patch.name?.trim();
    if (
      nextName !== undefined &&
      nextName.length > 0 &&
      foldName(nextName) !== foldName(character.name)
    ) {
      this.assertNameAvailable(
        "character",
        project.characters
          .filter((candidate) => candidate.characterId !== characterId)
          .map((candidate) => candidate.name),
        nextName,
      );
    }

    const frontmatterPatch: ManagedFrontmatter = {};
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.characterName, patch.name?.trim());
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.characterType, patch.type);
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.oneSentenceStoryline, patch.oneSentenceStoryline);
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.motivation, patch.motivation);
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.goal, patch.goal);
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.conflict, patch.conflict);
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.growth, patch.growth);
    const sectionValues: Record<string, string> = {
      "one-paragraph-storyline":
        patch.oneParagraphStoryline ?? character.oneParagraphStoryline,
      "character-synopsis": patch.characterSynopsis ?? character.characterSynopsis,
      "character-profile": patch.characterProfile ?? character.characterProfile,
    };
    const rollbackValues: Record<string, string> = {
      "one-paragraph-storyline": character.oneParagraphStoryline,
      "character-synopsis": character.characterSynopsis,
      "character-profile": character.characterProfile,
    };
    await this.updateManagedForm(
      character.path,
      patch.expectedRevision,
      frontmatterPatch,
      sectionValues,
      rollbackValues,
    );

    let path = character.path;
    if (nextName !== undefined && nextName.length > 0 && nextName !== character.name) {
      await this.syncNoteHeading(path, nextName);
      path = await this.renameManagedNote(path, nextName);
      await this.refreshCharacterReferences(project, character.path, path, nextName);
    }
    return this.characterFromRecord(await this.repository.readManaged(path));
  }

  /**
   * Keeps the note file named after the title stored in frontmatter. Letting the
   * two drift is the most confusing thing a rename can do, because the dashboard
   * then shows one name and the file explorer another.
   */
  /**
   * Brings an existing note heading to the stored name. A note without one is
   * left as it is: the author may have removed it deliberately, and writing one
   * back would add content rather than correct it.
   */
  private async syncNoteHeading(path: string, title: string): Promise<void> {
    const record = await this.repository.readManaged(path);
    if (firstHeading(record.body) === null) return;
    await this.repository.updateFirstHeading(path, title);
  }

  private async renameManagedNote(path: string, title: string): Promise<string> {
    const current = normalizePath(path);
    const requested = normalizePath(`${parentOf(current)}/${safeFileName(title)}.md`);
    if (requested === current) return current;
    const destination = this.repository.get(requested)
      ? this.repository.resolveUniquePath(requested)
      : requested;
    return this.repository.renameFile(current, destination);
  }

  /**
   * Rewrites the links scenes store for a renamed character. Obsidian rewrites
   * the path inside a link but never its display text, so a scene would keep
   * presenting the previous name everywhere the raw link is rendered — the
   * Bases views among them.
   */
  /**
   * Drops a character from every scene cast that lists them. Called once the
   * note is gone, so a failure here leaves recoverable dangling links the health
   * check reports rather than a cast edited for a deletion that never happened.
   *
   * A scene's point of view is deliberately left alone: blanking it would leave
   * the scene invalid, and choosing the replacement is the author's call.
   */
  async removeCharacterFromScenes(
    projectLocator: ProjectLocator,
    characterPath: string,
  ): Promise<void> {
    const project = await this.loadProject(projectLocator);
    const records = await this.findManagedFilesInProjectDirectories(
      project,
      "scenes",
      "scene",
      project.id,
    );
    for (const record of records) {
      if (record.readOnly) continue;
      const stored = record.frontmatter[FRONTMATTER_KEYS.sceneCharacters];
      const rawCharacters: unknown[] = Array.isArray(stored)
        ? (stored as unknown[])
        : typeof stored === "string"
          ? [stored]
          : [];
      const next = rawCharacters.filter((entry) => {
        const target = fromWikiLink(asOptionalString(entry));
        return (
          target === null || !this.linkNames(target, characterPath, record.path)
        );
      });
      if (next.length === rawCharacters.length) continue;
      await this.repository.updateFrontmatter(record.path, {
        [FRONTMATTER_KEYS.sceneCharacters]: next,
      });
    }
  }

  /**
   * Where a stored link leads: the note's own path while the link resolves, and
   * the link's own target once it leads nowhere, so a report can name what
   * broke. Null only when nothing is stored.
   *
   * The two differ more often than they look. Obsidian owns the links this
   * plugin writes and rewrites them whenever a note or folder is renamed --
   * Rename project included -- in a form that carries no ".md" and may be
   * shortened to a bare file name. The stored text stops being a path the
   * moment anything is renamed, which is why it is resolved rather than read.
   */
  private linkedPath(stored: string | null, sourcePath: string): string | null {
    const target = fromWikiLink(stored);
    if (target === null || target.length === 0) return null;
    return this.repository.resolveLink(target, sourcePath)?.path ?? target;
  }

  /**
   * The target of a stored link that now leads nowhere, or null while it still
   * resolves. Existence is the whole test: a note that is present but has broken
   * metadata is a different issue, already reported against that note.
   */
  private missingLink(stored: string | null, sourcePath: string): string | null {
    const target = fromWikiLink(stored);
    if (target === null || target.length === 0) return null;
    return this.repository.resolveLink(target, sourcePath) === null
      ? target
      : null;
  }

  /**
   * The same test for a scene's cast, where a point-of-view mode may stand in
   * place of a link. A mode is not a link and never dangles.
   */
  private missingCharacterLink(
    stored: string | null,
    sourcePath: string,
  ): string | null {
    if (stored !== null && isScenePovMode(fromWikiLink(stored) ?? "")) {
      return null;
    }
    return this.missingLink(stored, sourcePath);
  }

  /**
   * Whether a stored link names one particular note. Asked when that note is
   * about to move or has just gone, which is exactly when resolving the link
   * cannot answer -- so the stored text has to be read the way Obsidian wrote
   * it: no ".md", and shortened to whatever tail of the path is unambiguous,
   * often the file name alone.
   *
   * While the note is still reachable there is nothing to guess: the link
   * either leads to it or leads somewhere else, and a link that leads somewhere
   * else does not name it however alike the two names look.
   */
  private linkNames(
    target: string,
    path: string,
    sourcePath: string,
  ): boolean {
    const wanted = normalizePath(path);
    const resolved = this.repository.resolveLink(target, sourcePath);
    if (resolved !== null) return resolved.path === wanted;
    const named = normalizePath(target);
    const stem = wanted.replace(/\.md$/u, "");
    return (
      named === wanted ||
      named === stem ||
      wanted.endsWith(`/${named}`) ||
      stem.endsWith(`/${named}`)
    );
  }

  private async refreshCharacterReferences(
    project: ProjectRef | ProjectSnapshot,
    previousPath: string,
    currentPath: string,
    name: string,
  ): Promise<void> {
    const records = await this.findManagedFilesInProjectDirectories(
      project,
      "scenes",
      "scene",
      project.id,
    );
    const link = toWikiLink(currentPath, name);
    // Either name reaches the same character: Obsidian repoints the links it
    // owns as the note moves, and leaves them naming where it was when a Vault
    // is set not to update links at all.
    const isRenamed = (stored: string | null, sourcePath: string): boolean =>
      stored !== null &&
      (this.linkNames(stored, previousPath, sourcePath) ||
        this.linkNames(stored, currentPath, sourcePath));

    for (const record of records) {
      if (record.readOnly) continue;
      const patch: ManagedFrontmatter = {};

      const storedPov = asOptionalString(record.frontmatter[FRONTMATTER_KEYS.pov]);
      if (
        storedPov !== null &&
        !isScenePovMode(storedPov) &&
        isRenamed(fromWikiLink(storedPov), record.path) &&
        storedPov !== link
      ) {
        patch[FRONTMATTER_KEYS.pov] = link;
      }

      const storedCharacters = record.frontmatter[FRONTMATTER_KEYS.sceneCharacters];
      const rawCharacters: unknown[] | null = Array.isArray(storedCharacters)
        ? (storedCharacters as unknown[])
        : typeof storedCharacters === "string"
          ? [storedCharacters]
          : null;
      if (rawCharacters !== null) {
        // Only the renamed entry is rebuilt; the remaining links already carry
        // the right display text for their own character.
        const next: unknown[] = rawCharacters.map((entry) => {
          const raw = asOptionalString(entry);
          return raw !== null && isRenamed(fromWikiLink(raw), record.path)
            ? link
            : entry;
        });
        if (fingerprint(next) !== fingerprint(rawCharacters)) {
          patch[FRONTMATTER_KEYS.sceneCharacters] = next;
        }
      }

      if (Object.keys(patch).length > 0) {
        await this.repository.updateFrontmatter(record.path, patch);
      }
    }
  }

  async createScene(
    projectLocator: ProjectLocator,
    inputOrTitle: SceneInput | string,
  ): Promise<SceneRecord> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const input: SceneInput = typeof inputOrTitle === "string" ? { title: inputOrTitle } : inputOrTitle;
    const title = input.title.trim();
    if (!title) throw new Error("Scene title is required.");
    this.assertNameAvailable(
      "scene",
      project.scenes.map((candidate) => candidate.title),
      title,
    );
    const scenes = project.scenes;
    const rank = scenes.length === 0 ? RANK_GAP : scenes[scenes.length - 1]!.rank + RANK_GAP;
    if (!Number.isSafeInteger(rank)) throw new RangeError("Cannot assign a safe scene rank.");
    const sceneId = createStableId("scene");
    const layout = getProjectPathLayout(project.locale);
    const characterNames = new Map(
      project.characters.map((character) => [character.path, character.name]),
    );
    const characterLink = (path: string): string =>
      toWikiLink(path, characterNames.get(path) ?? fileStem(path));
    const povValue = input.povPath === undefined ? SCENE_POV_OMNISCIENT : input.povPath;
    const requested = normalizePath(
      `${project.rootPath}/${layout.directories.scenes}/${safeFileName(title)}.md`,
    );
    const created = await this.repository.createManagedFile({
      path: requested,
      uniqueOnConflict: true,
      template: sceneTemplate(title, project.locale, {
        conflict: input.conflict,
        events: input.events,
        planning: input.planning,
      }),
      frontmatter: {
        ...commonFrontmatter("scene", project.id),
        [FRONTMATTER_KEYS.sceneId]: sceneId,
        [FRONTMATTER_KEYS.sceneTitle]: title,
        [FRONTMATTER_KEYS.rank]: rank,
        [FRONTMATTER_KEYS.pov]: povValue
          ? isScenePovMode(povValue)
            ? povValue
            : characterLink(povValue)
          : "",
        [FRONTMATTER_KEYS.sceneTime]: input.time ?? "",
        [FRONTMATTER_KEYS.sceneLocation]: input.location ?? "",
        [FRONTMATTER_KEYS.sceneCharacters]: (input.characters ?? []).map(characterLink),
      },
    });
    return this.sceneFromRecord(await this.repository.readManaged(created.path));
  }

  /**
   * Returns the path to one of the generated Bases views, writing it first when
   * it is missing. Opening therefore recovers a deleted base without waiting for
   * a health check, and a read-only project can still open one that exists.
   */
  async openProjectBase(
    projectLocator: ProjectLocator,
    id: ProjectBaseId,
  ): Promise<string> {
    const project = await this.resolveProjectForRead(projectLocator);
    const path = this.projectBasePath(project, id);
    if (this.repository.getFile(path) !== null) return path;

    this.assertProjectWritable(project);
    const base = this.projectBase(project, id);
    await this.repository.createPlainFile(path, base.content);
    return path;
  }

  private projectBase(
    project: ProjectRef | ProjectSnapshot,
    id: ProjectBaseId,
  ): ProjectBaseDefinition {
    const base = getProjectBases(project.id, project.locale).find(
      (candidate) => candidate.id === id,
    );
    if (!base) throw new Error(`Unknown project base: ${id}`);
    return base;
  }

  private projectBasePath(
    project: ProjectRef | ProjectSnapshot,
    id: ProjectBaseId,
  ): string {
    const layout = getProjectPathLayout(project.locale);
    return normalizePath(
      `${project.rootPath}/${layout.directories[id]}/${this.projectBase(project, id).fileName}`,
    );
  }

  async createSceneCanvas(projectLocator: ProjectLocator): Promise<string> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const layout = getProjectPathLayout(project.locale);
    const fileName = project.locale === "zh-CN" ? "场景看板.canvas" : "Scene Board.canvas";
    const requested = normalizePath(
      `${project.rootPath}/${layout.directories.scenes}/${fileName}`,
    );
    const file = await this.repository.createPlainFile(
      requested,
      '{"nodes":[],"edges":[]}',
      true,
    );
    return file.path;
  }

  async listScenes(projectLocator: ProjectLocator): Promise<SceneRecord[]> {
    const project = await this.resolveProjectForRead(projectLocator);
    const records = await this.findManagedFilesInProjectDirectories(
      project,
      "scenes",
      "scene",
      project.id,
    );
    const scenes: SceneRecord[] = [];
    for (const record of records) {
      try {
        scenes.push(this.sceneFromRecord(record));
      } catch (error) {
        if (!(record.readOnly && error instanceof InvalidManagedDocumentError)) throw error;
      }
    }
    return sortScenesByRank(scenes);
  }

  async updateScene(
    projectLocator: ProjectLocator,
    sceneId: string,
    patch: ScenePatch,
  ): Promise<SceneRecord> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const scene = project.scenes.find((candidate) => candidate.sceneId === sceneId);
    if (!scene) throw new ManagedFileNotFoundError(`scene:${sceneId}`);
    if (scene.readOnly) throw new UnsupportedSchemaError(scene.path, SCHEMA_VERSION + 1, SCHEMA_VERSION);
    assertExpectedRevision(scene.path, patch.expectedRevision, scene.revision);
    // Before the write, and skipped for a title the scene already has, for the
    // two reasons the character form gives.
    const nextTitle = patch.title?.trim();
    if (
      nextTitle !== undefined &&
      nextTitle.length > 0 &&
      foldName(nextTitle) !== foldName(scene.title)
    ) {
      this.assertNameAvailable(
        "scene",
        project.scenes
          .filter((candidate) => candidate.sceneId !== sceneId)
          .map((candidate) => candidate.title),
        nextTitle,
      );
    }
    const characterNames = new Map(
      project.characters.map((character) => [character.path, character.name]),
    );
    const characterLink = (path: string): string =>
      toWikiLink(path, characterNames.get(path) ?? fileStem(path));

    const frontmatterPatch: ManagedFrontmatter = {};
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.sceneTitle, patch.title?.trim());
    if (patch.povPath !== undefined) {
      frontmatterPatch[FRONTMATTER_KEYS.pov] = patch.povPath
        ? isScenePovMode(patch.povPath)
          ? patch.povPath
          : characterLink(patch.povPath)
        : "";
    }
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.sceneTime, patch.time);
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.sceneLocation, patch.location);
    if (patch.characters !== undefined) {
      frontmatterPatch[FRONTMATTER_KEYS.sceneCharacters] = patch.characters.map(characterLink);
    }
    const sectionValues: Record<string, string> = {
      "scene-conflict": patch.conflict ?? scene.conflict,
      "scene-events": patch.events ?? scene.events,
      "scene-planning": patch.planning ?? scene.planning,
    };
    const rollbackValues: Record<string, string> = {
      "scene-conflict": scene.conflict,
      "scene-events": scene.events,
      "scene-planning": scene.planning,
    };
    await this.updateManagedForm(
      scene.path,
      patch.expectedRevision,
      frontmatterPatch,
      sectionValues,
      rollbackValues,
    );

    // Nothing links to a scene, so renaming one needs no reference sweep.
    let path = scene.path;
    if (nextTitle !== undefined && nextTitle.length > 0 && nextTitle !== scene.title) {
      await this.syncNoteHeading(path, nextTitle);
      path = await this.renameManagedNote(path, nextTitle);
    }
    return this.sceneFromRecord(await this.repository.readManaged(path));
  }

  async reorderScene(
    projectLocator: ProjectLocator,
    sceneId: string,
    targetIndex: number,
  ): Promise<SceneRecord[]> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const current = project.scenes;
    await this.persistReorderedRanks(current, moveScene(current, sceneId, targetIndex));
    return this.listScenes(project);
  }

  /**
   * Writes back the ranks a reorder changed. A note that stored no usable rank
   * is always written even when its computed rank is unchanged: its in-memory
   * value was only the fallback, so skipping it would drop the new order on the
   * next load.
   */
  private async persistReorderedRanks(
    before: readonly { sceneId: string; path: string; rank: number; hasStoredRank: boolean }[],
    after: readonly { sceneId: string; path: string; rank: number }[],
  ): Promise<void> {
    const previous = new Map(
      before.map((item) => [item.sceneId, item] as const),
    );
    for (const item of after) {
      const stored = previous.get(item.sceneId);
      if (stored?.hasStoredRank === true && stored.rank === item.rank) continue;
      await this.repository.updateFrontmatter(item.path, {
        [FRONTMATTER_KEYS.rank]: item.rank,
      });
    }
  }

  async getArtifactPath(projectLocator: ProjectLocator, step: StepId): Promise<string | null> {
    const project = await this.resolveProjectForRead(projectLocator);
    if (step === 10) {
      if ("links" in project) return project.links.draft;
      return (await this.loadProject(project)).links.draft;
    }
    const documentType = STATIC_DOCUMENT_BY_STEP[step];
    if (!documentType) return null;
    const defaultArtifact = getStoryArtifacts(project.locale).find(
      (artifact) => artifact.step === step,
    );
    if (defaultArtifact) {
      const defaultPath = normalizePath(`${project.rootPath}/${defaultArtifact.relativePath}`);
      const defaultRecord = await this.repository.tryReadManaged(defaultPath);
      if (
        defaultRecord &&
        documentTypeOf(defaultRecord.frontmatter) === documentType &&
        projectIdOf(defaultRecord.frontmatter) === project.id
      ) {
        return defaultRecord.path;
      }
    }
    const records = await this.findManagedFilesInProjectDirectories(
      project,
      documentType === "one-sentence-summary" || documentType === "one-paragraph-summary"
        ? "summaries"
        : "synopses",
      documentType,
      project.id,
    );
    return records.sort((left, right) => left.path.localeCompare(right.path, "en"))[0]?.path ?? null;
  }

  async loadArtifact(
    projectLocator: ProjectLocator,
    step: StepId,
  ): Promise<ArtifactSnapshot | null> {
    const path = await this.getArtifactPath(projectLocator, step);
    if (!path) return null;
    const file = this.repository.getFile(path);
    if (!file) return null;
    if (step === 10) {
      const content = await this.repository.vault.read(file);
      const managed = await this.repository.tryReadManaged(path);
      return {
        path,
        content,
        revision: fingerprint(content),
        frontmatter: managed?.frontmatter ?? {},
        readOnly: managed?.readOnly ?? false,
      };
    }
    const record = await this.repository.readManaged(path);
    return {
      path: record.path,
      content: record.content,
      revision: fingerprint(record.content),
      frontmatter: record.frontmatter,
      readOnly: record.readOnly,
    };
  }

  async updateSection(path: string, sectionId: string, value: string): Promise<void> {
    await this.repository.updateSection(path, sectionId, value);
  }

  async updateSections(
    path: string,
    values: Readonly<Record<string, string>>,
    expectedRevision: string,
  ): Promise<void> {
    await this.repository.updateSections(path, values, expectedRevision);
  }

  private async recoverProjectId(rootPath: string): Promise<string | null> {
    const counts = new Map<string, number>();
    const folders = new Set(
      Object.values(PROJECT_PATH_LAYOUTS).flatMap((layout) =>
        Object.values(layout.directories),
      ),
    );
    for (const folder of folders) {
      const folderPath = normalizePath(`${rootPath}/${folder}`);
      for (const file of this.repository.listDirectFiles(folderPath)) {
        if (file.extension !== "md") continue;
        const record = await this.repository.tryReadManaged(file.path);
        if (!record || record.readOnly || !isProjectDocumentType(documentTypeOf(record.frontmatter))) {
          continue;
        }
        const candidate = normalizeStableId(record.frontmatter[FRONTMATTER_KEYS.projectId]);
        if (candidate) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      }
    }
    const ranked = [...counts.entries()].sort(
      ([leftId, leftCount], [rightId, rightCount]) =>
        rightCount - leftCount || leftId.localeCompare(rightId, "en"),
    );
    const first = ranked[0];
    const second = ranked[1];
    if (!first || (second && second[1] === first[1])) return null;
    return first[0];
  }

  private async findManagedFilesInProjectDirectories(
    project: ProjectRef,
    directory: ProjectDirectoryKey,
    documentType: DocumentType | undefined,
    projectId: string,
  ): Promise<ManagedFileRecord[]> {
    const records = new Map<string, ManagedFileRecord>();
    for (const folderName of this.getProjectDirectoryNames(project, directory)) {
      const folderRecords = await this.repository.findManagedFiles(
        normalizePath(`${project.rootPath}/${folderName}`),
        documentType,
        projectId,
      );
      for (const record of folderRecords) records.set(record.path, record);
    }
    return [...records.values()];
  }

  private getProjectDirectoryNames(
    project: ProjectRef,
    directory: ProjectDirectoryKey,
  ): string[] {
    const primary = getProjectPathLayout(project.locale).directories[directory];
    return [
      ...new Set([
        primary,
        ...Object.values(PROJECT_PATH_LAYOUTS).map(
          (layout) => layout.directories[directory],
        ),
      ]),
    ];
  }

  private async repairFolderOwnership(
    folderPath: string,
    documentTypes: ReadonlySet<DocumentType>,
    projectId: string,
    result: Omit<RepairResult, "project">,
  ): Promise<void> {
    for (const file of this.repository.listDirectFiles(folderPath)) {
      if (file.extension !== "md") continue;
      const record = await this.repository.tryReadManaged(file.path);
      if (!record) continue;
      const documentType = documentTypeOf(record.frontmatter);
      if (!documentType || !documentTypes.has(documentType as DocumentType)) continue;

      const candidateProjectId = normalizeStableId(
        record.frontmatter[FRONTMATTER_KEYS.projectId],
      );
      if (candidateProjectId !== null && candidateProjectId !== projectId) continue;
      if (record.readOnly) {
        markConflict(
          result,
          record.path,
          `The note uses unsupported Snowflake schema ${String(record.schemaVersion)}.`,
        );
        continue;
      }

      const patch: ManagedFrontmatter = {};
      if (!hasOwn(record.frontmatter, FRONTMATTER_KEYS.schema)) {
        patch[FRONTMATTER_KEYS.schema] = SCHEMA_VERSION;
      }
      if (record.frontmatter[FRONTMATTER_KEYS.projectId] !== projectId) {
        patch[FRONTMATTER_KEYS.projectId] = projectId;
      }
      if (Object.keys(patch).length > 0) {
        await this.repository.updateFrontmatter(record.path, patch);
        markRepaired(result, record.path);
      }
    }
  }

  private repairCharacterMetadata(
    record: ManagedFileRecord,
    usedIds: Set<string>,
    usedRanks: Set<number>,
  ): { patch: ManagedFrontmatter; name: string } {
    const patch: ManagedFrontmatter = {};
    const name =
      asOptionalString(record.frontmatter[FRONTMATTER_KEYS.characterName]) ??
      fileStem(record.path);
    if (record.readOnly) return { patch, name };

    let characterId = normalizeStableId(record.frontmatter[FRONTMATTER_KEYS.characterId]);
    if (!characterId || usedIds.has(characterId)) characterId = createUniqueStableId("character", usedIds);
    usedIds.add(characterId);
    if (record.frontmatter[FRONTMATTER_KEYS.characterId] !== characterId) {
      patch[FRONTMATTER_KEYS.characterId] = characterId;
    }
    if (record.frontmatter[FRONTMATTER_KEYS.characterName] !== name) {
      patch[FRONTMATTER_KEYS.characterName] = name;
    }
    const rawRank = record.frontmatter[FRONTMATTER_KEYS.rank];
    const rank =
      typeof rawRank === "number" && Number.isSafeInteger(rawRank) && !usedRanks.has(rawRank)
        ? rawRank
        : nextRepairRank(usedRanks);
    usedRanks.add(rank);
    if (rawRank !== rank) patch[FRONTMATTER_KEYS.rank] = rank;
    const rawCharacterType = record.frontmatter[FRONTMATTER_KEYS.characterType];
    if (!isCharacterType(rawCharacterType)) {
      patch[FRONTMATTER_KEYS.characterType] = "supporting";
    }
    for (const key of [
      FRONTMATTER_KEYS.oneSentenceStoryline,
      FRONTMATTER_KEYS.motivation,
      FRONTMATTER_KEYS.goal,
      FRONTMATTER_KEYS.conflict,
      FRONTMATTER_KEYS.growth,
    ]) {
      if (typeof record.frontmatter[key] !== "string") patch[key] = "";
    }
    return { patch, name };
  }

  private repairSceneMetadata(
    record: ManagedFileRecord,
    usedIds: Set<string>,
    usedRanks: Set<number>,
  ): { patch: ManagedFrontmatter; title: string } {
    const patch: ManagedFrontmatter = {};
    const title =
      asOptionalString(record.frontmatter[FRONTMATTER_KEYS.sceneTitle]) ?? fileStem(record.path);
    if (record.readOnly) return { patch, title };

    let sceneId = normalizeStableId(record.frontmatter[FRONTMATTER_KEYS.sceneId]);
    if (!sceneId || usedIds.has(sceneId)) sceneId = createUniqueStableId("scene", usedIds);
    usedIds.add(sceneId);
    if (record.frontmatter[FRONTMATTER_KEYS.sceneId] !== sceneId) {
      patch[FRONTMATTER_KEYS.sceneId] = sceneId;
    }
    if (record.frontmatter[FRONTMATTER_KEYS.sceneTitle] !== title) {
      patch[FRONTMATTER_KEYS.sceneTitle] = title;
    }

    const rawRank = record.frontmatter[FRONTMATTER_KEYS.rank];
    const rank =
      typeof rawRank === "number" && Number.isSafeInteger(rawRank) && !usedRanks.has(rawRank)
        ? rawRank
        : nextRepairRank(usedRanks);
    usedRanks.add(rank);
    if (rawRank !== rank) patch[FRONTMATTER_KEYS.rank] = rank;

    const rawPov = record.frontmatter[FRONTMATTER_KEYS.pov];
    const povPath = fromWikiLink(asOptionalString(rawPov));
    const povLink = povPath
      ? isScenePovMode(povPath)
        ? povPath
        : toWikiLink(povPath, fileStem(povPath))
      : "";
    if (rawPov !== povLink) patch[FRONTMATTER_KEYS.pov] = povLink;
    const rawCharacters = record.frontmatter[FRONTMATTER_KEYS.sceneCharacters];
    const characterLinks = readWikiLinkList(rawCharacters).map((path) =>
      toWikiLink(path, fileStem(path)),
    );
    if (JSON.stringify(rawCharacters) !== JSON.stringify(characterLinks)) {
      patch[FRONTMATTER_KEYS.sceneCharacters] = characterLinks;
    }
    for (const key of [
      FRONTMATTER_KEYS.sceneTime,
      FRONTMATTER_KEYS.sceneLocation,
    ]) {
      if (typeof record.frontmatter[key] !== "string") patch[key] = "";
    }
    return { patch, title };
  }

  private async ensureArtifact(
    project: ProjectRef,
    documentType: DocumentType,
    relativePath: string,
    template: MarkdownTemplate,
    result: Omit<RepairResult, "project">,
  ): Promise<string> {
    const parent = parentOf(normalizePath(`${project.rootPath}/${relativePath}`));
    const existing = await this.repository.findManagedFiles(parent, documentType, project.id);
    const target = existing[0]?.path ?? normalizePath(`${project.rootPath}/${relativePath}`);
    try {
      const ensured = await this.repository.ensureManagedFile({
        path: target,
        template,
        frontmatter: commonFrontmatter(documentType, project.id),
        uniqueOnConflict: true,
      });
      const sectionCheck = await this.repository.checkSections(ensured.path, template.sections);
      recordSectionCheckResults(result, ensured.path, sectionCheck);
      if (ensured.created) markCreated(result, ensured.path);
      else if (ensured.frontmatterRepaired) {
        markRepaired(result, ensured.path);
      } else {
        markUnchanged(result, ensured.path);
      }
      for (const conflict of sectionCheck.conflicts) {
        markConflict(result, ensured.path, conflict.reason);
      }
      return ensured.path;
    } catch (error) {
      if (error instanceof PathConflictError || error instanceof UnsupportedSchemaError) {
        markConflict(result, error.path, error.message);
        return target;
      }
      if (error instanceof InvalidManagedDocumentError) {
        markConflict(result, error.path ?? target, error.message);
        return target;
      }
      throw error;
    }
  }

  private async checkDocumentSections(
    record: ManagedFileRecord,
    template: MarkdownTemplate,
    result: Omit<RepairResult, "project">,
  ): Promise<void> {
    if (record.readOnly) {
      markConflict(
        result,
        record.path,
        `The note uses unsupported Snowflake schema ${String(record.schemaVersion)}.`,
      );
      return;
    }
    const check = await this.repository.checkSections(record.path, template.sections);
    recordSectionCheckResults(result, record.path, check);
    markUnchanged(result, record.path);
    for (const conflict of check.conflicts) {
      markConflict(result, record.path, conflict.reason);
    }
  }

  private async resolveProjectRecord(locator: ProjectLocator): Promise<ManagedFileRecord> {
    const path = typeof locator === "string" ? locator : locator.projectFile;
    const normalized = normalizePath(path);
    const direct = this.repository.getFile(normalized);
    if (direct) {
      return this.repository.readManaged(direct.path);
    }
    const record = await this.findProjectRecord(normalized);
    if (record) return record;
    for (const layout of Object.values(PROJECT_PATH_LAYOUTS)) {
      const candidate = await this.repository.tryReadManaged(
        normalizePath(
          `${normalized}/${layout.directories.system}/${layout.projectFileName}`,
        ),
      );
      if (candidate) return candidate;
    }
    throw new ManagedFileNotFoundError(normalized);
  }

  private async resolveProjectForRead(
    locator: ProjectLocator,
  ): Promise<ProjectRef | ProjectSnapshot> {
    return typeof locator === "string" ? this.loadProject(locator) : locator;
  }

  private async findProjectRecord(rootPath: string): Promise<ManagedFileRecord | null> {
    const folders = Object.values(PROJECT_PATH_LAYOUTS).map((layout) =>
      normalizePath(`${rootPath}/${layout.directories.system}`),
    );
    for (const folder of new Set(folders)) {
      const records = await this.repository.findManagedFiles(folder, "project-metadata");
      if (records[0]) return records[0];
    }
    return null;
  }

  private async findRepairableProjectRecord(rootPath: string): Promise<ManagedFileRecord | null> {
    const folders = Object.values(PROJECT_PATH_LAYOUTS).map((layout) =>
      normalizePath(`${rootPath}/${layout.directories.system}`),
    );
    for (const folder of new Set(folders)) {
      for (const file of this.repository.listDirectFiles(folder)) {
        if (file.extension !== "md") continue;
        const record = await this.repository.tryReadManaged(file.path);
        if (record && documentTypeOf(record.frontmatter) === "project-metadata") {
          return record;
        }
      }
    }
    return null;
  }

  private toProjectRef(record: ManagedFileRecord, rootPath: string): ProjectRef {
    const id = projectIdOf(record.frontmatter);
    if (!id) throw new InvalidManagedDocumentError(`Project id is missing in "${record.path}".`, record.path);
    const localeValue = record.frontmatter[FRONTMATTER_KEYS.projectLanguage];
    const locale: ProjectLanguage = isProjectLanguage(localeValue) ? localeValue : "en";
    return {
      projectFile: record.path,
      rootPath,
      id,
      title:
        asOptionalString(record.frontmatter[FRONTMATTER_KEYS.projectName]) ?? basename(rootPath),
      locale,
      readOnly: record.readOnly,
    };
  }

  private async toInspectableProjectRef(
    record: ManagedFileRecord,
    rootPath: string,
  ): Promise<ProjectRef> {
    const recoveredId =
      projectIdOf(record.frontmatter) ??
      (await this.recoverProjectId(rootPath)) ??
      `damaged-${fingerprint(rootPath)}`;
    const rawLocale = record.frontmatter[FRONTMATTER_KEYS.projectLanguage];
    const locale: ProjectLanguage = isProjectLanguage(rawLocale)
      ? rawLocale
      : record.path.endsWith(`/${PROJECT_PATH_LAYOUTS["zh-CN"].projectFileName}`) ||
          record.path.includes(`/${PROJECT_PATH_LAYOUTS["zh-CN"].directories.system}/`)
        ? "zh-CN"
        : "en";
    return {
      projectFile: record.path,
      rootPath,
      id: recoveredId,
      title:
        asOptionalString(record.frontmatter[FRONTMATTER_KEYS.projectName]) ??
        basename(rootPath),
      locale,
      readOnly: record.readOnly,
    };
  }

  private async inspectProjectStructure(
    project: ProjectRef,
    projectRecord: ManagedFileRecord,
    draftPath: string | null,
  ): Promise<ProjectStructureIssue[]> {
    const issues: ProjectStructureIssue[] = [];
    if (
      projectRecord.schemaVersion !== null &&
      projectRecord.schemaVersion > SCHEMA_VERSION
    ) {
      return issues;
    }
    const add = (issue: ProjectStructureIssue): void => {
      if (
        !issues.some(
          (candidate) =>
            candidate.code === issue.code &&
            candidate.path === issue.path &&
            candidate.field === issue.field,
        )
      ) {
        issues.push(issue);
      }
    };
    const metadata = projectRecord.frontmatter;
    const expectedProjectId = projectIdOf(metadata);
    const recoveredProjectId =
      expectedProjectId === null ? await this.recoverProjectId(project.rootPath) : null;
    const hasMatchingProjectId = (frontmatter: ManagedFrontmatter): boolean => {
      const childProjectId = projectIdOf(frontmatter);
      return expectedProjectId === null
        ? childProjectId !== null
        : childProjectId === expectedProjectId;
    };
    const metadataChecks: ReadonlyArray<{
      field: string;
      valid: (value: unknown) => boolean;
    }> = [
      {
        field: FRONTMATTER_KEYS.schema,
        valid: (value) => {
          const numeric = typeof value === "number" ? value : Number(value);
          return Number.isInteger(numeric) && numeric >= SCHEMA_VERSION;
        },
      },
      { field: FRONTMATTER_KEYS.document, valid: (value) => value === "project-metadata" },
      {
        field: FRONTMATTER_KEYS.projectId,
        valid: (value) => typeof value === "string" && value.trim().length > 0,
      },
      {
        field: FRONTMATTER_KEYS.projectName,
        valid: (value) => typeof value === "string" && value.trim().length > 0,
      },
      { field: FRONTMATTER_KEYS.projectLanguage, valid: isProjectLanguage },
      {
        field: FRONTMATTER_KEYS.stepStatuses,
        valid: isStepStatusRecord,
      },
      {
        field: FRONTMATTER_KEYS.reviewedFingerprints,
        valid: isPlainRecord,
      },
      {
        field: FRONTMATTER_KEYS.draft,
        valid: (value) => typeof value === "string",
      },
    ];
    for (const check of metadataChecks) {
      const exists = hasOwn(metadata, check.field);
      if (exists && check.valid(metadata[check.field])) continue;
      add({
        code: exists ? "invalid-metadata-field" : "missing-metadata-field",
        path: projectRecord.path,
        stepIds: [],
        field: check.field,
        canOpen: true,
        repairable: isSafelyRepairableProjectMetadataIssue(
          exists ? "invalid-metadata-field" : "missing-metadata-field",
          check.field,
          metadata,
          recoveredProjectId,
        ),
      });
    }

    const layout = getProjectPathLayout(project.locale);
    const directorySteps: Readonly<
      Record<ProjectDirectoryKey, readonly StepId[]>
    > = {
      system: [],
      summaries: [1, 2],
      characters: [3, 5, 7],
      synopses: [4, 6],
      scenes: [8, 9],
      draft: [10],
      materials: [],
      archive: [],
    };
    for (const directory of PROJECT_DIRECTORY_KEYS) {
      const path = normalizePath(
        `${project.rootPath}/${layout.directories[directory]}`,
      );
      if (this.repository.getFolder(path) !== null) continue;
      add({
        code: "missing-directory",
        path,
        stepIds: [...directorySteps[directory]],
        canOpen: false,
        repairable: this.repository.get(path) === null,
      });
    }

    const systemFolder = normalizePath(
      `${project.rootPath}/${layout.directories.system}`,
    );
    if (this.repository.getFolder(systemFolder) !== null) {
      for (const systemTemplate of getSystemTemplates(project.locale)) {
        const path = normalizePath(`${systemFolder}/${systemTemplate.fileName}`);
        const file = this.repository.getFile(path);
        if (file === null) {
          add({
            code: "missing-system-template",
            path,
            stepIds: [],
            expected: systemTemplate.id,
            canOpen: false,
            repairable: this.repository.get(path) === null,
          });
          continue;
        }
        const record = await this.repository.tryReadManaged(path);
        const frontmatter = systemTemplateFrontmatter(systemTemplate, project);
        if (
          record === null ||
          !isCurrentSystemTemplate(record, systemTemplate, frontmatter)
        ) {
          add({
            code: "invalid-system-template",
            path,
            stepIds: [],
            expected: systemTemplate.id,
            canOpen: false,
            repairable: record === null || !record.readOnly,
          });
        }
      }
    }

    // Only absence is reported. A base that exists belongs to the author, and
    // Obsidian rewrites it whenever a column is resized.
    for (const base of getProjectBases(project.id, project.locale)) {
      const directory = normalizePath(
        `${project.rootPath}/${layout.directories[base.id]}`,
      );
      if (this.repository.getFolder(directory) === null) continue;
      const path = normalizePath(`${directory}/${base.fileName}`);
      if (this.repository.getFile(path) !== null) continue;
      add({
        code: "missing-base",
        path,
        stepIds: [...directorySteps[base.id]],
        expected: base.id,
        canOpen: false,
        repairable: this.repository.get(path) === null,
      });
    }

    for (const artifact of getStoryArtifacts(project.locale)) {
      const path = normalizePath(`${project.rootPath}/${artifact.relativePath}`);
      const file = this.repository.getFile(path);
      if (file === null) {
        add({
          code: "missing-artifact",
          path,
          stepIds: [artifact.step],
          expected: artifact.document,
          canOpen: false,
          repairable: this.repository.get(path) === null,
        });
        continue;
      }
      const record = await this.repository.readManaged(path);
      if (
        record.schemaVersion !== null &&
        record.schemaVersion > SCHEMA_VERSION
      ) {
        continue;
      }
      if (
        documentTypeOf(record.frontmatter) !== artifact.document ||
        !hasMatchingProjectId(record.frontmatter) ||
        !isCurrentOrNewerSchema(record.frontmatter)
      ) {
        add({
          code: "invalid-artifact-metadata",
          path,
          stepIds: [artifact.step],
          expected: artifact.document,
          canOpen: true,
          repairable:
            safeCommonMetadataRepairPatch(record, artifact.document, project.id) !== null,
        });
      }
    }

    const inspectCollection = async (
      directory: ProjectDirectoryKey,
      documentType: "character" | "scene",
      stepIds: StepId[],
    ): Promise<void> => {
      const folderPath = normalizePath(
        `${project.rootPath}/${layout.directories[directory]}`,
      );
      if (this.repository.getFolder(folderPath) === null) return;
      const stableIds = new Set<string>();
      const usedRanks = new Set<number>();
      for (const file of this.repository.listDirectFiles(folderPath)) {
        if (file.extension !== "md") continue;
        const record = await this.repository.readManaged(file.path);
        if (
          record.schemaVersion !== null &&
          record.schemaVersion > SCHEMA_VERSION
        ) {
          continue;
        }
        const looksManaged =
          documentTypeOf(record.frontmatter) === documentType ||
          record.content.includes(`snowflake:section:${
            documentType === "character" ? "character-profile" : "scene-conflict"
          }`);
        if (!looksManaged) continue;
        const stableId = asOptionalString(
          record.frontmatter[
            documentType === "character"
              ? FRONTMATTER_KEYS.characterId
              : FRONTMATTER_KEYS.sceneId
          ],
        );
        const idsBeforeCurrent = new Set(stableIds);
        const ranksBeforeCurrent = new Set(usedRanks);
        const stableIdIsUnique = stableId !== null && !stableIds.has(stableId);
        if (stableId !== null) stableIds.add(stableId);
        const rawRank = record.frontmatter[FRONTMATTER_KEYS.rank];
        if (typeof rawRank === "number" && Number.isSafeInteger(rawRank)) {
          usedRanks.add(rawRank);
        }
        const storedTitle = asOptionalString(
          record.frontmatter[
            documentType === "character"
              ? FRONTMATTER_KEYS.characterName
              : FRONTMATTER_KEYS.sceneTitle
          ],
        );
        if (storedTitle !== null) {
          const expectedStem = trySafeFileName(storedTitle);
          const heading = firstHeading(record.body);
          const fileNameDrifted =
            expectedStem !== null &&
            !stemMatchesTitle(fileStem(record.path), expectedStem);
          // An absent heading is left alone. The author may have removed it on
          // purpose, and repairing would add content rather than correct it.
          const headingDrifted =
            heading !== null && heading !== normalizeHeading(storedTitle);
          if (fileNameDrifted || headingDrifted) {
            add({
              code: "mismatched-note-title",
              path: record.path,
              stepIds,
              expected: storedTitle,
              canOpen: true,
              repairable: !record.readOnly,
            });
          }
        }

        // Deleting a character leaves the links scenes stored for it pointing at
        // nothing. Obsidian treats those as ordinary unresolved links and offers
        // to create the note, which would resurrect the character as an empty
        // stub, so the project has to notice the breakage itself.
        if (documentType === "scene") {
          const missingPov = this.missingCharacterLink(
            asOptionalString(record.frontmatter[FRONTMATTER_KEYS.pov]),
            record.path,
          );
          if (missingPov !== null) {
            add({
              code: "dangling-scene-pov",
              path: record.path,
              stepIds,
              expected: fileStem(missingPov),
              canOpen: true,
              // Which character now carries the scene is an authorial decision,
              // so there is no content-preserving fix to apply on their behalf.
              repairable: false,
            });
          }
          const missingCast = readWikiLinkList(
            record.frontmatter[FRONTMATTER_KEYS.sceneCharacters],
          ).filter(
            (path) => this.missingCharacterLink(path, record.path) !== null,
          );
          if (missingCast.length > 0) {
            add({
              code: "dangling-scene-character",
              path: record.path,
              stepIds,
              expected: missingCast.map((path) => fileStem(path)).join(", "),
              canOpen: true,
              repairable: !record.readOnly,
            });
          }
        }

        const typeSpecificValid =
          documentType === "character"
            ? stableIdIsUnique &&
              asOptionalString(record.frontmatter[FRONTMATTER_KEYS.characterName]) !== null &&
              isCharacterType(record.frontmatter[FRONTMATTER_KEYS.characterType])
            : stableIdIsUnique &&
              asOptionalString(record.frontmatter[FRONTMATTER_KEYS.sceneTitle]) !== null &&
              typeof record.frontmatter[FRONTMATTER_KEYS.rank] === "number";
        if (
          isCurrentOrNewerSchema(record.frontmatter) &&
          documentTypeOf(record.frontmatter) === documentType &&
          hasMatchingProjectId(record.frontmatter) &&
          typeSpecificValid
        ) {
          continue;
        }
        add({
          code: "invalid-artifact-metadata",
          path: record.path,
          stepIds,
          expected: documentType,
          canOpen: true,
          repairable:
            documentType === "character"
              ? safeCharacterMetadataRepairPatch(
                  record,
                  project.id,
                  idsBeforeCurrent,
                  ranksBeforeCurrent,
                ) !== null
              : safeSceneMetadataRepairPatch(
                  record,
                  project.id,
                  idsBeforeCurrent,
                  ranksBeforeCurrent,
                ) !== null,
        });
      }
    };
    await inspectCollection("characters", "character", [3, 5, 7]);
    await inspectCollection("scenes", "scene", [8, 9]);

    const canonicalDraftPath = normalizePath(
      `${project.rootPath}/${layout.directories.draft}/${layout.draftFileName}`,
    );
    const effectiveDraftPath = draftPath ?? canonicalDraftPath;
    const draftFile = this.repository.getFile(effectiveDraftPath);
    if (draftFile === null) {
      add({
        code: "missing-artifact",
        path: effectiveDraftPath,
        stepIds: [10],
        expected: "draft",
        canOpen: false,
        // A draft can always be put back: it is written where this project
        // keeps its draft, beside anything already there, whatever the stored
        // link happened to say. Leaving the author no way out of a link that
        // leads nowhere would be the worse answer.
        repairable: true,
      });
    } else {
      const record = await this.repository.readManaged(draftFile.path);
      if (
        record.schemaVersion !== null &&
        record.schemaVersion > SCHEMA_VERSION
      ) {
        return issues.sort((left, right) =>
          left.path.localeCompare(right.path, "en", { numeric: true }),
        );
      }
      if (
        documentTypeOf(record.frontmatter) !== "draft" ||
        !hasMatchingProjectId(record.frontmatter) ||
        !isCurrentOrNewerSchema(record.frontmatter)
      ) {
        add({
          code: "invalid-artifact-metadata",
          path: draftFile.path,
          stepIds: [10],
          expected: "draft",
          canOpen: true,
          repairable:
            draftFile.path === canonicalDraftPath &&
            safeCommonMetadataRepairPatch(record, "draft", project.id) !== null,
        });
      }
    }

    return issues.sort((left, right) =>
      left.path.localeCompare(right.path, "en", { numeric: true }),
    );
  }

  private characterFromRecord(record: ManagedFileRecord): CharacterRecord {
    const characterId = asOptionalString(record.frontmatter[FRONTMATTER_KEYS.characterId]);
    const projectId = projectIdOf(record.frontmatter);
    if (!characterId || !projectId) {
      throw new InvalidManagedDocumentError(`Character metadata is incomplete in "${record.path}".`, record.path);
    }
    const characterTypeValue = record.frontmatter[FRONTMATTER_KEYS.characterType];
    const rank = storedRank(record.frontmatter);
    return {
      id: characterId,
      characterId,
      projectId,
      path: record.path,
      name:
        asOptionalString(record.frontmatter[FRONTMATTER_KEYS.characterName]) ?? fileStem(record.path),
      rank: rank ?? RANK_GAP,
      hasStoredRank: rank !== null,
      type: isCharacterType(characterTypeValue) ? characterTypeValue : "supporting",
      oneSentenceStoryline: asString(record.frontmatter[FRONTMATTER_KEYS.oneSentenceStoryline]),
      motivation: asString(record.frontmatter[FRONTMATTER_KEYS.motivation]),
      goal: asString(record.frontmatter[FRONTMATTER_KEYS.goal]),
      conflict: asString(record.frontmatter[FRONTMATTER_KEYS.conflict]),
      growth: asString(record.frontmatter[FRONTMATTER_KEYS.growth]),
      oneParagraphStoryline: readMarkedSection(record.content, "one-paragraph-storyline") ?? "",
      characterSynopsis: readMarkedSection(record.content, "character-synopsis") ?? "",
      characterProfile: readMarkedSection(record.content, "character-profile") ?? "",
      sectionHealth: inspectManagedDocumentSections(
        record.content,
        managedSectionsForDocument("character").map((section) => section.id),
        record.path,
      ),
      revision: fingerprint(record.content),
      readOnly: record.readOnly,
    };
  }

  private sceneFromRecord(record: ManagedFileRecord): SceneRecord {
    const sceneId = asOptionalString(record.frontmatter[FRONTMATTER_KEYS.sceneId]);
    const projectId = projectIdOf(record.frontmatter);
    if (!sceneId || !projectId) {
      throw new InvalidManagedDocumentError(`Scene metadata is incomplete in "${record.path}".`, record.path);
    }
    const rank = storedRank(record.frontmatter);
    // Every character a scene names is given as the note's own path, because
    // that is what the rest of the plugin holds a character by. A stored link
    // is not that path once Obsidian has rewritten it, and a scene whose cast
    // no longer matches the project's characters loses that cast the next time
    // its form is opened, so the links are followed here rather than copied.
    const storedPov = fromWikiLink(
      asOptionalString(record.frontmatter[FRONTMATTER_KEYS.pov]),
    );
    return {
      id: sceneId,
      sceneId,
      projectId,
      path: record.path,
      title: asOptionalString(record.frontmatter[FRONTMATTER_KEYS.sceneTitle]) ?? fileStem(record.path),
      rank: rank ?? RANK_GAP,
      hasStoredRank: rank !== null,
      povPath:
        storedPov === null || isScenePovMode(storedPov)
          ? storedPov
          : this.linkedPath(storedPov, record.path),
      time: asString(record.frontmatter[FRONTMATTER_KEYS.sceneTime]),
      location: asString(record.frontmatter[FRONTMATTER_KEYS.sceneLocation]),
      characters: readWikiLinkList(
        record.frontmatter[FRONTMATTER_KEYS.sceneCharacters],
      ).map((target) => this.linkedPath(target, record.path) ?? target),
      conflict: readMarkedSection(record.content, "scene-conflict") ?? "",
      events: readMarkedSection(record.content, "scene-events") ?? "",
      planning: readMarkedSection(record.content, "scene-planning") ?? "",
      sectionHealth: inspectManagedDocumentSections(
        record.content,
        managedSectionsForDocument("scene").map((section) => section.id),
        record.path,
      ),
      revision: fingerprint(record.content),
      readOnly: record.readOnly,
    };
  }

  private projectHasBlockingManagedSectionIssues(
    project: ProjectSnapshot,
  ): boolean {
    for (const step of [1, 2, 4, 6] as const) {
      const artifact = project.artifacts[step];
      const documentType = STATIC_DOCUMENT_BY_STEP[step];
      if (artifact === undefined || documentType === undefined) continue;
      const expected = managedSectionsForDocument(documentType).map(
        (section) => section.id,
      );
      if (
        inspectManagedDocumentSections(
          artifact.content,
          expected,
          artifact.path,
        ).issues.some((issue) => issue.code !== "unknown-section")
      ) {
        return true;
      }
    }
    return (
      project.characters.some((character) =>
        character.sectionHealth.issues.some(
          (issue) => issue.code !== "unknown-section",
        ),
      ) ||
      project.scenes.some((scene) =>
        scene.sectionHealth.issues.some(
          (issue) => issue.code !== "unknown-section",
        ),
      )
    );
  }

  private async calculateProjectFingerprints(
    project: ProjectRef,
    draftPath: string | null,
  ): Promise<{
    fingerprints: StepFingerprintMap;
    hasUnsupportedChildren: boolean;
    characters: CharacterRecord[];
    scenes: SceneRecord[];
    artifacts: Partial<Record<StepId, ArtifactSnapshot>>;
  }> {
    const output: StepFingerprintMap = {};
    const artifacts: Partial<Record<StepId, ArtifactSnapshot>> = {};
    const storyArtifactRecords = [
      ...(await this.findManagedFilesInProjectDirectories(
        project,
        "summaries",
        undefined,
        project.id,
      )),
      ...(await this.findManagedFilesInProjectDirectories(
        project,
        "synopses",
        undefined,
        project.id,
      )),
    ];
    let hasUnsupportedChildren = storyArtifactRecords.some((record) => record.readOnly);
    for (const artifact of getStoryArtifacts(project.locale)) {
      const matchingRecords = storyArtifactRecords.filter(
        (candidate) => documentTypeOf(candidate.frontmatter) === artifact.document,
      );
      const canonicalPath = normalizePath(`${project.rootPath}/${artifact.relativePath}`);
      const record =
        matchingRecords.find((candidate) => candidate.path === canonicalPath) ??
        matchingRecords.sort((left, right) => left.path.localeCompare(right.path, "en"))[0];
      output[artifact.step] = fingerprint(record?.body ?? "");
      if (record) {
        artifacts[artifact.step] = {
          path: record.path,
          content: record.content,
          revision: fingerprint(record.content),
          frontmatter: record.frontmatter,
          readOnly: record.readOnly,
        };
      }
    }

    const characterRecords = await this.findManagedFilesInProjectDirectories(
      project,
      "characters",
      "character",
      project.id,
    );
    hasUnsupportedChildren ||= characterRecords.some((record) => record.readOnly);
    const characters: CharacterRecord[] = [];
    for (const record of characterRecords.filter((candidate) => !candidate.readOnly)) {
      try {
        const character = this.characterFromRecord(record);
        characters.push(character);
      } catch (error) {
        if (!(error instanceof InvalidManagedDocumentError)) throw error;
      }
    }
    characters.sort((left, right) => left.characterId.localeCompare(right.characterId, "en"));
    assertUniqueStableIds(
      characters,
      (character) => character.characterId,
      (character) => character.path,
      "character",
    );
    const opaqueCharacters = characterRecords
      .filter((record) => record.readOnly)
      .map((record) => ({ path: record.path, content: record.content }));
    const visibleCharacters = [...characters];
    for (const record of characterRecords.filter((candidate) => candidate.readOnly)) {
      try {
        visibleCharacters.push(this.characterFromRecord(record));
      } catch (error) {
        if (!(error instanceof InvalidManagedDocumentError)) throw error;
      }
    }
    visibleCharacters.sort(compareCharactersByRank);
    output[3] = fingerprint(
      [characters.map(({ characterId, name, type, oneSentenceStoryline, motivation, goal, conflict, growth, oneParagraphStoryline }) => ({
        characterId,
        name,
        type,
        oneSentenceStoryline,
        motivation,
        goal,
        conflict,
        growth,
        oneParagraphStoryline,
      })), opaqueCharacters],
    );
    output[5] = fingerprint([
      characters.map(({ characterId, characterSynopsis }) => ({ characterId, characterSynopsis })),
      opaqueCharacters,
    ]);
    output[7] = fingerprint([
      characters.map(({ characterId, characterProfile }) => ({ characterId, characterProfile })),
      opaqueCharacters,
    ]);

    const sceneRecords = await this.findManagedFilesInProjectDirectories(
      project,
      "scenes",
      "scene",
      project.id,
    );
    hasUnsupportedChildren ||= sceneRecords.some((record) => record.readOnly);
    const validScenes: SceneRecord[] = [];
    for (const record of sceneRecords.filter((candidate) => !candidate.readOnly)) {
      try {
        const scene = this.sceneFromRecord(record);
        validScenes.push(scene);
      } catch (error) {
        if (!(error instanceof InvalidManagedDocumentError)) throw error;
      }
    }
    const scenes = sortScenesByRank(validScenes);
    assertUniqueStableIds(
      scenes,
      (scene) => scene.sceneId,
      (scene) => scene.path,
      "scene",
    );
    const opaqueScenes = sceneRecords
      .filter((record) => record.readOnly)
      .map((record) => ({ path: record.path, content: record.content }));
    const visibleScenes = [...scenes];
    for (const record of sceneRecords.filter((candidate) => candidate.readOnly)) {
      try {
        visibleScenes.push(this.sceneFromRecord(record));
      } catch (error) {
        if (!(error instanceof InvalidManagedDocumentError)) throw error;
      }
    }
    output[8] = fingerprint(
      [scenes.map(({ sceneId, rank, title, povPath, time, location, characters, conflict, events }) => ({
        sceneId,
        rank,
        title,
        povPath,
        time,
        location,
        characters,
        conflict,
        events,
      })), opaqueScenes],
    );
    output[9] = fingerprint([
      scenes.map(({ sceneId, planning }) => ({ sceneId, planning })),
      opaqueScenes,
    ]);

    const draft = draftPath ? this.repository.getFile(draftPath) : null;
    const draftContent = draft ? await this.repository.vault.read(draft) : "";
    output[10] = fingerprint(draftContent);
    if (draft) {
      const managedDraft = await this.repository.tryReadManaged(draft.path);
      artifacts[10] = {
        path: draft.path,
        content: draftContent,
        revision: fingerprint(draftContent),
        frontmatter: managedDraft?.frontmatter ?? {},
        readOnly: managedDraft?.readOnly ?? false,
      };
      if (
        managedDraft?.readOnly === true &&
        projectIdOf(managedDraft.frontmatter) === project.id
      ) {
        hasUnsupportedChildren = true;
      }
    }
    return {
      fingerprints: output,
      hasUnsupportedChildren,
      characters: visibleCharacters,
      scenes: sortScenesByRank(visibleScenes),
      artifacts,
    };
  }

  private async updateManagedForm(
    path: string,
    expectedRevision: string,
    frontmatterPatch: ManagedFrontmatter,
    sectionValues: Readonly<Record<string, string>>,
    rollbackValues: Readonly<Record<string, string>>,
  ): Promise<void> {
    const hasSections = Object.keys(sectionValues).length > 0;
    const hasFrontmatter = Object.keys(frontmatterPatch).length > 0;

    if (!hasSections) {
      if (hasFrontmatter) await this.repository.updateFrontmatter(path, frontmatterPatch);
      return;
    }

    // Validate every requested section and apply all prose edits through one
    // Vault.process call before changing frontmatter. A damaged marker layout
    // therefore cannot leave the structured fields partially updated.
    await this.repository.updateSections(path, sectionValues, expectedRevision);
    if (!hasFrontmatter) return;

    const afterSections = await this.repository.readManaged(path);
    const afterSectionsRevision = fingerprint(afterSections.content);
    try {
      await this.repository.updateFrontmatter(path, frontmatterPatch);
    } catch (error) {
      // Best-effort rollback is conditional on the exact post-section revision.
      // If another writer won the race, updateSections throws rather than
      // overwriting that newer content.
      try {
        await this.repository.updateSections(
          path,
          rollbackValues,
          afterSectionsRevision,
        );
      } catch (rollbackError) {
        if (rollbackError instanceof ConcurrentChangeError) throw rollbackError;
      }
      throw error;
    }
  }

  private assertProjectWritable(project: ProjectRef): void {
    if (project.readOnly) throw new UnsupportedSchemaError(project.projectFile, SCHEMA_VERSION + 1, SCHEMA_VERSION);
  }

  /**
   * Refuses a name the project has already given out. Checked before anything is
   * written, so a rejected create leaves no note behind and a rejected rename
   * leaves the note it was asked about exactly as it was.
   *
   * Read-only characters and scenes hold their names too: the plugin cannot edit
   * them, but it still shows them, so a new one matching would be every bit as
   * ambiguous as a pair it could edit.
   */
  private assertNameAvailable(
    kind: NamedRecordKind,
    taken: readonly string[],
    name: string,
  ): void {
    if (!isNameTaken(taken, name)) return;
    throw new DuplicateNameError(kind, name);
  }
}

function schemaCanBeSafelyPatched(frontmatter: ManagedFrontmatter): boolean {
  return (
    !hasOwn(frontmatter, FRONTMATTER_KEYS.schema) ||
    schemaVersionOf(frontmatter) === SCHEMA_VERSION
  );
}

function isSafelyRepairableProjectMetadataIssue(
  code: ProjectStructureIssue["code"],
  field: string,
  frontmatter: ManagedFrontmatter,
  recoveredProjectId: string | null,
): boolean {
  if (!schemaCanBeSafelyPatched(frontmatter)) return false;
  switch (field) {
    case FRONTMATTER_KEYS.schema:
      return code === "missing-metadata-field";
    case FRONTMATTER_KEYS.document:
    case FRONTMATTER_KEYS.projectName:
    case FRONTMATTER_KEYS.projectLanguage:
      return true;
    case FRONTMATTER_KEYS.projectId:
      return recoveredProjectId !== null;
    case FRONTMATTER_KEYS.draft:
      return code === "missing-metadata-field";
    default:
      return false;
  }
}

function safeCommonMetadataRepairPatch(
  record: ManagedFileRecord,
  expectedDocument: DocumentType,
  expectedProjectId: string,
): ManagedFrontmatter | null {
  const frontmatter = record.frontmatter;
  if (!schemaCanBeSafelyPatched(frontmatter)) return null;

  const patch: ManagedFrontmatter = {};
  if (!hasOwn(frontmatter, FRONTMATTER_KEYS.schema)) {
    patch[FRONTMATTER_KEYS.schema] = SCHEMA_VERSION;
  }

  const documentType = documentTypeOf(frontmatter);
  if (documentType !== expectedDocument) {
    if (documentType !== null && isDocumentType(documentType)) return null;
    patch[FRONTMATTER_KEYS.document] = expectedDocument;
  }

  const projectId = projectIdOf(frontmatter);
  if (projectId !== expectedProjectId) {
    if (projectId !== null) return null;
    patch[FRONTMATTER_KEYS.projectId] = expectedProjectId;
  }
  return patch;
}

function safeCharacterMetadataRepairPatch(
  record: ManagedFileRecord,
  expectedProjectId: string,
  usedIds: Set<string>,
  usedRanks: Set<number>,
): ManagedFrontmatter | null {
  const patch = safeCommonMetadataRepairPatch(
    record,
    "character",
    expectedProjectId,
  );
  if (patch === null) return null;
  const frontmatter = record.frontmatter;

  // Character type is an authorial decision. Never guess or overwrite it.
  if (!isCharacterType(frontmatter[FRONTMATTER_KEYS.characterType])) return null;

  const rawId = normalizeStableId(frontmatter[FRONTMATTER_KEYS.characterId]);
  const characterId =
    rawId !== null && !usedIds.has(rawId)
      ? rawId
      : createUniqueStableId("character", usedIds);
  if (frontmatter[FRONTMATTER_KEYS.characterId] !== characterId) {
    patch[FRONTMATTER_KEYS.characterId] = characterId;
  }

  const name =
    asOptionalString(frontmatter[FRONTMATTER_KEYS.characterName]) ??
    fileStem(record.path);
  if (frontmatter[FRONTMATTER_KEYS.characterName] !== name) {
    patch[FRONTMATTER_KEYS.characterName] = name;
  }

  const rawRank = frontmatter[FRONTMATTER_KEYS.rank];
  const rank =
    typeof rawRank === "number" &&
    Number.isSafeInteger(rawRank) &&
    !usedRanks.has(rawRank)
      ? rawRank
      : nextRepairRank(usedRanks);
  if (rawRank !== rank) patch[FRONTMATTER_KEYS.rank] = rank;
  return patch;
}

function safeSceneMetadataRepairPatch(
  record: ManagedFileRecord,
  expectedProjectId: string,
  usedIds: Set<string>,
  usedRanks: Set<number>,
): ManagedFrontmatter | null {
  const patch = safeCommonMetadataRepairPatch(record, "scene", expectedProjectId);
  if (patch === null) return null;
  const frontmatter = record.frontmatter;

  const rawId = normalizeStableId(frontmatter[FRONTMATTER_KEYS.sceneId]);
  const sceneId =
    rawId !== null && !usedIds.has(rawId)
      ? rawId
      : createUniqueStableId("scene", usedIds);
  if (frontmatter[FRONTMATTER_KEYS.sceneId] !== sceneId) {
    patch[FRONTMATTER_KEYS.sceneId] = sceneId;
  }

  const title =
    asOptionalString(frontmatter[FRONTMATTER_KEYS.sceneTitle]) ??
    fileStem(record.path);
  if (frontmatter[FRONTMATTER_KEYS.sceneTitle] !== title) {
    patch[FRONTMATTER_KEYS.sceneTitle] = title;
  }

  const rawRank = frontmatter[FRONTMATTER_KEYS.rank];
  const rank =
    typeof rawRank === "number" &&
    Number.isSafeInteger(rawRank) &&
    !usedRanks.has(rawRank)
      ? rawRank
      : nextRepairRank(usedRanks);
  if (rawRank !== rank) patch[FRONTMATTER_KEYS.rank] = rank;
  return patch;
}

function projectFrontmatter(
  projectId: string,
  name: string,
  locale: ProjectLanguage,
): ManagedFrontmatter {
  return {
    ...commonFrontmatter("project-metadata", projectId),
    [FRONTMATTER_KEYS.projectName]: name,
    [FRONTMATTER_KEYS.projectLanguage]: locale,
    [FRONTMATTER_KEYS.stepStatuses]: createDefaultStepStatuses(),
    [FRONTMATTER_KEYS.reviewedFingerprints]: {},
    [FRONTMATTER_KEYS.draft]: "",
  };
}

function commonFrontmatter(documentType: DocumentType, projectId: string): ManagedFrontmatter {
  return {
    [FRONTMATTER_KEYS.schema]: SCHEMA_VERSION,
    [FRONTMATTER_KEYS.document]: documentType,
    [FRONTMATTER_KEYS.projectId]: projectId,
  };
}

function systemTemplateFrontmatter(
  template: SystemTemplateDefinition,
  project: ProjectRef,
): ManagedFrontmatter {
  const frontmatter = commonFrontmatter(template.documentType, project.id);
  if (template.id === "character") {
    return {
      ...frontmatter,
      [FRONTMATTER_KEYS.characterId]: `${project.id}-template-character`,
      [FRONTMATTER_KEYS.characterName]: project.locale === "zh-CN" ? "角色" : "Character",
      [FRONTMATTER_KEYS.rank]: RANK_GAP,
      [FRONTMATTER_KEYS.characterType]: "major",
      [FRONTMATTER_KEYS.oneSentenceStoryline]: "",
      [FRONTMATTER_KEYS.motivation]: "",
      [FRONTMATTER_KEYS.goal]: "",
      [FRONTMATTER_KEYS.conflict]: "",
      [FRONTMATTER_KEYS.growth]: "",
    };
  }
  if (template.id === "scene") {
    return {
      ...frontmatter,
      [FRONTMATTER_KEYS.sceneId]: `${project.id}-template-scene`,
      [FRONTMATTER_KEYS.sceneTitle]: project.locale === "zh-CN" ? "场景" : "Scene",
      [FRONTMATTER_KEYS.rank]: RANK_GAP,
      [FRONTMATTER_KEYS.pov]: SCENE_POV_OMNISCIENT,
      [FRONTMATTER_KEYS.sceneTime]: "",
      [FRONTMATTER_KEYS.sceneLocation]: "",
      [FRONTMATTER_KEYS.sceneCharacters]: [],
    };
  }
  return frontmatter;
}

function isCurrentSystemTemplate(
  record: ManagedFileRecord,
  template: SystemTemplateDefinition,
  expectedFrontmatter: ManagedFrontmatter,
): boolean {
  if (record.body !== template.template.body) return false;
  return Object.entries(expectedFrontmatter).every(
    ([key, value]) => fingerprint(record.frontmatter[key]) === fingerprint(value),
  );
}

function isCurrentOrNewerSchema(frontmatter: ManagedFrontmatter): boolean {
  const version = schemaVersionOf(frontmatter);
  return version !== null && version >= SCHEMA_VERSION;
}

/**
 * Decides one revision-reconcile pass. Pure so the same rules can be tried
 * against the loaded snapshot before touching the Vault, then re-applied to
 * the stored frontmatter inside the write.
 */
function reconcileRevisionFrontmatter(
  statuses: Readonly<StepStatusMap>,
  reviewedFingerprints: Readonly<StepFingerprintMap>,
  outdated: ReadonlySet<StepId>,
  currentFingerprints: Readonly<StepFingerprintMap>,
): { steps: StepStatusMap; reviewed: StepFingerprintMap; changed: boolean } {
  const steps = { ...statuses };
  const reviewed = { ...reviewedFingerprints };
  let changed = false;

  for (const step of STEP_IDS) {
    if (!outdated.has(step)) continue;

    if (step === 9 && steps[step] === "skipped") {
      const refreshed = reviewContextFingerprint(step, currentFingerprints);
      if (reviewed[step] !== refreshed) {
        reviewed[step] = refreshed;
        changed = true;
      }
      continue;
    }
    if (steps[step] !== "complete") continue;

    if (step === 10) {
      steps[step] = "not-started";
      delete reviewed[step];
    } else {
      steps[step] = "in-revision";
    }
    changed = true;
  }

  return { steps, reviewed, changed };
}

function readStepStatuses(value: unknown): StepStatusMap {
  const statuses = createDefaultStepStatuses();
  if (!isRecord(value)) return statuses;
  for (const step of STEP_IDS) {
    const candidate = value[String(step)];
    if (isStepStatus(candidate) && canSetStepStatus(step, candidate)) {
      statuses[step] = candidate;
    }
  }
  return enforceStepStatusDependencies(statuses);
}

function readFingerprints(value: unknown): StepFingerprintMap {
  const fingerprints: StepFingerprintMap = {};
  if (!isRecord(value)) return fingerprints;
  for (const step of STEP_IDS) {
    const candidate = value[String(step)];
    if (typeof candidate === "string") fingerprints[step] = candidate;
  }
  return fingerprints;
}

function readRepairFingerprints(value: unknown): StepFingerprintMap {
  const fingerprints = readFingerprints(value);
  for (const step of STEP_IDS) {
    const candidate = fingerprints[step];
    if (candidate !== undefined && !/^fp1-[0-9a-f]{16}$/u.test(candidate)) {
      delete fingerprints[step];
    }
  }
  return fingerprints;
}

function encodeProjectPatch(
  project: ProjectSnapshot,
  patch: ProjectFrontmatterPatch,
): ManagedFrontmatter {
  const encoded: ManagedFrontmatter = {};
  copyDefined(encoded, FRONTMATTER_KEYS.projectName, patch.title?.trim());
  copyDefined(encoded, FRONTMATTER_KEYS.projectLanguage, patch.locale);
  if (patch.steps) {
    const statuses = { ...project.steps };
    for (const [rawStep, status] of Object.entries(patch.steps)) {
      const step = Number(rawStep) as StepId;
      if (status !== undefined) {
        assertStepStatus(step, status);
        statuses[step] = status;
      }
    }
    for (const [rawStep, status] of Object.entries(patch.steps)) {
      const step = Number(rawStep) as StepId;
      if (
        status !== undefined &&
        (status === "complete" || (step === 9 && status === "skipped")) &&
        !areStepPrerequisitesComplete(statuses, step)
      ) {
        statuses[step] = "not-started";
      }
    }
    encoded[FRONTMATTER_KEYS.stepStatuses] = enforceStepStatusDependencies(statuses);
  }
  if (patch.draftPath !== undefined) {
    encoded[FRONTMATTER_KEYS.draft] = patch.draftPath
      ? toWikiLink(patch.draftPath)
      : "";
  }
  copyDefined(encoded, FRONTMATTER_KEYS.reviewedFingerprints, patch.reviewedFingerprints);
  return encoded;
}

function isProjectPatch(value: ProjectFrontmatterPatch | ManagedFrontmatter): value is ProjectFrontmatterPatch {
  return ["title", "locale", "steps", "draftPath", "reviewedFingerprints"].some(
    (key) => key in value,
  );
}

function copyDefined(target: ManagedFrontmatter, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

function assertUniqueStableIds<T>(
  records: readonly T[],
  idOf: (record: T) => string,
  pathOf: (record: T) => string,
  kind: "character" | "scene",
): void {
  const firstPathById = new Map<string, string>();
  for (const record of records) {
    const id = idOf(record);
    const path = pathOf(record);
    const firstPath = firstPathById.get(id);
    if (firstPath !== undefined) {
      throw new InvalidManagedDocumentError(
        `Duplicate ${kind} id "${id}" in "${firstPath}" and "${path}". Repair the project before editing.`,
        path,
      );
    }
    firstPathById.set(id, path);
  }
}

function assertExpectedRevision(
  path: string,
  expectedRevision: string,
  actualRevision: string,
): void {
  if (expectedRevision !== actualRevision) {
    throw new ConcurrentChangeError(path, expectedRevision, actualRevision);
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeStableId(value: unknown): string | null {
  return asOptionalString(value);
}

/** The note's own ordering value, or null when it stores none that is usable. */
function storedRank(frontmatter: ManagedFrontmatter): number | null {
  const value = frontmatter[FRONTMATTER_KEYS.rank];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function createUniqueStableId(prefix: string, used: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const candidate = createStableId(prefix);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Could not create a unique ${prefix} id.`);
}

function nextRepairRank(used: ReadonlySet<number>): number {
  for (let index = 1; index <= used.size + 1; index += 1) {
    const candidate = index * RANK_GAP;
    if (Number.isSafeInteger(candidate) && !used.has(candidate)) return candidate;
  }
  throw new RangeError("Could not assign a safe scene rank while repairing the project.");
}

function isProjectDocumentType(value: string | null): value is DocumentType {
  return (
    value === "one-sentence-summary" ||
    value === "one-paragraph-summary" ||
    value === "plot-synopsis" ||
    value === "long-synopsis" ||
    value === "character" ||
    value === "scene" ||
    value === "draft"
  );
}

function hasOwn(record: ManagedFrontmatter, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

type RepairAccumulator = Omit<RepairResult, "project">;

function markCreated(result: RepairAccumulator, path: string): void {
  removePath(result.repaired, path);
  removePath(result.unchanged, path);
  pushUnique(result.created, path);
}

function markRepaired(result: RepairAccumulator, path: string): void {
  if (result.created.includes(path)) return;
  removePath(result.unchanged, path);
  pushUnique(result.repaired, path);
}

function markUnchanged(result: RepairAccumulator, path: string): void {
  if (result.created.includes(path) || result.repaired.includes(path)) return;
  pushUnique(result.unchanged, path);
}

function markConflict(result: RepairAccumulator, path: string, reason: string): void {
  removePath(result.unchanged, path);
  if (!result.conflicts.some((conflict) => conflict.path === path && conflict.reason === reason)) {
    result.conflicts.push({ path, reason });
  }
}

function recordSectionCheckResults(
  result: RepairAccumulator,
  path: string,
  check: Awaited<ReturnType<VaultRepository["checkSections"]>>,
): void {
  for (const sectionId of check.unchanged) {
    upsertSectionResult(result, { path, sectionId, status: "unchanged" });
  }
  for (const conflict of check.conflicts) {
    upsertSectionResult(result, {
      path,
      sectionId: conflict.sectionId,
      status: "conflict",
      code: conflict.code,
      reason: conflict.reason,
      markerSectionId: conflict.markerSectionId,
      relatedSectionId: conflict.relatedSectionId,
    });
  }
}

function upsertSectionResult(
  result: RepairAccumulator,
  next: RepairAccumulator["sectionResults"][number],
): void {
  const index = result.sectionResults.findIndex(
    (candidate) =>
      candidate.path === next.path && candidate.sectionId === next.sectionId,
  );
  if (index === -1) result.sectionResults.push(next);
  else result.sectionResults[index] = next;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function removePath(values: string[], path: string): void {
  let index = values.indexOf(path);
  while (index !== -1) {
    values.splice(index, 1);
    index = values.indexOf(path);
  }
}

function compareCharactersByRank(
  left: CharacterRecord,
  right: CharacterRecord,
): number {
  const byRank = left.rank - right.rank;
  if (byRank !== 0) return byRank;
  return left.characterId.localeCompare(right.characterId, "en");
}

/**
 * Writes a link the way Obsidian writes one: the note's path without the ".md"
 * it would never show. Obsidian rewrites these links itself as notes move, so
 * matching its form is what keeps a stored link looking the same before and
 * after a rename instead of quietly changing shape on the first one.
 */
export function toWikiLink(path: string, alias?: string): string {
  const normalized = normalizePath(path.trim()).replace(/\.md$/u, "");
  if (!normalized) return "";
  const safeAlias = typeof alias === "string"
    ? alias.replace(/[|\]]/gu, "").trim()
    : "";
  return safeAlias ? `[[${normalized}|${safeAlias}]]` : `[[${normalized}]]`;
}

export function fromWikiLink(value: string | null): string | null {
  if (!value) return null;
  const match = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(value.trim());
  return normalizePath((match?.[1] ?? value).trim());
}

function readWikiLinkList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const paths = values
    .map((item) => asOptionalString(item))
    .map((item) => fromWikiLink(item))
    .filter((item): item is string => item !== null && item.length > 0);
  return [...new Set(paths)];
}

export function safeFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|#[\]^]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/\.+$/gu, "")
    .trim();
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("The name does not contain a safe file name.");
  }
  return normalized;
}

function createStableId(prefix: string): string {
  const uuid = typeof window === "undefined" ? undefined : window.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function projectRootForMetadataPath(path: string): string {
  const metadataFolder = parentOf(normalizePath(path));
  const isSystemFolder = Object.values(PROJECT_PATH_LAYOUTS).some(
    (layout) => basename(metadataFolder) === layout.directories.system,
  );
  return isSystemFolder ? parentOf(metadataFolder) : metadataFolder;
}

function relativeToRoot(path: string, rootPath: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(rootPath);
  const prefix = `${normalizedRoot}/`;
  if (!normalizedPath.startsWith(prefix)) {
    throw new Error(`"${normalizedPath}" is not inside "${normalizedRoot}".`);
  }
  return normalizedPath.slice(prefix.length);
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function normalizeHeading(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** The first level-one heading, matched exactly as updateFirstHeading writes it. */
function firstHeading(body: string): string | null {
  const match = /^#(?:[ \t]+)(.*)$/mu.exec(body);
  return match ? normalizeHeading(match[1] ?? "") : null;
}

function trySafeFileName(value: string): string | null {
  try {
    return safeFileName(value);
  } catch {
    return null;
  }
}

/**
 * A name whose note is already occupied — most often by something outside the
 * project sharing the folder — falls back to a numbered file, on creation and on
 * rename alike. Treating that as drift would report a defect on the only file
 * name that was available.
 */
function stemMatchesTitle(stem: string, expected: string): boolean {
  if (stem === expected) return true;
  if (!stem.startsWith(`${expected} (`) || !stem.endsWith(")")) return false;
  return /^\d+$/u.test(stem.slice(expected.length + 2, -1));
}

function fileStem(path: string): string {
  const name = basename(path);
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): boolean {
  return isRecord(value);
}

function isStepStatusRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return STEP_IDS.every((step) => isStepStatus(value[String(step)]));
}
