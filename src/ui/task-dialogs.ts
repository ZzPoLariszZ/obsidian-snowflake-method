import type { App } from 'obsidian';

import { ConfirmModal, type Translate } from './modals';

/** Before a task leaves the file for good: its title, so the author knows which. */
class ConfirmTaskDeletionModal extends ConfirmModal {
	constructor(
		app: App,
		t: Translate,
		private readonly title: string,
		onResolve: (confirmed: boolean) => void,
	) {
		super(app, t, { label: t('actions.delete'), style: 'mod-warning' }, onResolve);
		this.setTitle(t('taskBoard.deleteTitle'));
		this.modalEl.addClass('snowflake-method-delete-member-modal');
	}

	protected renderBody(body: HTMLElement): void {
		if (this.title.length > 0) {
			body.createEl('p', {
				cls: 'snowflake-method-sticky-delete-preview',
				text: this.title,
			});
		}
		body.createEl('p', { text: this.t('taskBoard.deleteDescription') });
	}
}

/** Before every archived task leaves the file at once: how many. */
class ConfirmTaskArchiveEmptyingModal extends ConfirmModal {
	constructor(
		app: App,
		t: Translate,
		private readonly count: number,
		onResolve: (confirmed: boolean) => void,
	) {
		super(app, t, { label: t('taskBoard.emptyArchive'), style: 'mod-warning' }, onResolve);
		this.setTitle(t('taskBoard.emptyArchiveTitle'));
		this.modalEl.addClass('snowflake-method-delete-member-modal');
	}

	protected renderBody(body: HTMLElement): void {
		body.createEl('p', {
			text: this.t('taskBoard.emptyArchiveDescription', { count: this.count }),
		});
	}
}

export function confirmTaskDeletion(
	app: App,
	t: Translate,
	title: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmTaskDeletionModal(app, t, title, resolve).open();
	});
}

export function confirmTaskArchiveEmptying(
	app: App,
	t: Translate,
	count: number,
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmTaskArchiveEmptyingModal(app, t, count, resolve).open();
	});
}
