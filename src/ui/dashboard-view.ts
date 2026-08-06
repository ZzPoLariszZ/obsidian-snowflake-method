import {
	ItemView,
	Menu,
	Notice,
	setIcon,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import {
	STEP_ONE_SECTION_IDS,
	STEP_TWO_SECTION_IDS,
	areStepPrerequisitesComplete,
	countWritingLength,
	createDefaultStepStatuses,
	managedSectionHighlightsForStep,
	primaryManagedSectionForStep,
	type StepOneSectionId,
	type StepId,
	type StepStatus,
} from '../domain';
import {
	CreateCharacterModal,
	CreateProjectModal,
	CreateSceneModal,
	RepairReportModal,
	type Translate,
} from './modals';
import {
	dashboardHasHealthIssues,
	dashboardRenderContinuity,
	mergeDashboardViewState,
	shouldShowGlobalStructureIssue,
} from './dashboard-state';
import { RenderStateKeeper } from './render-state';
import { renderSnowflakeEvolution } from './snowflake-evolution';
import type {
	CreatedProject,
	DashboardHost,
	ManagedSectionIssueViewModel,
	StepFields,
	ProjectDashboardModel,
	SceneViewModel,
	StepViewModel,
} from './view-model';

export const DASHBOARD_VIEW_TYPE = 'snowflake-method-dashboard';

/**
 * Reorder drags carry a payload type of their own. `text/plain` is what every
 * other drag source in the app also writes, so a row keyed on it accepts a note
 * dragged in from the file explorer, or any selected text, as a reorder.
 */
const CHARACTER_DRAG_TYPE = 'application/x-snowflake-character';
const SCENE_DRAG_TYPE = 'application/x-snowflake-scene';

const STEP_LIST_SELECTOR = '.snowflake-method-step-list';
const MAIN_PANEL_SELECTOR = '.snowflake-method-main';
const ACTIVE_STEP_SELECTOR = '.snowflake-method-step-button.is-active';

export class SnowflakeDashboardView extends ItemView {
	private readonly host: DashboardHost;
	private readonly stepDrafts = new Map<
		string,
		{ fields: StepFields; expectedRevision: string }
	>();
	private selectedStep: StepId;
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
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		const update = mergeDashboardViewState(
			{
				projectPath: this.projectPath,
				projectTitle: this.projectTitle,
				selectedStep: this.selectedStep,
			},
			state,
		);
		this.projectPath = update.state.projectPath;
		this.projectTitle = update.state.projectTitle;
		this.selectedStep = update.state.selectedStep;
		// During workspace restoration Obsidian may open an ItemView before it
		// delivers the persisted view state. Re-rendering here prevents that first
		// paint (which uses the global recent project) from becoming permanent.
		if (this.opened && this.app.workspace.layoutReady && update.changed) {
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
		this.viewTitleIconEl?.remove();
		this.viewTitleIconEl = null;
	}

	async refresh(): Promise<void> {
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
		this.renderState.capture(this.contentEl);
		const continuity = dashboardRenderContinuity(
			{ projectId: this.renderedProjectId, step: this.renderedStep },
			{ projectId: model?.projectId ?? null, step: this.selectedStep },
		);
		if (!continuity.sameProject) this.renderState.clear();
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
		leaf.tabHeaderEl?.setAttribute('aria-label', fullTitle);
		leaf.tabHeaderEl?.setAttribute('title', fullTitle);
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
		const navHeader = nav.createDiv({ cls: 'snowflake-method-step-nav-header' });
		navHeader.createSpan({ text: this.t('dashboard.steps') });
		const list = nav.createEl('ol', { cls: 'snowflake-method-step-list' });
		for (const step of model.steps) {
			const active = step.id === this.selectedStep;
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
					title: stepTitle,
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
				void this.runAndRefresh(() => this.host.selectStep(step.id));
			});
		}

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
				title: projectSwitcherLabel,
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
		healthButton.setAttribute('aria-label', healthLabel);
		healthButton.setAttribute('title', healthLabel);
	}

	private openCreateProjectFromDashboard(): void {
		this.openCreateProject(
			this.t,
			this.projectLocale ?? this.host.getDefaultProjectLocale(),
		);
	}

	private openCreateProject(t: Translate, locale: 'en' | 'zh-CN'): void {
		new CreateProjectModal(
			this.app,
			t,
			locale,
			async (request) => {
				const project = await this.host.createProject(request);
				await this.host.selectProject(project.path);
				await this.refresh();
			},
		).open();
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

	private renderSelectedStep(
		layout: HTMLElement,
		model: ProjectDashboardModel,
	): void {
		const main = layout.createEl('main', { cls: 'snowflake-method-main' });
		const step =
			model.steps.find((candidate) => candidate.id === this.selectedStep) ??
			model.steps[0];
		if (step === undefined) return;
		this.renderedStep = step.id;

		const panel = main.createDiv({
			cls: 'snowflake-method-panel',
		});
		const projectComplete = model.steps.every(
			(candidate) =>
				candidate.status === 'complete' ||
				(candidate.optional && candidate.status === 'skipped'),
		);
		const statuses = createDefaultStepStatuses();
		for (const candidate of model.steps) {
			statuses[candidate.id] = candidate.status;
		}
		const prerequisitesComplete = areStepPrerequisitesComplete(
			statuses,
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
		).open();
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
				attr: { role: 'img', 'aria-label': label, title: label },
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
		id: 'characters' | 'scenes',
	): void {
		const openBase = actions.createEl('button', {
			cls: 'snowflake-method-open-base',
			text: this.t('actions.openBase'),
			attr: { type: 'button' },
		});
		openBase.addEventListener('click', () => {
			void this.runAndRefresh(() => this.host.openProjectBase(id));
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
		this.renderOpenBase(actions, 'characters');
		const add = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t('actions.addCharacter'),
			attr: { type: 'button' },
		});
		add.disabled = model.readOnly;
		add.addEventListener('click', () => {
			new CreateCharacterModal(this.app, this.t, async (request) => {
				await this.host.createCharacter(request);
				await this.refresh();
			}).open();
		});

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

		const wrap = panel.createDiv({ cls: 'snowflake-method-table-wrap' });
		const table = wrap.createEl('table', {
			cls: 'snowflake-method-table snowflake-method-character-table',
		});
		const columns = table.createEl('colgroup');
		for (const name of ['name', 'type', 'one-sentence-storyline', 'actions']) {
			columns.createEl('col', {
				cls: `snowflake-method-character-column-${name}`,
			});
		}
		const header = table.createEl('thead').createEl('tr');
		for (const key of ['name', 'characterType', 'oneSentenceStoryline', 'actions']) {
			header.createEl('th', {
				cls: `snowflake-method-character-header-${key}`,
				text: this.t(
					key === 'characterType'
						? 'table.characterTypeShort'
						: `table.${key}`,
				),
			});
		}
		const body = table.createEl('tbody');
		const reorderReadOnly =
			model.readOnly || model.characters.some((character) => character.readOnly);
		model.characters.forEach((character, index) => {
			const characterDamaged = character.healthIssues.some(
				(issue) => issue.blocking,
			);
			const row = body.createEl('tr', {
				attr: { draggable: reorderReadOnly ? 'false' : 'true' },
			});
			row.dataset.characterId = character.id;
			row.toggleClass('has-managed-section-issue', characterDamaged);
			const nameCell = row.createEl('td', {
				cls: 'snowflake-method-table-primary',
				attr: {
					'data-label': this.t('table.name'),
					title: character.name,
				},
			});
			nameCell.createSpan({ text: character.name });
			if (characterDamaged) {
				const warning = nameCell.createSpan({
					cls: 'snowflake-method-table-health-warning',
					attr: {
						'aria-label': this.t('editor.managedSection.damagedTitle'),
						title: this.t('editor.managedSection.damagedTitle'),
					},
				});
				setIcon(warning, 'triangle-alert');
			}
			row.createEl('td', {
				text: this.t(`character.${character.type}Short`),
				attr: { 'data-label': this.t('table.characterType') },
			});
			row.createEl('td', {
				text: character.oneSentenceStoryline,
				attr: {
					'data-label': this.t('table.oneSentenceStoryline'),
					title: character.oneSentenceStoryline,
				},
			});
			const cell = row.createEl('td', {
				attr: { 'data-label': this.t('table.actions') },
			});
			const buttonGroup = cell.createDiv({
				cls: 'snowflake-method-table-actions',
			});
			const editCharacter = (): void => {
				if (model.readOnly || character.readOnly || characterDamaged) return;
				new CreateCharacterModal(
					this.app,
					this.t,
					async (request) => {
						await this.host.updateCharacter(character.id, request);
						await this.refresh();
					},
					{
						name: character.name,
						type: character.type,
						oneSentenceStoryline: character.oneSentenceStoryline,
						oneParagraphStoryline: character.oneParagraphStoryline,
						motivation: character.motivation,
						goal: character.goal,
						conflict: character.conflict,
						growth: character.growth,
						expectedRevision: character.revision,
					},
				).open();
			};
			const openCharacter = (): void => {
				void this.host.openManagedFile(
					character.path,
					primaryManagedSectionForStep(step) ?? undefined,
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
			if (!reorderReadOnly) {
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
		});
	}

	private renderScenes(
		panel: HTMLElement,
		model: ProjectDashboardModel,
		step: 8 | 9,
	): void {
		const actions = panel.createDiv({
			cls: 'snowflake-method-actions snowflake-method-list-actions',
		});
		this.renderOpenBase(actions, 'scenes');
		const add = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t('actions.addScene'),
			attr: { type: 'button' },
		});
		add.disabled = model.readOnly;
		add.addEventListener('click', () => {
			new CreateSceneModal(
				this.app,
				this.t,
				model.characters.map((character) => ({
					path: character.path,
					name: character.name,
				})),
				async (request) => {
					await this.host.createScene(request);
					await this.refresh();
				},
			).open();
		});

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

		const wrap = panel.createDiv({ cls: 'snowflake-method-table-wrap' });
		const table = wrap.createEl('table', {
			cls: 'snowflake-method-table snowflake-method-scene-table',
		});
		const columns = table.createEl('colgroup');
		for (const name of ['order', 'name', 'pov', 'conflict', 'actions']) {
			columns.createEl('col', {
				cls: `snowflake-method-scene-column-${name}`,
			});
		}
		const header = table.createEl('thead').createEl('tr');
		for (const key of ['order', 'sceneName', 'scenePov', 'conflict', 'actions']) {
			header.createEl('th', { text: this.t(`table.${key}`) });
		}
		const body = table.createEl('tbody');
		const reorderReadOnly =
			model.readOnly || model.scenes.some((candidate) => candidate.readOnly);
		model.scenes.forEach((scene, index) => {
			this.renderSceneRow(body, scene, index, model, step, reorderReadOnly);
		});
	}

	private renderSceneRow(
		body: HTMLElement,
		scene: SceneViewModel,
		index: number,
		model: ProjectDashboardModel,
		step: 8 | 9,
		reorderReadOnly: boolean,
	): void {
		const sceneDamaged = scene.healthIssues.some((issue) => issue.blocking);
		const row = body.createEl('tr', {
			attr: { draggable: reorderReadOnly ? 'false' : 'true' },
		});
		row.dataset.sceneId = scene.id;
		row.toggleClass('has-managed-section-issue', sceneDamaged);
		row.createEl('td', {
			text: String(index + 1),
			attr: { 'data-label': this.t('table.order') },
		});
		const titleCell = row.createEl('td', {
			cls: 'snowflake-method-table-primary',
			attr: {
				'data-label': this.t('table.sceneName'),
				title: scene.title,
			},
		});
		titleCell.createSpan({ text: scene.title });
		if (sceneDamaged) {
			const warning = titleCell.createSpan({
				cls: 'snowflake-method-table-health-warning',
				attr: {
					'aria-label': this.t('editor.managedSection.damagedTitle'),
					title: this.t('editor.managedSection.damagedTitle'),
				},
			});
			setIcon(warning, 'triangle-alert');
		}
		row.createEl('td', {
			text: scene.povName,
			attr: { 'data-label': this.t('table.scenePov') },
		});
		row.createEl('td', {
			text: scene.conflict,
			attr: {
				'data-label': this.t('table.conflict'),
				title: scene.conflict,
			},
		});
		const actionCell = row.createEl('td', {
			attr: { 'data-label': this.t('table.actions') },
		});
		const buttonGroup = actionCell.createDiv({
			cls: 'snowflake-method-table-actions',
		});
		const editScene = (): void => {
			if (model.readOnly || scene.readOnly || sceneDamaged) return;
			new CreateSceneModal(
				this.app,
				this.t,
				model.characters.map((character) => ({
					path: character.path,
					name: character.name,
				})),
				async (request) => {
					await this.host.updateScene(scene.id, request);
					await this.refresh();
				},
				{
					title: scene.title,
					povPath: scene.povPath,
					time: scene.time,
					location: scene.location,
					characterPaths: scene.characterPaths,
					conflict: scene.conflict,
					events: scene.events,
					expectedRevision: scene.revision,
				},
			).open();
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

		if (!reorderReadOnly) {
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
				title: this.t('step8.hints.canvasAria'),
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
				title: this.t(labelKey),
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
