import { Modal, type App } from 'obsidian';

import type { Translate } from './modals';

export interface RecoveredCorkboardDraft {
	scene: string;
	title?: string;
	conflict?: string;
}

/** Keeps refused card text outside the board that may already be closing. */
export class CorkboardDraftModal extends Modal {
	constructor(app: App, private readonly t: Translate, private readonly drafts: readonly RecoveredCorkboardDraft[]) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.t('corkboard.draftRecovery.title'));
		const root = this.contentEl;
		root.empty();
		root.createEl('p', { text: this.t('corkboard.draftRecovery.description') });
		for (const draft of this.drafts) {
			root.createEl('h3', { text: draft.scene });
			for (const field of ['title', 'conflict'] as const) {
				const value = draft[field];
				if (value === undefined) continue;
				const label = this.t(field === 'title' ? 'corkboard.editName' : 'table.conflict');
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
