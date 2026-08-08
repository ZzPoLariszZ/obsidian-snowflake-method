import type { Menu } from 'obsidian';

import type { CharacterType, StepId, StepStatus } from '../domain';
import type { MarkerIssueCode } from '../templates';
import type { ProjectStructureIssueCode } from '../services';

import type {
	CharacterOption,
	CreateCharacterRequest,
	CreateProjectRequest,
	CreateSceneRequest,
	Translate,
} from './modals';

export interface ProjectOption {
	path: string;
	rootPath: string;
	projectId: string;
	title: string;
	readOnly: boolean;
	hasStructureIssues: boolean;
	hasMarkerIssues: boolean;
}

export interface CreatedProject {
	path: string;
	projectId: string;
	title: string;
	locale: 'en' | 'zh-CN';
}

export interface StepViewModel {
	id: StepId;
	title: string;
	description: string;
	status: StepStatus;
	optional: boolean;
	artifactPath: string | null;
	contentReadOnly: boolean;
	healthIssues: ManagedSectionIssueViewModel[];
}

export interface ManagedSectionIssueViewModel {
	path: string;
	sectionId: string | null;
	sectionLabel: string;
	code: MarkerIssueCode | ProjectStructureIssueCode;
	message: string;
	/** What to do about it, shown on its own line. Null when the message says all. */
	action: string | null;
	blocking: boolean;
	kind: 'section' | 'structure';
	stepIds: StepId[];
	canOpen: boolean;
	repairable: boolean;
	repairField: string | null;
}

export interface CharacterViewModel {
	id: string;
	path: string;
	name: string;
	rank: number;
	type: CharacterType;
	oneSentenceStoryline: string;
	oneParagraphStoryline: string;
	motivation: string;
	goal: string;
	conflict: string;
	growth: string;
	revision: string;
	readOnly: boolean;
	/** The note's file name or heading has drifted from this name. */
	nameDrifted: boolean;
	healthIssues: ManagedSectionIssueViewModel[];
}

export interface SceneViewModel {
	id: string;
	path: string;
	title: string;
	rank: number;
	povPath: string;
	povName: string;
	/** The stored point of view names a character the project no longer has. */
	povMissing: boolean;
	time: string;
	location: string;
	characterPaths: string[];
	conflict: string;
	events: string;
	revision: string;
	readOnly: boolean;
	/** The note's file name or heading has drifted from this title. */
	nameDrifted: boolean;
	healthIssues: ManagedSectionIssueViewModel[];
}

export type StepFields = Record<string, string>;

export interface ProjectDashboardModel {
	path: string;
	projectId: string;
	title: string;
	locale: 'en' | 'zh-CN';
	readOnly: boolean;
	readOnlyReason: string | null;
	steps: StepViewModel[];
	stepFields: Partial<Record<StepId, StepFields>>;
	stepRevisions: Partial<Record<StepId, string>>;
	characters: CharacterViewModel[];
	scenes: SceneViewModel[];
	structureIssues: ManagedSectionIssueViewModel[];
	/** The manuscript note last worked in, when it is still in the vault. */
	lastManuscriptNote: { path: string; title: string } | null;
}

export interface RepairReportEntryViewModel {
	path: string;
	sectionId: string | null;
	sectionLabel: string;
	status: 'unchanged' | 'conflict';
	message: string;
	action: string | null;
	canOpen: boolean;
	repairable: boolean;
	repairField: string | null;
	/** Set when the entry is a scene, so the report can offer its editor. */
	sceneId: string | null;
}

export interface RepairReportViewModel {
	summary: string;
	entries: RepairReportEntryViewModel[];
}

export interface ManuscriptSegmentViewModel {
	path: string;
	title: string;
	sequence: number;
	readOnly: boolean;
}

export interface ManuscriptModel {
	projectPath: string;
	projectId: string;
	projectTitle: string;
	locale: 'en' | 'zh-CN';
	readOnly: boolean;
	/** Every segment of the manuscript, in reading order. */
	segments: ManuscriptSegmentViewModel[];
}

export interface ManuscriptSegmentText {
	path: string;
	/** Everything below the frontmatter. The frontmatter is never shown. */
	body: string;
	/** Fingerprint of the whole file, so a save can refuse to clobber. */
	revision: string;
	/** What the Vault says about the file, so an unchanged one can be left. */
	stamp: string;
	readOnly: boolean;
}

export interface ManuscriptWindowSettings {
	before: number;
	after: number;
	showPath: boolean;
	showSequence: boolean;
}

export interface ManuscriptHost {
	t: Translate;
	translateForProject(
		locale: 'en' | 'zh-CN' | null,
		key: string,
		vars?: Record<string, string | number>,
	): string;
	manuscriptWindowSettings(): ManuscriptWindowSettings;
	loadManuscript(projectPath: string | null): Promise<ManuscriptModel | null>;
	readManuscriptSegment(path: string): Promise<ManuscriptSegmentText>;
	/** How the Vault last saw a segment's file, without opening it. */
	manuscriptSegmentStamp(path: string): string | null;
	/** Saves one segment and reports what it now carries. */
	saveManuscriptSegment(
		path: string,
		body: string,
		expectedRevision: string,
	): Promise<{ revision: string; stamp: string }>;
	/** Creates a segment at one end of the manuscript, or after a given one. */
	createManuscriptSegment(
		projectPath: string,
		placement: { after: string } | { atStart: true } | { atEnd: true },
	): Promise<string | null>;
	splitManuscriptSegment(
		projectPath: string,
		path: string,
		offset: number,
	): Promise<string | null>;
	openManagedFile(
		path: string,
		sectionId?: string,
		highlightSectionIds?: readonly string[],
	): Promise<void>;
	/** This plugin's own labelled group of items, as the file menu shows them. */
	addProjectMenuSection(menu: Menu, path: string, source?: string): void;
	/** Records where the author was working, for the dashboard to offer later. */
	rememberManuscriptNote(projectId: string, path: string): void;
	/** Joins a note with the one after it, the earlier one surviving. */
	mergeManuscriptSegments(projectPath: string, path: string): Promise<void>;
}

export interface DashboardHost {
	t: Translate;
	translateForProject(
		locale: 'en' | 'zh-CN' | null,
		key: string,
		vars?: Record<string, string | number>,
	): string;
	getRecentStep(): StepId;
	isReduceMotionEnabled(): boolean;
	openProjectManager(
		projectLocale: 'en' | 'zh-CN' | null,
	): Promise<void>;
	getDefaultProjectLocale(): 'en' | 'zh-CN';
	syncCertificateCelebration(
		projectId: string,
		complete: boolean,
	): Promise<boolean>;
	listProjects(): Promise<ProjectOption[]>;
	loadDashboardModel(path?: string | null): Promise<ProjectDashboardModel | null>;
	selectProject(path: string): Promise<void>;
	activateProject(
		path: string,
		locale: 'en' | 'zh-CN',
		step: StepId,
	): void;
	selectStep(step: StepId): Promise<void>;
	createProject(request: CreateProjectRequest): Promise<CreatedProject>;
	/** Reports the character back so a field that asked for it can select it. */
	createCharacter(request: CreateCharacterRequest): Promise<CharacterOption>;
	updateCharacter(id: string, request: CreateCharacterRequest): Promise<void>;
	deleteCharacter(id: string, expectedRevision: string): Promise<void>;
	createScene(request: CreateSceneRequest): Promise<void>;
	createSceneCanvas(): Promise<void>;
	openProjectBase(id: 'characters' | 'scenes'): Promise<void>;
	updateScene(id: string, request: CreateSceneRequest): Promise<void>;
	deleteScene(id: string, expectedRevision: string): Promise<void>;
	setStepStatus(step: StepId, status: StepStatus): Promise<void>;
	saveStepFields(
		step: 1 | 2,
		fields: StepFields,
		expectedRevision: string,
	): Promise<void>;
	reorderScene(sceneId: string, targetIndex: number): Promise<void>;
	reorderCharacter(characterId: string, targetIndex: number): Promise<void>;
	openManagedFile(
		path: string,
		sectionId?: string,
		highlightSectionIds?: readonly string[],
	): Promise<void>;
	openStep(step: StepId): Promise<void>;
	openManuscriptStream(
		projectPath: string,
		anchorPath?: string | null,
	): Promise<void>;
	checkCurrentProject(): Promise<RepairReportViewModel>;
	repairMissingStructureItem(path: string, field?: string): Promise<void>;
}
