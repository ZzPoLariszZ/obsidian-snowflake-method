import { type App, Notice, Setting } from 'obsidian';

import {
	DEFAULT_TASK_PRIORITY,
	DEFAULT_TASK_STATUS,
	TASK_PRIORITIES,
	TASK_STATUSES,
	isTaskDay,
	isTaskPriority,
	isTaskStatus,
	type EntityRosterEntry,
	type TaskEdit,
	type TaskPriority,
	type TaskStatus,
} from '../domain';
import { addEnumSelect } from './entity-form';
import {
	SnowflakeFormModal,
	UniqueNameField,
	type SubmitHandler,
	type Translate,
} from './modals';
import { RelatedEntitiesField } from './related-entities-field';

/**
 * The task's own form: the title with the rule the thread form holds a name
 * to, the note about it, the column on the title row where a thread wears
 * its status, how pressing it is, the day it is due, and the entities it is
 * about through the field the thread form shares. One shape for creating
 * and editing; what the form hands back is exactly what the service writes.
 */

export interface TaskFormOptions {
	title: string;
	submitLabelKey: string;
	/** Every entity a task can be about. */
	roster: readonly EntityRosterEntry[];
	/** The titles the project's other tasks already answer to; an edit passes every one but its own. */
	takenNames: readonly string[];
	initial?: TaskEdit;
	/** The column a new task opens in, when the board's Add was pressed there. */
	initialStatus?: TaskStatus;
}

class TaskModal extends SnowflakeFormModal<TaskEdit> {
	private title: string;
	/** The rule the title is held to: not one another task answers to. */
	private readonly uniqueName: UniqueNameField;
	private description: string;
	private status: TaskStatus;
	private priority: TaskPriority;
	/** As the date field holds it: a day, or nothing. */
	private dueDate: string;
	private readonly relatedField: RelatedEntitiesField;

	constructor(
		app: App,
		t: Translate,
		private readonly options: TaskFormOptions,
		onSubmit: SubmitHandler<TaskEdit>,
		private readonly settle: () => void,
	) {
		super(app, t, options.title, onSubmit, options.submitLabelKey);
		this.modalEl.addClass('snowflake-method-character-modal', 'snowflake-method-task-modal');
		const initial = options.initial;
		this.title = initial?.title ?? '';
		this.uniqueName = new UniqueNameField(
			options.takenNames,
			initial?.title ?? null,
			() => this.t('modal.task.nameTaken'),
		);
		this.description = initial?.description ?? '';
		this.status = initial?.status ?? options.initialStatus ?? DEFAULT_TASK_STATUS;
		this.priority = initial?.priority ?? DEFAULT_TASK_PRIORITY;
		this.dueDate = initial?.dueDate ?? '';
		this.relatedField = new RelatedEntitiesField(
			app,
			t,
			options.roster,
			initial?.related ?? [],
			{
				placeholder: t('modal.task.relatedPlaceholder'),
				empty: t('modal.task.relatedEmpty'),
				missingTitle: (name) => t('modal.task.relatedMissing', { name }),
				removeLabel: (name) => t('modal.task.relatedRemove', { name }),
			},
		);
	}

	protected buildForm(): void {
		const t = this.t;
		this.contentEl.addClass('snowflake-method-character-form', 'snowflake-method-task-form');
		// The column, worn where a thread wears its status: a bare select on
		// the title row, always holding one of the six.
		addEnumSelect(this.titleControls(), {
			cls: 'dropdown snowflake-method-status-select',
			ariaLabel: t('modal.task.status'),
			values: TASK_STATUSES,
			label: (status) => t(`tasks.status.${status}`),
			initial: this.status,
			is: isTaskStatus,
			fallback: this.status,
			onChange: (value) => {
				this.status = value;
			},
		});
		let titleInput: HTMLInputElement | null = null;
		const titleSetting = new Setting(this.contentEl)
			.setName(`${t('modal.task.name')} *`)
			.addText((text) => {
				titleInput = text.inputEl;
				text.setValue(this.title).onChange((value) => {
					this.title = value;
					// On every keystroke, so a title already taken is answered
					// while it is still being typed rather than at Save.
					this.uniqueName.show(value);
				});
				// The field the author came to type in, when the task is new;
				// an edit opens with nothing focused, like every form.
				if (this.options.initial === undefined) {
					this.contentEl.win.setTimeout(() => {
						text.inputEl.focus();
					}, 0);
				}
			});
		titleSetting.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-character-name-setting',
		);
		// The line under the field, kept whether or not it has anything to
		// say, so an objection never moves the form under the author.
		this.uniqueName.attach(titleSetting.settingEl, titleInput, this.title);
		// The day and the weight share the title's row, the weight in the
		// column the status above it was sized to.
		const dueSetting = new Setting(this.contentEl)
			.setName(t('modal.task.dueDate'))
			.addText((text) => {
				// The browser's own day picker; what it hands back is a day or
				// nothing, and Save checks it is a day all the same.
				text.inputEl.type = 'date';
				text.setValue(this.dueDate).onChange((value) => {
					this.dueDate = value;
				});
			});
		dueSetting.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-task-due-setting',
		);
		const prioritySetting = new Setting(this.contentEl)
			.setName(t('modal.task.priority'))
			.addDropdown((dropdown) => {
				for (const priority of TASK_PRIORITIES) {
					dropdown.addOption(priority, t(`tasks.priority.${priority}`));
				}
				dropdown.setValue(this.priority).onChange((value) => {
					this.priority = isTaskPriority(value) ? value : this.priority;
				});
			});
		prioritySetting.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-task-priority-setting',
		);
		const descriptionSetting = new Setting(this.contentEl)
			.setName(t('modal.task.description'))
			.addTextArea((area) => {
				area
					.setPlaceholder(t('form.description.placeholder'))
					.setValue(this.description)
					.onChange((value) => {
						this.description = value;
					});
			});
		descriptionSetting.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-task-description-setting',
		);
		const relatedSetting = new Setting(this.contentEl).setName(t('modal.task.related'));
		relatedSetting.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-task-related-setting',
		);
		this.relatedField.render(relatedSetting.controlEl, 'snowflake-method-foreshadowing-related');
	}

	onClose(): void {
		super.onClose();
		this.settle();
	}

	protected collectValue(): TaskEdit | null {
		const title = this.title.trim();
		if (title.length === 0) {
			new Notice(this.t('modal.task.nameRequired'));
			return null;
		}
		const objection = this.uniqueName.objection(title);
		if (objection !== null) {
			// As a notice too, so the answer reaches a form scrolled past it.
			new Notice(objection);
			return null;
		}
		const due = this.dueDate.trim();
		if (due.length > 0 && !isTaskDay(due)) {
			new Notice(this.t('modal.task.dueInvalid'));
			return null;
		}
		return {
			title,
			description: this.description.trim(),
			status: this.status,
			priority: this.priority,
			dueDate: due.length === 0 ? null : due,
			related: this.relatedField.value(),
		};
	}
}

/**
 * Opens the task's form and resolves when it closes, whichever way. The
 * work happens in `onSubmit`; throwing from it keeps the form open with a
 * notice, which is how a refused write is answered.
 */
export function promptForTask(
	app: App,
	t: Translate,
	options: TaskFormOptions,
	onSubmit: SubmitHandler<TaskEdit>,
): Promise<void> {
	return new Promise((resolve) => {
		new TaskModal(app, t, options, onSubmit, resolve).open();
	});
}
