import { describe, expect, it } from 'vitest';

import {
	OBS_EVENT_SUBSCRIPTIONS,
	OBS_SCENES,
	carryObsLoan,
	dataUrlBytes,
	decodeObsMessage,
	encodeObsCall,
	encodeObsIdentify,
	isBlankBitmap,
	obsAuthentication,
	obsAllScreensPlan,
	obsCapturePlan,
	obsListedFrame,
	obsListedScreens,
	obsScreenInputName,
	obsScreenLayout,
	obsFolderKey,
	obsLoanIsReal,
	obsLoanKey,
	obsLoanProfile,
	obsLoanStands,
	obsCanvasPlan,
	OBS_SIDE_LIMIT,
	obsNativeSize,
	obsOutputSize,
	pickObsListItem,
	pickObsWindow,
	readObsJournal,
	resolveObsKind,
	type ObsLoan,
} from '../../src/domain';

/** A bitmap as OBS hands one back: a header, then rows from the bottom up, padded to four bytes. */
function bitmap(width: number, height: number, bits: 24 | 32, shade: (x: number, y: number) => number): Uint8Array {
	const step = bits / 8;
	const row = Math.floor((bits * width + 31) / 32) * 4;
	const offset = 54;
	const bytes = new Uint8Array(offset + row * height);
	const view = new DataView(bytes.buffer);
	bytes[0] = 0x42;
	bytes[1] = 0x4d;
	view.setUint32(10, offset, true);
	view.setInt32(18, width, true);
	view.setInt32(22, height, true);
	view.setUint16(28, bits, true);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const at = offset + y * row + x * step;
			const value = shade(x, y);
			bytes[at] = value;
			bytes[at + 1] = value;
			bytes[at + 2] = value;
			if (bits === 32) bytes[at + 3] = 255;
		}
	}
	return bytes;
}

describe('the words of OBS’s server', () => {
	it('proves the password as the server reckons it, without sending it', async () => {
		const salt = 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=';
		const challenge = '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=';
		// Both reckoned outside this code, with the system's own tools.
		expect(await obsAuthentication('supersecretpassword', salt, challenge)).toBe(
			'1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=',
		);
		expect(await obsAuthentication('pässwörd✓', salt, challenge)).toBe(
			'RjzoD66Qy9p4kQBEIKOOT+8dbQC+XRcnav+Fyn4ZpnY=',
		);
	});

	it('reads the greeting with and without a password asked', () => {
		expect(
			decodeObsMessage(
				JSON.stringify({
					op: 0,
					d: { obsWebSocketVersion: '5.5.2', rpcVersion: 1, authentication: { challenge: 'c', salt: 's' } },
				}),
			),
		).toEqual({ kind: 'hello', authentication: { challenge: 'c', salt: 's' } });
		expect(decodeObsMessage(JSON.stringify({ op: 0, d: { rpcVersion: 1 } }))).toEqual({
			kind: 'hello',
			authentication: null,
		});
		expect(decodeObsMessage(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))).toEqual({
			kind: 'identified',
		});
	});

	it('reads an answer by its id, and an event by its name', () => {
		expect(
			decodeObsMessage(
				JSON.stringify({
					op: 7,
					d: {
						requestType: 'StopRecord',
						requestId: 'call-3',
						requestStatus: { result: true, code: 100 },
						responseData: { outputPath: '/a/b.mov' },
					},
				}),
			),
		).toEqual({ kind: 'answer', id: 'call-3', ok: true, code: 100, comment: null, data: { outputPath: '/a/b.mov' } });
		expect(
			decodeObsMessage(
				JSON.stringify({
					op: 7,
					d: { requestId: 'call-4', requestStatus: { result: false, code: 500, comment: 'Output active' } },
				}),
			),
		).toEqual({ kind: 'answer', id: 'call-4', ok: false, code: 500, comment: 'Output active', data: {} });
		expect(
			decodeObsMessage(
				JSON.stringify({
					op: 5,
					d: { eventType: 'RecordStateChanged', eventData: { outputActive: true } },
				}),
			),
		).toEqual({ kind: 'event', type: 'RecordStateChanged', data: { outputActive: true } });
	});

	it('reads anything else as nothing, and never throws', () => {
		for (const junk of [undefined, null, 4, new ArrayBuffer(4), '', 'not json', '[]', '{"op":"0"}', '{"op":9,"d":{}}', '{"op":7,"d":{}}', '{"op":5,"d":{}}']) {
			expect(decodeObsMessage(junk)).toBeNull();
		}
	});

	it('answers the greeting with the events it wants and the proof only where one is asked', () => {
		expect(JSON.parse(encodeObsIdentify(null))).toEqual({
			op: 1,
			d: { rpcVersion: 1, eventSubscriptions: OBS_EVENT_SUBSCRIPTIONS },
		});
		expect(OBS_EVENT_SUBSCRIPTIONS).toBe(65);
		expect(JSON.parse(encodeObsIdentify('proof'))).toEqual({
			op: 1,
			d: { rpcVersion: 1, eventSubscriptions: 65, authentication: 'proof' },
		});
	});

	it('asks under an id, with its data only where there is some', () => {
		expect(JSON.parse(encodeObsCall('a', 'StartRecord'))).toEqual({
			op: 6,
			d: { requestType: 'StartRecord', requestId: 'a' },
		});
		expect(JSON.parse(encodeObsCall('b', 'SetInputMute', { inputName: 'Mic/Aux', inputMuted: true }))).toEqual({
			op: 6,
			d: { requestType: 'SetInputMute', requestId: 'b', requestData: { inputName: 'Mic/Aux', inputMuted: true } },
		});
	});
});

describe('the source OBS is asked to capture with', () => {
	it('finds a kind under the newest version this OBS lists it by', () => {
		expect(resolveObsKind(['screen_capture', 'coreaudio_input_capture'], 'screen_capture')).toBe('screen_capture');
		expect(resolveObsKind(['xshm_input', 'xshm_input_v2'], 'xshm_input')).toBe('xshm_input_v2');
		expect(resolveObsKind(['xshm_input_v2'], 'xshm_input')).toBe('xshm_input_v2');
		expect(resolveObsKind(['window_capture_extra', 'xshm_input_vx'], 'window_capture')).toBeNull();
		expect(resolveObsKind([], 'screen_capture')).toBeNull();
	});

	it('captures a Mac’s screen by the system’s identifier and Obsidian by its window, asking OBS for no list', () => {
		const screen = { displayUuid: '08C01862-9690-4A1E-B653-10B1A582F805' };
		const own = { windowId: 4321 };
		expect(obsCapturePlan('mac', 'screen', ['screen_capture'], screen)).toEqual({
			kind: 'ready',
			inputKind: 'screen_capture',
			settings: { type: 0, display_uuid: '08C01862-9690-4A1E-B653-10B1A582F805', show_cursor: true },
			// OBS falls over when its macOS source is asked for its list of screens.
			pick: null,
		});
		expect(obsCapturePlan('mac', 'obsidian', ['screen_capture'], own)).toEqual({
			kind: 'ready',
			inputKind: 'screen_capture',
			settings: { type: 1, window: 4321, show_cursor: true },
			pick: null,
		});
	});

	it('gives every screen a source of its own, named by the system on a Mac and read from OBS’s list elsewhere', () => {
		const main = { x: 0, y: 0, width: 2560, height: 1440 };
		const side = { x: -1440, y: -690, width: 1440, height: 2560 };
		expect(
			obsAllScreensPlan('mac', ['screen_capture'], {
				displays: [
					{ displayUuid: 'MAIN', frame: main },
					{ displayUuid: 'SIDE', frame: side },
				],
			}),
		).toEqual({
			kind: 'pieces',
			inputKind: 'screen_capture',
			pieces: [
				{ settings: { type: 0, display_uuid: 'MAIN', show_cursor: true }, frame: main },
				{ settings: { type: 0, display_uuid: 'SIDE', show_cursor: true }, frame: side },
			],
		});
		// A Mac's screens are never asked of OBS, so there is no source without the system's word.
		expect(obsAllScreensPlan('mac', ['screen_capture'], null)).toEqual({ kind: 'none' });
		expect(obsAllScreensPlan('mac', ['screen_capture'], { displays: [] })).toEqual({ kind: 'none' });
		expect(obsAllScreensPlan('mac', ['screen_capture'], { displayUuid: 'MAIN' })).toEqual({ kind: 'none' });
		expect(obsAllScreensPlan('mac', [], { displays: [{ displayUuid: 'MAIN', frame: main }] })).toEqual({ kind: 'none' });
		expect(obsAllScreensPlan('win', ['monitor_capture'], null)).toEqual({
			kind: 'listed',
			inputKind: 'monitor_capture',
			settings: { capture_cursor: true },
			property: 'monitor_id',
		});
		expect(obsAllScreensPlan('linux', ['xshm_input_v2'], null)).toEqual({
			kind: 'listed',
			inputKind: 'xshm_input_v2',
			settings: { show_cursor: true },
			property: 'screen',
		});
		expect(obsAllScreensPlan('linux', ['pipewire-screen-capture-source'], null)).toEqual({ kind: 'none' });
		expect(obsScreenInputName(0)).toBe('Snowflake Method all screens capture 1');
		expect(obsScreenInputName(1)).toBe('Snowflake Method all screens capture 2');
	});

	it('reads a screen’s size and place out of the name OBS lists it under', () => {
		expect(obsListedFrame('Display 1: 1920x1080 @ 0,0 (Primary Monitor)')).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
		expect(obsListedFrame('显示器 2: 2560x1440 @ -2560,-200')).toEqual({ x: -2560, y: -200, width: 2560, height: 1440 });
		expect(obsListedFrame('Screen HDMI-1 (1920x1080 @ 1920,0)')).toEqual({ x: 1920, y: 0, width: 1920, height: 1080 });
		expect(obsListedFrame('Display 1')).toBeNull();
		expect(obsListedFrame('0x0 @ 0,0')).toBeNull();
		expect(obsListedFrame('')).toBeNull();
	});

	it('takes every screen OBS lists, and none where one cannot be placed', () => {
		const items = [
			{ itemName: '[Select a display to capture]', itemEnabled: true, itemValue: 'DUMMY' },
			{ itemName: 'Display 1: 1920x1080 @ 0,0 (Primary Monitor)', itemEnabled: true, itemValue: 'mon-1' },
			{ itemName: 'Display 2: 2560x1440 @ 1920,0', itemEnabled: true, itemValue: 'mon-2' },
		];
		expect(obsListedScreens(items, 'monitor_id', { capture_cursor: true })).toEqual([
			{ settings: { capture_cursor: true, monitor_id: 'mon-1' }, frame: { x: 0, y: 0, width: 1920, height: 1080 } },
			{ settings: { capture_cursor: true, monitor_id: 'mon-2' }, frame: { x: 1920, y: 0, width: 2560, height: 1440 } },
		]);
		// X11 counts its screens.
		expect(
			obsListedScreens([{ itemName: 'Screen 0 (1920x1080 @ 0,0)', itemEnabled: true, itemValue: 0 }], 'screen', {}),
		).toEqual([{ settings: { screen: 0 }, frame: { x: 0, y: 0, width: 1920, height: 1080 } }]);
		// A scene with a screen in the wrong place would be a wrong record of the desk.
		expect(obsListedScreens([...items, { itemName: 'Display 3', itemEnabled: true, itemValue: 'mon-3' }], 'monitor_id', {})).toBeNull();
		expect(obsListedScreens([items[0]], 'monitor_id', {})).toBeNull();
		expect(obsListedScreens([], 'monitor_id', {})).toBeNull();
	});

	it('lays the screens out on the canvas as they stand on the desk, as large as they fit, in its middle', () => {
		const main = { x: 0, y: 0, width: 2560, height: 1440 };
		const side = { x: -1440, y: -690, width: 1440, height: 2560 };
		// Together they are 4000 by 2560: on a 1920 by 1080 canvas the height decides.
		const laid = obsScreenLayout([main, side], { width: 1920, height: 1080 });
		const scale = 1080 / 2560;
		const offset = (1920 - 4000 * scale) / 2;
		expect(laid).toEqual([
			{ x: Math.round((offset + 1440 * scale) * 100) / 100, y: Math.round(690 * scale * 100) / 100, width: 1080, height: 607.5 },
			{ x: Math.round(offset * 100) / 100, y: 0, width: 607.5, height: 1080 },
		]);
		// One screen alone fills the canvas where their shapes agree.
		expect(obsScreenLayout([main], { width: 1280, height: 720 })).toEqual([{ x: 0, y: 0, width: 1280, height: 720 }]);
		// Side by side, the width decides and the row stands in the middle.
		expect(
			obsScreenLayout(
				[
					{ x: 0, y: 0, width: 1920, height: 1080 },
					{ x: 1920, y: 0, width: 1920, height: 1080 },
				],
				{ width: 1920, height: 1080 },
			),
		).toEqual([
			{ x: 0, y: 270, width: 960, height: 540 },
			{ x: 960, y: 270, width: 960, height: 540 },
		]);
		expect(obsScreenLayout([], { width: 1920, height: 1080 })).toBeNull();
		expect(obsScreenLayout([main], { width: 0, height: 1080 })).toBeNull();
	});

	it('makes no source on a Mac where the system named nothing, or named the wrong thing', () => {
		expect(obsCapturePlan('mac', 'screen', ['screen_capture'], null)).toEqual({ kind: 'none' });
		expect(obsCapturePlan('mac', 'obsidian', ['screen_capture'], null)).toEqual({ kind: 'none' });
		expect(obsCapturePlan('mac', 'screen', ['screen_capture'], { windowId: 4321 })).toEqual({ kind: 'none' });
		expect(obsCapturePlan('mac', 'obsidian', ['screen_capture'], { displayUuid: 'X' })).toEqual({ kind: 'none' });
	});

	it('captures a Windows monitor, or Obsidian’s window found by its program', () => {
		expect(obsCapturePlan('win', 'screen', ['monitor_capture', 'window_capture'], null)).toMatchObject({
			inputKind: 'monitor_capture',
			pick: { property: 'monitor_id', rule: 'display' },
		});
		expect(obsCapturePlan('win', 'obsidian', ['monitor_capture', 'window_capture'], null)).toMatchObject({
			inputKind: 'window_capture',
			settings: { priority: 2 },
			pick: { property: 'window', rule: 'windows-window' },
		});
	});

	it('captures under X11 and leaves Wayland, which lists neither X11 kind, to OBS', () => {
		const x11 = ['xshm_input_v2', 'xcomposite_input', 'pipewire-screen-capture-source'];
		expect(obsCapturePlan('linux', 'screen', x11, null)).toEqual({
			kind: 'ready',
			inputKind: 'xshm_input_v2',
			settings: { show_cursor: true },
			pick: null,
		});
		expect(obsCapturePlan('linux', 'obsidian', x11, null)).toMatchObject({
			inputKind: 'xcomposite_input',
			pick: { property: 'capture_window', rule: 'x11-window' },
		});
		const wayland = ['pipewire-screen-capture-source', 'pipewire-window-capture-source'];
		expect(obsCapturePlan('linux', 'screen', wayland, null)).toEqual({ kind: 'none' });
		expect(obsCapturePlan('linux', 'obsidian', wayland, null)).toEqual({ kind: 'none' });
		expect(obsCapturePlan('mac', 'screen', [], { displayUuid: 'X' })).toEqual({ kind: 'none' });
	});

	it('keeps one scene and one source for each thing it shows', () => {
		expect(OBS_SCENES.screen.scene).not.toBe(OBS_SCENES.obsidian.scene);
		expect(OBS_SCENES.screen.input).not.toBe(OBS_SCENES.obsidian.input);
	});

	it('picks the screen Obsidian stands on by where OBS says the screen is', () => {
		const screens = [
			{ itemName: ' ', itemEnabled: true, itemValue: null },
			{ itemName: 'BenQ EW3270U: 5120x2880 @ 0,0', itemEnabled: true, itemValue: 'uuid-main' },
			{ itemName: 'DELL P2720DC: 1440x2560 @ -1440,-560', itemEnabled: true, itemValue: 'uuid-side' },
		];
		expect(pickObsListItem(screens, 'display', { x: -1440, y: -560 })).toBe('uuid-side');
		expect(pickObsListItem(screens, 'display', { x: 0, y: 0 })).toBe('uuid-main');
		// A screen OBS does not list falls to the main one, then to the first.
		expect(pickObsListItem(screens, 'display', { x: 9999, y: 0 })).toBe('uuid-main');
		expect(pickObsListItem(screens, 'display', null)).toBe('uuid-main');
		expect(pickObsListItem([{ itemName: 'Odd', itemEnabled: true, itemValue: 'only' }], 'display', null)).toBe('only');
	});

	it('finds a screen on Windows by its place wherever that stands in the name', () => {
		// Read from OBS's own code for Windows: the screen's name, its size, its place in
		// pixels, and after the main one a mark in OBS's own language.
		const windows = [
			{ itemName: 'Select a display', itemEnabled: true, itemValue: 'DUMMY' },
			{ itemName: 'LG ULTRAGEAR: 2560x1440 @ -2560,0', itemEnabled: true, itemValue: 'left' },
			{ itemName: 'DELL U2720Q: 3840x2160 @ 0,0 (Primary Monitor)', itemEnabled: true, itemValue: 'main' },
			{ itemName: 'Generic PnP Monitor: 1920x1080 @ 3840,360', itemEnabled: true, itemValue: 'right' },
		];
		expect(pickObsListItem(windows, 'display', { x: 0, y: 0 })).toBe('main');
		expect(pickObsListItem(windows, 'display', { x: 3840, y: 360 })).toBe('right');
		expect(pickObsListItem(windows, 'display', { x: -2560, y: 0 })).toBe('left');
		// A corner OBS lists no screen at falls to the main one, which is not the first here.
		expect(pickObsListItem(windows, 'display', { x: 2560, y: 240 })).toBe('main');
		expect(pickObsListItem(windows, 'display', null)).toBe('main');
		// The mark reads otherwise in another language, and the place is found all the same.
		const chinese = [
			{ itemName: 'DELL U2720Q: 3840x2160 @ 3840,0', itemEnabled: true, itemValue: 'side' },
			{ itemName: 'DELL U2720Q: 3840x2160 @ 0,0 (主显示器)', itemEnabled: true, itemValue: 'main' },
		];
		expect(pickObsListItem(chinese, 'display', { x: 0, y: 0 })).toBe('main');
		// A place that only begins as another does is not that place.
		expect(pickObsListItem(chinese, 'display', { x: 384, y: 0 })).toBe('main');
		expect(pickObsListItem(chinese, 'display', { x: 3840, y: 0 })).toBe('side');
	});

	it('never picks OBS’s placeholder, a disabled item or an empty one', () => {
		expect(
			pickObsListItem(
				[
					{ itemName: 'Select a display', itemEnabled: true, itemValue: 'DUMMY' },
					{ itemName: 'Off: 1x1 @ 0,0', itemEnabled: false, itemValue: 'off' },
					{ itemName: 'Blank', itemEnabled: true, itemValue: '  ' },
				],
				'display',
				null,
			),
		).toBeNull();
		expect(pickObsListItem(['junk', 3, null], 'display', null)).toBeNull();
	});

	it('picks Obsidian’s window by its program on Windows, whatever the title says', () => {
		const windows = [
			{ itemName: '[chrome.exe]: Obsidian review', itemEnabled: true, itemValue: 'Obsidian review:Chrome_WidgetWin_1:chrome.exe' },
			{ itemName: '[Obsidian.exe]: Draft', itemEnabled: true, itemValue: 'Draft - Vault - Obsidian v1.14.4:Chrome_WidgetWin_1:Obsidian.exe' },
		];
		expect(pickObsListItem(windows, 'windows-window', null)).toBe(
			'Draft - Vault - Obsidian v1.14.4:Chrome_WidgetWin_1:Obsidian.exe',
		);
		expect(pickObsListItem(windows.slice(0, 1), 'windows-window', null)).toBeNull();
	});

	it('picks Obsidian’s window by its class under X11', () => {
		const windows = [
			{ itemName: 'Terminal', itemEnabled: true, itemValue: '41943047\r\nTerminal\r\ngnome-terminal' },
			{ itemName: 'Draft', itemEnabled: true, itemValue: '52428807\r\nDraft\r\nobsidian' },
		];
		expect(pickObsListItem(windows, 'x11-window', null)).toBe('52428807\r\nDraft\r\nobsidian');
		expect(pickObsListItem(windows.slice(0, 1), 'x11-window', null)).toBeNull();
	});

	it('picks the window of Obsidian’s with the title asked for, and the first of them where none carries it', () => {
		const windows = [
			{ itemName: '[Obsidian.exe]: Draft - Vault - Obsidian', itemEnabled: true, itemValue: 'Draft - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe' },
			// Another program's window under the very title asked for is never taken.
			{ itemName: '[notepad.exe]: Notes - Vault - Obsidian', itemEnabled: true, itemValue: 'Notes - Vault - Obsidian:Notepad:notepad.exe' },
			{ itemName: '[Obsidian.exe]: Notes - Vault - Obsidian', itemEnabled: true, itemValue: 'Notes - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe' },
		];
		const notes = 'Notes - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe';
		const draft = 'Draft - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe';
		expect(pickObsListItem(windows, 'windows-window', null, 'Notes - Vault - Obsidian')).toBe(notes);
		expect(pickObsListItem(windows, 'windows-window', null, 'Gone - Vault - Obsidian')).toBe(draft);
		expect(pickObsListItem(windows, 'windows-window', null, '')).toBe(draft);
		// The end of a longer title is not the title.
		expect(pickObsListItem(windows, 'windows-window', null, 'Obsidian')).toBe(draft);
		const x11 = [
			{ itemName: '[obsidian] Draft - Vault - Obsidian', itemEnabled: true, itemValue: '52428807\r\nDraft - Vault - Obsidian\r\nobsidian' },
			{ itemName: '[obsidian] Notes - Vault - Obsidian', itemEnabled: true, itemValue: '52428999\r\nNotes - Vault - Obsidian\r\nobsidian' },
		];
		expect(pickObsListItem(x11, 'x11-window', null, 'Notes - Vault - Obsidian')).toBe(
			'52428999\r\nNotes - Vault - Obsidian\r\nobsidian',
		);
		expect(pickObsListItem(x11, 'x11-window', null, 'Gone')).toBe('52428807\r\nDraft - Vault - Obsidian\r\nobsidian');
	});

	it('follows only to a window OBS lists under the title asked for, never to a guess', () => {
		const windows = [
			{ itemName: '[Obsidian.exe]: Draft - Vault - Obsidian', itemEnabled: true, itemValue: 'Draft - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe' },
			{ itemName: '[notepad.exe]: Notes - Vault - Obsidian', itemEnabled: true, itemValue: 'Notes - Vault - Obsidian:Notepad:notepad.exe' },
			{ itemName: '[Obsidian.exe]: Notes - Vault - Obsidian', itemEnabled: false, itemValue: 'off:Chrome_WidgetWin_1:Obsidian.exe' },
			{ itemName: '[Obsidian.exe]: Cast - Vault - Obsidian', itemEnabled: true, itemValue: 'Cast - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe' },
		];
		expect(pickObsWindow(windows, 'windows-window', 'Cast - Vault - Obsidian')).toBe(
			'Cast - Vault - Obsidian:Chrome_WidgetWin_1:Obsidian.exe',
		);
		// Listed under that title by another program only, or switched off in the list: not found.
		expect(pickObsWindow(windows, 'windows-window', 'Notes - Vault - Obsidian')).toBeNull();
		expect(pickObsWindow(windows, 'windows-window', 'Gone - Vault - Obsidian')).toBeNull();
		expect(pickObsWindow(windows, 'windows-window', '')).toBeNull();
		const x11 = [
			{ itemName: '[obsidian] Draft', itemEnabled: true, itemValue: '52428807\r\nDraft\r\nobsidian' },
			{ itemName: '[gedit] Notes', itemEnabled: true, itemValue: '41943047\r\nNotes\r\ngedit' },
		];
		expect(pickObsWindow(x11, 'x11-window', 'Draft')).toBe('52428807\r\nDraft\r\nobsidian');
		expect(pickObsWindow(x11, 'x11-window', 'Notes')).toBeNull();
		expect(pickObsWindow(['junk', 3, null], 'x11-window', 'Draft')).toBeNull();
	});

	it('brings the canvas down until its shorter side is the one asked, its shape kept, and never up', () => {
		expect(obsOutputSize({ width: 1920, height: 1080 }, '720p')).toEqual({ width: 1280, height: 720 });
		expect(obsOutputSize({ width: 3840, height: 2160 }, '1080p')).toEqual({ width: 1920, height: 1080 });
		expect(obsOutputSize({ width: 5120, height: 2880 }, '1440p')).toEqual({ width: 2560, height: 1440 });
		// A screen that stands tall is held by its width, or it would come out a sliver.
		expect(obsOutputSize({ width: 1440, height: 2560 }, '720p')).toEqual({ width: 720, height: 1280 });
		expect(obsOutputSize({ width: 1440, height: 2560 }, '1080p')).toEqual({ width: 1080, height: 1920 });
		expect(obsOutputSize({ width: 1280, height: 720 }, '1080p')).toEqual({ width: 1280, height: 720 });
		expect(obsOutputSize({ width: 1920, height: 1080 }, '1440p')).toEqual({ width: 1920, height: 1080 });
		expect(obsOutputSize({ width: 0, height: 1080 }, '720p')).toBeNull();
	});

	it('asks for a size as OBS will keep it: the width in fours, the height in twos', () => {
		// The real OBS answers 1668 by 1080 when asked for 1670 by 1080, and a loan
		// that reads otherwise than it was written could never be given back.
		expect(obsOutputSize({ width: 3024, height: 1964 }, '1080p')).toEqual({ width: 1664, height: 1080 });
		expect(obsOutputSize({ width: 3456, height: 2234 }, '1080p')).toEqual({ width: 1672, height: 1080 });
		expect(obsOutputSize({ width: 3456, height: 2234 }, '720p')).toEqual({ width: 1112, height: 720 });
		// Unscaled, a side is cut to its step and never rounded past the canvas.
		expect(obsOutputSize({ width: 1513, height: 977 }, 'full')).toEqual({ width: 1512, height: 976 });
		expect(obsOutputSize({ width: 1514, height: 978 }, '1440p')).toEqual({ width: 1512, height: 978 });
	});

	it('writes the picture as large as the canvas for the full size, up to the most OBS takes', () => {
		expect(obsOutputSize({ width: 2560, height: 1440 }, 'full')).toEqual({ width: 2560, height: 1440 });
		expect(obsOutputSize({ width: 3456, height: 2234 }, 'full')).toEqual({ width: 3456, height: 2234 });
		expect(OBS_SIDE_LIMIT).toBe(4096);
		// A canvas the author set larger by hand is brought down to it, its shape kept.
		expect(obsOutputSize({ width: 5120, height: 2880 }, 'full')).toEqual({ width: 4096, height: 2304 });
		expect(obsOutputSize({ width: 2880, height: 5120 }, 'full')).toEqual({ width: 2304, height: 4096 });
		// A desk too wide for it at 1440 lines is held by its long side.
		expect(obsOutputSize({ width: 7680, height: 1440 }, '1440p')).toEqual({ width: 4096, height: 768 });
	});

	it('measures what a scene of the plugin’s shows: one source as OBS says, a desk in its sharpest screen’s pixels', () => {
		expect(obsNativeSize([{ source: { width: 5120, height: 2880 }, frame: null }])).toEqual({ width: 5120, height: 2880 });
		// A wide screen with two pixels to a point, and a tall one to its left with one.
		const desk = [
			{ source: { width: 5120, height: 2880 }, frame: { x: 0, y: 0, width: 2560, height: 1440 } },
			{ source: { width: 1440, height: 2560 }, frame: { x: -1440, y: -690, width: 1440, height: 2560 } },
		];
		expect(obsNativeSize(desk)).toEqual({ width: 8000, height: 5120 });
		// Screens counted in pixels already stay as they are.
		expect(
			obsNativeSize([
				{ source: { width: 1920, height: 1080 }, frame: { x: 0, y: 0, width: 1920, height: 1080 } },
				{ source: { width: 1920, height: 1080 }, frame: { x: 1920, y: 0, width: 1920, height: 1080 } },
			]),
		).toEqual({ width: 3840, height: 1080 });
		// A source with no picture yet has no size, and a screen with no place cannot be laid out.
		expect(obsNativeSize([])).toBeNull();
		expect(obsNativeSize([{ source: { width: 0, height: 0 }, frame: null }])).toBeNull();
		expect(obsNativeSize([desk[0] ?? { source: { width: 1, height: 1 }, frame: null }, { source: { width: 100, height: 100 }, frame: null }])).toBeNull();
	});

	it('gives the plugin’s scene a canvas of its own size, each side rounded up to what OBS writes in', () => {
		expect(obsCanvasPlan({ width: 2560, height: 1440 })).toEqual({
			area: { width: 2560, height: 1440 },
			canvas: { width: 2560, height: 1440 },
		});
		// A window of an odd size keeps every pixel: the canvas is the next size up, the window in its corner.
		expect(obsCanvasPlan({ width: 1513, height: 977 })).toEqual({
			area: { width: 1513, height: 977 },
			canvas: { width: 1516, height: 978 },
		});
		// Larger than OBS takes: brought down until no side passes it, its shape kept.
		expect(obsCanvasPlan({ width: 5120, height: 2880 })).toEqual({
			area: { width: 4096, height: 2304 },
			canvas: { width: 4096, height: 2304 },
		});
		expect(obsCanvasPlan({ width: 8000, height: 5120 })).toEqual({
			area: { width: 4096, height: 2621 },
			canvas: { width: 4096, height: 2622 },
		});
		expect(obsCanvasPlan({ width: 0, height: 100 })).toBeNull();
		// The picture of a canvas so made is written with nothing scaled.
		for (const native of [{ width: 2560, height: 1440 }, { width: 1513, height: 977 }, { width: 8000, height: 5120 }]) {
			const canvas = obsCanvasPlan(native)?.canvas ?? { width: 0, height: 0 };
			expect(obsOutputSize(canvas, 'full'), JSON.stringify(native)).toEqual(canvas);
		}
	});

	it('borrows the folder under the key OBS’s output is set up to read', () => {
		expect(obsFolderKey('Simple', null)).toEqual({ category: 'SimpleOutput', name: 'FilePath' });
		expect(obsFolderKey(null, null)).toEqual({ category: 'SimpleOutput', name: 'FilePath' });
		expect(obsFolderKey('Advanced', 'Standard')).toEqual({ category: 'AdvOut', name: 'RecFilePath' });
		expect(obsFolderKey('Advanced', null)).toEqual({ category: 'AdvOut', name: 'RecFilePath' });
		expect(obsFolderKey('Advanced', 'FFmpeg')).toEqual({ category: 'AdvOut', name: 'FFFilePath' });
	});
});

describe('the ledger of what is borrowed from OBS', () => {
	const folder: ObsLoan = {
		kind: 'parameter',
		profile: 'Untitled',
		category: 'SimpleOutput',
		name: 'FilePath',
		before: '/Users/ada/Movies',
		after: '/Users/ada/Proof',
	};
	const size: ObsLoan = {
		kind: 'output-size',
		profile: 'Untitled',
		before: { width: 1280, height: 720 },
		after: { width: 1920, height: 1080 },
	};
	const canvas: ObsLoan = {
		kind: 'canvas',
		profile: 'Untitled',
		before: { width: 1920, height: 1080 },
		after: { width: 4096, height: 2304 },
	};
	const mute: ObsLoan = { kind: 'mute', input: 'Mic/Aux', before: false, after: true };
	const scene: ObsLoan = { kind: 'scene', before: 'Scene', after: 'Snowflake Method screen' };

	it('keeps the canvas as a loan of its own, beside the size OBS writes at', () => {
		expect(obsLoanKey(canvas)).not.toBe(obsLoanKey(size));
		expect(obsLoanProfile(canvas)).toBe('Untitled');
		expect(obsLoanIsReal(canvas)).toBe(true);
		expect(obsLoanIsReal({ ...canvas, after: canvas.before })).toBe(false);
		expect(obsLoanStands(canvas, { width: 4096, height: 2304 })).toBe(true);
		// A canvas the author set meanwhile is theirs.
		expect(obsLoanStands(canvas, { width: 1920, height: 1080 })).toBe(false);
		// Borrowed again over a loan never settled: the size to give back is the first one written down.
		const again: ObsLoan = { ...canvas, before: canvas.after, after: { width: 2560, height: 1440 } };
		expect(carryObsLoan(again, [canvas])).toEqual({ ...again, before: canvas.before });
		expect(carryObsLoan(again, [size])).toEqual(again);
	});

	it('reads back what it wrote, and nothing from anything else', () => {
		const journal = { version: 1, loans: [folder, size, canvas, mute, scene] };
		expect(readObsJournal(JSON.parse(JSON.stringify(journal)))).toEqual(journal);
		for (const junk of [null, 'x', {}, { version: 2, loans: [folder] }, { version: 1, loans: 'no' }, { version: 1, loans: [] }]) {
			expect(readObsJournal(junk)).toBeNull();
		}
	});

	it('drops an entry it cannot read and keeps the rest', () => {
		expect(
			readObsJournal({
				version: 1,
				loans: [
					{ kind: 'parameter', category: 'Output' },
					// A setting with no profile named could be given back to the wrong one.
					{ kind: 'parameter', category: 'Output', name: 'Mode', before: 'Simple', after: 'Advanced' },
					mute,
					{ kind: 'mute', input: 'x', before: 'no', after: true },
					4,
				],
			}),
		).toEqual({ version: 1, loans: [mute] });
	});

	it('gives a value back only while OBS still holds what the plugin left there', () => {
		expect(obsLoanStands(folder, '/Users/ada/Proof')).toBe(true);
		// The author pointed OBS somewhere else meanwhile: that is theirs.
		expect(obsLoanStands(folder, '/Users/ada/Elsewhere')).toBe(false);
		expect(obsLoanStands(folder, null)).toBe(false);
		expect(obsLoanStands(size, { width: 1920, height: 1080 })).toBe(true);
		expect(obsLoanStands(size, { width: 1280, height: 720 })).toBe(false);
		expect(obsLoanStands(size, 'junk')).toBe(false);
		expect(obsLoanStands(mute, true)).toBe(true);
		expect(obsLoanStands(mute, false)).toBe(false);
		expect(obsLoanStands(scene, 'Snowflake Method screen')).toBe(true);
		expect(obsLoanStands(scene, 'Scene')).toBe(false);
	});

	it('borrows nothing where the value already stood as asked', () => {
		expect(obsLoanIsReal(folder)).toBe(true);
		expect(obsLoanIsReal({ ...folder, before: folder.after })).toBe(false);
		expect(obsLoanIsReal(size)).toBe(true);
		expect(
			obsLoanIsReal({ kind: 'output-size', profile: 'p', before: { width: 2, height: 2 }, after: { width: 2, height: 2 } }),
		).toBe(false);
		expect(obsLoanIsReal({ ...mute, before: true })).toBe(false);
		expect(obsLoanIsReal({ kind: 'parameter', profile: 'p', category: 'a', name: 'b', before: null, after: 'x' })).toBe(true);
	});

	it('keeps the first value written down when a loan was never given back', () => {
		const again: ObsLoan = { ...folder, before: '/Users/ada/Proof', after: '/Users/ada/Proof/Other' };
		expect(carryObsLoan(again, [folder])).toEqual({ ...again, before: '/Users/ada/Movies' });
		expect(carryObsLoan(again, [mute, scene])).toEqual(again);
		expect(carryObsLoan({ ...mute, before: true }, [mute])).toEqual(mute);
		expect(carryObsLoan({ kind: 'scene', before: 'Snowflake Method screen', after: 'Snowflake Method Obsidian' }, [scene])).toEqual({
			kind: 'scene',
			before: 'Scene',
			after: 'Snowflake Method Obsidian',
		});
	});

	it('tells entries about the same thing apart from entries about another, and one profile’s settings from another’s', () => {
		expect(obsLoanKey(folder)).toBe('parameter|Untitled|SimpleOutput|FilePath');
		expect(obsLoanKey({ ...folder, name: 'RecQuality' })).not.toBe(obsLoanKey(folder));
		expect(obsLoanKey({ ...folder, profile: 'Streaming' })).not.toBe(obsLoanKey(folder));
		expect(obsLoanKey(mute)).toBe('mute|Mic/Aux');
		expect(obsLoanKey(size)).toBe('output-size|Untitled');
		expect(obsLoanKey(scene)).toBe('scene');
		expect(obsLoanProfile(folder)).toBe('Untitled');
		expect(obsLoanProfile(size)).toBe('Untitled');
		expect(obsLoanProfile(mute)).toBeNull();
		expect(obsLoanProfile(scene)).toBeNull();
	});

	it('carries nothing over from another profile’s loan of the same setting', () => {
		const elsewhere: ObsLoan = { ...folder, profile: 'Streaming', before: '/Volumes/Stream' };
		const again: ObsLoan = { ...folder, before: '/Users/ada/Other' };
		expect(carryObsLoan(again, [elsewhere])).toEqual(again);
	});
});

describe('telling a blank picture', () => {
	it('calls a flat picture blank, black or any other shade', () => {
		expect(isBlankBitmap(bitmap(32, 18, 24, () => 0))).toBe(true);
		expect(isBlankBitmap(bitmap(32, 18, 32, () => 0))).toBe(true);
		expect(isBlankBitmap(bitmap(31, 18, 24, () => 200))).toBe(true);
	});

	it('calls a picture with anything on it not blank', () => {
		expect(isBlankBitmap(bitmap(32, 18, 24, (x, y) => (x === 31 && y === 17 ? 90 : 0)))).toBe(false);
		expect(isBlankBitmap(bitmap(31, 18, 24, (x) => x * 8))).toBe(false);
		expect(isBlankBitmap(bitmap(32, 18, 32, (x, y) => (x + y) % 255))).toBe(false);
	});

	it('lets the grain of a compressed black pass as black', () => {
		expect(isBlankBitmap(bitmap(32, 18, 24, (x) => (x % 2 === 0 ? 0 : 4)))).toBe(true);
	});

	it('says nothing about bytes that are no bitmap it reads', () => {
		expect(isBlankBitmap(new Uint8Array(10))).toBeNull();
		expect(isBlankBitmap(new Uint8Array(100))).toBeNull();
		const cut = bitmap(32, 18, 24, () => 0).slice(0, 400);
		expect(isBlankBitmap(cut)).toBeNull();
		const odd = bitmap(32, 18, 24, () => 0);
		new DataView(odd.buffer).setUint16(28, 8, true);
		expect(isBlankBitmap(odd)).toBeNull();
	});

	it('reads the bytes out of a data address, and nothing out of anything else', () => {
		expect(dataUrlBytes('data:image/bmp;base64,Qk0=')).toEqual(new Uint8Array([0x42, 0x4d]));
		expect(dataUrlBytes('data:image/bmp,plain')).toBeNull();
		expect(dataUrlBytes('https://example.com/a.bmp')).toBeNull();
		expect(dataUrlBytes('data:image/bmp;base64,***')).toBeNull();
	});
});
