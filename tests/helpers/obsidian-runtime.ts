import { StateField } from '@codemirror/state';
import { parse as parseRealYaml, stringify as stringifyRealYaml } from 'yaml';

import { normalizeFakePath } from "./fake-vault";

export const normalizePath = normalizeFakePath;
// Real YAML, the way Obsidian's own helpers behave: the fake vault writes its
// frontmatter as JSON, which is a YAML subset, so both worlds stay readable.
export const parseYaml = (source: string): unknown => parseRealYaml(source);
/** The file a link names, without the heading or block anchor after it. */
export const getLinkpath = (linktext: string): string =>
	linktext.split('#')[0] ?? linktext;
export const stringifyYaml = (value: unknown): string =>
	stringifyRealYaml(value);

// The repository/service tests use structural fake Vault objects. These class
// exports keep incidental instanceof checks in neighboring code predictable if
// that code is imported by a test bundle.
export class TAbstractFile {}
export class TFile extends TAbstractFile {}
export class TFolder extends TAbstractFile {}
export class App {}
export class PluginSettingTab {
	constructor(..._arguments: unknown[]) {}
	update(): void {}
}

/**
 * Stands in only so a module defining a subclass can be imported. The tests
 * exercise the pure helpers beside it, never the popover itself, which needs a
 * DOM this runtime does not have.
 */
export class AbstractInputSuggest {
	limit = 0;
	constructor(..._arguments: unknown[]) {}
	open(): void {}
	close(): void {}
	setValue(_value: string): void {}
}

/** Only `locale()` is reached from the code under test. */
export const moment = { locale: (): string => 'en' };

/** A desktop that is not a Mac, which is what the tests' chords are written for. */
export const Platform = { isMacOS: false, isMobile: false, isDesktop: true };

export const editorEditorField = StateField.define<unknown>({
	create: () => undefined,
	update: (value) => value,
});
export const editorInfoField = StateField.define<unknown>({
	create: () => undefined,
	update: (value) => value,
});
export const editorLivePreviewField = StateField.define<boolean>({
	create: () => false,
	update: (value) => value,
});
export function setIcon(..._arguments: unknown[]): void {}
export function setTooltip(..._arguments: unknown[]): void {}
export class Notice {
	constructor(..._arguments: unknown[]) {}
}
/** One handler as a scope hands it back: enough to fire it, and to take it off again. */
export interface KeymapEventHandler {
	modifiers: readonly string[] | null;
	key: string | null;
	func: (event: KeyboardEvent, context: unknown) => boolean | void;
}

/**
 * The keymap scope a dialog registers its chords on, as far as the code
 * under test reaches it: the handlers are kept in the order they came, and
 * a test fires one by its key.
 */
export class Scope {
	readonly keys: KeymapEventHandler[] = [];
	constructor(..._arguments: unknown[]) {}
	register(
		modifiers: readonly string[] | null,
		key: string | null,
		func: KeymapEventHandler['func'],
	): KeymapEventHandler {
		const handler: KeymapEventHandler = { modifiers, key, func };
		this.keys.push(handler);
		return handler;
	}
	unregister(handler: KeymapEventHandler): void {
		const at = this.keys.indexOf(handler);
		if (at >= 0) this.keys.splice(at, 1);
	}
}
/**
 * Enough of a Modal for classes to extend, with the scope a dialog's chords
 * ride on, and the dialog's own element as far as a constructor marks it.
 */
export class Modal {
	readonly scope = new Scope();
	modalEl = { addClass: (..._classes: string[]): void => undefined };
	constructor(..._arguments: unknown[]) {}
	open(): void {}
	close(): void {}
}
/**
 * The two list dialogs, enough to be subclassed and opened: a test that
 * drives one mocks the module with a richer stand-in, as the form tests do.
 */
export class SuggestModal<T> extends Modal {
	limit = 0;
	emptyStateText = '';
	inputEl = { value: '', focus: (): void => undefined };
	setPlaceholder(_text: string): this {
		return this;
	}
	setInstructions(_instructions: unknown[]): this {
		return this;
	}
	getSuggestions(_query: string): T[] | Promise<T[]> {
		return [];
	}
	renderSuggestion(_value: T, _el: unknown): void {}
	onChooseSuggestion(_value: T, _event: unknown): void {}
}
export class FuzzySuggestModal<T> extends SuggestModal<T> {
	getItems(): T[] {
		return [];
	}
	getItemText(_item: T): string {
		return '';
	}
	onChooseItem(_item: T, _event: unknown): void {}
}
/**
 * Stands in only so a module that builds one can be imported. The tests
 * exercise the pure helpers beside it, never the input itself, which needs a
 * DOM this runtime does not have.
 */
export class SearchComponent {
	constructor(..._arguments: unknown[]) {}
	setPlaceholder(_text: string): this {
		return this;
	}
	onChange(_handler: (value: string) => void): this {
		return this;
	}
}
/** Enough of a Setting for code paths that only construct rows. */
export class Setting {
	constructor(..._arguments: unknown[]) {}
	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
	addDropdown(): this {
		return this;
	}
	addButton(): this {
		return this;
	}
}

/**
 * Enough of a Menu for a module that builds one to be imported: the panels
 * put their row menus together with it, and a missing named export is a
 * link error before any test runs. Nothing here is ever shown.
 */
class MenuItemStub {
	setTitle(): this {
		return this;
	}
	setIsLabel(): this {
		return this;
	}
	setChecked(): this {
		return this;
	}
	setIcon(): this {
		return this;
	}
	setWarning(): this {
		return this;
	}
	setDisabled(): this {
		return this;
	}
	setSection(): this {
		return this;
	}
	onClick(): this {
		return this;
	}
}

export class Menu {
	addItem(build: (item: MenuItemStub) => void): this {
		build(new MenuItemStub());
		return this;
	}
	addSeparator(): this {
		return this;
	}
	setParentElement(): this {
		return this;
	}
	showAtMouseEvent(): this {
		return this;
	}
	showAtPosition(): this {
		return this;
	}
	onHide(): void {}
	hide(): this {
		return this;
	}
}
