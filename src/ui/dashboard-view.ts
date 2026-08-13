import {
	ItemView,
	Menu,
	Notice,
	SearchComponent,
	setIcon,
	setTooltip,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import {
	SCENE_POV_MULTIPLE,
	SCENE_POV_OMNISCIENT,
	STEP_ONE_SECTION_IDS,
	STEP_TWO_SECTION_IDS,
	WORLDBUILDING_KINDS,
	areStepPrerequisitesComplete,
	countWritingLength,
	createDefaultStepStatuses,
	getFirstIncompleteStep,
	isProgressStatus,
	managedSectionHighlightsForStep,
	primaryManagedSectionForStep,
	PROGRESS_STATUSES,
	type EntityKind,
	type ProgressStatus,
	type TimeKind,
	type StepOneSectionId,
	type StepId,
	type StepStatus,
	type StepStatusMap,
	type WorldbuildingKind,
} from '../domain';
import { MAX_DEFINITION_DEPTH } from '../services';
import {
	ConfirmRestoreBaseModal,
	CreateCharacterModal,
	CreateProjectModal,
	CreateSceneModal,
	EntityFormModal,
	MoveAfterModal,
	MoveToPositionModal,
	RepairReportModal,
	promptForNewCharacter,
	promptForNewEntity,
	promptForNewScene,
	type CharacterOption,
	type MemberFormContext,
	type MoveAfterEntry,
	type Translate,
} from './modals';
import {
	dashboardHasHealthIssues,
	dashboardPaneKey,
	dashboardRenderContinuity,
	memberMatches,
	mergeDashboardViewState,
	shouldShowGlobalStructureIssue,
	type DashboardPane,
	type DashboardRailCollapse,
} from './dashboard-state';
import {
	buildOptionField,
	type OptionPicker,
	type PickerOption,
} from './option-picker';
import {
	ENTITY_GROUP_IDS,
	type DefinitionPathSource,
	type EntityGroupId,
} from './entity-form';
import { RenderStateKeeper } from './render-state';
import { renderSnowflakeEvolution } from './snowflake-evolution';
import { VirtualTable } from './virtual-table';
import type {
	CharacterViewModel,
	CreatedProject,
	DashboardHost,
	DefinitionFileChoice,
	ManagedSectionIssueViewModel,
	StepFields,
	ProjectDashboardModel,
	SceneViewModel,
	StepViewModel,
	WorldbuildingEntityViewModel,
} from './view-model';

export const DASHBOARD_VIEW_TYPE = 'snowflake-method-dashboard';

/**
 * Reorder drags carry a payload type of their own. `text/plain` is what every
 * other drag source in the app also writes, so a row keyed on it accepts a note
 * dragged in from the file explorer, or any selected text, as a reorder.
 */
const CHARACTER_DRAG_TYPE = 'application/x-snowflake-character';
const SCENE_DRAG_TYPE = 'application/x-snowflake-scene';
const ENTITY_DRAG_TYPE = 'application/x-snowflake-entity';

/** How the filter panel sits: under its button, and off the window's edge. */
const PANEL_ANCHOR_GAP = 4;
const PANEL_EDGE_GAP = 8;

/** One question the funnel asks: a labelled picker over one vocabulary. */
interface MemberFilterRow {
	label: string;
	/** What the field reads as when the question is not being asked. */
	placeholder: string;
	/** The value that means exactly that, and what the reset returns to. */
	empty: string;
	options: () => PickerOption[];
	/** What the table is filtered by now, which the panel opens on. */
	value: string;
	apply: (value: string) => void;
}

/**
 * Both member tables are laid by the same five columns, so stepping between
 * characters and scenes changes the rows and not the grid: order, name, the
 * kind column (a character's type, a scene's point of view), the wrapping
 * text column, and the actions.
 */
const MEMBER_COLUMN_CLASSES = ['order', 'name', 'kind', 'text', 'actions'].map(
	(name) => `snowflake-method-member-column-${name}`,
);

const STEP_LIST_SELECTOR = '.snowflake-method-step-list';
const MAIN_PANEL_SELECTOR = '.snowflake-method-main';

const WORLDBUILDING_KIND_ICONS: Record<WorldbuildingKind, string> = {
	time: 'clock',
	location: 'map-pin',
	item: 'gem',
};

/**
 * Whether a category path sits at or below the one a filter names, so
 * filtering by `Race` keeps the characters filed under `Race/Elf`. A level
 * nobody is filed under directly is still a real thing to ask about, which is
 * why the whole tree is on offer.
 */
function categoryWithin(path: string, filter: string): boolean {
	return path === filter || path.startsWith(`${filter}/`);
}

/** What a stored term reads as: a link's display name, or the text itself. */
function termName(raw: string): string {
	const trimmed = raw.trim();
	const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/u.exec(trimmed);
	if (match === null) return trimmed;
	const alias = (match[2] ?? '').trim();
	if (alias.length > 0) return alias;
	const path = (match[1] ?? '').trim();
	return path.split('/').pop() ?? path;
}

/** The model's steps as the status map the domain rules are written against. */
function stepStatusesOf(model: ProjectDashboardModel): StepStatusMap {
	const statuses = createDefaultStepStatuses();
	for (const step of model.steps) statuses[step.id] = step.status;
	return statuses;
}
const ACTIVE_STEP_SELECTOR = '.snowflake-method-step-button.is-active';

export class SnowflakeDashboardView extends ItemView {
	private readonly host: DashboardHost;
	private readonly stepDrafts = new Map<
		string,
		{ fields: StepFields; expectedRevision: string }
	>();
	private selectedStep: StepId;
	/** What the main panel shows: the selected step, or a worldbuilding kind. */
	private selectedPane: DashboardPane;
	private railCollapsed: DashboardRailCollapse = {
		steps: false,
		worldbuilding: false,
	};
	private readonly entityQueries = new Map<WorldbuildingKind, string>();
	private readonly entityCategoryFilters = new Map<WorldbuildingKind, string>();
	private readonly entityStatusFilters = new Map<
		WorldbuildingKind,
		'all' | ProgressStatus
	>();
	private readonly entityCategories = new Map<
		WorldbuildingKind,
		{ projectId: string; paths: string[] }
	>();
	private readonly entityScroll = new Map<WorldbuildingKind, number>();
	private readonly entityHeights = new Map<string, number>();
	private entityRowHeight = 48;
	private entityTable: VirtualTable | null = null;
	/**
	 * What each member table is showing, one set per table rather than one
	 * per step: steps 3, 5 and 7 share the character table and 8 and 9 the
	 * scene table, so moving between them keeps the same rows, search and
	 * filters in view. Session state, like the selected step.
	 */
	private characterScroll = 0;
	private sceneScroll = 0;
	private characterQuery = '';
	private sceneQuery = '';
	/**
	 * What the character table is filtered by. Two questions, asked together
	 * behind one funnel: a category path, whose subtree counts as filed under
	 * it, and a progress status. '' and 'all' mean the question is not being
	 * asked.
	 */
	private characterCategoryFilter = '';
	private characterStatusFilter: 'all' | ProgressStatus = 'all';
	/** Every category the project offers, and whose project they came from. */
	private characterCategories: { projectId: string; paths: string[] } | null =
		null;
	private sceneCategories: { projectId: string; paths: string[] } | null = null;
	/** A character path, a point-of-view mode, or '' for every scene. */
	private scenePovFilter = '';
	private sceneCategoryFilter = '';
	private sceneStatusFilter: 'all' | ProgressStatus = 'all';
	/** A time or location by the name it is shown under, or '' for all. */
	private sceneTimeFilter = '';
	private sceneLocationFilter = '';
	/** A character path the scene must have in its cast, or '' for all. */
	private sceneCharacterFilter = '';
	/** The average measured row height, carried across renders as a seed. */
	private characterRowHeight = 48;
	private sceneRowHeight = 48;
	/** Measured heights by member id: rows wrap, so each has its own. */
	private readonly characterHeights = new Map<string, number>();
	private readonly sceneHeights = new Map<string, number>();
	private characterTable: VirtualTable | null = null;
	private sceneTable: VirtualTable | null = null;
	/** The filter pickers the member panel on show is using, for release. */
	private memberFilterPickers: OptionPicker[] = [];
	/** The filter panel while it is open, with what it has to let go of. */
	private filterPanel: { el: HTMLElement; release: () => void } | null = null;
	/** What the last render drew, so a reveal can find a row's place now. */
	private lastRender: {
		projects: Awaited<ReturnType<DashboardHost['listProjects']>>;
		model: ProjectDashboardModel | null;
	} | null = null;
	/**
	 * False until a step has actually been chosen in this session. A view built
	 * for a leaf Obsidian restored carries the step the workspace last saved,
	 * which is where the author happened to stop rather than where they mean to
	 * start — so the first render picks up the work instead.
	 */
	private stepChosen = false;
	/**
	 * False until Obsidian has handed this leaf its state. Until then the view
	 * does not know which project it belongs to, and a null path means "whichever
	 * project is current" to the host — so rendering in that gap paints somebody
	 * else's project for the beat before the state lands.
	 */
	private stateDelivered = false;
	private projectPath: string | null = null;
	private projectTitle: string | null = null;
	private projectLocale: 'en' | 'zh-CN' | null = null;
	private opened = false;
	private refreshing = false;
	private refreshPending = false;
	private rendered = false;
	private renderedProjectId: string | null = null;
	private renderedProjectPath: string | null = null;
	private renderedProjectComplete = false;
	private renderedStep: StepId | null = null;
	private renderedPaneKey: string | null = null;
	private renderedModel: ProjectDashboardModel | null = null;
	// A refresh replaces every node, so the presentation state the author set by
	// hand has to be carried across the rebuild rather than left to the DOM.
	private readonly renderState = new RenderStateKeeper([
		STEP_LIST_SELECTOR,
		MAIN_PANEL_SELECTOR,
	]);
	private celebrationEl: HTMLElement | null = null;
	private celebrationDelayTimer: number | null = null;
	private celebrationDelayWindow: Window | null = null;
	private celebrationTimer: number | null = null;
	private celebrationWindow: Window | null = null;
	private viewTitleIconEl: HTMLElement | null = null;
	private readonly t = (
		key: string,
		vars?: Record<string, string | number>,
	): string => this.host.translateForProject(this.projectLocale, key, vars);

	constructor(leaf: WorkspaceLeaf, host: DashboardHost) {
		super(leaf);
		this.host = host;
		this.selectedStep = host.getRecentStep();
		this.selectedPane = { kind: 'step', step: this.selectedStep };
	}

	getViewType(): string {
		return DASHBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.projectTitle ?? this.t('dashboard.title');
	}

	getIcon(): string {
		return 'snowflake';
	}

	getState(): Record<string, unknown> {
		return {
			projectPath: this.projectPath,
			projectTitle: this.projectTitle,
			selectedStep: this.selectedStep,
			selectedPane: this.selectedPane,
			railCollapsed: this.railCollapsed,
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		this.stateDelivered = true;
		const update = mergeDashboardViewState(
			{
				projectPath: this.projectPath,
				projectTitle: this.projectTitle,
				selectedStep: this.selectedStep,
				selectedPane: this.selectedPane,
				railCollapsed: this.railCollapsed,
			},
			state,
		);
		this.projectPath = update.state.projectPath;
		this.projectTitle = update.state.projectTitle;
		this.selectedStep = update.state.selectedStep;
		this.selectedPane = update.state.selectedPane;
		this.railCollapsed = update.state.railCollapsed;
		// During workspace restoration Obsidian may open an ItemView before it
		// delivers the persisted view state, so this is the first moment a
		// restored leaf can be drawn at all — hence rendering when nothing has
		// been drawn yet, and not only when the state moved.
		if (
			this.opened &&
			this.app.workspace.layoutReady &&
			(update.changed || !this.rendered)
		) {
			await this.refresh();
		}
	}

	getProjectPath(): string | null {
		return this.projectPath;
	}

	getSelectedStep(): StepId {
		return this.selectedStep;
	}

	isEmpty(): boolean {
		return this.renderedProjectId === null;
	}

	async showCreatedProject(project: CreatedProject): Promise<void> {
		this.bindProject(project);
		await this.refresh();
	}

	async showSelectedProject(
		project: CreatedProject,
		selectedStep: StepId,
	): Promise<void> {
		this.bindProject(project);
		this.selectedStep = selectedStep;
		// Asked for by name, so it stands even on a view that has yet to render.
		this.stepChosen = true;
		await this.refresh();
	}

	async showRenamedProject(project: CreatedProject): Promise<void> {
		this.projectPath = project.path;
		this.projectTitle = project.title;
		this.projectLocale = project.locale;
		this.updateViewTitle();
		await this.refresh();
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		this.registerDomEvent(this.contentEl, 'pointerdown', () => {
			this.activateProjectContext();
		});
		this.registerDomEvent(this.contentEl, 'focusin', () => {
			this.activateProjectContext();
		});
		this.decorateViewTitle();
		// Restored views can open while Obsidian is still building the layout.
		// Scanning here would put Vault I/O back on the startup critical path;
		// the plugin activates and refreshes this view from onLayoutReady().
		if (this.app.workspace.layoutReady) await this.refresh();
		this.decorateViewTitle();
	}

	async onClose(): Promise<void> {
		this.opened = false;
		this.clearCertificateCelebration();
		this.releaseMemberControls();
		this.viewTitleIconEl?.remove();
		this.viewTitleIconEl = null;
	}

	/**
	 * Lets go of what a member panel was holding beyond its own elements: the
	 * filter picker owns a suggestion list that would outlive its field, and a
	 * table may have a frame queued that would wake to a page that has gone.
	 */
	private releaseMemberControls(): void {
		// The panel lives outside the view's own element, so a render that
		// throws its toolbar away would otherwise leave it hanging there.
		this.closeFilterPanel();
		this.releaseFilterPickers();
		this.characterTable?.destroy();
		this.characterTable = null;
		this.sceneTable?.destroy();
		this.sceneTable = null;
		this.entityTable?.destroy();
		this.entityTable = null;
	}

	async refresh(): Promise<void> {
		// A leaf that has not been told which project it is for has nothing to
		// draw, and asking the host with no path would have it answer with the
		// current project — another leaf's. Waiting costs a beat; setState draws
		// as soon as it arrives.
		if (this.projectPath === null && !this.stateDelivered) return;
		if (this.refreshing) {
			this.refreshPending = true;
			return;
		}
		this.refreshing = true;
		try {
			do {
				this.refreshPending = false;
				try {
					const requestedProjectPath = this.projectPath;
					const [projects, model] = await Promise.all([
						this.host.listProjects(),
						this.host.loadDashboardModel(requestedProjectPath),
					]);
					if (requestedProjectPath !== this.projectPath) {
						this.refreshPending = true;
						continue;
					}
					if (model === null && this.projectPath !== null) {
						this.leaf.detach();
						return;
					}
					this.render(projects, model);
				} catch (error) {
					this.renderError(error);
				}
			} while (this.refreshPending);
		} finally {
			this.refreshing = false;
		}
	}

	private render(
		projects: Awaited<ReturnType<DashboardHost['listProjects']>>,
		model: ProjectDashboardModel | null,
	): void {
		this.lastRender = { projects, model };
		// Once a project is in hand, the first render of the session opens on the
		// step still waiting to be done. Only the first: from here on the step is
		// whatever the author last moved to, which is what returning to a tab they
		// left open should give them.
		if (model !== null && !this.stepChosen) {
			this.selectedStep = getFirstIncompleteStep(stepStatusesOf(model));
			this.selectedPane = { kind: 'step', step: this.selectedStep };
			this.stepChosen = true;
		}
		this.renderState.capture(this.contentEl);
		const continuity = dashboardRenderContinuity(
			{ projectId: this.renderedProjectId, pane: this.renderedPaneKey },
			{
				projectId: model?.projectId ?? null,
				pane: dashboardPaneKey(this.selectedPane),
			},
		);
		if (!continuity.sameProject) {
			this.renderState.clear();
			// Another project's rows are not coming back, and their measured
			// heights would otherwise pile up for as long as the view is open.
			this.characterHeights.clear();
			this.sceneHeights.clear();
		}
		if (!continuity.samePanel) this.renderState.resetScroll(MAIN_PANEL_SELECTOR);
		this.rendered = true;
		if (model === null && projects.length === 0) {
			this.projectPath = null;
			this.projectTitle = null;
			this.projectLocale = null;
		} else {
			this.projectPath = model?.path ?? this.projectPath;
			this.projectTitle = model?.title ?? this.projectTitle;
			this.projectLocale = model?.locale ?? null;
		}
		this.updateViewTitle();
		this.renderedProjectId = model?.projectId ?? null;
		this.renderedProjectPath = model?.path ?? null;
		this.renderedProjectComplete = false;
		this.renderedStep = null;
		this.renderedPaneKey = null;
		this.renderedModel = model;
		// Both belong to the DOM about to go.
		this.releaseMemberControls();
		const root = this.contentEl;
		root.empty();
		this.celebrationEl = null;
		root.addClass('snowflake-method-dashboard');

		if (model === null) {
			this.renderEmpty(root);
			return;
		}

		const completedSteps = model.steps.filter(
			(step) => step.status === 'complete' || step.status === 'skipped',
		).length;
		const progressBlock = root.createDiv({
			cls: 'snowflake-method-progress-block',
		});
		const progressMeta = progressBlock.createDiv({
			cls: 'snowflake-method-progress-meta',
		});
		progressMeta.createSpan({ text: this.t('dashboard.progress') });
		progressMeta.createEl('strong', {
			text: `${completedSteps} / ${model.steps.length}`,
		});
		const progress = progressBlock.createEl('progress', {
			cls: 'snowflake-method-progress',
			attr: {
				max: String(model.steps.length),
				value: String(completedSteps),
				'aria-label': this.t('dashboard.progress'),
			},
		});
		progress.value = completedSteps;

		if (model.readOnly) {
			const readOnlyNotice = root.createDiv({
				cls: 'snowflake-method-repair-callout snowflake-method-schema-notice',
				attr: { role: 'status' },
			});
			const readOnlyIcon = readOnlyNotice.createSpan({
				cls: 'snowflake-method-repair-callout-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(readOnlyIcon, 'shield-alert');
			const readOnlyCopy = readOnlyNotice.createDiv({
				cls: 'snowflake-method-repair-callout-copy',
			});
			readOnlyCopy.createEl('h3', {
				text: this.t('dashboard.readOnlyTitle'),
			});
			readOnlyCopy.createEl('p', {
				text: model.readOnlyReason ?? this.t('dashboard.readOnlySchema'),
			});
		}

		const globalStructureIssues = model.structureIssues.filter(
			shouldShowGlobalStructureIssue,
		);
		if (globalStructureIssues.length > 0) {
			this.renderManagedSectionIssues(root, globalStructureIssues);
		}

		const layout = root.createDiv({ cls: 'snowflake-method-layout' });
		this.renderStepNavigation(layout, model, projects);
		this.renderSelectedStep(layout, model);
		// Deferred to here so both scrollers are measured against the finished
		// layout: the step list and the main panel share a grid row, and the row's
		// height is not settled until the panel beside it exists.
		this.renderState.restore(root);
		if (continuity.revealActiveStep) {
			this.renderState.reveal(root, STEP_LIST_SELECTOR, ACTIVE_STEP_SELECTOR);
		}
	}

	private createDisclosure(
		parent: HTMLElement,
		key: string,
		cls: string,
		defaultOpen = false,
	): HTMLDetailsElement {
		return this.renderState.createDisclosure(parent, key, cls, defaultOpen);
	}

	private decorateViewTitle(): void {
		const title = this.containerEl.querySelector<HTMLElement>(
			'.view-header-title',
		);
		if (title === null) return;
		if (this.viewTitleIconEl?.isConnected === true) return;
		const existingIcon = title.querySelector<HTMLElement>(
			'.snowflake-method-view-title-icon',
		);
		if (existingIcon !== null) {
			this.viewTitleIconEl = existingIcon;
			return;
		}

		const icon = title.createSpan({
			cls: 'snowflake-method-view-title-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, 'snowflake');
		title.prepend(icon);
		this.viewTitleIconEl = icon;
	}

	private updateViewTitle(): void {
		const leaf = this.leaf as WorkspaceLeaf & {
			updateHeader?: () => void;
			tabHeaderEl?: HTMLElement;
		};
		leaf.updateHeader?.();
		const fullTitle = this.getFullDisplayText();
		if (leaf.tabHeaderEl !== undefined) setTooltip(leaf.tabHeaderEl, fullTitle);
		this.containerEl
			.querySelector<HTMLElement>('.view-header-title')
			?.setText(fullTitle);
		this.viewTitleIconEl = null;
		this.decorateViewTitle();
	}

	private getFullDisplayText(): string {
		const dashboardTitle = this.t('dashboard.title');
		return this.projectTitle === null
			? dashboardTitle
			: `${dashboardTitle} - ${this.projectTitle}`;
	}

	private renderStepNavigation(
		layout: HTMLElement,
		model: ProjectDashboardModel,
		projects: Awaited<ReturnType<DashboardHost['listProjects']>>,
	): void {
		const nav = layout.createEl('nav', {
			cls: 'snowflake-method-step-nav',
			attr: { 'aria-label': this.t('dashboard.steps') },
		});
		const stepsGroup = this.createRailGroup(
			nav,
			'steps',
			this.t('dashboard.steps'),
		);
		const list = stepsGroup.createEl('ol', { cls: 'snowflake-method-step-list' });
		for (const step of model.steps) {
			const active =
				this.selectedPane.kind === 'step' && step.id === this.selectedPane.step;
			const damaged = this.getStepHealthIssues(model, step.id).some(
				(issue) => issue.blocking,
			);
			const stepTitle = damaged
				? `${step.title} · ${this.t('editor.managedSection.damagedTitle')}`
				: step.title;
			const item = list.createEl('li', {
				cls: 'snowflake-method-step-item',
			});
			const button = item.createEl('button', {
				cls: `snowflake-method-step-button${
					active ? ' is-active' : ''
				}${damaged ? ' has-managed-section-issue' : ''}`,
				attr: {
					type: 'button',
					'aria-label': stepTitle,
					...(damaged ? { 'aria-invalid': 'true' } : {}),
					...(active ? { 'aria-current': 'step' } : {}),
				},
			});
			button.createSpan({
				cls: 'snowflake-method-step-number',
				text: this.t(`steps.number.${step.id}`),
			});
			button.createSpan({
				cls: 'snowflake-method-step-label',
				text: step.title,
			});
			const indicator = button.createSpan({
				cls: 'snowflake-method-step-indicator',
				attr: {
					'aria-label': damaged
						? this.t('editor.managedSection.damagedTitle')
						: this.t(`status.${step.status}`),
				},
			});
			indicator.dataset.status = step.status;
			if (damaged) {
				indicator.addClass('has-managed-section-issue');
				setIcon(indicator, 'triangle-alert');
			} else {
				indicator.setText(this.statusGlyph(step.status));
			}
			button.addEventListener('click', () => {
				this.selectedStep = step.id;
				this.selectedPane = { kind: 'step', step: step.id };
				this.stepChosen = true;
				void this.runAndRefresh(() => this.host.selectStep(step.id));
			});
		}

		this.renderWorldbuildingGroup(nav, model);

		const projectFooter = nav.createDiv({
			cls: 'snowflake-method-project-footer',
		});
		const projectSwitcherLabel = `${this.t('dashboard.projectSwitcher')}: ${model.title}`;
		const projectControl = projectFooter.createEl('button', {
			cls: 'snowflake-method-project-control',
			attr: {
				type: 'button',
				'aria-haspopup': 'menu',
				'aria-expanded': 'false',
				'aria-label': projectSwitcherLabel,
			},
		});
		const switcherIcon = projectControl.createSpan({
			cls: 'snowflake-method-project-switcher-icon',
		});
		setIcon(switcherIcon, 'chevrons-up-down');
		projectControl.createSpan({
			cls: 'snowflake-method-project-switcher-label',
			text: model.title,
		});
		projectControl.addEventListener('click', () => {
			const menu = new Menu();
			menu.setParentElement(projectFooter);
			for (const project of projects) {
				menu.addItem((item) => {
					item.setTitle(project.title);
					if (project.hasStructureIssues || project.hasMarkerIssues) {
						item.setIcon('triangle-alert');
					}
					return item.setChecked(project.path === model.path).onClick(() => {
							void this.host
								.selectProject(project.path)
								.catch((error: unknown) => this.renderError(error));
						});
				});
			}
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(this.t('dashboard.manageProjects'))
					.onClick(() => {
						void this.host
							.openProjectManager(this.projectLocale)
							.catch((error: unknown) => this.renderError(error));
					}),
			);
			projectControl.setAttribute('aria-expanded', 'true');
			menu.onHide(() => {
				projectControl.setAttribute('aria-expanded', 'false');
			});
			const rect = projectControl.getBoundingClientRect();
			menu.showAtPosition({
				x: rect.left,
				y: rect.top,
				width: Math.max(rect.width, 240),
				overlap: true,
			});
		});

		const projectActions = projectFooter.createDiv({
			cls: 'snowflake-method-project-actions',
		});
		this.addToolbarButton(projectActions, 'circle-plus', 'actions.newProject', () => {
			this.openCreateProjectFromDashboard();
		});
		const hasHealthIssues = dashboardHasHealthIssues(model);
		const healthButton = this.addToolbarButton(
			projectActions,
			'shield-check',
			'actions.repair',
			() => {
			void this.runAndRefresh(async () => {
				const report = await this.host.checkCurrentProject();
				this.showRepairReport(report);
			});
			},
		);
		healthButton.addClass(
			hasHealthIssues ? 'has-health-issues' : 'is-health-healthy',
		);
		const healthStatus = this.t(
			hasHealthIssues
				? 'projectHealth.needsAttention'
				: 'messages.healthCheckPassed',
		);
		const healthLabel = `${this.t('actions.repair')}: ${healthStatus}`;
		setTooltip(healthButton, healthLabel);
	}

	private openCreateProjectFromDashboard(): void {
		void this.openCreateProject(
			this.t,
			this.projectLocale ?? this.host.getDefaultProjectLocale(),
		);
	}

	private async openCreateProject(
		t: Translate,
		locale: 'en' | 'zh-CN',
	): Promise<void> {
		try {
			const existing = await this.host.listProjects();
			new CreateProjectModal(
				this.app,
				t,
				locale,
				existing.map((project) => project.title),
				async (request) => {
					const project = await this.host.createProject(request);
					await this.host.selectProject(project.path);
					await this.refresh();
				},
			).open();
		} catch (error) {
			new Notice(
				error instanceof Error ? error.message : this.t('errors.unknown'),
			);
		}
	}

	private bindProject(project: CreatedProject): void {
		this.projectPath = project.path;
		this.projectTitle = project.title;
		this.projectLocale = project.locale;
		this.selectedStep = 1;
		this.updateViewTitle();
	}

	private activateProjectContext(): void {
		if (this.projectPath === null || this.projectLocale === null) return;
		this.host.activateProject(
			this.projectPath,
			this.projectLocale,
			this.selectedStep,
		);
	}

	async activateFromWorkspace(): Promise<void> {
		await this.refreshFromWorkspace();
		this.activateProjectContext();
	}

	async refreshFromWorkspace(): Promise<void> {
		if (!this.rendered || this.renderedProjectPath !== this.projectPath) {
			await this.refresh();
		}
	}

	/**
	 * One collapsible group of the rail. The fold is presentation state the
	 * author sets, so it rides the view state rather than the DOM.
	 */
	private createRailGroup(
		nav: HTMLElement,
		key: keyof DashboardRailCollapse,
		title: string,
	): HTMLElement {
		const group = nav.createDiv({ cls: 'snowflake-method-rail-group' });
		const header = group.createEl('button', {
			cls: 'snowflake-method-step-nav-header snowflake-method-rail-group-header',
			attr: {
				type: 'button',
				'aria-expanded': this.railCollapsed[key] ? 'false' : 'true',
			},
		});
		const chevron = header.createSpan({
			cls: 'snowflake-method-rail-group-chevron',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(chevron, this.railCollapsed[key] ? 'chevron-right' : 'chevron-down');
		header.createSpan({ text: title });
		const body = group.createDiv({ cls: 'snowflake-method-rail-group-body' });
		if (this.railCollapsed[key]) body.addClass('is-collapsed');
		header.addEventListener('click', () => {
			this.railCollapsed = {
				...this.railCollapsed,
				[key]: !this.railCollapsed[key],
			};
			body.toggleClass('is-collapsed', this.railCollapsed[key]);
			header.setAttribute(
				'aria-expanded',
				this.railCollapsed[key] ? 'false' : 'true',
			);
			setIcon(
				chevron,
				this.railCollapsed[key] ? 'chevron-right' : 'chevron-down',
			);
			this.app.workspace.requestSaveLayout();
		});
		return body;
	}

	private renderWorldbuildingGroup(
		nav: HTMLElement,
		model: ProjectDashboardModel,
	): void {
		const body = this.createRailGroup(
			nav,
			'worldbuilding',
			this.t('dashboard.worldbuilding'),
		);
		const list = body.createEl('ol', {
			cls: 'snowflake-method-step-list snowflake-method-worldbuilding-list',
		});
		for (const kind of WORLDBUILDING_KINDS) {
			const active =
				this.selectedPane.kind === 'worldbuilding' &&
				this.selectedPane.wbKind === kind;
			const entities = model.worldbuilding[kind];
			const damaged = entities.some((entity) =>
				entity.healthIssues.some((issue) => issue.blocking),
			);
			const title = this.t(`worldbuilding.kind.${kind}`);
			const item = list.createEl('li', { cls: 'snowflake-method-step-item' });
			const button = item.createEl('button', {
				cls: `snowflake-method-step-button${active ? ' is-active' : ''}${
					damaged ? ' has-managed-section-issue' : ''
				}`,
				attr: {
					type: 'button',
					'aria-label': title,
					...(damaged ? { 'aria-invalid': 'true' } : {}),
					...(active ? { 'aria-current': 'true' } : {}),
				},
			});
			const iconEl = button.createSpan({
				cls: 'snowflake-method-step-number snowflake-method-worldbuilding-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(iconEl, WORLDBUILDING_KIND_ICONS[kind]);
			button.createSpan({
				cls: 'snowflake-method-step-label',
				text: title,
			});
			const indicator = button.createSpan({
				cls: 'snowflake-method-step-indicator snowflake-method-worldbuilding-count',
				attr: { 'aria-label': String(entities.length) },
			});
			if (damaged) {
				indicator.addClass('has-managed-section-issue');
				setIcon(indicator, 'triangle-alert');
			} else {
				indicator.setText(String(entities.length));
			}
			button.addEventListener('click', () => {
				this.selectedPane = { kind: 'worldbuilding', wbKind: kind };
				this.stepChosen = true;
				void this.runAndRefresh(() => this.host.selectWorldbuildingKind(kind));
			});
		}
	}

	/**
	 * The panel one worldbuilding kind fills: the same shape as a member step,
	 * with the records living behind the entity form rather than in prose.
	 */
	private renderWorldbuildingPane(
		layout: HTMLElement,
		model: ProjectDashboardModel,
		kind: WorldbuildingKind,
	): void {
		const main = layout.createEl('main', { cls: 'snowflake-method-main' });
		this.renderedPaneKey = dashboardPaneKey({ kind: 'worldbuilding', wbKind: kind });
		const panel = main.createDiv({ cls: 'snowflake-method-panel' });
		// The same header a step panel carries, so a kind's title sits where a
		// step's does and reads at the same size.
		const header = panel.createDiv({ cls: 'snowflake-method-panel-header' });
		const title = header.createDiv({ cls: 'snowflake-method-panel-title' });
		title.createEl('h2', { text: this.t(`worldbuilding.kind.${kind}`) });
		panel.createEl('p', {
			cls: 'snowflake-method-step-description',
			text: this.t(`worldbuilding.kind.${kind}.description`),
		});
		const blockingIssues = model.worldbuilding[kind]
			.flatMap((entity) => entity.healthIssues)
			.filter((issue) => issue.blocking);
		if (blockingIssues.length > 0) {
			this.renderManagedSectionIssues(panel, blockingIssues);
		}

		const actions = panel.createDiv({
			cls: 'snowflake-method-actions snowflake-method-list-actions',
		});
		this.renderOpenBase(actions, kind, model);
		const add = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t(`worldbuilding.add.${kind}`),
			attr: { type: 'button' },
		});
		add.disabled = model.readOnly;
		add.addEventListener('click', () => {
			this.openCreateEntity(model, kind);
		});

		if (model.worldbuilding[kind].length === 0) {
			const empty = panel.createEl('p', {
				cls: 'snowflake-method-character-empty',
			});
			const icon = empty.createSpan({
				cls: 'snowflake-method-character-empty-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(icon, 'triangle-alert');
			empty.createSpan({ text: this.t(`worldbuilding.empty.${kind}`) });
			return;
		}

		// The same frame the character and scene tables stand in, so a project
		// reads the same whichever of its lists is on show.
		panel.addClass('snowflake-method-member-panel');
		const toolbar = panel.createDiv({ cls: 'snowflake-method-table-toolbar' });
		const search = new SearchComponent(toolbar);
		search.setPlaceholder(this.t(`worldbuilding.search.${kind}`));
		search.setValue(this.entityQueries.get(kind) ?? '');
		void this.loadEntityCategories(model, kind);
		const count = toolbar.createSpan({ cls: 'snowflake-method-table-count' });
		const filterSlot = toolbar.createDiv({
			cls: 'snowflake-method-table-filter',
		});
		const filterButton = filterSlot.createEl('button', {
			cls: 'clickable-icon snowflake-method-filter-button',
			attr: {
				type: 'button',
				'aria-haspopup': 'dialog',
				'aria-expanded': 'false',
				'aria-label': this.t('table.filter'),
			},
		});
		setIcon(filterButton, 'funnel');
		setTooltip(filterButton, this.t('table.filter'));

		const { headWrap, bodyWrap, body } = this.buildTableFrame(
			panel,
			'snowflake-method-entity-table',
			[
				this.t('table.order'),
				this.t('table.name'),
				this.t('table.category'),
				this.t('table.description'),
				this.t('table.actions'),
			],
		);
		const reorderReadOnly =
			model.readOnly ||
			model.worldbuilding[kind].some((entity) => entity.readOnly);

		let entries: { entity: WorldbuildingEntityViewModel; index: number }[] = [];
		const virtual = new VirtualTable({
			scroller: bodyWrap,
			body,
			columns: 5,
			estimatedRowHeight: this.entityRowHeight,
			overscan: 8,
			rowKey: (offset) => entries[offset]?.entity.id ?? `?${String(offset)}`,
			heights: this.entityHeights,
			renderRow: (rows, offset) => {
				const entry = entries[offset];
				if (entry === undefined) return;
				this.renderEntityRow(
					rows,
					model,
					kind,
					entry.entity,
					entry.index,
					reorderReadOnly,
					reorderReadOnly || this.entityListFiltered(kind),
				);
			},
			renderTail: (rows) => {
				this.renderAddRow(
					rows,
					5,
					this.t(`worldbuilding.addMore.${kind}`),
					model.readOnly,
					() => {
						this.openCreateEntity(model, kind);
					},
				);
			},
			onScroll: (top) => {
				this.entityScroll.set(kind, top);
				headWrap.scrollLeft = bodyWrap.scrollLeft;
			},
			onMeasure: (height) => {
				this.entityRowHeight = height;
			},
		});
		this.entityTable = virtual;
		const feed = (resetScroll: boolean): void => {
			if (resetScroll) {
				this.entityScroll.set(kind, 0);
				bodyWrap.scrollTop = 0;
			}
			entries = this.entityEntries(model, kind);
			count.setText(
				this.entityListFiltered(kind)
					? this.t('table.filteredCount', {
							shown: entries.length,
							total: model.worldbuilding[kind].length,
						})
					: '',
			);
			virtual.setTotal(entries.length);
		};
		search.onChange((value) => {
			this.entityQueries.set(kind, value);
			feed(true);
		});
		const markFilterButton = (): void => {
			filterButton.toggleClass('is-active', this.entityFiltered(kind));
		};
		markFilterButton();
		filterButton.addEventListener('click', () => {
			if (this.filterPanel !== null) {
				this.closeFilterPanel();
				return;
			}
			this.openFilterPanel(
				filterButton,
				this.entityFilterRows(model, kind),
				() => {
					markFilterButton();
					feed(true);
				},
			);
		});
		feed(false);
		bodyWrap.scrollTop = this.entityScroll.get(kind) ?? 0;
		virtual.refresh();
	}

	/** The rows one kind's table shows, each with its place in the list. */
	private entityEntries(
		model: ProjectDashboardModel,
		kind: WorldbuildingKind,
	): { entity: WorldbuildingEntityViewModel; index: number }[] {
		const query = this.entityQueries.get(kind) ?? '';
		const category = this.entityCategoryFilters.get(kind) ?? '';
		const status = this.entityStatusFilters.get(kind) ?? 'all';
		return model.worldbuilding[kind]
			.map((entity, index) => ({ entity, index }))
			.filter(
				({ entity }) =>
					(category === '' ||
						entity.categoryPaths.some((path) =>
							categoryWithin(path, category),
						)) &&
					(status === 'all' || entity.progressStatus === status) &&
					memberMatches(
						[
							entity.name,
							...entity.aliases,
							...entity.categoryPaths,
							...(entity.progressStatus === null
								? []
								: [this.t(`status.${entity.progressStatus}`)]),
							entity.description,
						],
						query,
					),
			);
	}

	private entityFiltered(kind: WorldbuildingKind): boolean {
		return (
			(this.entityCategoryFilters.get(kind) ?? '') !== '' ||
			(this.entityStatusFilters.get(kind) ?? 'all') !== 'all'
		);
	}

	private entityListFiltered(kind: WorldbuildingKind): boolean {
		return (
			(this.entityQueries.get(kind) ?? '').trim().length > 0 ||
			this.entityFiltered(kind)
		);
	}

	private entityFilterRows(
		model: ProjectDashboardModel,
		kind: WorldbuildingKind,
	): MemberFilterRow[] {
		return [
			this.progressFilterRow(
				this.entityStatusFilters.get(kind) ?? 'all',
				(next) => {
					this.entityStatusFilters.set(kind, next);
				},
			),
			this.categoryFilterRow(
				this.entityCategories.get(kind)?.projectId === model.projectId
					? (this.entityCategories.get(kind)?.paths ?? [])
					: [],
				this.entityCategoryFilters.get(kind) ?? '',
				(next) => {
					this.entityCategoryFilters.set(kind, next);
				},
			),
		];
	}

	private async loadEntityCategories(
		model: ProjectDashboardModel,
		kind: WorldbuildingKind,
	): Promise<void> {
		let paths: string[] = [];
		try {
			paths = await this.host.listDefinitionPaths(kind, 'category');
		} catch {
			paths = [];
		}
		this.entityCategories.set(kind, { projectId: model.projectId, paths });
	}

	private renderEntityRow(
		body: HTMLElement,
		model: ProjectDashboardModel,
		kind: WorldbuildingKind,
		entity: WorldbuildingEntityViewModel,
		index: number,
		reorderReadOnly: boolean,
		dragLocked: boolean,
	): void {
		const damaged = entity.healthIssues.some((issue) => issue.blocking);
		const row = body.createEl('tr', {
			attr: { draggable: dragLocked ? 'false' : 'true' },
		});
		row.dataset.entityId = entity.id;
		row.toggleClass('has-managed-section-issue', damaged);
		row.createEl('td', {
			text: String(index + 1),
			attr: { 'data-label': this.t('table.order') },
		});
		const nameCell = row.createEl('td', {
			cls: 'snowflake-method-table-primary',
			attr: { 'data-label': this.t('table.name') },
		});
		this.renderMemberNameCell(nameCell, {
			name: entity.name,
			drifted: entity.nameDrifted,
			damaged,
			aliases: entity.aliases,
			// What a time note is and what it spans, a fact to a line: its own,
			// which the other kinds have none of and the columns no room for.
			details:
				kind === 'time'
					? [
							entity.timeKind === null
								? ''
								: this.t(`form.timeKind.${entity.timeKind}`),
							termName(entity.timeStart),
							termName(entity.timeEnd),
						].filter((fact) => fact.length > 0)
					: undefined,
			progressStatus: entity.progressStatus,
		});
		const categoryCell = row.createEl('td', {
			cls: 'snowflake-method-member-categories',
			attr: { 'data-label': this.t('table.category') },
		});
		for (const path of entity.categoryPaths) {
			categoryCell.createDiv({
				cls: 'snowflake-method-member-category',
				text: path,
			});
		}
		row.createEl('td', {
			text: entity.description,
			attr: { 'data-label': this.t('table.description') },
		});
		const actionCell = row.createEl('td', {
			attr: { 'data-label': this.t('table.actions') },
		});
		const buttonGroup = actionCell.createDiv({
			cls: 'snowflake-method-table-actions',
		});
		const locked = model.readOnly || entity.readOnly || damaged;
		const openEntity = (): void => {
			void this.host.openManagedFile(entity.path, 'entity-fields', [
				'entity-fields',
			]);
		};
		const editEntity = (): void => {
			if (!locked) this.openEntityEditor(model, entity);
		};
		const splitButton = buttonGroup.createDiv({
			cls: 'snowflake-method-character-split-button',
		});
		const edit = splitButton.createEl('button', {
			cls: 'snowflake-method-character-edit',
			text: this.t('actions.edit'),
			attr: { type: 'button' },
		});
		edit.disabled = locked;
		edit.addEventListener('click', editEntity);
		const trigger = splitButton.createEl('button', {
			cls: 'snowflake-method-character-action-menu-trigger',
			attr: {
				type: 'button',
				'aria-haspopup': 'menu',
				'aria-label': this.t('table.actions'),
			},
		});
		const triggerIcon = trigger.createSpan({
			cls: 'snowflake-method-character-action-menu-icon',
		});
		setIcon(triggerIcon, 'chevron-down');
		const entities = model.worldbuilding[kind];
		trigger.addEventListener('click', (event) => {
			// The same items a character's and a scene's menu carries, and no
			// delete: that is the button beside this one.
			const menu = new Menu();
			menu.setParentElement(splitButton);
			menu.addItem((item) =>
				item
					.setTitle(this.t('actions.edit'))
					.setIcon('pencil')
					.setDisabled(locked)
					.onClick(editEntity),
			);
			menu.addItem((item) =>
				item
					.setTitle(this.t('common.open'))
					.setIcon('file-text')
					.onClick(openEntity),
			);
			this.addOrderMenuItems(menu, {
				index,
				total: entities.length,
				locked: reorderReadOnly,
				readOnly: model.readOnly,
				insertTitleKey: `worldbuilding.insertAfter.${kind}`,
				options: () =>
					entities
						.map((candidate, at) => ({
							id: candidate.id,
							index: at,
							label: `${String(at + 1)}. ${candidate.name}`,
						}))
						.filter((candidate) => candidate.id !== entity.id),
				move: (toIndex) => this.host.reorderEntity(kind, entity.id, toIndex),
				reveal: () => {
					this.revealEntity(model, kind, entity.id);
				},
				insert: () => {
					this.insertEntityAfter(model, kind, index);
				},
			});
			menu.showAtMouseEvent(event);
		});
		const remove = buttonGroup.createEl('button', {
			cls: 'snowflake-method-character-delete',
			text: this.t('actions.delete'),
			attr: { type: 'button' },
		});
		remove.disabled = model.readOnly || entity.readOnly;
		remove.addEventListener('click', () => {
			void this.runAndRefresh(() =>
				this.host.deleteEntity(entity.id, entity.revision),
			);
		});
		if (!dragLocked) {
			this.makeRowReorderable(
				row,
				ENTITY_DRAG_TYPE,
				entity.id,
				index,
				(candidate) => entities.some((entry) => entry.id === candidate),
				(id, target) => this.host.reorderEntity(kind, id, target),
			);
		}
	}

	/** Scrolls one kind's table to a row, wherever the filters put it. */
	private revealEntity(
		model: ProjectDashboardModel,
		kind: WorldbuildingKind,
		id: string,
	): void {
		const at = this.entityEntries(model, kind).findIndex(
			(entry) => entry.entity.id === id,
		);
		if (at === -1) return;
		this.entityTable?.reveal(at);
	}

	/** Creates an entry and walks it back from the end to `index + 1`. */
	private insertEntityAfter(
		model: ProjectDashboardModel,
		kind: WorldbuildingKind,
		index: number,
	): void {
		void this.memberFormContext(model, kind).then((context) => {
			new EntityFormModal(
				this.app,
				this.t,
				kind,
				model.worldbuilding[kind].map((entity) => entity.name),
				context,
				async (request) => {
					const created = await this.host.createEntity(request);
					await this.host.reorderEntity(kind, created.id, index + 1);
					await this.refresh();
					this.revealEntity(model, kind, created.id);
				},
			).open();
		});
	}

	/**
	 * Everything the record editors need from the project, fetched fresh so
	 * the pickers list what the definition files hold right now. The kind is
	 * the note the form is for: each kind owns its own definition files, so a
	 * character form lists character vocabularies and an item form the item
	 * ones, while record targets stay free to point at any entity.
	 */
	private async memberFormContext(
		model: ProjectDashboardModel,
		kind: EntityKind,
	): Promise<MemberFormContext> {
		const [categoryPaths, worldStatusPaths, relationshipPaths, filePaths] =
			await Promise.all([
				this.host.listDefinitionPaths(kind, 'category'),
				this.host.listDefinitionPaths(kind, 'world-status'),
				this.host.listDefinitionPaths(kind, 'relationship'),
				this.host.definitionFilePaths(kind),
			]);
		const sourceFor = (
			id: DefinitionFileChoice,
			initial: string[],
		): DefinitionPathSource => {
			let paths = [...initial];
			return {
				list: () => paths,
				add: async (path, description) => {
					const result = await this.host.addDefinitionPath(
						kind,
						id,
						path,
						description,
					);
					if (!result.ok) {
						return result.code === 'too-deep'
							? this.t('form.definition.tooDeep', {
									count: MAX_DEFINITION_DEPTH,
								})
							: this.t('form.definition.invalid', { name: result.segment });
					}
					paths = await this.host.listDefinitionPaths(kind, id);
					return null;
				},
			};
		};
		const named = (
			entries: readonly { path: string; name: string }[],
		): PickerOption[] =>
			entries.map((entry) => ({ value: entry.path, label: entry.name }));
		// A time note whose kind this release no longer knows is still a time,
		// and a point is what an unnamed one is: leaving it out of both lists
		// would put it beyond every picker while its links still stand.
		const timesOfKind = (timeKind: TimeKind): PickerOption[] =>
			named(
				model.worldbuilding.time.filter((entity) =>
					timeKind === 'point'
						? entity.timeKind === 'point' || entity.timeKind === null
						: entity.timeKind === timeKind,
				),
			);
		const groups: Record<EntityGroupId, () => PickerOption[]> = {
			character: () => named(model.characters),
			scene: () =>
				named(
					model.scenes.map((scene) => ({
						path: scene.path,
						name: scene.title,
					})),
				),
			'time-point': () => timesOfKind('point'),
			'time-period': () => timesOfKind('period'),
			location: () => named(model.worldbuilding.location),
			item: () => named(model.worldbuilding.item),
		};
		// A stored link carries no file extension, so both sides are keyed
		// without one: otherwise every reference read back from a note looks
		// like a note the project has never heard of.
		const noteKey = (path: string): string => path.replace(/\.md$/u, '');
		const groupByPath = new Map<string, EntityGroupId>();
		for (const group of ENTITY_GROUP_IDS) {
			for (const option of groups[group]()) {
				groupByPath.set(noteKey(option.value), group);
			}
		}
		const members = [
			...named(model.characters),
			...named(
				model.scenes.map((scene) => ({ path: scene.path, name: scene.title })),
			),
			...WORLDBUILDING_KINDS.flatMap((kind) =>
				named(model.worldbuilding[kind]),
			),
		];
		const times = named(model.worldbuilding.time);
		// Notes made while this form has been open. The project behind it was
		// read before they existed, so without this a note made a moment ago is
		// one the form cannot say anything about, and its line goes unnamed.
		const madeHere = new Map<string, EntityGroupId>();
		return {
			notice: (message) => {
				new Notice(message);
			},
			entitiesIn: (group) => groups[group](),
			createIn: async (group, name, options) => {
				const created = await this.createInGroup(model, group, name, options);
				if (created !== null) madeHere.set(noteKey(created.value), group);
				return created;
			},
			groupOf: (path) =>
				groupByPath.get(noteKey(path)) ?? madeHere.get(noteKey(path)) ?? null,
			members: () => members,
			times: () => times,
			categories: sourceFor('category', categoryPaths),
			worldStatusLabels: sourceFor('world-status', worldStatusPaths),
			relationshipLabels: sourceFor('relationship', relationshipPaths),
			worldStatusPath: filePaths['world-status'],
			relationshipPath: filePaths.relationship,
		};
	}

	/**
	 * Makes the note a field asked for. Either the note's own form opens on top
	 * of the one being filled in, so everything about it is said while it is in
	 * mind, or the note is made from its name alone and left for later. Which
	 * one is a setting, because both are how somebody works.
	 */
	private async createInGroup(
		model: ProjectDashboardModel,
		group: EntityGroupId,
		rawName: string,
		options?: { onlyGroup?: boolean },
	): Promise<PickerOption | null> {
		const name = rawName.trim();
		if (name.length === 0) return null;
		if (this.host.opensFormWhenCreatingFromField()) {
			return this.createInGroupThroughForm(model, group, name, options);
		}
		const find = (path: string): PickerOption => ({ value: path, label: name });
		try {
			if (group === 'character') {
				const created = await this.quickCreateCharacter(name);
				return created === null ? null : find(created.path);
			}
			if (group === 'scene') {
				const created = await this.host.createScene({
					title: name,
					aliases: [],
					categoryPaths: [],
					progressStatus: 'not-started',
					povPath: '',
					times: [],
					locations: [],
					characterPaths: [],
					conflict: '',
					worldStatus: [],
					relationships: [],
					events: '',
				});
				await this.refresh();
				return find(created.path);
			}
			const kind: WorldbuildingKind =
				group === 'location' ? 'location' : group === 'item' ? 'item' : 'time';
			const created = await this.host.createEntity({
				kind,
				name,
				aliases: [],
				categoryPaths: [],
				progressStatus: 'not-started',
				description: '',
				timeKind:
					group === 'time-point'
						? 'point'
						: group === 'time-period'
							? 'period'
							: null,
				timeStart: '',
				timeEnd: '',
				worldStatus: [],
				relationships: [],
			});
			await this.refresh();
			return find(created.path);
		} catch (error) {
			new Notice(
				error instanceof Error ? error.message : this.t('errors.unknown'),
			);
			return null;
		}
	}

	/** A character from its name alone, with every other field left unset. */
	private async quickCreateCharacter(
		name: string,
	): Promise<CharacterOption | null> {
		try {
			const created = await this.host.createCharacter({
				name,
				aliases: [],
				categoryPaths: [],
				progressStatus: 'not-started',
				oneSentenceStoryline: '',
				oneParagraphStoryline: '',
				motivation: '',
				goal: '',
				conflict: '',
				growth: '',
				worldStatus: [],
				relationships: [],
			});
			await this.refresh();
			return created;
		} catch (error) {
			new Notice(
				error instanceof Error ? error.message : this.t('errors.unknown'),
			);
			return null;
		}
	}

	/**
	 * The same form the note would be created through anywhere else, opened on
	 * top of the one that asked for it and seeded with the name typed there.
	 * Resolves to null when the author closes it without creating anything.
	 */
	private async createInGroupThroughForm(
		model: ProjectDashboardModel,
		group: EntityGroupId,
		name: string,
		options?: { onlyGroup?: boolean },
	): Promise<PickerOption | null> {
		const report = (path: string, label: string): PickerOption => ({
			value: path,
			label,
		});
		if (group === 'character') {
			const context = await this.memberFormContext(model, 'character');
			const created = await promptForNewCharacter(
				this.app,
				this.t,
				model.characters.map((character) => character.name),
				name,
				(request) => this.host.createCharacter(request),
				context,
			);
			if (created === null) return null;
			await this.refresh();
			return report(created.path, created.name);
		}
		if (group === 'scene') {
			const context = await this.memberFormContext(model, 'scene');
			const created = await promptForNewScene(
				this.app,
				this.t,
				model.characters.map((character) => ({
					id: character.id,
					path: character.path,
					name: character.name,
				})),
				model.scenes.map((scene) => scene.title),
				name,
				async (request) => {
					const scene = await this.host.createScene(request);
					return report(scene.path, request.title);
				},
				context,
			);
			if (created === null) return null;
			await this.refresh();
			return created;
		}
		const kind: WorldbuildingKind =
			group === 'location' ? 'location' : group === 'item' ? 'item' : 'time';
		const context = await this.memberFormContext(model, kind);
		const created = await promptForNewEntity(
			this.app,
			this.t,
			kind,
			model.worldbuilding[kind].map((entity) => entity.name),
			context,
			{
				name,
				// The field asked for one kind of time, and the form opens on it.
				timeKind:
					group === 'time-point'
						? 'point'
						: group === 'time-period'
							? 'period'
							: undefined,
				// A field that takes nothing else holds the answer as well.
				lockTimeKind: options?.onlyGroup === true,
			},
			async (request) => {
				const entity = await this.host.createEntity(request);
				return report(entity.path, request.name);
			},
		);
		if (created === null) return null;
		await this.refresh();
		return created;
	}

	private openCreateEntity(
		model: ProjectDashboardModel,
		kind: WorldbuildingKind,
	): void {
		void this.memberFormContext(model, kind).then((context) => {
			new EntityFormModal(
				this.app,
				this.t,
				kind,
				model.worldbuilding[kind].map((entity) => entity.name),
				context,
				async (request) => {
					await this.host.createEntity(request);
					this.entityQueries.set(kind, '');
					await this.refresh();
				},
			).open();
		});
	}

	private openEntityEditor(
		model: ProjectDashboardModel,
		entity: WorldbuildingEntityViewModel,
	): void {
		void this.memberFormContext(model, entity.kind).then((context) => {
			new EntityFormModal(
				this.app,
				this.t,
				entity.kind,
				model.worldbuilding[entity.kind]
					.filter((candidate) => candidate.id !== entity.id)
					.map((candidate) => candidate.name),
				context,
				async (request) => {
					await this.host.updateEntity(entity.id, request);
					await this.refresh();
				},
				{
					kind: entity.kind,
					name: entity.name,
					aliases: entity.aliases,
					categoryPaths: entity.categoryPaths,
					progressStatus: entity.progressStatus ?? 'not-started',
					description: entity.description,
					timeKind: entity.timeKind,
					timeStart: entity.timeStart,
					timeEnd: entity.timeEnd,
					worldStatus: entity.worldStatus,
					relationships: entity.relationships,
					expectedRevision: entity.revision,
				},
			).open();
		});
	}

	private renderSelectedStep(
		layout: HTMLElement,
		model: ProjectDashboardModel,
	): void {
		if (this.selectedPane.kind === 'worldbuilding') {
			this.renderWorldbuildingPane(layout, model, this.selectedPane.wbKind);
			return;
		}
		const main = layout.createEl('main', { cls: 'snowflake-method-main' });
		const step =
			model.steps.find((candidate) => candidate.id === this.selectedStep) ??
			model.steps[0];
		if (step === undefined) return;
		this.renderedStep = step.id;
		this.renderedPaneKey = dashboardPaneKey({ kind: 'step', step: step.id });

		const panel = main.createDiv({
			cls: 'snowflake-method-panel',
		});
		const projectComplete = model.steps.every(
			(candidate) =>
				candidate.status === 'complete' ||
				(candidate.optional && candidate.status === 'skipped'),
		);
		const prerequisitesComplete = areStepPrerequisitesComplete(
			stepStatusesOf(model),
			step.id,
		);
		this.renderedProjectComplete = projectComplete;
		this.renderStepHeader(
			panel,
			step,
			model.readOnly,
			prerequisitesComplete,
		);
		this.renderStepDescription(panel, step, projectComplete);
		const stepHealthIssues = this.getStepHealthIssues(model, step.id).filter(
			(issue) => issue.blocking,
		);
		if (stepHealthIssues.length > 0) {
			this.renderManagedSectionIssues(panel, stepHealthIssues);
		}
		const contentReadOnly =
			model.readOnly ||
			step.contentReadOnly ||
			stepHealthIssues.some((issue) => issue.blocking);

		switch (step.id) {
			case 1:
				this.renderOneSentenceSummary(panel, model, contentReadOnly);
				break;
			case 2:
				this.renderOneParagraphSummary(panel, model, contentReadOnly);
				break;
			case 3:
			case 5:
			case 7:
				this.renderCharacters(panel, model, step.id);
				break;
			case 8:
			case 9:
				this.renderScenes(panel, model, step.id);
				break;
			case 10:
				this.renderManuscript(panel, model);
				break;
			default:
				this.renderOpenArtifact(panel, step, model);
				break;
		}
		if (!projectComplete || step.id === 10) {
			void this.host
				.syncCertificateCelebration(model.projectId, projectComplete)
				.then((shouldCelebrate) => {
					if (
						shouldCelebrate &&
						this.renderedProjectId === model.projectId &&
						this.selectedStep === 10
					) {
						this.scheduleCertificateCelebration(model.projectId);
					}
				})
				.catch((error: unknown) => {
					new Notice(
						error instanceof Error
							? error.message
							: this.t('errors.unknown'),
					);
				});
		}
	}

	/**
	 * Step 10 is where the novel gets written, and until now the panel had
	 * nothing in it but the congratulation. The way in to the manuscript belongs
	 * here rather than only in the command palette.
	 */
	private renderManuscript(
		panel: HTMLElement,
		model: ProjectDashboardModel,
	): void {
		const section = panel.createDiv({ cls: 'snowflake-method-step-ten-manuscript' });
		const open = section.createEl('button', {
			cls: 'mod-cta',
			text: this.t('step10.openManuscript'),
			attr: { type: 'button' },
		});
		open.addEventListener('click', () => {
			void this.host
				.openManuscriptStream(model.path)
				.catch((error: unknown) => {
					new Notice(
						error instanceof Error ? error.message : this.t('errors.unknown'),
					);
				});
		});
		// Where the author stopped, directly under the way in, because both are
		// ways in and the second one is the better of the two: a manuscript is
		// the part of a project nobody starts from the top of twice.
		const last = model.lastManuscriptNote;
		if (last !== null) {
			const resume = section.createDiv({
				cls: 'snowflake-method-step-ten-resume',
			});
			resume.createSpan({ text: this.t('step10.lastOpen') });
			const link = resume.createEl('button', {
				cls: 'snowflake-method-step-ten-resume-note',
				text: last.title,
				attr: { type: 'button' },
			});
			// The button says which note; the tooltip says which one of the notes
			// by that name, which is the whole reason the path is offered here.
			setTooltip(link, last.path);
			link.addEventListener('click', () => {
				void this.host
					.openManuscriptStream(model.path, last.path)
					.catch((error: unknown) => {
						new Notice(
							error instanceof Error ? error.message : this.t('errors.unknown'),
						);
					});
			});
		}

		section.createEl('p', {
			cls: 'snowflake-method-step-description',
			text: this.t('step10.manuscriptHint'),
		});
	}

	private scheduleCertificateCelebration(projectId: string): void {
		if (
			this.celebrationDelayTimer !== null ||
			this.host.isReduceMotionEnabled()
		) {
			return;
		}
		const viewWindow = this.contentEl.win;
		this.celebrationDelayWindow = viewWindow;
		this.celebrationDelayTimer = viewWindow.setTimeout(() => {
			this.celebrationDelayTimer = null;
			this.celebrationDelayWindow = null;
			if (
				this.renderedProjectId === projectId &&
				this.renderedProjectComplete &&
				this.selectedStep === 10
			) {
				this.playCertificateCelebration();
			}
		}, 600);
	}

	private playCertificateCelebration(): void {
		this.clearCertificateCelebration();
		if (this.host.isReduceMotionEnabled()) return;

		const overlay = this.contentEl.createDiv({
			cls: 'snowflake-method-celebration',
			attr: { 'aria-hidden': 'true' },
		});
		this.celebrationEl = overlay;

		for (let index = 0; index < 108; index += 1) {
			const classes = [
				'snowflake-method-confetti',
				`is-position-${Math.floor(Math.random() * 18)}`,
				`is-color-${index % 8}`,
				`is-timing-${Math.floor(Math.random() * 12)}`,
				`is-drift-${Math.floor(Math.random() * 9)}`,
			];
			if (index % 4 === 0) classes.push('is-round');
			overlay.createSpan({
				cls: classes,
			});
		}

		for (let burstIndex = 0; burstIndex < 7; burstIndex += 1) {
			const sparkCount = 30 + (burstIndex % 3) * 3;
			for (let index = 0; index < sparkCount; index += 1) {
				const ray =
					(Math.round(
						(index / sparkCount) * 36 + (Math.random() - 0.5) * 1.2,
					) +
					36) %
					36;
				overlay.createSpan({
					cls: [
						'snowflake-method-firework-spark',
						`is-burst-${burstIndex}`,
						`is-ray-${ray}`,
						`is-color-${(burstIndex + index) % 8}`,
						`is-distance-${Math.floor(Math.random() * 6)}`,
						`is-gravity-${Math.floor(Math.random() * 5)}`,
						`is-timing-${Math.floor(Math.random() * 5)}`,
					],
				});
			}
		}

		const viewWindow = this.contentEl.win;
		this.celebrationWindow = viewWindow;
		this.celebrationTimer = viewWindow.setTimeout(() => {
			this.clearCertificateCelebration();
		}, 4600);
	}

	private clearCertificateCelebration(): void {
		if (
			this.celebrationDelayTimer !== null &&
			this.celebrationDelayWindow !== null
		) {
			this.celebrationDelayWindow.clearTimeout(this.celebrationDelayTimer);
			this.celebrationDelayTimer = null;
		}
		this.celebrationDelayWindow = null;
		if (this.celebrationTimer !== null && this.celebrationWindow !== null) {
			this.celebrationWindow.clearTimeout(this.celebrationTimer);
			this.celebrationTimer = null;
		}
		this.celebrationWindow = null;
		this.celebrationEl?.remove();
		this.celebrationEl = null;
	}

	private getStepHealthIssues(
		model: ProjectDashboardModel,
		step: StepId,
	): ManagedSectionIssueViewModel[] {
		const structureIssues = model.structureIssues.filter((issue) =>
			issue.stepIds.includes(step),
		);
		const artifactIssues = model.steps.find((candidate) => candidate.id === step)
			?.healthIssues;
		if (artifactIssues !== undefined && artifactIssues.length > 0) {
			return [...structureIssues, ...artifactIssues];
		}
		if (step === 3 || step === 5 || step === 7) {
			return [
				...structureIssues,
				...model.characters.flatMap((character) => character.healthIssues),
			];
		}
		if (step === 8 || step === 9) {
			return [
				...structureIssues,
				...model.scenes.flatMap((scene) => scene.healthIssues),
			];
		}
		return structureIssues;
	}

	private renderManagedSectionIssues(
		panel: HTMLElement,
		issues: readonly ManagedSectionIssueViewModel[],
	): void {
		const callout = panel.createDiv({
			cls: 'snowflake-method-repair-callout',
			attr: { role: 'alert' },
		});
		const icon = callout.createSpan({
			cls: 'snowflake-method-repair-callout-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, 'triangle-alert');
		const copy = callout.createDiv({
			cls: 'snowflake-method-repair-callout-copy',
		});
		const hasStructureIssue = issues.some((issue) => issue.kind === 'structure');
		copy.createEl('h3', {
			text: this.t(
				hasStructureIssue
					? 'projectStructure.damagedTitle'
					: 'editor.managedSection.damagedTitle',
			),
		});
		copy.createEl('p', {
			text: this.t(
				hasStructureIssue
					? 'projectHealth.dashboardStructureSummary'
					: 'projectHealth.dashboardSectionSummary',
			),
		});
		const actions = callout.createDiv({
			cls: 'snowflake-method-repair-callout-actions',
		});
		const repair = actions.createEl('button', {
			text: this.t('actions.repair'),
			attr: { type: 'button' },
		});
		repair.addEventListener('click', () => {
			void this.runAndRefresh(async () => {
				const report = await this.host.checkCurrentProject();
				this.showRepairReport(report);
			});
		});
	}

	private showRepairReport(
		report: Awaited<ReturnType<DashboardHost['checkCurrentProject']>>,
	): void {
		new RepairReportModal(
			this.app,
			this.t,
			report,
			(path, sectionId) =>
				this.host.openManagedFile(path, sectionId ?? undefined),
			async (entry) => {
				await this.host.repairMissingStructureItem(
					entry.path,
					entry.repairField ?? undefined,
				);
				await this.refresh();
				return this.host.checkCurrentProject();
			},
			async (sceneId) => {
				const model = this.renderedModel;
				const scene = model?.scenes.find((candidate) => candidate.id === sceneId);
				if (model === undefined || model === null || scene === undefined) return;
				this.openSceneEditor(model, scene);
			},
		).open();
	}

	/**
	 * The name as the project stores it, marked when the note it belongs to no
	 * longer carries it. The same warm colour a point of view that names nobody
	 * gets: in both, the table is showing a name the Vault does not agree with.
	 */
	/**
	 * What a member row leads with: the name, and under it what else it goes by
	 * and how far along it is. One block inside the cell, so the card layout a
	 * narrow pane switches to still has a single thing to put beside the label.
	 */
	private renderMemberNameCell(
		cell: HTMLElement,
		member: {
			name: string;
			drifted: boolean;
			damaged: boolean;
			aliases: readonly string[];
			/** The member's own facts, one to a line, where its kind has any. */
			details?: readonly string[];
			progressStatus: ProgressStatus | null;
		},
	): void {
		setTooltip(cell, member.name);
		const block = cell.createDiv({ cls: 'snowflake-method-member-name-cell' });
		const line = block.createDiv({ cls: 'snowflake-method-member-name-line' });
		this.renderTableName(line, member.name, member.drifted);
		if (member.damaged) {
			const warning = line.createSpan({
				cls: 'snowflake-method-table-health-warning',
				attr: { 'aria-label': this.t('editor.managedSection.damagedTitle') },
			});
			setIcon(warning, 'triangle-alert');
		}
		// Quieter than the name, and each on a line of its own beneath it: what
		// else it goes by, what it is, then how far along it is.
		if (member.aliases.length > 0) {
			const aliases = member.aliases.join(', ');
			const aliasEl = block.createDiv({
				cls: 'snowflake-method-member-aliases',
				text: aliases,
			});
			setTooltip(aliasEl, `${this.t('form.aliases')}: ${aliases}`);
		}
		for (const fact of member.details ?? []) {
			if (fact.length === 0) continue;
			const detail = block.createDiv({
				cls: 'snowflake-method-member-detail',
				text: fact,
			});
			setTooltip(detail, fact);
		}
		if (member.progressStatus !== null) {
			block.createDiv({
				cls:
					'snowflake-method-entity-status snowflake-method-member-status ' +
					`is-${member.progressStatus}`,
				text: this.t(`status.${member.progressStatus}`),
			});
		}
	}

	private renderTableName(
		cell: HTMLElement,
		name: string,
		drifted: boolean,
	): void {
		if (!drifted) {
			cell.createSpan({ text: name });
			return;
		}
		const label = this.t('table.nameDrifted');
		cell.createSpan({
			cls: 'snowflake-method-table-missing-reference',
			text: name,
			attr: { 'aria-label': label},
		});
	}

	private renderStepDescription(
		panel: HTMLElement,
		step: StepViewModel,
		projectComplete: boolean,
	): void {
		const descriptionHost =
			step.id === 10
				? panel.createDiv({ cls: 'snowflake-method-step-ten-description-row' })
				: panel;
		const description = descriptionHost.createEl('p', {
			cls: 'snowflake-method-step-description',
		});
		if (step.id !== 10) {
			description.setText(step.description);
			return;
		}
		const [opening, ...emphasisParts] = step.description.split('\n');
		description.createSpan({ text: opening });
		const emphasis = emphasisParts.join('\n');
		if (emphasis.length > 0) {
			description.createEl('br');
			description.createSpan({
				cls: 'snowflake-method-step-description-emphasis',
				text: emphasis,
			});
		}
		if (projectComplete) {
			const label = this.t('step10.certificate');
			const certificateSlot = descriptionHost.createDiv({
				cls: 'snowflake-method-certificate-slot',
			});
			const certificate = certificateSlot.createDiv({
				cls: 'snowflake-method-certificate',
				attr: { role: 'img', 'aria-label': label},
			});
			setIcon(certificate, 'badge-check');
		}
	}

	private renderStepHeader(
		panel: HTMLElement,
		step: StepViewModel,
		readOnly: boolean,
		prerequisitesComplete: boolean,
	): void {
		const header = panel.createDiv({ cls: 'snowflake-method-panel-header' });
		const title = header.createDiv({ cls: 'snowflake-method-panel-title' });
		title.createEl('h2', {
			text: this.t('steps.titleFormat', {
				number: this.t(`steps.number.${step.id}`),
				title: step.title,
			}),
		});
		const status = header.createEl('select', {
			cls: 'dropdown snowflake-method-status-select',
			attr: { 'aria-label': this.t('status.label') },
		});
		const statuses: StepStatus[] =
			step.id === 10
				? ['not-started', 'complete']
				: ['not-started', 'in-progress', 'in-revision', 'complete'];
		if (step.id === 9) statuses.push('skipped');
		for (const value of statuses) {
			const option = status.createEl('option', {
				value,
				text: this.t(`status.${value}`),
			});
			if (value === 'complete' || value === 'skipped') {
				option.disabled = !prerequisitesComplete;
			}
			option.selected = step.status === value;
		}
		status.disabled = readOnly;
		status.addEventListener('change', () => {
			void this.runAndRefresh(() =>
				this.host.setStepStatus(step.id, status.value as StepStatus),
			);
		});
	}

	private renderOneSentenceSummary(
		panel: HTMLElement,
		model: ProjectDashboardModel,
		readOnly: boolean,
	): void {
		const draftKey = `${model.projectId}:1`;
		const draft = this.stepDrafts.get(draftKey);
		const fields = draft?.fields ?? model.stepFields[1] ?? {};
		const fieldReadOnly = readOnly;
		const inputs = new Map<
			StepOneSectionId,
			HTMLInputElement | HTMLTextAreaElement
		>();
		const audience = panel.createEl('section', {
			cls: 'snowflake-method-guided-section',
		});
		const audienceHeader = audience.createDiv({
			cls: 'snowflake-method-guided-section-header',
		});
		const audienceIcon = audienceHeader.createSpan({
			cls: 'snowflake-method-guided-section-icon',
		});
		setIcon(audienceIcon, 'users');
		audienceHeader.createEl('h3', {
			text: this.t('step1.targetReaders.title'),
		});
		audience.createEl('p', {
			text: this.t('step1.targetReaders.intro'),
		});
		const questions = this.createDisclosure(
			audience,
			'1:target-readers',
			'snowflake-method-guided-details',
		);
		const questionsSummary = questions.createEl('summary');
		questionsSummary.createSpan({
			text: this.t('step1.targetReaders.questions'),
		});
		questionsSummary.createSpan({
			cls: 'snowflake-method-status',
			text: this.t('common.recommended'),
		});
		const questionFields = questions.createDiv({
			cls: 'snowflake-method-question-fields',
		});
		inputs.set(
			'genre',
			this.addTextInputField(
				questionFields,
				this.t('fields.genre'),
				fields.genre ?? '',
				fieldReadOnly,
			),
		);
		const genreField = inputs.get('genre')?.parentElement;
		genreField?.addClass('snowflake-method-question-field-wide');
		const reasonsField = questionFields.createDiv({
			cls: 'snowflake-method-field snowflake-method-question-field-wide snowflake-method-audience-reasons-field',
		});
		reasonsField.createEl('label', {
			text: this.t('fields.audienceAppeal'),
		});
		const reasonsInput = reasonsField.createEl('textarea', {
			attr: {
				placeholder: this.t('fields.audienceReasonsPlaceholder'),
			},
		});
		reasonsInput.value = fields['audience-reason-1'] ?? '';
		reasonsInput.disabled = fieldReadOnly;
		inputs.set('audience-reason-1', reasonsInput);

		const writingHints = this.createDisclosure(
			panel,
			'1:hints',
			'snowflake-method-writing-hints',
		);
		const hintsSummary = writingHints.createEl('summary');
		const hintsIcon = hintsSummary.createSpan({
			cls: 'snowflake-method-writing-hints-icon',
		});
		setIcon(hintsIcon, 'lightbulb');
		hintsSummary.createSpan({ text: this.t('step1.hints.title') });
		const hintsList = writingHints.createEl('ol');
		for (const key of [
			'step1.hints.shorter',
			'step1.hints.characters',
			'step1.hints.pictures',
			'step1.hints.imagination',
			'step1.hints.revision',
		]) {
			const item = hintsList.createEl('li', { text: this.t(key) });
			if (
				key === 'step1.hints.imagination' ||
				key === 'step1.hints.revision'
			) {
				item.addClass('snowflake-method-hint-emphasis');
			}
		}

		const oneSentenceSummaryField = panel.createDiv({
			cls: 'snowflake-method-field snowflake-method-one-sentence-summary-field',
		});
		const textarea = oneSentenceSummaryField.createEl('textarea', {
			cls: 'snowflake-method-one-sentence-summary-input',
			attr: {
				'aria-label': this.t('fields.oneSentenceSummary'),
				placeholder: this.t('fields.oneSentenceSummaryPlaceholder'),
			},
		});
		textarea.value = fields['one-sentence-summary'] ?? '';
		textarea.disabled = fieldReadOnly;
		inputs.set('one-sentence-summary', textarea);
		const hint = panel.createEl('p', {
			cls: 'snowflake-method-hint snowflake-method-length-hint',
		});
		const lengthCount = hint.createSpan({
			cls: 'snowflake-method-length-count',
		});
		const updateHint = (): void => {
			const { total } = countWritingLength(textarea.value);
			lengthCount.setText(
				this.t('fields.oneSentenceSummaryCount', {
					count: total,
					unit: total === 1 ? 'word' : 'words',
				}),
			);
		};
		const candidateTitles = this.createDisclosure(
			panel,
			'1:candidate-titles',
			'snowflake-method-guided-section snowflake-method-optional-section',
			([1, 2, 3, 4, 5, 6] as const).some(
				(number) => (fields[`candidate-title-${number}`] ?? '').length > 0,
			),
		);
		const candidateSummary = candidateTitles.createEl('summary');
		candidateSummary.createSpan({
			text: this.t('step1.candidateTitles.title'),
		});
		candidateSummary.createSpan({
			cls: 'snowflake-method-status',
			text: this.t('common.optional'),
		});
		candidateTitles.createEl('p', {
			text: this.t('step1.candidateTitles.description'),
		});
		const titleFields = candidateTitles.createDiv({
			cls: 'snowflake-method-candidate-title-fields',
		});
		for (const number of [1, 2, 3, 4, 5, 6] as const) {
			const id = `candidate-title-${number}` as const;
			inputs.set(
				id,
				this.addTextInputField(
					titleFields,
					this.t('fields.candidateTitle', { number }),
					fields[id] ?? '',
					fieldReadOnly,
				),
			);
		}

		const collectFields = (): StepFields =>
			Object.fromEntries(
				STEP_ONE_SECTION_IDS.map((id) => [
					id,
					inputs.get(id)?.value ?? fields[id] ?? '',
				]),
			);
		const rememberDraft = (): void => {
			const activeDraft = this.stepDrafts.get(draftKey);
			this.stepDrafts.set(draftKey, {
				fields: collectFields(),
				expectedRevision:
					activeDraft?.expectedRevision ??
					draft?.expectedRevision ??
					model.stepRevisions[1] ??
					'',
			});
		};
		for (const input of inputs.values()) {
			input.addEventListener('input', () => {
				rememberDraft();
				if (input === textarea) updateHint();
			});
		}
		updateHint();
		this.addSaveAndOpenActions(
			panel,
			1,
			fieldReadOnly,
			async () => {
				const activeDraft = this.stepDrafts.get(draftKey);
				await this.host.saveStepFields(
					1,
					collectFields(),
					activeDraft?.expectedRevision ?? model.stepRevisions[1] ?? '',
				);
				this.stepDrafts.delete(draftKey);
			},
			() => this.stepDrafts.delete(draftKey),
		);
	}

	private renderOneParagraphSummary(
		panel: HTMLElement,
		model: ProjectDashboardModel,
		readOnly: boolean,
	): void {
		const draftKey = `${model.projectId}:2`;
		const draft = this.stepDrafts.get(draftKey);
		const current = draft?.fields ?? model.stepFields[2] ?? {};
		const paragraphSectionId = STEP_TWO_SECTION_IDS[0];
		const descriptionSectionId = STEP_TWO_SECTION_IDS[1];
		const writingHints = this.createDisclosure(
			panel,
			'2:hints',
			'snowflake-method-writing-hints',
		);
		const hintsSummary = writingHints.createEl('summary');
		const hintsIcon = hintsSummary.createSpan({
			cls: 'snowflake-method-writing-hints-icon',
		});
		setIcon(hintsIcon, 'lightbulb');
		hintsSummary.createSpan({ text: this.t('step2.hints.title') });
		const hintsList = writingHints.createEl('ol');
		for (const key of [
			'step2.hints.structure',
			'step2.hints.sentences',
			'step1.hints.imagination',
			'step1.hints.revision',
		]) {
			const item = hintsList.createEl('li', { text: this.t(key) });
			if (
				key === 'step1.hints.imagination' ||
				key === 'step1.hints.revision'
			) {
				item.addClass('snowflake-method-hint-emphasis');
			}
		}

		const oneSentenceSummary =
			model.stepFields[1]?.['one-sentence-summary'] ?? '';
		this.renderSourceSummary(
			panel,
			'step2.sourceSummary.title',
			'step2.sourceSummary.empty',
			oneSentenceSummary,
		);

		const paragraphField = panel.createDiv({
			cls: 'snowflake-method-field snowflake-method-one-paragraph-summary-field',
		});
		const input = paragraphField.createEl('textarea', {
			cls: 'snowflake-method-one-paragraph-summary-input',
			attr: {
				'aria-label': this.t('fields.oneParagraphSummary'),
				placeholder: this.t('fields.oneParagraphSummaryPlaceholder'),
				rows: '6',
			},
		});
		input.value = current[paragraphSectionId] ?? '';
		input.disabled = readOnly;

		const description = this.createDisclosure(
			panel,
			'2:description',
			'snowflake-method-guided-section snowflake-method-optional-section snowflake-method-description-section',
			(current[descriptionSectionId] ?? '').length > 0,
		);
		const descriptionSummary = description.createEl('summary');
		descriptionSummary.createSpan({
			text: this.t('step2.description.title'),
		});
		descriptionSummary.createSpan({
			cls: 'snowflake-method-status',
			text: this.t('common.optional'),
		});
		description.createEl('p', {
			text: this.t('step2.description.description'),
		});
		const descriptionField = description.createDiv({
			cls: 'snowflake-method-field snowflake-method-description-field',
		});
		const descriptionInput = descriptionField.createEl('textarea', {
			cls: 'snowflake-method-description-input',
			attr: {
				'aria-label': this.t('fields.description'),
				placeholder: this.t('fields.descriptionPlaceholder'),
				rows: '12',
			},
		});
		descriptionInput.value = current[descriptionSectionId] ?? '';
		descriptionInput.disabled = readOnly;

		const rememberDraft = (): void => {
			const activeDraft = this.stepDrafts.get(draftKey);
			this.stepDrafts.set(draftKey, {
				fields: {
					[paragraphSectionId]: input.value,
					[descriptionSectionId]: descriptionInput.value,
				},
				expectedRevision:
					activeDraft?.expectedRevision ?? model.stepRevisions[2] ?? '',
			});
		};
		input.addEventListener('input', rememberDraft);
		descriptionInput.addEventListener('input', rememberDraft);
		this.addSaveAndOpenActions(
			panel,
			2,
			readOnly,
			async () => {
				const activeDraft = this.stepDrafts.get(draftKey);
				await this.host.saveStepFields(
					2,
					{
						[paragraphSectionId]: input.value,
						[descriptionSectionId]: descriptionInput.value,
					},
					activeDraft?.expectedRevision ?? model.stepRevisions[2] ?? '',
				);
				this.stepDrafts.delete(draftKey);
			},
			() => this.stepDrafts.delete(draftKey),
		);
	}

	/**
	 * Opens the generated Bases view for this collection. Deliberately left
	 * enabled on a read-only project: an existing base still opens, and only
	 * writing a missing one is refused.
	 */
	private renderOpenBase(
		actions: HTMLElement,
		id: 'characters' | 'scenes' | WorldbuildingKind,
		model: ProjectDashboardModel,
	): void {
		const openBase = (): void => {
			void this.runAndRefresh(() => this.host.openProjectBase(id));
		};
		const splitButton = actions.createDiv({
			cls: 'snowflake-method-character-split-button snowflake-method-base-split-button',
		});
		const open = splitButton.createEl('button', {
			cls: 'snowflake-method-open-base',
			text: this.t('actions.openBase'),
			attr: { type: 'button' },
		});
		open.addEventListener('click', openBase);
		const actionMenu = splitButton.createEl('button', {
			cls: 'snowflake-method-character-action-menu-trigger',
			attr: {
				type: 'button',
				'aria-haspopup': 'menu',
				'aria-label': this.t('table.actions'),
			},
		});
		const menuIcon = actionMenu.createSpan({
			cls: 'snowflake-method-character-action-menu-icon',
		});
		setIcon(menuIcon, 'chevron-down');
		actionMenu.addEventListener('click', (event) => {
			const menu = new Menu();
			menu.setParentElement(splitButton);
			menu.addItem((item) =>
				item
					.setTitle(this.t('actions.restoreBase'))
					.setIcon('rotate-ccw')
					.setDisabled(model.readOnly)
					.onClick(() => {
						new ConfirmRestoreBaseModal(this.app, this.t, (confirmed) => {
							if (!confirmed) return;
							void this.runAndRefresh(() =>
								this.host.restoreProjectBase(id),
							);
						}).open();
					}),
			);
			menu.addItem((item) =>
				item
					.setTitle(this.t('actions.openBase'))
					.setIcon('layout-grid')
					.onClick(openBase),
			);
			menu.showAtMouseEvent(event);
		});
	}

	/**
	 * One line above the member tables while any writable note predates the
	 * generated fields block. Informational, never damage: the notes keep
	 * working from their properties until their author chooses to migrate.
	 */
	private renderMigrationCallout(
		panel: HTMLElement,
		model: ProjectDashboardModel,
	): void {
		if (model.unmigratedMembers === 0 || model.readOnly) return;
		const callout = panel.createDiv({
			cls: 'snowflake-method-migrate-callout',
			attr: { role: 'status' },
		});
		const icon = callout.createSpan({
			cls: 'snowflake-method-migrate-callout-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, 'info');
		callout.createSpan({
			cls: 'snowflake-method-migrate-callout-copy',
			text: this.t('migrate.membersCallout', {
				count: model.unmigratedMembers,
			}),
		});
		const action = callout.createEl('button', {
			text: this.t('migrate.membersAction'),
			attr: { type: 'button' },
		});
		action.addEventListener('click', () => {
			action.disabled = true;
			void this.host
				.migrateMemberNotes()
				.then(({ migrated, skipped }) => {
					new Notice(
						this.t('messages.migrateMemberNotesDone', { migrated, skipped }),
					);
				})
				.catch((error: unknown) => {
					action.disabled = false;
					new Notice(
						error instanceof Error ? error.message : this.t('errors.unknown'),
					);
				});
		});
	}

	private renderCharacters(
		panel: HTMLElement,
		model: ProjectDashboardModel,
		step: 3 | 5 | 7,
	): void {
		this.renderMigrationCallout(panel, model);
		const actions = panel.createDiv({
			cls: 'snowflake-method-actions snowflake-method-list-actions',
		});
		this.renderOpenBase(actions, 'characters', model);
		const add = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t('actions.addCharacter'),
			attr: { type: 'button' },
		});
		add.disabled = model.readOnly;
		add.addEventListener('click', () => this.openCreateCharacter(model));

		if (step === 5) {
			this.renderWritingHints(
				panel,
				step,
				'step5.hints.title',
				[
					'step5.hints.reorder',
					'step5.hints.openNote',
					'step5.hints.expand',
					'step5.hints.revision',
				],
				['step5.hints.revision'],
			);
		} else if (step === 7) {
			this.renderWritingHints(
				panel,
				step,
				'step7.hints.title',
				[
					'step7.hints.reorder',
					'step7.hints.openNote',
					'step7.hints.contents',
					'step1.hints.imagination',
					'step7.hints.storyDetails',
					'step7.hints.revision',
				],
				['step1.hints.imagination', 'step7.hints.revision'],
			);
		} else {
			this.renderWritingHints(
				panel,
				step,
				'characters.hints.title',
				['characters.hints.reorder', 'characters.hints.revision'],
				['characters.hints.revision'],
			);
		}

		if (model.characters.length === 0) {
			const empty = panel.createEl('p', {
				cls: 'snowflake-method-character-empty',
			});
			const icon = empty.createSpan({
				cls: 'snowflake-method-character-empty-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(icon, 'triangle-alert');
			empty.createSpan({ text: this.t('characters.empty') });
			return;
		}

		panel.addClass('snowflake-method-member-panel');
		const toolbar = panel.createDiv({ cls: 'snowflake-method-table-toolbar' });
		const search = new SearchComponent(toolbar);
		search.setPlaceholder(this.t('table.searchCharacters'));
		search.setValue(this.characterQuery);
		// The whole category tree, not only the paths characters already carry:
		// a filter is asked before the answer is known, and an empty category is
		// a fair thing to ask about. Fetched beside the render rather than in it,
		// and read live by the list below.
		void this.loadMemberCategories(model, 'character');
		const count = toolbar.createSpan({ cls: 'snowflake-method-table-count' });
		const filterSlot = toolbar.createDiv({
			cls: 'snowflake-method-table-filter',
		});
		// An icon button in Obsidian's own sense: `clickable-icon` is the class
		// its button styling stands aside for, so the funnel is the symbol
		// alone rather than a symbol on a slab.
		const filterButton = filterSlot.createEl('button', {
			cls: 'clickable-icon snowflake-method-filter-button',
			attr: {
				type: 'button',
				'aria-haspopup': 'dialog',
				'aria-expanded': 'false',
				'aria-label': this.t('table.filter'),
			},
		});
		setIcon(filterButton, 'funnel');
		setTooltip(filterButton, this.t('table.filter'));

		const { headWrap, bodyWrap, body } = this.buildTableFrame(
			panel,
			'snowflake-method-character-table',
			[
				this.t('table.order'),
				this.t('table.name'),
				this.t('table.category'),
				this.t('table.oneSentenceStoryline'),
				this.t('table.actions'),
			],
		);
		const reorderReadOnly =
			model.readOnly || model.characters.some((character) => character.readOnly);

		let entries: { character: CharacterViewModel; index: number }[] = [];
		const virtual = new VirtualTable({
			scroller: bodyWrap,
			body,
			columns: 5,
			estimatedRowHeight: this.characterRowHeight,
			overscan: 8,
			rowKey: (offset) =>
				entries[offset]?.character.id ?? `?${String(offset)}`,
			heights: this.characterHeights,
			renderRow: (rows, offset) => {
				const entry = entries[offset];
				if (entry === undefined) return;
				this.renderCharacterRow(
					rows,
					entry.character,
					entry.index,
					model,
					step,
					reorderReadOnly,
					reorderReadOnly || this.characterListFiltered(),
				);
			},
			renderTail: (rows) => {
				this.renderAddRow(
					rows,
					5,
					this.t('actions.addMoreCharacters'),
					model.readOnly,
					() => this.openCreateCharacter(model),
				);
			},
			onScroll: (top) => {
				this.characterScroll = top;
				headWrap.scrollLeft = bodyWrap.scrollLeft;
			},
			onMeasure: (height) => {
				this.characterRowHeight = height;
			},
		});
		this.characterTable = virtual;
		const feed = (resetScroll: boolean): void => {
			// A changed filter makes the old offset point at nothing the eye
			// was on, so the list starts back at its head.
			if (resetScroll) {
				this.characterScroll = 0;
				bodyWrap.scrollTop = 0;
			}
			entries = this.characterEntries(model);
			count.setText(
				this.characterListFiltered()
					? this.t('table.filteredCount', {
							shown: entries.length,
							total: model.characters.length,
						})
					: '',
			);
			virtual.setTotal(entries.length);
		};
		search.onChange((value) => {
			this.characterQuery = value;
			feed(true);
		});
		const markFilterButton = (): void => {
			filterButton.toggleClass(
				'is-active',
				this.characterCategoryFilter !== '' ||
					this.characterStatusFilter !== 'all',
			);
		};
		markFilterButton();
		filterButton.addEventListener('click', () => {
			if (this.filterPanel !== null) {
				this.closeFilterPanel();
				return;
			}
			this.openFilterPanel(filterButton, this.characterFilterRows(model), () => {
				markFilterButton();
				feed(true);
			});
		});
		feed(false);
		bodyWrap.scrollTop = this.characterScroll;
		virtual.refresh();
	}

	/** The progress row every member table's funnel opens with. */
	private progressFilterRow(
		value: 'all' | ProgressStatus,
		apply: (next: 'all' | ProgressStatus) => void,
	): MemberFilterRow {
		return {
			label: this.t('table.progressStatus'),
			placeholder: this.t('table.filterAllStatuses'),
			empty: 'all',
			options: () =>
				PROGRESS_STATUSES.map((status) => ({
					value: status,
					label: this.t(`status.${status}`),
				})),
			value,
			apply: (next) => {
				apply(isProgressStatus(next) ? next : 'all');
			},
		};
	}

	/** The category row, over one kind's whole tree. */
	private categoryFilterRow(
		paths: readonly string[],
		value: string,
		apply: (next: string) => void,
	): MemberFilterRow {
		return {
			label: this.t('table.category'),
			placeholder: this.t('table.filterAllCategories'),
			empty: '',
			options: () => paths.map((path) => ({ value: path, label: path })),
			value,
			apply,
		};
	}

	private characterFilterRows(
		model: ProjectDashboardModel,
	): MemberFilterRow[] {
		return [
			this.progressFilterRow(this.characterStatusFilter, (next) => {
				this.characterStatusFilter = next;
			}),
			this.categoryFilterRow(
				this.characterCategoryPaths(model),
				this.characterCategoryFilter,
				(next) => {
					this.characterCategoryFilter = next;
				},
			),
		];
	}

	/**
	 * Everything a scene can be narrowed by. The notes it names are offered
	 * whole, not only the ones some scene already points at: a filter is asked
	 * before the answer is known.
	 */
	private sceneFilterRows(model: ProjectDashboardModel): MemberFilterRow[] {
		const named = (
			entities: readonly { name: string }[],
		): PickerOption[] =>
			entities
				.map((entity) => ({ value: entity.name, label: entity.name }))
				.filter((option) => option.value.length > 0);
		return [
			this.progressFilterRow(this.sceneStatusFilter, (next) => {
				this.sceneStatusFilter = next;
			}),
			this.categoryFilterRow(
				this.sceneCategoryPaths(model),
				this.sceneCategoryFilter,
				(next) => {
					this.sceneCategoryFilter = next;
				},
			),
			{
				label: this.t('table.scenePov'),
				placeholder: this.t('table.filterAllPov'),
				empty: '',
				options: () => [
					{
						value: SCENE_POV_OMNISCIENT,
						label: this.t('modal.scene.povOmniscient'),
					},
					{
						value: SCENE_POV_MULTIPLE,
						label: this.t('modal.scene.povMultiple'),
					},
					...model.characters.map((character) => ({
						value: character.path,
						label: character.name,
					})),
				],
				value: this.scenePovFilter,
				apply: (next) => {
					this.scenePovFilter = next;
				},
			},
			{
				label: this.t('table.sceneTime'),
				placeholder: this.t('table.filterAllTimes'),
				empty: '',
				options: () => named(model.worldbuilding.time),
				value: this.sceneTimeFilter,
				apply: (next) => {
					this.sceneTimeFilter = next;
				},
			},
			{
				label: this.t('table.sceneLocation'),
				placeholder: this.t('table.filterAllLocations'),
				empty: '',
				options: () => named(model.worldbuilding.location),
				value: this.sceneLocationFilter,
				apply: (next) => {
					this.sceneLocationFilter = next;
				},
			},
			{
				label: this.t('table.sceneCharacters'),
				placeholder: this.t('table.filterAllCast'),
				empty: '',
				options: () =>
					model.characters.map((character) => ({
						value: character.path,
						label: character.name,
					})),
				value: this.sceneCharacterFilter,
				apply: (next) => {
					this.sceneCharacterFilter = next;
				},
			},
		];
	}

	/**
	 * The questions the funnel asks, in a panel under it. Each is a picker of
	 * its own, so they can all be asked at once, and each offers its whole
	 * vocabulary rather than only the answers this project happens to hold.
	 */
	private openFilterPanel(
		anchor: HTMLElement,
		rows: readonly MemberFilterRow[],
		changed: () => void,
	): void {
		this.closeFilterPanel();
		const panel = anchor.win.activeDocument.body.createDiv({
			cls: 'snowflake-method-filter-panel',
			attr: { role: 'dialog', 'aria-label': this.t('table.filter') },
		});
		panel.createDiv({
			cls: 'snowflake-method-filter-panel-title',
			text: this.t('table.filter'),
		});
		const body = panel.createDiv({ cls: 'snowflake-method-filter-panel-body' });
		// What the panel is being set to, until it is confirmed. The table keeps
		// showing what it was showing while the fields are being worked out, and
		// a panel dismissed without confirming changes nothing.
		const draft = rows.map((entry) => entry.value);
		// Rebuilt rather than reassigned: a picker shows the value it was built
		// with, so the reset below has to build the fields again to show them
		// back at rest.
		const fill = (): void => {
			body.empty();
			this.releaseFilterPickers();
			rows.forEach((entry, index) => {
				const field = body.createDiv({ cls: 'snowflake-method-filter-row' });
				field.createDiv({
					cls: 'snowflake-method-filter-label',
					text: entry.label,
				});
				this.memberFilterPickers.push(
					buildOptionField(this.app, field, {
						options: () => [
							{ value: entry.empty, label: entry.placeholder },
							...entry.options(),
						],
						value: () => draft[index] ?? entry.empty,
						choose: (value) => {
							draft[index] = value;
						},
						label: entry.label,
						placeholder: entry.placeholder,
						emptyPlaceholder: entry.placeholder,
					}),
				);
			});
		};
		fill();
		const actions = panel.createDiv({
			cls: 'snowflake-method-filter-panel-actions',
		});
		const reset = actions.createEl('button', {
			cls: 'snowflake-method-filter-reset',
			text: this.t('table.filterReset'),
			attr: { type: 'button' },
		});
		// Clears the fields rather than the table: the panel has one way out,
		// and this is not it.
		reset.addEventListener('click', () => {
			rows.forEach((entry, index) => {
				draft[index] = entry.empty;
			});
			fill();
		});
		const confirm = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t('table.filterConfirm'),
			attr: { type: 'button' },
		});
		confirm.addEventListener('click', () => {
			rows.forEach((entry, index) => {
				entry.apply(draft[index] ?? entry.empty);
			});
			this.closeFilterPanel();
			changed();
		});

		// Under the funnel and lined up with its end, in the layer above
		// everything: the panel covers a table that scrolls, and a panel inside
		// it would be clipped by it.
		const view = anchor.win;
		const place = (): void => {
			const box = anchor.getBoundingClientRect();
			const room = view.innerWidth - panel.offsetWidth - PANEL_EDGE_GAP;
			panel.style.top = `${String(box.bottom + PANEL_ANCHOR_GAP)}px`;
			panel.style.left = `${String(
				Math.max(
					PANEL_EDGE_GAP,
					Math.min(box.right - panel.offsetWidth, room),
				),
			)}px`;
		};
		place();
		anchor.setAttribute('aria-expanded', 'true');

		// A click inside the panel is the author using it, and one inside a
		// suggestion list is them using a field of it: the list is put in the
		// same layer, outside the panel's own element.
		const dismiss = (event: MouseEvent): void => {
			const target = event.target as Node | null;
			if (target === null) return;
			if (panel.contains(target) || anchor.contains(target)) return;
			const el = target.instanceOf(Element) ? target : target.parentElement;
			if (el?.closest('.suggestion-container') != null) return;
			this.closeFilterPanel();
		};
		const onKey = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return;
			// The field's own list answers Escape first, and closing the panel
			// under it would take the field away mid-correction.
			if (view.activeDocument.querySelector('.suggestion-container') !== null) {
				return;
			}
			this.closeFilterPanel();
			anchor.focus();
		};
		view.addEventListener('mousedown', dismiss, true);
		view.addEventListener('keydown', onKey, true);
		view.addEventListener('resize', place);
		this.filterPanel = {
			el: panel,
			release: () => {
				view.removeEventListener('mousedown', dismiss, true);
				view.removeEventListener('keydown', onKey, true);
				view.removeEventListener('resize', place);
				anchor.setAttribute('aria-expanded', 'false');
			},
		};
	}

	private closeFilterPanel(): void {
		const open = this.filterPanel;
		if (open === null) return;
		this.filterPanel = null;
		open.release();
		this.releaseFilterPickers();
		open.el.remove();
	}

	private releaseFilterPickers(): void {
		for (const picker of this.memberFilterPickers) picker.destroy();
		this.memberFilterPickers = [];
	}

	/**
	 * The frame both member tables share: a header strip and a scrolling body,
	 * as two tables laid by the same fixed columns so they stay aligned. The
	 * split is what keeps the body's scrollbar under the header instead of
	 * running alongside it, and the header follows the body's horizontal
	 * scroll so a narrow pane never shears the columns apart.
	 */
	private buildTableFrame(
		panel: HTMLElement,
		tableCls: string,
		headers: readonly string[],
	): { headWrap: HTMLElement; bodyWrap: HTMLElement; body: HTMLElement } {
		const wrap = panel.createDiv({ cls: 'snowflake-method-table-wrap' });
		const headWrap = wrap.createDiv({ cls: 'snowflake-method-table-head' });
		const headTable = headWrap.createEl('table', {
			cls: `snowflake-method-table ${tableCls}`,
		});
		const bodyWrap = wrap.createDiv({ cls: 'snowflake-method-table-body' });
		const bodyTable = bodyWrap.createEl('table', {
			cls: `snowflake-method-table ${tableCls}`,
		});
		for (const table of [headTable, bodyTable]) {
			const columns = table.createEl('colgroup');
			for (const cls of MEMBER_COLUMN_CLASSES) {
				columns.createEl('col', { cls });
			}
		}
		const headerRow = headTable.createEl('thead').createEl('tr');
		for (const text of headers) headerRow.createEl('th', { text });
		return { headWrap, bodyWrap, body: bodyTable.createEl('tbody') };
	}

	private renderCharacterRow(
		body: HTMLElement,
		character: CharacterViewModel,
		index: number,
		model: ProjectDashboardModel,
		step: 3 | 5 | 7,
		reorderReadOnly: boolean,
		dragLocked: boolean,
	): void {
		const characterDamaged = character.healthIssues.some(
			(issue) => issue.blocking,
		);
		const row = body.createEl('tr', {
			attr: { draggable: dragLocked ? 'false' : 'true' },
		});
		row.dataset.characterId = character.id;
		row.toggleClass('has-managed-section-issue', characterDamaged);
		row.createEl('td', {
			text: String(index + 1),
			attr: { 'data-label': this.t('table.order') },
		});
		const nameCell = row.createEl('td', {
			cls: 'snowflake-method-table-primary',
			attr: { 'data-label': this.t('table.name') },
		});
		this.renderMemberNameCell(nameCell, {
			name: character.name,
			drifted: character.nameDrifted,
			damaged: characterDamaged,
			aliases: character.aliases,
			progressStatus: character.progressStatus,
		});
		const categoryCell = row.createEl('td', {
			cls: 'snowflake-method-member-categories',
			attr: { 'data-label': this.t('table.category') },
		});
		// Every category the character carries, the role among them, each on a
		// line of its own: they are paths, and paths read badly run together.
		for (const path of character.categoryPaths) {
			categoryCell.createDiv({
				cls: 'snowflake-method-member-category',
				text: path,
			});
		}
		row.createEl('td', {
			text: character.oneSentenceStoryline,
			attr: { 'data-label': this.t('table.oneSentenceStoryline') },
		});
		const cell = row.createEl('td', {
			attr: { 'data-label': this.t('table.actions') },
		});
		const buttonGroup = cell.createDiv({
			cls: 'snowflake-method-table-actions',
		});
		const editCharacter = (): void => {
			if (model.readOnly || character.readOnly || characterDamaged) return;
			void this.memberFormContext(model, 'character').then((context) => {
				new CreateCharacterModal(
					this.app,
					this.t,
					model.characters
						.filter((candidate) => candidate.id !== character.id)
						.map((candidate) => candidate.name),
					async (request) => {
						await this.host.updateCharacter(character.id, request);
						await this.refresh();
					},
					{
						name: character.name,
						aliases: character.aliases,
						categoryPaths: character.categoryPaths,
						progressStatus: character.progressStatus ?? 'not-started',
						oneSentenceStoryline: character.oneSentenceStoryline,
						oneParagraphStoryline: character.oneParagraphStoryline,
						motivation: character.motivation,
						goal: character.goal,
						conflict: character.conflict,
						growth: character.growth,
						worldStatus: character.worldStatus,
						relationships: character.relationships,
						expectedRevision: character.revision,
					},
					undefined,
					context,
				).open();
			});
		};
		const openCharacter = (): void => {
			void this.host.openManagedFile(
				character.path,
				primaryManagedSectionForStep(step) ?? undefined,
				managedSectionHighlightsForStep(step),
			);
		};
		const opensByDefault = step === 5 || step === 7;
		const splitButton = buttonGroup.createDiv({
			cls: 'snowflake-method-character-split-button',
		});
		const primaryAction = splitButton.createEl('button', {
			cls: 'snowflake-method-character-edit',
			text: this.t(
				opensByDefault ? 'common.open' : 'actions.edit',
			),
			attr: { type: 'button' },
		});
		primaryAction.disabled =
			!opensByDefault &&
			(model.readOnly || character.readOnly || characterDamaged);
		primaryAction.addEventListener(
			'click',
			opensByDefault ? openCharacter : editCharacter,
		);
		const actionMenu = splitButton.createEl('button', {
			cls: 'snowflake-method-character-action-menu-trigger',
			attr: {
				type: 'button',
				'aria-haspopup': 'menu',
				'aria-label': this.t('table.actions'),
			},
		});
		const menuIcon = actionMenu.createSpan({
			cls: 'snowflake-method-character-action-menu-icon',
		});
		setIcon(menuIcon, 'chevron-down');
		actionMenu.addEventListener('click', (event) => {
			const menu = new Menu();
			menu.setParentElement(splitButton);
			const addEditItem = (): void => {
				menu.addItem((item) =>
					item
						.setTitle(this.t('actions.edit'))
						.setIcon('pencil')
						.setDisabled(
							model.readOnly || character.readOnly || characterDamaged,
						)
						.onClick(editCharacter),
				);
			};
			const addOpenItem = (): void => {
				menu.addItem((item) =>
					item
						.setTitle(this.t('common.open'))
						.setIcon('file-text')
						.onClick(openCharacter),
				);
			};
			if (step === 3) {
				addOpenItem();
				addEditItem();
			} else {
				addEditItem();
				addOpenItem();
			}
			this.addOrderMenuItems(menu, {
				index,
				total: model.characters.length,
				locked: reorderReadOnly,
				readOnly: model.readOnly,
				insertTitleKey: 'table.insertCharacterAfter',
				options: () =>
					model.characters
						.map((candidate, at) => ({
							id: candidate.id,
							index: at,
							label: `${String(at + 1)}. ${candidate.name}`,
						}))
						.filter((candidate) => candidate.id !== character.id),
				move: (toIndex) => this.host.reorderCharacter(character.id, toIndex),
				reveal: () => {
					this.revealCharacter(character.id);
				},
				insert: () => {
					this.insertCharacterAfter(model, index);
				},
			});
			menu.showAtMouseEvent(event);
		});
		const remove = buttonGroup.createEl('button', {
			cls: 'snowflake-method-character-delete',
			text: this.t('actions.delete'),
			attr: { type: 'button' },
		});
		remove.disabled = model.readOnly || character.readOnly;
		remove.addEventListener('click', () => {
			void this.runAndRefresh(() =>
				this.host.deleteCharacter(character.id, character.revision),
			);
		});
		if (!dragLocked) {
			this.makeRowReorderable(
				row,
				CHARACTER_DRAG_TYPE,
				character.id,
				index,
				(candidate) =>
					model.characters.some((entry) => entry.id === candidate),
				(id, target) => this.host.reorderCharacter(id, target),
			);
		}
	}

	private renderScenes(
		panel: HTMLElement,
		model: ProjectDashboardModel,
		step: 8 | 9,
	): void {
		this.renderMigrationCallout(panel, model);
		const actions = panel.createDiv({
			cls: 'snowflake-method-actions snowflake-method-list-actions',
		});
		this.renderOpenBase(actions, 'scenes', model);
		const add = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t('actions.addScene'),
			attr: { type: 'button' },
		});
		add.disabled = model.readOnly;
		add.addEventListener('click', () => this.openCreateScene(model));

		if (step === 8) {
			this.renderSceneListHints(panel);
		} else {
			this.renderWritingHints(
				panel,
				step,
				'step9.hints.title',
				[
					'step9.hints.reorder',
					'step9.hints.sceneTypes',
					'step1.hints.imagination',
					'step9.hints.revision',
				],
				['step1.hints.imagination', 'step9.hints.revision'],
			);
		}

		if (model.scenes.length === 0) {
			const empty = panel.createEl('p', {
				cls: 'snowflake-method-character-empty',
			});
			const icon = empty.createSpan({
				cls: 'snowflake-method-character-empty-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(icon, 'triangle-alert');
			empty.createSpan({ text: this.t('scenes.empty') });
			return;
		}

		panel.addClass('snowflake-method-member-panel');
		const toolbar = panel.createDiv({ cls: 'snowflake-method-table-toolbar' });
		const search = new SearchComponent(toolbar);
		search.setPlaceholder(this.t('table.searchScenes'));
		search.setValue(this.sceneQuery);
		void this.loadMemberCategories(model, 'scene');
		// A held filter can name a character since deleted, which would filter
		// every scene out while the field reads as if nothing were set.
		const knownCharacter = (path: string): boolean =>
			model.characters.some((character) => character.path === path);
		if (
			this.scenePovFilter !== '' &&
			this.scenePovFilter !== SCENE_POV_OMNISCIENT &&
			this.scenePovFilter !== SCENE_POV_MULTIPLE &&
			!knownCharacter(this.scenePovFilter)
		) {
			this.scenePovFilter = '';
		}
		if (
			this.sceneCharacterFilter !== '' &&
			!knownCharacter(this.sceneCharacterFilter)
		) {
			this.sceneCharacterFilter = '';
		}
		const count = toolbar.createSpan({ cls: 'snowflake-method-table-count' });
		const filterSlot = toolbar.createDiv({
			cls: 'snowflake-method-table-filter',
		});
		const filterButton = filterSlot.createEl('button', {
			cls: 'clickable-icon snowflake-method-filter-button',
			attr: {
				type: 'button',
				'aria-haspopup': 'dialog',
				'aria-expanded': 'false',
				'aria-label': this.t('table.filter'),
			},
		});
		setIcon(filterButton, 'funnel');
		setTooltip(filterButton, this.t('table.filter'));

		const { headWrap, bodyWrap, body } = this.buildTableFrame(
			panel,
			'snowflake-method-scene-table',
			['order', 'sceneName', 'scenePov', 'conflict', 'actions'].map(
				(key) => this.t(`table.${key}`),
			),
		);
		const reorderReadOnly =
			model.readOnly || model.scenes.some((candidate) => candidate.readOnly);

		let entries: { scene: SceneViewModel; index: number }[] = [];
		const virtual = new VirtualTable({
			scroller: bodyWrap,
			body,
			columns: 5,
			estimatedRowHeight: this.sceneRowHeight,
			overscan: 8,
			rowKey: (offset) => entries[offset]?.scene.id ?? `?${String(offset)}`,
			heights: this.sceneHeights,
			renderRow: (rows, offset) => {
				const entry = entries[offset];
				if (entry === undefined) return;
				this.renderSceneRow(
					rows,
					entry.scene,
					entry.index,
					model,
					step,
					reorderReadOnly,
					reorderReadOnly || this.sceneListFiltered(),
				);
			},
			renderTail: (rows) => {
				this.renderAddRow(
					rows,
					5,
					this.t('actions.addMoreScenes'),
					model.readOnly,
					() => this.openCreateScene(model),
				);
			},
			onScroll: (top) => {
				this.sceneScroll = top;
				headWrap.scrollLeft = bodyWrap.scrollLeft;
			},
			onMeasure: (height) => {
				this.sceneRowHeight = height;
			},
		});
		this.sceneTable = virtual;
		const feed = (resetScroll: boolean): void => {
			// A changed filter makes the old offset point at nothing the eye
			// was on, so the list starts back at its head.
			if (resetScroll) {
				this.sceneScroll = 0;
				bodyWrap.scrollTop = 0;
			}
			entries = this.sceneEntries(model);
			count.setText(
				this.sceneListFiltered()
					? this.t('table.filteredCount', {
							shown: entries.length,
							total: model.scenes.length,
						})
					: '',
			);
			virtual.setTotal(entries.length);
		};
		search.onChange((value) => {
			this.sceneQuery = value;
			feed(true);
		});
		const markFilterButton = (): void => {
			filterButton.toggleClass('is-active', this.sceneFiltered());
		};
		markFilterButton();
		filterButton.addEventListener('click', () => {
			if (this.filterPanel !== null) {
				this.closeFilterPanel();
				return;
			}
			this.openFilterPanel(filterButton, this.sceneFilterRows(model), () => {
				markFilterButton();
				feed(true);
			});
		});
		feed(false);
		bodyWrap.scrollTop = this.sceneScroll;
		virtual.refresh();
	}

	private renderSceneRow(
		body: HTMLElement,
		scene: SceneViewModel,
		index: number,
		model: ProjectDashboardModel,
		step: 8 | 9,
		reorderReadOnly: boolean,
		dragLocked: boolean,
	): void {
		const sceneDamaged = scene.healthIssues.some((issue) => issue.blocking);
		const row = body.createEl('tr', {
			attr: { draggable: dragLocked ? 'false' : 'true' },
		});
		row.dataset.sceneId = scene.id;
		row.toggleClass('has-managed-section-issue', sceneDamaged);
		row.createEl('td', {
			text: String(index + 1),
			attr: { 'data-label': this.t('table.order') },
		});
		const titleCell = row.createEl('td', {
			cls: 'snowflake-method-table-primary',
			attr: { 'data-label': this.t('table.sceneName') },
		});
		this.renderMemberNameCell(titleCell, {
			name: scene.title,
			drifted: scene.nameDrifted,
			damaged: sceneDamaged,
			aliases: scene.aliases,
			progressStatus: scene.progressStatus,
		});
		const povCell = row.createEl('td', {
			attr: { 'data-label': this.t('table.scenePov') },
		});
		if (scene.povMissing) {
			const missingLabel = this.t('table.povMissing', {
				name: scene.povName,
			});
			povCell.createSpan({
				cls: 'snowflake-method-table-missing-reference',
				text: '???',
				attr: { 'aria-label': missingLabel},
			});
		} else {
			povCell.setText(scene.povName);
		}
		row.createEl('td', {
			text: scene.conflict,
			attr: { 'data-label': this.t('table.conflict') },
		});
		const actionCell = row.createEl('td', {
			attr: { 'data-label': this.t('table.actions') },
		});
		const buttonGroup = actionCell.createDiv({
			cls: 'snowflake-method-table-actions',
		});
		const editScene = (): void => {
			if (model.readOnly || scene.readOnly || sceneDamaged) return;
			this.openSceneEditor(model, scene);
		};
		const openScene = (): void => {
			void this.host.openManagedFile(
				scene.path,
				primaryManagedSectionForStep(step) ?? undefined,
				managedSectionHighlightsForStep(step),
			);
		};
		const opensByDefault = step === 9;
		const splitButton = buttonGroup.createDiv({
			cls: 'snowflake-method-character-split-button',
		});
		const primaryAction = splitButton.createEl('button', {
			cls: 'snowflake-method-character-edit',
			text: this.t(opensByDefault ? 'common.open' : 'actions.edit'),
			attr: { type: 'button' },
		});
		primaryAction.disabled =
			!opensByDefault && (model.readOnly || scene.readOnly || sceneDamaged);
		primaryAction.addEventListener(
			'click',
			opensByDefault ? openScene : editScene,
		);
		const actionMenu = splitButton.createEl('button', {
			cls: 'snowflake-method-character-action-menu-trigger',
			attr: {
				type: 'button',
				'aria-haspopup': 'menu',
				'aria-label': this.t('table.actions'),
			},
		});
		const menuIcon = actionMenu.createSpan({
			cls: 'snowflake-method-character-action-menu-icon',
		});
		setIcon(menuIcon, 'chevron-down');
		actionMenu.addEventListener('click', (event) => {
			const menu = new Menu();
			menu.setParentElement(splitButton);
			const addEditItem = (): void => {
				menu.addItem((item) =>
					item
						.setTitle(this.t('actions.edit'))
						.setIcon('pencil')
						.setDisabled(model.readOnly || scene.readOnly || sceneDamaged)
						.onClick(editScene),
				);
			};
			const addOpenItem = (): void => {
				menu.addItem((item) =>
					item
						.setTitle(this.t('common.open'))
						.setIcon('file-text')
						.onClick(openScene),
				);
			};
			if (step === 8) {
				addOpenItem();
				addEditItem();
			} else {
				addEditItem();
				addOpenItem();
			}
			this.addOrderMenuItems(menu, {
				index,
				total: model.scenes.length,
				locked: reorderReadOnly,
				readOnly: model.readOnly,
				insertTitleKey: 'table.insertSceneAfter',
				options: () =>
					model.scenes
						.map((candidate, at) => ({
							id: candidate.id,
							index: at,
							label: `${String(at + 1)}. ${candidate.title}`,
						}))
						.filter((candidate) => candidate.id !== scene.id),
				move: (toIndex) => this.host.reorderScene(scene.id, toIndex),
				reveal: () => {
					this.revealScene(scene.id);
				},
				insert: () => {
					this.insertSceneAfter(model, index);
				},
			});
			menu.showAtMouseEvent(event);
		});
		const remove = buttonGroup.createEl('button', {
			cls: 'snowflake-method-character-delete',
			text: this.t('actions.delete'),
			attr: { type: 'button' },
		});
		remove.disabled = model.readOnly || scene.readOnly;
		remove.addEventListener('click', () => {
			void this.runAndRefresh(() =>
				this.host.deleteScene(scene.id, scene.revision),
			);
		});

		if (!dragLocked) {
			this.makeRowReorderable(
				row,
				SCENE_DRAG_TYPE,
				scene.id,
				index,
				(candidate) => model.scenes.some((entry) => entry.id === candidate),
				(id, target) => this.host.reorderScene(id, target),
			);
		}
	}

	private openCreateCharacter(model: ProjectDashboardModel): void {
		void this.memberFormContext(model, 'character').then((context) => {
			new CreateCharacterModal(
				this.app,
				this.t,
				model.characters.map((character) => character.name),
				async (request) => {
					await this.host.createCharacter(request);
					// The new character joins the end of the list, so the search
					// and filter are let go and the table scrolls to the end.
					// What was just made must be on screen, not hidden behind an
					// old query it happens not to match.
					this.characterQuery = '';
					this.characterCategoryFilter = '';
					this.characterStatusFilter = 'all';
					this.characterScroll = Number.MAX_SAFE_INTEGER;
					await this.refresh();
				},
				undefined,
				undefined,
				context,
			).open();
		});
	}

	private openCreateScene(model: ProjectDashboardModel): void {
		void this.memberFormContext(model, 'scene').then((context) => {
			new CreateSceneModal(
				this.app,
				this.t,
				model.characters.map((character) => ({
					id: character.id,
					path: character.path,
					name: character.name,
				})),
				model.scenes.map((scene) => scene.title),
				async (request) => {
					await this.host.createScene(request);
					// To the end, filters let go, for the same reason as above.
					this.sceneQuery = '';
					this.clearSceneFilters();
					this.sceneScroll = Number.MAX_SAFE_INTEGER;
					await this.refresh();
				},
				undefined,
				this.creatingCharacter(model),
				context,
			).open();
		});
	}

	/** Creates a character and walks it back from the end to `index + 1`. */
	private insertCharacterAfter(
		model: ProjectDashboardModel,
		index: number,
	): void {
		void this.memberFormContext(model, 'character').then((context) => {
			new CreateCharacterModal(
				this.app,
				this.t,
				model.characters.map((character) => character.name),
				async (request) => {
					const created = await this.host.createCharacter(request);
					await this.host.reorderCharacter(created.id, index + 1);
					await this.refresh();
					this.revealCharacter(created.id);
				},
				undefined,
				undefined,
				context,
			).open();
		});
	}

	/** Creates a scene and walks it back from the end to `index + 1`. */
	private insertSceneAfter(model: ProjectDashboardModel, index: number): void {
		void this.memberFormContext(model, 'scene').then((context) => {
			new CreateSceneModal(
				this.app,
				this.t,
				model.characters.map((character) => ({
					id: character.id,
					path: character.path,
					name: character.name,
				})),
				model.scenes.map((scene) => scene.title),
				async (request) => {
					const created = await this.host.createScene(request);
					await this.host.reorderScene(created.id, index + 1);
					await this.refresh();
					this.revealScene(created.id);
				},
				undefined,
				this.creatingCharacter(model),
				context,
			).open();
		});
	}

	/** The categories the filter offers, once they have been read. */
	private characterCategoryPaths(model: ProjectDashboardModel): string[] {
		const loaded = this.characterCategories;
		return loaded?.projectId === model.projectId ? loaded.paths : [];
	}

	private sceneCategoryPaths(model: ProjectDashboardModel): string[] {
		const loaded = this.sceneCategories;
		return loaded?.projectId === model.projectId ? loaded.paths : [];
	}

	/**
	 * Reads a kind's category tree for the filter. Held between renders, so the
	 * list is ready by the time the field is opened, and keyed by project so
	 * another one's categories are never on offer.
	 */
	private async loadMemberCategories(
		model: ProjectDashboardModel,
		kind: 'character' | 'scene',
	): Promise<void> {
		let paths: string[] = [];
		try {
			paths = await this.host.listDefinitionPaths(kind, 'category');
		} catch {
			// A tree that cannot be read leaves the filter offering the rest,
			// which is a smaller panel rather than a broken one.
			paths = [];
		}
		const loaded = { projectId: model.projectId, paths };
		if (kind === 'character') this.characterCategories = loaded;
		else this.sceneCategories = loaded;
	}

	/** The rows the character table shows, each with its place in the list. */
	private characterEntries(
		model: ProjectDashboardModel,
	): { character: CharacterViewModel; index: number }[] {
		const category = this.characterCategoryFilter;
		const status = this.characterStatusFilter;
		return model.characters
			.map((character, index) => ({ character, index }))
			.filter(
				({ character }) =>
					(category === '' ||
						character.categoryPaths.some((path) =>
							categoryWithin(path, category),
						)) &&
					(status === 'all' || character.progressStatus === status) &&
					memberMatches(
						[
							character.name,
							...character.aliases,
							...character.categoryPaths,
							...(character.progressStatus === null
								? []
								: [this.t(`status.${character.progressStatus}`)]),
							character.oneSentenceStoryline,
						],
						this.characterQuery,
					),
			);
	}

	private characterListFiltered(): boolean {
		return (
			this.characterQuery.trim().length > 0 ||
			this.characterCategoryFilter !== '' ||
			this.characterStatusFilter !== 'all'
		);
	}

	/** The rows the scene table shows, each with its place in the list. */
	private sceneEntries(
		model: ProjectDashboardModel,
	): { scene: SceneViewModel; index: number }[] {
		const names = new Map(
			model.characters.map((character) => [character.path, character.name]),
		);
		// The stored value is a link or the words themselves; either way the
		// name is what the table shows and what the filter names.
		const holds = (values: readonly string[], wanted: string): boolean =>
			values.some((value) => termName(value) === wanted);
		return model.scenes
			.map((scene, index) => ({ scene, index }))
			.filter(
				({ scene }) =>
					(this.scenePovFilter === '' ||
						scene.povPath === this.scenePovFilter) &&
					(this.sceneStatusFilter === 'all' ||
						scene.progressStatus === this.sceneStatusFilter) &&
					(this.sceneCategoryFilter === '' ||
						scene.categoryPaths.some((path) =>
							categoryWithin(path, this.sceneCategoryFilter),
						)) &&
					(this.sceneTimeFilter === '' ||
						holds(scene.times, this.sceneTimeFilter)) &&
					(this.sceneLocationFilter === '' ||
						holds(scene.locations, this.sceneLocationFilter)) &&
					(this.sceneCharacterFilter === '' ||
						scene.characterPaths.includes(this.sceneCharacterFilter)) &&
					memberMatches(
						[
							scene.title,
							...scene.aliases,
							...scene.categoryPaths,
							scene.povName,
							...scene.times.map(termName),
							...scene.locations.map(termName),
							scene.conflict,
							...(scene.progressStatus === null
								? []
								: [this.t(`status.${scene.progressStatus}`)]),
							...scene.characterPaths.map(
								(path) => names.get(path) ?? '',
							),
						],
						this.sceneQuery,
					),
			);
	}

	private clearSceneFilters(): void {
		this.scenePovFilter = '';
		this.sceneStatusFilter = 'all';
		this.sceneCategoryFilter = '';
		this.sceneTimeFilter = '';
		this.sceneLocationFilter = '';
		this.sceneCharacterFilter = '';
	}

	/** True when any of the funnel's six questions is being asked. */
	private sceneFiltered(): boolean {
		return (
			this.scenePovFilter !== '' ||
			this.sceneStatusFilter !== 'all' ||
			this.sceneCategoryFilter !== '' ||
			this.sceneTimeFilter !== '' ||
			this.sceneLocationFilter !== '' ||
			this.sceneCharacterFilter !== ''
		);
	}

	private sceneListFiltered(): boolean {
		return this.sceneQuery.trim().length > 0 || this.sceneFiltered();
	}

	/** Scrolls the character table to a row, wherever the filters put it. */
	private revealCharacter(id: string): void {
		const model = this.lastRender?.model ?? null;
		if (model === null) return;
		const at = this.characterEntries(model).findIndex(
			(entry) => entry.character.id === id,
		);
		if (at === -1) return;
		this.characterTable?.reveal(at);
	}

	/** Scrolls the scene table to a row, wherever the filters put it. */
	private revealScene(id: string): void {
		const model = this.lastRender?.model ?? null;
		if (model === null) return;
		const at = this.sceneEntries(model).findIndex(
			(entry) => entry.scene.id === id,
		);
		if (at === -1) return;
		this.sceneTable?.reveal(at);
	}

	/**
	 * The move and insert items every member row's menu carries. Dragging
	 * moves a row past the neighbours it can see; these move it by name and
	 * by number, which is what a list of three thousand actually needs, and
	 * they keep working while a filter hides the rows in between.
	 */
	private addOrderMenuItems(
		menu: Menu,
		config: {
			/** The row's place in the full list, not the filtered one. */
			index: number;
			total: number;
			/** True when any member is read-only, the rule the drag follows. */
			locked: boolean;
			/** True when the project cannot take a new member at all. */
			readOnly: boolean;
			insertTitleKey: string;
			/** Everything the row could be moved after, so all but itself. */
			options: () => MoveAfterEntry[];
			move: (toIndex: number) => Promise<void>;
			/** Scrolls to the row once the move has been drawn. */
			reveal: () => void;
			insert: () => void;
		},
	): void {
		const { index, total } = config;
		const moveTo = (toIndex: number): void => {
			void this.runAndRefresh(() =>
				config.move(Math.max(0, Math.min(toIndex, total - 1))),
			).then(() => {
				config.reveal();
			});
		};
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(this.t('actions.moveUp'))
				.setIcon('arrow-up')
				.setDisabled(config.locked || index === 0)
				.onClick(() => {
					moveTo(index - 1);
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(this.t('actions.moveDown'))
				.setIcon('arrow-down')
				.setDisabled(config.locked || index === total - 1)
				.onClick(() => {
					moveTo(index + 1);
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(this.t('table.moveToPosition'))
				.setIcon('hash')
				.setDisabled(config.locked)
				.onClick(() => {
					new MoveToPositionModal(
						this.app,
						this.t,
						total,
						index + 1,
						async (toIndex) => {
							await config.move(toIndex);
							await this.refresh();
							config.reveal();
						},
					).open();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(this.t('table.moveAfter'))
				.setIcon('corner-down-right')
				.setDisabled(config.locked)
				.onClick(() => {
					new MoveAfterModal(
						this.app,
						this.t,
						config.options(),
						(picked) => {
							// The mover leaves its place before it lands: a
							// target below it slides up by one, so following it
							// means taking its old index, while a target above
							// keeps its index and following it means the slot
							// after.
							moveTo(
								index < picked.index
									? picked.index
									: picked.index + 1,
							);
						},
					).open();
				}),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(this.t(config.insertTitleKey))
				.setIcon('plus')
				.setDisabled(config.readOnly)
				.onClick(config.insert),
		);
	}

	/**
	 * A last row whose only job is to add another. The button above the table is
	 * out of sight once a list is long enough to scroll, and the end of the list
	 * is where the eye already is after reading to the bottom of it.
	 */
	private renderAddRow(
		body: HTMLElement,
		columns: number,
		label: string,
		readOnly: boolean,
		add: () => void,
	): void {
		// Not draggable and given no drop handlers: it takes no part in the
		// ordering, so a row dragged onto it stays where it was.
		const row = body.createEl('tr', {
			cls: 'snowflake-method-table-add-row',
			attr: { draggable: 'false' },
		});
		if (readOnly) row.addClass('is-disabled');
		const cell = row.createEl('td', { attr: { colspan: String(columns) } });
		const button = cell.createEl('button', {
			cls: 'snowflake-method-table-add-button',
			text: label,
			attr: { type: 'button' },
		});
		button.disabled = readOnly;
		button.addEventListener('click', add);
	}

	/**
	 * Lets a scene's fields create a character the project does not have yet,
	 * seeded with the name that was typed. Null on a read-only project, which
	 * leaves the fields offering only what already exists.
	 */
	private creatingCharacter(
		model: ProjectDashboardModel,
	):
		| ((
				name: string,
				takenNames: readonly string[],
		  ) => Promise<CharacterOption | null>)
		| null {
		if (model.readOnly) return null;
		// The taken names come from the scene form rather than from `model`, which
		// was read before any character created from there existed.
		return async (name, takenNames) => {
			// Made from its name alone, with everything else left for later.
			if (!this.host.opensFormWhenCreatingFromField()) {
				return this.quickCreateCharacter(name);
			}
			const context = await this.memberFormContext(model, 'character');
			const created = await promptForNewCharacter(
				this.app,
				this.t,
				takenNames,
				name,
				(request) => this.host.createCharacter(request),
				context,
			);
			if (created === null) return null;
			// The field behind the form is waiting on this, so the dashboard redraw
			// is left to catch up on its own rather than kept in front of it.
			void this.refresh();
			return created;
		};
	}

	private openSceneEditor(
		model: ProjectDashboardModel,
		scene: SceneViewModel,
	): void {
		void this.memberFormContext(model, 'scene').then((context) => {
			new CreateSceneModal(
				this.app,
				this.t,
				model.characters.map((character) => ({
					id: character.id,
					path: character.path,
					name: character.name,
				})),
				model.scenes
					.filter((candidate) => candidate.id !== scene.id)
					.map((candidate) => candidate.title),
				async (request) => {
					await this.host.updateScene(scene.id, request);
					await this.refresh();
				},
				{
					title: scene.title,
					aliases: scene.aliases,
					categoryPaths: scene.categoryPaths,
					progressStatus: scene.progressStatus ?? 'not-started',
					povPath: scene.povPath,
					times: scene.times,
					locations: scene.locations,
					characterPaths: scene.characterPaths,
					conflict: scene.conflict,
					worldStatus: scene.worldStatus,
					relationships: scene.relationships,
					events: scene.events,
					expectedRevision: scene.revision,
				},
				this.creatingCharacter(model),
				context,
			).open();
		});
	}

	private renderSceneListHints(panel: HTMLElement): void {
		const writingHints = this.createDisclosure(
			panel,
			'8:hints',
			'snowflake-method-writing-hints',
		);
		const hintsSummary = writingHints.createEl('summary');
		const hintsIcon = hintsSummary.createSpan({
			cls: 'snowflake-method-writing-hints-icon',
		});
		setIcon(hintsIcon, 'lightbulb');
		hintsSummary.createSpan({ text: this.t('step8.hints.title') });

		const hintsList = writingHints.createEl('ol');
		hintsList.createEl('li', {
			text: this.t('step8.hints.reorder'),
		});
		const elementsHint = hintsList.createEl('li');
		elementsHint.createSpan({
			text: this.t('step8.hints.elementsBefore'),
		});
		elementsHint.createEl('strong', {
			cls: 'snowflake-method-hint-keyword',
			text: this.t('step8.hints.conflict'),
		});
		elementsHint.createSpan({
			text: this.t('step8.hints.elementsAfter'),
		});
		const povHint = hintsList.createEl('li');
		povHint.createSpan({ text: this.t('step8.hints.povBefore') });
		povHint.createEl('strong', {
			cls: 'snowflake-method-hint-keyword',
			text: this.t('step8.hints.povKeyword'),
		});
		povHint.createSpan({ text: this.t('step8.hints.povAfter') });
		const imaginationHint = hintsList.createEl('li', {
			text: this.t('step1.hints.imagination'),
		});
		imaginationHint.addClass('snowflake-method-hint-emphasis');
		const canvasHint = hintsList.createEl('li');
		canvasHint.createSpan({ text: this.t('step8.hints.canvasBefore') });
		const canvasAction = canvasHint.createEl('button', {
			cls: 'snowflake-method-canvas-link',
			attr: {
				'aria-label': this.t('step8.hints.canvasAria'),
				type: 'button',
			},
		});
		const canvasIcon = canvasAction.createSpan({
			cls: 'snowflake-method-canvas-link-icon',
		});
		setIcon(canvasIcon, 'layout-dashboard');
		canvasAction.createSpan({
			cls: 'snowflake-method-canvas-link-label',
			text: this.t('step8.hints.canvasAction'),
		});
		canvasAction.addEventListener('click', () => {
			void this.runAndRefresh(() => this.host.createSceneCanvas());
		});
		canvasHint.createSpan({ text: this.t('step8.hints.canvasAfter') });
		const revisionHint = hintsList.createEl('li', {
			text: this.t('step8.hints.revision'),
		});
		revisionHint.addClass('snowflake-method-hint-emphasis');
	}

	private renderOpenArtifact(
		panel: HTMLElement,
		step: StepViewModel,
		model: ProjectDashboardModel,
	): void {
		if (step.id === 4) {
			this.renderWritingHints(
				panel,
				step.id,
				'step4.hints.title',
				[
					'step4.hints.openNote',
					'step4.hints.structure',
					'step4.hints.paragraphs',
					'step1.hints.imagination',
					'step4.hints.revision',
				],
				['step1.hints.imagination', 'step4.hints.revision'],
			);
			const paragraphSectionId = STEP_TWO_SECTION_IDS[0];
			const oneParagraphSummary =
				model.stepFields[2]?.[paragraphSectionId] ?? '';
			this.renderSourceSummary(
				panel,
				'step4.sourceSummary.title',
				'step4.sourceSummary.empty',
				oneParagraphSummary,
			);
		}
		if (step.id === 6) {
			this.renderWritingHints(
				panel,
				step.id,
				'step6.hints.title',
				[
					'step6.hints.openNote',
					'step6.hints.pageLength',
					'step1.hints.imagination',
					'step6.hints.revision',
				],
				['step1.hints.imagination', 'step6.hints.revision'],
			);
			const plotSynopsis =
				model.stepFields[4]?.['plot-synopsis'] ?? '';
			this.renderSourceSummary(
				panel,
				'step6.sourceSynopsis.title',
				'step6.sourceSynopsis.empty',
				plotSynopsis,
			);
		}
		const actions = panel.createDiv({ cls: 'snowflake-method-actions' });
		const open = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t('actions.openNote'),
		});
		open.disabled = step.artifactPath === null;
		open.addEventListener('click', () => {
			void this.host.openStep(step.id);
		});
	}

	private renderWritingHints(
		panel: HTMLElement,
		step: StepId,
		titleKey: string,
		hintKeys: readonly string[],
		emphasizedKeys: readonly string[],
	): void {
		const writingHints = this.createDisclosure(
			panel,
			`${step}:hints`,
			'snowflake-method-writing-hints',
		);
		const hintsSummary = writingHints.createEl('summary');
		const hintsIcon = hintsSummary.createSpan({
			cls: 'snowflake-method-writing-hints-icon',
		});
		setIcon(hintsIcon, 'lightbulb');
		hintsSummary.createSpan({ text: this.t(titleKey) });
		const hintsList = writingHints.createEl('ol');
		for (const key of hintKeys) {
			const item = hintsList.createEl('li', { text: this.t(key) });
			if (emphasizedKeys.includes(key)) {
				item.addClass('snowflake-method-hint-emphasis');
			}
		}
	}

	private renderSourceSummary(
		panel: HTMLElement,
		titleKey: string,
		emptyKey: string,
		content: string,
	): void {
		const sourceSummary = panel.createDiv({
			cls: 'snowflake-method-source-summary',
			attr: {
				role: 'note',
				'aria-label': this.t(titleKey),
				'aria-readonly': 'true',
			},
		});
		const sourceSummaryHeader = sourceSummary.createDiv({
			cls: 'snowflake-method-source-summary-header',
		});
		const sourceSummaryIcon = sourceSummaryHeader.createSpan({
			cls: 'snowflake-method-source-summary-icon',
		});
		setIcon(sourceSummaryIcon, 'quote');
		sourceSummaryHeader.createDiv({
			cls: 'snowflake-method-source-summary-label',
			text: this.t(titleKey),
		});
		const sourceSummaryContent = sourceSummary.createEl('p', {
			cls: 'snowflake-method-source-summary-content',
			text: content.length > 0 ? content : this.t(emptyKey),
		});
		if (content.length === 0) {
			sourceSummaryContent.addClass('is-empty');
		}
	}

	private addSaveAndOpenActions(
		panel: HTMLElement,
		step: 1 | 2,
		readOnly: boolean,
		onSave: () => Promise<void>,
		onDiscard: () => void,
	): void {
		const actions = panel.createDiv({
			cls: 'snowflake-method-actions',
		});
		const open = actions.createEl('button', {
			text: this.t('actions.openNote'),
		});
		open.addEventListener('click', () => {
			void this.host.openStep(step);
		});
		const discard = actions.createEl('button', {
			text: this.t('actions.discardDraft'),
		});
		discard.addEventListener('click', () => {
			onDiscard();
			void this.refresh();
		});
		const save = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t('common.save'),
		});
		save.disabled = readOnly;
		save.addEventListener('click', () => {
			void this.runAndRefresh(onSave);
		});
	}

	private addTextInputField(
		container: HTMLElement,
		label: string,
		value: string,
		readOnly: boolean,
	): HTMLInputElement {
		const field = container.createDiv({ cls: 'snowflake-method-field' });
		field.createEl('label', { text: label });
		const input = field.createEl('input', { attr: { type: 'text' } });
		input.value = value;
		input.disabled = readOnly;
		return input;
	}

	private addToolbarButton(
		container: HTMLElement,
		icon: string,
		labelKey: string,
		onClick: () => void,
	): HTMLButtonElement {
		const button = container.createEl('button', {
			cls: 'snowflake-method-toolbar-button',
			attr: {
				'aria-label': this.t(labelKey),
				type: 'button',
			},
		});
		setIcon(button, icon);
		button.createSpan({
			cls: 'snowflake-method-button-label',
			text: this.t(labelKey),
		});
		button.addEventListener('click', onClick);
		return button;
	}

	private renderEmpty(root: HTMLElement): void {
		const empty = root.createDiv({ cls: 'snowflake-method-empty-state' });
		const inner = empty.createDiv({
			cls: 'snowflake-method-empty-state-content',
		});
		const icon = inner.createDiv({
			cls: 'snowflake-method-empty-state-icon',
			attr: { 'aria-hidden': 'true' },
		});
		renderSnowflakeEvolution(icon);
		inner.createEl('h2', { text: this.t('dashboard.emptyTitle') });
		inner.createEl('p', { text: this.t('dashboard.emptyDesc') });
		const openManager = inner.createEl('button', {
			cls: 'snowflake-method-empty-state-action',
			text: this.t('commands.openProjectManager'),
			attr: { type: 'button' },
		});
		openManager.addEventListener('click', () => {
			void this.host
				.openProjectManager(null)
				.catch((error: unknown) => this.renderError(error));
		});
	}

	private renderError(error: unknown): void {
		this.clearCertificateCelebration();
		this.rendered = true;
		this.renderedProjectId = null;
		this.renderedProjectComplete = false;
		this.renderedStep = null;
		this.releaseMemberControls();
		this.contentEl.empty();
		this.contentEl.addClass('snowflake-method-dashboard');
		const message =
			error instanceof Error ? error.message : this.t('errors.unknown');
		const panel = this.contentEl.createDiv({ cls: 'snowflake-method-panel' });
		panel.createEl('h2', { text: this.t('errors.dashboard') });
		panel.createEl('p', { text: message });
		const retry = panel.createEl('button', { text: this.t('common.retry') });
		retry.addEventListener('click', () => {
			void this.refresh();
		});
		const repair = panel.createEl('button', {
			text: this.t('actions.repair'),
		});
			repair.addEventListener('click', () => {
				void this.runAndRefresh(async () => {
					const report = await this.host.checkCurrentProject();
					this.showRepairReport(report);
			});
		});
	}

	private statusGlyph(status: StepStatus): string {
		switch (status) {
			case 'complete':
				return '✓';
			case 'in-progress':
				return '•';
			case 'in-revision':
				return '↻';
			case 'skipped':
				return '−';
			case 'not-started':
				return '';
		}
	}

	/**
	 * Makes one table row a reorder handle. A row accepts a drop only when the
	 * drag carries this table's own payload type and an id the table is showing,
	 * so neither a foreign drag nor a row from a second dashboard on another
	 * project can reach the reorder call.
	 */
	private makeRowReorderable(
		row: HTMLElement,
		dragType: string,
		id: string,
		index: number,
		isOwnId: (candidate: string) => boolean,
		reorder: (id: string, index: number) => Promise<void>,
	): void {
		row.addEventListener('dragstart', (event) => {
			if (event.dataTransfer === null) return;
			row.addClass('is-dragging');
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(dragType, id);
		});
		row.addEventListener('dragend', () => row.removeClass('is-dragging'));
		row.addEventListener('dragover', (event) => {
			// getData() is blocked until drop, but the type list is readable, and
			// leaving the default in place means drop never fires for a foreign drag.
			if (event.dataTransfer?.types.includes(dragType) !== true) return;
			event.preventDefault();
		});
		row.addEventListener('drop', (event) => {
			const dragged = event.dataTransfer?.getData(dragType) ?? '';
			if (dragged.length === 0 || !isOwnId(dragged)) return;
			event.preventDefault();
			void this.runAndRefresh(() => reorder(dragged, index));
		});
	}

	private async runAndRefresh(action: () => Promise<void>): Promise<void> {
		try {
			await action();
			await this.refresh();
		} catch (error) {
			new Notice(
				error instanceof Error ? error.message : this.t('errors.unknown'),
			);
		}
	}
}
