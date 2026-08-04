import {
	App,
	moment,
	normalizePath,
	PluginSettingTab,
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
	normalizeProjectRoot,
} from './project-root';

export type { UiLocalePreference } from './i18n';
export type ProjectLocale = 'en' | 'zh-CN';
export type DefaultProjectLocale = 'system' | ProjectLocale;

export interface SnowflakeSettings {
	settingsSchemaVersion: 5;
	projectRoot: string;
	uiLocale: UiLocalePreference;
	defaultProjectLocale: DefaultProjectLocale;
	openLongTextInSplit: boolean;
	protectManagedBoundaries: boolean;
	reduceMotion: boolean;
	recentProjectPath: string | null;
	recentStep: number;
	certificateCelebrations: Record<string, true>;
}

export const DEFAULT_SETTINGS: SnowflakeSettings = {
	settingsSchemaVersion: 5,
	projectRoot: '',
	uiLocale: 'project',
	defaultProjectLocale: 'system',
	openLongTextInSplit: true,
	protectManagedBoundaries: true,
	reduceMotion: false,
	recentProjectPath: null,
	recentStep: 1,
	certificateCelebrations: {},
};

const SETTINGS_KEYS = new Set<keyof SnowflakeSettings>([
	'settingsSchemaVersion',
	'projectRoot',
	'uiLocale',
	'defaultProjectLocale',
	'openLongTextInSplit',
	'protectManagedBoundaries',
	'reduceMotion',
	'recentProjectPath',
	'recentStep',
	'certificateCelebrations',
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
			raw.settingsSchemaVersion === 5) &&
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

	return {
		settingsSchemaVersion: 5,
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
		recentProjectPath:
			typeof raw.recentProjectPath === 'string'
				? normalizePath(raw.recentProjectPath)
				: null,
		recentStep,
		certificateCelebrations,
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
				control: {
					type: 'folder',
					key: 'projectRoot',
					defaultValue: DEFAULT_SETTINGS.projectRoot,
					includeRoot: true,
					placeholder: this.t('settings.projectRoot.placeholder'),
				},
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
		];
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
			default:
				break;
		}

		await this.owner.saveSettings();
		await this.owner.handleSettingsChanged(key);
		// Every label on this page is resolved through uiLocale, so the
		// definitions have to be rebuilt when it changes.
		if (key === 'uiLocale') this.update();
	}
}
