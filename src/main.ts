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
	DEFINITION_FILE_IDS,
	SCENE_POV_MULTIPLE,
	SCENE_POV_OMNISCIENT,
	STEP_DEFINITIONS,
	STEP_ONE_SECTION_IDS,
	STEP_TWO_SECTION_IDS,
	countWriting,
	countableProse,
	countsCharacters,
	entityKindIds,
	getFirstIncompleteStep,
	isDocumentType,
	isStepId,
	isWorldbuildingKind,
	TEMPLATE_SECTION_IDS,
	managedSectionHighlightsForStep,
	managedSectionsForDocument,
	primaryManagedSectionForStep,
	formatClock,
	WRITING_MODES,
	WRITING_SESSION_TYPES,
	type DocumentType,
	type WritingSessionTiming,
	type WritingSessionGoal,
	type WritingSessionType,
	type EntityKindId,
	type StepId,
	type StepStatus,
	type WorldbuildingKindId,
	type WritingCount,
	type WritingCountMode,
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
	UnsafeSectionError,
	UnsupportedSchemaError,
	documentTypeOf,
	parseMarkdownFrontmatter,
	projectIdOf,
} from './repository';
import {
	SnowflakeProjectService,
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
	type MemberUsage,
	type NoteCountOptions,
	type ProjectRef,
	type ProjectSnapshot,
	type SaveCustomFieldTemplateResult,
	type SceneRecord,
	type WorldbuildingRecord,
	type WritingCountScope,
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
import {
	MANUSCRIPT_VIEW_TYPE,
	NEXT_FOCUS_LEVEL,
	SnowflakeManuscriptView,
} from './ui/manuscript-view';
import {
	routeNotePane,
	type NotePaneLeaf,
	type NotePaneRoute,
} from './ui/note-pane';
import {
	STATISTICS_VIEW_TYPE,
	SnowflakeStatisticsView,
} from './ui/statistics-view';
import type {
	SessionPanelBridge,
	SessionPanelContext,
	SessionSetup,
} from './ui/session-panel';
import {
	ConfirmMemberDeletionModal,
	CreateCharacterModal,
	CreateProjectModal,
	CreateSceneModal,
	ManageProjectsModal,
	ManagedBoundaryUnlockModal,
	RepairReportModal,
	promptForNewCharacter,
	promptForSegmentTitle,
	type CharacterOption,
	type CreateCharacterRequest,
	type CreateProjectRequest,
	type CreateSceneRequest,
	promptForDefinitionKind,
	promptForDefinitionPath,
	DailyWordGoalModal,
	SessionSetupModal,
	type EntityFormRequest,
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
import { kindEntities } from './ui/view-model';

const REFRESH_DELAY_MS = 250;
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
 * How much room a scrollbar takes in this window. Overlaid ones, and the ones
 * Obsidian hides outright, take none; the ones Windows and Linux draw take about
 * a dozen pixels. The panels hand that much back out of the padding they already
 * keep, so a scrollbar costs no extra room -- but only a measurement can say
 * whether there is anything to hand back, and a theme can change the answer.
 */
function measureScrollbarWidth(targetDocument: Document): number {
	const probe = targetDocument.body.createDiv();
	// Dressed here rather than from the stylesheet: this runs before the plugin's
	// own stylesheet reaches the document, and a probe with no scrollbar to
	// measure would quietly report that a scrollbar costs nothing.
	probe.setCssStyles({
		position: 'absolute',
		top: '-9999px',
		width: '100px',
		height: '100px',
		overflowY: 'scroll',
		visibility: 'hidden',
	});
	const width = probe.offsetWidth - probe.clientWidth;
	probe.remove();
	return width;
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
	private refreshTimer: number | null = null;
	private refreshProjectLocales = false;
	/** The writing count in the status bar, and the text span inside it. */
	private writingCountItem: HTMLElement | null = null;
	private writingCountText: HTMLElement | null = null;
	sessions!: WritingSessionService;
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
	 * The plugin's own field the count last followed focus to. Focus events
	 * arrive from every corner of the app, and most of them change nothing
	 * about which writing is being counted.
	 */
	private writingCountField: Element | null = null;
	/** Set on teardown: no count may paint into a status bar that is gone. */
	private unloading = false;
	/** What is selected in the focused native Markdown editor, or null. */
	private editorFocus: EditorFocusReport | null = null;
	/** Which sidebars solo folded away, so leaving it unfolds only those. */
	private soloCollapsed: { left: boolean; right: boolean } | null = null;
	/** Whether solo took the window full screen, so leaving it lets go. */
	private soloFullscreen = false;
	private readonly motionDocuments = new Set<Document>();
	private readonly scrollbarDocuments = new Set<Document>();
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
			}),
		);
		this.applyMotionPreference();
		// A theme can restyle scrollbars, which changes how much room they take.
		this.registerEvent(
			this.app.workspace.on('css-change', () => this.publishScrollbarWidth()),
		);
		this.publishScrollbarWidth();
		this.register(() => {
			for (const targetDocument of this.motionDocuments) {
				targetDocument.body.classList.remove(REDUCE_MOTION_CLASS);
			}
			this.motionDocuments.clear();
			for (const targetDocument of this.scrollbarDocuments) {
				targetDocument.body.style.removeProperty(SCROLLBAR_WIDTH_PROPERTY);
			}
			this.scrollbarDocuments.clear();
		});
		this.projects = new SnowflakeProjectService(
			this.app.vault,
			this.app.fileManager,
			this.app.metadataCache,
			this.settings.projectRoot,
		);
		this.sessions = new WritingSessionService({
			repository: this.projects.repository,
			manuscript: this.projects.manuscript,
			writingCount: this.projects.writingCount,
			recovery: {
				load: () => this.app.loadLocalStorage(SESSION_RECOVERY_KEY) as unknown,
				save: (snapshot) => {
					this.app.saveLocalStorage(SESSION_RECOVERY_KEY, snapshot);
				},
			},
			deviceId: () => this.writingSessionDeviceId(),
			// The plugin-lifetime clock: the main window's, so a popout
			// closing can never take the session's ticker with it.
			timers: {
				set: (handler, ms) => window.setTimeout(handler, ms),
				clear: (handle) => window.clearTimeout(handle as number),
			},
		});
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
			(leaf) => new SnowflakeStatisticsView(leaf, this.writingSessions()),
		);
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
		this.registerCommands();
		this.registerFileMenu();
		this.registerWritingCount();
		addIcon(POMODORO_ICON, POMODORO_SVG);
		this.registerWritingSessions();
		this.addSettingTab(new SnowflakeSettingTab(this.app, this));
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
			this.resolveProjectScanReady();
			this.registerVaultListeners();
			this.registerEvent(
				this.app.workspace.on('active-leaf-change', (leaf) => {
					this.applyManuscriptModePresence();
					// What was reported from the editor just left must not stand
					// in for whatever is in front now.
					this.editorFocus = null;
					this.scheduleWritingCountRefresh(0);
					void this.activateDashboardLeaf(leaf).catch((error: unknown) => {
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
		if (this.refreshTimer !== null) {
			this.app.workspace.containerEl.win.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
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
				hasStructureIssues: snapshot.structureIssues.length > 0,
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
		for (const project of projects) {
			this.projectLocalesById.set(project.id, project.locale);
			this.knownProjectRoots.add(project.rootPath);
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

		await Promise.all(
			this.app.workspace
				.getLeavesOfType(DASHBOARD_VIEW_TYPE)
				.map(async (leaf) => {
					if (
						leaf.view instanceof SnowflakeDashboardView &&
						leaf.view.getProjectPath() === oldPath
					) {
						await leaf.view.showRenamedProject(renamed);
					}
				}),
		);
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
		// by side, since none of the four listings needs another.
		const [category, worldStatus, relationship, customFieldTemplates] =
			await Promise.all([
				this.projects.listDefinitionForest(project, 'category'),
				this.projects.listDefinitionForest(project, 'world-status'),
				this.projects.listDefinitionForest(project, 'relationship'),
				this.projects.listCustomFieldTemplates(project),
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
				blocking: true,
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
	): Promise<CharacterOption> {
		const project = await this.requireCurrentProject();
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
	): Promise<void> {
		const project = await this.requireCurrentProject();
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
	): Promise<{ id: string; path: string }> {
		const project = await this.requireCurrentProject();
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
	): Promise<{ id: string; path: string }> {
		const project = await this.requireCurrentProject();
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

	async kindTemplatePath(kind: EntityKindId): Promise<string | null> {
		const project = await this.requireCurrentProject();
		return this.projects.kindTemplatePath(project, kind);
	}

	async setKindTemplate(
		kind: EntityKindId,
		path: string | null,
	): Promise<void> {
		const project = await this.requireCurrentProject();
		try {
			await this.projects.setKindTemplate(project, kind, path);
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async kindTemplateFields(kind: EntityKindId): Promise<CustomField[]> {
		const project = await this.requireCurrentProject();
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
	): Promise<SaveCustomFieldTemplateResult> {
		const project = await this.requireCurrentProject();
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
	): Promise<string[]> {
		const project = await this.requireCurrentProject();
		return this.projects.listDefinitionPaths(project, kind, id);
	}

	async addDefinitionPath(
		kind: EntityKindId,
		id: DefinitionFileChoice,
		path: string,
		description = '',
	): Promise<AddDefinitionPathResult> {
		const project = await this.requireCurrentProject();
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
	): Promise<Record<DefinitionFileChoice, string>> {
		const project = await this.requireCurrentProject();
		const pathFor = (id: DefinitionFileChoice): string =>
			definitionRootPathFor(project, kind, id);
		return {
			category: pathFor('category'),
			'world-status': pathFor('world-status'),
			relationship: pathFor('relationship'),
		};
	}

	async updateScene(id: string, request: CreateSceneRequest): Promise<void> {
		const project = await this.requireCurrentProject();
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
			});
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async deleteScene(id: string, expectedRevision: string): Promise<void> {
		const project = await this.requireCurrentProject();
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

	async reorderScene(sceneId: string, targetIndex: number): Promise<void> {
		const project = await this.requireCurrentProject();
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
			].filter((issue) => issue.blocking);
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
		targetDocument.body.style.setProperty(
			SCROLLBAR_WIDTH_PROPERTY,
			`${measureScrollbarWidth(targetDocument)}px`,
		);
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
				this.sessions.surfaceActivity({
					kind: 'markdown-editor',
					path,
				});
				this.sessions.noteChanged(path, () => {
					try {
						return editor.getValue();
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
			this.sessions.surfaceActivity({
				kind:
					field.closest('.modal') === null ? 'dashboard-field' : 'modal-field',
				// A modal is drawn outside the view that opened it, so it
				// carries no mark of its own: the project it would save into
				// answers instead, which is the one the plugin calls current.
				path:
					field.closest<HTMLElement>('[data-snowflake-project]')?.dataset
						.snowflakeProject ?? this.settings.recentProjectPath,
			});
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
		if (event.kind === 'goal-reached') {
			new Notice(this.projectT('session.notice.goalReached'));
		} else if (event.kind === 'break-started') {
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
					: live.type === 'stopwatch'
						? formatClock(live.durations.totalMs)
						: formatClock(live.remainingMs ?? 0);
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
					live.scope === 'project'
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
		// A pace over less than a minute of focus is noise, not a number.
		if (live.durations.focusMs >= 60_000) {
			lines.push(
				this.projectT('session.stat.pace', {
					pace: this.grouped(
						Math.round(
							(live.trackedNet * 3_600_000) / live.durations.focusMs,
						),
					),
				}),
			);
		}
		if (live.goal !== null) {
			if (live.goalMet) {
				lines.push(this.projectT('session.stat.goalReached'));
			} else {
				if (live.goal.netWordTarget !== undefined) {
					lines.push(
						this.projectT('session.stat.goalNet', {
							net: this.grouped(live.trackedNet),
							target: this.grouped(live.goal.netWordTarget),
						}),
					);
				}
				if (live.goal.focusTimeTargetSeconds !== undefined) {
					lines.push(
						this.projectT('session.stat.goalFocus', {
							done: formatClock(live.durations.focusMs),
							target: formatClock(live.goal.focusTimeTargetSeconds * 1000),
						}),
					);
				}
			}
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
		this.settings.sessionDefaultType = setup.type;
		this.settings.sessionCountdownMinutes = setup.countdownMinutes;
		this.settings.sessionPomodoroWorkMinutes = setup.pomodoroWorkMinutes;
		this.settings.sessionPomodoroBreakMinutes = setup.pomodoroBreakMinutes;
		this.settings.sessionGoalNetWords = setup.goalNetWords;
		this.settings.sessionGoalFocusMinutes = setup.goalFocusMinutes;
		this.settings.sessionWritingMode = setup.writingMode;
		this.settings.sessionScope = setup.scope;
		this.settings.sessionStopwatchExpectedMinutes =
			setup.stopwatchExpectedMinutes;
		await this.saveSettings();
		// The mode is the one part of the setup a running session can still
		// take, and an author changing it mid-sitting means this sitting rather
		// than the next one.
		if (this.sessions.live() !== null) {
			this.sessions.setWritingMode(setup.writingMode);
		}
		this.sessionSettingsChanged();
	}

	/** The clock and conditions the timer widget shows and starts on. */
	private sessionSetup(): SessionSetup {
		return {
			type: this.settings.sessionDefaultType,
			countdownMinutes: this.settings.sessionCountdownMinutes,
			pomodoroWorkMinutes: this.settings.sessionPomodoroWorkMinutes,
			pomodoroBreakMinutes: this.settings.sessionPomodoroBreakMinutes,
			goalNetWords: this.settings.sessionGoalNetWords,
			goalFocusMinutes: this.settings.sessionGoalFocusMinutes,
			writingMode: this.settings.sessionWritingMode,
			scope: this.settings.sessionScope,
			stopwatchExpectedMinutes:
				this.settings.sessionStopwatchExpectedMinutes,
		};
	}

	/** The saved setup as a start request; zero is a condition left off. */
	private configuredStart(): StartSessionRequest {
		const setup = this.sessionSetup();
		const goal: WritingSessionGoal = {};
		if (setup.goalNetWords > 0) goal.netWordTarget = setup.goalNetWords;
		if (setup.goalFocusMinutes > 0) {
			goal.focusTimeTargetSeconds = setup.goalFocusMinutes * 60;
		}
		return {
			type: setup.type,
			scope: this.settings.sessionScope,
			writingMode: setup.writingMode,
			goal: Object.keys(goal).length === 0 ? null : goal,
		};
	}

	private async startConfiguredSession(
		request: StartSessionRequest,
	): Promise<void> {
		const project = await this.writingCountProject();
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
				scope: 'manuscript',
				type: 'stopwatch',
				writingMode: 'draft',
				goal: null,
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

	/** The one bridge every session panel renders through. */
	/**
	 * The one bridge every session panel renders through, over whichever
	 * project the panel belongs to. A dashboard pane names its own, so a pane
	 * reads its project's day and speaks its project's language whatever else
	 * is open; the sidebar names none and follows the writing.
	 */
	writingSessions(context: SessionPanelContext = {}): SessionPanelBridge {
		const projectLocale = context.locale ?? null;
		const t = (
			key: string,
			vars?: Record<string, string | number>,
		): string => this.translateForProject(projectLocale, key, vars);
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
			live: () => this.sessions.live(),
			history: async (days) => {
				const project = await this.resolveProject(context.projectPath ?? null);
				return project === null
					? null
					: this.sessions.dailyTotals(project, days);
			},
			view: () => ({
				trendDays: this.settings.sessionTrendDays,
				trendMeasure: this.settings.sessionTrendMeasure,
				heatmapMeasure: this.settings.sessionHeatmapMeasure,
			}),
			setView: (patch) => {
				if (patch.trendDays !== undefined) {
					this.settings.sessionTrendDays = patch.trendDays;
				}
				if (patch.trendMeasure !== undefined) {
					this.settings.sessionTrendMeasure = patch.trendMeasure;
				}
				if (patch.heatmapMeasure !== undefined) {
					this.settings.sessionHeatmapMeasure = patch.heatmapMeasure;
				}
				void this.saveSettings();
				// Both panels are looking at the same reading, so a switch in
				// one is a switch in the other.
				this.sessionSettingsChanged();
			},
			todaySummary: async () => {
				// A pane's day is its own project's day. A panel that named no
				// project reads the project the author is working in -- the one
				// the last dashboard they touched belongs to -- rather than
				// whichever note happens to be open in the editor beside it.
				const project = await this.resolveProject(context.projectPath ?? null);
				return project === null
					? null
					: this.sessions.todaySummary(project);
			},
			subscribe: (listener) => {
				const fromService = this.sessions.subscribe((event) => {
					listener(
						event.kind === 'started' ||
							event.kind === 'stopped' ||
							event.kind === 'recovered',
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
			dailyWordGoal: () => this.settings.sessionDailyWordGoal,
			setup: () => this.sessionSetup(),
			editDailyWordGoal: () => {
				new DailyWordGoalModal(
					this.app,
					t,
					this.settings.sessionDailyWordGoal,
					async (goal) => {
						this.settings.sessionDailyWordGoal = goal;
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
				void this.startConfiguredSession(this.configuredStart()).catch(
					(error: unknown) => {
						this.showError(error);
					},
				);
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
		this.sessions.surfaceActivity({
			kind: 'manuscript-segment',
			path,
		});
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
					count: this.projects.writingCount.countBody(
						context.body,
						'draft',
						options,
					),
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
		return this.projects.writingCount.countSectionAt(
			body,
			declared,
			caret - (content.length - body.length),
			options,
		);
	}

	/** A note's buffer, its frontmatter set aside — or all of it when broken. */
	private countMarkdownBuffer(
		content: string,
		options: NoteCountOptions,
	): WritingCount {
		try {
			const parsed = parseMarkdownFrontmatter(content);
			const declared = documentTypeOf(parsed.frontmatter);
			return this.projects.writingCount.countBody(
				parsed.body,
				isDocumentType(declared) ? declared : null,
				options,
			);
		} catch {
			return countWriting(countableProse(content, [], options), options);
		}
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

	async mergeManuscriptSegments(
		projectPath: string,
		path: string,
	): Promise<void> {
		await this.projects.mergeManuscriptSegments(projectPath, path);
		this.followMergedNote(projectPath, path);
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
		};
	}

	/**
	 * Turns one of the manuscript's writing modes, from the buttons every
	 * segment header carries: typewriter on and off, focus mode one level
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
				throw new Error(
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
		return promptForSegmentTitle(
			this.app,
			(key, vars) => this.translateForProject(project.locale, key, vars),
			this.translateForProject(
				project.locale,
				'manuscript.defaultSegmentTitle',
			),
			async (title) => {
				await onNamed?.();
				if ('after' in placement) {
					return manuscript.insertSegmentAfter(project, placement.after, title);
				}
				return 'atStart' in placement
					? manuscript.prependSegment(project, title)
					: manuscript.appendSegment(project, title);
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
		return promptForSegmentTitle(
			this.app,
			(key, vars) => this.translateForProject(project.locale, key, vars),
			this.translateForProject(
				project.locale,
				'manuscript.defaultSegmentTitle',
			),
			async (title) => {
				await onNamed?.();
				return this.projects.manuscript.splitSegment(
					project,
					path,
					offset,
					title,
				);
			},
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
			if (!leaf.view.containerEl.isShown()) continue;
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

	private async activateDashboardLeaf(
		leaf: WorkspaceLeaf | null,
	): Promise<void> {
		if (
			leaf === null ||
			leaf.getRoot() !== this.app.workspace.rootSplit ||
			leaf.getViewState().type !== DASHBOARD_VIEW_TYPE
		) {
			return;
		}
		await leaf.loadIfDeferred();
		if (leaf.view instanceof SnowflakeDashboardView) {
			await leaf.view.activateFromWorkspace();
		}
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
		// Restore context only from the most recently active main-workspace leaf.
		await this.activateDashboardLeaf(
			this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit),
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
			id: 'start-writing-session',
			name: this.globalT('commands.startWritingSession'),
			callback: () => {
				this.openStartSessionModal();
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
			id: 'toggle-table-progress-status',
			name: this.globalT('commands.toggleTableProgressStatus'),
			callback: () => {
				void this.toggleTableProgressStatus().catch((error: unknown) => {
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
	addProjectMenuSection(menu: Menu, path: string, source?: string): void {
		const locale = this.projectLocaleOfPath(path);
		const t = (key: string): string => this.translateForProject(locale, key);
		const section = 'snowflake-method';
		menu.addItem((item) =>
			item.setSection(section).setIsLabel(true).setTitle(t('plugin.name')),
		);
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
				// Out-of-editor writes move the counts, never the idle clock.
				if (file instanceof TFile) this.sessions.noteChanged(file.path);
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
		this.sessions.noteDeleted(file.path, {
			children: file instanceof TFolder,
		});
		if (!this.touchesProject(file.path)) return;
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
		this.sessions.notePathRenamed(oldPath, file.path);
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
		// Whatever the scan holds was true of the old arrangement.
		this.invalidateProjectDiscovery();
		if (leftTheRoot) {
			// Views cannot follow a project out of the scan's reach, and a
			// stream left in a background tab never notices on its own.
			this.detachProjectViews(oldPath);
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

	private async refreshDashboards(): Promise<void> {
		await Promise.all(
			this.app.workspace
				.getLeavesOfType(DASHBOARD_VIEW_TYPE)
				.map(async (leaf) => {
					if (leaf.view instanceof SnowflakeDashboardView) {
						await leaf.view.refresh();
					}
				}),
		);
		this.rerenderStatisticsViews();
		await this.refreshManuscriptStreams();
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

	private rerenderStatisticsViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			STATISTICS_VIEW_TYPE,
		)) {
			if (leaf.view instanceof SnowflakeStatisticsView) leaf.view.rerender();
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

	private async openCreateCharacterModal(): Promise<void> {
		try {
			const project = await this.requireCurrentProject();
			new CreateCharacterModal(
				this.app,
				this.t,
				project.characters.map((character) => character.name),
				async (request) => {
					await this.createCharacter(request);
					await this.refreshDashboards();
				},
			).open();
		} catch (error) {
			this.showError(error);
		}
	}

	private async openCreateSceneModal(): Promise<void> {
		try {
			const project = await this.requireCurrentProject();
			new CreateSceneModal(
				this.app,
				this.t,
				project.characters.map((character) => ({
					id: character.id,
					path: character.path,
					name: character.name,
				})),
				project.scenes.map((scene) => scene.title),
				async (request) => {
					await this.createScene(request);
					await this.refreshDashboards();
				},
				undefined,
				// The taken names come from the scene form rather than from the
				// snapshot above, which was read before any character created from
				// there existed.
				async (name, takenNames) => {
					const created = await promptForNewCharacter(
						this.app,
						this.t,
						takenNames,
						name,
						(request) => this.createCharacter(request),
					);
					if (created === null) return null;
					// The field behind the form is waiting on this, so the dashboard
					// redraw is left to catch up on its own rather than kept in front.
					void this.refreshDashboards();
					return created;
				},
			).open();
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
