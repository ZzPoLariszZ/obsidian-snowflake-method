/**
 * The dialogs the freeform workspace opens: a view made or edited, and the
 * words of a text node the project would not take. Each is a labelled form,
 * as every form the plugin opens is. A view is named as the timeline's views
 * are, in the timeline's own words; the confirmation a view's removal asks
 * through is the timeline's too, which says nothing of timelines.
 */

import { Modal, Notice, Setting, type App } from 'obsidian';

import {
	SnowflakeFormModal,
	UniqueNameField,
	type SubmitHandler,
	type Translate,
} from './modals';

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
