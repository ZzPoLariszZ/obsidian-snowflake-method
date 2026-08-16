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

/** Every row the page offers, groups walked into rather than counted as one. */
function settingRows(
	tab: SnowflakeSettingTab,
): { name: string; key?: string; options?: string[] }[] {
	const rows: { name: string; key?: string; options?: string[] }[] = [];
	const visit = (items: readonly unknown[]): void => {
		for (const item of items as Record<string, never>[]) {
			if (Array.isArray(item.items)) {
				if (typeof item.heading === 'string') rows.push({ name: item.heading });
				visit(item.items);
				continue;
			}
			if (!('name' in item)) continue;
			const control = item.control as
				| { key?: string; options?: Record<string, string> }
				| undefined;
			if (control?.key === undefined) {
				rows.push({ name: String(item.name) });
				continue;
			}
			rows.push({
				name: String(item.name),
				key: control.key,
				// A dropdown's own list, so a test can ask it for a value it offers
				// rather than the one it already holds.
				...(control.options === undefined
					? {}
					: { options: Object.keys(control.options) }),
			});
		}
	};
	visit(tab.getSettingDefinitions());
	return rows;
}

function settingNames(tab: SnowflakeSettingTab): string[] {
	return settingRows(tab).map((row) => row.name);
}

/** A tab whose plugin records saves, so a control's effect can be observed. */
function writableSettingTab(): {
	tab: SnowflakeSettingTab;
	settings: SnowflakeSettings;
} {
	const settings: SnowflakeSettings = { ...DEFAULT_SETTINGS };
	const plugin = {
		settings,
		saveSettings: async () => undefined,
		handleSettingsChanged: async () => undefined,
	} as unknown as SnowflakeMethodPlugin;
	return { tab: new SnowflakeSettingTab({} as never, plugin), settings };
}

/**
 * A value of the right type that is not the one the setting already holds.
 * A dropdown answers from its own list: asking one for the value it is already
 * on proves nothing about a key the page never stores.
 */
function otherValue(current: unknown, options?: readonly string[]): unknown {
	if (typeof current === 'boolean') return !current;
	if (typeof current === 'number') return current + 1;
	if (options !== undefined) {
		return options.find((option) => option !== current) ?? current;
	}
	return current;
}

describe('settings', () => {
	/**
	 * setControlValue stores each key by hand, and a key it has no case for is
	 * saved and announced without ever being written — the control moves and
	 * nothing happens. Nothing else notices, so this does.
	 */
	it('stores every control the page offers', async () => {
		for (const row of settingRows(writableSettingTab().tab)) {
			const { key, options } = row;
			if (key === undefined || key === 'projectRoot' || key === 'uiLocale') {
				continue;
			}
			const { tab, settings } = writableSettingTab();
			const wanted = otherValue(tab.getControlValue(key), options);

			await tab.setControlValue(key, wanted);

			expect(
				{ key, value: settings[key as keyof SnowflakeSettings] },
				`"${key}" has no case in setControlValue`,
			).toEqual({ key, value: wanted });
			expect(tab.getControlValue(key)).toEqual(wanted);
		}
	});

	it('migrates settings to schema v6 with boundary protection enabled', () => {
		expect(DEFAULT_SETTINGS.settingsSchemaVersion).toBe(6);
		expect(DEFAULT_SETTINGS.protectManagedBoundaries).toBe(true);
		const migrated = sanitizeSettings({
			settingsSchemaVersion: 4,
			uiLocale: 'zh-CN',
		});
		expect(migrated.settingsSchemaVersion).toBe(6);
		expect(migrated.uiLocale).toBe('zh-CN');
		expect(migrated.protectManagedBoundaries).toBe(true);
	});

	it('keeps the tables on their actions column unless it is turned off', () => {
		expect(DEFAULT_SETTINGS.showTableActionsColumn).toBe(true);
		expect(
			sanitizeSettings({ showTableActionsColumn: false })
				.showTableActionsColumn,
		).toBe(false);
		expect(
			sanitizeSettings({ showTableActionsColumn: 'no' }).showTableActionsColumn,
		).toBe(true);
	});

	it('keeps the tables quiet about progress until it is asked for', () => {
		expect(DEFAULT_SETTINGS.showTableProgressStatus).toBe(false);
		expect(
			sanitizeSettings({ showTableProgressStatus: true })
				.showTableProgressStatus,
		).toBe(true);
		expect(
			sanitizeSettings({ showTableProgressStatus: 'yes' })
				.showTableProgressStatus,
		).toBe(false);
	});

	it('leaves the ten steps standing until freeform mode is chosen', () => {
		expect(DEFAULT_SETTINGS.freeformMode).toBe(false);
		expect(sanitizeSettings({ freeformMode: true }).freeformMode).toBe(true);
		expect(sanitizeSettings({ freeformMode: 'on' }).freeformMode).toBe(false);
	});

	it('keeps the manuscript window to a size a page can be built from', () => {
		expect(DEFAULT_SETTINGS.manuscriptWindow).toBe(5);
		expect(DEFAULT_SETTINGS.showManuscriptSequence).toBe(false);
		expect(sanitizeSettings({ manuscriptWindow: 0 }).manuscriptWindow).toBe(0);
		expect(sanitizeSettings({ manuscriptWindow: 12 }).manuscriptWindow).toBe(12);
		expect(sanitizeSettings({ manuscriptWindow: -1 }).manuscriptWindow).toBe(5);
		expect(sanitizeSettings({ manuscriptWindow: 400 }).manuscriptWindow).toBe(5);
		expect(sanitizeSettings({ manuscriptWindow: '5' }).manuscriptWindow).toBe(5);
		expect(
			sanitizeSettings({ showManuscriptSequence: true }).showManuscriptSequence,
		).toBe(true);
	});

	it('drops settings the plugin no longer keeps, such as the pager size', () => {
		expect(sanitizeSettings({ memberPageSize: 50 })).not.toHaveProperty(
			'memberPageSize',
		);
	});

	it('starts with typewriter scrolling on and focus off, and holds a choice', () => {
		expect(DEFAULT_SETTINGS.manuscriptTypewriter).toBe(true);
		expect(DEFAULT_SETTINGS.manuscriptFocusLevel).toBe('off');
		expect(
			sanitizeSettings({ manuscriptTypewriter: false }).manuscriptTypewriter,
		).toBe(false);
		for (const level of ['off', 'on', 'deep', 'solo'] as const) {
			expect(
				sanitizeSettings({ manuscriptFocusLevel: level }).manuscriptFocusLevel,
			).toBe(level);
		}
		// Junk stays junk: anything unrecognised is the default.
		expect(
			sanitizeSettings({ manuscriptTypewriter: 'yes' }).manuscriptTypewriter,
		).toBe(true);
		expect(
			sanitizeSettings({ manuscriptFocusLevel: 'zen' }).manuscriptFocusLevel,
		).toBe('off');
	});

	it('reads the level a file written by the three focus switches added up to', () => {
		expect(
			sanitizeSettings({ manuscriptFocus: true }).manuscriptFocusLevel,
		).toBe('on');
		expect(
			sanitizeSettings({
				manuscriptFocus: true,
				manuscriptFocusFadesDashboard: true,
			}).manuscriptFocusLevel,
		).toBe('deep');
		expect(
			sanitizeSettings({ manuscriptSolo: true }).manuscriptFocusLevel,
		).toBe('solo');
		expect(
			sanitizeSettings({ manuscriptFocus: false }).manuscriptFocusLevel,
		).toBe('off');
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

	it('opens a note’s own form when a field asks for one', () => {
		expect(DEFAULT_SETTINGS.createFromField).toBe('form');
		expect(sanitizeSettings(undefined).createFromField).toBe('form');
		expect(sanitizeSettings({ createFromField: 'now' }).createFromField).toBe(
			'now',
		);
		// Anything else is not a way of creating, so the default answers for it.
		expect(
			sanitizeSettings({ createFromField: 'later' }).createFromField,
		).toBe('form');
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
