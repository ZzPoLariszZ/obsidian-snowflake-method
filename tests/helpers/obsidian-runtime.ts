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
