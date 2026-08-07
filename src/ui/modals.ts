import {
	App,
	Menu,
	Modal,
	Notice,
	Setting,
	TFolder,
	setIcon,
} from 'obsidian';

import {
	SCENE_POV_MULTIPLE,
	SCENE_POV_OMNISCIENT,
	addSceneCastMember,
	foldName,
	isChoosableScenePov,
	isNameTaken,
	normalizeSceneCast,
	type CharacterType,
	type SceneCharacterUsage,
} from '../domain';
import { t as translate } from '../i18n';
import {
	displayProjectRoot,
	isValidProjectRoot,
	normalizeProjectRoot,
} from '../project-root';
import type { ProjectLocale } from '../settings';
import {
	buildOptionField,
	buildOptionPicker,
	type OptionFieldConfig,
	type OptionPicker,
	type PickerOption,
} from './option-picker';
import {
	buildProjectRootField,
	type ProjectRootField,
} from './project-root-field';
import { RenderStateKeeper } from './render-state';
import { renderSnowflakeEvolution } from './snowflake-evolution';
import type { RepairReportViewModel } from './view-model';

const PROJECT_LIST_SELECTOR = '.snowflake-method-project-manager-list';
const PROJECT_MANAGER_MAIN_SELECTOR = '.snowflake-method-project-manager-main';

export type Translate = (
	key: string,
	vars?: Record<string, string | number>,
) => string;

export interface CreateProjectRequest {
	title: string;
	locale: ProjectLocale;
}

export interface ManageProjectOption {
	path: string;
	rootPath: string;
	projectId: string;
	title: string;
	readOnly: boolean;
	hasStructureIssues: boolean;
	hasMarkerIssues: boolean;
}

export interface CreateCharacterRequest {
	name: string;
	type: CharacterType;
	oneSentenceStoryline: string;
	oneParagraphStoryline: string;
	motivation: string;
	goal: string;
	conflict: string;
	growth: string;
	expectedRevision?: string;
}

export interface CharacterOption {
	path: string;
	name: string;
}

export interface CreateSceneRequest {
	title: string;
	time: string;
	location: string;
	characterPaths: string[];
	conflict: string;
	povPath: string;
	events: string;
	expectedRevision?: string;
}

type SubmitHandler<T> = (value: T) => Promise<void>;

/**
 * The rule that a name may not be one another record of its kind already
 * answers to, wired to the field holding it: an objection under the field as it
 * is typed, the field marked invalid to match, and the same objection standing
 * in the way of a submit.
 *
 * The line keeps its place whether or not it has anything to say, so answering
 * never moves the form under the author — the stylesheet holds the height, and
 * this only ever changes the words.
 *
 * Keeping the name a record already has is not taking one, so it is always
 * allowed. That is what lets a pair sharing a name from before this rule
 * existed still be edited, rather than being held to a rename first.
 */
class UniqueNameField {
	private warningEl: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;

	constructor(
		/** The names every other record of the same kind answers to. */
		private readonly taken: readonly string[],
		/** The name this record already has, or null for one being created. */
		private readonly currentName: string | null,
		/** Read late, so a form that redraws in another language re-reads it. */
		private readonly message: () => string,
	) {}

	/**
	 * Puts the objection inside the field's own row rather than after it: these
	 * forms are grids, where a line of its own would be placed as a cell and land
	 * a column's gap away from the field it is about.
	 */
	attach(row: HTMLElement, input: HTMLInputElement | null, value: string): void {
		this.inputEl = input;
		this.warningEl = row.createDiv({
			cls: 'snowflake-method-field-warning',
			attr: { role: 'alert' },
		});
		this.show(value);
	}

	/** Re-reads the field. Called on the way in and on every keystroke after. */
	show(value: string): void {
		const objection = this.objection(value);
		this.warningEl?.setText(objection ?? '');
		if (this.inputEl === null) return;
		if (objection === null) this.inputEl.removeAttribute('aria-invalid');
		else this.inputEl.setAttribute('aria-invalid', 'true');
	}

	/**
	 * What is wrong with `value`, or null when nothing is. An empty field has no
	 * objection here; the required check speaks for it, and has something more
	 * useful to say.
	 */
	objection(value: string): string | null {
		const name = value.trim();
		if (name.length === 0) return null;
		if (
			this.currentName !== null &&
			foldName(name) === foldName(this.currentName)
		) {
			return null;
		}
		return isNameTaken(this.taken, name) ? this.message() : null;
	}
}

function isCrossWindowHTMLElement(
	target: EventTarget | null,
): target is HTMLElement {
	const candidate = target as Node | null;
	return (
		candidate !== null &&
		typeof candidate.instanceOf === 'function' &&
		candidate.instanceOf(HTMLElement)
	);
}

abstract class SnowflakeFormModal<T> extends Modal {
	protected t: Translate;
	private readonly submitHandler: SubmitHandler<T>;
	private readonly submitLabelKey: string;
	private submitButton: HTMLButtonElement | null = null;

	protected constructor(
		app: App,
		t: Translate,
		title: string,
		onSubmit: SubmitHandler<T>,
		submitLabelKey = 'common.create',
	) {
		super(app);
		this.t = t;
		this.submitHandler = onSubmit;
		this.submitLabelKey = submitLabelKey;
		this.setTitle(title);
	}

	protected abstract buildForm(): void;
	protected abstract collectValue(): T | null;

	onOpen(): void {
		this.renderForm();
	}

	protected renderForm(): void {
		this.contentEl.empty();
		this.buildForm();
		const actions = this.contentEl.createDiv({
			cls: 'snowflake-method-modal-actions',
		});
		const cancel = actions.createEl('button', {
			text: this.t('common.cancel'),
		});
		cancel.addEventListener('click', () => this.close());
		this.submitButton = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t(this.submitLabelKey),
		});
		this.submitButton.addEventListener('click', () => {
			void this.submit();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		const value = this.collectValue();
		if (value === null || this.submitButton === null) return;

		this.submitButton.disabled = true;
		this.submitButton.setText(this.t('common.working'));
		try {
			await this.submitHandler(value);
			this.close();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : this.t('errors.unknown');
			new Notice(message);
			this.submitButton.disabled = false;
			this.submitButton.setText(this.t(this.submitLabelKey));
		}
	}
}

export class CreateProjectModal extends SnowflakeFormModal<CreateProjectRequest> {
	private title = '';
	private locale: ProjectLocale;
	private name: UniqueNameField;

	constructor(
		app: App,
		t: Translate,
		defaultLocale: ProjectLocale,
		/** The names the other projects under the same root already answer to. */
		private readonly takenNames: readonly string[],
		onSubmit: SubmitHandler<CreateProjectRequest>,
	) {
		super(app, t, t('modal.project.title'), onSubmit);
		this.modalEl.addClass('snowflake-method-project-modal');
		this.locale = defaultLocale;
		this.name = this.uniqueName();
	}

	/**
	 * Rebuilt with the form, because changing the language redraws it — and the
	 * old field is left holding a line that is no longer in the document.
	 */
	private uniqueName(): UniqueNameField {
		return new UniqueNameField(this.takenNames, null, () =>
			this.t('modal.project.nameTaken'),
		);
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-project-form');
		this.name = this.uniqueName();
		let inputEl: HTMLInputElement | null = null;
		const name = new Setting(this.contentEl)
			.setName(this.t('modal.project.name'))
			.addText((text) => {
				inputEl = text.inputEl;
				text
					.setPlaceholder(this.t('modal.project.namePlaceholder'))
					.setValue(this.title)
					.onChange((value) => {
						this.title = value;
						this.name.show(value);
					});
			});
		this.name.attach(name.settingEl, inputEl, this.title);

		new Setting(this.contentEl)
			.setName(this.t('modal.project.language'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('en', 'English')
					.addOption('zh-CN', '简体中文')
					.setValue(this.locale)
					.onChange((value) => {
						if (value !== 'en' && value !== 'zh-CN') return;
						this.locale = value;
						this.t = (key, vars) => translate(this.locale, key, vars);
						this.setTitle(this.t('modal.project.title'));
						this.renderForm();
					}),
			);
	}

	protected collectValue(): CreateProjectRequest | null {
		const title = this.title.trim();
		if (title.length === 0) {
			new Notice(this.t('modal.project.nameRequired'));
			return null;
		}
		const objection = this.name.objection(title);
		if (objection !== null) {
			new Notice(objection);
			return null;
		}

		return {
			title,
			locale: this.locale,
		};
	}
}

export class ManageProjectsModal extends Modal {
	private t: Translate;
	private locale: ProjectLocale;
	private projects: readonly ManageProjectOption[];
	private initialFocusFrame: number | null = null;
	private projectRootField: ProjectRootField | null = null;
	private projectRootInput: HTMLInputElement | null = null;
	private suppressProjectRootBlurCommit = false;
	private projectRootChangeId = 0;
	private initialFocusWindow: Window | null = null;
	// Changing the language, the project root, or any project rebuilds the whole
	// modal, which would otherwise send both panes back to the top.
	private readonly renderState = new RenderStateKeeper([
		PROJECT_LIST_SELECTOR,
		PROJECT_MANAGER_MAIN_SELECTOR,
	]);

	constructor(
		app: App,
		t: Translate,
		projects: readonly ManageProjectOption[],
		private readonly version: string,
		locale: ProjectLocale,
		private projectRoot: string,
		private readonly onProjectRootChange: (
			root: string,
		) => Promise<readonly ManageProjectOption[]>,
		private readonly onOpenProject: (path: string) => Promise<void>,
		private readonly onCreateProject: (locale: ProjectLocale) => void,
		private readonly onRenameProject: (
			project: ManageProjectOption,
			title: string,
		) => Promise<readonly ManageProjectOption[]>,
		private readonly onOpenProjectMetadata: (path: string) => Promise<void>,
		private readonly onTrashProject: (
			project: ManageProjectOption,
		) => Promise<readonly ManageProjectOption[] | null>,
	) {
		super(app);
		this.t = t;
		this.locale = locale;
		this.projects = projects;
		this.setTitle(t('modal.projectManager.title'));
		this.modalEl.addClass('snowflake-method-project-manager-modal');
	}

	onOpen(): void {
		this.renderManager();
		this.modalEl.tabIndex = -1;
		const modalWindow = this.modalEl.win;
		this.initialFocusWindow = modalWindow;
		this.initialFocusFrame = modalWindow.requestAnimationFrame(() => {
			this.initialFocusFrame = modalWindow.requestAnimationFrame(() => {
				this.initialFocusFrame = null;
				this.initialFocusWindow = null;
				if (!this.modalEl.isConnected) return;
				this.modalEl.focus({ preventScroll: true });
			});
		});
	}

	onClose(): void {
		if (this.initialFocusFrame !== null && this.initialFocusWindow !== null) {
			this.initialFocusWindow.cancelAnimationFrame(this.initialFocusFrame);
			this.initialFocusFrame = null;
		}
		this.initialFocusWindow = null;
		this.projectRootField?.destroy();
		this.projectRootField = null;
		this.projectRootInput = null;
		this.suppressProjectRootBlurCommit = false;
		this.contentEl.empty();
	}

	/**
	 * `resetProjectListScroll` is for a change that loads a different set of
	 * projects, where the position the reader had scrolled to no longer means
	 * anything. The settings pane beside it still keeps its place, because that is
	 * where the change was just made.
	 */
	private renderManager({ resetProjectListScroll = false } = {}): void {
		this.renderState.capture(this.contentEl);
		if (resetProjectListScroll) {
			this.renderState.resetScroll(PROJECT_LIST_SELECTOR);
		}
		this.projectRootField?.destroy();
		this.projectRootField = null;
		this.projectRootInput = null;
		this.suppressProjectRootBlurCommit = false;
		this.contentEl.empty();
		const layout = this.contentEl.createDiv({
			cls: 'snowflake-method-project-manager-layout',
		});
		const sidebar = layout.createEl('aside', {
			cls: 'snowflake-method-project-manager-sidebar',
		});
		const projectList = sidebar.createDiv({
			cls: 'snowflake-method-project-manager-list',
		});
		for (const project of this.projects) {
			const hasHealthIssues =
				project.hasStructureIssues || project.hasMarkerIssues;
			const projectRow = projectList.createDiv({
				cls: `snowflake-method-project-manager-project-row${
					hasHealthIssues ? ' has-health-issues' : ''
				}`,
			});
			const item = projectRow.createEl('button', {
				cls: 'snowflake-method-project-manager-project',
				attr: {
					type: 'button',
					title: project.title,
				},
			});
			item.createSpan({
				cls: 'snowflake-method-project-manager-project-title',
				text: project.title,
			});
			item.createSpan({
				cls: 'snowflake-method-project-manager-project-path',
				text: project.rootPath,
			});
			item.addEventListener('click', () => {
				void this.openProject(project.path, item);
			});
			if (hasHealthIssues) {
				const warning = projectRow.createSpan({
					cls: 'snowflake-method-project-manager-project-warning',
					attr: {
						'aria-label': this.t('projectHealth.needsAttention'),
						title: this.t('projectHealth.needsAttention'),
					},
				});
				setIcon(warning, 'triangle-alert');
			}
			const more = projectRow.createEl('button', {
				cls: 'clickable-icon snowflake-method-project-manager-project-more',
				attr: {
					type: 'button',
					'aria-haspopup': 'menu',
					'aria-label': this.t('modal.projectManager.projectOptions', {
						name: project.title,
					}),
				},
			});
			setIcon(more, 'ellipsis');
			more.addEventListener('click', () => {
				this.showProjectMenu(project, more);
			});
		}

		const main = layout.createEl('main', {
			cls: 'snowflake-method-project-manager-main',
		});
		const hero = main.createDiv({
			cls: 'snowflake-method-project-manager-hero',
		});
		const heroIcon = hero.createDiv({
			cls: 'snowflake-method-project-manager-icon',
			attr: { 'aria-hidden': 'true' },
		});
		renderSnowflakeEvolution(heroIcon);
		hero.createEl('h2', { text: this.t('plugin.name') });
		hero.createEl('p', {
			text: this.t('modal.projectManager.version', {
				version: this.version,
			}),
		});

		const actions = main.createDiv({
			cls: 'snowflake-method-project-manager-actions',
		});
		this.addLanguageSelector(actions);
		this.addProjectRootSelector(actions);
		this.addManagerAction(
			actions,
			this.t('modal.projectManager.createTitle'),
			this.t('modal.projectManager.createDesc'),
			this.t('common.create'),
			'circle-plus',
			true,
			async (button) => {
				button.disabled = true;
				const rootCommitted = await this.commitProjectRootInput();
				if (!rootCommitted) {
					button.disabled = false;
					return;
				}
				this.close();
				this.onCreateProject(this.locale);
			},
		);
		// Both panes are laid out by the same grid, so neither scroller settles to
		// its final height until the whole layout is built.
		this.renderState.restore(this.contentEl);
	}

	private addProjectRootSelector(container: HTMLElement): void {
		const row = container.createDiv({
			cls: 'snowflake-method-project-manager-action snowflake-method-project-manager-root',
		});
		const icon = row.createDiv({
			cls: 'snowflake-method-project-manager-action-icon snowflake-method-project-manager-root-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, 'folder-tree');
		const body = row.createDiv({
			cls: 'snowflake-method-project-manager-action-body snowflake-method-project-manager-root-body',
		});
		const copy = body.createDiv({
			cls: 'snowflake-method-project-manager-action-copy snowflake-method-project-manager-root-copy',
		});
		copy.createEl('h3', {
			text: this.t('modal.projectManager.projectRoot'),
		});
		copy.createEl('p', {
			text: this.t('modal.projectManager.projectRootDesc'),
		});
		const field = buildProjectRootField(this.app, body, {
			label: this.t('modal.projectManager.projectRoot'),
			placeholder: this.t('modal.projectManager.projectRootPlaceholder'),
			currentRoot: this.projectRoot,
			onChooseRoot: (root) => {
				void this.changeProjectRoot(root, field.inputEl);
			},
		});
		this.projectRootField = field;
		const input = field.inputEl;
		const selector = field.selectorEl;
		this.projectRootInput = input;
		const commit = (): void => {
			void this.changeProjectRoot(input.value, input);
		};
		input.addEventListener('blur', (event) => {
			const nextTarget = event.relatedTarget;
			if (
				this.suppressProjectRootBlurCommit ||
				(isCrossWindowHTMLElement(nextTarget) &&
					(nextTarget.closest(
						'.snowflake-method-project-manager-create',
					) !== null ||
						nextTarget.closest(
							'.snowflake-method-root-field-selector',
						) !== null))
			) {
				return;
			}
			commit();
		});
		input.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') return;
			event.preventDefault();
			commit();
		});
		selector.addEventListener('pointerdown', () => {
			this.suppressProjectRootBlurCommit = true;
		});
		selector.addEventListener('pointerup', () => {
			this.suppressProjectRootBlurCommit = false;
		});
		selector.addEventListener('pointercancel', () => {
			this.suppressProjectRootBlurCommit = false;
		});
	}

	private async changeProjectRoot(
		value: string,
		input: HTMLInputElement,
	): Promise<boolean> {
		if (!isValidProjectRoot(value)) {
			new Notice(this.t('modal.projectManager.projectRootInvalid'));
			input.value = displayProjectRoot(this.projectRoot);
			return false;
		}
		const root = normalizeProjectRoot(value);
		const conflictPath = this.findProjectRootFileConflict(root);
		if (conflictPath !== null) {
			new Notice(
				this.t('modal.projectManager.projectRootConflict', {
					path: conflictPath,
				}),
			);
			input.value = displayProjectRoot(this.projectRoot);
			return false;
		}
		if (root === this.projectRoot) {
			input.value = displayProjectRoot(root);
			return true;
		}

		const changeId = ++this.projectRootChangeId;
		input.disabled = true;
		try {
			const projects = await this.onProjectRootChange(root);
			if (changeId !== this.projectRootChangeId) return false;
			this.projectRoot = root;
			this.projects = projects;
			this.renderManager({ resetProjectListScroll: true });
			return true;
		} catch (error) {
			if (changeId !== this.projectRootChangeId) return false;
			new Notice(
				error instanceof Error ? error.message : this.t('errors.unknown'),
			);
			input.disabled = false;
			input.value = displayProjectRoot(this.projectRoot);
			return false;
		}
	}

	private async commitProjectRootInput(): Promise<boolean> {
		const input = this.projectRootInput;
		if (input === null) return true;
		return this.changeProjectRoot(input.value, input);
	}

	private findProjectRootFileConflict(root: string): string | null {
		let current = '';
		for (const segment of root.split('/').filter(Boolean)) {
			current = current.length > 0 ? `${current}/${segment}` : segment;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (existing !== null && !(existing instanceof TFolder)) return current;
		}
		return null;
	}

	private showProjectMenu(
		project: ManageProjectOption,
		trigger: HTMLButtonElement,
	): void {
		const menu = new Menu().setUseNativeMenu(false);
		menu.setParentElement(trigger.parentElement ?? this.contentEl);
		menu.addItem((item) =>
			item
				.setTitle(this.t('modal.projectManager.rename'))
				.setIcon('pencil')
				.setDisabled(project.readOnly)
				.onClick(() => this.openRenameProject(project)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(this.t('modal.projectManager.openMetadata'))
				.setIcon('file-text')
				.onClick(() => {
					void this.openProjectMetadata(project.path);
				}),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(this.t('modal.projectManager.trash'))
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => {
					void this.trashProject(project);
				}),
		);
		const rect = trigger.getBoundingClientRect();
		menu.showAtPosition({ x: rect.right, y: rect.bottom });
	}

	private openRenameProject(project: ManageProjectOption): void {
		new RenameProjectModal(
			this.app,
			this.t,
			project.title,
			this.projects
				.filter((candidate) => candidate.projectId !== project.projectId)
				.map((candidate) => candidate.title),
			async (title) => {
				this.projects = await this.onRenameProject(project, title);
				this.renderManager();
			},
		).open();
	}

	private async openProjectMetadata(path: string): Promise<void> {
		try {
			await this.onOpenProjectMetadata(path);
			this.close();
		} catch (error) {
			new Notice(
				error instanceof Error ? error.message : this.t('errors.unknown'),
			);
		}
	}

	private async trashProject(project: ManageProjectOption): Promise<void> {
		try {
			const projects = await this.onTrashProject(project);
			if (projects === null) return;
			this.projects = projects.filter(
				(candidate) => candidate.projectId !== project.projectId,
			);
			this.renderManager();
		} catch (error) {
			new Notice(
				error instanceof Error ? error.message : this.t('errors.unknown'),
			);
		}
	}

	private addLanguageSelector(container: HTMLElement): void {
		const row = container.createDiv({
			cls: 'snowflake-method-project-manager-action snowflake-method-project-manager-language',
		});
		const icon = row.createDiv({
			cls: 'snowflake-method-project-manager-action-icon snowflake-method-project-manager-language-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, 'languages');
		const body = row.createDiv({
			cls: 'snowflake-method-project-manager-action-body snowflake-method-project-manager-language-body',
		});
		const copy = body.createDiv({
			cls: 'snowflake-method-project-manager-action-copy',
		});
		copy.createEl('h3', {
			text: this.t('modal.projectManager.language'),
		});
		copy.createEl('p', {
			text: this.t('modal.projectManager.languageDesc'),
		});
		const control = body.createDiv({
			cls: 'snowflake-method-project-manager-language-control',
		});
		const select = control.createEl('select', {
			attr: {
				'aria-label': this.t('modal.projectManager.language'),
				title: this.t('modal.projectManager.language'),
			},
		});
		const selector = control.createSpan({
			cls: 'snowflake-method-project-manager-language-selector',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(selector, 'chevrons-up-down');
		select.createEl('option', { text: 'English', value: 'en' });
		select.createEl('option', { text: '简体中文', value: 'zh-CN' });
		select.value = this.locale;
		select.addEventListener('change', () => {
			if (select.value !== 'en' && select.value !== 'zh-CN') return;
			this.changeLanguage(select.value);
		});
	}

	private changeLanguage(locale: ProjectLocale): void {
		if (locale === this.locale) return;
		this.locale = locale;
		this.t = (key, vars) => translate(locale, key, vars);
		this.setTitle(this.t('modal.projectManager.title'));
		this.renderManager();
	}

	private async openProject(
		path: string,
		button: HTMLButtonElement,
	): Promise<void> {
		button.disabled = true;
		try {
			await this.onOpenProject(path);
			this.close();
		} catch (error) {
			new Notice(
				error instanceof Error ? error.message : this.t('errors.unknown'),
			);
			button.disabled = false;
		}
	}

	private addManagerAction(
		container: HTMLElement,
		title: string,
		description: string,
		buttonLabel: string,
		iconName: string,
		primary: boolean,
		onClick: (button: HTMLButtonElement) => void | Promise<void>,
	): void {
		const row = container.createDiv({
			cls: 'snowflake-method-project-manager-action snowflake-method-project-manager-create',
		});
		const icon = row.createDiv({
			cls: 'snowflake-method-project-manager-action-icon snowflake-method-project-manager-create-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, iconName);
		const body = row.createDiv({
			cls: 'snowflake-method-project-manager-action-body snowflake-method-project-manager-create-body',
		});
		const copy = body.createDiv({
			cls: 'snowflake-method-project-manager-action-copy',
		});
		copy.createEl('h3', { text: title });
		copy.createEl('p', { text: description });
		const button = body.createEl('button', {
			cls: primary ? 'mod-cta' : undefined,
			text: buttonLabel,
			attr: { type: 'button' },
		});
		button.addEventListener('pointerdown', () => {
			this.suppressProjectRootBlurCommit = true;
		});
		button.addEventListener('pointerup', () => {
			this.suppressProjectRootBlurCommit = false;
		});
		button.addEventListener('pointercancel', () => {
			this.suppressProjectRootBlurCommit = false;
		});
		button.addEventListener('click', () => {
			void onClick(button);
		});
	}
}

class RenameProjectModal extends SnowflakeFormModal<string> {
	private value: string;
	private readonly name: UniqueNameField;

	constructor(
		app: App,
		t: Translate,
		initialValue: string,
		/** The names the other projects under the same root already answer to. */
		takenNames: readonly string[],
		onSubmit: SubmitHandler<string>,
	) {
		super(app, t, t('modal.projectManager.renameTitle'), onSubmit, 'common.save');
		this.value = initialValue;
		this.name = new UniqueNameField(takenNames, initialValue, () =>
			this.t('modal.project.nameTaken'),
		);
		this.modalEl.addClass('snowflake-method-rename-project-modal');
	}

	protected buildForm(): void {
		// The same form the create dialog uses, so renaming a project looks like
		// naming one rather than like a different dialog that happens to ask for a
		// name; the stylesheet drops the language column it has no field for.
		this.contentEl.addClass('snowflake-method-project-form');
		let inputEl: HTMLInputElement | null = null;
		const name = new Setting(this.contentEl)
			.setName(this.t('modal.project.name'))
			.addText((text) => {
				inputEl = text.inputEl;
				text.setValue(this.value).onChange((value) => {
					this.value = value;
					this.name.show(value);
				});
			});
		this.name.attach(name.settingEl, inputEl, this.value);
	}

	protected collectValue(): string | null {
		const value = this.value.trim();
		if (value.length === 0) {
			new Notice(this.t('modal.project.nameRequired'));
			return null;
		}
		const objection = this.name.objection(value);
		if (objection !== null) {
			new Notice(objection);
			return null;
		}
		return value;
	}
}

export class CreateCharacterModal extends SnowflakeFormModal<CreateCharacterRequest> {
	private readonly value: CreateCharacterRequest;
	private readonly name: UniqueNameField;

	constructor(
		app: App,
		t: Translate,
		/**
		 * The names the project's other characters already answer to. Editing one
		 * passes every name but its own, so saving a form without touching the name
		 * is never mistaken for claiming a name that is already taken.
		 */
		takenNames: readonly string[],
		onSubmit: SubmitHandler<CreateCharacterRequest>,
		initial?: CreateCharacterRequest,
		/**
		 * Starting name for a character being created, so one typed into a scene's
		 * point-of-view or cast field carries over instead of being typed twice.
		 */
		presetName?: string,
	) {
		super(
			app,
			t,
			initial === undefined
				? t('modal.character.title')
				: t('modal.character.editTitle'),
			onSubmit,
			initial === undefined ? 'common.create' : 'common.save',
		);
		this.modalEl.addClass('snowflake-method-character-modal');
		this.name = new UniqueNameField(takenNames, initial?.name ?? null, () =>
			this.t('modal.character.nameTaken'),
		);
		this.value = initial === undefined
			? {
					name: presetName ?? '',
					type: 'major',
					oneSentenceStoryline: '',
					oneParagraphStoryline: '',
					motivation: '',
					goal: '',
					conflict: '',
					growth: '',
				}
			: { ...initial };
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-character-form');
		this.addText('name', 'modal.character.name', true);
		const characterType = new Setting(this.contentEl)
			.setName(this.t('modal.character.type'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('major', this.t('character.major'))
					.addOption('supporting', this.t('character.supporting'))
					.addOption('minor', this.t('character.minor'))
					.setValue(this.value.type)
					.onChange((value) => {
						this.value.type =
							value === 'supporting' || value === 'minor'
								? value
								: 'major';
					}),
			);
		characterType.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-character-type-setting',
		);
		this.addText('oneSentenceStoryline', 'modal.character.oneSentenceStoryline');
		this.addText('motivation', 'modal.character.motivation');
		this.addText('goal', 'modal.character.goal');
		this.addText('conflict', 'modal.character.conflict');
		this.addText('growth', 'modal.character.growth');
		this.addText('oneParagraphStoryline', 'modal.character.oneParagraphStoryline');
	}

	protected collectValue(): CreateCharacterRequest | null {
		this.value.name = this.value.name.trim();
		if (this.value.name.length === 0) {
			new Notice(this.t('modal.character.nameRequired'));
			return null;
		}
		const objection = this.name.objection(this.value.name);
		if (objection !== null) {
			// Also as a notice: the line under the field has been showing all along,
			// but a long form scrolls it out of sight, and a submit that appears to
			// do nothing is worse than one that says why.
			new Notice(objection);
			return null;
		}
		return { ...this.value };
	}

	private addText(
		key: Exclude<
			keyof CreateCharacterRequest,
			'type' | 'expectedRevision'
		>,
		label: string,
		required = false,
	): void {
		const setting = new Setting(this.contentEl).setName(
			this.t(label) + (required ? ' *' : ''),
		);
		setting.settingEl.addClass(
			'snowflake-method-character-setting',
			`snowflake-method-character-${key}-setting`,
		);
		if (key === 'name') {
			let inputEl: HTMLInputElement | null = null;
			setting.addText((text) => {
				inputEl = text.inputEl;
				text.setValue(this.value[key]).onChange((value) => {
					this.value[key] = value;
					// On every keystroke, so a name already taken is answered while the
					// author is still typing it rather than after they submit.
					this.name.show(value);
				});
			});
			// A name carried in from a scene may be taken before a key is pressed, so
			// the line starts out saying whatever it would say for what is there.
			this.name.attach(setting.settingEl, inputEl, this.value[key]);
			return;
		}
		const placeholderKey =
			key === 'oneSentenceStoryline' ||
			key === 'oneParagraphStoryline' ||
			key === 'motivation' ||
			key === 'goal' ||
			key === 'conflict' ||
			key === 'growth'
				? `modal.character.${key}Placeholder`
				: null;
		setting.addTextArea((text) => {
			text
				.setValue(this.value[key])
				.onChange((value) => {
					this.value[key] = value;
				});
			if (placeholderKey !== null) {
				text.setPlaceholder(this.t(placeholderKey));
			}
		});
	}
}

/**
 * The character form opened from a scene, which reports back what it created so
 * the field that asked for it can select it.
 */
class NewCharacterPrompt extends CreateCharacterModal {
	constructor(
		app: App,
		t: Translate,
		takenNames: readonly string[],
		presetName: string,
		onSubmit: SubmitHandler<CreateCharacterRequest>,
		private readonly settle: () => void,
	) {
		super(app, t, takenNames, onSubmit, undefined, presetName);
	}

	// Closing is the one thing both ways out of the form have in common: a
	// successful create has already run the submit handler by the time it closes,
	// and a cancel closes having created nothing.
	onClose(): void {
		super.onClose();
		this.settle();
	}
}

/**
 * Opens the character form seeded with `presetName`, resolving to the character
 * that was created or to null when the author closed it without creating one.
 */
export function promptForNewCharacter(
	app: App,
	t: Translate,
	takenNames: readonly string[],
	presetName: string,
	create: (request: CreateCharacterRequest) => Promise<CharacterOption>,
): Promise<CharacterOption | null> {
	return new Promise((resolve) => {
		const outcome: { created: CharacterOption | null } = { created: null };
		new NewCharacterPrompt(
			app,
			t,
			takenNames,
			presetName,
			async (request) => {
				outcome.created = await create(request);
			},
			() => resolve(outcome.created),
		).open();
	});
}

export class CreateSceneModal extends SnowflakeFormModal<CreateSceneRequest> {
	private readonly characters: CharacterOption[];
	private title = '';
	private time = '';
	private location = '';
	private characterPaths: string[] = [];
	private conflict = '';
	// Unset, so a new scene starts on the placeholder and the author has to say
	// whose scene it is rather than inheriting a default nobody chose.
	private povPath = '';
	private events = '';
	private expectedRevision: string | undefined;
	private readonly pickers: OptionPicker[] = [];
	private readonly name: UniqueNameField;

	constructor(
		app: App,
		t: Translate,
		characters: CharacterOption[],
		/**
		 * The titles the project's other scenes already answer to. Editing one
		 * passes every title but its own, so saving a form without touching the
		 * title is never mistaken for claiming a title that is already taken.
		 */
		takenTitles: readonly string[],
		onSubmit: SubmitHandler<CreateSceneRequest>,
		initial?: CreateSceneRequest,
		/**
		 * Creates a character the scene needs but the project lacks, reporting it
		 * back so the field can select it. Null when no character can be created
		 * from here, which leaves the fields offering only what already exists.
		 *
		 * Told which names are taken, from this modal's own list rather than the
		 * dashboard's: characters created from here are added to it as they arrive,
		 * while the view behind was drawn before any of them existed.
		 */
		private readonly onCreateCharacter:
			| ((
					name: string,
					takenNames: readonly string[],
			  ) => Promise<CharacterOption | null>)
			| null = null,
	) {
		super(
			app,
			t,
			initial === undefined ? t('modal.scene.title') : t('modal.scene.editTitle'),
			onSubmit,
			initial === undefined ? 'common.create' : 'common.save',
		);
		this.modalEl.addClass('snowflake-method-scene-modal');
		this.characters = [...characters];
		this.name = new UniqueNameField(takenTitles, initial?.title ?? null, () =>
			this.t('modal.scene.nameTaken'),
		);
		if (initial !== undefined) {
			this.title = initial.title;
			this.time = initial.time;
			this.location = initial.location;
			this.characterPaths = [...initial.characterPaths];
			this.conflict = initial.conflict;
			this.povPath = initial.povPath;
			this.events = initial.events;
			this.expectedRevision = initial.expectedRevision;
		}
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-scene-form');
		let titleEl: HTMLInputElement | null = null;
		const name = new Setting(this.contentEl)
			.setName(`${this.t('modal.scene.name')} *`)
			.addText((text) => {
				titleEl = text.inputEl;
				text.setValue(this.title).onChange((value) => {
					this.title = value;
					// On every keystroke, so a title already taken is answered while the
					// author is still typing it rather than after they submit.
					this.name.show(value);
				});
			});
		name.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-name-setting',
		);
		this.name.attach(name.settingEl, titleEl, this.title);
		const pov = new Setting(this.contentEl).setName(
			`${this.t('modal.scene.pov')} *`,
		);
		pov.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-pov-setting',
		);
		this.buildPovPicker(pov.controlEl);
		const time = new Setting(this.contentEl)
			.setName(this.t('modal.scene.time'))
			.addText((text) =>
				text
					.setPlaceholder(this.t('modal.scene.timePlaceholder'))
					.setValue(this.time)
					.onChange((value) => {
						this.time = value;
					}),
			);
		time.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-time-setting',
		);
		const location = new Setting(this.contentEl)
			.setName(this.t('modal.scene.location'))
			.addText((text) =>
				text
					.setPlaceholder(this.t('modal.scene.locationPlaceholder'))
					.setValue(this.location)
					.onChange((value) => {
						this.location = value;
					}),
			);
		location.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-location-setting',
		);
		const characters = new Setting(this.contentEl).setName(
			this.t('modal.scene.characters'),
		);
		characters.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-characters-setting',
		);
		this.buildCastPicker(characters.controlEl);
		const conflict = new Setting(this.contentEl)
			.setName(this.t('modal.scene.conflict'))
			.addTextArea((text) =>
				text
					.setPlaceholder(this.t('modal.scene.conflictPlaceholder'))
					.setValue(this.conflict)
					.onChange((value) => {
						this.conflict = value;
					}),
			);
		conflict.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-conflict-setting',
		);
		const events = new Setting(this.contentEl)
			.setName(this.t('modal.scene.events'))
			.addTextArea((text) =>
				text
					.setPlaceholder(this.t('modal.scene.eventsPlaceholder'))
					.setValue(this.events)
					.onChange((value) => {
						this.events = value;
					}),
			);
		events.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-events-setting',
		);
	}

	onClose(): void {
		for (const picker of this.pickers.splice(0)) picker.destroy();
		super.onClose();
	}

	/** The project's characters as picker options, in project order. */
	private characterOptions(): PickerOption[] {
		return this.characters.map((character) => ({
			value: character.path,
			label: character.name,
		}));
	}

	/**
	 * The create half of a field's config, or undefined when this modal was given
	 * no way to create a character.
	 */
	private creatingCharacter(): OptionFieldConfig['create'] {
		const create = this.onCreateCharacter;
		if (create === null) return undefined;
		return {
			label: (typed) => this.t('modal.scene.createCharacter', { name: typed }),
			run: async (typed) => {
				const created = await create(
					typed,
					this.characters.map((character) => character.name),
				);
				if (created === null) return null;
				// Both fields read the list through a callback, so appending here is
				// what puts the new character in front of the other one too.
				this.characters.push(created);
				return { value: created.path, label: created.name };
			},
		};
	}

	private buildPovPicker(container: HTMLElement): void {
		// A point of view naming a character since deleted has no option to select
		// it, so it must not survive the edit unchallenged: the field would show
		// nothing while still holding the old path, which then passes validation
		// and saves the broken point of view straight back. Clearing it here is
		// what makes "required" mean anything.
		const characterPaths = this.characters.map((character) => character.path);
		if (!isChoosableScenePov(this.povPath, characterPaths)) this.povPath = '';

		this.pickers.push(
			buildOptionField(this.app, container, {
				options: () => [
					{
						value: SCENE_POV_OMNISCIENT,
						label: this.t('modal.scene.povOmniscient'),
					},
					{
						value: SCENE_POV_MULTIPLE,
						label: this.t('modal.scene.povMultiple'),
					},
					...this.characterOptions(),
				],
				value: () => this.povPath,
				choose: (value) => {
					this.povPath = value;
				},
				label: this.t('modal.scene.pov'),
				placeholder: this.t('modal.scene.povChoose'),
				emptyPlaceholder: this.t('modal.scene.povChoose'),
				required: true,
				create: this.creatingCharacter(),
			}),
		);
	}

	private buildCastPicker(container: HTMLElement): void {
		const castOrder = (): string[] =>
			this.characters.map((candidate) => candidate.path);
		// A saved cast can name a character since deleted, which has no tag to show
		// and no way to remove. Drop it here rather than let it ride along unseen.
		this.characterPaths = normalizeSceneCast(castOrder(), this.characterPaths);

		this.pickers.push(
			buildOptionPicker(this.app, container, {
				options: () => this.characterOptions(),
				picked: () => this.characterPaths,
				pick: (value) => {
					this.characterPaths = addSceneCastMember(
						castOrder(),
						this.characterPaths,
						value,
					);
				},
				unpick: (value) => {
					this.characterPaths = this.characterPaths.filter(
						(candidate) => candidate !== value,
					);
				},
				label: this.t('modal.scene.characters'),
				placeholder: this.t('modal.scene.charactersPlaceholder'),
				emptyPlaceholder: this.t('modal.scene.charactersEmpty'),
				removeLabel: (label) =>
					this.t('modal.scene.removeCharacter', { name: label }),
				create: this.creatingCharacter(),
			}),
		);
	}

	protected collectValue(): CreateSceneRequest | null {
		const title = this.title.trim();
		if (title.length === 0) {
			new Notice(this.t('modal.scene.nameRequired'));
			return null;
		}
		const objection = this.name.objection(title);
		if (objection !== null) {
			// Also as a notice: the line under the field has been showing all along,
			// but a long form scrolls it out of sight, and a submit that appears to
			// do nothing is worse than one that says why.
			new Notice(objection);
			return null;
		}
		if (this.povPath.length === 0) {
			new Notice(this.t('modal.scene.povRequired'));
			return null;
		}
		return {
			title,
			time: this.time.trim(),
			location: this.location.trim(),
			characterPaths: [...this.characterPaths],
			conflict: this.conflict.trim(),
			povPath: this.povPath,
			events: this.events.trim(),
			expectedRevision: this.expectedRevision,
		};
	}
}

export class RepairReportModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private report: RepairReportViewModel,
		private readonly openFile: (
			path: string,
			sectionId: string | null,
		) => Promise<void>,
		private readonly repairItem: (
			entry: RepairReportViewModel['entries'][number],
		) => Promise<RepairReportViewModel>,
		/** Opens a scene's editor. Null when no scene editor is reachable. */
		private readonly editScene: ((sceneId: string) => Promise<void>) | null = null,
	) {
		super(app);
		this.setTitle(t('actions.repair'));
		this.modalEl.addClass('snowflake-method-repair-report-modal');
	}

	onOpen(): void {
		this.contentEl.empty();
		const healthy = this.report.entries.length === 0;
		const surface = this.contentEl.createDiv({
			cls: `snowflake-method-repair-callout snowflake-method-repair-report-surface${
				healthy ? ' is-healthy' : ' has-issues'
			}`,
			attr: { role: healthy ? 'status' : 'alert' },
		});
		const summaryIcon = surface.createSpan({
			cls: 'snowflake-method-repair-callout-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(summaryIcon, healthy ? 'circle-check' : 'triangle-alert');
		const reportCopy = surface.createDiv({
			cls: 'snowflake-method-repair-callout-copy',
		});
		const summary = reportCopy.createDiv({
			cls: 'snowflake-method-repair-report-summary',
		});
		summary.createEl('p', { text: this.report.summary });
		if (this.report.entries.length > 0) {
			const list = reportCopy.createEl('ul', {
				cls: 'snowflake-method-repair-report-list',
			});
			const entries = this.report.entries
				.map((entry, index) => ({ entry, index }))
				.sort((left, right) => {
					const leftPriority = left.entry.status === 'conflict' ? 0 : 1;
					const rightPriority = right.entry.status === 'conflict' ? 0 : 1;
					return leftPriority - rightPriority || left.index - right.index;
				})
				.map(({ entry }) => entry);
			for (const entry of entries) {
				const item = list.createEl('li', {
					cls: `snowflake-method-repair-report-item is-${entry.status}`,
					attr:
						entry.status === 'conflict'
							? { 'aria-invalid': 'true' }
							: undefined,
				});
				const copy = item.createDiv({
					cls: 'snowflake-method-repair-report-copy',
				});
				copy.createEl('strong', { text: entry.sectionLabel });
				copy.createSpan({ text: entry.message });
				// Its own line: what is wrong and what to do about it are separate
				// thoughts, and running them together wraps into an unreadable block.
				if (entry.action !== null) {
					copy.createSpan({
						cls: 'snowflake-method-repair-report-action',
						text: entry.action,
					});
				}
				copy.createEl('small', { text: entry.path });
				if (entry.repairable || entry.canOpen) {
					const itemActions = item.createDiv({
						cls: 'snowflake-method-repair-report-item-actions',
					});
					if (entry.repairable) {
						const repair = itemActions.createEl('button', {
							cls: 'mod-cta',
							text: this.t('actions.repairItem'),
							attr: { type: 'button' },
						});
						repair.addEventListener('click', () => {
							repair.disabled = true;
							void this.repairItem(entry)
								.then((report) => {
									this.report = report;
									this.onOpen();
								})
								.catch((error: unknown) => {
									repair.disabled = false;
									new Notice(
										error instanceof Error
											? error.message
											: this.t('errors.unknown'),
									);
								});
						});
					}
					// A deterministic repair is the primary action. Reaching the note is
					// reserved for issues that still require an author's judgment.
					if (!entry.canOpen || entry.repairable) continue;
					// A scene opens its editor rather than its raw Markdown: the judgment
					// these issues need is choosing a point of view, which is a field in
					// that form rather than something to hand-edit in frontmatter.
					const sceneId = entry.sceneId;
					const editScene = sceneId === null ? null : this.editScene;
					const open = itemActions.createEl('button', {
						text: this.t(
							editScene === null
								? 'editor.managedSection.openNote'
								: 'actions.edit',
						),
						attr: { type: 'button' },
					});
					open.addEventListener('click', () => {
						const reach =
							editScene !== null && sceneId !== null
								? editScene(sceneId)
								: this.openFile(entry.path, entry.sectionId);
						void reach
							.then(() => this.close())
							.catch((error: unknown) => {
								new Notice(
									error instanceof Error
										? error.message
										: this.t('errors.unknown'),
								);
							});
					});
				}
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Confirms deleting a character that scenes still reference, naming those scenes
 * first. Obsidian's own delete prompt cannot say any of this: it sees a note, not
 * a cast member, so the breakage would only surface later as unresolved links.
 */
export class ConfirmCharacterDeletionModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly characterName: string,
		private readonly usage: SceneCharacterUsage,
		private readonly onResolve: (confirmed: boolean) => void,
	) {
		super(app);
		this.setTitle(t('modal.deleteCharacter.title'));
		this.modalEl.addClass('snowflake-method-delete-character-modal');
	}

	onOpen(): void {
		this.contentEl.empty();
		const affected = new Set([
			...this.usage.pointOfView,
			...this.usage.cast,
		]).size;
		this.contentEl.createEl('p', {
			text: this.t('modal.deleteCharacter.description', {
				name: this.characterName,
				count: affected,
			}),
		});
		this.addSceneList(
			this.t('modal.deleteCharacter.povScenes'),
			this.usage.pointOfView,
			true,
		);
		this.addSceneList(
			this.t('modal.deleteCharacter.castScenes', { name: this.characterName }),
			this.usage.cast,
			false,
		);

		const actions = this.contentEl.createDiv({
			cls: 'snowflake-method-modal-actions',
		});
		const cancel = actions.createEl('button', {
			text: this.t('common.cancel'),
			attr: { type: 'button' },
		});
		cancel.addEventListener('click', () => this.close());
		const remove = actions.createEl('button', {
			cls: 'mod-warning',
			text: this.t('actions.delete'),
			attr: { type: 'button' },
		});
		remove.addEventListener('click', () => {
			this.confirmed = true;
			this.close();
		});
	}

	private addSceneList(
		label: string,
		titles: readonly string[],
		needsDecision: boolean,
	): void {
		if (titles.length === 0) return;
		const group = this.contentEl.createDiv({
			cls: `snowflake-method-delete-character-group${
				needsDecision ? ' needs-decision' : ''
			}`,
		});
		group.createEl('h3', { text: label });
		const list = group.createEl('ul');
		for (const title of titles) list.createEl('li', { text: title });
	}

	onClose(): void {
		this.contentEl.empty();
		// Resolves however the modal closed -- button, Escape, or the title bar --
		// so the caller is never left waiting on a dialog the author dismissed.
		this.onResolve(this.confirmed);
	}
}

export class ManagedBoundaryUnlockModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly onConfirm: () => void,
	) {
		super(app);
		this.setTitle(t('editor.managedSection.unlockConfirmTitle'));
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text: this.t('editor.managedSection.unlockConfirmDescription'),
		});
		const actions = this.contentEl.createDiv({
			cls: 'snowflake-method-modal-actions',
		});
		const cancel = actions.createEl('button', {
			text: this.t('common.cancel'),
			attr: { type: 'button' },
		});
		cancel.addEventListener('click', () => this.close());
		const unlock = actions.createEl('button', {
			cls: 'mod-warning',
			text: this.t('editor.managedSection.unlockConfirmAction'),
			attr: { type: 'button' },
		});
		unlock.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
