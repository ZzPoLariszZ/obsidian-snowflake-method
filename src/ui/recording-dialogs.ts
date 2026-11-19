import type { App } from 'obsidian';

import { ConfirmModal, type Translate } from './modals';
import { renderRecordingNoteLines } from './recording-notes';

/** What the author answered before a start: whether to record, and whether to be asked again. */
export interface RecordingStartAnswer {
	confirmed: boolean;
	/** Not to be asked before later recordings. Only ever true with a yes. */
	skip: boolean;
}

/**
 * Before a recording starts: what the settings say at all times, said
 * where it cannot be missed, since a recording is started from the ribbon
 * or the palette, where the settings are out of sight. A recording shows
 * everything on the screen, and that is the author's to agree to. The
 * author may say not to be asked again, with a box at the head of the
 * buttons as Obsidian's own confirmations have one.
 */
class ConfirmRecordingStartModal extends ConfirmModal {
	constructor(
		app: App,
		t: Translate,
		private readonly answer: { skip: boolean },
		onResolve: (confirmed: boolean) => void,
	) {
		super(app, t, { label: t('recording.action.start'), style: 'mod-cta' }, onResolve);
		this.setTitle(t('recording.notes.title'));
		this.modalEl.addClass('snowflake-method-recording-confirm');
		this.proceedOnModEnter();
	}

	protected renderBody(body: HTMLElement): void {
		renderRecordingNoteLines(body.createDiv({ cls: 'snowflake-method-recording-confirm-notes' }), this.t);
	}

	onOpen(): void {
		super.onOpen();
		const actions = this.contentEl.querySelector('.snowflake-method-modal-actions');
		if (actions === null) return;
		mountRecordingSkipBox(actions, this.t, (skip) => {
			this.answer.skip = skip;
		});
	}
}

/**
 * The box that says not to ask again, put at the head of a dialog's row of
 * buttons, where Obsidian's own confirmations have theirs. It can be
 * reached with the keyboard like the buttons beside it.
 */
export function mountRecordingSkipBox(
	actions: Element,
	t: Translate,
	onChange: (skip: boolean) => void,
): HTMLInputElement {
	const label = actions.createEl('label', {
		cls: 'mod-checkbox snowflake-method-modal-leading-action snowflake-method-recording-confirm-skip',
	});
	const box = label.createEl('input');
	box.type = 'checkbox';
	box.addEventListener('change', () => {
		onChange(box.checked);
	});
	label.createSpan({ text: t('recording.confirm.skip') });
	actions.prepend(label);
	return box;
}

/** What the author answered: a dialog closed any way but by its start button is a no, and asks again next time. */
export function confirmRecordingStart(app: App, t: Translate): Promise<RecordingStartAnswer> {
	return new Promise((resolve) => {
		const answer = { skip: false };
		new ConfirmRecordingStartModal(app, t, answer, (confirmed) => {
			resolve({ confirmed, skip: confirmed && answer.skip });
		}).open();
	});
}
