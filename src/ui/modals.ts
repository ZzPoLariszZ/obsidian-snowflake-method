import {
	AbstractInputSuggest,
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
	type CharacterType,
} from '../domain';
import { t as translate } from '../i18n';
import {
	displayProjectRoot,
	isValidProjectRoot,
	normalizeProjectRoot,
} from '../project-root';
import type { ProjectLocale } from '../settings';
import { renderSnowflakeEvolution } from './snowflake-evolution';
import type { RepairReportViewModel } from './view-model';

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

class ProjectRootSuggest extends AbstractInputSuggest<TFolder> {
	private showAll = false;

	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		private readonly currentRoot: string,
		private readonly onChooseRoot: (root: string) => void,
	) {
		super(app, inputEl);
		this.limit = 50;
	}

	showAllSuggestions(): void {
		this.inputEl.focus({ preventScroll: true });
		this.showAll = true;
		const EventConstructor =
			this.inputEl.ownerDocument.defaultView?.Event ?? Event;
		this.inputEl.dispatchEvent(
			new EventConstructor('input', { bubbles: true }),
		);
	}

	protected getSuggestions(query: string): TFolder[] {
		const trimmedQuery = query.trim();
		const showAll = this.showAll;
		this.showAll = false;
		if (
			!showAll &&
			trimmedQuery === displayProjectRoot(this.currentRoot)
		) {
			return [];
		}
		const normalizedQuery = showAll ? '' : trimmedQuery.toLocaleLowerCase();
		// Runs on every keystroke; getAllLoadedFiles() would walk every note and
		// attachment in the Vault to arrive at the same list.
		const folders = this.app.vault.getAllFolders(true);
		const unique = new Map<string, TFolder>();
		for (const folder of folders) {
			unique.set(normalizeProjectRoot(folder.path), folder);
		}
		return [...unique.entries()]
			.filter(([path]) =>
				displayProjectRoot(path)
					.toLocaleLowerCase()
					.includes(normalizedQuery),
			)
			.sort(([left], [right]) => {
				if (left.length === 0) return -1;
				if (right.length === 0) return 1;
				return left.localeCompare(right);
			})
			.map(([, folder]) => folder);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(displayProjectRoot(folder.path));
	}

	selectSuggestion(folder: TFolder): void {
		const root = normalizeProjectRoot(folder.path);
		this.setValue(displayProjectRoot(root));
		this.close();
		this.onChooseRoot(root);
	}
}

type SubmitHandler<T> = (value: T) => Promise<void>;

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

	constructor(
		app: App,
		t: Translate,
		defaultLocale: ProjectLocale,
		onSubmit: SubmitHandler<CreateProjectRequest>,
	) {
		super(app, t, t('modal.project.title'), onSubmit);
		this.modalEl.addClass('snowflake-method-project-modal');
		this.locale = defaultLocale;
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-project-form');
		new Setting(this.contentEl)
			.setName(this.t('modal.project.name'))
			.addText((text) =>
				text
					.setPlaceholder(this.t('modal.project.namePlaceholder'))
					.setValue(this.title)
					.onChange((value) => {
						this.title = value;
					}),
			);

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
	private projectRootSuggest: ProjectRootSuggest | null = null;
	private projectRootInput: HTMLInputElement | null = null;
	private suppressProjectRootBlurCommit = false;
	private projectRootChangeId = 0;
	private initialFocusWindow: Window | null = null;

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
		this.projectRootSuggest?.close();
		this.projectRootSuggest = null;
		this.projectRootInput = null;
		this.suppressProjectRootBlurCommit = false;
		this.contentEl.empty();
	}

	private renderManager(): void {
		this.projectRootSuggest?.close();
		this.projectRootSuggest = null;
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
		const control = body.createDiv({
			cls: 'snowflake-method-project-manager-root-control',
		});
		const input = control.createEl('input', {
			type: 'text',
			value: displayProjectRoot(this.projectRoot),
			placeholder: this.t('modal.projectManager.projectRootPlaceholder'),
			attr: {
				'aria-label': this.t('modal.projectManager.projectRoot'),
				spellcheck: 'false',
			},
		});
		this.projectRootInput = input;
		const selector = control.createEl('button', {
			cls: 'clickable-icon snowflake-method-project-manager-root-selector',
			attr: {
				type: 'button',
				'aria-label': this.t('modal.projectManager.projectRoot'),
				title: this.t('modal.projectManager.projectRoot'),
			},
		});
		setIcon(selector, 'chevrons-up-down');
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
							'.snowflake-method-project-manager-root-selector',
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
		const suggest = new ProjectRootSuggest(
			this.app,
			input,
			this.projectRoot,
			(root) => {
				void this.changeProjectRoot(root, input);
			},
		);
		this.projectRootSuggest = suggest;
		selector.addEventListener('pointerdown', () => {
			this.suppressProjectRootBlurCommit = true;
		});
		selector.addEventListener('pointerup', () => {
			this.suppressProjectRootBlurCommit = false;
		});
		selector.addEventListener('pointercancel', () => {
			this.suppressProjectRootBlurCommit = false;
		});
		selector.addEventListener('click', () => {
			suggest.showAllSuggestions();
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
			this.renderManager();
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
		new RenameProjectModal(this.app, this.t, project.title, async (title) => {
			this.projects = await this.onRenameProject(project, title);
			this.renderManager();
		}).open();
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

	constructor(
		app: App,
		t: Translate,
		initialValue: string,
		onSubmit: SubmitHandler<string>,
	) {
		super(app, t, t('modal.projectManager.renameTitle'), onSubmit, 'common.save');
		this.value = initialValue;
		this.modalEl.addClass('snowflake-method-rename-project-modal');
	}

	protected buildForm(): void {
		new Setting(this.contentEl)
			.setName(this.t('modal.project.name'))
			.addText((text) =>
				text.setValue(this.value).onChange((value) => {
					this.value = value;
				}),
			);
	}

	protected collectValue(): string | null {
		const value = this.value.trim();
		if (value.length === 0) {
			new Notice(this.t('modal.project.nameRequired'));
			return null;
		}
		return value;
	}
}

export class CreateCharacterModal extends SnowflakeFormModal<CreateCharacterRequest> {
	private readonly value: CreateCharacterRequest;

	constructor(
		app: App,
		t: Translate,
		onSubmit: SubmitHandler<CreateCharacterRequest>,
		initial?: CreateCharacterRequest,
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
		this.value = initial === undefined
			? {
					name: '',
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
			setting.addText((text) =>
				text
					.setValue(this.value[key])
					.onChange((value) => {
						this.value[key] = value;
					}),
			);
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

export class CreateSceneModal extends SnowflakeFormModal<CreateSceneRequest> {
	private readonly characters: CharacterOption[];
	private title = '';
	private time = '';
	private location = '';
	private characterPaths: string[] = [];
	private conflict = '';
	private povPath = SCENE_POV_OMNISCIENT;
	private events = '';
	private expectedRevision: string | undefined;
	private characterSelectCleanup: (() => void) | null = null;

	constructor(
		app: App,
		t: Translate,
		characters: CharacterOption[],
		onSubmit: SubmitHandler<CreateSceneRequest>,
		initial?: CreateSceneRequest,
	) {
		super(
			app,
			t,
			initial === undefined ? t('modal.scene.title') : t('modal.scene.editTitle'),
			onSubmit,
			initial === undefined ? 'common.create' : 'common.save',
		);
		this.modalEl.addClass('snowflake-method-scene-modal');
		this.characters = characters;
		if (initial !== undefined) {
			this.title = initial.title;
			this.time = initial.time;
			this.location = initial.location;
			this.characterPaths = [...initial.characterPaths];
			this.conflict = initial.conflict;
			this.povPath = initial.povPath || SCENE_POV_OMNISCIENT;
			this.events = initial.events;
			this.expectedRevision = initial.expectedRevision;
		}
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-scene-form');
		const name = new Setting(this.contentEl)
			.setName(`${this.t('modal.scene.name')} *`)
			.addText((text) =>
				text
					.setValue(this.title)
					.onChange((value) => {
						this.title = value;
					}),
			);
		name.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-name-setting',
		);
		const pov = new Setting(this.contentEl)
			.setName(`${this.t('modal.scene.pov')} *`)
			.addDropdown((dropdown) => {
				dropdown.addOption(
					SCENE_POV_OMNISCIENT,
					this.t('modal.scene.povOmniscient'),
				);
				dropdown.addOption(
					SCENE_POV_MULTIPLE,
					this.t('modal.scene.povMultiple'),
				);
				for (const character of this.characters) {
					dropdown.addOption(character.path, character.name);
				}
				dropdown.selectEl.required = true;
				dropdown.selectEl.setAttribute('aria-required', 'true');
				dropdown.setValue(this.povPath);
				dropdown.onChange((value) => {
					this.povPath = value;
				});
			});
		pov.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-pov-setting',
		);
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
		this.buildCharacterMultiSelect(characters.controlEl);
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
		this.characterSelectCleanup?.();
		this.characterSelectCleanup = null;
		super.onClose();
	}

	private buildCharacterMultiSelect(container: HTMLElement): void {
		const control = container.createDiv({
			cls: 'snowflake-method-character-multi-select',
		});
		const trigger = control.createDiv({
			cls: 'snowflake-method-character-multi-select-trigger',
			attr: {
				role: 'combobox',
				tabindex: '0',
				'aria-haspopup': 'listbox',
				'aria-expanded': 'false',
			},
		});
		const values = trigger.createDiv({
			cls: 'snowflake-method-character-multi-select-values',
		});
		const chevron = trigger.createSpan({
			cls: 'snowflake-method-character-multi-select-chevron',
		});
		setIcon(chevron, 'chevron-down');

		const options = control.createDiv({
			cls: 'snowflake-method-character-multi-select-options is-hidden',
			attr: { role: 'listbox', 'aria-multiselectable': 'true' },
		});
		let open = false;

		const setOpen = (next: boolean): void => {
			open = next;
			options.toggleClass('is-hidden', !open);
			trigger.setAttribute('aria-expanded', String(open));
			control.toggleClass('is-open', open);
		};

		const toggleCharacter = (path: string): void => {
			const selected = new Set(this.characterPaths);
			if (selected.has(path)) selected.delete(path);
			else selected.add(path);
			this.characterPaths = this.characters
				.map((character) => character.path)
				.filter((candidate) => selected.has(candidate));
			render();
		};

		const render = (): void => {
			values.empty();
			const selected = new Set(this.characterPaths);
			if (selected.size === 0) {
				values.createSpan({
					cls: 'snowflake-method-character-multi-select-placeholder',
					text:
						this.characters.length === 0
							? this.t('modal.scene.charactersEmpty')
							: this.t('modal.scene.charactersPlaceholder'),
				});
			} else {
				for (const character of this.characters) {
					if (!selected.has(character.path)) continue;
					const tag = values.createSpan({
						cls: 'snowflake-method-character-multi-select-tag',
					});
					tag.createSpan({ text: character.name });
					const remove = tag.createEl('button', {
						cls: 'snowflake-method-character-multi-select-remove clickable-icon',
						attr: {
							type: 'button',
							'aria-label': this.t('modal.scene.removeCharacter', {
								name: character.name,
							}),
						},
					});
					setIcon(remove, 'x');
					remove.addEventListener('click', (event) => {
						event.stopPropagation();
						toggleCharacter(character.path);
					});
				}
			}

			options.empty();
			if (this.characters.length === 0) {
				options.createDiv({
					cls: 'snowflake-method-character-multi-select-empty',
					text: this.t('modal.scene.charactersEmpty'),
				});
			}
			for (const character of this.characters) {
				const option = options.createDiv({
					cls: 'snowflake-method-character-multi-select-option',
					attr: {
						role: 'option',
						tabindex: '0',
						'aria-selected': String(selected.has(character.path)),
					},
				});
				option.toggleClass('is-selected', selected.has(character.path));
				option.createSpan({ text: character.name });
				const check = option.createSpan({
					cls: 'snowflake-method-character-multi-select-check',
				});
				if (selected.has(character.path)) setIcon(check, 'check');
				option.addEventListener('click', () => {
					toggleCharacter(character.path);
				});
				option.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						toggleCharacter(character.path);
					}
				});
			}
		};

		trigger.addEventListener('click', () => setOpen(!open));
		trigger.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				setOpen(!open);
			} else if (event.key === 'Escape') {
				setOpen(false);
			}
		});
		const closeOnOutsidePointer = (event: PointerEvent): void => {
			if (open && !control.contains(event.target as Node)) setOpen(false);
		};
		const ownerDocument = control.doc;
		ownerDocument.addEventListener('pointerdown', closeOnOutsidePointer);
		this.characterSelectCleanup = () =>
			ownerDocument.removeEventListener('pointerdown', closeOnOutsidePointer);
		render();
	}

	protected collectValue(): CreateSceneRequest | null {
		const title = this.title.trim();
		if (title.length === 0) {
			new Notice(this.t('modal.scene.nameRequired'));
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
					// A deterministic repair is the primary action. Opening the raw note is
					// reserved for issues that still require an author's judgment.
					if (!entry.canOpen || entry.repairable) continue;
					const open = itemActions.createEl('button', {
						text: this.t('editor.managedSection.openNote'),
						attr: { type: 'button' },
					});
					open.addEventListener('click', () => {
						void this.openFile(entry.path, entry.sectionId)
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
