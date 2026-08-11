import type {
  CharacterType,
  ProjectLanguage,
  StepFingerprintMap,
  StepId,
  StepStatus,
  StepStatusMap,
} from "../domain";
import type { ManagedFrontmatter } from "../repository";
import type {
  ManagedSectionsInspection,
  MarkerIssueCode,
} from "../templates";

export const DEFAULT_PROJECT_ROOT = "Snowflake Projects";

export const PROJECT_DIRECTORY_KEYS = [
  "system",
  "summaries",
  "characters",
  "synopses",
  "scenes",
  "draft",
  "materials",
  "archive",
] as const;

export type ProjectDirectoryKey = (typeof PROJECT_DIRECTORY_KEYS)[number];

export interface ProjectPathLayout {
  projectFileName: string;
  directories: Readonly<Record<ProjectDirectoryKey, string>>;
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
      materials: "80_Material",
      archive: "90_Archive",
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
      materials: "80_素材",
      archive: "90_存档",
    },
    draftFileName: "初稿.md",
  },
};

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
}

export interface ProjectLinks {
  draft: string | null;
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
  "mismatched-project-folder",
  "invalid-artifact-metadata",
  "dangling-scene-pov",
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
] as const;

export type ProjectStructureIssueCode =
  (typeof PROJECT_STRUCTURE_ISSUE_CODES)[number];

/** A project-level contract problem that exists before marker inspection. */
export interface ProjectStructureIssue {
  code: ProjectStructureIssueCode;
  path: string;
  stepIds: StepId[];
  field?: string;
  expected?: string;
  canOpen: boolean;
  /** True only when the issue has a deterministic, content-preserving fix. */
  repairable: boolean;
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
  oneSentenceStoryline?: string;
  motivation?: string;
  goal?: string;
  conflict?: string;
  growth?: string;
  oneParagraphStoryline?: string;
  characterSynopsis?: string;
  characterProfile?: string;
}

export interface CharacterPatch {
  /** Revision shown to the editor before the user began changing fields. */
  expectedRevision: string;
  name?: string;
  type?: CharacterType;
  oneSentenceStoryline?: string;
  motivation?: string;
  goal?: string;
  conflict?: string;
  growth?: string;
  oneParagraphStoryline?: string;
  characterSynopsis?: string;
  characterProfile?: string;
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
  type: CharacterType;
  oneSentenceStoryline: string;
  motivation: string;
  goal: string;
  conflict: string;
  growth: string;
  oneParagraphStoryline: string;
  characterSynopsis: string;
  characterProfile: string;
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
  time?: string;
  location?: string;
  characters?: string[];
  conflict?: string;
  events?: string;
  planning?: string;
}

export interface ScenePatch {
  /** Revision shown to the editor before the user began changing fields. */
  expectedRevision: string;
  title?: string;
  povPath?: string | null;
  time?: string;
  location?: string;
  characters?: string[];
  conflict?: string;
  events?: string;
  planning?: string;
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
  povPath: string | null;
  time: string;
  location: string;
  characters: string[];
  conflict: string;
  events: string;
  planning: string;
  sectionHealth: ManagedSectionsInspection;
  /** True while the note lacks the fields block or still holds the legacy conflict section. */
  unmigrated: boolean;
  /** Stable fingerprint of the complete managed Markdown note. */
  revision: string;
  readOnly: boolean;
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
