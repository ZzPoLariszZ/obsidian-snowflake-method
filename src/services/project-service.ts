import {
  normalizePath,
  type FileManager,
  type MetadataCache,
  type Vault,
} from "obsidian";

import {
  MIN_SUPPORTED_SCHEMA_VERSION,
  RANK_GAP,
  SCHEMA_VERSION,
  STEP_IDS,
  isWritableSchemaVersion,
  managedSectionsForDocument,
  optionalSectionIds,
  areStepPrerequisitesComplete,
  assertStepStatus,
  calculateContextNeedsReview,
  canSetStepStatus,
  createDefaultStepStatuses,
  enforceStepStatusDependencies,
  fileStem,
  findSequenceIssues,
  fingerprint,
  foldName,
  safeFileName,
  WORLDBUILDING_KIND_DEFINITIONS,
  isDocumentType,
  isCharacterType,
  isNameTaken,
  isProgressStatus,
  isProjectLanguage,
  isScenePovMode,
  isStepStatus,
  isTimeKind,
  isWorldbuildingKind,
  moveRanked,
  reviewContextFingerprint,
  setStepStatus,
  sortByRank,
  ALIASES_KEY,
  DEFINITION_FILE_IDS,
  DOCUMENT_TYPES,
  SCENE_POV_OMNISCIENT,
  WORLDBUILDING_KINDS,
  entityKindIds,
  kindIdFromFolderName,
  nextCustomKindPrefix,
  type CharacterType,
  type DefinitionFileId,
  type EntityKindId,
  type DocumentType,
  type ProgressStatus,
  type ProjectLanguage,
  type ProjectWorldbuildingKind,
  type StepFingerprintMap,
  type StepId,
  type StepStatus,
  type StepStatusMap,
  type TimeKind,
  type WorldbuildingKind,
  type WorldbuildingKindId,
} from "../domain";
import {
  MAX_DEFINITION_DEPTH,
  characterRoleFromCategories,
  characterRoleFromValue,
  characterRoleName,
  characterStarterNames,
  checkDefinitionPath,
  customFieldRootNameForFolder,
  definitionRootFromValue,
  definitionRootNameForFolder,
  isValidDefinitionSegment,
  nodeLink,
  nodeSelfPath,
  parseDefinitionValue,
  taxonomyPathFromTarget,
  taxonomyPathFromValue,
  type AppendPathResult,
  type RenamePathResult,
} from "./definition-files";
import {
  ConcurrentChangeError,
  InvalidManagedDocumentError,
  ManagedFileNotFoundError,
  PathConflictError,
  UnsafeSectionError,
  UnsupportedSchemaError,
  VaultRepository,
  documentTypeOf,
  isFrontmatterOrdered,
  projectIdOf,
  schemaVersionOf,
  type ManagedFileRecord,
  type ManagedFrontmatter,
} from "../repository";
import {
  BASE_EXCLUDED_COLUMN_KEYS,
  appendBaseColumns,
  baseColumnDisplayNames,
  characterTemplate,
  customFieldTemplateNote,
  definitionTemplate,
  getLegacyRoleRefreshes,
  getProjectBases,
  getStoryArtifacts,
  getSystemTemplates,
  draftTemplate,
  legacySceneConflictHeadings,
  storyArtifactTemplate,
  projectTemplate,
  inspectManagedDocumentSections,
  readMarkedSection,
  renameWorldbuildingBaseKind,
  templateNoteFields,
  type CustomField,
  renderCharacterFieldsBlock,
  renderDefinitionFieldsBlock,
  renderEntityFieldsBlock,
  renderSceneFieldsBlock,
  renderRecordSection,
  parseRecordSectionLenient,
  parseTerm,
  renderTerm,
  type RecordTerm,
  type SpanLookup,
  entityTemplate,
  type CharacterFieldsView,
  type EntityFieldsView,
  type RecordLine,
  type RecordSectionId,
  sceneTemplate,
  type ManagedSectionDefinition,
  type ManagedSectionsInspection,
  type ScenePovField,
  type SectionLayoutEntry,
  type MarkdownTemplate,
  type CharacterRoleLinks,
  type ProjectBaseDefinition,
  type ProjectBaseId,
  type SystemTemplateDefinition,
} from "../templates";
import {
  ManuscriptService,
  type ManuscriptSegmentRecord,
} from "./manuscript-service";
import {
  isMemberDocumentType,
  planFieldsBlockReconcile,
  type MemberDocumentType,
} from "./mirror-sync";
import {
  DEFAULT_PROJECT_ROOT,
  FRONTMATTER_KEYS,
  PROJECT_DIRECTORY_KEYS,
  PROJECT_PATH_LAYOUTS,
  entitiesOf,
  entityKindFolder,
  getProjectMetadataRelativePath,
  getProjectPathLayout,
  worldbuildingKindFolder,
  type KindScope,
  type ArtifactSnapshot,
  type CharacterInput,
  type CharacterPatch,
  type CharacterRecord,
  type CreateProjectOptions,
  type CustomFieldTemplateInfo,
  type DefinitionForest,
  type DefinitionNodeInfo,
  type DefinitionNodeUsage,
  type MemberUsage,
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
  type EntityInput,
  type EntityPatch,
  type WorldbuildingRecord,
} from "./types";

const STATIC_DOCUMENT_BY_STEP: Partial<Record<StepId, DocumentType>> = {
  1: "one-sentence-summary",
  2: "one-paragraph-summary",
  4: "plot-synopsis",
  6: "long-synopsis",
  10: "draft",
};

/**
 * The sequence a character note's properties read in: the stamp that says
 * whose note it is, then who the character is and what they are called, then
 * where they sit in the list and what they belong to, then the story fields,
 * with how far along they are last of all. The same order the dashboard table
 * and the generated base read, so the three agree wherever a character is
 * shown.
 *
 * Held on every write, not only at creation: a property a note gains later --
 * an alias added long after the character was made -- would otherwise settle
 * at the end, behind the story it should be reading in front of. Anything the
 * author added themselves follows, undisturbed.
 */
/**
 * And for a worldbuilding entry, whose own fields are the time it covers and
 * what it is: the kind sits with the identity, because it says which list the
 * note belongs to rather than anything about the thing itself.
 */
const ENTITY_FRONTMATTER_ORDER: readonly string[] = [
  FRONTMATTER_KEYS.schema,
  FRONTMATTER_KEYS.document,
  FRONTMATTER_KEYS.projectId,
  FRONTMATTER_KEYS.entityId,
  FRONTMATTER_KEYS.worldbuildingKind,
  FRONTMATTER_KEYS.name,
  ALIASES_KEY,
  FRONTMATTER_KEYS.rank,
  FRONTMATTER_KEYS.category,
  FRONTMATTER_KEYS.timeKind,
  FRONTMATTER_KEYS.timeStart,
  FRONTMATTER_KEYS.timeEnd,
  FRONTMATTER_KEYS.description,
  FRONTMATTER_KEYS.progressStatus,
];

/** The same sequence for a scene: what it is, then the story, then progress. */
const SCENE_FRONTMATTER_ORDER: readonly string[] = [
  FRONTMATTER_KEYS.schema,
  FRONTMATTER_KEYS.document,
  FRONTMATTER_KEYS.projectId,
  FRONTMATTER_KEYS.sceneId,
  FRONTMATTER_KEYS.sceneTitle,
  ALIASES_KEY,
  FRONTMATTER_KEYS.rank,
  FRONTMATTER_KEYS.category,
  FRONTMATTER_KEYS.pov,
  FRONTMATTER_KEYS.sceneTime,
  FRONTMATTER_KEYS.sceneLocation,
  FRONTMATTER_KEYS.sceneCharacters,
  FRONTMATTER_KEYS.conflict,
  FRONTMATTER_KEYS.progressStatus,
];

const CHARACTER_FRONTMATTER_ORDER: readonly string[] = [
  FRONTMATTER_KEYS.schema,
  FRONTMATTER_KEYS.document,
  FRONTMATTER_KEYS.projectId,
  FRONTMATTER_KEYS.characterId,
  FRONTMATTER_KEYS.characterName,
  ALIASES_KEY,
  FRONTMATTER_KEYS.rank,
  FRONTMATTER_KEYS.category,
  FRONTMATTER_KEYS.oneSentenceStoryline,
  FRONTMATTER_KEYS.motivation,
  FRONTMATTER_KEYS.goal,
  FRONTMATTER_KEYS.conflict,
  FRONTMATTER_KEYS.growth,
  FRONTMATTER_KEYS.progressStatus,
];

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

/**
 * What a duplicate name is a duplicate of: an entity kind id, or `project`
 * for a name two project folders would share. Open like the kind ids are.
 */
export type NamedRecordKind = EntityKindId;

/**
 * What making or renaming a kind came to: the kind as the project now lists
 * it, or the refusal to show — a name the file system will not hold, or one
 * already answering for a kind, built-in spellings included.
 */
export type KindMutationResult =
  | { ok: true; kind: ProjectWorldbuildingKind }
  | { ok: false; code: "invalid-name" | "taken" | "full" };

/**
 * What saving a custom-field template came to: the note as it now stands, or
 * the refusal to show — a name the file system will not hold, or one another
 * template of the kind already answers to.
 */
export type SaveCustomFieldTemplateResult =
  | { ok: true; path: string }
  | { ok: false; code: "invalid-name" | "taken" };

/** The template-type stamp a custom-field template note wears. */
const CUSTOM_FIELD_TEMPLATE_TYPE = "custom-field";

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
/** A health repair promised a kind registration the registry then refused. */
export class KindRegistrationRefusedError extends Error {
  constructor(public readonly kindId: string) {
    super(`The kind "${kindId}" cannot be registered.`);
    this.name = "KindRegistrationRefusedError";
  }
}

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
  /** The manuscript of whichever project is being asked about. See its class. */
  readonly manuscript: ManuscriptService;
  /**
   * Definition node folders this service is raising right now. Making a
   * folder is what tells the vault watcher a node exists, so without this
   * the watcher would answer the folder the plugin just made and write the
   * node file first, empty, while the pass that has the description is
   * still on its way to the same file.
   */
  private readonly ensuringDefinitionNodes = new Set<string>();

  constructor(
    vault: Vault,
    fileManager: FileManager,
    metadataCache: MetadataCache,
    readonly defaultRoot = DEFAULT_PROJECT_ROOT,
  ) {
    this.repository = new VaultRepository(vault, fileManager, metadataCache);
    this.manuscript = new ManuscriptService(this.repository);
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

  /**
   * The last snapshot of each project, kept while its files stand unchanged.
   *
   * Nearly everything the plugin does begins by loading the project, and at
   * three thousand scenes a load spends a third of a second mapping and
   * inspecting notes that have not moved since the last one. The digest is
   * the subtree as the vault already holds it in memory — every folder path,
   * and every file path with its modification time and size — so a write,
   * rename, deletion or new folder from anyone, the plugin included, reads
   * as a different project and rebuilds; until then the same snapshot
   * answers. Snapshots are shared, never edited, like the records they carry.
   */
  private readonly snapshots = new Map<
    string,
    { digest: string; snapshot: ProjectSnapshot }
  >();

  /**
   * Forgets every kept snapshot, so the next load rebuilds at full price.
   * The cost tests call it to measure that price; correctness never needs it.
   */
  forgetSnapshots(): void {
    this.snapshots.clear();
  }

  private projectTreeDigest(rootPath: string): string {
    let sum = 0;
    let xor = 0;
    let count = 0;
    const eat = (text: string): void => {
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      hash >>>= 0;
      sum = (sum + hash) >>> 0;
      xor = (xor ^ hash) >>> 0;
      count += 1;
    };
    const walkFolders = (path: string): void => {
      for (const folder of this.repository.listDirectFolders(path)) {
        eat(`${folder.path}/`);
        walkFolders(folder.path);
      }
    };
    walkFolders(rootPath);
    for (const file of this.repository.listFilesBelow(rootPath)) {
      eat(`${file.path}|${file.stat.mtime}|${file.stat.size}`);
    }
    return `${count}:${sum}:${xor}`;
  }

  async loadProject(locator: ProjectLocator): Promise<ProjectSnapshot> {
    const record = await this.resolveProjectRecord(locator);
    const rootPath = projectRootForMetadataPath(record.path);
    const digest = this.projectTreeDigest(rootPath);
    const cached = this.snapshots.get(rootPath);
    if (cached !== undefined && cached.digest === digest) {
      return cached.snapshot;
    }
    const project = await this.toInspectableProjectRef(record, rootPath);
    const steps = readStepStatuses(record.frontmatter[FRONTMATTER_KEYS.stepStatuses]);
    const links = {
      draft: this.linkedPath(
        asOptionalString(record.frontmatter[FRONTMATTER_KEYS.draft]),
        record.path,
        project.rootPath,
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
    links.draft = await this.settleManuscriptStart(
      project,
      links.draft,
      fingerprintCalculation.manuscript,
    );
    const structureIssues = await this.inspectProjectStructure(
      project,
      record,
      links.draft,
      fingerprintCalculation.manuscript,
      fingerprintCalculation.unregisteredKindNotes,
    );
    const snapshot: ProjectSnapshot = {
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
      worldbuilding: fingerprintCalculation.worldbuilding,
      artifacts: fingerprintCalculation.artifacts,
      structureIssues,
    };
    // A write can land while a snapshot is building, leaving it of neither
    // state: such a snapshot is served once and never cached.
    if (this.projectTreeDigest(rootPath) === digest) {
      this.snapshots.set(rootPath, { digest, snapshot });
    }
    return snapshot;
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

  /**
   * The frontmatter that would rewrite one note's links without the ".md"
   * Obsidian never writes, and the number of links that would change. Null when
   * none of them carry one, which is every note written since.
   *
   * Every key that holds a link is read, not the three the first release
   * happened to write: a scene names a time and a place, a period names its
   * ends, and every member carries its categories.
   */
  private extensionTidyPatch(
    record: ManagedFileRecord,
  ): { patch: ManagedFrontmatter; links: number } | null {
    if (record.readOnly) return null;
    const patch: ManagedFrontmatter = {};
    let links = 0;
    for (const field of STORED_LINK_FIELDS) {
      const stored = record.frontmatter[field.key];
      if (field.list) {
        const raw = storedList(stored);
        if (raw === null) continue;
        const next = raw.map((entry) => {
          const value = storedReference(field, entry);
          const tidied =
            value === null ? null : this.tidiedLink(value, record.path);
          if (tidied === null) return entry;
          links += 1;
          return tidied;
        });
        if (fingerprint(next) !== fingerprint(raw)) patch[field.key] = next;
        continue;
      }
      const tidied = this.tidiedLink(
        storedReference(field, stored),
        record.path,
      );
      if (tidied === null) continue;
      patch[field.key] = tidied;
      links += 1;
    }
    return links > 0 ? { patch, links } : null;
  }

  /**
   * The same link written the way Obsidian writes one, or null when it already
   * is -- or when dropping the extension would lead somewhere else, which no
   * tidying is worth.
   */
  private tidiedLink(stored: string | null, sourcePath: string): string | null {
    const target = fromWikiLink(stored);
    if (target === null || !target.endsWith(".md")) return null;
    if (isScenePovMode(target)) return null;
    const tidied = toWikiLink(target, wikiLinkAlias(stored ?? ""));
    const before = this.repository.resolveLink(target, sourcePath);
    const after = this.repository.resolveLink(
      fromWikiLink(tidied) ?? "",
      sourcePath,
    );
    if (before?.path !== after?.path) return null;
    return tidied === stored ? null : tidied;
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
    const commonFolders = [
      ...Object.values(layout.directories),
      ...project.worldbuildingKinds.map(
        (kind) => `${layout.directories.worldbuilding}/${kind.folderName}`,
      ),
    ].map((folder) => normalizePath(`${rootPath}/${folder}`));
    for (const folder of commonFolders) {
      const existed = this.repository.getFolder(folder) != null;
      await this.repository.ensureFolder(folder);
      if (existed) markUnchanged(result, folder);
      else markCreated(result, folder);
    }

    // Like the bases below, a tree root's existence is the contract: its
    // folders are the author's taxonomy, and the health checker is what
    // watches over the node files and the links pointing in. Every entity
    // kind carries its own set, in the folder its notes live in, plus the
    // fourth folder its custom-field templates call home.
    for (const kind of entityKindIds(project.worldbuildingKinds)) {
      const roots = [
        ...DEFINITION_FILE_IDS.map((definitionId) => ({
          path: definitionRootPath(project, kind, definitionId),
          ensure: () => this.ensureDefinitionRoot(project, kind, definitionId),
        })),
        {
          path: customFieldRootPath(project, kind),
          ensure: () =>
            this.repository.ensureFolder(customFieldRootPath(project, kind)),
        },
      ];
      for (const root of roots) {
        if (this.repository.getFolder(root.path) !== null) {
          markUnchanged(result, root.path);
        } else if (this.repository.get(root.path) !== null) {
          markConflict(result, root.path, `A file already exists at "${root.path}".`);
        } else {
          await root.ensure();
          markCreated(result, root.path);
        }
      }
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
        // 061 is a worldbuilding-typed template and lives here with the rest.
        "worldbuilding",
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
      worldbuilding: new Set(["worldbuilding"]),
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
    for (const base of getProjectBases(
      project.id,
      project.locale,
      characterRoleLinks(project),
      project.worldbuildingKinds,
    )) {
      const path = normalizePath(
        `${rootPath}/${projectBaseFolder(project, base.id)}/${base.fileName}`,
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

    const draftTarget = fromWikiLink(
      asOptionalString(projectRecord.frontmatter[FRONTMATTER_KEYS.draft]),
    );
    if (
      draftTarget === null ||
      draftTarget.length === 0 ||
      this.draftNotePath(draftTarget, projectRecord.path, project.rootPath) ===
        null
    ) {
      await this.restoreDraft(project, result);
    }

    return { project: await this.loadProject(project.projectFile), ...result };
  }

  /**
   * Keeps `snowflake-draft` naming the note the manuscript begins at.
   *
   * The field was written when step 10 was one note called Draft. A manuscript
   * is many notes now, and which of them comes first is decided by the stored
   * order rather than by a file name -- so an author is free to rename that
   * note, file it into a part folder, or delete it once other chapters exist.
   *
   * Nobody types this field, so it is kept true rather than reported: it is
   * quietly moved to whichever note the manuscript now begins with, whether the
   * one it named was deleted, renamed, or simply overtaken by a note written
   * before it.
   *
   * The one time it is left alone is a project whose manuscript is empty. What
   * it names then is the only trace of where the author's prose went, and the
   * repair reads it to bring that note home rather than writing a new one.
   */
  private async settleManuscriptStart(
    project: ProjectRef,
    draftPath: string | null,
    manuscript: readonly ManuscriptSegmentRecord[],
  ): Promise<string | null> {
    const opening = manuscript[0];
    if (opening === undefined || draftPath === opening.path) return draftPath;
    if (project.readOnly) return opening.path;
    await this.repository.updateFrontmatter(project.projectFile, {
      [FRONTMATTER_KEYS.draft]: toWikiLink(opening.path, fileStem(opening.path)),
    });
    return opening.path;
  }

  /**
   * Gives a project a manuscript to point at: the note it already begins with
   * when there is one, and a new first note when the manuscript is empty. Both
   * repairs go through here so a link that leads nowhere is mended the same way
   * whichever side asks for it -- in particular neither leaves a second draft
   * behind when the first one is still present.
   */
  private async restoreDraft(
    project: ProjectRef,
    result: Omit<RepairResult, "project">,
  ): Promise<string> {
    const layout = getProjectPathLayout(project.locale);
    // The manuscript knows its own first note, wherever it is filed and
    // whatever it is called. Only a manuscript with nothing in it needs one
    // written, and only then at the canonical name.
    // Read from the notes: this decides whether to write one, and the index
    // being a beat behind would be a beat in which a second draft gets made.
    const existing = await this.manuscript.listSegmentsFromFiles(project);
    const draft =
      existing[0]?.path ??
      (await this.adoptStrayDraft(project, result)) ??
      (await this.ensureArtifact(
        project,
        "draft",
        `${layout.directories.draft}/${layout.draftFileName}`,
        draftTemplate(project.locale),
        result,
      ));
    await this.repository.updateFrontmatter(project.projectFile, {
      // Named, as every other link this plugin writes is: the property editor
      // shows the display text, and a whole path where a note name belongs
      // reads as machinery rather than as the draft.
      [FRONTMATTER_KEYS.draft]: toWikiLink(draft, fileStem(draft)),
    });
    markRepaired(result, project.projectFile);
    return draft;
  }

  /**
   * Moves a draft the project names from outside the manuscript folder into it.
   *
   * A manuscript is the manuscript folder, so a note kept anywhere else is not
   * part of one however the project links to it. Writing a fresh empty draft
   * beside it and leaving the author's own prose orphaned would be the worse
   * answer, so the repair brings the note to where manuscripts live.
   */
  private async adoptStrayDraft(
    project: ProjectRef,
    result: Omit<RepairResult, "project">,
  ): Promise<string | null> {
    const record = await this.repository.tryReadManaged(project.projectFile);
    const target = record === null
      ? null
      : fromWikiLink(asOptionalString(record.frontmatter[FRONTMATTER_KEYS.draft]));
    if (target === null || target.length === 0) return null;
    const stray = this.repository.resolveLink(target, project.projectFile);
    if (stray === null) return null;
    const strayRecord = await this.repository.tryReadManaged(stray.path);
    if (
      strayRecord === null ||
      strayRecord.readOnly ||
      documentTypeOf(strayRecord.frontmatter) !== "draft" ||
      projectIdOf(strayRecord.frontmatter) !== project.id
    ) {
      return null;
    }

    const layout = getProjectPathLayout(project.locale);
    const home = this.repository.resolveUniquePath(
      normalizePath(
        `${project.rootPath}/${layout.directories.draft}/${basename(stray.path)}`,
      ),
    );
    const moved = await this.repository.renameFile(stray.path, home);
    markRepaired(result, moved);
    return moved;
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
      const base = getProjectBases(
        project.id,
        project.locale,
        characterRoleLinks(project),
        project.worldbuildingKinds,
      ).find(
        (candidate) =>
          normalizePath(
            `${project.rootPath}/${projectBaseFolder(project, candidate.id)}/${candidate.fileName}`,
          ) === normalized,
      );
      if (!base) {
        throw new Error(`No canonical project base was found for "${normalized}".`);
      }
      await this.repository.createPlainFile(normalized, base.content);
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "unregistered-worldbuilding-kind") {
      const kindId = issue.field;
      if (kindId === undefined) {
        throw new Error(`No kind id was recorded for "${normalized}".`);
      }
      const result = await this.createWorldbuildingKind(project, kindId);
      if (!result.ok) {
        throw new KindRegistrationRefusedError(kindId);
      }
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "missing-definition-node") {
      await this.materializeDefinitionNodesBelow(project, normalized);
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "unresolved-definition-link") {
      const member = this.memberAtPath(project, normalized);
      if (member === null) {
        throw new Error(`No project member was found at "${normalized}".`);
      }
      const kind = memberEntityKind(member);
      const roots = DEFINITION_FILE_IDS.map((id) => ({
        id,
        rootPath: definitionRootPath(project, kind, id),
      }));
      let created = 0;
      const raise = async (
        target: string,
        root: { id: DefinitionFileId; rootPath: string },
      ): Promise<void> => {
        const path = taxonomyPathFromTarget(target, root.rootPath);
        if (path === null) return;
        if (this.definitionNodeFolderStands(root.rootPath, path)) return;
        const check = checkDefinitionPath(path);
        if (!check.ok) return;
        // Counted by what the ensure actually made: a repair that made
        // nothing has repaired nothing, and says so below rather than
        // reporting a success the next check would take straight back.
        created += (
          await this.ensureDefinitionNodes(project, kind, root.id, check.segments)
        ).length;
      };
      for (const raw of member.categories) {
        const link = parseDefinitionValue(raw);
        if (link === null) continue;
        await raise(link.target, {
          id: "category",
          rootPath: definitionRootPath(project, kind, "category"),
        });
      }
      for (const line of [...member.worldStatus, ...member.relationships]) {
        for (const root of roots) {
          if (taxonomyPathFromTarget(line.label.path, root.rootPath) === null) {
            continue;
          }
          await raise(line.label.path, root);
          break;
        }
      }
      if (created === 0) {
        throw new Error(
          `No unresolved definition link was found in "${normalized}".`,
        );
      }
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "stale-definition-alias") {
      const member = this.memberAtPath(project, normalized);
      if (member === null) {
        throw new Error(`No project member was found at "${normalized}".`);
      }
      const kind = memberEntityKind(member);
      const roots = DEFINITION_FILE_IDS.map((id) =>
        definitionRootPath(project, kind, id),
      );
      // The names come back from the targets: the frontmatter through the
      // normal rewrite, and the record labels re-rendered with the path each
      // target spells today. The callout follows on its own reconcile.
      await this.normalizeMemberCategoryLinks(project, member);
      const fixLabels = (lines: readonly RecordLine[]): RecordLine[] =>
        lines.map((line) => {
          for (const root of roots) {
            const derived = taxonomyPathFromTarget(line.label.path, root);
            if (derived === null) continue;
            return derived === line.label.display
              ? line
              : { ...line, label: { ...line.label, display: derived } };
          }
          return line;
        });
      await this.reconcileRecordSections(project, {
        ...member,
        worldStatus: fixLabels(member.worldStatus),
        relationships: fixLabels(member.relationships),
      });
      // The callout re-emits the category links, so left to the debounced
      // reconcile it would keep showing the stale names for a while after
      // the repair reported success: refreshed here, from the note as it
      // stands now, so the report and the note agree immediately.
      const refreshed = await this.loadProject(project.projectFile);
      try {
        await this.reconcileMemberFieldsBlock(refreshed, normalized);
      } catch (error) {
        if (!(error instanceof UnsafeSectionError)) throw error;
      }
      return this.loadProject(project.projectFile);
    }

    if (
      issue.code === "mismatched-character-title" ||
      issue.code === "mismatched-scene-title" ||
      issue.code === "mismatched-entity-title"
    ) {
      // Frontmatter is the name the dashboard shows, so it wins; the heading and
      // file name are brought to it rather than the other way around.
      // safeFileName is lossy, so a file name cannot reconstruct a title.
      const record = await this.repository.readManaged(normalized);
      const title = memberStoredTitle(record);
      if (title === null) {
        throw new Error(`No stored name was found for "${normalized}".`);
      }
      await this.syncNoteHeading(normalized, title);
      const renamed = await this.renameManagedNote(normalized, title);
      await this.refreshMemberReferences(project, normalized, renamed, title);
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "extension-in-link") {
      // The report covers the project, so the repair does too: every note it
      // counted is rewritten in one go, rather than leaving the same one-time
      // change to be clicked through note by note.
      const records = [
        await this.repository.readManaged(project.projectFile),
        ...(await this.memberRecords(project)),
      ];
      let rewritten = 0;
      for (const record of records) {
        const tidy = this.extensionTidyPatch(record);
        if (tidy === null) continue;
        await this.repository.updateFrontmatter(record.path, tidy.patch);
        rewritten += 1;
      }
      if (rewritten === 0) {
        throw new Error(`No stored link in "${normalized}" carries a file extension.`);
      }
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "unlinked-path" || issue.code === "incomplete-link") {
      // Written out in full as a link, so that it stops depending on the name
      // staying unique and Obsidian starts keeping it up to date. Only the ones
      // the report named are touched; the rest keep the text the author has,
      // alias and all.
      const wanted = issue.code === "unlinked-path" ? "unlinked" : "incomplete";
      const record = await this.repository.readManaged(normalized);
      const names = new Map(
        projectMembers(project).map((member) => [member.path, memberName(member)]),
      );
      const rewrite = (path: string, stored: string | null): string =>
        toWikiLink(path, wikiLinkAlias(stored ?? "") ?? names.get(path) ?? fileStem(path));
      const patch: ManagedFrontmatter = {};
      // The same reader the report used, so every field it can name is a field
      // this can mend: what an author wrote in words is passed over by both.
      const mend = (field: { key: string; prose: boolean }): void => {
        const stored = storedReference(field, record.frontmatter[field.key]);
        if (stored === null) return;
        const link = this.classifyLink(stored, normalized, project.rootPath);
        if (link.kind === wanted) patch[field.key] = rewrite(link.path, stored);
      };
      mend(DRAFT_LINK_FIELD);
      for (const field of [...MEMBER_LINK_FIELDS, CATEGORY_LINK_FIELD]) {
        if (!field.list) {
          mend(field);
          continue;
        }
        const raw = storedList(record.frontmatter[field.key]);
        if (raw === null) continue;
        const next = raw.map((entry) => {
          const stored = storedReference(field, entry);
          if (stored === null) return entry;
          const link = this.classifyLink(stored, normalized, project.rootPath);
          return link.kind === wanted ? rewrite(link.path, stored) : entry;
        });
        if (fingerprint(next) !== fingerprint(raw)) patch[field.key] = next;
      }
      if (Object.keys(patch).length === 0) {
        throw new Error(`No such link was found in "${normalized}".`);
      }
      await this.repository.updateFrontmatter(normalized, patch);
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "foreign-link" || issue.code === "missing-link") {
      // The lists lose only the entries the report named. A field holding one
      // note is never emptied here, and every other field on the note, and all
      // of its prose, is left exactly as the author wrote it.
      const wanted = issue.code === "foreign-link" ? "foreign" : "missing";
      const record = await this.repository.readManaged(normalized);
      const patch: ManagedFrontmatter = {};
      for (const field of MEMBER_LINK_FIELDS) {
        // Only what a list can lose: what a field holds alone is a decision to
        // be made rather than an entry to drop.
        if (!field.removable) continue;
        const raw = storedList(record.frontmatter[field.key]);
        if (raw === null) continue;
        const next = raw.filter((entry) => {
          const stored = storedReference(field, entry);
          return (
            stored === null ||
            this.classifyLink(stored, normalized, project.rootPath).kind !== wanted
          );
        });
        if (next.length !== raw.length) patch[field.key] = next;
      }
      if (Object.keys(patch).length === 0) {
        throw new Error(`No such link was found in "${normalized}".`);
      }
      await this.repository.updateFrontmatter(normalized, patch);
      return this.loadProject(project.projectFile);
    }

    if (
      issue.code === "missing-manuscript-sequence" ||
      issue.code === "invalid-manuscript-sequence" ||
      issue.code === "duplicate-manuscript-sequence"
    ) {
      // Every one of the three is settled the same way, because a manuscript
      // whose positions disagree has only one honest answer: keep the order it
      // reads in now and write it down properly. Nothing below a frontmatter is
      // touched, so no prose moves and none of it changes.
      const written = await this.manuscript.repairSequences(project);
      if (written.length === 0) {
        throw new Error(`No manuscript position in "${normalized}" needed repair.`);
      }
      return this.loadProject(project.projectFile);
    }

    if (issue.code === "mismatched-project-folder") {
      // The same rule one folder up: the stored name is the one the dashboard
      // shows, so the folder is brought to it. An author who meant the folder
      // name has Rename project, which sets both at once -- and only that way
      // round is safe, because safeFileName drops what a folder cannot hold.
      const folder = this.repository.getFolder(normalized);
      if (folder === null) throw new ManagedFileNotFoundError(normalized);
      const destination = normalizePath(
        `${parentOf(normalized)}/${safeFileName(project.title)}`,
      );
      if (destination === normalized) return this.loadProject(project.projectFile);
      if (this.repository.get(destination)) throw new PathConflictError(destination);
      await this.repository.fileManager.renameFile(folder, destination);
      return this.loadProject(
        normalizePath(
          `${destination}/${relativeToRoot(project.projectFile, normalized)}`,
        ),
      );
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
      // The registry is rewritten to the entries the reading accepted: the
      // losers of a duplicate drop off the list and nothing else moves, so
      // folders and notes stay exactly where they are.
      case FRONTMATTER_KEYS.worldbuildingKinds:
        return {
          [FRONTMATTER_KEYS.worldbuildingKinds]: this.readWorldbuildingKinds(
            frontmatter,
            project.rootPath,
            project.locale,
          )
            .kinds.filter((kind) => kind.custom)
            .map((kind) => kind.folderName),
        };
      // A per-kind map keeps its readable pairs and loses the rest.
      case FRONTMATTER_KEYS.kindTemplates:
      case FRONTMATTER_KEYS.kindIcons:
      case FRONTMATTER_KEYS.kindDescriptions: {
        const value = frontmatter[issue.field];
        const entries =
          typeof value === "object" && value !== null && !Array.isArray(value)
            ? Object.entries(value).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === "string",
              )
            : [];
        return {
          [issue.field]: Object.fromEntries(entries),
        };
      }
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

    if (!isMemberDocumentType(expected)) {
      return safeCommonMetadataRepairPatch(record, expected, project.id);
    }

    const idKey =
      expected === "character"
        ? FRONTMATTER_KEYS.characterId
        : expected === "scene"
          ? FRONTMATTER_KEYS.sceneId
          : FRONTMATTER_KEYS.entityId;
    const folder = parentOf(record.path);
    const usedIds = new Set<string>();
    const usedRanks = new Set<number>();
    for (const file of this.repository.listDirectFiles(folder)) {
      if (file.extension !== "md" || file.path === record.path) continue;
      const candidate = await this.repository.tryReadManaged(file.path);
      if (!candidate) continue;
      const id = normalizeStableId(candidate.frontmatter[idKey]);
      if (id) usedIds.add(id);
      const rank = candidate.frontmatter[FRONTMATTER_KEYS.rank];
      if (typeof rank === "number" && Number.isSafeInteger(rank)) usedRanks.add(rank);
    }

    if (expected === "character") {
      return safeCharacterMetadataRepairPatch(record, project.id, usedIds, usedRanks);
    }
    if (expected === "scene") {
      return safeSceneMetadataRepairPatch(record, project.id, usedIds, usedRanks);
    }
    // The folder a worldbuilding note sits in says which kind it is, and the
    // note is only repairable where that folder is one of them.
    const kind = project.worldbuildingKinds.find(
      (candidate) =>
        normalizePath(worldbuildingKindFolder(project, candidate.id)) === folder,
    );
    return kind === undefined
      ? null
      : safeEntityMetadataRepairPatch(record, project.id, kind.id, usedIds, usedRanks);
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
    // A role is one category among the others now, so it is written only when
    // a caller names one. Defaulting here would hand every new character a
    // role nobody chose, and overwrite the one the category picker did.
    const resolvedType = input.type;
    if (resolvedType !== undefined && !isCharacterType(resolvedType)) {
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
    // Born migrated: the role is a category link from the first write, and
    // the legacy type key never appears on a new note.
    const pickedCategories = categoryLinksFromPaths(
      project,
      "character",
      input.categoryPaths ?? [],
    );
    const categories =
      resolvedType === undefined
        ? pickedCategories
        : replacedRoleCategories(
            project.locale,
            pickedCategories,
            resolvedType,
            categoryDefinitionPath(project, "character"),
          );
    const aliases = (input.aliases ?? [])
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0);
    await this.ensureReferencedDefinitions(
      project,
      "character",
      [
        ...(input.categoryPaths ?? []),
        ...(resolvedType === undefined
          ? []
          : [characterRoleName(project.locale, resolvedType)]),
      ],
      [input.worldStatus, input.relationships],
    );
    const created = await this.repository.createManagedFile({
      path: requested,
      uniqueOnConflict: true,
      template: characterTemplate(name, project.locale, {
        fieldsBlock: renderCharacterFieldsBlock(
          project.locale,
          characterFieldsView(project.locale, {
            type: resolvedType ?? null,
            progressStatus: input.progressStatus ?? null,
            aliases,
            categories,
            oneSentenceStoryline: input.oneSentenceStoryline ?? "",
            motivation: input.motivation ?? "",
            goal: input.goal ?? "",
            conflict: input.conflict ?? "",
            growth: input.growth ?? "",
          }),
        ),
        oneParagraphStoryline: input.oneParagraphStoryline,
        characterSynopsis: input.characterSynopsis,
        characterProfile: input.characterProfile,
      }),
      // Written in CHARACTER_FRONTMATTER_ORDER: the sequence a note is made
      // with is the sequence every later edit holds it to.
      frontmatter: {
        ...commonFrontmatter("character", project.id),
        [FRONTMATTER_KEYS.characterId]: characterId,
        [FRONTMATTER_KEYS.characterName]: name,
        ...(aliases.length > 0 ? { [ALIASES_KEY]: aliases } : {}),
        [FRONTMATTER_KEYS.rank]: rank,
        [FRONTMATTER_KEYS.category]: categories,
        [FRONTMATTER_KEYS.oneSentenceStoryline]: input.oneSentenceStoryline ?? "",
        [FRONTMATTER_KEYS.motivation]: input.motivation ?? "",
        [FRONTMATTER_KEYS.goal]: input.goal ?? "",
        [FRONTMATTER_KEYS.conflict]: input.conflict ?? "",
        [FRONTMATTER_KEYS.growth]: input.growth ?? "",
        ...(input.progressStatus
          ? { [FRONTMATTER_KEYS.progressStatus]: input.progressStatus }
          : {}),
      },
    });
    // Record sections are deferred out of the template; the first records a
    // note is created with are upserted right after it exists.
    const createdRecords = entityRecordSectionValues(
      project.locale,
      {
        worldStatus: input.worldStatus ?? [],
        relationships: input.relationships ?? [],
      },
      { worldStatusUnrecognized: [], relationshipsUnrecognized: [] },
      projectTimeSpans(project),
    );
    if ((input.customFields ?? "").trim().length > 0) {
      createdRecords["custom-fields"] = input.customFields!;
    }
    if (Object.keys(createdRecords).length > 0) {
      await this.repository.upsertSections(
        created.path,
        createdRecords,
        characterUpdateLayout(name, project.locale),
      );
    }
    return this.characterFromRecord(
      await this.repository.readManaged(created.path),
      project.locale,
    );
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
        characters.push(this.characterFromRecord(record, project.locale));
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
    const current = project.characters;
    await this.persistReorderedRanks(
      current,
      moveRanked(current, characterId, targetIndex),
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
    await this.ensureReferencedDefinitions(
      project,
      "character",
      [
        ...(patch.categoryPaths ?? []),
        ...(patch.type === undefined
          ? []
          : [characterRoleName(project.locale, patch.type)]),
      ],
      [patch.worldStatus, patch.relationships],
    );

    const frontmatterPatch: ManagedFrontmatter = {};
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.characterName, patch.name?.trim());
    // A role change lands where the role lives: as the category link on a
    // migrated note, under the legacy key on one the migration has not
    // reached. Writing the legacy key back onto a migrated note would flip it
    // to unmigrated again. The category picker owns the whole list, so what it
    // sends is what the note gets, role category included or left out.
    let nextCategories = character.categories;
    if (patch.categoryPaths !== undefined) {
      const picked = categoryLinksFromPaths(
        project,
        "character",
        patch.categoryPaths,
      );
      nextCategories =
        patch.type === undefined
          ? picked
          : replacedRoleCategories(
              project.locale,
              picked,
              patch.type,
              categoryDefinitionPath(project, "character"),
            );
      frontmatterPatch[FRONTMATTER_KEYS.category] = nextCategories;
    } else if (patch.type !== undefined) {
      if (character.categories.length > 0) {
        nextCategories = replacedRoleCategories(
          project.locale,
          character.categories,
          patch.type,
          categoryDefinitionPath(project, "character"),
        );
        frontmatterPatch[FRONTMATTER_KEYS.category] = nextCategories;
      } else {
        frontmatterPatch[FRONTMATTER_KEYS.characterType] = patch.type;
      }
    }
    const nextAliases =
      patch.aliases === undefined
        ? character.aliases
        : patch.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0);
    if (patch.aliases !== undefined) {
      frontmatterPatch[ALIASES_KEY] = nextAliases.length > 0 ? nextAliases : undefined;
    }
    const nextProgressStatus =
      patch.progressStatus === undefined
        ? character.progressStatus
        : patch.progressStatus;
    if (patch.progressStatus !== undefined) {
      frontmatterPatch[FRONTMATTER_KEYS.progressStatus] =
        patch.progressStatus ?? undefined;
    }
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.oneSentenceStoryline, patch.oneSentenceStoryline);
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.motivation, patch.motivation);
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.goal, patch.goal);
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.conflict, patch.conflict);
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.growth, patch.growth);

    const nextRecords = {
      worldStatus: patch.worldStatus ?? character.worldStatus,
      relationships: patch.relationships ?? character.relationships,
    };
    const spans = projectTimeSpans(project);
    const nextRecordValues = entityRecordSectionValues(
      project.locale,
      nextRecords,
      character,
      spans,
    );
    const originalRecordValues = entityRecordSectionValues(
      project.locale,
      character,
      character,
      spans,
    );
    const sectionValues: Record<string, string> = {
      "character-fields": renderCharacterFieldsBlock(
        project.locale,
        characterFieldsView(project.locale, {
          ...character,
          type: characterRoleFromCategories(nextCategories) ?? character.type,
          progressStatus: nextProgressStatus,
          aliases: nextAliases,
          categories: nextCategories,
          oneSentenceStoryline:
            patch.oneSentenceStoryline ?? character.oneSentenceStoryline,
          motivation: patch.motivation ?? character.motivation,
          goal: patch.goal ?? character.goal,
          conflict: patch.conflict ?? character.conflict,
          growth: patch.growth ?? character.growth,
        }),
      ),
      "one-paragraph-storyline":
        patch.oneParagraphStoryline ?? character.oneParagraphStoryline,
      "character-synopsis": patch.characterSynopsis ?? character.characterSynopsis,
      "character-profile": patch.characterProfile ?? character.characterProfile,
      ...customFieldsSectionValue(patch.customFields ?? character.customFields),
      ...nextRecordValues,
    };
    const rollbackValues: Record<string, string> = {
      "character-fields": renderCharacterFieldsBlock(
        project.locale,
        characterFieldsView(project.locale, character),
      ),
      "one-paragraph-storyline": character.oneParagraphStoryline,
      "character-synopsis": character.characterSynopsis,
      "character-profile": character.characterProfile,
      ...customFieldsSectionValue(character.customFields),
      ...Object.fromEntries(
        Object.keys(nextRecordValues).map((sectionId) => [
          sectionId,
          originalRecordValues[sectionId] ?? "",
        ]),
      ),
    };
    await this.updateManagedForm(
      character.path,
      patch.expectedRevision,
      frontmatterPatch,
      sectionValues,
      rollbackValues,
      characterUpdateLayout(character.name, project.locale),
      CHARACTER_FRONTMATTER_ORDER,
    );
    await this.removeEmptiedRecordSections(
      character,
      nextRecords,
      patch.customFields,
    );

    let path = character.path;
    if (nextName !== undefined && nextName.length > 0 && nextName !== character.name) {
      await this.syncNoteHeading(path, nextName);
      path = await this.renameManagedNote(path, nextName);
      await this.refreshMemberReferences(project, character.path, path, nextName);
    }
    return this.characterFromRecord(
      await this.repository.readManaged(path),
      project.locale,
    );
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
   * Drops a deleted note from every list that keeps it: a scene's cast, and the
   * times and places a scene happens in. Called once the note is gone, so a
   * failure here leaves recoverable dangling links the health check reports
   * rather than lists edited for a deletion that never happened.
   *
   * The fields holding one note rather than a list are deliberately left alone
   * — a scene's point of view, a period's two ends — because emptying one
   * leaves the note saying less than it did, and choosing the replacement is
   * the author's call. The health check names those instead.
   */
  async removeMemberReferences(
    projectLocator: ProjectLocator,
    memberPath: string,
  ): Promise<void> {
    const project = await this.loadProject(projectLocator);
    await this.removeReferencesToMembers(project, [memberPath]);
  }

  /**
   * The same sweep for any number of members at once: the notes are walked
   * once and each affected note is written once, however many members just
   * left — what keeps a kind deletion from reloading the project per entity.
   */
  private async removeReferencesToMembers(
    project: ProjectSnapshot,
    memberPaths: readonly string[],
  ): Promise<void> {
    if (memberPaths.length === 0) return;
    // The notes are gone, so every link to one is words now, and a bare
    // wiki-word only reads as a deleted member in fields of its own kind;
    // a path-qualified link says which note it meant by itself.
    const gone = memberPaths.map((path) => ({
      path,
      kind: memberKindOfPath(project, path),
    }));
    const goneSet = new Set(gone.map((member) => member.path));
    const records = await this.memberRecords(project);
    for (const record of records) {
      if (record.readOnly || goneSet.has(record.path)) continue;
      const patch: ManagedFrontmatter = {};
      for (const field of MEMBER_LINK_FIELDS) {
        // Only what a list can lose: what a field holds alone is a decision to
        // be made rather than an entry to drop.
        if (!field.removable) continue;
        const raw = storedList(record.frontmatter[field.key]);
        if (raw === null) continue;
        const next = raw.filter((entry) => {
          const target = fromWikiLink(storedReference(field, entry));
          if (target === null) return true;
          return !gone.some(
            (member) =>
              (target.includes("/") || field.kind === member.kind) &&
              this.linkNames(
                target,
                member.path,
                record.path,
                project.rootPath,
                true,
              ),
          );
        });
        if (next.length !== raw.length) patch[field.key] = next;
      }
      if (Object.keys(patch).length === 0) continue;
      await this.repository.updateFrontmatter(record.path, patch);
    }
  }

  /**
   * Which notes name one member, split because deleting it costs each kind
   * something different: an entry in a list can simply go, while a field
   * holding one note leaves the note that holds it needing a decision only the
   * author can make, and a record line is a sentence the author wrote.
   */
  async memberUsage(
    projectLocator: ProjectLocator,
    memberPath: string,
  ): Promise<MemberUsage> {
    const project = await this.loadProject(projectLocator);
    const listed = new Set<string>();
    const single = new Set<string>();
    const records = new Set<string>();
    // A bare wiki-word in a field only means this member where the field
    // holds its kind, matching what the removal sweep will actually edit. A
    // record line's clauses can point at anyone, so there the words keep
    // reading.
    const kind = memberKindOfPath(project, memberPath);
    for (const record of await this.memberRecords(project)) {
      if (record.path === memberPath) continue;
      const names = (stored: string | null, kindMatches: boolean): boolean => {
        const target = fromWikiLink(stored);
        if (target === null) return false;
        if (!target.includes("/") && !kindMatches) return false;
        return this.linkNames(
          target,
          memberPath,
          record.path,
          project.rootPath,
          true,
        );
      };
      const title = memberTitleOf(record);
      for (const field of MEMBER_LINK_FIELDS) {
        const kindMatches = field.kind === kind;
        const stored = record.frontmatter[field.key];
        if (field.list) {
          if (
            storedList(stored)?.some((entry) =>
              names(storedReference(field, entry), kindMatches),
            )
          ) {
            listed.add(title);
          }
          continue;
        }
        const value = storedReference(field, stored);
        if (value !== null && !isScenePovMode(value) && names(value, kindMatches)) {
          single.add(title);
        }
      }
      if (
        memberRecordTerms(record, project.locale).some(
          (term) =>
            term.kind === "link" &&
            this.linkNames(
              term.path,
              memberPath,
              record.path,
              project.rootPath,
              kind !== null,
            ),
        )
      ) {
        records.add(title);
      }
    }
    return {
      listed: [...listed],
      needsDecision: [...single],
      records: [...records],
    };
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
  private linkedPath(
    stored: string | null,
    sourcePath: string,
    root: string,
  ): string | null {
    const target = fromWikiLink(stored);
    if (target === null || target.length === 0) return null;
    return this.draftNotePath(target, sourcePath, root) ?? target;
  }

  /**
   * Where a draft link leads, or null when it leads nowhere. The project's own
   * draft is preferred and anywhere in the Vault accepted, because a draft is
   * the one note a project is allowed to keep outside its folder.
   */
  private draftNotePath(
    target: string,
    sourcePath: string,
    root: string,
  ): string | null {
    return (
      this.repository.resolveLinkWithin(target, sourcePath, root)?.path ??
      this.repository.resolveLink(target, sourcePath)?.path ??
      null
    );
  }

  /**
   * The note a scene's link leads to, which may only be one of its own
   * project's. Obsidian shortens a link to a bare file name whenever that name
   * is unambiguous, and a second project reusing the name makes it ambiguous
   * without either note being touched -- at which point Obsidian starts
   * answering with the other project's character. A link reaching outside the
   * project is not this project's character, however it is spelled, and reads
   * as broken so the health check can say so.
   */
  private projectLinkedPath(
    stored: string | null,
    sourcePath: string,
    root: string,
  ): string | null {
    const target = fromWikiLink(stored);
    if (target === null || target.length === 0) return null;
    return (
      this.repository.resolveLinkWithin(target, sourcePath, root)?.path ?? target
    );
  }

  /** A scene's cast exactly as stored, so a rewrite can keep what it does not change. */
  private storedCast(record: ManagedFileRecord): unknown[] {
    const stored = record.frontmatter[FRONTMATTER_KEYS.sceneCharacters];
    if (Array.isArray(stored)) return stored as unknown[];
    return typeof stored === "string" ? [stored] : [];
  }

  /**
   * How a stored link stands to the project it was written in. Three things can
   * be wrong with one, and each wants a different answer:
   *
   * - shortened, so it still reaches the right note but only while no other
   *   project reuses the name -- write the path out in full;
   * - reaching a note in another project, which this project never meant;
   * - reaching nothing at all.
   *
   * The last two are told apart because "gone" and "someone else's" are not the
   * same news, even though both leave the list to be edited.
   */
  private classifyLink(
    stored: string | null,
    sourcePath: string,
    root: string,
  ): {
    kind: "ok" | "unlinked" | "incomplete" | "foreign" | "missing";
    path: string;
  } {
    const target = fromWikiLink(stored);
    if (target === null || target.length === 0 || isScenePovMode(target)) {
      return { kind: "ok", path: target ?? "" };
    }
    const own = this.repository.resolveLinkWithin(target, sourcePath, root);
    if (own === null) {
      const anywhere = this.repository.resolveLink(target, sourcePath);
      return anywhere === null
        ? { kind: "missing", path: target }
        : { kind: "foreign", path: anywhere.path };
    }
    // A path typed as plain text reaches the note today and is not a link, so
    // Obsidian leaves it where it is when that note moves -- and the plugin
    // reading it as one is what lets it look healthy right up until a rename
    // takes the note out from under it. Reported before the shape of the path,
    // because writing it as a link settles both at once.
    if (!isWikiLink(stored)) return { kind: "unlinked", path: own.path };
    // Complete when the stored text is the note's own path, with or without the
    // extension Obsidian drops. Anything shorter leans on the name being
    // unique, which is a thing that stops being true without warning.
    const named = normalizePath(target);
    const complete =
      named === own.path || named === own.path.replace(/\.md$/u, "");
    return { kind: complete ? "ok" : "incomplete", path: own.path };
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
    root: string,
    bareNames: boolean,
  ): boolean {
    const wanted = normalizePath(path);
    const resolved = this.repository.resolveLinkWithin(target, sourcePath, root);
    if (resolved !== null) return resolved.path === wanted;
    // A link that resolves nowhere carries only its words, and words are
    // ambiguous: a dangling [[Winter]] could have meant any member ever
    // called Winter. The caller says whether this context is narrow enough
    // -- the right kind of field for the member in hand -- to read them.
    if (!bareNames) return false;
    const named = normalizePath(target);
    const stem = wanted.replace(/\.md$/u, "");
    return (
      named === wanted ||
      named === stem ||
      wanted.endsWith(`/${named}`) ||
      stem.endsWith(`/${named}`)
    );
  }

  /**
   * Rewrites every reference the project stores to a note that has just been
   * renamed. Obsidian repoints the links it owns as the note moves, but never
   * their display text, so every place a raw link is rendered — the Bases
   * views among them — would keep presenting the previous name.
   *
   * One sweep for all of them, because a member is named the same way wherever
   * it is named: a scene's point of view and cast, the times and places a
   * scene happens in, the two ends of a period, and the record lines any
   * member writes about another.
   */
  private async refreshMemberReferences(
    project: ProjectSnapshot,
    previousPath: string,
    currentPath: string,
    name: string,
  ): Promise<void> {
    const records = await this.memberRecords(project);
    const link = toWikiLink(currentPath, name);
    // Either name reaches the same note: Obsidian repoints the links it owns
    // as the note moves, and leaves them naming where it was when a Vault is
    // set not to update links at all. A bare wiki-word is different: it is
    // whatever the vault happens to resolve it to today -- with the time note
    // gone, a hand-typed [[Winter]] in a scene's time list resolves to a
    // character of that name, or to nothing at all. Either way it only reads
    // as this member in fields and clauses of this member's own kind. A
    // path-qualified target is unambiguous wherever it sits: its folders
    // already say which kind it names.
    const kind = memberKindOfPath(project, previousPath);
    const isRenamed = (
      target: string | null,
      sourcePath: string,
      kindMatches: boolean,
    ): boolean => {
      if (target === null) return false;
      if (!target.includes("/") && !kindMatches) return false;
      return (
        this.linkNames(target, previousPath, sourcePath, project.rootPath, true) ||
        this.linkNames(target, currentPath, sourcePath, project.rootPath, true)
      );
    };

    const touched: string[] = [];
    for (const record of records) {
      if (record.readOnly || record.path === previousPath) continue;
      const patch: ManagedFrontmatter = {};
      for (const field of MEMBER_LINK_FIELDS) {
        const kindMatches = field.kind === kind;
        const stored = record.frontmatter[field.key];
        if (field.list) {
          const raw = storedList(stored);
          if (raw === null) continue;
          // Only the renamed entry is rebuilt; the remaining links already
          // carry the right display text for their own note.
          const next = raw.map((entry) => {
            const value = storedReference(field, entry);
            return value !== null &&
              isRenamed(fromWikiLink(value), record.path, kindMatches)
              ? link
              : entry;
          });
          if (fingerprint(next) !== fingerprint(raw)) patch[field.key] = next;
          continue;
        }
        const value = storedReference(field, stored);
        if (value === null || isScenePovMode(value)) continue;
        if (
          value !== link &&
          isRenamed(fromWikiLink(value), record.path, kindMatches)
        ) {
          patch[field.key] = link;
        }
      }
      if (Object.keys(patch).length === 0) continue;
      await this.repository.updateFrontmatter(record.path, patch);
      touched.push(record.path);
    }

    // Read again before the record lines: a line naming a period writes that
    // period's own ends after it, and those ends are frontmatter the pass
    // above may just have rewritten.
    const refreshed = await this.loadProject(project.projectFile);
    for (const member of projectMembers(refreshed)) {
      if (member.readOnly) continue;
      const rewrite = (term: RecordTerm, kindMatches: boolean): RecordTerm =>
        term.kind === "link" && isRenamed(term.path, member.path, kindMatches)
          ? {
              kind: "link",
              path: normalizePath(currentPath).replace(/\.md$/u, ""),
              name,
            }
          : term;
      // `when` holds times and `at` holds locations, so only there do bare
      // words read as those kinds; `with` and the arrow reach any member.
      const kindIn = (
        clauseKind: "target" | "at" | "when" | "with" | "span",
      ): boolean =>
        clauseKind === "when" || clauseKind === "span"
          ? kind === "time"
          : clauseKind === "at"
            ? kind === "location"
            : kind !== null;
      let changed = false;
      const rewritten = (lines: readonly RecordLine[]): RecordLine[] =>
        lines.map((line) => {
          let lineChanged = false;
          const clauses = line.clauses.map((clause) => {
            if (clause.kind === "span") {
              const start = rewrite(clause.start, kindIn("span"));
              const end = rewrite(clause.end, kindIn("span"));
              if (start === clause.start && end === clause.end) return clause;
              lineChanged = true;
              return { ...clause, start, end };
            }
            const term = rewrite(clause.term, kindIn(clause.kind));
            if (term === clause.term) return clause;
            lineChanged = true;
            return { ...clause, term };
          });
          if (!lineChanged) return line;
          changed = true;
          return { ...line, clauses };
        });
      const worldStatus = rewritten(member.worldStatus);
      const relationships = rewritten(member.relationships);
      if (!changed) continue;
      await this.reconcileRecordSections(refreshed, {
        ...member,
        worldStatus,
        relationships,
      });
      touched.push(member.path);
    }

    // The overview re-emits these very links, so leaving it to the watcher
    // would show yesterday's name for as long as it takes an event to arrive,
    // and never at all where the write came from a repair.
    for (const path of new Set(touched)) {
      try {
        await this.reconcileMemberFieldsBlock(refreshed, path);
      } catch (error) {
        if (!(error instanceof UnsafeSectionError)) throw error;
      }
    }
  }

  /**
   * The member notes of a project, read once for a pass that has to look at
   * all of them. Characters and scenes come from their own folders, and
   * worldbuilding notes from wherever their kind folders are.
   */
  private async memberRecords(
    project: ProjectRef | ProjectSnapshot,
  ): Promise<ManagedFileRecord[]> {
    const records = new Map<string, ManagedFileRecord>();
    for (const [directory, documentType] of [
      ["characters", "character"],
      ["scenes", "scene"],
    ] as const) {
      for (const record of await this.findManagedFilesInProjectDirectories(
        project,
        directory,
        documentType,
        project.id,
      )) {
        records.set(record.path, record);
      }
    }
    for (const folderName of this.getProjectDirectoryNames(project, "worldbuilding")) {
      for (const record of await this.repository.findManagedFilesBelow(
        normalizePath(`${project.rootPath}/${folderName}`),
        "worldbuilding",
        project.id,
      )) {
        records.set(record.path, record);
      }
    }
    return [...records.values()];
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
    const sceneAliases = (input.aliases ?? [])
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0);
    const sceneCategories = categoryLinksFromPaths(
      project,
      "scene",
      input.categoryPaths ?? [],
    );
    await this.ensureReferencedDefinitions(project, "scene", input.categoryPaths ?? [], [
      input.worldStatus,
      input.relationships,
    ]);
    const created = await this.repository.createManagedFile({
      path: requested,
      uniqueOnConflict: true,
      template: sceneTemplate(title, project.locale, {
        fieldsBlock: sceneFieldsBlock(
          project.locale,
          {
            progressStatus: input.progressStatus ?? null,
            aliases: sceneAliases,
            categories: sceneCategories,
            povPath: povValue ?? null,
            times: input.times ?? [],
            locations: input.locations ?? [],
            conflict: input.conflict ?? "",
            characters: input.characters ?? [],
          },
          characterNames,
        ),
        events: input.events,
        planning: input.planning,
      }),
      // Written in SCENE_FRONTMATTER_ORDER: the sequence a note is made with
      // is the sequence every later edit holds it to.
      frontmatter: {
        ...commonFrontmatter("scene", project.id),
        [FRONTMATTER_KEYS.sceneId]: sceneId,
        [FRONTMATTER_KEYS.sceneTitle]: title,
        ...(sceneAliases.length > 0 ? { [ALIASES_KEY]: sceneAliases } : {}),
        [FRONTMATTER_KEYS.rank]: rank,
        ...(sceneCategories.length > 0
          ? { [FRONTMATTER_KEYS.category]: sceneCategories }
          : {}),
        [FRONTMATTER_KEYS.pov]: povValue
          ? isScenePovMode(povValue)
            ? povValue
            : characterLink(povValue)
          : "",
        [FRONTMATTER_KEYS.sceneTime]: input.times ?? [],
        [FRONTMATTER_KEYS.sceneLocation]: input.locations ?? [],
        [FRONTMATTER_KEYS.sceneCharacters]: (input.characters ?? []).map(characterLink),
        [FRONTMATTER_KEYS.conflict]: input.conflict ?? "",
        ...(input.progressStatus
          ? { [FRONTMATTER_KEYS.progressStatus]: input.progressStatus }
          : {}),
      },
    });
    const createdRecords = entityRecordSectionValues(
      project.locale,
      {
        worldStatus: input.worldStatus ?? [],
        relationships: input.relationships ?? [],
      },
      { worldStatusUnrecognized: [], relationshipsUnrecognized: [] },
      projectTimeSpans(project),
    );
    if ((input.customFields ?? "").trim().length > 0) {
      createdRecords["custom-fields"] = input.customFields!;
    }
    if (Object.keys(createdRecords).length > 0) {
      await this.repository.upsertSections(
        created.path,
        createdRecords,
        sceneUpdateLayout(title, project.locale),
      );
    }
    return this.sceneFromRecord(
      await this.repository.readManaged(created.path),
      project.rootPath,
      project.locale,
    );
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
    if (this.repository.getFile(path) === null) {
      this.assertProjectWritable(project);
      const base = this.projectBase(project, id);
      await this.repository.createPlainFile(path, base.content);
      return path;
    }
    if (!project.readOnly) {
      await this.refreshProjectBaseColumns(project, id, path);
    }
    return path;
  }

  /**
   * Rewrites the base from the current template and hands back its path. The
   * one way a base picks up template changes an append cannot express, so the
   * dashboard offers it behind a confirmation: it replaces the arrangements
   * the author made in the file.
   */
  async restoreProjectBase(
    projectLocator: ProjectLocator,
    id: ProjectBaseId,
  ): Promise<string> {
    const project = await this.resolveProjectForRead(projectLocator);
    this.assertProjectWritable(project);
    const path = this.projectBasePath(project, id);
    const base = this.projectBase(project, id);
    if (this.repository.getFile(path) === null) {
      await this.repository.createPlainFile(path, base.content);
    } else {
      await this.repository.updatePlainFile(path, () => base.content);
    }
    return path;
  }

  /**
   * Grows the base with columns for member properties it does not reference
   * yet, so a field that moved into the frontmatter, or one the author added
   * by hand, shows up the next time the view opens. Append-only: everything
   * the author arranged in the base stays arranged.
   */
  private async refreshProjectBaseColumns(
    project: ProjectRef | ProjectSnapshot,
    id: ProjectBaseId,
    path: string,
  ): Promise<void> {
    const documentType: DocumentType =
      id === "characters"
        ? "character"
        : id === "scenes"
          ? "scene"
          : "worldbuilding";
    const folder = normalizePath(
      `${project.rootPath}/${projectBaseFolder(project, id)}`,
    );
    const entries = await this.repository.listManagedEntriesBelow(
      folder,
      documentType,
      project.id,
    );
    const keys = new Set<string>();
    for (const entry of entries) {
      for (const key of Object.keys(entry.frontmatter)) keys.add(key);
    }
    const displayNames = baseColumnDisplayNames(project.locale);
    const additions = [...keys]
      .filter((key) => !BASE_EXCLUDED_COLUMN_KEYS.has(key))
      .sort()
      .map((key) => ({ key, displayName: displayNames.get(key) }));
    if (additions.length === 0) return;
    await this.repository.updatePlainFile(
      path,
      (current) => appendBaseColumns(current, additions).content,
    );
  }

  private projectBase(
    project: ProjectRef | ProjectSnapshot,
    id: ProjectBaseId,
  ): ProjectBaseDefinition {
    const base = getProjectBases(
      project.id,
      project.locale,
      characterRoleLinks(project),
      project.worldbuildingKinds,
    ).find((candidate) => candidate.id === id);
    if (!base) throw new Error(`Unknown project base: ${id}`);
    return base;
  }

  private projectBasePath(
    project: ProjectRef | ProjectSnapshot,
    id: ProjectBaseId,
  ): string {
    return normalizePath(
      `${project.rootPath}/${projectBaseFolder(project, id)}/${this.projectBase(project, id).fileName}`,
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
        scenes.push(this.sceneFromRecord(record, project.rootPath, project.locale));
      } catch (error) {
        if (!(record.readOnly && error instanceof InvalidManagedDocumentError)) throw error;
      }
    }
    return sortByRank(scenes);
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
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.sceneTime, patch.times);
    copyDefined(
      frontmatterPatch,
      FRONTMATTER_KEYS.sceneLocation,
      patch.locations,
    );
    if (patch.characters !== undefined) {
      frontmatterPatch[FRONTMATTER_KEYS.sceneCharacters] = patch.characters.map(characterLink);
    }
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.conflict, patch.conflict);
    const nextAliases =
      patch.aliases === undefined
        ? scene.aliases
        : patch.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0);
    if (patch.aliases !== undefined) {
      frontmatterPatch[ALIASES_KEY] = nextAliases.length > 0 ? nextAliases : undefined;
    }
    await this.ensureReferencedDefinitions(project, "scene", patch.categoryPaths ?? [], [
      patch.worldStatus,
      patch.relationships,
    ]);
    const nextCategories =
      patch.categoryPaths === undefined
        ? scene.categories
        : categoryLinksFromPaths(project, "scene", patch.categoryPaths);
    if (patch.categoryPaths !== undefined) {
      frontmatterPatch[FRONTMATTER_KEYS.category] =
        nextCategories.length > 0 ? nextCategories : undefined;
    }
    const nextProgressStatus =
      patch.progressStatus === undefined ? scene.progressStatus : patch.progressStatus;
    if (patch.progressStatus !== undefined) {
      frontmatterPatch[FRONTMATTER_KEYS.progressStatus] =
        patch.progressStatus ?? undefined;
    }
    const nextFields = {
      progressStatus: nextProgressStatus,
      aliases: nextAliases,
      categories: nextCategories,
      povPath: patch.povPath !== undefined ? patch.povPath || null : scene.povPath,
      times: patch.times ?? scene.times,
      locations: patch.locations ?? scene.locations,
      conflict: patch.conflict ?? scene.conflict,
      characters: patch.characters ?? scene.characters,
    };
    const nextRecords = {
      worldStatus: patch.worldStatus ?? scene.worldStatus,
      relationships: patch.relationships ?? scene.relationships,
    };
    const sceneUnrecognized = {
      worldStatusUnrecognized: scene.worldStatusUnrecognized,
      relationshipsUnrecognized: scene.relationshipsUnrecognized,
    };
    const spans = projectTimeSpans(project);
    const nextRecordValues = entityRecordSectionValues(
      project.locale,
      nextRecords,
      sceneUnrecognized,
      spans,
    );
    const originalRecordValues = entityRecordSectionValues(
      project.locale,
      { worldStatus: scene.worldStatus, relationships: scene.relationships },
      sceneUnrecognized,
      spans,
    );
    const sectionValues: Record<string, string> = {
      "scene-fields": sceneFieldsBlock(project.locale, nextFields, characterNames),
      "scene-events": patch.events ?? scene.events,
      "scene-planning": patch.planning ?? scene.planning,
      ...customFieldsSectionValue(patch.customFields ?? scene.customFields),
      ...nextRecordValues,
    };
    const rollbackValues: Record<string, string> = {
      "scene-fields": sceneFieldsBlock(project.locale, scene, characterNames),
      "scene-events": scene.events,
      "scene-planning": scene.planning,
      ...customFieldsSectionValue(scene.customFields),
      ...Object.fromEntries(
        Object.keys(nextRecordValues).map((sectionId) => [
          sectionId,
          originalRecordValues[sectionId] ?? "",
        ]),
      ),
    };
    // Until the migration removes it, a legacy conflict section is text the
    // author still sees, so an edit keeps it saying what the property says
    // rather than leaving yesterday's conflict on the page.
    const legacyConflict = readMarkedSection(
      (await this.repository.readManaged(scene.path)).content,
      "scene-conflict",
    );
    if (legacyConflict !== null) {
      sectionValues["scene-conflict"] = patch.conflict ?? scene.conflict;
      rollbackValues["scene-conflict"] = legacyConflict;
    }
    await this.updateManagedForm(
      scene.path,
      patch.expectedRevision,
      frontmatterPatch,
      sectionValues,
      rollbackValues,
      sceneUpdateLayout(scene.title, project.locale),
      SCENE_FRONTMATTER_ORDER,
    );
    await this.removeEmptiedRecordSections(
      scene,
      nextRecords,
      patch.customFields,
    );

    let path = scene.path;
    if (nextTitle !== undefined && nextTitle.length > 0 && nextTitle !== scene.title) {
      await this.syncNoteHeading(path, nextTitle);
      path = await this.renameManagedNote(path, nextTitle);
      // No property names a scene, but a record line can: what a character was
      // doing, where and when, is a sentence that may point at one.
      await this.refreshMemberReferences(project, scene.path, path, nextTitle);
    }
    return this.sceneFromRecord(
      await this.repository.readManaged(path),
      project.rootPath,
      project.locale,
    );
  }

  /**
   * Moves a project onto schema 2 in one pass: the worldbuilding tree is
   * created where missing, every legacy character role becomes a category
   * link, every legacy scene conflict moves into its property, every member
   * overview is regenerated in the current shape, and the notes and project
   * file are stamped with the schema they now follow. Damaged notes are
   * skipped and counted, never forced.
   */
  async migrateMemberNotes(
    projectLocator: ProjectLocator,
  ): Promise<{ migrated: number; skipped: number }> {
    const loaded = await this.loadProject(projectLocator);
    this.assertProjectWritable(loaded);
    await this.ensureWorldbuildingTree(loaded);
    await this.syncDefinitionTrees(loaded);
    await this.refreshRoleLinksInBases(loaded);
    // Notes made here join the project, so everything after this reads a
    // project that has them: the callouts refreshed below are refreshed with
    // the links, not with the words they replaced.
    const project =
      (await this.adoptSceneNoteFields(loaded)) > 0
        ? await this.loadProject(projectLocator)
        : loaded;
    // The plugin's own files come along first, silently: they are generated,
    // so bringing them current is bookkeeping, not migration.
    await this.settleSystemFiles(project);
    const characterNames = new Map(
      project.characters.map((character) => [character.path, character.name]),
    );
    const legacyHeadings = legacySceneConflictHeadings();
    let migrated = 0;
    let skipped = 0;

    for (const character of project.characters) {
      if (character.readOnly || !character.unmigrated) continue;
      try {
        // The role moves first, into the category links, and the legacy key
        // goes with it in the same write: a failure between the two writes
        // then leaves either yesterday's note or one every reader already
        // resolves the same way, never a note claiming two roles.
        const record = await this.repository.readManaged(character.path);
        // A legacy key that does not read is still the author's role, in a
        // spelling the plugin cannot follow. Migrating would delete the key
        // without converting anything: the note is skipped and counted, and
        // the health check names it for the author to put right.
        if (
          hasOwn(record.frontmatter, FRONTMATTER_KEYS.characterType) &&
          !isCharacterType(record.frontmatter[FRONTMATTER_KEYS.characterType])
        ) {
          skipped += 1;
          continue;
        }
        // Nothing to move when the role already reads as a category, or when
        // the note never named one. Whatever the list holds afterwards is
        // re-emitted in today's link form, old role or not.
        const roleAdjusted =
          character.type === null ||
          characterRoleFromCategories(character.categories) !== null
            ? character.categories
            : replacedRoleCategories(
                project.locale,
                character.categories,
                character.type,
                categoryDefinitionPath(project, "character"),
              );
        const migratedCategories = normalizedCategoryValues(
          project,
          "character",
          roleAdjusted,
        );
        const frontmatterPatch: ManagedFrontmatter = {};
        if (schemaVersionOf(record.frontmatter) !== SCHEMA_VERSION) {
          frontmatterPatch[FRONTMATTER_KEYS.schema] = SCHEMA_VERSION;
        }
        if (
          hasOwn(record.frontmatter, FRONTMATTER_KEYS.characterType) ||
          migratedCategories !== character.categories
        ) {
          frontmatterPatch[FRONTMATTER_KEYS.category] = [...migratedCategories];
          frontmatterPatch[FRONTMATTER_KEYS.characterType] = undefined;
        }
        if (Object.keys(frontmatterPatch).length > 0) {
          await this.repository.updateFrontmatter(character.path, frontmatterPatch);
        }
        await this.repository.reshapeSections(character.path, {
          values: {
            "character-fields": renderCharacterFieldsBlock(
              project.locale,
              characterFieldsView(project.locale, {
                ...character,
                categories: [...migratedCategories],
              }),
            ),
          },
          layout: characterUpdateLayout(character.name, project.locale),
        });
        migrated += 1;
      } catch (error) {
        if (!(error instanceof UnsafeSectionError)) throw error;
        skipped += 1;
      }
    }

    for (const scene of project.scenes) {
      if (scene.readOnly || !scene.unmigrated) continue;
      try {
        const record = await this.repository.readManaged(scene.path);
        // The property first: scene.conflict already reads property-wins, so
        // this writes exactly what the note showed, and a failure after it
        // leaves a state every reader resolves the same way.
        const frontmatterPatch: ManagedFrontmatter = {};
        if (schemaVersionOf(record.frontmatter) !== SCHEMA_VERSION) {
          frontmatterPatch[FRONTMATTER_KEYS.schema] = SCHEMA_VERSION;
        }
        if (!hasOwn(record.frontmatter, FRONTMATTER_KEYS.conflict)) {
          frontmatterPatch[FRONTMATTER_KEYS.conflict] = scene.conflict;
        }
        if (Object.keys(frontmatterPatch).length > 0) {
          await this.repository.updateFrontmatter(scene.path, frontmatterPatch);
        }
        await this.repository.reshapeSections(scene.path, {
          values: {
            "scene-fields": sceneFieldsBlock(
              project.locale,
              scene,
              characterNames,
            ),
          },
          layout: sceneUpdateLayout(scene.title, project.locale),
          remove: [{ sectionId: "scene-conflict", headings: legacyHeadings }],
        });
        migrated += 1;
      } catch (error) {
        if (!(error instanceof UnsafeSectionError)) throw error;
        skipped += 1;
      }
    }

    for (const kind of project.worldbuildingKinds) {
      for (const entity of entitiesOf(project, kind.id)) {
        if (entity.readOnly || !entity.unmigrated) continue;
        try {
          // The block first: a damaged one refuses here and keeps the old
          // stamp, which is what keeps the note counted as waiting.
          await this.reconcileMemberFieldsBlock(project, entity.path);
          await this.repository.updateFrontmatter(entity.path, {
            [FRONTMATTER_KEYS.schema]: SCHEMA_VERSION,
          });
          migrated += 1;
        } catch (error) {
          if (!(error instanceof UnsafeSectionError)) throw error;
          skipped += 1;
        }
      }
    }

    // Members the flags never marked can still carry yesterday's overview
    // shape; the same idempotent reconcile the vault watcher runs brings each
    // one current, and touches nothing that already matches.
    // Worldbuilding entities are members of the same model and carry the same
    // generated overview, so a bulk refresh that skipped them would leave a
    // project half in the current shape.
    const refreshable = (
      snapshot: ProjectSnapshot,
    ): Array<CharacterRecord | SceneRecord | WorldbuildingRecord> =>
      [
        ...snapshot.characters,
        ...snapshot.scenes,
        ...snapshot.worldbuildingKinds.flatMap((kind) => entitiesOf(snapshot, kind.id)),
      ].filter(
        (member) =>
          !member.readOnly && !("unmigrated" in member && member.unmigrated),
      );
    // Category links first, and reloaded when any changed: the callouts
    // refreshed below are rendered from the snapshot, and must show the
    // links the notes now hold, not the ones conversion just replaced.
    let normalized = 0;
    for (const member of refreshable(project)) {
      if (await this.normalizeMemberCategoryLinks(project, member)) {
        normalized += 1;
      }
    }
    const current =
      normalized > 0 ? await this.loadProject(projectLocator) : project;
    for (const member of refreshable(current)) {
      try {
        await this.reconcileMemberFieldsBlock(current, member.path);
        await this.reconcileRecordSections(current, member);
      } catch (error) {
        if (!(error instanceof UnsafeSectionError)) throw error;
      }
    }
    // Last, once every property this migration writes is in place: a note
    // made by an older release holds its keys in that release's order, and
    // one that gained an alias since holds it at the end. Written only where
    // the sequence actually differs.
    const ordered: [readonly { path: string; readOnly: boolean }[], readonly string[]][] =
      [
        [current.characters, CHARACTER_FRONTMATTER_ORDER],
        [current.scenes, SCENE_FRONTMATTER_ORDER],
        ...current.worldbuildingKinds.map(
          (kind) =>
            [entitiesOf(current, kind.id), ENTITY_FRONTMATTER_ORDER] as [
              readonly { path: string; readOnly: boolean }[],
              readonly string[],
            ],
        ),
      ];
    for (const [members, order] of ordered) {
      for (const member of members) {
        if (member.readOnly) continue;
        const record = await this.repository.tryReadManaged(member.path);
        if (record === null) continue;
        if (isFrontmatterOrdered(record.frontmatter, order)) continue;
        await this.repository.updateFrontmatter(member.path, {}, order);
      }
    }

    // The members above are the notes the migration transforms; everything
    // else the plugin manages — step artifacts, the manuscript, materials,
    // archives, definition notes — changes nothing but its stamp between
    // schemas, and nothing else ever brings that stamp forward. Swept here so
    // one migration leaves no note claiming an older release wrote it,
    // whichever door it came through. Members stay out of the sweep: one the
    // loop skipped must keep its old stamp, or it stops being counted as
    // waiting.
    for (const path of await this.listOutdatedStamps(project)) {
      await this.repository.updateFrontmatter(path, {
        [FRONTMATTER_KEYS.schema]: SCHEMA_VERSION,
      });
      migrated += 1;
    }

    return { migrated, skipped };
  }

  /**
   * Brings the plugin's own files current, silently. The system templates,
   * 011 through 091, are generated: a missing one is created and an outdated
   * one replaced without asking, and the metadata note's schema stamp —
   * bookkeeping on a plugin-managed file — comes along the same way. A
   * template that exists but cannot be read is left for the health pane to
   * explain. User notes are never touched here: their crossing stays behind
   * the Update button. Runs when a dashboard shows the project and at the
   * head of every migration; both doors are idempotent.
   */
  async settleSystemFiles(projectLocator: ProjectLocator): Promise<boolean> {
    const project = await this.loadProject(projectLocator);
    if (project.readOnly) return false;
    let settled = false;
    const layout = getProjectPathLayout(project.locale);
    for (const systemTemplate of getSystemTemplates(project.locale)) {
      const path = normalizePath(
        `${project.rootPath}/${layout.directories.system}/${systemTemplate.fileName}`,
      );
      const frontmatter = systemTemplateFrontmatter(systemTemplate, project);
      if (this.repository.getFile(path) === null) {
        await this.repository.createManagedFile({
          path,
          template: systemTemplate.template,
          frontmatter,
        });
        settled = true;
        continue;
      }
      const record = await this.repository.tryReadManaged(path);
      if (record === null || record.readOnly) continue;
      if (isCurrentSystemTemplate(record, systemTemplate, frontmatter)) continue;
      await this.repository.replaceManagedFile(
        path,
        systemTemplate.template,
        frontmatter,
      );
      settled = true;
    }
    if (
      project.schemaVersion !== null &&
      project.schemaVersion < SCHEMA_VERSION
    ) {
      await this.repository.updateFrontmatter(project.projectFile, {
        [FRONTMATTER_KEYS.schema]: SCHEMA_VERSION,
      });
      settled = true;
    }
    return settled;
  }

  /**
   * Every note of the project that still carries an older release's schema
   * stamp and that no member machinery will bring forward: artifacts, drafts,
   * materials, archives, definition notes — anything managed except the
   * members, whose crossing (and whose right to be skipped) belongs to the
   * member loops, and the metadata note, whose stamp the migration writes
   * last and countOutdatedNotes checks directly off the snapshot.
   */
  private async listOutdatedStamps(
    project: ProjectRef | ProjectSnapshot,
  ): Promise<string[]> {
    const entries = await this.repository.listManagedEntriesBelow(
      project.rootPath,
      undefined,
      project.id,
    );
    const outdated: string[] = [];
    for (const entry of entries) {
      if (entry.readOnly) continue;
      const documentType = documentTypeOf(entry.frontmatter);
      if (!isDocumentType(documentType)) continue;
      if (isMemberDocumentType(documentType)) continue;
      if (documentType === "project-metadata") continue;
      if (entry.schemaVersion === null || entry.schemaVersion >= SCHEMA_VERSION) {
        continue;
      }
      outdated.push(entry.path);
    }
    return outdated;
  }

  /** How many such notes are waiting, for the dashboard's callout to say. */
  async countOutdatedNotes(projectLocator: ProjectLocator): Promise<number> {
    const project = await this.loadProject(projectLocator);
    return (await this.listOutdatedStamps(project)).length;
  }

  /**
   * Brings a note's record sections back in step with the codec. The plugin is
   * their only writer, so what it would write now is what they should hold,
   * and re-emitting them is how lines written by an older release pick up what
   * the grammar says today.
   *
   * Written only where the two differ: a migration reads every note in the
   * project, and one that also touched every note would be a migration nobody
   * could tell from a rewrite.
   */
  private async reconcileRecordSections(
    project: ProjectSnapshot,
    member: CharacterRecord | SceneRecord | WorldbuildingRecord,
  ): Promise<void> {
    const values = entityRecordSectionValues(
      project.locale,
      {
        worldStatus: member.worldStatus,
        relationships: member.relationships,
      },
      {
        worldStatusUnrecognized: member.worldStatusUnrecognized,
        relationshipsUnrecognized: member.relationshipsUnrecognized,
      },
      projectTimeSpans(project),
    );
    if (Object.keys(values).length === 0) return;
    const record = await this.repository.readManaged(member.path);
    const stale: Record<string, string> = {};
    for (const [sectionId, value] of Object.entries(values)) {
      const current = readMarkedSection(record.content, sectionId);
      // A section that is not there is not this pass's business: records are
      // upserted when a note first has one, never conjured by a refresh.
      if (current === null || current.trim() === value.trim()) continue;
      stale[sectionId] = value;
    }
    if (Object.keys(stale).length === 0) return;
    await this.repository.updateSections(member.path, stale);
  }


  /**
   * The bases embed the three role links in their filters and formulas, and
   * the ones written before nodes were folders anchor a heading that no
   * longer exists. The wording a generated column was written with is stuck
   * the same way, because a base is created once and belongs to its author
   * afterwards. The swap is textual on purpose: views, columns and widths
   * are theirs, so only the exact superseded strings give way.
   */
  private async refreshRoleLinksInBases(
    project: ProjectSnapshot,
  ): Promise<void> {
    const roles = characterRoleLinks(project);
    // A 0.7.0 base filters its role sheets on the legacy type key the
    // migration is about to delete from every note. That is the one older
    // spelling a released vault can hold.
    const swaps = getLegacyRoleRefreshes(project.locale, roles);
    for (const base of getProjectBases(project.id, project.locale, roles, project.worldbuildingKinds)) {
      const path = normalizePath(
        `${project.rootPath}/${projectBaseFolder(project, base.id)}/${base.fileName}`,
      );
      if (this.repository.getFile(path) === null) continue;
      await this.repository.updatePlainFile(path, (currentContent) => {
        let next = currentContent;
        for (const swap of swaps) next = next.split(swap.from).join(swap.to);
        return next;
      });
    }
  }

  /**
   * Rewrites a member's stored category links to today's node form, and only
   * then: a value already written this way comes back identical, and the
   * note is left untouched. True when the note changed.
   */
  private async normalizeMemberCategoryLinks(
    project: ProjectSnapshot,
    member: CharacterRecord | SceneRecord | WorldbuildingRecord,
  ): Promise<boolean> {
    const kind = memberEntityKind(member);
    const next = normalizedCategoryValues(project, kind, member.categories);
    if (next === member.categories) return false;
    await this.repository.updateFrontmatter(member.path, {
      [FRONTMATTER_KEYS.category]: [...next],
    });
    return true;
  }

  /**
   * Every definition path a write references is made real first. The picker
   * creates what it offers, but a path can also arrive typed straight into a
   * caller or carried in from another note, and a link written before its
   * node exists would be born broken.
   */
  private async ensureReferencedDefinitions(
    project: ProjectRef | ProjectSnapshot,
    kind: EntityKindId,
    categoryPaths: readonly string[],
    records: ReadonlyArray<readonly RecordLine[] | undefined>,
  ): Promise<void> {
    const jobs = new Map<
      string,
      { id: DefinitionFileId; segments: string[] }
    >();
    const claim = (id: DefinitionFileId, path: string): void => {
      const check = checkDefinitionPath(path);
      if (!check.ok) return;
      jobs.set(`${id}/${check.segments.join("/")}`, {
        id,
        segments: check.segments,
      });
    };
    for (const path of categoryPaths) claim("category", path);
    const roots = DEFINITION_FILE_IDS.map((id) => ({
      id,
      rootPath: definitionRootPath(project, kind, id),
    }));
    for (const lines of records) {
      for (const record of lines ?? []) {
        for (const root of roots) {
          const taxonomy = taxonomyPathFromTarget(
            record.label.path,
            root.rootPath,
          );
          if (taxonomy === null) continue;
          claim(root.id, taxonomy);
          break;
        }
      }
    }
    for (const job of jobs.values()) {
      await this.ensureDefinitionNodes(project, kind, job.id, job.segments);
    }
  }

  /**
   * Gives a scene's time and place the notes they were always naming, and
   * every link that names a note the name it is read out by.
   *
   * Before either field named a note a scene wrote it as a line of words, and
   * those words are the name of the note the author would have made: so one
   * is made, once per distinct wording, and the scene points at it. Links the
   * scene already holds are re-emitted rather than left alone, which is what
   * gives the ones written before display names a name to show. A period's
   * two ends are re-emitted for the same reason.
   *
   * Reports how many notes changed, so the caller knows whether the project
   * it holds is still the project on disk.
   */
  private async adoptSceneNoteFields(project: ProjectSnapshot): Promise<number> {
    const fields = [
      {
        key: FRONTMATTER_KEYS.sceneTime,
        kind: "time" as const,
        stored: (scene: SceneRecord): readonly string[] => scene.times,
      },
      {
        key: FRONTMATTER_KEYS.sceneLocation,
        kind: "location" as const,
        stored: (scene: SceneRecord): readonly string[] => scene.locations,
      },
    ];
    // One note per wording, however many scenes wrote it: two scenes on the
    // same evening are in the same evening.
    const known = new Map<string, string>();
    const ranks = new Map<WorldbuildingKind, number>();
    for (const { kind } of fields) {
      const entities = entitiesOf(project, kind);
      for (const entity of entities) {
        known.set(`${kind} ${foldName(entity.name)}`, entity.path);
      }
      const last = entities[entities.length - 1];
      ranks.set(kind, last === undefined ? 0 : last.rank);
    }
    let changed = 0;
    for (const scene of project.scenes) {
      if (scene.readOnly) continue;
      const patch: ManagedFrontmatter = {};
      for (const field of fields) {
        const stored = field.stored(scene);
        const adopted: string[] = [];
        let differs = false;
        for (const raw of stored) {
          const value = raw.trim();
          if (value.length === 0) {
            differs = true;
            continue;
          }
          const term = parseTerm(value);
          if (term.kind === "link") {
            const link = renderTerm(term);
            if (link !== value) differs = true;
            adopted.push(link);
            continue;
          }
          const key = `${field.kind} ${foldName(term.text)}`;
          let path = known.get(key);
          if (path === undefined) {
            const rank = (ranks.get(field.kind) ?? 0) + RANK_GAP;
            path = await this.createAdoptedEntity(
              project,
              field.kind,
              term.text,
              rank,
            );
            ranks.set(field.kind, rank);
            known.set(key, path);
          }
          adopted.push(renderTerm({ kind: "link", path, name: term.text }));
          differs = true;
        }
        if (differs) patch[field.key] = adopted;
      }
      if (Object.keys(patch).length === 0) continue;
      await this.repository.updateFrontmatter(scene.path, patch);
      changed += 1;
    }
    // A period's ends are links too, and were written before links carried the
    // name they are read out by.
    for (const entity of entitiesOf(project, "time")) {
      if (entity.readOnly) continue;
      const patch: ManagedFrontmatter = {};
      const spans = [
        { key: FRONTMATTER_KEYS.timeStart, stored: entity.timeStart },
        { key: FRONTMATTER_KEYS.timeEnd, stored: entity.timeEnd },
      ];
      for (const span of spans) {
        const value = span.stored.trim();
        if (value.length === 0) continue;
        const term = parseTerm(value);
        if (term.kind !== "link") continue;
        const link = renderTerm(term);
        if (link !== value) patch[span.key] = link;
      }
      if (Object.keys(patch).length === 0) continue;
      await this.repository.updateFrontmatter(entity.path, patch);
      changed += 1;
    }
    return changed;
  }

  /**
   * The note a scene's words were naming, from the words alone. Every other
   * field is left unset: the migration moves what an author wrote, and has
   * nothing of its own to say about a place or a moment.
   */
  private async createAdoptedEntity(
    project: ProjectSnapshot,
    kind: WorldbuildingKind,
    name: string,
    rank: number,
  ): Promise<string> {
    // A moment is what a scene's own time is, so an adopted time is a point.
    const timeKind: TimeKind | null = kind === "time" ? "point" : null;
    const view = entityFieldsViewOf(kind, {
      progressStatus: null,
      aliases: [],
      categories: [],
      description: "",
      timeKind,
      timeStart: "",
      timeEnd: "",
    });
    const folder = normalizePath(worldbuildingKindFolder(project, kind));
    const created = await this.repository.createManagedFile({
      path: normalizePath(`${folder}/${safeFileName(name)}.md`),
      uniqueOnConflict: true,
      template: entityTemplate(name, kind, project.locale, {
        fieldsBlock: renderEntityFieldsBlock(project.locale, kind, view),
      }),
      frontmatter: {
        ...commonFrontmatter("worldbuilding", project.id),
        [FRONTMATTER_KEYS.entityId]: createStableId("entity"),
        [FRONTMATTER_KEYS.worldbuildingKind]: kind,
        [FRONTMATTER_KEYS.name]: name,
        [FRONTMATTER_KEYS.rank]: rank,
        [FRONTMATTER_KEYS.description]: "",
        ...(timeKind === null
          ? {}
          : {
              [FRONTMATTER_KEYS.timeKind]: timeKind,
              [FRONTMATTER_KEYS.timeStart]: "",
              [FRONTMATTER_KEYS.timeEnd]: "",
            }),
      },
    });
    return created.path;
  }

  /**
   * The paths a definition tree's folders spell, depth first with siblings
   * in folded name order: what the category and record-label pickers list.
   * The walk stops at the depth cap, so a deeper folder is simply not part
   * of the vocabulary.
   */
  async listDefinitionPaths(
    projectLocator: ProjectLocator,
    kind: EntityKindId,
    id: DefinitionFileId,
  ): Promise<string[]> {
    const project = await this.loadProject(projectLocator);
    return this.walkDefinitionTree(definitionRootPath(project, kind, id));
  }

  private walkDefinitionTree(rootPath: string): string[] {
    return this.definitionNodeFolders(rootPath).map(
      (folderPath) => taxonomyPathFromTarget(folderPath, rootPath) ?? "",
    );
  }

  /**
   * One vocabulary across every kind, read for showing and managing rather
   * than for picking: every node in walk order with what its note says it
   * means, which notes use it, and the two ways a node can half-exist — a
   * folder missing the note its links resolve to, and a path members
   * reference that no folder spells, raised as a marked entry where the
   * folder would stand, missing ancestors and all.
   *
   * Usage is direct: the notes naming that very node, not its children. A
   * deletion that takes a subtree gathers the descendants' entries itself.
   * Paths are matched under fold throughout, because the file systems these
   * vaults live on answer to either case with the same folder.
   */
  async listDefinitionForest(
    projectLocator: ProjectLocator,
    id: DefinitionFileId,
  ): Promise<DefinitionForest> {
    // Everything the members store is in the snapshot, so a caller holding
    // one — the dashboard model is built from exactly this — pays no second
    // read of the project.
    const project =
      typeof projectLocator === "object" && "characters" in projectLocator
        ? projectLocator
        : await this.loadProject(projectLocator);
    const forest = {} as DefinitionForest;
    for (const kind of entityKindIds(project.worldbuildingKinds)) {
      const rootPath = definitionRootPath(project, kind, id);
      const members = membersOfKind(project, kind);
      // Referenced paths under this root, by folded path: who names the node
      // in a category list, who under a record label, and how the first
      // reference spelled it — the name a folderless entry is shown by.
      const usage = new Map<string, DefinitionNodeUsage>();
      const spelled = new Map<string, string>();
      const claim = (
        taxonomyPath: string,
        bucket: keyof DefinitionNodeUsage,
        name: string,
      ): void => {
        const folded = foldName(taxonomyPath);
        if (!spelled.has(folded)) spelled.set(folded, taxonomyPath);
        const entry = usage.get(folded) ?? { listed: [], records: [] };
        if (!entry[bucket].includes(name)) entry[bucket].push(name);
        usage.set(folded, entry);
      };
      for (const member of members) {
        const name = memberName(member);
        for (const raw of member.categories) {
          const link = parseDefinitionValue(raw);
          if (link === null) continue;
          const path = taxonomyPathFromTarget(link.target, rootPath);
          if (path !== null) claim(path, "listed", name);
        }
        for (const line of [...member.worldStatus, ...member.relationships]) {
          const path = taxonomyPathFromTarget(line.label.path, rootPath);
          if (path !== null) claim(path, "records", name);
        }
      }
      const standing = this.walkDefinitionTree(rootPath);
      const known = new Set(standing.map((path) => foldName(path)));
      const ghosts = new Map<string, string>();
      for (const display of spelled.values()) {
        const segments = display.split("/");
        for (let depth = 1; depth <= segments.length; depth += 1) {
          const ancestor = segments.slice(0, depth).join("/");
          const folded = foldName(ancestor);
          if (!known.has(folded) && !ghosts.has(folded)) {
            ghosts.set(folded, ancestor);
          }
        }
      }
      const paths = [...standing, ...ghosts.values()].sort(
        compareTaxonomyPaths,
      );
      const nodes: DefinitionNodeInfo[] = [];
      for (const taxonomyPath of paths) {
        const segments = taxonomyPath.split("/");
        const folderPath = normalizePath(`${rootPath}/${taxonomyPath}`);
        // The note as it stands, whichever era named it; a node without one
        // is offered the leaf-named path everything writes now.
        const standingNote = this.standingNodeNotePath(folderPath);
        const selfPath =
          standingNote ??
          normalizePath(`${folderPath}/${basename(folderPath)}.md`);
        const missing = !known.has(foldName(taxonomyPath));
        let description = "";
        let missingSelf = false;
        if (!missing) {
          const record =
            standingNote === null
              ? null
              : await this.repository.tryReadManaged(standingNote);
          missingSelf = record === null;
          description =
            record === null
              ? ""
              : (asOptionalString(
                  record.frontmatter[FRONTMATTER_KEYS.description],
                ) ?? "");
        }
        nodes.push({
          taxonomyPath,
          name: segments[segments.length - 1] ?? taxonomyPath,
          depth: segments.length,
          folderPath,
          selfPath,
          description,
          missingSelf,
          missing,
          usage: usage.get(foldName(taxonomyPath)) ?? {
            listed: [],
            records: [],
          },
        });
      }
      forest[kind] = { rootPath, nodes };
    }
    return forest;
  }

  /**
   * Every node folder at or below a folder, depth first with siblings in
   * folded name order, stopping at the depth cap. One walk for the pickers,
   * the health scan, and the passes that write node files.
   */
  private definitionNodeFolders(rootPath: string, from = rootPath): string[] {
    const folders: string[] = [];
    const start = this.repository.getFolder(from) === null ? null : from;
    if (start === null) return folders;
    const startDepth =
      start === rootPath
        ? 0
        : (taxonomyPathFromTarget(start, rootPath)?.split("/").length ?? 0);
    const visit = (folderPath: string, depth: number): void => {
      if (depth >= MAX_DEFINITION_DEPTH) return;
      const children = [...this.repository.listDirectFolders(folderPath)].sort(
        (left, right) => foldName(left.name).localeCompare(foldName(right.name)),
      );
      for (const child of children) {
        const path = `${folderPath}/${child.name}`;
        folders.push(path);
        visit(path, depth + 1);
      }
    };
    if (startDepth > 0) folders.push(start);
    visit(start, startDepth);
    return folders;
  }

  /** The tree a folder belongs to, or null when it is under none of them. */
  private definitionRootOf(
    project: ProjectRef | ProjectSnapshot,
    folderPath: string,
  ): { kind: EntityKindId; id: DefinitionFileId; rootPath: string } | null {
    const normalized = normalizePath(folderPath);
    for (const kind of entityKindIds(project.worldbuildingKinds)) {
      for (const id of DEFINITION_FILE_IDS) {
        const rootPath = definitionRootPath(project, kind, id);
        if (normalized === rootPath || normalized.startsWith(`${rootPath}/`)) {
          return { kind, id, rootPath };
        }
      }
    }
    return null;
  }

  /**
   * Gives every node folder at or below a path its `_self.md`. The vault
   * watcher calls this when a folder appears under a project, so a node made
   * in the file explorer is materialized the moment it exists; a path that
   * is not under any definition tree is quietly nothing to do.
   */
  async materializeDefinitionNodesBelow(
    projectLocator: ProjectLocator,
    folderPath: string,
  ): Promise<void> {
    const project = await this.resolveProjectForRead(projectLocator);
    if (project.readOnly) return;
    const normalized = normalizePath(folderPath);
    const owner = this.definitionRootOf(project, normalized);
    if (owner === null || this.repository.getFolder(normalized) === null) {
      return;
    }
    for (const nodeFolder of this.definitionNodeFolders(
      owner.rootPath,
      normalized,
    )) {
      // A folder the plugin is in the middle of raising is not a folder made
      // by hand, and the pass raising it is the one holding the description.
      if (this.ensuringDefinitionNodes.has(nodeFolder)) continue;
      await this.syncDefinitionNode(
        project,
        owner.id,
        owner.rootPath,
        nodeFolder,
      );
    }
  }

  /**
   * Every node in every tree, brought current: the pass that gives a project
   * written by an older build the node files, properties and blocks this one
   * writes. Cheap enough to run whole, because a vocabulary is small beside
   * the notes that use it.
   */
  private async syncDefinitionTrees(
    project: ProjectRef | ProjectSnapshot,
  ): Promise<void> {
    for (const kind of entityKindIds(project.worldbuildingKinds)) {
      for (const id of DEFINITION_FILE_IDS) {
        const rootPath = definitionRootPath(project, kind, id);
        if (this.repository.getFolder(rootPath) === null) continue;
        for (const nodeFolder of this.definitionNodeFolders(rootPath)) {
          await this.syncDefinitionNode(project, id, rootPath, nodeFolder);
        }
      }
    }
  }

  /**
   * The definition links one member note stores, checked against the trees.
   * The target is the identity, so a target whose node folder is gone is a
   * broken link, and an alias that no longer reads as the target's path is a
   * name a folder rename left behind. Legacy heading links are neither: the
   * migration is what rewrites those, and reporting them here would call a
   * project damaged for not having migrated yet.
   */
  private inspectMemberDefinitionLinks(
    project: KindScope,
    kind: EntityKindId,
    record: ManagedFileRecord,
    stepIds: StepId[],
    add: (issue: ProjectStructureIssue) => void,
  ): void {
    const categoryRoot = definitionRootPath(project, kind, "category");
    const roots = DEFINITION_FILE_IDS.map((id) =>
      definitionRootPath(project, kind, id),
    );
    const stale: string[] = [];
    const unresolved: string[] = [];
    // Named under the tree it belongs to, because each member kind keeps its
    // own: a relationship a scene has is not one a character has, and a report
    // that said only "Family" would look like the same entry twice over.
    const check = (target: string, alias: string, root: string): void => {
      const path = taxonomyPathFromTarget(target, root);
      if (path === null) return;
      const named = this.reportName(`${root}/${path}`, project.rootPath);
      // Folded, the way links resolve and the repair matches: a folder
      // renamed only in case still holds the node this link means.
      if (!this.definitionNodeFolderStands(root, path)) {
        unresolved.push(named);
        return;
      }
      if (alias !== path) stale.push(alias.length === 0 ? named : alias);
    };
    for (const raw of readStringList(
      record.frontmatter[FRONTMATTER_KEYS.category],
    )) {
      const link = parseDefinitionValue(raw);
      if (link === null) continue;
      check(link.target, link.alias ?? "", categoryRoot);
    }
    // Record labels live in the body, and the generated callout re-emits the
    // category links there too: the same checks apply to every one of them.
    // Any piped link is a candidate: what makes one a node link is living
    // under a definition root, which is the roots loop's business, not a
    // reserved spelling's. Ordinary member links fall out of the loop below.
    const labelPattern = /\[\[([^\]|#]+)\|([^\]]*)\]\]/gu;
    for (const match of record.body.matchAll(labelPattern)) {
      const target = (match[1] ?? "").trim();
      const alias = (match[2] ?? "").trim();
      for (const root of roots) {
        if (taxonomyPathFromTarget(target, root) === null) continue;
        check(target, alias, root);
        break;
      }
    }
    if (unresolved.length > 0) {
      add({
        code: "unresolved-definition-link",
        path: record.path,
        stepIds,
        names: [...new Set(unresolved)],
        canOpen: true,
        repairable: !record.readOnly,
      });
    }
    if (stale.length > 0) {
      add({
        code: "stale-definition-alias",
        path: record.path,
        stepIds,
        names: [...new Set(stale)],
        canOpen: true,
        repairable: !record.readOnly,
      });
    }
  }

  /**
   * What is wrong with the links one member note stores: text where a link
   * belongs, a link shortened to part of a path, a link into another project,
   * a link to a note that is gone. Every note is read the same way, because
   * every one of them stores links — a scene names its cast and its setting, a
   * period names its ends, and all of them name their categories.
   *
   * Which of the four a field can be reported for is the field's own business.
   * A list can simply lose an entry, so all four apply; a field holding one
   * note cannot be emptied by a repair, and a category that leads nowhere is
   * the definition check's to report, because it can raise what the link names
   * rather than take the link away.
   */
  private inspectMemberLinks(
    project: { rootPath: string },
    record: ManagedFileRecord,
    stepIds: StepId[],
    add: (issue: ProjectStructureIssue) => void,
  ): void {
    const found = new Map<string, string[]>();
    for (const field of [...MEMBER_LINK_FIELDS, CATEGORY_LINK_FIELD]) {
      const stored = record.frontmatter[field.key];
      const entries = field.list ? (storedList(stored) ?? []) : [stored];
      for (const entry of entries) {
        // Classified from the stored entry rather than its target: it is the
        // entry that says whether it is a link at all.
        const value = storedReference(field, entry);
        if (value === null) continue;
        const link = this.classifyLink(value, record.path, project.rootPath);
        if (link.kind === "ok") continue;
        const removal = link.kind === "foreign" || link.kind === "missing";
        if (removal && !field.removable) continue;
        const named = found.get(link.kind) ?? [];
        named.push(this.reportName(link.path, project.rootPath));
        found.set(link.kind, named);
      }
    }
    const codes = [
      ["unlinked", "unlinked-path"],
      ["incomplete", "incomplete-link"],
      ["foreign", "foreign-link"],
      ["missing", "missing-link"],
    ] as const;
    for (const [kind, code] of codes) {
      const named = found.get(kind);
      if (named === undefined) continue;
      add({
        code,
        path: record.path,
        stepIds,
        names: [...new Set(named)],
        canOpen: true,
        repairable: !record.readOnly,
      });
    }
  }

  /**
   * The notes a member's records point at that lead nowhere at all — most
   * often because the note they named was deleted while the sentence about it
   * stayed. Reported and never repaired: what a line should say once the note
   * it was about is gone is the author's to write.
   *
   * A link that resolves outside the project is left alone. The pickers offer
   * members only, but an author writing their own line may well point at a
   * note they keep elsewhere, and that is not damage.
   */
  private inspectMemberRecordLinks(
    project: { rootPath: string; locale: ProjectLanguage },
    record: ManagedFileRecord,
    stepIds: StepId[],
    add: (issue: ProjectStructureIssue) => void,
  ): void {
    const dangling = new Set<string>();
    for (const term of memberRecordTerms(record, project.locale)) {
      if (term.kind !== "link") continue;
      if (this.repository.resolveLink(term.path, record.path) !== null) continue;
      dangling.add(this.reportName(term.path, project.rootPath));
    }
    if (dangling.size === 0) return;
    add({
      code: "dangling-record-link",
      path: record.path,
      stepIds,
      names: [...dangling],
      canOpen: true,
      repairable: false,
    });
  }

  /**
   * How a report names a note or an entry: by its path inside the project, so
   * that two of them sharing a name are told apart — the relationship a scene
   * has and the one a character has are different entries, and a report saying
   * only "Family" would look like the same one twice.
   *
   * What lies outside the project keeps its Vault path, which is what says it
   * is outside; what the project cannot place at all is named exactly as the
   * link stored it, because inventing a folder for it would be a guess.
   */
  private reportName(target: string, root: string): string {
    const named = normalizePath(target).replace(/\.md$/u, "");
    const prefix = `${normalizePath(root)}/`;
    return named.startsWith(prefix) ? named.slice(prefix.length) : named;
  }

  private memberAtPath(
    project: ProjectSnapshot,
    path: string,
  ): CharacterRecord | SceneRecord | WorldbuildingRecord | null {
    return (
      projectMembers(project).find((member) => member.path === path) ?? null
    );
  }

  /**
   * Makes sure a path exists in one kind's tree, creating the worldbuilding
   * tree first when an older project has none. Refusals are returned rather
   * than thrown so the picker can say why in the project's language.
   */
  async addDefinitionPath(
    projectLocator: ProjectLocator,
    kind: EntityKindId,
    id: DefinitionFileId,
    path: string,
    description = "",
  ): Promise<AppendPathResult> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    await this.ensureWorldbuildingTree(project);
    const check = checkDefinitionPath(path);
    if (!check.ok) return check;
    const createdPaths = await this.ensureDefinitionNodes(
      project,
      kind,
      id,
      check.segments,
      description,
    );
    return { ok: true, createdPaths };
  }

  /**
   * Raises a node chain below a root, reusing what already stands: a folder
   * matching a segment under fold is the same node, so a picker typing a
   * different case cannot mint a twin of what a case-blind file system would
   * refuse anyway. Every folder on the chain gets its node file, and the
   * description lands in the deepest node's body, where it stays the moment
   * the body has anything of its own.
   */
  /**
   * Whether a node folder already stands at a taxonomy path, matched the way
   * `ensureDefinitionNodes` matches: fold by fold, segment by segment. The
   * check that raises an issue and the ensure that would mend it must agree
   * on what exists -- an exact-case lookup here would report a folder renamed
   * only in case as missing, and the repair, matching folded, would create
   * nothing and report success, forever.
   */
  private definitionNodeFolderStands(rootPath: string, path: string): boolean {
    if (this.repository.getFolder(rootPath) === null) return false;
    let folderPath = rootPath;
    for (const segment of path.split("/")) {
      const existing = this.repository
        .listDirectFolders(folderPath)
        .find((child) => foldName(child.name) === foldName(segment));
      if (existing === undefined) return false;
      folderPath = `${folderPath}/${existing.name}`;
    }
    return true;
  }

  private async ensureDefinitionNodes(
    project: ProjectRef | ProjectSnapshot,
    kind: EntityKindId,
    id: DefinitionFileId,
    segments: readonly string[],
    description = "",
  ): Promise<string[]> {
    const rootPath = definitionRootPath(project, kind, id);
    await this.repository.ensureFolder(rootPath);
    const created: string[] = [];
    const claimed: string[] = [];
    let folderPath = rootPath;
    let taxonomy = "";
    try {
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index] as string;
        const existing = this.repository
          .listDirectFolders(folderPath)
          .find((child) => foldName(child.name) === foldName(segment));
        const name = existing?.name ?? segment;
        folderPath = `${folderPath}/${name}`;
        taxonomy = taxonomy.length === 0 ? name : `${taxonomy}/${name}`;
        // Claimed before the folder exists, because making it is what tells
        // the watcher there is a node here, and the watcher knows nothing of
        // the description this pass is carrying.
        claimed.push(folderPath);
        this.ensuringDefinitionNodes.add(folderPath);
        if (existing === undefined) {
          await this.repository.ensureFolder(folderPath);
          created.push(taxonomy);
        }
        await this.syncDefinitionNode(
          project,
          id,
          rootPath,
          folderPath,
          index === segments.length - 1 ? description : "",
        );
      }
    } finally {
      for (const path of claimed) this.ensuringDefinitionNodes.delete(path);
    }
    return created;
  }

  /**
   * The note a node folder must hold, made when it is not there and brought
   * current when it is. The description is a property, so a second pass can
   * never double it, and the block below it is generated from where the node
   * sits: a folder renamed in the file explorer is put right by the next
   * pass rather than left describing where it used to be.
   *
  /** The node folder's own note as it stands on disk, or null. */
  private standingNodeNotePath(folderPath: string): string | null {
    const leaf = normalizePath(`${folderPath}/${basename(folderPath)}.md`);
    return this.repository.getFile(leaf) !== null ? leaf : null;
  }

  /**
   * The note a node folder must hold, made when it is not there and brought
   * current when it is. The description is a property, so a second pass can
   * never double it, and the block below it is generated from where the node
   * sits: a folder renamed in the file explorer is put right by the next
   * pass rather than left describing where it used to be.
   *
   * A description already written wins over one arriving here, because the
   * note is where an author edits it. True when the file had to be made.
   */
  private async syncDefinitionNode(
    project: ProjectRef | ProjectSnapshot,
    id: DefinitionFileId,
    rootPath: string,
    folderPath: string,
    description = "",
  ): Promise<boolean> {
    const path = normalizePath(`${folderPath}/${basename(folderPath)}.md`);
    const taxonomyPath = taxonomyPathFromTarget(folderPath, rootPath) ?? "";
    const offered = description.trim();
    // A note the node already has under an earlier name -- the leaf a
    // renamed folder used to answer to, standing alone -- is this node's
    // own and is renamed into place. Making a fresh note beside it would
    // fork the description. Two strange files at once is nothing to guess
    // about: the fresh note wins and the strays stay.
    if (this.repository.getFile(path) === null) {
      const notes = this.repository
        .listDirectFiles(folderPath)
        .filter((file) => file.extension === "md");
      const earlier =
        notes.length === 1 ? normalizePath(notes[0]?.path ?? "") : null;
      if (earlier !== null && earlier !== path) {
        try {
          await this.repository.renameFile(earlier, path);
        } catch {
          // The watcher may have renamed or created it between the look and
          // the move; whoever lost carries on with what stands now.
        }
      }
    }
    if (this.repository.getFile(path) === null) {
      if (this.repository.get(path) !== null) return false;
      try {
        await this.repository.createManagedFile({
          path,
          template: definitionTemplate(id, project.locale, {
            taxonomyPath,
            description: offered,
          }),
          frontmatter: {
            ...commonFrontmatter("definition", project.id),
            [FRONTMATTER_KEYS.definitionId]: createStableId("definition"),
            // Written only when there is one: an empty property is a line in
            // every node's properties panel saying nothing.
            ...(offered.length > 0
              ? { [FRONTMATTER_KEYS.description]: offered }
              : {}),
          },
        });
        return true;
      } catch (error) {
        // The folder watcher raises node files too, and it may have reached
        // this one between the look and the write. Whoever lost carries on
        // below, which is where the two passes agree anyway.
        if (!(error instanceof PathConflictError)) throw error;
      }
    }
    const record = await this.repository.tryReadManaged(path);
    if (record === null || record.readOnly) return false;
    const stored = asOptionalString(
      record.frontmatter[FRONTMATTER_KEYS.description],
    );
    const finalDescription =
      stored !== null && stored.trim().length > 0 ? stored : offered;
    const patch: ManagedFrontmatter = {};
    if (documentTypeOf(record.frontmatter) !== "definition") {
      patch[FRONTMATTER_KEYS.document] = "definition";
    }
    if (
      asOptionalString(record.frontmatter[FRONTMATTER_KEYS.definitionId]) === null
    ) {
      patch[FRONTMATTER_KEYS.definitionId] = createStableId("definition");
    }
    if (projectIdOf(record.frontmatter) === null) {
      patch[FRONTMATTER_KEYS.projectId] = project.id;
    }
    if (finalDescription !== (stored ?? "")) {
      patch[FRONTMATTER_KEYS.description] = finalDescription;
    }
    if (Object.keys(patch).length > 0) {
      await this.repository.updateFrontmatter(path, patch);
    }
    const expected = renderDefinitionFieldsBlock(project.locale, id, {
      taxonomyPath,
      description: finalDescription,
    });
    const current = readMarkedSection(record.content, "definition-fields");
    if (current !== null && current.trim() === expected.trim()) return false;
    // Upserted rather than only updated: a node file written before this
    // block existed, or made by hand, gains it at the top of the note with
    // whatever the author put there kept below.
    await this.repository.reshapeSections(path, {
      values: { "definition-fields": expected },
      layout: [{ id: "definition-fields", heading: "" }],
    });
    return false;
  }

  /**
   * Brings one node file in step with the folders around it, for the vault
   * watcher: a description edited in the note's properties reaches the block
   * below, and nothing happens at a path that is not a node.
   */
  async syncDefinitionNodeAt(
    projectLocator: ProjectLocator,
    notePath: string,
  ): Promise<boolean> {
    const project = await this.resolveProjectForRead(projectLocator);
    if (project.readOnly) return false;
    const normalized = normalizePath(notePath);
    const folderPath = parentOf(normalized);
    const name = basename(normalized);
    if (foldName(name) !== foldName(`${basename(folderPath)}.md`)) {
      return false;
    }
    const owner = this.definitionRootOf(project, folderPath);
    if (owner === null || folderPath === owner.rootPath) return false;
    await this.syncDefinitionNode(
      project,
      owner.id,
      owner.rootPath,
      folderPath,
    );
    return true;
  }

  /**
   * Gives one node a new name, and walks everything that names it. The
   * folder is renamed first; the subtree's node files are regenerated,
   * because every path below the fold changed; and every member link into
   * the moved subtree is rewritten by hand — target and shown name both —
   * because Obsidian's own link updater is a setting an author may have
   * off, and a vocabulary rename must not depend on it. Where Obsidian got
   * there first, the rewrite finds the targets already moved and only
   * settles their shown names.
   *
   * Refusals are returned rather than thrown so the dialog can say why in
   * the project's language: a name the file system will not take, or a
   * sibling already answering to it — under fold, because the file systems
   * these vaults live on would treat the twin as the same folder.
   */
  async renameDefinitionNode(
    projectLocator: ProjectLocator,
    kind: EntityKindId,
    id: DefinitionFileId,
    taxonomyPath: string,
    newName: string,
  ): Promise<RenamePathResult> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const trimmed = newName.trim();
    if (!isValidDefinitionSegment(trimmed)) {
      return { ok: false, code: "invalid-segment", segment: trimmed };
    }
    const rootPath = definitionRootPath(project, kind, id);
    const segments = taxonomyPath
      .split("/")
      .filter((segment) => segment.length > 0);
    const oldName = segments[segments.length - 1] ?? "";
    const parentSegments = segments.slice(0, -1);
    const parentPath = [rootPath, ...parentSegments].join("/");
    const oldFolder = normalizePath(`${parentPath}/${oldName}`);
    if (this.repository.getFolder(oldFolder) === null) {
      throw new ManagedFileNotFoundError(oldFolder);
    }
    if (trimmed === oldName) return { ok: true, taxonomyPath };
    const twin = this.repository
      .listDirectFolders(parentPath)
      .find(
        (child) =>
          foldName(child.name) === foldName(trimmed) &&
          child.name !== oldName,
      );
    if (twin !== undefined) {
      return { ok: false, code: "taken", segment: trimmed };
    }
    const newFolder = normalizePath(`${parentPath}/${trimmed}`);
    await this.repository.renameFolder(oldFolder, newFolder);
    // Every node below moved with it, and each one's generated block spells
    // its path: brought current here rather than left to the next pass.
    for (const nodeFolder of this.definitionNodeFolders(rootPath, newFolder)) {
      await this.syncDefinitionNode(project, id, rootPath, nodeFolder);
    }
    await this.rewriteDefinitionReferences(
      project,
      kind,
      rootPath,
      oldFolder,
      newFolder,
    );
    return { ok: true, taxonomyPath: [...parentSegments, trimmed].join("/") };
  }

  /**
   * Rewrites every member link into a moved subtree: the category lists in
   * frontmatter, the labels on record lines, and the callout that re-emits
   * them. The project is reloaded first, because Obsidian may have moved
   * some targets already; a link found moved keeps its target and gets its
   * shown name settled, so the pass lands the same wherever Obsidian left
   * off.
   */
  private async rewriteDefinitionReferences(
    project: ProjectSnapshot,
    kind: EntityKindId,
    rootPath: string,
    oldFolder: string,
    newFolder: string,
  ): Promise<void> {
    const oldPrefix = `${oldFolder}/`;
    const oldNote = `${oldFolder}/${basename(oldFolder)}`;
    const moved = (target: string): string => {
      const cleaned = normalizePath(target.trim());
      // The renamed node's own note carried the old leaf twice. Only the
      // folder survives the move here; the canonical link written below
      // puts the new note segment back on.
      if (cleaned === oldFolder || cleaned === oldNote) return newFolder;
      return cleaned.startsWith(oldPrefix)
        ? `${newFolder}/${cleaned.slice(oldPrefix.length)}`
        : cleaned;
    };
    const refreshed = await this.loadProject(project.projectFile);
    const members = membersOfKind(refreshed, kind);
    const touched: string[] = [];
    for (const member of members) {
      if (member.readOnly) continue;
      let changed = false;
      const categories = member.categories.map((raw) => {
        const link = parseDefinitionValue(raw);
        if (link === null) return raw;
        const path = taxonomyPathFromTarget(moved(link.target), rootPath);
        if (path === null) return raw;
        const canonical = nodeLink(rootPath, path);
        if (canonical === raw.trim()) return raw;
        changed = true;
        return canonical;
      });
      if (changed) {
        await this.repository.updateFrontmatter(member.path, {
          [FRONTMATTER_KEYS.category]: categories,
        });
        touched.push(member.path);
      }
      const fixLines = (lines: readonly RecordLine[]): readonly RecordLine[] =>
        lines.map((line) => {
          const path = taxonomyPathFromTarget(moved(line.label.path), rootPath);
          if (path === null) return line;
          const target = nodeSelfPath(rootPath, path);
          if (line.label.path === target && line.label.display === path) {
            return line;
          }
          return { ...line, label: { path: target, display: path } };
        });
      const worldStatus = fixLines(member.worldStatus);
      const relationships = fixLines(member.relationships);
      if (
        worldStatus.some((line, index) => line !== member.worldStatus[index]) ||
        relationships.some(
          (line, index) => line !== member.relationships[index],
        )
      ) {
        await this.reconcileRecordSections(refreshed, {
          ...member,
          worldStatus: [...worldStatus],
          relationships: [...relationships],
        });
        if (!touched.includes(member.path)) touched.push(member.path);
      }
    }
    if (touched.length === 0) return;
    // The callout re-emits the category links; refreshed from the notes as
    // they stand now, so the panes and the notes agree immediately.
    const final = await this.loadProject(project.projectFile);
    for (const path of touched) {
      try {
        await this.reconcileMemberFieldsBlock(final, path);
      } catch (error) {
        if (!(error instanceof UnsafeSectionError)) throw error;
      }
    }
  }

  /**
   * Trashes one node, subtree and all, and takes the entries that simply
   * can go: a category link into the felled subtree drops out of its list,
   * the way a deleted member drops out of the lists that carry it. Record
   * lines are sentences the author wrote and stay; the health check reports
   * each one still labelled with a felled path, with the member's form to
   * settle it in.
   */
  async deleteDefinitionNode(
    projectLocator: ProjectLocator,
    kind: EntityKindId,
    id: DefinitionFileId,
    taxonomyPath: string,
  ): Promise<void> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const rootPath = definitionRootPath(project, kind, id);
    const folderPath = normalizePath(`${rootPath}/${taxonomyPath}`);
    if (this.repository.getFolder(folderPath) === null) {
      throw new ManagedFileNotFoundError(folderPath);
    }
    await this.repository.trashFolder(folderPath);
    const stump = foldName(taxonomyPath);
    const felled = (path: string): boolean => {
      const folded = foldName(path);
      return folded === stump || folded.startsWith(`${stump}/`);
    };
    const refreshed = await this.loadProject(project.projectFile);
    const touched: string[] = [];
    for (const member of membersOfKind(refreshed, kind)) {
      if (member.readOnly) continue;
      const kept = member.categories.filter((raw) => {
        const link = parseDefinitionValue(raw);
        if (link === null) return true;
        const path = taxonomyPathFromTarget(link.target, rootPath);
        return path === null || !felled(path);
      });
      if (kept.length === member.categories.length) continue;
      await this.repository.updateFrontmatter(member.path, {
        [FRONTMATTER_KEYS.category]: kept,
      });
      touched.push(member.path);
    }
    if (touched.length === 0) return;
    const final = await this.loadProject(project.projectFile);
    for (const path of touched) {
      try {
        await this.reconcileMemberFieldsBlock(final, path);
      } catch (error) {
        if (!(error instanceof UnsafeSectionError)) throw error;
      }
    }
  }

  /**
   * Writes what one node means: the property on its note, and the generated
   * block below it through the same sync every other writer uses. An
   * emptied description takes the property with it, because an empty
   * property is a line in the panel saying nothing.
   */
  async updateDefinitionDescription(
    projectLocator: ProjectLocator,
    kind: EntityKindId,
    id: DefinitionFileId,
    taxonomyPath: string,
    description: string,
  ): Promise<void> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const rootPath = definitionRootPath(project, kind, id);
    const folderPath = normalizePath(`${rootPath}/${taxonomyPath}`);
    if (this.repository.getFolder(folderPath) === null) {
      throw new ManagedFileNotFoundError(folderPath);
    }
    const selfPath = this.standingNodeNotePath(folderPath);
    const trimmed = description.trim();
    if (selfPath !== null) {
      await this.repository.updateFrontmatter(selfPath, {
        [FRONTMATTER_KEYS.description]:
          trimmed.length === 0 ? undefined : trimmed,
      });
    }
    // A note that was missing is made here with the description in hand; one
    // that stands has just been told, and the sync re-renders its block.
    await this.syncDefinitionNode(project, id, rootPath, folderPath, trimmed);
  }

  /**
   * One tree root, seeded only at its own creation: characters arrive with
   * the vocabulary the plugin itself depends on or has always suggested, and
   * every other kind starts empty because its vocabulary is the author's to
   * invent. A root that already exists belongs to the author, missing
   * starters and all.
   */
  private async ensureDefinitionRoot(
    project: ProjectRef | ProjectSnapshot,
    kind: EntityKindId,
    id: DefinitionFileId,
  ): Promise<void> {
    const rootPath = definitionRootPath(project, kind, id);
    const existed = this.repository.getFolder(rootPath) !== null;
    await this.repository.ensureFolder(rootPath);
    if (existed || kind !== "character") return;
    for (const starter of characterStarterNames(project.locale, id)) {
      await this.ensureDefinitionNodes(project, kind, id, [starter]);
    }
  }

  /**
   * The worldbuilding folders, every kind's definition trees, and the kind
   * bases a schema 2 project carries, created only where missing: what exists
   * belongs to the author.
   */
  private async ensureWorldbuildingTree(
    project: ProjectRef | ProjectSnapshot,
  ): Promise<void> {
    const layout = getProjectPathLayout(project.locale);
    await this.repository.ensureFolder(
      normalizePath(`${project.rootPath}/${layout.directories.worldbuilding}`),
    );
    for (const kind of entityKindIds(project.worldbuildingKinds)) {
      await this.repository.ensureFolder(
        normalizePath(`${project.rootPath}/${entityKindFolder(project, kind)}`),
      );
      for (const definitionId of DEFINITION_FILE_IDS) {
        await this.ensureDefinitionRoot(project, kind, definitionId);
      }
      await this.repository.ensureFolder(customFieldRootPath(project, kind));
    }
    for (const base of getProjectBases(
      project.id,
      project.locale,
      characterRoleLinks(project),
      project.worldbuildingKinds,
    )) {
      if (base.id === "characters" || base.id === "scenes") continue;
      const path = normalizePath(
        `${project.rootPath}/${projectBaseFolder(project, base.id)}/${base.fileName}`,
      );
      if (this.repository.get(path) === null) {
        await this.repository.createPlainFile(path, base.content);
      }
    }
  }

  /**
   * The generated block a member note should carry right now, rendered from
   * its project record. Null for a path the project holds no writable member
   * at.
   */
  memberFieldsBlock(
    project: ProjectSnapshot,
    path: string,
  ): { documentType: MemberDocumentType; expected: string } | null {
    const character = project.characters.find(
      (candidate) => candidate.path === path,
    );
    if (character) {
      return character.readOnly
        ? null
        : {
            documentType: "character",
            expected: renderCharacterFieldsBlock(
              project.locale,
              characterFieldsView(project.locale, character),
            ),
          };
    }
    const scene = project.scenes.find((candidate) => candidate.path === path);
    if (scene) {
      if (scene.readOnly) return null;
      const characterNames = new Map(
        project.characters.map((candidate) => [candidate.path, candidate.name]),
      );
      return {
        documentType: "scene",
        expected: sceneFieldsBlock(project.locale, scene, characterNames),
      };
    }
    for (const kind of project.worldbuildingKinds) {
      const entity = entitiesOf(project, kind.id).find(
        (candidate) => candidate.path === path,
      );
      if (entity) {
        return entity.readOnly
          ? null
          : {
              documentType: "worldbuilding",
              expected: renderEntityFieldsBlock(
                project.locale,
                kind.id,
                entityFieldsViewOf(kind.id, entity),
              ),
            };
      }
    }
    return null;
  }

  /**
   * Rewrites the note's fields block when it stops saying what the properties
   * say: after a Properties-panel edit, an external edit, or a change typed
   * into the block itself. One-way and idempotent. Returns whether anything
   * was written.
   */
  async reconcileMemberFieldsBlock(
    project: ProjectSnapshot,
    path: string,
  ): Promise<boolean> {
    const target = this.memberFieldsBlock(project, path);
    if (target === null) return false;
    const record = await this.repository.readManaged(path);
    const plan = planFieldsBlockReconcile({
      documentType: target.documentType,
      content: record.content,
      expectedBlock: target.expected,
    });
    if (plan === null) return false;
    await this.repository.updateSections(path, { [plan.sectionId]: plan.value });
    return true;
  }

  /**
   * Joins a manuscript note with the one after it.
   *
   * The merge itself belongs to the manuscript; what belongs here is the one
   * piece of project metadata it can invalidate. `snowflake-draft` names the
   * opening of the manuscript, and merging that note into its neighbour would
   * leave the project pointing at something in the trash.
   */
  async mergeManuscriptSegments(
    projectLocator: ProjectLocator,
    path: string,
  ): Promise<ProjectSnapshot> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const merged = await this.manuscript.mergeWithNext(project, path);
    if (merged === null) {
      throw new Error(`There is no manuscript note after "${normalizePath(path)}".`);
    }
    if (project.links.draft === merged.removed) {
      await this.repository.updateFrontmatter(project.projectFile, {
        [FRONTMATTER_KEYS.draft]: toWikiLink(merged.kept, fileStem(merged.kept)),
      });
    }
    return this.loadProject(project.projectFile);
  }

  async reorderScene(
    projectLocator: ProjectLocator,
    sceneId: string,
    targetIndex: number,
  ): Promise<SceneRecord[]> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const current = project.scenes;
    await this.persistReorderedRanks(current, moveRanked(current, sceneId, targetIndex));
    return this.listScenes(project);
  }

  async listEntities(
    projectLocator: ProjectLocator,
    kind: WorldbuildingKindId,
  ): Promise<WorldbuildingRecord[]> {
    const project = await this.loadProject(projectLocator);
    return entitiesOf(project, kind);
  }

  async createEntity(
    projectLocator: ProjectLocator,
    input: EntityInput,
  ): Promise<WorldbuildingRecord> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const kind = input.kind;
    const name = input.name.trim();
    if (!name) throw new Error("Entity name is required.");
    this.assertNameAvailable(
      kind,
      entitiesOf(project, kind).map((entity) => entity.name),
      name,
    );
    const timeKind = kind === "time" ? (input.timeKind ?? null) : null;
    const timeStart = kind === "time" ? (input.timeStart ?? "").trim() : "";
    const timeEnd = kind === "time" ? (input.timeEnd ?? "").trim() : "";
    assertEntityTimeFields(timeKind, timeStart, timeEnd);

    const entityId = createStableId("entity");
    const siblings = entitiesOf(project, kind);
    const rank =
      siblings.length === 0
        ? RANK_GAP
        : siblings[siblings.length - 1]!.rank + RANK_GAP;
    if (!Number.isSafeInteger(rank)) throw new RangeError("Cannot assign a safe entity rank.");
    const folder = normalizePath(worldbuildingKindFolder(project, kind));
    const aliases = (input.aliases ?? [])
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0);
    const categories = categoryLinksFromPaths(
      project,
      kind,
      input.categoryPaths ?? [],
    );
    await this.ensureReferencedDefinitions(project, kind, input.categoryPaths ?? [], [
      input.worldStatus,
      input.relationships,
    ]);
    const view = entityFieldsViewOf(kind, {
      progressStatus: input.progressStatus ?? null,
      aliases,
      categories,
      description: input.description ?? "",
      timeKind,
      timeStart,
      timeEnd,
    });
    const created = await this.repository.createManagedFile({
      path: normalizePath(`${folder}/${safeFileName(name)}.md`),
      uniqueOnConflict: true,
      template: entityTemplate(name, kind, project.locale, {
        fieldsBlock: renderEntityFieldsBlock(project.locale, kind, view),
        notes: input.notes,
      }),
      // Written in ENTITY_FRONTMATTER_ORDER: the sequence a note is made with
      // is the sequence every later edit holds it to.
      frontmatter: {
        ...commonFrontmatter("worldbuilding", project.id),
        [FRONTMATTER_KEYS.entityId]: entityId,
        [FRONTMATTER_KEYS.worldbuildingKind]: kind,
        [FRONTMATTER_KEYS.name]: name,
        ...(aliases.length > 0 ? { [ALIASES_KEY]: aliases } : {}),
        [FRONTMATTER_KEYS.rank]: rank,
        ...(categories.length > 0 ? { [FRONTMATTER_KEYS.category]: categories } : {}),
        ...(kind === "time"
          ? {
              ...(timeKind === null ? {} : { [FRONTMATTER_KEYS.timeKind]: timeKind }),
              [FRONTMATTER_KEYS.timeStart]: timeStart,
              [FRONTMATTER_KEYS.timeEnd]: timeEnd,
            }
          : {}),
        [FRONTMATTER_KEYS.description]: input.description ?? "",
        ...(input.progressStatus
          ? { [FRONTMATTER_KEYS.progressStatus]: input.progressStatus }
          : {}),
      },
    });
    // Record sections are deferred out of the template; the first records a
    // note is created with are upserted right after it exists.
    const recordValues = entityRecordSectionValues(
      project.locale,
      {
        worldStatus: input.worldStatus ?? [],
        relationships: input.relationships ?? [],
      },
      { worldStatusUnrecognized: [], relationshipsUnrecognized: [] },
      projectTimeSpans(project),
    );
    if ((input.customFields ?? "").trim().length > 0) {
      recordValues["custom-fields"] = input.customFields!;
    }
    if (Object.keys(recordValues).length > 0) {
      await this.repository.upsertSections(
        created.path,
        recordValues,
        entityUpdateLayout(name, kind, project.locale),
      );
    }
    return this.entityFromRecord(
      await this.repository.readManaged(created.path),
      project.locale,
    );
  }

  async updateEntity(
    projectLocator: ProjectLocator,
    entityId: string,
    patch: EntityPatch,
  ): Promise<WorldbuildingRecord> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const entity = project.worldbuildingKinds.flatMap(
      (kind) => entitiesOf(project, kind.id),
    ).find((candidate) => candidate.entityId === entityId);
    if (!entity) {
      throw new ManagedFileNotFoundError(`worldbuilding entity ${entityId}`);
    }
    if (entity.readOnly) {
      throw new UnsupportedSchemaError(entity.path, SCHEMA_VERSION + 1, SCHEMA_VERSION);
    }
    const kind = entity.kind;
    const nextName = patch.name?.trim();
    if (
      nextName !== undefined &&
      nextName.length > 0 &&
      foldName(nextName) !== foldName(entity.name)
    ) {
      this.assertNameAvailable(
        kind,
        entitiesOf(project, kind)
          .filter((candidate) => candidate.entityId !== entityId)
          .map((candidate) => candidate.name),
        nextName,
      );
    }
    await this.ensureReferencedDefinitions(project, kind, patch.categoryPaths ?? [], [
      patch.worldStatus,
      patch.relationships,
    ]);

    const next = {
      progressStatus:
        patch.progressStatus === undefined
          ? entity.progressStatus
          : patch.progressStatus,
      aliases: (patch.aliases ?? entity.aliases)
        .map((alias) => alias.trim())
        .filter((alias) => alias.length > 0),
      categories:
        patch.categoryPaths === undefined
          ? entity.categories
          : categoryLinksFromPaths(project, kind, patch.categoryPaths),
      description: patch.description ?? entity.description,
      timeKind:
        kind !== "time"
          ? null
          : patch.timeKind === undefined
            ? entity.timeKind
            : patch.timeKind,
      timeStart: kind !== "time" ? "" : (patch.timeStart ?? entity.timeStart).trim(),
      timeEnd: kind !== "time" ? "" : (patch.timeEnd ?? entity.timeEnd).trim(),
    };
    assertEntityTimeFields(next.timeKind, next.timeStart, next.timeEnd);

    const frontmatterPatch: ManagedFrontmatter = {};
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.name, nextName);
    if (patch.aliases !== undefined) {
      frontmatterPatch[ALIASES_KEY] =
        next.aliases.length > 0 ? next.aliases : undefined;
    }
    if (patch.categoryPaths !== undefined) {
      frontmatterPatch[FRONTMATTER_KEYS.category] =
        next.categories.length > 0 ? next.categories : undefined;
    }
    if (patch.progressStatus !== undefined) {
      frontmatterPatch[FRONTMATTER_KEYS.progressStatus] =
        patch.progressStatus ?? undefined;
    }
    copyDefined(frontmatterPatch, FRONTMATTER_KEYS.description, patch.description);
    if (kind === "time") {
      if (patch.timeKind !== undefined) {
        frontmatterPatch[FRONTMATTER_KEYS.timeKind] = patch.timeKind ?? undefined;
      }
      copyDefined(frontmatterPatch, FRONTMATTER_KEYS.timeStart, patch.timeStart?.trim());
      copyDefined(frontmatterPatch, FRONTMATTER_KEYS.timeEnd, patch.timeEnd?.trim());
    }

    const nextRecords = {
      worldStatus: patch.worldStatus ?? entity.worldStatus,
      relationships: patch.relationships ?? entity.relationships,
    };
    const spans = projectTimeSpans(project);
    const nextRecordValues = entityRecordSectionValues(
      project.locale,
      nextRecords,
      entity,
      spans,
    );
    const originalRecordValues = entityRecordSectionValues(
      project.locale,
      entity,
      entity,
      spans,
    );
    const sectionValues: Record<string, string> = {
      "entity-fields": renderEntityFieldsBlock(
        project.locale,
        kind,
        entityFieldsViewOf(kind, next),
      ),
      "entity-notes": patch.notes ?? entity.notes,
      ...customFieldsSectionValue(patch.customFields ?? entity.customFields),
      ...nextRecordValues,
    };
    const rollbackValues: Record<string, string> = {
      "entity-fields": renderEntityFieldsBlock(
        project.locale,
        kind,
        entityFieldsViewOf(kind, entity),
      ),
      "entity-notes": entity.notes,
      ...customFieldsSectionValue(entity.customFields),
      ...Object.fromEntries(
        Object.keys(nextRecordValues).map((sectionId) => [
          sectionId,
          originalRecordValues[sectionId] ?? "",
        ]),
      ),
    };
    await this.updateManagedForm(
      entity.path,
      patch.expectedRevision,
      frontmatterPatch,
      sectionValues,
      rollbackValues,
      entityUpdateLayout(entity.name, kind, project.locale),
      ENTITY_FRONTMATTER_ORDER,
    );
    await this.removeEmptiedRecordSections(entity, nextRecords, patch.customFields);

    let path = entity.path;
    if (nextName !== undefined && nextName.length > 0 && nextName !== entity.name) {
      await this.syncNoteHeading(path, nextName);
      path = await this.renameManagedNote(path, nextName);
      await this.refreshMemberReferences(project, entity.path, path, nextName);
    }
    return this.entityFromRecord(
      await this.repository.readManaged(path),
      project.locale,
    );
  }

  async reorderEntity(
    projectLocator: ProjectLocator,
    kind: WorldbuildingKindId,
    entityId: string,
    targetIndex: number,
  ): Promise<WorldbuildingRecord[]> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const current = entitiesOf(project, kind);
    await this.persistReorderedRanks(current, moveRanked(current, entityId, targetIndex));
    return this.listEntities(project, kind);
  }

  /**
   * Registers a new custom kind and raises its scaffold: the registry entry,
   * the folder wearing the first free prefix of the run, the three
   * vocabulary roots, and the kind's base. The registry entry is what makes
   * the kind exist; everything after it is scaffold the repair pass could
   * rebuild.
   */
  async createWorldbuildingKind(
    projectLocator: ProjectLocator,
    name: string,
    appearance?: { icon?: string; description?: string },
  ): Promise<KindMutationResult> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const trimmed = name.trim();
    const refusal = validateKindName(trimmed, project.worldbuildingKinds);
    if (refusal !== null) return { ok: false, code: refusal };
    const prefix = nextCustomKindPrefix(project.worldbuildingKinds);
    if (prefix === null) return { ok: false, code: "full" };
    const folderName = `${prefix}_${trimmed}`;
    await this.repository.updateFrontmatterAtomic(
      project.projectFile,
      (frontmatter) => {
        const patch: ManagedFrontmatter = {
          [FRONTMATTER_KEYS.worldbuildingKinds]: [
            ...storedKindFolderNames(frontmatter),
            folderName,
          ],
        };
        // The looks ride along in the same write, or not at all: an empty
        // answer leaves the maps untouched rather than holding a blank.
        for (const [key, given] of [
          [FRONTMATTER_KEYS.kindIcons, appearance?.icon],
          [FRONTMATTER_KEYS.kindDescriptions, appearance?.description],
        ] as const) {
          const value = given?.trim() ?? "";
          if (value.length === 0) continue;
          const stored = frontmatter[key];
          patch[key] = {
            ...(isKindStringMap(stored) ? stored : {}),
            [trimmed]: value,
          };
        }
        return patch;
      },
    );
    const refreshed = await this.loadProject(project.projectFile);
    await this.ensureKindScaffold(refreshed, trimmed);
    const kind = refreshed.worldbuildingKinds.find(
      (candidate) => candidate.id === trimmed,
    );
    if (kind === undefined) {
      throw new Error(`The kind "${trimmed}" did not register.`);
    }
    return { ok: true, kind };
  }

  /**
   * One kind's folder, its three vocabulary roots, its template folder, and
   * its base, made real.
   */
  private async ensureKindScaffold(
    project: ProjectSnapshot,
    kindId: WorldbuildingKindId,
  ): Promise<void> {
    await this.repository.ensureFolder(
      normalizePath(worldbuildingKindFolder(project, kindId)),
    );
    for (const definitionId of DEFINITION_FILE_IDS) {
      await this.ensureDefinitionRoot(project, kindId, definitionId);
    }
    await this.repository.ensureFolder(customFieldRootPath(project, kindId));
    const basePath = this.projectBasePath(project, kindId);
    if (this.repository.get(basePath) === null) {
      await this.repository.createPlainFile(
        basePath,
        this.projectBase(project, kindId).content,
      );
    }
  }

  /**
   * Renames a custom kind: the registry entry and the template choice first,
   * because they are what the readers answer to, then the folder, the kind
   * stamp on every note of the kind, the links into its moved vocabulary
   * trees, the links other members hold to its notes, and last the base's
   * name and filter. Idempotent over whatever Obsidian's own link updater
   * already moved.
   */
  async renameWorldbuildingKind(
    projectLocator: ProjectLocator,
    kindId: WorldbuildingKindId,
    newName: string,
  ): Promise<KindMutationResult> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const kind = project.worldbuildingKinds.find(
      (candidate) => candidate.id === kindId,
    );
    if (kind === undefined) {
      throw new ManagedFileNotFoundError(`worldbuilding kind ${kindId}`);
    }
    if (!kind.custom) {
      throw new Error(`The built-in kind "${kindId}" keeps its name.`);
    }
    const trimmed = newName.trim();
    if (trimmed === kindId) return { ok: true, kind };
    const others = project.worldbuildingKinds.filter(
      (candidate) => candidate.id !== kindId,
    );
    const refusal = validateKindName(trimmed, others);
    if (refusal !== null) return { ok: false, code: refusal };

    const layout = getProjectPathLayout(project.locale);
    const worldbuildingDirectory = `${project.rootPath}/${layout.directories.worldbuilding}`;
    const number =
      /^\d+[A-Za-z]?/u.exec(kind.folderName)?.[0] ??
      nextCustomKindPrefix(others) ??
      "64";
    const newFolderName = `${number}_${trimmed}`;
    const oldFolder = normalizePath(`${worldbuildingDirectory}/${kind.folderName}`);
    const newFolder = normalizePath(`${worldbuildingDirectory}/${newFolderName}`);
    const entities = entitiesOf(project, kindId);
    const movedPath = (path: string): string | null =>
      path.startsWith(`${oldFolder}/`)
        ? normalizePath(`${newFolder}/${path.slice(oldFolder.length + 1)}`)
        : null;

    await this.repository.updateFrontmatterAtomic(
      project.projectFile,
      (frontmatter) => {
        const patch: ManagedFrontmatter = {
          [FRONTMATTER_KEYS.worldbuildingKinds]: storedKindFolderNames(
            frontmatter,
          ).map((entry) => (entry === kind.folderName ? newFolderName : entry)),
        };
        // Every per-kind map follows the name: template, icon, description.
        for (const key of [
          FRONTMATTER_KEYS.kindTemplates,
          FRONTMATTER_KEYS.kindIcons,
          FRONTMATTER_KEYS.kindDescriptions,
        ] as const) {
          const stored = frontmatter[key];
          if (isKindStringMap(stored) && stored[kindId] !== undefined) {
            const moved: Record<string, string> = { ...stored };
            moved[trimmed] = moved[kindId]!;
            delete moved[kindId];
            patch[key] = moved;
          }
        }
        // A stored template choice names a path inside the kind's folder,
        // and the folder is about to move: the value follows the name too.
        const templates =
          patch[FRONTMATTER_KEYS.kindTemplates] ??
          frontmatter[FRONTMATTER_KEYS.kindTemplates];
        if (isKindStringMap(templates)) {
          const retargeted: Record<string, string> = { ...templates };
          let changed = false;
          for (const [entryKind, stored] of Object.entries(retargeted)) {
            const target = (fromWikiLink(stored) ?? stored).trim();
            if (!target.startsWith(`${oldFolder}/`)) continue;
            const moved = `${newFolder}/${target.slice(oldFolder.length + 1)}`;
            retargeted[entryKind] = toWikiLink(moved, fileStem(moved));
            changed = true;
          }
          if (changed) patch[FRONTMATTER_KEYS.kindTemplates] = retargeted;
        }
        return patch;
      },
    );
    if (this.repository.getFolder(oldFolder) !== null) {
      await this.repository.renameFolder(oldFolder, newFolder);
    } else {
      await this.repository.ensureFolder(newFolder);
    }
    // The notes wear the new id: what a note carries is the registry id.
    // Every note is its own write, so the writes overlap instead of queueing
    // one behind another through a large kind.
    await Promise.all(
      entities.map(async (entity) => {
        const path = movedPath(entity.path) ?? entity.path;
        const record = await this.repository.tryReadManaged(path);
        if (record === null || record.readOnly) return;
        await this.repository.updateFrontmatter(path, {
          [FRONTMATTER_KEYS.worldbuildingKind]: trimmed,
        });
      }),
    );
    let refreshed = await this.loadProject(project.projectFile);
    // Links into the moved vocabulary trees: the same pass a node rename
    // runs, with each whole root as the moved subtree.
    for (const definitionId of DEFINITION_FILE_IDS) {
      const rootPath = definitionRootPath(refreshed, trimmed, definitionId);
      const oldRoot = normalizePath(`${oldFolder}/${basename(rootPath)}`);
      await this.rewriteDefinitionReferences(
        refreshed,
        trimmed,
        rootPath,
        oldRoot,
        rootPath,
      );
    }
    // Links to the kind's own notes, wherever another member names one.
    refreshed = await this.loadProject(project.projectFile);
    for (const entity of entities) {
      const path = movedPath(entity.path);
      if (path === null) continue;
      await this.refreshMemberReferences(
        refreshed,
        entity.path,
        path,
        entity.name,
      );
    }
    // The base moved with the folder; its name and filter follow the kind.
    const oldBase = normalizePath(`${newFolder}/${safeFileName(kindId)}.base`);
    const newBase = normalizePath(`${newFolder}/${safeFileName(trimmed)}.base`);
    if (this.repository.getFile(oldBase) !== null) {
      const renamed = await this.repository.renameFile(oldBase, newBase);
      await this.repository.updatePlainFile(renamed, (content) =>
        renameWorldbuildingBaseKind(content, kindId, trimmed),
      );
    }
    const final = await this.loadProject(project.projectFile);
    const renamedKind = final.worldbuildingKinds.find(
      (candidate) => candidate.id === trimmed,
    );
    if (renamedKind === undefined) {
      throw new Error(`The kind "${trimmed}" did not register.`);
    }
    return { ok: true, kind: renamedKind };
  }

  /**
   * What deleting a kind costs, for the confirmation to read out: how many
   * notes go with the folder, and everything outside the kind that names one
   * of them, in the same buckets a single deletion shows. References between
   * the kind's own notes are not costs — they leave together.
   */
  async worldbuildingKindUsage(
    projectLocator: ProjectLocator,
    kindId: WorldbuildingKindId,
  ): Promise<{ entityCount: number; usage: MemberUsage }> {
    const project = await this.loadProject(projectLocator);
    const entities = entitiesOf(project, kindId);
    const entityPaths = new Set(
      entities.map((entity) => normalizePath(entity.path)),
    );
    // Notes of the kind itself are told apart by path, never by name: they
    // leave with the folder either way, and a member of another kind that
    // happens to share a name must keep its place in the report.
    const folder = normalizePath(worldbuildingKindFolder(project, kindId));
    const insideKind = (path: string): boolean =>
      entityPaths.has(normalizePath(path)) ||
      normalizePath(path).startsWith(`${folder}/`);
    const listed = new Set<string>();
    const needsDecision = new Set<string>();
    const records = new Set<string>();
    // One pass over the members, each record's fields and lines read once,
    // against the whole set of notes the folder will take with it.
    for (const record of await this.memberRecords(project)) {
      if (insideKind(record.path)) continue;
      const title = memberTitleOf(record);
      const namesAny = (stored: string | null, kindMatches: boolean): boolean => {
        const target = fromWikiLink(stored);
        if (target === null) return false;
        if (!target.includes("/") && !kindMatches) return false;
        return this.linkReachesAny(
          target,
          entityPaths,
          record.path,
          project.rootPath,
        );
      };
      for (const field of MEMBER_LINK_FIELDS) {
        const kindMatches = field.kind === kindId;
        const stored = record.frontmatter[field.key];
        if (field.list) {
          if (
            storedList(stored)?.some((entry) =>
              namesAny(storedReference(field, entry), kindMatches),
            )
          ) {
            listed.add(title);
          }
          continue;
        }
        const value = storedReference(field, stored);
        if (
          value !== null &&
          !isScenePovMode(value) &&
          namesAny(value, kindMatches)
        ) {
          needsDecision.add(title);
        }
      }
      if (
        memberRecordTerms(record, project.locale).some(
          (term) =>
            term.kind === "link" &&
            this.linkReachesAny(
              term.path,
              entityPaths,
              record.path,
              project.rootPath,
            ),
        )
      ) {
        records.add(title);
      }
    }
    return {
      entityCount: entities.length,
      usage: {
        listed: [...listed],
        needsDecision: [...needsDecision],
        records: [...records],
      },
    };
  }

  /**
   * linkNames against a set of members: the link resolves once, and only a
   * link that resolves nowhere falls back to reading its bare words against
   * each candidate.
   */
  private linkReachesAny(
    target: string,
    memberPaths: ReadonlySet<string>,
    sourcePath: string,
    root: string,
  ): boolean {
    const resolved = this.repository.resolveLinkWithin(target, sourcePath, root);
    if (resolved !== null) return memberPaths.has(normalizePath(resolved.path));
    const named = normalizePath(target);
    for (const wanted of memberPaths) {
      const stem = wanted.replace(/\.md$/u, "");
      if (
        named === wanted ||
        named === stem ||
        wanted.endsWith(`/${named}`) ||
        stem.endsWith(`/${named}`)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Trashes a custom kind whole: its folder with every note, vocabulary tree
   * and base inside, then the cascade a single deletion runs for each note
   * that just went — list entries drop, record lines stay for the health
   * check to report — and last the registry entry and template choice.
   */
  async deleteWorldbuildingKind(
    projectLocator: ProjectLocator,
    kindId: WorldbuildingKindId,
  ): Promise<void> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const kind = project.worldbuildingKinds.find(
      (candidate) => candidate.id === kindId,
    );
    if (kind === undefined) {
      throw new ManagedFileNotFoundError(`worldbuilding kind ${kindId}`);
    }
    if (!kind.custom) {
      throw new Error(`The built-in kind "${kindId}" cannot be deleted.`);
    }
    const folder = normalizePath(worldbuildingKindFolder(project, kindId));
    const entities = entitiesOf(project, kindId);
    if (this.repository.getFolder(folder) !== null) {
      await this.repository.trashFolder(folder);
    }
    // After the delete, as with a single member: a failure here leaves links
    // the health check can still report, not lists edited for a deletion
    // that never landed. One sweep for the whole kind.
    await this.removeReferencesToMembers(
      project,
      entities.map((entity) => entity.path),
    );
    await this.repository.updateFrontmatterAtomic(
      project.projectFile,
      (frontmatter) => {
        const patch: ManagedFrontmatter = {
          [FRONTMATTER_KEYS.worldbuildingKinds]: storedKindFolderNames(
            frontmatter,
          ).filter((entry) => entry !== kind.folderName),
        };
        // The kind's entries leave every per-kind map with it.
        for (const key of [
          FRONTMATTER_KEYS.kindTemplates,
          FRONTMATTER_KEYS.kindIcons,
          FRONTMATTER_KEYS.kindDescriptions,
        ] as const) {
          const stored = frontmatter[key];
          if (isKindStringMap(stored) && stored[kindId] !== undefined) {
            const kept: Record<string, string> = { ...stored };
            delete kept[kindId];
            patch[key] = kept;
          }
        }
        return patch;
      },
    );
  }

  /**
   * The note chosen to seed one kind's default custom fields, as stored:
   * the target path, resolved no further, so a note that has gone still
   * shows where the choice pointed.
   */
  async kindTemplatePath(
    projectLocator: ProjectLocator,
    kindId: EntityKindId,
  ): Promise<string | null> {
    const project = await this.loadProject(projectLocator);
    const record = await this.repository.tryReadManaged(project.projectFile);
    const map = record?.frontmatter[FRONTMATTER_KEYS.kindTemplates];
    if (!isKindStringMap(map)) return null;
    const stored = map[kindId];
    if (stored === undefined) return null;
    const target = (fromWikiLink(stored) ?? stored).trim();
    return target.length === 0 ? null : target;
  }

  /** Records which note seeds one kind's custom fields; null clears it. */
  async setKindTemplate(
    projectLocator: ProjectLocator,
    kindId: EntityKindId,
    path: string | null,
  ): Promise<void> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    await this.repository.updateFrontmatterAtomic(
      project.projectFile,
      (frontmatter) => {
        const stored = frontmatter[FRONTMATTER_KEYS.kindTemplates];
        const map: Record<string, string> = isKindStringMap(stored)
          ? { ...stored }
          : {};
        if (path === null || path.trim().length === 0) delete map[kindId];
        else map[kindId] = toWikiLink(path, fileStem(path));
        return { [FRONTMATTER_KEYS.kindTemplates]: map };
      },
    );
  }

  /**
   * Records how a kind presents itself — its icon and its pane sentence.
   * An empty string clears the entry: unset looks are the built-in fallback,
   * not a stored blank.
   */
  async setKindAppearance(
    projectLocator: ProjectLocator,
    kindId: WorldbuildingKindId,
    appearance: { icon: string; description: string },
  ): Promise<void> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    await this.repository.updateFrontmatterAtomic(
      project.projectFile,
      (frontmatter) => {
        const patch: ManagedFrontmatter = {};
        for (const [key, given] of [
          [FRONTMATTER_KEYS.kindIcons, appearance.icon],
          [FRONTMATTER_KEYS.kindDescriptions, appearance.description],
        ] as const) {
          const stored = frontmatter[key];
          const map: Record<string, string> = isKindStringMap(stored)
            ? { ...stored }
            : {};
          const value = given.trim();
          if (value.length === 0) delete map[kindId];
          else map[kindId] = value;
          patch[key] = map;
        }
        return patch;
      },
    );
  }

  /**
   * The default custom fields a kind's template note defines right now: the
   * protected block of a template note, or every `###` block of a free-form
   * choice from before templates had a home. An unset choice, a note that has
   * gone, and a note with no fields all seed nothing.
   */
  async kindTemplateFields(
    projectLocator: ProjectLocator,
    kindId: EntityKindId,
  ): Promise<CustomField[]> {
    const templatePath = await this.kindTemplatePath(projectLocator, kindId);
    if (templatePath === null) return [];
    const path = templatePath.endsWith(".md")
      ? templatePath
      : `${templatePath}.md`;
    const record = await this.repository.tryReadManaged(normalizePath(path));
    if (record === null) return [];
    return templateNoteFields(record.content);
  }

  /**
   * Every kind's custom-field templates, straight from the folder that holds
   * them: the note names the template, the frontmatter holds its sentence.
   */
  async listCustomFieldTemplates(
    projectLocator: ProjectLocator,
  ): Promise<Record<EntityKindId, CustomFieldTemplateInfo[]>> {
    const project = await this.loadProject(projectLocator);
    const kinds = entityKindIds(project.worldbuildingKinds);
    // The dashboard asks for this on every refresh, so the folders are read
    // off the metadata index, and side by side rather than one behind the
    // next. The write paths below keep reading the files: a collision check
    // must not trust an index that runs a beat behind its own write.
    const listings = await Promise.all(
      kinds.map((kind) => this.customFieldTemplatesOf(project, kind, "index")),
    );
    const listing: Record<EntityKindId, CustomFieldTemplateInfo[]> = {};
    kinds.forEach((kind, index) => {
      listing[kind] = listings[index]!;
    });
    return listing;
  }

  private async customFieldTemplatesOf(
    project: ProjectRef,
    kind: EntityKindId,
    from: "files" | "index" = "files",
  ): Promise<CustomFieldTemplateInfo[]> {
    const root = customFieldRootPath(project, kind);
    const records =
      from === "index"
        ? // The entries walk is recursive; only direct children are templates.
          (
            await this.repository.listManagedEntriesBelow(
              root,
              "template",
              project.id,
            )
          ).filter(
            (record) => record.path.slice(0, record.path.lastIndexOf("/")) === root,
          )
        : await this.repository.findManagedFiles(root, "template", project.id);
    return records
      .filter(
        (record) =>
          record.frontmatter[FRONTMATTER_KEYS.templateType] ===
          CUSTOM_FIELD_TEMPLATE_TYPE,
      )
      .map((record) => ({
        name: fileStem(record.path),
        description:
          asOptionalString(record.frontmatter[FRONTMATTER_KEYS.description]) ??
          "",
        path: record.path,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** The fields one template stores, for the dialog that edits them. */
  async customFieldTemplateFields(
    projectLocator: ProjectLocator,
    kind: EntityKindId,
    name: string,
  ): Promise<CustomField[]> {
    const project = await this.loadProject(projectLocator);
    const path = normalizePath(
      `${customFieldRootPath(project, kind)}/${name}.md`,
    );
    const record = await this.repository.tryReadManaged(path);
    if (record === null) return [];
    return templateNoteFields(record.content);
  }

  /**
   * Writes one custom-field template into the kind's template folder. A new
   * name makes a new note; `previousName` says a standing template is being
   * edited, name change included; `overwrite` lets an export land on a taken
   * name, replacing that note but keeping its identity. Refusals are returned
   * rather than thrown so the dialog can say why in the project's language.
   */
  async saveCustomFieldTemplate(
    projectLocator: ProjectLocator,
    kind: EntityKindId,
    input: {
      name: string;
      description: string;
      fields: readonly CustomField[];
    },
    options: { previousName?: string; overwrite?: boolean } = {},
  ): Promise<SaveCustomFieldTemplateResult> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const name = input.name.trim();
    if (name.length === 0 || safeFileName(name) !== name) {
      return { ok: false, code: "invalid-name" };
    }
    const root = customFieldRootPath(project, kind);
    const existing = await this.customFieldTemplatesOf(project, kind);
    const previous =
      options.previousName === undefined
        ? null
        : (existing.find(
            (candidate) => candidate.name === options.previousName,
          ) ?? null);
    if (options.previousName !== undefined && previous === null) {
      throw new ManagedFileNotFoundError(
        normalizePath(`${root}/${options.previousName}.md`),
      );
    }
    const collision =
      existing.find(
        (candidate) =>
          candidate !== previous && foldName(candidate.name) === foldName(name),
      ) ?? null;
    // Only an export may land on a taken name; an edit renamed onto another
    // template is refused, because replacing a second note was never asked.
    if (collision !== null && (previous !== null || options.overwrite !== true)) {
      return { ok: false, code: "taken" };
    }
    let path = collision?.path ?? previous?.path ?? null;
    if (previous !== null && collision === null && previous.name !== name) {
      const destination = normalizePath(`${root}/${name}.md`);
      await this.repository.renameFile(previous.path, destination);
      await this.retargetKindTemplateEntries(
        project,
        stripMarkdownExtension(previous.path),
        stripMarkdownExtension(destination),
      );
      path = destination;
    }
    const description = input.description.trim();
    const identity =
      path === null
        ? null
        : normalizeStableId(
            (await this.repository.tryReadManaged(path))?.frontmatter[
              FRONTMATTER_KEYS.templateId
            ],
          );
    const frontmatter: ManagedFrontmatter = {
      ...commonFrontmatter("template", project.id),
      [FRONTMATTER_KEYS.templateType]: CUSTOM_FIELD_TEMPLATE_TYPE,
      [FRONTMATTER_KEYS.templateId]:
        identity ?? createStableId("field-template"),
      ...(description.length > 0
        ? { [FRONTMATTER_KEYS.description]: description }
        : {}),
    };
    const template = customFieldTemplateNote(input.fields);
    if (path === null) {
      const created = normalizePath(`${root}/${name}.md`);
      await this.repository.createManagedFile({
        path: created,
        template,
        frontmatter,
      });
      return { ok: true, path: created };
    }
    await this.repository.replaceManagedFile(path, template, frontmatter);
    return { ok: true, path };
  }

  /** Trashes one template and clears every choice that pointed at it. */
  async deleteCustomFieldTemplate(
    projectLocator: ProjectLocator,
    kind: EntityKindId,
    name: string,
  ): Promise<void> {
    const project = await this.loadProject(projectLocator);
    this.assertProjectWritable(project);
    const existing = await this.customFieldTemplatesOf(project, kind);
    const template =
      existing.find((candidate) => candidate.name === name) ?? null;
    if (template === null) {
      throw new ManagedFileNotFoundError(
        normalizePath(`${customFieldRootPath(project, kind)}/${name}.md`),
      );
    }
    await this.repository.trashFile(template.path);
    await this.retargetKindTemplateEntries(
      project,
      stripMarkdownExtension(template.path),
      null,
    );
  }

  /**
   * Follows a template note wherever it goes: every kind whose stored choice
   * named the old path is pointed at the new one, or cleared when the note is
   * gone for good.
   */
  private async retargetKindTemplateEntries(
    project: ProjectRef,
    from: string,
    to: string | null,
  ): Promise<void> {
    const record = await this.repository.tryReadManaged(project.projectFile);
    const stored = record?.frontmatter[FRONTMATTER_KEYS.kindTemplates];
    if (!isKindStringMap(stored)) return;
    const matches = Object.values(stored).some(
      (value) => (fromWikiLink(value) ?? value).trim() === from,
    );
    if (!matches) return;
    await this.repository.updateFrontmatterAtomic(
      project.projectFile,
      (frontmatter) => {
        const current = frontmatter[FRONTMATTER_KEYS.kindTemplates];
        const map: Record<string, string> = isKindStringMap(current)
          ? { ...current }
          : {};
        for (const [entryKind, value] of Object.entries(map)) {
          if ((fromWikiLink(value) ?? value).trim() !== from) continue;
          if (to === null) delete map[entryKind];
          else map[entryKind] = toWikiLink(to, fileStem(to));
        }
        return { [FRONTMATTER_KEYS.kindTemplates]: map };
      },
    );
  }

  /**
   * Takes an emptied record section out of the note together with the heading
   * the plugin created it under, returning the note to its deferred state. A
   * section that still holds lines the grammar cannot read is never removed:
   * those lines are the author's.
   */
  private async removeEmptiedRecordSections(
    entity: {
      path: string;
      worldStatus: readonly unknown[];
      relationships: readonly unknown[];
      worldStatusUnrecognized: readonly string[];
      relationshipsUnrecognized: readonly string[];
      customFields: string;
    },
    nextRecords: {
      worldStatus: readonly unknown[];
      relationships: readonly unknown[];
    },
    nextCustomFields?: string,
  ): Promise<void> {
    const emptied: Array<{ sectionId: string; headings: string[] }> = [];
    // The custom-fields block goes the way a record section goes: deferred
    // in, removed whole when the last field leaves.
    if (
      entity.customFields.trim().length > 0 &&
      (nextCustomFields ?? entity.customFields).trim().length === 0
    ) {
      emptied.push({ sectionId: "custom-fields", headings: [] });
    }
    const consider = (
      sectionId: RecordSectionId,
      had: boolean,
      hasNow: boolean,
      unrecognized: readonly string[],
    ): void => {
      if (had && !hasNow && unrecognized.length === 0) {
        // No headings to absorb: a record section is a callout that names
        // itself, and nothing above it belongs to the plugin.
        emptied.push({ sectionId, headings: [] });
      }
    };
    consider(
      "world-status",
      entity.worldStatus.length > 0,
      nextRecords.worldStatus.length > 0,
      entity.worldStatusUnrecognized,
    );
    consider(
      "relationships",
      entity.relationships.length > 0,
      nextRecords.relationships.length > 0,
      entity.relationshipsUnrecognized,
    );
    if (emptied.length === 0) return;
    await this.repository.reshapeSections(entity.path, {
      values: {},
      layout: [],
      remove: emptied,
    });
  }

  private readonly entityReadings = new WeakMap<
    ManagedFileRecord,
    Pick<
      WorldbuildingRecord,
      | "worldStatus"
      | "relationships"
      | "worldStatusUnrecognized"
      | "relationshipsUnrecognized"
      | "notes"
      | "customFields"
      | "sectionHealth"
      | "revision"
    >
  >();

  private entityFromRecord(
    record: ManagedFileRecord,
    locale: ProjectLanguage,
  ): WorldbuildingRecord {
    const entityId = asOptionalString(record.frontmatter[FRONTMATTER_KEYS.entityId]);
    const projectId = projectIdOf(record.frontmatter);
    const kindValue = record.frontmatter[FRONTMATTER_KEYS.worldbuildingKind];
    const kind =
      typeof kindValue === "string" && kindValue.trim().length > 0
        ? kindValue.trim()
        : null;
    if (!entityId || !projectId || kind === null) {
      throw new InvalidManagedDocumentError(
        `Worldbuilding metadata is incomplete in "${record.path}".`,
        record.path,
      );
    }
    const rank = storedRank(record.frontmatter);
    let reading = this.entityReadings.get(record);
    if (reading === undefined) {
      const worldStatus = parseRecordSectionLenient(
        locale,
        readMarkedSection(record.content, "world-status") ?? "",
      );
      const relationships = parseRecordSectionLenient(
        locale,
        readMarkedSection(record.content, "relationships") ?? "",
      );
      reading = {
        worldStatus: worldStatus.records,
        worldStatusUnrecognized: worldStatus.unrecognized,
        relationships: relationships.records,
        relationshipsUnrecognized: relationships.unrecognized,
        notes: readMarkedSection(record.content, "entity-notes") ?? "",
        customFields: readMarkedSection(record.content, "custom-fields") ?? "",
        sectionHealth: memberSectionHealth(record.content, "worldbuilding", record.path),
        revision: fingerprint(record.content),
      };
      this.entityReadings.set(record, reading);
    }
    const progressStatusValue = record.frontmatter[FRONTMATTER_KEYS.progressStatus];
    const timeKindValue = record.frontmatter[FRONTMATTER_KEYS.timeKind];
    return {
      id: entityId,
      entityId,
      projectId,
      path: record.path,
      kind,
      name:
        asOptionalString(record.frontmatter[FRONTMATTER_KEYS.name]) ??
        fileStem(record.path),
      rank: rank ?? RANK_GAP,
      hasStoredRank: rank !== null,
      progressStatus: isProgressStatus(progressStatusValue) ? progressStatusValue : null,
      aliases: readStringList(record.frontmatter[ALIASES_KEY]),
      categories: readStringList(record.frontmatter[FRONTMATTER_KEYS.category]),
      description: asString(record.frontmatter[FRONTMATTER_KEYS.description]),
      timeKind: isTimeKind(timeKindValue) ? timeKindValue : null,
      timeStart: asString(record.frontmatter[FRONTMATTER_KEYS.timeStart]),
      timeEnd: asString(record.frontmatter[FRONTMATTER_KEYS.timeEnd]),
      ...reading,
      // Entities change nothing but the stamp between schemas, so the stamp
      // is the whole test of whether the migration has reached the note.
      unmigrated: (record.schemaVersion ?? 0) < SCHEMA_VERSION,
      readOnly: record.readOnly,
    };
  }

  /**
   * Writes back the ranks a reorder changed. A note that stored no usable rank
   * is always written even when its computed rank is unchanged: its in-memory
   * value was only the fallback, so skipping it would drop the new order on the
   * next load.
   */
  private async persistReorderedRanks(
    before: readonly { id: string; path: string; rank: number; hasStoredRank: boolean }[],
    after: readonly { id: string; path: string; rank: number }[],
  ): Promise<void> {
    const previous = new Map(
      before.map((item) => [item.id, item] as const),
    );
    for (const item of after) {
      const stored = previous.get(item.id);
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
      // The whole subtree votes: worldbuilding notes live one kind folder
      // down, definition `_self.md` notes deeper still, and every one of
      // them carries the very stamp being recovered.
      const queue: string[] = [folderPath];
      while (queue.length > 0) {
        const current = queue.pop() as string;
        for (const child of this.repository.listDirectFolders(current)) {
          queue.push(child.path);
        }
        for (const file of this.repository.listDirectFiles(current)) {
          if (file.extension !== "md") continue;
          const record = await this.repository.tryReadManaged(file.path);
          if (!record || record.readOnly || !isProjectDocumentType(documentTypeOf(record.frontmatter))) {
            continue;
          }
          const candidate = normalizeStableId(record.frontmatter[FRONTMATTER_KEYS.projectId]);
          if (candidate) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
        }
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
    // The role is an authorial decision. A note without the legacy type key
    // is a migrated note or a roleless one, and a value that does not read
    // is the author's to put right: the repair never invents or moves a
    // role, the same rule the per-note safe repair follows.
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
    // The conflict property is never backfilled onto a note that lacks it:
    // absence is what marks the legacy section as the live copy, and writing
    // an empty property here would silently override that text. Only a
    // property that exists with a non-string value is normalized.
    if (
      hasOwn(record.frontmatter, FRONTMATTER_KEYS.conflict) &&
      typeof record.frontmatter[FRONTMATTER_KEYS.conflict] !== "string"
    ) {
      patch[FRONTMATTER_KEYS.conflict] = "";
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
    // Legacy sections are not part of the template any more, but a copy still
    // sitting in an unmigrated note must keep its damage checked: until the
    // migration runs, it is the live store for its field.
    const documentType = documentTypeOf(record.frontmatter);
    const checkList: ManagedSectionDefinition[] = [...template.sections];
    const optional = new Set<string>();
    if (isDocumentType(documentType)) {
      for (const id of optionalSectionIds(documentType)) optional.add(id);
      for (const descriptor of managedSectionsForDocument(documentType)) {
        if (
          descriptor.legacy === true &&
          !checkList.some((section) => section.id === descriptor.id)
        ) {
          checkList.push({ id: descriptor.id, heading: "" });
        }
      }
    }
    const check = await this.repository.checkSections(
      record.path,
      checkList,
      optional,
    );
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
      worldbuildingKinds: this.readWorldbuildingKinds(
        record.frontmatter,
        rootPath,
        locale,
      ).kinds,
    };
  }

  /**
   * The kinds a metadata note declares: the built-ins, then the registered
   * custom kinds in registry order. The registry is authoritative — a folder
   * no entry names is not a kind — and reading it settles collisions the
   * validation could not have allowed but a hand edit can create: the first
   * entry to spell an id keeps it, and every later one is handed back for the
   * structure check to report.
   */
  private readWorldbuildingKinds(
    frontmatter: ManagedFrontmatter,
    rootPath: string,
    locale: ProjectLanguage,
  ): { kinds: ProjectWorldbuildingKind[]; invalidEntries: string[] } {
    const layout = getProjectPathLayout(locale);
    // A custom kind's looks ride two per-kind maps; a built-in's belong to
    // the program, so for one the maps are never consulted.
    const icons = frontmatter[FRONTMATTER_KEYS.kindIcons];
    const descriptions = frontmatter[FRONTMATTER_KEYS.kindDescriptions];
    const appearance = (id: string, map: unknown): string | null => {
      if (!isKindStringMap(map)) return null;
      const stored = map[id]?.trim() ?? "";
      return stored.length === 0 ? null : stored;
    };
    const describe = (
      id: string,
      folderName: string,
      custom: boolean,
    ): ProjectWorldbuildingKind => ({
      id,
      folderName,
      custom,
      icon: custom ? appearance(id, icons) : null,
      description: custom ? appearance(id, descriptions) : null,
    });
    const kinds = WORLDBUILDING_KINDS.map((kind) =>
      describe(kind, layout.worldbuildingKinds[kind], false),
    );
    const taken = new Set(reservedKindFolds());
    const invalidEntries: string[] = [];
    const stored = frontmatter[FRONTMATTER_KEYS.worldbuildingKinds];
    for (const value of Array.isArray(stored) ? stored : []) {
      const folderName = typeof value === "string" ? value.trim() : "";
      const id = kindIdFromFolderName(folderName);
      if (
        folderName.length === 0 ||
        id.length === 0 ||
        folderName.includes("/") ||
        taken.has(foldName(id))
      ) {
        invalidEntries.push(typeof value === "string" ? value : String(value));
        continue;
      }
      taken.add(foldName(id));
      kinds.push(describe(id, folderName, true));
    }
    return { kinds, invalidEntries };
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
      worldbuildingKinds: this.readWorldbuildingKinds(
        record.frontmatter,
        rootPath,
        locale,
      ).kinds,
    };
  }

  private async inspectProjectStructure(
    project: ProjectRef,
    projectRecord: ManagedFileRecord,
    draftPath: string | null,
    manuscript: readonly ManuscriptSegmentRecord[],
    unregisteredKindNotes: ReadonlyMap<string, string[]> = new Map(),
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
          return Number.isInteger(numeric) && numeric >= MIN_SUPPORTED_SCHEMA_VERSION;
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
        // The key stays on the issue because the repair works one property at a
        // time; the report reads it off the list like every other finding.
        field: check.field,
        names: [check.field],
        canOpen: true,
        repairable: isSafelyRepairableProjectMetadataIssue(
          exists ? "invalid-metadata-field" : "missing-metadata-field",
          check.field,
          metadata,
          recoveredProjectId,
        ),
      });
    }

    // The folder is what the Vault calls the project and the stored name is what
    // the dashboard calls it, and Rename project is what keeps them the same. A
    // folder renamed from the file explorer never reaches the stored name, and
    // nothing else compares the two, so the project would go on answering to a
    // name that is nowhere in the Vault without ever saying so.
    const expectedFolder = trySafeFileName(project.title);
    const projectFolder = normalizePath(project.rootPath);
    if (
      expectedFolder !== null &&
      !stemMatchesTitle(basename(projectFolder), expectedFolder)
    ) {
      add({
        code: "mismatched-project-folder",
        path: projectFolder,
        stepIds: [],
        expected: project.title,
        canOpen: false,
        repairable:
          !projectRecord.readOnly &&
          this.repository.get(`${parentOf(projectFolder)}/${expectedFolder}`) ===
            null,
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
      worldbuilding: [],
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
    for (const kind of project.worldbuildingKinds) {
      const path = normalizePath(worldbuildingKindFolder(project, kind.id));
      if (this.repository.getFolder(path) !== null) continue;
      add({
        code: "missing-directory",
        path,
        stepIds: [],
        canOpen: false,
        repairable: this.repository.get(path) === null,
      });
    }
    // The template folder every kind carries: unlike a vocabulary root, whose
    // absence the tree walk tolerates, this one is reported so the repair can
    // put it back before anyone reaches for the templates inside.
    for (const kind of entityKindIds(project.worldbuildingKinds)) {
      const path = customFieldRootPath(project, kind);
      if (this.repository.getFolder(path) !== null) continue;
      add({
        code: "missing-directory",
        path,
        stepIds: [],
        canOpen: false,
        repairable: this.repository.get(path) === null,
      });
    }

    // The registry itself: a hand edit can leave entries no reading honors —
    // a value that is not a list, an entry that shadows a built-in, or two
    // spelling the same id, where the first won above. One issue names them
    // all, and its repair rewrites the key to the entries that stood.
    const registryValue = metadata[FRONTMATTER_KEYS.worldbuildingKinds];
    const registryReading = this.readWorldbuildingKinds(
      metadata,
      project.rootPath,
      project.locale,
    );
    const registryComplaints =
      hasOwn(metadata, FRONTMATTER_KEYS.worldbuildingKinds) &&
      !Array.isArray(registryValue)
        ? [FRONTMATTER_KEYS.worldbuildingKinds as string]
        : registryReading.invalidEntries;
    if (registryComplaints.length > 0) {
      add({
        code: "invalid-metadata-field",
        path: projectRecord.path,
        stepIds: [],
        field: FRONTMATTER_KEYS.worldbuildingKinds,
        names: registryComplaints,
        canOpen: true,
        repairable: !projectRecord.readOnly,
      });
    }
    for (const key of [
      FRONTMATTER_KEYS.kindTemplates,
      FRONTMATTER_KEYS.kindIcons,
      FRONTMATTER_KEYS.kindDescriptions,
    ] as const) {
      if (hasOwn(metadata, key) && !isKindStringMap(metadata[key])) {
        add({
          code: "invalid-metadata-field",
          path: projectRecord.path,
          stepIds: [],
          field: key,
          names: [key],
          canOpen: true,
          repairable: !projectRecord.readOnly,
        });
      }
    }

    // Notes wearing a kind the registry does not list: invisible to every
    // table until the kind is back, so each such id is reported with the
    // notes carrying it, and the repair registers the kind again.
    for (const [kindId, notes] of unregisteredKindNotes) {
      add({
        code: "unregistered-worldbuilding-kind",
        path: normalizePath(
          `${project.rootPath}/${layout.directories.worldbuilding}`,
        ),
        stepIds: [],
        field: kindId,
        expected: kindId,
        names: notes.map((note) => this.reportName(note, project.rootPath)),
        canOpen: false,
        // Repairable only when the repair itself would go through: the same
        // registry and the same slot pool the registration will check.
        repairable:
          !projectRecord.readOnly &&
          validateKindName(kindId, project.worldbuildingKinds) === null &&
          nextCustomKindPrefix(project.worldbuildingKinds) !== null,
      });
    }

    // Every folder under a definition root is a node, and every node must
    // hold its `_self.md`: the folder is what makes the node exist, and the
    // note is what its links resolve to. The walk stops where reading does.
    for (const kind of entityKindIds(project.worldbuildingKinds)) {
      for (const definitionId of DEFINITION_FILE_IDS) {
        const rootPath = definitionRootPath(project, kind, definitionId);
        if (this.repository.getFolder(rootPath) === null) continue;
        const visit = (folderPath: string, depth: number): void => {
          if (depth > MAX_DEFINITION_DEPTH) return;
          if (depth > 0) {
            const leafPath = normalizePath(
              `${folderPath}/${basename(folderPath)}.md`,
            );
            if (this.standingNodeNotePath(folderPath) === null) {
              add({
                code: "missing-definition-node",
                path: folderPath,
                stepIds: [],
                canOpen: false,
                repairable:
                  !projectRecord.readOnly &&
                  this.repository.get(leafPath) === null,
              });
            }
          }
          for (const child of this.repository.listDirectFolders(folderPath)) {
            visit(`${folderPath}/${child.name}`, depth + 1);
          }
        };
        visit(rootPath, 0);
      }
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
    for (const base of getProjectBases(
      project.id,
      project.locale,
      characterRoleLinks(project),
      project.worldbuildingKinds,
    )) {
      const directory = normalizePath(
        `${project.rootPath}/${projectBaseFolder(project, base.id)}`,
      );
      if (this.repository.getFolder(directory) === null) continue;
      const path = normalizePath(`${directory}/${base.fileName}`);
      if (this.repository.getFile(path) !== null) continue;
      add({
        code: "missing-base",
        path,
        stepIds:
          base.id === "characters" || base.id === "scenes"
            ? [...directorySteps[base.id]]
            : [],
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

    // Links this project stored before the plugin started writing them the way
    // Obsidian does. Nothing about them is broken -- both forms are read -- so
    // they are gathered into one report for the project rather than raised
    // against each note that has one.
    // Which notes carry them, not how many there are: a count says a number
    // where every other row says what it found.
    const datedNotes: string[] = [];
    if ((this.extensionTidyPatch(projectRecord)?.links ?? 0) > 0) {
      datedNotes.push(this.reportName(projectRecord.path, project.rootPath));
    }

    // The same drift, wherever a member keeps its name: the file it is filed
    // as and the heading it opens with are both brought to the name the note
    // stores, because that is the name the dashboard shows.
    const inspectTitle = (
      record: ManagedFileRecord,
      code:
        | "mismatched-character-title"
        | "mismatched-scene-title"
        | "mismatched-entity-title",
      stepIds: StepId[],
    ): void => {
      const storedTitle = memberStoredTitle(record);
      if (storedTitle === null) return;
      const expectedStem = trySafeFileName(storedTitle);
      const heading = firstHeading(record.body);
      const fileNameDrifted =
        expectedStem !== null &&
        !stemMatchesTitle(fileStem(record.path), expectedStem);
      // An absent heading is left alone. The author may have removed it on
      // purpose, and repairing would add content rather than correct it.
      const headingDrifted =
        heading !== null && heading !== normalizeHeading(storedTitle);
      if (!fileNameDrifted && !headingDrifted) return;
      add({
        code,
        path: record.path,
        stepIds,
        expected: storedTitle,
        canOpen: true,
        repairable: !record.readOnly,
      });
    };

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
        inspectTitle(
          record,
          documentType === "character"
            ? "mismatched-character-title"
            : "mismatched-scene-title",
          stepIds,
        );

        // Deleting a character leaves the links scenes stored for it pointing
        // at nothing. Obsidian treats those as ordinary unresolved links and
        // offers to create the note, which would resurrect the character as an
        // empty stub, so the project has to notice the breakage itself.
        this.inspectMemberLinks(project, record, stepIds, add);
        if (documentType === "scene") {
          // The point of view is deliberately absent from what a repair
          // touches, so a scene left without one is reported on its own: which
          // character now carries the scene is the author's to decide.
          const pov = this.classifyLink(
            asOptionalString(record.frontmatter[FRONTMATTER_KEYS.pov]),
            record.path,
            project.rootPath,
          );
          if (pov.kind === "foreign" || pov.kind === "missing") {
            add({
              code: "dangling-scene-pov",
              path: record.path,
              stepIds,
              names: [this.reportName(pov.path, project.rootPath)],
              canOpen: true,
              repairable: false,
            });
          }
        }
        // Read while the note is open anyway; reported once for the project
        // below, since one note at a time would be a long list of the same
        // one-time change.
        if ((this.extensionTidyPatch(record)?.links ?? 0) > 0) {
          datedNotes.push(this.reportName(record.path, project.rootPath));
        }

        this.inspectMemberDefinitionLinks(
          project,
          documentType,
          record,
          stepIds,
          add,
        );
        this.inspectMemberRecordLinks(project, record, stepIds, add);

        // A role is a category like any other, so having none is a choice, not
        // damage. What a character must have is its identity: a unique id and
        // a name -- and a legacy role key that still reads, because the
        // migration deletes that key, and it must never delete a role it
        // could not first read.
        const typeReadable =
          documentType !== "character" ||
          !hasOwn(record.frontmatter, FRONTMATTER_KEYS.characterType) ||
          isCharacterType(record.frontmatter[FRONTMATTER_KEYS.characterType]);
        const typeSpecificValid =
          documentType === "character"
            ? stableIdIsUnique &&
              typeReadable &&
              asOptionalString(record.frontmatter[FRONTMATTER_KEYS.characterName]) !== null
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
          // A role value nobody can read is the author's to put right: the
          // repair never guesses a role, so it cannot mend this one.
          repairable:
            typeReadable &&
            (documentType === "character"
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
                ) !== null),
        });
      }
    };
    await inspectCollection("characters", "character", [3, 5, 7]);
    await inspectCollection("scenes", "scene", [8, 9]);

    // Worldbuilding notes are members like any other and are inspected like
    // any other: the name they are filed under, the links they store, and the
    // metadata that makes them readable at all. No step hinges on them, so
    // their issues arrive with no step attached.
    for (const kind of project.worldbuildingKinds) {
      const folderPath = normalizePath(
        worldbuildingKindFolder(project, kind.id),
      );
      if (this.repository.getFolder(folderPath) === null) continue;
      const stableIds = new Set<string>();
      const usedRanks = new Set<number>();
      for (const file of this.repository.listDirectFiles(folderPath)) {
        if (file.extension !== "md") continue;
        const record = await this.repository.tryReadManaged(file.path);
        if (record === null) continue;
        if (record.schemaVersion !== null && record.schemaVersion > SCHEMA_VERSION) {
          continue;
        }
        // A note whose metadata says nothing is still one of these if it
        // carries the block this plugin writes: that is the note whose
        // identity has to be reported rather than quietly skipped.
        const looksManaged =
          documentTypeOf(record.frontmatter) === "worldbuilding" ||
          record.content.includes("snowflake:section:entity-fields");
        if (!looksManaged) continue;
        const stableId = asOptionalString(
          record.frontmatter[FRONTMATTER_KEYS.entityId],
        );
        const idsBeforeCurrent = new Set(stableIds);
        const ranksBeforeCurrent = new Set(usedRanks);
        const stableIdIsUnique = stableId !== null && !stableIds.has(stableId);
        if (stableId !== null) stableIds.add(stableId);
        const rawRank = record.frontmatter[FRONTMATTER_KEYS.rank];
        if (typeof rawRank === "number" && Number.isSafeInteger(rawRank)) {
          usedRanks.add(rawRank);
        }

        inspectTitle(record, "mismatched-entity-title", []);
        if ((this.extensionTidyPatch(record)?.links ?? 0) > 0) {
          datedNotes.push(this.reportName(record.path, project.rootPath));
        }
        this.inspectMemberDefinitionLinks(project, kind.id, record, [], add);
        this.inspectMemberRecordLinks(project, record, [], add);
        this.inspectMemberLinks(project, record, [], add);

        // A period is written between two moments, and those two are notes.
        // Emptying one is no repair -- the period would then say less than its
        // author meant -- so a broken end is named and left.
        const ends = new Set<string>();
        for (const key of [FRONTMATTER_KEYS.timeStart, FRONTMATTER_KEYS.timeEnd]) {
          const stored = asOptionalString(record.frontmatter[key]);
          if (stored === null || stored.trim().length === 0) continue;
          const term = parseTerm(stored);
          if (term.kind !== "link") continue;
          if (this.repository.resolveLink(term.path, record.path) !== null) continue;
          ends.add(this.reportName(term.path, project.rootPath));
        }
        if (ends.size > 0) {
          add({
            code: "dangling-time-span",
            path: record.path,
            stepIds: [],
            names: [...ends],
            canOpen: true,
            repairable: false,
          });
        }

        // What an entity must have is what makes it readable: a unique id, a
        // name, and a kind the project lists — custom kinds included, because
        // a registered kind's notes are as readable as a built-in's.
        const stampedKind = asOptionalString(
          record.frontmatter[FRONTMATTER_KEYS.worldbuildingKind],
        );
        if (
          isCurrentOrNewerSchema(record.frontmatter) &&
          documentTypeOf(record.frontmatter) === "worldbuilding" &&
          hasMatchingProjectId(record.frontmatter) &&
          stableIdIsUnique &&
          asOptionalString(record.frontmatter[FRONTMATTER_KEYS.name]) !== null &&
          stampedKind !== null &&
          project.worldbuildingKinds.some(
            (candidate) => candidate.id === stampedKind,
          )
        ) {
          continue;
        }
        add({
          code: "invalid-artifact-metadata",
          path: record.path,
          stepIds: [],
          expected: "worldbuilding",
          canOpen: true,
          repairable:
            safeEntityMetadataRepairPatch(
              record,
              project.id,
              kind.id,
              idsBeforeCurrent,
              ranksBeforeCurrent,
            ) !== null,
        });
      }
    }

    // The draft link belongs to the project note rather than to any scene, and
    // is just as capable of being typed out as plain text.
    const draftLink = this.classifyLink(
      asOptionalString(projectRecord.frontmatter[FRONTMATTER_KEYS.draft]),
      projectRecord.path,
      project.rootPath,
    );
    if (draftLink.kind === "unlinked" || draftLink.kind === "incomplete") {
      add({
        code: draftLink.kind === "unlinked" ? "unlinked-path" : "incomplete-link",
        path: projectRecord.path,
        stepIds: [10],
        names: [this.reportName(draftLink.path, project.rootPath)],
        canOpen: true,
        repairable: !projectRecord.readOnly,
      });
    }

    if (datedNotes.length > 0) {
      add({
        code: "extension-in-link",
        path: project.rootPath,
        stepIds: [],
        names: datedNotes,
        canOpen: false,
        repairable: true,
      });
    }

    // A manuscript reads in the order its notes store, so a note with nowhere
    // to sit, a note sitting somewhere unreadable, and two notes sitting in the
    // same place each stop the manuscript being a sequence. Each is repaired by
    // writing positions and nothing else, so none of them touches prose.
    //
    // Read off the manuscript this was handed rather than gathered again: each
    // segment carries the position its frontmatter wrote as well as the one the
    // manuscript resolved, which is the whole of what this needs.
    const sequenceIssues = findSequenceIssues(manuscript);
    const sequenceCodes = [
      ["missing-manuscript-sequence", sequenceIssues.missing],
      ["invalid-manuscript-sequence", sequenceIssues.invalid],
      ["duplicate-manuscript-sequence", sequenceIssues.duplicate],
    ] as const;
    for (const [code, paths] of sequenceCodes) {
      // Reported against the first note it applies to rather than against the
      // folder, so the author can open the note the sentence is about. A note
      // falls into exactly one of the three, so the three never collide.
      const first = paths[0];
      if (first === undefined) continue;
      add({
        code,
        path: first,
        stepIds: [10],
        names: paths.map((path) => this.reportName(path, project.rootPath)),
        canOpen: true,
        repairable: !projectRecord.readOnly,
      });
    }

    // Step 10's artifact is the manuscript, not a note with a particular name.
    // A project with notes in it is not missing anything, however they are
    // called and wherever they are filed; a project with none of them is.
    const canonicalDraftPath = normalizePath(
      `${project.rootPath}/${layout.directories.draft}/${layout.draftFileName}`,
    );
    if (manuscript.length === 0) {
      // With no manuscript at all, whatever the project links to is the only
      // clue to where the prose went. A real note whose metadata no longer says
      // it belongs here is why the manuscript is empty, and is reported as
      // itself rather than as an absence.
      const named =
        draftPath === null ? null : this.repository.getFile(draftPath);
      const record =
        named === null ? null : await this.repository.readManaged(named.path);
      if (
        record !== null &&
        record.schemaVersion !== null &&
        record.schemaVersion > SCHEMA_VERSION
      ) {
        return issues.sort((left, right) =>
          left.path.localeCompare(right.path, "en", { numeric: true }),
        );
      }
      if (
        record !== null &&
        (documentTypeOf(record.frontmatter) !== "draft" ||
          !hasMatchingProjectId(record.frontmatter) ||
          !isCurrentOrNewerSchema(record.frontmatter))
      ) {
        add({
          code: "invalid-artifact-metadata",
          path: record.path,
          stepIds: [10],
          expected: "draft",
          canOpen: true,
          repairable:
            safeCommonMetadataRepairPatch(record, "draft", project.id) !== null,
        });
      } else {
        add({
          code: "missing-artifact",
          path: canonicalDraftPath,
          stepIds: [10],
          expected: "draft",
          canOpen: false,
          // A manuscript can always be started: the first note is written where
          // this project keeps its manuscript, or the note it already has is
          // brought there. Leaving the author no way out would be the worse
          // answer.
          repairable: true,
        });
      }
    }

    return issues.sort((left, right) =>
      left.path.localeCompare(right.path, "en", { numeric: true }),
    );
  }

  /**
   * The parts of a member note that follow from its bytes alone — the marked
   * sections, their health, the revision hash — parsed once per record. The
   * repository hands back the same record for as long as the file stands
   * unchanged, so the parse rides the record's own lifetime. Link resolution
   * is deliberately not in here: what a link reaches can change while the
   * note holding it does not.
   */
  private readonly characterReadings = new WeakMap<
    ManagedFileRecord,
    Pick<
      CharacterRecord,
      | "worldStatus"
      | "relationships"
      | "worldStatusUnrecognized"
      | "relationshipsUnrecognized"
      | "oneParagraphStoryline"
      | "characterSynopsis"
      | "characterProfile"
      | "customFields"
      | "sectionHealth"
      | "unmigrated"
      | "revision"
    >
  >();

  private readonly sceneReadings = new WeakMap<
    ManagedFileRecord,
    Pick<
      SceneRecord,
      | "conflict"
      | "worldStatus"
      | "relationships"
      | "worldStatusUnrecognized"
      | "relationshipsUnrecognized"
      | "events"
      | "planning"
      | "customFields"
      | "sectionHealth"
      | "unmigrated"
      | "revision"
    >
  >();

  private characterFromRecord(
    record: ManagedFileRecord,
    locale: ProjectLanguage,
  ): CharacterRecord {
    const characterId = asOptionalString(record.frontmatter[FRONTMATTER_KEYS.characterId]);
    const projectId = projectIdOf(record.frontmatter);
    if (!characterId || !projectId) {
      throw new InvalidManagedDocumentError(`Character metadata is incomplete in "${record.path}".`, record.path);
    }
    const characterTypeValue = record.frontmatter[FRONTMATTER_KEYS.characterType];
    const rank = storedRank(record.frontmatter);
    let reading = this.characterReadings.get(record);
    if (reading === undefined) {
      const worldStatus = parseRecordSectionLenient(
        locale,
        readMarkedSection(record.content, "world-status") ?? "",
      );
      const relationships = parseRecordSectionLenient(
        locale,
        readMarkedSection(record.content, "relationships") ?? "",
      );
      reading = {
        worldStatus: worldStatus.records,
        worldStatusUnrecognized: worldStatus.unrecognized,
        relationships: relationships.records,
        relationshipsUnrecognized: relationships.unrecognized,
        oneParagraphStoryline: readMarkedSection(record.content, "one-paragraph-storyline") ?? "",
        characterSynopsis: readMarkedSection(record.content, "character-synopsis") ?? "",
        characterProfile: readMarkedSection(record.content, "character-profile") ?? "",
        customFields: readMarkedSection(record.content, "custom-fields") ?? "",
        sectionHealth: memberSectionHealth(record.content, "character", record.path),
        // A note the schema 2 migration has not reached: an older schema
        // stamp, no fields block yet, or the role still stored under the
        // legacy type key instead of as a category link.
        unmigrated:
          (schemaVersionOf(record.frontmatter) ?? 0) < SCHEMA_VERSION ||
          readMarkedSection(record.content, "character-fields") === null ||
          hasOwn(record.frontmatter, FRONTMATTER_KEYS.characterType),
        revision: fingerprint(record.content),
      };
      this.characterReadings.set(record, reading);
    }
    const progressStatusValue = record.frontmatter[FRONTMATTER_KEYS.progressStatus];
    return {
      id: characterId,
      characterId,
      projectId,
      path: record.path,
      name:
        asOptionalString(record.frontmatter[FRONTMATTER_KEYS.characterName]) ?? fileStem(record.path),
      rank: rank ?? RANK_GAP,
      hasStoredRank: rank !== null,
      // The role is whichever category names one, or the legacy key on a note
      // the migration has not reached. A character with neither has no role,
      // which is now an ordinary thing to be.
      type:
        characterRoleFromCategories(record.frontmatter[FRONTMATTER_KEYS.category]) ??
        (isCharacterType(characterTypeValue) ? characterTypeValue : null),
      progressStatus: isProgressStatus(progressStatusValue) ? progressStatusValue : null,
      aliases: readStringList(record.frontmatter[ALIASES_KEY]),
      categories: readStringList(record.frontmatter[FRONTMATTER_KEYS.category]),
      oneSentenceStoryline: asString(record.frontmatter[FRONTMATTER_KEYS.oneSentenceStoryline]),
      motivation: asString(record.frontmatter[FRONTMATTER_KEYS.motivation]),
      goal: asString(record.frontmatter[FRONTMATTER_KEYS.goal]),
      conflict: asString(record.frontmatter[FRONTMATTER_KEYS.conflict]),
      growth: asString(record.frontmatter[FRONTMATTER_KEYS.growth]),
      ...reading,
      readOnly: record.readOnly,
    };
  }

  private sceneFromRecord(
    record: ManagedFileRecord,
    root: string,
    locale: ProjectLanguage,
  ): SceneRecord {
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
    // its form is opened, so the links are followed here rather than copied --
    // and followed only as far as this project, which is the only place its
    // characters are.
    const storedPov = fromWikiLink(
      asOptionalString(record.frontmatter[FRONTMATTER_KEYS.pov]),
    );
    const progressStatusValue = record.frontmatter[FRONTMATTER_KEYS.progressStatus];
    return {
      id: sceneId,
      sceneId,
      projectId,
      path: record.path,
      title: asOptionalString(record.frontmatter[FRONTMATTER_KEYS.sceneTitle]) ?? fileStem(record.path),
      rank: rank ?? RANK_GAP,
      hasStoredRank: rank !== null,
      progressStatus: isProgressStatus(progressStatusValue) ? progressStatusValue : null,
      aliases: readStringList(record.frontmatter[ALIASES_KEY]),
      categories: readStringList(record.frontmatter[FRONTMATTER_KEYS.category]),
      povPath:
        storedPov === null || isScenePovMode(storedPov)
          ? storedPov
          : this.projectLinkedPath(storedPov, record.path, root),
      // A scene written before these named notes holds one line of words, so
      // a lone string reads as a list of one and keeps what it said.
      times: readStringList(record.frontmatter[FRONTMATTER_KEYS.sceneTime]),
      locations: readStringList(
        record.frontmatter[FRONTMATTER_KEYS.sceneLocation],
      ),
      characters: readWikiLinkList(
        record.frontmatter[FRONTMATTER_KEYS.sceneCharacters],
      ).map(
        (target) => this.projectLinkedPath(target, record.path, root) ?? target,
      ),
      ...this.sceneReading(record, locale),
      readOnly: record.readOnly,
    };
  }

  private sceneReading(
    record: ManagedFileRecord,
    locale: ProjectLanguage,
  ): Pick<
    SceneRecord,
    | "conflict"
    | "worldStatus"
    | "relationships"
    | "worldStatusUnrecognized"
    | "relationshipsUnrecognized"
    | "events"
    | "planning"
    | "customFields"
    | "sectionHealth"
    | "unmigrated"
    | "revision"
  > {
    let reading = this.sceneReadings.get(record);
    if (reading === undefined) {
      const worldStatus = parseRecordSectionLenient(
        locale,
        readMarkedSection(record.content, "world-status") ?? "",
      );
      const relationships = parseRecordSectionLenient(
        locale,
        readMarkedSection(record.content, "relationships") ?? "",
      );
      reading = {
        // The property is the store once it exists, even holding an empty
        // string; the legacy section only answers for notes the migration has
        // not reached, where it is still the live copy.
        conflict: hasOwn(record.frontmatter, FRONTMATTER_KEYS.conflict)
          ? asString(record.frontmatter[FRONTMATTER_KEYS.conflict])
          : (readMarkedSection(record.content, "scene-conflict") ?? ""),
        worldStatus: worldStatus.records,
        worldStatusUnrecognized: worldStatus.unrecognized,
        relationships: relationships.records,
        relationshipsUnrecognized: relationships.unrecognized,
        events: readMarkedSection(record.content, "scene-events") ?? "",
        planning: readMarkedSection(record.content, "scene-planning") ?? "",
        customFields: readMarkedSection(record.content, "custom-fields") ?? "",
        sectionHealth: memberSectionHealth(record.content, "scene", record.path),
        // An older schema stamp counts too: a 0.7.0 scene is already property
        // -shaped, and without this the migration would leave it stamped 1,
        // against its own promise that migrated notes carry the schema they
        // now follow.
        unmigrated:
          (schemaVersionOf(record.frontmatter) ?? 0) < SCHEMA_VERSION ||
          readMarkedSection(record.content, "scene-fields") === null ||
          readMarkedSection(record.content, "scene-conflict") !== null,
        revision: fingerprint(record.content),
      };
      this.sceneReadings.set(record, reading);
    }
    return reading;
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
    const blocking = (issue: { code: string }): boolean =>
      issue.code !== "unknown-section" && issue.code !== "unrecognized-record";
    return (
      project.characters.some((character) =>
        character.sectionHealth.issues.some(blocking),
      ) ||
      project.scenes.some((scene) =>
        scene.sectionHealth.issues.some(blocking),
      ) ||
      project.worldbuildingKinds.some((kind) =>
        entitiesOf(project, kind.id).some((entity) =>
          entity.sectionHealth.issues.some(blocking),
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
    worldbuilding: Record<WorldbuildingKindId, WorldbuildingRecord[]>;
    /** Notes whose kind no registry entry spells, by kind id. */
    unregisteredKindNotes: Map<string, string[]>;
    artifacts: Partial<Record<StepId, ArtifactSnapshot>>;
    manuscript: ManuscriptSegmentRecord[];
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
        const character = this.characterFromRecord(record, project.locale);
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
        visibleCharacters.push(this.characterFromRecord(record, project.locale));
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
        const scene = this.sceneFromRecord(record, project.rootPath, project.locale);
        validScenes.push(scene);
      } catch (error) {
        if (!(error instanceof InvalidManagedDocumentError)) throw error;
      }
    }
    const scenes = sortByRank(validScenes);
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
        visibleScenes.push(this.sceneFromRecord(record, project.rootPath, project.locale));
      } catch (error) {
        if (!(error instanceof InvalidManagedDocumentError)) throw error;
      }
    }
    output[8] = fingerprint(
      [scenes.map(({ sceneId, rank, title, povPath, times, locations, characters, conflict, events }) => ({
        sceneId,
        rank,
        title,
        povPath,
        times,
        locations,
        characters,
        conflict,
        events,
      })), opaqueScenes],
    );
    output[9] = fingerprint([
      scenes.map(({ sceneId, planning }) => ({ sceneId, planning })),
      opaqueScenes,
    ]);

    // The manuscript is fingerprinted from what the Vault already knows about
    // its notes rather than from their text. Step 10 impacts no step, so this
    // fingerprint is never a review source and nothing downstream reads it --
    // and reading a whole novel back on every Vault event, once per note, to
    // produce a value nobody looks at is a cost a long manuscript would feel.
    const segments = await this.manuscript.listSegments(project);
    output[10] = fingerprint(
      segments.map((segment) => {
        const file = this.repository.getFile(segment.path);
        return {
          path: segment.path,
          sequence: segment.sequence,
          modified: file?.stat.mtime ?? 0,
          size: file?.stat.size ?? 0,
        };
      }),
    );

    const draft = draftPath ? this.repository.getFile(draftPath) : null;
    const draftContent = draft ? await this.repository.vault.read(draft) : "";
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

    // Worldbuilding entities join the snapshot but no step fingerprint: no
    // step's review hinges on them. The kind lives in each note's own
    // frontmatter rather than its folder, so one recursive scan serves all.
    const worldbuilding: Record<WorldbuildingKindId, WorldbuildingRecord[]> = {};
    for (const kind of project.worldbuildingKinds) {
      worldbuilding[kind.id] = [];
    }
    // Notes carrying a kind no registry entry spells: kept out of the buckets
    // and handed to the structure check, whose repair registers the kind.
    const unregisteredKindNotes = new Map<string, string[]>();
    const entityRecords = new Map<string, ManagedFileRecord>();
    for (const folderName of this.getProjectDirectoryNames(project, "worldbuilding")) {
      const folderRecords = await this.repository.findManagedFilesBelow(
        normalizePath(`${project.rootPath}/${folderName}`),
        "worldbuilding",
        project.id,
      );
      for (const record of folderRecords) entityRecords.set(record.path, record);
    }
    hasUnsupportedChildren ||= [...entityRecords.values()].some(
      (record) => record.readOnly && projectIdOf(record.frontmatter) === project.id,
    );
    const entities: WorldbuildingRecord[] = [];
    for (const record of entityRecords.values()) {
      try {
        entities.push(this.entityFromRecord(record, project.locale));
      } catch (error) {
        if (!(error instanceof InvalidManagedDocumentError)) throw error;
      }
    }
    assertUniqueStableIds(
      entities,
      (entity) => entity.entityId,
      (entity) => entity.path,
      "entity",
    );
    for (const entity of sortByRank(entities)) {
      const bucket = worldbuilding[entity.kind];
      if (bucket !== undefined) {
        bucket.push(entity);
        continue;
      }
      const notes = unregisteredKindNotes.get(entity.kind) ?? [];
      notes.push(entity.path);
      unregisteredKindNotes.set(entity.kind, notes);
    }

    return {
      fingerprints: output,
      hasUnsupportedChildren,
      characters: visibleCharacters,
      scenes: sortByRank(visibleScenes),
      worldbuilding,
      unregisteredKindNotes,
      artifacts,
      manuscript: segments,
    };
  }

  private async updateManagedForm(
    path: string,
    expectedRevision: string,
    frontmatterPatch: ManagedFrontmatter,
    sectionValues: Readonly<Record<string, string>>,
    rollbackValues: Readonly<Record<string, string>>,
    layout: readonly SectionLayoutEntry[],
    /** The key sequence the note holds to, where its kind has one. */
    frontmatterOrder?: readonly string[],
  ): Promise<void> {
    const hasSections = Object.keys(sectionValues).length > 0;
    const hasFrontmatter = Object.keys(frontmatterPatch).length > 0;

    if (!hasSections) {
      if (hasFrontmatter) {
        await this.repository.updateFrontmatter(
          path,
          frontmatterPatch,
          frontmatterOrder,
        );
      }
      return;
    }

    // Validate every requested section and apply all prose edits through one
    // Vault.process call before changing frontmatter. A damaged marker layout
    // therefore cannot leave the structured fields partially updated. Upsert
    // rather than update: a note from before the fields block gains it on its
    // first edit, at its canonical place in the layout.
    await this.repository.upsertSections(path, sectionValues, layout, expectedRevision);
    if (!hasFrontmatter) return;

    const afterSections = await this.repository.readManaged(path);
    const afterSectionsRevision = fingerprint(afterSections.content);
    try {
      await this.repository.updateFrontmatter(
        path,
        frontmatterPatch,
        frontmatterOrder,
      );
    } catch (error) {
      // Best-effort rollback is conditional on the exact post-section revision.
      // If another writer won the race, upsertSections throws rather than
      // overwriting that newer content.
      try {
        await this.repository.upsertSections(
          path,
          rollbackValues,
          layout,
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
    isWritableSchemaVersion(schemaVersionOf(frontmatter))
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
    // All optional: only what is present and unreadable gets repaired, by
    // rewriting the key to the entries the reading accepted.
    case FRONTMATTER_KEYS.worldbuildingKinds:
    case FRONTMATTER_KEYS.kindTemplates:
    case FRONTMATTER_KEYS.kindIcons:
    case FRONTMATTER_KEYS.kindDescriptions:
      return code === "invalid-metadata-field";
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

/** Whether a character note stores its role in either of its two homes. */
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

  // The role is an authorial decision, stored as a category link or under the
  // legacy key on an older note. This repair restores identity only, and
  // never invents or moves a role -- including the choice to have none.
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

/**
 * Identity for a worldbuilding note, and identity only: the id it is tracked
 * by, the name it is read out as, the kind that says which pane it belongs to,
 * and a place in the order. Everything an author writes into one — its
 * categories, its records, its description — is left exactly as it stands.
 *
 * The kind comes from the folder the note is filed in, which is the one thing
 * about it that survives a frontmatter an editor mangled.
 */
function safeEntityMetadataRepairPatch(
  record: ManagedFileRecord,
  expectedProjectId: string,
  kind: WorldbuildingKindId,
  usedIds: Set<string>,
  usedRanks: Set<number>,
): ManagedFrontmatter | null {
  const patch = safeCommonMetadataRepairPatch(
    record,
    "worldbuilding",
    expectedProjectId,
  );
  if (patch === null) return null;
  const frontmatter = record.frontmatter;

  const rawId = normalizeStableId(frontmatter[FRONTMATTER_KEYS.entityId]);
  const entityId =
    rawId !== null && !usedIds.has(rawId)
      ? rawId
      : createUniqueStableId("entity", usedIds);
  if (frontmatter[FRONTMATTER_KEYS.entityId] !== entityId) {
    patch[FRONTMATTER_KEYS.entityId] = entityId;
  }

  const name =
    asOptionalString(frontmatter[FRONTMATTER_KEYS.name]) ?? fileStem(record.path);
  if (frontmatter[FRONTMATTER_KEYS.name] !== name) {
    patch[FRONTMATTER_KEYS.name] = name;
  }

  if (frontmatter[FRONTMATTER_KEYS.worldbuildingKind] !== kind) {
    patch[FRONTMATTER_KEYS.worldbuildingKind] = kind;
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
    // The properties a character carries, in the order they read on one, and
    // no role: a role is a category now, and one named here would teach a
    // shape the forms no longer write.
    return {
      ...frontmatter,
      [FRONTMATTER_KEYS.characterId]: `${project.id}-template-character`,
      [FRONTMATTER_KEYS.characterName]: project.locale === "zh-CN" ? "角色" : "Character",
      [FRONTMATTER_KEYS.rank]: RANK_GAP,
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
      [FRONTMATTER_KEYS.sceneTime]: [],
      [FRONTMATTER_KEYS.sceneLocation]: [],
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
  return version !== null && version >= MIN_SUPPORTED_SCHEMA_VERSION;
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
      ? toWikiLink(patch.draftPath, fileStem(patch.draftPath))
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
  kind: "character" | "scene" | "entity",
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

/**
 * A frontmatter list of plain strings, kept in stored order. A bare string
 * counts as a one-entry list, the way Obsidian itself reads `aliases`.
 */
function readStringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * The character's generated fields block view. A character always displays a
 * category line: the stored links when it has them, and otherwise its role
 * synthesized as the seeded path, so an unmigrated note reads the same way a
 * migrated one does.
 */
function characterFieldsView(
  locale: ProjectLanguage,
  source: {
    type: CharacterType | null;
    progressStatus: ProgressStatus | null;
    aliases: readonly string[];
    categories: readonly string[];
    oneSentenceStoryline: string;
    motivation: string;
    goal: string;
    conflict: string;
    growth: string;
  },
): CharacterFieldsView {
  return {
    progressStatus: source.progressStatus,
    aliases: [...source.aliases],
    // A note whose role still lives under the legacy key has no category to
    // show, so the role stands in for one until the migration moves it. A
    // character with no role at all simply has no category line.
    categories:
      source.categories.length > 0
        ? [...source.categories]
        : source.type === null
          ? []
          : [characterRoleName(locale, source.type)],
    oneSentenceStoryline: source.oneSentenceStoryline,
    motivation: source.motivation,
    goal: source.goal,
    conflict: source.conflict,
    growth: source.growth,
  };
}

/**
 * The tree's walk order, recovered from paths alone: segment by segment under
 * fold, a parent before its children. What the folder walk yields for
 * standing nodes, extended to entries no folder spells.
 */
function compareTaxonomyPaths(left: string, right: string): number {
  const a = left.split("/");
  const b = right.split("/");
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    const order = foldName(a[index] ?? "").localeCompare(
      foldName(b[index] ?? ""),
    );
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

/** The vault path of one of an entity kind's tree root folders. */
/**
 * The kind ids no registry entry may spell: the built-in ids and the names
 * the built-in folders answer to in either language, folded. A custom kind
 * called Time would stand beside the built-in in one language and shadow it
 * in the other, so both spellings are off the table everywhere. Character and
 * scene are members before they are kinds, so their ids and folder names are
 * reserved the same way — a kind called character would answer for both
 * namespaces at once — and the two ids the pickers split time into go with
 * them, or a kind so named would stand in for one half of time.
 */
function reservedKindFolds(): Set<string> {
  const folds = new Set<string>();
  for (const kind of WORLDBUILDING_KINDS) folds.add(foldName(kind));
  for (const id of ["character", "scene", "time-point", "time-period"]) {
    folds.add(foldName(id));
  }
  for (const language of ["en", "zh-CN"] as const) {
    const layout = getProjectPathLayout(language);
    for (const kind of WORLDBUILDING_KINDS) {
      folds.add(foldName(kindIdFromFolderName(layout.worldbuildingKinds[kind])));
    }
    for (const key of ["characters", "scenes"] as const) {
      folds.add(foldName(kindIdFromFolderName(layout.directories[key])));
    }
  }
  // The two ids the base machinery answers by their literal spelling --
  // projectBaseFolder and the canonical base list both special-case them --
  // so a kind wearing either name would put on the built-in base as its own.
  for (const id of ["characters", "scenes"]) folds.add(foldName(id));
  return folds;
}

/**
 * What stands in the way of a kind wearing this name: a name the file system
 * will not hold or that would read as an ordering prefix, a reserved built-in
 * spelling, or a kind already answering to it under fold. Null when the name
 * is free to take.
 */
export function validateKindName(
  name: string,
  existing: readonly ProjectWorldbuildingKind[],
): "invalid-name" | "taken" | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.includes("/")) return "invalid-name";
  try {
    if (safeFileName(trimmed) !== trimmed) return "invalid-name";
  } catch {
    return "invalid-name";
  }
  // A leading `NN_` would be stripped back off as an ordering prefix, so the
  // registered name and the read-back id would stop agreeing.
  if (kindIdFromFolderName(trimmed) !== trimmed) return "invalid-name";
  if (reservedKindFolds().has(foldName(trimmed))) return "taken";
  if (existing.some((kind) => foldName(kind.id) === foldName(trimmed))) {
    return "taken";
  }
  return null;
}

/** A per-kind map as stored: kind ids to strings, nothing else. */
function isKindStringMap(
  value: unknown,
): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

/** The registry as stored, string entries only; readers validate further. */
function storedKindFolderNames(frontmatter: ManagedFrontmatter): string[] {
  const stored = frontmatter[FRONTMATTER_KEYS.worldbuildingKinds];
  return Array.isArray(stored)
    ? stored.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function definitionRootPath(
  project: KindScope,
  kind: EntityKindId,
  id: DefinitionFileId,
): string {
  const kindFolder = entityKindFolder(project, kind);
  return normalizePath(
    `${project.rootPath}/${kindFolder}/${definitionRootNameForFolder(kindFolder, id, project.locale)}`,
  );
}

/** The folder a kind's custom-field templates live in, `24_Custom_Field`. */
function customFieldRootPath(project: KindScope, kind: EntityKindId): string {
  const kindFolder = entityKindFolder(project, kind);
  return normalizePath(
    `${project.rootPath}/${kindFolder}/${customFieldRootNameForFolder(kindFolder, project.locale)}`,
  );
}

/** The root folder of an entity kind's Category tree. */
function categoryDefinitionPath(
  project: KindScope,
  kind: EntityKindId,
): string {
  return definitionRootPath(project, kind, "category");
}

/** The exact role links this project writes, for base filters and formulas. */
function characterRoleLinks(project: KindScope): CharacterRoleLinks {
  const definitionPath = categoryDefinitionPath(project, "character");
  const link = (type: CharacterType): string =>
    nodeLink(definitionPath, characterRoleName(project.locale, type));
  return {
    major: link("major"),
    supporting: link("supporting"),
    minor: link("minor"),
  };
}

/**
 * The character type a single stored category value names, if any. Root-level
 * role nodes only, the same reading `characterRoleFromCategories` gives the
 * dashboard: a deeper node that happens to carry a role's name is an ordinary
 * category, and a role change must not overwrite it.
 */
function roleTypeOfValue(value: string): CharacterType | null {
  return characterRoleFromValue(value);
}

/** The entity kind a member record is, which is where its trees live. */
function memberEntityKind(
  member: CharacterRecord | SceneRecord | WorldbuildingRecord,
): EntityKindId {
  return "characterId" in member
    ? "character"
    : "sceneId" in member
      ? "scene"
      : member.kind;
}

/**
 * The entity kind a member path belongs to, read from the folder it sits in.
 * The note itself may already be gone -- the deletion sweep runs after the
 * file does, and a rename sweep asks about the note's previous path -- so
 * the path is all there is to read.
 */
function memberKindOfPath(
  project: KindScope,
  path: string,
): EntityKindId | null {
  const normalized = normalizePath(path);
  for (const kind of entityKindIds(project.worldbuildingKinds)) {
    const folder = normalizePath(
      `${project.rootPath}/${entityKindFolder(project, kind)}`,
    );
    if (normalized.startsWith(`${folder}/`)) return kind;
  }
  return null;
}

/** The project folder a base file lives in, relative to the project root. */
function projectBaseFolder(
  project: KindScope,
  id: ProjectBaseId,
): string {
  const layout = getProjectPathLayout(project.locale);
  if (id === "characters") return layout.directories.characters;
  if (id === "scenes") return layout.directories.scenes;
  return entityKindFolder(project, id);
}

/**
 * The stored category list with its role link moved to a new role. The other
 * categories stay untouched; a list carrying no role link gains one at the
 * front, reusing the definition path the note's own links already point at
 * when there is one.
 */
function replacedRoleCategories(
  locale: ProjectLanguage,
  categories: readonly string[],
  type: CharacterType,
  fallbackDefinitionPath: string,
): string[] {
  const definitionPath =
    categories
      .filter((raw) => roleTypeOfValue(raw) !== null)
      .map((raw) => definitionRootFromValue(raw))
      .find((root): root is string => root !== null) ?? fallbackDefinitionPath;
  const roleLink = nodeLink(definitionPath, characterRoleName(locale, type));
  let replaced = false;
  const next = categories.map((raw) => {
    if (roleTypeOfValue(raw) !== null) {
      replaced = true;
      return roleLink;
    }
    return raw;
  });
  if (!replaced) next.unshift(roleLink);
  return next;
}

/** Category paths chosen in a picker become links into the kind's own tree. */
function categoryLinksFromPaths(
  project: KindScope,
  kind: EntityKindId,
  paths: readonly string[],
): string[] {
  const definitionPath = categoryDefinitionPath(project, kind);
  return paths
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .map((path) => nodeLink(definitionPath, path));
}

/**
 * The stored category list as this release would write it: every value read
 * for the path it names and re-emitted as a node link. The same array comes
 * back when nothing would change, so a caller comparing by identity writes
 * only the notes conversion actually touches.
 */
function normalizedCategoryValues(
  project: KindScope,
  kind: EntityKindId,
  values: readonly string[],
): readonly string[] {
  const root = categoryDefinitionPath(project, kind);
  const next = values.map((raw) => {
    const path = taxonomyPathFromValue(raw, root);
    return path === null ? raw : nodeLink(root, path);
  });
  const changed = next.some((value, index) => value !== values[index]);
  return changed ? next : values;
}

interface EntityFieldsSource {
  progressStatus: ProgressStatus | null;
  aliases: readonly string[];
  categories: readonly string[];
  description: string;
  timeKind: TimeKind | null;
  timeStart: string;
  timeEnd: string;
}

function entityFieldsViewOf(
  kind: WorldbuildingKindId,
  source: EntityFieldsSource,
): EntityFieldsView {
  return {
    progressStatus: source.progressStatus,
    aliases: [...source.aliases],
    categories: [...source.categories],
    description: source.description,
    time: isWorldbuildingKind(kind) && WORLDBUILDING_KIND_DEFINITIONS[kind].timeFields
      ? { kind: source.timeKind, start: source.timeStart, end: source.timeEnd }
      : null,
  };
}

/**
 * A period claims a span, so it needs both of its ends or neither; a point is
 * its own time and an event may name one moment or a span freely.
 */
function assertEntityTimeFields(
  timeKind: TimeKind | null,
  timeStart: string,
  timeEnd: string,
): void {
  if (timeKind !== "period") return;
  if ((timeStart.length > 0) !== (timeEnd.length > 0)) {
    throw new Error("A time period needs both its start and its end, or neither.");
  }
}

const RECORD_SECTION_IDS: readonly RecordSectionId[] = [
  "world-status",
  "relationships",
];

/**
 * The custom-fields block as a section-values entry: present only while it
 * holds something, because the section is deferred and an empty write would
 * plant an empty block on every note a form touches.
 */
function customFieldsSectionValue(
  block: string,
): Record<string, string> {
  return block.trim().length > 0 ? { "custom-fields": block } : {};
}

/**
 * The record sections a write should carry: only the ones with something in
 * them, each rendered in the project language with the lines the grammar
 * cannot read re-emitted verbatim after the records.
 */
function entityRecordSectionValues(
  locale: ProjectLanguage,
  records: {
    worldStatus: readonly RecordLine[];
    relationships: readonly RecordLine[];
  },
  unrecognized: {
    worldStatusUnrecognized: readonly string[];
    relationshipsUnrecognized: readonly string[];
  },
  spanOf: SpanLookup | null = null,
): Record<string, string> {
  const values: Record<string, string> = {};
  if (records.worldStatus.length + unrecognized.worldStatusUnrecognized.length > 0) {
    values["world-status"] = renderRecordSection(
      locale,
      "world-status",
      records.worldStatus,
      unrecognized.worldStatusUnrecognized,
      spanOf,
    );
  }
  if (
    records.relationships.length + unrecognized.relationshipsUnrecognized.length >
    0
  ) {
    values["relationships"] = renderRecordSection(
      locale,
      "relationships",
      records.relationships,
      unrecognized.relationshipsUnrecognized,
      spanOf,
    );
  }
  return values;
}

/**
 * Where one member note names another: the point of view a scene is told from
 * and the cast it puts on stage, the times and places it happens in, and the
 * two ends of a period. A rename or a deletion sweeps every one of them,
 * because a member is named the same way wherever it is named.
 *
 * The list-valued ones are the ones a deletion can simply shorten; emptying
 * one of the others would leave the note that holds it saying less than its
 * author meant it to.
 *
 * The ones marked as prose could hold words before they held notes. Only what
 * is written as a link is read as one there, so a scene still saying "one
 * winter evening" is never reported as a broken link and never rewritten: it
 * is the member migration that gives those words a note.
 *
 * Each field holds one kind of note, and the kind is what keeps the sweeps
 * honest: a link that no longer resolves is matched by bare name only against
 * members of the kind its field holds, so renaming a character called Winter
 * never captures a scene's dangling time entry of the same name.
 */
const MEMBER_LINK_FIELDS = [
  {
    key: FRONTMATTER_KEYS.pov,
    kind: "character",
    list: false,
    prose: false,
    removable: false,
  },
  {
    key: FRONTMATTER_KEYS.sceneCharacters,
    kind: "character",
    list: true,
    prose: false,
    removable: true,
  },
  {
    key: FRONTMATTER_KEYS.sceneTime,
    kind: "time",
    list: true,
    prose: true,
    removable: true,
  },
  {
    key: FRONTMATTER_KEYS.sceneLocation,
    kind: "location",
    list: true,
    prose: true,
    removable: true,
  },
  {
    key: FRONTMATTER_KEYS.timeStart,
    kind: "time",
    list: false,
    prose: true,
    removable: false,
  },
  {
    key: FRONTMATTER_KEYS.timeEnd,
    kind: "time",
    list: false,
    prose: true,
    removable: false,
  },
] as const;

/**
 * The categories every member carries. They are links like the rest and go
 * short the same way, but one that leads nowhere is never taken off the list:
 * the definition check raises the entry the link names instead, which is what
 * an author meant by writing it.
 */
const CATEGORY_LINK_FIELD = {
  key: FRONTMATTER_KEYS.category,
  list: true,
  prose: false,
  removable: false,
} as const;

/**
 * Every frontmatter key holding a link this plugin writes: what one member
 * names in another, the categories every member carries, and the note a
 * project calls its manuscript. A link written the way Obsidian never writes
 * one is tidied wherever it is stored, not only where it was first found.
 */
/** The note a project calls its manuscript. */
const DRAFT_LINK_FIELD = {
  key: FRONTMATTER_KEYS.draft,
  list: false,
  prose: false,
  removable: false,
} as const;

const STORED_LINK_FIELDS = [
  ...MEMBER_LINK_FIELDS,
  CATEGORY_LINK_FIELD,
  DRAFT_LINK_FIELD,
] as const;

/**
 * A stored value read as the list it may be, or null when the note stores
 * nothing there. A note written before a field held several reads as a list of
 * one, which keeps what it said.
 */
function storedList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value as unknown[];
  return typeof value === "string" ? [value] : null;
}

/**
 * One stored entry, when it is something that names a note; null when it is
 * not. A field that held the author's own words before it held notes keeps
 * them: a scene still saying "one winter evening" is never followed, rewritten
 * or taken away by anything here.
 */
function storedReference(
  field: { readonly prose: boolean },
  entry: unknown,
): string | null {
  const stored = asOptionalString(entry);
  if (stored === null || stored.length === 0) return null;
  if (field.prose && !isWikiLink(stored)) return null;
  return stored;
}

/** Every member of a project, in the order the dashboard shows its panes. */
function projectMembers(
  project: ProjectSnapshot,
): Array<CharacterRecord | SceneRecord | WorldbuildingRecord> {
  return [
    ...project.characters,
    ...project.scenes,
    ...project.worldbuildingKinds.flatMap((kind) => entitiesOf(project, kind.id)),
  ];
}

/** One kind's members, read off the snapshot. */
function membersOfKind(
  project: ProjectSnapshot,
  kind: EntityKindId,
): ReadonlyArray<CharacterRecord | SceneRecord | WorldbuildingRecord> {
  return kind === "character"
    ? project.characters
    : kind === "scene"
      ? project.scenes
      : entitiesOf(project, kind);
}

/**
 * The name a member note stores, whichever kind of member it is, or null when
 * it stores none — which is the one case a file name cannot stand in for,
 * since safeFileName is lossy and a repair would write back less than the
 * author typed.
 */
function memberStoredTitle(record: ManagedFileRecord): string | null {
  return (
    asOptionalString(record.frontmatter[FRONTMATTER_KEYS.characterName]) ??
    asOptionalString(record.frontmatter[FRONTMATTER_KEYS.sceneTitle]) ??
    asOptionalString(record.frontmatter[FRONTMATTER_KEYS.name])
  );
}

/** The name a member note goes by, falling back to what it is filed as. */
function memberTitleOf(record: ManagedFileRecord): string {
  return memberStoredTitle(record) ?? fileStem(record.path);
}

/** The same, read off a loaded member rather than off its note. */
function memberName(
  member: CharacterRecord | SceneRecord | WorldbuildingRecord,
): string {
  return "title" in member ? member.title : member.name;
}

/**
 * Every note the record sections of one member point at. Read leniently and
 * from the note itself, because these live in the body where an author writes
 * as well as the plugin.
 */
function memberRecordTerms(
  record: ManagedFileRecord,
  locale: ProjectLanguage,
): RecordTerm[] {
  const terms: RecordTerm[] = [];
  for (const sectionId of RECORD_SECTION_IDS) {
    const content = readMarkedSection(record.content, sectionId);
    if (content === null) continue;
    for (const line of parseRecordSectionLenient(locale, content).records) {
      for (const clause of line.clauses) {
        if (clause.kind === "span") terms.push(clause.start, clause.end);
        else terms.push(clause.term);
      }
    }
  }
  return terms;
}

/**
 * What each of the project's periods spans, for the record lines that name
 * one. Keyed without the file extension, which is how a stored link names it.
 */
function projectTimeSpans(project: ProjectSnapshot): SpanLookup {
  const spans = new Map<string, { start: RecordTerm; end: RecordTerm }>();
  for (const entity of entitiesOf(project, "time")) {
    if (entity.timeKind !== "period") continue;
    const start = entity.timeStart.trim();
    const end = entity.timeEnd.trim();
    if (start.length === 0 || end.length === 0) continue;
    spans.set(entity.path.replace(/\.md$/u, ""), {
      start: parseTerm(start),
      end: parseTerm(end),
    });
  }
  return (path) => spans.get(path.replace(/\.md$/u, "")) ?? null;
}

/**
 * The upsert layout for a worldbuilding note: the registry order, with the
 * headings deferred record sections are created under when their first record
 * arrives.
 */
function entityUpdateLayout(
  name: string,
  kind: WorldbuildingKindId,
  locale: ProjectLanguage,
): SectionLayoutEntry[] {
  const sections = entityTemplate(name, kind, locale).sections;
  return managedSectionsForDocument("worldbuilding").map(
    (descriptor) =>
      sections.find((section) => section.id === descriptor.id) ?? {
        // A section the template defers carries no heading: the record
        // sections are titled callouts, and the title is what names them.
        id: descriptor.id,
        heading: "",
      },
  );
}

/** The upsert layout for a character note, record headings included. */
function characterUpdateLayout(
  name: string,
  locale: ProjectLanguage,
): SectionLayoutEntry[] {
  const sections = characterTemplate(name, locale).sections;
  return managedSectionsForDocument("character").map(
    (descriptor) =>
      sections.find((section) => section.id === descriptor.id) ?? {
        // A section the template defers carries no heading: the record
        // sections are titled callouts, and the title is what names them.
        id: descriptor.id,
        heading: "",
      },
  );
}


interface SceneFieldsSource {
  progressStatus: ProgressStatus | null;
  aliases: readonly string[];
  categories: readonly string[];
  povPath: string | null;
  times: readonly string[];
  locations: readonly string[];
  conflict: string;
  characters: readonly string[];
}

/**
 * The scene's generated fields block, with the point of view and the cast
 * resolved to names the way the dashboard shows them. Only the display is
 * localized; the stored properties keep their language-neutral values.
 */
function sceneFieldsBlock(
  locale: ProjectLanguage,
  fields: SceneFieldsSource,
  characterNames: ReadonlyMap<string, string>,
): string {
  const memberName = (path: string): string =>
    characterNames.get(path) ?? fileStem(path);
  const pov: ScenePovField =
    fields.povPath === null || fields.povPath === ""
      ? null
      : isScenePovMode(fields.povPath)
        ? { kind: "mode", mode: fields.povPath }
        : {
            kind: "character",
            path: fields.povPath,
            name: memberName(fields.povPath),
          };
  return renderSceneFieldsBlock(locale, {
    progressStatus: fields.progressStatus,
    aliases: [...fields.aliases],
    categories: [...fields.categories],
    pov,
    times: [...fields.times],
    locations: [...fields.locations],
    conflict: fields.conflict,
    cast: fields.characters.map((path) => ({ path, name: memberName(path) })),
  });
}

/**
 * The upsert layout for a scene: the template's sections in registry order,
 * with the legacy conflict slotted at its historical place. A fields block
 * inserted into an unmigrated note then lands above the legacy section, where
 * migration will leave it, instead of below.
 */
function sceneUpdateLayout(
  title: string,
  locale: ProjectLanguage,
): SectionLayoutEntry[] {
  const sections = sceneTemplate(title, locale).sections;
  return managedSectionsForDocument("scene").map(
    (descriptor) =>
      sections.find((section) => section.id === descriptor.id) ?? {
        // A section the template defers carries no heading: the record
        // sections are titled callouts, and the title is what names them.
        id: descriptor.id,
        heading: "",
      },
  );
}

/**
 * Section health for a character or scene note. Optional sections are dropped
 * from the issues when only their absence is wrong: a fields block a note has
 * not been migrated to carry, or a legacy section migration already removed,
 * is a state of the note rather than damage to it. Damage to one that exists
 * stays reported.
 */
function memberSectionHealth(
  content: string,
  documentType: "character" | "scene" | "worldbuilding",
  path: string,
): ManagedSectionsInspection {
  const inspection = inspectManagedDocumentSections(
    content,
    managedSectionsForDocument(documentType).map((section) => section.id),
    path,
  );
  const optional = optionalSectionIds(documentType);
  const issues = inspection.issues.filter(
    (issue) =>
      !(
        issue.code === "missing" &&
        issue.sectionId !== null &&
        optional.has(issue.sectionId)
      ),
  );
  // Lines a record section holds that the grammar cannot read: kept verbatim,
  // invisible to the dashboard, and only the author can resolve them, so the
  // health report is where they get said. Informational, never blocking.
  // Detection is language-independent, since the lenient parse tries both.
  for (const sectionId of RECORD_SECTION_IDS) {
    const body = readMarkedSection(content, sectionId);
    if (body === null) continue;
    const unrecognized = parseRecordSectionLenient("en", body).unrecognized;
    if (unrecognized.length > 0) {
      issues.push({
        code: "unrecognized-record",
        sectionId,
        reason: `${unrecognized.length} line(s) in "${sectionId}" do not read as records.`,
      });
    }
  }
  return { sections: inspection.sections, issues };
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

/**
 * The document types whose notes vote when a project id is being recovered:
 * derived from the one list of types, so a type added there votes here
 * without anyone remembering to widen a copy. The project's own metadata
 * note is what is being recovered, and material and archive hold whatever
 * the author brought along rather than the plugin's stamps.
 */
const PROJECT_MEMBER_DOCUMENT_TYPES: readonly string[] = DOCUMENT_TYPES.filter(
  (type) =>
    type !== "project-metadata" && type !== "material" && type !== "archive",
);

function isProjectDocumentType(value: string | null): value is DocumentType {
  return value !== null && PROJECT_MEMBER_DOCUMENT_TYPES.includes(value);
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

/** The path a stored link means: the note's path without its ".md". */
function stripMarkdownExtension(path: string): string {
  return path.replace(/\.md$/u, "");
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

/** Whether a stored value is a wikilink at all, rather than a path typed out. */
function isWikiLink(value: string | null): boolean {
  return value !== null && /^\[\[[^\]]+\]\]$/u.test(value.trim());
}

/** The display text a link carries after the bar, if it carries one. */
function wikiLinkAlias(value: string): string | undefined {
  return /^\[\[[^\]|]+\|([^\]]*)\]\]$/u.exec(value.trim())?.[1];
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
