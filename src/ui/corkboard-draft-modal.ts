import type { App } from 'obsidian';

import type { Translate } from './modals';
import { SnowflakeModal } from './dialog-base';
import { DIALOG_CLASS } from './dialog-class';

export interface RecoveredCorkboardDraft {
	/** What the note is called. */
	name: string;
	title?: string;
	body?: string;
	/** What the body is called for this kind of note: a scene's conflict, a character's storyline. */
	bodyLabel: string;
}

/** Keeps refused card text outside the board that may already be closing. */
export class CorkboardDraftModal extends SnowflakeModal {
	constructor(app: App, private readonly t: Translate, private readonly drafts: readonly RecoveredCorkboardDraft[]) {
		super(app);
		this.modalEl.addClass(DIALOG_CLASS);
	}

	onOpen(): void {
		this.setTitle(this.t('corkboard.draftRecovery.title'));
		const root = this.contentEl;
		root.empty();
		root.createEl('p', { text: this.t('corkboard.draftRecovery.description') });
		for (const draft of this.drafts) {
			root.createEl('h3', { text: draft.name });
			for (const field of ['title', 'body'] as const) {
				const value = draft[field];
				if (value === undefined) continue;
				const label = field === 'title' ? this.t('corkboard.editName') : draft.bodyLabel;
				root.createEl('p', { text: label });
				const input = root.createEl('textarea', {
					cls: 'snowflake-method-corkboard-recovered-text',
					attr: { 'aria-label': label, rows: field === 'title' ? '2' : '6' },
				});
				input.readOnly = true;
				input.value = value;
			}
		}
		root.createEl('button', { text: this.t('common.close'), attr: { type: 'button' } })
			.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
