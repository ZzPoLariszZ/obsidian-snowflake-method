import {
	MarkdownView,
	moment,
	Notice,
	Platform,
	Plugin,
	TFile,
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
	getFirstIncompleteStep,
	isDocumentType,
	isStepId,
	managedSectionHighlightsForStep,
	managedSectionsForDocument,
	primaryManagedSectionForStep,
	type DocumentType,
	type StepId,
	type StepStatus,
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
	ProjectCreationInterruptedError,
	PROJECT_PATH_LAYOUTS,
	type ArtifactSnapshot,
	type CharacterRecord,
	type ProjectRef,
	type ProjectSnapshot,
	type SceneRecord,
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
	type CharacterOption,
	type CreateCharacterRequest,
	type CreateProjectRequest,
	type CreateSceneRequest,
	type ManageProjectOption,
	type Translate,
} from './ui/modals';
import type {
	CharacterViewModel,
	CreatedProject,
	DashboardHost,
	ManagedSectionIssueViewModel,
	StepFields,
	ProjectDashboardModel,
	ProjectOption,
	RepairReportViewModel,
	SceneViewModel,
} from './ui/view-model';

const REFRESH_DELAY_MS = 250;
const REDUCE_MOTION_CLASS = 'snowflake-method-reduce-motion';
const SCROLLBAR_WIDTH_PROPERTY = '--snowflake-method-scrollbar-width';
/** Below this width a second pane leaves neither side room to write in. */
const MIN_SPLIT_WIDTH_PX = 900;

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
	implements DashboardHost
{
	settings: SnowflakeSettings = { ...DEFAULT_SETTINGS };
	projects!: SnowflakeProjectService;
	private refreshTimer: number | null = null;
	private refreshProjectLocales = false;
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
		this.addRibbonIcon('snowflake', this.globalT('commands.openDashboard'), () => {
			void this.openDashboard();
		});
		this.registerCommands();
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
					void this.activateDashboardLeaf(leaf).catch((error: unknown) => {
						this.showError(error);
					});
				}),
			);
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
		const characterModels = characters.map((character) =>
			this.characterViewModel(character, projectT),
		);
		const characterNames = new Map(
			characters.map((character) => [character.path, character.name]),
		);
		const sceneModels = scenes.map((scene) =>
			this.sceneViewModel(scene, characterNames, projectT),
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
		return { path: character.path, name: character.name };
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
				type: request.type,
				oneSentenceStoryline: request.oneSentenceStoryline,
				oneParagraphStoryline: request.oneParagraphStoryline,
				motivation: request.motivation,
				goal: request.goal,
				conflict: request.conflict,
				growth: request.growth,
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

	async createScene(request: CreateSceneRequest): Promise<void> {
		const project = await this.requireCurrentProject();
		let scene;
		try {
			scene = await this.projects.createScene(project, {
				title: request.title,
				povPath: request.povPath || null,
				time: request.time,
				location: request.location,
				characters: request.characterPaths,
				conflict: request.conflict,
				events: request.events,
			});
		} catch (error) {
			this.rethrowLocalizedMutationError(error);
		}
		new Notice(this.t('messages.sceneCreated', { name: scene.title }));
	}

	async createSceneCanvas(): Promise<void> {
		const project = await this.requireCurrentProject();
		const path = await this.projects.createSceneCanvas(project);
		const name = path.slice(path.lastIndexOf('/') + 1);
		new Notice(this.t('messages.canvasCreated', { name }));
		await this.openManagedFile(path);
	}

	async openProjectBase(id: 'characters' | 'scenes'): Promise<void> {
		const project = await this.requireCurrentProject();
		const path = await this.projects.openProjectBase(project, id);
		await this.openManagedFile(path);
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
				time: request.time,
				location: request.location,
				characters: request.characterPaths,
				conflict: request.conflict,
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
				editor.scrollIntoView({ from: cursor, to: cursor }, true);
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
		editor.scrollIntoView({ from: cursor, to: cursor }, true);
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
				getStrings: (context) => this.managedSectionEditorStrings(context),
				getSectionIds: (context) =>
					this.managedSectionIdsForEditor(context.content),
				onBoundaryBlocked: ({ context }) => {
					new Notice(
						this.editorT(
							context.content,
							'editor.managedSection.protectedNotice',
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

	private registerVaultListeners(): void {
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
	}

	private async handleVaultDelete(file: TAbstractFile): Promise<void> {
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
		t: Translate,
	): CharacterViewModel {
		return {
			id: character.characterId,
			path: character.path,
			name: character.name,
			rank: character.rank,
			type: character.type,
			oneSentenceStoryline: character.oneSentenceStoryline,
			oneParagraphStoryline: character.oneParagraphStoryline,
			motivation: character.motivation,
			goal: character.goal,
			conflict: character.conflict,
			growth: character.growth,
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
			time: scene.time,
			location: scene.location,
			characterPaths: scene.characters,
			conflict: scene.conflict,
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
			blocking: issue.code !== 'unknown-section',
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
