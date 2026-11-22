import { Notice, type Setting } from 'obsidian';

import type { ServerStatus } from '../../api/index';
import type { LocalApiSettingsBridge } from './local-api-bridge';
import type { Translate } from './modals';
import { recordingNotice } from './recording-notes';
import { bare } from './recording-settings';

/**
 * The rows of the settings page's Local API section that are drawn by hand:
 * what an author is told of it, where the listener stands, and the access
 * token. The plain choices beside them (the listener, its port, how far a
 * caller may go, the command line) are declared like every other row of
 * the page.
 *
 * Each row is drawn whole whenever the page is, from what the plugin says
 * at that moment: nothing here keeps a state of its own.
 */

/** What an author is told of the API: what it is for, in the accent, then the one warning of what it lets out. */
export const LOCAL_API_NOTES = [
	{ key: 'localApi.note.purpose', tone: 'accent' },
	{ key: 'localApi.note.caution', tone: 'warning' },
] as const;

/**
 * The notes at the head of the section, drawn as the recording's are: a
 * heading, a notice for each note, and a word on where the choices are kept.
 */
export function renderLocalApiNotes(setting: Setting, t: Translate): void {
	const row = bare(setting, 'snowflake-method-settings-local-api-notes');
	// The notes' own heading, dressed as a row's name is.
	row.createDiv({ cls: 'setting-item-name', text: t('localApi.notes.title') });
	for (const note of LOCAL_API_NOTES) recordingNotice(row, note.tone, t(note.key));
	row.createEl('p', { cls: 'snowflake-method-hint', text: t('localApi.notes.local') });
}

/** What the status row says of where the listener stands. */
export function localApiStatusText(t: Translate, status: ServerStatus): string {
	if (status.state === 'off') return t('localApi.status.off');
	if (status.state === 'listening') return t('localApi.status.listening', { port: status.port });
	return t(`localApi.status.${status.reason}`, { port: status.port });
}

/** Lays lines under a row's name, one to a line. */
function describe(setting: Setting, lines: readonly string[]): void {
	setting.descEl.empty();
	for (const line of lines) {
		for (const part of line.split('\n')) setting.descEl.createDiv({ text: part });
	}
}

/**
 * The access token: what it is for, and the two things an author does with
 * it. It is copied and never shown. A token read off the screen is a token
 * anyone looking at the screen has, and one that is only ever copied goes
 * exactly where the author puts it.
 */
export function renderLocalApiToken(
	setting: Setting,
	bridge: LocalApiSettingsBridge,
	t: Translate,
	refresh: () => void,
): void {
	const token = bridge.token();
	describe(setting, token === null ? [t('localApi.token.desc'), t('localApi.token.none')] : [t('localApi.token.desc')]);
	setting.addButton((button) =>
		button
			.setButtonText(t('localApi.token.copy'))
			.setDisabled(token === null)
			.onClick(() => {
				const held = bridge.token();
				if (held === null) return;
				// The window the page stands in, which since 1.13 is not the main one.
				void setting.settingEl.win.navigator.clipboard.writeText(held).then(
					() => {
						new Notice(t('localApi.token.copied'));
					},
					() => {},
				);
			}),
	);
	setting.addButton((button) =>
		button.setButtonText(t('localApi.token.renew')).onClick(() => {
			void bridge.renewToken().then((outcome) => {
				if (outcome === 'declined') return;
				new Notice(t(outcome === 'renewed' ? 'localApi.token.renewed' : 'localApi.token.failed'));
				refresh();
			});
		}),
	);
}

/**
 * Where the listener stands: off, answering and on which port, or why it
 * could not be started, with a way to try again once the cause is seen to.
 * The line wears the colour of its standing: the theme's own success while
 * the listener answers, its error where it could not be started, and the
 * quiet of any description while it is off. How far a caller may go is said
 * over it, so the two things that decide what a caller can do are read in
 * one place, and the coloured line ends the row.
 */
export function renderLocalApiStatus(
	setting: Setting,
	bridge: LocalApiSettingsBridge,
	t: Translate,
	refresh: () => void,
): void {
	const status = bridge.status();
	setting.descEl.empty();
	setting.descEl.createDiv({
		text: t('localApi.status.access', { level: t(`localApi.access.${bridge.preferences().access}`) }),
	});
	const standing = setting.descEl.createDiv({ text: localApiStatusText(t, status) });
	if (status.state === 'listening') standing.addClass('snowflake-method-settings-local-api-listening');
	else if (status.state === 'failed') standing.addClass('snowflake-method-settings-local-api-failed');
	if (status.state !== 'failed') return;
	setting.addButton((button) =>
		button.setButtonText(t('common.retry')).onClick(() => {
			void bridge.retry().then(refresh);
		}),
	);
}
