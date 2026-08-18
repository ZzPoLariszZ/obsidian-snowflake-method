import type {
  CharacterType,
  EntityKindId,
  ProgressStatus,
  ProjectLanguage,
  ProjectWorldbuildingKind,
  StepFingerprintMap,
  StepId,
  StepStatus,
  StepStatusMap,
  TimeKind,
  WorldbuildingKind,
  WorldbuildingKindId,
} from "../domain";
import type { ManagedFrontmatter } from "../repository";
import type {
  ManagedSectionsInspection,
  MarkerIssueCode,
  RecordLine,
} from "../templates";

export const DEFAULT_PROJECT_ROOT = "Snowflake Projects";

/**
 * Where archived projects go: one folder beside the project folders, so the
 * one-level discovery scan never reads into it. Unlocalized like the default
 * root above, because it must be found again whatever language the vault
 * later runs in.
 */
export const PROJECT_ARCHIVE_FOLDER = "Snowflake Archive";

/** The archive folder under one configured project root. */
export function projectArchiveRoot(rootPath: string): string {
  return rootPath.length === 0
    ? PROJECT_ARCHIVE_FOLDER
    : `${rootPath}/${PROJECT_ARCHIVE_FOLDER}`;
}

export const PROJECT_DIRECTORY_KEYS = [
  "system",
  "summaries",
  "characters",
  "synopses",
  "scenes",
  "draft",
  "worldbuilding",
  "writingSessions",
  "materials",
  "archive",
] as const;

export type ProjectDirectoryKey = (typeof PROJECT_DIRECTORY_KEYS)[number];

export interface ProjectPathLayout {
  projectFileName: string;
  directories: Readonly<Record<ProjectDirectoryKey, string>>;
  /** Kind subfolders inside the worldbuilding directory. */
  worldbuildingKinds: Readonly<Record<WorldbuildingKind, string>>;
  draftFileName: string;
}

export const PROJECT_PATH_LAYOUTS: Readonly<Record<ProjectLanguage, ProjectPathLayout>> = {
  en: {
    projectFileName: "001_Project_Metadata.md",
    directories: {
      system: "00_System",
      summaries: "10_Summary",
      characters: "20_Character",
      synopses: "30_Synopsis",
      scenes: "40_Scene",
      draft: "50_Manuscript",
      worldbuilding: "60_Worldbuilding",
      // One key for the whole chain: ensureFolder builds every level, and a
      // single entry keeps the id-recovery walk from visiting 70_Tool three
      // times over.
      writingSessions: "70_Tool/71_Statistics/711_Writing_Session",
      materials: "80_Material",
      archive: "90_Archive",
    },
    worldbuildingKinds: {
      time: "61_Time",
      location: "62_Location",
      item: "63_Item",
    },
    draftFileName: "Draft.md",
  },
  "zh-CN": {
    projectFileName: "001_项目元数据.md",
    directories: {
      system: "00_系统",
      summaries: "10_概述",
      characters: "20_角色",
      synopses: "30_大纲",
      scenes: "40_场景",
      draft: "50_正文",
      worldbuilding: "60_世界观",
      writingSessions: "70_工具/71_统计/711_写作会话",
      materials: "80_素材",
      archive: "90_存档",
    },
    worldbuildingKinds: {
      time: "61_时间",
      location: "62_地点",
      item: "63_物品",
    },
    draftFileName: "初稿.md",
  },
};

/** A project as the kind lookups need it: where it is and what kinds it has. */
export interface KindScope {
  rootPath: string;
  locale: ProjectLanguage;
  worldbuildingKinds: readonly ProjectWorldbuildingKind[];
}

/**
 * The folder name of one worldbuilding kind: the registered descriptor's when
 * the project lists the kind, and the layout's own for a built-in id even
 * when the descriptor list is not at hand. An unregistered custom id has no
 * folder to name.
 */
export function worldbuildingKindFolderName(
  scope: KindScope,
  kind: WorldbuildingKindId,
): string | null {
  const registered = scope.worldbuildingKinds.find(
    (candidate) => candidate.id === kind,
  );
  if (registered !== undefined) return registered.folderName;
  const layout = getProjectPathLayout(scope.locale);
  return kind in layout.worldbuildingKinds
    ? layout.worldbuildingKinds[kind as WorldbuildingKind]
    : null;
}

/** The vault path of a project's worldbuilding kind folder. */
export function worldbuildingKindFolder(
  scope: KindScope,
  kind: WorldbuildingKindId,
): string {
  const layout = getProjectPathLayout(scope.locale);
  const folderName = worldbuildingKindFolderName(scope, kind);
  if (folderName === null) {
    throw new Error(`Unknown worldbuilding kind "${kind}".`);
  }
  return `${scope.rootPath}/${layout.directories.worldbuilding}/${folderName}`;
}

/**
 * The project-relative folder an entity kind's notes live in, which is also
 * where the kind's own definition files sit.
 */
export function entityKindFolder(
  scope: KindScope,
  kind: EntityKindId,
): string {
  const layout = getProjectPathLayout(scope.locale);
  if (kind === "character") return layout.directories.characters;
  if (kind === "scene") return layout.directories.scenes;
  const folderName = worldbuildingKindFolderName(scope, kind);
  if (folderName === null) {
    throw new Error(`Unknown worldbuilding kind "${kind}".`);
  }
  return `${layout.directories.worldbuilding}/${folderName}`;
}

export function getProjectPathLayout(language: ProjectLanguage): ProjectPathLayout {
  return PROJECT_PATH_LAYOUTS[language];
}

export function getProjectMetadataRelativePath(language: ProjectLanguage): string {
  const layout = getProjectPathLayout(language);
  return `${layout.directories.system}/${layout.projectFileName}`;
}

export { FRONTMATTER_KEYS } from "../domain";

export type ProjectLocator = string | ProjectRef | ProjectSnapshot;

export interface ProjectRef {
  projectFile: string;
  rootPath: string;
  id: string;
  title: string;
  locale: ProjectLanguage;
  readOnly: boolean;
  /**
   * Every worldbuilding kind the project has, built-ins first, then the
   * registered custom kinds in registry order. Read off the metadata note, so
   * a ref carries it wherever the ref goes.
   */
  worldbuildingKinds: ProjectWorldbuildingKind[];
}

export interface ProjectLinks {
  draft: string | null;
}

/**
 * One kind's bucket of a snapshot. The map holds a row for every kind the
 * project lists, so an empty answer means an id from somewhere else — a pane
 * left open on a kind since deleted, say — and the caller reads that as no
 * entities rather than as a crash.
 */
export function entitiesOf(
  project: Pick<ProjectSnapshot, "worldbuilding">,
  kind: WorldbuildingKindId,
): WorldbuildingRecord[] {
  return project.worldbuilding[kind] ?? [];
}

export interface ProjectSnapshot extends ProjectRef {
  steps: StepStatusMap;
  links: ProjectLinks;
  reviewedFingerprints: StepFingerprintMap;
  currentFingerprints: StepFingerprintMap;
  needsReview: StepId[];
  schemaVersion: number | null;
  characters: CharacterRecord[];
  scenes: SceneRecord[];
  /** One bucket per kind the project has, keyed by kind id. */
  worldbuilding: Record<WorldbuildingKindId, WorldbuildingRecord[]>;
  artifacts: Partial<Record<StepId, ArtifactSnapshot>>;
  structureIssues: ProjectStructureIssue[];
}

export const PROJECT_STRUCTURE_ISSUE_CODES = [
  "missing-metadata-field",
  "invalid-metadata-field",
  "missing-directory",
  "missing-artifact",
  "missing-system-template",
  "invalid-system-template",
  "missing-base",
  // One code per kind of name, because the sentence that explains the drift
  // has to say which name it means and where that name is changed.
  "mismatched-character-title",
  "mismatched-scene-title",
  "mismatched-entity-title",
  "mismatched-project-folder",
  "invalid-artifact-metadata",
  // One per reference nothing can be done about automatically: which note
  // takes the place of the one that went is the author's decision, and a
  // record line is a sentence they wrote.
  "dangling-scene-pov",
  "dangling-time-span",
  "dangling-record-link",
  // One per thing that can be wrong with a stored link, because each is mended
  // a different way: written out in full, or taken off the list.
  "unlinked-path",
  "incomplete-link",
  "foreign-link",
  "missing-link",
  "extension-in-link",
  // One per way a manuscript can lose its order, because a note carrying no
  // position, a note carrying nonsense, and two notes claiming the same place
  // are three different sentences with three different repairs.
  "missing-manuscript-sequence",
  "invalid-manuscript-sequence",
  "duplicate-manuscript-sequence",
  // One per thing that can be wrong around a definition tree: a node folder
  // without the note its links resolve to, a link naming a node that is not
  // there, and a link whose displayed name a folder rename left behind.
  "missing-definition-node",
  "unresolved-definition-link",
  "stale-definition-alias",
  // Notes carry a worldbuilding kind the registry does not list, which a
  // hand-restored backup or a hand-edited registry can leave behind. The
  // repair registers the kind and ensures its folder, so the notes come back
  // into the fold instead of standing invisible.
  "unregistered-worldbuilding-kind",
] as const;

export type ProjectStructureIssueCode =
  (typeof PROJECT_STRUCTURE_ISSUE_CODES)[number];

/** A project-level contract problem that exists before marker inspection. */
export interface ProjectStructureIssue {
  code: ProjectStructureIssueCode;
  path: string;
  stepIds: StepId[];
  field?: string;
  /**
   * One value the sentence itself needs: a count, a document type, the name a
   * note should be filed under. Never a list — what the report names, it names
   * in `names`.
   */
  expected?: string;
  /**
   * What the issue found, one entry to a line. Written as the path inside the
   * project wherever the project knows one, so two notes sharing a name are
   * told apart, and as the link stored it when it names nothing the project
   * can place.
   */
  names?: string[];
  canOpen: boolean;
  /** True only when the issue has a deterministic, content-preserving fix. */
  repairable: boolean;
}

/**
 * Which notes name one member, split because deleting it costs each kind
 * something different: an entry in a list can simply go, a field holding one
 * note leaves the note that holds it needing a decision only the author can
 * make, and a record line is a sentence the author wrote about the two of
 * them. A note in more than one of those appears in each.
 */
export interface MemberUsage {
  /** Notes listing it among others, which lose the entry and nothing else. */
  listed: string[];
  /** Notes naming it where only one note fits: a point of view, a period end. */
  needsDecision: string[];
  /** Notes whose world status or relationships mention it. */
  records: string[];
}

/**
 * Which notes use one definition node directly, split because removing the
 * node costs each something different: a category entry in a list can simply
 * go, while a record line is a sentence the author wrote under that label.
 */
export interface DefinitionNodeUsage {
  /** Display names of notes categorized under the node itself. */
  listed: string[];
  /** Display names of notes whose record lines carry the node as a label. */
  records: string[];
}

/**
 * One node of a definition tree, in the order the tree is read: depth first,
 * siblings by folded name. A node exists because its folder does; the two
 * flags carry the ways it can half-exist — a folder without the note its
 * links resolve to, and a path members reference that no folder spells.
 */
export interface DefinitionNodeInfo {
  /** The taxonomy path below the tree root, `Race/Elf`. */
  taxonomyPath: string;
  /** The last segment, which is the folder's own name. */
  name: string;
  /** How many segments the path has; 1 directly under the root. */
  depth: number;
  /** Vault path of the node's folder, standing or not. */
  folderPath: string;
  /** Vault path of the node's `_self.md`. */
  selfPath: string;
  /** What the node's note says it means; empty while it says nothing. */
  description: string;
  /** The folder stands but its `_self.md` is not there. */
  missingSelf: boolean;
  /** Members reference the path but no folder spells it. */
  missing: boolean;
  /** The notes naming this very node, not its children. */
  usage: DefinitionNodeUsage;
}

/** One kind's tree of one vocabulary: where it roots, and every node in order. */
export interface DefinitionTreeInfo {
  /** Vault path of the tree's root folder, which may not exist yet. */
  rootPath: string;
  nodes: DefinitionNodeInfo[];
}

/** One vocabulary across every entity kind of the project, keyed by kind id. */
export type DefinitionForest = Record<EntityKindId, DefinitionTreeInfo>;

/** One custom-field template as the tables list it. */
export interface CustomFieldTemplateInfo {
  /** The note's own name, which is the template's. */
  name: string;
  /** The sentence its frontmatter holds; empty while it holds none. */
  description: string;
  /** Vault path of the template note. */
  path: string;
}

export interface CreateProjectOptions {
  name?: string;
  title?: string;
  rootPath?: string;
  locale?: ProjectLanguage;
  language?: ProjectLanguage;
}

export interface RepairResult {
  project: ProjectSnapshot;
  created: string[];
  repaired: string[];
  unchanged: string[];
  conflicts: Array<{ path: string; reason: string }>;
  sectionResults: RepairSectionResult[];
}

export interface RepairSectionResult {
  path: string;
  sectionId: string;
  status: "unchanged" | "conflict";
  code?: MarkerIssueCode;
  reason?: string;
  markerSectionId?: string;
  relatedSectionId?: string;
}

export interface CharacterInput {
  name: string;
  type?: CharacterType;
  aliases?: string[];
  /** Category paths beyond the role, `Character/Race/Elf`; links are built here. */
  categoryPaths?: string[];
  progressStatus?: ProgressStatus | null;
  oneSentenceStoryline?: string;
  motivation?: string;
  goal?: string;
  conflict?: string;
  growth?: string;
  worldStatus?: RecordLine[];
  relationships?: RecordLine[];
  oneParagraphStoryline?: string;
  characterSynopsis?: string;
  characterProfile?: string;
  customFields?: string;
}

export interface CharacterPatch {
  /** Revision shown to the editor before the user began changing fields. */
  expectedRevision: string;
  name?: string;
  type?: CharacterType;
  aliases?: string[];
  categoryPaths?: string[];
  progressStatus?: ProgressStatus | null;
  oneSentenceStoryline?: string;
  motivation?: string;
  goal?: string;
  conflict?: string;
  growth?: string;
  worldStatus?: RecordLine[];
  relationships?: RecordLine[];
  oneParagraphStoryline?: string;
  characterSynopsis?: string;
  characterProfile?: string;
  customFields?: string;
}

export interface CharacterRecord {
  id: string;
  characterId: string;
  projectId: string;
  path: string;
  name: string;
  /** Sparse ordering value used by the character table. */
  rank: number;
  /** False when `rank` is the fallback because the note stores no usable rank. */
  hasStoredRank: boolean;
  /**
   * The role, read from the category links first, the legacy key second, and
   * null when the character has been given neither.
   */
  type: CharacterType | null;
  /** Null while the note has never chosen a progress status. */
  progressStatus: ProgressStatus | null;
  aliases: string[];
  /** Category links exactly as stored, `[[…/Full/Path/_self|Full/Path]]`. */
  categories: string[];
  oneSentenceStoryline: string;
  motivation: string;
  goal: string;
  conflict: string;
  growth: string;
  /** Record lines from the note's body sections. */
  worldStatus: RecordLine[];
  relationships: RecordLine[];
  worldStatusUnrecognized: string[];
  relationshipsUnrecognized: string[];
  oneParagraphStoryline: string;
  characterSynopsis: string;
  characterProfile: string;
  /** The custom-fields block as stored; empty while the note carries none. */
  customFields: string;
  sectionHealth: ManagedSectionsInspection;
  /** True while the note predates the generated fields block. */
  unmigrated: boolean;
  /** Stable fingerprint of the complete managed Markdown note. */
  revision: string;
  readOnly: boolean;
}

export interface SceneInput {
  title: string;
  povPath?: string | null;
  aliases?: string[];
  categoryPaths?: string[];
  progressStatus?: ProgressStatus | null;
  times?: string[];
  locations?: string[];
  characters?: string[];
  conflict?: string;
  worldStatus?: RecordLine[];
  relationships?: RecordLine[];
  events?: string;
  planning?: string;
  customFields?: string;
}

export interface ScenePatch {
  /** Revision shown to the editor before the user began changing fields. */
  expectedRevision: string;
  title?: string;
  povPath?: string | null;
  aliases?: string[];
  categoryPaths?: string[];
  progressStatus?: ProgressStatus | null;
  times?: string[];
  locations?: string[];
  characters?: string[];
  conflict?: string;
  worldStatus?: RecordLine[];
  relationships?: RecordLine[];
  events?: string;
  planning?: string;
  customFields?: string;
}

export interface SceneRecord {
  id: string;
  sceneId: string;
  projectId: string;
  path: string;
  title: string;
  rank: number;
  /** False when `rank` is the fallback because the note stores no usable rank. */
  hasStoredRank: boolean;
  /** Null while the note has never chosen a progress status. */
  progressStatus: ProgressStatus | null;
  aliases: string[];
  /** Category links exactly as stored, `[[…/Full/Path/_self|Full/Path]]`. */
  categories: string[];
  povPath: string | null;
  /** Time notes the scene happens in, as stored links or plain words. */
  times: string[];
  /** Places the scene happens in, as stored links or plain words. */
  locations: string[];
  characters: string[];
  conflict: string;
  worldStatus: RecordLine[];
  relationships: RecordLine[];
  worldStatusUnrecognized: string[];
  relationshipsUnrecognized: string[];
  events: string;
  planning: string;
  /** The custom-fields block as stored; empty while the note carries none. */
  customFields: string;
  sectionHealth: ManagedSectionsInspection;
  /** True while the note lacks the fields block or still holds the legacy conflict section. */
  unmigrated: boolean;
  /** Stable fingerprint of the complete managed Markdown note. */
  revision: string;
  readOnly: boolean;
}

/**
 * A worldbuilding entity's structured record. Frontmatter carries what a
 * single value or a single link can hold; the record sections carry the
 * compounds, read back through the codec from the plugin's own lines.
 */
export interface WorldbuildingRecord {
  id: string;
  entityId: string;
  projectId: string;
  path: string;
  kind: WorldbuildingKindId;
  name: string;
  rank: number;
  /** False when `rank` is the fallback because the note stores no usable rank. */
  hasStoredRank: boolean;
  /** Null while the note has never chosen a progress status. */
  progressStatus: ProgressStatus | null;
  aliases: string[];
  /** Category links exactly as stored, `[[…/Full/Path/_self|Full/Path]]`. */
  categories: string[];
  description: string;
  timeKind: TimeKind | null;
  /** Raw stored term, a wikilink or plain text; empty when absent. */
  timeStart: string;
  timeEnd: string;
  worldStatus: RecordLine[];
  relationships: RecordLine[];
  /**
   * Lines in each record section the grammar does not cover, kept verbatim
   * per section so a rewrite re-emits them where they were found.
   */
  worldStatusUnrecognized: string[];
  relationshipsUnrecognized: string[];
  notes: string;
  /** The custom-fields block as stored; empty while the note carries none. */
  customFields: string;
  sectionHealth: ManagedSectionsInspection;
  /** True while the note carries an older release's schema stamp. */
  unmigrated: boolean;
  /** Stable fingerprint of the complete managed Markdown note. */
  revision: string;
  readOnly: boolean;
}

export interface EntityInput {
  kind: WorldbuildingKindId;
  name: string;
  aliases?: string[];
  /** Category paths chosen in the picker, `Time/Era`; links are built here. */
  categoryPaths?: string[];
  progressStatus?: ProgressStatus | null;
  description?: string;
  timeKind?: TimeKind | null;
  timeStart?: string;
  timeEnd?: string;
  worldStatus?: RecordLine[];
  relationships?: RecordLine[];
  notes?: string;
  customFields?: string;
}

export interface EntityPatch {
  /** Revision shown to the editor before the user began changing fields. */
  expectedRevision: string;
  name?: string;
  aliases?: string[];
  categoryPaths?: string[];
  progressStatus?: ProgressStatus | null;
  description?: string;
  timeKind?: TimeKind | null;
  timeStart?: string;
  timeEnd?: string;
  worldStatus?: RecordLine[];
  relationships?: RecordLine[];
  notes?: string;
  customFields?: string;
}

export interface ArtifactSnapshot {
  path: string;
  content: string;
  revision: string;
  frontmatter: ManagedFrontmatter;
  readOnly: boolean;
}

export interface ProjectFrontmatterPatch {
  title?: string;
  locale?: ProjectLanguage;
  steps?: Partial<Record<StepId, StepStatus>>;
  draftPath?: string | null;
  reviewedFingerprints?: StepFingerprintMap;
}
