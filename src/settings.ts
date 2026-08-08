import {
	App,
	Notice,
	moment,
	normalizePath,
	PluginSettingTab,
	type Setting,
	type SettingDefinitionItem,
} from 'obsidian';

import type SnowflakeMethodPlugin from './main';
import {
	resolveGlobalLocale,
	t as translate,
	type UiLocalePreference,
} from './i18n';
import {
	displayProjectRoot,
	isValidProjectRoot,
	normalizeProjectRoot,
} from './project-root';
import {
	buildProjectRootField,
	type ProjectRootField,
} from './ui/project-root-field';

export type { UiLocalePreference } from './i18n';
export type ProjectLocale = 'en' | 'zh-CN';
export type DefaultProjectLocale = 'system' | ProjectLocale;

export interface SnowflakeSettings {
	settingsSchemaVersion: 6;
	projectRoot: string;
	uiLocale: UiLocalePreference;
	defaultProjectLocale: DefaultProjectLocale;
	openLongTextInSplit: boolean;
	protectManagedBoundaries: boolean;
	reduceMotion: boolean;
	/** Manuscript notes kept loaded on each side of the one being read. */
	manuscriptWindow: number;
	showManuscriptPath: boolean;
	showManuscriptSequence: boolean;
	recentProjectPath: string | null;
	recentStep: number;
	certificateCelebrations: Record<string, true>;
	/** The manuscript note last worked in, by project id. */
	recentManuscriptNotes: Record<string, string>;
}

export const DEFAULT_SETTINGS: SnowflakeSettings = {
	settingsSchemaVersion: 6,
	projectRoot: '',
	uiLocale: 'project',
	defaultProjectLocale: 'system',
	openLongTextInSplit: true,
	protectManagedBoundaries: true,
	reduceMotion: false,
	manuscriptWindow: 5,
	showManuscriptPath: true,
	showManuscriptSequence: false,
	recentProjectPath: null,
	recentStep: 1,
	certificateCelebrations: {},
	recentManuscriptNotes: {},
};

const SETTINGS_KEYS = new Set<keyof SnowflakeSettings>([
	'settingsSchemaVersion',
	'projectRoot',
	'uiLocale',
	'defaultProjectLocale',
	'openLongTextInSplit',
	'protectManagedBoundaries',
	'reduceMotion',
	'manuscriptWindow',
	'showManuscriptPath',
	'showManuscriptSequence',
	'recentProjectPath',
	'recentStep',
	'certificateCelebrations',
	'recentManuscriptNotes',
]);

export function sanitizeSettings(input: unknown): SnowflakeSettings {
	const raw = isRecord(input) ? input : {};
	const projectRoot =
		typeof raw.projectRoot === 'string'
			? normalizeProjectRoot(raw.projectRoot)
			: DEFAULT_SETTINGS.projectRoot;
	const uiLocale =
		(raw.settingsSchemaVersion === 2 ||
			raw.settingsSchemaVersion === 3 ||
			raw.settingsSchemaVersion === 4 ||
			raw.settingsSchemaVersion === 5 ||
			raw.settingsSchemaVersion === 6) &&
		isUiLocale(raw.uiLocale)
			? raw.uiLocale
			: DEFAULT_SETTINGS.uiLocale;
	const defaultProjectLocale = isDefaultProjectLocale(raw.defaultProjectLocale)
		? raw.defaultProjectLocale
		: DEFAULT_SETTINGS.defaultProjectLocale;
	const recentStep =
		typeof raw.recentStep === 'number' &&
		Number.isInteger(raw.recentStep) &&
		raw.recentStep >= 1 &&
		raw.recentStep <= 10
			? raw.recentStep
			: DEFAULT_SETTINGS.recentStep;
	const certificateCelebrations: Record<string, true> = {};
	if (isRecord(raw.certificateCelebrations)) {
		for (const [projectId, celebrated] of Object.entries(
			raw.certificateCelebrations,
		)) {
			if (projectId.length > 0 && celebrated === true) {
				certificateCelebrations[projectId] = true;
			}
		}
	}

	// Held to a range a window can be drawn from: nothing to hold on a side,
	// and enough to read around a chapter without loading a novel.
	const manuscriptWindow =
		typeof raw.manuscriptWindow === 'number' &&
		Number.isInteger(raw.manuscriptWindow) &&
		raw.manuscriptWindow >= 0 &&
		raw.manuscriptWindow <= 25
			? raw.manuscriptWindow
			: DEFAULT_SETTINGS.manuscriptWindow;

	const recentManuscriptNotes: Record<string, string> = {};
	if (isRecord(raw.recentManuscriptNotes)) {
		for (const [projectId, path] of Object.entries(raw.recentManuscriptNotes)) {
			if (projectId.length > 0 && typeof path === 'string' && path.length > 0) {
				recentManuscriptNotes[projectId] = normalizePath(path);
			}
		}
	}

	return {
		settingsSchemaVersion: 6,
		projectRoot,
		uiLocale,
		defaultProjectLocale,
		openLongTextInSplit:
			typeof raw.openLongTextInSplit === 'boolean'
				? raw.openLongTextInSplit
				: DEFAULT_SETTINGS.openLongTextInSplit,
		protectManagedBoundaries:
			typeof raw.protectManagedBoundaries === 'boolean'
				? raw.protectManagedBoundaries
				: DEFAULT_SETTINGS.protectManagedBoundaries,
		reduceMotion:
			typeof raw.reduceMotion === 'boolean'
				? raw.reduceMotion
				: DEFAULT_SETTINGS.reduceMotion,
		manuscriptWindow,
		showManuscriptPath:
			typeof raw.showManuscriptPath === 'boolean'
				? raw.showManuscriptPath
				: DEFAULT_SETTINGS.showManuscriptPath,
		showManuscriptSequence:
			typeof raw.showManuscriptSequence === 'boolean'
				? raw.showManuscriptSequence
				: DEFAULT_SETTINGS.showManuscriptSequence,
		recentProjectPath:
			typeof raw.recentProjectPath === 'string'
				? normalizePath(raw.recentProjectPath)
				: null,
		recentStep,
		certificateCelebrations,
		recentManuscriptNotes,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUiLocale(value: unknown): value is UiLocalePreference {
	return (
		value === 'project' ||
		value === 'system' ||
		value === 'en' ||
		value === 'zh-CN'
	);
}

function isDefaultProjectLocale(value: unknown): value is DefaultProjectLocale {
	return value === 'system' || value === 'en' || value === 'zh-CN';
}

export class SnowflakeSettingTab extends PluginSettingTab {
	private readonly owner: SnowflakeMethodPlugin;

	constructor(app: App, plugin: SnowflakeMethodPlugin) {
		super(app, plugin);
		this.owner = plugin;
	}

	private t(key: string): string {
		// This page is global UI, so 'project' falls back to Obsidian's language
		// -- but an explicit English or Chinese choice has to be honoured here,
		// including on the control that sets it.
		return translate(
			resolveGlobalLocale(this.owner.settings.uiLocale, moment.locale()),
			key,
		);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: this.t('settings.projectRoot.name'),
				desc: this.t('settings.projectRoot.desc'),
				// Rendered rather than declared as a `folder` control, so this is
				// the same field the project manager offers — one frame, one list,
				// one set of manners — instead of two controls that merely ask the
				// same question.
				render: (setting) => this.renderProjectRoot(setting),
			},
			{
				name: this.t('settings.uiLocale.name'),
				desc: this.t('settings.uiLocale.desc'),
				control: {
					type: 'dropdown',
					key: 'uiLocale',
					defaultValue: DEFAULT_SETTINGS.uiLocale,
					options: {
						project: this.t('settings.locale.project'),
						system: this.t('settings.locale.system'),
						en: 'English',
						'zh-CN': '简体中文',
					},
				},
			},
			{
				name: this.t('settings.projectLocale.name'),
				desc: this.t('settings.projectLocale.desc'),
				control: {
					type: 'dropdown',
					key: 'defaultProjectLocale',
					defaultValue: DEFAULT_SETTINGS.defaultProjectLocale,
					options: {
						system: this.t('settings.locale.system'),
						en: 'English',
						'zh-CN': '简体中文',
					},
				},
			},
			{
				name: this.t('settings.split.name'),
				desc: this.t('settings.split.desc'),
				control: {
					type: 'toggle',
					key: 'openLongTextInSplit',
					defaultValue: DEFAULT_SETTINGS.openLongTextInSplit,
				},
			},
			{
				name: this.t('settings.reduceMotion.name'),
				desc: this.t('settings.reduceMotion.desc'),
				control: {
					type: 'toggle',
					key: 'reduceMotion',
					defaultValue: DEFAULT_SETTINGS.reduceMotion,
				},
			},
			{
				name: this.t('settings.protectBoundaries.name'),
				desc: this.t('settings.protectBoundaries.desc'),
				control: {
					type: 'toggle',
					key: 'protectManagedBoundaries',
					defaultValue: DEFAULT_SETTINGS.protectManagedBoundaries,
				},
			},
			// Under a heading of their own: three settings that mean nothing to an
			// author who never opens the manuscript, and that would otherwise sit
			// among the ones that govern the whole plugin.
			{
				type: 'group',
				heading: this.t('settings.manuscript.heading'),
				items: [
					{
						name: this.t('settings.manuscriptWindow.name'),
						desc: this.t('settings.manuscriptWindow.desc'),
						control: {
							type: 'slider',
							key: 'manuscriptWindow',
							defaultValue: DEFAULT_SETTINGS.manuscriptWindow,
							min: 0,
							max: 25,
							step: 1,
						},
					},
					{
						name: this.t('settings.manuscriptPath.name'),
						desc: this.t('settings.manuscriptPath.desc'),
						control: {
							type: 'toggle',
							key: 'showManuscriptPath',
							defaultValue: DEFAULT_SETTINGS.showManuscriptPath,
						},
					},
					{
						name: this.t('settings.manuscriptSequence.name'),
						desc: this.t('settings.manuscriptSequence.desc'),
						control: {
							type: 'toggle',
							key: 'showManuscriptSequence',
							defaultValue: DEFAULT_SETTINGS.showManuscriptSequence,
						},
					},
				],
			},
		];
	}

	/**
	 * Builds the project-root field into a setting row, and reports back how to
	 * take it down again — the list it can leave open outlives the row itself.
	 */
	private renderProjectRoot(setting: Setting): () => void {
		const field = buildProjectRootField(this.app, setting.controlEl, {
			label: this.t('settings.projectRoot.name'),
			placeholder: this.t('settings.projectRoot.placeholder'),
			currentRoot: this.owner.settings.projectRoot,
			onChooseRoot: (root) => {
				void this.commitProjectRoot(root, field);
			},
		});
		const commit = (): void => {
			void this.commitProjectRoot(field.inputEl.value, field);
		};
		// Committing on the way out would fight the chevron, which takes focus off
		// the box on its way to opening the list.
		field.inputEl.addEventListener('blur', (event) => {
			const next = event.relatedTarget;
			if (next instanceof HTMLElement && next === field.selectorEl) return;
			commit();
		});
		field.inputEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') return;
			event.preventDefault();
			commit();
		});
		return () => field.destroy();
	}

	/**
	 * Takes a root the author typed or picked. A path the Vault could never hold
	 * is refused and the field put back to what is in force, so the box never
	 * shows a root the plugin is not using.
	 */
	private async commitProjectRoot(
		value: string,
		field: ProjectRootField,
	): Promise<void> {
		if (!isValidProjectRoot(value)) {
			new Notice(this.t('modal.projectManager.projectRootInvalid'));
			field.showValue(this.owner.settings.projectRoot);
			return;
		}
		const root = normalizeProjectRoot(value);
		if (root !== this.owner.settings.projectRoot) {
			await this.setControlValue('projectRoot', root);
		}
		field.showValue(this.owner.settings.projectRoot);
	}

	getControlValue(key: string): unknown {
		if (!SETTINGS_KEYS.has(key as keyof SnowflakeSettings)) {
			return undefined;
		}
		if (key === 'projectRoot') {
			return displayProjectRoot(this.owner.settings.projectRoot);
		}
		return this.owner.settings[key as keyof SnowflakeSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!SETTINGS_KEYS.has(key as keyof SnowflakeSettings)) {
			return;
		}

		switch (key) {
			case 'projectRoot':
				if (typeof value === 'string') {
					this.owner.settings.projectRoot = normalizeProjectRoot(value);
				}
				break;
			case 'uiLocale':
				if (isUiLocale(value)) this.owner.settings.uiLocale = value;
				break;
			case 'defaultProjectLocale':
				if (isDefaultProjectLocale(value)) {
					this.owner.settings.defaultProjectLocale = value;
				}
				break;
			case 'openLongTextInSplit':
				if (typeof value === 'boolean') {
					this.owner.settings.openLongTextInSplit = value;
				}
				break;
			case 'reduceMotion':
				if (typeof value === 'boolean') {
					this.owner.settings.reduceMotion = value;
				}
				break;
			case 'protectManagedBoundaries':
				if (typeof value === 'boolean') {
					this.owner.settings.protectManagedBoundaries = value;
				}
				break;
			case 'manuscriptWindow':
				if (typeof value === 'number' && Number.isInteger(value)) {
					this.owner.settings.manuscriptWindow = value;
				}
				break;
			case 'showManuscriptPath':
				if (typeof value === 'boolean') {
					this.owner.settings.showManuscriptPath = value;
				}
				break;
			case 'showManuscriptSequence':
				if (typeof value === 'boolean') {
					this.owner.settings.showManuscriptSequence = value;
				}
				break;
			default:
				// A key with no case above is saved and announced but never stored,
				// so the control moves and nothing happens. Every key in
				// SETTINGS_KEYS needs a case here; the test below holds it to that.
				break;
		}

		await this.owner.saveSettings();
		await this.owner.handleSettingsChanged(key);
		// Every label on this page is resolved through uiLocale, so the
		// definitions have to be rebuilt when it changes.
		if (key === 'uiLocale') this.update();
	}
}
