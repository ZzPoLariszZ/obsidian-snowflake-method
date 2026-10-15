// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		modalEl = document.body.createDiv({ cls: 'modal' });
		setTitle(): this {
			return this;
		}
		/** Stacked as Obsidian stacks a dialog: in a container of its own, the latest last. */
		override open(): void {
			document.body.createDiv({ cls: 'modal-container' }).appendChild(this.modalEl);
		}
	}
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		MarkdownView: class {},
		Modal,
		FuzzySuggestModal: class extends Modal {},
		SuggestModal: class extends Modal {},
	};
});

import type { App } from 'obsidian';

import SnowflakeMethodPlugin from '../../src/main';
import { DIALOG_CLASS } from '../../src/ui/dialog-class';
import { FieldPress } from '../../src/ui/field-menu';
import {
	CreateCharacterModal,
	CreateSceneModal,
	EntityFormModal,
	promptForDefinitionPath,
	type MemberFormContext,
} from '../../src/ui/modals';
import { installObsidianDom } from '../helpers/obsidian-dom';

beforeAll(() => {
	installObsidianDom(window);
});

const listening: { type: string; callback: EventListener; options?: AddEventListenerOptions }[] = [];

afterEach(() => {
	for (const { type, callback, options } of listening.splice(0)) {
		document.removeEventListener(type, callback, options);
	}
	document.body.empty();
});

const CURRENT = 'Alpha/00_System/001_Project_Metadata.md';
const OTHER = 'Beta/00_System/001_Project_Metadata.md';
const app = {} as App;
const t = (key: string): string => key;
const context = { projectPath: OTHER } as MemberFormContext;

/** The plugin's menu over selected words, listening on the document, its project handed to a spy. */
function fieldMenu() {
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	const openFieldMenu = vi.fn<(field: HTMLElement, span: { text: string }, projectPath: string) => void>();
	Object.assign(plugin, {
		settings: { recentProjectPath: CURRENT },
		fieldPress: new FieldPress(),
		openFieldMenu,
		registerDomEvent: (doc: Document, type: string, callback: EventListener, options?: AddEventListenerOptions) => {
			doc.addEventListener(type, callback, options);
			listening.push({ type, callback, options });
		},
	});
	(plugin as unknown as { registerFieldMenu(doc: Document): void }).registerFieldMenu(document);
	/** A box in a dialog, its words selected and right-clicked. */
	const rightClick = (dialog: HTMLElement): HTMLTextAreaElement => {
		const box = dialog.createEl('textarea');
		box.value = 'the old mill road';
		box.setSelectionRange(4, 12);
		box.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
		box.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		return box;
	};
	const heard = (): unknown[][] =>
		openFieldMenu.mock.calls.map(([field, span, projectPath]) => [field, span.text, projectPath]);
	return { rightClick, heard };
}

describe('the project a member form belongs to', () => {
	it('is marked on the dialog of each member form, from the context it was opened with', () => {
		const forms = [
			new CreateCharacterModal(app, t, [], vi.fn(), undefined, 'Alice', context),
			new CreateSceneModal(app, t, [], [], vi.fn(), undefined, null, context),
			new EntityFormModal(app, t, 'location', [], context, vi.fn()),
		];
		expect(forms.map((form) => form.modalEl.dataset.snowflakeProject)).toEqual([OTHER, OTHER, OTHER]);
		// A form opened with no context is the current project's, and says nothing.
		expect(new CreateCharacterModal(app, t, [], vi.fn()).modalEl.dataset.snowflakeProject).toBeUndefined();
	});

	it('is where the menu over words selected in the form makes things, while another project stays current', () => {
		const { rightClick, heard } = fieldMenu();
		const form = new CreateCharacterModal(app, t, [], vi.fn(), undefined, 'Alice', context);
		form.open();
		const formBox = rightClick(form.modalEl);
		// A dialog that says nothing of its project, over none that does, is the current one's.
		document.body.empty();
		const plain = document.body.createDiv({ cls: 'modal-container' }).createDiv({ cls: `modal ${DIALOG_CLASS}` });
		const plainBox = rightClick(plain);
		expect(heard()).toEqual([
			[formBox, 'old mill', OTHER],
			[plainBox, 'old mill', CURRENT],
		]);
	});

	it('is the project of a dialog the form opens, as a vocabulary entry’s for a record label', () => {
		const { rightClick, heard } = fieldMenu();
		const form = new CreateCharacterModal(app, t, [], vi.fn(), undefined, 'Alice', context);
		form.open();
		// A world status record names a label the project lacks, and asks for its entry.
		const record = (form as unknown as {
			recordContext(context: MemberFormContext, labels: unknown, definitionId: string): {
				describeLabel(path: string): Promise<unknown>;
			};
		}).recordContext(context, {}, 'world-status');
		void record.describeLabel('Rank/Captain');
		const entry = document.body.lastElementChild?.querySelector<HTMLElement>(`.${DIALOG_CLASS}`);
		if (entry === null || entry === undefined || entry === form.modalEl) throw new Error('no entry dialog');
		const entryBox = rightClick(entry);
		// The same dialog opened from nowhere marked is the current project's.
		document.body.empty();
		void promptForDefinitionPath(app, t, 'world-status', 'Rank/Captain');
		const lone = document.body.lastElementChild?.querySelector<HTMLElement>(`.${DIALOG_CLASS}`);
		if (lone === null || lone === undefined) throw new Error('no entry dialog');
		const loneBox = rightClick(lone);
		expect(heard()).toEqual([
			[entryBox, 'old mill', OTHER],
			[loneBox, 'old mill', CURRENT],
		]);
	});
});

describe('the project a card’s body belongs to', () => {
	/** A prose box holding words, the page's selection set over a stretch of them, right-clicked. */
	const rightClickProse = (parent: HTMLElement, value: string, start: number, end: number): HTMLElement => {
		const box = parent.createDiv({ cls: 'snowflake-method-prose-box snowflake-method-corkboard-body-text' });
		box.setAttribute('contenteditable', 'plaintext-only');
		const text = document.createTextNode(value);
		box.appendChild(text);
		const range = document.createRange();
		range.setStart(text, start);
		range.setEnd(text, end);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		box.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
		box.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		return box;
	};

	it('is the project marked on the board the card stands on, and the current one where nothing is marked', () => {
		const { rightClick, heard } = fieldMenu();
		const board = document.body.createDiv({
			cls: 'snowflake-method-story-structure',
			attr: { 'data-snowflake-project': OTHER },
		});
		const onBoard = rightClickProse(board, 'the old mill road', 4, 12);
		const loose = rightClickProse(document.body.createDiv(), 'the old mill road', 4, 12);
		// A text area on the board is not a card's body, and the app keeps its own menu over it.
		rightClick(board);
		expect(heard()).toEqual([
			[onBoard, 'old mill', OTHER],
			[loose, 'old mill', CURRENT],
		]);
	});
});
