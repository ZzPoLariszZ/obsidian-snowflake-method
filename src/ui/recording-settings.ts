import { setIcon, type Setting } from 'obsidian';

import type { RecordingScope, RecordingSystem, RecordingTool } from '../domain';
import type { ObsProbe, RecordingStorage } from '../services';
import type { Translate } from './modals';
import type { RecordingSettingsBridge } from './recording-bridge';
import { recordingNotice, renderRecordingNoteLines, type RecordingNoticeTone } from './recording-notes';
import {
	OBS_GUIDE_STEPS,
	guideRuns,
	recordingErrorText,
	recordingSize,
} from './recording-rows';

/**
 * The rows of the settings page's Screen recording section that are drawn
 * by hand: what an author is told before recording, what macOS allows, the
 * folder outside the vault, and OBS's guide, password and test. The plain
 * choices beside them (the recorder, where recordings go, what is shown,
 * how sharp) are declared like every other row of the page.
 *
 * Each row is drawn whole whenever the page is: nothing here keeps a state
 * of its own. What must outlast a redraw, the test's answer and whether the
 * guide stands open, is kept by the page and handed in.
 */

type Tone = RecordingNoticeTone;

/** What the page keeps of the section's rows from one drawing to the next. */
export interface RecordingSettingsMemory {
	/** A look at OBS is under way. */
	testing: boolean;
	/** OBS was closed, and is being opened for the look. */
	opening: boolean;
	/** What the last look found, until a choice it depended on changes. */
	probe: ObsProbe | null;
	/** Goes up whenever a choice a look depends on changes, so a look begun before the change is known for an old one. */
	stamp: number;
	/** The setup guide stands open. */
	guideOpen: boolean;
	/** What the vault's folder was last counted to hold, and what it was counted for. Counted once, not at every drawing. */
	figures: { key: string; counted: Promise<{ files: number; bytes: number } | null> } | null;
}

export const freshRecordingSettingsMemory = (): RecordingSettingsMemory => ({
	testing: false,
	opening: false,
	probe: null,
	stamp: 0,
	guideOpen: false,
	figures: null,
});

/**
 * A choice the look at OBS depends on has changed: the port, the password,
 * the recorder, what is recorded. The answer that stood was for the old
 * choice and says nothing of the new one, and neither will a look still
 * under way. True where an answer was showing, which the page then draws
 * away.
 */
export function forgetObsProbe(memory: RecordingSettingsMemory): boolean {
	memory.stamp += 1;
	if (memory.probe === null) return false;
	memory.probe = null;
	return true;
}

/**
 * What the choice of what to record comes to with the recorder chosen, one
 * line for each choice so the row always speaks of the one that stands.
 * Every screen at once is a file for each screen, or one small picture of
 * all. Obsidian alone is a file for each of its windows, or a video that
 * follows the author from window to window. OBS is said to follow only
 * where it has been seen to: on a Mac.
 */
export function recordingScopeHint(
	t: Translate,
	scope: RecordingScope,
	tool: RecordingTool,
	system: RecordingSystem,
): string {
	if (scope === 'screen') return t('recording.scope.screenHint');
	if (scope === 'all') return t(tool === 'native' ? 'recording.scope.allNative' : 'recording.scope.allObs');
	if (scope === 'obs') return t('recording.scope.obsHint');
	if (tool === 'native') return t('recording.scope.obsidianNative');
	return t(system === 'mac' ? 'recording.scope.obsidianObs' : 'recording.scope.obsidianHint');
}

/**
 * What to record, drawn by hand though it is a plain dropdown. The page
 * never draws a declared control again while that control holds the
 * keyboard, so a declared row's description stood as it was while its own
 * dropdown changed under it. A row drawn here is drawn again whole, the
 * keyboard put back in it, and what it says follows what was chosen.
 */
export function renderRecordingScope(
	setting: Setting,
	scopes: readonly { value: string; label: string }[],
	standing: string,
	locked: boolean,
	choose: (value: string) => void,
): void {
	setting.addDropdown((dropdown) => {
		for (const scope of scopes) dropdown.addOption(scope.value, scope.label);
		dropdown.setValue(standing).setDisabled(locked).onChange(choose);
	});
}

/** Takes a row down to its bare ground, for one that is not a name beside a control. */
function bare(setting: Setting, cls: string): HTMLElement {
	const row = setting.settingEl;
	row.empty();
	row.addClass('snowflake-method-settings-recording-bare', cls);
	return row;
}

/**
 * What an author is told before recording: what a recording is for, then
 * what it shows and what it costs. The same words stand in the dialog
 * before the first start on a device.
 */
export function renderRecordingNotes(setting: Setting, t: Translate): void {
	const row = bare(setting, 'snowflake-method-settings-recording-notes');
	// The notes' own heading, dressed as a row's name is.
	row.createDiv({ cls: 'setting-item-name', text: t('recording.notes.title') });
	renderRecordingNoteLines(row, t);
	row.createEl('p', { cls: 'snowflake-method-hint', text: t('recording.settings.local') });
}

/**
 * Whether the row on what macOS allows has anything to say: with the Mac's
 * own recorder, where macOS has not said yes. The page asks this to show
 * the row, and the row asks it before it listens for anything, so the two
 * never differ.
 */
export function recordingPermissionShown(bridge: RecordingSettingsBridge): boolean {
	return bridge.preferences().tool === 'native' && bridge.screenAccess() !== 'granted';
}

/**
 * What macOS allows, said only where it has not said yes: with the Mac's
 * own recorder, Obsidian itself must be let record the screen. The author
 * comes back from the system's settings to this window, so what macOS
 * allows is read again whenever the window comes forward.
 */
export function renderRecordingPermission(
	setting: Setting,
	bridge: RecordingSettingsBridge,
	t: Translate,
	refresh: () => void,
): () => void {
	const row = bare(setting, 'snowflake-method-settings-recording-permission');
	// The page draws a row it then keeps out of sight: one with nothing to say
	// listens for nothing, or every coming forward of the window would draw the
	// whole page again for a row nobody sees.
	if (!recordingPermissionShown(bridge)) return () => {};
	const denied = bridge.screenAccess() === 'denied';
	const line = recordingNotice(
		row,
		denied ? 'warning' : 'muted',
		t(denied ? 'recording.permission.denied' : 'recording.permission.unknown'),
	);
	const open = line.createEl('button', {
		cls: 'snowflake-method-history-notice-button',
		text: t('recording.permission.open'),
		attr: { type: 'button' },
	});
	open.addEventListener('click', () => {
		bridge.openScreenPrivacy();
	});
	const win = row.win;
	win.addEventListener('focus', refresh);
	return () => {
		win.removeEventListener('focus', refresh);
	};
}

/** What the row of a folder says under its name: the folder, then what keeping recordings there comes to. */
function describe(setting: Setting, lines: readonly { text: string; tone?: Tone; path?: boolean }[]): void {
	setting.descEl.empty();
	for (const line of lines) {
		const el = setting.descEl.createDiv({
			cls: line.path === true ? 'snowflake-method-settings-recording-path' : '',
			text: line.text,
		});
		if (line.tone === 'warning') el.addClass('snowflake-method-settings-recording-warning');
	}
}

/** Whether a folder can be opened: there is one, and it is not one recordings are refused. */
const canOpen = (place: RecordingStorage): boolean =>
	place.mode !== 'none' && !(place.mode === 'vault' && place.refused);

/**
 * The folder outside the vault: where it is, and the system's own dialog
 * to choose another. Nothing is typed here: a path written by hand is a
 * path that may not be there, and the recorder would find out last.
 */
export function renderRecordingOutsideFolder(
	setting: Setting,
	bridge: RecordingSettingsBridge,
	t: Translate,
	refresh: () => void,
): void {
	const place = bridge.storage();
	const idle = bridge.state().phase === 'idle';
	if (place.mode === 'none') describe(setting, [{ text: t('recording.storage.none'), tone: 'warning' }]);
	else if (place.mode === 'default') {
		describe(setting, [{ text: t('recording.storage.default', { path: place.path }) }]);
	} else if (place.mode === 'outside') {
		describe(setting, [{ text: place.path, path: true }]);
	} else {
		// Chosen as a folder outside, and in the vault after all: it is handled as the vault's.
		describe(setting, [
			{ text: place.path, path: true },
			place.refused
				? { text: t('recording.storage.project'), tone: 'warning' }
				: { text: t('recording.storage.vault'), tone: 'warning' },
		]);
	}
	setting.addButton((button) =>
		button
			.setButtonText(t('recording.folder.choose'))
			.setDisabled(!idle)
			.onClick(() => {
				void bridge.chooseFolder().then(refresh, () => {});
			}),
	);
	setting.addButton((button) =>
		button
			.setButtonText(t('recording.folder.open'))
			.setDisabled(!canOpen(place))
			.onClick(() => {
				bridge.openFolder();
			}),
	);
}

/**
 * What the vault folder's row says under its name. The vault can be asked
 * what the folder holds, so the row says that once it is counted. There is
 * no way into the folder here: a folder of the vault is a click away in the
 * file explorer. Returns the release: a count that comes back to a row no
 * longer there writes nothing.
 *
 * The page draws this row again at every change of any row, so the count
 * is kept: it is made anew only for another folder, after a recording has
 * ended, and when the page is opened again.
 */
export function describeRecordingVaultFolder(
	setting: Setting,
	bridge: RecordingSettingsBridge,
	t: Translate,
	locale: string,
	memory: RecordingSettingsMemory,
): () => void {
	const place = bridge.storage();
	const refused = place.mode === 'vault' && place.refused;
	// What sync does with a folder in the vault is said by the row above, where the vault is chosen.
	const said: { text: string; tone?: Tone }[] = t('recording.vaultFolder.desc')
		.split('\n')
		.map((text) => ({ text }));
	if (refused) said.push({ text: t('recording.storage.project'), tone: 'warning' });
	describe(setting, said);
	let live = true;
	if (!refused) {
		const key = `${place.mode === 'vault' ? place.vaultPath : ''}\n${String(bridge.state().last?.endedAt ?? 0)}`;
		if (memory.figures?.key !== key) memory.figures = { key, counted: bridge.figures() };
		void memory.figures.counted.then(
			(counted) => {
				if (!live || counted === null || counted.files === 0) return;
				describe(setting, [
					...said,
					{
						text: t(counted.files === 1 ? 'recording.storage.figuresOne' : 'recording.storage.figures', {
							count: counted.files,
							size: recordingSize(counted.bytes, locale),
						}),
					},
				]);
			},
			() => {},
		);
	}
	return () => {
		live = false;
	};
}

/**
 * The guide to setting OBS up, folded: OBS's WebSocket server is off until
 * the author turns it on, and nothing can turn it on for them. OBS's own
 * names stand out in each line, so the eye finds the same words in OBS.
 */
export function renderObsGuide(
	setting: Setting,
	bridge: RecordingSettingsBridge,
	t: Translate,
	memory: RecordingSettingsMemory,
): void {
	const row = bare(setting, 'snowflake-method-settings-recording-guide');
	const guide = row.createEl('details', { cls: 'snowflake-method-writing-hints' });
	guide.open = memory.guideOpen;
	guide.addEventListener('toggle', () => {
		memory.guideOpen = guide.open;
	});
	const summary = guide.createEl('summary');
	setIcon(summary.createSpan({ cls: 'snowflake-method-writing-hints-icon' }), 'lightbulb');
	summary.createSpan({ text: t('recording.guide.title') });
	const list = guide.createEl('ol');
	for (const step of OBS_GUIDE_STEPS) {
		const line = list.createEl('li');
		for (const run of guideRuns(t, step)) {
			if (run.link) {
				// The recorder's name is the way to its own page: a dashed line under it and the sign of a link.
				const link = line.createSpan({
					cls: 'snowflake-method-recording-link',
					attr: { role: 'link', tabindex: '0' },
				});
				link.createSpan({ cls: 'snowflake-method-hint-link-label', text: run.text });
				setIcon(
					link.createSpan({ cls: 'snowflake-method-hint-link-icon', attr: { 'aria-hidden': 'true' } }),
					'external-link',
				);
				link.addEventListener('click', () => {
					bridge.openObsDownload();
				});
				link.addEventListener('keydown', (event) => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					bridge.openObsDownload();
				});
			} else if (run.term) line.createEl('strong', { cls: 'snowflake-method-hint-keyword', text: run.text });
			else {
				// A step breaks where its words break, so a long one reads as whole clauses and never as a wrapped line.
				for (const [at, part] of run.text.split('\n').entries()) {
					if (at > 0) line.createEl('br');
					if (part.length > 0) line.createSpan({ text: part });
				}
			}
		}
	}
}

/**
 * OBS's password, in Obsidian's own field for a secret: the choices keep
 * the secret's name and never the password. Of the field's parts the row
 * shows the button alone, which reads as the way to choose a secret, then
 * as the way to change it. `changed` is told when another secret is
 * chosen: a look at OBS made with the old one no longer stands.
 */
export function renderObsPassword(setting: Setting, bridge: RecordingSettingsBridge, changed: () => void): void {
	setting.settingEl.addClass('snowflake-method-settings-recording-secret');
	bridge.mountSecret(setting.controlEl, changed);
}

/**
 * A look at OBS with no recording made: whether it answers, which version
 * it is, and a small picture of what it would record. A closed OBS is
 * opened for the look, as it is for a recording, and the row says so while
 * it waits. The answer stands under the row's name until a choice it
 * depended on changes.
 */
export function renderObsTest(
	setting: Setting,
	bridge: RecordingSettingsBridge,
	t: Translate,
	memory: RecordingSettingsMemory,
	refresh: () => void,
): void {
	setting.settingEl.addClass('snowflake-method-settings-recording-test');
	const probe = memory.probe;
	// An OBS that was closed takes some seconds to come up: the row says that is what it waits for.
	if (memory.testing) {
		describe(setting, [{ text: t(memory.opening ? 'recording.phase.opening' : 'recording.obs.testing') }]);
	}
	else if (probe === null) describe(setting, [{ text: t('recording.obs.testHint') }]);
	else if (!probe.ok) {
		describe(setting, [{ text: recordingErrorText(t, { code: probe.code, detail: null }), tone: 'warning' }]);
	} else if (probe.problem !== null) {
		describe(setting, [{ text: recordingErrorText(t, { code: probe.problem, detail: null }), tone: 'warning' }]);
	} else describe(setting, [{ text: t('recording.obs.connected', { version: probe.version }) }]);
	const picture = !memory.testing && probe !== null && probe.ok ? probe.picture : null;
	if (picture !== null) {
		setting.descEl.createEl('img', {
			cls: 'snowflake-method-recording-preview',
			attr: { src: picture, alt: t('recording.obs.preview') },
		});
	}
	setting.addButton((button) =>
		button
			.setButtonText(t('recording.obs.test'))
			.setDisabled(memory.testing || bridge.state().phase !== 'idle')
			.onClick(() => {
				if (memory.testing) return;
				memory.testing = true;
				memory.opening = false;
				refresh();
				const opening = (): void => {
					memory.opening = true;
					refresh();
				};
				const stamp = memory.stamp;
				void bridge.testObs(opening).then(
					(found) => {
						memory.testing = false;
						memory.opening = false;
						// A choice changed while OBS was looked at: the answer is for the old one, and is not shown.
						memory.probe = memory.stamp === stamp ? found : null;
						refresh();
					},
					() => {
						memory.testing = false;
						memory.opening = false;
						refresh();
					},
				);
			}),
	);
}
