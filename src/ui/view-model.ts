import type { Menu } from 'obsidian';

import type {
	CharacterType,
	EntityKind,
	ProgressStatus,
	StepId,
	StepStatus,
	TimeKind,
	WorldbuildingKind,
} from '../domain';
import type { MarkerIssueCode, RecordLine } from '../templates';
import type { ProjectStructureIssueCode } from '../services';

import type {
	CharacterOption,
	CreateCharacterRequest,
	CreateProjectRequest,
	CreateSceneRequest,
	EntityFormRequest,
	Translate,
} from './modals';

/** Every base the dashboard can open or restore, one per generated file. */
export type ProjectBaseChoice = 'characters' | 'scenes' | WorldbuildingKind;

export type DefinitionFileChoice = 'category' | 'world-status' | 'relationship';

export type AddDefinitionPathResult =
	| { ok: true }
	| {
			ok: false;
			code: 'invalid-segment' | 'too-deep';
			segment: string;
	  };

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
	/** What the issue found, one to a line under the message. */
	names: string[];
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
	/** Null when no category names a role and no legacy key stores one. */
	type: CharacterType | null;
	progressStatus: ProgressStatus | null;
	aliases: string[];
	/** Full category paths for display and the picker, role excluded. */
	categoryPaths: string[];
	oneSentenceStoryline: string;
	oneParagraphStoryline: string;
	motivation: string;
	goal: string;
	conflict: string;
	growth: string;
	worldStatus: RecordLine[];
	relationships: RecordLine[];
	revision: string;
	readOnly: boolean;
	healthIssues: ManagedSectionIssueViewModel[];
}

export interface SceneViewModel {
	id: string;
	path: string;
	title: string;
	rank: number;
	progressStatus: ProgressStatus | null;
	aliases: string[];
	/** Full category paths for display and the picker. */
	categoryPaths: string[];
	povPath: string;
	povName: string;
	/** The stored point of view names a character the project no longer has. */
	povMissing: boolean;
	/** Time notes the scene names, as stored links or plain words. */
	times: string[];
	/** Places the scene names, as stored links or plain words. */
	locations: string[];
	characterPaths: string[];
	conflict: string;
	worldStatus: RecordLine[];
	relationships: RecordLine[];
	events: string;
	revision: string;
	readOnly: boolean;
	healthIssues: ManagedSectionIssueViewModel[];
}

export interface WorldbuildingEntityViewModel {
	id: string;
	path: string;
	name: string;
	kind: WorldbuildingKind;
	rank: number;
	progressStatus: ProgressStatus | null;
	aliases: string[];
	/** Full category paths for display and the picker. */
	categoryPaths: string[];
	description: string;
	timeKind: TimeKind | null;
	/** Raw stored terms, wikilinks or plain text; empty when absent. */
	timeStart: string;
	timeEnd: string;
	/** The stored start or end names a note the Vault no longer has. */
	timeStartMissing: boolean;
	timeEndMissing: boolean;
	worldStatus: RecordLine[];
	relationships: RecordLine[];
	revision: string;
	readOnly: boolean;
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
	worldbuilding: Record<WorldbuildingKind, WorldbuildingEntityViewModel[]>;
	/** Writable member notes that predate the generated fields block. */
	unmigratedMembers: number;
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
	/** What the check found, one to a line under the message. */
	names: string[];
	action: string | null;
	canOpen: boolean;
	repairable: boolean;
	repairField: string | null;
	/** Set when the entry is a member note, so the report can offer its form. */
	memberId: string | null;
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
	/** The line being written held at the middle of the page. */
	typewriter: boolean;
	/** How far the fading reaches; 'off' fades nothing. */
	focusLevel: 'off' | 'on' | 'deep' | 'solo';
}

/**
 * Run once the author has settled on a name for a new note, and before the note
 * is made.
 *
 * Both of these begin by asking a question the answer to which may be no.
 * Anything the page must do to get ready — putting an editor away, which
 * changes the height of the note it was in — belongs after the answer, or the
 * words move while the author is still deciding whether to move them.
 */
export type SegmentNamed = () => Promise<void>;

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
		onNamed?: SegmentNamed,
	): Promise<string | null>;
	splitManuscriptSegment(
		projectPath: string,
		path: string,
		offset: number,
		onNamed?: SegmentNamed,
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
	/**
	 * Turns one writing mode for every stream at once: typewriter on and off,
	 * focus around its levels. The buttons live in each segment's header, but
	 * the mode is the author's, not the note's.
	 */
	toggleManuscriptMode(mode: 'typewriter' | 'focus'): Promise<void>;
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
	/** True while a field that makes a note opens that note's form first. */
	opensFormWhenCreatingFromField(): boolean;
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
	selectWorldbuildingKind(kind: WorldbuildingKind): Promise<void>;
	createProject(request: CreateProjectRequest): Promise<CreatedProject>;
	/** Reports the character back so a field that asked for it can select it. */
	createCharacter(request: CreateCharacterRequest): Promise<CharacterOption>;
	updateCharacter(id: string, request: CreateCharacterRequest): Promise<void>;
	deleteCharacter(id: string, expectedRevision: string): Promise<void>;
	/** Reports the scene's id back, so inserting can place what it created. */
	createScene(request: CreateSceneRequest): Promise<{ id: string; path: string }>;
	createEntity(request: EntityFormRequest): Promise<{ id: string; path: string }>;
	updateEntity(id: string, request: EntityFormRequest): Promise<void>;
	deleteEntity(id: string, expectedRevision: string): Promise<void>;
	reorderEntity(
		kind: WorldbuildingKind,
		entityId: string,
		targetIndex: number,
	): Promise<void>;
	createSceneCanvas(): Promise<void>;
	openProjectBase(id: ProjectBaseChoice): Promise<void>;
	/** Rewrites the base from the current template and opens it. */
	restoreProjectBase(id: ProjectBaseChoice): Promise<void>;
	/** The paths one kind's definition file offers, in its heading order. */
	listDefinitionPaths(
		kind: EntityKind,
		id: DefinitionFileChoice,
	): Promise<string[]>;
	/** Vault paths of one kind's definition files, for the links records store. */
	definitionFilePaths(
		kind: EntityKind,
	): Promise<Record<DefinitionFileChoice, string>>;
	/** Appends a new path, reporting a refusal instead of throwing it. */
	addDefinitionPath(
		kind: EntityKind,
		id: DefinitionFileChoice,
		path: string,
		description?: string,
	): Promise<AddDefinitionPathResult>;
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
	/** Writes the fields block into every member note that predates it. */
	migrateMemberNotes(): Promise<{ migrated: number; skipped: number }>;
}
