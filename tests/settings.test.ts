import { describe, expect, it } from 'vitest';

import {
	displayProjectRoot,
	isValidProjectRoot,
	movedWithRename,
	normalizeProjectRoot,
	touchesAnyProject,
} from '../src/project-root';
import {
	DEFAULT_SETTINGS,
	SnowflakeSettingTab,
	sanitizeSettings,
	type SnowflakeSettings,
} from '../src/settings';
import type SnowflakeMethodPlugin from '../src/main';

function settingTabFor(
	uiLocale: SnowflakeSettings['uiLocale'],
): SnowflakeSettingTab {
	const plugin = {
		settings: { ...DEFAULT_SETTINGS, uiLocale },
	} as SnowflakeMethodPlugin;
	return new SnowflakeSettingTab({} as never, plugin);
}

function settingNames(tab: SnowflakeSettingTab): string[] {
	return tab
		.getSettingDefinitions()
		.map((item) => ('name' in item ? String(item.name) : ''));
}

describe('settings', () => {
	it('migrates settings to schema v5 with boundary protection enabled', () => {
		expect(DEFAULT_SETTINGS.settingsSchemaVersion).toBe(5);
		expect(DEFAULT_SETTINGS.protectManagedBoundaries).toBe(true);
		const migrated = sanitizeSettings({
			settingsSchemaVersion: 4,
			uiLocale: 'zh-CN',
		});
		expect(migrated.settingsSchemaVersion).toBe(5);
		expect(migrated.uiLocale).toBe('zh-CN');
		expect(migrated.protectManagedBoundaries).toBe(true);
	});

	it('preserves an explicit boundary protection preference', () => {
		expect(
			sanitizeSettings({
				settingsSchemaVersion: 5,
				protectManagedBoundaries: false,
			}).protectManagedBoundaries,
		).toBe(false);
		expect(
			sanitizeSettings({
				settingsSchemaVersion: 5,
				protectManagedBoundaries: 'no',
			}).protectManagedBoundaries,
		).toBe(true);
	});

	it('uses the current project language as the default UI language', () => {
		expect(DEFAULT_SETTINGS.uiLocale).toBe('project');
		expect(sanitizeSettings(undefined).uiLocale).toBe('project');
	});

	it('follows Obsidian as the default project language', () => {
		expect(DEFAULT_SETTINGS.defaultProjectLocale).toBe('system');
		expect(sanitizeSettings(undefined).defaultProjectLocale).toBe('system');
	});

	it('keeps motion enabled until the plugin setting disables it', () => {
		expect(DEFAULT_SETTINGS.reduceMotion).toBe(false);
		expect(sanitizeSettings(undefined).reduceMotion).toBe(false);
		expect(sanitizeSettings({ reduceMotion: true }).reduceMotion).toBe(true);
	});

	it('uses an empty canonical path for the current Vault root', () => {
		expect(DEFAULT_SETTINGS.projectRoot).toBe('');
		expect(sanitizeSettings(undefined).projectRoot).toBe('');
		expect(normalizeProjectRoot('/')).toBe('');
		expect(normalizeProjectRoot('///')).toBe('');
		expect(normalizeProjectRoot('')).toBe('');
		expect(displayProjectRoot('')).toBe('/');
		expect(sanitizeSettings({ projectRoot: '/' }).projectRoot).toBe('');
		expect(sanitizeSettings({ projectRoot: '' }).projectRoot).toBe('');
		expect(
			sanitizeSettings({ projectRoot: 'Snowflake Projects/' }).projectRoot,
		).toBe('Snowflake Projects');
	});

	it('accepts new Vault-relative project roots and rejects unsafe paths', () => {
		expect(isValidProjectRoot('Future Projects/Snowflake')).toBe(true);
		expect(isValidProjectRoot('Future Projects/')).toBe(true);
		expect(isValidProjectRoot('/')).toBe(true);
		expect(isValidProjectRoot('/absolute/path')).toBe(false);
		expect(isValidProjectRoot('../outside')).toBe(false);
		expect(isValidProjectRoot('Projects/../outside')).toBe(false);
		expect(isValidProjectRoot('Projects\\Snowflake')).toBe(false);
	});

	it('preserves each supported default project language preference', () => {
		for (const defaultProjectLocale of ['system', 'en', 'zh-CN'] as const) {
			expect(sanitizeSettings({ defaultProjectLocale }).defaultProjectLocale).toBe(
				defaultProjectLocale,
			);
		}
		expect(
			sanitizeSettings({ defaultProjectLocale: 'fr' }).defaultProjectLocale,
		).toBe('system');
	});

	it('migrates pre-v2 UI language settings to the new default', () => {
		expect(
			sanitizeSettings({ settingsSchemaVersion: 1, uiLocale: 'system' })
				.uiLocale,
		).toBe('project');
	});

	it('preserves an explicit v2 UI language choice', () => {
		expect(
			sanitizeSettings({ settingsSchemaVersion: 2, uiLocale: 'system' })
				.uiLocale,
		).toBe('system');
		expect(
			sanitizeSettings({ settingsSchemaVersion: 2, uiLocale: 'zh-CN' })
				.uiLocale,
		).toBe('zh-CN');
	});

	it('preserves only completed project celebration state', () => {
		const settings = sanitizeSettings({
			settingsSchemaVersion: 3,
			certificateCelebrations: {
				'project-complete': true,
				'project-incomplete': false,
				'project-invalid': 'yes',
			},
		});
		expect(settings.certificateCelebrations).toEqual({
			'project-complete': true,
		});
	});

	// A dashboard refresh re-reads the whole current project, so unrelated notes
	// must not schedule one. With the root left at the Vault root, every note in
	// the Vault is "in the root", and nesting depth cannot separate them either:
	// Inbox/note.md is exactly as deep as Novel/00_System/001.md.
	it('ignores unrelated notes at any depth outside the project folders', () => {
		const projects = ['Novel', 'Second Novel'];

		expect(touchesAnyProject('Novel/00_System/001.md', projects)).toBe(true);
		expect(touchesAnyProject('Second Novel/20_Character/Ada.md', projects)).toBe(
			true,
		);

		expect(touchesAnyProject('Inbox.md', projects)).toBe(false);
		expect(touchesAnyProject('Inbox/note.md', projects)).toBe(false);
		expect(touchesAnyProject('Archive/old.md', projects)).toBe(false);
		expect(touchesAnyProject('Archive/2026/notes/deep.md', projects)).toBe(false);
		// A name that merely starts with a project's name is not inside it.
		expect(touchesAnyProject('Novel Ideas/note.md', projects)).toBe(false);
		expect(touchesAnyProject('anything', [])).toBe(false);
	});

	// The settings page is global UI, so 'project' falls back to Obsidian's
	// language -- but it also renders the control that sets uiLocale, and an
	// explicit choice there has to apply to the page making it.
	it('renders the settings page in the chosen interface language', () => {
		const english = settingNames(settingTabFor('en'));
		const chinese = settingNames(settingTabFor('zh-CN'));

		expect(english.length).toBeGreaterThan(0);
		expect(chinese).toHaveLength(english.length);
		expect(chinese).not.toEqual(english);
		expect(chinese.every((name) => name.length > 0)).toBe(true);

		// The stub reports an English Obsidian, so both fallbacks land on English.
		expect(settingNames(settingTabFor('system'))).toEqual(english);
		expect(settingNames(settingTabFor('project'))).toEqual(english);
	});

	it('sees a folder that contains a project, so deletes and renames still count', () => {
		const projects = ['Snowflake Projects/Novel'];

		expect(touchesAnyProject('Snowflake Projects/Novel', projects)).toBe(true);
		expect(touchesAnyProject('Snowflake Projects', projects)).toBe(true);
		expect(touchesAnyProject('Snowflake Projects/Other', projects)).toBe(false);
	});

	it('follows the configured root when its folder is renamed', () => {
		// The root folder itself, and a folder above it.
		expect(movedWithRename('Snowflake Projects', 'Snowflake Projects', 'Novels')).toBe(
			'Novels',
		);
		expect(movedWithRename('Writing/Projects', 'Writing', 'Docs')).toBe(
			'Docs/Projects',
		);
		expect(
			movedWithRename(
				'Snowflake Projects/Novel/00_System/001.md',
				'Snowflake Projects',
				'Novels',
			),
		).toBe('Novels/Novel/00_System/001.md');

		// Unrelated renames, a prefix that is not a path boundary, and the Vault
		// root, which has no folder to rename.
		expect(movedWithRename('Snowflake Projects', 'Other', 'Renamed')).toBeNull();
		expect(movedWithRename('Snowflake Projects', 'Snowflake', 'Novels')).toBeNull();
		expect(movedWithRename('', 'Snowflake Projects', 'Novels')).toBeNull();
	});
});
