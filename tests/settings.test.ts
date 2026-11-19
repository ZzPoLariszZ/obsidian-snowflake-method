import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MANUSCRIPT_PRESENTATION,
	PROJECT_LANGUAGES,
	type CustomHighlightRule,
	type ManuscriptPresentation,
} from '../src/domain';

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
	isManuscriptPresentationKey,
	PRESENTATION_SETTINGS_KEYS,
	sanitizeSettings,
	type SnowflakeSettings,
} from '../src/settings';
import type SnowflakeMethodPlugin from '../src/main';
import {
	IDLE_RECORDING_STATE,
	defaultRecordingPreferences,
	sanitizeRecordingPreferences,
	type RecordingPreferences,
	type RecordingState,
	type RecordingSystem,
} from '../src/domain';
import type { ObsProbe } from '../src/services';
import type { RecordingSettingsBridge } from '../src/ui/recording-bridge';
import type { RecordingSettingsMemory } from '../src/ui/recording-settings';

function settingTabFor(
	uiLocale: SnowflakeSettings['uiLocale'],
): SnowflakeSettingTab {
	const plugin = {
		settings: { ...DEFAULT_SETTINGS, uiLocale },
		// Nothing records where these pages are drawn: the section stands only where something does.
		recordingSettings: () => null,
	} as unknown as SnowflakeMethodPlugin;
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
			// A nameless row is plumbing -- the fold dress each section hides
			// at its head -- not a row the page shows anyone.
			if (String(item.name).length === 0) continue;
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
		saveSettingsSoon: () => undefined,
		handleSettingsChanged: async () => undefined,
		confirmBoundaryProtectionOff: async () => true,
		recordingSettings: () => null,
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

	/**
	 * Turning the guard off leaves every note's markers open, so the switch
	 * asks first; a refusal writes and announces nothing. Turning it back on
	 * asks nothing at all.
	 */
	it('asks before turning boundary protection off, and only then', async () => {
		const asked: boolean[] = [];
		const saved: string[] = [];
		const settings: SnowflakeSettings = { ...DEFAULT_SETTINGS };
		let answer = false;
		const plugin = {
			settings,
			saveSettings: async () => {
				saved.push('save');
			},
			saveSettingsSoon: () => undefined,
			handleSettingsChanged: async (key: string) => {
				saved.push(key);
			},
			confirmBoundaryProtectionOff: async () => {
				asked.push(answer);
				return answer;
			},
		} as unknown as SnowflakeMethodPlugin;
		const tab = new SnowflakeSettingTab({} as never, plugin);

		await tab.setControlValue('protectManagedBoundaries', false);
		expect(settings.protectManagedBoundaries).toBe(true);
		expect(saved).toEqual([]);

		answer = true;
		await tab.setControlValue('protectManagedBoundaries', false);
		expect(settings.protectManagedBoundaries).toBe(false);
		expect(saved).toEqual(['save', 'protectManagedBoundaries']);

		await tab.setControlValue('protectManagedBoundaries', true);
		expect(settings.protectManagedBoundaries).toBe(true);
		expect(asked).toEqual([false, true]);
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

	it('shows the derived tasks until asked not to', () => {
		expect(DEFAULT_SETTINGS.showDerivedTasks).toBe(true);
		expect(sanitizeSettings({ showDerivedTasks: false }).showDerivedTasks).toBe(false);
		expect(sanitizeSettings({ showDerivedTasks: 'no' }).showDerivedTasks).toBe(true);
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

	it('shows the wheel of chapters in the stream\u2019s margin unless it is turned off', () => {
		expect(DEFAULT_SETTINGS.showManuscriptContents).toBe(true);
		expect(sanitizeSettings({}).showManuscriptContents).toBe(true);
		expect(
			sanitizeSettings({ showManuscriptContents: false }).showManuscriptContents,
		).toBe(false);
		expect(
			sanitizeSettings({ showManuscriptContents: 'no' }).showManuscriptContents,
		).toBe(true);
	});

	it('holds the session clocks to their ranges, or the defaults', () => {
		expect(DEFAULT_SETTINGS.sessionIdleThresholdSeconds).toBe(60);
		expect(DEFAULT_SETTINGS.sessionCountdownMinutes).toBe(45);
		expect(DEFAULT_SETTINGS.sessionPomodoroWorkMinutes).toBe(25);
		expect(DEFAULT_SETTINGS.sessionPomodoroBreakMinutes).toBe(5);
		expect(DEFAULT_SETTINGS.sessionPomodoroAutoRepeat).toBe(true);
		// A pomodoro out of the box, and focus mode starting a sitting on its
		// own: the two the author is most likely to want and least likely to
		// go looking for.
		expect(DEFAULT_SETTINGS.sessionDefaultType).toBe('pomodoro');
		expect(DEFAULT_SETTINGS.sessionAutoWithFocusMode).toBe(true);
		expect(DEFAULT_SETTINGS.sessionDailyWordGoalProject).toBe(6000);
		expect(DEFAULT_SETTINGS.sessionDailyWordGoalManuscript).toBe(4000);
		// The goal aims at the manuscript, because that is the writing a day
		// is measured by. The statistics still open on the whole project:
		// which words are counted towards a target and which are shown in a
		// chart are two questions, and each keeps its own answer.
		expect(DEFAULT_SETTINGS.sessionDailyGoalScope).toBe('manuscript');
		expect(DEFAULT_SETTINGS.sessionScope).toBe('project');
		// A note's own title is an H1 the plugin wrote, never the author's.
		expect(DEFAULT_SETTINGS.writingCountHeadings).toBe('skip-first-h1');
		// Clamped to the nearest bound, never silently reset: the dialogs and
		// this loader hold a value to the same limits, so a number that worked
		// all day is at worst pulled to the edge of its range overnight --
		// only what is not a number at all falls back to the default.
		expect(
			sanitizeSettings({ sessionIdleThresholdSeconds: 29 })
				.sessionIdleThresholdSeconds,
		).toBe(30);
		expect(
			sanitizeSettings({ sessionIdleThresholdSeconds: 301 })
				.sessionIdleThresholdSeconds,
		).toBe(300);
		expect(
			sanitizeSettings({ sessionIdleThresholdSeconds: 2.5 })
				.sessionIdleThresholdSeconds,
		).toBe(30);
		expect(
			sanitizeSettings({ sessionIdleThresholdSeconds: 30 })
				.sessionIdleThresholdSeconds,
		).toBe(30);
		expect(
			sanitizeSettings({ sessionIdleThresholdSeconds: 'long' })
				.sessionIdleThresholdSeconds,
		).toBe(60);
		expect(
			sanitizeSettings({ sessionCountdownMinutes: 181 }).sessionCountdownMinutes,
		).toBe(180);
		expect(
			sanitizeSettings({ sessionCountdownMinutes: 3 }).sessionCountdownMinutes,
		).toBe(5);
		expect(
			sanitizeSettings({ sessionPomodoroWorkMinutes: 90 })
				.sessionPomodoroWorkMinutes,
		).toBe(90);
		expect(
			sanitizeSettings({ sessionPomodoroBreakMinutes: 0 })
				.sessionPomodoroBreakMinutes,
		).toBe(1);
		expect(
			sanitizeSettings({ sessionDailyWordGoalProject: 2_000_000 })
				.sessionDailyWordGoalProject,
		).toBe(1_000_000);
		// Anything that is not a boolean falls back to the default, whatever
		// the default happens to be.
		expect(
			sanitizeSettings({ sessionAutoWithFocusMode: 'yes' })
				.sessionAutoWithFocusMode,
		).toBe(DEFAULT_SETTINGS.sessionAutoWithFocusMode);
		// Words count outside sessions from the first install onward; a writer
		// who wants only session words turns it off, and the choice holds.
		expect(DEFAULT_SETTINGS.sessionTrackUntimedWords).toBe(true);
		expect(
			sanitizeSettings({ sessionTrackUntimedWords: false })
				.sessionTrackUntimedWords,
		).toBe(false);
		expect(
			sanitizeSettings({ sessionTrackUntimedWords: 'yes' })
				.sessionTrackUntimedWords,
		).toBe(true);
	});

	it('drops settings the plugin no longer keeps, such as the pager size', () => {
		expect(sanitizeSettings({ memberPageSize: 50 })).not.toHaveProperty(
			'memberPageSize',
		);
	});

	it('dresses the page from the theme by default, and holds each value to its range', () => {
		expect(DEFAULT_SETTINGS.manuscriptFontFamily).toBe('');
		expect(DEFAULT_SETTINGS.manuscriptFontSize).toBe(0);
		expect(DEFAULT_SETTINGS.manuscriptLineHeight).toBe(0);
		expect(DEFAULT_SETTINGS.manuscriptContentWidth).toBe(0);
		// One blank line, which is what the editor has always shown.
		expect(DEFAULT_SETTINGS.manuscriptParagraphSpacing).toBe(1);
		expect(DEFAULT_SETTINGS.manuscriptFirstLineIndent).toBe(0);
		expect(DEFAULT_SETTINGS.manuscriptTextAlign).toBe('justify');
		expect(DEFAULT_SETTINGS.manuscriptHyphenation).toBe(false);
		expect(DEFAULT_SETTINGS.manuscriptEnterParagraph).toBe(true);
		expect(DEFAULT_SETTINGS.manuscriptTintLight).toBe('');
		expect(DEFAULT_SETTINGS.manuscriptTintDark).toBe('');
		expect(DEFAULT_SETTINGS.manuscriptGuide).toBe('none');
		// The dress reaches every note of a Snowflake project until narrowed
		// to the stream or widened to the vault.
		expect(DEFAULT_SETTINGS.manuscriptPresentationScope).toBe('project');
		// The ground goes where the typography goes until it is carried over
		// the plugin's whole interface or the whole app.
		expect(DEFAULT_SETTINGS.manuscriptTintScope).toBe('typography');

		// And every one of them is the domain's value rather than a second
		// copy of it. Walked through the mapping, so a twelfth dress field is
		// covered the day it is added.
		for (const [field, key] of Object.entries(PRESENTATION_SETTINGS_KEYS)) {
			expect(DEFAULT_SETTINGS[key]).toEqual(
				DEFAULT_MANUSCRIPT_PRESENTATION[field as keyof ManuscriptPresentation],
			);
		}

		const read = (raw: Record<string, unknown>): SnowflakeSettings =>
			sanitizeSettings(raw);
		expect(
			read({ manuscriptFontFamily: ' Iowan Old Style , serif ' }).manuscriptFontFamily,
		).toBe('Iowan Old Style, serif');
		expect(read({ manuscriptFontFamily: 42 }).manuscriptFontFamily).toBe('');
		// The faces the picker offers at the top of its list are stored as a
		// list of font lists, newest first, without repeats.
		expect(DEFAULT_SETTINGS.manuscriptRecentFonts).toEqual([]);
		expect(
			read({ manuscriptRecentFonts: ['Georgia', 'Georgia', 42, ''] })
				.manuscriptRecentFonts,
		).toEqual(['Georgia']);
		expect(read({ manuscriptRecentFonts: 'Georgia' }).manuscriptRecentFonts).toEqual(
			[],
		);
		expect(read({ manuscriptFontSize: 18 }).manuscriptFontSize).toBe(18);
		expect(read({ manuscriptFontSize: 2 }).manuscriptFontSize).toBe(12);
		expect(read({ manuscriptFontSize: '18' }).manuscriptFontSize).toBe(0);
		expect(read({ manuscriptLineHeight: 1.8 }).manuscriptLineHeight).toBe(1.8);
		expect(read({ manuscriptLineHeight: 1.1 }).manuscriptLineHeight).toBe(1.4);
		expect(read({ manuscriptLineHeight: 9 }).manuscriptLineHeight).toBe(3);
		expect(read({ manuscriptContentWidth: 760 }).manuscriptContentWidth).toBe(760);
		expect(read({ manuscriptContentWidth: 99999 }).manuscriptContentWidth).toBe(2000);
		expect(
			read({ manuscriptParagraphSpacing: 0.5 }).manuscriptParagraphSpacing,
		).toBe(0.5);
		// Never below a quarter of a line: the editor must keep a blank line
		// the caret can stand on, and the page keeps the same gap.
		expect(read({ manuscriptParagraphSpacing: 0 }).manuscriptParagraphSpacing).toBe(
			0.25,
		);
		expect(
			read({ manuscriptParagraphSpacing: 'wide' }).manuscriptParagraphSpacing,
		).toBe(1);
		expect(read({ manuscriptFirstLineIndent: 2 }).manuscriptFirstLineIndent).toBe(2);
		expect(read({ manuscriptFirstLineIndent: -2 }).manuscriptFirstLineIndent).toBe(
			0,
		);
		expect(read({ manuscriptTextAlign: 'justify' }).manuscriptTextAlign).toBe('justify');
		expect(read({ manuscriptTextAlign: 'center' }).manuscriptTextAlign).toBe('justify');
		expect(read({ manuscriptHyphenation: true }).manuscriptHyphenation).toBe(true);
		expect(read({ manuscriptHyphenation: 'yes' }).manuscriptHyphenation).toBe(false);
		expect(read({ manuscriptEnterParagraph: false }).manuscriptEnterParagraph).toBe(false);
		expect(read({ manuscriptEnterParagraph: 'no' }).manuscriptEnterParagraph).toBe(true);
		expect(read({ manuscriptTintLight: '#C7E0C7' }).manuscriptTintLight).toBe(
			'#c7e0c7',
		);
		expect(read({ manuscriptTintLight: 'sage' }).manuscriptTintLight).toBe('');
		expect(read({ manuscriptTintDark: '#202e47' }).manuscriptTintDark).toBe(
			'#202e47',
		);
		for (const guide of ['none', 'solid', 'dashed'] as const) {
			expect(read({ manuscriptGuide: guide }).manuscriptGuide).toBe(guide);
		}
		expect(read({ manuscriptGuide: 'dotted' }).manuscriptGuide).toBe('none');
		for (const scope of ['stream', 'project', 'vault'] as const) {
			expect(
				read({ manuscriptPresentationScope: scope }).manuscriptPresentationScope,
			).toBe(scope);
		}
		expect(
			read({ manuscriptPresentationScope: 'manuscript' }).manuscriptPresentationScope,
		).toBe('project');
		for (const scope of ['typography', 'snowflake', 'obsidian'] as const) {
			expect(read({ manuscriptTintScope: scope }).manuscriptTintScope).toBe(scope);
		}
		expect(read({ manuscriptTintScope: 'vault' }).manuscriptTintScope).toBe('typography');
	});

	/**
	 * The typography reaches past the stream, to notes in Obsidian's own
	 * tabs and, with the background, to the rest of the app, so it stands in
	 * a section of its own just above the stream's, its scope first.
	 */
	it('gives the typography a section of its own, just above the stream’s', () => {
		const groups = settingTabFor('en').getSettingDefinitions() as {
			heading?: string;
			items?: { name?: unknown }[];
		}[];
		expect(groups.map((group) => group.heading)).toEqual([
			'General',
			'File explorer',
			'Typography',
			'Manuscript stream',
			'Data statistics',
			'Export',
		]);
		const names = (index: number): unknown[] =>
			(groups[index]?.items ?? [])
				.map((item) => item.name)
				.filter((name) => name !== '');
		expect(names(2)[0]).toBe('Typography scope');
		expect(names(2)).toContain('Background scope');
		expect(names(3)).not.toContain('Font family');
		expect(names(3)).not.toContain('Typography');
		expect(settingTabFor('zh-CN').getSettingDefinitions().map((group) => (group as { heading?: string }).heading)).toEqual([
			'通用',
			'文件列表',
			'排版',
			'正文流',
			'数据统计',
			'导出',
		]);
	});

	/**
	 * The background scope's row is drawn rather than declared, so the walk
	 * over the declared rows never reaches it. It is no part of the dress a
	 * stream wears, so it is saved before it is announced.
	 */
	it('stores the background scope the drawn row hands over', async () => {
		const { tab, settings } = writableSettingTab();
		expect(isManuscriptPresentationKey('manuscriptTintScope')).toBe(false);
		await tab.setControlValue('manuscriptTintScope', 'obsidian');
		expect(settings.manuscriptTintScope).toBe('obsidian');
		expect(tab.getControlValue('manuscriptTintScope')).toBe('obsidian');
		await tab.setControlValue('manuscriptTintScope', 'vault');
		expect(settings.manuscriptTintScope).toBe('obsidian');
	});

	/**
	 * The appearance rows are rendered rather than declared, so the walk above
	 * never reaches them: each key is stored by hand here, which also proves
	 * it is in SETTINGS_KEYS, without which setControlValue answers nothing.
	 */
	it('stores every appearance key the rendered rows hand over', async () => {
		const wanted: Partial<SnowflakeSettings> = {
			manuscriptFontFamily: 'Georgia, serif',
			manuscriptFontSize: 18,
			manuscriptLineHeight: 1.8,
			manuscriptContentWidth: 760,
			manuscriptParagraphSpacing: 0.5,
			manuscriptFirstLineIndent: 2,
			manuscriptTextAlign: 'justify',
			manuscriptHyphenation: true,
			manuscriptTintLight: '#e5d8be',
			manuscriptTintDark: '#202e47',
			manuscriptGuide: 'dashed',
		};
		for (const [key, value] of Object.entries(wanted)) {
			const { tab, settings } = writableSettingTab();
			expect(isManuscriptPresentationKey(key), key).toBe(true);
			await tab.setControlValue(key, value);
			expect({ key, value: settings[key as keyof SnowflakeSettings] }).toEqual({
				key,
				value,
			});
			expect(tab.getControlValue(key)).toEqual(value);
		}
		expect(isManuscriptPresentationKey('manuscriptWindow')).toBe(false);
		expect(isManuscriptPresentationKey('manuscriptTypewriter')).toBe(false);
		// And the walk above covers the dress entire, so a twelfth value cannot
		// be added with a row on the page and no way through to an open stream.
		expect(Object.keys(wanted).sort()).toEqual(
			Object.values(PRESENTATION_SETTINGS_KEYS).sort(),
		);
	});

	/**
	 * Two silent ways to lose a setting: a key missing from the literal
	 * sanitizeSettings returns is dropped on every load, and a key missing
	 * from SETTINGS_KEYS makes its row a no-op. Both are parity with the
	 * defaults, so both are held here.
	 */
	it('keeps every default through a load and offers every key to its row', () => {
		const keys = Object.keys(DEFAULT_SETTINGS).sort();
		expect(Object.keys(sanitizeSettings({ ...DEFAULT_SETTINGS })).sort()).toEqual(
			keys,
		);
		const { tab } = writableSettingTab();
		for (const key of keys) {
			// The root is shown as a path rather than stored as one.
			if (key === 'projectRoot') continue;
			expect(tab.getControlValue(key), key).toEqual(
				DEFAULT_SETTINGS[key as keyof SnowflakeSettings],
			);
		}
	});

	it('reads the mention highlight choice and falls back to off', () => {
		expect(
			sanitizeSettings({
				...DEFAULT_SETTINGS,
				manuscriptMentionHighlight: 'unlinked',
			}).manuscriptMentionHighlight,
		).toBe('unlinked');
		expect(
			sanitizeSettings({
				...DEFAULT_SETTINGS,
				manuscriptMentionHighlight: 'sometimes',
			}).manuscriptMentionHighlight,
		).toBe('off');
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

	it('hides the scrollbars until the plugin setting shows them', () => {
		expect(DEFAULT_SETTINGS.hideScrollbars).toBe(true);
		expect(sanitizeSettings(undefined).hideScrollbars).toBe(true);
		expect(sanitizeSettings({ hideScrollbars: false }).hideScrollbars).toBe(false);
		expect(sanitizeSettings({ hideScrollbars: 'no' }).hideScrollbars).toBe(true);
	});

	it('shows the tooltips until the plugin setting hides them', () => {
		expect(DEFAULT_SETTINGS.hideTooltips).toBe(false);
		expect(sanitizeSettings(undefined).hideTooltips).toBe(false);
		expect(sanitizeSettings({ hideTooltips: true }).hideTooltips).toBe(true);
		expect(sanitizeSettings({ hideTooltips: 'no' }).hideTooltips).toBe(false);
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
		for (const defaultProjectLocale of ['system', ...PROJECT_LANGUAGES] as const) {
			expect(sanitizeSettings({ defaultProjectLocale }).defaultProjectLocale).toBe(
				defaultProjectLocale,
			);
		}
		expect(
			sanitizeSettings({ defaultProjectLocale: 'it' }).defaultProjectLocale,
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

describe('manuscript analysis settings', () => {
	const stored = (over: Partial<SnowflakeSettings>): SnowflakeSettings =>
		sanitizeSettings({ ...DEFAULT_SETTINGS, ...over });

	it('keeps a stored rule list and reads junk as none', () => {
		const rules: CustomHighlightRule[] = [
			{
				id: 'rule-a',
				name: 'Weather',
				kind: 'literal',
				patterns: ['fog', 'mist'],
				enabled: true,
				decoration: 'underline',
				color: '#aabbcc',
			},
		];
		expect(stored({ customHighlightRules: rules }).customHighlightRules).toEqual(
			rules,
		);
		expect(
			sanitizeSettings({ ...DEFAULT_SETTINGS, customHighlightRules: 'junk' })
				.customHighlightRules,
		).toEqual([]);
	});

	it('starts the later quote styles off where dialogue reading was turned off', () => {
		const later = (settings: SnowflakeSettings): boolean[] => [
			settings.dialogueQuotesLowHigh,
			settings.dialogueQuotesGuillemets,
			settings.dialogueQuotesInwardGuillemets,
		];
		const four = (on: boolean): Record<string, boolean> => ({
			dialogueQuotesCurly: on,
			dialogueQuotesStraight: on,
			dialogueQuotesCorner: on,
			dialogueQuotesWhite: on,
		});
		// A file from before the three, with all it knew switched off.
		expect(later(sanitizeSettings(four(false)))).toEqual([false, false, false]);
		// One style left on, or a file that never said, and they start on.
		expect(later(sanitizeSettings({ ...four(false), dialogueQuotesCorner: true }))).toEqual([true, true, true]);
		expect(later(sanitizeSettings({}))).toEqual([true, true, true]);
		// A choice made since is kept either way.
		expect(later(sanitizeSettings({ ...four(false), dialogueQuotesGuillemets: true }))).toEqual([false, true, false]);
		expect(later(stored({ dialogueQuotesLowHigh: false }))).toEqual([false, true, true]);
	});

	it('clamps the reading speeds and falls back only from junk', () => {
		expect(stored({ readingWordsPerMinute: 100000 }).readingWordsPerMinute).toBe(
			2000,
		);
		expect(stored({ readingWordsPerMinute: 3 }).readingWordsPerMinute).toBe(10);
		expect(
			stored({ readingCjkCharactersPerMinute: 512.6 })
				.readingCjkCharactersPerMinute,
		).toBe(513);
		expect(
			sanitizeSettings({ ...DEFAULT_SETTINGS, readingWordsPerMinute: 'fast' })
				.readingWordsPerMinute,
		).toBe(250);
	});

	it('holds the free-text lists to their storage bound', () => {
		const long = 'x'.repeat(30000);
		expect(stored({ sensitiveWords: long }).sensitiveWords).toHaveLength(20000);
		expect(stored({ customStopwords: 'the 的' }).customStopwords).toBe('the 的');
		expect(
			sanitizeSettings({ ...DEFAULT_SETTINGS, sensitiveWords: 42 })
				.sensitiveWords,
		).toBe('');
	});

	it('stores the textarea values the sweep cannot exercise', async () => {
		const { tab } = writableSettingTab();
		await tab.setControlValue('sensitiveWords', 'damn\n乌鸦');
		expect(tab.getControlValue('sensitiveWords')).toBe('damn\n乌鸦');
		await tab.setControlValue('customStopwords', 'the 的');
		expect(tab.getControlValue('customStopwords')).toBe('the 的');
	});
});

describe('highlight rule rows', () => {
	const withRules = (): SnowflakeSettingTab => {
		const plugin = {
			settings: {
				...DEFAULT_SETTINGS,
				customHighlightRules: [
					{
						id: 'a',
						name: 'Weather',
						kind: 'literal',
						patterns: ['fog', 'mist'],
						enabled: true,
						decoration: 'background',
						color: null,
					},
					{
						id: 'b',
						name: '',
						kind: 'regex',
						patterns: ['('],
						enabled: false,
						decoration: 'wavy',
						color: null,
					},
				] satisfies CustomHighlightRule[],
			},
			recordingSettings: () => null,
		} as unknown as SnowflakeMethodPlugin;
		return new SnowflakeSettingTab({} as never, plugin);
	};

	it('names each rule, a nameless one by its kind, and nothing more', () => {
		// The card carries the name alone: kind, pattern count, and whether
		// the rule runs all live elsewhere (the editor and the pause button).
		expect(withRules().customRuleNames()).toEqual([
			'Weather',
			'Regular expression',
		]);
	});

	it('offers no rule rows where no rules stand', () => {
		expect(settingTabFor('en').customRuleNames()).toEqual([]);
	});
});

describe('word milestone settings', () => {
	it('start off, per chapter, every five hundred units', () => {
		expect(DEFAULT_SETTINGS.manuscriptMilestones).toBe(false);
		expect(DEFAULT_SETTINGS.manuscriptMilestoneMode).toBe('chapter');
		expect(DEFAULT_SETTINGS.manuscriptMilestoneInterval).toBe(500);
	});

	it('keeps a whole interval of at least one and falls back from anything else', () => {
		const interval = (value: unknown): number =>
			sanitizeSettings({ manuscriptMilestoneInterval: value })
				.manuscriptMilestoneInterval;
		expect(interval(1)).toBe(1);
		expect(interval(250)).toBe(250);
		expect(interval(0)).toBe(500);
		expect(interval(-1)).toBe(500);
		expect(interval(2.5)).toBe(500);
		expect(interval('x')).toBe(500);
		expect(interval(10_000_000)).toBe(500);
	});

	it('knows the two modes and nothing else', () => {
		const mode = (value: unknown): string =>
			sanitizeSettings({ manuscriptMilestoneMode: value }).manuscriptMilestoneMode;
		expect(mode('chapter')).toBe('chapter');
		expect(mode('manuscript')).toBe('manuscript');
		expect(mode('note')).toBe('chapter');
		expect(
			sanitizeSettings({ manuscriptMilestones: 'yes' }).manuscriptMilestones,
		).toBe(false);
		expect(sanitizeSettings({ manuscriptMilestones: true }).manuscriptMilestones).toBe(
			true,
		);
	});
});

describe('automatic chapter number settings', () => {
	it('start off, with no custom rule yet', () => {
		expect(DEFAULT_SETTINGS.manuscriptChapterNumbering).toBe('off');
		expect(DEFAULT_SETTINGS.manuscriptChapterNumberRules).toEqual([]);
	});

	it('keeps a known style and falls back from anything else', () => {
		const style = (value: unknown): string =>
			sanitizeSettings({ manuscriptChapterNumbering: value })
				.manuscriptChapterNumbering;
		expect(style('chinese')).toBe('chinese');
		expect(style('chinese-arabic')).toBe('chinese-arabic');
		expect(style('english')).toBe('english');
		expect(style('custom')).toBe('custom');
		expect(style('roman')).toBe('off');
		expect(style(3)).toBe('off');
	});

	it('keeps the custom rules as stored, junk dropped and one running at most', () => {
		const kept = sanitizeSettings({
			manuscriptChapterNumberRules: [
				{ id: 'a', kind: 'format', text: '第{nnnn}章', enabled: true },
				{ id: 'b', kind: 'regex', text: '^第(\\d', seed: '第0001章', enabled: true },
				{ id: 'c', kind: 'words', text: 'Chapter {n}' },
			],
		});
		expect(kept.manuscriptChapterNumberRules).toEqual([
			{ id: 'a', kind: 'format', text: '第{nnnn}章', seed: '', enabled: true },
			// Kept as typed even though it does not compile yet; the dialog objects, the store does not.
			{ id: 'b', kind: 'regex', text: '^第(\\d', seed: '第0001章', enabled: false },
		]);
		expect(
			sanitizeSettings({ manuscriptChapterNumberRules: 'none' })
				.manuscriptChapterNumberRules,
		).toEqual([]);
	});
});

describe('export settings', () => {
	it('start with the folder beside the projects, plain text, indent kept, spacing dropped, one file', () => {
		expect(DEFAULT_SETTINGS.exportFolder).toBe('');
		expect(DEFAULT_SETTINGS.exportFormat).toBe('txt');
		expect(DEFAULT_SETTINGS.exportIndent).toBe(true);
		expect(DEFAULT_SETTINGS.exportParagraphSpacing).toBe(false);
		expect(DEFAULT_SETTINGS.exportManuscriptLayout).toBe('single');
		expect(DEFAULT_SETTINGS.exportChapterSeparator).toBe('blank');
	});

	it('keeps known choices and falls back from anything else', () => {
		const kept = sanitizeSettings({
			exportFolder: '/Out/',
			exportFormat: 'md',
			exportIndent: false,
			exportParagraphSpacing: false,
			exportManuscriptLayout: 'folder',
			exportChapterSeparator: 'asterisks',
		});
		expect(kept.exportFolder).toBe('Out');
		expect(kept.exportFormat).toBe('md');
		expect(kept.exportIndent).toBe(false);
		expect(kept.exportParagraphSpacing).toBe(false);
		expect(kept.exportManuscriptLayout).toBe('folder');
		expect(kept.exportChapterSeparator).toBe('asterisks');
		const fallen = sanitizeSettings({
			exportFolder: '/',
			exportFormat: 'docx',
			exportManuscriptLayout: 'zip',
			exportChapterSeparator: 'title',
			exportIndent: 'yes',
		});
		expect(fallen.exportFolder).toBe('');
		expect(fallen.exportFormat).toBe('txt');
		expect(fallen.exportManuscriptLayout).toBe('single');
		expect(fallen.exportChapterSeparator).toBe('blank');
		expect(fallen.exportIndent).toBe(true);
	});

	it('groups the export rows by the export they shape: every one, the whole manuscript, one note', () => {
		const names = settingNames(settingTabFor('en'));
		expect(names.slice(names.indexOf('Export'))).toEqual([
			'Export',
			'Export folder',
			'Export format',
			'Preserve first-line indentation',
			'Preserve extra paragraph spacing',
			'Whole manuscript',
			'Layout',
			'Between notes',
			'One note',
			'Location',
		]);
		// One note has nothing of its own to choose: the row says where it goes.
		const location = settingRows(settingTabFor('en')).find((row) => row.name === 'Location');
		expect(location).toEqual({ name: 'Location' });
	});

	it('leaves the explorer uncovered until the plugin setting turns immersive mode on', () => {
		expect(DEFAULT_SETTINGS.explorerImmersive).toBe(false);
		expect(sanitizeSettings(undefined).explorerImmersive).toBe(false);
		expect(sanitizeSettings({ explorerImmersive: true }).explorerImmersive).toBe(true);
	});
});

describe('the screen recording’s section of the settings', () => {
	type Row = {
		name: string;
		desc?: unknown;
		visible?: boolean | (() => boolean);
		render?: unknown;
		control?: {
			type: string;
			key: string;
			options?: Record<string, string>;
			disabled?: boolean | (() => boolean);
			validate?: (value: number) => unknown;
		};
	};

	/** What a row drawn by hand asked of its dropdown: its answers, the one that stands, and whether it is locked. */
	function drawnDropdown(row: Row) {
		const drawn: { options: Record<string, string>; value: string; disabled: boolean; choose: (value: string) => void } = {
			options: {},
			value: '',
			disabled: false,
			choose: () => {},
		};
		const dropdown = {
			addOption: (value: string, label: string) => {
				drawn.options[value] = label;
				return dropdown;
			},
			setValue: (value: string) => {
				drawn.value = value;
				return dropdown;
			},
			setDisabled: (disabled: boolean) => {
				drawn.disabled = disabled;
				return dropdown;
			},
			onChange: (choose: (value: string) => void) => {
				drawn.choose = choose;
				return dropdown;
			},
		};
		const setting = {
			addDropdown: (build: (made: typeof dropdown) => unknown) => {
				build(dropdown);
				return setting;
			},
		};
		(row.render as (given: typeof setting) => void)(setting);
		return drawn;
	}

	function recordingTab(system: RecordingSystem = 'mac', patch: Partial<RecordingPreferences> = {}) {
		const held: {
			preferences: RecordingPreferences;
			state: RecordingState;
			access: 'granted' | 'denied' | 'unknown';
			/** What Obsidian's field for a secret calls when another secret is chosen, once the row is drawn. */
			secretChanged: () => void;
		} = {
			// The choices most of these rows are tested with: a folder outside the vault, the screen
			// Obsidian is on, OBS's own size. What a device starts on has a test of its own.
			preferences: {
				...defaultRecordingPreferences(system),
				location: 'outside',
				scope: 'screen',
				quality: 'original',
				...patch,
			},
			state: { ...IDLE_RECORDING_STATE },
			access: 'granted',
			secretChanged: () => {},
		};
		const bridge: RecordingSettingsBridge = {
			system: () => system,
			state: () => held.state,
			preferences: () => held.preferences,
			update: (next) => {
				// As the plugin's own does: the choices a recorder runs on stand still while it runs.
				const asking = Object.keys(next).every((key) => key === 'confirm');
				if (held.state.phase !== 'idle' && !asking) return;
				held.preferences = sanitizeRecordingPreferences({ ...held.preferences, ...next }, system);
			},
			storage: () => ({ mode: 'default', path: '/Users/ada/Movies' }),
			defaultVaultFolder: () => 'Snowflake Projects/Snowflake Recordings',
			figures: () => Promise.resolve(null),
			chooseFolder: () => Promise.resolve(),
			openFolder: () => {},
			screenAccess: () => held.access,
			openScreenPrivacy: () => {},
			testObs: () => Promise.resolve({ ok: false, code: 'obs-closed' }),
			mountSecret: (_host, changed) => {
				held.secretChanged = changed;
			},
			openObsDownload: () => {},
		};
		const plugin = {
			settings: { ...DEFAULT_SETTINGS, uiLocale: 'en' },
			recordingSettings: () => bridge,
		} as unknown as SnowflakeMethodPlugin;
		const tab = new SnowflakeSettingTab({} as never, plugin);
		let updates = 0;
		(tab as unknown as { update: () => void }).update = () => {
			updates += 1;
		};
		/** The section's rows as they stand now, the ones a choice hides left out. */
		const rows = (): Row[] => {
			const groups = tab.getSettingDefinitions() as { heading?: string; items?: Row[] }[];
			const section = groups[groups.length - 1];
			return (section?.items ?? []).filter((row) =>
				typeof row.visible === 'function' ? row.visible() : row.visible !== false,
			);
		};
		const names = (): string[] => rows().map((row) => row.name).filter((name) => name.length > 0);
		const row = (name: string): Row => {
			const found = rows().find((entry) => entry.name === name);
			if (found === undefined) throw new Error(`No row is named ${name}.`);
			return found;
		};
		return { tab, held, rows, names, row, updates: () => updates };
	}

	it('stands last on the page, and not at all where nothing records', () => {
		const headings = (tab: SnowflakeSettingTab): (string | undefined)[] =>
			tab.getSettingDefinitions().map((group) => (group as { heading?: string }).heading);
		expect(headings(recordingTab().tab).slice(-2)).toEqual(['Export', 'Screen recording']);
		// A phone or a tablet has no bridge to read through.
		expect(headings(settingTabFor('en'))).not.toContain('Screen recording');
	});

	it('says the notes and their switch first, then asks for the recorder, where recordings go and what they show, then what only that recorder needs', () => {
		const { names, held } = recordingTab();
		expect(names()).toEqual([
			'Before you record',
			// The switch for the dialog that says the notes stands right under them.
			'Confirm before recording',
			'Recording tool',
			'Save recordings to',
			'Folder outside the vault',
			'What to record',
			'macOS native',
			'Video quality',
		]);
		held.preferences = { ...held.preferences, tool: 'obs' };
		expect(names()).toEqual([
			'Before you record',
			'Confirm before recording',
			'Recording tool',
			'Save recordings to',
			'Folder outside the vault',
			'What to record',
			'OBS Studio',
			'Set up OBS Studio',
			'Port',
			'Password',
			'Video quality',
			'Test connection',
		]);
	});

	it('shows the folder’s row for the place chosen, the vault’s or the one outside it', () => {
		const { names, tab, held, updates } = recordingTab();
		expect(names()).toContain('Folder outside the vault');
		expect(names()).not.toContain('Folder in the vault');
		void tab.setControlValue('recording.location', 'vault');
		expect(held.preferences.location).toBe('vault');
		expect(names()).toContain('Folder in the vault');
		expect(names()).not.toContain('Folder outside the vault');
		// The rows under a choice follow it at once.
		expect(updates()).toBe(1);
		void tab.setControlValue('recording.location', 'elsewhere');
		expect([held.preferences.location, updates()]).toEqual(['vault', 1]);
	});

	it('offers the Mac’s recorder on a Mac alone, and no choice of recorder where there is one', () => {
		const mac = recordingTab('mac');
		expect(mac.row('Recording tool').control?.options).toEqual({
			native: 'macOS native',
			obs: 'OBS Studio',
		});
		const windows = recordingTab('win');
		expect(windows.names()).not.toContain('Recording tool');
		expect(windows.names()).toContain('OBS Studio');
		expect(windows.names()).not.toContain('macOS native');
	});

	it('starts a device on recordings in the vault, of Obsidian alone, at 1080 lines', () => {
		const { tab, names, row } = recordingTab('mac', { ...defaultRecordingPreferences('mac'), tool: 'obs' });
		expect(tab.getControlValue('recording.location')).toBe('vault');
		expect(names()).toContain('Folder in the vault');
		expect(names()).not.toContain('Folder outside the vault');
		expect(drawnDropdown(row('What to record')).value).toBe('obsidian');
		expect(row('What to record').desc).toBe('The video shows the Obsidian window you are working in.');
		expect(tab.getControlValue('recording.quality')).toBe('1080p');
		// What each declared row goes back to is the same.
		expect(row('Save recordings to').control).toMatchObject({ defaultValue: 'vault' });
		expect(row('Video quality').control).toMatchObject({ defaultValue: '1080p' });
	});

	it('offers what the recorder can show, and falls back to what a device starts on with the recorder that had the choice', () => {
		const { tab, held, row } = recordingTab('mac', { tool: 'obs', scope: 'obs' });
		const withObs = drawnDropdown(row('What to record'));
		expect(withObs.options).toEqual({
			screen: 'Current screen',
			all: 'All screens',
			obsidian: 'Obsidian only',
			obs: 'As set in OBS Studio',
		});
		expect(withObs.value).toBe('obs');
		expect(tab.getControlValue('recording.scope')).toBe('obs');
		void tab.setControlValue('recording.tool', 'native');
		// A scope only OBS has goes back with it to the one a device starts on: Obsidian alone.
		expect([held.preferences.tool, held.preferences.scope]).toEqual(['native', 'obsidian']);
		const withMac = drawnDropdown(row('What to record'));
		expect(withMac.options).toEqual({
			screen: 'Current screen',
			all: 'All screens',
			obsidian: 'Obsidian only',
		});
		expect(withMac.value).toBe('obsidian');
		void tab.setControlValue('recording.scope', 'obs');
		expect(held.preferences.scope).toBe('obsidian');
	});

	it('draws what to record by hand, so the line under it follows the choice made in it', () => {
		// The page never draws a declared control again while it holds the
		// keyboard, and this row's line speaks of its own choice.
		const { held, row, updates } = recordingTab();
		const scope = row('What to record');
		expect(scope.control).toBeUndefined();
		expect(scope.desc).toBe('Records the screen Obsidian is on.');
		drawnDropdown(scope).choose('all');
		expect(held.preferences.scope).toBe('all');
		// The page is asked to draw again, and the row's new words are ready for it.
		expect(updates()).toBe(1);
		expect(row('What to record').desc).toBe('Each screen is saved as a file of its own.');
		// An answer the recorder has not is not kept.
		drawnDropdown(row('What to record')).choose('obs');
		expect([held.preferences.scope, updates()]).toEqual(['all', 1]);
	});

	it('says under the choice what it comes to with the recorder chosen', () => {
		const { tab, row } = recordingTab();
		expect(row('What to record').desc).toBe('Records the screen Obsidian is on.');
		void tab.setControlValue('recording.scope', 'all');
		expect(row('What to record').desc).toBe('Each screen is saved as a file of its own.');
		void tab.setControlValue('recording.scope', 'obsidian');
		expect(row('What to record').desc).toBe('Each Obsidian window is saved as a file of its own.');
		void tab.setControlValue('recording.tool', 'obs');
		expect(row('What to record').desc).toBe('The video shows the Obsidian window you are working in.');
		// A choice only OBS has is spoken of too, never the screen's line in its place.
		void tab.setControlValue('recording.scope', 'obs');
		expect(row('What to record').desc).toBe('Records what OBS Studio’s current scene shows.');
	});

	it('says what macOS has not allowed only with the Mac’s recorder, and only until it is', () => {
		const { names, held } = recordingTab();
		expect(names()).not.toContain('Open system settings');
		held.access = 'denied';
		expect(names()).toContain('Open system settings');
		held.preferences = { ...held.preferences, tool: 'obs' };
		// With OBS it is OBS that macOS must allow, and OBS asks for itself.
		expect(names()).not.toContain('Open system settings');
	});

	it('reads and keeps each choice through the plugin, never in the vault’s own settings', () => {
		const { tab, held } = recordingTab('mac', { tool: 'obs' });
		expect(tab.getControlValue('recording.tool')).toBe('obs');
		expect(tab.getControlValue('recording.location')).toBe('outside');
		expect(tab.getControlValue('recording.quality')).toBe('original');
		expect(tab.getControlValue('recording.obsPort')).toBe(4455);
		expect(tab.getControlValue('recording.nothing')).toBeUndefined();
		void tab.setControlValue('recording.quality', '720p');
		void tab.setControlValue('recording.obsPort', 4460);
		expect([held.preferences.quality, held.preferences.obsPort]).toEqual(['720p', 4460]);
		// Nothing out of range is kept.
		for (const port of [0, 70000, 4455.5, '4460']) void tab.setControlValue('recording.obsPort', port);
		void tab.setControlValue('recording.quality', '4k');
		expect([held.preferences.quality, held.preferences.obsPort]).toEqual(['720p', 4460]);
		// None of it is one of the settings that travel with the vault.
		expect(Object.keys(DEFAULT_SETTINGS).some((key) => key.toLowerCase().includes('record'))).toBe(false);
	});

	it('forgets the look at OBS when its port or its password changes, and draws the page again only where an answer showed', () => {
		const { tab, held, row, updates } = recordingTab('mac', { tool: 'obs' });
		const memory = (tab as unknown as { recordingMemory: RecordingSettingsMemory }).recordingMemory;
		const answer: ObsProbe = { ok: true, version: '33.0.1', picture: null, problem: null };
		// No answer showing: a port typed figure by figure draws nothing again.
		void tab.setControlValue('recording.obsPort', 4460);
		void tab.setControlValue('recording.obsPort', 4461);
		expect([memory.probe, memory.stamp, updates()]).toEqual([null, 2, 0]);
		// An answer showing is for the old port: it goes, and the page is drawn once to say so.
		memory.probe = answer;
		void tab.setControlValue('recording.obsPort', 4462);
		void tab.setControlValue('recording.obsPort', 4463);
		expect([memory.probe, held.preferences.obsPort, updates()]).toEqual([null, 4463, 1]);
		// Another secret chosen for the password does the same: the answer was for the old one.
		const password = { settingEl: { addClass: () => {} }, controlEl: {} };
		(row('Password').render as (given: typeof password) => void)(password);
		memory.probe = answer;
		const stamp = memory.stamp;
		held.secretChanged();
		expect([memory.probe, memory.stamp, updates()]).toEqual([null, stamp + 1, 2]);
		// How sharp the picture is has no part in the look, and leaves its answer standing.
		memory.probe = answer;
		void tab.setControlValue('recording.quality', '720p');
		expect([memory.probe, updates()]).toEqual([answer, 2]);
	});

	it('counts what the recordings’ folder holds afresh each time the page is opened', () => {
		const { tab } = recordingTab('mac', { location: 'vault' });
		const memory = (tab as unknown as { recordingMemory: RecordingSettingsMemory }).recordingMemory;
		memory.figures = { key: 'Proof\n0', counted: Promise.resolve({ files: 2, bytes: 5 }) };
		// The page is left: the count is let go with it.
		const page = tab as unknown as { containerEl: unknown; hide: () => void };
		page.containerEl = { win: { clearTimeout: () => {} }, removeClass: () => {} };
		page.hide();
		expect(memory.figures).toBeNull();
	});

	it('names a port out of range in the row itself', () => {
		const { row } = recordingTab('mac', { tool: 'obs' });
		const validate = row('Port').control?.validate;
		expect(validate?.(4455)).toBeUndefined();
		for (const port of [0, 65536, 4455.5]) expect(validate?.(port), String(port)).toBe('Enter a port between 1 and 65535.');
	});

	it('holds every choice still while a recording runs', () => {
		const { tab, held, rows } = recordingTab('mac', { tool: 'obs' });
		// Every choice the recorder is started with. Whether to be asked first is no such choice.
		const locked = (): boolean[] =>
			rows()
				.filter((row) => row.control !== undefined && row.name !== 'Confirm before recording')
				.map((row) => (typeof row.control?.disabled === 'function' ? row.control.disabled() : row.control?.disabled === true));
		const scope = (): boolean => drawnDropdown(rows().find((row) => row.name === 'What to record') as Row).disabled;
		expect([...locked(), scope()]).toEqual([false, false, false, false, false]);
		held.state = { ...held.state, phase: 'recording' };
		expect([...locked(), scope()]).toEqual([true, true, true, true, true]);
		// And a change that reaches the page all the same is not kept.
		void tab.setControlValue('recording.tool', 'native');
		void tab.setControlValue('recording.location', 'vault');
		expect([held.preferences.tool, held.preferences.location]).toEqual(['obs', 'outside']);
	});

	it('offers OBS’s own size first, then the full size and the three it can be held to', () => {
		const { row, tab, held } = recordingTab('mac', { tool: 'obs' });
		expect(row('Video quality').control?.options).toEqual({
			original: 'As set in OBS Studio',
			full: 'Native',
			'1440p': '2K',
			'1080p': '1080p',
			'720p': '720p',
		});
		expect(Object.keys(row('Video quality').control?.options ?? {})).toEqual(['original', 'full', '1440p', '1080p', '720p']);
		for (const quality of ['full', '1440p'] as const) {
			void tab.setControlValue('recording.quality', quality);
			expect(held.preferences.quality).toBe(quality);
		}
	});

	it('has a switch for the dialog before a recording, which the dialog’s own box turns off', () => {
		const { row, tab, held } = recordingTab();
		const asked = row('Confirm before recording');
		expect(asked.control).toMatchObject({ type: 'toggle', key: 'recording.confirm' });
		expect(asked.desc).toBe('Show these notes before each recording starts.');
		expect(tab.getControlValue('recording.confirm')).toBe(true);
		// The box in the dialog, ticked: the choices no longer ask, and the switch shows it.
		held.preferences = { ...held.preferences, confirm: false };
		expect(tab.getControlValue('recording.confirm')).toBe(false);
		// Turned on again here, and only by a plain yes or no.
		void tab.setControlValue('recording.confirm', true);
		expect(held.preferences.confirm).toBe(true);
		void tab.setControlValue('recording.confirm', 'no');
		expect(held.preferences.confirm).toBe(true);
		// It is no choice the recorder runs on: it may change while one records.
		held.state = { ...held.state, phase: 'recording' };
		void tab.setControlValue('recording.confirm', false);
		expect(held.preferences.confirm).toBe(false);
		expect(asked.control?.disabled).toBeUndefined();
	});

	it('finds the notes when the page is searched, though the row draws them itself', () => {
		const { row } = recordingTab();
		const notes = row('Before you record');
		expect(typeof notes.render).toBe('function');
		expect(String(notes.desc)).toContain('claims AI wrote your novel');
		expect(String(notes.desc)).toContain('Watch it yourself before you share it.');
	});
});
