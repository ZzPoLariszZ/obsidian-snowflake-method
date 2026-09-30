/**
 * The dialogs the freeform workspace opens: a view made or edited, nodes
 * added by type, a node's size and place set by number, a line's words and
 * look, and the words of a text node the project would not take. Each is a labelled form, as every
 * form the plugin opens is. A view is named as the timeline's views are, in
 * the timeline's own words; the confirmation a view's removal asks through
 * is the timeline's too, which says nothing of timelines.
 */

import { Modal, Notice, Setting, type App } from 'obsidian';

import {
	FREEFORM_ARROWS,
	FREEFORM_LINES,
	FREEFORM_SIZE,
	isFreeformArrow,
	isFreeformLine,
	type FreeformArrow,
	type FreeformLine,
} from '../domain';
import { addEnumSelect } from './entity-form';
import {
	SnowflakeFormModal,
	UniqueNameField,
	type SubmitHandler,
	type Translate,
} from './modals';
import { buildOptionField, buildOptionPicker, type OptionPicker, type PickerOption } from './option-picker';

export interface FreeformViewFormOptions {
	mode: 'add' | 'edit';
	initial: string;
	/** The names every other view of the project answers to. */
	takenNames: readonly string[];
	/** Takes the view out, confirmation and all; true when it went. Offered only where a view is edited. */
	deleteView?: () => Promise<boolean>;
}

/**
 * A view made or edited: its name alone, which is all a view has that is
 * not on its canvas. Edited, it carries Delete at the start of the foot,
 * across from Save.
 */
export class FreeformViewFormModal extends SnowflakeFormModal<string> {
	private nameValue: string;
	private readonly name: UniqueNameField;
	private closed = false;

	constructor(
		app: App,
		t: Translate,
		private readonly options: FreeformViewFormOptions,
		onSubmit: SubmitHandler<string>,
	) {
		super(
			app,
			t,
			t(options.mode === 'add' ? 'timeline.view.add' : 'timeline.view.edit'),
			onSubmit,
			options.mode === 'add' ? 'common.create' : 'common.save',
		);
		this.nameValue = options.initial;
		this.name = new UniqueNameField(
			options.takenNames,
			options.mode === 'edit' ? options.initial : null,
			() => this.t('timeline.view.nameTaken'),
		);
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
	}

	protected leadingActions(actions: HTMLElement): void {
		const remove = this.options.deleteView;
		if (remove === undefined) return;
		const button = actions.createEl('button', {
			cls: 'mod-warning snowflake-method-modal-leading-action',
			text: this.t('actions.delete'),
			attr: { type: 'button' },
		});
		button.addEventListener('click', () => {
			if (this.closed) return;
			void remove().then((gone) => {
				if (gone && !this.closed) this.close();
			});
		});
	}

	protected collectValue(): string | null {
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
		return name;
	}

	onClose(): void {
		this.closed = true;
		super.onClose();
	}
}

/** A text node's words that could not be written, and the view they were meant to stand on. */
export interface RecoveredFreeformText {
	place: string;
	words: string;
}

/**
 * Keeps refused words outside the workspace, which may already have gone. A
 * text node's words live nowhere but on its view, so words the view would
 * not take are handed back here for the author to copy.
 */
export class FreeformTextModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly drafts: readonly RecoveredFreeformText[],
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.t('freeformCanvas.text.unsaved'));
		const root = this.contentEl;
		root.empty();
		root.createEl('p', { text: this.t('freeformCanvas.text.refused') });
		for (const draft of this.drafts) {
			root.createEl('h3', { text: draft.place });
			const input = root.createEl('textarea', {
				cls: 'snowflake-method-corkboard-recovered-text',
				attr: { 'aria-label': this.t('freeformCanvas.text.label'), rows: '6' },
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

// -- Nodes added by type ---------------------------------------------------------

/** One kind of node the form can add: what the project holds of a type, or what is made on the canvas. */
export interface FreeformNodeType {
	/** `scene`, `character`, a worldbuilding kind's id, or `text`. */
	value: string;
	label: string;
	section: 'entity' | 'canvas';
}

/** One node of a type as the form offers it: by the id the view will keep, and whether the view holds it already. */
export interface FreeformNodeCandidate {
	id: string;
	name: string;
	onView: boolean;
}

export interface FreeformNodeFormOptions {
	types: readonly FreeformNodeType[];
	/** The nodes of a type, asked for as the type is chosen. */
	candidates: (type: string) => readonly FreeformNodeCandidate[];
	/** How many more nodes the view has room for. */
	room: () => number;
	/** The type the form opens on; none where left out. */
	initialType?: string | null;
}

/** What the form asks for: nodes of a type by their ids, or one text node to be typed into. */
export type FreeformNodeDraft =
	| { type: 'text' }
	| { type: 'entity'; kind: string; nodes: readonly { id: string; name: string }[] };

/** How many rows the nodes list shows before it asks to be narrowed: a project may hold thousands of scenes. */
export const FREEFORM_PICK_ROWS = 200;

/**
 * Nodes added to the view: first the type, then, for a type the project
 * holds notes of, the notes themselves, searched and picked several at
 * once, those already on the view listed apart. A line under the field says
 * how many are chosen and how many more the view has room for. Text is
 * typed where it lands, so choosing it asks nothing more.
 */
export class FreeformNodeFormModal extends SnowflakeFormModal<FreeformNodeDraft> {
	private type: string | null;
	private readonly picked: string[] = [];
	private typeField: OptionPicker | null = null;
	private nodesPicker: OptionPicker | null = null;
	private nodesSetting: Setting | null = null;
	private nodesHost: HTMLElement | null = null;
	private summaryEl: HTMLElement | null = null;

	constructor(
		app: App,
		t: Translate,
		private readonly options: FreeformNodeFormOptions,
		onSubmit: SubmitHandler<FreeformNodeDraft>,
	) {
		super(app, t, t('freeformCanvas.node.add'), onSubmit, 'common.add');
		this.type = options.initialType ?? null;
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-project-form');
		const type = new Setting(this.contentEl).setName(this.t('freeformCanvas.node.type'));
		this.typeField?.destroy();
		this.typeField = buildOptionField(
			this.app,
			type.controlEl.createDiv({ cls: 'snowflake-method-timeline-picker' }),
			{
				options: () => this.typeOptions(),
				label: this.t('freeformCanvas.node.type'),
				placeholder: this.t('freeformCanvas.node.typePlaceholder'),
				emptyPlaceholder: this.t('freeformCanvas.node.typePlaceholder'),
				required: true,
				value: () => this.type ?? '',
				choose: (value) => {
					this.chooseType(value);
				},
			},
		);
		this.nodesSetting = new Setting(this.contentEl).setName(this.t('freeformCanvas.node.pick'));
		this.nodesSetting.settingEl.addClass('snowflake-method-freeform-node-pick');
		this.nodesHost = this.nodesSetting.controlEl.createDiv({ cls: 'snowflake-method-timeline-picker' });
		this.summaryEl = this.nodesSetting.settingEl.createDiv({
			cls: 'snowflake-method-field-warning',
			attr: { role: 'status' },
		});
		this.buildNodesPicker();
		this.paintNodes();
	}

	/**
	 * The nodes field, built afresh for each type chosen: a field decides as
	 * it is built whether it has anything to offer, and one built before a
	 * type was chosen would have decided it had nothing.
	 */
	private buildNodesPicker(): void {
		const host = this.nodesHost;
		if (host === null) return;
		this.nodesPicker?.destroy();
		host.empty();
		this.nodesPicker = buildOptionPicker(this.app, host, {
			options: () => this.nodeOptions(),
			label: this.t('freeformCanvas.node.pick'),
			placeholder: this.t('freeformCanvas.node.pickPlaceholder'),
			emptyPlaceholder: this.t('freeformCanvas.node.pickEmpty'),
			cap: { rows: FREEFORM_PICK_ROWS, more: (count) => this.t('freeformCanvas.node.pickMore', { count }) },
			picked: () => this.picked,
			pick: (value) => {
				this.picked.push(value);
				this.paintSummary();
			},
			unpick: (value) => {
				const at = this.picked.indexOf(value);
				if (at !== -1) this.picked.splice(at, 1);
				this.paintSummary();
			},
			removeLabel: (label) => this.t('form.record.removeLine', { name: label }),
		});
	}

	/** The types in two groups: what the project holds notes of, and what is made on the canvas. */
	private typeOptions(): PickerOption[] {
		return this.options.types.map((type) => ({
			value: type.value,
			label: type.label,
			section: this.t(type.section === 'entity' ? 'freeformCanvas.node.section.entity' : 'freeformCanvas.node.section.canvas'),
		}));
	}

	/**
	 * The nodes of the chosen type, those not yet on the view first. The two
	 * are set apart only where the view holds some: with none on it, a
	 * heading over the whole list would say nothing.
	 */
	private nodeOptions(): PickerOption[] {
		const type = this.type;
		if (type === null || type === 'text') return [];
		const candidates = this.options.candidates(type);
		const apart = candidates.some((candidate) => candidate.onView);
		const option = (candidate: FreeformNodeCandidate): PickerOption => ({
			value: candidate.id,
			label: candidate.name,
			...(apart
				? { section: this.t(candidate.onView ? 'freeformCanvas.node.onView' : 'freeformCanvas.node.notOnView') }
				: {}),
		});
		return [
			...candidates.filter((candidate) => !candidate.onView).map(option),
			...candidates.filter((candidate) => candidate.onView).map(option),
		];
	}

	private chooseType(value: string): void {
		if (value === this.type) return;
		this.type = value;
		// What was picked was of the type before, and is nothing of this one.
		this.picked.length = 0;
		this.buildNodesPicker();
		this.paintNodes();
	}

	/** The nodes field stands only for a type the project holds notes of. */
	private paintNodes(): void {
		const asks = this.type !== null && this.type !== 'text';
		this.nodesSetting?.settingEl.toggleClass('is-hidden', !asks);
		this.paintSummary();
	}

	/** How many are chosen, and how many more the view has room for; a warning where the choice is more than that. */
	private paintSummary(): void {
		const el = this.summaryEl;
		if (el === null) return;
		const room = this.options.room();
		const chosen = this.picked.length;
		const over = chosen > room;
		el.setText(over
			? this.t('freeformCanvas.node.limitSome', { left: room })
			: this.t('freeformCanvas.node.summary', { chosen, left: Math.max(0, room - chosen) }));
		el.toggleClass('is-notice', !over);
	}

	protected collectValue(): FreeformNodeDraft | null {
		const type = this.type;
		if (type === null) {
			new Notice(this.t('freeformCanvas.node.typePlaceholder'));
			return null;
		}
		if (type === 'text') return { type: 'text' };
		if (this.picked.length === 0) {
			new Notice(this.t('freeformCanvas.node.required'));
			return null;
		}
		const room = this.options.room();
		if (this.picked.length > room) {
			new Notice(this.t('freeformCanvas.node.limitSome', { left: room }));
			return null;
		}
		const names = new Map(this.options.candidates(type).map((candidate) => [candidate.id, candidate.name]));
		return {
			type: 'entity',
			kind: type,
			nodes: this.picked.map((id) => ({ id, name: names.get(id) ?? '' })),
		};
	}

	onClose(): void {
		this.typeField?.destroy();
		this.typeField = null;
		this.nodesPicker?.destroy();
		this.nodesPicker = null;
		this.nodesSetting = null;
		this.nodesHost = null;
		this.summaryEl = null;
		super.onClose();
	}
}

// -- A node's size and place ---------------------------------------------------------

export interface FreeformGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * A node's place and size set by number, which is the keyboard's way of
 * moving and sizing one. Whole canvas pixels, as they stand at 100%; a size
 * no smaller than the least a node may be sized to by hand.
 */
export class FreeformGeometryModal extends SnowflakeFormModal<FreeformGeometry> {
	private readonly typed: Record<keyof FreeformGeometry, string>;

	constructor(
		app: App,
		t: Translate,
		initial: FreeformGeometry,
		private readonly least: { width: number; height: number },
		onSubmit: SubmitHandler<FreeformGeometry>,
	) {
		super(app, t, t('freeformCanvas.geometry.title'), onSubmit, 'common.save');
		this.typed = {
			x: String(initial.x),
			y: String(initial.y),
			width: String(initial.width),
			height: String(initial.height),
		};
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-project-form');
		this.contentEl.createEl('p', { text: this.t('freeformCanvas.geometry.hint') });
		for (const field of ['x', 'y', 'width', 'height'] as const) {
			new Setting(this.contentEl)
				.setName(this.t(`freeformCanvas.geometry.${field}`))
				.addText((text) => {
					text.inputEl.type = 'number';
					text.inputEl.step = '1';
					text.inputEl.setAttribute('aria-label', this.t(`freeformCanvas.geometry.${field}`));
					text.setValue(this.typed[field]).onChange((value) => {
						this.typed[field] = value;
					});
				});
		}
	}

	protected collectValue(): FreeformGeometry | null {
		const read: Partial<FreeformGeometry> = {};
		for (const field of ['x', 'y', 'width', 'height'] as const) {
			const value = Number(this.typed[field].trim());
			if (this.typed[field].trim().length === 0 || !Number.isInteger(value)) {
				new Notice(this.t('freeformCanvas.geometry.invalid'));
				return null;
			}
			read[field] = value;
		}
		const geometry = read as FreeformGeometry;
		if (geometry.width < this.least.width || geometry.height < this.least.height) {
			new Notice(this.t('freeformCanvas.geometry.tooSmall', { width: this.least.width, height: this.least.height }));
			return null;
		}
		if (geometry.width > FREEFORM_SIZE.max || geometry.height > FREEFORM_SIZE.max) {
			new Notice(this.t('freeformCanvas.geometry.invalid'));
			return null;
		}
		return geometry;
	}
}

// -- A line's words and look -----------------------------------------------------------

export interface FreeformEdgeDraft {
	label: string;
	arrow: FreeformArrow;
	line: FreeformLine;
}

/**
 * A line edited: the words on it, where its arrowheads stand, and how it is
 * drawn. It says first that it is drawn on the canvas only, so no one takes
 * a line for a link between the notes it joins.
 */
export class FreeformEdgeFormModal extends SnowflakeFormModal<FreeformEdgeDraft> {
	private readonly draft: FreeformEdgeDraft;

	constructor(
		app: App,
		t: Translate,
		initial: FreeformEdgeDraft,
		private readonly labelLimit: number,
		onSubmit: SubmitHandler<FreeformEdgeDraft>,
	) {
		super(app, t, t('freeformCanvas.edge.edit'), onSubmit, 'common.save');
		this.draft = { ...initial };
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-project-form');
		this.contentEl.createEl('p', { text: this.t('freeformCanvas.edge.hint') });
		new Setting(this.contentEl)
			.setName(this.t('freeformCanvas.edge.label'))
			.setDesc(this.t('freeformCanvas.edge.labelHint'))
			.addText((text) => {
				text.inputEl.setAttribute('aria-label', this.t('freeformCanvas.edge.label'));
				text.inputEl.setAttribute('maxlength', String(this.labelLimit));
				text.setValue(this.draft.label).onChange((value) => {
					this.draft.label = value;
				});
			});
		const arrow = new Setting(this.contentEl).setName(this.t('freeformCanvas.edge.arrow'));
		addEnumSelect(arrow.controlEl, {
			cls: 'dropdown snowflake-method-freeform-edge-arrow',
			ariaLabel: this.t('freeformCanvas.edge.arrow'),
			values: FREEFORM_ARROWS,
			label: (value) => this.t(`freeformCanvas.edge.arrow.${value}`),
			initial: this.draft.arrow,
			is: isFreeformArrow,
			fallback: 'end',
			onChange: (value) => {
				this.draft.arrow = value;
			},
		});
		const line = new Setting(this.contentEl).setName(this.t('freeformCanvas.edge.line'));
		addEnumSelect(line.controlEl, {
			cls: 'dropdown snowflake-method-freeform-edge-line',
			ariaLabel: this.t('freeformCanvas.edge.line'),
			values: FREEFORM_LINES,
			label: (value) => this.t(`freeformCanvas.edge.line.${value}`),
			initial: this.draft.line,
			is: isFreeformLine,
			fallback: 'solid',
			onChange: (value) => {
				this.draft.line = value;
			},
		});
	}

	protected collectValue(): FreeformEdgeDraft | null {
		const label = this.draft.label.trim();
		if (label.length > this.labelLimit) {
			new Notice(this.t('freeformCanvas.edge.refused'));
			return null;
		}
		return { label, arrow: this.draft.arrow, line: this.draft.line };
	}
}
