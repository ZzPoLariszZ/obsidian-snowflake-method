import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom } from '../helpers/corkboard-dom';

const { order } = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		modalEl = { addClass: (): void => undefined };
		contentEl = new CorkboardDom().container;
		setTitle(): void {}
		open(): void { order.push('opened'); }
		onClose(): void {}
		close(): void { this.onClose(); }
	}
	return { ...runtime, Modal, FuzzySuggestModal: class extends Modal {}, SuggestModal: class extends Modal {} };
});

import type { App, Modal } from 'obsidian';

import { promptForCustomFieldTemplate } from '../../src/ui/modals';

const app = {} as App;
const t = (key: string): string => key;
const options = { title: 'Export as template', submitLabel: 'Save', rows: null, objection: () => null };

describe('the template dialog', () => {
	it('opens on its own for a caller with no dialogs to keep, and answers nothing when dismissed', async () => {
		order.length = 0;
		const opened = vi.fn();
		const pending = promptForCustomFieldTemplate(app, t, options);
		pending.then(opened, opened);
		expect(order).toEqual(['opened']);
		await Promise.resolve();
		expect(opened).not.toHaveBeenCalled();
	});

	it('is handed to a caller that owns its dialogs before it opens, and answers as a cancelled one when closed from outside', async () => {
		order.length = 0;
		const kept: Modal[] = [];
		const pending = promptForCustomFieldTemplate(app, t, options, (modal) => {
			order.push('kept');
			kept.push(modal);
			return modal;
		});
		expect(order).toEqual(['kept', 'opened']);
		expect(kept).toHaveLength(1);
		// The owner goes, and closes what it kept: nothing was answered, so nothing is saved.
		kept[0]!.close();
		await expect(pending).resolves.toBeNull();
	});
});
