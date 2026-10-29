/**
 * The Story Structure view: the family of visualizations a story's scenes
 * can be looked at through, each in a tab of the strip at the top: the
 * corkboard, the freeform canvas, the timeline, the beat sheet and the
 * relationship graph. A main-area leaf that keeps its own project across dashboard switches and
 * reloads. Several projects may stand open at once: a modifier click on a
 * tab opens that visualization in a leaf of its own.
 */

import {
	ItemView,
	Keymap,
	Notice,
	Scope,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import type {
	BeatSheetBridge,
	BeatSheetControls,
	BeatSheetHandle,
	RenderBeatSheet,
} from './beat-sheet-bridge';
import type {
	CorkboardControls,
	CorkboardHandle,
	RenderCorkboard,
} from './corkboard-bridge';
import { keepEscapeInView } from './escape-key';
import { FilterPanel } from './filter-panel';
import type {
	FreeformBridge,
	FreeformControls,
	FreeformHandle,
	RenderFreeform,
} from './freeform-bridge';
import type { MountFreeformCanvas } from './freeform-canvas-port';
import type { Translate } from './modals';
import { renderNoticePane, renderTabStrip } from './pane-parts';
import type {
	RelationshipGraphBridge,
	RelationshipGraphControls,
	RelationshipGraphHandle,
	RenderRelationshipGraph,
} from './relationship-graph-bridge';
import type { MountRelationshipGraph } from './relationship-graph-port';
import { isEntityGroupField, type EntityFilters } from './entity-filters';
import { clearSceneFilters, type SceneFilters } from './scene-filters';
import {
	STORY_STRUCTURE_FAMILIES,
	beatSheetMemory,
	corkboardMemory,
	defaultStoryStructureState,
	familyVisualization,
	CORKBOARD_SCENE_VIEW,
	corkboardViewAvailable,
	defaultCorkboardViewSettings,
	entityCorkboardMemory,
	freeformMemory,
	isCorkboardGroupField,
	mergeStoryStructureViewState,
	namedCorkboardViews,
	readCorkboardPreferences,
	relationshipGraphMemory,
	timelineMemory,
	visualizationFamily,
	type BeatSheetMemory,
	type CorkboardGroupField,
	type CorkboardMemory,
	type CorkboardView,
	type CorkboardViewSettings,
	type CorkboardPreferences,
	type FreeformMemory,
	type RelationshipGraphMemory,
	type StoryStructureViewStateSnapshot,
	type StoryStructureVisualization,
	type TimelineMemory,
} from './story-structure-state';
import type {
	RenderTimeline,
	TimelineBridge,
	TimelineControls,
	TimelineHandle,
} from './timeline-bridge';
import type { DashboardHost, ProjectDashboardModel } from './view-model';

export const STORY_STRUCTURE_VIEW_TYPE = 'snowflake-method-story-structure';

export interface StoryStructureViewDeps {
	host: DashboardHost;
	/**
	 * Global language settings, independent of the active dashboard.
	 */
	fingerprint(): string;
	recentProjectPath(): string | null;
	/** A project's defaults for a view of the board; the scene view's where none is named. */
	corkboardPreferences(projectId: string, view?: CorkboardView): Partial<CorkboardPreferences>;
	rememberCorkboardPreferences(projectId: string, changes: Partial<CorkboardPreferences>, onlyIfMissing?: boolean, view?: CorkboardView): void;
	corkboard: RenderCorkboard;
	timeline: RenderTimeline;
	beatSheet: RenderBeatSheet;
	freeform: RenderFreeform;
	/** Raises the freeform canvas's engine, whose code is not taken until a canvas is first shown. */
	freeformCanvas: MountFreeformCanvas;
	relationshipGraph: RenderRelationshipGraph;
	relationshipGraphCanvas: MountRelationshipGraph;
	/** Remains truthful for drafts from leaves that closed before the plugin unloads. */
	unloading?(): boolean;
	/**
	 * Whether the app runs on a phone, where the workspace is not offered:
	 * a tab that opens there all the same, kept from a wider screen, says
	 * so and draws no board.
	 */
	phone?(): boolean;
}

export class SnowflakeStoryStructureView extends ItemView {
	private state: StoryStructureViewStateSnapshot = defaultStoryStructureState();
	/** The scene view's memory, which the pools of the other workspaces deal from too. */
	private readonly memory: CorkboardMemory = corkboardMemory();
	/** The view the corkboard tab shows. */
	private corkboardView: CorkboardView = CORKBOARD_SCENE_VIEW;
	/** The character and worldbuilding views' memories, each made when first shown, its settings the tab's and the project's. */
	private readonly entityMemories = new Map<CorkboardView, CorkboardMemory<EntityFilters>>();
	private model: ProjectDashboardModel | null = null;
	private board: CorkboardHandle | TimelineHandle | BeatSheetHandle | FreeformHandle | RelationshipGraphHandle | null = null;
	private readonly timelineMemory: TimelineMemory = timelineMemory();
	private readonly beatSheetMemory: BeatSheetMemory = beatSheetMemory();
	private readonly freeformMemory: FreeformMemory = freeformMemory();
	private readonly relationshipGraphMemory: RelationshipGraphMemory = relationshipGraphMemory();
	/** The timeline bridge for the project's path, remade when a rename moves it. */
	private timelineBridge: { path: string; bridge: TimelineBridge } | null = null;
	/** The beat sheet's, kept the same way. */
	private beatSheetBridge: { path: string; bridge: BeatSheetBridge } | null = null;
	/** The freeform canvas's, kept the same way. */
	private freeformBridge: { path: string; bridge: FreeformBridge } | null = null;
	/** The relationship graph's, kept the same way. */
	private relationshipGraphBridge: { path: string; bridge: RelationshipGraphBridge } | null = null;
	/** What the frame on show was built for; null while nothing is drawn. */
	private shownFrame: string | null = null;
	private shownFingerprint: string | null = null;
	private opened = false;
	private unloading = false;
	private stateDelivered = false;
	private preferencesProjectId: string | null = null;
	private restoredPreferences: Partial<CorkboardPreferences> = {};
	private refreshing = false;
	private refreshPending = false;
	private refreshRun: Promise<void> = Promise.resolve();
	private refreshQueuedWhileHidden = false;
	private readonly filterPanel: FilterPanel;
	private readonly t: Translate = (key, vars) =>
		this.deps.host.translateForProject(this.model?.locale ?? null, key, vars);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: StoryStructureViewDeps,
	) {
		super(leaf);
		this.filterPanel = new FilterPanel(this.app, this.t);
		// The app's keymap reads Mod+Enter at the window, ahead of any control
		// in the leaf; a scope of the view's own is what stands ahead of it
		// while the leaf is active, so a card's body box can save on the chord.
		this.scope = new Scope(this.app.scope);
		this.scope.register(['Mod'], 'Enter', (event) => {
			if (this.board?.saveFocusedBody() !== true) return true;
			event.preventDefault();
			return false;
		});
	}

	getViewType(): string {
		return STORY_STRUCTURE_VIEW_TYPE;
	}

	getDisplayText(): string {
		const project = this.model?.title;
		return project === undefined
			? this.t('storyStructure.title')
			: this.t(`storyStructure.titleFor.${this.state.visualization}`, {
					project,
				});
	}

	getIcon(): string {
		return 'orbit';
	}

	getState(): Record<string, unknown> {
		return { ...this.snapshot() };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const update = mergeStoryStructureViewState(this.snapshot(), state);
		const candidate =
			typeof state === 'object' && state !== null
				? (state as Record<string, unknown>)
				: {};
		// Older layouts did not store a project. Adopt their current project
		// once, after restored state arrives, and persist that ownership.
		const legacy = !this.stateDelivered &&
			typeof candidate.projectPath !== 'string' && candidate.projectPath !== null;
		if (legacy) update.state.projectPath = this.deps.recentProjectPath();
		if (
			update.state.projectPath !== this.state.projectPath &&
			(update.state.projectPath === null || this.model === null)
		) {
			this.clearCorkboardSession();
		}
		if (!this.stateDelivered || update.state.projectPath !== this.state.projectPath) {
			this.preferencesProjectId = null;
			this.restoredPreferences = {};
			// The other views' settings the tab held were the project's it showed:
			// the next starts them from what the state names, as the scene view does.
			update.state.corkboard.views = namedCorkboardViews(candidate.corkboard);
		}
		this.restoredPreferences = {
			...this.restoredPreferences,
			...readCorkboardPreferences(candidate.corkboard),
		};
		this.state = update.state;
		this.stateDelivered = true;
		this.memory.mode = update.state.corkboard.mode;
		this.memory.group = update.state.corkboard.group;
		this.memory.reversed = update.state.corkboard.reversed;
		this.corkboardView = update.state.corkboard.view;
		for (const [view, settings] of Object.entries(update.state.corkboard.views)) {
			const held = this.entityMemories.get(view);
			if (held === undefined) continue;
			held.mode = settings.mode;
			held.group = settings.group;
			held.reversed = settings.reversed;
		}
		this.timelineMemory.pool.mode = update.state.timeline.pool.mode;
		this.timelineMemory.pool.group = update.state.timeline.pool.group;
		this.timelineMemory.pool.reversed = update.state.timeline.pool.reversed;
		this.timelineMemory.poolCollapsed = update.state.timeline.poolCollapsed;
		this.timelineMemory.timeCollapsed = update.state.timeline.timeCollapsed;
		this.beatSheetMemory.pool.mode = update.state.beatSheet.pool.mode;
		this.beatSheetMemory.pool.group = update.state.beatSheet.pool.group;
		this.beatSheetMemory.pool.reversed = update.state.beatSheet.pool.reversed;
		this.beatSheetMemory.poolCollapsed = update.state.beatSheet.poolCollapsed;
		this.beatSheetMemory.beatsCollapsed = update.state.beatSheet.beatsCollapsed;
		// Every switch the layout keeps, as one, so none is left behind.
		Object.assign(this.freeformMemory, update.state.freeform);
		this.relationshipGraphMemory.view = update.state.relationshipGraph.view;
		this.relationshipGraphMemory.controlsOpen = update.state.relationshipGraph.controlsOpen;
		await super.setState(state, result);
		if (legacy) this.app.workspace.requestSaveLayout();
		// A restored leaf may open before its state arrives, so the first
		// state is drawn whether or not it moved anything.
		if (
			this.opened &&
			this.app.workspace.layoutReady &&
			(update.changed || this.shownFrame === null)
		) {
			await this.refresh();
		}
	}

	private snapshot(): StoryStructureViewStateSnapshot {
		// The scene view's memory, which the pools share, gathers by a scene field alone.
		const groupSetting = (group: string): CorkboardGroupField | '' => (isCorkboardGroupField(group) ? group : '');
		// Every other view's settings: the ones the layout named and the tab has not shown, under the ones it has.
		const views: Record<string, CorkboardViewSettings> = { ...this.state.corkboard.views };
		for (const [view, memory] of this.entityMemories) {
			views[view] = {
				mode: memory.mode,
				group: isEntityGroupField(memory.group) ? memory.group : '',
				reversed: memory.reversed,
			};
		}
		return {
			projectPath: this.state.projectPath,
			visualization: this.state.visualization,
			corkboard: {
				mode: this.memory.mode,
				group: groupSetting(this.memory.group),
				reversed: this.memory.reversed,
				view: this.corkboardView,
				views,
			},
			timeline: {
				pool: {
					mode: this.timelineMemory.pool.mode,
					group: groupSetting(this.timelineMemory.pool.group),
					reversed: this.timelineMemory.pool.reversed,
				},
				poolCollapsed: this.timelineMemory.poolCollapsed,
				timeCollapsed: this.timelineMemory.timeCollapsed,
			},
			beatSheet: {
				pool: {
					mode: this.beatSheetMemory.pool.mode,
					group: groupSetting(this.beatSheetMemory.pool.group),
					reversed: this.beatSheetMemory.pool.reversed,
				},
				poolCollapsed: this.beatSheetMemory.poolCollapsed,
				beatsCollapsed: this.beatSheetMemory.beatsCollapsed,
			},
			freeform: {
				viewId: this.freeformMemory.viewId,
				minimap: this.freeformMemory.minimap,
				snap: this.freeformMemory.snap,
				snapObjects: this.freeformMemory.snapObjects,
				readOnly: this.freeformMemory.readOnly,
			},
			relationshipGraph: {
				view: this.relationshipGraphMemory.view,
				controlsOpen: this.relationshipGraphMemory.controlsOpen,
			},
		};
	}

	private clearCorkboardSession(): void {
		this.memory.query = '';
		clearSceneFilters(this.memory.filters);
		this.memory.scrollTop = 0;
		this.entityMemories.clear();
		this.timelineMemory.pool.query = '';
		clearSceneFilters(this.timelineMemory.pool.filters);
		this.timelineMemory.pool.scrollTop = 0;
		this.timelineMemory.activeTimeline.clear();
		this.timelineMemory.stackPositions.clear();
		this.timelineMemory.scroll = { left: 0, top: 0 };
		this.beatSheetMemory.pool.query = '';
		clearSceneFilters(this.beatSheetMemory.pool.filters);
		this.beatSheetMemory.pool.scrollTop = 0;
		this.beatSheetMemory.stackPositions.clear();
		this.beatSheetMemory.scroll = { left: 0, top: 0 };
		// Which view is shown is kept: it is the saved layout's to say, and one
		// that names no view of the project standing falls back by itself.
		this.freeformMemory.viewports.clear();
		// The graph's search, focus and positions were the project's it showed.
		this.relationshipGraphMemory.query = '';
		this.relationshipGraphMemory.focus = null;
		this.relationshipGraphMemory.positions.clear();
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		this.contentEl.addClass('snowflake-method-story-structure');
		keepEscapeInView(this);
		this.registerDomEvent(this.contentEl, 'pointerdown', () => this.activateProjectContext());
		this.registerDomEvent(this.contentEl, 'focusin', () => this.activateProjectContext());
		if (this.app.workspace.layoutReady) {
			if (this.stateDelivered) await this.refresh();
		} else {
			this.app.workspace.onLayoutReady(() => {
				if (this.opened && this.stateDelivered) void this.refresh();
			});
		}
	}

	onClose(): Promise<void> {
		this.opened = false;
		this.disposeBoard();
		this.filterPanel.close();
		this.shownFrame = null;
		this.contentEl.empty();
		return Promise.resolve();
	}

	/** Owes the next reveal a refresh, for events that landed off screen. */
	queueRefreshWhenShown(): void {
		this.refreshQueuedWhileHidden = true;
	}

	onResize(): void {
		if (!this.refreshQueuedWhileHidden || !this.containerEl.isShown()) {
			this.board?.remeasure();
			return;
		}
		this.refreshQueuedWhileHidden = false;
		void this.refresh();
	}

	/** The project the frame on show speaks for, when one is. */
	projectPath(): string | null {
		return this.state.projectPath;
	}

	/** The loaded owner, for command routing when its workspace tab becomes active. */
	workspaceProjectContext(): Pick<ProjectDashboardModel, 'path' | 'locale'> | null {
		const model = this.model;
		if (model === null || model.path !== this.state.projectPath) return null;
		return { path: model.path, locale: model.locale };
	}

	private activateProjectContext(): void {
		const context = this.workspaceProjectContext();
		if (context === null) return;
		this.deps.host.activateProject(context.path, context.locale, this.deps.host.getRecentStep());
	}

	/** Reads again when the language settings have moved. */
	rerender(): void {
		if (!this.opened) return;
		if (this.deps.fingerprint() === this.shownFingerprint) return;
		if (!this.containerEl.isShown()) {
			this.queueRefreshWhenShown();
			return;
		}
		void this.refresh();
	}

	showVisualization(key: StoryStructureVisualization): void {
		if (this.state.visualization === key) return;
		this.state = { ...this.state, visualization: key };
		this.renderFrame();
		this.app.workspace.requestSaveLayout();
		this.updateHeader();
	}

	/**
	 * Reads this tab's project and draws it: the whole frame when the
	 * language, the project or the visualization has moved, else only the
	 * board's own paint. A request made while a run is in flight is drawn
	 * by that run before it settles, so awaiting it is awaiting a read that
	 * began after the request: what the board's queue of writes counts on.
	 */
	async refresh(): Promise<void> {
		if (!this.stateDelivered || this.unloading) return;
		this.refreshQueuedWhileHidden = false;
		if (this.refreshing) {
			this.refreshPending = true;
			await this.refreshRun;
			return;
		}
		let settle = (): void => undefined;
		this.refreshRun = new Promise<void>((resolve) => {
			settle = resolve;
		});
		this.refreshing = true;
		try {
			do {
				this.refreshPending = false;
				try {
					const fingerprint = this.deps.fingerprint();
					const path = this.state.projectPath;
					const model =
						path === null ? null : await this.deps.host.loadDashboardModel(path);
					if (!this.opened || this.unloading) return;
					if (path !== this.state.projectPath) {
						this.refreshPending = true;
						continue;
					}
					// A path change may only rename this project. Keep its search,
					// filters and scroll until the loaded identity tells us it changed.
					if (this.model?.projectId !== model?.projectId) {
						this.clearCorkboardSession();
					}
					this.model = model;
					// The project shown, marked on the root as the dashboard marks its
					// own, so the menu over words in a card's body knows whose they are.
					if (path === null) delete this.contentEl.dataset.snowflakeProject;
					else this.contentEl.dataset.snowflakeProject = path;
					if (model !== null) this.restoreCorkboardPreferences(model.projectId);
					// A view of a kind the project no longer has falls back to the scenes, here where the model is known.
					if (model !== null && !corkboardViewAvailable(this.corkboardView, model.worldbuildingKinds)) {
						this.corkboardView = CORKBOARD_SCENE_VIEW;
						this.app.workspace.requestSaveLayout();
					}
					this.shownFingerprint = fingerprint;
					if (this.frameKey() !== this.shownFrame) {
						this.renderFrame();
					} else {
						this.board?.refresh();
					}
				} catch (error) {
					this.renderError(error);
				}
			} while (this.refreshPending);
		} finally {
			this.refreshing = false;
			settle();
		}
		this.updateHeader();
	}

	private restoreCorkboardPreferences(projectId: string): void {
		if (this.preferencesProjectId === projectId) return;
		const saved = this.deps.corkboardPreferences(projectId);
		const preferences = {
			mode: 'standard' as const,
			reversed: false,
			...saved,
			...this.restoredPreferences,
		};
		this.memory.mode = preferences.mode;
		this.memory.reversed = preferences.reversed;
		this.preferencesProjectId = projectId;
		// Existing tabs may predate project preferences. Seed only missing
		// defaults; restoring an older tab must not overwrite a newer choice.
		const missing = {
			...(saved.mode === undefined ? { mode: preferences.mode } : {}),
			...(saved.reversed === undefined ? { reversed: preferences.reversed } : {}),
		};
		if (Object.keys(missing).length > 0) {
			this.deps.rememberCorkboardPreferences(projectId, missing, true);
		}
	}

	private frameKey(): string {
		return `${this.shownFingerprint ?? ''}|${this.model?.projectId ?? ''}|${this.model?.locale ?? ''}|${this.state.visualization}|${this.corkboardView}|${this.onPhone() ? 'phone' : 'wide'}`;
	}

	/** Whether the tab stands on a phone, where it shows its note instead of a board. */
	private onPhone(): boolean {
		return this.deps.phone?.() === true;
	}

	/**
	 * Draws again after the device class flips: an iPad split to a phone's
	 * width puts the board away for the note, and widening brings it back.
	 */
	deviceClassChanged(): void {
		if (!this.opened) return;
		if (!this.containerEl.isShown()) {
			this.queueRefreshWhenShown();
			return;
		}
		void this.refresh();
	}

	/** Shows another view on the corkboard tab: the board is remade for it, its drafts settled first. */
	showCorkboardView(view: CorkboardView): void {
		if (view === this.corkboardView) return;
		this.corkboardView = view;
		this.renderFrame();
		this.app.workspace.requestSaveLayout();
	}

	/**
	 * The memory of the view shown: the scene view's own, or one made for a
	 * character or worldbuilding view when first shown, from the settings the
	 * tab's layout kept for it, else the project's own defaults for that view,
	 * else the board's. Each view keeps its own card style, grouping and
	 * direction, so a choice made on one holds on no other.
	 */
	private corkboardMemoryFor(view: CorkboardView): CorkboardMemory<SceneFilters> | CorkboardMemory<EntityFilters> {
		if (view === CORKBOARD_SCENE_VIEW) return this.memory;
		let held = this.entityMemories.get(view);
		if (held === undefined) {
			const projectId = this.model?.projectId ?? null;
			const saved = projectId === null ? {} : this.deps.corkboardPreferences(projectId, view);
			const kept = this.state.corkboard.views[view];
			const settings: CorkboardViewSettings = {
				...defaultCorkboardViewSettings(),
				...saved,
				...(kept ?? {}),
			};
			held = entityCorkboardMemory(view, settings);
			this.entityMemories.set(view, held);
			// A view the project has no defaults for yet takes the ones it opens with, as the scene view does.
			if (projectId !== null) {
				const missing = {
					...(saved.mode === undefined ? { mode: settings.mode } : {}),
					...(saved.reversed === undefined ? { reversed: settings.reversed } : {}),
				};
				if (Object.keys(missing).length > 0) this.deps.rememberCorkboardPreferences(projectId, missing, true, view);
			}
		}
		return held;
	}

	/** The peer tabs and the face the chosen visualization shows. */
	private renderFrame(): void {
		this.disposeBoard();
		this.filterPanel.close();
		const root = this.contentEl;
		root.empty();
		this.shownFrame = this.frameKey();
		if (this.onPhone()) {
			this.renderPhoneNote(root);
			return;
		}
		const family = visualizationFamily(this.state.visualization);
		const families = renderTabStrip(root, {
			label: this.t('storyStructure.family'),
			tabs: STORY_STRUCTURE_FAMILIES,
			tabLabel: (candidate) => this.t(`storyStructure.family.${candidate}`),
			choose: (candidate, event) => {
				this.choose(familyVisualization(candidate), event);
			},
		});
		families.mark(family);
		const field = root.createDiv({
			cls: 'snowflake-method-tab-panel',
			attr: { role: 'tabpanel' },
		});
		const body = field.createDiv({ cls: 'snowflake-method-tab-scroll' });
		if (this.model === null) {
			this.renderEmptyNote(body);
			return;
		}
		if (this.state.visualization === 'corkboard-ordered') {
			body.addClass('is-self-scrolling');
			const host = body.createDiv({ cls: 'snowflake-method-corkboard-host' });
			this.board = this.deps.corkboard(host, this.controls());
			return;
		}
		if (this.state.visualization === 'timeline') {
			body.addClass('is-self-scrolling');
			const host = body.createDiv({ cls: 'snowflake-method-timeline-host' });
			this.board = this.deps.timeline(host, this.timelineControls());
			return;
		}
		if (this.state.visualization === 'beat-sheet') {
			body.addClass('is-self-scrolling');
			const host = body.createDiv({ cls: 'snowflake-method-beat-sheet-host' });
			this.board = this.deps.beatSheet(host, this.beatSheetControls());
			return;
		}
		if (this.state.visualization === 'relationship-graph') {
			body.addClass('is-self-scrolling');
			const host = body.createDiv({ cls: 'snowflake-method-relationship-graph-host' });
			this.board = this.deps.relationshipGraph(host, this.relationshipGraphControls());
			return;
		}
		body.addClass('is-self-scrolling');
		const host = body.createDiv({ cls: 'snowflake-method-freeform-host' });
		this.board = this.deps.freeform(host, this.freeformControls());
	}

	/** A plain click shows the visualization here; a modifier click opens it in a leaf of its own. */
	private choose(key: StoryStructureVisualization, event: MouseEvent): void {
		if (Keymap.isModEvent(event) !== false) {
			void this.deps.host.openStoryStructure(key, {
				newTab: true,
				projectPath: this.state.projectPath,
			}).catch((error: unknown) => {
				new Notice(error instanceof Error ? error.message : this.t('errors.unknown'));
			});
			return;
		}
		this.showVisualization(key);
	}

	private controls(): CorkboardControls {
		return {
			app: this.app,
			host: this.deps.host,
			t: this.t,
			model: () => this.model,
			activateProject: () => this.activateProjectContext(),
			refresh: () => this.refresh(),
			unloading: () => this.unloading || this.deps.unloading?.() === true,
			popover: this.filterPanel.lend(),
			memory: this.corkboardMemoryFor(this.corkboardView),
			remember: (changes) => {
				// The board wrote the change on the view's own memory; the layout and the project's defaults for that view follow.
				this.app.workspace.requestSaveLayout();
				if (changes !== undefined && this.model !== null) {
					this.deps.rememberCorkboardPreferences(this.model.projectId, changes, false, this.corkboardView);
				}
			},
			views: {
				choose: (view) => {
					this.showCorkboardView(view);
				},
			},
		};
	}

	private timelineControls(): TimelineControls {
		return {
			app: this.app,
			host: this.deps.host,
			t: this.t,
			model: () => this.model,
			projectPath: () => this.state.projectPath,
			activateProject: () => this.activateProjectContext(),
			refresh: () => this.refresh(),
			popover: this.filterPanel.lend(),
			bridge: () => this.timelineBridgeFor(),
			memory: this.timelineMemory,
			remember: () => {
				this.app.workspace.requestSaveLayout();
			},
			corkboard: this.deps.corkboard,
			unloading: () => this.unloading || this.deps.unloading?.() === true,
		};
	}

	private beatSheetControls(): BeatSheetControls {
		return {
			app: this.app,
			host: this.deps.host,
			t: this.t,
			model: () => this.model,
			projectPath: () => this.state.projectPath,
			activateProject: () => this.activateProjectContext(),
			refresh: () => this.refresh(),
			popover: this.filterPanel.lend(),
			bridge: () => this.beatSheetBridgeFor(),
			memory: this.beatSheetMemory,
			remember: () => {
				this.app.workspace.requestSaveLayout();
			},
			corkboard: this.deps.corkboard,
			unloading: () => this.unloading || this.deps.unloading?.() === true,
		};
	}

	private freeformControls(): FreeformControls {
		return {
			app: this.app,
			host: this.deps.host,
			t: this.t,
			model: () => this.model,
			projectPath: () => this.state.projectPath,
			activateProject: () => this.activateProjectContext(),
			refresh: () => this.refresh(),
			bridge: () => this.freeformBridgeFor(),
			memory: this.freeformMemory,
			remember: () => {
				this.app.workspace.requestSaveLayout();
			},
			unloading: () => this.unloading || this.deps.unloading?.() === true,
			component: this,
			chord: (modifiers, key, listener) => {
				const scope = this.scope;
				if (scope === null) return () => undefined;
				const handler = scope.register(modifiers, key, listener);
				return () => {
					scope.unregister(handler);
				};
			},
			mountCanvas: this.deps.freeformCanvas,
			// The plugin's own window is the one its code was loaded in.
			atHome: (element) => element.win === window,
		};
	}

	private relationshipGraphControls(): RelationshipGraphControls {
		return {
			app: this.app,
			host: this.deps.host,
			t: this.t,
			model: () => this.model,
			projectPath: () => this.state.projectPath,
			activateProject: () => this.activateProjectContext(),
			refresh: () => this.refresh(),
			bridge: () => this.relationshipGraphBridgeFor(),
			canvas: this.deps.relationshipGraphCanvas,
			memory: this.relationshipGraphMemory,
			remember: () => {
				this.app.workspace.requestSaveLayout();
			},
			unloading: () => this.unloading || this.deps.unloading?.() === true,
		};
	}

	/** The relationship graph's bridge for the project's path as it stands now, remade when a rename moves it. */
	private relationshipGraphBridgeFor(): RelationshipGraphBridge {
		const path = this.state.projectPath ?? this.model?.path ?? '';
		if (this.relationshipGraphBridge === null || this.relationshipGraphBridge.path !== path) {
			this.relationshipGraphBridge = {
				path,
				bridge: this.deps.host.relationshipGraph({ projectPath: path, locale: this.model?.locale ?? null }),
			};
		}
		return this.relationshipGraphBridge.bridge;
	}

	/** The freeform canvas's bridge for the project's path as it stands now, remade when a rename moves it. */
	private freeformBridgeFor(): FreeformBridge {
		const path = this.state.projectPath ?? this.model?.path ?? '';
		if (this.freeformBridge === null || this.freeformBridge.path !== path) {
			this.freeformBridge = {
				path,
				bridge: this.deps.host.freeform({ projectPath: path, locale: this.model?.locale ?? null }),
			};
		}
		return this.freeformBridge.bridge;
	}

	/** The beat sheet's bridge for the project's path as it stands now, remade when a rename moves it. */
	private beatSheetBridgeFor(): BeatSheetBridge {
		const path = this.state.projectPath ?? this.model?.path ?? '';
		if (this.beatSheetBridge === null || this.beatSheetBridge.path !== path) {
			this.beatSheetBridge = {
				path,
				bridge: this.deps.host.beatSheet({ projectPath: path }),
			};
		}
		return this.beatSheetBridge.bridge;
	}

	/** The bridge for the project's path as it stands now; a rename hands the workspace a new one. */
	private timelineBridgeFor(): TimelineBridge {
		const path = this.state.projectPath ?? this.model?.path ?? '';
		if (this.timelineBridge === null || this.timelineBridge.path !== path) {
			this.timelineBridge = {
				path,
				bridge: this.deps.host.timeline({ projectPath: path, locale: this.model?.locale ?? null }),
			};
		}
		return this.timelineBridge.bridge;
	}

	/** Settle typed words before plugin teardown; any later refusal must remain outside a dialog. */
	settleForUnload(): void {
		this.unloading = true;
		this.disposeBoard();
		this.filterPanel.close();
	}

	private disposeBoard(): void {
		this.board?.dispose();
		this.board = null;
	}

	/**
	 * The workspace is not offered on a phone: its boards want more room
	 * than a phone's screen has, and the dashboard's tables carry the scenes
	 * and the characters there. A tab that opens on one all the same, kept
	 * from a wider screen, says so on the notice pane the Scene ↔ Manuscript
	 * tab stands on, and leads back to the dashboard from under the words.
	 */
	private renderPhoneNote(root: HTMLElement): void {
		const { actions } = renderNoticePane(root, {
			name: 'workspace-phone',
			lead: this.t('storyStructure.phone'),
		});
		const path = this.state.projectPath;
		if (path === null) return;
		const open = actions.createEl('button', {
			cls: 'mod-cta snowflake-method-workspace-phone-open',
			text: this.t('storyStructure.phoneBack'),
			attr: { type: 'button' },
		});
		open.addEventListener('click', () => {
			void this.deps.host.selectProject(path).catch((error: unknown) => {
				new Notice(error instanceof Error ? error.message : this.t('errors.unknown'));
			});
		});
	}

	/**
	 * A tab with no project says so where its board would stand, on the
	 * notice pane the Scene ↔ Manuscript tab stands on, and leads to the
	 * project manager from under the words, as the dashboard's own empty
	 * state does. The panel scrolls the pane as it scrolls a board.
	 */
	private renderEmptyNote(body: HTMLElement): void {
		body.addClass('is-self-scrolling');
		const { actions } = renderNoticePane(body, {
			name: 'workspace-empty',
			lead: this.t('storyStructure.noProject'),
		});
		const manage = actions.createEl('button', {
			cls: 'mod-cta snowflake-method-workspace-empty-manage',
			text: this.t('commands.openProjectManager'),
			attr: { type: 'button' },
		});
		manage.addEventListener('click', () => {
			void this.deps.host.openProjectManager(null).catch((error: unknown) => {
				new Notice(error instanceof Error ? error.message : this.t('errors.unknown'));
			});
		});
	}

	/**
	 * A tab whose project has no readable structure says so on the notice
	 * pane, in a frame of its own: the tabs of a board it cannot draw would
	 * only lead back here.
	 */
	private renderError(error: unknown): void {
		this.disposeBoard();
		this.filterPanel.close();
		this.shownFrame = null;
		const root = this.contentEl;
		root.empty();
		renderNoticePane(root, {
			name: 'workspace-failed',
			lead: this.t('storyStructure.loadFailed'),
		});
		console.error('Snowflake: story structure could not be loaded', error);
	}

	private updateHeader(): void {
		const leaf = this.leaf as WorkspaceLeaf & { updateHeader?: () => void };
		leaf.updateHeader?.();
		// Obsidian initializes the view title before our project is loaded;
		// updateHeader refreshes the tab label, but leaves that title unchanged.
		this.containerEl.querySelector<HTMLElement>('.view-header-title')
			?.setText(this.getDisplayText());
	}
}
