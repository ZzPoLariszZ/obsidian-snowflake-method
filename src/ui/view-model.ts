import type { Menu } from 'obsidian';

import type {
	CharacterType,
	CompiledHighlightRules,
	DialoguePresentation,
	DialogueStyle,
	EntityKindId,
	EntityMatcher,
	EntityRosterEntry,
	Foreshadowing,
	ForeshadowingEdit,
	ForeshadowingOccurrence,
	ForeshadowingRef,
	MacaronColor,
	ManuscriptPresentation,
	MentionHighlightMode,
	MilestoneCountOptions,
	MilestoneMode,
	MentionIgnore,
	OccurrencePlacement,
	OccurrenceRole,
	ProgressStatus,
	ProjectWorldbuildingKind,
	Revision,
	SensitiveMatcher,
	StepId,
	StepStatus,
	TimeKind,
	WorldbuildingKindId,
	WritingCountMode,
} from '../domain';
import type { CustomField, MarkerIssueCode, RecordLine } from '../templates';
import type { WikilinkTarget } from './segment-editor-backend';
import type { EntitiesPanelBridge } from './entities-panel';
import type { ProsePanelBridge } from './prose-panel';
import type { ForeshadowingPanelBridge } from './foreshadowing-panel';
import type { StickyNoteBridge } from './sticky-note-bridge';
import type { TaskBoardBridge } from './task-bridge';
import type { StoryStructureVisualization } from './story-structure-state';
import type { RevisionPanelBridge } from './revision-panel';
import type {
	SessionPanelBridge,
	SessionPanelContext,
} from './session-panel';
import type {
	CustomFieldTemplateInfo,
	DefinitionForest,
	KindMutationResult,
	MemberUsage,
	ProjectStructureIssueCode,
	SaveCustomFieldTemplateResult,
	ScenePatch,
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
	/** The board tint, or null while the scene wears none. */
	color: MacaronColor | null;
	/** Manuscript links as stored, each with what the board shows and opens. */
	linkedManuscript: {
		raw: string;
		linktext: string;
		target: string;
		label: string;
	}[];
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
	/** Manuscript note paths in the stream's reading order for linked scene previews. */
	manuscriptPaths: readonly string[];
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

/**
 * A save the note refused because it had changed on disk since the stream
 * last read it. A class of its own, so the stream can tell it from a failure
 * and take the note's new revision without losing the author's text.
 */
export class ManuscriptSaveConflict extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ManuscriptSaveConflict';
	}
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
	/** Brackets and quotes close themselves in the editor. */
	autoPairBrackets: boolean;
	/** Emphasis markers close themselves in the editor. */
	autoPairMarkdown: boolean;
	/** Enter puts the paragraph break; Shift+Enter the plain line break. */
	enterParagraph: boolean;
	/** Whether the registered sensitive words are marked on the page. */
	sensitiveHighlight: boolean;
	/** The custom rules' master switch, the one the command also flips. */
	customHighlights: boolean;
	/** The faces most recently set, newest first, for the font picker's list. */
	recentFonts: readonly string[];
	/** How the page is dressed: typography, ground and guides, both halves. */
	presentation: ManuscriptPresentation;
	/** Which entity mentions the stream marks where they stand in the prose. */
	mentionHighlight: MentionHighlightMode;
	/**
	 * The word milestones drawn beside the rows: whether at all, what the
	 * count accumulates over, every how many units, and the convention it
	 * counts by -- the status bar's own, so a milestone never disagrees with
	 * the number the reader is shown.
	 */
	milestones: {
		enabled: boolean;
		mode: MilestoneMode;
		interval: number;
		count: MilestoneCountOptions;
	};
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
	/**
	 * The entities the wikilink popup may offer for one project, each name
	 * and alias already shaped into an entry. Empty when there is no project
	 * to draw from.
	 */
	listWikilinkTargets(
		projectPath: string | null,
	): Promise<readonly WikilinkTarget[]>;
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
	/**
	 * This plugin's own labelled group of items, as the file menu shows them.
	 * `lead` items land right after the group's label, ahead of the standing
	 * entries, for whatever the click itself was about.
	 */
	addProjectMenuSection(
		menu: Menu,
		path: string,
		source?: string,
		lead?: (menu: Menu) => void,
	): void;
	/** Records where the author was working, for the dashboard to offer later. */
	rememberManuscriptNote(projectId: string, path: string): void;
	/**
	 * Joins a note with the one after it, the earlier one surviving, once the
	 * author has agreed to it. `onAgreed` runs between the answer and the
	 * join, as `onNamed` does above. Resolves false when nothing was joined.
	 */
	mergeManuscriptSegments(
		projectPath: string,
		path: string,
		onAgreed?: SegmentNamed,
	): Promise<boolean>;
	/**
	 * Turns one writing mode for every stream at once: typewriter on and off,
	 * focus around its levels. The buttons live in each segment's header, but
	 * the mode is the author's, not the note's.
	 */
	toggleManuscriptMode(mode: 'typewriter' | 'focus'): Promise<void>;
	/**
	 * The page's dress, changed from the stream's own popover. One dress for
	 * every stream, as the settings page sets it: saved, and announced so
	 * every open stream hears of it.
	 */
	setManuscriptPresentation(
		patch: Partial<ManuscriptPresentation>,
	): Promise<void>;
	/** Whether Enter puts the paragraph break, changed from the popover. */
	setManuscriptEnterParagraph(on: boolean): Promise<void>;
	/** Which entity mentions the streams mark, changed from the toolbar. */
	setManuscriptMentionHighlight(mode: MentionHighlightMode): Promise<void>;
	/** The reader's mention-ignore rules for one project. */
	mentionIgnores(
		projectPath: string | null,
	): Promise<readonly MentionIgnore[]>;
	/** The project's standing revisions, for the feed both halves share. */
	manuscriptRevisions(
		projectPath: string | null,
	): Promise<readonly Revision[]>;
	/**
	 * Every manuscript note's writing count in reading order, under the
	 * status bar's convention, for the milestones that accumulate across
	 * chapters. A note that will not read is absent from the map.
	 */
	manuscriptSegmentTotals(
		projectPath: string | null,
	): Promise<ReadonlyMap<string, number>>;
	/** Writes the whole manuscript as plain text under the export settings. */
	exportManuscript(projectPath: string | null): Promise<void>;
	/** Writes one note as plain text under the export settings. */
	exportManuscriptSegment(
		projectPath: string | null,
		path: string,
	): Promise<void>;
	/** One note's plain text under the export settings, for the clipboard. */
	manuscriptSegmentPlainText(
		projectPath: string | null,
		path: string,
	): Promise<string | null>;
	/**
	 * Writes one revision, then re-dresses streams and dashboards. False when
	 * the write did not happen -- no project answers for the path any more, or
	 * the project is read-only -- so a caller can say so rather than assuming
	 * its words landed.
	 */
	createRevision(
		projectPath: string | null,
		revision: Revision,
	): Promise<boolean>;
	/** Rewrites one revision's proposed text and comment; false as above. */
	updateRevision(
		projectPath: string | null,
		id: string,
		patch: { proposed: string; comment: string },
	): Promise<boolean>;
	/**
	 * Takes one revision out: an accept, a reject or a discard alike. False
	 * only when the write was refused, so a caller that has already changed
	 * the author's text can say the record it meant to retire is still there.
	 * A revision another view removed first answers true: it is gone, which
	 * is what was asked.
	 */
	discardRevision(projectPath: string | null, id: string): Promise<boolean>;
	/** A fresh id for a revision about to be captured. */
	mintRevisionId(): string;
	/** The project's foreshadowing, for the feed both halves share. */
	manuscriptForeshadowings(
		projectPath: string | null,
	): Promise<readonly Foreshadowing[]>;
	/** The same threads in the order the dashboard's table lists them, for a picker. */
	orderedForeshadowings(
		projectPath: string | null,
	): Promise<readonly Foreshadowing[]>;
	/**
	 * Writes one thread, then re-dresses streams and dashboards. False when
	 * the write did not happen -- no project answers for the path, the
	 * project is read-only, or the store refused -- so a form can stay open
	 * on what was typed rather than assuming its words landed.
	 */
	createForeshadowing(
		projectPath: string | null,
		item: Foreshadowing,
	): Promise<boolean>;
	/** The edit form's save, one write; false as above, or when the thread is gone. */
	editForeshadowing(
		projectPath: string | null,
		id: string,
		next: ForeshadowingEdit,
	): Promise<boolean>;
	/**
	 * Takes one thread out with every occurrence it holds. False only when
	 * the write was refused; a thread another view deleted first answers
	 * true, since it is gone, which is what was asked.
	 */
	deleteForeshadowing(projectPath: string | null, id: string): Promise<boolean>;
	/** Appends one occurrence to a thread; false as for `createForeshadowing`. */
	addForeshadowingOccurrence(
		projectPath: string | null,
		id: string,
		occurrence: ForeshadowingOccurrence,
	): Promise<boolean>;
	/** Rewrites one occurrence's role and note; false as above. */
	updateForeshadowingOccurrence(
		projectPath: string | null,
		id: string,
		occurrenceId: string,
		patch: { role: OccurrenceRole; note: string },
	): Promise<boolean>;
	/** Takes one occurrence out; false only when the write was refused. */
	deleteForeshadowingOccurrence(
		projectPath: string | null,
		id: string,
		occurrenceId: string,
	): Promise<boolean>;
	/** Puts one occurrence on a fresh passage; false as for `editForeshadowing`. */
	relinkForeshadowingOccurrence(
		projectPath: string | null,
		id: string,
		occurrenceId: string,
		placement: OccurrencePlacement,
	): Promise<boolean>;
	/** Fresh ids for a thread and an occurrence about to be captured. */
	mintForeshadowingId(): string;
	mintOccurrenceId(): string;
	/**
	 * Every entity a thread may be about, with the stable id a ref is kept
	 * by and the group the pickers list it under. Read-only projects answer
	 * too: their members still hold names a ref can point at.
	 */
	foreshadowingEntityRoster(
		projectPath: string | null,
	): Promise<readonly EntityRosterEntry[]>;
	/**
	 * Every occurrence no chapter still answers for, project-wide, for the
	 * relink search. A sweep over every chapter carrying occurrences, so it
	 * is asked only when the author opens that search.
	 */
	unresolvedForeshadowingOccurrences(
		projectPath: string | null,
	): Promise<readonly ForeshadowingRef[]>;
	/**
	 * Opens the thread's own editor -- name, description, status, related
	 * entities, and the role and note of each occurrence -- whose save is one
	 * write. Resolves when the dialog closes, whichever way.
	 */
	openForeshadowingEditor(projectPath: string | null, id: string): Promise<void>;
	/** Writes one ignore rule, then re-dresses every open stream. */
	addMentionIgnore(
		projectPath: string | null,
		rule: MentionIgnore,
	): Promise<void>;
	/** Takes one ignore rule back out, then re-dresses every open stream. */
	removeMentionIgnore(
		projectPath: string | null,
		rule: MentionIgnore,
	): Promise<void>;
	/**
	 * The matcher for the project's roster, the wikilink popup's own list:
	 * what highlights is exactly what completes. Null without a project.
	 */
	manuscriptEntityMatcher(
		projectPath: string | null,
	): Promise<EntityMatcher | null>;
	/**
	 * The dress-only matchers and modes, read straight from settings: the
	 * sensitive list, the compiled highlight rules, and how dialogue shows --
	 * each feature empty or off when disabled. Synchronous because the
	 * settings are already in hand, and memoized behind fingerprints so
	 * asking is free.
	 */
	manuscriptDressFeeds(): {
		sensitive: SensitiveMatcher;
		highlights: CompiledHighlightRules;
		dialogue: {
			styles: readonly DialogueStyle[];
			presentation: DialoguePresentation;
		};
	};
	/** Stores the dialogue presentation, from the bar's own menu. */
	setDialoguePresentation(mode: DialoguePresentation): Promise<void>;
	/** Turns the sensitive-word marks, the settings page's own switch. */
	setSensitiveHighlight(on: boolean): Promise<void>;
	/** Turns the custom rules' marks, master of the whole family. */
	setCustomHighlights(on: boolean): Promise<void>;
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

/** What another surface asks the dashboard's scene form to do. */
export type SceneFormIntent =
	| { mode: 'create'; afterIndex: number | null }
	| { mode: 'edit'; id: string; section?: 'linked-manuscript' };

export interface DashboardHost {
	t: Translate;
	/** The bridge the statistics pane renders the session panel through. */
	writingSessions(context: SessionPanelContext): SessionPanelBridge;
	/** The bridge the statistics pane renders the prose panel through. */
	proseStatistics(context: SessionPanelContext): ProsePanelBridge;
	/** The bridge the statistics pane renders the tracking panel through. */
	entityTracking(context: SessionPanelContext): EntitiesPanelBridge;
	/** The bridge the task management pane renders the revision table through. */
	revisionTable(context: SessionPanelContext): RevisionPanelBridge;
	/** The bridge the task management pane renders the foreshadowing table through. */
	foreshadowingTable(context: SessionPanelContext): ForeshadowingPanelBridge;
	/** The bridge the task management pane and the sidebar render the sticky notes through. */
	stickyNotes(context: SessionPanelContext): StickyNoteBridge;
	/** The bridge the task management pane renders the task board through. */
	taskBoard(context: SessionPanelContext): TaskBoardBridge;
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
	/**
	 * One field at a time, under the revision the card was drawn from, the
	 * way a board edits in place. Answers the note's fresh revision, so the
	 * next edit can carry it rather than the one drawn a moment ago. The
	 * project stays explicit so queued saves remain bound after a tab closes.
	 */
	patchScene(id: string, patch: ScenePatch, projectPath: string): Promise<string>;
	/** The named project's manuscript notes in reading order, for pickers and filters. */
	listManuscriptNotes(projectPath: string): Promise<{ path: string; title: string }[]>;
	/**
	 * Opens the scene form on the dashboard of the current project, opening a
	 * dashboard behind the asker when none is; resolves when the modal closes,
	 * with the scene a create made.
	 */
	openSceneForm(intent: SceneFormIntent): Promise<string | null>;
	/** Opens an existing character's edit form without switching away from the caller. */
	openCharacterForm(id: string): Promise<void>;
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
	/**
	 * Brings the story structure view forward, on the visualization asked
	 * for when one is; a new leaf when asked, or when none stands open.
	 */
	openStoryStructure(
		visualization?: StoryStructureVisualization,
		options?: { newTab?: boolean; projectPath?: string | null },
	): Promise<void>;
	checkCurrentProject(): Promise<RepairReportViewModel>;
	repairMissingStructureItem(path: string, field?: string): Promise<void>;
	/** Writes the fields block into every member note that predates it. */
	migrateMemberNotes(): Promise<{ migrated: number; skipped: number }>;
}
