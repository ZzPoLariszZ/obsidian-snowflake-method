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
/** The app's reading of the modifier: Ctrl here, as off a Mac. */
export const Keymap = {
	isModEvent: (event?: { ctrlKey?: boolean; metaKey?: boolean } | null): 'tab' | false =>
		event?.ctrlKey === true || event?.metaKey === true ? 'tab' : false,
};

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
/** An element that takes everything and shows nothing, for a Setting built off the page. */
interface QuietElement {
	addClass(...names: string[]): void;
	removeClass(...names: string[]): void;
	toggleClass(name: string, on: boolean): void;
	setText(text: string): void;
	setAttribute(name: string, value: string): void;
	createDiv(spec?: unknown): QuietElement;
	createEl(tag: string, spec?: unknown): QuietElement;
	createSpan(spec?: unknown): QuietElement;
	empty(): void;
	remove(): void;
}

const quietElement = (): QuietElement => {
	const element: QuietElement = {
		addClass: () => undefined,
		removeClass: () => undefined,
		toggleClass: () => undefined,
		setText: () => undefined,
		setAttribute: () => undefined,
		createDiv: () => quietElement(),
		createEl: () => quietElement(),
		createSpan: () => quietElement(),
		empty: () => undefined,
		remove: () => undefined,
	};
	return element;
};

/** A component that answers every call with itself and keeps one value, so a module that builds a panel can run. */
class QuietComponent {
	disabled = false;
	private value: unknown = '';
	private handler: ((value: never) => unknown) | null = null;
	readonly inputEl = quietElement();
	readonly clearButtonEl = quietElement();
	readonly containerEl = quietElement();
	readonly buttonEl = quietElement();
	readonly extraSettingsEl = quietElement();
	readonly selectEl = quietElement();
	readonly sliderEl = quietElement();
	readonly toggleEl = quietElement();
	setValue(value: unknown): this {
		this.value = value;
		return this;
	}
	getValue(): unknown {
		return this.value;
	}
	onChange(handler: (value: never) => unknown): this {
		this.handler = handler;
		return this;
	}
	/** What a test may do to stand in for the user. */
	change(value: unknown): void {
		this.value = value;
		this.handler?.(value as never);
	}
	onClick(): this {
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		return this;
	}
	setPlaceholder(): this {
		return this;
	}
	setLimits(): this {
		return this;
	}
	setDynamicTooltip(): this {
		return this;
	}
	setInstant(): this {
		return this;
	}
	addOption(): this {
		return this;
	}
	addOptions(): this {
		return this;
	}
	setButtonText(): this {
		return this;
	}
	setCta(): this {
		return this;
	}
	setWarning(): this {
		return this;
	}
	setIcon(): this {
		return this;
	}
	setTooltip(): this {
		return this;
	}
	then(callback: (component: this) => unknown): this {
		callback(this);
		return this;
	}
}

/** Enough of a Setting to build a row on a page that may be a fake DOM or nothing at all. */
export class Setting {
	settingEl: QuietElement;
	infoEl: QuietElement;
	nameEl: QuietElement;
	descEl: QuietElement;
	controlEl: QuietElement;
	constructor(container?: unknown) {
		const parent = container as Partial<QuietElement> | undefined;
		this.settingEl = typeof parent?.createDiv === 'function' ? parent.createDiv({ cls: 'setting-item' }) : quietElement();
		this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
		this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
		this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
		this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
	}
	setName(name?: string): this {
		if (typeof name === 'string') this.nameEl.setText(name);
		return this;
	}
	setDesc(): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
	setClass(name: string): this {
		this.settingEl.addClass(name);
		return this;
	}
	setTooltip(): this {
		return this;
	}
	setDisabled(): this {
		return this;
	}
	private add(build?: (component: never) => unknown): this {
		build?.(new QuietComponent() as never);
		return this;
	}
	addDropdown(build?: (component: never) => unknown): this {
		return this.add(build);
	}
	addButton(build?: (component: never) => unknown): this {
		return this.add(build);
	}
	addExtraButton(build?: (component: never) => unknown): this {
		return this.add(build);
	}
	addToggle(build?: (component: never) => unknown): this {
		return this.add(build);
	}
	addSlider(build?: (component: never) => unknown): this {
		return this.add(build);
	}
	addSearch(build?: (component: never) => unknown): this {
		return this.add(build);
	}
	addText(build?: (component: never) => unknown): this {
		return this.add(build);
	}
	addTextArea(build?: (component: never) => unknown): this {
		return this.add(build);
	}
	addColorPicker(build?: (component: never) => unknown): this {
		return this.add(build);
	}
}

/** A text field off the page: the value kept, the hand on it called. */
export class TextComponent extends QuietComponent {
	constructor(container?: unknown) {
		super();
		const parent = container as Partial<QuietElement> | undefined;
		if (typeof parent?.createEl === 'function') parent.createEl('input', { attr: { type: 'text' } });
	}
}

/** A colour chip off the page: the value kept, the hand on it called. */
export class ColorComponent extends QuietComponent {
	constructor(container?: unknown) {
		super();
		const parent = container as Partial<QuietElement> | undefined;
		if (typeof parent?.createEl === 'function') parent.createEl('input', { attr: { type: 'color' } });
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
