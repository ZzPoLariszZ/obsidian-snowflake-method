// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { App } from 'obsidian';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	// Enough of a dialog to be opened and saved from: its elements, and the
	// open and close that call the form's own.
	class Modal extends runtime.Modal {
		modalEl = document.body.createDiv();
		contentEl = document.body.createDiv();
		setTitle(): this {
			return this;
		}
		onOpen(): void {}
		onClose(): void {}
		open(): void {
			this.onOpen();
		}
		close(): void {
			this.onClose();
		}
	}
	return {
		...runtime,
		Modal,
		ItemView: class {
			app: unknown;
			constructor(public leaf: { app: unknown }) {
				this.app = leaf.app;
			}
		},
		FuzzySuggestModal: class extends Modal {},
		SuggestModal: class extends Modal {},
	};
});

import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import { SnowflakeFormModal, type SubmitHandler } from '../../src/ui/modals';
import { writesUnderWay } from '../../src/ui/pending-writes';
import { installObsidianDom } from '../helpers/obsidian-dom';

/**
 * Where a save enters, it is noted as a write on its way for as long as it
 * runs. A save is several writes with the note read back between them, and
 * it begins by fetching its project: a quit that waited only for whichever
 * write happened to be out let the window go with the rest unwritten.
 */

beforeAll(() => {
	installObsidianDom(window);
});

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
	let resolve = (): void => undefined;
	let reject = (_error: Error): void => undefined;
	const promise = new Promise<void>((settle, fail) => {
		resolve = settle;
		reject = fail;
	});
	return { promise, resolve, reject };
}

async function microtasks(): Promise<void> {
	for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

class ProbeForm extends SnowflakeFormModal<string> {
	constructor(onSubmit: SubmitHandler<string>) {
		super({} as App, (key) => key, 'A form', onSubmit);
	}

	protected buildForm(): void {}

	protected collectValue(): string | null {
		return 'what was typed';
	}

	save(): Promise<boolean> {
		return this.submit();
	}
}

describe('a form’s save', () => {
	it('is a write on its way from the press to the handler’s end', async () => {
		const saved = deferred();
		const handled: string[] = [];
		const form = new ProbeForm(async (value) => {
			handled.push(value);
			await saved.promise;
		});
		form.open();
		expect(writesUnderWay()).toBeNull();

		const saving = form.save();
		await microtasks();
		expect(handled).toEqual(['what was typed']);
		// Nothing has been written yet, and it is owed all the same.
		expect(writesUnderWay()).not.toBeNull();
		saved.resolve();
		expect(await saving).toBe(true);
		expect(writesUnderWay()).toBeNull();
	});

	it('is owed no longer once it has failed', async () => {
		const saved = deferred();
		const form = new ProbeForm(() => saved.promise);
		form.open();
		const saving = form.save();
		await microtasks();
		expect(writesUnderWay()).not.toBeNull();
		saved.reject(new Error('the note changed underneath'));
		expect(await saving).toBe(false);
		expect(writesUnderWay()).toBeNull();
	});
});

describe('a change made from the dashboard', () => {
	function view(): {
		saveAndRefresh(action: () => Promise<void>): Promise<void>;
		runAndRefresh(action: () => Promise<void>): Promise<void>;
		refresh: ReturnType<typeof vi.fn>;
	} {
		const made = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
		const owedAtRefresh: boolean[] = [];
		const refresh = vi.fn(async () => {
			owedAtRefresh.push(writesUnderWay() !== null);
		});
		Object.assign(made, { refresh, t: (key: string) => key, owedAtRefresh });
		return made as unknown as ReturnType<typeof view>;
	}

	it('is a write on its way until it lands, and its reading is not', async () => {
		const dashboard = view();
		const written = deferred();
		const running = dashboard.saveAndRefresh(() => written.promise);
		await microtasks();
		expect(writesUnderWay()).not.toBeNull();
		expect(dashboard.refresh).not.toHaveBeenCalled();
		written.resolve();
		await running;
		expect(dashboard.refresh).toHaveBeenCalledTimes(1);
		// The reading that follows a change is nobody's to wait for.
		expect((dashboard as unknown as { owedAtRefresh: boolean[] }).owedAtRefresh).toEqual([false]);
		expect(writesUnderWay()).toBeNull();
	});

	it('is not one where the action only looks, or asks the author first', async () => {
		const dashboard = view();
		const answered = deferred();
		const running = dashboard.runAndRefresh(() => answered.promise);
		await microtasks();
		expect(writesUnderWay()).toBeNull();
		answered.resolve();
		await running;
		expect(dashboard.refresh).toHaveBeenCalledTimes(1);
	});
});
