import {
	App,
	FuzzySuggestModal,
	Menu,
	Modal,
	Notice,
	Setting,
	SuggestModal,
	TFolder,
	setIcon,
} from 'obsidian';

import {
	SCENE_POV_MULTIPLE,
	SCENE_POV_OMNISCIENT,
	TIME_KINDS,
	addSceneCastMember,
	foldName,
	isChoosableScenePov,
	isNameTaken,
	isTimeKind,
	normalizeSceneCast,
	type EntityKind,
	type ProgressStatus,
	type TimeKind,
	type WorldbuildingKind,
} from '../domain';
import type { MemberUsage } from '../services';
import type { RecordLine } from '../templates';
import {
	CategoryPathField,
	ChipListField,
	NoteField,
	NoteListField,
	ENTITY_GROUP_IDS,
	RecordCardsEditor,
	addProgressStatusControl,
	type DefinitionPathSource,
	type EntityGroupId,
	type PickedEntity,
	type RecordDraft,
	type RecordEditorContext,
} from './entity-form';
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
	optionsMatching,
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
import type {
	DefinitionFileChoice,
	RepairReportViewModel,
} from './view-model';

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
	aliases: string[];
	categoryPaths: string[];
	progressStatus: ProgressStatus;
	oneSentenceStoryline: string;
	oneParagraphStoryline: string;
	motivation: string;
	goal: string;
	conflict: string;
	growth: string;
	worldStatus: RecordLine[];
	relationships: RecordLine[];
	expectedRevision?: string;
}

export interface CharacterOption {
	id: string;
	path: string;
	name: string;
}

export interface CreateSceneRequest {
	title: string;
	aliases: string[];
	categoryPaths: string[];
	progressStatus: ProgressStatus;
	times: string[];
	locations: string[];
	characterPaths: string[];
	conflict: string;
	worldStatus: RecordLine[];
	relationships: RecordLine[];
	povPath: string;
	events: string;
	expectedRevision?: string;
}

export interface EntityFormRequest {
	kind: WorldbuildingKind;
	name: string;
	aliases: string[];
	categoryPaths: string[];
	progressStatus: ProgressStatus;
	description: string;
	timeKind: TimeKind | null;
	timeStart: string;
	timeEnd: string;
	worldStatus: RecordLine[];
	relationships: RecordLine[];
	expectedRevision?: string;
}

/**
 * Everything the record editors need from the project: who can be pointed at,
 * and which definition files supply the labels. Built by the dashboard once
 * per opened form.
 */
export interface MemberFormContext {
	notice: (message: string) => void;
	/** Every note of one group, for the picker that points a record at one. */
	entitiesIn: (group: EntityGroupId) => readonly PickerOption[];
	/**
	 * Makes a note of that group, for a field asked for something the project
	 * does not have yet. `onlyGroup` is for a field that takes one group and no
	 * other: the form that opens holds the kind rather than offering to change
	 * it, because changing it would make a note the field cannot accept.
	 */
	createIn: (
		group: EntityGroupId,
		name: string,
		options?: { onlyGroup?: boolean },
	) => Promise<PickerOption | null>;
	/** Which group a stored link belongs to, or null when it left the project. */
	groupOf: (path: string) => EntityGroupId | null;
	members: () => readonly PickerOption[];
	times: () => readonly PickerOption[];
	categories: DefinitionPathSource;
	worldStatusLabels: DefinitionPathSource;
	relationshipLabels: DefinitionPathSource;
	/** Vault paths of the definition files, for the label links records store. */
	worldStatusPath: string;
	relationshipPath: string;
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
		// What every form the plugin opens has in common, for the few things
		// that should be true of all of them at once.
		this.modalEl.addClass('snowflake-method-form-modal');
	}

	protected abstract buildForm(): void;
	protected abstract collectValue(): T | null;

	/** Everything a record editor needs, wired to this modal's own dialogs. */
	protected recordContext(
		context: MemberFormContext,
		labels: DefinitionPathSource,
		definitionId: DefinitionFileChoice,
	): RecordEditorContext {
		return {
			app: this.app,
			t: this.t,
			notice: context.notice,
			labels,
			describeLabel: (path) =>
				promptForDefinitionPath(this.app, this.t, definitionId, path),
			pickEntity: () => promptForEntityReference(this.app, this.t, context),
			entityGroup: context.groupOf,
			times: context.times,
			members: context.members,
		};
	}

	/**
	 * Puts a control on the title row, where a step pane keeps its status. The
	 * title survives a redraw of the form, so an old control is cleared first
	 * rather than joined by a second one.
	 */
	protected titleControls(): HTMLElement {
		this.titleEl.addClass('snowflake-method-form-title');
		const existing = this.titleEl.querySelector(
			'.snowflake-method-form-title-controls',
		);
		existing?.remove();
		return this.titleEl.createDiv({
			cls: 'snowflake-method-form-title-controls',
		});
	}

	onOpen(): void {
		this.renderForm();
		// A form opens with nothing focused. Whatever sits first in the dialog
		// is an accident of layout, and landing on it puts a caret, or a
		// dropdown ready to change on a keypress, where nobody was looking.
		window.setTimeout(() => {
			const active = this.modalEl.ownerDocument.activeElement;
			if (isCrossWindowHTMLElement(active) && this.modalEl.contains(active)) {
				active.blur();
			}
		}, 0);
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

/**
 * The one question a new manuscript segment has to answer. Deliberately not the
 * duplicate-name form the character and scene modals use: nothing links to a
 * segment by name, so two chapters may share one, and a manuscript is no place
 * to be refused a title.
 */
class SegmentTitleModal extends SnowflakeFormModal<string> {
	private title: string;

	constructor(
		app: App,
		t: Translate,
		presetTitle: string,
		onSubmit: SubmitHandler<string>,
		private readonly settle: () => void,
	) {
		super(app, t, t('manuscript.newSegment'), onSubmit);
		this.title = presetTitle;
		this.modalEl.addClass('snowflake-method-project-modal');
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		// The same form the project dialogs use, so naming a chapter looks like
		// naming anything else rather than like a dialog of its own.
		this.contentEl.addClass('snowflake-method-project-form');
		new Setting(this.contentEl)
			.setName(this.t('manuscript.segmentTitle'))
			.addText((text) => {
				text
					.setPlaceholder(this.t('manuscript.segmentTitlePlaceholder'))
					.setValue(this.title)
					.onChange((value) => {
						this.title = value;
					});
				// The one field this form has, so it takes the caret without the
				// author reaching for it. Timed by the window the form is in,
				// which is not the app's when it opened in a popout.
				this.contentEl.win.setTimeout(() => {
					text.inputEl.focus();
					text.inputEl.select();
				}, 0);
			});
	}

	protected collectValue(): string | null {
		const title = this.title.trim();
		if (title.length === 0) {
			new Notice(this.t('manuscript.segmentTitleRequired'));
			return null;
		}
		return title;
	}

	onClose(): void {
		super.onClose();
		this.settle();
	}
}

/**
 * Asks for a segment title, resolving to the path of the segment that was
 * created or to null when the author closed the form without creating one.
 */
export function promptForSegmentTitle(
	app: App,
	t: Translate,
	presetTitle: string,
	create: (title: string) => Promise<string>,
): Promise<string | null> {
	return new Promise((resolve) => {
		const outcome: { created: string | null } = { created: null };
		new SegmentTitleModal(
			app,
			t,
			presetTitle,
			async (title) => {
				outcome.created = await create(title);
			},
			() => resolve(outcome.created),
		).open();
	});
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
		this.modalEl.addClass('snowflake-method-compact-form-modal');
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
	private aliasesField: ChipListField | null = null;
	private categoryField: CategoryPathField | null = null;
	private worldStatusEditor: RecordCardsEditor | null = null;
	private relationshipsEditor: RecordCardsEditor | null = null;

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
		/**
		 * The project context the universal rows and record editors draw on.
		 * Without it the form offers only the classic fields, which is what the
		 * quick create-from-a-scene flow wants.
		 */
		private readonly formContext?: MemberFormContext,
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
				}
			: { ...initial };
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-character-form');
		this.buildTitleStatus();
		this.addText('name', 'modal.character.name', true);
		this.buildUniversalRows();
		this.addText('oneSentenceStoryline', 'modal.character.oneSentenceStoryline');
		this.addText('motivation', 'modal.character.motivation');
		this.addText('goal', 'modal.character.goal');
		this.addText('conflict', 'modal.character.conflict');
		this.addText('growth', 'modal.character.growth');
		this.addText('oneParagraphStoryline', 'modal.character.oneParagraphStoryline');
		this.buildRecordEditors();
	}

	/** The status rides in the title row, the way a step's status does. */
	private buildTitleStatus(): void {
		if (this.formContext === undefined) return;
		addProgressStatusControl(
			this.titleControls(),
			this.t,
			this.value.progressStatus,
			(value) => {
				this.value.progressStatus = value;
			},
		);
	}

	private buildUniversalRows(): void {
		const context = this.formContext;
		if (context === undefined) return;
		const aliases = new Setting(this.contentEl).setName(this.t('form.aliases'));
		aliases.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-character-aliases-setting',
		);
		this.aliasesField = new ChipListField(
			{ t: this.t },
			this.value.aliases,
			this.t('form.aliases.placeholder'),
		);
		this.aliasesField.attach(aliases.controlEl);
		const categories = new Setting(this.contentEl)
			.setName(this.t('form.category'))
			.setDesc(this.t('form.definition.desc.category'));
		categories.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-character-category-setting',
		);
		this.categoryField = new CategoryPathField(
			{
				app: this.app,
				t: this.t,
				notice: context.notice,
				source: context.categories,
				describe: (path) =>
					promptForDefinitionPath(this.app, this.t, 'category', path),
			},
			this.value.categoryPaths,
		);
		this.categoryField.attach(categories.controlEl);
	}

	private buildRecordEditors(): void {
		const context = this.formContext;
		if (context === undefined) return;
		const block = this.contentEl.createDiv({
			cls: 'snowflake-method-record-editors',
		});
		this.worldStatusEditor = new RecordCardsEditor(
			this.recordContext(context, context.worldStatusLabels, 'world-status'),
			context.worldStatusPath,
			this.value.worldStatus,
			{
				title: this.t('form.worldStatus'),
				add: this.t('form.record.addStatus'),
				labelTitle: this.t('form.record.status'),
				labelPlaceholder: this.t('form.definition.placeholder.world-status'),
			},
			false,
		);
		this.worldStatusEditor.attach(block);
		this.relationshipsEditor = new RecordCardsEditor(
			this.recordContext(context, context.relationshipLabels, 'relationship'),
			context.relationshipPath,
			this.value.relationships,
			{
				title: this.t('form.relationships'),
				add: this.t('form.record.addRelationship'),
				labelTitle: this.t('form.record.relationship'),
				labelPlaceholder: this.t('form.definition.placeholder.relationship'),
			},
			true,
		);
		this.relationshipsEditor.attach(block);
	}

	/** Pulls the live editors back into the value, for collect and re-render. */
	private syncEditors(): void {
		if (this.aliasesField !== null) this.value.aliases = this.aliasesField.get();
		if (this.categoryField !== null) {
			this.value.categoryPaths = this.categoryField.get();
		}
		if (this.worldStatusEditor !== null) {
			this.value.worldStatus = this.worldStatusEditor.records();
		}
		if (this.relationshipsEditor !== null) {
			this.value.relationships = this.relationshipsEditor.records();
		}
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
		this.syncEditors();
		return { ...this.value };
	}

	private addText(
		key: Exclude<
			keyof CreateCharacterRequest,
			| 'type'
			| 'expectedRevision'
			| 'aliases'
			| 'categoryPaths'
			| 'progressStatus'
			| 'age'
			| 'worldStatus'
			| 'relationships'
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
 * The character form opened from a field, which reports back what it created so
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
		formContext?: MemberFormContext,
	) {
		super(app, t, takenNames, onSubmit, undefined, presetName, formContext);
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
 *
 * The context is the same one the form behind it was given: a character made
 * from a field is a character like any other, and is asked the same questions.
 */
export function promptForNewCharacter(
	app: App,
	t: Translate,
	takenNames: readonly string[],
	presetName: string,
	create: (request: CreateCharacterRequest) => Promise<CharacterOption>,
	formContext?: MemberFormContext,
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
			formContext,
		).open();
	});
}

/**
 * Asks what a new category means before it is written. A category becomes a
 * word the whole project is sorted by, so the moment to record what it stands
 * for is the moment it is invented -- and the description is optional because
 * some categories really do explain themselves.
 */
class NewDefinitionModal extends Modal {
	private pathEl: HTMLInputElement | null = null;
	private descriptionEl: HTMLTextAreaElement | null = null;
	private decided = false;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly definitionId: DefinitionFileChoice,
		private readonly path: string,
		private readonly done: (created: NewDefinitionPath | null) => void,
	) {
		super(app);
		this.setTitle(t(`modal.definition.title.${definitionId}`));
		this.modalEl.addClass(
			'snowflake-method-form-modal',
			'snowflake-method-definition-modal',
		);
	}

	onOpen(): void {
		// Worn like every other form the plugin opens: the same rows, each label
		// above the field it names. It asks for less than they do, and that is
		// the only way it should differ. Which vocabulary is being added to is
		// what the wording changes: the dialog is the same for all three.
		this.contentEl.addClass('snowflake-method-definition-form');
		// The name arrives from whatever was typed into the field, which is
		// where a slash in the wrong place is easiest to make and hardest to
		// see. It stays an editable field so it can be put right here.
		const name = new Setting(this.contentEl)
			.setName(this.t(`modal.definition.name.${this.definitionId}`))
			.setDesc(this.t(`form.definition.desc.${this.definitionId}`))
			.addText((text) => {
				text.setValue(this.path);
				text.setPlaceholder(
					this.t(`form.definition.placeholder.${this.definitionId}`),
				);
				this.pathEl = text.inputEl;
			});
		name.settingEl.addClass('snowflake-method-definition-setting');
		// Read at submit rather than tracked on the way in: what the field holds
		// when Create is pressed is the answer, however it got there -- typed,
		// pasted, or composed through an input method.
		const description = new Setting(this.contentEl)
			.setName(this.t('modal.category.description'))
			.addTextArea((text) => {
				text.setPlaceholder(this.t('form.description.placeholder'));
				this.descriptionEl = text.inputEl;
			});
		description.settingEl.addClass(
			'snowflake-method-definition-setting',
			'snowflake-method-definition-description',
		);
		const actions = this.contentEl.createDiv({
			cls: 'snowflake-method-modal-actions',
		});
		const cancel = actions.createEl('button', { text: this.t('common.cancel') });
		cancel.addEventListener('click', () => this.close());
		const create = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t('common.create'),
		});
		create.addEventListener('click', () => {
			// An empty name is nothing to create, so the form stays open on it.
			if ((this.pathEl?.value ?? '').trim().length === 0) {
				this.pathEl?.focus();
				return;
			}
			this.decided = true;
			this.close();
		});
	}

	onClose(): void {
		const path = this.pathEl?.value.trim() ?? '';
		const description = this.descriptionEl?.value.trim() ?? '';
		this.contentEl.empty();
		this.pathEl = null;
		this.descriptionEl = null;
		// Closing any other way is a refusal, and a refusal creates nothing.
		this.done(this.decided ? { path, description } : null);
	}
}

/** What the new-category dialog settled on: the path to add, and what it means. */
export interface NewDefinitionPath {
	path: string;
	description: string;
}

/**
 * Opens the new-entry dialog for one of the vocabularies, resolving to the
 * path to add and what it means, or to null when the author backed out.
 */
export function promptForDefinitionPath(
	app: App,
	t: Translate,
	definitionId: DefinitionFileChoice,
	path: string,
): Promise<NewDefinitionPath | null> {
	return new Promise((resolve) => {
		new NewDefinitionModal(app, t, definitionId, path, resolve).open();
	});
}

/** One kind of note a vocabulary can be added to, by the name it is shown by. */
export interface DefinitionKindChoice {
	kind: EntityKind;
	label: string;
}

/**
 * Which kind of note a new entry belongs to, asked the way a record asks
 * what kind of note it is pointing at: one list, chosen before the thing
 * itself. Each kind keeps its own vocabulary, so this is the first thing an
 * entry needs to know about itself.
 */
class DefinitionKindModal extends SuggestModal<DefinitionKindChoice> {
	private answered: EntityKind | null = null;

	constructor(
		app: App,
		t: Translate,
		private readonly kinds: readonly DefinitionKindChoice[],
		private readonly done: (kind: EntityKind | null) => void,
	) {
		super(app);
		this.setPlaceholder(t('definition.pickKind'));
	}

	getSuggestions(query: string): DefinitionKindChoice[] {
		return optionsMatching(this.kinds, query);
	}

	renderSuggestion(choice: DefinitionKindChoice, el: HTMLElement): void {
		el.setText(choice.label);
	}

	onChooseSuggestion(choice: DefinitionKindChoice): void {
		this.answered = choice.kind;
	}

	/**
	 * The answer is read after this dialog is gone, not while it is closing:
	 * the framework closes first and reports the choice second, so reading at
	 * close time would always find nothing chosen — and a kind chosen would
	 * come back as nobody answering, which ends the asking there. Settles
	 * however the dialog closed, so a caller waiting on it is never left
	 * holding a promise nobody will settle.
	 */
	onClose(): void {
		super.onClose();
		void Promise.resolve().then(() => {
			this.done(this.answered);
		});
	}
}

/** Asks which kind of note an entry is for, or null when nobody answered. */
export function promptForDefinitionKind(
	app: App,
	t: Translate,
	kinds: readonly DefinitionKindChoice[],
): Promise<EntityKind | null> {
	return new Promise((resolve) => {
		new DefinitionKindModal(app, t, kinds, resolve).open();
	});
}

/** What the edit dialog settled on: the node's name and what it means. */
export interface DefinitionEditResult {
	name: string;
	description: string;
}

/**
 * The same two rows the new-entry dialog asks with, prefilled: one node's
 * name and its description. Only the last segment is editable, which is what
 * the line under the field says — the ancestors have rows of their own, and
 * this dialog renames the one entry it was opened on.
 */
class EditDefinitionModal extends Modal {
	private nameEl: HTMLInputElement | null = null;
	private descriptionEl: HTMLTextAreaElement | null = null;
	private decided = false;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly definitionId: DefinitionFileChoice,
		private readonly taxonomyPath: string,
		private readonly description: string,
		private readonly done: (settled: DefinitionEditResult | null) => void,
	) {
		super(app);
		this.setTitle(t(`modal.definition.edit.${definitionId}`));
		this.modalEl.addClass(
			'snowflake-method-form-modal',
			'snowflake-method-definition-modal',
		);
	}

	onOpen(): void {
		this.contentEl.addClass('snowflake-method-definition-form');
		const segments = this.taxonomyPath.split('/');
		const name = new Setting(this.contentEl)
			.setName(this.t(`modal.definition.name.${this.definitionId}`))
			.setDesc(this.t('modal.definition.edit.scope'))
			.addText((text) => {
				text.setValue(segments[segments.length - 1] ?? '');
				this.nameEl = text.inputEl;
			});
		name.settingEl.addClass('snowflake-method-definition-setting');
		const description = new Setting(this.contentEl)
			.setName(this.t('modal.category.description'))
			.addTextArea((text) => {
				text.setPlaceholder(this.t('form.description.placeholder'));
				text.setValue(this.description);
				this.descriptionEl = text.inputEl;
			});
		description.settingEl.addClass(
			'snowflake-method-definition-setting',
			'snowflake-method-definition-description',
		);
		const actions = this.contentEl.createDiv({
			cls: 'snowflake-method-modal-actions',
		});
		const cancel = actions.createEl('button', { text: this.t('common.cancel') });
		cancel.addEventListener('click', () => this.close());
		const save = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t('common.save'),
		});
		save.addEventListener('click', () => {
			// An empty name is nothing to rename to, so the form stays open on it.
			if ((this.nameEl?.value ?? '').trim().length === 0) {
				this.nameEl?.focus();
				return;
			}
			this.decided = true;
			this.close();
		});
	}

	onClose(): void {
		const name = this.nameEl?.value.trim() ?? '';
		const description = this.descriptionEl?.value.trim() ?? '';
		this.contentEl.empty();
		this.nameEl = null;
		this.descriptionEl = null;
		// Closing any other way is a refusal, and a refusal changes nothing.
		this.done(this.decided ? { name, description } : null);
	}
}

/**
 * Opens the edit dialog for one definition node, resolving to the name and
 * description it settled on, or to null when the author backed out.
 */
export function promptForDefinitionEdit(
	app: App,
	t: Translate,
	definitionId: DefinitionFileChoice,
	taxonomyPath: string,
	description: string,
): Promise<DefinitionEditResult | null> {
	return new Promise((resolve) => {
		new EditDefinitionModal(
			app,
			t,
			definitionId,
			taxonomyPath,
			description,
			resolve,
		).open();
	});
}

/** What deleting one definition node costs, gathered over its subtree. */
export interface DefinitionDeletionCost {
	/** How many standing entries go, the node itself included. */
	nodes: number;
	/** Notes that lose the entry from their category lists. */
	listed: string[];
	/** Notes whose record lines will be left naming the felled path. */
	records: string[];
}

/**
 * Asks whether a definition node should go, saying what going costs: how
 * many entries the subtree takes with it, which notes lose a category
 * entry, and which record lines will be left naming a path that is gone —
 * those are sentences the author wrote, so they stay and the health check
 * reports them.
 */
export class ConfirmDefinitionDeletionModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly taxonomyPath: string,
		private readonly cost: DefinitionDeletionCost,
		private readonly onResolve: (confirmed: boolean) => void,
	) {
		super(app);
		this.setTitle(t('modal.deleteDefinition.title', { name: taxonomyPath }));
		this.modalEl.addClass('snowflake-method-delete-member-modal');
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text: this.t(
				this.cost.nodes > 1
					? 'modal.deleteDefinition.subtree'
					: 'modal.deleteDefinition.description',
				{ name: this.taxonomyPath, count: this.cost.nodes - 1 },
			),
		});
		this.addNoteList(
			this.t('modal.deleteDefinition.listed'),
			this.cost.listed,
			false,
		);
		this.addNoteList(
			this.t('modal.deleteDefinition.records'),
			this.cost.records,
			true,
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

	private addNoteList(
		label: string,
		titles: readonly string[],
		needsDecision: boolean,
	): void {
		if (titles.length === 0) return;
		const group = this.contentEl.createDiv({
			cls: `snowflake-method-delete-member-group${
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

/**
 * A list to choose from, with an offer to create what was typed when the list
 * has nothing like it. Resolves to null when the author closes it.
 */
/**
 * Points a record at another note in two questions asked by one dialog: what
 * kind of note, then which one. Asking the kind first is what keeps the second
 * list short enough to read in a project with three thousand scenes in it, and
 * one dialog that moves on is steadier than a second one opened while the
 * first is still closing.
 */
class EntityReferenceModal extends SuggestModal<ReferenceChoice> {
	private group: EntityGroupId | null = null;
	private answered: PickedEntity | null = null;
	private pending: Promise<PickedEntity | null> | null = null;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly context: MemberFormContext,
		private readonly done: (picked: PickedEntity | null) => void,
	) {
		super(app);
		this.setPlaceholder(t('form.record.pickGroup'));
	}

	getSuggestions(query: string): ReferenceChoice[] {
		const group = this.group;
		if (group === null) {
			return optionsMatching(
				ENTITY_GROUP_IDS.map((id) => ({
					value: id,
					label: this.t(`form.group.${id}`),
				})),
				query,
			).map((option) => ({
				kind: 'group',
				group: option.value,
				label: option.label,
			}));
		}
		const options = this.context.entitiesIn(group);
		const matches = optionsMatching(options, query).map(
			(option): ReferenceChoice => ({ kind: 'entity', group, option }),
		);
		const typed = query.trim();
		if (
			typed.length === 0 ||
			options.some((option) => option.label === typed)
		) {
			return matches;
		}
		return [...matches, { kind: 'create', group, name: typed }];
	}

	renderSuggestion(choice: ReferenceChoice, el: HTMLElement): void {
		if (choice.kind === 'group') el.setText(choice.label);
		else if (choice.kind === 'entity') el.setText(choice.option.label);
		else {
			// The same row a field offers, so creating from here and creating
			// from a field are one offer wearing one look.
			el.addClass('snowflake-method-option-picker-create');
			el.setText(this.t('form.record.createEntity', { name: choice.name }));
		}
	}

	/**
	 * Choosing the kind moves this dialog on rather than closing it, which is
	 * why the framework's own select is only called for an answer.
	 */
	selectSuggestion(
		choice: ReferenceChoice,
		event: MouseEvent | KeyboardEvent,
	): void {
		if (choice.kind !== 'group') {
			super.selectSuggestion(choice, event);
			return;
		}
		this.group = choice.group;
		this.setPlaceholder(
			this.t('form.record.pickEntity', { group: choice.label }),
		);
		this.inputEl.value = '';
		this.inputEl.dispatchEvent(new Event('input'));
		this.inputEl.focus();
	}

	onChooseSuggestion(choice: ReferenceChoice): void {
		if (choice.kind === 'entity') {
			this.answered = { group: choice.group, option: choice.option };
			return;
		}
		if (choice.kind === 'create') {
			this.pending = this.context
				.createIn(choice.group, choice.name)
				.then((option) =>
					option === null ? null : { group: choice.group, option },
				);
		}
	}

	/**
	 * The answer is read after this dialog is gone, not while it is closing:
	 * the framework closes first and reports the choice second, so reading at
	 * close time would always find nothing chosen.
	 */
	onClose(): void {
		super.onClose();
		void Promise.resolve().then(async () => {
			this.done(await (this.pending ?? Promise.resolve(this.answered)));
		});
	}
}

type ReferenceChoice =
	| { kind: 'group'; group: EntityGroupId; label: string }
	| { kind: 'entity'; group: EntityGroupId; option: PickerOption }
	| { kind: 'create'; group: EntityGroupId; name: string };

export function promptForEntityReference(
	app: App,
	t: Translate,
	context: MemberFormContext,
): Promise<PickedEntity | null> {
	return new Promise((resolve) => {
		new EntityReferenceModal(app, t, context, resolve).open();
	});
}

export class CreateSceneModal extends SnowflakeFormModal<CreateSceneRequest> {
	private readonly characters: CharacterOption[];
	private title = '';
	private times: string[] = [];
	private locations: string[] = [];
	private characterPaths: string[] = [];
	private conflict = '';
	// Unset, so a new scene starts on the placeholder and the author has to say
	// whose scene it is rather than inheriting a default nobody chose.
	private povPath = '';
	private events = '';
	private aliases: string[] = [];
	private categoryPaths: string[] = [];
	private progressStatus: ProgressStatus = 'not-started';
	private worldStatus: RecordLine[] = [];
	private relationships: RecordLine[] = [];
	private expectedRevision: string | undefined;
	private readonly pickers: OptionPicker[] = [];
	private readonly name: UniqueNameField;
	private aliasesField: ChipListField | null = null;
	private categoryField: CategoryPathField | null = null;
	private timesField: NoteListField | null = null;
	private locationsField: NoteListField | null = null;
	private worldStatusEditor: RecordCardsEditor | null = null;
	private relationshipsEditor: RecordCardsEditor | null = null;

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
		/**
		 * The project context the universal rows and record editors draw on.
		 * Without it the form offers only the classic fields.
		 */
		private readonly formContext?: MemberFormContext,
		/** The title typed into the field that asked for this scene. */
		presetTitle?: string,
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
		this.title = presetTitle ?? '';
		this.name = new UniqueNameField(takenTitles, initial?.title ?? null, () =>
			this.t('modal.scene.nameTaken'),
		);
		if (initial !== undefined) {
			this.title = initial.title;
			this.times = [...initial.times];
			this.locations = [...initial.locations];
			this.characterPaths = [...initial.characterPaths];
			this.conflict = initial.conflict;
			this.povPath = initial.povPath;
			this.events = initial.events;
			this.aliases = [...initial.aliases];
			this.categoryPaths = [...initial.categoryPaths];
			this.progressStatus = initial.progressStatus;
			this.worldStatus = [...initial.worldStatus];
			this.relationships = [...initial.relationships];
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
		// Aliases and category sit with the name, the way they do on a
		// character, rather than after the prose fields.
		this.buildUniversalRows();
		const time = new Setting(this.contentEl).setName(
			this.t('modal.scene.time'),
		);
		time.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-time-setting',
		);
		this.timesField = this.buildNoteListField(
			time.controlEl,
			['time-point', 'time-period'],
			'time-point',
			this.t('modal.scene.time'),
			this.t('modal.scene.timePlaceholder'),
			this.times,
		);
		const location = new Setting(this.contentEl).setName(
			this.t('modal.scene.location'),
		);
		location.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-location-setting',
		);
		this.locationsField = this.buildNoteListField(
			location.controlEl,
			['location'],
			'location',
			this.t('modal.scene.location'),
			this.t('modal.scene.locationPlaceholder'),
			this.locations,
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
		this.buildRecordEditors();
	}

	private buildUniversalRows(): void {
		const context = this.formContext;
		if (context === undefined) return;
		addProgressStatusControl(
			this.titleControls(),
			this.t,
			this.progressStatus,
			(value) => {
				this.progressStatus = value;
			},
		);
		const aliases = new Setting(this.contentEl).setName(this.t('form.aliases'));
		aliases.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-aliases-setting',
		);
		this.aliasesField = new ChipListField(
			{ t: this.t },
			this.aliases,
			this.t('form.aliases.placeholder'),
		);
		this.aliasesField.attach(aliases.controlEl);
		const categories = new Setting(this.contentEl)
			.setName(this.t('form.category'))
			.setDesc(this.t('form.definition.desc.category'));
		categories.settingEl.addClass(
			'snowflake-method-scene-setting',
			'snowflake-method-scene-category-setting',
		);
		this.categoryField = new CategoryPathField(
			{
				app: this.app,
				t: this.t,
				notice: context.notice,
				source: context.categories,
				describe: (path) =>
					promptForDefinitionPath(this.app, this.t, 'category', path),
			},
			this.categoryPaths,
		);
		this.categoryField.attach(categories.controlEl);
	}

	private buildRecordEditors(): void {
		const context = this.formContext;
		if (context === undefined) return;
		const block = this.contentEl.createDiv({
			cls: 'snowflake-method-record-editors',
		});
		this.worldStatusEditor = new RecordCardsEditor(
			this.recordContext(context, context.worldStatusLabels, 'world-status'),
			context.worldStatusPath,
			this.worldStatus,
			{
				title: this.t('form.worldStatus'),
				add: this.t('form.record.addStatus'),
				labelTitle: this.t('form.record.status'),
				labelPlaceholder: this.t('form.definition.placeholder.world-status'),
			},
			false,
		);
		this.worldStatusEditor.attach(block);
		this.relationshipsEditor = new RecordCardsEditor(
			this.recordContext(context, context.relationshipLabels, 'relationship'),
			context.relationshipPath,
			this.relationships,
			{
				title: this.t('form.relationships'),
				add: this.t('form.record.addRelationship'),
				labelTitle: this.t('form.record.relationship'),
				labelPlaceholder: this.t('form.definition.placeholder.relationship'),
			},
			true,
		);
		this.relationshipsEditor.attach(block);
	}

	/** Pulls the live editors back into the fields, for collect and re-render. */
	private syncEditors(): void {
		if (this.aliasesField !== null) this.aliases = this.aliasesField.get();
		if (this.categoryField !== null) {
			this.categoryPaths = this.categoryField.get();
		}
		if (this.worldStatusEditor !== null) {
			this.worldStatus = this.worldStatusEditor.records();
		}
		if (this.relationshipsEditor !== null) {
			this.relationships = this.relationshipsEditor.records();
		}
	}

	protected renderForm(): void {
		// The form re-renders when a character is created from one of its own
		// fields; whatever the editors hold has to survive the rebuild.
		this.syncEditors();
		super.renderForm();
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

	/**
	 * A tag picker over the notes of one or more kinds, creating in the kind a
	 * new name most likely belongs to.
	 */
	private buildNoteListField(
		container: HTMLElement,
		groups: readonly EntityGroupId[],
		createIn: EntityGroupId,
		label: string,
		placeholder: string,
		initial: readonly string[],
	): NoteListField | null {
		const context = this.formContext;
		if (context === undefined) return null;
		const field = new NoteListField(
			{
				app: this.app,
				t: this.t,
				notice: context.notice,
				options: () => groups.flatMap((group) => context.entitiesIn(group)),
				create: (name) => context.createIn(createIn, name),
				label,
				placeholder,
				createLabel: (name) =>
					this.t('form.record.createEntity', { name }),
				removeLabel: (name) => this.t('form.record.removeLine', { name }),
			},
			initial,
		);
		field.attach(container);
		return field;
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
		this.syncEditors();
		return {
			title,
			aliases: [...this.aliases],
			categoryPaths: [...this.categoryPaths],
			progressStatus: this.progressStatus,
			times: this.timesField?.get() ?? [...this.times],
			locations: this.locationsField?.get() ?? [...this.locations],
			characterPaths: [...this.characterPaths],
			conflict: this.conflict.trim(),
			worldStatus: [...this.worldStatus],
			relationships: [...this.relationships],
			povPath: this.povPath,
			events: this.events.trim(),
			expectedRevision: this.expectedRevision,
		};
	}
}

/**
 * The form every worldbuilding entity is created and edited through: the
 * universal rows, the kind's own fields, and the record editors for what the
 * body sections store. Records are modal-only, so this is where they live.
 */
export class EntityFormModal extends SnowflakeFormModal<EntityFormRequest> {
	private readonly value: EntityFormRequest;
	private readonly name: UniqueNameField;
	private readonly pickers: OptionPicker[] = [];
	private aliasesField: ChipListField | null = null;
	private categoryField: CategoryPathField | null = null;
	private worldStatusEditor: RecordCardsEditor | null = null;
	private relationshipsEditor: RecordCardsEditor | null = null;
	// Cards begun but not yet filed under a label. A record needs its label to
	// be saved, but the redraw the time-kind dropdown triggers is not a save:
	// these carry what was typed across it.
	private worldStatusDrafts: RecordDraft[] = [];
	private relationshipDrafts: RecordDraft[] = [];

	constructor(
		app: App,
		t: Translate,
		kind: WorldbuildingKind,
		takenNames: readonly string[],
		private readonly formContext: MemberFormContext,
		onSubmit: SubmitHandler<EntityFormRequest>,
		initial?: EntityFormRequest,
		/**
		 * What a note being created already knows about itself: the name typed
		 * into the field that asked for it, and the kind of time that field
		 * wanted. Still a create, so the form opens on Create rather than Save.
		 * A locked kind is one the field will only take, and the form holds it.
		 */
		private readonly preset?: {
			name?: string;
			timeKind?: TimeKind;
			lockTimeKind?: boolean;
		},
	) {
		super(
			app,
			t,
			initial === undefined
				? t(`modal.entity.title.${kind}`)
				: t(`modal.entity.editTitle.${kind}`),
			onSubmit,
			initial === undefined ? 'common.create' : 'common.save',
		);
		this.modalEl.addClass('snowflake-method-character-modal');
		this.name = new UniqueNameField(takenNames, initial?.name ?? null, () =>
			this.t('modal.entity.nameTaken'),
		);
		this.value = initial === undefined
			? {
					kind,
					name: preset?.name ?? '',
					aliases: [],
					categoryPaths: [],
					progressStatus: 'not-started',
					description: '',
					timeKind: preset?.timeKind ?? null,
					timeStart: '',
					timeEnd: '',
					worldStatus: [],
					relationships: [],
				}
			: { ...initial };
	}

	protected buildForm(): void {
		this.contentEl.addClass(
			'snowflake-method-character-form',
			'snowflake-method-entity-form',
		);
		if (this.value.kind === 'time') {
			this.contentEl.addClass('snowflake-method-entity-form-timed');
		}
		const context = this.formContext;
		let nameEl: HTMLInputElement | null = null;
		const name = new Setting(this.contentEl)
			.setName(`${this.t('modal.entity.name')} *`)
			.addText((text) => {
				nameEl = text.inputEl;
				text.setValue(this.value.name).onChange((value) => {
					this.value.name = value;
					this.name.show(value);
				});
			});
		name.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-character-name-setting',
		);
		this.name.attach(name.settingEl, nameEl, this.value.name);
		if (this.value.kind === 'time') this.buildTimeKindRow();

		addProgressStatusControl(
			this.titleControls(),
			this.t,
			this.value.progressStatus,
			(value) => {
				this.value.progressStatus = value;
			},
		);
		const aliases = new Setting(this.contentEl).setName(this.t('form.aliases'));
		aliases.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-character-aliases-setting',
		);
		this.aliasesField = new ChipListField(
			{ t: this.t },
			this.value.aliases,
			this.t('form.aliases.placeholder'),
		);
		this.aliasesField.attach(aliases.controlEl);
		const categories = new Setting(this.contentEl)
			.setName(this.t('form.category'))
			.setDesc(this.t('form.definition.desc.category'));
		categories.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-character-category-setting',
		);
		this.categoryField = new CategoryPathField(
			{
				app: this.app,
				t: this.t,
				notice: context.notice,
				source: context.categories,
				describe: (path) =>
					promptForDefinitionPath(this.app, this.t, 'category', path),
			},
			this.value.categoryPaths,
		);
		this.categoryField.attach(categories.controlEl);
		if (this.value.kind === 'time') this.buildTimeSpanRows();

		const description = new Setting(this.contentEl)
			.setName(this.t('form.description'))
			.addTextArea((text) =>
				text
					.setPlaceholder(this.t('form.description.placeholder'))
					.setValue(this.value.description)
					.onChange((value) => {
						this.value.description = value;
					}),
			);
		description.settingEl.addClass('snowflake-method-character-setting');

		this.buildRecordEditors();
	}

	/**
	 * A time note is a point or the period between two of them, so the type is
	 * the first thing said about it and rides beside the name.
	 */
	private buildTimeKindRow(): void {
		// Starred like the name: a time note is a point or a period before it is
		// anything else, and the form never leaves the question blank.
		const timeKind = new Setting(this.contentEl).setName(
			`${this.t('form.timeKind')} *`,
		);
		timeKind.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-entity-kind-setting',
		);
		timeKind.addDropdown((dropdown) => {
			for (const kind of TIME_KINDS) {
				dropdown.addOption(kind, this.t(`form.timeKind.${kind}`));
			}
			// Every time note is one of the two, so the field opens on one
			// rather than on a blank nobody chose.
			const current = this.value.timeKind ?? 'point';
			this.value.timeKind = current;
			dropdown.setValue(current).onChange((value) => {
				this.value.timeKind = isTimeKind(value) ? value : 'point';
				// A span belongs to a period alone, so those rows come and go
				// with the answer.
				this.renderForm();
			});
			// A form opened by a field that takes one kind shows which kind that
			// is and holds it: the other answer would make a note the field
			// asking for it could not accept.
			if (this.preset?.lockTimeKind === true) {
				dropdown.setDisabled(true);
				timeKind.settingEl.addClass('is-locked');
			}
		});
	}

	/** A period is the stretch between two points, and names both of them. */
	private buildTimeSpanRows(): void {
		if (this.value.timeKind !== 'period') return;
		// The two ends are one thing said twice, so they share a row of even
		// halves rather than the form's own uneven columns.
		const span = this.contentEl.createDiv({
			cls: 'snowflake-method-entity-span-row',
		});
		const addSpanRow = (
			labelKey: string,
			read: () => string,
			write: (value: string) => void,
		): void => {
			const row = new Setting(span).setName(this.t(labelKey));
			row.settingEl.addClass(
				'snowflake-method-character-setting',
				'snowflake-method-entity-span-setting',
			);
			// Only points, never periods: a period is the stretch between two
			// moments, and a stretch is not a moment.
			const field = new NoteField(
				{
					app: this.app,
					t: this.t,
					options: () => this.formContext.entitiesIn('time-point'),
					create: (name) =>
						this.formContext.createIn('time-point', name, {
							onlyGroup: true,
						}),
					label: this.t(labelKey),
					placeholder: this.t(`${labelKey}.placeholder`),
					createLabel: (name) =>
						this.t('form.record.createEntity', { name }),
					onChange: write,
				},
				read(),
			);
			this.pickers.push(field.attach(row.controlEl));
		};
		addSpanRow(
			'form.timeStart',
			() => this.value.timeStart,
			(value) => {
				this.value.timeStart = value;
			},
		);
		addSpanRow(
			'form.timeEnd',
			() => this.value.timeEnd,
			(value) => {
				this.value.timeEnd = value;
			},
		);
	}

	private buildRecordEditors(): void {
		const context = this.formContext;
		const block = this.contentEl.createDiv({
			cls: 'snowflake-method-record-editors',
		});
		this.worldStatusEditor = new RecordCardsEditor(
			this.recordContext(context, context.worldStatusLabels, 'world-status'),
			context.worldStatusPath,
			this.value.worldStatus,
			{
				title: this.t('form.worldStatus'),
				add: this.t('form.record.addStatus'),
				labelTitle: this.t('form.record.status'),
				labelPlaceholder: this.t('form.definition.placeholder.world-status'),
			},
			false,
			this.worldStatusDrafts,
		);
		this.worldStatusEditor.attach(block);
		this.relationshipsEditor = new RecordCardsEditor(
			this.recordContext(context, context.relationshipLabels, 'relationship'),
			context.relationshipPath,
			this.value.relationships,
			{
				title: this.t('form.relationships'),
				add: this.t('form.record.addRelationship'),
				labelTitle: this.t('form.record.relationship'),
				labelPlaceholder: this.t('form.definition.placeholder.relationship'),
			},
			true,
			this.relationshipDrafts,
		);
		this.relationshipsEditor.attach(block);
	}

	private syncEditors(): void {
		if (this.aliasesField !== null) this.value.aliases = this.aliasesField.get();
		if (this.categoryField !== null) {
			this.value.categoryPaths = this.categoryField.get();
		}
		if (this.worldStatusEditor !== null) {
			this.value.worldStatus = this.worldStatusEditor.records();
			this.worldStatusDrafts = this.worldStatusEditor.drafts();
		}
		if (this.relationshipsEditor !== null) {
			this.value.relationships = this.relationshipsEditor.records();
			this.relationshipDrafts = this.relationshipsEditor.drafts();
		}
	}

	protected renderForm(): void {
		// The form redraws when the time kind changes, which is one field
		// answering for another: whatever the editors hold has to survive it.
		this.syncEditors();
		for (const picker of this.pickers.splice(0)) picker.destroy();
		super.renderForm();
	}

	onClose(): void {
		for (const picker of this.pickers.splice(0)) picker.destroy();
		super.onClose();
	}

	protected collectValue(): EntityFormRequest | null {
		this.value.name = this.value.name.trim();
		if (this.value.name.length === 0) {
			new Notice(this.t('modal.entity.nameRequired'));
			return null;
		}
		const objection = this.name.objection(this.value.name);
		if (objection !== null) {
			new Notice(objection);
			return null;
		}
		// A point is a moment, so it has no ends. Anything a period held before
		// the author made it a point goes with the rows that held it.
		const period =
			this.value.kind === 'time' && this.value.timeKind === 'period';
		const span = period
			? {
					start: this.value.timeStart.trim(),
					end: this.value.timeEnd.trim(),
				}
			: { start: '', end: '' };
		// A period claims the stretch between two moments, so it needs both of
		// them or neither: one end alone names a stretch with no other side.
		if ((span.start.length > 0) !== (span.end.length > 0)) {
			new Notice(this.t('form.period.halfSpan'));
			return null;
		}
		this.syncEditors();
		return { ...this.value, timeStart: span.start, timeEnd: span.end };
	}
}


/** The scene form opened from a field, reporting back what it created. */
class NewScenePrompt extends CreateSceneModal {
	constructor(
		app: App,
		t: Translate,
		characters: CharacterOption[],
		takenTitles: readonly string[],
		presetTitle: string,
		onSubmit: SubmitHandler<CreateSceneRequest>,
		private readonly settle: () => void,
		formContext?: MemberFormContext,
	) {
		super(
			app,
			t,
			characters,
			takenTitles,
			onSubmit,
			undefined,
			null,
			formContext,
			presetTitle,
		);
	}

	onClose(): void {
		super.onClose();
		this.settle();
	}
}

export function promptForNewScene(
	app: App,
	t: Translate,
	characters: CharacterOption[],
	takenTitles: readonly string[],
	presetTitle: string,
	create: (request: CreateSceneRequest) => Promise<PickerOption>,
	formContext?: MemberFormContext,
): Promise<PickerOption | null> {
	return new Promise((resolve) => {
		const outcome: { created: PickerOption | null } = { created: null };
		new NewScenePrompt(
			app,
			t,
			characters,
			takenTitles,
			presetTitle,
			async (request) => {
				outcome.created = await create(request);
			},
			() => resolve(outcome.created),
			formContext,
		).open();
	});
}

/** The worldbuilding form opened from a field, reporting back what it made. */
class NewEntityPrompt extends EntityFormModal {
	constructor(
		app: App,
		t: Translate,
		kind: WorldbuildingKind,
		takenNames: readonly string[],
		formContext: MemberFormContext,
		preset: { name?: string; timeKind?: TimeKind; lockTimeKind?: boolean },
		onSubmit: SubmitHandler<EntityFormRequest>,
		private readonly settle: () => void,
	) {
		super(app, t, kind, takenNames, formContext, onSubmit, undefined, preset);
	}

	onClose(): void {
		super.onClose();
		this.settle();
	}
}

export function promptForNewEntity(
	app: App,
	t: Translate,
	kind: WorldbuildingKind,
	takenNames: readonly string[],
	formContext: MemberFormContext,
	preset: { name?: string; timeKind?: TimeKind; lockTimeKind?: boolean },
	create: (request: EntityFormRequest) => Promise<PickerOption>,
): Promise<PickerOption | null> {
	return new Promise((resolve) => {
		const outcome: { created: PickerOption | null } = { created: null };
		new NewEntityPrompt(
			app,
			t,
			kind,
			takenNames,
			formContext,
			preset,
			async (request) => {
				outcome.created = await create(request);
			},
			() => resolve(outcome.created),
		).open();
	});
}

/**
 * Asks where in the list a row should go, as the 1-based position the order
 * column shows. Dragging moves a row past a neighbour or two; a scene going
 * from the back of three thousand to the front needs its destination named.
 */
export class MoveToPositionModal extends SnowflakeFormModal<number> {
	private position: string;

	constructor(
		app: App,
		t: Translate,
		/** How many entries the list holds, naming the last position there is. */
		private readonly total: number,
		/** The 1-based position the row holds now, offered as the start. */
		current: number,
		onSubmit: SubmitHandler<number>,
	) {
		super(app, t, t('modal.moveToPosition.title'), onSubmit, 'actions.move');
		this.position = String(current);
		this.modalEl.addClass('snowflake-method-project-modal');
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		// The same form the project dialogs use, so moving a row looks like
		// answering any other one-field question the plugin asks.
		this.contentEl.addClass('snowflake-method-project-form');
		new Setting(this.contentEl)
			.setName(this.t('modal.moveToPosition.position', { total: this.total }))
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.inputEl.max = String(this.total);
				text.setValue(this.position).onChange((value) => {
					this.position = value;
				});
				// The one field this form has, so it takes the caret without the
				// author reaching for it. Timed by the window the form is in,
				// which is not the app's when it opened in a popout.
				this.contentEl.win.setTimeout(() => {
					text.inputEl.focus();
					text.inputEl.select();
				}, 0);
			});
	}

	/** The 0-based index the position names, which is what the mover takes. */
	protected collectValue(): number | null {
		const position = Number(this.position.trim());
		if (!Number.isInteger(position) || position < 1 || position > this.total) {
			new Notice(
				this.t('modal.moveToPosition.invalid', { total: this.total }),
			);
			return null;
		}
		return position - 1;
	}
}

export interface MoveAfterEntry {
	id: string;
	/** The 0-based position the entry holds now. */
	index: number;
	/** What the list shows for it: the position and the name. */
	label: string;
}

/**
 * Picks the entry another row should follow. Typing narrows the whole list,
 * so the destination is found by name even when the rows between are off
 * screen or filtered out of the table.
 */
export class MoveAfterModal extends FuzzySuggestModal<MoveAfterEntry> {
	constructor(
		app: App,
		t: Translate,
		/** Every entry the row could follow, so everything except itself. */
		private readonly entries: MoveAfterEntry[],
		private readonly onPick: (entry: MoveAfterEntry) => void,
	) {
		super(app);
		this.setPlaceholder(t('modal.moveAfter.placeholder'));
		// Enough matches to scan, few enough to render at three thousand rows.
		this.limit = 50;
	}

	getItems(): MoveAfterEntry[] {
		return this.entries;
	}

	getItemText(entry: MoveAfterEntry): string {
		return entry.label;
	}

	onChooseItem(entry: MoveAfterEntry): void {
		this.onPick(entry);
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
		/**
		 * Opens a member's own editor and answers with the report as it reads
		 * once that form is done. Null when no editor is reachable.
		 */
		private readonly editMember:
			| ((memberId: string) => Promise<RepairReportViewModel>)
			| null = null,
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
				// One to a line, and by path: a comma-separated tail wraps into a
				// hedge the eye cannot count, and two notes of the same name are
				// only told apart by where they are filed.
				if (entry.names.length > 0) {
					const found = copy.createEl('ul', {
						cls: 'snowflake-method-repair-report-names',
					});
					for (const name of entry.names) found.createEl('li', { text: name });
				}
				// Its own line: what is wrong and what to do about it are separate
				// thoughts, and running them together wraps into an unreadable block.
				// Where the advice is itself two thoughts -- what this button does,
				// and where the name is changed instead -- they are split again.
				for (const line of entry.action?.split('\n') ?? []) {
					copy.createSpan({
						cls: 'snowflake-method-repair-report-action',
						text: line,
					});
				}
				// A project's folder is named by the heading above already, and the
				// path adds nothing when it is the same word twice.
				if (entry.path !== entry.sectionLabel) {
					copy.createEl('small', { text: entry.path });
				}
				this.renderEntryActions(item, entry);
			}
		}
	}

	/**
	 * Every way one entry can be settled, as one split button: the most decisive
	 * way to hand, and the rest a chevron away.
	 *
	 * A repair that needs no decision leads, because it is the one action that
	 * asks nothing of the author; the form comes next, because the decisions
	 * these issues do need are fields in it; the note itself comes last. None of
	 * them is hidden behind the others, though — a repairable issue is often one
	 * an author would rather look at first.
	 */
	private renderEntryActions(
		item: HTMLElement,
		entry: RepairReportViewModel['entries'][number],
	): void {
		const say = (error: unknown): void => {
			new Notice(
				error instanceof Error ? error.message : this.t('errors.unknown'),
			);
		};
		// Opening a note puts it behind this dialog, so the dialog gets out of the
		// way. Nothing else here does: a form stacks on top, and a repair leaves
		// the list to be read again.
		const reach = (opening: Promise<void>): void => {
			void opening.then(() => this.close()).catch(say);
		};
		const memberId = entry.memberId;
		const editMember = memberId === null ? null : this.editMember;
		const actions: Array<{
			label: string;
			icon: string;
			/** True for the one action that settles the row without being asked. */
			decisive?: boolean;
			run: (button: HTMLButtonElement | null) => void;
		}> = [];
		if (entry.repairable) {
			actions.push({
				label: this.t('actions.repairItem'),
				icon: 'wrench',
				decisive: true,
				run: (button) => {
					if (button !== null) button.disabled = true;
					void this.repairItem(entry)
						.then((report) => {
							this.report = report;
							this.onOpen();
						})
						.catch((error: unknown) => {
							if (button !== null) button.disabled = false;
							say(error);
						});
				},
			});
		}
		// A member opens its own editor rather than its raw Markdown: the
		// judgment these issues need — another point of view, another moment,
		// another sentence — is a field in that form rather than something to
		// hand-edit in frontmatter.
		if (entry.canOpen && editMember !== null && memberId !== null) {
			actions.push({
				label: this.t('actions.edit'),
				icon: 'pencil',
				// The form opens on top of this dialog rather than in place of
				// it: an author settling several rows would otherwise have to
				// find their way back to the report after every one. What the
				// form changed is read back into the list when it closes.
				run: () => {
					void editMember(memberId)
						.then((report) => {
							this.report = report;
							this.onOpen();
						})
						.catch(say);
				},
			});
		}
		if (entry.canOpen) {
			actions.push({
				label: this.t('editor.managedSection.openNote'),
				icon: 'file-text',
				run: () => reach(this.openFile(entry.path, entry.sectionId)),
			});
		}
		const primary = actions[0];
		if (primary === undefined) return;
		const itemActions = item.createDiv({
			cls: 'snowflake-method-repair-report-item-actions',
		});
		const split = itemActions.createDiv({
			cls: 'snowflake-method-character-split-button snowflake-method-base-split-button',
		});
		// A repair asks nothing of the author and is done the moment it is
		// pressed, so it carries the accent; reaching the note is an ordinary
		// button. Both halves take the colour, or the chevron would read as a
		// second control rather than the other half of this one.
		const accent = primary.decisive === true ? ' mod-cta' : '';
		const button = split.createEl('button', {
			cls: `snowflake-method-character-edit${accent}`,
			text: primary.label,
			attr: { type: 'button' },
		});
		button.addEventListener('click', () => {
			primary.run(button);
		});
		// The chevron is part of the shape, not of the offer: a row with one way
		// to settle it keeps the same button as every other row, with nothing
		// behind the chevron and no way to press it.
		const only = actions.length === 1;
		const trigger = split.createEl('button', {
			cls: `snowflake-method-character-action-menu-trigger${accent}`,
			attr: {
				type: 'button',
				...(only ? {} : { 'aria-haspopup': 'menu' }),
				'aria-label': this.t('table.actions'),
			},
		});
		trigger.disabled = only;
		setIcon(
			trigger.createSpan({ cls: 'snowflake-method-character-action-menu-icon' }),
			'chevron-down',
		);
		if (only) return;
		trigger.addEventListener('click', (event) => {
			const menu = new Menu();
			menu.setParentElement(split);
			// The others first and the primary last: the button already offers it,
			// so the list reads as what else there is.
			for (const action of [...actions.slice(1), primary]) {
				menu.addItem((entryItem) =>
					entryItem
						.setTitle(action.label)
						.setIcon(action.icon)
						.onClick(() => {
							action.run(null);
						}),
				);
			}
			menu.showAtMouseEvent(event);
		});
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
/** Restoring a base replaces the author's arrangements in it, so it asks. */
export class ConfirmRestoreBaseModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly onResolve: (confirmed: boolean) => void,
	) {
		super(app);
		this.setTitle(t('modal.restoreBase.title'));
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text: this.t('modal.restoreBase.description'),
		});
		const actions = this.contentEl.createDiv({
			cls: 'snowflake-method-modal-actions',
		});
		const cancel = actions.createEl('button', {
			text: this.t('common.cancel'),
			attr: { type: 'button' },
		});
		cancel.addEventListener('click', () => this.close());
		const restore = actions.createEl('button', {
			cls: 'mod-warning',
			text: this.t('modal.restoreBase.action'),
			attr: { type: 'button' },
		});
		restore.addEventListener('click', () => {
			this.confirmed = true;
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		this.onResolve(this.confirmed);
	}
}

/**
 * Asks before a member note that other notes name goes to the trash, and says
 * what naming it costs them. One dialog for all of them, because a character,
 * a scene and a worldbuilding note are named the same way and lose the same
 * things when they go.
 */
export class ConfirmMemberDeletionModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly memberName: string,
		private readonly usage: MemberUsage,
		private readonly onResolve: (confirmed: boolean) => void,
	) {
		super(app);
		this.setTitle(t('modal.deleteMember.title', { name: memberName }));
		this.modalEl.addClass('snowflake-method-delete-member-modal');
	}

	onOpen(): void {
		this.contentEl.empty();
		const affected = new Set([
			...this.usage.needsDecision,
			...this.usage.listed,
			...this.usage.records,
		]).size;
		this.contentEl.createEl('p', {
			text: this.t('modal.deleteMember.description', {
				name: this.memberName,
				count: affected,
			}),
		});
		this.addNoteList(
			this.t('modal.deleteMember.needsDecision'),
			this.usage.needsDecision,
			true,
		);
		this.addNoteList(
			this.t('modal.deleteMember.listed', { name: this.memberName }),
			this.usage.listed,
			false,
		);
		this.addNoteList(
			this.t('modal.deleteMember.records'),
			this.usage.records,
			true,
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

	private addNoteList(
		label: string,
		titles: readonly string[],
		needsDecision: boolean,
	): void {
		if (titles.length === 0) return;
		const group = this.contentEl.createDiv({
			cls: `snowflake-method-delete-member-group${
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

/**
 * Asks whether two manuscript notes should be joined, resolving true only if
 * the author said so.
 *
 * A merge is the one manuscript action that takes a note away, and undoing it
 * means splitting again at a seam nothing records. Every other action here is
 * either reversible or asks for a name first; this asks for the same pause.
 */
export function confirmSegmentMerge(
	app: App,
	t: Translate,
	kept: string,
	removed: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmSegmentMergeModal(app, t, kept, removed, resolve).open();
	});
}

/**
 * Built to the shape of Obsidian's own delete prompt — the question and its
 * consequence as two paragraphs, and the buttons in a `modal-button-container`
 * below the content rather than inside it, cancel plain and the destructive one
 * red. An author being asked whether to throw a note away should be looking at
 * the dialog they already know, not at this plugin's idea of one.
 */
class ConfirmSegmentMergeModal extends Modal {
	private confirmed = false;
	private buttons: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly kept: string,
		private readonly removed: string,
		private readonly onResolve: (confirmed: boolean) => void,
	) {
		super(app);
		this.setTitle(t('modal.mergeSegments.title'));
		this.modalEl.addClass('snowflake-method-merge-segments-modal');
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			// A note is named after a file and can be as long as one, so it wraps
			// the way Obsidian wraps a filename rather than widening the dialog.
			cls: 'u-break-word',
			text: this.t('modal.mergeSegments.question', {
				removed: this.removed,
				kept: this.kept,
			}),
		});
		this.contentEl.createEl('p', {
			text: this.t('modal.mergeSegments.consequence'),
		});

		const buttons = this.modalEl.createDiv({ cls: 'modal-button-container' });
		this.buttons = buttons;
		const cancel = buttons.createEl('button', {
			cls: 'mod-cancel',
			text: this.t('common.cancel'),
			attr: { type: 'button' },
		});
		cancel.addEventListener('click', () => {
			this.close();
		});
		const merge = buttons.createEl('button', {
			cls: 'mod-cta mod-destructive',
			text: this.t('actions.merge'),
			attr: { type: 'button' },
		});
		merge.addEventListener('click', () => {
			this.confirmed = true;
			this.close();
		});
		// Where Obsidian puts it on its own delete prompt, so Return answers this
		// dialog the way it answers that one. Left on cancel it draws a ring round
		// the button nobody is looking at. Deferred because opening a modal moves
		// the focus to the first thing in it once this method has returned, which
		// would undo a call made here.
		this.contentEl.win.setTimeout(() => {
			merge.focus();
		}, 0);
	}

	onClose(): void {
		this.contentEl.empty();
		// The buttons hang off the modal rather than off its content, so emptying
		// the content leaves them behind.
		this.buttons?.remove();
		this.buttons = null;
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
