/**
 * The Story Structure view: the family of visualizations a story's scenes
 * can be looked at through, each in a tab of the strip at the top, the
 * ordered corkboard built and the rest holding their places. A main-area
 * leaf that keeps its own project across dashboard switches and reloads.
 * Several projects may stand open at once: a modifier
 * click on a tab opens that visualization in a leaf of its own.
 */

import {
	ItemView,
	Keymap,
	Scope,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import type {
	CorkboardControls,
	CorkboardHandle,
	RenderCorkboard,
} from './corkboard-bridge';
import { FilterPanel } from './filter-panel';
import type { Translate } from './modals';
import { renderTabStrip } from './pane-parts';
import {
	STORY_STRUCTURE_FAMILIES,
	corkboardMemory,
	defaultStoryStructureState,
	familyVisualization,
	mergeStoryStructureViewState,
	readCorkboardPreferences,
	visualizationFamily,
	type CorkboardMemory,
	type CorkboardPreferences,
	type StoryStructureViewStateSnapshot,
	type StoryStructureVisualization,
} from './story-structure-state';
import type { DashboardHost, ProjectDashboardModel } from './view-model';

export const STORY_STRUCTURE_VIEW_TYPE = 'snowflake-method-story-structure';

export interface StoryStructureViewDeps {
	host: DashboardHost;
	/**
	 * Global language settings, independent of the active dashboard.
	 */
	fingerprint(): string;
	recentProjectPath(): string | null;
	corkboardPreferences(projectId: string): Partial<CorkboardPreferences>;
	rememberCorkboardPreferences(projectId: string, changes: Partial<CorkboardPreferences>): void;
	corkboard: RenderCorkboard;
}

export class SnowflakeStoryStructureView extends ItemView {
	private state: StoryStructureViewStateSnapshot = defaultStoryStructureState();
	private readonly memory: CorkboardMemory = corkboardMemory();
	private model: ProjectDashboardModel | null = null;
	private board: CorkboardHandle | null = null;
	/** What the frame on show was built for; null while nothing is drawn. */
	private shownFrame: string | null = null;
	private shownFingerprint: string | null = null;
	private opened = false;
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
		// while the leaf is active, so a conflict box can save on the chord.
		this.scope = new Scope(this.app.scope);
		this.scope.register(['Mod'], 'Enter', (event) => {
			if (this.board?.saveFocusedConflict() !== true) return true;
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
		return 'layout-grid';
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
		if (!this.stateDelivered || update.state.projectPath !== this.state.projectPath) {
			this.preferencesProjectId = null;
			this.restoredPreferences = {};
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
		return {
			projectPath: this.state.projectPath,
			visualization: this.state.visualization,
			corkboard: {
				mode: this.memory.mode,
				group: this.memory.group,
				reversed: this.memory.reversed,
			},
		};
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		this.contentEl.addClass('snowflake-method-story-structure');
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

	private activateProjectContext(): void {
		const model = this.model;
		if (model === null) return;
		this.deps.host.activateProject(model.path, model.locale, this.deps.host.getRecentStep());
	}

	/** Reads again when the language settings have moved. */
	rerender(): void {
		if (!this.opened) return;
		if (this.deps.fingerprint() === this.shownFingerprint) return;
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
		if (!this.stateDelivered) return;
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
					if (!this.opened) return;
					if (path !== this.state.projectPath) {
						this.refreshPending = true;
						continue;
					}
					this.model = model;
					if (model !== null) this.restoreCorkboardPreferences(model.projectId);
					this.shownFingerprint = fingerprint;
					if (this.frameKey() !== this.shownFrame || this.board === null) {
						this.renderFrame();
					} else {
						this.board.refresh();
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
			this.deps.rememberCorkboardPreferences(projectId, missing);
		}
	}

	private frameKey(): string {
		return `${this.shownFingerprint ?? ''}|${this.model?.projectId ?? ''}|${this.model?.locale ?? ''}|${this.state.visualization}`;
	}

	/** The peer tabs and the face the chosen visualization shows. */
	private renderFrame(): void {
		this.disposeBoard();
		this.filterPanel.close();
		const root = this.contentEl;
		root.empty();
		this.shownFrame = this.frameKey();
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
			body.createEl('p', {
				cls: 'snowflake-method-tab-planned',
				text: this.t('storyStructure.noProject'),
			});
			return;
		}
		if (this.state.visualization !== 'corkboard-ordered') {
			body.createEl('p', {
				cls: 'snowflake-method-tab-planned',
				text: this.t('statistics.tab.planned'),
			});
			return;
		}
		body.addClass('is-self-scrolling');
		const host = body.createDiv({ cls: 'snowflake-method-corkboard-host' });
		this.board = this.deps.corkboard(host, this.controls());
	}

	/** A plain click shows the visualization here; a modifier click opens it in a leaf of its own. */
	private choose(key: StoryStructureVisualization, event: MouseEvent): void {
		if (Keymap.isModEvent(event) !== false) {
			void this.deps.host.openStoryStructure(key, {
				newTab: true,
				projectPath: this.state.projectPath,
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
			popover: this.filterPanel.lend(),
			memory: this.memory,
			remember: (changes) => {
				this.app.workspace.requestSaveLayout();
				if (changes !== undefined && this.model !== null) {
					this.deps.rememberCorkboardPreferences(this.model.projectId, changes);
				}
			},
		};
	}

	private disposeBoard(): void {
		this.board?.dispose();
		this.board = null;
	}

	private renderError(error: unknown): void {
		this.disposeBoard();
		this.shownFrame = null;
		const root = this.contentEl;
		root.empty();
		root.createEl('p', {
			cls: 'snowflake-method-tab-planned',
			text: `${this.t('storyStructure.loadFailed')} ${
				error instanceof Error ? error.message : ''
			}`.trim(),
		});
	}

	private updateHeader(): void {
		const leaf = this.leaf as WorkspaceLeaf & { updateHeader?: () => void };
		leaf.updateHeader?.();
	}
}
