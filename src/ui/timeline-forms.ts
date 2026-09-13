/**
 * The dialogs the timeline workspace opens: a name for a timeline or a view,
 * a new timeline with the entity it follows, a view made or edited over
 * the timelines it shows, and the one confirmation every removal here asks
 * through. Each is a labelled form, as every form the plugin opens is.
 */

import { FuzzySuggestModal, Modal, Notice, Setting, setIcon, setTooltip, type App } from 'obsidian';

import type { EntityRef, EntityRosterEntry, Timeline } from '../domain';
import { entityGroupLabel, renderRecordPickFrame, wireCardDrag } from './entity-form';
import {
	ConfirmModal,
	SnowflakeFormModal,
	UniqueNameField,
	type SubmitHandler,
	type Translate,
} from './modals';
import { buildOptionField, type OptionPicker, type PickerOption } from './option-picker';

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
		// The same form the project dialogs use, so naming a timeline or a view
		// looks like naming anything else rather than like a settings page.
		this.contentEl.addClass('snowflake-method-project-form');
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
	private picker: OptionPicker | null = null;

	constructor(
		app: App,
		t: Translate,
		private readonly options: {
			takenNames: readonly string[];
			/** Who the timeline may follow: the cast and every kind but time, as the project stands. */
			roster: () => readonly EntityRosterEntry[];
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
		this.contentEl.addClass('snowflake-method-project-form');
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
		// The binding is typed into, searched and picked from, as a form's
		// category is, the cast and each kind under a heading of its own. A
		// field of this kind changes only by a pick, so None stands first
		// among the rows for a timeline that follows nobody.
		const binding = new Setting(this.contentEl)
			.setName(this.t('timeline.timeline.entity'))
			.setDesc(this.t('timeline.timeline.entityHint'));
		this.picker?.destroy();
		this.picker = buildOptionField(
			this.app,
			binding.controlEl.createDiv({ cls: 'snowflake-method-timeline-picker' }),
			{
				options: () => [
					{ value: '', label: this.t('timeline.timeline.entityNone') },
					...this.options.roster().map((entry) => ({
						value: entry.id,
						label: entry.name,
						section: entityGroupLabel(this.t, entry.group),
					})),
				],
				label: this.t('timeline.timeline.entity'),
				placeholder: this.t('timeline.timeline.entityNone'),
				emptyPlaceholder: this.t('timeline.timeline.entityNone'),
				value: () => this.value.binding?.id ?? '',
				choose: (value) => {
					const entry = this.options.roster().find((candidate) => candidate.id === value);
					this.value.binding =
						entry === undefined ? null : { kind: entry.kind, id: entry.id, name: entry.name };
				},
				dress: (el, option) => {
					el.toggleClass('is-none', option === null || option.value === '');
				},
			},
		);
		if (this.options.offerView) {
			// A field like the ones above it in name, on one line with its
			// switch at the end: a switch is not a box the width of the form.
			const join = new Setting(this.contentEl)
				.setName(this.t('timeline.timeline.addToView'))
				.addToggle((toggle) => {
					toggle.setValue(this.value.addToView).onChange((value) => {
						this.value.addToView = value;
					});
				});
			join.settingEl.addClass('snowflake-method-timeline-switch-setting');
		}
	}

	onClose(): void {
		this.picker?.destroy();
		this.picker = null;
		super.onClose();
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

/** The times offered when a sub-description moves within its timeline. */
export class TimelineTimePickModal extends FuzzySuggestModal<PickerOption> {
	constructor(
		app: App,
		placeholder: string,
		private readonly times: readonly PickerOption[],
		private readonly pick: (time: PickerOption) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): PickerOption[] {
		return [...this.times];
	}

	getItemText(time: PickerOption): string {
		return time.label;
	}

	onChooseItem(time: PickerOption): void {
		this.pick(time);
	}
}

/** The timelines the project has that a view does not show yet, picked by name. */
class TimelinePickModal extends FuzzySuggestModal<Timeline> {
	constructor(
		app: App,
		placeholder: string,
		private readonly timelines: readonly Timeline[],
		private readonly pick: (timeline: Timeline) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): Timeline[] {
		return [...this.timelines];
	}

	getItemText(timeline: Timeline): string {
		return timeline.name;
	}

	onChooseItem(timeline: Timeline): void {
		this.pick(timeline);
	}
}

/**
 * A view made, or one edited: the name, and the timelines it shows as
 * lines under the field, as a scene's manuscript notes stand under theirs:
 * each with a handle to drag it into its place among them, its name, and
 * a way to take it off. Under the lines, a frame adds a timeline the
 * project already has; by the field's name, a plus makes one on the spot,
 * and it joins the lines. Editing puts Delete at the start of the foot.
 */
export class TimelineViewFormModal extends SnowflakeFormModal<TimelineViewDraft> {
	private nameValue: string;
	private readonly name: UniqueNameField;
	/** The timelines the view shows, in its order. */
	private timelines: string[];
	private lines: HTMLElement | null = null;
	private frame: ReturnType<typeof renderRecordPickFrame> | null = null;
	private picker: TimelinePickModal | null = null;
	private closed = false;
	private readonly dragState: { dragging: string | null } = { dragging: null };

	constructor(
		app: App,
		t: Translate,
		private readonly options: {
			mode: 'add' | 'edit';
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
			t(options.mode === 'add' ? 'timeline.view.add' : 'timeline.view.edit'),
			onSubmit,
			options.mode === 'add' ? 'common.create' : 'common.save',
		);
		this.nameValue = options.initial.name;
		this.name = new UniqueNameField(
			options.takenNames,
			options.mode === 'edit' ? options.initial.name : null,
			() => this.t('timeline.view.nameTaken'),
		);
		this.timelines = [...options.initial.timelines];
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-project-form');
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
		const timelines = new Setting(this.contentEl).setName(this.t('timeline.view.timelines'));
		timelines.settingEl.addClass('snowflake-method-timeline-view-setting');
		// The plus by the field's name makes a timeline on the spot, and it joins the lines.
		const make = timelines.infoEl.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-view-make',
			attr: { type: 'button', 'aria-label': this.t('timeline.addTimeline') },
		});
		setIcon(make, 'plus');
		setTooltip(make, this.t('timeline.addTimeline'));
		make.addEventListener('click', () => {
			if (this.closed) return;
			void this.options.addTimeline().then((id) => {
				if (id === null || this.closed) return;
				if (!this.timelines.includes(id)) this.timelines.push(id);
				this.paintLines();
			});
		});
		const block = timelines.controlEl.createDiv({ cls: 'snowflake-method-timeline-view-timelines' });
		this.lines = block.createDiv({ cls: 'snowflake-method-record-lines' });
		// The frame under the lines adds a timeline the project has and the view does not show.
		this.frame = renderRecordPickFrame(block, '', () => {
			const offered = this.available();
			if (offered.length === 0 || this.closed) return;
			this.picker?.close();
			const picker = new TimelinePickModal(this.app, this.t('timeline.view.addExisting'), offered, (timeline) => {
				if (this.closed || this.timelines.includes(timeline.id)) return;
				this.timelines.push(timeline.id);
				this.paintLines();
			});
			const closed = picker.onClose.bind(picker);
			picker.onClose = (): void => {
				if (this.picker === picker) this.picker = null;
				closed();
			};
			this.picker = picker;
			picker.open();
		});
		this.paintLines();
	}

	/** The project's timelines the view does not show yet. */
	private available(): Timeline[] {
		return this.options.timelines().filter((timeline) => !this.timelines.includes(timeline.id));
	}

	/** The lines, one per timeline shown, remade whole: the list is short and the order moves. */
	private paintLines(): void {
		const lines = this.lines;
		if (lines === null) return;
		lines.empty();
		const known = this.options.timelines();
		// A timeline the project no longer has leaves the view with the save.
		this.timelines = this.timelines.filter((id) => known.some((timeline) => timeline.id === id));
		for (const id of this.timelines) {
			const timeline = known.find((candidate) => candidate.id === id);
			if (timeline === undefined) continue;
			const el = lines.createDiv({ cls: 'snowflake-method-record-line snowflake-method-timeline-view-line' });
			const handle = el.createEl('button', {
				cls: 'clickable-icon snowflake-method-timeline-view-handle',
				attr: { type: 'button', 'aria-label': this.t('form.record.reorder') },
			});
			setIcon(handle, 'grip-vertical');
			el.createDiv({ cls: 'snowflake-method-record-line-value', text: timeline.name });
			const remove = el.createEl('button', {
				cls: 'snowflake-method-record-line-remove clickable-icon',
				attr: { type: 'button', 'aria-label': this.t('timeline.view.remove', { name: timeline.name }) },
			});
			setIcon(remove, 'circle-minus');
			remove.addEventListener('click', () => {
				this.timelines = this.timelines.filter((candidate) => candidate !== id);
				this.paintLines();
			});
			// A drop puts the dragged line in this one's place; from the
			// keyboard, the handle walks its line one step at a time.
			wireCardDrag(el, handle, this.dragState, id, (dragged) => {
				this.moveLine(dragged, id);
			});
			handle.addEventListener('keydown', (event) => {
				const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
				if (step === 0) return;
				event.preventDefault();
				const other = this.timelines[this.timelines.indexOf(id) + step];
				if (other === undefined) return;
				this.moveLine(id, other);
				this.focusHandle(id);
			});
		}
		const offered = this.available();
		this.frame?.setPlaceholder(this.t(
			known.length === 0
				? 'timeline.view.noTimelines'
				: offered.length === 0
					? 'timeline.view.allShown'
					: 'timeline.view.addExisting',
		));
		this.frame?.setDisabled(offered.length === 0);
	}

	/**
	 * Puts a line in another's place: after it when brought down, before it
	 * when brought up, as a record card goes among its rows.
	 */
	private moveLine(id: string, target: string): void {
		const from = this.timelines.indexOf(id);
		const to = this.timelines.indexOf(target);
		if (from === -1 || to === -1 || from === to) return;
		const next = [...this.timelines];
		next.splice(from, 1);
		next.splice(to, 0, id);
		this.timelines = next;
		this.paintLines();
	}

	private focusHandle(id: string): void {
		const line = this.lines?.children[this.timelines.indexOf(id)];
		line?.querySelector<HTMLElement>('.snowflake-method-timeline-view-handle')?.focus();
	}

	/** Delete, at the start of the foot across from Save, when the view stands to be taken away. */
	protected leadingActions(actions: HTMLElement): void {
		const deleteView = this.options.deleteView;
		if (deleteView === undefined) return;
		const button = actions.createEl('button', {
			cls: 'mod-warning snowflake-method-modal-leading-action',
			text: this.t('actions.delete'),
			attr: { type: 'button' },
		});
		button.addEventListener('click', () => {
			if (this.closed) return;
			void deleteView().then((gone) => {
				if (gone && !this.closed) this.close();
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
		return { name, timelines: [...this.timelines] };
	}

	onClose(): void {
		this.closed = true;
		this.picker?.close();
		this.picker = null;
		this.lines = null;
		this.frame = null;
		super.onClose();
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
	keep: <T extends Modal>(modal: T) => T = (modal) => modal,
): Promise<boolean> {
	return new Promise((resolve) => {
		keep(new TimelineConfirmModal(app, t, spec, resolve)).open();
	});
}

/** A sub-description's words that could not be written, and where they were meant to stand. */
export interface RecoveredTimelineDraft {
	place: string;
	words: string;
}

/** Keeps refused sub-description text outside the workspace that has already gone. */
export class TimelineDraftModal extends Modal {
	constructor(app: App, private readonly t: Translate, private readonly drafts: readonly RecoveredTimelineDraft[]) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.t('timeline.draftRecovery.title'));
		const root = this.contentEl;
		root.empty();
		root.createEl('p', { text: this.t('timeline.draftRecovery.description') });
		for (const draft of this.drafts) {
			root.createEl('h3', { text: draft.place });
			const input = root.createEl('textarea', {
				cls: 'snowflake-method-corkboard-recovered-text',
				attr: { 'aria-label': this.t('timeline.subrow.label'), rows: '4' },
			});
			input.readOnly = true;
			input.value = draft.words;
		}
		root.createEl('button', { text: this.t('common.close'), attr: { type: 'button' } })
			.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
