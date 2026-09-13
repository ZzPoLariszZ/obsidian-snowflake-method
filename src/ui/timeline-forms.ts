/**
 * The dialogs the timeline workspace opens: a name for a timeline or a view,
 * a new timeline with the entity it follows, a view made or managed over
 * the timelines it shows, and the one confirmation every removal here asks
 * through. Each is a labelled form, as every form the plugin opens is.
 */

import { Notice, Setting, type App } from 'obsidian';

import type { EntityRef, Timeline } from '../domain';
import {
	ConfirmModal,
	SnowflakeFormModal,
	UniqueNameField,
	type SubmitHandler,
	type Translate,
} from './modals';

interface NameFormSpec {
	title: string;
	label: string;
	initial: string;
	takenNames: readonly string[];
	requiredKey: string;
	takenKey: string;
	submitLabelKey: string;
}

/** A form that asks for one name, as renaming a project does. */
class NameFormModal extends SnowflakeFormModal<string> {
	private value: string;
	private readonly name: UniqueNameField;

	constructor(
		app: App,
		t: Translate,
		private readonly spec: NameFormSpec,
		onSubmit: SubmitHandler<string>,
	) {
		super(app, t, spec.title, onSubmit, spec.submitLabelKey);
		this.value = spec.initial;
		this.name = new UniqueNameField(
			spec.takenNames,
			spec.initial.length > 0 ? spec.initial : null,
			() => this.t(spec.takenKey),
		);
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		let inputEl: HTMLInputElement | null = null;
		const name = new Setting(this.contentEl)
			.setName(this.spec.label)
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
			new Notice(this.t(this.spec.requiredKey));
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

export function renameTimelineForm(
	app: App,
	t: Translate,
	current: string,
	takenNames: readonly string[],
	onSubmit: SubmitHandler<string>,
): NameFormModal {
	return new NameFormModal(app, t, {
		title: t('timeline.timeline.renameTitle'),
		label: t('timeline.timeline.name'),
		initial: current,
		takenNames,
		requiredKey: 'timeline.timeline.nameRequired',
		takenKey: 'timeline.timeline.nameTaken',
		submitLabelKey: 'common.save',
	}, onSubmit);
}

export function renameTimelineViewForm(
	app: App,
	t: Translate,
	current: string,
	takenNames: readonly string[],
	onSubmit: SubmitHandler<string>,
): NameFormModal {
	return new NameFormModal(app, t, {
		title: t('timeline.view.rename'),
		label: t('timeline.view.name'),
		initial: current,
		takenNames,
		requiredKey: 'timeline.view.nameRequired',
		takenKey: 'timeline.view.nameTaken',
		submitLabelKey: 'common.save',
	}, onSubmit);
}

/** What the Add timeline form hands back. */
export interface TimelineDraft {
	name: string;
	binding: EntityRef | null;
	/** Whether the new timeline joins the view standing open. */
	addToView: boolean;
}

export class AddTimelineModal extends SnowflakeFormModal<TimelineDraft> {
	private readonly value: TimelineDraft;
	private readonly name: UniqueNameField;
	private bindingName: HTMLElement | null = null;

	constructor(
		app: App,
		t: Translate,
		private readonly options: {
			takenNames: readonly string[];
			/** Asks for the entity the timeline follows; null when the author closes the picker. */
			pickBinding: () => Promise<EntityRef | null>;
			/** Whether a view stands open for the timeline to join. */
			offerView: boolean;
		},
		onSubmit: SubmitHandler<TimelineDraft>,
	) {
		super(app, t, t('timeline.addTimeline'), onSubmit, 'common.create');
		this.value = { name: '', binding: null, addToView: options.offerView };
		this.name = new UniqueNameField(options.takenNames, null, () =>
			this.t('timeline.timeline.nameTaken'),
		);
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		let inputEl: HTMLInputElement | null = null;
		const name = new Setting(this.contentEl)
			.setName(this.t('timeline.timeline.name'))
			.addText((text) => {
				inputEl = text.inputEl;
				text.setValue(this.value.name).onChange((value) => {
					this.value.name = value;
					this.name.show(value);
				});
			});
		this.name.attach(name.settingEl, inputEl, this.value.name);
		const binding = new Setting(this.contentEl)
			.setName(this.t('timeline.timeline.entity'))
			.setDesc(this.t('timeline.timeline.entityHint'));
		this.bindingName = binding.controlEl.createSpan({
			cls: 'snowflake-method-timeline-binding-name',
		});
		binding
			.addButton((button) => {
				button.setButtonText(this.t('timeline.timeline.entityChoose')).onClick(async () => {
					const picked = await this.options.pickBinding();
					if (picked === null) return;
					this.value.binding = picked;
					this.paintBinding();
				});
			})
			.addExtraButton((button) => {
				button.setIcon('x').setTooltip(this.t('common.remove')).onClick(() => {
					this.value.binding = null;
					this.paintBinding();
				});
			});
		this.paintBinding();
		if (this.options.offerView) {
			new Setting(this.contentEl)
				.setName(this.t('timeline.timeline.addToView'))
				.addToggle((toggle) => {
					toggle.setValue(this.value.addToView).onChange((value) => {
						this.value.addToView = value;
					});
				});
		}
	}

	private paintBinding(): void {
		const binding = this.value.binding;
		this.bindingName?.setText(binding === null ? this.t('timeline.timeline.entityNone') : binding.name);
		this.bindingName?.toggleClass('is-empty', binding === null);
	}

	protected collectValue(): TimelineDraft | null {
		const name = this.value.name.trim();
		if (name.length === 0) {
			new Notice(this.t('timeline.timeline.nameRequired'));
			return null;
		}
		const objection = this.name.objection(name);
		if (objection !== null) {
			new Notice(objection);
			return null;
		}
		return { ...this.value, name };
	}
}

/** What the view forms hand back: the name, and the timelines shown in order. */
export interface TimelineViewDraft {
	name: string;
	timelines: string[];
}

/**
 * A view made, or one managed: the name, and a checklist of every timeline
 * the project has, in the order the view shows them, with a way to make a
 * timeline on the spot. Managing adds Move up and Move down to the ones
 * checked, and puts Delete view at the foot with the other buttons.
 */
export class TimelineViewFormModal extends SnowflakeFormModal<TimelineViewDraft> {
	private nameValue: string;
	private readonly name: UniqueNameField;
	/** Every timeline in the order the list shows: the view's own first, the rest after. */
	private order: string[];
	private readonly checked: Set<string>;
	private list: HTMLElement | null = null;

	constructor(
		app: App,
		t: Translate,
		private readonly options: {
			mode: 'add' | 'manage';
			takenNames: readonly string[];
			initial: TimelineViewDraft;
			/** The project's timelines as they stand now, re-read after one is made. */
			timelines: () => readonly Timeline[];
			/** Makes a timeline on the spot; its id, or null when the author closed the form. */
			addTimeline: () => Promise<string | null>;
			/** Takes the view out, confirmation and all; true when it went. */
			deleteView?: () => Promise<boolean>;
		},
		onSubmit: SubmitHandler<TimelineViewDraft>,
	) {
		super(
			app,
			t,
			t(options.mode === 'add' ? 'timeline.view.add' : 'timeline.view.manage'),
			onSubmit,
			options.mode === 'add' ? 'common.create' : 'common.save',
		);
		this.nameValue = options.initial.name;
		this.name = new UniqueNameField(
			options.takenNames,
			options.mode === 'manage' ? options.initial.name : null,
			() => this.t('timeline.view.nameTaken'),
		);
		this.checked = new Set(options.initial.timelines);
		this.order = [...options.initial.timelines];
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		let inputEl: HTMLInputElement | null = null;
		const name = new Setting(this.contentEl)
			.setName(this.t('timeline.view.name'))
			.addText((text) => {
				inputEl = text.inputEl;
				text.setValue(this.nameValue).onChange((value) => {
					this.nameValue = value;
					this.name.show(value);
				});
			});
		this.name.attach(name.settingEl, inputEl, this.nameValue);
		new Setting(this.contentEl)
			.setName(this.t('timeline.view.timelines'))
			.setDesc(this.t('timeline.view.timelinesHint'))
			.setHeading();
		this.list = this.contentEl.createDiv({ cls: 'snowflake-method-timeline-view-list' });
		this.paintList();
		new Setting(this.contentEl).addButton((button) => {
			button.setButtonText(this.t('timeline.addTimeline')).onClick(async () => {
				const id = await this.options.addTimeline();
				if (id === null) return;
				this.checked.add(id);
				if (!this.order.includes(id)) this.order.push(id);
				this.paintList();
			});
		});
	}

	/** The rows, one per timeline, remade whole: the list is short and the order moves. */
	private paintList(): void {
		const list = this.list;
		if (list === null) return;
		list.empty();
		const timelines = this.options.timelines();
		const known = new Set(timelines.map((timeline) => timeline.id));
		// The view's own order first; a timeline the view lacks joins at the end.
		this.order = [
			...this.order.filter((id) => known.has(id)),
			...timelines.map((timeline) => timeline.id).filter((id) => !this.order.includes(id)),
		];
		if (this.order.length === 0) {
			list.createEl('p', {
				cls: 'snowflake-method-timeline-view-list-empty',
				text: this.t('timeline.view.noTimelines'),
			});
			return;
		}
		const shown = this.order.filter((id) => this.checked.has(id));
		for (const id of this.order) {
			const timeline = timelines.find((candidate) => candidate.id === id);
			if (timeline === undefined) continue;
			const row = new Setting(list).setName(timeline.name);
			const checked = this.checked.has(id);
			if (this.options.mode === 'manage' && checked) {
				const at = shown.indexOf(id);
				row.addExtraButton((button) => {
					button.setIcon('arrow-up').setTooltip(this.t('actions.moveUp')).setDisabled(at <= 0)
						.onClick(() => { this.move(id, -1); });
				});
				row.addExtraButton((button) => {
					button.setIcon('arrow-down').setTooltip(this.t('actions.moveDown'))
						.setDisabled(at === -1 || at >= shown.length - 1)
						.onClick(() => { this.move(id, 1); });
				});
			}
			row.addToggle((toggle) => {
				toggle.setValue(checked).onChange((value) => {
					if (value) this.checked.add(id);
					else this.checked.delete(id);
					if (this.options.mode === 'manage') this.paintList();
				});
			});
		}
	}

	/** Swaps a checked timeline with its checked neighbour, one step up or down. */
	private move(id: string, step: -1 | 1): void {
		const shown = this.order.filter((candidate) => this.checked.has(candidate));
		const at = shown.indexOf(id);
		const other = shown[at + step];
		if (at === -1 || other === undefined) return;
		const from = this.order.indexOf(id);
		const to = this.order.indexOf(other);
		this.order[from] = other;
		this.order[to] = id;
		this.paintList();
	}

	protected leadingActions(actions: HTMLElement): void {
		const deleteView = this.options.deleteView;
		if (deleteView === undefined) return;
		const button = actions.createEl('button', {
			cls: 'mod-warning',
			text: this.t('timeline.view.delete'),
			attr: { type: 'button' },
		});
		button.addEventListener('click', () => {
			void deleteView().then((gone) => {
				if (gone) this.close();
			});
		});
	}

	protected collectValue(): TimelineViewDraft | null {
		const name = this.nameValue.trim();
		if (name.length === 0) {
			new Notice(this.t('timeline.view.nameRequired'));
			return null;
		}
		const objection = this.name.objection(name);
		if (objection !== null) {
			new Notice(objection);
			return null;
		}
		return { name, timelines: this.order.filter((id) => this.checked.has(id)) };
	}
}

/** One confirmation for every removal the workspace asks about. */
class TimelineConfirmModal extends ConfirmModal {
	constructor(
		app: App,
		t: Translate,
		private readonly spec: { title: string; lines: readonly string[]; label: string },
		onResolve: (confirmed: boolean) => void,
	) {
		super(app, t, { label: spec.label, style: 'mod-warning' }, onResolve);
		this.setTitle(spec.title);
		this.modalEl.addClass('snowflake-method-delete-member-modal');
	}

	protected renderBody(body: HTMLElement): void {
		for (const line of this.spec.lines) body.createEl('p', { text: line });
	}
}

export function confirmTimelineAction(
	app: App,
	t: Translate,
	spec: { title: string; lines: readonly string[]; label: string },
): Promise<boolean> {
	return new Promise((resolve) => {
		new TimelineConfirmModal(app, t, spec, resolve).open();
	});
}
