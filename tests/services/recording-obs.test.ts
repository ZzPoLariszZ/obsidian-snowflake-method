import { describe, expect, it } from 'vitest';

import {
	OBS_SCENES,
	OBS_WINDOW_SPARE_INPUT,
	obsScreenInputName,
	type DesktopWindow,
	type ObsJournal,
	type ObsMacTarget,
	type RecordingNoticeCode,
	type RecordingSystem,
} from '../../src/domain';
import { ObsSocket } from '../../src/services/obs-socket';
import type { RecorderEnd, RecorderHooks } from '../../src/services/recording-driver';
import { FOLLOW_WAIT_MS, ObsRecorder, SWAP_SETTLE_MS, type ObsStart } from '../../src/services/recording-obs';
import { FakeClock } from '../helpers/fake-clock';
import { FAKE_OBS_PASSWORD, FakeObs } from '../helpers/fake-obs';

interface Rig {
	obs: FakeObs;
	clock: FakeClock;
	recorder: ObsRecorder;
	/** What the device holds of the ledger, as last saved. */
	ledger: { value: ObsJournal | null; saves: number };
	opened: { count: number; works: boolean; then: () => void };
	hooks: RecorderHooks;
	seen: {
		phases: string[];
		notices: RecordingNoticeCode[];
		bytes: number[];
		ended: RecorderEnd[];
		cancel: boolean;
		/** How many times the author was counted in, and what the count answers: true once it has run out. */
		held: number;
		count: () => Promise<boolean>;
	};
	/** A second recorder over the same OBS and the same ledger, as after a restart of the plugin. */
	again: () => ObsRecorder;
	/** What the system calls the screen Obsidian is on, and every screen, on a Mac. Null where it will not say. */
	mac: { screen: ObsMacTarget | null; all: ObsMacTarget | null; asked: string[] };
	/** The window of Obsidian's in use, which a recording of Obsidian alone begins on. */
	windows: { inUse: DesktopWindow | null };
}

/** Obsidian's main window, and one a tab was moved out into. */
const MAIN_WINDOW: DesktopWindow = { key: { window: 'main' }, id: 4321, title: 'Draft - Vault - Obsidian' };
const SIDE_WINDOW: DesktopWindow = { key: { window: 'side' }, id: 4399, title: 'Notes - Vault - Obsidian' };
/** The two as OBS on Windows lists them, with another program's window between. */
const WINDOWS_LIST = [
	{
		itemName: '[Obsidian.exe]: Draft - Vault - Obsidian',
		itemEnabled: true,
		itemValue: 'Draft - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe',
	},
	{ itemName: '[chrome.exe]: Tab', itemEnabled: true, itemValue: 'Tab:Chrome_WidgetWin_1:chrome.exe' },
	{
		itemName: '[Obsidian.exe]: Notes - Vault - Obsidian',
		itemEnabled: true,
		itemValue: 'Notes - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe',
	},
];

const MAIN_SCREEN = '08C01862-9690-4A1E-B653-10B1A582F805';
const SIDE_SCREEN = 'DCFB4942-F77D-4AFC-AAC8-471180EF3246';
/** A desk like the one this was built on: a wide screen, and a tall one to its left that stands higher. */
const TWO_SCREENS: ObsMacTarget = {
	displays: [
		{ displayUuid: MAIN_SCREEN, frame: { x: 0, y: 0, width: 2560, height: 1440 } },
		{ displayUuid: SIDE_SCREEN, frame: { x: -1440, y: -690, width: 1440, height: 2560 } },
	],
};

function rig(options: { system?: RecordingSystem; obs?: FakeObs; ledger?: ObsJournal | null } = {}): Rig {
	const obs = options.obs ?? new FakeObs();
	const clock = new FakeClock();
	const ledger = { value: options.ledger ?? null, saves: 0 };
	const opened = { count: 0, works: true, then: (): void => {} };
	const seen: Rig['seen'] = {
		phases: [],
		notices: [],
		bytes: [],
		ended: [],
		cancel: false,
		held: 0,
		count: () => Promise.resolve(true),
	};
	const mac: Rig['mac'] = {
		screen: { displayUuid: MAIN_SCREEN },
		all: TWO_SCREENS,
		asked: [],
	};
	const windows: Rig['windows'] = { inUse: MAIN_WINDOW };
	let minted = 0;
	const make = (): ObsRecorder =>
		new ObsRecorder({
			socket: () =>
				new ObsSocket({
					open: obs.open,
					timers: clock.timers,
					mint: () => {
						minted += 1;
						return `call-${String(minted)}`;
					},
				}),
			system: () => options.system ?? 'mac',
			journal: {
				load: () => ledger.value,
				save: (journal) => {
					ledger.value = journal === null ? null : (JSON.parse(JSON.stringify(journal)) as ObsJournal);
					ledger.saves += 1;
				},
			},
			timers: clock.timers,
			now: () => clock.now,
			openObs: () => {
				opened.count += 1;
				opened.then();
				return Promise.resolve(opened.works);
			},
			screenOrigin: () => ({ x: 0, y: 0 }),
			macTarget: (scope) => {
				mac.asked.push(scope);
				return Promise.resolve(mac[scope]);
			},
			obsidianWindow: () => windows.inUse,
		});
	return {
		obs,
		clock,
		recorder: make(),
		ledger,
		opened,
		seen,
		hooks: {
			phase: (phase) => seen.phases.push(phase),
			cancelled: () => seen.cancel,
			hold: () => {
				seen.held += 1;
				return seen.count();
			},
			bytes: (bytes) => seen.bytes.push(bytes),
			notice: (code) => seen.notices.push(code),
			ended: (end) => seen.ended.push(end),
		},
		again: make,
		mac,
		windows,
	};
}

const request = (patch: Partial<ObsStart> = {}): ObsStart => ({
	port: 4455,
	password: null,
	folder: '/Users/ada/Proof',
	scope: 'screen',
	quality: 'original',
	mayOpen: false,
	...patch,
});

describe('recording through OBS', () => {
	it('borrows, records, and after a stop leaves OBS as it found it', async () => {
		const { obs, clock, recorder, hooks, seen, ledger } = rig();
		const before = obs.borrowable();
		const started = await clock.drive(recorder.start(request({ quality: '1080p' }), hooks));
		expect(started).toMatchObject({ ok: true, path: obs.recordPath });
		expect(seen.phases).toEqual(['starting']);
		// What OBS holds while it records.
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('/Users/ada/Proof');
		expect(obs.parameters['Output/FilenameFormatting']).toBe('%CCYY-%MM-%DD %hh.%mm.%ss');
		// How OBS compresses is never touched: a start after that records nothing.
		expect(obs.parameters['SimpleOutput/RecQuality']).toBe('Stream');
		// The screen is 2560 by 1440 here: the canvas is made its size, and the picture written at 1080 lines.
		expect(obs.video).toMatchObject({ baseWidth: 2560, baseHeight: 1440, outputWidth: 1920, outputHeight: 1080 });
		expect(obs.program).toBe(OBS_SCENES.screen.scene);
		expect(obs.mutes).toEqual({ 'Mic/Aux': true, 'Desktop Audio': true });
		expect(obs.recording).toBe(true);
		expect(recorder.owes).toBe(true);
		expect(ledger.value?.loans.map((loan) => loan.kind)).toEqual([
			'parameter', 'parameter', 'scene', 'mute', 'canvas', 'output-size',
		]);
		// The author was counted in once, before the recording was asked for.
		expect(seen.held).toBe(1);

		const stopped = await clock.drive(recorder.stop());
		expect(stopped).toEqual({ path: obs.recordPath, error: null });
		expect(obs.recording).toBe(false);
		expect(obs.borrowable()).toEqual(before);
		expect(recorder.owes).toBe(false);
		expect(ledger.value).toBeNull();
		expect(seen.notices).toEqual([]);
		expect(seen.ended).toEqual([]);
	});

	it('asks for everything in one order, the recording last', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request({ quality: '720p' }), hooks));
		expect(obs.writes()).toEqual([
			// Whatever an earlier recording left of the plugin's own goes first, for each of its three scenes,
			// and the source for Obsidian's window under its second name.
			'RemoveInput',
			'RemoveScene',
			'RemoveInput',
			'RemoveScene',
			'RemoveInput',
			'RemoveScene',
			'RemoveInput',
			'SetProfileParameter',
			'SetProfileParameter',
			'CreateScene',
			'CreateInput',
			'SetInputSettings',
			// The plugin's own source first, then OBS's microphone.
			'SetInputMute',
			'SetSceneItemTransform',
			'SetCurrentProgramScene',
			'SetInputMute',
			// The canvas is made the size of the screen, and the source put on it again. OBS
			// writes at 720 lines already here, so nothing more is borrowed for the quality.
			'SetVideoSettings',
			'SetSceneItemTransform',
			'StartRecord',
		]);
		const folder = obs.calls.find((call) => call.type === 'SetProfileParameter');
		expect(folder?.data).toEqual({
			parameterCategory: 'SimpleOutput',
			parameterName: 'FilePath',
			parameterValue: '/Users/ada/Proof',
		});
		// Never the request that writes both of OBS's folder keys at once.
		expect(obs.types()).not.toContain('SetRecordDirectory');
	});

	it('writes each loan down before it changes anything', async () => {
		const obs = new FakeObs();
		const { clock, recorder, hooks, ledger } = rig({ obs });
		let savedBeforeFirstWrite: number | null = null;
		const original = obs.receive.bind(obs);
		obs.receive = (socket, frame) => {
			if (savedBeforeFirstWrite === null && frame.includes('"SetProfileParameter"')) {
				savedBeforeFirstWrite = ledger.saves;
				expect(ledger.value?.loans).toEqual([
					{
						kind: 'parameter',
						profile: 'Untitled',
						category: 'SimpleOutput',
						name: 'FilePath',
						before: '/Users/ada/Movies',
						after: '/Users/ada/Proof',
					},
				]);
			}
			original(socket, frame);
		};
		await clock.drive(recorder.start(request(), hooks));
		expect(savedBeforeFirstWrite).toBeGreaterThan(0);
	});

	it('points the source at the screen Obsidian stands on and fits it to the canvas', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request(), hooks));
		expect(obs.inputs[OBS_SCENES.screen.input]).toEqual({
			kind: 'screen_capture',
			settings: { type: 0, show_cursor: true, display_uuid: MAIN_SCREEN },
			muted: true,
		});
		const fit = obs.calls.find((call) => call.type === 'SetSceneItemTransform');
		expect(fit?.data.sceneItemTransform).toMatchObject({
			boundsType: 'OBS_BOUNDS_SCALE_INNER',
			boundsWidth: 1920,
			boundsHeight: 1080,
		});
	});

	it('records Obsidian alone by its own window on a Mac', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request({ scope: 'obsidian' }), hooks));
		expect(obs.program).toBe(OBS_SCENES.obsidian.scene);
		expect(obs.inputs[OBS_SCENES.obsidian.input]?.settings).toEqual({ type: 1, window: 4321, show_cursor: true });
	});

	it('begins on the window of Obsidian’s that is in use, and makes no source where none can be named', async () => {
		const moved = rig();
		moved.windows.inUse = SIDE_WINDOW;
		expect((await moved.clock.drive(moved.recorder.start(request({ scope: 'obsidian' }), moved.hooks))).ok).toBe(true);
		expect(moved.obs.inputs[OBS_SCENES.obsidian.input]?.settings).toEqual({ type: 1, window: 4399, show_cursor: true });

		for (const inUse of [null, { ...MAIN_WINDOW, id: null }]) {
			const unnamed = rig();
			unnamed.windows.inUse = inUse;
			const before = unnamed.obs.borrowable();
			expect(
				await unnamed.clock.drive(unnamed.recorder.start(request({ scope: 'obsidian' }), unnamed.hooks)),
			).toMatchObject({ ok: false, code: 'obs-scene' });
			expect(unnamed.obs.types()).not.toContain('CreateInput');
			expect(unnamed.obs.borrowable()).toEqual(before);
		}
	});

	it('follows the author to another of Obsidian’s windows while it records, with a source made anew', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request({ scope: 'obsidian' }), hooks));
		expect(obs.onAir()).toEqual([{ source: OBS_SCENES.obsidian.input, window: 4321 }]);
		const made = (): number => obs.types().filter((type) => type === 'CreateInput').length;
		recorder.follow(SIDE_WINDOW);
		// Not at once: a move is left to settle.
		await clock.settle();
		expect(made()).toBe(1);
		await clock.advance(FOLLOW_WAIT_MS);
		// The new source is on top and shown, and the old one is still under it while the new finds its picture.
		expect(obs.onAir()).toEqual([
			{ source: OBS_WINDOW_SPARE_INPUT, window: 4399 },
			{ source: OBS_SCENES.obsidian.input, window: 4321 },
		]);
		await clock.advance(SWAP_SETTLE_MS);
		expect(obs.onAir()).toEqual([{ source: OBS_WINDOW_SPARE_INPUT, window: 4399 }]);
		expect(obs.inputs[OBS_WINDOW_SPARE_INPUT]).toEqual({
			kind: 'screen_capture',
			settings: { type: 1, window: 4399, show_cursor: true },
			muted: true,
			knows: [4321, 4399],
		});
		// And back again, the two names taking turns.
		recorder.follow(MAIN_WINDOW);
		await clock.advance(FOLLOW_WAIT_MS + SWAP_SETTLE_MS);
		expect(obs.onAir()).toEqual([{ source: OBS_SCENES.obsidian.input, window: 4321 }]);
		expect(obs.capturing()).toEqual([OBS_SCENES.obsidian.input]);
		// Each was hidden until it was muted and in its place: the recording got no sound and no picture out of place.
		expect([obs.heard, obs.misplaced]).toEqual([[], []]);
		const fits = obs.calls.filter((call) => call.type === 'SetSceneItemTransform').map((call) => call.data.sceneItemTransform);
		expect(fits).toHaveLength(3);
		expect(fits[2]).toEqual(fits[0]);
		// A Mac's windows are named by the system: OBS is never asked for a list, which would end it.
		expect(obs.types()).not.toContain('GetInputPropertiesListPropertyItems');
		expect(obs.crashed).toBe(false);
		expect(obs.recording).toBe(true);
		// Nothing of either is left once the recording ends.
		await clock.drive(recorder.stop());
		expect([obs.scenes.map((scene) => scene.name), obs.capturing(), obs.program]).toEqual([['Scene'], [], 'Scene']);
	});

	it('shows a window that opened after the recording began, which the first source never could', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request({ scope: 'obsidian' }), hooks));
		const later: DesktopWindow = { key: { window: 'later' }, id: 4500, title: 'Cast - Vault - Obsidian' };
		obs.desk.push(4500);
		// What setting the old source to it would come to, as with the real OBS: no picture at all.
		const socket = new ObsSocket({ open: obs.open, timers: clock.timers, mint: () => 'probe' });
		await clock.drive(socket.connect(4455, null));
		await clock.drive(
			socket.call('SetInputSettings', { inputName: OBS_SCENES.obsidian.input, inputSettings: { window: 4500 }, overlay: true }),
		);
		expect(obs.onAir()).toEqual([]);
		socket.close();
		recorder.follow(later);
		await clock.advance(FOLLOW_WAIT_MS + SWAP_SETTLE_MS);
		expect(obs.onAir()).toEqual([{ source: OBS_WINDOW_SPARE_INPUT, window: 4500 }]);
		// And when that window closes, the source goes back to one that is still there.
		obs.desk = obs.desk.filter((id) => id !== 4500);
		expect(obs.onAir()).toEqual([]);
		recorder.follow(MAIN_WINDOW);
		await clock.advance(FOLLOW_WAIT_MS + SWAP_SETTLE_MS);
		expect(obs.onAir()).toEqual([{ source: OBS_SCENES.obsidian.input, window: 4321 }]);
	});

	it('follows only the last of a burst of moves, and asks nothing for the window it already shows', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request({ scope: 'obsidian' }), hooks));
		const made = (): number => obs.types().filter((type) => type === 'CreateInput').length;
		recorder.follow(SIDE_WINDOW);
		recorder.follow(MAIN_WINDOW);
		recorder.follow(SIDE_WINDOW);
		await clock.advance(FOLLOW_WAIT_MS + SWAP_SETTLE_MS);
		expect(made()).toBe(2);
		expect(obs.onAir()).toEqual([{ source: OBS_WINDOW_SPARE_INPUT, window: 4399 }]);
		// There and back before it settled: the source is where it should be already.
		const asked = obs.types().length;
		recorder.follow(MAIN_WINDOW);
		recorder.follow(SIDE_WINDOW);
		await clock.advance(FOLLOW_WAIT_MS + SWAP_SETTLE_MS);
		expect(obs.types().length).toBe(asked);
	});

	it('takes up the next move when the author moves again while a source is being made', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request({ scope: 'obsidian' }), hooks));
		recorder.follow(SIDE_WINDOW);
		await clock.advance(FOLLOW_WAIT_MS);
		// The new source is up and the old one not yet gone: the author is back in the main window.
		recorder.follow(MAIN_WINDOW);
		await clock.advance(FOLLOW_WAIT_MS + SWAP_SETTLE_MS * 2);
		expect(obs.onAir()).toEqual([{ source: OBS_SCENES.obsidian.input, window: 4321 }]);
		expect(obs.capturing()).toEqual([OBS_SCENES.obsidian.input]);
		expect([obs.heard, obs.misplaced]).toEqual([[], []]);
	});

	it('asks again for a name OBS has not let go of yet, and keeps the old source where the new cannot be shown', async () => {
		const slow = rig();
		slow.obs.lingers = 2;
		await slow.clock.drive(slow.recorder.start(request({ scope: 'obsidian' }), slow.hooks));
		slow.recorder.follow(SIDE_WINDOW);
		await slow.clock.advance(FOLLOW_WAIT_MS + SWAP_SETTLE_MS);
		slow.recorder.follow(MAIN_WINDOW);
		// The first name was the old source's a moment ago: OBS refuses it twice, then takes it.
		await slow.clock.advance(FOLLOW_WAIT_MS + SWAP_SETTLE_MS + 500);
		expect(slow.obs.onAir()).toEqual([{ source: OBS_SCENES.obsidian.input, window: 4321 }]);
		expect(slow.obs.calls.filter((call) => call.type === 'CreateInput')).toHaveLength(5);

		const mute = rig();
		await mute.clock.drive(mute.recorder.start(request({ scope: 'obsidian' }), mute.hooks));
		mute.obs.failNext('SetInputMute', 702);
		mute.recorder.follow(SIDE_WINDOW);
		await mute.clock.advance(FOLLOW_WAIT_MS + SWAP_SETTLE_MS);
		// A source that cannot be muted is never shown: it goes again, and the recording stays where it was.
		expect(mute.obs.onAir()).toEqual([{ source: OBS_SCENES.obsidian.input, window: 4321 }]);
		expect(mute.obs.capturing()).toEqual([OBS_SCENES.obsidian.input]);
		expect(mute.obs.heard).toEqual([]);
		// The next move is followed all the same.
		mute.recorder.follow(SIDE_WINDOW);
		await mute.clock.advance(FOLLOW_WAIT_MS + SWAP_SETTLE_MS);
		expect(mute.obs.onAir()).toEqual([{ source: OBS_WINDOW_SPARE_INPUT, window: 4399 }]);
	});

	it('follows nothing where the recording is not of Obsidian alone, nor once it has stopped', async () => {
		const screen = rig();
		await screen.clock.drive(screen.recorder.start(request(), screen.hooks));
		const before = screen.obs.types().length;
		screen.recorder.follow(SIDE_WINDOW);
		await screen.clock.advance(FOLLOW_WAIT_MS);
		expect(screen.obs.types().slice(before)).not.toContain('SetInputSettings');

		const stopped = rig();
		await stopped.clock.drive(stopped.recorder.start(request({ scope: 'obsidian' }), stopped.hooks));
		stopped.recorder.follow(SIDE_WINDOW);
		// Stopped before the move had settled: the source is gone, and nothing is asked of it.
		await stopped.clock.drive(stopped.recorder.stop());
		const after = stopped.obs.types().length;
		stopped.recorder.follow(MAIN_WINDOW);
		await stopped.clock.advance(FOLLOW_WAIT_MS * 4);
		expect(stopped.obs.types().length).toBe(after);
		expect(stopped.clock.waiting).toBe(0);

		// Stopped while a new source was being made: both go with the recording, and nothing is left capturing.
		const midway = rig();
		await midway.clock.drive(midway.recorder.start(request({ scope: 'obsidian' }), midway.hooks));
		midway.recorder.follow(SIDE_WINDOW);
		await midway.clock.advance(FOLLOW_WAIT_MS);
		expect(midway.obs.capturing()).toHaveLength(2);
		await midway.clock.drive(midway.recorder.stop());
		await midway.clock.advance(SWAP_SETTLE_MS * 2);
		expect([midway.obs.scenes.map((scene) => scene.name), midway.obs.capturing()]).toEqual([['Scene'], []]);
		expect(midway.clock.waiting).toBe(0);
	});

	it('begins on the window in use on Windows too, found by its title in OBS’s own list', async () => {
		const windows = rig({ system: 'win' });
		windows.obs.kinds = ['monitor_capture', 'window_capture'];
		windows.obs.loudKinds = [];
		windows.obs.lists.window = WINDOWS_LIST;
		windows.windows.inUse = SIDE_WINDOW;
		expect((await windows.clock.drive(windows.recorder.start(request({ scope: 'obsidian' }), windows.hooks))).ok).toBe(true);
		expect(windows.obs.inputs[OBS_SCENES.obsidian.input]?.settings).toMatchObject({
			priority: 2,
			window: 'Notes - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe',
		});
		// And follows by the same list.
		windows.recorder.follow(MAIN_WINDOW);
		await windows.clock.advance(FOLLOW_WAIT_MS);
		expect(windows.obs.inputs[OBS_SCENES.obsidian.input]?.settings).toMatchObject({
			priority: 2,
			window: 'Draft - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe',
		});
	});

	it('points OBS under X11 at the screen Obsidian stands on, chosen from OBS’s own list, and at no other', async () => {
		const linux = rig({ system: 'linux' });
		linux.obs.kinds = ['xshm_input_v2', 'xcomposite_input'];
		linux.obs.loudKinds = [];
		// Obsidian stands on the screen at 0,0, which OBS lists second: a source left to itself would show the first.
		linux.obs.lists.screen = [
			{ itemName: 'Screen HDMI-1 (1920x1080 @ -1920,0)', itemEnabled: true, itemValue: 0 },
			{ itemName: 'Screen DP-1 (2560x1440 @ 0,0)', itemEnabled: true, itemValue: 1 },
		];
		expect((await linux.clock.drive(linux.recorder.start(request(), linux.hooks))).ok).toBe(true);
		expect(linux.obs.inputs[OBS_SCENES.screen.input]).toMatchObject({
			kind: 'xshm_input_v2',
			settings: { show_cursor: true, screen: 1 },
		});

		// Where OBS lists no screen at that corner, none is recorded in its place.
		const elsewhere = rig({ system: 'linux' });
		elsewhere.obs.kinds = ['xshm_input_v2', 'xcomposite_input'];
		elsewhere.obs.loudKinds = [];
		elsewhere.obs.lists.screen = [
			{ itemName: 'Screen HDMI-1 (1920x1080 @ -1920,0)', itemEnabled: true, itemValue: 0 },
			{ itemName: 'Screen DP-1 (2560x1440 @ 40,0)', itemEnabled: true, itemValue: 1 },
		];
		const before = elsewhere.obs.borrowable();
		expect(await elsewhere.clock.drive(elsewhere.recorder.start(request(), elsewhere.hooks))).toMatchObject({
			ok: false,
			code: 'obs-scene',
		});
		expect(elsewhere.obs.types()).not.toContain('StartRecord');
		expect(elsewhere.obs.borrowable()).toEqual(before);
		expect(elsewhere.obs.capturing()).toEqual([]);
	});

	it('stays on the window it shows where OBS lists none of the title asked for', async () => {
		const windows = rig({ system: 'win' });
		windows.obs.kinds = ['monitor_capture', 'window_capture'];
		windows.obs.loudKinds = [];
		windows.obs.lists.window = WINDOWS_LIST;
		await windows.clock.drive(windows.recorder.start(request({ scope: 'obsidian' }), windows.hooks));
		const lists = (): number =>
			windows.obs.types().filter((type) => type === 'GetInputPropertiesListPropertyItems').length;
		const atStart = lists();
		const sets = windows.obs.types().filter((type) => type === 'SetInputSettings').length;
		windows.recorder.follow({ key: { window: 'unlisted' }, id: null, title: 'Nowhere - Vault - Obsidian' });
		await windows.clock.advance(10_000);
		// Asked for a few times, then left: never a guess at another window.
		expect(lists()).toBe(atStart + 3);
		expect(windows.obs.types().filter((type) => type === 'SetInputSettings')).toHaveLength(sets);
		expect(windows.obs.inputs[OBS_SCENES.obsidian.input]?.settings).toMatchObject({
			window: 'Draft - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe',
		});
		expect(windows.obs.recording).toBe(true);
	});

	it('asks again for a window just opened, whose title comes a moment after it', async () => {
		const windows = rig({ system: 'win' });
		windows.obs.kinds = ['monitor_capture', 'window_capture'];
		windows.obs.loudKinds = [];
		windows.obs.lists.window = WINDOWS_LIST;
		await windows.clock.drive(windows.recorder.start(request({ scope: 'obsidian' }), windows.hooks));
		// As a new window comes forward: no title of its own yet.
		windows.recorder.follow({ ...SIDE_WINDOW, title: 'Obsidian' });
		await windows.clock.advance(FOLLOW_WAIT_MS);
		expect(windows.obs.inputs[OBS_SCENES.obsidian.input]?.settings).toMatchObject({
			window: 'Draft - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe',
		});
		// The same window, read again a second later, has its title.
		windows.windows.inUse = SIDE_WINDOW;
		await windows.clock.advance(1000);
		expect(windows.obs.inputs[OBS_SCENES.obsidian.input]?.settings).toMatchObject({
			window: 'Notes - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe',
		});
	});

	it('gives every screen a source of its own on a Mac, laid out as the screens stand on the desk', async () => {
		const { obs, clock, recorder, hooks, mac } = rig();
		const started = await clock.drive(recorder.start(request({ scope: 'all' }), hooks));
		expect(started.ok).toBe(true);
		expect(mac.asked).toEqual(['all']);
		expect(obs.program).toBe(OBS_SCENES.all.scene);
		expect(obs.capturing()).toEqual([obsScreenInputName(0), obsScreenInputName(1)]);
		expect(obs.inputs[obsScreenInputName(0)]).toEqual({
			kind: 'screen_capture',
			settings: { type: 0, display_uuid: MAIN_SCREEN, show_cursor: true },
			muted: true,
		});
		expect(obs.inputs[obsScreenInputName(1)]?.settings).toEqual({ type: 0, display_uuid: SIDE_SCREEN, show_cursor: true });
		expect(obs.inputs[obsScreenInputName(1)]?.muted).toBe(true);
		// The canvas is 1920 by 1080 and stays so: the two screens share it, the tall one on the left.
		const fits = obs.calls.filter((call) => call.type === 'SetSceneItemTransform').map((call) => call.data.sceneItemTransform);
		expect(fits).toHaveLength(2);
		expect(fits[0]).toMatchObject({ boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1080, boundsHeight: 607.5 });
		expect(fits[1]).toMatchObject({ positionY: 0, boundsWidth: 607.5, boundsHeight: 1080 });
		const [wide, tall] = fits as { positionX: number; positionY: number }[];
		expect(tall?.positionX).toBeLessThan(wide?.positionX ?? 0);
		expect(obs.video).toMatchObject({ baseWidth: 1920, baseHeight: 1080 });
		expect(obs.types()).not.toContain('GetInputPropertiesListPropertyItems');
		// And nothing of it is left once the recording ends.
		await clock.drive(recorder.stop());
		expect([obs.scenes.map((scene) => scene.name), obs.capturing(), obs.program]).toEqual([['Scene'], [], 'Scene']);
	});

	it('reads every screen from OBS’s own list on Windows, a source for each', async () => {
		const obs = new FakeObs();
		obs.kinds = ['monitor_capture', 'window_capture'];
		obs.loudKinds = [];
		obs.lists.monitor_id = [
			{ itemName: '[Select a display to capture]', itemEnabled: true, itemValue: 'DUMMY' },
			{ itemName: 'Display 1: 1920x1080 @ 0,0 (Primary Monitor)', itemEnabled: true, itemValue: 'mon-1' },
			{ itemName: 'Display 2: 1920x1080 @ 1920,0', itemEnabled: true, itemValue: 'mon-2' },
		];
		const { clock, recorder, hooks, mac } = rig({ obs, system: 'win' });
		const started = await clock.drive(recorder.start(request({ scope: 'all', folder: 'D:\\Proof' }), hooks));
		expect(started.ok).toBe(true);
		// The system is only asked on a Mac.
		expect(mac.asked).toEqual([]);
		expect(obs.capturing()).toEqual([obsScreenInputName(0), obsScreenInputName(1)]);
		expect(obs.inputs[obsScreenInputName(0)]?.settings).toEqual({ capture_cursor: true, monitor_id: 'mon-1' });
		expect(obs.inputs[obsScreenInputName(1)]?.settings).toEqual({ capture_cursor: true, monitor_id: 'mon-2' });
		// Side by side on a canvas of one screen's shape: each takes half its width.
		const fits = obs.calls.filter((call) => call.type === 'SetSceneItemTransform').map((call) => call.data.sceneItemTransform);
		expect(fits).toEqual([
			expect.objectContaining({ positionX: 0, positionY: 270, boundsWidth: 960, boundsHeight: 540 }),
			expect.objectContaining({ positionX: 960, positionY: 270, boundsWidth: 960, boundsHeight: 540 }),
		]);
		await clock.drive(recorder.stop());
		expect(obs.capturing()).toEqual([]);
	});

	it('makes no scene of every screen where a screen cannot be named or placed, and leaves OBS as it was', async () => {
		const unnamed = rig();
		unnamed.mac.all = null;
		expect(await unnamed.clock.drive(unnamed.recorder.start(request({ scope: 'all' }), unnamed.hooks))).toMatchObject({
			ok: false,
			code: 'obs-scene',
		});
		expect(unnamed.obs.types()).not.toContain('CreateScene');

		const obs = new FakeObs();
		obs.kinds = ['monitor_capture'];
		obs.loudKinds = [];
		obs.lists.monitor_id = [
			{ itemName: 'Display 1: 1920x1080 @ 0,0', itemEnabled: true, itemValue: 'mon-1' },
			{ itemName: 'Display 2', itemEnabled: true, itemValue: 'mon-2' },
		];
		const unplaced = rig({ obs, system: 'win' });
		const before = obs.borrowable();
		expect(await unplaced.clock.drive(unplaced.recorder.start(request({ scope: 'all' }), unplaced.hooks))).toMatchObject({
			ok: false,
			code: 'obs-scene',
		});
		// The first source, made to ask OBS for its screens, went again with its scene.
		expect([obs.scenes.map((scene) => scene.name), obs.capturing()]).toEqual([['Scene'], []]);
		expect(obs.borrowable()).toEqual(before);
	});

	it('takes every screen’s source away when the plugin goes this instant', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request({ scope: 'all' }), hooks));
		expect(obs.capturing()).toHaveLength(2);
		recorder.abandon();
		await clock.settle();
		expect(obs.capturing()).toEqual([]);
		expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene']);
	});

	it('never asks OBS on a Mac for its list of screens, which ends OBS', async () => {
		for (const scope of ['screen', 'all', 'obsidian'] as const) {
			const { obs, clock, recorder, hooks, mac, again } = rig();
			const started = await clock.drive(recorder.start(request({ scope }), hooks));
			expect(started.ok).toBe(true);
			expect(obs.types()).not.toContain('GetInputPropertiesListPropertyItems');
			expect(obs.crashed).toBe(false);
			// The system was asked instead, once, for a screen. A window carries its own number.
			expect(mac.asked).toEqual(scope === 'obsidian' ? [] : [scope]);
			await clock.drive(recorder.stop());
			// The same holds for a look without a recording.
			const probe = await clock.drive(again().probe({ port: 4455, password: null, scope, mayOpen: false }));
			expect(probe).toMatchObject({ ok: true, problem: null });
			expect(obs.types()).not.toContain('GetInputPropertiesListPropertyItems');
			expect(obs.crashed).toBe(false);
		}
	});

	it('shows what asking would cost: the scripted OBS falls over as the real one does', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request(), hooks));
		// The source is there only while the recording runs.
		const socket = new ObsSocket({ open: obs.open, timers: clock.timers, mint: () => 'probe' });
		await clock.drive(socket.connect(4455, null));
		const answer = await clock.drive(
			socket.call('GetInputPropertiesListPropertyItems', {
				inputName: OBS_SCENES.screen.input,
				propertyName: 'display_uuid',
			}),
		);
		expect(answer.ok).toBe(false);
		expect(obs.crashed).toBe(true);
	});

	it('makes no source on a Mac where the system will not name the screen, and leaves OBS untouched', async () => {
		const { obs, clock, recorder, hooks, mac, ledger } = rig();
		mac.screen = null;
		const before = obs.borrowable();
		const started = await clock.drive(recorder.start(request(), hooks));
		expect(started).toMatchObject({ ok: false, code: 'obs-scene' });
		expect(obs.types()).not.toContain('CreateScene');
		expect(obs.types()).not.toContain('CreateInput');
		expect(obs.borrowable()).toEqual(before);
		expect(ledger.value).toBeNull();
	});

	it('replaces a source an earlier build left, pointed at the wrong thing and perhaps no longer live', async () => {
		const { obs, clock, recorder, hooks } = rig();
		// As the first build made it: an application capture, left in OBS after its recording.
		obs.scenes.push({ name: OBS_SCENES.obsidian.scene, items: [{ id: 41, source: OBS_SCENES.obsidian.input }] });
		obs.inputs[OBS_SCENES.obsidian.input] = {
			kind: 'screen_capture',
			settings: { type: 2, application: 'md.obsidian', show_cursor: true },
			muted: false,
		};
		const started = await clock.drive(recorder.start(request({ scope: 'obsidian' }), hooks));
		expect(started.ok).toBe(true);
		// Not the old source with new settings: OBS does not start a source again that it has cut off.
		expect(obs.types().indexOf('RemoveInput')).toBeLessThan(obs.types().indexOf('CreateInput'));
		expect(obs.inputs[OBS_SCENES.obsidian.input]?.settings).toEqual({ type: 1, window: 4321, show_cursor: true });
		expect(obs.inputs[OBS_SCENES.obsidian.input]?.muted).toBe(true);
	});

	it('makes its scene and its source anew for every recording, and takes them away after each', async () => {
		const { obs, clock, recorder, hooks } = rig();
		for (let round = 1; round <= 2; round += 1) {
			await clock.drive(recorder.start(request(), hooks));
			expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene', OBS_SCENES.screen.scene]);
			expect(obs.capturing()).toEqual([OBS_SCENES.screen.input]);
			expect(obs.types().filter((type) => type === 'CreateScene')).toHaveLength(round);
			expect(obs.types().filter((type) => type === 'CreateInput')).toHaveLength(round);
			await clock.drive(recorder.stop());
			// A source left in OBS goes on capturing, on air or not, and the system shows the author as much.
			expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene']);
			expect(obs.capturing()).toEqual([]);
			expect(obs.program).toBe('Scene');
		}
	});

	it('leaves nothing of its own in OBS after a look, a start that came to nothing, or a stop in OBS itself', async () => {
		const looked = rig();
		await looked.clock.drive(looked.recorder.probe({ port: 4455, password: null, scope: 'obsidian', mayOpen: false }));
		expect([looked.obs.scenes.map((scene) => scene.name), looked.obs.capturing()]).toEqual([['Scene'], []]);

		const refused = rig();
		refused.obs.blank = true;
		const start = await refused.clock.drive(refused.recorder.start(request(), refused.hooks));
		expect(start).toMatchObject({ ok: false, code: 'obs-blank' });
		expect([refused.obs.scenes.map((scene) => scene.name), refused.obs.capturing()]).toEqual([['Scene'], []]);

		const elsewhere = rig();
		await elsewhere.clock.drive(elsewhere.recorder.start(request(), elsewhere.hooks));
		elsewhere.obs.stopFromInside();
		await elsewhere.clock.advance(1000);
		expect(elsewhere.seen.ended).toHaveLength(1);
		expect([elsewhere.obs.scenes.map((scene) => scene.name), elsewhere.obs.capturing()]).toEqual([['Scene'], []]);
	});

	it('takes away what an earlier run left of both scopes, even to record OBS’s own scene', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.scenes[0]?.items.push({ id: 7, source: 'The author’s own capture' });
		for (const names of Object.values(OBS_SCENES)) {
			obs.scenes.push({ name: names.scene, items: [{ id: 90, source: names.input }] });
			obs.inputs[names.input] = { kind: 'screen_capture', settings: {}, muted: false };
		}
		const started = await clock.drive(recorder.start(request({ scope: 'obs' }), hooks));
		expect(started.ok).toBe(true);
		expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene']);
		expect(obs.capturing()).toEqual([]);
		// The author's own scene and what it holds are no business of the plugin's.
		expect(obs.scenes[0]?.items).toEqual([{ id: 7, source: 'The author’s own capture' }]);
	});

	it('sends its scene away without waiting when the plugin goes this instant', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request(), hooks));
		recorder.abandon();
		await clock.settle();
		const sent = obs.types();
		expect(sent.indexOf('StopRecord')).toBeGreaterThan(-1);
		expect(sent.lastIndexOf('RemoveInput')).toBeGreaterThan(sent.indexOf('StopRecord'));
		expect(obs.capturing()).toEqual([]);
		expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene']);
	});

	it('lets OBS keep a scene of the plugin’s that is its last scene, and says nothing of it', async () => {
		const { obs, clock, recorder, hooks, seen } = rig();
		await clock.drive(recorder.start(request(), hooks));
		// The author deleted every scene of their own meanwhile.
		obs.scenes = obs.scenes.filter((scene) => scene.name === OBS_SCENES.screen.scene);
		expect(await clock.drive(recorder.stop())).toEqual({ path: obs.recordPath, error: null });
		expect(obs.scenes.map((scene) => scene.name)).toEqual([OBS_SCENES.screen.scene]);
		// Its source went all the same: nothing captures on.
		expect(obs.capturing()).toEqual([]);
		expect(seen.notices).toEqual([]);
	});

	it('uses a source it could not take away rather than making it twice', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.inputs[OBS_SCENES.screen.input] = { kind: 'screen_capture', settings: {}, muted: false };
		obs.failNext('RemoveInput', 702);
		const started = await clock.drive(recorder.start(request(), hooks));
		expect(started.ok).toBe(true);
		expect(obs.types()).toContain('CreateSceneItem');
		expect(obs.inputs[OBS_SCENES.screen.input]?.settings).toMatchObject({ type: 0 });
	});

	it.each([
		['the folder', 'SetProfileParameter', 0],
		['the file name', 'SetProfileParameter', 1],
		['the scene', 'CreateScene', 0],
		['the source', 'CreateInput', 0],
		['the source’s settings', 'SetInputSettings', 0],
		['the scene on air', 'SetCurrentProgramScene', 0],
		['the recording itself', 'StartRecord', 0],
	] as const)('leaves OBS as it found it when %s is refused', async (_what, type, skip) => {
		const obs = new FakeObs();
		const { clock, recorder, hooks, ledger } = rig({ obs });
		const before = obs.borrowable();
		// The refusal is armed just as the request it is meant for comes up.
		let seenOfType = 0;
		const original = obs.receive.bind(obs);
		obs.receive = (socket, frame) => {
			if (frame.includes(`"requestType":"${type}"`)) {
				if (seenOfType === skip) obs.failNext(type, 702);
				seenOfType += 1;
			}
			original(socket, frame);
		};
		const started = await clock.drive(recorder.start(request({ quality: '1080p' }), hooks));
		expect(started.ok).toBe(false);
		expect(obs.recording).toBe(false);
		expect(obs.borrowable()).toEqual(before);
		expect(ledger.value).toBeNull();
		expect(recorder.owes).toBe(false);
	});

	it('does not believe a start OBS agreed to and never made', async () => {
		const { obs, clock, recorder, hooks, ledger } = rig();
		const before = obs.borrowable();
		obs.startsNothing = true;
		const started = await clock.drive(recorder.start(request(), hooks));
		expect(started).toEqual({ ok: false, code: 'obs-refused', detail: 'StartRecord' });
		expect(obs.borrowable()).toEqual(before);
		expect(ledger.value).toBeNull();
	});

	it('refuses to record a picture that is black all over', async () => {
		const { obs, clock, recorder, hooks } = rig();
		const before = obs.borrowable();
		obs.blank = true;
		expect(await clock.drive(recorder.start(request(), hooks))).toEqual({
			ok: false,
			code: 'obs-blank',
			detail: null,
		});
		expect(obs.types()).not.toContain('StartRecord');
		expect(obs.borrowable()).toEqual(before);
	});

	it('records a bare page of one flat colour: only black is a picture of nothing', async () => {
		const { obs, clock, recorder, hooks } = rig();
		// A new note in a window with nothing round it, in the dark theme's own ground.
		obs.flat = 30;
		expect((await clock.drive(recorder.start(request({ scope: 'obsidian' }), hooks))).ok).toBe(true);
		expect(obs.recording).toBe(true);
		// The look is fine enough to find what little a bare page shows.
		const shot = obs.calls.find((call) => call.type === 'GetSourceScreenshot');
		expect([shot?.data.imageWidth, shot?.data.imageHeight]).toEqual([64, 36]);
	});

	it('gives a source new on air a few looks to find its first frame', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.blank = true;
		const starting = recorder.start(request(), hooks);
		await clock.advance(1200);
		obs.blank = false;
		expect((await clock.drive(starting)).ok).toBe(true);
	});

	it('cannot tell a blank picture where OBS writes no bitmap, and records', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.blank = true;
		obs.formats = ['jpg', 'png'];
		expect((await clock.drive(recorder.start(request(), hooks))).ok).toBe(true);
	});

	it('leaves OBS’s own scene alone when asked to, and refuses one with nothing in it', async () => {
		const { obs, clock, recorder, hooks } = rig();
		expect(await clock.drive(recorder.start(request({ scope: 'obs' }), hooks))).toEqual({
			ok: false,
			code: 'obs-empty',
			detail: null,
		});
		obs.scenes[0]?.items.push({ id: 90, source: 'My capture' });
		const started = await clock.drive(recorder.start(request({ scope: 'obs' }), hooks));
		expect(started.ok).toBe(true);
		expect(obs.program).toBe('Scene');
		expect(obs.scenes).toHaveLength(1);
		// The author's own scene keeps the sound the author set for it.
		expect(obs.mutes['Mic/Aux']).toBe(false);
		expect(obs.types()).not.toContain('SetInputMute');
	});

	it('mutes only what is heard, and gives each back', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.special.mic2 = 'Second mic';
		obs.mutes['Second mic'] = false;
		await clock.drive(recorder.start(request(), hooks));
		expect(obs.calls.filter((call) => call.type === 'SetInputMute').map((call) => call.data.inputName)).toEqual([
			OBS_SCENES.screen.input,
			'Mic/Aux',
			'Second mic',
		]);
		expect(obs.mutes).toEqual({ 'Mic/Aux': true, 'Desktop Audio': true, 'Second mic': true });
		await clock.drive(recorder.stop());
		expect(obs.mutes).toEqual({ 'Mic/Aux': false, 'Desktop Audio': true, 'Second mic': false });
	});

	it('keeps the sound of its own source off, and owes OBS nothing for it', async () => {
		const { obs, clock, recorder, hooks, ledger } = rig();
		await clock.drive(recorder.start(request(), hooks));
		// macOS's screen capture brings the computer's sound with the picture.
		expect(obs.inputs[OBS_SCENES.screen.input]?.muted).toBe(true);
		expect(ledger.value?.loans.some((loan) => loan.kind === 'mute' && loan.input === OBS_SCENES.screen.input)).toBe(
			false,
		);
		await clock.drive(recorder.stop());
		// The source went with the recording, and the next recording's is muted from the first.
		expect(obs.inputs[OBS_SCENES.screen.input]).toBeUndefined();
		await clock.drive(recorder.start(request(), hooks));
		expect(obs.inputs[OBS_SCENES.screen.input]?.muted).toBe(true);
	});

	it('asks nothing more of a source that has no sound', async () => {
		const obs = new FakeObs();
		obs.loudKinds = [];
		const { clock, recorder, hooks } = rig({ obs });
		const started = await clock.drive(recorder.start(request(), hooks));
		expect(started.ok).toBe(true);
		expect(obs.calls.filter((call) => call.type === 'SetInputMute').map((call) => call.data.inputName)).toEqual([
			'Mic/Aux',
		]);
	});

	it.each([
		['its own source', OBS_SCENES.screen.input],
		['OBS’s microphone', 'Mic/Aux'],
	] as const)('makes no recording where %s cannot be muted', async (_what, input) => {
		const obs = new FakeObs();
		const { clock, recorder, hooks, ledger } = rig({ obs });
		const before = obs.borrowable();
		const original = obs.receive.bind(obs);
		obs.receive = (socket, frame) => {
			if (frame.includes('"requestType":"SetInputMute"') && frame.includes(JSON.stringify(input))) {
				obs.failNext('SetInputMute', 702);
			}
			original(socket, frame);
		};
		const started = await clock.drive(recorder.start(request(), hooks));
		expect(started).toMatchObject({ ok: false, code: 'obs-refused' });
		expect(obs.recording).toBe(false);
		expect(obs.borrowable()).toEqual(before);
		expect(ledger.value).toBeNull();
	});

	it('records at OBS’s own size when OBS will not change it, and says so', async () => {
		const { obs, clock, recorder, hooks, seen } = rig();
		obs.outputBusy = true;
		const started = await clock.drive(recorder.start(request({ quality: '1080p' }), hooks));
		expect(started.ok).toBe(true);
		expect(seen.notices).toEqual(['quality-kept']);
		expect(obs.video).toMatchObject({ outputWidth: 1280, outputHeight: 720 });
		await clock.drive(recorder.stop());
		expect(obs.video).toMatchObject({ outputWidth: 1280, outputHeight: 720 });
	});

	it('lowers the picture by its size alone, and never by how OBS compresses', async () => {
		for (const mode of ['Simple', 'Advanced']) {
			for (const quality of ['1080p', '720p'] as const) {
				const { obs, clock, recorder, hooks } = rig();
				obs.parameters['Output/Mode'] = mode;
				obs.video = { baseWidth: 3840, baseHeight: 2160, outputWidth: 3840, outputHeight: 2160 };
				const started = await clock.drive(recorder.start(request({ quality }), hooks));
				// The real OBS answers a start and records nothing once its compression was changed behind its back.
				expect(started.ok, `${mode} ${quality}`).toBe(true);
				expect(obs.recording).toBe(true);
				expect(obs.video.outputHeight).toBe(quality === '1080p' ? 1080 : 720);
				expect(obs.parameters['SimpleOutput/RecQuality']).toBe('Stream');
				const named = obs.calls
					.filter((call) => call.type === 'SetProfileParameter')
					.map((call) => String(call.data.parameterName));
				expect(named).not.toContain('RecQuality');
				await clock.drive(recorder.stop());
				expect(obs.video).toMatchObject({ outputWidth: 3840, outputHeight: 2160 });
			}
		}
	});

	it('gives its own scene a canvas the size of the screen, writes the picture as large, and gives both back', async () => {
		const { obs, clock, recorder, hooks, seen, ledger } = rig();
		const before = obs.borrowable();
		const started = await clock.drive(recorder.start(request({ quality: 'full' }), hooks));
		expect(started.ok).toBe(true);
		// The screen is 2560 by 1440 here: it is drawn pixel for pixel, and written so.
		expect(obs.video).toEqual({ baseWidth: 2560, baseHeight: 1440, outputWidth: 2560, outputHeight: 1440 });
		const item = obs.scenes.find((scene) => scene.name === OBS_SCENES.screen.scene)?.items[0];
		expect(item?.place).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
		expect(ledger.value?.loans.slice(-2)).toEqual([
			{ kind: 'canvas', profile: 'Untitled', before: { width: 1920, height: 1080 }, after: { width: 2560, height: 1440 } },
			{ kind: 'output-size', profile: 'Untitled', before: { width: 1280, height: 720 }, after: { width: 2560, height: 1440 } },
		]);
		expect(seen.notices).toEqual([]);
		await clock.drive(recorder.stop());
		expect(obs.borrowable()).toEqual(before);
		expect(ledger.value).toBeNull();
	});

	it('holds a screen larger than OBS takes to the most it takes, and never asks for more', async () => {
		for (const [quality, written] of [
			['full', [4096, 2304]],
			['1440p', [2560, 1440]],
			['1080p', [1920, 1080]],
			['720p', [1280, 720]],
		] as const) {
			const { obs, clock, recorder, hooks, seen } = rig();
			// A screen of 5120 by 2880, which OBS will not take from outside.
			obs.sourceSizes[MAIN_SCREEN] = { width: 5120, height: 2880 };
			const before = obs.borrowable();
			expect((await clock.drive(recorder.start(request({ quality }), hooks))).ok, quality).toBe(true);
			expect([obs.video.baseWidth, obs.video.baseHeight], quality).toEqual([4096, 2304]);
			expect([obs.video.outputWidth, obs.video.outputHeight], quality).toEqual(written);
			const sides = obs.calls
				.filter((call) => call.type === 'SetVideoSettings')
				.flatMap((call) => Object.values(call.data) as number[]);
			expect(Math.max(...sides), quality).toBeLessThanOrEqual(4096);
			expect(seen.notices, quality).toEqual([]);
			await clock.drive(recorder.stop());
			expect(obs.borrowable(), quality).toEqual(before);
		}
	});

	it('holds the shorter side to the quality asked, so a screen that stands tall is not made a sliver', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.sourceSizes[MAIN_SCREEN] = { width: 1440, height: 2560 };
		await clock.drive(recorder.start(request({ quality: '1080p' }), hooks));
		expect(obs.video).toEqual({ baseWidth: 1440, baseHeight: 2560, outputWidth: 1080, outputHeight: 1920 });
	});

	it('never writes a picture larger than what is recorded', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.sourceSizes[MAIN_SCREEN] = { width: 1280, height: 800 };
		await clock.drive(recorder.start(request({ quality: '1440p' }), hooks));
		expect(obs.video).toEqual({ baseWidth: 1280, baseHeight: 800, outputWidth: 1280, outputHeight: 800 });
	});

	it('leaves the author’s own canvas alone, and holds only the size OBS writes at', async () => {
		const { obs, clock, recorder, hooks, ledger } = rig();
		obs.scenes[0]?.items.push({ id: 90, source: 'My capture' });
		const before = obs.borrowable();
		await clock.drive(recorder.start(request({ scope: 'obs', quality: 'full' }), hooks));
		// The author's scene is laid out on their canvas: it stays, and the picture is written as large as it.
		expect(obs.video).toEqual({ baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080 });
		expect(ledger.value?.loans.map((loan) => loan.kind)).not.toContain('canvas');
		expect(obs.types()).not.toContain('GetSceneItemTransform');
		expect(obs.types()).not.toContain('SetSceneItemTransform');
		await clock.drive(recorder.stop());
		expect(obs.borrowable()).toEqual(before);
	});

	it('keeps every pixel of a window of an odd size, and fits a window it follows to the same part of the canvas', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.sourceSizes['4321'] = { width: 1513, height: 977 };
		await clock.drive(recorder.start(request({ scope: 'obsidian', quality: 'full' }), hooks));
		// The canvas is the next size up that OBS writes in, the window in its corner, nothing scaled.
		expect(obs.video).toEqual({ baseWidth: 1516, baseHeight: 978, outputWidth: 1516, outputHeight: 978 });
		const scene = (): { source: string; place?: unknown }[] =>
			obs.scenes.find((entry) => entry.name === OBS_SCENES.obsidian.scene)?.items ?? [];
		expect(scene().map((item) => item.place)).toEqual([{ x: 0, y: 0, width: 1513, height: 977 }]);
		recorder.follow(SIDE_WINDOW);
		await clock.advance(FOLLOW_WAIT_MS + SWAP_SETTLE_MS);
		expect(scene().map((item) => [item.source, item.place])).toEqual([
			[OBS_WINDOW_SPARE_INPUT, { x: 0, y: 0, width: 1513, height: 977 }],
		]);
		expect(obs.misplaced).toEqual([]);
	});

	it('lays every screen out on a canvas as large as the desk, counted in the sharpest screen’s pixels', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.sourceSizes[MAIN_SCREEN] = { width: 5120, height: 2880 };
		obs.sourceSizes[SIDE_SCREEN] = { width: 1440, height: 2560 };
		const before = obs.borrowable();
		await clock.drive(recorder.start(request({ scope: 'all', quality: 'full' }), hooks));
		// The desk is 4000 by 2560 points, 8000 by 5120 in the wide screen's pixels: brought down to what OBS takes.
		expect(obs.video).toEqual({ baseWidth: 4096, baseHeight: 2622, outputWidth: 4096, outputHeight: 2622 });
		const places = (obs.scenes.find((scene) => scene.name === OBS_SCENES.all.scene)?.items ?? []).map((item) => item.place);
		expect(places).toHaveLength(2);
		const [wide, tall] = places;
		// As they stand on the desk: the tall one on the left and from the top, the wide one beside it and lower.
		expect(tall?.x).toBeLessThan(wide?.x ?? 0);
		expect(tall?.y).toBeLessThan(wide?.y ?? 0);
		expect((wide?.width ?? 0) / (wide?.height ?? 1)).toBeCloseTo(2560 / 1440, 2);
		expect((tall?.width ?? 0) / (tall?.height ?? 1)).toBeCloseTo(1440 / 2560, 2);
		for (const place of places) {
			expect((place?.x ?? -1) >= 0 && (place?.x ?? 0) + (place?.width ?? 0) <= 4096.01).toBe(true);
			expect((place?.y ?? -1) >= 0 && (place?.y ?? 0) + (place?.height ?? 0) <= 2621.01).toBe(true);
		}
		await clock.drive(recorder.stop());
		expect(obs.borrowable()).toEqual(before);
	});

	it('waits for a source’s first picture to learn its size, and leaves the canvas alone where none comes', async () => {
		const late = rig();
		late.obs.sizesLate = 3;
		await late.clock.drive(late.recorder.start(request({ quality: 'full' }), late.hooks));
		expect(late.obs.video).toMatchObject({ baseWidth: 2560, baseHeight: 1440 });

		const never = rig();
		never.obs.sizesLate = 1000;
		const started = await never.clock.drive(never.recorder.start(request({ quality: '1080p' }), never.hooks));
		// The recording is made all the same, on the canvas as it stood.
		expect(started.ok).toBe(true);
		expect(never.obs.video).toEqual({ baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080 });
		expect(never.ledger.value?.loans.map((loan) => loan.kind)).not.toContain('canvas');
		expect(never.seen.notices).toEqual([]);
	});

	it('counts the author in once everything is ready, and asks for the recording only when the count has run out', async () => {
		const { obs, clock, recorder, hooks, seen } = rig();
		let ready: string[] = [];
		let finish: (ran: boolean) => void = () => {};
		seen.count = () => {
			ready = obs.types();
			return new Promise((resolve) => {
				finish = resolve;
			});
		};
		const starting = recorder.start(request({ quality: '1080p' }), hooks);
		await clock.advance(5000);
		// Everything asked of OBS is asked, its picture looked at, and nothing records while the count runs.
		expect(seen.held).toBe(1);
		expect(ready).toContain('GetSourceScreenshot');
		expect(ready.filter((type) => type === 'SetVideoSettings')).toHaveLength(2);
		expect(obs.types()).not.toContain('StartRecord');
		expect(obs.recording).toBe(false);
		finish(true);
		expect((await clock.drive(starting)).ok).toBe(true);
		expect(obs.types().slice(-2)).toContain('StartRecord');
		expect(obs.recording).toBe(true);
	});

	it('gives everything back and leaves nothing of its own where the author stops the count', async () => {
		const { obs, clock, recorder, hooks, seen, ledger } = rig();
		const before = obs.borrowable();
		seen.count = () => Promise.resolve(false);
		expect(await clock.drive(recorder.start(request({ quality: 'full' }), hooks))).toEqual({
			ok: false,
			code: 'cancelled',
			detail: null,
		});
		expect(obs.types()).not.toContain('StartRecord');
		expect(obs.borrowable()).toEqual(before);
		expect([obs.scenes.map((scene) => scene.name), obs.capturing(), obs.program]).toEqual([['Scene'], [], 'Scene']);
		expect(ledger.value).toBeNull();
		// And the next start is a start like any other.
		seen.count = () => Promise.resolve(true);
		expect((await clock.drive(recorder.start(request(), hooks))).ok).toBe(true);
	});

	it('borrows the folder under the advanced output’s own key and leaves its compression alone', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.parameters['Output/Mode'] = 'Advanced';
		await clock.drive(recorder.start(request({ quality: '1080p' }), hooks));
		expect(obs.parameters['AdvOut/RecFilePath']).toBe('/Users/ada/Proof');
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('/Users/ada/Movies');
		expect(obs.parameters['SimpleOutput/RecQuality']).toBe('Stream');
		await clock.drive(recorder.stop());
		expect(obs.parameters['AdvOut/RecFilePath']).toBe('/Users/ada/Movies');
	});

	it('leaves what the author changed in OBS during the recording', async () => {
		const { obs, clock, recorder, hooks, ledger } = rig();
		await clock.drive(recorder.start(request(), hooks));
		obs.parameters['SimpleOutput/FilePath'] = '/Volumes/Elsewhere';
		obs.program = 'Scene';
		await clock.drive(recorder.stop());
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('/Volumes/Elsewhere');
		expect(obs.program).toBe('Scene');
		// Everything else went back, and nothing is owed.
		expect(obs.parameters['Output/FilenameFormatting']).toBe('%CCYY-%MM-%DD %hh-%mm-%ss');
		expect(obs.mutes['Mic/Aux']).toBe(false);
		expect(ledger.value).toBeNull();
	});

	it('waits for OBS to close the file before it gives anything back', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request({ quality: '1080p' }), hooks));
		obs.stopsLate = 3;
		const stopping = recorder.stop();
		await clock.advance(1500);
		// Still writing: the size it writes at has not been touched.
		expect(obs.video).toMatchObject({ outputWidth: 1920, outputHeight: 1080 });
		await clock.drive(stopping);
		expect(obs.video).toMatchObject({ outputWidth: 1280, outputHeight: 720 });
	});

	it('keeps what OBS would not take back, says so, and settles it at the next conversation', async () => {
		const { obs, clock, recorder, hooks, seen, ledger, again } = rig();
		await clock.drive(recorder.start(request(), hooks));
		// The microphone is the first thing given back, and OBS will not take it this once.
		obs.failNext('SetInputMute', 500);
		await clock.drive(recorder.stop());
		expect(obs.mutes['Mic/Aux']).toBe(true);
		expect(seen.notices).toEqual(['return-pending']);
		expect(ledger.value?.loans).toEqual([{ kind: 'mute', input: 'Mic/Aux', before: false, after: true }]);
		// A plugin started afresh reads the ledger and finishes the job on a look at OBS.
		const next = again();
		expect(next.owes).toBe(true);
		const probe = await clock.drive(next.probe({ port: 4455, password: null, scope: 'obs', mayOpen: false }));
		expect(probe.ok).toBe(true);
		expect(obs.mutes['Mic/Aux']).toBe(false);
		expect(next.owes).toBe(false);
		expect(ledger.value).toBeNull();
	});

	it('takes its scene out of OBS even where OBS would not go back to the author’s', async () => {
		const { obs, clock, recorder, hooks, ledger, again } = rig();
		await clock.drive(recorder.start(request(), hooks));
		obs.failNext('SetCurrentProgramScene', 500);
		await clock.drive(recorder.stop());
		// OBS goes to a scene of the author's by itself once the plugin's is gone.
		expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene']);
		expect(obs.program).toBe('Scene');
		// The loan is let go at the next conversation: OBS no longer holds what the plugin left.
		const next = again();
		await clock.drive(next.probe({ port: 4455, password: null, scope: 'obs', mayOpen: false }));
		expect(ledger.value).toBeNull();
	});

	it('keeps the first value written down when it borrows again over an unsettled loan', async () => {
		const { obs, clock, recorder, hooks, ledger } = rig();
		await clock.drive(recorder.start(request(), hooks));
		// OBS will not take the file name back at the stop, nor when the next start tries to settle it.
		obs.failNext('SetProfileParameter', 500);
		await clock.drive(recorder.stop());
		expect(obs.parameters['Output/FilenameFormatting']).toBe('%CCYY-%MM-%DD %hh.%mm.%ss');
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('/Users/ada/Movies');
		obs.failNext('SetProfileParameter', 500);
		await clock.drive(recorder.start(request(), hooks));
		const name = ledger.value?.loans.find((loan) => loan.kind === 'parameter' && loan.name === 'FilenameFormatting');
		expect(name).toMatchObject({
			before: '%CCYY-%MM-%DD %hh-%mm-%ss',
			after: '%CCYY-%MM-%DD %hh.%mm.%ss',
		});
		await clock.drive(recorder.stop());
		expect(obs.parameters['Output/FilenameFormatting']).toBe('%CCYY-%MM-%DD %hh-%mm-%ss');
		expect(ledger.value).toBeNull();
	});

	it('holds a setting back until the profile it was borrowed from is in use again', async () => {
		const { obs, clock, recorder, hooks, ledger } = rig();
		await clock.drive(recorder.start(request(), hooks));
		obs.profile = 'Streaming';
		await clock.drive(recorder.stop());
		// The settings read the same in this stand-in, but they are another profile's now.
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('/Users/ada/Proof');
		expect(ledger.value?.loans.map((loan) => loan.kind)).toEqual(['parameter', 'parameter']);
		expect(obs.program).toBe('Scene');
		obs.profile = 'Untitled';
		await clock.drive(recorder.probe({ port: 4455, password: null, scope: 'obs', mayOpen: false }));
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('/Users/ada/Movies');
		expect(ledger.value).toBeNull();
	});

	it('changes nothing in an OBS that is already recording something of its own', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.recording = true;
		expect(await clock.drive(recorder.start(request(), hooks))).toEqual({
			ok: false,
			code: 'obs-recording',
			detail: null,
		});
		expect(obs.writes()).toEqual([]);
		expect(obs.recording).toBe(true);
	});

	it('takes up a recording an earlier run of the plugin left in OBS', async () => {
		const first = rig();
		await first.clock.drive(first.recorder.start(request(), first.hooks));
		// The plugin goes away without a word; OBS records on.
		const before = first.obs.writes().length;
		first.obs.duration = 90_000;
		const second = rig({ obs: first.obs, ledger: first.ledger.value });
		const started = await second.clock.drive(second.recorder.start(request(), second.hooks));
		expect(started).toEqual({ ok: true, startedAt: second.clock.now - 90_000, path: null });
		expect(first.obs.writes()).toHaveLength(before);
		// It records already: there is nothing to count the author in for.
		expect(second.seen.held).toBe(0);
		await second.clock.drive(second.recorder.stop());
		expect(first.obs.recording).toBe(false);
		expect(first.obs.program).toBe('Scene');
		expect(first.obs.parameters['SimpleOutput/FilePath']).toBe('/Users/ada/Movies');
		expect(second.ledger.value).toBeNull();
	});

	it('follows a recording stopped in OBS itself, and gives back what it borrowed', async () => {
		const { obs, clock, recorder, hooks, seen, ledger } = rig();
		const before = obs.borrowable();
		await clock.drive(recorder.start(request(), hooks));
		obs.stopFromInside();
		await clock.advance(100);
		expect(seen.ended).toEqual([{ reason: 'external', path: obs.recordPath, error: null }]);
		expect(obs.borrowable()).toEqual(before);
		expect(ledger.value).toBeNull();
		// Nothing is left to stop.
		expect(await clock.drive(recorder.stop())).toEqual({ path: null, error: null });
	});

	it('notices on its own rounds a recording that ended without a word', async () => {
		const { obs, clock, recorder, hooks, seen } = rig();
		await clock.drive(recorder.start(request(), hooks));
		obs.recording = false;
		await clock.advance(5200);
		expect(seen.ended).toHaveLength(1);
		expect(seen.ended[0]?.reason).toBe('external');
	});

	it('tells how large the file has grown on its rounds', async () => {
		const { obs, clock, recorder, hooks, seen } = rig();
		await clock.drive(recorder.start(request(), hooks));
		obs.bytes = 4_000_000;
		await clock.advance(5200);
		obs.bytes = 9_000_000;
		await clock.advance(5000);
		expect(seen.bytes).toEqual([4_000_000, 9_000_000]);
		expect(seen.ended).toEqual([]);
	});

	it('ends with OBS when OBS quits, and keeps the ledger for its return', async () => {
		const { obs, clock, recorder, hooks, seen, ledger } = rig();
		await clock.drive(recorder.start(request(), hooks));
		obs.emit('ExitStarted');
		await clock.advance(100);
		expect(seen.ended).toEqual([{ reason: 'external', path: obs.recordPath, error: null }]);
		expect(seen.notices).toEqual(['return-pending']);
		expect(ledger.value?.loans.length).toBeGreaterThan(0);
	});

	it('finds OBS again after the conversation dropped, and goes on', async () => {
		const { obs, clock, recorder, hooks, seen } = rig();
		await clock.drive(recorder.start(request(), hooks));
		const before = obs.conversations;
		obs.drop();
		await clock.advance(3500);
		expect(obs.conversations).toBe(before + 1);
		expect(seen.ended).toEqual([]);
		obs.bytes = 7;
		await clock.advance(5200);
		expect(seen.bytes).toEqual([7]);
		expect(await clock.drive(recorder.stop())).toEqual({ path: obs.recordPath, error: null });
	});

	it('gives the recording up as lost when OBS never comes back', async () => {
		const { obs, clock, recorder, hooks, seen, ledger, opened } = rig();
		await clock.drive(recorder.start(request({ mayOpen: true }), hooks));
		obs.closed = true;
		obs.drop();
		await clock.advance(20_000);
		expect(seen.ended).toEqual([{ reason: 'lost', path: null, error: 'obs-lost' }]);
		// A lost OBS is never opened again behind the author's back.
		expect(opened.count).toBe(0);
		expect(ledger.value?.loans.length).toBeGreaterThan(0);
	});

	it('finds the recording over when it gets OBS back', async () => {
		const { obs, clock, recorder, hooks, seen } = rig();
		const before = obs.borrowable();
		await clock.drive(recorder.start(request(), hooks));
		obs.recording = false;
		obs.drop();
		await clock.advance(4000);
		expect(seen.ended).toEqual([{ reason: 'external', path: obs.recordPath, error: null }]);
		expect(obs.borrowable()).toEqual(before);
	});

	it('names the cause when OBS does not let it in', async () => {
		const closed = rig();
		closed.obs.closed = true;
		expect(await closed.clock.drive(closed.recorder.start(request(), closed.hooks))).toEqual({
			ok: false,
			code: 'obs-closed',
			detail: null,
		});
		expect(closed.opened.count).toBe(0);
		const locked = rig();
		locked.obs.password = FAKE_OBS_PASSWORD;
		expect(await locked.clock.drive(locked.recorder.start(request(), locked.hooks))).toMatchObject({
			code: 'obs-password',
		});
		expect(
			await locked.clock.drive(locked.recorder.start(request({ password: 'wrong' }), locked.hooks)),
		).toMatchObject({ code: 'obs-password' });
		expect(
			(await locked.clock.drive(locked.recorder.start(request({ password: FAKE_OBS_PASSWORD }), locked.hooks))).ok,
		).toBe(true);
	});

	it('opens OBS when it may, and asks again until OBS answers', async () => {
		const { obs, clock, recorder, hooks, seen, opened } = rig();
		obs.closed = true;
		const starting = recorder.start(request({ mayOpen: true }), hooks);
		await clock.advance(4000);
		expect(opened.count).toBe(1);
		expect(seen.phases).toEqual(['opening']);
		obs.closed = false;
		expect((await clock.drive(starting)).ok).toBe(true);
		expect(seen.phases).toEqual(['opening', 'starting']);
	});

	it('waits half a minute for an OBS it opened, and no longer', async () => {
		const { obs, clock, recorder, hooks, opened } = rig();
		obs.closed = true;
		const starting = recorder.start(request({ mayOpen: true }), hooks);
		await clock.advance(29_000);
		let settled = false;
		void starting.then(() => {
			settled = true;
		});
		await clock.settle();
		expect(settled).toBe(false);
		expect(await clock.drive(starting)).toEqual({ ok: false, code: 'obs-closed', detail: null });
		expect(clock.now).toBeLessThan(1_000_000 + 40_000);
		expect(opened.count).toBe(1);
	});

	it('says OBS is closed where it could not be opened at all', async () => {
		const { obs, clock, recorder, hooks, opened } = rig();
		obs.closed = true;
		opened.works = false;
		expect(await clock.drive(recorder.start(request({ mayOpen: true }), hooks))).toEqual({
			ok: false,
			code: 'obs-closed',
			detail: null,
		});
	});

	it('gives the wait up when the author does', async () => {
		const { obs, clock, recorder, hooks, seen } = rig();
		obs.closed = true;
		const starting = recorder.start(request({ mayOpen: true }), hooks);
		await clock.advance(2000);
		seen.cancel = true;
		expect(await clock.drive(starting)).toEqual({ ok: false, code: 'cancelled', detail: null });
		expect(obs.writes()).toEqual([]);
	});

	it('gives back what it borrowed when the author gives the start up half way', async () => {
		const obs = new FakeObs();
		const { clock, recorder, hooks, seen } = rig({ obs });
		const before = obs.borrowable();
		const original = obs.receive.bind(obs);
		obs.receive = (socket, frame) => {
			if (frame.includes('"GetSourceScreenshot"')) seen.cancel = true;
			original(socket, frame);
		};
		expect(await clock.drive(recorder.start(request(), hooks))).toEqual({
			ok: false,
			code: 'cancelled',
			detail: null,
		});
		expect(obs.types()).not.toContain('StartRecord');
		expect(obs.borrowable()).toEqual(before);
	});

	it('asks again while a freshly opened OBS says it is not ready', async () => {
		const { obs, clock, recorder, hooks } = rig();
		obs.notReady = 3;
		expect((await clock.drive(recorder.start(request(), hooks))).ok).toBe(true);
		expect(obs.types().filter((type) => type === 'GetVersion')).toHaveLength(4);
	});

	it('leaves the scene to OBS where it knows no source to make', async () => {
		const wayland = rig({ system: 'linux' });
		wayland.obs.kinds = ['pipewire-screen-capture-source'];
		const before = wayland.obs.borrowable();
		expect(await wayland.clock.drive(wayland.recorder.start(request(), wayland.hooks))).toEqual({
			ok: false,
			code: 'obs-scene',
			detail: null,
		});
		expect(wayland.obs.borrowable()).toEqual(before);
		expect(wayland.obs.types()).not.toContain('CreateScene');
	});

	it('refuses where OBS lists no window of Obsidian’s to capture', async () => {
		const windows = rig({ system: 'win' });
		windows.obs.kinds = ['monitor_capture', 'window_capture'];
		windows.obs.lists.window = [
			{ itemName: '[chrome.exe]: Tab', itemEnabled: true, itemValue: 'Tab:Chrome_WidgetWin_1:chrome.exe' },
		];
		const before = windows.obs.borrowable();
		expect(
			await windows.clock.drive(windows.recorder.start(request({ scope: 'obsidian' }), windows.hooks)),
		).toMatchObject({ ok: false, code: 'obs-scene' });
		expect(windows.obs.borrowable()).toEqual(before);
		windows.obs.lists.window = [
			{ itemName: '[Obsidian.exe]: Draft', itemEnabled: true, itemValue: 'Draft:Chrome_WidgetWin_1:Obsidian.exe' },
		];
		expect(
			(await windows.clock.drive(windows.recorder.start(request({ scope: 'obsidian' }), windows.hooks))).ok,
		).toBe(true);
		expect(windows.obs.inputs[OBS_SCENES.obsidian.input]?.settings).toMatchObject({
			priority: 2,
			window: 'Draft:Chrome_WidgetWin_1:Obsidian.exe',
		});
	});

	it('asks OBS to stop without waiting when the plugin goes this instant, and keeps the ledger', async () => {
		const { obs, clock, recorder, hooks, ledger, again } = rig();
		await clock.drive(recorder.start(request(), hooks));
		recorder.abandon();
		await clock.settle();
		expect(obs.recording).toBe(false);
		// Its scene went with it, so OBS is on a scene of the author's again and nothing captures on.
		expect(obs.program).toBe('Scene');
		expect(obs.capturing()).toEqual([]);
		// The rest of what was borrowed is still written down.
		expect(ledger.value?.loans.length).toBeGreaterThan(0);
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('/Users/ada/Proof');
		// Nothing of the gone recorder still turns.
		await clock.advance(30_000);
		expect(obs.types().filter((type) => type === 'GetRecordStatus').length).toBeLessThan(4);
		// The next plugin gives everything back on its first start.
		const next = again();
		await clock.drive(next.start(request(), hooks));
		await clock.drive(next.stop());
		expect(obs.program).toBe('Scene');
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('/Users/ada/Movies');
		expect(ledger.value).toBeNull();
	});

	it('gives a quitting Obsidian three seconds of OBS, then leaves the rest to the ledger', async () => {
		const { obs, clock, recorder, hooks, ledger } = rig();
		await clock.drive(recorder.start(request(), hooks));
		obs.stopsLate = 30;
		const from = clock.now;
		await clock.drive(recorder.settle());
		expect(clock.now - from).toBeLessThan(6000);
		expect(obs.recording).toBe(false);
		expect(ledger.value?.loans.length).toBeGreaterThan(0);
	});

	it('will not start twice at once', async () => {
		const { clock, recorder, hooks } = rig();
		const first = recorder.start(request(), hooks);
		expect(await recorder.start(request(), hooks)).toEqual({ ok: false, code: 'obs-recording', detail: null });
		expect((await clock.drive(first)).ok).toBe(true);
		expect(await recorder.start(request(), hooks)).toEqual({ ok: false, code: 'obs-recording', detail: null });
	});
});

describe('an OBS busy with something of the author’s own', () => {
	const mute = { kind: 'mute', input: 'Mic/Aux', before: false, after: true } as const;

	it('puts no scene of its own on air while OBS is live on another output, and moves nothing', async () => {
		for (const live of ['streaming', 'virtualCamera', 'replayBuffer'] as const) {
			const { obs, clock, recorder, hooks, ledger } = rig();
			obs[live] = true;
			const before = obs.borrowable();
			for (const scope of ['screen', 'all', 'obsidian'] as const) {
				expect(
					await clock.drive(recorder.start(request({ scope, quality: '1080p' }), hooks)),
					`${live} ${scope}`,
				).toEqual({ ok: false, code: 'obs-live', detail: null });
			}
			// Nothing was changed, made or muted: what goes out live goes on as it was.
			expect(obs.writes()).toEqual([]);
			expect(obs.borrowable()).toEqual(before);
			expect(ledger.value).toBeNull();
		}
	});

	it('records OBS’s own scene while OBS streams, as the stream shows it, at OBS’s own size', async () => {
		const { obs, clock, recorder, hooks, seen } = rig();
		obs.streaming = true;
		obs.scenes[0]?.items.push({ id: 7, source: 'The author’s own capture' });
		const started = await clock.drive(recorder.start(request({ scope: 'obs', quality: '1080p' }), hooks));
		expect(started.ok).toBe(true);
		// The scene on air and what OBS hears are the stream's, and stay as they are.
		expect(obs.program).toBe('Scene');
		expect(obs.mutes).toEqual({ 'Mic/Aux': false, 'Desktop Audio': true });
		expect(obs.writes()).not.toContain('SetCurrentProgramScene');
		expect(obs.writes()).not.toContain('SetInputMute');
		// OBS changes no size while it streams, and the author is told.
		expect(seen.notices).toEqual(['quality-kept']);
		await clock.drive(recorder.stop());
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('/Users/ada/Movies');
	});

	it('asks of each output by its own name, and takes one OBS has none of as not running', async () => {
		// A replay buffer that is there and off, and one that is not there at all, stand in nobody's way.
		const off = rig();
		off.obs.replayBuffer = false;
		expect((await off.clock.drive(off.recorder.start(request(), off.hooks))).ok).toBe(true);
		const none = rig();
		expect((await none.clock.drive(none.recorder.start(request(), none.hooks))).ok).toBe(true);
		expect(none.obs.types()).toEqual(expect.arrayContaining(['GetStreamStatus', 'GetVirtualCamStatus', 'GetReplayBufferStatus']));
		// An OBS that answers none of the three is taken as not live, and records.
		const old = rig();
		for (const type of ['GetStreamStatus', 'GetVirtualCamStatus', 'GetReplayBufferStatus']) old.obs.failNext(type, 204);
		expect((await old.clock.drive(old.recorder.start(request(), old.hooks))).ok).toBe(true);
	});

	it('never asks OBS for the list of its outputs, which ends an OBS whose video was set anew', async () => {
		const { obs, clock, recorder, hooks } = rig();
		// A recording that borrows a size sets OBS's video anew, twice over, and gives it back the same way.
		await clock.drive(recorder.start(request({ quality: '1080p' }), hooks));
		await clock.drive(recorder.stop());
		expect(obs.videoResets).toBeGreaterThan(1);
		// The next look and the next start ask whether OBS is live elsewhere, and OBS is still there after both.
		expect(await clock.drive(recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: false }))).toMatchObject({
			ok: true,
			problem: null,
		});
		expect((await clock.drive(recorder.start(request({ quality: '720p' }), hooks))).ok).toBe(true);
		expect(obs.types()).not.toContain('GetOutputList');
		expect(obs.crashed).toBe(false);
	});

	it('shows what asking for that list would cost: the scripted OBS falls over as the real one does', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request({ quality: '1080p' }), hooks));
		await clock.drive(recorder.stop());
		const socket = new ObsSocket({ open: obs.open, timers: clock.timers, mint: () => 'direct' });
		await clock.drive(socket.connect(4455, null));
		const answer = await clock.drive(socket.call('GetOutputList'));
		expect(answer.ok).toBe(false);
		expect(obs.crashed).toBe(true);
	});

	it('gives nothing back under a live output either, and settles the ledger once OBS is quiet', async () => {
		const { obs, clock, recorder, hooks, ledger } = rig({ ledger: { version: 1, loans: [mute] } });
		obs.mutes['Mic/Aux'] = true;
		obs.streaming = true;
		expect(await clock.drive(recorder.start(request(), hooks))).toMatchObject({ ok: false, code: 'obs-live' });
		// The microphone an earlier run muted stays muted on the stream: this is not the moment to move it.
		expect(obs.mutes['Mic/Aux']).toBe(true);
		expect(ledger.value?.loans).toEqual([mute]);
		obs.streaming = false;
		expect((await clock.drive(recorder.start(request(), hooks))).ok).toBe(true);
		await clock.drive(recorder.stop());
		expect(obs.mutes['Mic/Aux']).toBe(false);
		expect(ledger.value).toBeNull();
	});

	it('never takes up a recording the author began in OBS, whatever the ledger still holds', async () => {
		const { obs, clock, recorder, hooks, ledger } = rig({ ledger: { version: 1, loans: [mute] } });
		obs.mutes['Mic/Aux'] = true;
		obs.recording = true;
		expect(await clock.drive(recorder.start(request(), hooks))).toEqual({
			ok: false,
			code: 'obs-recording',
			detail: null,
		});
		// Their recording goes on untouched: not stopped, and nothing given back under it.
		expect(obs.writes()).toEqual([]);
		expect(obs.recording).toBe(true);
		expect(ledger.value?.loans).toEqual([mute]);
		// A look says the same, and moves nothing either.
		const probe = await clock.drive(recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: false }));
		expect(probe).toMatchObject({ ok: true, problem: 'obs-recording' });
		expect(obs.writes()).toEqual([]);
	});

	it('takes up its own recording even where it borrowed nothing for it', async () => {
		const first = rig();
		// OBS already records where the plugin wants, under the name it wants, and its own scene is recorded.
		first.obs.parameters['SimpleOutput/FilePath'] = '/Users/ada/Proof';
		first.obs.parameters['Output/FilenameFormatting'] = '%CCYY-%MM-%DD %hh.%mm.%ss';
		first.obs.scenes[0]?.items.push({ id: 7, source: 'The author’s own capture' });
		await first.clock.drive(first.recorder.start(request({ scope: 'obs' }), first.hooks));
		expect(first.ledger.value).toEqual({ version: 1, loans: [], recording: true });
		// The plugin goes away without a word, and comes back.
		const second = rig({ obs: first.obs, ledger: first.ledger.value });
		expect((await second.clock.drive(second.recorder.start(request({ scope: 'obs' }), second.hooks))).ok).toBe(true);
		expect(second.seen.held).toBe(0);
		// A look at it finds nothing in the way: the recording is the plugin's own.
		await second.clock.drive(second.recorder.stop());
		expect(first.obs.recording).toBe(false);
		expect(second.ledger.value).toBeNull();
	});

	it('strikes its mark out once OBS is seen not to record: after a stop, a stop in OBS, or OBS quitting', async () => {
		const stopped = rig();
		await stopped.clock.drive(stopped.recorder.start(request(), stopped.hooks));
		expect(stopped.ledger.value?.recording).toBe(true);
		await stopped.clock.drive(stopped.recorder.stop());
		expect(stopped.ledger.value).toBeNull();

		const inside = rig();
		await inside.clock.drive(inside.recorder.start(request(), inside.hooks));
		inside.obs.stopFromInside();
		await inside.clock.advance(1000);
		expect(inside.ledger.value).toBeNull();

		const quit = rig();
		await quit.clock.drive(quit.recorder.start(request(), quit.hooks));
		quit.obs.emit('ExitStarted');
		await quit.clock.advance(100);
		// What was borrowed waits for OBS to come back. The recording does not: it ended with OBS.
		expect(quit.ledger.value?.loans.length).toBeGreaterThan(0);
		expect(quit.ledger.value?.recording).toBeUndefined();
		// So a recording the author begins in the OBS they open again is theirs.
		const next = quit.again();
		expect(await quit.clock.drive(next.start(request(), quit.hooks))).toMatchObject({ ok: false, code: 'obs-recording' });
		expect(quit.obs.recording).toBe(true);
	});

	it('keeps its mark where OBS was lost under a recording, and takes that recording up when OBS answers again', async () => {
		const { obs, clock, recorder, hooks, seen, ledger, again } = rig();
		await clock.drive(recorder.start(request(), hooks));
		obs.closed = true;
		obs.drop();
		await clock.advance(20_000);
		expect(seen.ended).toEqual([{ reason: 'lost', path: null, error: 'obs-lost' }]);
		expect(ledger.value?.recording).toBe(true);
		obs.closed = false;
		const next = again();
		expect((await clock.drive(next.start(request(), hooks))).ok).toBe(true);
		expect(await clock.drive(next.stop())).toMatchObject({ error: null });
		expect(obs.recording).toBe(false);
		expect(obs.program).toBe('Scene');
		expect(ledger.value).toBeNull();
	});
});

describe('a stop OBS may not have heard', () => {
	it('says the recording was lost where the stop never reached OBS', async () => {
		const { obs, clock, recorder, hooks, seen, ledger } = rig();
		await clock.drive(recorder.start(request(), hooks));
		// The conversation drops, and the author stops before OBS is found again.
		obs.closed = true;
		obs.drop();
		await clock.advance(500);
		expect(await clock.drive(recorder.stop())).toEqual({ path: null, error: 'obs-lost' });
		// OBS was told nothing and records on. The ledger keeps what is still borrowed, and whose recording it is.
		expect(obs.recording).toBe(true);
		expect(seen.notices).toEqual(['return-pending']);
		expect(ledger.value?.recording).toBe(true);
		expect(ledger.value?.loans.length).toBeGreaterThan(0);
	});

	it('gives up on an OBS that says nothing to a stop, and leaves the scene it records where it is', async () => {
		const { obs, clock, recorder, hooks } = rig();
		await clock.drive(recorder.start(request(), hooks));
		obs.silent = true;
		const from = clock.now;
		const asked = obs.types().length;
		expect(await clock.drive(recorder.stop())).toEqual({ path: null, error: 'obs-lost' });
		// One stop and two looks, each given its time, and never the whole minute of a stop OBS took.
		expect(clock.now - from).toBeLessThan(40_000);
		expect(obs.types().slice(asked)).toEqual(['StopRecord', 'GetRecordStatus', 'GetRecordStatus']);
		expect(obs.program).toBe(OBS_SCENES.screen.scene);
	});

	it('tells a stop OBS took as a stop, even where the file is not closed in time', async () => {
		const { obs, clock, recorder, hooks, seen } = rig();
		await clock.drive(recorder.start(request(), hooks));
		obs.stopsLate = 90;
		expect(await clock.drive(recorder.stop())).toEqual({ path: obs.recordPath, error: null });
		expect(seen.notices).toEqual(['return-pending']);
		// Its picture is of no use any more: the scene went with the stop.
		expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene']);
	});

	it('answers nothing to a stop while the recording is already ending by itself, and lets that end name the file', async () => {
		const { obs, clock, recorder, hooks, seen } = rig();
		await clock.drive(recorder.start(request(), hooks));
		// OBS is slow to answer while the plugin gives back what it borrowed.
		obs.holdNext('GetProfileList');
		obs.stopFromInside();
		await clock.settle();
		expect(seen.ended).toEqual([]);
		// The author presses stop in that moment: there is nothing left to stop, and nothing to say yet.
		expect(await recorder.stop()).toBeNull();
		obs.release();
		await clock.settle();
		expect(seen.ended).toEqual([{ reason: 'external', path: obs.recordPath, error: null }]);
		expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene']);
	});
});

describe('a plugin that goes while OBS is being asked', () => {
	it('lets a start under way end by itself, and gives everything back first', async () => {
		const { obs, clock, recorder, hooks, seen, ledger } = rig();
		const before = obs.borrowable();
		let finish: (ran: boolean) => void = () => {};
		seen.count = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const starting = recorder.start(request({ quality: '1080p' }), hooks);
		await clock.advance(5000);
		expect(seen.held).toBe(1);
		// Everything is borrowed by now, and the plugin's scene is on air.
		expect(obs.program).toBe(OBS_SCENES.screen.scene);
		expect(obs.mutes['Mic/Aux']).toBe(true);
		recorder.abandon();
		// The service ends the count as it goes.
		seen.cancel = true;
		finish(false);
		expect(await clock.drive(starting)).toEqual({ ok: false, code: 'cancelled', detail: null });
		expect(obs.types()).not.toContain('StartRecord');
		expect(obs.borrowable()).toEqual(before);
		expect([obs.scenes.map((scene) => scene.name), obs.capturing()]).toEqual([['Scene'], []]);
		expect(ledger.value).toBeNull();
	});

	it('ends a recording that began only after the plugin had gone', async () => {
		const { obs, clock, recorder, hooks, ledger } = rig();
		const before = obs.borrowable();
		// OBS takes the start, and its answer is still on its way when the plugin goes.
		obs.holdNext('StartRecord');
		const starting = recorder.start(request(), hooks);
		await clock.advance(5000);
		expect(obs.recording).toBe(true);
		recorder.abandon();
		obs.release();
		expect(await clock.drive(starting)).toEqual({ ok: false, code: 'cancelled', detail: null });
		expect(obs.recording).toBe(false);
		expect(obs.borrowable()).toEqual(before);
		expect(ledger.value).toBeNull();
	});

	it('lets a look under way end by itself too, with nothing of its own left in OBS', async () => {
		const { obs, clock, recorder } = rig();
		const before = obs.borrowable();
		obs.holdNext('GetSourceScreenshot');
		const looking = recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: false });
		await clock.advance(2000);
		// The plugin's scene is on air for the look.
		expect(obs.program).toBe(OBS_SCENES.screen.scene);
		recorder.abandon();
		obs.release();
		await clock.drive(looking);
		expect(obs.borrowable()).toEqual(before);
		expect([obs.scenes.map((scene) => scene.name), obs.capturing()]).toEqual([['Scene'], []]);
	});

	it('opens no OBS and makes no scene for a look once the plugin has gone', async () => {
		const { obs, clock, recorder, opened } = rig();
		obs.closed = true;
		const looking = recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: true });
		await clock.advance(4000);
		expect(opened.count).toBe(1);
		recorder.abandon();
		obs.closed = false;
		expect(await clock.drive(looking)).toEqual({ ok: false, code: 'obs-closed' });
		expect(obs.writes()).toEqual([]);
	});
});

describe('a look at OBS', () => {
	it('says which OBS answered and shows what it would record, and leaves the scene as it was', async () => {
		const { obs, clock, recorder } = rig();
		const before = obs.borrowable();
		const probe = await clock.drive(recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: false }));
		expect(probe).toEqual({
			ok: true,
			version: '33.0.1',
			picture: 'data:image/jpg;base64,AAAA',
			problem: null,
		});
		// The plugin's scene was on air for the look, and is off again.
		expect(obs.types()).toContain('SetCurrentProgramScene');
		expect(obs.borrowable()).toEqual(before);
		expect(obs.types()).not.toContain('StartRecord');
		// A look mutes nothing of OBS's own. Only the plugin's source, made here, has its sound turned off.
		expect(obs.calls.filter((call) => call.type === 'SetInputMute').map((call) => call.data.inputName)).toEqual([
			OBS_SCENES.screen.input,
		]);
	});

	it('opens an OBS that is closed for the look where it may, waits for it, and says it is opening', async () => {
		const { obs, clock, recorder, opened } = rig();
		obs.closed = true;
		let told = 0;
		const looking = recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: true }, () => {
			told += 1;
		});
		await clock.advance(4000);
		expect([opened.count, told]).toEqual([1, 1]);
		obs.closed = false;
		expect(await clock.drive(looking)).toMatchObject({ ok: true, version: '33.0.1', problem: null });
		// Nothing of the look is left in OBS, and nothing was recorded.
		expect([obs.scenes.map((scene) => scene.name), obs.capturing(), obs.program]).toEqual([['Scene'], [], 'Scene']);
		expect(obs.types()).not.toContain('StartRecord');
	});

	it('opens nothing for a look where OBS may not be opened, cannot be, or answers already', async () => {
		const never = rig();
		never.obs.closed = true;
		let told = 0;
		const refused = await never.clock.drive(
			never.recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: false }, () => {
				told += 1;
			}),
		);
		expect(refused).toEqual({ ok: false, code: 'obs-closed' });
		expect([never.opened.count, told]).toEqual([0, 0]);

		const cannot = rig();
		cannot.obs.closed = true;
		cannot.opened.works = false;
		expect(
			await cannot.clock.drive(cannot.recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: true })),
		).toEqual({ ok: false, code: 'obs-closed' });
		expect(cannot.opened.count).toBe(1);

		// An OBS that answers and wants a password is open: it is not opened again.
		const locked = rig();
		locked.obs.password = FAKE_OBS_PASSWORD;
		expect(
			await locked.clock.drive(locked.recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: true })),
		).toEqual({ ok: false, code: 'obs-password' });
		expect(locked.opened.count).toBe(0);
	});

	it('waits half a minute for an OBS it opened for a look, and no longer', async () => {
		const { obs, clock, recorder, opened } = rig();
		obs.closed = true;
		const looking = recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: true });
		await clock.advance(29_000);
		let settled = false;
		void looking.then(() => {
			settled = true;
		});
		await clock.settle();
		expect(settled).toBe(false);
		expect(await clock.drive(looking)).toEqual({ ok: false, code: 'obs-closed' });
		expect(clock.now).toBeLessThan(1_000_000 + 40_000);
		expect(opened.count).toBe(1);
	});

	it('names what stands in the way of a recording', async () => {
		const empty = rig();
		expect(await empty.clock.drive(empty.recorder.probe({ port: 4455, password: null, scope: 'obs', mayOpen: false }))).toEqual({
			ok: true,
			version: '33.0.1',
			picture: null,
			problem: 'obs-empty',
		});
		const blank = rig();
		blank.obs.blank = true;
		expect(
			await blank.clock.drive(blank.recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: false })),
		).toMatchObject({ ok: true, problem: 'obs-blank' });
		const wayland = rig({ system: 'linux' });
		wayland.obs.kinds = [];
		expect(
			await wayland.clock.drive(wayland.recorder.probe({ port: 4455, password: null, scope: 'obsidian', mayOpen: false })),
		).toMatchObject({ ok: true, problem: 'obs-scene', picture: null });
	});

	it('names why OBS did not answer', async () => {
		const closed = rig();
		closed.obs.closed = true;
		expect(await closed.clock.drive(closed.recorder.probe({ port: 4455, password: null, scope: 'obs', mayOpen: false }))).toEqual({
			ok: false,
			code: 'obs-closed',
		});
		// A look never opens OBS.
		expect(closed.opened.count).toBe(0);
		const locked = rig();
		locked.obs.password = FAKE_OBS_PASSWORD;
		expect(await locked.clock.drive(locked.recorder.probe({ port: 4455, password: null, scope: 'obs', mayOpen: false }))).toEqual({
			ok: false,
			code: 'obs-password',
		});
	});

	it('moves nothing in an OBS that is recording something of its own', async () => {
		const { obs, clock, recorder } = rig();
		obs.recording = true;
		const probe = await clock.drive(recorder.probe({ port: 4455, password: null, scope: 'screen', mayOpen: false }));
		expect(probe).toMatchObject({ ok: true, problem: 'obs-recording' });
		expect(obs.writes()).toEqual([]);
	});

	it('puts no scene on air for a look while OBS is live on another output, and says what stands in the way', async () => {
		const { obs, clock, recorder } = rig();
		obs.streaming = true;
		const probe = await clock.drive(recorder.probe({ port: 4455, password: null, scope: 'obsidian', mayOpen: false }));
		// No picture: what the plugin would record is the scene it may not put on air now.
		expect(probe).toEqual({ ok: true, version: '33.0.1', picture: null, problem: 'obs-live' });
		expect(obs.writes()).toEqual([]);
		// OBS's own scene is looked at as the stream shows it, with nothing in the way.
		obs.scenes[0]?.items.push({ id: 7, source: 'The author’s own capture' });
		const own = await clock.drive(recorder.probe({ port: 4455, password: null, scope: 'obs', mayOpen: false }));
		expect(own).toMatchObject({ ok: true, problem: null, picture: 'data:image/jpg;base64,AAAA' });
		expect(obs.program).toBe('Scene');
		expect(obs.writes()).not.toContain('SetCurrentProgramScene');
	});
});
