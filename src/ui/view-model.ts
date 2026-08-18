import type { Menu } from 'obsidian';

import type {
	CharacterType,
	EntityKindId,
	ProgressStatus,
	ProjectWorldbuildingKind,
	StepId,
	StepStatus,
	TimeKind,
	WorldbuildingKindId,
	WritingCountMode,
} from '../domain';
import type { CustomField, MarkerIssueCode, RecordLine } from '../templates';
import type { SessionPanelBridge } from './session-panel';
import type {
	CustomFieldTemplateInfo,
	DefinitionForest,
	KindMutationResult,
	MemberUsage,
	ProjectStructureIssueCode,
	SaveCustomFieldTemplateResult,
} from '../services';

import type {
	CharacterOption,
	CreateCharacterRequest,
	CreateProjectRequest,
	CreateSceneRequest,
	EntityFormRequest,
	Translate,
} from './modals';

/**
 * Every base the dashboard can open or restore, one per generated file. Open
 * like the kind ids: `characters`, `scenes`, or any kind id.
 */
export type ProjectBaseChoice = WorldbuildingKindId;

export type DefinitionFileChoice = 'category' | 'world-status' | 'relationship';

export type AddDefinitionPathResult =
	| { ok: true }
	| {
			ok: false;
			code: 'invalid-segment' | 'too-deep';
			segment: string;
	  };

export type RenameDefinitionPathResult =
	| { ok: true; taxonomyPath: string }
	| {
			ok: false;
			code: 'invalid-segment' | 'taken';
			segment: string;
	  };

/**
 * What a kind mutation came to, with refusals as data for the modal: the
 * service's own result, under the name the UI has always called it.
 */
export type KindMutationOutcome = KindMutationResult;

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
	/** The custom-fields block as stored; empty while the note carries none. */
	customFields: string;
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
	/** The custom-fields block as stored; empty while the note carries none. */
	customFields: string;
	revision: string;
	readOnly: boolean;
	healthIssues: ManagedSectionIssueViewModel[];
}

export interface WorldbuildingEntityViewModel {
	id: string;
	path: string;
	name: string;
	kind: WorldbuildingKindId;
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
	/** The custom-fields block as stored; empty while the note carries none. */
	customFields: string;
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
	/** Every kind the project has, in rail order, customs included. */
	worldbuildingKinds: ProjectWorldbuildingKind[];
	worldbuilding: Record<WorldbuildingKindId, WorldbuildingEntityViewModel[]>;
	/** The three vocabularies across every kind, for the definition panes. */
	definitions: Record<DefinitionFileChoice, DefinitionForest>;
	/** Every kind's custom-field templates, for the pane and the pickers. */
	customFieldTemplates: Record<EntityKindId, CustomFieldTemplateInfo[]>;
	/** Writable member notes that predate the generated fields block. */
	outdatedNotes: number;
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

/** One kind's rows of the model; empty for a pane left on a kind since gone. */
export function kindEntities(
	model: ProjectDashboardModel,
	kind: WorldbuildingKindId,
): WorldbuildingEntityViewModel[] {
	return model.worldbuilding[kind] ?? [];
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

/**
 * What a stream is doing with words right now, for whoever counts them: the
 * project whose manuscript it shows, the segment being edited with its
 * unsaved text, and what stands selected in that segment. All null together
 * while the stream is prose from end to end.
 */
export interface ManuscriptWritingContext {
	projectPath: string | null;
	editingPath: string | null;
	body: string | null;
	selection: string | null;
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
	/**
	 * The stream's writing context moved: a segment began or finished being
	 * edited, its text grew, or its selection changed. Carries nothing,
	 * because the host reads the context back from whichever stream is in
	 * front — a report from a stream in a background pane must not speak for
	 * the one the author is looking at.
	 */
	manuscriptWritingChanged(): void;
	/**
	 * One segment's text changed under typing, with the text it now holds.
	 * Unlike the report above this one carries its subject, because a writing
	 * session tracks the note that was edited wherever its pane sits.
	 */
	manuscriptSegmentEdited(path: string, body: string): void;
}

export interface DashboardHost {
	t: Translate;
	/** The bridge the statistics pane renders the session panel through. */
	writingSessions(): SessionPanelBridge;
	translateForProject(
		locale: 'en' | 'zh-CN' | null,
		key: string,
		vars?: Record<string, string | number>,
	): string;
	getRecentStep(): StepId;
	isReduceMotionEnabled(): boolean;
	/** True while the tables write each note's progress status under its name. */
	showsTableProgressStatus(): boolean;
	/** True while a table's rows wear their actions as a column of buttons. */
	showsTableActionsColumn(): boolean;
	/** True while the dashboard sets the ten steps aside for freeform work. */
	isFreeformModeEnabled(): boolean;
	/** The convention the writing count follows. */
	writingCountMode(): WritingCountMode;
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
	selectWorldbuildingKind(kind: WorldbuildingKindId): Promise<void>;
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
	/** Registers a new custom kind, or reports why the name cannot be it. */
	createWorldbuildingKind(
		name: string,
		appearance: { icon: string; description: string },
	): Promise<KindMutationOutcome>;
	/** Renames one custom kind, carrying every reference with it. */
	renameWorldbuildingKind(
		kind: WorldbuildingKindId,
		newName: string,
	): Promise<KindMutationOutcome>;
	/** Records the kind's icon and pane sentence; empty strings clear them. */
	setKindAppearance(
		kind: WorldbuildingKindId,
		appearance: { icon: string; description: string },
	): Promise<void>;
	/** What deleting the kind takes with it, for the confirmation to read. */
	worldbuildingKindUsage(
		kind: WorldbuildingKindId,
	): Promise<{ entityCount: number; usage: MemberUsage }>;
	/** Trashes the kind whole: folder, notes, vocabularies, base, registry. */
	deleteWorldbuildingKind(kind: WorldbuildingKindId): Promise<void>;
	/** The note seeding one kind's default custom fields, when one is chosen. */
	kindTemplatePath(kind: EntityKindId): Promise<string | null>;
	/** Records that choice; null clears it. */
	setKindTemplate(kind: EntityKindId, path: string | null): Promise<void>;
	/** The default fields the chosen template note defines right now. */
	kindTemplateFields(kind: EntityKindId): Promise<CustomField[]>;
	/** The fields one named template stores, for the dialog that edits them. */
	customFieldTemplateFields(
		kind: EntityKindId,
		name: string,
	): Promise<CustomField[]>;
	/** Writes one template: add, edit, or an export allowed to overwrite. */
	saveCustomFieldTemplate(
		kind: EntityKindId,
		input: { name: string; description: string; fields: CustomField[] },
		options?: { previousName?: string; overwrite?: boolean },
	): Promise<SaveCustomFieldTemplateResult>;
	/** Trashes one template and clears every choice that named it. */
	deleteCustomFieldTemplate(kind: EntityKindId, name: string): Promise<void>;
	reorderEntity(
		kind: WorldbuildingKindId,
		entityId: string,
		targetIndex: number,
	): Promise<void>;
	createSceneCanvas(): Promise<void>;
	openProjectBase(id: ProjectBaseChoice): Promise<void>;
	/** Rewrites the base from the current template and opens it. */
	restoreProjectBase(id: ProjectBaseChoice): Promise<void>;
	/** The paths one kind's definition file offers, in its heading order. */
	listDefinitionPaths(
		kind: EntityKindId,
		id: DefinitionFileChoice,
	): Promise<string[]>;
	/** Vault paths of one kind's definition files, for the links records store. */
	definitionFilePaths(
		kind: EntityKindId,
	): Promise<Record<DefinitionFileChoice, string>>;
	/** Appends a new path, reporting a refusal instead of throwing it. */
	addDefinitionPath(
		kind: EntityKindId,
		id: DefinitionFileChoice,
		path: string,
		description?: string,
	): Promise<AddDefinitionPathResult>;
	/** Renames one node and rewrites every member link into its subtree. */
	renameDefinitionNode(
		kind: EntityKindId,
		id: DefinitionFileChoice,
		taxonomyPath: string,
		newName: string,
	): Promise<RenameDefinitionPathResult>;
	/** Trashes one node's subtree and drops it from members' category lists. */
	deleteDefinitionNode(
		kind: EntityKindId,
		id: DefinitionFileChoice,
		taxonomyPath: string,
	): Promise<void>;
	/** Writes what one node means, on its note and its generated block. */
	updateDefinitionDescription(
		kind: EntityKindId,
		id: DefinitionFileChoice,
		taxonomyPath: string,
		description: string,
	): Promise<void>;
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
