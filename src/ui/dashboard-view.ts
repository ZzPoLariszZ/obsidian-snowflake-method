import {
	ItemView,
	Menu,
	Notice,
	SearchComponent,
	setIcon,
	setTooltip,
	type Modal,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import {
	DEFINITION_FILE_IDS,
	SCENE_POV_MULTIPLE,
	SCENE_POV_OMNISCIENT,
	STEP_ONE_SECTION_IDS,
	STEP_TWO_SECTION_IDS,
	areStepPrerequisitesComplete,
	countWriting,
	createDefaultStepStatuses,
	getFirstIncompleteStep,
	isProgressStatus,
	managedSectionHighlightsForStep,
	primaryManagedSectionForStep,
	PROGRESS_STATUSES,
	entityKindIds,
	foldName,
	isWorldbuildingKind,
	nextCustomKindPrefix,
	safeFileName,
	type EntityKindId,
	type ProjectWorldbuildingKind,
	type ProgressStatus,
	type TimeKind,
	type StepOneSectionId,
	type StepId,
	type StepStatus,
	type StepStatusMap,
	type WorldbuildingKindId,
} from '../domain';
import {
	MAX_DEFINITION_DEPTH,
	validateKindName,
	type CustomFieldTemplateInfo,
	type DefinitionForest,
	type DefinitionNodeInfo,
	type DefinitionTreeInfo,
} from '../services';
import {
	ConfirmDefinitionDeletionModal,
	ConfirmKindDeletionModal,
	ConfirmRestoreBaseModal,
	CreateCharacterModal,
	CreateProjectModal,
	CreateSceneModal,
	EntityFormModal,
	MoveAfterModal,
	MoveToPositionModal,
	RepairReportModal,
	promptForCustomFieldTemplate,
	promptForDefinitionEdit,
	promptForKindForm,
	promptForDefinitionKind,
	promptForDefinitionPath,
	promptForNewCharacter,
	promptForNewEntity,
	promptForNewScene,
	promptForTemplateDeletion,
	type CharacterOption,
	type MemberFormContext,
	type MoveAfterEntry,
	type Translate,
} from './modals';
import {
	coerceFreeformPane,
	dashboardHasHealthIssues,
	dashboardPaneKey,
	dashboardRenderContinuity,
	isFreeformStep,
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
	entityGroupLabel,
	entityGroupsOf,
	type DefinitionPathSource,
	type EntityGroupId,
} from './entity-form';
import { RenderStateKeeper } from './render-state';
import { renderSnowflakeEvolution } from './snowflake-evolution';
import { kindEntities } from './view-model';
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
	ProjectBaseChoice,
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
 * Both member tables are laid by the same four columns, so stepping between
 * characters and scenes changes the rows and not the grid: order, name, the
 * kind column (a character's type, a scene's point of view), and the wrapping
 * text column. What a row can be asked to do keeps no column of its own — it
 * rides at the end of the last one.
 */
const MEMBER_COLUMN_CLASSES = ['order', 'name', 'kind', 'text'].map(
	(name) => `snowflake-method-member-column-${name}`,
);

/** The fifth column, kept only while the actions are shown as buttons. */
const ACTIONS_COLUMN_CLASS = 'snowflake-method-member-column-actions';

/** How many of an entry's users the panel shows before offering the rest. */
const DEFINITION_USAGE_PREVIEW = 4;

/** The rail's scroller: both groups together, not either list on its own. */
const RAIL_SCROLL_SELECTOR = '.snowflake-method-step-nav-scroll';
const MAIN_PANEL_SELECTOR = '.snowflake-method-main';

const WORLDBUILDING_KIND_ICONS: Record<'time' | 'location' | 'item', string> = {
	time: 'clock',
	location: 'map-pin',
	item: 'gem',
};

/** The mark each kind of note goes by, the rail's own for the three it lists. */
/** Every custom kind wears the one icon; the built-ins keep their own. */
const CUSTOM_KIND_ICON = 'shapes';

const EMPTY_TREE: DefinitionTreeInfo = { rootPath: '', nodes: [] };

/** One kind's tree of a forest; empty for the same stale-pane reason. */
function forestTree(
	forest: DefinitionForest,
	kind: EntityKindId,
): DefinitionTreeInfo {
	return forest[kind] ?? EMPTY_TREE;
}

const ENTITY_KIND_ICONS: Record<
	'character' | 'scene' | 'time' | 'location' | 'item',
	string
> = {
	character: 'user',
	scene: 'clapperboard',
	...WORLDBUILDING_KIND_ICONS,
};

/**
 * The face a kind wears wherever it appears: a built-in's own icon, an
 * authored kind's chosen one, and the generic shape only when nothing chose.
 */
function kindIcon(model: ProjectDashboardModel, kind: string): string {
	if (kind === 'character' || kind === 'scene' || isWorldbuildingKind(kind)) {
		return ENTITY_KIND_ICONS[kind];
	}
	const descriptor = model.worldbuildingKinds.find(
		(candidate) => candidate.id === kind,
	);
	return descriptor?.icon ?? CUSTOM_KIND_ICON;
}

/**
 * What one rail row is made of. The leading mark is a step's number or a
 * kind's icon; the indicator is how many notes stand behind the row, or how
 * far along the step is.
 */
interface RailRowSpec {
	leading: { icon: string } | { text: string };
	label: string;
	active: boolean;
	/** Steps are steps to a screen reader; everything else is just current. */
	current: 'step' | 'true';
	damaged: boolean;
	indicator: { count: number } | { status: StepStatus };
	onClick: () => void;
}

const DEFINITION_ICONS: Record<DefinitionFileChoice, string> = {
	category: 'tags',
	'world-status': 'activity',
	relationship: 'heart-handshake',
};

/**
 * What every tree in one definition pane shares: which vocabulary is on
 * show, the rows drawn so far so a chosen one can be marked without redrawing
 * the others, and how to choose one.
 */
interface DefinitionPaneContext {
	id: DefinitionFileChoice;
	/** Rows by `id/kind/path`, replaced whenever a tree redraws. */
	rows: Map<string, HTMLElement>;
	select: (kind: EntityKindId, taxonomyPath: string) => void;
	/** Chooses an entry and opens whatever was folded over it on the way. */
	reveal: (kind: EntityKindId, taxonomyPath: string) => void;
	markSelected: () => void;
}

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
/** One line of a member's own facts, beneath its name. */
interface MemberFact {
	text: string;
	/** The note it names is gone, so the row shows that instead of the name. */
	missing: boolean;
}

/** What a row shows where the note a field names is no longer there. */
const MISSING_REFERENCE_TEXT = '???';

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
	/**
	 * Folded rows of the definition trees, keyed `id/kind/path`. Session
	 * state like a table's search: a refresh redraws the fold as it stood.
	 */
	private readonly definitionCollapse = new Set<string>();
	/** Folded kind sections, keyed `id/kind`. */
	private readonly definitionSectionCollapse = new Set<string>();
	/** What each tree's search box holds, keyed `id/kind`. */
	private readonly definitionQueries = new Map<string, string>();
	/** What the template pane's search box holds. */
	private customFieldsQuery = '';
	/** The entry the inspector is showing, one per vocabulary. */
	private readonly definitionSelection = new Map<
		DefinitionFileChoice,
		{ kind: EntityKindId; taxonomyPath: string }
	>();
	/**
	 * The one entry whose users are listed in full rather than previewed,
	 * keyed `id/kind/path`. One at a time, and only while it is being read.
	 */
	private definitionUsageOpen: string | null = null;
	private readonly entityQueries = new Map<WorldbuildingKindId, string>();
	private readonly entityCategoryFilters = new Map<WorldbuildingKindId, string>();
	private readonly entityStatusFilters = new Map<
		WorldbuildingKindId,
		'all' | ProgressStatus
	>();
	private readonly entityCategories = new Map<
		WorldbuildingKindId,
		{ projectId: string; paths: string[] }
	>();
	private readonly entityScroll = new Map<WorldbuildingKindId, number>();
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
		RAIL_SCROLL_SELECTOR,
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

	private get freeformMode(): boolean {
		return this.host.isFreeformModeEnabled();
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
		// However the selection got here, a step pane freeform mode no longer
		// shows lands on characters instead.
		if (model !== null && this.freeformMode) {
			this.selectedPane = coerceFreeformPane(this.selectedPane);
			if (this.selectedPane.kind === 'step') {
				this.selectedStep = this.selectedPane.step;
			}
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

		if (!this.freeformMode) {
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
		}

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
		// The project-level notices share one place: a vault from a newer
		// release warns just above, and one with notes from an older release
		// offers its update here, wherever in the dashboard the author is.
		this.renderMigrationCallout(root, model);

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
		// layout: the rail and the main panel share a grid row, and the row's
		// height is not settled until the panel beside it exists.
		this.renderState.restore(root);
		if (continuity.revealActiveStep) {
			this.renderState.reveal(root, RAIL_SCROLL_SELECTOR, ACTIVE_STEP_SELECTOR);
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
			attr: {
				'aria-label': this.t(
					this.freeformMode ? 'dashboard.worldbuilding' : 'dashboard.steps',
				),
			},
		});
		// Both groups scroll together, inside the rail rather than as the rail:
		// the project switcher stands on the floor below, where no scrollbar
		// reaches it and its rule still meets both walls.
		const groups = nav.createDiv({ cls: 'snowflake-method-step-nav-scroll' });
		if (!this.freeformMode) this.renderStepsGroup(groups, model);

		this.renderWorldbuildingGroup(groups, model);

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

	/**
	 * Opens the form for a new note of a kind, from outside the dashboard. The
	 * kind's own pane comes forward first, so the note lands in a table the
	 * author is already looking at, and the form is the pane's own: everything
	 * it offers, categories and records included, is built from this render.
	 * Characters and scenes keep their own panes and their own forms, which is
	 * where those two have always been written.
	 */
	async startEntityCreation(kind: EntityKindId): Promise<void> {
		if (this.lastRender?.model == null) return;
		this.selectedPane =
			kind === 'character'
				? { kind: 'step', step: 7 }
				: kind === 'scene'
					? { kind: 'step', step: 8 }
					: { kind: 'worldbuilding', wbKind: kind };
		if (this.selectedPane.kind === 'step') {
			this.selectedStep = this.selectedPane.step;
		}
		this.stepChosen = true;
		await this.refresh();
		const model = this.lastRender.model;
		if (model === null) return;
		if (kind === 'character') this.openCreateCharacter(model);
		else if (kind === 'scene') this.openCreateScene(model);
		else this.openCreateEntity(model, kind);
	}

	/** Opens the new-kind dialog, the same one the rail's invitation opens. */
	startKindCreation(): void {
		const model = this.lastRender?.model ?? null;
		if (model === null) return;
		this.openCreateKind(model);
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
	 * One row of the rail, whichever group it stands in: a mark where a step
	 * keeps its number, what the pane is called, and the circle at the end
	 * carrying either how many notes are in there or how far along a step is.
	 * A row with something to report wears the warning in place of its circle,
	 * because that one of them needs looking at matters more than how many.
	 */
	private renderRailRow(list: HTMLElement, row: RailRowSpec): void {
		const item = list.createEl('li', { cls: 'snowflake-method-step-item' });
		const button = item.createEl('button', {
			cls: `snowflake-method-step-button${row.active ? ' is-active' : ''}${
				row.damaged ? ' has-managed-section-issue' : ''
			}`,
			attr: {
				type: 'button',
				'aria-label': row.label,
				...(row.damaged ? { 'aria-invalid': 'true' } : {}),
				...(row.active ? { 'aria-current': row.current } : {}),
			},
		});
		if ('icon' in row.leading) {
			const iconEl = button.createSpan({
				cls: 'snowflake-method-step-number snowflake-method-worldbuilding-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(iconEl, row.leading.icon);
		} else {
			button.createSpan({
				cls: 'snowflake-method-step-number',
				text: row.leading.text,
			});
		}
		button.createSpan({
			cls: 'snowflake-method-step-label',
			text: row.label,
		});
		const counted = 'count' in row.indicator;
		const indicator = button.createSpan({
			cls: `snowflake-method-step-indicator${
				counted ? ' snowflake-method-worldbuilding-count' : ''
			}`,
			attr: {
				'aria-label': row.damaged
					? this.t('projectStructure.damagedTitle')
					: 'count' in row.indicator
						? String(row.indicator.count)
						: this.t(`status.${row.indicator.status}`),
			},
		});
		if ('status' in row.indicator) {
			indicator.dataset.status = row.indicator.status;
		}
		if (row.damaged) {
			indicator.addClass('has-managed-section-issue');
			setIcon(indicator, 'triangle-alert');
		} else if ('count' in row.indicator) {
			this.setCount(indicator, row.indicator.count);
		} else {
			indicator.setText(this.statusGlyph(row.indicator.status));
		}
		button.addEventListener('click', row.onClick);
	}

	private renderStepsGroup(
		nav: HTMLElement,
		model: ProjectDashboardModel,
	): void {
		const stepsGroup = this.createRailGroup(
			nav,
			'steps',
			this.t('dashboard.steps'),
		);
		const list = stepsGroup.createEl('ol', { cls: 'snowflake-method-step-list' });
		for (const step of model.steps) {
			this.renderRailRow(list, {
				leading: { text: this.t(`steps.number.${step.id}`) },
				label: step.title,
				active:
					this.selectedPane.kind === 'step' &&
					step.id === this.selectedPane.step,
				current: 'step',
				damaged: this.getStepHealthIssues(model, step.id).some(
					(issue) => issue.blocking,
				),
				indicator: { status: step.status },
				onClick: () => {
					this.selectedStep = step.id;
					this.selectedPane = { kind: 'step', step: step.id };
					this.stepChosen = true;
					void this.runAndRefresh(() => this.host.selectStep(step.id));
				},
			});
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
		// The chevron leads, as every other fold in the plugin does, and stands
		// in the column the rows below keep their marks in — which puts the
		// word itself in the column those rows keep their names in.
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

	/**
	 * A characters or scenes row for the worldbuilding group while freeform
	 * mode has the steps away: a kind-shaped face over the step pane it still
	 * selects, warning exactly when the hidden step row would have.
	 */
	private renderFreeformEntityRow(
		list: HTMLElement,
		model: ProjectDashboardModel,
		step: 7 | 8,
	): void {
		this.renderRailRow(list, {
			leading: { icon: kindIcon(model, step === 7 ? 'character' : 'scene') },
			label: this.t(step === 7 ? 'freeform.character' : 'freeform.scene'),
			active:
				this.selectedPane.kind === 'step' && this.selectedPane.step === step,
			current: 'step',
			damaged: this.getStepHealthIssues(model, step).some(
				(issue) => issue.blocking,
			),
			indicator: {
				count: step === 7 ? model.characters.length : model.scenes.length,
			},
			onClick: () => {
				this.selectedStep = step;
				this.selectedPane = { kind: 'step', step };
				this.stepChosen = true;
				void this.runAndRefresh(() => this.host.selectStep(step));
			},
		});
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
		// With the steps out of sight, characters and scenes stand where an
		// author reaches for them first: ahead of the kinds they write about.
		if (this.freeformMode) {
			this.renderFreeformEntityRow(list, model, 7);
			this.renderFreeformEntityRow(list, model, 8);
		}
		for (const descriptor of model.worldbuildingKinds) {
			const kind = descriptor.id;
			const entities = kindEntities(model, kind);
			this.renderRailRow(list, {
				leading: { icon: kindIcon(model, kind) },
				label: this.kindDisplayName(kind),
				active:
					this.selectedPane.kind === 'worldbuilding' &&
					this.selectedPane.wbKind === kind,
				current: 'true',
				// Whatever the project reports about one of these notes, the same
				// way a step carries what is reported about its own: the count
				// steps aside for the warning, because how many there are matters
				// less than that one of them needs looking at.
				damaged: entities.some(
					(entity) =>
						entity.healthIssues.some((issue) => issue.blocking) ||
						this.memberWarnings(model, entity.path).length > 0,
				),
				indicator: { count: entities.length },
				onClick: () => {
					this.selectedPane = { kind: 'worldbuilding', wbKind: kind };
					this.stepChosen = true;
					void this.runAndRefresh(() =>
						this.host.selectWorldbuildingKind(kind),
					);
				},
			});
		}
		// The invitation to add a kind, standing with the kinds it would join
		// and above the line the vocabularies sit behind: quiet like every
		// other add-row, because it is an offer rather than a thing.
		const hintItem = list.createEl('li', {
			cls: 'snowflake-method-step-item',
		});
		const hint = hintItem.createEl('button', {
			cls: 'snowflake-method-step-button snowflake-method-add-kind',
			attr: { type: 'button', 'aria-label': this.t('worldbuilding.kind.add') },
		});
		// Disabled only while all thirty-two slots are in use at once: a
		// deleted kind frees its slot, and the invitation comes back with it.
		hint.disabled =
			model.readOnly || nextCustomKindPrefix(model.worldbuildingKinds) === null;
		const hintIcon = hint.createSpan({
			cls: 'snowflake-method-step-number snowflake-method-worldbuilding-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(hintIcon, 'plus');
		hint.createSpan({
			cls: 'snowflake-method-step-label',
			text: this.t('worldbuilding.kind.add'),
		});
		hint.addEventListener('click', () => {
			this.openCreateKind(model);
		});
		// The vocabularies live with the kinds they classify: three more
		// entries in the same list, each the whole of one vocabulary across
		// every kind — but they are words rather than notes, so a line parts
		// them from the kinds above.
		list.createEl('li', {
			cls: 'snowflake-method-rail-divider',
			attr: { role: 'presentation' },
		});
		for (const definitionId of DEFINITION_FILE_IDS) {
			const trees = entityKindIds(model.worldbuildingKinds).map((kind) =>
				forestTree(model.definitions[definitionId], kind),
			);
			this.renderRailRow(list, {
				leading: { icon: DEFINITION_ICONS[definitionId] },
				label: this.t(`dashboard.definition.${definitionId}`),
				active:
					this.selectedPane.kind === 'definition' &&
					this.selectedPane.definitionId === definitionId,
				current: 'true',
				// Held to the standard the kinds above set: whatever the project
				// reports about the vocabulary — an entry without its note, a path
				// members name that no folder spells — takes the count's place.
				damaged: trees.some((tree) =>
					tree.nodes.some((node) => node.missing || node.missingSelf),
				),
				indicator: {
					count: trees.reduce(
						(total, tree) =>
							total + tree.nodes.filter((node) => !node.missing).length,
						0,
					),
				},
				onClick: () => {
					this.selectedPane = { kind: 'definition', definitionId };
					this.stepChosen = true;
					void this.refresh();
				},
			});
		}
		this.renderCustomFieldsRailEntry(list, model);
	}

	/** The rail entry under Relationship that opens the template tables. */
	private renderCustomFieldsRailEntry(
		list: HTMLElement,
		model: ProjectDashboardModel,
	): void {
		this.renderRailRow(list, {
			leading: { icon: 'layout-template' },
			label: this.t('dashboard.customFields'),
			active: this.selectedPane.kind === 'custom-fields',
			current: 'true',
			// Templates are shapes rather than notes: nothing here can be
			// damaged the way an entry with a missing folder can.
			damaged: false,
			indicator: {
				count: entityKindIds(model.worldbuildingKinds).reduce(
					(total, kind) =>
						total + (model.customFieldTemplates[kind]?.length ?? 0),
					0,
				),
			},
			onClick: () => {
				this.selectedPane = { kind: 'custom-fields' };
				this.stepChosen = true;
				void this.refresh();
			},
		});
	}

	/**
	 * The panel one worldbuilding kind fills: the same shape as a member step,
	 * with the records living behind the entity form rather than in prose.
	 */
	private renderWorldbuildingPane(
		layout: HTMLElement,
		model: ProjectDashboardModel,
		kind: WorldbuildingKindId,
	): void {
		const main = layout.createEl('main', { cls: 'snowflake-method-main' });
		this.renderedPaneKey = dashboardPaneKey({ kind: 'worldbuilding', wbKind: kind });
		const panel = main.createDiv({ cls: 'snowflake-method-panel' });
		const descriptor = model.worldbuildingKinds.find(
			(candidate) => candidate.id === kind,
		);
		// The same header a step panel carries, so a kind's title sits where a
		// step's does and reads at the same size.
		const header = panel.createDiv({ cls: 'snowflake-method-panel-header' });
		const title = header.createDiv({ cls: 'snowflake-method-panel-title' });
		title.createEl('h2', { text: this.kindDisplayName(kind) });
		// An authored kind answers for its own name, looks, and existence: its
		// doors hang where a step keeps its status, at the header's right.
		if (descriptor?.custom === true) {
			const options = header.createEl('button', {
				cls: 'clickable-icon snowflake-method-kind-options',
				attr: {
					type: 'button',
					'aria-haspopup': 'menu',
					'aria-label': this.t('worldbuilding.kind.options', { name: kind }),
				},
			});
			setIcon(options, 'ellipsis');
			options.addEventListener('click', (event) => {
				const menu = new Menu();
				menu.addItem((menuItem) =>
					menuItem
						.setTitle(this.t('actions.edit'))
						.setIcon('pencil')
						.setDisabled(model.readOnly)
						.onClick(() => {
							this.openRenameKind(model, descriptor);
						}),
				);
				menu.addItem((menuItem) =>
					menuItem
						.setTitle(this.t('actions.delete'))
						.setIcon('trash-2')
						.setDisabled(model.readOnly)
						.onClick(() => {
							void this.confirmKindDeletion(model, kind);
						}),
				);
				menu.showAtMouseEvent(event);
			});
		}
		// Built-ins carry their own sentences; an authored kind says only what
		// its author wrote, and nothing stands where nothing was written.
		const paneDescription = isWorldbuildingKind(kind)
			? this.t(`worldbuilding.kind.${kind}.description`)
			: (descriptor?.description ?? '');
		if (paneDescription.length > 0) {
			panel.createEl('p', {
				cls: 'snowflake-method-step-description',
				text: paneDescription,
			});
		}
		const paths = new Set(kindEntities(model, kind).map((entity) => entity.path));
		const blockingIssues = [
			...kindEntities(model, kind).flatMap((entity) => entity.healthIssues),
			...model.structureIssues.filter((issue) => paths.has(issue.path)),
		].filter((issue) => issue.blocking);
		if (blockingIssues.length > 0) {
			this.renderManagedSectionIssues(panel, blockingIssues);
		}

		const actions = panel.createDiv({
			cls: 'snowflake-method-actions snowflake-method-list-actions',
		});
		this.renderOpenBase(actions, kind, model);
		const add = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.kindText('worldbuilding.add', kind),
			attr: { type: 'button' },
		});
		add.disabled = model.readOnly;
		add.addEventListener('click', () => {
			this.openCreateEntity(model, kind);
		});

		if (kindEntities(model, kind).length === 0) {
			const empty = panel.createEl('p', {
				cls: 'snowflake-method-character-empty',
			});
			const icon = empty.createSpan({
				cls: 'snowflake-method-character-empty-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(icon, 'triangle-alert');
			empty.createSpan({ text: this.kindText('worldbuilding.empty', kind) });
			return;
		}

		// The same frame the character and scene tables stand in, so a project
		// reads the same whichever of its lists is on show.
		panel.addClass('snowflake-method-member-panel');
		const toolbar = panel.createDiv({ cls: 'snowflake-method-table-toolbar' });
		const search = new SearchComponent(toolbar);
		search.setPlaceholder(this.kindText('worldbuilding.search', kind));
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
			],
		);
		const reorderReadOnly =
			model.readOnly ||
			kindEntities(model, kind).some((entity) => entity.readOnly);

		let entries: { entity: WorldbuildingEntityViewModel; index: number }[] = [];
		const virtual = new VirtualTable({
			scroller: bodyWrap,
			body,
			columns: this.tableColumnClasses().length,
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
					this.tableColumnClasses().length,
					this.kindText('worldbuilding.addMore', kind),
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
							total: kindEntities(model, kind).length,
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
		kind: WorldbuildingKindId,
	): { entity: WorldbuildingEntityViewModel; index: number }[] {
		const query = this.entityQueries.get(kind) ?? '';
		const category = this.entityCategoryFilters.get(kind) ?? '';
		const status = this.entityStatusFilters.get(kind) ?? 'all';
		return kindEntities(model, kind)
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

	private entityFiltered(kind: WorldbuildingKindId): boolean {
		return (
			(this.entityCategoryFilters.get(kind) ?? '') !== '' ||
			(this.entityStatusFilters.get(kind) ?? 'all') !== 'all'
		);
	}

	private entityListFiltered(kind: WorldbuildingKindId): boolean {
		return (
			(this.entityQueries.get(kind) ?? '').trim().length > 0 ||
			this.entityFiltered(kind)
		);
	}

	private entityFilterRows(
		model: ProjectDashboardModel,
		kind: WorldbuildingKindId,
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
		kind: WorldbuildingKindId,
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
		kind: WorldbuildingKindId,
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
			damaged,
			warnings: this.memberWarnings(model, entity.path),
			aliases: entity.aliases,
			// What a time note is and what it spans, a fact to a line: its own,
			// which the other kinds have none of and the columns no room for.
			details:
				kind === 'time'
					? ([
							{
								text:
									entity.timeKind === null
										? ''
										: this.t(`form.timeKind.${entity.timeKind}`),
								missing: false,
							},
							{
								text: termName(entity.timeStart),
								missing: entity.timeStartMissing,
							},
							{ text: termName(entity.timeEnd), missing: entity.timeEndMissing },
						].filter((fact) => fact.text.length > 0) satisfies MemberFact[])
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
		const textCell = row.createEl('td', {
			text: entity.description,
			attr: { 'data-label': this.t('table.description') },
		});
		const locked = model.readOnly || entity.readOnly || damaged;
		const openEntity = (): void => {
			void this.host.openManagedFile(entity.path, 'entity-fields', [
				'entity-fields',
			]);
		};
		const editEntity = (): void => {
			if (!locked) void this.openEntityEditor(model, entity);
		};
		const entities = kindEntities(model, kind);
		this.renderRowActions(row, textCell, {
			name: entity.name,
			primaryLabel: this.t('actions.edit'),
			primary: editEntity,
			primaryDisabled: locked,
			// The same items a character's and a scene's menu carries.
			items: (menu) => {
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
					insertTitle: this.kindText('worldbuilding.insertAfter', kind),
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
			},
			remove: () => {
				void this.runAndRefresh(() =>
					this.host.deleteEntity(entity.id, entity.revision),
				);
			},
			removeDisabled: model.readOnly || entity.readOnly,
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
		kind: WorldbuildingKindId,
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
		kind: WorldbuildingKindId,
		index: number,
	): void {
		void this.memberFormContext(model, kind).then((context) => {
			new EntityFormModal(
				this.app,
				this.t,
				kind,
				kindEntities(model, kind).map((entity) => entity.name),
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
	 * The panel one vocabulary fills: the whole of one id across every kind,
	 * each kind a section holding its tree. The trees are small — the depth
	 * cap keeps them readable — so the rows are plain elements rather than a
	 * virtual table, and the fold is session state like a table's search.
	 */
	private renderDefinitionPane(
		layout: HTMLElement,
		model: ProjectDashboardModel,
		id: DefinitionFileChoice,
	): void {
		const main = layout.createEl('main', { cls: 'snowflake-method-main' });
		this.renderedPaneKey = dashboardPaneKey({
			kind: 'definition',
			definitionId: id,
		});
		const panel = main.createDiv({ cls: 'snowflake-method-panel' });
		const header = panel.createDiv({ cls: 'snowflake-method-panel-header' });
		const title = header.createDiv({ cls: 'snowflake-method-panel-title' });
		title.createEl('h2', { text: this.t(`dashboard.definition.${id}`) });
		panel.createEl('p', {
			cls: 'snowflake-method-step-description',
			text: this.t(`dashboard.definition.${id}.description`),
		});
		const forest = model.definitions[id];
		// The project file sits one folder below the root, which is how the
		// report's project-relative names are read back against this pane's
		// trees.
		const projectRoot = model.path.split('/').slice(0, -2).join('/');
		const relativeRoots = entityKindIds(model.worldbuildingKinds).map((kind) => {
			const rootPath = forestTree(forest, kind).rootPath;
			return rootPath.startsWith(`${projectRoot}/`)
				? rootPath.slice(projectRoot.length + 1)
				: rootPath;
		});
		const paneIssues = model.structureIssues.filter((issue) => {
			if (!issue.blocking) return false;
			if (issue.code === 'missing-definition-node') {
				return entityKindIds(model.worldbuildingKinds).some((kind) => {
					const rootPath = forestTree(forest, kind).rootPath;
					return (
						issue.path === rootPath || issue.path.startsWith(`${rootPath}/`)
					);
				});
			}
			if (issue.code === 'unresolved-definition-link') {
				return issue.names.some((name) =>
					relativeRoots.some((root) => name.startsWith(`${root}/`)),
				);
			}
			return false;
		});
		if (paneIssues.length > 0) {
			this.renderManagedSectionIssues(panel, paneIssues);
		}
		panel.addClass('snowflake-method-definition-panel');
		// One search and one way in, on the line every member pane puts them,
		// and above both columns: what is being looked for is a word rather
		// than a word in the character trees, and what is being added is an
		// entry rather than a character's entry — which kind it belongs to is
		// the first thing the dialog asks. Standing above the columns is also
		// what lets the first tree's heading and the inspector start level.
		const toolbar = panel.createDiv({
			cls: 'snowflake-method-table-toolbar snowflake-method-definition-toolbar',
		});
		const search = new SearchComponent(toolbar);
		search.setPlaceholder(this.t('definition.search'));
		search.setValue(this.definitionQueries.get(id) ?? '');
		const add = toolbar.createEl('button', {
			cls: 'mod-cta snowflake-method-definition-add',
			text: this.t(`definition.add.${id}`),
			attr: { type: 'button' },
		});
		add.disabled = model.readOnly;
		add.addEventListener('click', () => {
			void this.addDefinitionEntryToKind(model, id);
		});
		// Browse on one side, inspect on the other: a tree row has room for a
		// name and little else, and what an entry means and who uses it are
		// exactly what the row cannot hold. Narrow panes stack the two, the
		// inspector first, so a chosen entry is not below a long tree.
		const columns = panel.createDiv({
			cls: 'snowflake-method-definition-layout',
		});
		const browser = columns.createDiv({
			cls: 'snowflake-method-definition-browser',
		});
		// The frame around the trees is not one of them: it rides above the
		// rows, one screenful tall and pinned to the top of the column, so it
		// stands closed wherever the reader has scrolled to. Being inside the
		// column it stops where the scrollbar's lane begins, which is what
		// leaves the bar running outside it.
		browser.createDiv({
			cls: 'snowflake-method-definition-frame',
			attr: { 'aria-hidden': 'true' },
		});
		const inspector = columns.createEl('aside', {
			cls: 'snowflake-method-definition-inspector',
		});
		const noMatches = browser.createEl('p', {
			cls: 'snowflake-method-definition-empty is-hidden',
			text: this.t('definition.noMatches'),
		});
		const rows = new Map<string, HTMLElement>();
		// The trees redraw from here, so a step taken in the panel — following
		// the path of the chosen entry back up a branch — can open what was
		// folded over the entry it lands on.
		let repaintTrees = (): void => {};
		const paintInspector = (): void => {
			this.renderDefinitionInspector(inspector, model, context);
		};
		const markSelected = (): void => {
			const chosen = this.definitionSelection.get(id);
			const key =
				chosen === undefined
					? null
					: this.definitionCollapseKey(id, chosen.kind, chosen.taxonomyPath);
			for (const [rowKey, element] of rows) {
				const selected = rowKey === key;
				element.toggleClass('is-selected', selected);
				element.setAttribute('aria-selected', String(selected));
			}
		};
		const context: DefinitionPaneContext = {
			id,
			rows,
			markSelected,
			select: (kind, taxonomyPath) => {
				this.definitionSelection.set(id, { kind, taxonomyPath });
				markSelected();
				paintInspector();
			},
			reveal: (kind, taxonomyPath) => {
				// An entry cannot be shown as chosen while a fold above it hides
				// its row, so every fold along the way is opened first.
				const segments = taxonomyPath.split('/');
				for (let depth = 1; depth <= segments.length; depth += 1) {
					this.definitionCollapse.delete(
						this.definitionCollapseKey(
							id,
							kind,
							segments.slice(0, depth).join('/'),
						),
					);
				}
				this.definitionSectionCollapse.delete(`${id}/${kind}`);
				this.definitionSelection.set(id, { kind, taxonomyPath });
				repaintTrees();
				markSelected();
				paintInspector();
				rows
					.get(this.definitionCollapseKey(id, kind, taxonomyPath))
					?.scrollIntoView({ block: 'nearest' });
			},
		};
		const painters = entityKindIds(model.worldbuildingKinds).map((kind) =>
			this.renderDefinitionSection(browser, model, context, kind),
		);
		repaintTrees = (): void => {
			for (const paint of painters) paint();
		};
		// What is left of the column once the trees have taken their share: it
		// closes the last one with a line, and holds the room below it. When
		// the trees fill the column there is nothing left of it, and nothing
		// left to draw the line with — which is the moment the frame's own
		// floor is doing that work.
		browser.createDiv({ cls: 'snowflake-method-definition-tail' });
		search.onChange((value) => {
			this.definitionQueries.set(id, value);
			const found = painters.reduce((total, paint) => total + paint(), 0);
			const nothingFound = value.trim().length > 0 && found === 0;
			noMatches.toggleClass('is-hidden', !nothingFound);
			// The tail's parting line answers to this class rather than to a
			// :has selector, which the browser re-checks broadly on any change.
			browser.toggleClass('is-empty', nothingFound);
		});
		paintInspector();
	}

	/**
	 * One kind's tree of one vocabulary, behind a fold of its own: five trees
	 * in one pane is four more than anyone reads at once, so each says how
	 * many entries it holds and opens when it is wanted.
	 *
	 * Everything below the header redraws in place — folding a row, searching,
	 * choosing an entry — because a full refresh would take the search box's
	 * focus away between one keystroke and the next.
	 */
	private renderDefinitionSection(
		browser: HTMLElement,
		model: ProjectDashboardModel,
		context: DefinitionPaneContext,
		kind: EntityKindId,
	): () => number {
		const { id } = context;
		const tree = forestTree(model.definitions[id], kind);
		const sectionKey = `${id}/${kind}`;
		const section = browser.createDiv({
			cls: 'snowflake-method-definition-section',
		});
		const header = section.createDiv({
			cls: 'snowflake-method-definition-section-header',
		});
		const collapsed = (): boolean =>
			this.definitionSectionCollapse.has(sectionKey);
		const toggle = header.createEl('button', {
			cls: 'snowflake-method-definition-section-toggle',
			attr: { type: 'button', 'aria-expanded': String(!collapsed()) },
		});
		const chevron = toggle.createSpan({
			cls: 'snowflake-method-definition-section-chevron',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(chevron, collapsed() ? 'chevron-right' : 'chevron-down');
		toggle.createSpan({
			cls: 'snowflake-method-definition-section-title',
			text: this.definitionKindLabel(kind),
			attr: { role: 'heading', 'aria-level': '3' },
		});
		// How many entries this kind keeps, worn the way the rail wears its
		// counts: the same circle, in the same place at the end of the line.
		const standing = tree.nodes.filter((node) => !node.missing).length;
		this.setCount(
			toggle.createSpan({
				cls:
					'snowflake-method-step-indicator snowflake-method-worldbuilding-count ' +
					'snowflake-method-definition-count',
				attr: {
					'aria-label': this.t('definition.countLabel', { count: standing }),
				},
			}),
			standing,
		);
		const body = section.createDiv({
			cls: 'snowflake-method-definition-section-body',
		});
		if (tree.nodes.length === 0) {
			// The same sentence an empty member table says, worn the same way:
			// a kind with no vocabulary yet is not a fault, it is a start.
			const empty = body.createEl('p', {
				cls: 'snowflake-method-character-empty',
			});
			const icon = empty.createSpan({
				cls: 'snowflake-method-character-empty-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(icon, 'triangle-alert');
			empty.createSpan({ text: this.t(`definition.empty.${id}`) });
		}
		const rows =
			tree.nodes.length === 0
				? null
				: body.createDiv({
						cls: 'snowflake-method-definition-tree',
						attr: { role: 'tree' },
					});
		// How many entries the search found here: what tells the pane whether
		// this kind has anything to show, and whether anything was found at all.
		const paint = (): number => {
			const query = this.definitionQueries.get(id) ?? '';
			const searching = query.trim().length > 0;
			// A search reaches into folded branches rather than past them, so
			// while one is on, the fold is set aside — the row's own and the
			// whole section's alike.
			const open = searching || !collapsed();
			body.toggleClass('is-collapsed', !open);
			toggle.setAttribute('aria-expanded', String(open));
			setIcon(chevron, open ? 'chevron-down' : 'chevron-right');
			if (rows === null) {
				section.toggleClass('is-hidden', searching);
				return 0;
			}
			rows.empty();
			// A match is worth nothing without the branch it hangs from, so the
			// ancestors of every hit come along.
			const shown = new Set<string>();
			let found = 0;
			if (searching) {
				for (const node of tree.nodes) {
					if (
						!memberMatches(
							[node.name, node.taxonomyPath, node.description],
							query,
						)
					) {
						continue;
					}
					found += 1;
					const segments = node.taxonomyPath.split('/');
					for (let depth = 1; depth <= segments.length; depth += 1) {
						shown.add(segments.slice(0, depth).join('/'));
					}
				}
				// A kind with nothing to answer steps aside rather than saying
				// so five times over.
				section.toggleClass('is-hidden', found === 0);
				if (found === 0) return 0;
			} else {
				section.removeClass('is-hidden');
			}
			for (let index = 0; index < tree.nodes.length; index += 1) {
				const node = tree.nodes[index];
				if (node === undefined) continue;
				if (searching) {
					if (!shown.has(node.taxonomyPath)) continue;
				} else if (
					this.definitionAncestorCollapsed(id, kind, node.taxonomyPath)
				) {
					continue;
				}
				const hasChildren = (tree.nodes[index + 1]?.depth ?? 0) > node.depth;
				this.renderDefinitionRow(rows, model, context, kind, node, {
					hasChildren,
					folded:
						!searching &&
						this.definitionCollapse.has(
							this.definitionCollapseKey(id, kind, node.taxonomyPath),
						),
					repaint: () => {
						paint();
					},
				});
			}
			// Where the next entry goes, at the end of the list that will hold
			// it — the same offer the member tables end with, riding with its
			// list the way theirs do.
			const more = rows.createEl('button', {
				cls: 'snowflake-method-definition-add-more',
				text: this.t(`definition.addMore.${id}`),
				attr: { type: 'button' },
			});
			more.disabled = model.readOnly;
			more.addEventListener('click', () => {
				void this.addDefinitionEntry(id, kind, '');
			});
			context.markSelected();
			return found;
		};
		toggle.addEventListener('click', () => {
			if (!this.definitionSectionCollapse.delete(sectionKey)) {
				this.definitionSectionCollapse.add(sectionKey);
			}
			paint();
		});
		paint();
		return paint;
	}

	/**
	 * One row of a tree: the fold toggle, the name marked the way a member's
	 * is when the project reports anything about it, how many notes name it,
	 * and everything that can be done to it behind one quiet button at the
	 * end. The row itself chooses the entry the inspector is showing, which
	 * is where its description and the notes using it are read.
	 */
	private renderDefinitionRow(
		rows: HTMLElement,
		model: ProjectDashboardModel,
		context: DefinitionPaneContext,
		kind: EntityKindId,
		node: DefinitionNodeInfo,
		shape: { hasChildren: boolean; folded: boolean; repaint: () => void },
	): void {
		const { id } = context;
		const rowKey = this.definitionCollapseKey(id, kind, node.taxonomyPath);
		const chosen = this.definitionSelection.get(id);
		const selected =
			chosen?.kind === kind && chosen.taxonomyPath === node.taxonomyPath;
		const row = rows.createDiv({
			cls: `snowflake-method-definition-row${node.missing ? ' is-missing' : ''}${
				selected ? ' is-selected' : ''
			}`,
			attr: {
				role: 'treeitem',
				'aria-level': String(node.depth),
				'aria-selected': String(selected),
				...(shape.hasChildren
					? { 'aria-expanded': shape.folded ? 'false' : 'true' }
					: {}),
			},
		});
		context.rows.set(rowKey, row);
		const fold = (): void => {
			if (!shape.hasChildren) return;
			if (!this.definitionCollapse.delete(rowKey)) {
				this.definitionCollapse.add(rowKey);
			}
			shape.repaint();
		};
		// The whole row answers, arrow included: choosing an entry and opening
		// what is under it are one gesture, the way a heading opens its own
		// section. Only the button at the end keeps a click of its own.
		row.addEventListener('click', (event) => {
			const target = event.target;
			if (
				target instanceof Element &&
				target.closest('.snowflake-method-definition-more') !== null
			) {
				return;
			}
			context.select(kind, node.taxonomyPath);
			fold();
		});
		// How deep the row sits, which is both its indent and how many guide
		// lines run down its left: one for every branch it hangs from.
		row.style.setProperty(
			'--snowflake-definition-depth',
			String(node.depth - 1),
		);
		if (shape.hasChildren) {
			// Which way it points is all it does: the row opens itself, the way
			// a section heading opens its own section.
			const toggle = row.createSpan({
				cls: 'snowflake-method-definition-toggle',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(toggle, shape.folded ? 'chevron-right' : 'chevron-down');
		} else {
			row.createSpan({
				cls: 'snowflake-method-definition-toggle-spacer',
				attr: { 'aria-hidden': 'true' },
			});
		}
		const troubles = [
			...this.memberWarnings(model, node.folderPath),
			...(node.missing ? [this.t('definition.missingEntry')] : []),
		];
		const body = row.createEl('button', {
			cls: 'snowflake-method-definition-row-body',
			attr: { type: 'button' },
		});
		setTooltip(body, [node.taxonomyPath, ...troubles].join('\n'));
		this.renderTableName(body, node.name, troubles);
		const more = row.createEl('button', {
			cls: 'clickable-icon snowflake-method-definition-more',
			attr: {
				type: 'button',
				'aria-haspopup': 'menu',
				'aria-label': this.t('definition.options', { name: node.name }),
			},
		});
		setIcon(more, 'ellipsis');
		more.addEventListener('click', (event) => {
			this.showDefinitionMenu(event, model, id, kind, node, more);
		});
	}

	/**
	 * The template tables: one section per kind, each a small table of the
	 * kind's custom-field templates with edit and delete at hand. Dressed like
	 * the vocabulary pane — header, search, per-kind folds — but a template
	 * list is flat, so a table stands where the tree would.
	 */
	private renderCustomFieldsPane(
		layout: HTMLElement,
		model: ProjectDashboardModel,
	): void {
		const main = layout.createEl('main', { cls: 'snowflake-method-main' });
		this.renderedPaneKey = dashboardPaneKey({ kind: 'custom-fields' });
		const panel = main.createDiv({ cls: 'snowflake-method-panel' });
		const header = panel.createDiv({ cls: 'snowflake-method-panel-header' });
		const title = header.createDiv({ cls: 'snowflake-method-panel-title' });
		title.createEl('h2', { text: this.t('dashboard.customFields') });
		panel.createEl('p', {
			cls: 'snowflake-method-step-description',
			text: this.t('dashboard.customFields.description'),
		});
		const toolbar = panel.createDiv({
			cls: 'snowflake-method-table-toolbar snowflake-method-definition-toolbar',
		});
		const search = new SearchComponent(toolbar);
		search.setPlaceholder(this.t('customFields.search'));
		search.setValue(this.customFieldsQuery);
		const add = toolbar.createEl('button', {
			cls: 'mod-cta snowflake-method-definition-add',
			text: this.t('customFields.add'),
			attr: { type: 'button' },
		});
		add.disabled = model.readOnly;
		add.addEventListener('click', () => {
			void this.addTemplateToKind(model);
		});
		const sections = panel.createDiv({
			cls: 'snowflake-method-template-sections',
		});
		const painters = entityKindIds(model.worldbuildingKinds).map((kind) =>
			this.renderCustomFieldsSection(sections, model, kind),
		);
		const noMatches = sections.createEl('p', {
			cls: 'snowflake-method-definition-empty is-hidden',
			text: this.t('definition.noMatches'),
		});
		search.onChange((value) => {
			this.customFieldsQuery = value;
			const found = painters.reduce((total, paint) => total + paint(), 0);
			noMatches.toggleClass(
				'is-hidden',
				!(value.trim().length > 0 && found === 0),
			);
		});
	}

	/** One kind's templates behind a fold of its own, as a two-column table. */
	private renderCustomFieldsSection(
		container: HTMLElement,
		model: ProjectDashboardModel,
		kind: EntityKindId,
	): () => number {
		const templates = model.customFieldTemplates[kind] ?? [];
		const sectionKey = `custom-fields/${kind}`;
		const section = container.createDiv({
			cls: 'snowflake-method-definition-section',
		});
		const header = section.createDiv({
			cls: 'snowflake-method-definition-section-header',
		});
		const collapsed = (): boolean =>
			this.definitionSectionCollapse.has(sectionKey);
		const toggle = header.createEl('button', {
			cls: 'snowflake-method-definition-section-toggle',
			attr: { type: 'button', 'aria-expanded': String(!collapsed()) },
		});
		const chevron = toggle.createSpan({
			cls: 'snowflake-method-definition-section-chevron',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(chevron, collapsed() ? 'chevron-right' : 'chevron-down');
		toggle.createSpan({
			cls: 'snowflake-method-definition-section-title',
			text: this.definitionKindLabel(kind),
			attr: { role: 'heading', 'aria-level': '3' },
		});
		this.setCount(
			toggle.createSpan({
				cls:
					'snowflake-method-step-indicator snowflake-method-worldbuilding-count ' +
					'snowflake-method-definition-count',
				attr: {
					'aria-label': this.t('customFields.countLabel', {
						count: templates.length,
					}),
				},
			}),
			templates.length,
		);
		const body = section.createDiv({
			cls: 'snowflake-method-definition-section-body',
		});
		let rows: { template: CustomFieldTemplateInfo; row: HTMLElement }[] = [];
		if (templates.length === 0) {
			// The same sentence an empty tree says, worn the same way; the
			// toolbar's Add template is the way in, as it is for the trees.
			const empty = body.createEl('p', {
				cls: 'snowflake-method-character-empty',
			});
			const icon = empty.createSpan({
				cls: 'snowflake-method-character-empty-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(icon, 'triangle-alert');
			empty.createSpan({ text: this.t('customFields.empty') });
		} else {
			rows = this.renderCustomFieldsTable(body, model, kind, templates);
		}
		const paint = (): number => {
			const query = this.customFieldsQuery;
			const searching = query.trim().length > 0;
			const open = searching || !collapsed();
			body.toggleClass('is-collapsed', !open);
			toggle.setAttribute('aria-expanded', String(open));
			setIcon(chevron, open ? 'chevron-down' : 'chevron-right');
			let found = 0;
			for (const { template, row } of rows) {
				const matches =
					!searching ||
					memberMatches([template.name, template.description], query);
				row.toggleClass('is-hidden', !matches);
				if (matches) found += 1;
			}
			// While a search is on, a kind with nothing to show steps aside.
			section.toggleClass('is-hidden', searching && found === 0);
			return found;
		};
		toggle.addEventListener('click', () => {
			if (!this.definitionSectionCollapse.delete(sectionKey)) {
				this.definitionSectionCollapse.add(sectionKey);
			}
			paint();
		});
		paint();
		return paint;
	}

	/** The two-column table one kind's templates stand in, add-row included. */
	private renderCustomFieldsTable(
		body: HTMLElement,
		model: ProjectDashboardModel,
		kind: EntityKindId,
		templates: readonly CustomFieldTemplateInfo[],
	): { template: CustomFieldTemplateInfo; row: HTMLElement }[] {
		const frame = this.buildTableFrame(
			body,
			'snowflake-method-template-table',
			[this.t('table.name'), this.t('table.description')],
			this.templateColumnClasses(),
		);
		const rows = templates.map((template) => {
			const row = frame.body.createEl('tr');
			row.createEl('td', {
				cls: 'snowflake-method-table-primary',
				text: template.name,
			});
			const textCell = row.createEl('td', { text: template.description });
			this.renderRowActions(row, textCell, {
				name: template.name,
				primaryLabel: this.t('actions.edit'),
				primary: () => {
					void this.openEditTemplate(model, kind, template);
				},
				primaryDisabled: model.readOnly,
				items: (menu) => {
					menu.addItem((item) =>
						item
							.setTitle(this.t('actions.edit'))
							.setIcon('pencil')
							.setDisabled(model.readOnly)
							.onClick(() => {
								void this.openEditTemplate(model, kind, template);
							}),
					);
					menu.addItem((item) =>
						item
							.setTitle(this.t('common.open'))
							.setIcon('file-text')
							.onClick(() => {
								void this.host.openManagedFile(template.path);
							}),
					);
				},
				remove: () => {
					void this.confirmTemplateDeletion(kind, template);
				},
				removeDisabled: model.readOnly,
			});
			return { template, row };
		});
		this.renderAddRow(
			frame.body,
			2 + (this.host.showsTableActionsColumn() ? 1 : 0),
			this.t('customFields.addMore'),
			model.readOnly,
			() => {
				void this.openCreateTemplate(model, kind);
			},
		);
		return rows;
	}

	/** The toolbar's way in: which kind first, then the same dialog. */
	private async addTemplateToKind(model: ProjectDashboardModel): Promise<void> {
		const kind = await promptForDefinitionKind(
			this.app,
			this.t,
			entityKindIds(model.worldbuildingKinds).map((candidate) => ({
				kind: candidate,
				label: this.definitionKindLabel(candidate),
			})),
		);
		if (kind === null) return;
		await this.openCreateTemplate(model, kind);
	}

	private async openCreateTemplate(
		model: ProjectDashboardModel,
		kind: EntityKindId,
	): Promise<void> {
		const result = await promptForCustomFieldTemplate(this.app, this.t, {
			title: this.t('modal.customFieldTemplate.createTitle', {
				kind: this.definitionKindLabel(kind),
			}),
			submitLabel: this.t('common.create'),
			rows: [],
			objection: (name) =>
				this.templateNameObjection(model, kind, name, null),
		});
		if (result === null) return;
		await this.runAndRefresh(async () => {
			const outcome = await this.host.saveCustomFieldTemplate(kind, result);
			if (!outcome.ok) {
				new Notice(this.templateRefusal(outcome.code, result.name));
			}
		});
	}

	private async openEditTemplate(
		model: ProjectDashboardModel,
		kind: EntityKindId,
		template: CustomFieldTemplateInfo,
	): Promise<void> {
		const fields = await this.host.customFieldTemplateFields(
			kind,
			template.name,
		);
		const result = await promptForCustomFieldTemplate(this.app, this.t, {
			title: this.t('modal.customFieldTemplate.editTitle', {
				name: template.name,
			}),
			submitLabel: this.t('common.save'),
			initial: { name: template.name, description: template.description },
			rows: [...fields],
			objection: (name) =>
				this.templateNameObjection(model, kind, name, template.name),
		});
		if (result === null) return;
		await this.runAndRefresh(async () => {
			const outcome = await this.host.saveCustomFieldTemplate(kind, result, {
				previousName: template.name,
			});
			if (!outcome.ok) {
				new Notice(this.templateRefusal(outcome.code, result.name));
			}
		});
	}

	private async confirmTemplateDeletion(
		kind: EntityKindId,
		template: CustomFieldTemplateInfo,
	): Promise<void> {
		const confirmed = await promptForTemplateDeletion(
			this.app,
			this.t,
			template.name,
		);
		if (!confirmed) return;
		await this.runAndRefresh(() =>
			this.host.deleteCustomFieldTemplate(kind, template.name),
		);
	}

	/**
	 * What is wrong with a template name right now: a spelling no file can
	 * wear, or a namesake in the kind — the one being edited excepted.
	 */
	private templateNameObjection(
		model: ProjectDashboardModel,
		kind: EntityKindId,
		name: string,
		previousName: string | null,
	): string | null {
		if (safeFileName(name) !== name) {
			return this.t('modal.customFieldTemplate.invalidName', { name });
		}
		const taken = (model.customFieldTemplates[kind] ?? []).some(
			(candidate) =>
				candidate.name !== previousName &&
				foldName(candidate.name) === foldName(name),
		);
		return taken
			? this.t('modal.customFieldTemplate.nameTaken', { name })
			: null;
	}

	private templateRefusal(code: 'invalid-name' | 'taken', name: string): string {
		return code === 'taken'
			? this.t('modal.customFieldTemplate.nameTaken', { name })
			: this.t('modal.customFieldTemplate.invalidName', { name });
	}

	/** The columns the template tables are laid by: name, sentence, actions. */
	private templateColumnClasses(): string[] {
		const columns = [
			'snowflake-method-member-column-name',
			'snowflake-method-member-column-text',
		];
		return this.host.showsTableActionsColumn()
			? [...columns, ACTIONS_COLUMN_CLASS]
			: columns;
	}

	/** Everything one entry can be asked to do, from a row or the inspector. */
	private definitionActions(
		model: ProjectDashboardModel,
		id: DefinitionFileChoice,
		kind: EntityKindId,
		node: DefinitionNodeInfo,
	): {
		locked: boolean;
		edit: () => void;
		open: () => void;
		addChild: () => void;
		create: () => void;
		remove: () => void;
	} {
		const locked = model.readOnly;
		return {
			locked,
			edit: () => {
				if (!locked) void this.openDefinitionEditor(id, kind, node);
			},
			open: () => {
				void this.host.openManagedFile(node.selfPath, 'definition-fields', [
					'definition-fields',
				]);
			},
			addChild: () => {
				void this.addDefinitionEntry(id, kind, `${node.taxonomyPath}/`);
			},
			create: () => {
				void this.runAndRefresh(async () => {
					const result = await this.host.addDefinitionPath(
						kind,
						id,
						node.taxonomyPath,
					);
					if (!result.ok) new Notice(this.definitionRefusal(result));
				});
			},
			remove: () => {
				this.confirmDefinitionDeletion(model, id, kind, node);
			},
		};
	}

	/**
	 * The menu behind a row's last button. An entry no folder spells can only
	 * be raised, so that is all it offers.
	 */
	private showDefinitionMenu(
		event: MouseEvent,
		model: ProjectDashboardModel,
		id: DefinitionFileChoice,
		kind: EntityKindId,
		node: DefinitionNodeInfo,
		anchor: HTMLElement,
	): void {
		const actions = this.definitionActions(model, id, kind, node);
		const menu = new Menu();
		menu.setParentElement(anchor);
		if (node.missing) {
			menu.addItem((item) =>
				item
					.setTitle(this.t('definition.create'))
					.setIcon('folder-plus')
					.setDisabled(actions.locked)
					.onClick(actions.create),
			);
			menu.showAtMouseEvent(event);
			return;
		}
		menu.addItem((item) =>
			item
				.setTitle(this.t('actions.edit'))
				.setIcon('pencil')
				.setDisabled(actions.locked)
				.onClick(actions.edit),
		);
		menu.addItem((item) =>
			item
				.setTitle(this.t('common.open'))
				.setIcon('file-text')
				.onClick(actions.open),
		);
		menu.addItem((item) =>
			item
				.setTitle(this.t('definition.addChild'))
				.setIcon('plus')
				.setDisabled(actions.locked || node.depth >= MAX_DEFINITION_DEPTH)
				.onClick(actions.addChild),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(this.t('actions.delete'))
				.setIcon('trash')
				.setWarning(true)
				.setDisabled(actions.locked)
				.onClick(actions.remove),
		);
		menu.showAtMouseEvent(event);
	}

	/**
	 * The other half of the pane: one entry read in full — where it sits in
	 * its tree, what it means, and which notes use it — with its name the
	 * loudest thing in the panel and everything that can be done to it either
	 * at the foot or behind the menu in the corner.
	 */
	private renderDefinitionInspector(
		container: HTMLElement,
		model: ProjectDashboardModel,
		context: DefinitionPaneContext,
	): void {
		const { id } = context;
		container.empty();
		const chosen = this.definitionSelection.get(id);
		const node =
			chosen === undefined
				? undefined
				: forestTree(model.definitions[id], chosen.kind).nodes.find(
						(candidate) => candidate.taxonomyPath === chosen.taxonomyPath,
					);
		// With nothing chosen there is nothing to frame: no panel, only the
		// invitation, standing where the panel would have been.
		container.toggleClass(
			'is-empty',
			chosen === undefined || node === undefined,
		);
		if (chosen === undefined || node === undefined) {
			container.createEl('p', {
				cls: 'snowflake-method-definition-inspector-empty',
				text: this.t('definition.inspector.empty'),
			});
			return;
		}
		const kind = chosen.kind;
		const troubles = [
			...this.memberWarnings(model, node.folderPath),
			...(node.missing ? [this.t('definition.missingEntry')] : []),
		];
		// The panel itself is the frame and holds still; everything that
		// scrolls lives in here, and reaches out past the frame's right edge
		// by the width of the scrollbar, which is what leaves the bar running
		// outside the frame without taking any of the panel's width.
		const body = container
			.createDiv({ cls: 'snowflake-method-definition-inspector-scroll' })
			.createDiv({ cls: 'snowflake-method-definition-inspector-body' });
		// One line: the name, the tag saying what kind of note it files right
		// beside it, and at the far end everything that can be done to it —
		// behind the same menu the entry's own row carries, felling included,
		// which is no button to leave lying about.
		const header = body.createDiv({
			cls: 'snowflake-method-definition-inspector-header',
		});
		this.renderTableName(
			header.createEl('h3', {
				cls: 'snowflake-method-definition-inspector-name',
			}),
			node.name,
			troubles,
		);
		header.createSpan({
			cls: 'snowflake-method-definition-inspector-kind',
			text: this.definitionKindLabel(kind),
		});
		const more = header.createEl('button', {
			cls: 'clickable-icon snowflake-method-definition-inspector-more',
			attr: {
				type: 'button',
				'aria-haspopup': 'menu',
				'aria-label': this.t('definition.options', { name: node.name }),
			},
		});
		setIcon(more, 'ellipsis');
		more.addEventListener('click', (event) => {
			this.showDefinitionMenu(event, model, id, kind, node, more);
		});
		// One part of the reading: its name, and under it what there is to say.
		// A part that can be counted says so at the end of its own line.
		const section = (label: string, count?: number): HTMLElement => {
			const block = body.createDiv({
				cls: 'snowflake-method-definition-inspector-section',
			});
			const line = block.createDiv({
				cls: 'snowflake-method-definition-inspector-label',
			});
			line.createSpan({ text: label });
			if (count !== undefined) {
				this.setCount(
					line.createSpan({
						cls:
							'snowflake-method-step-indicator snowflake-method-worldbuilding-count ' +
							'snowflake-method-definition-inspector-total',
					}),
					count,
				);
			}
			return block;
		};
		// Where the entry sits, which is what tells two entries of the same
		// name apart: read from the folders the tree is made of, never from
		// what a link happens to display. Each step above the last is a way
		// back up the branch.
		const trail = section(this.t('definition.inspector.path')).createDiv({
			cls: 'snowflake-method-definition-inspector-trail',
		});
		const segments = node.taxonomyPath.split('/');
		for (let depth = 1; depth <= segments.length; depth += 1) {
			const step = segments.slice(0, depth).join('/');
			const name = segments[depth - 1] ?? step;
			if (depth > 1) {
				// The separator every other place in the plugin writes a path
				// with, so one read here matches one read in a picker or a
				// field: A/B/C, and nothing else.
				trail.createSpan({
					cls: 'snowflake-method-definition-inspector-slash',
					text: '/',
					attr: { 'aria-hidden': 'true' },
				});
			}
			if (depth === segments.length) {
				trail.createSpan({
					cls: 'snowflake-method-definition-inspector-step is-current',
					text: name,
				});
				continue;
			}
			const jump = trail.createEl('button', {
				cls: 'snowflake-method-definition-inspector-step',
				text: name,
				attr: { type: 'button' },
			});
			setTooltip(jump, this.t('definition.inspector.goTo', { name }));
			jump.addEventListener('click', () => {
				context.reveal(kind, step);
			});
		}
		const described = section(this.t('definition.inspector.description'));
		if (node.description.length > 0) {
			described
				.createDiv({
					cls: 'snowflake-method-definition-inspector-description',
				})
				.setText(node.description);
		} else {
			// Said the way every empty list in the dashboard says it.
			this.renderDefinitionNothing(
				described,
				this.t('definition.inspector.noDescription'),
			);
		}
		this.renderDefinitionUsage(container, model, context, kind, node, section);
	}

	/**
	 * Who uses the chosen entry: how many notes in all, then the first few by
	 * name with the kind of note each is, and a way to see the rest. A note
	 * named here opens from here — that is the question this list is read to
	 * answer.
	 */
	private renderDefinitionUsage(
		panel: HTMLElement,
		model: ProjectDashboardModel,
		context: DefinitionPaneContext,
		kind: EntityKindId,
		node: DefinitionNodeInfo,
		section: (label: string, count?: number) => HTMLElement,
	): void {
		const { id } = context;
		const names = [...node.usage.listed, ...node.usage.records];
		const block = section(this.t('definition.inspector.usedBy'), names.length);
		if (names.length === 0) {
			this.renderDefinitionNothing(
				block,
				this.t('definition.inspector.unused'),
			);
			return;
		}
		// Which note a name belongs to, and what may be done to it from here,
		// so a note using this entry is reached rather than hunted for. Only
		// this kind's members can use it, and by the same name the usage was
		// gathered by — which for a scene is its title.
		const notes = new Map<
			string,
			{ path: string; locked: boolean; edit: () => void }
		>();
		const remember = (
			name: string,
			member: {
				path: string;
				readOnly: boolean;
				healthIssues: readonly { readonly blocking: boolean }[];
			},
			edit: () => void,
		): void => {
			notes.set(name, {
				path: member.path,
				// The three things that hold a member table's Edit shut hold
				// this one shut too: a form is no place to meet a damaged note.
				locked:
					model.readOnly ||
					member.readOnly ||
					member.healthIssues.some((issue) => issue.blocking),
				edit,
			});
		};
		if (kind === 'character') {
			for (const character of model.characters) {
				remember(character.name, character, () => {
					void this.openCharacterEditor(model, character);
				});
			}
		} else if (kind === 'scene') {
			for (const scene of model.scenes) {
				remember(scene.title, scene, () => {
					void this.openSceneEditor(model, scene);
				});
			}
		} else {
			for (const entity of kindEntities(model, kind)) {
				remember(entity.name, entity, () => {
					void this.openEntityEditor(model, entity);
				});
			}
		}
		const key = this.definitionCollapseKey(id, kind, node.taxonomyPath);
		const all = this.definitionUsageOpen === key;
		const shown = all ? names : names.slice(0, DEFINITION_USAGE_PREVIEW);
		// One card to a note: the mark its kind goes by in the rail, its name,
		// and what may be done to it. The card itself does nothing — it says
		// which notes use the entry, which is a reading, not an offer.
		const list = block.createDiv({
			cls: 'snowflake-method-definition-inspector-notes',
		});
		for (const name of shown) {
			const note = notes.get(name);
			// A name no note answers to is written rather than offered: there
			// is nothing to open and nothing to edit, and a dead target is
			// worse than none.
			const card = list.createDiv({
				cls: `snowflake-method-definition-inspector-note${
					note === undefined ? ' is-plain' : ''
				}`,
			});
			setIcon(
				card.createSpan({
					cls: 'snowflake-method-definition-inspector-note-icon',
					attr: { 'aria-hidden': 'true' },
				}),
				kindIcon(model, kind),
			);
			card.createSpan({
				cls: 'snowflake-method-definition-inspector-note-name',
				text: name,
			});
			// The whole name, for one the card had to cut short.
			setTooltip(card, name);
			if (note === undefined) continue;
			// Behind the same button an entry's own row carries, and holding
			// the same two things a member's row offers.
			const more = card.createEl('button', {
				cls: 'clickable-icon snowflake-method-definition-inspector-note-more',
				attr: {
					type: 'button',
					'aria-haspopup': 'menu',
					'aria-label': this.t('definition.options', { name }),
				},
			});
			setIcon(more, 'ellipsis');
			more.addEventListener('click', (event) => {
				const menu = new Menu();
				menu.setParentElement(card);
				menu.addItem((item) =>
					item
						.setTitle(this.t('common.open'))
						.setIcon('file-text')
						.onClick(() => {
							void this.host.openManagedFile(note.path);
						}),
				);
				menu.addItem((item) =>
					item
						.setTitle(this.t('actions.edit'))
						.setIcon('pencil')
						.setDisabled(note.locked)
						.onClick(note.edit),
				);
				menu.showAtMouseEvent(event);
			});
		}
		if (names.length <= DEFINITION_USAGE_PREVIEW) return;
		const toggle = block.createEl('button', {
			cls: 'snowflake-method-definition-inspector-viewall',
			attr: { type: 'button' },
		});
		toggle.createSpan({
			text: all
				? this.t('definition.inspector.showFewer')
				: this.t('definition.inspector.viewAll', { count: names.length }),
		});
		setIcon(
			toggle.createSpan({
				cls: 'snowflake-method-definition-inspector-viewall-icon',
				attr: { 'aria-hidden': 'true' },
			}),
			all ? 'chevron-up' : 'chevron-right',
		);
		toggle.addEventListener('click', () => {
			this.definitionUsageOpen = all ? null : key;
			this.renderDefinitionInspector(panel, model, context);
		});
	}

	/**
	 * Nothing there yet, said the way an empty table and an empty tree say it:
	 * the same mark, the same accent, the same short sentence.
	 */
	private renderDefinitionNothing(parent: HTMLElement, text: string): void {
		const empty = parent.createEl('p', {
			cls: 'snowflake-method-character-empty snowflake-method-definition-inspector-nothing',
		});
		const icon = empty.createSpan({
			cls: 'snowflake-method-character-empty-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, 'triangle-alert');
		empty.createSpan({ text });
	}

	/**
	 * A count in one of the rail's circles. The circle keeps its size, so the
	 * figures give way instead: three of them still read, which is as many as
	 * a vocabulary or a kind is ever counted in.
	 */
	private setCount(element: HTMLElement, value: number): void {
		const text = String(value);
		element.setText(text);
		element.dataset.digits = String(Math.min(text.length, 4));
	}

	/** The heading one kind's tree stands under. */
	private definitionKindLabel(kind: EntityKindId): string {
		if (kind === 'character' || kind === 'scene') {
			return this.t(`definition.kind.${kind}`);
		}
		return this.kindDisplayName(kind);
	}

	private definitionCollapseKey(
		id: DefinitionFileChoice,
		kind: EntityKindId,
		taxonomyPath: string,
	): string {
		return `${id}/${kind}/${taxonomyPath}`;
	}

	private definitionAncestorCollapsed(
		id: DefinitionFileChoice,
		kind: EntityKindId,
		taxonomyPath: string,
	): boolean {
		const segments = taxonomyPath.split('/');
		for (let depth = 1; depth < segments.length; depth += 1) {
			const ancestor = segments.slice(0, depth).join('/');
			if (
				this.definitionCollapse.has(
					this.definitionCollapseKey(id, kind, ancestor),
				)
			) {
				return true;
			}
		}
		return false;
	}

	/** The sentence a refused definition name is explained with. */
	private definitionRefusal(result: {
		code: 'invalid-segment' | 'too-deep' | 'taken';
		segment: string;
	}): string {
		if (result.code === 'too-deep') {
			return this.t('form.definition.tooDeep', {
				count: MAX_DEFINITION_DEPTH,
			});
		}
		if (result.code === 'taken') {
			return this.t('form.definition.taken', { name: result.segment });
		}
		return this.t('form.definition.invalid', { name: result.segment });
	}

	/**
	 * Adding from the pane rather than from a row: which kind of note the
	 * entry belongs to is asked first, because each kind keeps a vocabulary
	 * of its own and an entry has to be born into one of them.
	 */
	private async addDefinitionEntryToKind(
		model: ProjectDashboardModel,
		id: DefinitionFileChoice,
	): Promise<void> {
		const kind = await promptForDefinitionKind(
			this.app,
			this.t,
			entityKindIds(model.worldbuildingKinds).map((candidate) => ({
				kind: candidate,
				label: this.definitionKindLabel(candidate),
			})),
		);
		if (kind === null) return;
		await this.addDefinitionEntry(id, kind, '');
	}

	/** Asks for a new entry — at the root, or under the prefilled parent. */
	private async addDefinitionEntry(
		id: DefinitionFileChoice,
		kind: EntityKindId,
		prefill: string,
	): Promise<void> {
		const created = await promptForDefinitionPath(
			this.app,
			this.t,
			id,
			prefill,
		);
		if (created === null) return;
		await this.runAndRefresh(async () => {
			const result = await this.host.addDefinitionPath(
				kind,
				id,
				created.path,
				created.description,
			);
			if (!result.ok) new Notice(this.definitionRefusal(result));
		});
	}

	/**
	 * The edit dialog, and what it settled on carried out: the rename first,
	 * because it moves the node the description belongs to, and the
	 * description at whichever path the node then stands at.
	 */
	private async openDefinitionEditor(
		id: DefinitionFileChoice,
		kind: EntityKindId,
		node: DefinitionNodeInfo,
	): Promise<void> {
		const settled = await promptForDefinitionEdit(
			this.app,
			this.t,
			id,
			node.taxonomyPath,
			node.description,
		);
		if (settled === null) return;
		await this.runAndRefresh(async () => {
			let taxonomyPath = node.taxonomyPath;
			if (settled.name !== node.name) {
				const renamed = await this.host.renameDefinitionNode(
					kind,
					id,
					node.taxonomyPath,
					settled.name,
				);
				if (!renamed.ok) {
					new Notice(this.definitionRefusal(renamed));
					return;
				}
				taxonomyPath = renamed.taxonomyPath;
				// A fold keyed by the old path would fall open on the rename.
				const oldKey = this.definitionCollapseKey(
					id,
					kind,
					node.taxonomyPath,
				);
				if (this.definitionCollapse.delete(oldKey)) {
					this.definitionCollapse.add(
						this.definitionCollapseKey(id, kind, taxonomyPath),
					);
				}
				// The inspector is showing this entry; it keeps showing it under
				// the name it now has, rather than emptying out.
				const chosen = this.definitionSelection.get(id);
				if (
					chosen?.kind === kind &&
					chosen.taxonomyPath === node.taxonomyPath
				) {
					this.definitionSelection.set(id, { kind, taxonomyPath });
				}
			}
			if (settled.description !== node.description) {
				await this.host.updateDefinitionDescription(
					kind,
					id,
					taxonomyPath,
					settled.description,
				);
			}
		});
	}

	/**
	 * What deleting one node costs, gathered over its subtree the same way
	 * the deletion will fell it, then the question — and only on yes, the
	 * deletion itself.
	 */
	private confirmDefinitionDeletion(
		model: ProjectDashboardModel,
		id: DefinitionFileChoice,
		kind: EntityKindId,
		node: DefinitionNodeInfo,
	): void {
		const tree = forestTree(model.definitions[id], kind);
		const prefix = `${node.taxonomyPath}/`;
		const subtree = tree.nodes.filter(
			(candidate) =>
				candidate.taxonomyPath === node.taxonomyPath ||
				candidate.taxonomyPath.startsWith(prefix),
		);
		const listed = new Set<string>();
		const records = new Set<string>();
		for (const member of subtree) {
			for (const name of member.usage.listed) listed.add(name);
			for (const name of member.usage.records) records.add(name);
		}
		new ConfirmDefinitionDeletionModal(
			this.app,
			this.t,
			node.taxonomyPath,
			{
				nodes: subtree.filter((candidate) => !candidate.missing).length,
				listed: [...listed],
				records: [...records],
			},
			(confirmed) => {
				if (!confirmed) return;
				// Nothing left to inspect where the subtree stood.
				const chosen = this.definitionSelection.get(id);
				if (
					chosen?.kind === kind &&
					(chosen.taxonomyPath === node.taxonomyPath ||
						chosen.taxonomyPath.startsWith(prefix))
				) {
					this.definitionSelection.delete(id);
				}
				void this.runAndRefresh(() =>
					this.host.deleteDefinitionNode(kind, id, node.taxonomyPath),
				);
			},
		).open();
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
		kind: EntityKindId,
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
				kindEntities(model, 'time').filter((entity) =>
					timeKind === 'point'
						? entity.timeKind === 'point' || entity.timeKind === null
						: entity.timeKind === timeKind,
				),
			);
		// The project's own groups, registered kinds included: any group not
		// answered by name here is a kind whose notes the model already holds.
		const groupIds = entityGroupsOf(model.worldbuildingKinds);
		const entitiesOfGroup = (group: EntityGroupId): PickerOption[] => {
			if (group === 'character') return named(model.characters);
			if (group === 'scene') {
				return named(
					model.scenes.map((scene) => ({
						path: scene.path,
						name: scene.title,
					})),
				);
			}
			if (group === 'time-point') return timesOfKind('point');
			if (group === 'time-period') return timesOfKind('period');
			return named(kindEntities(model, group));
		};
		// A stored link carries no file extension, so both sides are keyed
		// without one: otherwise every reference read back from a note looks
		// like a note the project has never heard of.
		const noteKey = (path: string): string => path.replace(/\.md$/u, '');
		const groupByPath = new Map<string, EntityGroupId>();
		for (const group of groupIds) {
			for (const option of entitiesOfGroup(group)) {
				groupByPath.set(noteKey(option.value), group);
			}
		}
		const members = [
			...named(model.characters),
			...named(
				model.scenes.map((scene) => ({ path: scene.path, name: scene.title })),
			),
			...model.worldbuildingKinds.flatMap((descriptor) =>
				named(kindEntities(model, descriptor.id)),
			),
		];
		const times = named(kindEntities(model, 'time'));
		// Notes made while this form has been open. The project behind it was
		// read before they existed, so without this a note made a moment ago is
		// one the form cannot say anything about, and its line goes unnamed.
		const madeHere = new Map<string, EntityGroupId>();
		// Only the kind's own template folder speaks here: a template is made
		// in the dashboard or exported from a form, never picked at large. The
		// picker names them by note name and holds them by extensionless path.
		// Read off the freshest render, so a template exported while this very
		// form stands open joins the offer once the refresh behind it lands.
		const templateOptions = (): PickerOption[] => {
			const fresh = this.renderedModel ?? model;
			return (fresh.customFieldTemplates[kind] ?? []).map((template) => ({
				value: noteKey(template.path),
				label: template.name,
			}));
		};
		return {
			notice: (message) => {
				new Notice(message);
			},
			kindTemplates: {
				options: templateOptions,
				current: () => this.host.kindTemplatePath(kind),
				set: (path) => this.host.setKindTemplate(kind, path),
				fields: () => this.host.kindTemplateFields(kind),
				export: async (input) => {
					const outcome = await this.host.saveCustomFieldTemplate(
						kind,
						input,
						{ overwrite: true },
					);
					// The pane and the picker read the model, so a fresh export
					// joins them on the next refresh, behind the open form.
					if (outcome.ok) void this.refresh();
					return outcome;
				},
			},
			groups: () =>
				groupIds.map((id) => ({ id, label: entityGroupLabel(this.t, id) })),
			entitiesIn: (group) => entitiesOfGroup(group),
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
					customFields: '',
				});
				await this.refresh();
				return find(created.path);
			}
			const kind: WorldbuildingKindId =
				group === 'time-point' || group === 'time-period' ? 'time' : group;
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
				customFields: '',
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
				customFields: '',
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
		const kind: WorldbuildingKindId =
			group === 'time-point' || group === 'time-period' ? 'time' : group;
		const context = await this.memberFormContext(model, kind);
		const created = await promptForNewEntity(
			this.app,
			this.t,
			kind,
			kindEntities(model, kind).map((entity) => entity.name),
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

	/** Built-in kinds read from the copy; an authored kind is its own name. */
	private kindDisplayName(kind: WorldbuildingKindId): string {
		return isWorldbuildingKind(kind)
			? this.t(`worldbuilding.kind.${kind}`)
			: kind;
	}

	/** Per-kind copy: the built-ins have their own sentences, customs share one. */
	private kindText(prefix: string, kind: WorldbuildingKindId): string {
		return isWorldbuildingKind(kind)
			? this.t(`${prefix}.${kind}`)
			: this.t(`${prefix}.custom`, { name: kind });
	}

	private kindRefusal(
		code: 'invalid-name' | 'taken' | 'full',
		name: string,
	): string {
		if (code === 'full') return this.t('modal.kind.full');
		return code === 'taken'
			? this.t('modal.kind.nameTaken', { name })
			: this.t('modal.kind.invalidName', { name });
	}

	private openCreateKind(model: ProjectDashboardModel): void {
		if (model.readOnly) return;
		void promptForKindForm(this.app, this.t, {
			title: this.t('modal.kind.createTitle'),
			submitLabel: this.t('common.create'),
			objection: (name) => {
				const code = validateKindName(name, model.worldbuildingKinds);
				return code === null ? null : this.kindRefusal(code, name);
			},
		}).then(async (result) => {
			if (result === null) return;
			await this.runAndRefresh(async () => {
				const made = await this.host.createWorldbuildingKind(result.name, {
					icon: result.icon,
					description: result.description,
				});
				if (!made.ok) {
					new Notice(this.kindRefusal(made.code, result.name));
					return;
				}
				this.selectedPane = {
					kind: 'worldbuilding',
					wbKind: made.kind.id,
				};
				this.stepChosen = true;
				new Notice(this.t('messages.kindCreated', { name: made.kind.id }));
			});
		});
	}

	/**
	 * The same dialog creation opens, with everything the kind has standing:
	 * the name renames, and looks that changed are recorded under whichever
	 * name the kind ends up wearing.
	 */
	private openRenameKind(
		model: ProjectDashboardModel,
		descriptor: ProjectWorldbuildingKind,
	): void {
		if (model.readOnly) return;
		const kind = descriptor.id;
		// Keeping the kind's own name is not taking one, so the check runs
		// against every kind but this.
		const others = model.worldbuildingKinds.filter(
			(candidate) => candidate.id !== kind,
		);
		void promptForKindForm(this.app, this.t, {
			title: this.t('modal.kind.editTitle', { name: kind }),
			submitLabel: this.t('common.save'),
			initial: {
				name: kind,
				icon: descriptor.icon ?? '',
				description: descriptor.description ?? '',
			},
			objection: (name) => {
				const code = validateKindName(name, others);
				return code === null ? null : this.kindRefusal(code, name);
			},
		}).then(async (result) => {
			if (result === null) return;
			await this.runAndRefresh(async () => {
				let settledId = kind;
				if (result.name !== kind) {
					const renamed = await this.host.renameWorldbuildingKind(
						kind,
						result.name,
					);
					if (!renamed.ok) {
						new Notice(this.kindRefusal(renamed.code, result.name));
						return;
					}
					settledId = renamed.kind.id;
					if (
						this.selectedPane.kind === 'worldbuilding' &&
						this.selectedPane.wbKind === kind
					) {
						this.selectedPane = {
							kind: 'worldbuilding',
							wbKind: settledId,
						};
					}
					new Notice(this.t('messages.kindRenamed', { name: settledId }));
				}
				if (
					result.icon !== (descriptor.icon ?? '') ||
					result.description !== (descriptor.description ?? '')
				) {
					await this.host.setKindAppearance(settledId, {
						icon: result.icon,
						description: result.description,
					});
				}
			});
		});
	}

	private async confirmKindDeletion(
		model: ProjectDashboardModel,
		kind: WorldbuildingKindId,
	): Promise<void> {
		if (model.readOnly) return;
		// The pre-fetch runs before runAndRefresh's own net, and the caller
		// drops the promise, so a refusal here has to say itself or the menu
		// item would just do nothing.
		const cost = await this.host.worldbuildingKindUsage(kind).catch(
			(error: unknown) => {
				new Notice(
					error instanceof Error ? error.message : this.t('errors.unknown'),
				);
				return null;
			},
		);
		if (cost === null) return;
		const confirmed = await new Promise<boolean>((resolve) => {
			new ConfirmKindDeletionModal(
				this.app,
				this.t,
				kind,
				cost.entityCount,
				cost.usage,
				resolve,
			).open();
		});
		if (!confirmed) return;
		await this.runAndRefresh(async () => {
			await this.host.deleteWorldbuildingKind(kind);
			if (
				this.selectedPane.kind === 'worldbuilding' &&
				this.selectedPane.wbKind === kind
			) {
				this.selectedPane = { kind: 'step', step: this.selectedStep };
			}
			new Notice(this.t('messages.kindDeleted', { name: kind }));
		});
	}

	private openCreateEntity(
		model: ProjectDashboardModel,
		kind: WorldbuildingKindId,
	): void {
		void this.memberFormContext(model, kind).then((context) => {
			new EntityFormModal(
				this.app,
				this.t,
				kind,
				kindEntities(model, kind).map((entity) => entity.name),
				context,
				async (request) => {
					await this.host.createEntity(request);
					this.entityQueries.set(kind, '');
					await this.refresh();
				},
			).open();
		});
	}

	/**
	 * The character's own form, opened wherever a character is reached: from its
	 * row, and from a health report that leaves the author a decision to make.
	 */
	private openCharacterEditor(
		model: ProjectDashboardModel,
		character: CharacterViewModel,
	): Promise<Modal> {
		return this.memberFormContext(model, 'character').then((context) => {
			const form = new CreateCharacterModal(
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
					customFields: character.customFields,
					expectedRevision: character.revision,
				},
				undefined,
				context,
			);
			form.open();
			return form;
		});
	}

	private openEntityEditor(
		model: ProjectDashboardModel,
		entity: WorldbuildingEntityViewModel,
	): Promise<Modal> {
		return this.memberFormContext(model, entity.kind).then((context) => {
			const form = new EntityFormModal(
				this.app,
				this.t,
				entity.kind,
				kindEntities(model, entity.kind)
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
					customFields: entity.customFields,
					expectedRevision: entity.revision,
				},
			);
			form.open();
			return form;
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
		if (this.selectedPane.kind === 'definition') {
			this.renderDefinitionPane(layout, model, this.selectedPane.definitionId);
			return;
		}
		if (this.selectedPane.kind === 'custom-fields') {
			this.renderCustomFieldsPane(layout, model);
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
		copy.createEl('h3', { text: this.t('projectStructure.damagedTitle') });
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
			async (memberId) => {
				await this.editMemberById(memberId);
				await this.refresh();
				return this.host.checkCurrentProject();
			},
		).open();
	}

	/**
	 * Opens the form of whichever member a report row is about. Public because
	 * the same report opens from the command palette, where the plugin has the
	 * issues but not the model these forms are filled from.
	 */
	async editMemberById(memberId: string): Promise<void> {
		const model = this.renderedModel;
		if (model === undefined || model === null) return;
		const scene = model.scenes.find((candidate) => candidate.id === memberId);
		const character = model.characters.find(
			(candidate) => candidate.id === memberId,
		);
		const entity = model.worldbuildingKinds.flatMap((descriptor) =>
			kindEntities(model, descriptor.id),
		).find((candidate) => candidate.id === memberId);
		const form =
			scene !== undefined
				? await this.openSceneEditor(model, scene)
				: character !== undefined
					? await this.openCharacterEditor(model, character)
					: entity !== undefined
						? await this.openEntityEditor(model, entity)
						: null;
		if (form === null) return;
		// Whoever opened the form is still on screen behind it and wants to know
		// when it is done. A modal announces that by closing, and nothing else,
		// so its own closing is what the wait is on.
		await new Promise<void>((resolve) => {
			const closed = form.onClose.bind(form);
			form.onClose = (): void => {
				closed();
				resolve();
			};
		});
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
			damaged: boolean;
			/** What the project reports about this note, a sentence to a problem. */
			warnings: readonly string[];
			aliases: readonly string[];
			/** The member's own facts, one to a line, where its kind has any. */
			details?: readonly MemberFact[];
			progressStatus: ProgressStatus | null;
		},
	): void {
		// The name is the one thing every row shows, so it is where a row says
		// that something about its note needs looking at.
		const troubles = [
			...member.warnings,
			...(member.damaged ? [this.t('editor.managedSection.damagedTitle')] : []),
		];
		setTooltip(cell, [member.name, ...troubles].join('\n'));
		const block = cell.createDiv({ cls: 'snowflake-method-member-name-cell' });
		const line = block.createDiv({ cls: 'snowflake-method-member-name-line' });
		this.renderTableName(line, member.name, troubles);
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
			if (fact.text.length === 0) continue;
			const detail = block.createDiv({ cls: 'snowflake-method-member-detail' });
			// A fact whose note is gone has nothing left to show, so it shows that:
			// the same three marks a point of view nobody answers to gets.
			if (fact.missing) {
				const label = this.t('table.referenceMissing', { name: fact.text });
				detail.createSpan({
					cls: 'snowflake-method-table-missing-reference',
					text: MISSING_REFERENCE_TEXT,
					attr: { 'aria-label': label },
				});
				setTooltip(detail, label);
				continue;
			}
			detail.setText(fact.text);
			setTooltip(detail, fact.text);
		}
		// A line on every row of every table, and one the note's own form both
		// sets and shows: written here only where it is asked for.
		if (member.progressStatus !== null && this.host.showsTableProgressStatus()) {
			block.createDiv({
				cls:
					'snowflake-method-entity-status snowflake-method-member-status ' +
					`is-${member.progressStatus}`,
				text: this.t(`status.${member.progressStatus}`),
			});
		}
	}

	/**
	 * A name, and what the project reports about it: the warn colour and, beside
	 * it, the mark that says the same thing without asking anyone to see colour.
	 * Both belong to the name itself — a name marked in one list and only tinted
	 * in another reads as two different states of the same note.
	 */
	private renderTableName(
		cell: HTMLElement,
		name: string,
		troubles: readonly string[],
	): void {
		if (troubles.length === 0) {
			cell.createSpan({ text: name });
			return;
		}
		const reported = troubles.join('\n');
		cell.createSpan({
			cls: 'snowflake-method-table-missing-reference',
			text: name,
			attr: { 'aria-label': reported },
		});
		const warning = cell.createSpan({
			cls: 'snowflake-method-table-health-warning',
			attr: { 'aria-label': reported },
		});
		setIcon(warning, 'triangle-alert');
	}

	/**
	 * Everything a row can be asked to do, behind one button at the end of its
	 * last cell — no column of its own, and nothing on show until the row is
	 * pointed at or reached by the keyboard. The actions used to stand as
	 * buttons in a column that cost the table its widest one to say what a
	 * press says when it is asked, and left deleting a note a slip of the hand
	 * away. The menu is the one the vocabulary rows carry, so a row reads the
	 * same wherever the dashboard puts one.
	 */
	private renderRowMenu(
		cell: HTMLElement,
		name: string,
		build: (menu: Menu) => void,
	): void {
		const more = cell.createEl('button', {
			cls: 'clickable-icon snowflake-method-table-more',
			attr: {
				type: 'button',
				'aria-haspopup': 'menu',
				'aria-label': this.t('table.options', { name }),
			},
		});
		setIcon(more, 'ellipsis');
		more.addEventListener('click', (event) => {
			const menu = new Menu();
			menu.setParentElement(more);
			build(menu);
			menu.showAtMouseEvent(event);
		});
	}

	/**
	 * A row's actions, in whichever of the two shapes the author asked for: a
	 * column of buttons — the action the step is for, a menu beside it, and
	 * felling at the end — or one menu at the end of the row's last cell, which
	 * gives the table back the widest column it had. Both offer the same things;
	 * only the column keeps felling on show, which is why it is a choice.
	 */
	private renderRowActions(
		row: HTMLElement,
		textCell: HTMLElement,
		member: {
			name: string;
			/** The action the column puts on its button, first in the menu too. */
			primaryLabel: string;
			primary: () => void;
			primaryDisabled: boolean;
			/** Edit, open and ordering, in the order this step wants them. */
			items: (menu: Menu) => void;
			remove: () => void;
			removeDisabled: boolean;
		},
	): void {
		if (!this.host.showsTableActionsColumn()) {
			this.renderRowMenu(textCell, member.name, (menu) => {
				member.items(menu);
				menu.addSeparator();
				menu.addItem((item) =>
					item
						.setTitle(this.t('actions.delete'))
						.setIcon('trash')
						.setWarning(true)
						.setDisabled(member.removeDisabled)
						.onClick(member.remove),
				);
			});
			return;
		}
		const cell = row.createEl('td', {
			attr: { 'data-label': this.t('table.actions') },
		});
		const group = cell.createDiv({ cls: 'snowflake-method-table-actions' });
		const splitButton = group.createDiv({
			cls: 'snowflake-method-character-split-button',
		});
		const primary = splitButton.createEl('button', {
			cls: 'snowflake-method-character-edit',
			text: member.primaryLabel,
			attr: { type: 'button' },
		});
		primary.disabled = member.primaryDisabled;
		primary.addEventListener('click', member.primary);
		const trigger = splitButton.createEl('button', {
			cls: 'snowflake-method-character-action-menu-trigger',
			attr: {
				type: 'button',
				'aria-haspopup': 'menu',
				'aria-label': this.t('table.actions'),
			},
		});
		setIcon(
			trigger.createSpan({
				cls: 'snowflake-method-character-action-menu-icon',
			}),
			'chevron-down',
		);
		// No felling in this menu: that is the button beside it.
		trigger.addEventListener('click', (event) => {
			const menu = new Menu();
			menu.setParentElement(splitButton);
			member.items(menu);
			menu.showAtMouseEvent(event);
		});
		const remove = group.createEl('button', {
			cls: 'snowflake-method-character-delete',
			text: this.t('actions.delete'),
			attr: { type: 'button' },
		});
		remove.disabled = member.removeDisabled;
		remove.addEventListener('click', member.remove);
	}

	/** The columns a member table is laid by, the actions one where it is shown. */
	private tableColumnClasses(): string[] {
		return this.host.showsTableActionsColumn()
			? [...MEMBER_COLUMN_CLASSES, ACTIONS_COLUMN_CLASS]
			: [...MEMBER_COLUMN_CLASSES];
	}

	/**
	 * What the project reports about one note, as sentences. The rows show them
	 * on the name; the health pane shows the same sentences with what to do.
	 */
	private memberWarnings(
		model: ProjectDashboardModel,
		path: string,
	): string[] {
		return model.structureIssues
			.filter((issue) => issue.path === path)
			.map((issue) => issue.message);
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
			// Freeform mode says what the list is rather than what the step is
			// for, in a sentence of its own: cutting the step's description at
			// its line break would leave the copy at the mercy of where a
			// translator chose to wrap it.
			description.setText(
				this.freeformMode && isFreeformStep(step.id)
					? this.t(
							step.id === 7
								? 'freeform.characterDescription'
								: 'freeform.sceneDescription',
						)
					: step.description,
			);
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
		// In freeform mode the pane is not a numbered step with a status to
		// move: just the members it lists, named for what they are.
		if (this.freeformMode && isFreeformStep(step.id)) {
			title.createEl('h2', {
				text: this.t(step.id === 7 ? 'freeform.character' : 'freeform.scene'),
			});
			return;
		}
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
			const { total } = countWriting(textarea.value, {
				mode: this.host.writingCountMode(),
			});
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
		id: ProjectBaseChoice,
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
	 * One line among the project-level notices while any writable note was
	 * written by an older release — a member without its generated fields
	 * block, or any managed note still carrying an old schema stamp. It sits
	 * beside the newer-schema warning: both speak about the vault's age, one
	 * looking forward and one back. Informational, never damage: the notes
	 * keep working until their author chooses to update.
	 */
	private renderMigrationCallout(
		panel: HTMLElement,
		model: ProjectDashboardModel,
	): void {
		if (model.outdatedNotes === 0 || model.readOnly) return;
		const callout = panel.createDiv({
			cls: 'snowflake-method-repair-callout snowflake-method-migrate-callout',
			attr: { role: 'status' },
		});
		const icon = callout.createSpan({
			cls: 'snowflake-method-repair-callout-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, 'refresh-cw');
		const copy = callout.createDiv({
			cls: 'snowflake-method-repair-callout-copy',
		});
		copy.createEl('h3', { text: this.t('migrate.membersTitle') });
		copy.createEl('p', {
			text: this.t('migrate.membersCallout', {
				count: model.outdatedNotes,
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

		// The hints are the method coaching its steps; freeform mode reads the
		// pane as a plain member table and leaves them out.
		if (!this.freeformMode) {
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
			],
		);
		const reorderReadOnly =
			model.readOnly || model.characters.some((character) => character.readOnly);

		let entries: { character: CharacterViewModel; index: number }[] = [];
		const virtual = new VirtualTable({
			scroller: bodyWrap,
			body,
			columns: this.tableColumnClasses().length,
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
					this.tableColumnClasses().length,
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
				options: () => named(kindEntities(model, 'time')),
				value: this.sceneTimeFilter,
				apply: (next) => {
					this.sceneTimeFilter = next;
				},
			},
			{
				label: this.t('table.sceneLocation'),
				placeholder: this.t('table.filterAllLocations'),
				empty: '',
				options: () => named(kindEntities(model, 'location')),
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
		// The actions column is the author's choice, so it is the frame that
		// knows whether there is one: the rows fill whichever grid it lays.
		// Member tables lay the member grid; a caller with fewer columns says
		// so here.
		columnClasses: readonly string[] = this.tableColumnClasses(),
	): { headWrap: HTMLElement; bodyWrap: HTMLElement; body: HTMLElement } {
		const shown = this.host.showsTableActionsColumn()
			? [...headers, this.t('table.actions')]
			: headers;
		const wrap = panel.createDiv({ cls: 'snowflake-method-table-wrap' });
		const headWrap = wrap.createDiv({ cls: 'snowflake-method-table-head' });
		const tableClasses = `snowflake-method-table ${tableCls}${
			this.host.showsTableActionsColumn() ? ' has-actions-column' : ''
		}`;
		const headTable = headWrap.createEl('table', { cls: tableClasses });
		const bodyWrap = wrap.createDiv({ cls: 'snowflake-method-table-body' });
		const bodyTable = bodyWrap.createEl('table', { cls: tableClasses });
		for (const table of [headTable, bodyTable]) {
			const columns = table.createEl('colgroup');
			for (const cls of columnClasses) {
				columns.createEl('col', { cls });
			}
		}
		const headerRow = headTable.createEl('thead').createEl('tr');
		for (const text of shown) headerRow.createEl('th', { text });
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
			damaged: characterDamaged,
			warnings: this.memberWarnings(model, character.path),
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
		const cell = row.createEl('td', {
			text: character.oneSentenceStoryline,
			attr: { 'data-label': this.t('table.oneSentenceStoryline') },
		});
		const editCharacter = (): void => {
			if (model.readOnly || character.readOnly || characterDamaged) return;
			void this.openCharacterEditor(model, character);
		};
		const openCharacter = (): void => {
			void this.host.openManagedFile(
				character.path,
				primaryManagedSectionForStep(step) ?? undefined,
				managedSectionHighlightsForStep(step),
			);
		};
		// On the steps written in the note itself, opening it is the work, so
		// that is the action the column offers and the menu leads with. In
		// freeform mode the pane is a member table like any kind's, and a
		// table's first offer is the form.
		const opensByDefault = step === 5 || (step === 7 && !this.freeformMode);
		this.renderRowActions(row, cell, {
			name: character.name,
			primaryLabel: this.t(opensByDefault ? 'common.open' : 'actions.edit'),
			primary: opensByDefault ? openCharacter : editCharacter,
			primaryDisabled:
				!opensByDefault &&
				(model.readOnly || character.readOnly || characterDamaged),
			items: (menu) => {
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
				if (opensByDefault) {
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
					insertTitle: this.t('table.insertCharacterAfter'),
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
			},
			remove: () => {
				void this.runAndRefresh(() =>
					this.host.deleteCharacter(character.id, character.revision),
				);
			},
			removeDisabled: model.readOnly || character.readOnly,
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

		// Same as the character lists: freeform mode keeps the table and
		// leaves the method's coaching out.
		if (!this.freeformMode) {
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
			['order', 'sceneName', 'scenePov', 'conflict'].map((key) =>
				this.t(`table.${key}`),
			),
		);
		const reorderReadOnly =
			model.readOnly || model.scenes.some((candidate) => candidate.readOnly);

		let entries: { scene: SceneViewModel; index: number }[] = [];
		const virtual = new VirtualTable({
			scroller: bodyWrap,
			body,
			columns: this.tableColumnClasses().length,
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
					this.tableColumnClasses().length,
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
			damaged: sceneDamaged,
			warnings: this.memberWarnings(model, scene.path),
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
				text: MISSING_REFERENCE_TEXT,
				attr: { 'aria-label': missingLabel },
			});
		} else {
			povCell.setText(scene.povName);
		}
		const textCell = row.createEl('td', {
			text: scene.conflict,
			attr: { 'data-label': this.t('table.conflict') },
		});
		const editScene = (): void => {
			if (model.readOnly || scene.readOnly || sceneDamaged) return;
			void this.openSceneEditor(model, scene);
		};
		const openScene = (): void => {
			void this.host.openManagedFile(
				scene.path,
				primaryManagedSectionForStep(step) ?? undefined,
				managedSectionHighlightsForStep(step),
			);
		};
		// The step-9 planning is written in the scene note itself, so that is the
		// step where opening it leads and editing its fields follows.
		const opensByDefault = step === 9;
		this.renderRowActions(row, textCell, {
			name: scene.title,
			primaryLabel: this.t(opensByDefault ? 'common.open' : 'actions.edit'),
			primary: opensByDefault ? openScene : editScene,
			primaryDisabled:
				!opensByDefault && (model.readOnly || scene.readOnly || sceneDamaged),
			items: (menu) => {
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
				if (opensByDefault) {
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
					insertTitle: this.t('table.insertSceneAfter'),
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
			},
			remove: () => {
				void this.runAndRefresh(() =>
					this.host.deleteScene(scene.id, scene.revision),
				);
			},
			removeDisabled: model.readOnly || scene.readOnly,
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
			insertTitle: string;
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
				.setTitle(config.insertTitle)
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
	): Promise<Modal> {
		return this.memberFormContext(model, 'scene').then((context) => {
			const form = new CreateSceneModal(
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
					customFields: scene.customFields,
					expectedRevision: scene.revision,
				},
				this.creatingCharacter(model),
				context,
			);
			form.open();
			return form;
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
