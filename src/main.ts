import {
	addIcon,
	MarkdownView,
	Menu,
	moment,
	normalizePath,
	Notice,
	Platform,
	Plugin,
	setIcon,
	setTooltip,
	TFile,
	TFolder,
	type EditorPosition,
	type MarkdownFileInfo,
	type TAbstractFile,
	type WorkspaceLeaf,
} from 'obsidian';

import {
	DEFAULT_STICKY_NOTE_COLOR,
	DEFAULT_STOPWORDS_EN,
	DEFAULT_STOPWORDS_ZH,
	DEFINITION_FILE_IDS,
	DIALOGUE_STYLE_TOKENS,
	parseWikiLink,
	SCENE_POV_MULTIPLE,
	SCENE_POV_OMNISCIENT,
	STEP_DEFINITIONS,
	STEP_ONE_SECTION_IDS,
	STEP_TWO_SECTION_IDS,
	STICKY_NOTE_LOCAL_STATE_KEY,
	TEMPLATE_SECTION_IDS,
	wikiLinkLabel,
	WRITING_MODES,
	WRITING_SESSION_TYPES,
	analyzeMentions,
	anchorOccurrence,
	clampSessionValue,
	compileChapterNumbering,
	compileCustomHighlightRules,
	countWriting,
	countableProse,
	countsCharacters,
	entityKindIds,
	fileStem,
	formatClock,
	getFirstIncompleteStep,
	hasWordSegmenter,
	highlightRulesFingerprint,
	isDocumentType,
	isStepId,
	isWorldbuildingKind,
	managedSectionHighlightsForStep,
	managedSectionsForDocument,
	occurrenceUnresolved,
	orderForeshadowings,
	orderOccurrences,
	parseQuotePair,
	parseSensitiveWords,
	parseStopwords,
	primaryManagedSectionForStep,
	proposeChapterNumber,
	proposeChapterRemoval,
	rememberFontFamily,
	sanitizeChapterNumberRules,
	sanitizeContentWidth,
	sanitizeCustomHighlightRules,
	sanitizeFirstLineIndent,
	sanitizeFontFamily,
	sanitizeFontSize,
	sanitizeGuide,
	sanitizeHyphenation,
	sanitizeLineHeight,
	sanitizeParagraphSpacing,
	sanitizeTextAlign,
	sanitizeTint,
	sessionPace,
	splitMentionIgnores,
	addDays,
	daysInMonth,
	deriveTasks,
	goalNetSince,
	partitionStickyNotes,
	startOfMonth,
	startOfWeek,
	stickyNotePreview,
	type DocumentType,
	type WritingSessionTiming,
	type WritingSessionScope,
	type WritingSessionType,
	type EntityKindId,
	type StepId,
	type StepStatus,
	type WorldbuildingKindId,
	type WritingCount,
	type WritingCountMode,
	type CompiledHighlightRules,
	type CustomHighlightRule,
	type DialogueOccurrence,
	type DialoguePresentation,
	type DialogueStyle,
	type EntityMatcher,
	type EntityOccurrence,
	type ManuscriptPresentation,
	type MentionHighlightMode,
	type MentionIgnore,
	type SensitiveMatcher,
	type Revision,
	type DerivedTaskSources,
	type EntityRosterEntry,
	type Task,
	type TaskEdit,
	type TaskStatus,
	type Foreshadowing,
	type ForeshadowingEdit,
	type ForeshadowingOccurrence,
	type ForeshadowingRef,
	type OccurrencePlacement,
	type OccurrenceRole,
	type StickyNoteColor,
	type ChapterFollower,
	type ChapterNumbering,
	type ChapterNumberRule,
	type ChapterNumberProposal,
	type ChapterRemovalProposal,
} from './domain';
import { resolveGlobalLocale, resolveLocale, t as translate } from './i18n';
import {
	areManagedBoundariesUnlocked,
	createManagedSectionEditorExtension,
	createSelectionWatchExtension,
	type EditorFocusReport,
	findEditorViewForMarkdownInfo,
	flashManagedMarkerIssue,
	flashManagedSections,
	isManagedSectionEditorLivePreview,
	refreshManagedSectionDecorations,
	resolveManagedSectionNavigationTarget,
	resolveManagedMarkerIssueNavigationTarget,
	resolveManagedSectionLocale,
	setManagedBoundariesUnlocked,
	type ManagedSectionEditorContext,
	type ManagedSectionEditorIdentity,
	type ManagedSectionEditorStrings,
} from './editor';
import {
	ConcurrentChangeError,
	ManagedFileNotFoundError,
	PathConflictError,
	UnsafeSectionError,
	UnsupportedSchemaError,
	documentTypeOf,
	parseMarkdownFrontmatter,
	projectIdOf,
} from './repository';
import {
	createStableId,
	type ScenePatch,
	sessionClockMs,
	SnowflakeProjectService,
	ExportIntoManuscriptError,
	projectExportRoot,
	type ManuscriptExportOptions,
	type ManuscriptExportPlan,
	type ManuscriptExportScope,
	type SegmentRenameOutcome,
	ArchiveFolderIsProjectError,
	DuplicateNameError,
	KindRegistrationRefusedError,
	MEMBER_FIELDS_SECTION_BY_DOCUMENT,
	ProjectCreationInterruptedError,
	PROJECT_PATH_LAYOUTS,
	definitionRootNameForFolder,
	entitiesOf,
	entityKindFolder,
	isMemberDocumentType,
	MAX_DEFINITION_DEPTH,
	type KindScope,
	taxonomyPathFromValue,
	type ArtifactSnapshot,
	type CharacterRecord,
	type AnalysisConfig,
	type DialogueChapterAggregate,
	type EntityMentionAggregate,
	type MemberUsage,
	type MentionAggregate,
	type NoteCountOptions,
	type SensitiveTermAggregate,
	type ProjectRef,
	type ProjectSnapshot,
	type SaveCustomFieldTemplateResult,
	type SceneRecord,
	type TaskWrite,
	type WorldbuildingRecord,
	type WritingCountScope,
	isStickyNotePath,
	isTaskFilePath,
	isManuscriptCachePath,
	type StickyNoteRecord,
	toWikiLink,
	WritingSessionService,
	type LiveWritingSession,
	type StartWritingSessionOptions,
	type WritingSessionEvent,
} from './services';
import {
	isPathAtOrBelow,
	movedWithRename,
	normalizeProjectRoot,
	touchesAnyProject,
} from './project-root';
import {
	DEFAULT_SETTINGS,
	SnowflakeSettingTab,
	isManuscriptPresentationKey,
	sanitizeSettings,
	type ManuscriptFocusLevel,
	type SnowflakeSettings,
} from './settings';
import {
	inspectManagedDocumentSections,
	parseTerm,
	readMarkedSection,
	type CustomField,
	type ManagedMarkerIssue,
	type ManagedSectionsInspection,
} from './templates';
import {
	DASHBOARD_VIEW_TYPE,
	SnowflakeDashboardView,
} from './ui/dashboard-view';
import { entityGroupLabel, entityGroupsOf } from './ui/entity-form';
import {
	MANUSCRIPT_EDITING_HOVER_SOURCE,
	MANUSCRIPT_READING_HOVER_SOURCE,
	MANUSCRIPT_VIEW_TYPE,
	NEXT_FOCUS_LEVEL,
	SnowflakeManuscriptView,
} from './ui/manuscript-view';
import {
	confirmForeshadowingDeletion,
	promptForForeshadowing,
	promptForForeshadowingOccurrence,
} from './ui/foreshadowing-form';
import type {
	ForeshadowingPanelBridge,
	ForeshadowingReading,
} from './ui/foreshadowing-panel';
import {
	foreshadowingTableItems,
	type ForeshadowingNoteReading,
} from './ui/foreshadowing-rows';
import type {
	StickyNoteBridge,
	StickyNoteKey,
	StickyNoteFloatOptions,
} from './ui/sticky-note-bridge';
import { STICKY_NOTE_HOVER_SOURCE } from './ui/sticky-note-card';
import { confirmStickyNoteDeletion, confirmStickyNoteEmptying } from './ui/sticky-note-dialogs';
import type { TaskBoardBridge } from './ui/task-bridge';
import { confirmTaskArchiveEmptying, confirmTaskDeletion } from './ui/task-dialogs';
import { promptForTask } from './ui/task-form';
import { StickyNoteGone, StickyNoteSaveConflict } from './ui/sticky-note-editing';
import { StickyNoteFloatLayer } from './ui/sticky-note-float';
import { StickyNoteHub } from './ui/sticky-note-hub';
import {
	STICKY_NOTES_VIEW_TYPE,
	SnowflakeStickyNotesView,
} from './ui/sticky-notes-view';
import type { WikilinkTarget } from './ui/segment-editor-backend';
import {
	revisionTableRows,
	type RevisionNoteReading,
	type RevisionRow,
	type RevisionPanelBridge,
} from './ui/revision-panel';
import {
	collectWikilinkTargets,
	type WikilinkProjectMembers,
	type WikilinkSourceRecord,
} from './ui/wikilink-complete';
import {
	routeNotePane,
	type NotePaneLeaf,
	type NotePaneRoute,
} from './ui/note-pane';
import {
	STATISTICS_VIEW_TYPE,
	SnowflakeStatisticsView,
} from './ui/statistics-view';
import {
	STORY_STRUCTURE_VIEW_TYPE,
	SnowflakeStoryStructureView,
} from './ui/story-structure-view';
import {
	DEFAULT_STORY_STRUCTURE_VISUALIZATION,
	readCorkboardPreferences,
	type CorkboardPreferences,
	type StoryStructureVisualization,
} from './ui/story-structure-state';
import { renderCorkboard } from './ui/corkboard';
import type {
	SessionPanelBridge,
	SessionPanelContext,
	SessionSetup,
} from './ui/session-panel';
import type {
	EntitiesPanelBridge,
	TrackingKindSection,
} from './ui/entities-panel';
import type { ProsePanelBridge } from './ui/prose-panel';
import {
	ConfirmMemberDeletionModal,
	CreateProjectModal,
	ManageProjectsModal,
	ManagedBoundaryUnlockModal,
	RepairReportModal,
	promptForSegmentTitle,
	confirmSegmentMerge,
	confirmExportReplace,
	type SegmentTitlePrompt,
	type CharacterOption,
	type CreateCharacterRequest,
	type CreateProjectRequest,
	type CreateSceneRequest,
	promptForDefinitionKind,
	promptForDefinitionPath,
	DailyWordGoalModal,
	SessionSetupModal,
	confirmHighlightRuleDeletion,
	promptForHighlightRule,
	promptForChapterNumberRule,
	confirmChapterNumberRuleDeletion,
	type EntityFormRequest,
	type HighlightRuleFormResult,
	type ChapterNumberRuleFormResult,
	type ManageProjectLists,
	type ManageProjectOption,
	type StartSessionRequest,
	type Translate,
} from './ui/modals';
import type {
	AddDefinitionPathResult,
	CharacterViewModel,
	CreatedProject,
	DashboardHost,
	DefinitionFileChoice,
	RenameDefinitionPathResult,
	ManagedSectionIssueViewModel,
	ManuscriptHost,
	ManuscriptModel,
	ManuscriptSegmentText,
	ManuscriptWindowSettings,
	SceneFormIntent,
	SegmentNamed,
	StepFields,
	KindMutationOutcome,
	ProjectBaseChoice,
	ProjectDashboardModel,
	ProjectOption,
	RepairReportViewModel,
	SceneViewModel,
	WorldbuildingEntityViewModel,
} from './ui/view-model';
import { ManuscriptSaveConflict, kindEntities } from './ui/view-model';

const REFRESH_DELAY_MS = 250;
/**
 * How long a flurry of settings writes is gathered before it reaches the disk.
 * A typography slider answers at every stop it crosses so the page follows the
 * hand; the file is written once the hand stops.
 */
const SETTINGS_SAVE_DELAY_MS = 400;
const FIELDS_RECONCILE_DELAY_MS = 1_000;
const REDUCE_MOTION_CLASS = 'snowflake-method-reduce-motion';
const SCROLLBAR_WIDTH_PROPERTY = '--snowflake-method-scrollbar-width';
/** Below this width a second pane leaves neither side room to write in. */
const MIN_SPLIT_WIDTH_PX = 900;

/** Fields that hold writing. A date, a number, a checkbox holds none. */
const COUNTABLE_FIELD_TYPES = new Set(['text', 'search']);

/** Per-device localStorage keys: never data.json, which may sync. */
const SESSION_RECOVERY_KEY = 'snowflake-method-session-recovery';
const SESSION_DEVICE_KEY = 'snowflake-method-device-id';
const UNTIMED_RECOVERY_KEY = 'snowflake-method-untimed-recovery';
const CORKBOARD_PREFERENCES_KEY = 'snowflake-method-corkboard-preferences';

/**
 * The pomodoro's tomato, drawn here because lucide has none: a round body,
 * a stem, two leaves, on the 100-unit grid `addIcon` hands out.
 */
const POMODORO_ICON = 'snowflake-method-pomodoro';
const POMODORO_SVG = [
	'<g fill="none" stroke="currentColor" stroke-width="8"',
	' stroke-linecap="round" stroke-linejoin="round">',
	'<path d="M50 32 C 28 32 15 46 15 62 a 35 33 0 0 0 70 0 C 85 46 72 32 50 32 Z"/>',
	'<path d="M50 30 V 14"/>',
	'<path d="M50 30 C 43 22 33 19 25 23 c 6 8 16 10 25 7 Z"/>',
	'<path d="M50 30 C 57 22 67 19 75 23 c -6 8 -16 10 -25 7 Z"/>',
	'</g>',
].join('');

/**
 * How often a field being counted is looked at again. A field can stop
 * existing without a word from the DOM -- closing a modal removes the element
 * that had focus, and removal fires neither blur nor focusout -- so the one
 * count that cannot wait for an event asks again while it stands.
 */
const FIELD_RECHECK_MS = 500;

/** The nearest thing above an element that this plugin put a class on. */
function markedOwnerOf(element: Element): Element | null {
	return element.closest('[class*="snowflake-method-"]');
}

/** The vault path of one of an entity kind's tree root folders. */
function definitionRootPathFor(
	project: KindScope,
	kind: EntityKindId,
	id: DefinitionFileChoice,
): string {
	const kindFolder = entityKindFolder(project, kind);
	return normalizePath(
		`${project.rootPath}/${kindFolder}/${definitionRootNameForFolder(kindFolder, id, project.locale)}`,
	);
}

/**
 * The taxonomy path a stored category link displays. The link's target is
 * the source of truth, so the path is read from it; the alias only answers
 * for a value the root cannot explain.
 */
function categoryDisplayPath(raw: string, categoryRoot: string): string {
	return taxonomyPathFromValue(raw, categoryRoot) ?? raw;
}

/**
 * How much room a scrollbar takes in this window, or null when the window
 * cannot say yet.
 *
 * Overlaid ones, and the ones Obsidian hides outright, take none; the ones
 * Windows and Linux draw take about a dozen pixels. The panels hand that much
 * back out of the padding they already keep, so a scrollbar costs no extra
 * room -- but only a measurement can say whether there is anything to hand
 * back, and a theme can change the answer.
 *
 * Measured the way the panels reserve their room, with `scrollbar-gutter`
 * rather than a forced scrollbar: those are the same number on most machines
 * and need not be, and the number wanted here is the one the stylesheet will
 * actually spend.
 *
 * Null when nothing was laid out. A window still being built measures every
 * box at zero, and zero is a real answer here -- it is the answer for an
 * overlaid scrollbar -- so a zero taken too early cannot afterwards be told
 * from a true one. That is worth guarding rather than rounding off: the
 * padding a panel hands back is `pad - width`, so a width wrongly read as
 * zero gives the whole padding back and then loses the gutter's width off the
 * inside, which walks every field in the dialog left of the title above them.
 */
function measureScrollbarWidth(targetDocument: Document): number | null {
	const probe = targetDocument.body.createDiv();
	// Dressed here rather than from the stylesheet: this runs before the plugin's
	// own stylesheet reaches the document, and a probe with no scrollbar to
	// measure would quietly report that a scrollbar costs nothing.
	probe.setCssStyles({
		position: 'absolute',
		top: '-9999px',
		width: '100px',
		height: '100px',
		overflowY: 'auto',
		scrollbarGutter: 'stable',
		visibility: 'hidden',
	});
	const laidOut = probe.offsetWidth > 0;
	const width = probe.offsetWidth - probe.clientWidth;
	probe.remove();
	return laidOut ? width : null;
}

/** Tab group of a leaf; the companion pane is tracked by this identity. */
type NotePane = WorkspaceLeaf['parent'];

interface ProjectHealthFlags {
	hasStructureIssues: boolean;
	hasMarkerIssues: boolean;
}
const DOCUMENT_BY_MANAGED_STEP: Readonly<
	Partial<Record<StepId, DocumentType>>
> = {
	1: 'one-sentence-summary',
	2: 'one-paragraph-summary',
	4: 'plot-synopsis',
	6: 'long-synopsis',
};

export default class SnowflakeMethodPlugin
	extends Plugin
	implements DashboardHost, ManuscriptHost
{
	settings: SnowflakeSettings = { ...DEFAULT_SETTINGS };
	projects!: SnowflakeProjectService;
	/** The settings page, kept so a value changed elsewhere can reach its rows. */
	private settingTab: SnowflakeSettingTab | null = null;
	private settingsSaveTimer: number | null = null;
	private refreshTimer: number | null = null;
	private projectRescanTimer: number | null = null;
	private refreshProjectLocales = false;
	/** The sticky-note surfaces' own bell, rung once a burst of vault events has settled. */
	private stickyNoteNotifyTimer: number | null = null;
	/** The task board's own bell, rung the same way. */
	private taskNotifyTimer: number | null = null;
	/** Who wants to hear that the tasks, or a source a derived card is computed from, changed. */
	private readonly taskListeners = new Set<() => void>();
	/** The writing count in the status bar, and the text span inside it. */
	private writingCountItem: HTMLElement | null = null;
	private writingCountText: HTMLElement | null = null;
	sessions!: WritingSessionService;
	/** What every sticky-note surface shares: claims, the device's memory of the panels, the bell. */
	stickyNoteHub!: StickyNoteHub;
	/** The floating sticky notes, one layer per window, made when a window first floats one. */
	private readonly stickyLayers = new Map<Document, StickyNoteFloatLayer>();
	/** The project the layers were last reconciled to; undefined before the first pass. */
	private stickyFloatsProject: string | null | undefined = undefined;
	/** The chapters the relink sweep read, each under the stamp it was read at. */
	private readonly sweptBodies = new Map<string, { stamp: string; body: string }>();
	private lastFocusLevel: ManuscriptFocusLevel = 'off';
	private sessionItem: HTMLElement | null = null;
	private sessionIconEl: HTMLElement | null = null;
	private sessionText: HTMLElement | null = null;
	private sessionShown: { text: string; tooltip: string; look: string } | null =
		null;
	private writingCountTimer: number | null = null;
	/** When the pending count is due, so a later request cannot delay it. */
	private writingCountDue = 0;
	/** Ticks per refresh, so a slow count cannot paint over a newer one. */
	private writingCountSequence = 0;
	/** What the status bar last said, so an unchanged count repaints nothing. */
	private writingCountShown: { line: string; breakdown: string } | null = null;

	/**
	 * The last buffer counted and what it came to. A caret step schedules a
	 * recount, but the buffer it lands in is nearly always the buffer the
	 * last count read: holding an arrow key must not re-parse a novel-sized
	 * note four times a second to re-derive the same number. One slot each,
	 * because the hot pattern is "same text as a moment ago", and the slot is
	 * checked by comparing the text itself -- an identity that cannot go
	 * stale, whatever path the change arrived by.
	 */
	private bufferCountMemo: {
		body: string;
		declared: DocumentType | null;
		options: NoteCountOptions;
		count: WritingCount;
	} | null = null;

	/** The same, for the marked section under the caret. */
	private sectionCountMemo: {
		body: string;
		from: number;
		to: number;
		options: NoteCountOptions;
		count: WritingCount;
	} | null = null;

	/**
	 * The entity matcher per snapshot. A snapshot object stands until the
	 * project's tree digest moves, so a quiet stream refresh answers here
	 * without so much as a fingerprint; the service's own fingerprint slot
	 * then keeps the automaton across digest moves that left the roster
	 * alone.
	 */
	private readonly entityMatcherMemo = new WeakMap<
		ProjectSnapshot,
		EntityMatcher
	>();
	/** The compiled highlight rules, valid while their fingerprint holds. */
	private highlightRuleSet: CompiledHighlightRules | null = null;
	/**
	 * The plugin's own field the count last followed focus to. Focus events
	 * arrive from every corner of the app, and most of them change nothing
	 * about which writing is being counted.
	 */
	private writingCountField: Element | null = null;
	/** Set on teardown: no count may paint into a status bar that is gone. */
	private unloading = false;
	/** What is selected in the focused native Markdown editor, or null. */
	private editorFocus: EditorFocusReport | null = null;
	/** Reject an earlier tab activation when its deferred load finishes late. */
	private projectLeafActivation = 0;
	/** Which sidebars solo folded away, so leaving it unfolds only those. */
	private soloCollapsed: { left: boolean; right: boolean } | null = null;
	/** Whether solo took the window full screen, so leaving it lets go. */
	private soloFullscreen = false;
	private readonly motionDocuments = new Set<Document>();
	private readonly scrollbarDocuments = new Set<Document>();

	/**
	 * One hidden probe per published document, watched for size: macOS swaps
	 * overlay scrollbars for classic ones when a mouse arrives, silently and
	 * mid-session, and the probe's content box is the one thing in the page
	 * that provably moves when it happens. The observer re-publishes the
	 * measured width the moment it fires, so the panels and tables reading
	 * it never sit a whole focus-cycle out of date.
	 */
	private readonly scrollbarSentinels = new Map<
		Document,
		{ probe: HTMLElement; observer: ResizeObserver }
	>();
	private resolveProjectScanReady: () => void = () => undefined;
	/** Vault discovery must not contribute to the plugin onload critical path. */
	private readonly projectScanReady = new Promise<void>((resolve) => {
		this.resolveProjectScanReady = resolve;
	});
	private projectDiscoveryPromise: Promise<ProjectRef[]> | null = null;
	private currentProjectLocale: 'en' | 'zh-CN' | null = null;
	private notePane: NotePane | null = null;
	private readonly projectLocalesById = new Map<string, 'en' | 'zh-CN'>();
	/** Root folders of the projects discovered under the configured root. */
	private readonly knownProjectRoots = new Set<string>();
	/**
	 * The discovered projects by root folder, for resolving which project a
	 * path belongs to without a read: the untimed tracking asks on every edit
	 * anywhere in the vault. Read-only projects are left out, because nothing
	 * records into them.
	 */
	private readonly knownProjectsByRoot = new Map<string, ProjectRef>();
	/** Draft notes a project links to from outside its own folder, by root. */
	private readonly externalDrafts = new Map<string, string>();
	/** Member notes waiting for the fields-block reconcile pass. */
	private readonly pendingFieldsReconciles = new Set<string>();
	private fieldsReconcileTimer: number | null = null;
	/** Held while the migration writes, which leaves every block right anyway. */
	private fieldsReconcilePaused = false;
	/** Project health flags by project root path; see projectHealthFlags(). */
	private readonly projectHealth = new Map<
		string,
		Promise<ProjectHealthFlags>
	>();
	private settingsSaveQueue: Promise<void> = Promise.resolve();
	readonly t = (
		key: string,
		vars?: Record<string, string | number>,
	): string => translate(this.currentLocale(), key, vars);
	private readonly globalT = (
		key: string,
		vars?: Record<string, string | number>,
	): string =>
		translate(
			resolveGlobalLocale(this.settings.uiLocale, moment.locale()),
			key,
			vars,
		);

	/**
	 * The app's own surfaces that speak about a project rather than about the
	 * app: the status bar, its menus, and the notices they raise. They follow
	 * the project the author is working in, the way the dashboard and the
	 * statistics panels do, so one window is not saying the same thing in two
	 * languages at once.
	 *
	 * The command palette keeps `globalT`. Its names are registered once at
	 * load and cannot be re-registered, so a palette that followed the project
	 * would only ever show whichever language happened to be current at start.
	 */
	private readonly projectT = (
		key: string,
		vars?: Record<string, string | number>,
	): string => this.translateForProject(null, key, vars);

	readonly translateForProject = (
		locale: 'en' | 'zh-CN' | null,
		key: string,
		vars?: Record<string, string | number>,
	): string =>
		translate(
			resolveLocale(
				this.settings.uiLocale,
				moment.locale(),
				locale ??
					this.currentProjectLocale ??
					this.resolvedDefaultProjectLocale(),
			),
			key,
			vars,
		);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerEvent(
			this.app.workspace.on('window-open', (_workspaceWindow, targetWindow) => {
				this.applyMotionPreferenceToDocument(targetWindow.document);
				this.publishScrollbarWidthToDocument(targetWindow.document);
				this.registerDomEvent(targetWindow, 'focus', () => {
					this.publishScrollbarWidthToDocument(targetWindow.document);
				});
				// A popout carries writing surfaces of its own, and a session
				// must hear the typing in them.
				this.registerWritingSurfaceWatch(targetWindow.document);
			}),
		);
		this.registerEvent(
			this.app.workspace.on('window-close', (_workspaceWindow, targetWindow) => {
				targetWindow.document.body.classList.remove(REDUCE_MOTION_CLASS);
				this.motionDocuments.delete(targetWindow.document);
				targetWindow.document.body.style.removeProperty(
					SCROLLBAR_WIDTH_PROPERTY,
				);
				this.scrollbarDocuments.delete(targetWindow.document);
				this.dropScrollbarSentinel(targetWindow.document);
				// The popout's floating notes go with it, their memory kept.
				this.stickyLayers.get(targetWindow.document)?.destroy();
				this.stickyLayers.delete(targetWindow.document);
			}),
		);
		this.applyMotionPreference();
		// A theme can restyle scrollbars, which changes how much room they take.
		this.registerEvent(
			this.app.workspace.on('css-change', () => this.publishScrollbarWidth()),
		);
		// So can the machine, without saying so. macOS draws overlaid bars that
		// take no room and classic ones that take about a dozen pixels, and it
		// changes its mind when a mouse is plugged in or the setting is touched
		// -- neither of which this plugin hears about. The panels and tables
		// hand back exactly this many pixels out of their own padding, so a
		// number that has gone stale walks a table's body out of line with its
		// header. Asked again whenever the window comes forward, which is when
		// an author returns from having changed such a thing, and written back
		// only when it moved.
		this.registerDomEvent(window, 'focus', () => {
			this.publishScrollbarWidth();
		});
		this.publishScrollbarWidth();
		// Again once there is a workspace to measure against. The load above runs
		// while Obsidian is still assembling its window, where every box measures
		// zero -- and zero is what a machine with overlaid scrollbars truthfully
		// reports, so it stands unchallenged for the rest of the session.
		this.app.workspace.onLayoutReady(() => {
			this.publishScrollbarWidth();
		});
		this.register(() => {
			for (const targetDocument of this.motionDocuments) {
				targetDocument.body.classList.remove(REDUCE_MOTION_CLASS);
			}
			this.motionDocuments.clear();
			for (const targetDocument of this.scrollbarDocuments) {
				targetDocument.body.style.removeProperty(SCROLLBAR_WIDTH_PROPERTY);
			}
			this.scrollbarDocuments.clear();
			for (const targetDocument of [...this.scrollbarSentinels.keys()]) {
				this.dropScrollbarSentinel(targetDocument);
			}
		});
		this.projects = new SnowflakeProjectService(
			this.app.vault,
			this.app.fileManager,
			this.app.metadataCache,
			this.settings.projectRoot,
			{
				// The session device id names the mention index file too: one
				// identity per install, and vault sync never contests either.
				deviceId: () => this.writingSessionDeviceId(),
				now: () => Date.now(),
				// The ignores are the reader's own choices: a quarantine is
				// told the way a session file's is, never silently.
				onCorrupt: (path) => {
					new Notice(
						this.projectT('mention.notice.ignoresPreserved', { path }),
					);
				},
				// Told apart from the ignores above, because they are not the
				// same loss: what was set aside here is every proposal the
				// author had standing in this project.
				onRevisionsCorrupt: (path) => {
					new Notice(
						this.projectT('manuscript.revision.corruptPreserved', { path }),
					);
				},
				// Not a loss and not damage: another device wrote the file with
				// a build that knows more than this one, and this one has left
				// it exactly as it found it.
				onRevisionsForeign: () => {
					new Notice(this.projectT('manuscript.revision.newerSchema'));
				},
				// The foreshadowing file, told apart the same two ways.
				onForeshadowingCorrupt: (path) => {
					new Notice(
						this.projectT('manuscript.foreshadowing.corruptPreserved', {
							path,
						}),
					);
				},
				onForeshadowingForeign: () => {
					new Notice(this.projectT('manuscript.foreshadowing.newerSchema'));
				},
				// The task file, told apart the same two ways.
				onTasksCorrupt: (path) => {
					new Notice(this.projectT('tasks.corruptPreserved', { path }));
				},
				onTasksForeign: () => {
					new Notice(this.projectT('tasks.newerSchema'));
				},
				// The main window's clock, as the sessions take theirs: a
				// popout closing never takes the flush timer with it.
				timers: {
					set: (handler, ms) => window.setTimeout(handler, ms),
					clear: (handle) => {
						window.clearTimeout(handle as number);
					},
				},
			},
		);
		this.sessions = new WritingSessionService({
			repository: this.projects.repository,
			writingCount: this.projects.writingCount,
			scope: () => this.settings.sessionScope,
			goalScope: () => this.settings.sessionDailyGoalScope,
			recovery: {
				load: () => this.app.loadLocalStorage(SESSION_RECOVERY_KEY) as unknown,
				save: (snapshot) => {
					this.app.saveLocalStorage(SESSION_RECOVERY_KEY, snapshot);
				},
			},
			deviceId: () => this.writingSessionDeviceId(),
			isNoteOpen: (path) => this.isNoteOpenInEditor(path),
			trackUntimed: () => this.settings.sessionTrackUntimedWords,
			projectAtPath: (path) => this.projectRefAtPath(path),
			countOptions: () => this.writingCountOptions(),
			untimedRecovery: {
				load: () =>
					this.app.loadLocalStorage(UNTIMED_RECOVERY_KEY) as unknown,
				save: (snapshot) => {
					this.app.saveLocalStorage(UNTIMED_RECOVERY_KEY, snapshot);
				},
			},
			// The plugin-lifetime clock: the main window's, so a popout
			// closing can never take the session's ticker with it.
			timers: {
				set: (handler, ms) => window.setTimeout(handler, ms),
				clear: (handle) => window.clearTimeout(handle as number),
			},
		});
		this.stickyNoteHub = new StickyNoteHub({
			load: () => this.app.loadLocalStorage(STICKY_NOTE_LOCAL_STATE_KEY) as unknown,
			save: (state) => {
				this.app.saveLocalStorage(STICKY_NOTE_LOCAL_STATE_KEY, state);
			},
		});
		// The plugin's own saves are how modal and dashboard writing keeps
		// crediting words, now that vault events answer only for strangers.
		this.projects.repository.onBodyWrite = (path, before, after, userInput) => {
			this.sessions.notePersistedByPlugin(path, before, after, userInput);
		};
		// And a merge's absorbed segment reports what it held, so the removal
		// weighs against the text the merge credits into the survivor. A
		// segment is the manuscript's by definition, which is what the note
		// itself can no longer be asked once it is gone.
		this.projects.manuscript.onSegmentRemoved = (path, body) => {
			this.sessions.noteRemovedByPlugin(path, body, { manuscript: true });
		};
		// A body reaching the file may have carried revised text to new
		// offsets: the store is brought level quietly, once, for every writer
		// alike, and only a real move re-dresses anything.
		this.projects.manuscript.onSegmentWritten = (path, body) => {
			void this.levelMarginRecords(path, body).catch(() => undefined);
		};
		// And text that walks from one note into another takes its revisions
		// with it. `left` is the departing note as it stood, which is what
		// sorts the travellers from the stayers -- by where their words
		// actually were rather than by where the store last wrote them down.
		// Both bodies are written by the time this fires, so the levelling
		// afterwards reads what stands in the note that received them.
		this.projects.manuscript.onSegmentTextCarried = (
			from,
			into,
			left,
			at,
			shift,
		) => {
			// Answered as a promise so a split can wait for the travellers to
			// have left before the head is levelled.
			return (async () => {
				const project = this.projectRefAtPath(into);
				if (project === null) return;
				// Every file at once, one levelling read and one announce.
				const stores = this.projects.marginRecords;
				const carried = await Promise.all(
					stores.map((store) =>
						store.carryTextBetweenNotes(project, from, into, left, at, shift),
					),
				);
				if (!carried.some(Boolean)) return;
				const { body } = await this.readManuscriptSegment(into);
				await Promise.all(
					stores
						.filter((_store, index) => carried[index] === true)
						.map((store) => store.refreshAnchorsOnSave(project, into, body)),
				);
				await this.announceMarginRecordsChanged();
			})().catch(() => undefined);
		};
		this.lastFocusLevel = this.settings.manuscriptFocusLevel;
		this.registerManagedSectionEditor();
		this.registerView(
			DASHBOARD_VIEW_TYPE,
			(leaf) => new SnowflakeDashboardView(leaf, this),
		);
		this.registerView(
			MANUSCRIPT_VIEW_TYPE,
			(leaf) => new SnowflakeManuscriptView(leaf, this),
		);
		this.registerView(
			STATISTICS_VIEW_TYPE,
			(leaf) =>
				new SnowflakeStatisticsView(leaf, this.writingSessions(), () =>
					this.statisticsFingerprint(),
				),
		);
		this.registerView(
			STORY_STRUCTURE_VIEW_TYPE,
			(leaf) =>
				new SnowflakeStoryStructureView(leaf, {
					host: this,
					fingerprint: () => `${this.settings.uiLocale}|${moment.locale()}`,
					recentProjectPath: () => this.settings.recentProjectPath,
					corkboardPreferences: (projectId) => this.corkboardPreferences(projectId),
					rememberCorkboardPreferences: (projectId, changes) => this.rememberCorkboardPreferences(projectId, changes),
					corkboard: renderCorkboard,
				}),
		);
		this.registerView(
			STICKY_NOTES_VIEW_TYPE,
			(leaf) =>
				new SnowflakeStickyNotesView(leaf, {
					bridge: () => this.stickyNotes(),
					fingerprint: () => this.statisticsFingerprint(),
					locale: () => this.currentLocale(),
				}),
		);
		// Two feeds so the core Page preview plugin offers each with its own
		// modifier default: rendered manuscript prose previews on a plain
		// hover like any reading view, the stream's editor asks for the
		// modifier like any editing view. Both stay adjustable there.
		this.registerHoverLinkSource(MANUSCRIPT_READING_HOVER_SOURCE, {
			display: this.globalT('manuscript.hoverSource.reading'),
			defaultMod: false,
		});
		this.registerHoverLinkSource(MANUSCRIPT_EDITING_HOVER_SOURCE, {
			display: this.globalT('manuscript.hoverSource.editing'),
			defaultMod: true,
		});
		this.registerHoverLinkSource(STICKY_NOTE_HOVER_SOURCE, {
			display: this.globalT('stickyNotes.viewTitle'),
			defaultMod: true,
		});
		this.addRibbonIcon('snowflake', this.globalT('commands.openDashboard'), () => {
			void this.openDashboard();
		});
		this.addRibbonIcon(
			'scroll-text',
			this.globalT('commands.openManuscriptStream'),
			() => {
				void this.openCurrentManuscript();
			},
		);
		this.addRibbonIcon('orbit', this.globalT('commands.openStoryStructure'), () => {
			void this.openStoryStructure().catch((error: unknown) => {
				this.showError(error);
			});
		});
		this.addRibbonIcon('sticker', this.globalT('commands.newStickyNote'), () => {
			void this.createStickyNoteAndFloat().catch((error: unknown) => {
				this.showError(error);
			});
		});
		this.registerCommands();
		this.registerFileMenu();
		this.registerWritingCount();
		addIcon(POMODORO_ICON, POMODORO_SVG);
		this.registerWritingSessions();
		this.settingTab = new SnowflakeSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, _editor, info) => {
				const view = findEditorViewForMarkdownInfo(info);
				if (
					!this.settings.protectManagedBoundaries ||
					view === null ||
					!this.isManagedEditorContext(view.state.doc.toString())
				) {
					return;
				}
				const unlocked = areManagedBoundariesUnlocked(view.state);
				menu.addItem((item) =>
					item
						.setTitle(
							this.editorT(
								view.state.doc.toString(),
								unlocked
									? 'editor.managedSection.relock'
									: 'editor.managedSection.unlock',
							),
						)
						.setIcon(unlocked ? 'lock-keyhole' : 'lock-keyhole-open')
						.onClick(() => this.toggleManagedBoundaries(info)),
				);
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			// The notes this device remembers floating come back before anything
			// else asks for them.
			void this.reconcileStickyFloats().catch((error: unknown) => {
				this.showError(error);
			});
			// The tracking pane's view is gone -- the dashboard's Entity
			// tracking tab is its home now -- and a workspace still holding
			// one of its leaves would show an empty placeholder forever.
			this.app.workspace.detachLeavesOfType('snowflake-method-mentions');
			this.resolveProjectScanReady();
			this.registerVaultListeners();
			this.registerEvent(
				this.app.workspace.on('active-leaf-change', (leaf) => {
					this.applyManuscriptModePresence();
					// What was reported from the editor just left must not stand
					// in for whatever is in front now.
					this.editorFocus = null;
					this.scheduleWritingCountRefresh(0);
					void this.activateProjectLeaf(leaf).catch((error: unknown) => {
						this.showError(error);
					});
				}),
			);
			// Panes move without the active leaf changing — a drag, a split, a
			// closed neighbour — and the marks must follow the containers.
			this.registerEvent(
				this.app.workspace.on('layout-change', () => {
					this.applyManuscriptModePresence();
				}),
			);
			// A session that begins already in solo cannot know how the sidebars
			// stood before it: the folding happened in a session that is gone.
			// Treating them as having been open means leaving solo always brings
			// them back — which is the answer an author who has lost the sidebars
			// actually wants — instead of restoring the folded state solo itself
			// had left behind.
			if (this.settings.manuscriptFocusLevel === 'solo') {
				this.soloCollapsed = { left: false, right: false };
			}
			this.applyManuscriptModePresence();
			this.scheduleWritingCountRefresh(0);
			// The path-to-project map fills from the first scan, and the scan
			// is kicked here rather than waited for from a dashboard: with no
			// pane open, untimed words would otherwise go unclaimed until one
			// was.
			void this.discoverProjects().catch((error: unknown) => {
				this.showError(error);
			});
			// A session the last run never closed is finalized before anything
			// can start a new one over it.
			void this.sessions.recoverAtStartup().catch((error: unknown) => {
				this.showError(error);
			});
			void this.refreshVisibleDashboardsAfterLayout().catch(
				(error: unknown) => {
					this.showError(error);
				},
			);
			void this.refreshManagedEditorLocalesAfterLayout().catch(
				(error: unknown) => {
					this.showError(error);
				},
			);
		});
	}

	onunload(): void {
		// First, and synchronously: a running session's snapshot must land in
		// the per-device store before anything else happens, so the next load
		// can close the session out instead of losing it.
		this.sessions.markShutdown();
		// Typed sticky-note text still waiting on its quiet timer lands now, and
		// every editor lets its note go.
		void this.stickyNoteHub.claims.releaseAll();
		for (const layer of this.stickyLayers.values()) layer.destroy();
		this.stickyLayers.clear();
		if (this.stickyNoteNotifyTimer !== null) {
			this.app.workspace.containerEl.win.clearTimeout(this.stickyNoteNotifyTimer);
			this.stickyNoteNotifyTimer = null;
		}
		if (this.taskNotifyTimer !== null) {
			this.app.workspace.containerEl.win.clearTimeout(this.taskNotifyTimer);
			this.taskNotifyTimer = null;
		}
		// The caches' quiet-flush timers die here, or a disabled plugin would
		// still write index files into the vault seconds after unload.
		this.projects.mentions.dispose();
		this.projects.analysis.dispose();
		// A typography change still waiting on its timer, written now: the drag
		// that made it is the author's choice whether or not they paused after it.
		if (this.settingsSaveTimer !== null) {
			window.clearTimeout(this.settingsSaveTimer);
			this.settingsSaveTimer = null;
			void this.saveSettings();
		}
		if (this.refreshTimer !== null) {
			this.app.workspace.containerEl.win.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		if (this.projectRescanTimer !== null) {
			this.app.workspace.containerEl.win.clearTimeout(
				this.projectRescanTimer,
			);
			this.projectRescanTimer = null;
		}
		// The app is handed back as it stands: nothing faded, nothing folded.
		const body = this.app.workspace.containerEl.doc.body;
		body.classList.remove(
			'snowflake-method-focus-app',
			'snowflake-method-focus-dashboard',
			'snowflake-method-solo',
		);
		if (this.soloCollapsed !== null) {
			if (!this.soloCollapsed.left) this.app.workspace.leftSplit.expand();
			if (!this.soloCollapsed.right) this.app.workspace.rightSplit.expand();
			this.soloCollapsed = null;
		}
		if (this.soloFullscreen) {
			this.soloFullscreen = false;
			const doc = this.app.workspace.containerEl.doc;
			if (doc.fullscreenElement !== null) void doc.exitFullscreen();
		}
	}

	async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
		this.applyMotionPreference();
		// Resynced silently: a level that arrived from outside is not the
		// author turning focus mode on here, so it starts no session.
		this.lastFocusLevel = this.settings.manuscriptFocusLevel;
		await this.syncCurrentProjectLocale();
		await this.refreshDashboards();
	}

	getRecentStep(): StepId {
		return isStepId(this.settings.recentStep) ? this.settings.recentStep : 1;
	}

	isReduceMotionEnabled(): boolean {
		return this.settings.reduceMotion;
	}

	showsTableProgressStatus(): boolean {
		return this.settings.showTableProgressStatus;
	}

	showsTableActionsColumn(): boolean {
		return this.settings.showTableActionsColumn;
	}

	isFreeformModeEnabled(): boolean {
		return this.settings.freeformMode;
	}

	writingCountMode(): WritingCountMode {
		return this.settings.writingCountMode;
	}

	opensFormWhenCreatingFromField(): boolean {
		return this.settings.createFromField === 'form';
	}

	async openProjectManager(
		projectLocale: 'en' | 'zh-CN' | null,
	): Promise<void> {
		const locale = resolveLocale(
			this.settings.uiLocale,
			moment.locale(),
			projectLocale ??
				this.currentProjectLocale ??
				this.resolvedDefaultProjectLocale(),
		);
		const managerT: Translate = (key, vars) => translate(locale, key, vars);
		const { projects, archived } = await this.manageProjectLists();
		new ManageProjectsModal(
			this.app,
			managerT,
			projects,
			this.manifest.version,
			locale,
			this.settings.projectRoot,
			async (root) => {
				const normalizedRoot = normalizeProjectRoot(root);
				if (normalizedRoot !== this.settings.projectRoot) {
					this.settings.projectRoot = normalizedRoot;
					await this.saveSettings();
					await this.handleSettingsChanged('projectRoot');
				}
				return this.manageProjectLists();
			},
			async (path) => {
				await this.selectProject(path);
			},
			(projectLocale) => {
				void this.openCreateProjectModal(
					(key, vars) => translate(projectLocale, key, vars),
					projectLocale,
				);
			},
			async (project, title) => this.renameManagedProject(project, title),
			async (path) => this.openManagedFile(path),
			async (project) => this.trashManagedProject(project),
			archived,
			async (project) => this.archiveManagedProject(project),
			async (project) => this.restoreManagedProject(project),
			async (project) => this.trashArchivedProject(project),
		).open();
	}

	getDefaultProjectLocale(): 'en' | 'zh-CN' {
		return this.resolvedDefaultProjectLocale();
	}

	async syncCertificateCelebration(
		projectId: string,
		complete: boolean,
	): Promise<boolean> {
		const celebrated = this.settings.certificateCelebrations[projectId] === true;
		if (celebrated === complete) return false;
		const next = { ...this.settings.certificateCelebrations };
		if (complete) next[projectId] = true;
		else delete next[projectId];
		this.settings.certificateCelebrations = next;
		await this.saveSettings();
		return complete;
	}

	async listProjects(): Promise<ProjectOption[]> {
		const projects = await this.discoverProjects();
		const options = await Promise.all(
			projects.map(async (project) => ({
				path: project.projectFile,
				rootPath: project.rootPath,
				projectId: project.id,
				title: project.title,
				readOnly: project.readOnly,
				...(await this.projectHealthFlags(project)),
			})),
		);
		const discovered = new Set(projects.map((project) => project.rootPath));
		for (const rootPath of this.projectHealth.keys()) {
			if (!discovered.has(rootPath)) this.projectHealth.delete(rootPath);
		}
		return options;
	}

	/**
	 * Health flags drive one warning icon per project in the switcher and the
	 * manager, but computing them reads every note in the project. Every
	 * dashboard refresh calls listProjects(), so without this cache editing a
	 * single note re-reads every project in the root. The pending load is what
	 * is cached, so several dashboards refreshing at once share one read.
	 */
	private projectHealthFlags(project: ProjectRef): Promise<ProjectHealthFlags> {
		const cached = this.projectHealth.get(project.rootPath);
		if (cached !== undefined) return cached;
		const pending = this.loadProjectHealthFlags(project);
		this.projectHealth.set(project.rootPath, pending);
		return pending;
	}

	private async loadProjectHealthFlags(
		project: ProjectRef,
	): Promise<ProjectHealthFlags> {
		try {
			const snapshot = await this.projects.loadProject(project);
			this.rememberDraft(snapshot);
			return {
				// Advisory issues are an offer, not damage: a triangle here over
				// a file that is merely where an older build kept it sends the
				// author looking for a fault the report will not name.
				hasStructureIssues: snapshot.structureIssues.some(
					(issue) => issue.blocking,
				),
				hasMarkerIssues: this.projectHasMarkerIssues(snapshot),
			};
		} catch {
			// Keep a discoverable but severely damaged project in the manager.
			return { hasStructureIssues: true, hasMarkerIssues: false };
		}
	}

	/** Drops the cached flags of every project the changed path belongs to. */
	private invalidateProjectHealth(path: string): void {
		for (const rootPath of this.projectHealth.keys()) {
			if (isPathAtOrBelow(path, rootPath)) this.projectHealth.delete(rootPath);
		}
	}

	/**
	 * The one place the discovered-project caches are refreshed. Discovery is
	 * held until the workspace layout is ready and concurrent callers share one
	 * scan, so restored dashboards cannot move Vault I/O back into onload().
	 */
	private async discoverProjects(): Promise<ProjectRef[]> {
		await this.projectScanReady;
		if (this.projectDiscoveryPromise !== null) {
			return this.projectDiscoveryPromise;
		}

		const discovery = this.scanProjects();
		this.projectDiscoveryPromise = discovery;
		try {
			return await discovery;
		} finally {
			if (this.projectDiscoveryPromise === discovery) {
				this.projectDiscoveryPromise = null;
			}
		}
	}

	/**
	 * Lets go of the scan in flight, if any. A scan that began before a project
	 * folder moved reports where the folders were, not where they are, and the
	 * callers after the move would join it and repaint the old arrangement.
	 * The scan itself finishes for whoever already asked; the next asker starts
	 * one of their own.
	 */
	private invalidateProjectDiscovery(): void {
		this.projectDiscoveryPromise = null;
	}

	private async scanProjects(): Promise<ProjectRef[]> {
		const projects = await this.projects.discoverProjects(
			this.settings.projectRoot,
		);
		this.projectLocalesById.clear();
		this.knownProjectRoots.clear();
		this.knownProjectsByRoot.clear();
		for (const project of projects) {
			this.projectLocalesById.set(project.id, project.locale);
			this.knownProjectRoots.add(project.rootPath);
			if (!project.readOnly) {
				this.knownProjectsByRoot.set(project.rootPath, project);
			}
		}
		for (const rootPath of this.externalDrafts.keys()) {
			if (!this.knownProjectRoots.has(rootPath)) {
				this.externalDrafts.delete(rootPath);
			}
		}
		return projects;
	}

	/**
	 * Whether a Vault change is worth a dashboard refresh. A refresh re-reads
	 * the whole current project, so the test has to be the project folders
	 * themselves: the configured root defaults to the Vault root, where every
	 * note in the Vault sits "in the root", and an ordinary `Inbox/note.md` is
	 * nested just as deep as a project note.
	 */
	private touchesProject(path: string): boolean {
		return (
			touchesAnyProject(path, this.knownProjectRoots) ||
			// A project that has just appeared is not in the set yet, but its
			// canonical metadata note is recognisable from its path alone.
			this.isDirectProjectFile(path) ||
			this.isLinkedDraft(path)
		);
	}

	/**
	 * The writable project whose folder holds `path`, from the last scan, or
	 * null. Pure string work over a handful of roots: cheap enough to ask on
	 * every edit, and empty only before the first scan has run.
	 */
	private projectRefAtPath(path: string): ProjectRef | null {
		for (const [rootPath, project] of this.knownProjectsByRoot) {
			if (isPathAtOrBelow(path, rootPath)) return project;
		}
		return null;
	}

	/** A draft a project links to from outside its own folder. */
	private isLinkedDraft(path: string): boolean {
		for (const draftPath of this.externalDrafts.values()) {
			if (draftPath === path) return true;
		}
		return false;
	}

	/**
	 * Records a draft the project-folder scan cannot reach, so editing it still
	 * refreshes the step 10 review state. Callers pass a snapshot they already
	 * hold; this costs no extra reads.
	 */
	private rememberDraft(project: ProjectSnapshot): void {
		const draftPath = project.links.draft;
		if (draftPath === null || isPathAtOrBelow(draftPath, project.rootPath)) {
			this.externalDrafts.delete(project.rootPath);
			return;
		}
		this.externalDrafts.set(project.rootPath, draftPath);
	}

	private projectHasMarkerIssues(project: ProjectSnapshot): boolean {
		for (const step of [1, 2, 4, 6] as const) {
			const artifact = project.artifacts[step];
			const documentType = DOCUMENT_BY_MANAGED_STEP[step];
			if (artifact === undefined || documentType === undefined) continue;
			const expected = managedSectionsForDocument(documentType).map(
				(section) => section.id,
			);
			if (
				inspectManagedDocumentSections(
					artifact.content,
					expected,
					artifact.path,
				).issues.some((issue) => issue.code !== 'unknown-section')
			) {
				return true;
			}
		}
		return (
			project.characters.some((character) =>
				character.sectionHealth.issues.some(
					(issue) => issue.code !== 'unknown-section',
				),
			) ||
			project.scenes.some((scene) =>
				scene.sectionHealth.issues.some(
					(issue) => issue.code !== 'unknown-section',
				),
			)
		);
	}

	private async renameManagedProject(
		option: ManageProjectOption,
		title: string,
	): Promise<ProjectOption[]> {
		const oldPath = option.path;
		let project: ProjectSnapshot;
		try {
			project = await this.projects.renameProject(oldPath, title);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
		const renamed: CreatedProject = {
			path: project.projectFile,
			projectId: project.id,
			title: project.title,
			locale: project.locale,
		};
		this.projectLocalesById.set(project.id, project.locale);
		this.invalidateProjectHealth(oldPath);
		this.invalidateProjectHealth(project.rootPath);

		if (this.settings.recentProjectPath === oldPath) {
			this.settings.recentProjectPath = project.projectFile;
			this.currentProjectLocale = project.locale;
			await this.saveSettings();
		}

		await this.renameProjectViews(option.rootPath, project.rootPath, renamed);
		new Notice(this.t('messages.projectRenamed', { name: project.title }));
		return this.listProjects();
	}

	/**
	 * Puts a project's folder through Obsidian's own deletion flow and forgets
	 * what was held about it. Everything the flow needs is on the row the author
	 * clicked, so deleting a project reads none of it.
	 *
	 * Obsidian's confirmation performs the configured trash/delete action before
	 * it resolves true. Calling trashFile() again would use a detached TFolder
	 * and abort the manager refresh after the project has already disappeared.
	 */
	private async confirmProjectDeletion(
		option: ManageProjectOption,
	): Promise<boolean> {
		const folder = this.projects.repository.getFolder(option.rootPath);
		if (folder === null) throw new ManagedFileNotFoundError(option.rootPath);
		if (!(await this.app.fileManager.promptForDeletion(folder))) return false;
		this.projectLocalesById.delete(option.projectId);
		this.invalidateProjectHealth(option.rootPath);
		this.invalidateProjectDiscovery();
		new Notice(this.t('messages.projectTrashed', { name: option.title }));
		return true;
	}

	/** Forgets a recent project that lived at or below the path. */
	private async forgetRecentProjectUnder(rootPath: string): Promise<void> {
		const recent = this.settings.recentProjectPath;
		if (recent === null || !isPathAtOrBelow(recent, rootPath)) return;
		this.settings.recentProjectPath = null;
		this.settings.recentStep = 1;
		this.currentProjectLocale = null;
		await this.saveSettings();
	}

	private async trashManagedProject(
		option: ManageProjectOption,
	): Promise<ProjectOption[] | null> {
		if (!(await this.confirmProjectDeletion(option))) return null;
		await this.forgetRecentProjectUnder(option.rootPath);
		await this.refreshDashboards();
		return (await this.listProjects()).filter(
			(candidate) => candidate.projectId !== option.projectId,
		);
	}

	/**
	 * The archived rows carry no health flags on purpose: computing them reads
	 * every note of every archived project each time the manager opens, for
	 * rows whose only offers are restore, open metadata, and trash.
	 */
	private async listArchivedProjectOptions(): Promise<ManageProjectOption[]> {
		const archived = await this.projects.listArchivedProjects(
			this.settings.projectRoot,
		);
		return archived.map((project) => ({
			path: project.projectFile,
			rootPath: project.rootPath,
			projectId: project.id,
			title: project.title,
			readOnly: project.readOnly,
			hasStructureIssues: false,
			hasMarkerIssues: false,
		}));
	}

	/** The manager's two lists, gathered together because it shows them so. */
	private async manageProjectLists(): Promise<ManageProjectLists> {
		// Disjoint folders, so neither has to wait on the other: the archive
		// sits beside the projects rather than among them.
		const [projects, archived] = await Promise.all([
			this.listProjects(),
			this.listArchivedProjectOptions(),
		]);
		return { projects, archived };
	}

	private async archiveManagedProject(
		option: ManageProjectOption,
	): Promise<ManageProjectLists> {
		// Asked before the move rather than after: the folder rename reaches
		// handleVaultRename first, which forgets a recent project that has left
		// the root, so by the time this returns there is nothing left to compare.
		const wasRecent =
			this.settings.recentProjectPath !== null &&
			isPathAtOrBelow(this.settings.recentProjectPath, option.rootPath);
		let project: ProjectRef;
		try {
			project = await this.projects.archiveProject(option.path);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
		this.projectLocalesById.delete(project.id);
		this.invalidateProjectHealth(option.rootPath);
		this.invalidateProjectDiscovery();
		// A rename does not detach views the way a delete does, and a dashboard
		// left open on the old path would sit on a project it can no longer find.
		this.detachProjectViews(option.rootPath);
		if (wasRecent) {
			this.settings.recentProjectPath = null;
			this.settings.recentStep = 1;
			this.currentProjectLocale = null;
			await this.saveSettings();
		}
		this.scheduleRefresh(true);
		new Notice(this.t('messages.projectArchived', { name: project.title }));
		return this.manageProjectLists();
	}

	private async restoreManagedProject(
		option: ManageProjectOption,
	): Promise<ManageProjectLists> {
		let restored: { project: ProjectSnapshot; renamedFrom: string | null };
		try {
			restored = await this.projects.restoreProject(
				option.path,
				this.settings.projectRoot,
			);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
		this.invalidateProjectHealth(option.rootPath);
		this.invalidateProjectHealth(restored.project.rootPath);
		this.invalidateProjectDiscovery();
		this.scheduleRefresh(true);
		new Notice(
			restored.renamedFrom === null
				? this.t('messages.projectRestored', {
						name: restored.project.title,
					})
				: this.t('messages.projectRestoredRenamed', {
						name: restored.project.title,
						from: restored.renamedFrom,
					}),
		);
		return this.manageProjectLists();
	}

	private async trashArchivedProject(
		option: ManageProjectOption,
	): Promise<ManageProjectLists | null> {
		if (!(await this.confirmProjectDeletion(option))) return null;
		return this.manageProjectLists();
	}

	async loadDashboardModel(
		path: string | null = null,
	): Promise<ProjectDashboardModel | null> {
		// reconcileRevisionStatuses loads the project itself, so handing it a
		// path rather than a snapshot saves one full read of every note in the
		// project on the dashboard's own refresh path.
		let project: ProjectSnapshot | null;
		try {
			project =
				path === null
					? await this.getCurrentProject()
					: await this.projects.reconcileRevisionStatuses(path);
		} catch (error) {
			if (!(error instanceof ManagedFileNotFoundError)) throw error;
			return null;
		}
		if (project === null) return null;
		if (path === null) {
			project = await this.projects.reconcileRevisionStatuses(project);
		}
		// The plugin's own files — the system templates and the metadata
		// note's stamp — are generated, so a dashboard showing the project
		// brings them current here, silently. User notes keep their banner.
		if (!project.readOnly && (await this.projects.settleSystemFiles(project))) {
			project = await this.projects.reconcileRevisionStatuses(
				project.projectFile,
			);
		}
		this.rememberDraft(project);
		this.projectLocalesById.set(project.id, project.locale);
		const projectT = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(project.locale, key, vars);

		const { characters, scenes } = project;
		const artifactMap = new Map<StepId, ArtifactSnapshot | null>();
		for (const step of [1, 2, 4, 6] as const) {
			artifactMap.set(step, project.artifacts[step] ?? null);
		}
		const characterModels = characters.map((character) =>
			this.characterViewModel(
				character,
				projectT,
				definitionRootPathFor(project, 'character', 'category'),
			),
		);
		const characterNames = new Map(
			characters.map((character) => [character.path, character.name]),
		);
		const sceneModels = scenes.map((scene) =>
			this.sceneViewModel(
				scene,
				characterNames,
				projectT,
				definitionRootPathFor(project, 'scene', 'category'),
			),
		);
		const artifactIssues = new Map<StepId, ManagedSectionIssueViewModel[]>();
		for (const [step, artifact] of artifactMap) {
			const documentType = DOCUMENT_BY_MANAGED_STEP[step];
			if (artifact === null || documentType === undefined) {
				artifactIssues.set(step, []);
				continue;
			}
			const expected = managedSectionsForDocument(documentType).map(
				(section) => section.id,
			);
			artifactIssues.set(
				step,
				this.issueViewModels(
					artifact.path,
					inspectManagedDocumentSections(
						artifact.content,
						expected,
						artifact.path,
					),
					projectT,
				),
			);
		}
		const pathMap = new Map<StepId, string | null>();
		for (const definition of STEP_DEFINITIONS) {
			const step = definition.id;
			const path =
				step === 3 || step === 5 || step === 7
					? (characters[0]?.path ?? null)
					: step === 8 || step === 9
						? (scenes[0]?.path ?? null)
						: step === 10
							? project.links.draft
							: (artifactMap.get(step)?.path ?? null);
			pathMap.set(step, path);
		}
		// Read off the snapshot in hand, so the three vocabularies cost the
		// walk of their folders and nothing of the members again — and side
		// by side, including the manuscript's indexed reading order.
		const [category, worldStatus, relationship, customFieldTemplates, manuscript] =
			await Promise.all([
				this.projects.listDefinitionForest(project, 'category'),
				this.projects.listDefinitionForest(project, 'world-status'),
				this.projects.listDefinitionForest(project, 'relationship'),
				this.projects.listCustomFieldTemplates(project),
				this.projects.manuscript.listSegments(project),
			]);
		const definitions = {
			category,
			'world-status': worldStatus,
			relationship,
		};

		return {
			path: project.projectFile,
			projectId: project.id,
			title: project.title,
			locale: project.locale,
			readOnly: project.readOnly,
			readOnlyReason: project.readOnly
				? projectT('dashboard.readOnlySchema')
				: null,
			lastManuscriptNote: this.lastManuscriptNote(project.id),
			steps: STEP_DEFINITIONS.map((definition) => ({
				id: definition.id,
				title: projectT(definition.titleKey),
				description: projectT(definition.descriptionKey),
				status: project.steps[definition.id],
				optional: definition.optional,
				artifactPath: pathMap.get(definition.id) ?? null,
				contentReadOnly: artifactMap.get(definition.id)?.readOnly ?? false,
				healthIssues: artifactIssues.get(definition.id) ?? [],
			})),
			stepFields: {
				1: this.readStepOneContent(artifactMap.get(1)?.content),
				2: this.readStepTwoContent(artifactMap.get(2)?.content),
				4: {
					'plot-synopsis': this.readArtifactSection(
						artifactMap.get(4)?.content,
						'plot-synopsis',
					),
				},
			},
				stepRevisions: {
					1: artifactMap.get(1)?.revision,
					2: artifactMap.get(2)?.revision,
				},
			characters: characterModels,
			scenes: sceneModels,
			manuscriptPaths: manuscript.map((segment) => segment.path),
			definitions,
			customFieldTemplates,
			worldbuildingKinds: project.worldbuildingKinds,
			worldbuilding: Object.fromEntries(
				project.worldbuildingKinds.map((kind) => [
					kind.id,
					entitiesOf(project, kind.id).map((entity) =>
						this.entityViewModel(
							entity,
							projectT,
							definitionRootPathFor(project, kind.id, 'category'),
						),
					),
				]),
			),
			outdatedNotes:
				characters.filter(
					(character) => character.unmigrated && !character.readOnly,
				).length +
				scenes.filter((scene) => scene.unmigrated && !scene.readOnly).length +
				project.worldbuildingKinds.flatMap((kind) =>
					entitiesOf(project, kind.id),
				).filter((entity) => entity.unmigrated && !entity.readOnly).length +
				(await this.projects.countOutdatedNotes(project)),
			structureIssues: project.structureIssues.map((issue) => ({
				path: issue.path,
				sectionId: null,
				// The note, always: what was found inside it is the list's to say,
				// and a row titled by a property key looked like a different kind
				// of row from every other one.
				sectionLabel: issue.path.split('/').pop() ?? issue.path,
				code: issue.code,
				message: projectT(`projectStructure.issue.${issue.code}`, {
					field: issue.field ?? '',
					expected: issue.expected ?? '',
				}),
				names: issue.names ?? [],
				action: this.optionalTranslation(
					projectT,
					`projectStructure.action.${issue.code}`,
				),
				blocking: issue.blocking,
				kind: 'structure',
				stepIds: issue.stepIds,
				canOpen: issue.canOpen,
				repairable: issue.repairable,
				repairField: issue.field ?? null,
			})),
		};
	}

	async selectProject(path: string): Promise<void> {
		const project = await this.projects.loadProject(path);

		const existing = this.findOpenProjectLeaf(path);
		if (existing !== undefined) {
			const stateStep = existing.getViewState().state?.selectedStep;
			const selectedStep =
				existing.view instanceof SnowflakeDashboardView
					? existing.view.getSelectedStep()
					: typeof stateStep === 'number' && isStepId(stateStep)
						? stateStep
						: this.getRecentStep();
			this.markCurrentProject(path, project.locale, selectedStep);
			const save = this.saveSettings();
			await existing.loadIfDeferred();
			if (existing.view instanceof SnowflakeDashboardView) {
				await existing.view.showSelectedProject(
					{
						path: project.projectFile,
						projectId: project.id,
						title: project.title,
						locale: project.locale,
					},
					selectedStep,
				);
			}
			this.app.workspace.setActiveLeaf(existing, { focus: true });
			await this.app.workspace.revealLeaf(existing);
			await save;
			return;
		}

		const firstIncomplete = getFirstIncompleteStep(project.steps);
		await this.openProjectTab(project, firstIncomplete);
		this.projectLocalesById.set(project.id, project.locale);
		this.markCurrentProject(path, project.locale, firstIncomplete);
		await this.saveSettings();
	}

	/**
	 * The project the author is now working in, and the surfaces that follow
	 * it told so. The statistics sidebar has no project of its own and reads
	 * whichever one this is, labels included, so every way of arriving at a
	 * project has to come through here -- opening one from the manager moved
	 * the sidebar's numbers without moving its language before it did.
	 */
	private markCurrentProject(
		path: string,
		locale: 'en' | 'zh-CN',
		step: StepId,
	): void {
		this.settings.recentProjectPath = path;
		this.currentProjectLocale = locale;
		this.settings.recentStep = step;
		this.rerenderStatisticsViews();
	}

	activateProject(
		path: string,
		locale: 'en' | 'zh-CN',
		step: StepId,
	): void {
		if (
			this.settings.recentProjectPath === path &&
			this.currentProjectLocale === locale &&
			this.settings.recentStep === step
		) {
			return;
		}
		this.markCurrentProject(path, locale, step);
		void this.saveSettings();
	}

	async selectStep(step: StepId): Promise<void> {
		this.settings.recentStep = step;
		await this.saveSettings();
	}

	async selectWorldbuildingKind(): Promise<void> {
		// The pane rides the view state; a fresh dashboard still opens on the
		// recent step, which stays whatever it was.
	}

	async createProject(request: CreateProjectRequest): Promise<CreatedProject> {
		let project: ProjectSnapshot;
		try {
			project = await this.projects.createProject({
				title: request.title,
				rootPath: this.settings.projectRoot,
				locale: request.locale,
			});
		} catch (error) {
			if (error instanceof ProjectCreationInterruptedError) {
				this.currentProjectLocale = request.locale;
				this.settings.recentProjectPath = error.projectPath;
				await this.saveSettings();
				await this.refreshDashboards();
				throw error;
			}
			this.rethrowLocalizedMutationError(error);
		}
		this.currentProjectLocale = project.locale;
		this.projectLocalesById.set(project.id, project.locale);
		this.settings.recentProjectPath = project.projectFile;
		this.settings.recentStep = 1;
		await this.saveSettings();
		new Notice(this.t('messages.projectCreated', { name: project.title }));
		return {
			path: project.projectFile,
			projectId: project.id,
			title: project.title,
			locale: project.locale,
		};
	}

	async createCharacter(
		request: CreateCharacterRequest,
		projectPath?: string,
	): Promise<CharacterOption> {
		const project = await this.requireProject(projectPath);
		let character;
		try {
			character = await this.projects.createCharacter(project, request);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
		new Notice(this.t('messages.characterCreated', { name: character.name }));
		return { id: character.id, path: character.path, name: character.name };
	}

	async updateCharacter(
		id: string,
		request: CreateCharacterRequest,
		projectPath?: string,
	): Promise<void> {
		const project = await this.requireProject(projectPath);
		const expectedRevision = this.requireExpectedRevision(
			request.expectedRevision,
		);
		try {
			await this.projects.updateCharacter(project, id, {
				expectedRevision,
				name: request.name,
				aliases: request.aliases,
				categoryPaths: request.categoryPaths,
				progressStatus: request.progressStatus,
				oneSentenceStoryline: request.oneSentenceStoryline,
				oneParagraphStoryline: request.oneParagraphStoryline,
				motivation: request.motivation,
				goal: request.goal,
				conflict: request.conflict,
				growth: request.growth,
				worldStatus: request.worldStatus,
				relationships: request.relationships,
				customFields: request.customFields,
			});
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async deleteCharacter(id: string, expectedRevision: string): Promise<void> {
		const project = await this.requireCurrentProject();
		const character = project.characters.find(
			(candidate) => candidate.characterId === id,
		);
		if (character === undefined) {
			throw new ManagedFileNotFoundError(`character:${id}`);
		}
		await this.deleteMember(
			project,
			character,
			expectedRevision,
			this.t('messages.characterDeleted'),
		);
	}

	/**
	 * Sends one member note to the trash, asking first when other notes name
	 * it. Obsidian's delete prompt sees a note rather than a member, so a note
	 * the project still points at gets a confirmation that says who points at
	 * it and what that costs them; with nothing pointing at it, the standard
	 * prompt is the right one.
	 */
	private async deleteMember(
		project: ProjectSnapshot,
		member: { path: string; name: string; revision: string },
		expectedRevision: string,
		deleted: string,
	): Promise<void> {
		const file = this.app.vault.getFileByPath(member.path);
		if (!(file instanceof TFile)) {
			throw new ManagedFileNotFoundError(member.path);
		}
		if (member.revision !== expectedRevision) {
			this.rethrowLocalizedMutationError(
				new ConcurrentChangeError(
					member.path,
					expectedRevision,
					member.revision,
				),
			);
		}
		const usage = await this.projects.memberUsage(project, member.path);
		if (
			usage.needsDecision.length === 0 &&
			usage.listed.length === 0 &&
			usage.records.length === 0
		) {
			if (!(await this.app.fileManager.promptForDeletion(file))) return;
			new Notice(deleted);
			return;
		}

		const confirmed = await new Promise<boolean>((resolve) => {
			new ConfirmMemberDeletionModal(
				this.app,
				this.t,
				member.name,
				usage,
				resolve,
			).open();
		});
		if (!confirmed) return;
		// trashFile honours the same trash preference the prompt would have, so
		// replacing that dialog does not quietly change where the note goes.
		await this.projects.repository.trashFile(member.path);
		// After the delete, so a failure here leaves links the health check can
		// still report rather than lists edited for a deletion that never landed.
		await this.projects.removeMemberReferences(project, member.path);
		new Notice(deleted);
	}

	async createScene(
		request: CreateSceneRequest,
		projectPath?: string,
	): Promise<{ id: string; path: string }> {
		const project = await this.requireProject(projectPath);
		let scene;
		try {
			scene = await this.projects.createScene(project, {
				title: request.title,
				povPath: request.povPath || null,
				aliases: request.aliases,
				categoryPaths: request.categoryPaths,
				progressStatus: request.progressStatus,
				times: request.times,
				locations: request.locations,
				characters: request.characterPaths,
				conflict: request.conflict,
				worldStatus: request.worldStatus,
				relationships: request.relationships,
				customFields: request.customFields,
				events: request.events,
				color: request.color,
				linkedManuscript: request.linkedManuscript,
			});
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
		new Notice(this.t('messages.sceneCreated', { name: scene.title }));
		return { id: scene.id, path: scene.path };
	}

	async createSceneCanvas(): Promise<void> {
		const project = await this.requireCurrentProject();
		const path = await this.projects.createSceneCanvas(project);
		const name = path.slice(path.lastIndexOf('/') + 1);
		new Notice(this.t('messages.canvasCreated', { name }));
		await this.openManagedFile(path);
	}

	async openProjectBase(id: ProjectBaseChoice): Promise<void> {
		const project = await this.requireCurrentProject();
		const path = await this.projects.openProjectBase(project, id);
		await this.openManagedFile(path);
	}

	async restoreProjectBase(id: ProjectBaseChoice): Promise<void> {
		const project = await this.requireCurrentProject();
		const path = await this.projects.restoreProjectBase(project, id);
		await this.openManagedFile(path);
	}

	async createEntity(
		request: EntityFormRequest,
		projectPath?: string,
	): Promise<{ id: string; path: string }> {
		const project = await this.requireProject(projectPath);
		let entity;
		try {
			entity = await this.projects.createEntity(project, {
				kind: request.kind,
				name: request.name,
				aliases: request.aliases,
				categoryPaths: request.categoryPaths,
				progressStatus: request.progressStatus,
				description: request.description,
				timeKind: request.timeKind,
				timeStart: request.timeStart,
				timeEnd: request.timeEnd,
				worldStatus: request.worldStatus,
				relationships: request.relationships,
				customFields: request.customFields,
			});
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
		new Notice(this.t('messages.entityCreated', { name: entity.name }));
		return { id: entity.entityId, path: entity.path };
	}

	async updateEntity(id: string, request: EntityFormRequest): Promise<void> {
		const project = await this.requireCurrentProject();
		const expectedRevision = this.requireExpectedRevision(
			request.expectedRevision,
		);
		try {
			await this.projects.updateEntity(project, id, {
				expectedRevision,
				name: request.name,
				aliases: request.aliases,
				categoryPaths: request.categoryPaths,
				progressStatus: request.progressStatus,
				description: request.description,
				timeKind: request.timeKind,
				timeStart: request.timeStart,
				timeEnd: request.timeEnd,
				worldStatus: request.worldStatus,
				relationships: request.relationships,
				customFields: request.customFields,
			});
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async deleteEntity(id: string, expectedRevision: string): Promise<void> {
		const project = await this.requireCurrentProject();
		const entity = project.worldbuildingKinds.flatMap((kind) =>
			entitiesOf(project, kind.id),
		).find((candidate) => candidate.entityId === id);
		if (entity === undefined) {
			throw new ManagedFileNotFoundError(`entity:${id}`);
		}
		await this.deleteMember(
			project,
			entity,
			expectedRevision,
			this.t('messages.entityDeleted'),
		);
	}

	async reorderEntity(
		kind: WorldbuildingKindId,
		entityId: string,
		targetIndex: number,
	): Promise<void> {
		const project = await this.requireCurrentProject();
		try {
			await this.projects.reorderEntity(project, kind, entityId, targetIndex);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async createWorldbuildingKind(
		name: string,
		appearance: { icon: string; description: string },
	): Promise<KindMutationOutcome> {
		const project = await this.requireCurrentProject();
		try {
			return await this.projects.createWorldbuildingKind(
				project,
				name,
				appearance,
			);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async setKindAppearance(
		kind: WorldbuildingKindId,
		appearance: { icon: string; description: string },
	): Promise<void> {
		const project = await this.requireCurrentProject();
		try {
			await this.projects.setKindAppearance(project, kind, appearance);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async renameWorldbuildingKind(
		kind: WorldbuildingKindId,
		newName: string,
	): Promise<KindMutationOutcome> {
		const project = await this.requireCurrentProject();
		try {
			return await this.projects.renameWorldbuildingKind(
				project,
				kind,
				newName,
			);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async worldbuildingKindUsage(
		kind: WorldbuildingKindId,
	): Promise<{ entityCount: number; usage: MemberUsage }> {
		const project = await this.requireCurrentProject();
		try {
			return await this.projects.worldbuildingKindUsage(project, kind);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async deleteWorldbuildingKind(kind: WorldbuildingKindId): Promise<void> {
		const project = await this.requireCurrentProject();
		try {
			await this.projects.deleteWorldbuildingKind(project, kind);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async kindTemplatePath(kind: EntityKindId, projectPath?: string): Promise<string | null> {
		const project = await this.requireProject(projectPath);
		return this.projects.kindTemplatePath(project, kind);
	}

	async setKindTemplate(
		kind: EntityKindId,
		path: string | null,
		projectPath?: string,
	): Promise<void> {
		const project = await this.requireProject(projectPath);
		try {
			await this.projects.setKindTemplate(project, kind, path);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async kindTemplateFields(kind: EntityKindId, projectPath?: string): Promise<CustomField[]> {
		const project = await this.requireProject(projectPath);
		return this.projects.kindTemplateFields(project, kind);
	}

	async customFieldTemplateFields(
		kind: EntityKindId,
		name: string,
	): Promise<CustomField[]> {
		const project = await this.requireCurrentProject();
		return this.projects.customFieldTemplateFields(project, kind, name);
	}

	async saveCustomFieldTemplate(
		kind: EntityKindId,
		input: { name: string; description: string; fields: CustomField[] },
		options?: { previousName?: string; overwrite?: boolean },
		projectPath?: string,
	): Promise<SaveCustomFieldTemplateResult> {
		const project = await this.requireProject(projectPath);
		try {
			return await this.projects.saveCustomFieldTemplate(
				project,
				kind,
				input,
				options,
			);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async deleteCustomFieldTemplate(
		kind: EntityKindId,
		name: string,
	): Promise<void> {
		const project = await this.requireCurrentProject();
		try {
			await this.projects.deleteCustomFieldTemplate(project, kind, name);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async listDefinitionPaths(
		kind: EntityKindId,
		id: DefinitionFileChoice,
		projectPath?: string,
	): Promise<string[]> {
		const project = await this.requireProject(projectPath);
		return this.projects.listDefinitionPaths(project, kind, id);
	}

	async addDefinitionPath(
		kind: EntityKindId,
		id: DefinitionFileChoice,
		path: string,
		description = '',
		projectPath?: string,
	): Promise<AddDefinitionPathResult> {
		const project = await this.requireProject(projectPath);
		const result = await this.projects.addDefinitionPath(
			project,
			kind,
			id,
			path,
			description,
		);
		return result.ok
			? { ok: true }
			: { ok: false, code: result.code, segment: result.segment };
	}

	async renameDefinitionNode(
		kind: EntityKindId,
		id: DefinitionFileChoice,
		taxonomyPath: string,
		newName: string,
	): Promise<RenameDefinitionPathResult> {
		const project = await this.requireCurrentProject();
		let result: RenameDefinitionPathResult;
		try {
			result = await this.projects.renameDefinitionNode(
				project,
				kind,
				id,
				taxonomyPath,
				newName,
			);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
		return result.ok
			? { ok: true, taxonomyPath: result.taxonomyPath }
			: { ok: false, code: result.code, segment: result.segment };
	}

	async deleteDefinitionNode(
		kind: EntityKindId,
		id: DefinitionFileChoice,
		taxonomyPath: string,
	): Promise<void> {
		const project = await this.requireCurrentProject();
		try {
			await this.projects.deleteDefinitionNode(project, kind, id, taxonomyPath);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
		new Notice(this.t('messages.definitionDeleted'));
	}

	async updateDefinitionDescription(
		kind: EntityKindId,
		id: DefinitionFileChoice,
		taxonomyPath: string,
		description: string,
	): Promise<void> {
		const project = await this.requireCurrentProject();
		try {
			await this.projects.updateDefinitionDescription(
				project,
				kind,
				id,
				taxonomyPath,
				description,
			);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async definitionFilePaths(
		kind: EntityKindId,
		projectPath?: string,
	): Promise<Record<DefinitionFileChoice, string>> {
		const project = await this.requireProject(projectPath);
		const pathFor = (id: DefinitionFileChoice): string =>
			definitionRootPathFor(project, kind, id);
		return {
			category: pathFor('category'),
			'world-status': pathFor('world-status'),
			relationship: pathFor('relationship'),
		};
	}

	async updateScene(id: string, request: CreateSceneRequest, projectPath?: string): Promise<void> {
		const project = await this.requireProject(projectPath);
		const expectedRevision = this.requireExpectedRevision(
			request.expectedRevision,
		);
		try {
			await this.projects.updateScene(project, id, {
				expectedRevision,
				title: request.title,
				povPath: request.povPath || null,
				aliases: request.aliases,
				categoryPaths: request.categoryPaths,
				progressStatus: request.progressStatus,
				times: request.times,
				locations: request.locations,
				characters: request.characterPaths,
				conflict: request.conflict,
				worldStatus: request.worldStatus,
				relationships: request.relationships,
				customFields: request.customFields,
				events: request.events,
				color: request.color,
				linkedManuscript: request.linkedManuscript,
			});
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async patchScene(id: string, patch: ScenePatch, projectPath: string): Promise<string> {
		try {
			const written = await this.projects.updateScene(projectPath, id, patch);
			return written.revision;
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async listManuscriptNotes(projectPath: string): Promise<{ path: string; title: string }[]> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return [];
		const segments = await this.projects.manuscript.listSegments(project);
		return segments.map((segment) => ({
			path: segment.path,
			title: segment.title,
		}));
	}

	async deleteScene(id: string, expectedRevision: string, projectPath?: string): Promise<void> {
		const project = await this.requireProject(projectPath);
		const scene = project.scenes.find((candidate) => candidate.sceneId === id);
		if (scene === undefined) {
			throw new ManagedFileNotFoundError(`scene:${id}`);
		}
		await this.deleteMember(
			project,
			{ path: scene.path, name: scene.title, revision: scene.revision },
			expectedRevision,
			this.t('messages.sceneDeleted'),
		);
	}

	async setStepStatus(step: StepId, status: StepStatus): Promise<void> {
		const project = await this.requireCurrentProject();
		await this.projects.updateStepStatus(project, step, status);
	}

	async saveStepFields(
		step: 1 | 2,
		fields: StepFields,
		expectedRevision: string,
	): Promise<void> {
		const project = await this.requireCurrentProject();
		const path = await this.projects.getArtifactPath(project, step);
		if (path === null) throw new Error(this.t('errors.invalidProject'));
		if (expectedRevision.length === 0) {
			throw new Error(this.t('errors.concurrentChange'));
		}

		const values =
			step === 1
				? Object.fromEntries(
						STEP_ONE_SECTION_IDS.map((key) => [key, fields[key] ?? '']),
					)
				: Object.fromEntries(
						STEP_TWO_SECTION_IDS.map((key) => [key, fields[key] ?? '']),
					);
		try {
			await this.projects.updateSections(path, values, expectedRevision);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async reorderScene(sceneId: string, targetIndex: number, projectPath?: string): Promise<void> {
		const project = await this.requireProject(projectPath);
		await this.projects.reorderScene(project, sceneId, targetIndex);
	}

	async reorderCharacter(characterId: string, targetIndex: number): Promise<void> {
		const project = await this.requireCurrentProject();
		await this.projects.reorderCharacter(project, characterId, targetIndex);
	}

	async openManagedFile(
		path: string,
		sectionId?: string,
		highlightSectionIds?: readonly string[],
	): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error(this.t('errors.fileMissing', { path }));
		}
		const leaf = await this.revealNoteLeaf(file);
		await nextAnimationFrame(leaf.view.containerEl.win);
		if (sectionId === undefined || !(leaf.view instanceof MarkdownView)) return;

		const editor = leaf.view.editor;
		const content = editor.getValue();
		const target = resolveManagedSectionNavigationTarget(content, sectionId);
		if (target === null) {
			const issueTarget = resolveManagedMarkerIssueNavigationTarget(
				content,
				sectionId,
			);
			if (issueTarget !== null) {
				const cursor = editor.offsetToPos(issueTarget.cursorOffset);
				editor.setCursor(cursor);
				this.centerEditorOn(leaf.view, cursor);
				editor.focus();
				const editorView = findEditorViewForMarkdownInfo(leaf.view);
				if (editorView !== null) {
					flashManagedMarkerIssue(
						editorView,
						sectionId,
						issueTarget.cursorOffset,
					);
				}
				new Notice(
					this.editorT(
						content,
						'editor.managedSection.navigationDamaged',
					),
				);
				return;
			}
			new Notice(
				this.editorT(
					content,
					'editor.managedSection.navigationUnavailable',
				),
			);
			return;
		}

		const cursor = editor.offsetToPos(target.cursorOffset);
		editor.setCursor(cursor);
		this.centerEditorOn(leaf.view, cursor);
		editor.focus();
		const editorView = findEditorViewForMarkdownInfo(leaf.view);
		if (editorView !== null) {
			flashManagedSections(
				editorView,
				highlightSectionIds ?? [sectionId],
				target.cursorOffset,
			);
		}
	}

	/**
	 * Centers the editor on the target once now and twice more after layout.
	 * Obsidian restores the note's remembered scroll just after it opens, and
	 * live preview keeps measuring the document for a few frames, so a single
	 * request lands before both and is carried away with the old position.
	 */
	private centerEditorOn(view: MarkdownView, cursor: EditorPosition): void {
		const editor = view.editor;
		const range = { from: cursor, to: cursor };
		editor.scrollIntoView(range, true);
		const win = view.containerEl.win;
		// The view can close before the delayed passes; a centering request
		// must never reach an editor that no longer has a place on screen.
		const center = (): void => {
			if (!view.containerEl.isConnected) return;
			editor.scrollIntoView(range, true);
		};
		win.requestAnimationFrame(() => {
			center();
			win.setTimeout(center, 250);
		});
	}

	/**
	 * Long-form notes share one companion pane beside the dashboard instead of
	 * splitting off another column per opening.
	 */
	private async revealNoteLeaf(file: TFile): Promise<WorkspaceLeaf> {
		const route = routeNotePane<WorkspaceLeaf, NotePane>({
			targetPath: file.path,
			targetProjectId: this.projectIdOfFile(file),
			dashboardViewType: DASHBOARD_VIEW_TYPE,
			leaves: this.workspaceLeafSnapshots(),
			notePane: this.notePane,
			activeLeaf: this.app.workspace.getMostRecentLeaf(
				this.app.workspace.rootSplit,
			),
			preferSplit: this.settings.openLongTextInSplit,
			canSplit: this.canSplitWorkspace(),
		});
		const leaf = await this.openNoteRoute(route, file);
		await this.app.workspace.revealLeaf(leaf);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		return leaf;
	}

	private async openNoteRoute(
		route: NotePaneRoute<WorkspaceLeaf, NotePane>,
		file: TFile,
	): Promise<WorkspaceLeaf> {
		switch (route.kind) {
			case 'reveal':
				// The note is already there; reopening it would reset the view.
				await route.leaf.loadIfDeferred();
				return route.leaf;
			case 'pane': {
				// A new tab is created next to the active leaf, so aim the
				// workspace at the companion pane first.
				this.app.workspace.setActiveLeaf(route.anchor, { focus: false });
				return await this.openNoteInLeaf(
					this.app.workspace.getLeaf('tab'),
					file,
					true,
				);
			}
			case 'split':
				return await this.openNoteInLeaf(
					this.app.workspace.createLeafBySplit(route.source, 'vertical'),
					file,
					true,
				);
			case 'tab':
				// Nothing to sit beside: keep the pane the author already owns.
				return await this.openNoteInLeaf(
					this.app.workspace.getLeaf('tab'),
					file,
					false,
				);
		}
	}

	private async openNoteInLeaf(
		leaf: WorkspaceLeaf,
		file: TFile,
		remember: boolean,
	): Promise<WorkspaceLeaf> {
		await leaf.openFile(file, { active: true });
		if (remember) this.notePane = leaf.parent;
		return leaf;
	}

	private workspaceLeafSnapshots(): NotePaneLeaf<WorkspaceLeaf, NotePane>[] {
		const snapshots: NotePaneLeaf<WorkspaceLeaf, NotePane>[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			// Sidebars and popout windows are the author's own arrangement.
			if (leaf.getRoot() !== this.app.workspace.rootSplit) return;
			// Deferred leaves keep their file in the view state only.
			const state = leaf.getViewState();
			const filePath =
				typeof state.state?.file === 'string' ? state.state.file : null;
			snapshots.push({
				leaf,
				pane: leaf.parent,
				viewType: state.type,
				filePath,
				projectId:
					filePath === null ? null : this.projectIdOfPath(filePath),
			});
		});
		return snapshots;
	}

	private canSplitWorkspace(): boolean {
		if (Platform.isMobile) return false;
		return this.app.workspace.containerEl.win.innerWidth >= MIN_SPLIT_WIDTH_PX;
	}

	private projectIdOfPath(path: string): string | null {
		const file = this.app.vault.getFileByPath(path);
		return file instanceof TFile ? this.projectIdOfFile(file) : null;
	}

	private projectIdOfFile(file: TFile): string | null {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return frontmatter === undefined ? null : projectIdOf(frontmatter);
	}

	async openStep(step: StepId): Promise<void> {
		const project = await this.requireCurrentProject();
		const path = await this.resolveStepArtifactPath(
			project,
			step,
			project.characters,
			project.scenes,
		);
		if (path === null) {
			await this.selectStep(step);
			await this.openDashboard();
			return;
		}
		await this.openManagedFile(
			path,
			primaryManagedSectionForStep(step) ?? undefined,
			managedSectionHighlightsForStep(step),
		);
	}

	/**
	 * The translation for `key`, or null when no locale defines one. Only some
	 * issue codes have an action worth spelling out, and `t()` hands back the key
	 * itself for anything it does not know.
	 */
	private optionalTranslation(
		translate: (key: string, vars?: Record<string, string | number>) => string,
		key: string,
	): string | null {
		const translated = translate(key);
		return translated === key ? null : translated;
	}

	async checkCurrentProject(): Promise<RepairReportViewModel> {
		const recent = this.settings.recentProjectPath;
		if (recent === null) throw new Error(this.t('messages.noCurrentProject'));
		try {
			const model = await this.loadDashboardModel(recent);
			if (model === null) throw new ManagedFileNotFoundError(recent);
			const t = (
				key: string,
				vars?: Record<string, string | number>,
			): string => this.translateForProject(model.locale, key, vars);
			// The same members the shield button counts, worldbuilding included:
			// an indicator that turns red over an issue the report then cannot
			// name would leave the author with nowhere to go.
			const issues = [
				...model.structureIssues,
				...model.steps.flatMap((step) => step.healthIssues),
				...model.characters.flatMap((character) => character.healthIssues),
				...model.scenes.flatMap((scene) => scene.healthIssues),
				...model.worldbuildingKinds.flatMap((kind) =>
					kindEntities(model, kind.id).flatMap(
						(entity) => entity.healthIssues,
					),
				),
				// Blocking issues, and any issue the report itself can put
				// right. An advisory one is not damage and lights nothing, but
				// it is exactly what this report exists to offer: filtered out
				// here, its Repair button could not be reached from anywhere
				// in the plugin.
			].filter((issue) => issue.blocking || issue.repairable);
			const uniqueIssues = [
				...new Map(
					issues.map((issue) => [
						`${issue.kind}\u0000${issue.path}\u0000${issue.sectionId ?? ''}\u0000${issue.code}\u0000${issue.repairField ?? ''}`,
						issue,
					]),
				).values(),
			];
			const entries: RepairReportViewModel['entries'] = uniqueIssues.map(
				(issue) => ({
					path: issue.path,
					sectionId: issue.sectionId,
					sectionLabel: issue.sectionLabel,
					status: 'conflict',
					message: issue.message,
					names: issue.names,
					action: issue.action,
					canOpen: issue.canOpen,
					repairable: issue.repairable,
					repairField: issue.repairField,
					// Whichever member the issue is about, so the report can offer the
					// form rather than the raw note it would otherwise open.
					memberId:
						[
							...model.characters,
							...model.scenes,
							...model.worldbuildingKinds.flatMap((kind) =>
								kindEntities(model, kind.id),
							),
						].find((member) => member.path === issue.path)?.id ?? null,
				}),
			);
			return {
				summary:
					entries.length === 0
						? t('messages.healthCheckPassed')
						: t('messages.healthCheckIssues', { count: entries.length }),
				entries,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : this.t('errors.unknown');
			return {
				summary: this.t('messages.healthCheckIssues', { count: 1 }),
				entries: [
					{
						path: recent,
						sectionId: null,
						action: null,
						memberId: null,
						sectionLabel: this.t('editor.managedSection.documentLabel'),
						status: 'conflict',
						message,
						names: [],
						canOpen: this.app.vault.getFileByPath(recent) instanceof TFile,
						repairable: false,
						repairField: null,
					},
				],
			};
		}
	}

	async repairMissingStructureItem(path: string, field?: string): Promise<void> {
		const project = await this.requireCurrentProject();
		try {
			await this.projects.repairMissingStructureItem(
				project.projectFile,
				path,
				field,
			);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async migrateMemberNotes(): Promise<{ migrated: number; skipped: number }> {
		const project = await this.requireCurrentProject();
		// The migration leaves every block saying what the properties say, so
		// the reconcile pass has nothing to add. Pausing it keeps the write
		// storm from queueing a project load for every note it touched.
		this.fieldsReconcilePaused = true;
		try {
			return await this.projects.migrateMemberNotes(project.projectFile);
		} finally {
			this.fieldsReconcilePaused = false;
			this.pendingFieldsReconciles.clear();
		}
	}

	/**
	 * Saves, but not this instant.
	 *
	 * A typography slider is answered at every stop it crosses, so that the page
	 * follows the hand dragging it. Each of those used to write the whole of
	 * data.json -- two dozen full rewrites for one drag of the font size, and two
	 * dozen file events for whatever is syncing the vault. The page is dressed
	 * from the settings in memory and needs nothing from the disk, so the disk is
	 * told once the hand comes to rest. Whatever is waiting is written on unload,
	 * so a drag and a quit in the same breath still lands.
	 */
	saveSettingsSoon(): void {
		if (this.settingsSaveTimer !== null) {
			window.clearTimeout(this.settingsSaveTimer);
		}
		this.settingsSaveTimer = window.setTimeout(() => {
			this.settingsSaveTimer = null;
			void this.saveSettings();
		}, SETTINGS_SAVE_DELAY_MS);
	}

	/** Writes a deferred save now, if one is waiting. */
	async flushSettingsSave(): Promise<void> {
		if (this.settingsSaveTimer === null) return;
		window.clearTimeout(this.settingsSaveTimer);
		this.settingsSaveTimer = null;
		await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		const snapshot: SnowflakeSettings = {
			...this.settings,
			certificateCelebrations: {
				...this.settings.certificateCelebrations,
			},
		};
		const save = this.settingsSaveQueue
			.catch(() => undefined)
			.then(() => this.saveData(snapshot));
		this.settingsSaveQueue = save;
		await save;
	}

	async handleSettingsChanged(key: string): Promise<void> {
		// The page's dress reaches every open stream as variables, and nothing
		// else needs to hear of it: no count to take again, no dashboard to
		// redraw. Answered first and alone, which is what lets a slider be
		// dragged live.
		if (isManuscriptPresentationKey(key)) {
			this.applyManuscriptPresentation();
			// The settings page shows these same values, and in 1.13 it stands
			// in a window of its own, so it can be open beside the popover that
			// just wrote one. It declines while it is the page doing the writing.
			this.settingTab?.refreshPresentationRows();
			return;
		}
		// Which mentions the streams mark is likewise a dress on text they
		// already hold: re-dressing the open streams is the whole change.
		if (key === 'manuscriptMentionHighlight') {
			this.applyManuscriptMentionMode();
			return;
		}
		// Custom highlight rules are dress alone -- transient marks over the
		// loaded segments -- so the same re-dress is again the whole change.
		if (
			key === 'customHighlightRules' ||
			key === 'customHighlightsEnabled' ||
			key === 'sensitiveHighlight'
		) {
			this.applyManuscriptMentionMode();
			return;
		}
		// How dialogue shows is likewise dress on text the streams hold.
		if (key === 'dialoguePresentation') {
			this.applyManuscriptMentionMode();
			return;
		}
		// The numbering rule is read when a note is named, and the export
		// settings when a file is written; nothing standing changes with them.
		if (key.startsWith('manuscriptChapterNumber')) return;
		if (key.startsWith('export')) return;
		// The word milestones are dress on the count the streams already take
		// of the text they hold, so re-dressing the open streams is the whole
		// change here too.
		if (
			key === 'manuscriptMilestones' ||
			key === 'manuscriptMilestoneMode' ||
			key === 'manuscriptMilestoneInterval'
		) {
			this.applyManuscriptMentionMode();
			return;
		}
		// The sensitive list re-dresses at once too, but its counts feed the
		// tracking pane and the statistics, so it also falls through.
		if (key === 'sensitiveWords') {
			this.applyManuscriptMentionMode();
		}
		if (key === 'reduceMotion') this.applyMotionPreference();
		if (key === 'manuscriptFocusLevel') {
			this.applyManuscriptModePresence();
			// The setting transition, deliberately not the effective focus: a
			// glance at another tab mid-session accrues idle, it does not end
			// the session.
			await this.handleFocusSessionTransition();
		}
		if (key === 'projectRoot') {
			this.projectHealth.clear();
			const recent = this.settings.recentProjectPath;
			if (recent !== null && !this.isDirectProjectFile(recent)) {
				this.settings.recentProjectPath = null;
				this.currentProjectLocale = null;
				await this.saveSettings();
			}
		}
		if (key === 'uiLocale' || key === 'protectManagedBoundaries') {
			this.app.workspace.updateOptions();
			this.refreshManagedEditors(
				key === 'protectManagedBoundaries' &&
					this.settings.protectManagedBoundaries,
			);
		}
		if (key === 'projectRoot') await this.syncCurrentProjectLocale();
		// Turning untimed tracking off files what the day has so far; the
		// stored records keep contributing to every reading either way.
		if (key === 'sessionTrackUntimedWords') {
			await this.sessions.untimedTrackingChanged();
		}
		// Every session widget is showing a session setting somewhere, and the
		// page they are set from is not one they can see change.
		if (key.startsWith('session')) this.sessionSettingsChanged();
		this.scheduleWritingCountRefresh(0);
		await this.refreshDashboards();
	}

	private applyMotionPreference(): void {
		this.applyMotionPreferenceToDocument(this.app.workspace.containerEl.doc);
		this.app.workspace.iterateAllLeaves((leaf) => {
			this.applyMotionPreferenceToDocument(leaf.view.containerEl.doc);
		});
	}

	/**
	 * Stamps the app with the focus levels that reach past the stream — fading
	 * the rest of the workspace, and solo — and only while a stream is the view
	 * in front of the author. Going anywhere else lifts all of it at once: the
	 * settings keep the author's choice, but the app is never left faded or
	 * folded away behind a note that has nothing to do with the manuscript.
	 */
	private applyManuscriptModePresence(): void {
		const body = this.app.workspace.containerEl.doc.body;
		const level = this.settings.manuscriptFocusLevel;
		const inFront = this.activeManuscriptView() !== null;
		this.markModeContainers();
		body.classList.toggle(
			'snowflake-method-focus-app',
			inFront && level !== 'off',
		);
		body.classList.toggle(
			'snowflake-method-focus-dashboard',
			inFront && (level === 'deep' || level === 'solo'),
		);
		const solo = inFront && level === 'solo';
		body.classList.toggle('snowflake-method-solo', solo);
		// Full screen follows the level rather than the leaf: the fading lifts
		// and returns as the author glances at other tabs, but macOS animates
		// its way into and out of full screen, and a second of animation per
		// glance would be the mode punishing the glancing. Entered once when
		// solo is chosen, left once when it is put away.
		const doc = this.app.workspace.containerEl.doc;
		if (level === 'solo' && !this.soloFullscreen) {
			if (doc.fullscreenElement === null) {
				this.soloFullscreen = true;
				doc.documentElement.requestFullscreen().catch(() => {
					this.soloFullscreen = false;
				});
			}
		} else if (level !== 'solo' && this.soloFullscreen) {
			this.soloFullscreen = false;
			if (doc.fullscreenElement !== null) void doc.exitFullscreen();
		}
		if (solo && this.soloCollapsed === null) {
			this.soloCollapsed = {
				left: this.app.workspace.leftSplit.collapsed,
				right: this.app.workspace.rightSplit.collapsed,
			};
			this.app.workspace.leftSplit.collapse();
			this.app.workspace.rightSplit.collapse();
		} else if (!solo && this.soloCollapsed !== null) {
			// Only the sidebars solo itself folded: one the author had already put
			// away stays away.
			if (!this.soloCollapsed.left) this.app.workspace.leftSplit.expand();
			if (!this.soloCollapsed.right) this.app.workspace.rightSplit.expand();
			this.soloCollapsed = null;
		}
	}

	/**
	 * Marks the containers the focus levels select by: the leaf holding each
	 * manuscript stream — and, for solo, the tab group and splits above it —
	 * and the leaf holding each dashboard. The stylesheet reads these classes
	 * where it once asked `:has()` what a container held, a question whose
	 * broad invalidation the plugin review flags. Swept and re-laid whole,
	 * because containers keep their elements as leaves move between them.
	 */
	private markModeContainers(): void {
		const root = this.app.workspace.containerEl.doc.body;
		for (const cls of [
			'snowflake-method-holds-stream',
			'snowflake-method-holds-dashboard',
		]) {
			for (const marked of Array.from(root.querySelectorAll(`.${cls}`))) {
				marked.classList.remove(cls);
			}
		}
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof SnowflakeManuscriptView) {
				let above: HTMLElement | null =
					leaf.view.containerEl.closest('.workspace-leaf');
				while (above !== null && !above.classList.contains('mod-root')) {
					if (
						above.classList.contains('workspace-leaf') ||
						above.classList.contains('workspace-tabs') ||
						above.classList.contains('workspace-split')
					) {
						above.classList.add('snowflake-method-holds-stream');
					}
					above = above.parentElement;
				}
			} else if (leaf.view instanceof SnowflakeDashboardView) {
				leaf.view.containerEl
					.closest('.workspace-leaf')
					?.classList.add('snowflake-method-holds-dashboard');
			}
		});
	}

	private applyMotionPreferenceToDocument(targetDocument: Document): void {
		this.motionDocuments.add(targetDocument);
		targetDocument.body.classList.toggle(
			REDUCE_MOTION_CLASS,
			this.settings.reduceMotion,
		);
	}

	private publishScrollbarWidth(): void {
		this.publishScrollbarWidthToDocument(this.app.workspace.containerEl.doc);
		this.app.workspace.iterateAllLeaves((leaf) => {
			this.publishScrollbarWidthToDocument(leaf.view.containerEl.doc);
		});
	}

	private publishScrollbarWidthToDocument(targetDocument: Document): void {
		this.scrollbarDocuments.add(targetDocument);
		this.ensureScrollbarSentinel(targetDocument);
		const width = measureScrollbarWidth(targetDocument);
		// Nothing is published from a window that could not answer: the value
		// left standing is either a true one from before or none at all, and
		// asking again once the workspace is ready costs one probe.
		if (width === null) return;
		const next = `${String(width)}px`;
		// Written only when it has actually moved. This is asked again every
		// time the window comes forward, and writing the same value back would
		// have every rule reading it re-evaluated for nothing.
		const shown = targetDocument.body.style.getPropertyValue(
			SCROLLBAR_WIDTH_PROPERTY,
		);
		if (shown === next) return;
		targetDocument.body.style.setProperty(SCROLLBAR_WIDTH_PROPERTY, next);
	}

	private ensureScrollbarSentinel(targetDocument: Document): void {
		if (this.scrollbarSentinels.has(targetDocument)) return;
		const probe = targetDocument.body.createDiv();
		probe.setCssStyles({
			position: 'absolute',
			top: '-9999px',
			width: '100px',
			height: '100px',
			overflowY: 'auto',
			scrollbarGutter: 'stable',
			visibility: 'hidden',
			pointerEvents: 'none',
		});
		const observer = new ResizeObserver(() => {
			// The publish writes only when the value moved, so the observer's
			// own first call after `observe` costs one skipped write.
			this.publishScrollbarWidthToDocument(targetDocument);
		});
		observer.observe(probe);
		this.scrollbarSentinels.set(targetDocument, { probe, observer });
	}

	private dropScrollbarSentinel(targetDocument: Document): void {
		const sentinel = this.scrollbarSentinels.get(targetDocument);
		if (sentinel === undefined) return;
		sentinel.observer.disconnect();
		sentinel.probe.remove();
		this.scrollbarSentinels.delete(targetDocument);
	}

	/**
	 * The writing count in the status bar: a snowflake and a number. A field
	 * of the plugin's own -- a form in a modal, a step on the dashboard --
	 * answers for itself while it has focus, because that is where the
	 * writing is going. Otherwise a Markdown note in front is counted from
	 * its editor's own buffer, so unsaved keystrokes already count; a
	 * manuscript stream counts the segment being written, or the whole
	 * manuscript while none is; a selection overrides any of them, under the
	 * same rules. Clicking offers the project and manuscript totals, counted
	 * on demand — a whole project is too much reading to do on every
	 * keystroke.
	 */
	private registerWritingCount(): void {
		const item = this.addStatusBarItem();
		item.addClass('mod-clickable', 'snowflake-method-word-count');
		const icon = item.createSpan({ cls: 'snowflake-method-word-count-icon' });
		setIcon(icon, 'snowflake');
		this.writingCountText = item.createSpan();
		this.writingCountItem = item;
		item.hide();
		this.registerDomEvent(item, 'click', (event) => {
			this.openWritingCountMenu(event);
		});
		this.registerEditorExtension(
			createSelectionWatchExtension((report) => {
				// The caret is half of the answer, not only the selection: it
				// says which of a note's marked sections is being written in.
				if (
					this.editorFocus?.path === report?.path &&
					this.editorFocus?.selectedText === report?.selectedText &&
					this.editorFocus?.caret === report?.caret
				) {
					return;
				}
				this.editorFocus = report;
				this.scheduleWritingCountRefresh();
			}),
		);
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, info) => {
				this.scheduleWritingCountRefresh();
				const path = info.file?.path;
				if (path === undefined) return;
				// The transaction is the activity; the text resolves lazily at
				// the session's debounce, so a burst of keystrokes never
				// materializes the note once per key.
				this.sessions.surfaceActivity(path);
				this.sessions.noteChanged(path, () => {
					try {
						// The leaf reuses one editor across the notes it opens,
						// and the debounce reads this later: by then the editor
						// may hold a different note, whose text must not be
						// counted as this one's. A swapped editor answers
						// nothing, and the disk answers instead.
						return info.file?.path === path ? editor.getValue() : null;
					} catch {
						return null;
					}
				});
			}),
		);
		// Focus decides whether a field is being written in at all, so a change
		// of field is worth a recount -- but only a change of field. Every
		// click in the app moves focus, and a stream in front with nothing
		// being edited answers a recount by reading its whole manuscript, so
		// clicking about must not set thousands of notes being summed again.
		// Typing and selecting are not enough either: they fire from every
		// editor, and a caret moving through a long note must not recount it.
		const doc = this.app.workspace.containerEl.doc;
		for (const event of ['focusin', 'focusout'] as const) {
			this.registerDomEvent(doc, event, () => {
				const field = this.focusedField();
				if (field === this.writingCountField) return;
				this.writingCountField = field;
				this.scheduleWritingCountRefresh(0);
			});
		}
		for (const event of ['input', 'selectionchange'] as const) {
			this.registerDomEvent(doc, event, () => {
				if (this.focusedField() === null) return;
				this.scheduleWritingCountRefresh();
			});
		}
		this.register(() => {
			// The flag as well as the timer: a count already in flight resumes
			// after its await, and the status bar item it was going to paint
			// into is removed with the plugin. Without it that continuation
			// arms a fresh timer on a dead instance and nothing clears it.
			this.unloading = true;
			if (this.writingCountTimer !== null) {
				this.app.workspace.containerEl.win.clearTimeout(
					this.writingCountTimer,
				);
				this.writingCountTimer = null;
			}
		});
	}

	private registerWritingSessions(): void {
		const item = this.addStatusBarItem();
		item.addClass('mod-clickable', 'snowflake-method-session');
		const icon = item.createSpan({ cls: 'snowflake-method-session-icon' });
		setIcon(icon, 'clock');
		this.sessionIconEl = icon;
		this.sessionText = item.createSpan();
		this.sessionItem = item;
		// Always on show: with no session running, the icon is how a session
		// is started, and a control that vanishes cannot be clicked.
		setTooltip(item, this.projectT('statusBar.sessionStart'));
		this.registerDomEvent(item, 'click', (event) => {
			this.openWritingSessionMenu(event);
		});
		this.register(
			this.sessions.subscribe((event) => this.handleSessionEvent(event)),
		);
		this.registerWritingSurfaceWatch(this.app.workspace.containerEl.doc);
		// Popout windows already on screen never fire `window-open` again --
		// a plugin update or a disable-enable with one open -- so their
		// documents are gathered from the leaves they hold. Windows opened
		// later arrive through the `window-open` handler instead, so no
		// document is watched twice.
		const watched = new Set<Document>([this.app.workspace.containerEl.doc]);
		this.app.workspace.iterateAllLeaves((leaf) => {
			const doc = leaf.view.containerEl.doc;
			if (watched.has(doc)) return;
			watched.add(doc);
			this.registerWritingSurfaceWatch(doc);
		});
	}

	/** This installation's id, minted once and kept out of data.json. */
	private writingSessionDeviceId(): string {
		const kept = this.app.loadLocalStorage(SESSION_DEVICE_KEY) as unknown;
		if (typeof kept === 'string' && kept.length > 0) return kept;
		const minted = crypto.randomUUID();
		this.app.saveLocalStorage(SESSION_DEVICE_KEY, minted);
		return minted;
	}

	/**
	 * Whether a note is on somebody's screen to be written in: a markdown
	 * leaf in editing mode in any window, or the manuscript stream's editing
	 * segment. A vault write to such a note is its own editor's save echo,
	 * never an external edit, and the sessions must leave it to the editor to
	 * settle. A reading-mode leaf does not count: it has no buffer to echo
	 * and fires no editor events, so a write under it really is external and
	 * skipping the rebase would hand the foreign delta to the next keystroke.
	 */
	private isNoteOpenInEditor(path: string): boolean {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (
				leaf.view instanceof MarkdownView &&
				leaf.view.file?.path === path &&
				leaf.view.getMode() === 'source'
			) {
				return true;
			}
		}
		for (const leaf of this.app.workspace.getLeavesOfType(
			MANUSCRIPT_VIEW_TYPE,
		)) {
			if (
				leaf.view instanceof SnowflakeManuscriptView &&
				leaf.view.editingSegment() === path
			) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Watches one document for editing on this plugin's own writing surfaces.
	 *
	 * A session follows surfaces rather than editors, because an author
	 * filling in a character's storyline on the dashboard is writing, and one
	 * that only heard CodeMirror would call them idle. Only the clock is at
	 * stake: what a field holds has not reached a note yet, and the words are
	 * counted when it does.
	 */
	private registerWritingSurfaceWatch(doc: Document): void {
		this.registerDomEvent(doc, 'input', (event) => {
			const field = this.writingSurfaceField(event.target);
			if (field === null) return;
			// A modal is drawn outside the view that opened it, so it carries
			// no mark of its own: the project it would save into answers
			// instead, which is the one the plugin calls current.
			this.sessions.surfaceActivity(
				field.closest<HTMLElement>('[data-snowflake-project]')?.dataset
					.snowflakeProject ?? this.settings.recentProjectPath,
			);
		});
	}

	/**
	 * A writing surface of this plugin's own, if the event landed in one. The
	 * ownership test the writing count already uses, minus Obsidian's
	 * settings window: a project root is configuration, not writing.
	 */
	private writingSurfaceField(
		target: EventTarget | null,
	): HTMLInputElement | HTMLTextAreaElement | null {
		const field =
			target instanceof HTMLTextAreaElement ||
			(target instanceof HTMLInputElement &&
				COUNTABLE_FIELD_TYPES.has(target.type))
				? target
				: null;
		if (field === null || !this.ownsField(field)) return null;
		return field.closest('.mod-settings') === null ? field : null;
	}

	private handleSessionEvent(event: WritingSessionEvent): void {
		if (this.unloading) return;
		if (event.kind === 'break-started') {
			new Notice(
				this.projectT('session.notice.breakStarted', { cycle: event.cycle }),
			);
		} else if (event.kind === 'work-started') {
			new Notice(
				this.projectT('session.notice.workStarted', { cycle: event.cycle }),
			);
		} else if (event.kind === 'corrupt-file-preserved') {
			new Notice(
				this.projectT('session.notice.corruptPreserved', { path: event.path }),
			);
		} else if (event.kind === 'recovered' && event.record !== null) {
			new Notice(this.projectT('session.notice.recovered'));
		} else if (
			event.kind === 'stopped' &&
			event.reason === 'countdown-completed'
		) {
			new Notice(this.projectT('session.notice.completed'));
		}
		this.repaintWritingSession();
		if (
			event.kind === 'started' ||
			event.kind === 'stopped' ||
			event.kind === 'recovered'
		) {
			this.scheduleRefresh(false);
		}
	}

	private repaintWritingSession(): LiveWritingSession | null {
		const item = this.sessionItem;
		const icon = this.sessionIconEl;
		const text = this.sessionText;
		if (item === null || icon === null || text === null || this.unloading) {
			return null;
		}
		const live = this.sessions.live();
		const iconName =
			live === null || live.type === 'stopwatch'
				? 'clock'
				: live.type === 'countdown'
					? 'timer'
					: POMODORO_ICON;
		const line =
			live === null
				? ''
				: live.state === 'starting'
					? this.projectT('statusBar.sessionStarting')
					: formatClock(sessionClockMs(live));
		const tooltip =
			live === null
				? this.projectT('statusBar.sessionStart')
				: this.writingSessionTooltip(live);
		const look = [
			iconName,
			live?.state ?? 'none',
			live?.pomodoro?.phase ?? '',
		].join(':');
		const shown = this.sessionShown;
		if (
			shown !== null &&
			shown.text === line &&
			shown.tooltip === tooltip &&
			shown.look === look
		) {
			return live;
		}
		this.sessionShown = { text: line, tooltip, look };
		setIcon(icon, iconName);
		text.setText(line);
		item.toggleClass('is-paused', live?.state === 'paused');
		item.toggleClass('is-idle', live?.state === 'idle');
		item.toggleClass('is-break', live?.pomodoro?.phase === 'break');
		setTooltip(item, tooltip);
		return live;
	}

	private writingSessionTooltip(live: LiveWritingSession): string {
		const state =
			live.pomodoro?.phase === 'break'
				? 'break'
				: live.state;
		const lines = [
			[
				this.projectT(`session.type.${live.type}`),
				this.projectT(`session.state.${state}`),
				this.projectT(`session.mode.${live.writingMode}`),
				this.projectT(
					this.settings.sessionScope === 'project'
						? 'statusBar.scopeProject'
						: 'statusBar.scopeManuscript',
				),
				...(live.pomodoro === null
					? []
					: [
							this.projectT('session.stat.cycle', {
								cycle: live.pomodoro.cycle,
							}),
						]),
			].join(' · '),
			this.projectT('session.stat.focus', {
				duration: formatClock(live.durations.focusMs),
			}),
			this.projectT('session.stat.idle', {
				duration: formatClock(live.durations.idleMs),
			}),
			this.projectT('session.stat.total', {
				duration: formatClock(live.durations.totalMs),
			}),
			this.projectT('session.stat.words', {
				added: this.grouped(live.added),
				deleted: this.grouped(live.deleted),
				net: this.grouped(live.trackedNet),
			}),
		];
		if (live.startWordCount !== null) {
			lines.push(
				this.projectT('session.stat.startCount', {
					count: this.grouped(live.startWordCount),
				}),
			);
		}
		const pace = sessionPace(live.trackedNet, live.durations.focusMs);
		if (pace !== null) {
			lines.push(
				this.projectT('session.stat.pace', { pace: this.grouped(pace) }),
			);
		}
		return lines.join('\n');
	}

	private openWritingSessionMenu(event: MouseEvent): void {
		const menu = new Menu();
		const live = this.sessions.live();
		if (live === null) {
			const icons: Record<WritingSessionType, string> = {
				stopwatch: 'clock',
				countdown: 'timer',
				pomodoro: POMODORO_ICON,
			};
			for (const type of WRITING_SESSION_TYPES) {
				menu.addItem((entry) =>
					entry
						.setTitle(this.projectT(`sessionMenu.start.${type}`))
						.setIcon(icons[type])
						.onClick(() => {
							void this.startQuickSession(type).catch((error: unknown) => {
								this.showError(error);
							});
						}),
				);
			}
			menu.addItem((entry) =>
				entry
					.setTitle(this.projectT('sessionMenu.startWithOptions'))
					.setIcon('sliders-horizontal')
					.onClick(() => {
						this.openStartSessionModal();
					}),
			);
		} else {
			// A break is not the author's pause to lift; the entry hides.
			if (live.pomodoro?.phase !== 'break') {
				menu.addItem((entry) =>
					entry
						.setTitle(
							this.projectT(
								live.state === 'paused'
									? 'sessionMenu.resume'
									: 'sessionMenu.pause',
							),
						)
						.setIcon(live.state === 'paused' ? 'play' : 'pause')
						.onClick(() => {
							if (live.state === 'paused') this.sessions.resume();
							else this.sessions.pause();
						}),
				);
			}
			menu.addItem((entry) =>
				entry
					.setTitle(this.projectT('sessionMenu.stop'))
					.setIcon('square')
					.onClick(() => {
						void this.sessions.stop().catch((error: unknown) => {
							this.showError(error);
						});
					}),
			);
			menu.addSeparator();
			for (const mode of WRITING_MODES) {
				menu.addItem((entry) =>
					entry
						.setTitle(this.projectT(`session.mode.${mode}`))
						.setChecked(live.writingMode === mode)
						.onClick(() => {
							this.sessions.setWritingMode(mode);
						}),
				);
			}
		}
		menu.addSeparator();
		menu.addItem((entry) =>
			entry
				.setTitle(this.projectT('sessionMenu.openStatistics'))
				.setIcon('chart-line')
				.onClick(() => {
					void this.openStatisticsView().catch((error: unknown) => {
						this.showError(error);
					});
				}),
		);
		menu.showAtMouseEvent(event);
	}

	/** The clocks a new session starts with, read from the settings once. */
	private sessionTiming(type: WritingSessionType): WritingSessionTiming {
		const timing: WritingSessionTiming = {
			idleThresholdSeconds: this.settings.sessionIdleThresholdSeconds,
		};
		if (type === 'countdown') {
			timing.targetDurationSeconds = this.settings.sessionCountdownMinutes * 60;
		}
		if (type === 'pomodoro') {
			timing.workDurationSeconds =
				this.settings.sessionPomodoroWorkMinutes * 60;
			timing.breakDurationSeconds =
				this.settings.sessionPomodoroBreakMinutes * 60;
			timing.autoRepeat = this.settings.sessionPomodoroAutoRepeat;
		}
		return timing;
	}

	private async startQuickSession(type: WritingSessionType): Promise<void> {
		await this.startConfiguredSession({
			...this.configuredStart(),
			type,
		});
	}

	/** Every session panel on screen, waiting to be told a setting moved. */
	private readonly sessionSettingsListeners = new Set<() => void>();

	private sessionSettingsChanged(): void {
		for (const listener of this.sessionSettingsListeners) listener();
	}

	/** What the timer dialog settled, stored and announced to every panel. */
	private async saveSessionSetup(setup: SessionSetup): Promise<void> {
		// Clamped into the same limits the next launch will load them under,
		// so a length never works all day and comes back different tomorrow.
		this.settings.sessionDefaultType = setup.type;
		this.settings.sessionCountdownMinutes = clampSessionValue(
			'countdownMinutes',
			setup.countdownMinutes,
		);
		this.settings.sessionPomodoroWorkMinutes = clampSessionValue(
			'pomodoroWorkMinutes',
			setup.pomodoroWorkMinutes,
		);
		this.settings.sessionPomodoroBreakMinutes = clampSessionValue(
			'pomodoroBreakMinutes',
			setup.pomodoroBreakMinutes,
		);
		this.settings.sessionPomodoroAutoRepeat = setup.pomodoroAutoRepeat;
		this.settings.sessionWritingMode = setup.writingMode;
		this.settings.sessionStopwatchExpectedMinutes = clampSessionValue(
			'stopwatchExpectedMinutes',
			setup.stopwatchExpectedMinutes,
		);
		await this.saveSettings();
		// The mode is the one part of the setup a running session can still
		// take, and an author changing it mid-sitting means this sitting rather
		// than the next one.
		if (this.sessions.live() !== null) {
			this.sessions.setWritingMode(setup.writingMode);
		}
		this.sessionSettingsChanged();
	}

	/** Net words a day is aimed at, in whichever scope is being aimed at. */
	private dailyWordGoal(): number {
		return this.settings.sessionDailyGoalScope === 'manuscript'
			? this.settings.sessionDailyWordGoalManuscript
			: this.settings.sessionDailyWordGoalProject;
	}

	/**
	 * Switches which reading every widget is showing. Nothing is recounted and
	 * nothing is rewritten: a session records both scopes, so this only
	 * changes the question being asked of what is already on disk. The goal
	 * scope is left where it is, which is the point of it being its own.
	 */
	private toggleSessionScope(): void {
		const scope: WritingSessionScope =
			this.settings.sessionScope === 'project' ? 'manuscript' : 'project';
		this.settings.sessionScope = scope;
		void this.saveSettings();
		new Notice(
			this.projectT('messages.sessionScopeSwitched', {
				scope: this.projectT(`session.scope.${scope}`),
			}),
		);
		this.sessionSettingsChanged();
		this.rerenderStatisticsViews();
	}

	/** The clock and conditions the timer widget shows and starts on. */
	private sessionSetup(): SessionSetup {
		return {
			type: this.settings.sessionDefaultType,
			countdownMinutes: this.settings.sessionCountdownMinutes,
			pomodoroWorkMinutes: this.settings.sessionPomodoroWorkMinutes,
			pomodoroBreakMinutes: this.settings.sessionPomodoroBreakMinutes,
			pomodoroAutoRepeat: this.settings.sessionPomodoroAutoRepeat,
			writingMode: this.settings.sessionWritingMode,
			stopwatchExpectedMinutes:
				this.settings.sessionStopwatchExpectedMinutes,
		};
	}

	/** The saved setup as a start request. */
	private configuredStart(): StartSessionRequest {
		const setup = this.sessionSetup();
		return { type: setup.type, writingMode: setup.writingMode };
	}

	private async startConfiguredSession(
		request: StartSessionRequest,
		projectPath: string | null = null,
	): Promise<void> {
		const project =
			projectPath === null
				? await this.writingCountProject()
				: await this.resolveProject(projectPath);
		if (project === null) {
			new Notice(this.projectT('messages.noCurrentProject'));
			return;
		}
		const options: StartWritingSessionOptions = {
			...request,
			startMode: 'manual',
			timing: this.sessionTiming(request.type),
			countOptions: this.writingCountOptions(),
		};
		await this.sessions.start(project, options);
	}

	/**
	 * Setting the clock and starting on it are the same dialog: what a session
	 * begins under is exactly what the timer is set to, so choosing it here
	 * settles both, and the button says Start rather than Save.
	 */
	private openStartSessionModal(): void {
		new SessionSetupModal(
			this.app,
			this.projectT,
			this.sessionSetup(),
			async (setup) => {
				await this.saveSessionSetup(setup);
				await this.startConfiguredSession(this.configuredStart());
			},
			'session.modal.start',
		).open();
	}

	/**
	 * The auto session that follows the focus-mode setting: turned on from
	 * off, it starts a strict stopwatch; turned off, it ends the session it
	 * started and no other. Auto never replaces a manual session.
	 */
	private async handleFocusSessionTransition(): Promise<void> {
		const level = this.settings.manuscriptFocusLevel;
		const was = this.lastFocusLevel;
		this.lastFocusLevel = level;
		if (was === level) return;
		if (was === 'off' && level !== 'off') {
			if (!this.settings.sessionAutoWithFocusMode) return;
			if (this.sessions.isRunning()) return;
			const project = await this.writingCountProject();
			if (project === null) return;
			await this.sessions.startAuto(project, {
				type: 'stopwatch',
				writingMode: 'draft',
				timing: this.sessionTiming('stopwatch'),
				countOptions: this.writingCountOptions(),
			});
			return;
		}
		if (was !== 'off' && level === 'off') {
			await this.sessions.stopIfAuto('focus-mode-ended');
		}
	}

	async openStatisticsView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(
			STATISTICS_VIEW_TYPE,
		)[0];
		if (existing !== undefined) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf === null) return;
		await leaf.setViewState({ type: STATISTICS_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	async openStickyNotesView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(
			STICKY_NOTES_VIEW_TYPE,
		)[0];
		if (existing !== undefined) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf === null) return;
		await leaf.setViewState({ type: STICKY_NOTES_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/** The one bridge every session panel renders through. */
	/**
	 * The one bridge every session panel renders through, over whichever
	 * project the panel belongs to. A dashboard pane names its own, so a pane
	 * reads its project's day and speaks its project's language whatever else
	 * is open; the sidebar names none and follows the writing.
	 */
	/**
	 * The bridge the prose panel reads through, shaped like the sessions
	 * bridge below and resolving its project the same way.
	 */
	revisionTable(context: SessionPanelContext = {}): RevisionPanelBridge {
		const projectLocale = context.locale ?? null;
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(projectLocale, key, vars);
		const panelProject = (): string | null =>
			context.projectPath ?? this.settings.recentProjectPath;
		return {
			t,
			rows: async () => {
				const project = await this.resolveProject(panelProject());
				if (project === null) return null;
				return this.readRevisionRows(project);
			},
			open: (occurrence) =>
				this.openManuscriptMention(panelProject(), occurrence),
			openUnresolved: (path, revisionId) =>
				this.openManuscriptRevisionCard(panelProject(), path, revisionId),
			discard: (id) => this.discardRevision(panelProject(), id),
		};
	}

	/**
	 * The bridge the foreshadowing table reads through, shaped like the
	 * revision one: rows freshly anchored against the chapters that carry
	 * occurrences, and every dialog opened from here rather than in the panel.
	 */
	foreshadowingTable(context: SessionPanelContext = {}): ForeshadowingPanelBridge {
		const projectLocale = context.locale ?? null;
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(projectLocale, key, vars);
		const panelProject = (): string | null =>
			context.projectPath ?? this.settings.recentProjectPath;
		return {
			t,
			read: async () => {
				const project = await this.resolveProject(panelProject());
				if (project === null) return null;
				return this.readForeshadowingTable(project);
			},
			open: (occurrence) =>
				this.openManuscriptMention(panelProject(), occurrence),
			openUnresolved: (path, occurrenceId) =>
				this.openManuscriptOccurrenceCard(panelProject(), path, occurrenceId),
			showsProgressStatus: () => this.showsTableProgressStatus(),
			showsActionsColumn: () => this.showsTableActionsColumn(),
			add: () => this.openCreateForeshadowingModal(panelProject()),
			editItem: (id) => this.openForeshadowingEditor(panelProject(), id),
			editOccurrence: async (id, occurrenceId) => {
				const project = await this.resolveProject(panelProject());
				if (project === null) return;
				const item = (await this.projects.foreshadowing.list(project)).find(
					(candidate) => candidate.id === id,
				);
				const occurrence = item?.occurrences.find(
					(candidate) => candidate.id === occurrenceId,
				);
				if (item === undefined || occurrence === undefined) return;
				const segments = await this.projects.manuscript.listSegments(project);
				const title =
					segments.find((segment) => segment.path === occurrence.path)?.title ??
					fileStem(occurrence.path);
				const body = await this.readManuscriptSegment(occurrence.path).then(
					(read) => read.body,
					() => null,
				);
				await promptForForeshadowingOccurrence(
					this.app,
					t,
					{
						title,
						text: occurrence.originalText,
						unresolved: occurrenceUnresolved(body, occurrence),
						reveal: () => {
							this.revealForeshadowingOccurrence(project.projectFile, occurrence);
						},
					},
					{ role: occurrence.role, note: occurrence.note },
					async (patch) => {
						const took = await this.updateForeshadowingOccurrence(
							project.projectFile,
							id,
							occurrenceId,
							patch,
						);
						if (!took) throw new Error(t('manuscript.foreshadowing.refused'));
					},
				);
			},
			deleteItem: async (id) => {
				const project = await this.resolveProject(panelProject());
				if (project === null) return false;
				const item = (await this.projects.foreshadowing.list(project)).find(
					(candidate) => candidate.id === id,
				);
				// Gone already is what was asked; declining is not a refusal.
				if (item === undefined) return true;
				const confirmed = await confirmForeshadowingDeletion(
					this.app,
					t,
					item.name,
					item.occurrences.length,
				);
				if (!confirmed) return true;
				return this.deleteForeshadowing(project.projectFile, id);
			},
			deleteOccurrence: (id, occurrenceId) =>
				this.deleteForeshadowingOccurrence(panelProject(), id, occurrenceId),
		};
	}

	stickyNotes(context: SessionPanelContext = {}): StickyNoteBridge {
		const projectLocale = context.locale ?? null;
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(projectLocale, key, vars);
		const panelProject = (): string | null =>
			context.projectPath ?? this.settings.recentProjectPath;
		return {
			t,
			hub: this.stickyNoteHub,
			read: async () => {
				const project = await this.resolveProject(panelProject());
				if (project === null) return null;
				return {
					projectPath: project.projectFile,
					locale: project.locale,
					readOnly: project.readOnly,
					notes: await this.projects.stickyNotes.list(project),
				};
			},
			readNote: (path) => this.projects.stickyNotes.read(path),
			stamp: (path) => this.projects.stickyNotes.stamp(path),
			editorPreferences: () => ({
				autoPairBrackets: this.settings.manuscriptAutoPairBrackets,
				autoPairMarkdown: this.settings.manuscriptAutoPairMarkdown,
			}),
			create: (color) => this.createStickyNote(panelProject(), color),
			writeBody: (path, body, expectedRevision) =>
				this.writeStickyNoteBody(path, body, expectedRevision),
			setColor: (note, color) =>
				this.mutateStickyNote(panelProject(), async () => {
					await this.projects.stickyNotes.setColor(note.path, color);
				}),
			// The editor lets go before the flag is written, so the archive
			// can never land on top of a save that was still on its way.
			archive: (note) =>
				this.mutateStickyNote(panelProject(), async () => {
					await this.stickyNoteHub.claims.evict(note.id);
					await this.projects.stickyNotes.setArchived(note.path, true);
					this.closeStickyFloats(note.id);
				}),
			restore: (note) =>
				this.mutateStickyNote(panelProject(), async () => {
					await this.projects.stickyNotes.setArchived(note.path, false);
				}),
			deleteNote: async (note) => {
				const project = await this.writableProject(panelProject());
				if (project === null) return false;
				const current = await this.projects.stickyNotes.read(note.path);
				// Gone already is what was asked; declining is not a refusal.
				if (current === null) return true;
				const confirmed = await confirmStickyNoteDeletion(
					this.app,
					t,
					stickyNotePreview(current.body),
				);
				if (!confirmed) return true;
				return this.mutateStickyNote(panelProject(), async () => {
					await this.stickyNoteHub.claims.evict(note.id);
					await this.projects.stickyNotes.trash(note.path);
					this.closeStickyFloats(note.id);
					this.stickyNoteHub.forget(note.id);
				});
			},
			deleteArchived: async (notes) => {
				const project = await this.writableProject(panelProject());
				if (project === null) return false;
				// Only what is still set aside goes: a note restored or gone
				// since the board read is left where it stands.
				const standing: StickyNoteKey[] = [];
				for (const note of notes) {
					const current = await this.projects.stickyNotes.read(note.path);
					if (current?.archived === true) standing.push(note);
				}
				if (standing.length === 0) return true;
				const confirmed = await confirmStickyNoteEmptying(this.app, t, standing.length);
				if (!confirmed) return true;
				return this.mutateStickyNote(panelProject(), async () => {
					for (const note of standing) {
						await this.stickyNoteHub.claims.evict(note.id);
						await this.projects.stickyNotes.trash(note.path);
						this.closeStickyFloats(note.id);
						this.stickyNoteHub.forget(note.id);
					}
				});
			},
			openNote: (path) => this.openManagedFile(path),
			float: (id, win, options) => this.floatStickyNote(id, win, options),
			isFloating: (id, win) => this.isStickyNoteFloating(id, win),
			unfloat: (id, win) => {
				this.stickyLayers.get(win.document)?.close(id);
			},
		};
	}

	/**
	 * The revision table's rows, freshly anchored against the chapters that
	 * carry revisions. The table and the task board's derived cards read
	 * through this one, so the two never count differently.
	 */
	private async readRevisionRows(project: ProjectSnapshot): Promise<RevisionRow[]> {
		const revisions = await this.projects.revisions.list(project);
		if (revisions.length === 0) return [];
		const segments = await this.projects.manuscript.listSegments(
			project,
		);
		// Filled in manuscript order and read back in it: the map's own
		// key order is what the rows are sorted by.
		const notes = new Map<string, RevisionNoteReading>();
		for (const segment of segments) {
			notes.set(segment.path, { title: segment.title, body: null });
		}
		// Only chapters that carry revisions are read, one read each and
		// all at once: standing is derived against the body, never
		// trusted stored. A chapter that cannot be read leaves its body
		// null, and every revision on it shows as a conflict.
		const paths = [...new Set(revisions.map((revision) => revision.path))];
		for (const [path, body] of await this.readSegmentBodies(paths)) {
			if (body === null) continue;
			const kept = notes.get(path);
			if (kept === undefined) {
				notes.set(path, { title: fileStem(path), body });
			} else {
				kept.body = body;
			}
		}
		return revisionTableRows(revisions, notes);
	}

	/**
	 * The foreshadowing table's reading: every thread, its occurrences
	 * anchored against the chapters that carry them. Read by the table and
	 * by the task board's derived cards alike.
	 */
	private async readForeshadowingTable(
		project: ProjectSnapshot,
	): Promise<ForeshadowingReading> {
		const items = await this.projects.foreshadowing.list(project);
		if (items.length === 0) return { items: [], readOnly: project.readOnly };
		const [segments, roster] = await Promise.all([
			this.projects.manuscript.listSegments(project),
			this.foreshadowingEntityRoster(project.projectFile),
		]);
		const notes = new Map<string, ForeshadowingNoteReading>();
		for (const segment of segments) {
			notes.set(segment.path, { title: segment.title, body: null });
		}
		// Only chapters carrying occurrences are read, one read each and
		// all at once; a chapter that cannot be read leaves its body
		// null, and every occurrence on it reads as unresolved.
		// A chapter the manuscript no longer lists is not read: nothing
		// can show its passage, so its rows wait to be relinked, as the
		// stream and the sweep say too.
		const paths = [
			...new Set(
				items.flatMap((item) =>
					item.occurrences.map((occurrence) => occurrence.path),
				),
			),
		].filter((path) => notes.has(path));
		for (const [path, body] of await this.readSegmentBodies(paths)) {
			const kept = notes.get(path);
			if (body !== null && kept !== undefined) kept.body = body;
		}
		return {
			items: foreshadowingTableItems(items, notes, roster),
			readOnly: project.readOnly,
		};
	}

	/**
	 * What the derived cards are computed from, each number the source
	 * tab's own. Read through the same caches the tabs read through -- never
	 * through the tracking pane's whole reading, which runs the prose
	 * statistics -- and each on its own footing: a source that cannot be
	 * read costs its own cards and nothing else, so the author's tasks stay
	 * in hand while a cache is having a bad day.
	 */
	private async deriveTaskSources(
		project: ProjectSnapshot,
	): Promise<{ sources: DerivedTaskSources; failed: boolean }> {
		const goal = this.dailyWordGoal();
		const today = this.sessions.today();
		const weekFrom = startOfWeek(today, this.settings.sessionWeekStart);
		const monthFrom = startOfMonth(today);
		const settled = await Promise.allSettled([
			goal > 0
				? this.sessions.totalsBetween(
						project,
						weekFrom < monthFrom ? weekFrom : monthFrom,
						today,
					)
				: Promise.resolve([]),
			this.manuscriptMentionAggregate(project.projectFile),
			this.sensitiveMentionAggregate(project.projectFile),
			this.readForeshadowingTable(project),
			this.readRevisionRows(project),
			this.projects.stickyNotes.list(project),
		]);
		let failed = false;
		const settle = <T>(outcome: PromiseSettledResult<T>, fallback: T): T => {
			if (outcome.status === 'fulfilled') return outcome.value;
			failed = true;
			console.error('Snowflake: a task board source could not be read', outcome.reason);
			return fallback;
		};
		const [history, mentions, sensitive, threads, revisions, stickies] = settled;
		const days = settle(history, []);
		const items = settle(threads, { items: [], readOnly: true }).items;
		const rows = settle(revisions, []);
		return {
			sources: {
				// A history that would not read leaves the goal cards out, as a
				// failed source leaves its issue cards out: the goal is the
				// author's setting, not a reading, and a period reached would
				// otherwise show as untouched until a read landed.
				dailyGoal: history.status === 'fulfilled' ? goal : 0,
				goalNet: {
					day: goalNetSince(days, today),
					week: goalNetSince(days, weekFrom),
					month: goalNetSince(days, monthFrom),
				},
				daysInMonth: daysInMonth(today),
				unresolvedMentions: settle(mentions, null)?.unresolved.length ?? 0,
				sensitiveWords: (settle(sensitive, null) ?? []).filter((term) => term.total > 0)
					.length,
				openForeshadowings: items.filter((item) => item.status === 'active').length,
				unresolvedForeshadowings: items
					.flatMap((item) => item.occurrences)
					.filter((occurrence) => occurrence.standing === 'unresolved').length,
				pendingRevisions: rows.length,
				unresolvedRevisions: rows.filter((row) => row.status === 'conflict').length,
				stickyNotes: partitionStickyNotes(settle(stickies, [])).active.length,
			},
			failed,
		};
	}

	/**
	 * The bridge the task board reads and writes through, shaped like the
	 * sticky notes': every mutation announces to the boards alone, since a
	 * task touches no manuscript text, and every dialog is opened here.
	 */
	taskBoard(context: SessionPanelContext = {}): TaskBoardBridge {
		const projectLocale = context.locale ?? null;
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(projectLocale, key, vars);
		const panelProject = (): string | null =>
			context.projectPath ?? this.settings.recentProjectPath;
		return {
			t,
			read: async () => {
				const project = await this.resolveProject(panelProject());
				if (project === null) return null;
				const today = this.sessions.today();
				const weekFrom = startOfWeek(today, this.settings.sessionWeekStart);
				const [tasks, derived, roster] = await Promise.all([
					this.projects.tasks.list(project),
					this.settings.showDerivedTasks
						? this.deriveTaskSources(project)
						: Promise.resolve(null),
					this.foreshadowingEntityRoster(project.projectFile),
				]);
				return {
					projectPath: project.projectFile,
					locale: project.locale,
					readOnly: project.readOnly,
					today,
					week: { from: weekFrom, to: addDays(weekFrom, 6) },
					dateFormat: this.settings.sessionDateFormat,
					tasks,
					derived: derived === null ? [] : deriveTasks(derived.sources),
					derivedFailed: derived !== null && derived.failed,
					roster,
				};
			},
			// Every channel a derived card's source speaks on, plus the board's
			// own: the sessions (a goal edit reaches only the settings
			// listeners, never a dashboard refresh), the sticky hub (a sticky
			// write never reaches one either), and the task bell.
			subscribe: (listener) => {
				const fromService = this.sessions.subscribe((event) => {
					if (event.kind === 'changed' && event.counted !== true) return;
					listener();
				});
				this.sessionSettingsListeners.add(listener);
				const fromHub = this.stickyNoteHub.subscribe(listener);
				this.taskListeners.add(listener);
				return () => {
					fromService();
					this.sessionSettingsListeners.delete(listener);
					fromHub();
					this.taskListeners.delete(listener);
				};
			},
			today: () => this.sessions.today(),
			add: (status) => this.openCreateTaskModal(panelProject(), status),
			edit: (id) => this.openTaskEditor(panelProject(), id),
			move: (id, status, beforeId) =>
				this.mutateTasks(
					panelProject(),
					async (project) => {
						const wrote = await this.projects.tasks.move(project, id, status, beforeId);
						return { result: wrote !== 'refused', changed: wrote === 'written' };
					},
					false,
				),
			archive: (id) => this.setTaskArchived(panelProject(), id, true),
			restore: (id) => this.setTaskArchived(panelProject(), id, false),
			deleteTask: async (id) => {
				const project = await this.writableProject(panelProject());
				if (project === null) return false;
				const task = (await this.projects.tasks.list(project)).find(
					(candidate) => candidate.id === id,
				);
				// Gone already is what was asked; declining is not a refusal.
				if (task === undefined) return true;
				const confirmed = await confirmTaskDeletion(this.app, t, task.title);
				if (!confirmed) return true;
				return this.removeTasks(panelProject(), [id]);
			},
			emptyArchive: async (ids) => {
				const project = await this.writableProject(panelProject());
				if (project === null) return false;
				// Only what is still set aside goes: a task restored or gone
				// since the board read is left where it stands, and one
				// restored while the confirmation stands open is spared by
				// the write itself, which reads the flag afresh.
				const standing = (await this.projects.tasks.list(project))
					.filter((task) => task.archived && ids.includes(task.id))
					.map((task) => task.id);
				if (standing.length === 0) return true;
				const confirmed = await confirmTaskArchiveEmptying(this.app, t, standing.length);
				if (!confirmed) return true;
				return this.removeTasks(panelProject(), standing, { archivedOnly: true });
			},
		};
	}

	/**
	 * One change to a project's tasks: refused where the project cannot be
	 * written, and announced to the boards when the file moved.
	 */
	private async mutateTasks<T>(
		projectPath: string | null,
		work: (project: ProjectSnapshot) => Promise<{ result: T; changed: boolean }>,
		refused: T,
	): Promise<T> {
		const project = await this.writableProject(projectPath);
		if (project === null) return refused;
		const { result, changed } = await work(project);
		if (changed) this.tasksChanged();
		return result;
	}

	private createTask(projectPath: string | null, task: Task): Promise<boolean> {
		return this.mutateTasks(
			projectPath,
			async (project) => {
				const took = await this.projects.tasks.create(project, task);
				return { result: took, changed: took };
			},
			false,
		);
	}

	/**
	 * One task's edit, answering with the store's own word: a task gone since
	 * the form opened is "absent", which the form must not take for a save,
	 * or what was typed into it would close with the dialog and be lost.
	 */
	private editTask(projectPath: string | null, id: string, next: TaskEdit): Promise<TaskWrite> {
		return this.mutateTasks<TaskWrite>(
			projectPath,
			async (project) => {
				const wrote = await this.projects.tasks.edit(project, id, next);
				return { result: wrote, changed: wrote === 'written' };
			},
			'refused',
		);
	}

	private setTaskArchived(
		projectPath: string | null,
		id: string,
		archived: boolean,
	): Promise<boolean> {
		return this.mutateTasks(
			projectPath,
			async (project) => {
				const wrote = await this.projects.tasks.setArchived(project, id, archived);
				return { result: wrote !== 'refused', changed: wrote === 'written' };
			},
			false,
		);
	}

	private removeTasks(
		projectPath: string | null,
		ids: readonly string[],
		options: { archivedOnly?: boolean } = {},
	): Promise<boolean> {
		return this.mutateTasks(
			projectPath,
			async (project) => {
				const outcome = await this.projects.tasks.remove(project, ids, options);
				return { result: outcome !== 'refused', changed: outcome === 'deleted' };
			},
			false,
		);
	}

	/**
	 * A new task, from the board's Add or the palette: the form empty but
	 * for the column it was asked in, and one write when it is saved.
	 */
	async openCreateTaskModal(projectPath: string | null, status?: TaskStatus): Promise<void> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return;
		// Refused at the door rather than at Save, where the board's own Add
		// is already greyed: a form filled in for nothing is worse than a word.
		if (project.readOnly) {
			new Notice(this.translateForProject(project.locale, 'errors.readOnly'));
			return;
		}
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(project.locale, key, vars);
		// The roster for the picker, and the standing tasks for the titles
		// the new one may not take.
		const [roster, tasks] = await Promise.all([
			this.foreshadowingEntityRoster(project.projectFile),
			this.projects.tasks.list(project),
		]);
		await promptForTask(
			this.app,
			t,
			{
				title: t('modal.task.title'),
				submitLabelKey: 'common.create',
				roster,
				takenNames: tasks.map((task) => task.title),
				...(status === undefined ? {} : { initialStatus: status }),
			},
			async (result) => {
				const now = Date.now();
				const took = await this.createTask(project.projectFile, {
					id: createStableId('task'),
					...result,
					archived: false,
					createdAt: now,
					updatedAt: now,
				});
				if (!took) throw new Error(t('taskBoard.refused'));
			},
		);
	}

	/** A task's form over what it holds, saved in one write. */
	async openTaskEditor(projectPath: string | null, id: string): Promise<void> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return;
		if (project.readOnly) {
			new Notice(this.translateForProject(project.locale, 'errors.readOnly'));
			return;
		}
		const tasks = await this.projects.tasks.list(project);
		const task = tasks.find((candidate) => candidate.id === id);
		if (task === undefined) return;
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(project.locale, key, vars);
		const roster = await this.foreshadowingEntityRoster(project.projectFile);
		await promptForTask(
			this.app,
			t,
			{
				title: t('modal.task.editTitle'),
				submitLabelKey: 'common.save',
				roster,
				// Every title but its own: keeping a title is not taking one.
				takenNames: tasks
					.filter((other) => other.id !== id)
					.map((other) => other.title),
				initial: {
					title: task.title,
					description: task.description,
					status: task.status,
					priority: task.priority,
					dueDate: task.dueDate,
					related: task.related,
				},
			},
			async (result) => {
				// A save is only a save when the store wrote, or found nothing to
				// write; anything else keeps the form open with what was typed.
				const wrote = await this.editTask(project.projectFile, id, result);
				if (wrote === 'absent') throw new Error(t('modal.task.gone'));
				if (wrote !== 'written') throw new Error(t('taskBoard.refused'));
			},
		);
	}

	proseStatistics(context: SessionPanelContext = {}): ProsePanelBridge {
		const projectLocale = context.locale ?? null;
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(projectLocale, key, vars);
		const panelProject = (): string | null =>
			context.projectPath ?? this.settings.recentProjectPath;
		const read = async <T>(
			from: (project: ProjectSnapshot) => Promise<T>,
		): Promise<T | null> => {
			const project = await this.resolveProject(panelProject());
			return project === null ? null : from(project);
		};
		return {
			t,
			statistics: async () =>
				read(async (project) =>
					this.projects.analysis.statistics(
						project,
						await this.analysisConfigFor(project),
					),
				),
			frequency: async ({ includeStopwords, includeEntities }) =>
				read(async (project) => {
					const stopwords = includeStopwords
						? null
						: this.frequencyStopwords();
					const exclude = includeEntities
						? null
						: await this.entityExclusionTerms(project);
					return this.projects.analysis.frequency(
						project,
						await this.analysisConfigFor(project),
						{ stopwords, exclude },
					);
				}),
			readingSpeeds: () => ({
				wordsPerMinute: this.settings.readingWordsPerMinute,
				cjkPerMinute: this.settings.readingCjkCharactersPerMinute,
			}),
			openChapter: async (path) => {
				const project = await this.resolveProject(panelProject());
				if (project === null) return;
				await this.openManuscriptStream(project.projectFile, path);
			},
			segmenterAvailable: () => hasWordSegmenter(),
		};
	}

	/**
	 * The tracking panel's bridge: the sidebar pane's readings regrouped for
	 * a designed surface -- entities gathered under their kinds in rail
	 * order, the chapter axis beside them so a distribution knows where the
	 * book begins and ends.
	 */
	entityTracking(context: SessionPanelContext = {}): EntitiesPanelBridge {
		const projectLocale = context.locale ?? null;
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(projectLocale, key, vars);
		const panelProject = (): string | null =>
			context.projectPath ?? this.settings.recentProjectPath;
		const kindLabel = (kind: string): string => {
			if (kind === 'character' || kind === 'scene') {
				return t(`definition.kind.${kind}`);
			}
			return isWorldbuildingKind(kind)
				? t(`worldbuilding.kind.${kind}`)
				: kind;
		};
		return {
			t,
			tracking: async () => {
				const projectPath = panelProject();
				if (projectPath === null) return null;
				const model = await this.loadDashboardModel(projectPath);
				const aggregate =
					await this.manuscriptMentionAggregate(projectPath);
				if (model === null || aggregate === null) return null;
				const [ignores, sensitive, dialogue] = await Promise.all([
					this.mentionIgnores(projectPath),
					this.sensitiveMentionAggregate(projectPath),
					this.dialogueMentionChapters(projectPath),
				]);
				const project = await this.resolveProject(projectPath);
				const perNote =
					project === null
						? []
						: (
								await this.projects.analysis.statistics(
									project,
									await this.analysisConfigFor(project),
								)
							).perNote;
				const chapters = perNote.map(({ path, title }) => ({
					path,
					title,
				}));
				const dialogueUnits = new Map(
					perNote.map((note) => [note.path, note.dialogueCounted]),
				);
				const kindOf = new Map<string, string>();
				for (const member of model.characters) {
					kindOf.set(member.path, 'character');
				}
				for (const member of model.scenes) kindOf.set(member.path, 'scene');
				for (const kind of model.worldbuildingKinds) {
					for (const member of model.worldbuilding[kind.id] ?? []) {
						kindOf.set(member.path, kind.id);
					}
				}
				const byKind = new Map<string, EntityMentionAggregate[]>();
				for (const entity of aggregate.entities) {
					const kind = kindOf.get(entity.memberPath);
					if (kind === undefined) continue;
					const held = byKind.get(kind);
					if (held === undefined) byKind.set(kind, [entity]);
					else held.push(entity);
				}
				const kinds: TrackingKindSection[] = entityKindIds(
					model.worldbuildingKinds,
				).map((kind) => ({
					id: kind,
					label: kindLabel(kind),
					rows: (byKind.get(kind) ?? []).sort(
						(left, right) =>
							right.total - left.total ||
							left.memberName.localeCompare(right.memberName),
					),
				}));
				return {
					kinds,
					unresolved: aggregate.unresolved,
					sensitive: sensitive ?? [],
					dialogue: (dialogue ?? []).map((chapter) => ({
						...chapter,
						units: dialogueUnits.get(chapter.path) ?? 0,
					})),
					ignores,
					chapters,
				};
			},
			dialogueOccurrences: (path) =>
				this.dialogueMentionOccurrences(panelProject(), path),
			readSegmentBody: async (path) => {
				try {
					return (await this.readManuscriptSegment(path)).body;
				} catch {
					return '';
				}
			},
			locateIgnore: async (rule) => {
				// The ordinal was counted over the note's analyzed occurrences
				// -- link targets, code and glued substrings never among them
				// -- so only that same analysis can walk it back to its spot.
				const projectPath = panelProject();
				const matcher = await this.manuscriptEntityMatcher(projectPath);
				if (matcher === null) return null;
				let body: string;
				try {
					body = (await this.readManuscriptSegment(rule.notePath)).body;
				} catch {
					return null;
				}
				const { candidate } = splitMentionIgnores(
					await this.mentionIgnores(projectPath),
				);
				const same = analyzeMentions(
					rule.notePath,
					body,
					[],
					matcher,
					candidate,
				).filter((entry) => entry.matchedText === rule.matchedText);
				const found = same[rule.ordinal];
				return found === undefined
					? null
					: { from: found.from, to: found.to };
			},
			openMention: (occurrence) =>
				this.openManuscriptMention(panelProject(), occurrence),
			openChapter: async (path) => {
				const project = await this.resolveProject(panelProject());
				if (project === null) return;
				await this.openManuscriptStream(project.projectFile, path);
			},
			openMember: (path) => this.openManagedFile(path),
			removeIgnore: (rule) =>
				this.removeMentionIgnore(panelProject(), rule),
		};
	}

	/**
	 * The stopword set frequency reads with: both built-in lists at once --
	 * a Chinese manuscript still holds English function words, and the two
	 * lists cannot collide -- plus whatever the reader added.
	 */
	private frequencyStopwords(): Set<string> {
		return new Set([
			...DEFAULT_STOPWORDS_EN,
			...DEFAULT_STOPWORDS_ZH,
			...parseStopwords(this.settings.customStopwords),
		]);
	}

	/** Every entity label, normalized the way tokens are (D20: whole labels). */
	private async entityExclusionTerms(
		project: ProjectSnapshot,
	): Promise<Set<string>> {
		const targets = await this.listWikilinkTargets(project.projectFile);
		return new Set(
			targets
				.map((target) => target.label.trim().normalize('NFC').toLowerCase())
				.filter((label) => label.length > 0),
		);
	}

	writingSessions(context: SessionPanelContext = {}): SessionPanelBridge {
		const projectLocale = context.locale ?? null;
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(projectLocale, key, vars);
		// Every reading below is of one project's sessions, and which project
		// that is has one answer: a pane names its own, and a panel that named
		// none reads the project the author is working in -- the one the last
		// dashboard they touched belongs to -- rather than whichever note
		// happens to be open in the editor beside it.
		// Which project this panel speaks for: a pane names its own, and the
		// sidebar names none and speaks for the one being worked in. Every
		// reading below is of that project, the running session included --
		// switch project and the sidebar switches with it, rather than leaving
		// a neighbour's clock ticking over a day that is not being shown.
		const panelProject = (): string | null =>
			context.projectPath ?? this.settings.recentProjectPath;
		const read = async <T>(
			from: (project: ProjectSnapshot) => Promise<T>,
		): Promise<T | null> => {
			const project = await this.resolveProject(panelProject());
			return project === null ? null : from(project);
		};
		return {
			t,
			locale: () =>
				resolveLocale(
					this.settings.uiLocale,
					moment.locale(),
					projectLocale ??
						this.currentProjectLocale ??
						this.resolvedDefaultProjectLocale(),
				),
			weekStart: () => this.settings.sessionWeekStart,
			dateFormat: () => this.settings.sessionDateFormat,
			today: () => this.sessions.today(),
			live: () => this.sessions.live(panelProject() ?? undefined),
			history: async (days) =>
				read((project) => this.sessions.dailyTotals(project, days)),
			month: async (anchor) =>
				read((project) => this.sessions.monthTotals(project, anchor)),
			spread: async (span) =>
				read((project) => this.sessions.spread(project, span)),
			view: () => ({
				trendDays: this.settings.sessionTrendDays,
				measure: this.settings.sessionReadingMeasure,
				heatmapGoal: this.settings.sessionHeatmapGoal,
				bandSpan: this.settings.sessionBandSpan,
			}),
			setView: (patch) => {
				if (patch.trendDays !== undefined) {
					this.settings.sessionTrendDays = patch.trendDays;
				}
				if (patch.measure !== undefined) {
					this.settings.sessionReadingMeasure = patch.measure;
					// Choosing a measure chooses it for every reading, and the
					// year's own goal shading is not one of them: a reader who
					// asks the trend about net words has asked the year too,
					// and would not expect it to still be on the goal.
					this.settings.sessionHeatmapGoal = false;
				}
				if (patch.heatmapGoal !== undefined) {
					this.settings.sessionHeatmapGoal = patch.heatmapGoal;
				}
				if (patch.bandSpan !== undefined) {
					this.settings.sessionBandSpan = patch.bandSpan;
				}
				void this.saveSettings();
				// Both panels are looking at the same reading, so a switch in
				// one is a switch in the other.
				this.sessionSettingsChanged();
			},
			todaySummary: async () =>
				read((project) => this.sessions.todaySummary(project)),
			subscribe: (listener) => {
				const fromService = this.sessions.subscribe((event) => {
					listener(
						event.kind === 'started' ||
							event.kind === 'stopped' ||
							event.kind === 'recovered',
						event.kind === 'changed' && event.counted === true,
					);
				});
				// A setting changed in one panel's dialog is a setting every
				// other panel is showing, so the channel is the plugin's rather
				// than the dialog's: a goal set in the dashboard moves the
				// sidebar's gauge at the same moment.
				const settings = (): void => {
					listener(true);
				};
				this.sessionSettingsListeners.add(settings);
				return () => {
					fromService();
					this.sessionSettingsListeners.delete(settings);
				};
			},
			// The target the gauges read is the one being aimed at, which is
			// the goal scope's rather than the lens's: what the charts are
			// showing must not move the goalposts.
			dailyWordGoal: () => this.dailyWordGoal(),
			goalScope: () => this.settings.sessionDailyGoalScope,
			setup: () => this.sessionSetup(),
			editDailyWordGoal: () => {
				new DailyWordGoalModal(
					this.app,
					t,
					{
						project: this.settings.sessionDailyWordGoalProject,
						manuscript: this.settings.sessionDailyWordGoalManuscript,
						scope: this.settings.sessionDailyGoalScope,
					},
					async (goals) => {
						this.settings.sessionDailyWordGoalProject =
							clampSessionValue('dailyWordGoal', goals.project);
						this.settings.sessionDailyWordGoalManuscript =
							clampSessionValue('dailyWordGoal', goals.manuscript);
						this.settings.sessionDailyGoalScope = goals.scope;
						await this.saveSettings();
						this.sessionSettingsChanged();
					},
				).open();
			},
			editSetup: () => {
				new SessionSetupModal(this.app, t, this.sessionSetup(), (setup) =>
					this.saveSessionSetup(setup),
				).open();
			},
			start: () => {
				// Started from a panel, the sitting is that panel's project's
				// -- the same one every reading above resolves, the sidebar's
				// included. A Start that resolved the project any other way
				// could begin a session the panel itself then refuses to show.
				void this.startConfiguredSession(
					this.configuredStart(),
					panelProject(),
				).catch((error: unknown) => {
					this.showError(error);
				});
			},
			pauseOrResume: () => {
				if (this.sessions.live()?.state === 'paused') this.sessions.resume();
				else this.sessions.pause();
			},
			stop: () => {
				void this.sessions.stop().catch((error: unknown) => {
					this.showError(error);
				});
			},
		};
	}

	/** A stream segment's text changed under the author's typing. */
	manuscriptSegmentEdited(path: string, body: string): void {
		this.sessions.surfaceActivity(path);
		// A stream body carries no frontmatter and draft notes carry no
		// managed sections, so counting it plain matches the note on disk.
		this.sessions.noteChanged(path, () => body);
	}

	/** A number as the reader's own locale groups it. */
	private grouped(value: number): string {
		const locale = resolveGlobalLocale(this.settings.uiLocale, moment.locale());
		return value.toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US');
	}

	/**
	 * The ways one piece of writing measures, one to a line.
	 *
	 * The headline number answers to whichever convention is set, so it says
	 * nothing about the others; this says all of them at once, the way a word
	 * processor's own statistics panel does. Words is what the two halves come
	 * to together, since a convention that reads Chinese by the character
	 * still counts each of those characters as a word.
	 */
	private writingCountBreakdown(count: WritingCount): string {
		return [
			this.projectT('statusBar.statWords', {
				count: this.grouped(count.cjkCharacters + count.words),
			}),
			this.projectT('statusBar.statCharactersNoSpaces', {
				count: this.grouped(count.charactersNoSpaces),
			}),
			this.projectT('statusBar.statCharactersWithSpaces', {
				count: this.grouped(count.charactersWithSpaces),
			}),
			this.projectT('statusBar.statNonAsianWords', {
				count: this.grouped(count.words),
			}),
			this.projectT('statusBar.statAsianCharacters', {
				count: this.grouped(count.cjkCharacters),
			}),
		].join('\n');
	}

	/**
	 * What a count is counted in. Three of the conventions gather writing into
	 * words and one reads it character by character, and a number labelled
	 * with the wrong one of those is a number that reads as wrong.
	 */
	private writingCountUnit(total: number): string {
		if (countsCharacters(this.settings.writingCountMode)) {
			return this.projectT(
				total === 1 ? 'statusBar.unitCharacter' : 'statusBar.unitCharacters',
			);
		}
		return this.projectT(
			total === 1 ? 'statusBar.unitWord' : 'statusBar.unitWords',
		);
	}

	/**
	 * One pending count at a time, and the soonest asked for is the one that
	 * runs. Callers ask from nothing to a second out, and a later request must
	 * not carry an earlier one with it: a focus change wants the number now,
	 * and a vault write arriving in the same tick would otherwise hold it back
	 * a full second -- or, under a stream of writes, re-arm ahead of itself
	 * forever and leave the previous context's number standing.
	 */
	private scheduleWritingCountRefresh(delay = 250): void {
		if (this.unloading) return;
		const win = this.app.workspace.containerEl.win;
		const due = Date.now() + delay;
		if (this.writingCountTimer !== null) {
			if (due >= this.writingCountDue) return;
			win.clearTimeout(this.writingCountTimer);
		}
		this.writingCountDue = due;
		this.writingCountTimer = win.setTimeout(() => {
			this.writingCountTimer = null;
			void this.refreshWritingCount().catch((error: unknown) => {
				console.error('Snowflake: could not refresh the writing count', error);
			});
		}, delay);
	}

	manuscriptWritingChanged(): void {
		this.scheduleWritingCountRefresh();
	}

	private async refreshWritingCount(): Promise<void> {
		const item = this.writingCountItem;
		const text = this.writingCountText;
		if (item === null || text === null || this.unloading) return;
		const sequence = ++this.writingCountSequence;
		const shown = await this.currentWritingCount();
		if (sequence !== this.writingCountSequence || this.unloading) return;
		if (shown === null) {
			this.writingCountShown = null;
			item.hide();
			return;
		}
		const line = this.projectT(
			shown.selection ? 'statusBar.selectionWordCount' : 'statusBar.wordCount',
			{
				count: this.grouped(shown.count.total),
				unit: this.writingCountUnit(shown.count.total),
			},
		);
		const breakdown = this.writingCountBreakdown(shown.count);
		// A count that says what the last one said needs no writing down. The
		// re-check below asks twice a second for as long as a field holds
		// focus, and every one of those answers the same until it is typed in.
		if (
			this.writingCountShown?.line !== line ||
			this.writingCountShown.breakdown !== breakdown
		) {
			this.writingCountShown = { line, breakdown };
			text.setText(line);
			// The breakdown is the item's name as well as its tooltip: Obsidian
			// keeps a tooltip in `aria-label`, so a label written after this one
			// would take the numbers away from the pointer and leave nothing in
			// their place.
			setTooltip(item, breakdown);
			item.show();
		}
		// The chain ends of its own accord: the first count taken after the
		// field is gone is not a field's count, and arms nothing.
		if (this.focusedField() !== null) {
			this.scheduleWritingCountRefresh(FIELD_RECHECK_MS);
		}
	}

	/**
	 * The plugin's own text field with focus, if one has it. Looked up when a
	 * count is taken rather than remembered, so a field whose modal closed
	 * cannot leave its number standing.
	 */
	private focusedField(): HTMLInputElement | HTMLTextAreaElement | null {
		const active = this.app.workspace.containerEl.doc.activeElement;
		const field =
			active instanceof HTMLTextAreaElement ||
			(active instanceof HTMLInputElement && COUNTABLE_FIELD_TYPES.has(active.type))
				? active
				: null;
		return field !== null && this.ownsField(field) ? field : null;
	}

	/**
	 * Whether a field is one this plugin drew.
	 *
	 * A class of ours somewhere overhead does not answer it: the focus modes
	 * mark the document body, the stream marks the workspace splits that hold
	 * it, and either would make every box in the app -- the quick switcher,
	 * the search pane, another plugin's view -- read as ours. What answers it
	 * is where the nearest marked container sits: inside a modal, or inside
	 * one of our own views. The body and a workspace split contain those
	 * rather than sitting in them, so they fail on the way past.
	 */
	private ownsField(field: Element): boolean {
		const owner = markedOwnerOf(field);
		if (owner === null) return false;
		if (owner.closest('.modal') !== null) return true;
		for (const type of [DASHBOARD_VIEW_TYPE, MANUSCRIPT_VIEW_TYPE]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				if (leaf.view.containerEl.contains(owner)) return true;
			}
		}
		return false;
	}

	/** What the status bar should show for what is in front, or null. */
	private async currentWritingCount(): Promise<{
		count: WritingCount;
		selection: boolean;
	} | null> {
		const options = this.writingCountOptions();
		// A field holds what was typed into it and no Markdown around it, so
		// it is counted as it stands -- the same reading the step 1 hint under
		// the dashboard's own box gives.
		const field = this.focusedField();
		if (field !== null) {
			const { selectionStart, selectionEnd } = field;
			const selected =
				selectionStart !== null &&
				selectionEnd !== null &&
				selectionEnd > selectionStart
					? field.value.slice(selectionStart, selectionEnd)
					: null;
			return {
				count: countWriting(selected ?? field.value, options),
				selection: selected !== null,
			};
		}
		const stream = this.activeManuscriptView();
		if (stream !== null) {
			const context = stream.writingContext();
			if (context.selection !== null) {
				return {
					count: this.countSelection(context.selection, options),
					selection: true,
				};
			}
			if (context.editingPath !== null && context.body !== null) {
				return {
					count: this.countBodyMemoized(context.body, 'draft', options),
					selection: false,
				};
			}
			const project = await this.resolveProject(context.projectPath);
			if (project === null) return null;
			return {
				count: await this.projects.writingCount.countProject(
					project,
					'manuscript',
					options,
				),
				selection: false,
			};
		}
		const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (markdown !== null && markdown.file !== null) {
			// Only what was reported from this very note may speak for it: a
			// caret carried over from another pane would land anywhere.
			const focus =
				this.editorFocus?.path === markdown.file.path ? this.editorFocus : null;
			if (focus?.selectedText != null) {
				return {
					count: this.countSelection(focus.selectedText, options),
					selection: true,
				};
			}
			const content = markdown.editor.getValue();
			const section =
				focus === null
					? null
					: this.countCaretSection(content, focus.caret, options);
			return {
				count: section ?? this.countMarkdownBuffer(content, options),
				selection: false,
			};
		}
		return null;
	}

	/**
	 * The marked section the caret sits in, counted by itself — the piece
	 * being written, with the note's own total to fall back to, the same
	 * bargain the manuscript stream strikes between a segment and the whole.
	 * Which sections answer and what comes out of them is the service's to
	 * say, so a section can never report more writing than the note holding it.
	 */
	private countCaretSection(
		content: string,
		caret: number,
		options: NoteCountOptions,
	): WritingCount | null {
		let body: string;
		let declared: unknown;
		try {
			const parsed = parseMarkdownFrontmatter(content);
			body = parsed.body;
			declared = documentTypeOf(parsed.frontmatter);
		} catch {
			return null;
		}
		if (!isDocumentType(declared)) return null;
		// The body runs to the end of the note, so what precedes it is the
		// frontmatter, and the caret steps back by exactly that much.
		const span = this.projects.writingCount.sectionSpanAt(
			body,
			declared,
			caret - (content.length - body.length),
		);
		if (span === null) return null;
		const memo = this.sectionCountMemo;
		if (
			memo !== null &&
			memo.from === span.from &&
			memo.to === span.to &&
			memo.options.mode === options.mode &&
			memo.options.headings === options.headings &&
			memo.body === body
		) {
			return memo.count;
		}
		const count = this.projects.writingCount.countRange(
			body,
			declared,
			span,
			options,
		);
		this.sectionCountMemo = { body, from: span.from, to: span.to, options, count };
		return count;
	}

	/** A note's buffer, its frontmatter set aside — or all of it when broken. */
	private countMarkdownBuffer(
		content: string,
		options: NoteCountOptions,
	): WritingCount {
		try {
			const parsed = parseMarkdownFrontmatter(content);
			const declared = documentTypeOf(parsed.frontmatter);
			return this.countBodyMemoized(
				parsed.body,
				isDocumentType(declared) ? declared : null,
				options,
			);
		} catch {
			return countWriting(countableProse(content, [], options), options);
		}
	}

	/** One body's count, remembered for as long as the body stands still. */
	private countBodyMemoized(
		body: string,
		declared: DocumentType | null,
		options: NoteCountOptions,
	): WritingCount {
		const memo = this.bufferCountMemo;
		if (
			memo !== null &&
			memo.declared === declared &&
			memo.options.mode === options.mode &&
			memo.options.headings === options.headings &&
			memo.body === body
		) {
			return memo.count;
		}
		const count = this.projects.writingCount.countBody(body, declared, options);
		this.bufferCountMemo = { body, declared, options, count };
		return count;
	}

	/**
	 * A selection counts as the page shows it: same stripping, same rules —
	 * except that a stretch the author drew a line around has no title. A
	 * level-1 heading is passed over because the plugin wrote it above the
	 * note, not because a heading is worth nothing, so spending that rule on
	 * the first heading inside a selection would drop one the author wrote and
	 * report less writing than the same text adds to the note.
	 */
	private countSelection(
		selection: string,
		options: NoteCountOptions,
	): WritingCount {
		const headings =
			options.headings === 'skip-first-h1' ? 'count' : options.headings;
		return countWriting(
			countableProse(selection, [], { ...options, headings }),
			options,
		);
	}

	private writingCountOptions(): NoteCountOptions {
		return {
			mode: this.settings.writingCountMode,
			headings: this.settings.writingCountHeadings,
		};
	}

	private openWritingCountMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((entry) =>
			entry
				.setTitle(this.projectT('statusBar.countProject'))
				.setIcon('snowflake')
				.onClick(() => {
					void this.noticeWritingCount('project').catch((error: unknown) => {
						this.showError(error);
					});
				}),
		);
		menu.addItem((entry) =>
			entry
				.setTitle(this.projectT('statusBar.countManuscript'))
				.setIcon('scroll-text')
				.onClick(() => {
					void this.noticeWritingCount('manuscript').catch(
						(error: unknown) => {
							this.showError(error);
						},
					);
				}),
		);
		menu.showAtMouseEvent(event);
	}

	/** The project a count should speak about: the one in front, else recent. */
	private async writingCountProject(): Promise<ProjectSnapshot | null> {
		const stream = this.activeManuscriptView();
		if (stream !== null) {
			return this.resolveProject(stream.writingContext().projectPath);
		}
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (file != null) return this.projectOfPath(file.path);
		return this.resolveProject(null);
	}

	/**
	 * A sticky notice while a whole scope is read: the first count of a large
	 * project takes seconds, and a click that answers with nothing for that
	 * long reads as a click that did nothing.
	 */
	private async whileCounting<T>(work: () => Promise<T>): Promise<T> {
		const notice = new Notice(this.projectT('statusBar.counting'), 0);
		try {
			return await work();
		} finally {
			notice.hide();
		}
	}

	private async noticeWritingCount(scope: WritingCountScope): Promise<void> {
		const project = await this.writingCountProject();
		if (project === null) {
			new Notice(this.projectT('messages.noCurrentProject'));
			return;
		}
		new Notice(
			await this.whileCounting(() => this.writingCountLine(project, scope)),
		);
	}

	private async writingCountLine(
		project: ProjectSnapshot,
		scope: WritingCountScope,
	): Promise<string> {
		const counted = await this.projects.writingCount.countProject(
			project,
			scope,
			this.writingCountOptions(),
		);
		// A scope is read as a block: which scope, how many notes it came from,
		// and then the same five measures a note's own count shows. Notes that
		// would not read are named when there are any, because their writing is
		// missing from every number under them.
		return [
			this.projectT(
				scope === 'project'
					? 'statusBar.scopeProject'
					: 'statusBar.scopeManuscript',
			),
			this.projectT('statusBar.statNotes', {
				count: this.grouped(counted.notes),
			}),
			...(counted.unreadable === 0
				? []
				: [
						this.projectT('statusBar.statUnreadable', {
							count: this.grouped(counted.unreadable),
						}),
					]),
			this.writingCountBreakdown(counted),
		].join('\n');
	}

	/** The palette command: both totals of the context project in one notice. */
	private async countProjectWords(): Promise<void> {
		const project = await this.writingCountProject();
		if (project === null) {
			new Notice(this.projectT('messages.noCurrentProject'));
			return;
		}
		const [whole, manuscript] = await this.whileCounting(() =>
			Promise.all([
				this.writingCountLine(project, 'project'),
				this.writingCountLine(project, 'manuscript'),
			]),
		);
		new Notice(`${whole}\n${manuscript}`);
	}

	private registerManagedSectionEditor(): void {
		this.registerEditorExtension(
			createManagedSectionEditorExtension({
				isPotentiallyEnabled: (context) =>
					this.isPotentiallyManagedEditor(context),
				isEnabled: (context) =>
					this.isManagedEditorContext(context.content) ||
					this.isPotentiallyManagedEditor(context),
				isProtectionEnabled: () => this.settings.protectManagedBoundaries,
				isPluginWrite: (context) =>
					context.filePath !== null &&
					this.projects.repository.isWritingPath(context.filePath),
				getStrings: (context) => this.managedSectionEditorStrings(context),
				getSectionIds: (context) =>
					this.managedSectionIdsForEditor(context.content),
				onBoundaryBlocked: ({ context, generatedSectionIds, recordSectionIds }) => {
					new Notice(
						this.editorT(
							context.content,
							generatedSectionIds.length > 0
								? 'editor.managedSection.generatedNotice'
								: recordSectionIds.some((id) => TEMPLATE_SECTION_IDS.has(id))
									? 'editor.managedSection.templateNotice'
									: recordSectionIds.length > 0
										? 'editor.managedSection.recordNotice'
										: 'editor.managedSection.protectedNotice',
						),
					);
				},
			}),
		);
	}

	private isManagedEditorContext(content: string): boolean {
		try {
			return this.hasManagedSections(
				parseMarkdownFrontmatter(content).frontmatter,
			);
		} catch {
			return false;
		}
	}

	private isPotentiallyManagedEditor(
		context: ManagedSectionEditorIdentity,
	): boolean {
		const file = context.info?.file;
		if (file !== null && file !== undefined) {
			const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (cached !== undefined) return this.hasManagedSections(cached);
		}
		const header = context.state.sliceDoc(
			0,
			Math.min(context.state.doc.length, 16_384),
		);
		return this.isManagedEditorContext(header);
	}

	private hasManagedSections(frontmatter: Record<string, unknown>): boolean {
		const documentType = documentTypeOf(frontmatter);
		return (
			isDocumentType(documentType) &&
			projectIdOf(frontmatter) !== null &&
			managedSectionsForDocument(documentType).length > 0
		);
	}

	private managedSectionIdsForEditor(content: string): readonly string[] {
		try {
			const documentType = documentTypeOf(
				parseMarkdownFrontmatter(content).frontmatter,
			);
			return isDocumentType(documentType)
				? managedSectionsForDocument(documentType).map((section) => section.id)
				: [];
		} catch {
			return [];
		}
	}

	private managedSectionEditorStrings(
		context: ManagedSectionEditorContext,
	): ManagedSectionEditorStrings {
		const t = (key: string): string => this.editorT(context.content, key);
		return {
			emptyPlaceholder: t('editor.managedSection.placeholder'),
			protectedBoundary: t('editor.managedSection.boundaryTooltip'),
			unlockedBoundary: t(
				'editor.managedSection.unlockConfirmDescription',
			),
		};
	}

	private editorT(content: string, key: string): string {
		return translate(this.editorLocale(content), key);
	}

	private toggleManagedBoundaries(info: MarkdownFileInfo): void {
		const view = findEditorViewForMarkdownInfo(info);
		if (view === null || !this.isManagedEditorContext(view.state.doc.toString())) {
			return;
		}
		if (areManagedBoundariesUnlocked(view.state)) {
			setManagedBoundariesUnlocked(view, false);
			return;
		}
		const t: Translate = (key, vars) =>
			translate(
				this.editorLocale(view.state.doc.toString()),
				key,
				vars,
			);
		new ManagedBoundaryUnlockModal(this.app, t, () => {
			setManagedBoundariesUnlocked(view, true);
			if (isManagedSectionEditorLivePreview(view)) {
				new Notice(t('editor.managedSection.switchToSource'));
			}
		}).open();
	}

	private async toggleManagedBoundaryProtection(): Promise<void> {
		const enabled = !this.settings.protectManagedBoundaries;
		this.settings.protectManagedBoundaries = enabled;
		await this.saveSettings();
		await this.handleSettingsChanged('protectManagedBoundaries');
		new Notice(
			this.globalT(
				enabled
					? 'commands.boundaryProtectionEnabled'
					: 'commands.boundaryProtectionDisabled',
			),
		);
	}

	private async toggleReducedAnimations(): Promise<void> {
		const enabled = !this.settings.reduceMotion;
		this.settings.reduceMotion = enabled;
		await this.saveSettings();
		await this.handleSettingsChanged('reduceMotion');
		new Notice(
			this.globalT(
				enabled
					? 'commands.reducedAnimationsEnabled'
					: 'commands.reducedAnimationsDisabled',
			),
		);
	}

	/**
	 * The two dashboard settings an author changes while looking at what they
	 * govern: whether a row says how far along its note is, and whether a name
	 * typed into a field opens the new note's form. Both are on the settings
	 * page as well; from the palette they are one keystroke from the table or
	 * the form itself.
	 */
	private async toggleTableProgressStatus(): Promise<void> {
		const shown = !this.settings.showTableProgressStatus;
		this.settings.showTableProgressStatus = shown;
		await this.saveSettings();
		await this.handleSettingsChanged('showTableProgressStatus');
		new Notice(
			this.globalT(
				shown
					? 'commands.tableProgressStatusShown'
					: 'commands.tableProgressStatusHidden',
			),
		);
	}

	/**
	 * The derived cards come and go from the palette; the boards repaint on
	 * their own channel, since nothing but the board reads the setting.
	 */
	private async toggleDerivedTasks(): Promise<void> {
		const shown = !this.settings.showDerivedTasks;
		this.settings.showDerivedTasks = shown;
		await this.saveSettings();
		this.tasksChanged();
		new Notice(
			this.globalT(shown ? 'commands.derivedTasksShown' : 'commands.derivedTasksHidden'),
		);
	}

	private async toggleTableActionsColumn(): Promise<void> {
		const shown = !this.settings.showTableActionsColumn;
		this.settings.showTableActionsColumn = shown;
		await this.saveSettings();
		await this.handleSettingsChanged('showTableActionsColumn');
		new Notice(
			this.globalT(
				shown
					? 'commands.tableActionsColumnShown'
					: 'commands.tableActionsColumnHidden',
			),
		);
	}

	private async toggleFreeformMode(): Promise<void> {
		const enabled = !this.settings.freeformMode;
		this.settings.freeformMode = enabled;
		await this.saveSettings();
		await this.handleSettingsChanged('freeformMode');
		new Notice(
			this.globalT(
				enabled
					? 'commands.freeformModeEnabled'
					: 'commands.freeformModeDisabled',
			),
		);
	}

	private async toggleUntimedTracking(): Promise<void> {
		const enabled = !this.settings.sessionTrackUntimedWords;
		this.settings.sessionTrackUntimedWords = enabled;
		await this.saveSettings();
		await this.handleSettingsChanged('sessionTrackUntimedWords');
		new Notice(
			this.globalT(
				enabled
					? 'commands.untimedTrackingEnabled'
					: 'commands.untimedTrackingDisabled',
			),
		);
	}

	private async toggleCreateFromField(): Promise<void> {
		const opensForm = this.settings.createFromField !== 'form';
		this.settings.createFromField = opensForm ? 'form' : 'now';
		await this.saveSettings();
		await this.handleSettingsChanged('createFromField');
		new Notice(
			this.globalT(
				opensForm
					? 'commands.createFromFieldForm'
					: 'commands.createFromFieldNow',
			),
		);
	}

	private async toggleNotesBesideDashboard(): Promise<void> {
		const enabled = !this.settings.openLongTextInSplit;
		this.settings.openLongTextInSplit = enabled;
		await this.saveSettings();
		await this.handleSettingsChanged('openLongTextInSplit');
		new Notice(
			this.globalT(
				enabled
					? 'commands.notesBesideDashboardEnabled'
					: 'commands.notesBesideDashboardDisabled',
			),
		);
	}

	/**
	 * The two things a manuscript note's header can carry, each turned on and
	 * off from the palette as well as from the settings page. Both are things an
	 * author wants while checking a manuscript over and not while writing in it,
	 * which is a reason to reach them without leaving the page they are on.
	 */
	private async toggleManuscriptHeader(
		key: 'showManuscriptPath' | 'showManuscriptSequence',
	): Promise<void> {
		const shown = !this.settings[key];
		this.settings[key] = shown;
		await this.saveSettings();
		await this.handleSettingsChanged(key);
		const said =
			key === 'showManuscriptPath'
				? shown
					? 'commands.manuscriptPathShown'
					: 'commands.manuscriptPathHidden'
				: shown
					? 'commands.manuscriptSequenceShown'
					: 'commands.manuscriptSequenceHidden';
		new Notice(this.globalT(said));
	}

	private editorLocale(content: string): 'en' | 'zh-CN' {
		return resolveManagedSectionLocale({
			uiLocale: this.settings.uiLocale,
			obsidianLocale: moment.locale(),
			fallbackProjectLocale:
				this.currentProjectLocale ?? this.resolvedDefaultProjectLocale(),
			content,
			projectLocalesById: this.projectLocalesById,
		});
	}

	/**
	 * Opens the manuscript of a project, reusing the stream already showing it
	 * rather than stacking another tab of the same book.
	 */
	async openManuscriptStream(
		projectPath: string,
		anchorPath: string | null = null,
	): Promise<void> {
		const open = this.app.workspace
			.getLeavesOfType(MANUSCRIPT_VIEW_TYPE)
			.find((leaf) => leaf.getViewState().state?.projectPath === projectPath);
		// A caller that names a note means that note. One that does not — the
		// ribbon, or a right-click on something in the project that is not part of
		// the manuscript — means the manuscript, and nowhere in particular.
		//
		// A stream being opened has to start somewhere, and where the author was
		// last writing is the best guess available. A stream already on screen is
		// already somewhere, and that somewhere is where the author left it: the
		// guess is then not an answer to anything, and acting on it carries them
		// off to a chapter they did not ask for.
		const anchor =
			anchorPath ??
			(open === undefined ? this.rememberedManuscriptNote(projectPath) : null);
		const leaf = open ?? this.manuscriptLeaf();
		if (open === undefined) {
			await leaf.setViewState({
				type: MANUSCRIPT_VIEW_TYPE,
				active: true,
				state: { projectPath, anchorPath: anchor },
			});
		}
		await leaf.loadIfDeferred();
		// The jump measures the stream's layout, so show a reused tab before
		// scrolling: a hidden tab reports zero offsets and loses the move.
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		await this.app.workspace.revealLeaf(leaf);
		// A stream already on screen is never handed a new view state, so the note
		// that was asked for has to be given to it directly. Without this, opening
		// the manuscript at a note only ever worked the first time.
		if (
			open !== undefined &&
			anchor !== null &&
			leaf.view instanceof SnowflakeManuscriptView
		) {
			await leaf.view.revealSegment(anchor);
		}
	}

	private corkboardPreferences(projectId: string): Partial<CorkboardPreferences> {
		return readCorkboardPreferences(
			this.app.loadLocalStorage(`${CORKBOARD_PREFERENCES_KEY}:${projectId}`) as unknown,
		);
	}

	private rememberCorkboardPreferences(projectId: string, changes: Partial<CorkboardPreferences>): void {
		const saved = this.corkboardPreferences(projectId);
		const next: CorkboardPreferences = {
			mode: 'standard',
			reversed: false,
			...saved,
			...readCorkboardPreferences(changes),
		};
		if (next.mode === saved.mode && next.reversed === saved.reversed) return;
		this.app.saveLocalStorage(`${CORKBOARD_PREFERENCES_KEY}:${projectId}`, next);
	}

	async openStoryStructure(
		visualization?: StoryStructureVisualization,
		options: { newTab?: boolean; projectPath?: string | null } = {},
	): Promise<void> {
		const projectPath = options.projectPath === undefined
			? this.settings.recentProjectPath
			: options.projectPath;
		const candidates =
			options.newTab === true
				? []
				: this.app.workspace
						.getLeavesOfType(STORY_STRUCTURE_VIEW_TYPE)
						.filter((leaf) => leaf.getRoot() === this.app.workspace.rootSplit);
		// A pre-project-state workspace may still be deferred on upgrade. Give
		// it an owner before loading it, preserving its visualization settings.
		const existing = candidates.find((leaf) => leaf.getViewState().state?.projectPath === projectPath) ??
			candidates.find((leaf) => leaf.getViewState().state?.projectPath === undefined);
		const leaf = existing ?? this.app.workspace.getLeaf('tab');
		const saved = existing?.getViewState();
		if (saved === undefined || saved.state?.projectPath === undefined) {
			await leaf.setViewState({
				...saved,
				type: STORY_STRUCTURE_VIEW_TYPE,
				active: true,
				state: {
					...saved?.state,
					projectPath,
					visualization: visualization ?? saved?.state?.visualization ?? DEFAULT_STORY_STRUCTURE_VISUALIZATION,
				},
			});
		}
		await leaf.loadIfDeferred();
		if (
			existing !== undefined &&
			visualization !== undefined &&
			leaf.view instanceof SnowflakeStoryStructureView
		) {
			leaf.view.showVisualization(visualization);
		}
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/** The note this project was last written in, when it is still there. */
	private rememberedManuscriptNote(projectPath: string): string | null {
		const projectId = this.projectIdOfPath(projectPath);
		return projectId === null ? null : this.lastManuscriptNote(projectId)?.path ?? null;
	}

	/**
	 * Where a manuscript goes: the pane long-form notes already open in, beside
	 * the dashboard rather than on top of it.
	 *
	 * A manuscript is the longest-form note a project has, so it belongs in the
	 * companion pane with the rest and not in a column of its own. The routing
	 * that decides which pane that is is the same one notes use; only finding a
	 * stream that is already open is handled by the caller, because a stream is
	 * not a file and has no path for the router to match on.
	 */
	private manuscriptLeaf(): WorkspaceLeaf {
		const route = routeNotePane<WorkspaceLeaf, NotePane>({
			// Nothing to match: the open case never reaches here.
			targetPath: '',
			targetProjectId: null,
			dashboardViewType: DASHBOARD_VIEW_TYPE,
			leaves: this.workspaceLeafSnapshots(),
			notePane: this.notePane,
			activeLeaf: this.app.workspace.getMostRecentLeaf(
				this.app.workspace.rootSplit,
			),
			preferSplit: this.settings.openLongTextInSplit,
			canSplit: this.canSplitWorkspace(),
		});
		switch (route.kind) {
			case 'pane': {
				// A new tab opens next to the active leaf, so aim at the pane first.
				this.app.workspace.setActiveLeaf(route.anchor, { focus: false });
				return this.claimNotePane(this.app.workspace.getLeaf('tab'));
			}
			case 'split':
				return this.claimNotePane(
					this.app.workspace.createLeafBySplit(route.source, 'vertical'),
				);
			case 'reveal':
			case 'tab':
				return this.app.workspace.getLeaf('tab');
		}
	}

	private claimNotePane(leaf: WorkspaceLeaf): WorkspaceLeaf {
		this.notePane = leaf.parent;
		return leaf;
	}

	private activeManuscriptView(): SnowflakeManuscriptView | null {
		return this.app.workspace.getActiveViewOfType(SnowflakeManuscriptView);
	}

	/**
	 * The manuscript of the project in hand. Anchored on the note in front of
	 * the author when that note is part of it, so a stream opened from a chapter
	 * opens at that chapter rather than at the front of the book.
	 */
	private async openCurrentManuscript(): Promise<void> {
		const project = await this.resolveProject(null);
		if (project === null) {
			new Notice(this.projectT('messages.noCurrentProject'));
			return;
		}
		const active = this.app.workspace.getActiveFile();
		const segments = await this.projects.manuscript.listSegments(project);
		const anchor =
			segments.find((segment) => segment.path === active?.path)?.path ?? null;
		await this.openManuscriptStream(project.projectFile, anchor);
	}

	/**
	 * The manuscript note this project was last worked in, when it is still
	 * there. Answered from the file rather than from the manuscript, so the
	 * dashboard does not read a whole novel to draw one line.
	 */
	private lastManuscriptNote(
		projectId: string,
	): { path: string; title: string } | null {
		const path = this.settings.recentManuscriptNotes[projectId];
		if (path === undefined) return null;
		const file = this.app.vault.getFileByPath(path);
		return file === null ? null : { path, title: file.basename };
	}

	rememberManuscriptNote(projectId: string, path: string): void {
		if (this.settings.recentManuscriptNotes[projectId] === path) return;
		this.settings.recentManuscriptNotes = {
			...this.settings.recentManuscriptNotes,
			[projectId]: path,
		};
		void this.saveSettings();
		// Step 10 offers this note as the way back in, so it has to be the note
		// the author is actually in rather than the one they were in when the
		// dashboard last happened to be redrawn.
		this.scheduleRefresh();
	}

	/**
	 * Joins a note with the one after it, once the author has said so. With
	 * numbering on and the note going numbered, the dialog also asks whether
	 * the numbered notes after it close the gap -- the mirror of the move up
	 * an inserted note asks for -- and those renames are settled before
	 * anything is joined, so a name that cannot be taken refuses the whole
	 * merge with nothing done. Resolves false when the author declined, or
	 * there was nothing after the note to join.
	 */
	async mergeManuscriptSegments(
		projectPath: string,
		path: string,
		onAgreed?: SegmentNamed,
	): Promise<boolean> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return false;
		const t = (key: string, vars?: Record<string, string | number>): string =>
			this.translateForProject(project.locale, key, vars);
		// Read from the notes as they stand on disk, as the naming form reads
		// them, so the pair and the notes after them are the ones the merge
		// will find.
		const segments = await this.projects.manuscript.listSegmentsFromFiles(project);
		const target = normalizePath(path);
		const at = segments.findIndex((segment) => segment.path === target);
		const kept = segments[at];
		const removed = segments[at + 1];
		if (kept === undefined || removed === undefined) return false;
		const proposal = this.chapterRemovalProposal(segments, at + 1);
		const choice = await confirmSegmentMerge(this.app, t, {
			kept: kept.title,
			removed: removed.title,
			followers: proposal?.followers.length ?? 0,
		});
		if (choice === null) return false;
		await onAgreed?.();
		const renames =
			choice.renumber && proposal !== null ? this.followerRenames(proposal) : [];
		let merged: { renumbered: SegmentRenameOutcome };
		try {
			merged = await this.projects.mergeManuscriptSegments(
				projectPath,
				path,
				renames,
			);
		} catch (error) {
			throw this.renumberError(error, t);
		}
		this.followMergedNote(projectPath, path);
		this.noticeRenumbered(merged.renumbered, t);
		return true;
	}

	/**
	 * Moves the note step 10 offers as the way back in onto the note that
	 * absorbed it.
	 *
	 * "You were last writing in" is answered from the file, so a note that has
	 * been merged away answers nothing at all: the line goes, and it takes the
	 * way back into the manuscript with it. The words have not gone anywhere
	 * though — they are in the note they were joined to, and that is the note to
	 * offer. `mergeManuscriptSegments` repoints the project's own draft link for
	 * the same reason; this is the same repair on the one pointer that lives in
	 * settings rather than in frontmatter.
	 */
	private followMergedNote(projectPath: string, kept: string): void {
		const projectId = this.projectIdOfPath(projectPath);
		if (projectId === null) return;
		const offered = this.settings.recentManuscriptNotes[projectId];
		// Only when the note that went is the note being offered. Any other note
		// still on disk is still where the author was last writing.
		if (offered === undefined) return;
		if (this.app.vault.getFileByPath(offered) !== null) return;
		this.rememberManuscriptNote(projectId, kept);
	}

	manuscriptWindowSettings(): ManuscriptWindowSettings {
		return {
			before: this.settings.manuscriptWindow,
			after: this.settings.manuscriptWindow,
			showPath: this.settings.showManuscriptPath,
			showSequence: this.settings.showManuscriptSequence,
			typewriter: this.settings.manuscriptTypewriter,
			focusLevel: this.settings.manuscriptFocusLevel,
			autoPairBrackets: this.settings.manuscriptAutoPairBrackets,
			autoPairMarkdown: this.settings.manuscriptAutoPairMarkdown,
			enterParagraph: this.settings.manuscriptEnterParagraph,
			recentFonts: this.settings.manuscriptRecentFonts,
			presentation: this.manuscriptPresentation(),
			mentionHighlight: this.settings.manuscriptMentionHighlight,
			sensitiveHighlight: this.settings.sensitiveHighlight,
			customHighlights: this.settings.customHighlightsEnabled,
			milestones: {
				enabled: this.settings.manuscriptMilestones,
				mode: this.settings.manuscriptMilestoneMode,
				interval: this.settings.manuscriptMilestoneInterval,
				count: this.writingCountOptions(),
			},
		};
	}

	/** How the manuscript page is dressed, from the settings that dress it. */
	manuscriptPresentation(): ManuscriptPresentation {
		return {
			fontFamily: this.settings.manuscriptFontFamily,
			fontSize: this.settings.manuscriptFontSize,
			lineHeight: this.settings.manuscriptLineHeight,
			contentWidth: this.settings.manuscriptContentWidth,
			paragraphSpacing: this.settings.manuscriptParagraphSpacing,
			firstLineIndent: this.settings.manuscriptFirstLineIndent,
			textAlign: this.settings.manuscriptTextAlign,
			hyphenation: this.settings.manuscriptHyphenation,
			tintLight: this.settings.manuscriptTintLight,
			tintDark: this.settings.manuscriptTintDark,
			guide: this.settings.manuscriptGuide,
		};
	}

	/**
	 * The page's dress, changed from a stream's own popover: each value held
	 * to its range exactly as the settings page holds it, saved once, and
	 * announced key by key so every open stream hears of it.
	 */
	async setManuscriptPresentation(
		patch: Partial<ManuscriptPresentation>,
	): Promise<void> {
		const changed: string[] = [];
		const keep = <K extends keyof SnowflakeSettings>(
			key: K,
			value: SnowflakeSettings[K],
		): void => {
			if (this.settings[key] === value) return;
			this.settings[key] = value;
			changed.push(key);
		};
		if (patch.fontFamily !== undefined) {
			keep('manuscriptFontFamily', sanitizeFontFamily(patch.fontFamily));
			// The face goes to the top of the picker's list, which is a note of
			// what was used rather than a change of dress: saved with the rest,
			// announced to nobody.
			this.settings.manuscriptRecentFonts = rememberFontFamily(
				this.settings.manuscriptRecentFonts,
				this.settings.manuscriptFontFamily,
			);
		}
		if (patch.fontSize !== undefined) {
			keep('manuscriptFontSize', sanitizeFontSize(patch.fontSize));
		}
		if (patch.lineHeight !== undefined) {
			keep('manuscriptLineHeight', sanitizeLineHeight(patch.lineHeight));
		}
		if (patch.contentWidth !== undefined) {
			keep('manuscriptContentWidth', sanitizeContentWidth(patch.contentWidth));
		}
		if (patch.paragraphSpacing !== undefined) {
			keep(
				'manuscriptParagraphSpacing',
				sanitizeParagraphSpacing(patch.paragraphSpacing),
			);
		}
		if (patch.firstLineIndent !== undefined) {
			keep(
				'manuscriptFirstLineIndent',
				sanitizeFirstLineIndent(patch.firstLineIndent),
			);
		}
		if (patch.textAlign !== undefined) {
			keep('manuscriptTextAlign', sanitizeTextAlign(patch.textAlign));
		}
		if (patch.hyphenation !== undefined) {
			keep('manuscriptHyphenation', sanitizeHyphenation(patch.hyphenation));
		}
		if (patch.tintLight !== undefined) {
			keep('manuscriptTintLight', sanitizeTint(patch.tintLight));
		}
		if (patch.tintDark !== undefined) {
			keep('manuscriptTintDark', sanitizeTint(patch.tintDark));
		}
		if (patch.guide !== undefined) keep('manuscriptGuide', sanitizeGuide(patch.guide));
		if (changed.length === 0) {
			// Only the recent-font list moved, which nothing on the page shows.
			if (patch.fontFamily === undefined) return;
			this.saveSettingsSoon();
			return;
		}
		// The page first: it reads the settings in memory, and putting the write
		// ahead of it made every stop of a drag wait on the disk.
		for (const key of changed) await this.handleSettingsChanged(key);
		this.saveSettingsSoon();
	}

	async setManuscriptEnterParagraph(on: boolean): Promise<void> {
		if (this.settings.manuscriptEnterParagraph === on) return;
		this.settings.manuscriptEnterParagraph = on;
		await this.saveSettings();
		await this.handleSettingsChanged('manuscriptEnterParagraph');
	}

	async setManuscriptMentionHighlight(
		mode: MentionHighlightMode,
	): Promise<void> {
		if (this.settings.manuscriptMentionHighlight === mode) return;
		this.settings.manuscriptMentionHighlight = mode;
		await this.saveSettings();
		await this.handleSettingsChanged('manuscriptMentionHighlight');
	}

	async mentionIgnores(
		projectPath: string | null,
	): Promise<readonly MentionIgnore[]> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return [];
		return this.projects.mentionStore.readIgnores(project);
	}

	async addMentionIgnore(
		projectPath: string | null,
		rule: MentionIgnore,
	): Promise<void> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return;
		await this.projects.mentionStore.addIgnore(project, rule);
		this.applyManuscriptMentionMode();
	}

	async removeMentionIgnore(
		projectPath: string | null,
		rule: MentionIgnore,
	): Promise<void> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return;
		await this.projects.mentionStore.removeIgnore(project, rule);
		this.applyManuscriptMentionMode();
	}

	async manuscriptRevisions(
		projectPath: string | null,
	): Promise<readonly Revision[]> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return [];
		return this.projects.revisions.list(project);
	}

	async manuscriptForeshadowings(
		projectPath: string | null,
	): Promise<readonly Foreshadowing[]> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return [];
		return this.projects.foreshadowing.list(project);
	}

	/** The export as the settings describe it, the folder resolved. */
	private exportOptions(): ManuscriptExportOptions {
		return {
			folder:
				this.settings.exportFolder.length === 0
					? projectExportRoot(this.settings.projectRoot)
					: this.settings.exportFolder,
			format: this.settings.exportFormat,
			indent: this.settings.exportIndent,
			paragraphSpacing: this.settings.exportParagraphSpacing,
			layout: this.settings.exportManuscriptLayout,
			separator: this.settings.exportChapterSeparator,
		};
	}

	async exportManuscript(projectPath: string | null): Promise<void> {
		await this.runExport(projectPath, { kind: 'manuscript' });
	}

	async exportManuscriptSegment(
		projectPath: string | null,
		path: string,
	): Promise<void> {
		await this.runExport(projectPath, { kind: 'segment', path });
	}

	async manuscriptSegmentPlainText(
		projectPath: string | null,
		path: string,
	): Promise<string | null> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return null;
		return this.projects.exporter.segmentText(project, path, this.exportOptions());
	}

	/**
	 * Plans, asks once about the files that already stand, writes, and says
	 * where. A folder inside the project is refused before anything is
	 * planned, because a file written there would read as a note.
	 */
	private async runExport(
		projectPath: string | null,
		scope: ManuscriptExportScope,
	): Promise<void> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return;
		const t = (key: string, vars?: Record<string, string | number>): string =>
			this.translateForProject(project.locale, key, vars);
		let plan: ManuscriptExportPlan;
		try {
			plan = await this.projects.exporter.plan(project, scope, this.exportOptions());
		} catch (error) {
			if (error instanceof ExportIntoManuscriptError) {
				new Notice(t('errors.exportIntoManuscript', { path: error.path }));
				return;
			}
			throw error;
		}
		if (plan.targets.length === 0) {
			new Notice(t('messages.exportNothing'));
			return;
		}
		const standing = plan.targets.filter((target) => target.exists);
		if (standing.length > 0) {
			const agreed = await confirmExportReplace(
				this.app,
				t,
				standing.map((target) => target.path),
			);
			if (!agreed) return;
		}
		const written = await this.projects.exporter.write(plan);
		const first = written[0] ?? '';
		new Notice(
			written.length === 1
				? t('messages.exported', { path: first })
				: t('messages.exportedMany', {
						count: written.length,
						folder: first.slice(0, Math.max(0, first.lastIndexOf('/'))),
					}),
		);
	}

	async manuscriptSegmentTotals(
		projectPath: string | null,
	): Promise<ReadonlyMap<string, number>> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return new Map();
		const win = this.app.workspace.containerEl.win;
		return this.projects.writingCount.countManuscriptTotals(
			project,
			this.writingCountOptions(),
			() =>
				new Promise((resolve) => {
					win.setTimeout(resolve, 0);
				}),
		);
	}

	/**
	 * The gate every revision mutation passes. A project that will not resolve
	 * -- its folder renamed or gone while a stream still stands open on it --
	 * and a project the plugin may not write to both answer null here, so a
	 * mutation refuses rather than quietly doing nothing: the card in the
	 * margin and the row in the table each decide what to show on what they
	 * are told back.
	 */
	private async writableProject(
		projectPath: string | null,
	): Promise<ProjectSnapshot | null> {
		const project = await this.resolveProject(projectPath);
		if (project === null || project.readOnly) return null;
		return project;
	}

	/**
	 * One mutation of a margin record -- a revision or a foreshadowing --
	 * through the gate and out to every view: `work` says what changed, and
	 * only a change is announced. Null from the gate is a refusal, answered
	 * as false without touching the store.
	 */
	private async mutateMarginRecords<T>(
		projectPath: string | null,
		work: (project: ProjectSnapshot) => Promise<{ result: T; changed: boolean }>,
		refused: T,
	): Promise<T> {
		const project = await this.writableProject(projectPath);
		if (project === null) return refused;
		const { result, changed } = await work(project);
		if (changed) await this.announceMarginRecordsChanged();
		return result;
	}

	/**
	 * One sticky-note mutation through the writable gate and out to every
	 * surface. Null from the gate is a refusal, answered as false without
	 * touching the file; the surfaces decide what to show on what they are
	 * told back.
	 */
	private async mutateStickyNote(
		projectPath: string | null,
		work: (project: ProjectSnapshot) => Promise<void>,
	): Promise<boolean> {
		const project = await this.writableProject(projectPath);
		if (project === null) return false;
		await work(project);
		this.stickyNoteHub.notify();
		return true;
	}

	private async createStickyNote(
		projectPath: string | null,
		color: StickyNoteColor = DEFAULT_STICKY_NOTE_COLOR,
	): Promise<StickyNoteRecord | null> {
		const project = await this.writableProject(projectPath);
		if (project === null) return null;
		const note = await this.projects.stickyNotes.create(project, color);
		this.stickyNoteHub.notify();
		return note;
	}

	/**
	 * A sticky note's body, written under the revision its editor holds. A
	 * file that moved on meanwhile says so in the author's own words rather
	 * than the repository's, as the manuscript's save does; a file that is
	 * not there says so in the editor's own terms, and the editor keeps the
	 * text for the note's return under another name.
	 */
	private async writeStickyNoteBody(
		path: string,
		body: string,
		expectedRevision: string,
	): Promise<StickyNoteRecord> {
		try {
			return await this.projects.stickyNotes.writeBody(path, body, expectedRevision);
		} catch (error) {
			if (error instanceof ManagedFileNotFoundError) {
				throw new StickyNoteGone(error.message);
			}
			if (error instanceof ConcurrentChangeError) {
				throw new StickyNoteSaveConflict(
					this.translateForProject(
						this.projectLocaleOfPath(path),
						'errors.concurrentChange',
					),
				);
			}
			throw error;
		}
	}

	/** The palette and the ribbon: a new note, floating in the author's window, ready to type into. */
	private async createStickyNoteAndFloat(): Promise<void> {
		const project = await this.resolveProject(this.settings.recentProjectPath);
		if (project === null) {
			new Notice(this.projectT('messages.noCurrentProject'));
			return;
		}
		if (project.readOnly) {
			new Notice(this.projectT('errors.readOnly'));
			return;
		}
		const note = await this.createStickyNote(project.projectFile);
		if (note === null) {
			new Notice(this.projectT('stickyNotes.refused'));
			return;
		}
		await this.floatStickyNote(
			note.id,
			this.app.workspace.containerEl.win.activeWindow,
			{ mode: 'editing', focus: true },
		);
	}

	/** The layer of one window, made the first time that window floats a note. */
	private stickyLayerFor(win: Window): StickyNoteFloatLayer {
		const doc = win.document;
		let layer = this.stickyLayers.get(doc);
		if (layer === undefined) {
			layer = new StickyNoteFloatLayer(doc, {
				app: this.app,
				plugin: this,
				bridge: this.stickyNotes(),
				locale: () => this.currentLocale(),
				// The main window keeps the device's memory of the panels; a
				// popout's panels last the popout's own life.
				remembers: doc === this.app.workspace.containerEl.doc,
			});
			this.stickyLayers.set(doc, layer);
		}
		return layer;
	}

	private async floatStickyNote(
		id: string,
		win: Window,
		options: StickyNoteFloatOptions = {},
	): Promise<void> {
		const project = await this.resolveProject(null);
		if (project === null) return;
		const note = (await this.projects.stickyNotes.list(project)).find(
			(candidate) => candidate.id === id,
		);
		if (note === undefined || note.archived) return;
		this.stickyLayerFor(win).open(
			note,
			{ path: project.projectFile, readOnly: project.readOnly },
			options,
		);
	}

	private isStickyNoteFloating(id: string, win: Window): boolean {
		return this.stickyLayers.get(win.document)?.has(id) ?? false;
	}

	private closeStickyFloats(id: string): void {
		for (const layer of this.stickyLayers.values()) layer.close(id);
	}

	/**
	 * Every window's floating notes brought level with the current project:
	 * at layout-ready, and whenever the project moves. The main window's
	 * layer is made here if nothing has made it yet, so notes remembered
	 * open come back at the next start without a first float.
	 */
	private async reconcileStickyFloats(): Promise<void> {
		const recent = this.settings.recentProjectPath;
		this.stickyFloatsProject = recent;
		// Nothing standing and nothing remembered open: nothing to put away
		// and nothing to bring back, so the project is not loaded for it.
		const standing = [...this.stickyLayers.values()].some((layer) => layer.hasAny());
		if (!standing && !this.stickyNoteHub.anyOpen()) {
			this.stickyLayerFor(this.app.workspace.containerEl.win);
			return;
		}
		const project = await this.resolveProject(null);
		const notes = project === null ? [] : await this.projects.stickyNotes.list(project);
		// The project moved again while this was reading: the run that
		// follows speaks for it, and this one must not put its panels away.
		if (this.settings.recentProjectPath !== recent) return;
		const target =
			project === null
				? null
				: { path: project.projectFile, readOnly: project.readOnly };
		this.stickyLayerFor(this.app.workspace.containerEl.win);
		for (const layer of this.stickyLayers.values()) {
			layer.reconcile(target, notes);
		}
	}

	/**
	 * A note the main window remembers floating, standing in the current
	 * project and not floating now, comes back: its frontmatter mended, or
	 * the note found again under another name. Asked cheaply first, from
	 * the scan's own record of the project and the notes' memoised reads,
	 * so the common bell -- a save in a note already standing -- loads nothing.
	 */
	private async restoreStickyFloats(): Promise<void> {
		const recent = this.settings.recentProjectPath;
		if (recent === null) return;
		const ref = this.projectRefAtPath(recent);
		if (ref === null) return;
		const layer = this.stickyLayers.get(this.app.workspace.containerEl.doc);
		const notes = await this.projects.stickyNotes.list(ref);
		const waiting = notes.some(
			(note) =>
				!note.archived &&
				!(layer?.has(note.id) ?? false) &&
				this.stickyNoteHub.floatState(note.id)?.open === true,
		);
		if (waiting) await this.reconcileStickyFloats();
	}

	/**
	 * A sticky file changed in the vault: every surface reads again once the
	 * burst has settled. The main window's clock, so a popout closing can
	 * never take the bell with it.
	 */
	private scheduleStickyNoteNotify(): void {
		const workspaceWindow = this.app.workspace.containerEl.win;
		if (this.stickyNoteNotifyTimer !== null) {
			workspaceWindow.clearTimeout(this.stickyNoteNotifyTimer);
		}
		this.stickyNoteNotifyTimer = workspaceWindow.setTimeout(() => {
			this.stickyNoteNotifyTimer = null;
			this.stickyNoteHub.notify();
			this.reconcileDashboardHealth();
			void this.restoreStickyFloats().catch((error: unknown) => {
				this.showError(error);
			});
		}, REFRESH_DELAY_MS);
	}

	/**
	 * The task file changed in the vault: the board reads again once the
	 * burst has settled, on the main window's clock like the sticky bell.
	 * The folder appears with the first task, so the health verdict is
	 * re-read as well.
	 */
	private scheduleTaskNotify(): void {
		const workspaceWindow = this.app.workspace.containerEl.win;
		if (this.taskNotifyTimer !== null) {
			workspaceWindow.clearTimeout(this.taskNotifyTimer);
		}
		this.taskNotifyTimer = workspaceWindow.setTimeout(() => {
			this.taskNotifyTimer = null;
			this.tasksChanged();
			this.reconcileDashboardHealth();
		}, REFRESH_DELAY_MS);
	}

	/** The tasks changed somewhere; every board reads again. A listener's failure is its own. */
	private tasksChanged(): void {
		for (const listener of [...this.taskListeners]) {
			try {
				listener();
			} catch (error) {
				console.error('Snowflake: a task board failed to refresh', error);
			}
		}
	}

	/**
	 * The shield in a dashboard's rail is painted from its model, and a sticky
	 * file is the one kind whose changes reach the dashboards without a
	 * refresh. Each shown dashboard re-reads its verdict instead and redraws
	 * only when the verdict moved; a hidden one owes the refresh at reveal,
	 * as it does for every other change.
	 */
	private reconcileDashboardHealth(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			DASHBOARD_VIEW_TYPE,
		)) {
			if (!(leaf.view instanceof SnowflakeDashboardView)) continue;
			if (!leaf.view.containerEl.isShown()) {
				leaf.view.queueRefreshWhenShown();
				continue;
			}
			void leaf.view.reconcileHealth().catch((error: unknown) => {
				this.showError(error);
			});
		}
	}

	createRevision(
		projectPath: string | null,
		revision: Revision,
	): Promise<boolean> {
		return this.mutateMarginRecords(
			projectPath,
			async (project) => {
				const took = await this.projects.revisions.create(project, revision);
				return { result: took, changed: took };
			},
			false,
		);
	}

	updateRevision(
		projectPath: string | null,
		id: string,
		patch: { proposed: string; comment: string },
	): Promise<boolean> {
		return this.mutateMarginRecords(
			projectPath,
			async (project) => {
				const took = await this.projects.revisions.update(project, id, patch);
				return { result: took, changed: took };
			},
			false,
		);
	}

	discardRevision(projectPath: string | null, id: string): Promise<boolean> {
		// Answered on whether the record is gone, not on whether this call is
		// what took it out. A card asking to be rid of a revision another view
		// discarded a moment earlier has got exactly what it asked for, and
		// only a refusal -- the gate answering null, or the store declining
		// to write over a file from a newer build -- is news worth telling an
		// author who has just had their text changed for them.
		return this.mutateMarginRecords(
			projectPath,
			async (project) => {
				const outcome = await this.projects.revisions.remove(project, id);
				return { result: outcome !== 'refused', changed: outcome === 'removed' };
			},
			false,
		);
	}

	mintRevisionId(): string {
		return createStableId('revision');
	}

	createForeshadowing(
		projectPath: string | null,
		item: Foreshadowing,
	): Promise<boolean> {
		return this.mutateMarginRecords(
			projectPath,
			async (project) => {
				const took = await this.projects.foreshadowing.create(project, item);
				return { result: took, changed: took };
			},
			false,
		);
	}

	editForeshadowing(
		projectPath: string | null,
		id: string,
		next: ForeshadowingEdit,
	): Promise<boolean> {
		return this.mutateMarginRecords(
			projectPath,
			async (project) => {
				const outcome = await this.projects.foreshadowing.edit(
					project,
					id,
					next,
				);
				return { result: outcome === 'written', changed: outcome === 'written' };
			},
			false,
		);
	}

	deleteForeshadowing(projectPath: string | null, id: string): Promise<boolean> {
		// Answered on whether the thread is gone, as `discardRevision` is.
		return this.mutateMarginRecords(
			projectPath,
			async (project) => {
				const outcome = await this.projects.foreshadowing.deleteItem(
					project,
					id,
				);
				return { result: outcome !== 'refused', changed: outcome === 'deleted' };
			},
			false,
		);
	}

	addForeshadowingOccurrence(
		projectPath: string | null,
		id: string,
		occurrence: ForeshadowingOccurrence,
	): Promise<boolean> {
		return this.mutateMarginRecords(
			projectPath,
			async (project) => {
				const outcome = await this.projects.foreshadowing.addOccurrence(
					project,
					id,
					occurrence,
				);
				return { result: outcome === 'written', changed: outcome === 'written' };
			},
			false,
		);
	}

	updateForeshadowingOccurrence(
		projectPath: string | null,
		id: string,
		occurrenceId: string,
		patch: { role: OccurrenceRole; note: string },
	): Promise<boolean> {
		return this.mutateMarginRecords(
			projectPath,
			async (project) => {
				const outcome = await this.projects.foreshadowing.updateOccurrence(
					project,
					id,
					occurrenceId,
					patch,
				);
				return { result: outcome === 'written', changed: outcome === 'written' };
			},
			false,
		);
	}

	deleteForeshadowingOccurrence(
		projectPath: string | null,
		id: string,
		occurrenceId: string,
	): Promise<boolean> {
		return this.mutateMarginRecords(
			projectPath,
			async (project) => {
				const outcome = await this.projects.foreshadowing.deleteOccurrence(
					project,
					id,
					occurrenceId,
				);
				return { result: outcome !== 'refused', changed: outcome === 'deleted' };
			},
			false,
		);
	}

	relinkForeshadowingOccurrence(
		projectPath: string | null,
		id: string,
		occurrenceId: string,
		placement: OccurrencePlacement,
	): Promise<boolean> {
		return this.mutateMarginRecords(
			projectPath,
			async (project) => {
				const outcome = await this.projects.foreshadowing.relinkOccurrence(
					project,
					id,
					occurrenceId,
					placement,
				);
				return { result: outcome === 'written', changed: outcome === 'written' };
			},
			false,
		);
	}

	mintForeshadowingId(): string {
		return createStableId('foreshadowing');
	}

	mintOccurrenceId(): string {
		return createStableId('occurrence');
	}

	/**
	 * Brings one note's stored revision offsets level with the body that
	 * just reached the file. The project is the scan's own record of it --
	 * pure string work over a handful of roots -- rather than a load: this
	 * runs behind every save, and a load whose digest the save itself just
	 * changed would rebuild the whole snapshot each time, for projects that
	 * have never made a revision. `projectOfPath`'s fallback to the project
	 * last opened is not used here either: a save under no known root must
	 * touch no other project's file.
	 */
	private async levelMarginRecords(path: string, body: string): Promise<void> {
		const project = this.projectRefAtPath(path);
		if (project === null) return;
		// Every file at once, and one announce for whatever moved: each
		// announce re-dresses every stream and rebuilds every dashboard.
		const moved = await Promise.all(
			this.projects.marginRecords.map((store) =>
				store.refreshAnchorsOnSave(project, path, body),
			),
		);
		if (moved.some(Boolean)) await this.announceMarginRecordsChanged();
	}

	/**
	 * Streams re-dress and dashboards re-read after any mutation of the
	 * records kept beside the manuscript -- a revision or a foreshadowing.
	 * The streams are dressed here, once: a dashboard refresh would reload
	 * every stream's manuscript and dress it a second time on the way, for a
	 * change that touched no note.
	 */
	private async announceMarginRecordsChanged(): Promise<void> {
		this.applyManuscriptMentionMode();
		await this.refreshDashboards({ streams: false });
	}

	/**
	 * The matcher for one project's roster: the same names and aliases the
	 * wikilink popup offers, so what highlights is exactly what completes.
	 */
	async manuscriptEntityMatcher(
		projectPath: string | null,
	): Promise<EntityMatcher | null> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return null;
		const kept = this.entityMatcherMemo.get(project);
		if (kept !== undefined) return kept;
		const targets = await this.listWikilinkTargets(projectPath);
		const matcher = this.projects.mentions.matcherFor(targets);
		this.entityMatcherMemo.set(project, matcher);
		return matcher;
	}

	/**
	 * The dress-only matchers, read straight from settings and memoized
	 * behind their own fingerprints: the sensitive list through the analysis
	 * service's slot, the highlight rules through one here. A disabled
	 * feature hands back its empty shape, which matches nothing for free.
	 */
	manuscriptDressFeeds(): {
		sensitive: SensitiveMatcher;
		highlights: CompiledHighlightRules;
		dialogue: {
			styles: readonly DialogueStyle[];
			presentation: DialoguePresentation;
		};
	} {
		const terms = this.settings.sensitiveHighlight
			? parseSensitiveWords(this.settings.sensitiveWords)
			: [];
		const rules = this.settings.customHighlightsEnabled
			? this.settings.customHighlightRules
			: [];
		const print = highlightRulesFingerprint(rules);
		if (
			this.highlightRuleSet === null ||
			this.highlightRuleSet.fingerprint !== print
		) {
			this.highlightRuleSet = compileCustomHighlightRules(rules);
		}
		return {
			sensitive: this.projects.analysis.sensitiveMatcherFor(terms),
			highlights: this.highlightRuleSet,
			dialogue: {
				styles: this.dialogueStylesFromSettings(),
				presentation: this.settings.dialoguePresentation,
			},
		};
	}

	/** Turns the sensitive-word marks, stored like the other dress choices. */
	async setSensitiveHighlight(on: boolean): Promise<void> {
		if (this.settings.sensitiveHighlight === on) return;
		this.settings.sensitiveHighlight = on;
		await this.saveSettings();
		await this.handleSettingsChanged('sensitiveHighlight');
	}

	/** Turns the custom rules' master switch, as the command does. */
	async setCustomHighlights(on: boolean): Promise<void> {
		if (this.settings.customHighlightsEnabled === on) return;
		this.settings.customHighlightsEnabled = on;
		await this.saveSettings();
		await this.handleSettingsChanged('customHighlightsEnabled');
	}

	/** Stores the dialogue presentation the way the highlight mode is stored. */
	async setDialoguePresentation(mode: DialoguePresentation): Promise<void> {
		if (this.settings.dialoguePresentation === mode) return;
		this.settings.dialoguePresentation = mode;
		await this.saveSettings();
		await this.handleSettingsChanged('dialoguePresentation');
	}

	/**
	 * The rule dialogs, opened on the settings tab's behalf: the tab must
	 * stay importable where Obsidian's Modal does not exist, so the classes
	 * live in the modals module and the tab reaches them through here.
	 */
	promptHighlightRule(
		translate: Translate,
		options: {
			title: string;
			submitLabel: string;
			initial?: CustomHighlightRule;
		},
	): Promise<HighlightRuleFormResult | null> {
		return promptForHighlightRule(this.app, translate, options);
	}

	confirmHighlightRuleDeletion(
		translate: Translate,
		ruleName: string,
	): Promise<boolean> {
		return confirmHighlightRuleDeletion(this.app, translate, ruleName);
	}

	/** Replaces the rule list whole: the settings tab's one mutation path. */
	async updateCustomHighlightRules(
		next: readonly CustomHighlightRule[],
	): Promise<void> {
		this.settings.customHighlightRules = sanitizeCustomHighlightRules([
			...next,
		]);
		await this.saveSettings();
		await this.handleSettingsChanged('customHighlightRules');
		// An open settings page re-reads its rows: the tab's own actions call
		// this too, harmlessly twice, and any other caller heals it for free.
		this.settingTab?.update();
	}

	promptChapterNumberRule(
		translate: Translate,
		options: {
			title: string;
			submitLabel: string;
			initial?: ChapterNumberRule;
		},
	): Promise<ChapterNumberRuleFormResult | null> {
		return promptForChapterNumberRule(this.app, translate, options);
	}

	confirmChapterNumberRuleDeletion(
		translate: Translate,
		ruleName: string,
	): Promise<boolean> {
		return confirmChapterNumberRuleDeletion(this.app, translate, ruleName);
	}

	/**
	 * Replaces the numbering rules whole, the settings tab's one mutation
	 * path; the sanitizer keeps one rule running at most.
	 */
	async updateChapterNumberRules(
		next: readonly ChapterNumberRule[],
	): Promise<void> {
		this.settings.manuscriptChapterNumberRules = sanitizeChapterNumberRules([
			...next,
		]);
		await this.saveSettings();
		await this.handleSettingsChanged('manuscriptChapterNumberRules');
		this.settingTab?.update();
	}

	/** One note's occurrences under the project index, ignores applied. */
	async manuscriptOccurrences(
		projectPath: string | null,
		path: string,
	): Promise<readonly EntityOccurrence[]> {
		const project = await this.resolveProject(projectPath);
		const matcher = await this.manuscriptEntityMatcher(projectPath);
		if (project === null || matcher === null) return [];
		return this.projects.mentions.occurrencesOf(project, matcher, path);
	}

	/** The whole manuscript folded per entity, for the tracking pane. */
	async manuscriptMentionAggregate(
		projectPath: string | null,
	): Promise<MentionAggregate | null> {
		const project = await this.resolveProject(projectPath);
		const matcher = await this.manuscriptEntityMatcher(projectPath);
		if (project === null || matcher === null) return null;
		return this.projects.mentions.aggregate(project, matcher);
	}

	/** The quote styles the settings have switched on, as pairs: all four
	 *  off is how dialogue reading is turned off. */
	private dialogueStylesFromSettings(): DialogueStyle[] {
		const chosen: string[] = [];
		if (this.settings.dialogueQuotesCurly) {
			chosen.push(DIALOGUE_STYLE_TOKENS.curly);
		}
		if (this.settings.dialogueQuotesStraight) {
			chosen.push(DIALOGUE_STYLE_TOKENS.straight);
		}
		if (this.settings.dialogueQuotesCorner) {
			chosen.push(DIALOGUE_STYLE_TOKENS.corner);
		}
		if (this.settings.dialogueQuotesWhite) {
			chosen.push(DIALOGUE_STYLE_TOKENS.white);
		}
		return chosen
			.map((token) => parseQuotePair(token))
			.filter((style): style is DialogueStyle => style !== null);
	}

	/**
	 * What the analysis reads of the settings, for one project's locale --
	 * plus the roster's names and aliases, which the tokenizer counts whole
	 * ahead of the dictionary. The same rows the wikilink popup offers, so
	 * what tokenizes atomically is exactly what completes and matches.
	 */
	private async analysisConfigFor(
		project: ProjectSnapshot,
	): Promise<AnalysisConfig> {
		const targets = await this.listWikilinkTargets(project.projectFile);
		return {
			sensitiveTerms: parseSensitiveWords(this.settings.sensitiveWords),
			dialogueStyles: this.dialogueStylesFromSettings(),
			count: this.writingCountOptions(),
			locale: project.locale,
			entityTerms: targets.map((target) => target.label),
		};
	}

	/** Every sensitive term's spots, for the tracking pane. */
	async sensitiveMentionAggregate(
		projectPath: string | null,
	): Promise<SensitiveTermAggregate[] | null> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return null;
		return this.projects.analysis.sensitiveAggregate(
			project,
			await this.analysisConfigFor(project),
		);
	}

	/** The chapters holding dialogue, for the tracking pane. */
	async dialogueMentionChapters(
		projectPath: string | null,
	): Promise<DialogueChapterAggregate[] | null> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return null;
		return this.projects.analysis.dialogueChapters(
			project,
			await this.analysisConfigFor(project),
		);
	}

	/** One chapter's quoted stretches, read fresh for the pane's expansion. */
	async dialogueMentionOccurrences(
		projectPath: string | null,
		path: string,
	): Promise<DialogueOccurrence[]> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return [];
		return this.projects.analysis.dialogueOccurrences(
			await this.analysisConfigFor(project),
			path,
		);
	}

	/** The project the tracking pane follows: a shown stream's, else recent. */
	mentionProjectPath(): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType(
			MANUSCRIPT_VIEW_TYPE,
		)) {
			if (!(leaf.view instanceof SnowflakeManuscriptView)) continue;
			if (!leaf.view.containerEl.isShown()) continue;
			const state = leaf.getViewState().state;
			const path = state?.projectPath;
			if (typeof path === 'string' && path.length > 0) return path;
		}
		return this.settings.recentProjectPath;
	}

	/** Opens the stream at one occurrence and flashes it where it stands. */
	async openManuscriptMention(
		projectPath: string | null,
		occurrence: { path: string; from: number; to: number },
	): Promise<void> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return;
		await this.openManuscriptStream(project.projectFile, occurrence.path);
		const leaf = this.app.workspace
			.getLeavesOfType(MANUSCRIPT_VIEW_TYPE)
			.find(
				(candidate) =>
					candidate.getViewState().state?.projectPath === project.projectFile,
			);
		if (leaf?.view instanceof SnowflakeManuscriptView) {
			await leaf.view.revealMention(
				occurrence.path,
				occurrence.from,
				occurrence.to,
			);
		}
	}

	/**
	 * Opens the stream at the chapter an unresolved occurrence was lost in
	 * and lights its card, which the rail pins at the chapter's head: there
	 * is no passage left to flash, so the card is what the row points at.
	 */
	async openManuscriptOccurrenceCard(
		projectPath: string | null,
		path: string,
		occurrenceId: string,
	): Promise<void> {
		await this.openManuscriptCard(projectPath, path, (view) =>
			view.revealOccurrenceCard(path, occurrenceId),
		);
	}

	/**
	 * The same for a revision its chapter no longer answers for: the
	 * conflict card is pinned at the chapter's head the way an unresolved
	 * occurrence's is, and the revision table's warned place reaches it.
	 */
	async openManuscriptRevisionCard(
		projectPath: string | null,
		path: string,
		revisionId: string,
	): Promise<void> {
		await this.openManuscriptCard(projectPath, path, (view) =>
			view.revealRevisionCard(path, revisionId),
		);
	}

	/**
	 * Opens the stream at one chapter and walks to a card pinned on its
	 * rail. A chapter the manuscript no longer lists has no place in the
	 * stream: the note itself is opened, where the words were lost.
	 */
	private async openManuscriptCard(
		projectPath: string | null,
		path: string,
		reveal: (view: SnowflakeManuscriptView) => Promise<void>,
	): Promise<void> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return;
		const listed = (await this.projects.manuscript.listSegments(project)).some(
			(segment) => segment.path === path,
		);
		if (!listed) {
			await this.openManagedFile(path);
			return;
		}
		await this.openManuscriptStream(project.projectFile, path);
		const leaf = this.app.workspace
			.getLeavesOfType(MANUSCRIPT_VIEW_TYPE)
			.find(
				(candidate) =>
					candidate.getViewState().state?.projectPath === project.projectFile,
			);
		if (leaf?.view instanceof SnowflakeManuscriptView) {
			await reveal(leaf.view);
		}
	}

	/**
	 * Every open stream dressed afresh, hidden ones included: a stream in a
	 * background tab or another window has no other way of hearing that the
	 * page changed under it, and it should come back looking right. A leaf
	 * not loaded yet reads the settings when it opens.
	 */
	private applyManuscriptPresentation(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			MANUSCRIPT_VIEW_TYPE,
		)) {
			if (leaf.view instanceof SnowflakeManuscriptView) {
				leaf.view.applyPresentation();
			}
		}
	}

	/**
	 * Every open stream re-dressed for the mention mode or ignore rules now
	 * in force, hidden ones included, for the same reason the presentation
	 * reaches them all.
	 */
	private applyManuscriptMentionMode(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			MANUSCRIPT_VIEW_TYPE,
		)) {
			if (leaf.view instanceof SnowflakeManuscriptView) {
				leaf.view.applyMentionMode();
			}
		}
	}

	/**
	 * Turns one of the manuscript's writing modes, from the pair the stream's
	 * toolbar carries: typewriter on and off, focus mode one level
	 * deeper — and off again past the deepest. One mode for the whole app
	 * rather than one per stream, because the modes are about how the author
	 * writes, not about which book they are writing in.
	 */
	async toggleManuscriptMode(mode: 'typewriter' | 'focus'): Promise<void> {
		if (mode === 'focus') {
			await this.setManuscriptFocus(
				NEXT_FOCUS_LEVEL[this.settings.manuscriptFocusLevel],
			);
			return;
		}
		const on = !this.settings.manuscriptTypewriter;
		this.settings.manuscriptTypewriter = on;
		await this.saveSettings();
		await this.handleSettingsChanged('manuscriptTypewriter');
		new Notice(
			this.globalT(
				on
					? 'commands.manuscriptTypewriterOn'
					: 'commands.manuscriptTypewriterOff',
			),
		);
	}

	/**
	 * Sets focus mode to one level. The palette offers each level as its own
	 * command, so a key can name the depth it wants; the notice confirms the
	 * level even when it was already in force.
	 */
	async setManuscriptFocus(level: ManuscriptFocusLevel): Promise<void> {
		if (this.settings.manuscriptFocusLevel !== level) {
			this.settings.manuscriptFocusLevel = level;
			await this.saveSettings();
			await this.handleSettingsChanged('manuscriptFocusLevel');
		}
		new Notice(this.globalT(`commands.manuscriptFocus.${level}`));
	}

	async loadManuscript(
		projectPath: string | null,
	): Promise<ManuscriptModel | null> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return null;
		const segments = await this.projects.manuscript.listSegments(project);
		return {
			projectPath: project.projectFile,
			projectId: project.id,
			projectTitle: project.title,
			locale: project.locale,
			readOnly: project.readOnly,
			segments: segments.map((segment) => ({
				path: segment.path,
				title: segment.title,
				sequence: segment.sequence,
				readOnly: segment.readOnly,
			})),
		};
	}

	async listWikilinkTargets(
		projectPath: string | null,
	): Promise<readonly WikilinkTarget[]> {
		// resolveProject rather than the known-projects map, which leaves
		// read-only projects out: their members still hold names a link can
		// point at, even when nothing here may edit them.
		const project = await this.resolveProject(projectPath);
		if (project === null) return [];
		const asSource = (
			record: { path: string; rank: number; aliases: string[] },
			name: string,
		): WikilinkSourceRecord => ({
			path: record.path,
			name,
			rank: record.rank,
			aliases: record.aliases,
		});
		const times = entitiesOf(project, 'time');
		const members: WikilinkProjectMembers = {
			groups: entityGroupsOf(project.worldbuildingKinds),
			characters: project.characters.map((record) =>
				asSource(record, record.name),
			),
			scenes: project.scenes.map((record) => asSource(record, record.title)),
			// The pickers' rule, kept: a time whose kind this release no longer
			// knows is still a time, and a point is what an unnamed one is.
			timeOf: (kind) =>
				times
					.filter((entity) =>
						kind === 'point'
							? entity.timeKind === 'point' || entity.timeKind === null
							: entity.timeKind === kind,
					)
					.map((entity) => asSource(entity, entity.name)),
			ofKind: (kind) =>
				entitiesOf(project, kind).map((entity) =>
					asSource(entity, entity.name),
				),
		};
		const projectT = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(project.locale, key, vars);
		return collectWikilinkTargets(
			members,
			(group) => entityGroupLabel(projectT, group),
			toWikiLink,
		);
	}

	async foreshadowingEntityRoster(
		projectPath: string | null,
	): Promise<readonly EntityRosterEntry[]> {
		// resolveProject for the reason `listWikilinkTargets` gives: a
		// read-only project's members still hold names a ref can point at.
		const project = await this.resolveProject(projectPath);
		if (project === null) return [];
		const roster: EntityRosterEntry[] = [
			...project.characters.map((record) => ({
				kind: 'character',
				id: record.characterId,
				name: record.name,
				path: record.path,
				group: 'character',
			})),
			...project.scenes.map((record) => ({
				kind: 'scene',
				id: record.sceneId,
				name: record.title,
				path: record.path,
				group: 'scene',
			})),
		];
		for (const kind of project.worldbuildingKinds) {
			for (const entity of entitiesOf(project, kind.id)) {
				roster.push({
					kind: kind.id,
					id: entity.entityId,
					name: entity.name,
					path: entity.path,
					// The pickers' split: a time is a point or a period, and a
					// point is what an unnamed one is.
					group:
						kind.id === 'time'
							? entity.timeKind === 'period'
								? 'time-period'
								: 'time-point'
							: kind.id,
				});
			}
		}
		return roster;
	}

	/**
	 * A new thread with no occurrence yet, from the table's Add or the
	 * palette: the form empty, and one write when it is saved. Occurrences
	 * come later, from a selection in the stream.
	 */
	async openCreateForeshadowingModal(projectPath: string | null): Promise<void> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return;
		// Refused at the door rather than at Save, where the panel's own Add
		// is already greyed: a form filled in for nothing is worse than a word.
		if (project.readOnly) {
			new Notice(this.translateForProject(project.locale, 'errors.readOnly'));
			return;
		}
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(project.locale, key, vars);
		// The roster for the picker, and the standing threads for the names
		// the new one may not take.
		const [roster, items] = await Promise.all([
			this.foreshadowingEntityRoster(project.projectFile),
			this.projects.foreshadowing.list(project),
		]);
		await promptForForeshadowing(
			this.app,
			t,
			{
				title: t('modal.foreshadowing.title'),
				submitLabelKey: 'common.create',
				roster,
				takenNames: items.map((item) => item.name),
			},
			async (result) => {
				const now = Date.now();
				const took = await this.createForeshadowing(project.projectFile, {
					id: createStableId('foreshadowing'),
					name: result.name,
					description: result.description,
					status: result.status,
					related: result.related,
					createdAt: now,
					updatedAt: now,
					occurrences: [],
				});
				if (!took) throw new Error(t('manuscript.foreshadowing.refused'));
			},
		);
	}

	async openForeshadowingEditor(
		projectPath: string | null,
		id: string,
	): Promise<void> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return;
		const items = await this.projects.foreshadowing.list(project);
		const item = items.find((candidate) => candidate.id === id);
		if (item === undefined) return;
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(project.locale, key, vars);
		const [roster, segments] = await Promise.all([
			this.foreshadowingEntityRoster(project.projectFile),
			this.projects.manuscript.listSegments(project),
		]);
		const titles = new Map(
			segments.map((segment) => [segment.path, segment.title] as const),
		);
		// Each occurrence's standing, read against its chapter now, so the
		// form can say which ones the manuscript no longer answers for.
		const paths = [
			...new Set(item.occurrences.map((occurrence) => occurrence.path)),
		];
		const bodies = await this.readSegmentBodies(paths);
		const bodyOf = (path: string): string | null => bodies.get(path) ?? null;
		// In manuscript order, which is the number each card wears: the
		// chapters as listed, then any note the list no longer names.
		const ordered = orderOccurrences(
			item,
			[
				...segments.map((segment) => segment.path),
				...paths.filter((path) => !titles.has(path)),
			],
			bodyOf,
		);
		await promptForForeshadowing(
			this.app,
			t,
			{
				title: t('modal.foreshadowing.editTitle'),
				submitLabelKey: 'common.save',
				roster,
				// Every name but its own: keeping a name is not taking one.
				takenNames: items
					.filter((other) => other.id !== id)
					.map((other) => other.name),
				initial: {
					name: item.name,
					description: item.description,
					status: item.status,
					related: item.related,
					occurrences: ordered.map((occurrence) => {
						const body = bodyOf(occurrence.path);
						return {
							id: occurrence.id,
							role: occurrence.role,
							note: occurrence.note,
							title: titles.get(occurrence.path) ?? fileStem(occurrence.path),
							text: occurrence.originalText,
							unresolved: occurrenceUnresolved(body, occurrence),
						};
					}),
				},
				onReveal: (occurrenceId) => {
					const occurrence = item.occurrences.find(
						(candidate) => candidate.id === occurrenceId,
					);
					if (occurrence !== undefined) {
						this.revealForeshadowingOccurrence(project.projectFile, occurrence);
					}
				},
				onDelete: async () => {
					const confirmed = await confirmForeshadowingDeletion(
						this.app,
						t,
						item.name,
						item.occurrences.length,
					);
					if (!confirmed) return false;
					return this.deleteForeshadowing(project.projectFile, id);
				},
			},
			async (result) => {
				// One write for the whole form, occurrence deletions included.
				const took = await this.editForeshadowing(project.projectFile, id, {
					name: result.name,
					description: result.description,
					status: result.status,
					related: result.related,
					occurrences: result.occurrences,
					removed: result.removed,
				});
				if (!took) throw new Error(t('manuscript.foreshadowing.refused'));
			},
		);
	}

	/**
	 * Shows an occurrence in the stream from a dialog standing open over it:
	 * the chapter read afresh, since the dialog may have stood open over an
	 * edit, then the passage where it stands now, or the pinned card when
	 * nothing stands.
	 */
	revealForeshadowingOccurrence(
		projectPath: string,
		occurrence: ForeshadowingOccurrence,
	): void {
		void this.readManuscriptSegment(occurrence.path)
			.then(({ body }) => anchorOccurrence(body, occurrence))
			.catch(() => ({ state: 'conflict' as const }))
			.then((anchor) =>
				anchor.state === 'conflict'
					? this.openManuscriptOccurrenceCard(
							projectPath,
							occurrence.path,
							occurrence.id,
						)
					: this.openManuscriptMention(projectPath, {
							path: occurrence.path,
							from: anchor.from,
							to: anchor.to,
						}),
			);
	}

	async unresolvedForeshadowingOccurrences(
		projectPath: string | null,
	): Promise<readonly ForeshadowingRef[]> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return [];
		const items = await this.projects.foreshadowing.list(project);
		// A chapter the manuscript no longer lists -- moved out of its folder
		// -- has no place the stream can show, so what stands on it waits to
		// be relinked, as the stream reads it too; its file is not opened.
		const listed = new Set(
			(await this.projects.manuscript.listSegments(project)).map(
				(segment) => segment.path,
			),
		);
		// Only listed chapters carrying occurrences are read, one read each
		// and all at once -- and only when their stamp moved since the last
		// sweep; a chapter that will not read leaves its body null, and every
		// occurrence on it is unresolved.
		const paths = [
			...new Set(
				items.flatMap((item) =>
					item.occurrences.map((occurrence) => occurrence.path),
				),
			),
		].filter((path) => listed.has(path));
		const bodies = new Map<string, string | null>();
		await Promise.all(
			paths.map(async (path) => {
				bodies.set(path, await this.sweptBody(path));
			}),
		);
		const unresolved: ForeshadowingRef[] = [];
		for (const item of items) {
			for (const occurrence of item.occurrences) {
				if (occurrenceUnresolved(bodies.get(occurrence.path) ?? null, occurrence)) {
					unresolved.push({ item, occurrence });
				}
			}
		}
		return unresolved;
	}

	/**
	 * The threads in the order the dashboard's table lists them -- status
	 * first, then first appearance in the manuscript -- for a picker that
	 * should read as the table does.
	 */
	async orderedForeshadowings(
		projectPath: string | null,
	): Promise<readonly Foreshadowing[]> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return [];
		const [items, segments] = await Promise.all([
			this.projects.foreshadowing.list(project),
			this.projects.manuscript.listSegments(project),
		]);
		const paths = segments.map((segment) => segment.path);
		const carrying = new Set(
			items.flatMap((item) => item.occurrences.map((occurrence) => occurrence.path)),
		);
		const bodies = await this.readSegmentBodies(
			paths.filter((path) => carrying.has(path)),
		);
		return orderForeshadowings(items, paths, (path) => bodies.get(path) ?? null);
	}

	/**
	 * The bodies of the chapters named, read all at once; a chapter that
	 * will not read is null, and every record on it reads as unresolved.
	 */
	private async readSegmentBodies(
		paths: readonly string[],
	): Promise<Map<string, string | null>> {
		const bodies = new Map<string, string | null>();
		await Promise.all(
			paths.map(async (path) => {
				bodies.set(
					path,
					await this.readManuscriptSegment(path).then(
						({ body }) => body,
						() => null,
					),
				);
			}),
		);
		return bodies;
	}

	/** A chapter's body for the sweep, read again only once its stamp has moved. */
	private async sweptBody(path: string): Promise<string | null> {
		const stamp = this.projects.manuscript.segmentStamp(path);
		if (stamp === null) return null;
		const kept = this.sweptBodies.get(path);
		if (kept !== undefined && kept.stamp === stamp) return kept.body;
		try {
			const { body } = await this.readManuscriptSegment(path);
			this.sweptBodies.set(path, { stamp, body });
			return body;
		} catch {
			return null;
		}
	}

	async readManuscriptSegment(path: string): Promise<ManuscriptSegmentText> {
		const segment = await this.projects.manuscript.readSegment(path);
		return {
			path: segment.path,
			body: segment.body,
			revision: segment.revision,
			stamp: segment.stamp,
			readOnly: segment.readOnly,
		};
	}

	manuscriptSegmentStamp(path: string): string | null {
		return this.projects.manuscript.segmentStamp(path);
	}

	async saveManuscriptSegment(
		path: string,
		body: string,
		expectedRevision: string,
	): Promise<{ revision: string; stamp: string }> {
		try {
			await this.projects.manuscript.writeSegment(path, body, expectedRevision);
		} catch (error) {
			// The note moved on somewhere else while this text was being written.
			// Said in the author's own words rather than the repository's, because
			// two views of one note is an ordinary thing to have arranged and this
			// is the one moment it costs them something.
			if (error instanceof ConcurrentChangeError) {
				throw new ManuscriptSaveConflict(
					this.translateForProject(
						this.projectLocaleOfPath(path),
						'errors.concurrentChange',
					),
				);
			}
			throw error;
		}
		const saved = await this.projects.manuscript.readSegment(path);
		return { revision: saved.revision, stamp: saved.stamp };
	}

	async createManuscriptSegment(
		projectPath: string,
		placement: { after: string } | { atStart: true } | { atEnd: true },
		onNamed?: SegmentNamed,
	): Promise<string | null> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return null;
		const manuscript = this.projects.manuscript;
		const t = (key: string, vars?: Record<string, string | number>): string =>
			this.translateForProject(project.locale, key, vars);
		const proposal = await this.chapterNumberProposal(project, placement);
		return promptForSegmentTitle(
			this.app,
			t,
			this.segmentTitlePrompt(t, proposal),
			async ({ title, renumber }) => {
				await onNamed?.();
				return this.placeSegment(t, () =>
					manuscript.createSegmentAt(
						project,
						placement,
						title,
						this.renamesFor(proposal, renumber),
					),
				);
			},
		);
	}

	async splitManuscriptSegment(
		projectPath: string,
		path: string,
		offset: number,
		onNamed?: SegmentNamed,
	): Promise<string | null> {
		const project = await this.resolveProject(projectPath);
		if (project === null) return null;
		const t = (key: string, vars?: Record<string, string | number>): string =>
			this.translateForProject(project.locale, key, vars);
		// The new note goes right after the one being split, so it is numbered
		// from that one, and the notes after it move along the same way.
		const proposal = await this.chapterNumberProposal(project, { after: path });
		return promptForSegmentTitle(
			this.app,
			t,
			this.segmentTitlePrompt(t, proposal),
			async ({ title, renumber }) => {
				await onNamed?.();
				return this.placeSegment(t, () =>
					this.projects.manuscript.splitSegmentAt(
						project,
						path,
						offset,
						title,
						this.renamesFor(proposal, renumber),
					),
				);
			},
		);
	}

	/** The numbering rule the settings describe, or null while it is off or unusable. */
	private chapterNumbering(): ChapterNumbering | null {
		return compileChapterNumbering({
			style: this.settings.manuscriptChapterNumbering,
			rules: this.settings.manuscriptChapterNumberRules,
		});
	}

	/**
	 * What the rule offers a note placed here: read from the notes as they
	 * stand on disk, because a note made a moment ago is exactly the one the
	 * index has not caught up with, and it is the one before the new note.
	 */
	private async chapterNumberProposal(
		project: ProjectSnapshot,
		placement: { after: string } | { atStart: true } | { atEnd: true },
	): Promise<(ChapterNumberProposal & { paths: string[] }) | null> {
		const numbering = this.chapterNumbering();
		if (numbering === null) return null;
		const segments = await this.projects.manuscript.listSegmentsFromFiles(project);
		let insertAt = segments.length;
		if ('after' in placement) {
			const target = normalizePath(placement.after);
			const index = segments.findIndex((segment) => segment.path === target);
			insertAt = index === -1 ? segments.length : index + 1;
		} else if ('atStart' in placement) {
			insertAt = 0;
		}
		return {
			...proposeChapterNumber(
				segments.map((segment) => segment.title),
				insertAt,
				numbering,
			),
			paths: segments.map((segment) => segment.path),
		};
	}

	/**
	 * What the rule asks of the notes after the one at `removeAt` once it is
	 * gone: the numbered ones move down by one, closing the gap, when the
	 * note going was numbered itself.
	 */
	private chapterRemovalProposal(
		segments: readonly { path: string; title: string }[],
		removeAt: number,
	): (ChapterRemovalProposal & { paths: string[] }) | null {
		const numbering = this.chapterNumbering();
		if (numbering === null) return null;
		return {
			...proposeChapterRemoval(
				segments.map((segment) => segment.title),
				removeAt,
				numbering,
			),
			paths: segments.map((segment) => segment.path),
		};
	}

	private segmentTitlePrompt(
		t: (key: string, vars?: Record<string, string | number>) => string,
		proposal: ChapterNumberProposal | null,
	): SegmentTitlePrompt {
		return {
			preset: t('manuscript.defaultSegmentTitle'),
			numbering:
				proposal === null
					? null
					: { head: proposal.head, followers: proposal.followers.length },
		};
	}

	/**
	 * Makes a note with the renumbering the author asked for -- the batch
	 * settled inside the service before the note is made, and put back if the
	 * note cannot be -- and says what moved. A name the batch cannot take
	 * refuses the whole thing, said in the form's own notice so the author can
	 * change the name or step back.
	 */
	private async placeSegment(
		t: (key: string, vars?: Record<string, string | number>) => string,
		place: () => Promise<{ path: string; renumbered: SegmentRenameOutcome }>,
	): Promise<string> {
		let placed: { path: string; renumbered: SegmentRenameOutcome };
		try {
			placed = await place();
		} catch (error) {
			throw this.renumberError(error, t);
		}
		this.noticeRenumbered(placed.renumbered, t);
		return placed.path;
	}

	/** The renames the author agreed to: the followers' when the toggle was on. */
	private renamesFor(
		proposal: (ChapterNumberProposal & { paths: string[] }) | null,
		renumber: boolean,
	): { path: string; title: string }[] {
		return renumber && proposal !== null ? this.followerRenames(proposal) : [];
	}

	/** The renames a proposal's followers ask for, each note by its path. */
	private followerRenames(proposal: {
		followers: readonly ChapterFollower[];
		paths: readonly string[];
	}): { path: string; title: string }[] {
		return proposal.followers.flatMap((follower) => {
			const path = proposal.paths[follower.index];
			return path === undefined ? [] : [{ path, title: follower.next }];
		});
	}

	/** A refused name said in the author's words; anything else as it came. */
	private renumberError(
		error: unknown,
		t: (key: string, vars?: Record<string, string | number>) => string,
	): unknown {
		return error instanceof PathConflictError
			? new Error(t('errors.renumberConflict', { path: error.path }))
			: error;
	}

	/**
	 * What the renumbering did, the notes it could not touch included: a
	 * read-only note keeps its name, and an author who asked for the move
	 * is told so rather than left to find the old number standing.
	 */
	private noticeRenumbered(
		outcome: SegmentRenameOutcome,
		t: (key: string, vars?: Record<string, string | number>) => string,
	): void {
		const count = outcome.renamed.length;
		const skipped = outcome.skipped.length;
		if (count === 0 && skipped === 0) return;
		new Notice(
			skipped === 0
				? t('messages.segmentsRenumbered', { count })
				: count === 0
					? t('messages.segmentsNotRenumbered', { skipped })
					: t('messages.segmentsRenumberedSkipped', { count, skipped }),
		);
	}

	private async resolveProject(
		projectPath: string | null,
	): Promise<ProjectSnapshot | null> {
		const path = projectPath ?? this.settings.recentProjectPath;
		if (path === null) return null;
		try {
			return await this.projects.loadProject(path);
		} catch {
			return null;
		}
	}

	/** Every open stream, refreshed after something changed underneath it. */
	private async refreshManuscriptStreams(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(
			MANUSCRIPT_VIEW_TYPE,
		)) {
			if (!leaf.view.containerEl.isShown()) {
				// A hidden stream pays at reveal instead: without the debt, an
				// alias added while a member note covered the stream stayed
				// undressed until the mode was touched or the app reloaded.
				if (leaf.view instanceof SnowflakeManuscriptView) {
					leaf.view.queueRefreshWhenShown();
				}
				continue;
			}
			await leaf.loadIfDeferred();
			if (leaf.view instanceof SnowflakeManuscriptView) {
				await leaf.view.refresh();
			}
		}
	}

	async openDashboard(): Promise<void> {
		await this.revealDashboard();
	}

	/**
	 * Brings the dashboard forward and hands back the view behind it, for the
	 * commands that finish inside a pane rather than in a dialog of their own.
	 */
	private async revealDashboard(): Promise<SnowflakeDashboardView | null> {
		const recent = this.settings.recentProjectPath;
		let leaf: WorkspaceLeaf | undefined =
			recent === null
				? this.app.workspace
						.getLeavesOfType(DASHBOARD_VIEW_TYPE)
						.find(
							(candidate) =>
								candidate.getRoot() === this.app.workspace.rootSplit,
						)
				: this.findOpenProjectLeaf(recent);
		if (leaf === undefined) {
			leaf = this.app.workspace.getLeaf('tab');
			await leaf.setViewState({
				type: DASHBOARD_VIEW_TYPE,
				active: true,
				state: {
					projectPath: recent,
					selectedStep: this.getRecentStep(),
				},
			});
		}
		await leaf.loadIfDeferred();
		if (leaf.view instanceof SnowflakeDashboardView) {
			await leaf.view.activateFromWorkspace();
		}
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		await this.app.workspace.revealLeaf(leaf);
		return leaf.view instanceof SnowflakeDashboardView ? leaf.view : null;
	}

	private async activateProjectLeaf(
		leaf: WorkspaceLeaf | null,
	): Promise<void> {
		if (
			leaf === null ||
			![DASHBOARD_VIEW_TYPE, STORY_STRUCTURE_VIEW_TYPE, MANUSCRIPT_VIEW_TYPE]
				.includes(leaf.getViewState().type) ||
			this.app.workspace.getMostRecentLeaf() !== leaf
		) {
			return;
		}
		// The unscoped lookup includes popouts and excludes sidebars. Focusing
		// a sidebar must not cancel the owning tab's pending startup activation.
		const activation = ++this.projectLeafActivation;
		const stillCurrent = (): boolean =>
			activation === this.projectLeafActivation &&
			this.app.workspace.getMostRecentLeaf() === leaf;
		const step = (): StepId => leaf.view instanceof SnowflakeDashboardView
			? leaf.view.getSelectedStep()
			: this.getRecentStep();
		const activateLoaded = (): boolean => {
			const view = leaf.view;
			if (!(view instanceof SnowflakeDashboardView) &&
				!(view instanceof SnowflakeStoryStructureView) &&
				!(view instanceof SnowflakeManuscriptView)) return false;
			const context = view.workspaceProjectContext();
			if (context === null) return false;
			this.activateProject(context.path, context.locale, step());
			return true;
		};
		// Loaded tabs switch context immediately, without waiting for a render or
		// an input inside the view. Background reads never activate a project.
		if (!stillCurrent() || activateLoaded()) return;
		await leaf.loadIfDeferred();
		if (!stillCurrent() || activateLoaded()) return;
		// Startup can leave a view's model loading after its saved state arrives.
		// Resolve only that saved owner, and check again after the asynchronous read.
		const path = leaf.getViewState().state?.projectPath;
		if (typeof path !== 'string') return;
		let project: ProjectSnapshot;
		try {
			project = await this.projects.loadProject(path);
		} catch (error) {
			// Restored workspaces can name a project removed while the app
			// was closed. Its view owns the empty state; activation stays quiet.
			if (error instanceof ManagedFileNotFoundError) return;
			throw error;
		}
		if (!stillCurrent() || leaf.getViewState().state?.projectPath !== path) return;
		this.activateProject(project.projectFile, project.locale, step());
	}

	private async refreshVisibleDashboardsAfterLayout(): Promise<void> {
		const visibleLeaves = this.app.workspace
			.getLeavesOfType(DASHBOARD_VIEW_TYPE)
			.filter((leaf) => leaf.view.containerEl.isShown());
		await Promise.all(
			visibleLeaves.map(async (leaf) => {
				await leaf.loadIfDeferred();
				if (
					leaf.view.containerEl.isShown() &&
					leaf.view instanceof SnowflakeDashboardView
				) {
					await leaf.view.refreshFromWorkspace();
				}
			}),
		);

		// Refreshing visible panes must not make every pane the current project.
		// Restore context only from the most recent tab, including a popout.
		await this.activateProjectLeaf(
			this.app.workspace.getMostRecentLeaf(),
		);
	}

	private findOpenProjectLeaf(path: string): WorkspaceLeaf | undefined {
		return this.app.workspace
			.getLeavesOfType(DASHBOARD_VIEW_TYPE)
			.filter((leaf) => leaf.getRoot() === this.app.workspace.rootSplit)
			.find((leaf) => {
				const statePath = leaf.getViewState().state?.projectPath;
				return leaf.view instanceof SnowflakeDashboardView
					? leaf.view.getProjectPath() === path
					: statePath === path;
			});
	}

	private async openProjectTab(
		project: ProjectSnapshot,
		step: StepId,
	): Promise<void> {
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: DASHBOARD_VIEW_TYPE,
			active: true,
			state: {
				projectPath: project.projectFile,
				projectTitle: project.title,
				selectedStep: step,
			},
		});
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private async reuseEmptyDashboard(project: CreatedProject): Promise<boolean> {
		const leaf = this.app.workspace
			.getLeavesOfType(DASHBOARD_VIEW_TYPE)
			.filter((candidate) => candidate.getRoot() === this.app.workspace.rootSplit)
			.find(
				(candidate) =>
					candidate.view instanceof SnowflakeDashboardView &&
					candidate.view.isEmpty(),
			);
		if (leaf === undefined || !(leaf.view instanceof SnowflakeDashboardView)) {
			return false;
		}
		await leaf.view.showCreatedProject(project);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		await this.app.workspace.revealLeaf(leaf);
		return true;
	}

	private registerCommands(): void {
		this.addCommand({
			id: 'toggle-custom-highlights',
			name: this.globalT('commands.toggleCustomHighlights'),
			callback: () => {
				this.settings.customHighlightsEnabled =
					!this.settings.customHighlightsEnabled;
				void this.saveSettings()
					.then(() => this.handleSettingsChanged('customHighlightsEnabled'))
					.catch((error: unknown) => {
						this.showError(error);
					});
			},
		});
		this.addCommand({
			id: 'start-writing-session',
			name: this.globalT('commands.startWritingSession'),
			callback: () => {
				this.openStartSessionModal();
			},
		});
		this.addCommand({
			id: 'toggle-session-scope',
			name: this.globalT('commands.toggleSessionScope'),
			callback: () => {
				this.toggleSessionScope();
			},
		});
		for (const type of WRITING_SESSION_TYPES) {
			this.addCommand({
				id: `start-writing-session-${type}`,
				name: this.globalT(`commands.startSession.${type}`),
				callback: () => {
					void this.startQuickSession(type).catch((error: unknown) => {
						this.showError(error);
					});
				},
			});
		}
		this.addCommand({
			id: 'pause-resume-writing-session',
			name: this.globalT('commands.pauseResumeWritingSession'),
			checkCallback: (checking) => {
				const live = this.sessions.live();
				if (live === null || live.pomodoro?.phase === 'break') return false;
				if (checking) return true;
				if (live.state === 'paused') this.sessions.resume();
				else this.sessions.pause();
				return true;
			},
		});
		this.addCommand({
			id: 'stop-writing-session',
			name: this.globalT('commands.stopWritingSession'),
			checkCallback: (checking) => {
				if (!this.sessions.isRunning()) return false;
				if (checking) return true;
				void this.sessions.stop().catch((error: unknown) => {
					this.showError(error);
				});
				return true;
			},
		});
		this.addCommand({
			id: 'open-statistics',
			name: this.globalT('commands.openStatistics'),
			callback: () => {
				void this.openStatisticsView().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'toggle-managed-boundary-protection',
			name: this.globalT('commands.toggleManagedBoundaries'),
			callback: () => {
				void this.toggleManagedBoundaryProtection().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'toggle-reduced-animations',
			name: this.globalT('commands.toggleReducedAnimations'),
			callback: () => {
				void this.toggleReducedAnimations().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'toggle-notes-beside-dashboard',
			name: this.globalT('commands.toggleNotesBesideDashboard'),
			callback: () => {
				void this.toggleNotesBesideDashboard().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'toggle-dashboard-rail',
			name: this.globalT('commands.toggleDashboardRail'),
			// The dashboard in front, else the recent project's: the rail's
			// fold is the view's own, so the command offers itself only where
			// a view can answer it.
			checkCallback: (checking) => {
				const dashboard =
					this.app.workspace.getActiveViewOfType(SnowflakeDashboardView) ??
					this.dashboardViewForRecentProject();
				if (dashboard === null || !dashboard.canToggleRail()) return false;
				if (!checking) dashboard.toggleRail();
				return true;
			},
		});
		this.addCommand({
			id: 'toggle-table-progress-status',
			name: this.globalT('commands.toggleTableProgressStatus'),
			callback: () => {
				void this.toggleTableProgressStatus().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'toggle-derived-tasks',
			name: this.globalT('commands.toggleDerivedTasks'),
			callback: () => {
				void this.toggleDerivedTasks().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'toggle-table-actions-column',
			name: this.globalT('commands.toggleTableActionsColumn'),
			callback: () => {
				void this.toggleTableActionsColumn().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'toggle-create-from-field',
			name: this.globalT('commands.toggleCreateFromField'),
			callback: () => {
				void this.toggleCreateFromField().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'toggle-freeform-mode',
			name: this.globalT('commands.toggleFreeformMode'),
			callback: () => {
				void this.toggleFreeformMode().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'toggle-untimed-word-tracking',
			name: this.globalT('commands.toggleUntimedTracking'),
			callback: () => {
				void this.toggleUntimedTracking().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'count-project-words',
			name: this.globalT('commands.countProjectWords'),
			callback: () => {
				void this.countProjectWords().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'create-project',
			name: this.globalT('commands.createProject'),
			callback: () => void this.openCreateProjectModal(),
		});
		this.addCommand({
			id: 'open-dashboard',
			name: this.globalT('commands.openDashboard'),
			callback: () => {
				void this.openDashboard();
			},
		});
		this.addCommand({
			id: 'open-project-manager',
			name: this.globalT('commands.openProjectManager'),
			callback: () => {
				void this.openProjectManager(null).catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'add-character',
			name: this.globalT('commands.addCharacter'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) void this.openCreateCharacterModal();
				return available;
			},
		});
		this.addCommand({
			id: 'add-worldbuilding-note',
			name: this.globalT('commands.addWorldbuildingNote'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) {
					void this.addWorldbuildingNote().catch((error: unknown) => {
						this.showError(error);
					});
				}
				return available;
			},
		});
		this.addCommand({
			id: 'create-worldbuilding-kind',
			name: this.globalT('commands.createWorldbuildingKind'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) {
					void this.startWorldbuildingKind().catch((error: unknown) => {
						this.showError(error);
					});
				}
				return available;
			},
		});
		this.addCommand({
			id: 'open-worldbuilding-base',
			name: this.globalT('commands.openWorldbuildingBase'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) {
					void this.openWorldbuildingBase().catch((error: unknown) => {
						this.showError(error);
					});
				}
				return available;
			},
		});
		for (const definitionId of DEFINITION_FILE_IDS) {
			this.addCommand({
				id: `add-${definitionId}`,
				name: this.globalT(`commands.add.${definitionId}`),
				checkCallback: (checking) => {
					const available = this.settings.recentProjectPath !== null;
					if (!checking && available) {
						void this.addDefinitionEntry(definitionId).catch(
							(error: unknown) => {
								this.showError(error);
							},
						);
					}
					return available;
				},
			});
		}
		this.addCommand({
			id: 'add-scene',
			name: this.globalT('commands.addScene'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) void this.openCreateSceneModal();
				return available;
			},
		});
		this.addCommand({
			id: 'add-foreshadowing',
			name: this.globalT('commands.addForeshadowing'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) {
					void this.openCreateForeshadowingModal(this.settings.recentProjectPath);
				}
				return available;
			},
		});
		this.addCommand({
			id: 'open-sticky-notes',
			name: this.globalT('commands.openStickyNotes'),
			callback: () => {
				void this.openStickyNotesView().catch((error: unknown) => {
					this.showError(error);
				});
			},
		});
		this.addCommand({
			id: 'new-task',
			name: this.globalT('commands.newTask'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) {
					void this.openCreateTaskModal(this.settings.recentProjectPath);
				}
				return available;
			},
		});
		this.addCommand({
			id: 'new-sticky-note',
			name: this.globalT('commands.newStickyNote'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) {
					void this.createStickyNoteAndFloat().catch((error: unknown) => {
						this.showError(error);
					});
				}
				return available;
			},
		});
		for (const base of ['characters', 'scenes'] as const) {
			this.addCommand({
				id: base === 'characters' ? 'open-character-base' : 'open-scene-base',
				name: this.globalT(
					base === 'characters'
						? 'commands.openCharacterBase'
						: 'commands.openSceneBase',
				),
				checkCallback: (checking) => {
					const available = this.settings.recentProjectPath !== null;
					if (!checking && available) {
						void this.openProjectBase(base)
							.then(() => this.refreshDashboards())
							.catch((error: unknown) => {
								this.showError(error);
							});
					}
					return available;
				},
			});
		}
		this.addCommand({
			id: 'open-manuscript-stream',
			name: this.globalT('commands.openManuscriptStream'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) void this.openCurrentManuscript();
				return available;
			},
		});
		this.addCommand({
			id: 'open-story-structure',
			name: this.globalT('commands.openStoryStructure'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) {
					void this.openStoryStructure().catch((error: unknown) => {
						this.showError(error);
					});
				}
				return available;
			},
		});
		this.addCommand({
			// Keep the ID stable for existing hotkeys; the display name follows the workspace tab.
			id: 'open-ordered-corkboard',
			name: this.globalT('commands.openCorkboard'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) {
					void this.openStoryStructure('corkboard-ordered').catch(
						(error: unknown) => {
							this.showError(error);
						},
					);
				}
				return available;
			},
		});
		this.addCommand({
			id: 'migrate-member-notes',
			name: this.globalT('commands.migrateMemberNotes'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) {
					void this.migrateMemberNotes()
						.then(({ migrated, skipped }) => {
							new Notice(
								this.t('messages.migrateMemberNotesDone', {
									migrated,
									skipped,
								}),
							);
						})
						.catch((error: unknown) => {
							this.showError(error);
						});
				}
				return available;
			},
		});
		this.addCommand({
			id: 'split-manuscript-segment',
			name: this.globalT('commands.splitManuscriptSegment'),
			checkCallback: (checking) => {
				const view = this.activeManuscriptView();
				// Only offered where there is a caret to split at.
				const available = view !== null && view.editingSegment() !== null;
				if (!checking && available) {
					void view.splitActiveSegment().catch((error: unknown) => {
						this.showError(error);
					});
				}
				return available;
			},
		});
		// Moving about in a manuscript, and growing one, from the keyboard. Each is
		// offered whenever a stream is the view in front of the author, which is
		// what makes them findable: a command nobody can see is a command nobody
		// can bind a key to either.
		const inStream = (
			run: (view: SnowflakeManuscriptView) => Promise<void>,
			ready: (view: SnowflakeManuscriptView) => boolean = (view) =>
				view.hasSegments(),
		) =>
			(checking: boolean): boolean => {
				const view = this.activeManuscriptView();
				const available = view !== null && ready(view);
				if (!checking && available) {
					void run(view).catch((error: unknown) => {
						this.showError(error);
					});
				}
				return available;
			};
		this.addCommand({
			id: 'manuscript-next-segment',
			name: this.globalT('commands.manuscriptNextSegment'),
			checkCallback: inStream((view) => view.goToSegment(1)),
		});
		this.addCommand({
			id: 'manuscript-previous-segment',
			name: this.globalT('commands.manuscriptPreviousSegment'),
			checkCallback: inStream((view) => view.goToSegment(-1)),
		});
		this.addCommand({
			id: 'manuscript-back-to-anchor',
			name: this.globalT('commands.manuscriptBackToAnchor'),
			checkCallback: inStream((view) => view.goToAnchor()),
		});
		// The manuscript as plain text: the whole book from the stream, and the
		// note the page is centred on, written or copied.
		this.addCommand({
			id: 'export-manuscript',
			name: this.globalT('commands.exportManuscript'),
			checkCallback: inStream((view) => view.exportWholeManuscript()),
		});
		this.addCommand({
			id: 'export-manuscript-note',
			name: this.globalT('commands.exportManuscriptNote'),
			checkCallback: inStream(
				(view) => view.exportActiveSegment(),
				(view) => view.activeSegment() !== null,
			),
		});
		this.addCommand({
			id: 'copy-manuscript-note',
			name: this.globalT('commands.copyManuscriptNote'),
			checkCallback: inStream(
				(view) => view.copyActiveSegment(),
				(view) => view.activeSegment() !== null,
			),
		});
		this.addCommand({
			id: 'manuscript-insert-note-after',
			name: this.globalT('commands.manuscriptInsertAfter'),
			checkCallback: inStream((view) => view.insertBesideActive('after')),
		});
		this.addCommand({
			id: 'manuscript-insert-note-before',
			name: this.globalT('commands.manuscriptInsertBefore'),
			checkCallback: inStream((view) => view.insertBesideActive('before')),
		});
		this.addCommand({
			id: 'manuscript-stop-editing',
			name: this.globalT('commands.manuscriptStopEditing'),
			checkCallback: inStream(
				(view) => view.stopEditing(),
				(view) => view.isEditing(),
			),
		});
		this.addCommand({
			id: 'toggle-manuscript-note-paths',
			name: this.globalT('commands.toggleManuscriptPath'),
			callback: () => {
				void this.toggleManuscriptHeader('showManuscriptPath').catch(
					(error: unknown) => {
						this.showError(error);
					},
				);
			},
		});
		this.addCommand({
			id: 'toggle-manuscript-order-numbers',
			name: this.globalT('commands.toggleManuscriptSequence'),
			callback: () => {
				void this.toggleManuscriptHeader('showManuscriptSequence').catch(
					(error: unknown) => {
						this.showError(error);
					},
				);
			},
		});
		// The writing modes, offered where they act: while a stream is in front.
		// The header buttons walk the levels; the palette names them — one
		// command per focus mode level, so a key can be bound to the exact
		// depth wanted rather than cycling through the rest.
		this.addCommand({
			id: 'toggle-typewriter-scrolling',
			name: this.globalT('commands.toggleManuscriptTypewriter'),
			checkCallback: inStream(
				() => this.toggleManuscriptMode('typewriter'),
				() => true,
			),
		});
		for (const level of ['off', 'on', 'deep', 'solo'] as const) {
			this.addCommand({
				id: `set-focus-mode-${level}`,
				name: this.globalT(`commands.setFocusMode.${level}`),
				checkCallback: inStream(
					() => this.setManuscriptFocus(level),
					() => true,
				),
			});
		}
		this.addCommand({
			id: 'close-manuscript-stream',
			name: this.globalT('commands.closeManuscriptStream'),
			checkCallback: inStream(
				async (view) => {
					view.leaf.detach();
					return Promise.resolve();
				},
				() => true,
			),
		});
		this.addCommand({
			id: 'repair-project',
			name: this.globalT('commands.openHealthChecker'),
			checkCallback: (checking) => {
				const available = this.settings.recentProjectPath !== null;
				if (!checking && available) {
					void this.checkCurrentProject()
						.then((report) => {
							this.showRepairReport(report);
							return this.refreshDashboards();
						})
						.catch((error: unknown) => {
							this.showError(error);
						});
				}
				return available;
			},
		});
	}

	/**
	 * This plugin's own items in the note context menu, wherever Obsidian raises
	 * one: the file explorer, a tab header, the search results, the manuscript.
	 *
	 * Grouped into a section of their own under a heading, because they are the
	 * only items in that menu written in the project's language while everything
	 * around them follows Obsidian's. Unlabelled, two sentences in Chinese in the
	 * middle of an English menu read as a fault rather than as a boundary.
	 */
	private registerFileMenu(): void {
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file, source) => {
				// Not our own menu: the stream adds these before it asks Obsidian
				// for the rest, and would otherwise be answered by itself.
				if (source === MANUSCRIPT_VIEW_TYPE) return;
				if (!(file instanceof TFile) || !this.touchesProject(file.path)) return;
				this.addProjectMenuSection(menu, file.path);
			}),
		);
	}

	/**
	 * The section itself, shared by the file menu and the manuscript's own.
	 *
	 * `source` is where the menu was raised, so the section can leave out the way
	 * back to somewhere the author is already standing.
	 */
	addProjectMenuSection(
		menu: Menu,
		path: string,
		source?: string,
		lead?: (menu: Menu) => void,
	): void {
		const locale = this.projectLocaleOfPath(path);
		const t = (key: string): string => this.translateForProject(locale, key);
		const section = 'snowflake-method';
		menu.addItem((item) =>
			item.setSection(section).setIsLabel(true).setTitle(t('plugin.name')),
		);
		// What the click itself was about leads the group, ahead of the
		// standing entries: a mention under the pointer outranks the doors
		// that are always there.
		lead?.(menu);
		if (source !== MANUSCRIPT_VIEW_TYPE) {
			menu.addItem((item) =>
				item
					.setSection(section)
					.setTitle(t('commands.openManuscriptStream'))
					.setIcon('scroll-text')
					.onClick(() => {
						void this.openManuscriptFor(path).catch((error: unknown) => {
							this.showError(error);
						});
					}),
			);
		}
		menu.addItem((item) =>
			item
				.setSection(section)
				.setTitle(t('commands.openDashboard'))
				.setIcon('snowflake')
				.onClick(() => {
					void this.openDashboardFor(path).catch((error: unknown) => {
						this.showError(error);
					});
				}),
		);
	}

	/** The language of whichever project owns a path, for menu text. */
	private projectLocaleOfPath(path: string): 'en' | 'zh-CN' | null {
		const projectId = this.projectIdOfPath(path);
		const locale =
			projectId === null ? undefined : this.projectLocalesById.get(projectId);
		return locale ?? this.currentProjectLocale;
	}

	/** The project a note belongs to, found from the roots already discovered. */
	private async projectOfPath(path: string): Promise<ProjectSnapshot | null> {
		for (const rootPath of this.knownProjectRoots) {
			if (!isPathAtOrBelow(path, rootPath)) continue;
			for (const project of await this.discoverProjects()) {
				if (project.rootPath === rootPath) {
					return this.projects.loadProject(project.projectFile);
				}
			}
		}
		return this.resolveProject(null);
	}

	private async openManuscriptFor(path: string): Promise<void> {
		const project = await this.projectOfPath(path);
		if (project === null) {
			new Notice(this.projectT('messages.noCurrentProject'));
			return;
		}
		const segments = await this.projects.manuscript.listSegments(project);
		const anchor = segments.find((segment) => segment.path === path)?.path ?? null;
		await this.openManuscriptStream(project.projectFile, anchor);
	}

	private async openDashboardFor(path: string): Promise<void> {
		const project = await this.projectOfPath(path);
		if (project === null) {
			new Notice(this.projectT('messages.noCurrentProject'));
			return;
		}
		await this.selectProject(project.projectFile);
		await this.openDashboard();
	}

	private registerVaultListeners(): void {
		this.register(() => {
			if (this.fieldsReconcileTimer !== null) {
				window.clearTimeout(this.fieldsReconcileTimer);
				this.fieldsReconcileTimer = null;
			}
			this.pendingFieldsReconciles.clear();
		});
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				// Born in scope, a note baselines at nothing, so what is then
				// written into it is credited to the session.
				if (file instanceof TFile) this.sessions.noteCreated(file.path);
				this.handleVaultEvent(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				// An out-of-editor write is not this device's writing: it moves
				// no counts and no clock, and only re-baselines what it touched
				// so the next keystroke is not credited with it. The plugin's
				// own saves report themselves through the repository instead,
				// and their modify echo is skipped by its write mark.
				if (
					file instanceof TFile &&
					!this.projects.repository.isWritingPath(file.path)
				) {
					this.sessions.noteWrittenExternally(file.path);
				}
				this.handleVaultEvent(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				void this.handleVaultDelete(file).catch((error: unknown) => {
					this.showError(error);
				});
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				void this.handleVaultRename(file, oldPath).catch((error: unknown) => {
					this.showError(error);
				});
			}),
		);
	}

	private handleVaultEvent(file: TAbstractFile): void {
		if (!this.touchesProject(file.path)) return;
		// Analysis reads flush their derived caches, sometimes partway through
		// a large manuscript. Those writes are results of a read, not edits:
		// refreshing their readers here feeds the scan back into itself.
		if (file instanceof TFile && isManuscriptCachePath(file.path)) return;
		// A sticky note is told to the surfaces showing it directly, and the
		// dashboards keep their frames, which a refresh would rebuild around
		// the tab's live editor at every save. The health report reads sticky
		// notes all the same, so the cached verdict is dropped here and the
		// bell has every dashboard re-read its own.
		if (file instanceof TFile && isStickyNotePath(file.path)) {
			this.invalidateProjectHealth(file.path);
			this.scheduleStickyNoteNotify();
			this.scheduleWritingCountRefresh(1000);
			return;
		}
		// The task file is told to the board the same way: its own bell, and
		// the dashboards keep their frames -- a drop would otherwise cost a
		// model reload and a frame rebuild a moment after landing.
		if (file instanceof TFile && isTaskFilePath(file.path)) {
			this.invalidateProjectHealth(file.path);
			this.scheduleTaskNotify();
			return;
		}
		this.invalidateProjectHealth(file.path);
		this.scheduleRefresh(this.isDirectProjectFile(file.path));
		this.scheduleFieldsBlockReconcile(file.path);
		// A note written from anywhere — sync, a script, another pane — may be
		// the one the status bar is counting, or part of the manuscript total.
		this.scheduleWritingCountRefresh(1000);
		if (file instanceof TFolder) this.scheduleDefinitionMaterialize(file.path);
	}

	/**
	 * A folder that just appeared under a definition tree is a node the file
	 * explorer made, and every node carries a note named after its folder:
	 * materialized here, the moment the folder exists, so a link made a
	 * breath later has a note to resolve to. For any other folder the service returns without
	 * writing, which is what makes it safe to call on every folder event.
	 */
	private scheduleDefinitionMaterialize(path: string): void {
		void (async () => {
			const project = await this.projectOfPath(path);
			if (project === null || project.readOnly) return;
			await this.projects.materializeDefinitionNodesBelow(project, path);
		})().catch((error: unknown) => {
			console.error(
				'Snowflake: could not materialize definition nodes',
				path,
				error,
			);
		});
	}

	/**
	 * Queues a note for the fields-block reconcile: the pass that rewrites a
	 * member note's generated block when it stops saying what the properties
	 * say. Trailing debounce, so a burst of writes settles into one pass, and
	 * the plugin's own write inside that pass ends it: the next look finds the
	 * block already right and writes nothing.
	 */
	private scheduleFieldsBlockReconcile(path: string): void {
		if (this.fieldsReconcilePaused || !path.endsWith('.md')) return;
		this.pendingFieldsReconciles.add(path);
		// Deliberately the main window's clock: this debounce outlives any one
		// view, and a timer scoped to a popout would die with it and drop the
		// pass. Cleanup is registered beside the vault listeners.
		if (this.fieldsReconcileTimer !== null) {
			window.clearTimeout(this.fieldsReconcileTimer);
		}
		this.fieldsReconcileTimer = window.setTimeout(() => {
			this.fieldsReconcileTimer = null;
			void this.drainFieldsBlockReconciles();
		}, FIELDS_RECONCILE_DELAY_MS);
	}

	private async drainFieldsBlockReconciles(): Promise<void> {
		const paths = [...this.pendingFieldsReconciles];
		this.pendingFieldsReconciles.clear();
		// One project snapshot per drain, however many notes a burst touched.
		const projects = new Map<string, ProjectSnapshot | null>();
		for (const path of paths) {
			try {
				await this.reconcileFieldsBlockAt(path, projects);
			} catch (error) {
				console.error(
					'Snowflake: could not reconcile the fields block',
					path,
					error,
				);
			}
		}
	}

	private async reconcileFieldsBlockAt(
		path: string,
		projects: Map<string, ProjectSnapshot | null>,
	): Promise<void> {
		const repository = this.projects.repository;
		if (repository.getFile(path) === null) return;
		const record = await repository.tryReadManaged(path);
		if (record === null || record.readOnly) return;
		const documentType = documentTypeOf(record.frontmatter);
		// A definition node's block is generated the same way, from where the
		// node sits and the description its properties carry, so a description
		// edited in the properties panel reaches the note it describes.
		if (documentType === 'definition') {
			const project = await this.projectOfPath(path);
			if (project === null) return;
			await this.projects.syncDefinitionNodeAt(project, path);
			return;
		}
		if (!isMemberDocumentType(documentType)) return;
		// Everything above costs one cached read; the project below costs a
		// load, so a note that carries no block never gets that far.
		if (
			readMarkedSection(
				record.content,
				MEMBER_FIELDS_SECTION_BY_DOCUMENT[documentType],
			) === null
		) {
			return;
		}
		const projectId = projectIdOf(record.frontmatter) ?? '';
		let project = projects.get(projectId);
		if (project === undefined) {
			project = await this.projectOfPath(path);
			projects.set(projectId, project);
		}
		if (project === null) return;
		await this.projects.reconcileMemberFieldsBlock(project, path);
	}

	private async handleVaultDelete(file: TAbstractFile): Promise<void> {
		// Before any guard: the parse cache lets the record go wherever the
		// file was, and forgetting can never change what a read returns.
		this.projects.repository.forget(file.path, {
			children: file instanceof TFolder,
		});
		this.projects.writingCount.forget(file.path, {
			children: file instanceof TFolder,
		});
		this.projects.mentions.forget(file.path, {
			children: file instanceof TFolder,
		});
		this.projects.analysis.forget(file.path, {
			children: file instanceof TFolder,
		});
		// The revision memo is keyed by project root: a deleted or archived
		// project folder takes its memo with it, and a deleted note simply
		// stops anchoring, which the derived standing already says.
		for (const store of this.projects.marginRecords) store.evict(file.path);
		this.projects.tasks.evict(file.path);
		this.sessions.noteDeleted(file.path, {
			children: file instanceof TFolder,
		});
		if (!this.touchesProject(file.path)) return;
		if (file instanceof TFile && isStickyNotePath(file.path)) {
			this.invalidateProjectHealth(file.path);
			this.scheduleStickyNoteNotify();
			return;
		}
		if (file instanceof TFile && isTaskFilePath(file.path)) {
			this.invalidateProjectHealth(file.path);
			this.scheduleTaskNotify();
			return;
		}
		// A project folder going takes its notes' surfaces with it.
		if (file instanceof TFolder) this.scheduleStickyNoteNotify();
		this.invalidateProjectHealth(file.path);
		this.detachProjectViews(file.path);
		this.scheduleRefresh(true);
		const recent = this.settings.recentProjectPath;
		if (recent !== null && isPathAtOrBelow(recent, file.path)) {
			this.settings.recentProjectPath = null;
			this.settings.recentStep = 1;
			this.currentProjectLocale = null;
			await this.saveSettings();
		}
	}

	/**
	 * Closes every dashboard and stream leaf showing a project at or below the
	 * path. A view left standing would sit on a project it can no longer find,
	 * whether the project went to the trash or into the archive.
	 */
	private detachProjectViews(path: string): void {
		for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)) {
			const statePath = leaf.getViewState().state?.projectPath;
			const dashboardPath =
				leaf.view instanceof SnowflakeDashboardView
					? leaf.view.getProjectPath()
					: typeof statePath === 'string'
						? statePath
						: null;
			if (dashboardPath !== null && isPathAtOrBelow(dashboardPath, path)) {
				leaf.detach();
			}
		}

		for (const leaf of this.app.workspace.getLeavesOfType(
			MANUSCRIPT_VIEW_TYPE,
		)) {
			const statePath = leaf.getViewState().state?.projectPath;
			if (typeof statePath === 'string' && isPathAtOrBelow(statePath, path)) {
				leaf.detach();
			}
		}
		for (const leaf of this.app.workspace.getLeavesOfType(
			STORY_STRUCTURE_VIEW_TYPE,
		)) {
			const statePath = leaf.getViewState().state?.projectPath;
			const projectPath =
				leaf.view instanceof SnowflakeStoryStructureView
					? leaf.view.projectPath()
					: typeof statePath === 'string' ? statePath : null;
			if (projectPath !== null && isPathAtOrBelow(projectPath, path)) {
				leaf.detach();
			}
		}
	}

	/**
	 * The projects a rename reaches, each as it stands after it.
	 *
	 * Two shapes, and asking which project the new path belongs to answers
	 * only the first. A note or a folder renamed INSIDE a project leaves the
	 * root alone, so the root that held it still holds it. A project's own
	 * folder renamed carries the root itself -- and the map this reads has not
	 * caught up, so the new name matches no known root at all, and a project
	 * asked for by that name comes back as nothing while every revision it
	 * holds is quietly left pointing at chapters under the old one. The
	 * pre-rename map is exactly the right thing to read here: it is the
	 * picture the paths in the file were written against. A moved project is
	 * then read at its new address, where its metadata note already stands.
	 */
	private async projectsCrossedByRename(
		oldPath: string,
		newPath: string,
	): Promise<ProjectSnapshot[]> {
		const roots = [...this.knownProjectRoots];
		const carried = roots.map((rootPath) => ({
			rootPath,
			movedRoot: movedWithRename(rootPath, oldPath, newPath),
		}));
		const touched = carried.filter(
			({ rootPath, movedRoot }) =>
				movedRoot !== null || isPathAtOrBelow(oldPath, rootPath),
		);
		if (touched.length === 0) return [];
		const discovered = await this.discoverProjects();
		const found: ProjectSnapshot[] = [];
		for (const { rootPath, movedRoot } of touched) {
			// Found by where the project stands NOW. The scan above ran after
			// the rename, so a project whose own folder moved answers to its
			// new root and to nothing else: asked for by the old one it comes
			// back as nothing at all, and every revision it holds is left
			// pointing at chapters under a name the vault no longer has.
			const project = discovered.find(
				(candidate) => candidate.rootPath === (movedRoot ?? rootPath),
			);
			if (project === undefined) continue;
			const projectFile =
				movedRoot === null
					? project.projectFile
					: (movedWithRename(project.projectFile, oldPath, newPath) ??
						project.projectFile);
			try {
				found.push(await this.projects.loadProject(projectFile));
			} catch {
				// A project the rename left unreadable keeps its revisions
				// where they are rather than losing them to a throw.
			}
		}
		return found;
	}

	/** The revision carries of the renames so far, each waiting on the one before. */
	private renameCarry: Promise<void> = Promise.resolve();

	/** Keep each workspace's saved project attached when its folder or note moves. */
	private async renameProjectViews(
		oldPath: string,
		newPath: string,
		project?: CreatedProject,
	): Promise<void> {
		const leaves = [DASHBOARD_VIEW_TYPE, STORY_STRUCTURE_VIEW_TYPE, MANUSCRIPT_VIEW_TYPE]
			.flatMap((type) => this.app.workspace.getLeavesOfType(type));
		await Promise.all(leaves.map(async (leaf) => {
			const saved = leaf.getViewState();
			const path = saved.state?.projectPath;
			if (typeof path !== 'string') return;
			// Vault events may already have moved this leaf by the time the
			// rename command returns with its new title.
			const projectPath = movedWithRename(path, oldPath, newPath) ??
				(project !== undefined && path === project.path ? path : null);
			if (projectPath === null) return;
			const anchor = saved.state?.anchorPath;
			const anchorPath = typeof anchor === 'string'
				? movedWithRename(anchor, oldPath, newPath) ?? anchor
				: anchor;
			await leaf.setViewState({
				...saved,
				state: {
					...saved.state,
					projectPath,
					...(saved.type === MANUSCRIPT_VIEW_TYPE ? { anchorPath } : {}),
					...(saved.type === DASHBOARD_VIEW_TYPE && project !== undefined
						? { projectTitle: project.title } : {}),
				},
			});
		}));
	}

	private async handleVaultRename(
		file: TAbstractFile,
		oldPath: string,
	): Promise<void> {
		// Before any guard: the parse cache lets the old path's record go. The
		// new path caches itself on its next read. The counts go with it: a
		// note's size and modified time both survive a rename, so a count left
		// under a path another note moves into would be handed straight back.
		this.projects.repository.forget(oldPath, {
			children: file instanceof TFolder,
		});
		this.projects.writingCount.forget(oldPath, {
			children: file instanceof TFolder,
		});
		this.projects.mentions.forget(oldPath, {
			children: file instanceof TFolder,
		});
		this.projects.analysis.forget(oldPath, {
			children: file instanceof TFolder,
		});
		for (const store of this.projects.marginRecords) store.evict(oldPath);
		// User data follows its note: a renamed chapter keeps its revisions,
		// where the caches above simply recompute under the new name. Carried
		// in the order the renames came, one after another: a renumbering
		// renames dependent notes back to back, and a later carry overtaking
		// an earlier one would file a note's revisions under the name another
		// note had just taken.
		this.renameCarry = this.renameCarry
			.then(async () => {
				let carried = false;
				for (const project of await this.projectsCrossedByRename(
					oldPath,
					file.path,
				)) {
					for (const store of this.projects.marginRecords) {
						if (await store.renameNotePaths(project, oldPath, file.path)) {
							carried = true;
						}
					}
				}
				if (carried) await this.announceMarginRecordsChanged();
			})
			.catch(() => undefined);
		this.sessions.notePathRenamed(oldPath, file.path);
		// A sticky note renamed or moved keeps its identity in its frontmatter:
		// the surfaces find it again by id. Its health can move with it -- a
		// note dragged out of the folder stops being one, and a note dragged
		// in is read as one -- so the verdict is re-read as after a save.
		if (file instanceof TFile) {
			const wasSticky = isStickyNotePath(oldPath) && this.touchesProject(oldPath);
			const isSticky = isStickyNotePath(file.path) && this.touchesProject(file.path);
			if (wasSticky || isSticky) {
				this.invalidateProjectHealth(oldPath);
				this.invalidateProjectHealth(file.path);
				this.scheduleStickyNoteNotify();
				// A note renamed within the folder concerns the sticky surfaces
				// alone. One carried across the folder's line -- a chapter
				// dragged in, a note dragged out -- is one the manuscript and
				// the dashboards must hear of as well, below.
				if (wasSticky && isSticky) return;
			}
			// The task file moved in or out of its folder: the board reads
			// again, and the move is a project change like any other below.
			const wasTasks = isTaskFilePath(oldPath) && this.touchesProject(oldPath);
			const isTasks = isTaskFilePath(file.path) && this.touchesProject(file.path);
			if (wasTasks || isTasks) {
				this.invalidateProjectHealth(oldPath);
				this.invalidateProjectHealth(file.path);
				this.scheduleTaskNotify();
			}
		}
		// A project folder moving takes its notes' surfaces with it.
		if (file instanceof TFolder) this.scheduleStickyNoteNotify();
		// The configured root travels with its folder. Leaving the setting on a
		// path that no longer exists would empty the dashboard while every
		// project note is still on disk. This is checked before the containment
		// test below, which cannot see a rename of a folder *above* the root.
		const movedRoot = movedWithRename(
			this.settings.projectRoot,
			oldPath,
			file.path,
		);
		if (movedRoot !== null) this.settings.projectRoot = movedRoot;

		// A project folder can be carried across the line the scan draws by
		// hand: dragged into the archive, or dragged back out of it. Neither
		// end of that move looks like anything the ordinary tests know — the
		// old path stops being a known root the moment it leaves, and the new
		// one is a folder rather than the note the scan recognises — so the
		// folder itself is asked whether it holds a project.
		const leftTheRoot =
			file instanceof TFolder &&
			this.knownProjectRoots.has(oldPath) &&
			parentPath(file.path) !== this.settings.projectRoot;
		const joinedTheRoot =
			file instanceof TFolder &&
			!this.knownProjectRoots.has(oldPath) &&
			parentPath(file.path) === this.settings.projectRoot &&
			this.holdsProjectMetadata(file.path);

		if (
			movedRoot === null &&
			!leftTheRoot &&
			!joinedTheRoot &&
			!this.touchesProject(oldPath) &&
			!this.touchesProject(file.path)
		) {
			return;
		}

		this.invalidateProjectHealth(oldPath);
		this.invalidateProjectHealth(file.path);
		// Whatever the scan holds was true of the old arrangement, so it is
		// dropped at once: a reader in the next tick must never be handed a
		// project under the name it has just stopped having.
		this.invalidateProjectDiscovery();
		// Refilling the path-to-project map is the part that costs a walk --
		// the untimed tracking resolves against it on every edit -- so that
		// is coalesced: a folder move fires one rename per descendant, and
		// rescanning per event would walk the vault once per file.
		this.scheduleProjectRescan();
		if (leftTheRoot) {
			// Views cannot follow a project out of the scan's reach, and a
			// stream left in a background tab never notices on its own.
			this.detachProjectViews(oldPath);
		} else {
			await this.renameProjectViews(oldPath, file.path);
		}

		const recent = this.settings.recentProjectPath;
		const movedRecent =
			recent === null ? null : movedWithRename(recent, oldPath, file.path);
		if (movedRecent !== null && recent !== null) {
			const projectNoteStayedInFolder =
				recent !== oldPath || parentPath(oldPath) === parentPath(movedRecent);
			this.settings.recentProjectPath =
				projectNoteStayedInFolder &&
				this.isProjectPath(movedRecent) &&
				this.isDirectProjectFile(movedRecent)
					? movedRecent
					: null;
		}
		if (movedRoot !== null || movedRecent !== null) await this.saveSettings();
		this.scheduleRefresh(true);
		// A folder dragged into a definition tree brings its subfolders along,
		// and every one of them is a node from this moment on.
		if (file instanceof TFolder) this.scheduleDefinitionMaterialize(file.path);
	}

	private isProjectPath(path: string): boolean {
		return isPathAtOrBelow(path, this.settings.projectRoot);
	}

	/**
	 * Whether a folder holds a project's canonical metadata note, which is what
	 * makes it a project the scan can find. Two lookups in the file map and no
	 * reads, so a Vault event can afford to ask.
	 */
	private holdsProjectMetadata(folderPath: string): boolean {
		return Object.values(PROJECT_PATH_LAYOUTS).some(
			(layout) =>
				this.projects.repository.getFile(
					normalizePath(
						`${folderPath}/${layout.directories.system}/${layout.projectFileName}`,
					),
				) !== null,
		);
	}

	private isDirectProjectFile(path: string): boolean {
		const fileName = basename(path);
		const layout = Object.values(PROJECT_PATH_LAYOUTS).find(
			(candidate) => candidate.projectFileName === fileName,
		);
		if (!layout) return false;
		const systemFolder = parentPath(path);
		if (basename(systemFolder) !== layout.directories.system) return false;
		const projectFolder = parentPath(systemFolder);
		return parentPath(projectFolder) === this.settings.projectRoot;
	}

	/**
	 * One project rescan for a whole burst of arrangement changes. The timer
	 * lives on the workspace window like the refresh beat's. Dropping the
	 * stale scan is the caller's to do, and immediately: this only refills
	 * what was dropped, and a reader that got there first has already done
	 * the work for it.
	 */
	private scheduleProjectRescan(): void {
		const workspaceWindow = this.app.workspace.containerEl.win;
		if (this.projectRescanTimer !== null) {
			workspaceWindow.clearTimeout(this.projectRescanTimer);
		}
		this.projectRescanTimer = workspaceWindow.setTimeout(() => {
			this.projectRescanTimer = null;
			void this.discoverProjects().catch((error: unknown) => {
				this.showError(error);
			});
		}, REFRESH_DELAY_MS);
	}

	private scheduleRefresh(refreshProjectLocales = false): void {
		this.refreshProjectLocales ||= refreshProjectLocales;
		const workspaceWindow = this.app.workspace.containerEl.win;
		if (this.refreshTimer !== null) {
			workspaceWindow.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = workspaceWindow.setTimeout(() => {
			this.refreshTimer = null;
			const syncLocales = this.refreshProjectLocales;
			this.refreshProjectLocales = false;
			void (async () => {
				if (syncLocales) await this.syncCurrentProjectLocale();
				await this.refreshDashboards();
			})().catch((error: unknown) => {
				this.showError(error);
			});
		}, REFRESH_DELAY_MS);
	}

	private async refreshDashboards(
		options: { streams?: boolean } = {},
	): Promise<void> {
		await Promise.all(
			this.app.workspace
				.getLeavesOfType(DASHBOARD_VIEW_TYPE)
				.map(async (leaf) => {
					if (!(leaf.view instanceof SnowflakeDashboardView)) return;
					// An off-screen dashboard keeps its stale frame and pays
					// the refresh at reveal instead -- the bargain the
					// manuscript streams already strike.
					if (!leaf.view.containerEl.isShown()) {
						leaf.view.queueRefreshWhenShown();
						return;
					}
					await leaf.view.refresh();
				}),
		);
		await Promise.all(
			this.app.workspace
				.getLeavesOfType(STORY_STRUCTURE_VIEW_TYPE)
				.map(async (leaf) => {
					if (!(leaf.view instanceof SnowflakeStoryStructureView)) return;
					if (!leaf.view.containerEl.isShown()) {
						leaf.view.queueRefreshWhenShown();
						return;
					}
					await leaf.view.refresh();
				}),
		);
		this.rerenderStatisticsViews();
		if (options.streams !== false) await this.refreshManuscriptStreams();
		this.refreshManagedEditors();
	}

	private refreshManagedEditors(relock = false): void {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const editorView = findEditorViewForMarkdownInfo(
				leaf.view as unknown as MarkdownFileInfo,
			);
			if (editorView === null) continue;
			if (relock) setManagedBoundariesUnlocked(editorView, false);
			refreshManagedSectionDecorations(editorView);
		}
	}

	private async refreshManagedEditorLocalesAfterLayout(): Promise<void> {
		// The restored workspace can finish attaching editor views after plugin
		// onload. Re-read project metadata at that point, reconfigure extensions,
		// then refresh every already-open Markdown editor on the next frame.
		await this.syncCurrentProjectLocale();
		this.app.workspace.updateOptions();
		await nextAnimationFrame(this.app.workspace.containerEl.win);
		this.refreshManagedEditors();
	}

	private async loadSettings(): Promise<void> {
		this.settings = sanitizeSettings(await this.loadData());
	}

	private currentLocale(): 'en' | 'zh-CN' {
		return resolveLocale(
			this.settings.uiLocale,
			moment.locale(),
			this.currentProjectLocale ?? this.resolvedDefaultProjectLocale(),
		);
	}

	private resolvedDefaultProjectLocale(): 'en' | 'zh-CN' {
		return this.settings.defaultProjectLocale === 'system'
			? resolveLocale('system', moment.locale())
			: this.settings.defaultProjectLocale;
	}

	private async syncCurrentProjectLocale(): Promise<void> {
		const projects = await this.discoverProjects();
		const recent = this.settings.recentProjectPath;
		if (recent === null) {
			this.currentProjectLocale = null;
			return;
		}
		this.currentProjectLocale =
			projects.find((project) => project.projectFile === recent)?.locale ?? null;
		// The sidebar has no project of its own and follows this one, labels
		// included, so the moment the language is settled is the moment it has
		// to be redrawn in it.
		this.rerenderStatisticsViews();
	}

	/**
	 * What the sidebar's mounted labels depend on: the language they were
	 * written in and the project they speak for. While neither moves, a
	 * rerender is a no-op, so the vault events that ask for one on every
	 * save cost nothing.
	 */
	private statisticsFingerprint(): string {
		return `${this.currentLocale()}|${this.settings.recentProjectPath ?? ''}`;
	}

	private rerenderStatisticsViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			STATISTICS_VIEW_TYPE,
		)) {
			if (leaf.view instanceof SnowflakeStatisticsView) leaf.view.rerender();
		}
		for (const leaf of this.app.workspace.getLeavesOfType(
			STICKY_NOTES_VIEW_TYPE,
		)) {
			if (leaf.view instanceof SnowflakeStickyNotesView) leaf.view.rerender();
		}
		for (const leaf of this.app.workspace.getLeavesOfType(
			STORY_STRUCTURE_VIEW_TYPE,
		)) {
			if (leaf.view instanceof SnowflakeStoryStructureView) leaf.view.rerender();
		}
		if (this.stickyFloatsProject !== this.settings.recentProjectPath) {
			void this.reconcileStickyFloats().catch((error: unknown) => {
				this.showError(error);
			});
		}
		this.repaintProjectSurfaces();
	}

	/**
	 * The status bar says the same numbers in the current project's language,
	 * so a change of project is a change it has to be told about. Both halves
	 * keep what they last painted and repaint nothing when it matches, and the
	 * numbers do not move when only the language does -- so the memory of what
	 * was shown is cleared first, and the repaint takes.
	 */
	private repaintProjectSurfaces(): void {
		this.sessionShown = null;
		this.writingCountShown = null;
		this.repaintWritingSession();
		this.scheduleWritingCountRefresh(0);
	}

	private async getCurrentProject(): Promise<ProjectSnapshot | null> {
		const recent = this.settings.recentProjectPath;
		if (recent !== null) {
			try {
				const project = await this.projects.loadProject(recent);
				this.currentProjectLocale = project.locale;
				return project;
			} catch (error) {
				if (!(error instanceof ManagedFileNotFoundError)) throw error;
				this.settings.recentProjectPath = null;
				this.currentProjectLocale = null;
				await this.saveSettings();
			}
		}

		const first = (await this.discoverProjects())[0];
		if (first === undefined) {
			this.currentProjectLocale = null;
			return null;
		}
		this.settings.recentProjectPath = first.projectFile;
		await this.saveSettings();
		const project = await this.projects.loadProject(first);
		this.currentProjectLocale = project.locale;
		return project;
	}

	private async requireCurrentProject(): Promise<ProjectSnapshot> {
		const project = await this.getCurrentProject();
		if (project === null) throw new Error(this.t('messages.noCurrentProject'));
		return project;
	}

	/** A captured form or queued action never changes the selected project. */
	private requireProject(projectPath?: string): Promise<ProjectSnapshot> {
		return projectPath === undefined
			? this.requireCurrentProject()
			: this.projects.loadProject(projectPath);
	}

	private async resolveStepArtifactPath(
		project: ProjectRef,
		step: StepId,
		characters: CharacterRecord[],
		scenes: SceneRecord[],
	): Promise<string | null> {
		if (step === 3 || step === 5 || step === 7) {
			return characters[0]?.path ?? null;
		}
		if (step === 8 || step === 9) return scenes[0]?.path ?? null;
		return this.projects.getArtifactPath(project, step);
	}

	private readStepOneContent(content: string | undefined): StepFields {
		return Object.fromEntries(
			STEP_ONE_SECTION_IDS.map((key) => [
				key,
				content ? (readMarkedSection(content, key) ?? '') : '',
			]),
		);
	}

	private readStepTwoContent(content: string | undefined): StepFields {
		return Object.fromEntries(
			STEP_TWO_SECTION_IDS.map((key) => [
				key,
				content ? (readMarkedSection(content, key) ?? '') : '',
			]),
		);
	}

	private readArtifactSection(
		content: string | undefined,
		sectionId: string,
	): string {
		return content ? (readMarkedSection(content, sectionId) ?? '') : '';
	}

	private characterViewModel(
		character: CharacterRecord,
		t: Translate,
		categoryRoot: string,
	): CharacterViewModel {
		return {
			id: character.characterId,
			path: character.path,
			name: character.name,
			rank: character.rank,
			type: character.type,
			progressStatus: character.progressStatus,
			aliases: character.aliases,
			// Every category, the role among them: the picker owns the whole list
			// now, so anything held back here would be dropped on the next save.
			categoryPaths: character.categories.map((raw) =>
				categoryDisplayPath(raw, categoryRoot),
			),
			oneSentenceStoryline: character.oneSentenceStoryline,
			oneParagraphStoryline: character.oneParagraphStoryline,
			motivation: character.motivation,
			goal: character.goal,
			conflict: character.conflict,
			growth: character.growth,
			worldStatus: character.worldStatus,
			customFields: character.customFields,
			relationships: character.relationships,
			revision: character.revision,
			readOnly: character.readOnly,
			healthIssues: this.issueViewModels(
				character.path,
				character.sectionHealth,
				t,
			),
		};
	}

	private sceneViewModel(
		scene: SceneRecord,
		characterNames: ReadonlyMap<string, string>,
		t: Translate,
		categoryRoot: string,
	): SceneViewModel {
		return {
			id: scene.sceneId,
			path: scene.path,
			title: scene.title,
			rank: scene.rank,
			povPath: scene.povPath ?? '',
			povName:
				scene.povPath === null
					? ''
					: scene.povPath === SCENE_POV_OMNISCIENT
						? t('modal.scene.povOmniscient')
						: scene.povPath === SCENE_POV_MULTIPLE
							? t('modal.scene.povMultiple')
							: (characterNames.get(scene.povPath) ??
								// The character is gone, so its note name is the only name
								// left to show for it.
								(scene.povPath.split('/').pop() ?? scene.povPath).replace(
									/\.md$/u,
									'',
								)),
			povMissing:
				scene.povPath !== null &&
				scene.povPath !== SCENE_POV_OMNISCIENT &&
				scene.povPath !== SCENE_POV_MULTIPLE &&
				!characterNames.has(scene.povPath),
			times: scene.times,
			locations: scene.locations,
			characterPaths: scene.characters,
			conflict: scene.conflict,
			color: scene.color,
			linkedManuscript: scene.linkedManuscript.map((raw) => {
				const link = parseWikiLink(raw);
				return {
					raw,
					linktext: link?.linktext ?? raw,
					target: link?.target ?? raw,
					label: wikiLinkLabel(raw),
				};
			}),
			progressStatus: scene.progressStatus,
			aliases: scene.aliases,
			categoryPaths: scene.categories.map((raw) =>
				categoryDisplayPath(raw, categoryRoot),
			),
			worldStatus: scene.worldStatus,
			customFields: scene.customFields,
			relationships: scene.relationships,
			events: scene.events,
			revision: scene.revision,
			readOnly: scene.readOnly,
			healthIssues: this.issueViewModels(
				scene.path,
				scene.sectionHealth,
				t,
			),
		};
	}

	private entityViewModel(
		entity: WorldbuildingRecord,
		t: Translate,
		categoryRoot: string,
	): WorldbuildingEntityViewModel {
		return {
			id: entity.entityId,
			path: entity.path,
			name: entity.name,
			kind: entity.kind,
			rank: entity.rank,
			progressStatus: entity.progressStatus,
			aliases: entity.aliases,
			categoryPaths: entity.categories.map((raw) =>
				categoryDisplayPath(raw, categoryRoot),
			),
			description: entity.description,
			timeKind: entity.timeKind,
			timeStart: entity.timeStart,
			timeEnd: entity.timeEnd,
			timeStartMissing: this.termMissing(entity.timeStart, entity.path),
			timeEndMissing: this.termMissing(entity.timeEnd, entity.path),
			worldStatus: entity.worldStatus,
			customFields: entity.customFields,
			relationships: entity.relationships,
			revision: entity.revision,
			readOnly: entity.readOnly,
			healthIssues: this.issueViewModels(entity.path, entity.sectionHealth, t),
		};
	}

	/**
	 * Whether a stored term names a note that is no longer there. Resolved the
	 * way the health check resolves it, so the table and the report never
	 * disagree about what is missing.
	 */
	private termMissing(raw: string, sourcePath: string): boolean {
		const value = raw.trim();
		if (value.length === 0) return false;
		const term = parseTerm(value);
		return (
			term.kind === 'link' &&
			this.projects.repository.resolveLink(term.path, sourcePath) === null
		);
	}

	private issueViewModels(
		path: string,
		inspection: ManagedSectionsInspection,
		t: Translate,
	): ManagedSectionIssueViewModel[] {
		return inspection.issues.map((issue) => ({
			path,
			sectionId: issue.sectionId,
			sectionLabel: this.sectionLabel(issue, t),
			code: issue.code,
			action: null,
			message: t(`editor.managedSection.issue.${issue.code}`),
			// A marker issue is about the section it names and nothing else, so
			// it has no list of its own to show.
			names: [],
			blocking:
				issue.code !== 'unknown-section' &&
				issue.code !== 'unrecognized-record',
			kind: 'section',
			stepIds: [],
			canOpen: true,
			repairable: false,
			repairField: null,
		}));
	}

	private sectionLabel(issue: ManagedMarkerIssue, t: Translate): string {
		if (issue.sectionId === null) {
			return t('editor.managedSection.damagedTitle');
		}
		const key = `editor.managedSection.name.${issue.sectionId}`;
		const translated = t(key);
		return translated === key ? issue.sectionId : translated;
	}

	private requireExpectedRevision(revision: string | undefined): string {
		if (revision === undefined || revision.length === 0) {
			throw new Error(this.t('errors.concurrentChange'));
		}
		return revision;
	}

	private rethrowLocalizedMutationError(error: unknown): never {
		if (error instanceof DuplicateNameError) {
			const key =
				error.kind === 'character'
					? 'errors.characterExists'
					: error.kind === 'scene'
						? 'errors.sceneExists'
						: error.kind === 'project'
							? 'errors.projectExists'
							: 'errors.entityExists';
			throw new Error(this.t(key, { name: error.requestedName }));
		}
		if (error instanceof KindRegistrationRefusedError) {
			throw new Error(
				this.t('errors.kindNotRegistrable', { name: error.kindId }),
			);
		}
		if (error instanceof ConcurrentChangeError) {
			throw new Error(this.t('errors.concurrentChange'));
		}
		if (error instanceof UnsafeSectionError) {
			throw new Error(this.t('editor.managedSection.damagedDescription'));
		}
		if (error instanceof UnsupportedSchemaError) {
			throw new Error(this.t('editor.managedSection.readOnlyNewerSchema'));
		}
		if (error instanceof ArchiveFolderIsProjectError) {
			throw new Error(this.t('errors.archiveFolderIsProject'));
		}
		throw error;
	}

	private async openCreateProjectModal(
		t: Translate = this.globalT,
		defaultLocale: 'en' | 'zh-CN' = this.getDefaultProjectLocale(),
	): Promise<void> {
		try {
			const existing = await this.discoverProjects();
			new CreateProjectModal(
				this.app,
				t,
				defaultLocale,
				existing.map((project) => project.title),
				async (request) => {
					const vaultWasEmpty = (await this.discoverProjects()).length === 0;
					const project = await this.createProject(request);
					if (
						!vaultWasEmpty ||
						!(await this.reuseEmptyDashboard(project))
					) {
						await this.selectProject(project.path);
					}
					await this.refreshDashboards();
				},
			).open();
		} catch (error) {
			this.showError(error);
		}
	}

	/** What a kind is called wherever a command has to ask which one. */
	private kindLabel(kind: EntityKindId): string {
		if (kind === 'character' || kind === 'scene') {
			return this.t(`definition.kind.${kind}`);
		}
		return isWorldbuildingKind(kind) ? this.t(`worldbuilding.kind.${kind}`) : kind;
	}

	/**
	 * Asks which kind, over every kind a project keeps. Characters and scenes
	 * stand with the worldbuilding kinds here, as they do in the rail and in
	 * each of the three vocabularies. Null when the author walked away.
	 */
	private async askEntityKind(
		project: ProjectSnapshot,
	): Promise<EntityKindId | null> {
		return promptForDefinitionKind(
			this.app,
			this.t,
			entityKindIds(project.worldbuildingKinds).map((kind) => ({
				kind,
				label: this.kindLabel(kind),
			})),
		);
	}

	private async addWorldbuildingNote(): Promise<void> {
		const project = await this.requireCurrentProject();
		const kind = await this.askEntityKind(project);
		if (kind === null) return;
		const view = await this.revealDashboard();
		await view?.startEntityCreation(kind);
	}

	private async startWorldbuildingKind(): Promise<void> {
		await this.requireCurrentProject();
		const view = await this.revealDashboard();
		view?.startKindCreation();
	}

	private async openWorldbuildingBase(): Promise<void> {
		const project = await this.requireCurrentProject();
		const kind = await this.askEntityKind(project);
		if (kind === null) return;
		// The two oldest bases are named for their contents rather than their
		// kind, from before the kinds were a list anything could join.
		const base =
			kind === 'character' ? 'characters' : kind === 'scene' ? 'scenes' : kind;
		await this.openProjectBase(base);
		await this.refreshDashboards();
	}

	/** Adds one entry to a vocabulary, under whichever kind keeps it. */
	private async addDefinitionEntry(id: DefinitionFileChoice): Promise<void> {
		const project = await this.requireCurrentProject();
		const kind = await this.askEntityKind(project);
		if (kind === null) return;
		const created = await promptForDefinitionPath(this.app, this.t, id, '');
		if (created === null) return;
		const result = await this.addDefinitionPath(
			kind,
			id,
			created.path,
			created.description,
		);
		if (!result.ok) {
			new Notice(
				result.code === 'too-deep'
					? this.t('form.definition.tooDeep', { count: MAX_DEFINITION_DEPTH })
					: this.t('form.definition.invalid', { name: result.segment }),
			);
			return;
		}
		await this.refreshDashboards();
	}

	/**
	 * The palette's way in to the same form the dashboard's own button opens.
	 *
	 * Asked of the dashboard rather than built here. A member form offers the
	 * universal rows -- aliases, category, the record editors -- only when it is
	 * handed the project context they draw on, and a form built straight from a
	 * command has none: the command quietly opened a shorter form than the
	 * button did, missing the very fields these notes are filed by. The
	 * worldbuilding command already went this way; the other two did not.
	 */
	private async openCreateCharacterModal(): Promise<void> {
		try {
			await this.requireCurrentProject();
			const view = await this.revealDashboard();
			await view?.startEntityCreation('character', false);
		} catch (error) {
			this.showError(error);
		}
	}

	/** As above: the dashboard's own scene form, opened from the palette. */
	private async openCreateSceneModal(): Promise<void> {
		try {
			await this.requireCurrentProject();
			const view = await this.revealDashboard();
			await view?.startEntityCreation('scene', false);
		} catch (error) {
			this.showError(error);
		}
	}

	private showError(error: unknown): void {
		new Notice(error instanceof Error ? error.message : this.t('errors.unknown'));
	}

	private showRepairReport(report: RepairReportViewModel): void {
		// The forms these rows offer are filled from the dashboard's own model,
		// so the report opened from the command palette offers them only while a
		// dashboard for this project is open to ask.
		const dashboard = this.dashboardViewForRecentProject();
		new RepairReportModal(
			this.app,
			this.t,
			report,
			(path, sectionId) =>
				this.openManagedFile(path, sectionId ?? undefined),
			async (entry) => {
				await this.repairMissingStructureItem(
					entry.path,
					entry.repairField ?? undefined,
				);
				await this.refreshDashboards();
				return this.checkCurrentProject();
			},
			dashboard === null
				? null
				: async (memberId) => {
						await dashboard.editMemberById(memberId);
						await this.refreshDashboards();
						return this.checkCurrentProject();
					},
		).open();
	}

	async openSceneForm(intent: SceneFormIntent, projectPath?: string): Promise<string | null> {
		return this.withDashboardForm((view) => view.openSceneForm(intent), null, projectPath);
	}

	async openCharacterForm(id: string, projectPath?: string): Promise<void> {
		await this.withDashboardForm((view) => view.openCharacterForm(id), undefined, projectPath);
	}

	/** Opens a dashboard-owned form while keeping the requesting surface active. */
	private async withDashboardForm<T>(
		open: (view: SnowflakeDashboardView) => Promise<T>,
		fallback: T,
		projectPath = this.settings.recentProjectPath,
	): Promise<T> {
		const recent = projectPath;
		if (recent === null) return fallback;
		const existing = this.findOpenProjectLeaf(recent);
		let view = existing?.view instanceof SnowflakeDashboardView ? existing.view : null;
		let background = false;
		if (view === null) {
			// A restored tab may still hold a deferred view. Find it by its
			// saved project path before deciding a new dashboard is needed.
			const from = this.app.workspace.getMostRecentLeaf(
				this.app.workspace.rootSplit,
			);
			let leaf = this.findOpenProjectLeaf(recent);
			if (leaf === undefined) {
				leaf = this.app.workspace.getLeaf('tab');
				await leaf.setViewState({
					type: DASHBOARD_VIEW_TYPE,
					active: false,
					state: { projectPath: recent, selectedStep: this.getRecentStep() },
				});
			}
			await leaf.loadIfDeferred();
			// Creating a tab can take the front; keep the requesting surface active.
			if (
				from !== null && from !== leaf &&
				this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit) === leaf
			) {
				await this.app.workspace.revealLeaf(from);
				this.app.workspace.setActiveLeaf(from, { focus: true });
			}
			view = leaf.view instanceof SnowflakeDashboardView ? leaf.view : null;
			background = true;
		}
		if (view === null || view.getProjectPath() !== recent) return fallback;
		try {
			return await open(view);
		} finally {
			// A frame drawn while hidden draws again at its first reveal.
			if (background) view.queueRefreshWhenShown();
		}
	}

	/** The open dashboard showing the project the report is about, if any. */
	private dashboardViewForRecentProject(): SnowflakeDashboardView | null {
		const recent = this.settings.recentProjectPath;
		if (recent === null) return null;
		const leaf = this.findOpenProjectLeaf(recent);
		return leaf?.view instanceof SnowflakeDashboardView ? leaf.view : null;
	}
}

function parentPath(path: string): string {
	const index = path.lastIndexOf('/');
	return index < 0 ? '' : path.slice(0, index);
}

function basename(path: string): string {
	const index = path.lastIndexOf('/');
	return index < 0 ? path : path.slice(index + 1);
}

function nextAnimationFrame(targetWindow: Window): Promise<void> {
	return new Promise((resolve) => {
		targetWindow.requestAnimationFrame(() => resolve());
	});
}
