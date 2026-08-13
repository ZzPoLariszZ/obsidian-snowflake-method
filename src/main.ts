import {
	MarkdownView,
	Menu,
	moment,
	normalizePath,
	Notice,
	Platform,
	Plugin,
	TFile,
	TFolder,
	type EditorPosition,
	type MarkdownFileInfo,
	type TAbstractFile,
	type WorkspaceLeaf,
} from 'obsidian';

import {
	SCENE_POV_MULTIPLE,
	SCENE_POV_OMNISCIENT,
	STEP_DEFINITIONS,
	STEP_ONE_SECTION_IDS,
	STEP_TWO_SECTION_IDS,
	WORLDBUILDING_KINDS,
	getFirstIncompleteStep,
	isDocumentType,
	isStepId,
	managedSectionHighlightsForStep,
	managedSectionsForDocument,
	primaryManagedSectionForStep,
	type DocumentType,
	type EntityKind,
	type ProjectLanguage,
	type StepId,
	type StepStatus,
	type WorldbuildingKind,
	scenesUsingCharacter,
} from './domain';
import { resolveGlobalLocale, resolveLocale, t as translate } from './i18n';
import {
	areManagedBoundariesUnlocked,
	createManagedSectionEditorExtension,
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
	DuplicateNameError,
	MEMBER_FIELDS_SECTION_BY_DOCUMENT,
	ProjectCreationInterruptedError,
	PROJECT_PATH_LAYOUTS,
	definitionRootName,
	entityKindFolder,
	getProjectPathLayout,
	isMemberDocumentType,
	taxonomyPathFromValue,
	type ArtifactSnapshot,
	type CharacterRecord,
	type ProjectRef,
	type ProjectSnapshot,
	type SceneRecord,
	type WorldbuildingRecord,
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
	readMarkedSection,
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
	ConfirmCharacterDeletionModal,
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
	type EntityFormRequest,
	type ManageProjectOption,
	type Translate,
} from './ui/modals';
import type {
	AddDefinitionPathResult,
	CharacterViewModel,
	CreatedProject,
	DashboardHost,
	DefinitionFileChoice,
	ManagedSectionIssueViewModel,
	ManuscriptHost,
	ManuscriptModel,
	ManuscriptSegmentText,
	ManuscriptWindowSettings,
	SegmentNamed,
	StepFields,
	ProjectBaseChoice,
	ProjectDashboardModel,
	ProjectOption,
	RepairReportViewModel,
	SceneViewModel,
	WorldbuildingEntityViewModel,
} from './ui/view-model';

const REFRESH_DELAY_MS = 250;
const FIELDS_RECONCILE_DELAY_MS = 1_000;
const REDUCE_MOTION_CLASS = 'snowflake-method-reduce-motion';
const SCROLLBAR_WIDTH_PROPERTY = '--snowflake-method-scrollbar-width';
/** Below this width a second pane leaves neither side room to write in. */
const MIN_SPLIT_WIDTH_PX = 900;

/** The vault path of one of an entity kind's tree root folders. */
function definitionRootPathFor(
	project: { rootPath: string; locale: ProjectLanguage },
	kind: EntityKind,
	id: DefinitionFileChoice,
): string {
	return normalizePath(
		`${project.rootPath}/${entityKindFolder(getProjectPathLayout(project.locale), kind)}/${definitionRootName(kind, id, project.locale)}`,
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
		this.registerManagedSectionEditor();
		this.registerView(
			DASHBOARD_VIEW_TYPE,
			(leaf) => new SnowflakeDashboardView(leaf, this),
		);
		this.registerView(
			MANUSCRIPT_VIEW_TYPE,
			(leaf) => new SnowflakeManuscriptView(leaf, this),
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
		await this.syncCurrentProjectLocale();
		await this.refreshDashboards();
	}

	getRecentStep(): StepId {
		return isStepId(this.settings.recentStep) ? this.settings.recentStep : 1;
	}

	isReduceMotionEnabled(): boolean {
		return this.settings.reduceMotion;
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
		const projects = await this.listProjects();
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
				return this.listProjects();
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

	private async trashManagedProject(
		option: ManageProjectOption,
	): Promise<ProjectOption[] | null> {
		const project = await this.projects.loadProject(option.path);
		const folder = this.projects.repository.getFolder(project.rootPath);
		if (folder === null) throw new ManagedFileNotFoundError(project.rootPath);
		if (!(await this.app.fileManager.promptForDeletion(folder))) return null;
		this.projectLocalesById.delete(project.id);
		this.invalidateProjectHealth(project.rootPath);

		// Obsidian's confirmation flow performs the configured trash/delete action
		// before resolving true. Calling trashFile() again uses a detached TFolder
		// and aborts the manager refresh after the project has already disappeared.
		if (
			this.settings.recentProjectPath === project.projectFile ||
			this.settings.recentProjectPath?.startsWith(`${project.rootPath}/`)
		) {
			this.settings.recentProjectPath = null;
			this.settings.recentStep = 1;
			this.currentProjectLocale = null;
			await this.saveSettings();
		}
		await this.refreshDashboards();
		new Notice(this.t('messages.projectTrashed', { name: project.title }));
		return (await this.listProjects()).filter(
			(candidate) => candidate.projectId !== project.id,
		);
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
		// A name that drifted from its note is reported against that note, and the
		// row for it is the one place an author is looking at the name itself.
		const driftedNames = new Set(
			project.structureIssues
				.filter(
					(issue) =>
						issue.code === 'mismatched-character-title' ||
						issue.code === 'mismatched-scene-title',
				)
				.map((issue) => issue.path),
		);
		const characterModels = characters.map((character) =>
			this.characterViewModel(
				character,
				driftedNames,
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
				driftedNames,
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
			worldbuilding: {
				time: project.worldbuilding.time.map((entity) =>
					this.entityViewModel(
						entity,
						projectT,
						definitionRootPathFor(project, 'time', 'category'),
					),
				),
				location: project.worldbuilding.location.map((entity) =>
					this.entityViewModel(
						entity,
						projectT,
						definitionRootPathFor(project, 'location', 'category'),
					),
				),
				item: project.worldbuilding.item.map((entity) =>
					this.entityViewModel(
						entity,
						projectT,
						definitionRootPathFor(project, 'item', 'category'),
					),
				),
			},
			unmigratedMembers:
				characters.filter(
					(character) => character.unmigrated && !character.readOnly,
				).length +
				scenes.filter((scene) => scene.unmigrated && !scene.readOnly).length,
			structureIssues: project.structureIssues.map((issue) => ({
				path: issue.path,
				sectionId: null,
				sectionLabel:
					issue.field ?? issue.path.split('/').pop() ?? issue.path,
				code: issue.code,
				message: projectT(`projectStructure.issue.${issue.code}`, {
					field: issue.field ?? '',
					expected: issue.expected ?? '',
				}),
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
			this.currentProjectLocale = project.locale;
			this.settings.recentProjectPath = path;
			this.settings.recentStep = selectedStep;
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
		this.currentProjectLocale = project.locale;
		this.projectLocalesById.set(project.id, project.locale);
		this.settings.recentProjectPath = path;
		this.settings.recentStep = firstIncomplete;
		await this.saveSettings();
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
		this.settings.recentProjectPath = path;
		this.currentProjectLocale = locale;
		this.settings.recentStep = step;
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
		const file = this.app.vault.getFileByPath(character.path);
		if (!(file instanceof TFile)) {
			throw new ManagedFileNotFoundError(character.path);
		}
		if (character.revision !== expectedRevision) {
			this.rethrowLocalizedMutationError(
				new ConcurrentChangeError(
					character.path,
					expectedRevision,
					character.revision,
				),
			);
		}
		// Obsidian's delete prompt sees a note, not a cast member, so a character
		// scenes still reference gets its own confirmation that names them. With
		// nothing referencing them, the standard prompt is the right one.
		const usage = scenesUsingCharacter(project.scenes, character.path);
		if (usage.pointOfView.length === 0 && usage.cast.length === 0) {
			if (!(await this.app.fileManager.promptForDeletion(file))) return;
			new Notice(this.t('messages.characterDeleted'));
			return;
		}

		const confirmed = await new Promise<boolean>((resolve) => {
			new ConfirmCharacterDeletionModal(
				this.app,
				this.t,
				character.name,
				usage,
				resolve,
			).open();
		});
		if (!confirmed) return;
		// trashFile honours the same trash preference the prompt would have, so
		// replacing that dialog does not quietly change where the note goes.
		await this.projects.repository.trashFile(character.path);
		// After the delete, so a failure here leaves links the health check can
		// still report rather than a cast edited for a deletion that never landed.
		await this.projects.removeCharacterFromScenes(project, character.path);
		new Notice(this.t('messages.characterDeleted'));
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
				details: [],
				worldStatus: request.worldStatus,
				relationships: request.relationships,
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
				details: [],
				worldStatus: request.worldStatus,
				relationships: request.relationships,
			});
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
	}

	async deleteEntity(id: string, expectedRevision: string): Promise<void> {
		const project = await this.requireCurrentProject();
		const entity = WORLDBUILDING_KINDS.flatMap(
			(kind) => project.worldbuilding[kind],
		).find((candidate) => candidate.entityId === id);
		if (entity === undefined) {
			throw new ManagedFileNotFoundError(`entity:${id}`);
		}
		const file = this.app.vault.getFileByPath(entity.path);
		if (!(file instanceof TFile)) {
			throw new ManagedFileNotFoundError(entity.path);
		}
		if (entity.revision !== expectedRevision) {
			this.rethrowLocalizedMutationError(
				new ConcurrentChangeError(entity.path, expectedRevision, entity.revision),
			);
		}
		if (!(await this.app.fileManager.promptForDeletion(file))) return;
		new Notice(this.t('messages.entityDeleted'));
	}

	async reorderEntity(
		kind: WorldbuildingKind,
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

	async listDefinitionPaths(
		kind: EntityKind,
		id: DefinitionFileChoice,
	): Promise<string[]> {
		const project = await this.requireCurrentProject();
		return this.projects.listDefinitionPaths(project, kind, id);
	}

	async addDefinitionPath(
		kind: EntityKind,
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

	async definitionFilePaths(
		kind: EntityKind,
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
		const file = this.app.vault.getFileByPath(scene.path);
		if (!(file instanceof TFile)) {
			throw new ManagedFileNotFoundError(scene.path);
		}
		if (scene.revision !== expectedRevision) {
			this.rethrowLocalizedMutationError(
				new ConcurrentChangeError(
					scene.path,
					expectedRevision,
					scene.revision,
				),
			);
		}
		if (!(await this.app.fileManager.promptForDeletion(file))) return;
		new Notice(this.t('messages.sceneDeleted'));
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
			const issues = [
				...model.structureIssues,
				...model.steps.flatMap((step) => step.healthIssues),
				...model.characters.flatMap((character) => character.healthIssues),
				...model.scenes.flatMap((scene) => scene.healthIssues),
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
					action: issue.action,
					canOpen: issue.canOpen,
					repairable: issue.repairable,
					repairField: issue.repairField,
					sceneId:
						model.scenes.find((scene) => scene.path === issue.path)?.id ?? null,
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
						sceneId: null,
						sectionLabel: this.t('editor.managedSection.documentLabel'),
						status: 'conflict',
						message,
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
		await this.projects.repairMissingStructureItem(
			project.projectFile,
			path,
			field,
		);
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
		if (key === 'manuscriptFocusLevel') this.applyManuscriptModePresence();
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
			new Notice(this.globalT('messages.noCurrentProject'));
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
			new Notice(this.globalT('messages.noCurrentProject'));
			return;
		}
		const segments = await this.projects.manuscript.listSegments(project);
		const anchor = segments.find((segment) => segment.path === path)?.path ?? null;
		await this.openManuscriptStream(project.projectFile, anchor);
	}

	private async openDashboardFor(path: string): Promise<void> {
		const project = await this.projectOfPath(path);
		if (project === null) {
			new Notice(this.globalT('messages.noCurrentProject'));
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
			this.app.vault.on('create', (file) => this.handleVaultEvent(file)),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => this.handleVaultEvent(file)),
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
		if (file instanceof TFolder) this.scheduleDefinitionMaterialize(file.path);
	}

	/**
	 * A folder that just appeared under a definition tree is a node the file
	 * explorer made, and every node carries its `_self.md`: materialized
	 * here, the moment the folder exists, so a link made a breath later has
	 * a note to resolve to. For any other folder the service returns without
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
		if (!this.touchesProject(file.path)) return;
		this.invalidateProjectHealth(file.path);

		for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)) {
			const statePath = leaf.getViewState().state?.projectPath;
			const dashboardPath =
				leaf.view instanceof SnowflakeDashboardView
					? leaf.view.getProjectPath()
					: typeof statePath === 'string'
						? statePath
						: null;
			if (
				dashboardPath !== null &&
				isPathAtOrBelow(dashboardPath, file.path)
			) {
				leaf.detach();
			}
		}

		// A stream showing a project that has just been deleted has nothing left
		// to show, and would otherwise sit there holding a manuscript that is in
		// the trash.
		for (const leaf of this.app.workspace.getLeavesOfType(
			MANUSCRIPT_VIEW_TYPE,
		)) {
			const statePath = leaf.getViewState().state?.projectPath;
			if (
				typeof statePath === 'string' &&
				isPathAtOrBelow(statePath, file.path)
			) {
				leaf.detach();
			}
		}

		this.scheduleRefresh(true);
		const recent = this.settings.recentProjectPath;
		if (recent !== null && isPathAtOrBelow(recent, file.path)) {
			this.settings.recentProjectPath = null;
			this.settings.recentStep = 1;
			this.currentProjectLocale = null;
			await this.saveSettings();
		}
	}

	private async handleVaultRename(
		file: TAbstractFile,
		oldPath: string,
	): Promise<void> {
		// Before any guard: the parse cache lets the old path's record go. The
		// new path caches itself on its next read.
		this.projects.repository.forget(oldPath, {
			children: file instanceof TFolder,
		});
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

		if (
			movedRoot === null &&
			!this.touchesProject(oldPath) &&
			!this.touchesProject(file.path)
		) {
			return;
		}

		this.invalidateProjectHealth(oldPath);
		this.invalidateProjectHealth(file.path);

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
		driftedNames: ReadonlySet<string>,
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
			relationships: character.relationships,
			revision: character.revision,
			readOnly: character.readOnly,
			nameDrifted: driftedNames.has(character.path),
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
		driftedNames: ReadonlySet<string>,
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
			relationships: scene.relationships,
			events: scene.events,
			revision: scene.revision,
			readOnly: scene.readOnly,
			nameDrifted: driftedNames.has(scene.path),
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
			details: entity.details,
			worldStatus: entity.worldStatus,
			relationships: entity.relationships,
			revision: entity.revision,
			readOnly: entity.readOnly,
			nameDrifted: false,
			healthIssues: this.issueViewModels(entity.path, entity.sectionHealth, t),
		};
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
			const key = {
				character: 'errors.characterExists',
				scene: 'errors.sceneExists',
				project: 'errors.projectExists',
				time: 'errors.entityExists',
				location: 'errors.entityExists',
				item: 'errors.entityExists',
			}[error.kind];
			throw new Error(this.t(key, { name: error.requestedName }));
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
		).open();
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
