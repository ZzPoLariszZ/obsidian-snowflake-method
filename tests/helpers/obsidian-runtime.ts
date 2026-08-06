import { StateField } from '@codemirror/state';

import { normalizeFakePath, parseFakeYaml } from "./fake-vault";

export const normalizePath = normalizeFakePath;
export const parseYaml = parseFakeYaml;
export const stringifyYaml = (value: unknown): string =>
	`${JSON.stringify(value, null, 2)}\n`;

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
