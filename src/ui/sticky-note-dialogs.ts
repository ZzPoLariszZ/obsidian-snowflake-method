import type { App } from 'obsidian';

import { ConfirmModal, type Translate } from './modals';

/** Before a sticky note's file goes to the trash: its first line, so the author knows which. */
class ConfirmStickyNoteDeletionModal extends ConfirmModal {
	constructor(
		app: App,
		t: Translate,
		private readonly preview: string,
		onResolve: (confirmed: boolean) => void,
	) {
		super(app, t, { label: t('actions.delete'), style: 'mod-warning' }, onResolve);
		this.setTitle(t('stickyNotes.deleteTitle'));
		this.modalEl.addClass('snowflake-method-delete-member-modal');
	}

	protected renderBody(body: HTMLElement): void {
		if (this.preview.length > 0) {
			body.createEl('p', {
				cls: 'snowflake-method-sticky-delete-preview',
				text: this.preview,
			});
		}
		body.createEl('p', { text: this.t('stickyNotes.deleteDescription') });
	}
}

/** Before every archived sticky note goes to the trash at once: how many. */
class ConfirmStickyNoteEmptyingModal extends ConfirmModal {
	constructor(
		app: App,
		t: Translate,
		private readonly count: number,
		onResolve: (confirmed: boolean) => void,
	) {
		super(app, t, { label: t('stickyNotes.emptyArchive'), style: 'mod-warning' }, onResolve);
		this.setTitle(t('stickyNotes.emptyArchiveTitle'));
		this.modalEl.addClass('snowflake-method-delete-member-modal');
	}

	protected renderBody(body: HTMLElement): void {
		body.createEl('p', {
			text: this.t('stickyNotes.emptyArchiveDescription', { count: this.count }),
		});
	}
}

export function confirmStickyNoteEmptying(
	app: App,
	t: Translate,
	count: number,
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmStickyNoteEmptyingModal(app, t, count, resolve).open();
	});
}

export function confirmStickyNoteDeletion(
	app: App,
	t: Translate,
	preview: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmStickyNoteDeletionModal(app, t, preview, resolve).open();
	});
}
