// @vitest-environment happy-dom

import type { Setting } from 'obsidian';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
	IDLE_RECORDING_STATE,
	defaultRecordingPreferences,
	type RecordingPreferences,
	type RecordingState,
	type RecordingSystem,
} from '../../src/domain';
import { t as translate } from '../../src/i18n';
import type { ObsProbe, RecordingStorage } from '../../src/services';
import type { RecordingSettingsBridge } from '../../src/ui/recording-bridge';
import {
	describeRecordingVaultFolder,
	forgetObsProbe,
	freshRecordingSettingsMemory,
	recordingScopeHint,
	renderObsGuide,
	renderObsPassword,
	renderObsTest,
	renderRecordingNotes,
	renderRecordingOutsideFolder,
	renderRecordingPermission,
} from '../../src/ui/recording-settings';
import { installObsidianDom } from '../helpers/obsidian-dom';

const t = (key: string, vars?: Record<string, string | number>): string => translate('en', key, vars);

/** A settings row with real elements: a name and a description on one side, its controls on the other. */
class Row {
	readonly settingEl = document.body.createDiv({ cls: 'setting-item' });
	readonly infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
	readonly nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
	readonly descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
	readonly controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
	readonly buttons: HTMLButtonElement[] = [];

	addButton(build: (button: unknown) => unknown): this {
		const el = this.controlEl.createEl('button');
		this.buttons.push(el);
		const button = {
			setButtonText: (text: string) => {
				el.textContent = text;
				return button;
			},
			setDisabled: (disabled: boolean) => {
				el.disabled = disabled;
				return button;
			},
			onClick: (handler: () => void) => {
				el.addEventListener('click', handler);
				return button;
			},
		};
		build(button);
		return this;
	}

	get setting(): Setting {
		return this as unknown as Setting;
	}

	/** The lines under the row's name, each with whether it warns. */
	said(): [string, boolean][] {
		return [...this.descEl.children]
			.filter((line) => line.tagName === 'DIV')
			.map((line) => [line.textContent, line.classList.contains('snowflake-method-settings-recording-warning')]);
	}

	button(words: string): HTMLButtonElement {
		const found = this.buttons.find((button) => button.textContent === words);
		if (found === undefined) throw new Error(`No button says ${words}.`);
		return found;
	}
}

function rig(system: RecordingSystem = 'mac') {
	const held: {
		state: RecordingState;
		preferences: RecordingPreferences;
		storage: RecordingStorage;
		figures: { files: number; bytes: number } | null;
		access: 'granted' | 'denied' | 'unknown';
		probe: ObsProbe;
		/** What Obsidian's field for a secret calls when another secret is chosen. */
		secretChanged: () => void;
	} = {
		state: { ...IDLE_RECORDING_STATE },
		preferences: defaultRecordingPreferences(system),
		storage: { mode: 'default', path: '/Users/ada/Movies' },
		figures: null,
		access: 'granted',
		probe: { ok: true, version: '33.0.1', picture: 'data:image/jpeg;base64,AAAA', problem: null },
		secretChanged: () => {},
	};
	const calls: string[] = [];
	const refreshed = { count: 0 };
	const bridge: RecordingSettingsBridge = {
		system: () => system,
		state: () => held.state,
		preferences: () => held.preferences,
		update: (patch) => {
			held.preferences = { ...held.preferences, ...patch };
		},
		storage: () => held.storage,
		defaultVaultFolder: () => 'Novels/Snowflake Recordings',
		figures: () => {
			calls.push('figures');
			return Promise.resolve(held.figures);
		},
		chooseFolder: () => {
			calls.push('chooseFolder');
			return Promise.resolve();
		},
		openFolder: () => {
			calls.push('openFolder');
		},
		screenAccess: () => held.access,
		openScreenPrivacy: () => {
			calls.push('openScreenPrivacy');
		},
		testObs: () => {
			calls.push('testObs');
			return Promise.resolve(held.probe);
		},
		mountSecret: (host, changed) => {
			calls.push(`mountSecret ${host.className}`);
			held.secretChanged = changed;
		},
		openObsDownload: () => {
			calls.push('openObsDownload');
		},
	};
	return {
		bridge,
		held,
		calls,
		refreshed,
		refresh: (): void => {
			refreshed.count += 1;
		},
	};
}

const settle = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
};

describe('the screen recording’s rows in the settings', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it('says what a recording is for in the accent, then one warning of two lines, and that the choices are the device’s', () => {
		const row = new Row();
		renderRecordingNotes(row.setting, t);
		expect(row.settingEl.classList.contains('snowflake-method-settings-recording-bare')).toBe(true);
		expect(row.settingEl.querySelector('.setting-item-name')?.textContent).toBe('Before you record');
		const lines = [...row.settingEl.querySelectorAll('.snowflake-method-history-notice')];
		expect(
			lines.map((line) => [
				(line as HTMLElement).dataset.tone,
				// A notice of several lines keeps each in a box of its own.
				[...line.querySelectorAll('.snowflake-method-history-notice-text > div')].map((each) => each.textContent),
				line.querySelector('.snowflake-method-history-notice-text')?.textContent,
			]),
		).toEqual([
			['accent', [], 'When someone claims AI wrote your novel, answer with the record of how you wrote it!'],
			['warning', ['A recording shows everything on the screen. Watch it yourself before you share it.', 'Recording may slow the computer, and the video files take a lot of disk space.'], 'A recording shows everything on the screen. Watch it yourself before you share it.Recording may slow the computer, and the video files take a lot of disk space.'],
		]);
		expect(row.settingEl.querySelector('p.snowflake-method-hint')?.textContent).toBe(
			'These settings are kept on this device only.',
		);
		// The row's own name and control are gone: it is not a name beside a control.
		expect(row.settingEl.querySelector('.setting-item-control')).toBeNull();
	});

	it('says what macOS has not allowed, with the way to the system’s settings, and looks again when the window comes forward', () => {
		const { bridge, held, calls, refreshed, refresh } = rig();
		held.access = 'denied';
		const denied = new Row();
		const release = renderRecordingPermission(denied.setting, bridge, t, refresh);
		const line = denied.settingEl.querySelector<HTMLElement>('.snowflake-method-history-notice');
		expect(line?.dataset.tone).toBe('warning');
		expect(line?.querySelector('.snowflake-method-history-notice-text')?.textContent).toBe(
			'macOS has not allowed Obsidian to record the screen. Allow it in the system settings, then restart Obsidian.',
		);
		line?.querySelector('button')?.click();
		expect(calls).toEqual(['openScreenPrivacy']);
		// The author comes back from the system's settings.
		window.dispatchEvent(new Event('focus'));
		expect(refreshed.count).toBe(1);
		release();
		window.dispatchEvent(new Event('focus'));
		expect(refreshed.count).toBe(1);

		held.access = 'unknown';
		const unasked = new Row();
		renderRecordingPermission(unasked.setting, bridge, t, refresh)();
		const quiet = unasked.settingEl.querySelector<HTMLElement>('.snowflake-method-history-notice');
		expect(quiet?.dataset.tone).toBe('muted');
		expect(quiet?.querySelector('.snowflake-method-history-notice-text')?.textContent).toBe(
			'macOS asks for permission the first time you record. Restart Obsidian after you allow it.',
		);
	});

	it('says where recordings go outside the vault, and offers the system’s own dialog to choose', async () => {
		const { bridge, held, calls, refreshed, refresh } = rig();
		const standing = new Row();
		renderRecordingOutsideFolder(standing.setting, bridge, t, refresh);
		expect(standing.said()).toEqual([['No folder is chosen yet. Recordings go to /Users/ada/Movies.', false]]);
		expect(standing.buttons.map((button) => [button.textContent, button.disabled])).toEqual([
			['Choose', false],
			['Open folder', false],
		]);
		standing.button('Choose').click();
		await settle();
		expect(calls).toEqual(['chooseFolder']);
		// What the row says follows what was chosen.
		expect(refreshed.count).toBe(1);
		standing.button('Open folder').click();
		expect(calls).toEqual(['chooseFolder', 'openFolder']);

		held.storage = { mode: 'outside', path: '/Volumes/Tape/Proof' };
		const chosen = new Row();
		renderRecordingOutsideFolder(chosen.setting, bridge, t, refresh);
		// The folder alone: where recordings belong is the author's to judge.
		expect(chosen.said()).toEqual([['/Volumes/Tape/Proof', false]]);
		expect(chosen.descEl.firstElementChild?.classList.contains('snowflake-method-settings-recording-path')).toBe(true);
	});

	it('warns where there is no folder, or the one chosen is in the vault after all, and stands still while a recording runs', () => {
		const { bridge, held, refresh } = rig();
		held.storage = { mode: 'none' };
		const none = new Row();
		renderRecordingOutsideFolder(none.setting, bridge, t, refresh);
		expect(none.said()).toEqual([['Choose a folder before you record.', true]]);
		expect(none.button('Open folder').disabled).toBe(true);

		held.storage = { mode: 'vault', path: '/Users/ada/Vault/Proof', vaultPath: 'Proof', refused: false };
		const inside = new Row();
		renderRecordingOutsideFolder(inside.setting, bridge, t, refresh);
		expect(inside.said()).toEqual([
			['/Users/ada/Vault/Proof', false],
			['This folder is inside the vault. Sync carries its recordings (unless you exclude them).', true],
		]);

		held.storage = { mode: 'vault', path: '/Users/ada/Vault/Novels/Demo', vaultPath: 'Novels/Demo', refused: true };
		const project = new Row();
		renderRecordingOutsideFolder(project.setting, bridge, t, refresh);
		expect(project.said()[1]).toEqual(['This folder belongs to a project. Choose another one.', true]);
		expect(project.button('Open folder').disabled).toBe(true);

		held.storage = { mode: 'default', path: '/Users/ada/Movies' };
		held.state = { ...held.state, phase: 'recording' };
		const busy = new Row();
		renderRecordingOutsideFolder(busy.setting, bridge, t, refresh);
		expect([busy.button('Choose').disabled, busy.button('Open folder').disabled]).toEqual([true, false]);
	});

	it('says which vault folder recordings go to, and what the folder holds once it is counted', async () => {
		const { bridge, held, calls } = rig();
		held.storage = {
			mode: 'vault',
			path: '/Users/ada/Vault/Novels/Snowflake Recordings',
			vaultPath: 'Novels/Snowflake Recordings',
			refused: false,
		};
		const empty = new Row();
		describeRecordingVaultFolder(empty.setting, bridge, t, 'en');
		const words = [
			['Vault folder where recordings are saved.', false],
			['Empty means "Snowflake Recordings".', false],
		];
		expect(empty.said()).toEqual(words);
		await settle();
		// Nothing recorded yet: nothing more to say.
		expect(empty.said()).toEqual(words);
		// A folder of the vault is a click away in the file explorer: the row offers no way into it.
		expect(empty.buttons).toEqual([]);
		expect(calls).toEqual(['figures']);

		held.figures = { files: 2, bytes: 1_500_000_000 };
		const some = new Row();
		describeRecordingVaultFolder(some.setting, bridge, t, 'en');
		await settle();
		expect(some.said()).toEqual([...words, ['2 recordings, 1.5 GB.', false]]);
		held.figures = { files: 1, bytes: 420_000_000 };
		const one = new Row();
		describeRecordingVaultFolder(one.setting, bridge, t, 'en');
		await settle();
		expect(one.said()[2]).toEqual(['1 recording, 420 MB.', false]);
	});

	it('counts nothing in a folder recordings are refused, and writes nothing to a row that has gone', async () => {
		const { bridge, held, calls } = rig();
		held.storage = { mode: 'vault', path: '/Users/ada/Vault/Novels/Demo', vaultPath: 'Novels/Demo', refused: true };
		const refused = new Row();
		describeRecordingVaultFolder(refused.setting, bridge, t, 'en');
		expect(refused.said()[2]).toEqual(['This folder belongs to a project. Choose another one.', true]);
		await settle();
		expect(calls).toEqual([]);

		held.storage = { mode: 'vault', path: '/Users/ada/Vault/Proof', vaultPath: 'Proof', refused: false };
		held.figures = { files: 3, bytes: 9_000_000_000 };
		const gone = new Row();
		const release = describeRecordingVaultFolder(gone.setting, bridge, t, 'en');
		release();
		await settle();
		expect(gone.said()).toHaveLength(2);
	});

	it('folds OBS’s guide, sets OBS’s own names apart, and remembers whether it stood open', () => {
		const { bridge, calls } = rig();
		const memory = freshRecordingSettingsMemory();
		const row = new Row();
		renderObsGuide(row.setting, bridge, t, memory);
		const guide = row.settingEl.querySelector('details');
		expect(guide?.open).toBe(false);
		expect(guide?.querySelector('summary')?.textContent).toBe('Set up OBS Studio');
		const steps = [...row.settingEl.querySelectorAll('li')];
		expect(steps).toHaveLength(5);
		expect(steps[1]?.textContent).toBe('Open Tools > WebSocket Server Settings and select Enable WebSocket server.');
		expect([...(steps[1]?.querySelectorAll('strong') ?? [])].map((term) => term.textContent)).toEqual([
			'Tools',
			'WebSocket Server Settings',
			'Enable WebSocket server',
		]);
		// The recorder's own name is the way to its page: no button, a name with the sign of a link.
		expect(steps[0]?.textContent).toBe('Install OBS Studio and open it yourself for the first setup.');
		expect(row.settingEl.querySelector('button')).toBeNull();
		const link = steps[0]?.querySelector<HTMLElement>('.snowflake-method-recording-link');
		expect([link?.getAttribute('role'), link?.textContent]).toEqual(['link', 'OBS Studio']);
		expect(link?.querySelector('.snowflake-method-hint-link-icon')).not.toBeNull();
		link?.click();
		link?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		expect(calls).toEqual(['openObsDownload', 'openObsDownload']);
		// The choice that leaves everything to OBS is quoted as the choice is written.
		expect(steps[4]?.querySelector('strong')?.textContent).toBe('As set in OBS Studio');
		if (guide !== null) {
			guide.open = true;
			guide.dispatchEvent(new Event('toggle'));
		}
		expect(memory.guideOpen).toBe(true);
		// Drawn again, as when the page is: it stands open as it was left.
		const again = new Row();
		renderObsGuide(again.setting, bridge, t, memory);
		expect(again.settingEl.querySelector('details')?.open).toBe(true);
	});

	it('hands OBS’s password to Obsidian’s own field for a secret', () => {
		const { bridge, held, calls } = rig();
		const row = new Row();
		let changed = 0;
		renderObsPassword(row.setting, bridge, () => {
			changed += 1;
		});
		expect(calls).toEqual(['mountSecret setting-item-control']);
		// Another secret chosen in that field is passed on: a look made with the old one no longer stands.
		held.secretChanged();
		expect(changed).toBe(1);
	});

	it('looks at OBS when asked, and keeps the answer and its picture until a choice changes', async () => {
		const { bridge, calls, refreshed, refresh } = rig();
		const memory = freshRecordingSettingsMemory();
		const first = new Row();
		renderObsTest(first.setting, bridge, t, memory, refresh);
		expect(first.said()).toEqual([['Check that OBS Studio answers and see what it would record.', false]]);
		expect(first.descEl.querySelector('img')).toBeNull();
		first.button('Test connection').click();
		// The page is drawn again at once, to say a look is under way.
		expect([memory.testing, refreshed.count]).toEqual([true, 1]);
		const waiting = new Row();
		renderObsTest(waiting.setting, bridge, t, memory, refresh);
		expect(waiting.said()).toEqual([['Testing…', false]]);
		expect(waiting.button('Test connection').disabled).toBe(true);
		await settle();
		expect([memory.testing, refreshed.count, calls]).toEqual([false, 2, ['testObs']]);
		const answered = new Row();
		renderObsTest(answered.setting, bridge, t, memory, refresh);
		// The recorder by its full name, as everywhere a result is said.
		expect(answered.said()).toEqual([['Connected to OBS Studio 33.0.1.', false]]);
		const picture = answered.descEl.querySelector('img');
		expect([picture?.getAttribute('src'), picture?.getAttribute('alt')]).toEqual([
			'data:image/jpeg;base64,AAAA',
			'What OBS Studio will record',
		]);
	});

	it('says OBS is being opened while a look waits for a closed one to come up', async () => {
		const { bridge, held, refreshed, refresh } = rig();
		let finish: (probe: ObsProbe) => void = () => {};
		let opening: () => void = () => {};
		bridge.testObs = (onOpening) => {
			if (onOpening !== undefined) opening = onOpening;
			return new Promise((resolve) => {
				finish = resolve;
			});
		};
		const memory = freshRecordingSettingsMemory();
		const first = new Row();
		renderObsTest(first.setting, bridge, t, memory, refresh);
		first.button('Test connection').click();
		expect([memory.testing, memory.opening, refreshed.count]).toEqual([true, false, 1]);
		// OBS was closed: the plugin opens it, and the row says that is what the wait is for.
		opening();
		expect([memory.opening, refreshed.count]).toEqual([true, 2]);
		const waiting = new Row();
		renderObsTest(waiting.setting, bridge, t, memory, refresh);
		expect(waiting.said()).toEqual([['Opening OBS Studio…', false]]);
		expect(waiting.button('Test connection').disabled).toBe(true);
		finish(held.probe);
		await settle();
		expect([memory.testing, memory.opening, refreshed.count]).toEqual([false, false, 3]);
		const answered = new Row();
		renderObsTest(answered.setting, bridge, t, memory, refresh);
		expect(answered.said()).toEqual([['Connected to OBS Studio 33.0.1.', false]]);
		// The next look starts as a look, not as an opening.
		answered.button('Test connection').click();
		expect([memory.testing, memory.opening]).toEqual([true, false]);
	});

	it('forgets a look when a choice it was made with changes: its answer, and the one still on its way', async () => {
		const { bridge, held, refresh } = rig();
		const memory = freshRecordingSettingsMemory();
		// Nothing showing: there is nothing to draw away.
		expect(forgetObsProbe(memory)).toBe(false);
		memory.probe = held.probe;
		// An answer was showing, and is not any more: the page is told to draw.
		expect(forgetObsProbe(memory)).toBe(true);
		expect(memory.probe).toBeNull();

		// A look begun under the old port answers after the port was changed: it says nothing of the new one.
		let finish: (probe: ObsProbe) => void = () => {};
		bridge.testObs = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const row = new Row();
		renderObsTest(row.setting, bridge, t, memory, refresh);
		row.button('Test connection').click();
		expect(forgetObsProbe(memory)).toBe(false);
		finish(held.probe);
		await settle();
		expect([memory.testing, memory.probe]).toEqual([false, null]);
		const after = new Row();
		renderObsTest(after.setting, bridge, t, memory, refresh);
		expect(after.said()).toEqual([['Check that OBS Studio answers and see what it would record.', false]]);
		// A look made with the choices as they stand is kept as before.
		after.button('Test connection').click();
		finish(held.probe);
		await settle();
		expect(memory.probe).toEqual(held.probe);
	});

	it('says that OBS is live on another output where that stands in a recording’s way, with no picture', () => {
		const { bridge, refresh } = rig();
		const memory = freshRecordingSettingsMemory();
		memory.probe = { ok: true, version: '33.0.1', picture: null, problem: 'obs-live' };
		const live = new Row();
		renderObsTest(live.setting, bridge, t, memory, refresh);
		expect(live.said()).toEqual([
			[
				'OBS Studio is streaming or running another output, and the plugin’s scene would take it over. Stop that output, or choose “As set in OBS Studio”.',
				true,
			],
		]);
		expect(live.descEl.querySelector('img')).toBeNull();
	});

	it('says why OBS could not be looked at, or what stands in a recording’s way, and waits while one runs', () => {
		const { bridge, held, refresh } = rig();
		const memory = freshRecordingSettingsMemory();
		memory.probe = { ok: false, code: 'obs-closed' };
		const closed = new Row();
		renderObsTest(closed.setting, bridge, t, memory, refresh);
		expect(closed.said()).toEqual([
			['OBS Studio didn’t answer. Open OBS Studio and check that its WebSocket server is turned on.', true],
		]);
		expect(closed.descEl.querySelector('img')).toBeNull();

		memory.probe = { ok: true, version: '33.0.1', picture: 'data:image/jpeg;base64,AAAA', problem: 'obs-blank' };
		const blank = new Row();
		renderObsTest(blank.setting, bridge, t, memory, refresh);
		expect(blank.said()[0]?.[1]).toBe(true);
		// The blank picture is shown all the same: it is what OBS would record.
		expect(blank.descEl.querySelector('img')).not.toBeNull();

		held.state = { ...held.state, phase: 'recording' };
		const busy = new Row();
		renderObsTest(busy.setting, bridge, t, freshRecordingSettingsMemory(), refresh);
		expect(busy.button('Test connection').disabled).toBe(true);
	});

	it('says what each choice of what to record comes to with the recorder chosen', () => {
		expect(recordingScopeHint(t, 'screen', 'native', 'mac')).toBe('Records the screen Obsidian is on.');
		expect(recordingScopeHint(t, 'obs', 'obs', 'mac')).toBe('Records what OBS Studio’s current scene shows.');
		expect(recordingScopeHint(t, 'all', 'native', 'mac')).toBe('Each screen is saved as a file of its own.');
		expect(recordingScopeHint(t, 'all', 'obs', 'win')).toBe('Every screen shares one video, so each is smaller in it.');
		expect(recordingScopeHint(t, 'obsidian', 'native', 'mac')).toBe('Each Obsidian window is saved as a file of its own.');
		expect(recordingScopeHint(t, 'obsidian', 'obs', 'mac')).toBe('The video shows the Obsidian window you are working in.');
		// Off a Mac it has never been seen to follow, so nothing is promised there.
		expect(recordingScopeHint(t, 'obsidian', 'obs', 'win')).toBe('Records the Obsidian window only.');
		expect(recordingScopeHint(t, 'obsidian', 'obs', 'linux')).toBe('Records the Obsidian window only.');
	});
});
