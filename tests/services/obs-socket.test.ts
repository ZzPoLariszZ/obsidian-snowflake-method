import { describe, expect, it } from 'vitest';

import {
	OBS_ANSWER_ENDED,
	OBS_ANSWER_SILENT,
	ObsSocket,
	obsAddress,
	type ObsEvent,
	type SocketLike,
} from '../../src/services/obs-socket';
import { FakeClock } from '../helpers/fake-clock';
import { FAKE_OBS_PASSWORD, FakeObs } from '../helpers/fake-obs';

function setup(): { obs: FakeObs; clock: FakeClock; socket: ObsSocket; urls: string[] } {
	const obs = new FakeObs();
	const clock = new FakeClock();
	const urls: string[] = [];
	let minted = 0;
	const socket = new ObsSocket({
		open: (url) => {
			urls.push(url);
			return obs.open(url);
		},
		timers: clock.timers,
		mint: () => {
			minted += 1;
			return `call-${String(minted)}`;
		},
	});
	return { obs, clock, socket, urls };
}

describe('a conversation with OBS', () => {
	it('only ever speaks to this computer', async () => {
		const { clock, socket, urls } = setup();
		expect(obsAddress(4455)).toBe('ws://127.0.0.1:4455');
		await clock.drive(socket.connect(4460, null));
		expect(urls).toEqual(['ws://127.0.0.1:4460']);
	});

	it('opens without a password where OBS asks none', async () => {
		const { clock, socket } = setup();
		expect(await clock.drive(socket.connect(4455, null))).toEqual({ ok: true });
		expect(socket.open).toBe(true);
	});

	it('proves the password where OBS asks one, and never sends it', async () => {
		const { obs, clock, socket } = setup();
		obs.password = FAKE_OBS_PASSWORD;
		expect(await clock.drive(socket.connect(4455, FAKE_OBS_PASSWORD))).toEqual({ ok: true });
		expect(socket.open).toBe(true);
		for (const frame of obs.sent) expect(frame).not.toContain(FAKE_OBS_PASSWORD);
	});

	it('says a password is needed before it answers the greeting at all', async () => {
		const { obs, clock, socket } = setup();
		obs.password = FAKE_OBS_PASSWORD;
		expect(await clock.drive(socket.connect(4455, null))).toEqual({ ok: false, reason: 'password-needed' });
		expect(await clock.drive(socket.connect(4455, ''))).toEqual({ ok: false, reason: 'password-needed' });
		expect(obs.sent).toEqual([]);
		expect(socket.open).toBe(false);
	});

	it('says the password is wrong when OBS closes on it', async () => {
		const { obs, clock, socket } = setup();
		obs.password = FAKE_OBS_PASSWORD;
		expect(await clock.drive(socket.connect(4455, 'not it'))).toEqual({ ok: false, reason: 'password-wrong' });
		expect(socket.open).toBe(false);
	});

	it('says nothing listens where the socket closes before any greeting', async () => {
		const { obs, clock, socket } = setup();
		obs.closed = true;
		expect(await clock.drive(socket.connect(4455, null))).toEqual({ ok: false, reason: 'refused' });
	});

	it('reads a socket that cannot even be made as nothing listening', async () => {
		const clock = new FakeClock();
		const socket = new ObsSocket({
			open: () => {
				throw new Error('no socket here');
			},
			timers: clock.timers,
			mint: () => 'x',
		});
		expect(await clock.drive(socket.connect(4455, null))).toEqual({ ok: false, reason: 'refused' });
	});

	it('reads an error with no close after it as nothing listening, at once', async () => {
		const clock = new FakeClock();
		let made: SocketLike | null = null;
		let closed = 0;
		const socket = new ObsSocket({
			open: () => {
				made = {
					send: () => {},
					close: () => {
						closed += 1;
					},
					onopen: null,
					onmessage: null,
					onclose: null,
					onerror: null,
				};
				return made;
			},
			timers: clock.timers,
			mint: () => 'x',
		});
		const pending = socket.connect(4455, null);
		const wire = made as SocketLike | null;
		// Some runtimes report a refused connection as an error and never close the socket.
		wire?.onerror?.();
		expect(await pending).toEqual({ ok: false, reason: 'refused' });
		expect(closed).toBe(1);
		// Nothing of the greeting's five seconds is left on the clock.
		expect(clock.waiting).toBe(0);
		// A close that does follow, as in Electron, finds nobody listening.
		expect(wire?.onclose).toBeNull();
	});

	it('keeps the cause a close names when no error came before it', async () => {
		const { obs, clock, socket } = setup();
		obs.password = FAKE_OBS_PASSWORD;
		expect(await clock.drive(socket.connect(4455, 'not-it'))).toEqual({ ok: false, reason: 'password-wrong' });
	});

	it('gives a greeting that never comes five seconds, then closes the socket', async () => {
		const clock = new FakeClock();
		let closed = 0;
		const mute: SocketLike = {
			send: () => {},
			close: () => {
				closed += 1;
			},
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
		};
		const socket = new ObsSocket({ open: () => mute, timers: clock.timers, mint: () => 'x' });
		const pending = socket.connect(4455, null);
		await clock.advance(4900);
		expect(closed).toBe(0);
		await clock.advance(200);
		expect(await pending).toEqual({ ok: false, reason: 'silent' });
		expect(closed).toBe(1);
	});

	it('reads an older OBS by the code it closes with', async () => {
		const clock = new FakeClock();
		let made: SocketLike | null = null;
		const socket = new ObsSocket({
			open: () => {
				made = { send: () => {}, close: () => {}, onopen: null, onmessage: null, onclose: null, onerror: null };
				return made;
			},
			timers: clock.timers,
			mint: () => 'x',
		});
		const pending = socket.connect(4455, null);
		(made as SocketLike | null)?.onclose?.({ code: 4010 });
		expect(await pending).toEqual({ ok: false, reason: 'old' });
	});

	it('matches each answer to what was asked, whatever order they come in', async () => {
		const { obs, clock, socket } = setup();
		await clock.drive(socket.connect(4455, null));
		const [version, status] = await clock.drive(
			Promise.all([socket.call('GetVersion'), socket.call('GetRecordStatus')]),
		);
		expect(version).toMatchObject({ ok: true, data: { obsVersion: '33.0.1' } });
		expect(status).toMatchObject({ ok: true, data: { outputActive: false } });
		expect(obs.types()).toEqual(['GetVersion', 'GetRecordStatus']);
	});

	it('hands a refusal back with its code, and never throws', async () => {
		const { obs, clock, socket } = setup();
		await clock.drive(socket.connect(4455, null));
		obs.failNext('StartRecord', 500);
		expect(await clock.drive(socket.call('StartRecord'))).toEqual({ ok: false, code: 500, comment: null });
		expect(await clock.drive(socket.call('NoSuchRequest'))).toEqual({ ok: false, code: 204, comment: null });
	});

	it('answers for itself where no conversation is open', async () => {
		const { socket } = setup();
		expect(await socket.call('GetVersion')).toEqual({ ok: false, code: OBS_ANSWER_ENDED, comment: null });
	});

	it('answers everything still waiting when OBS drops the conversation, and tells who listens', async () => {
		const clock = new FakeClock();
		let made: SocketLike | null = null;
		const socket = new ObsSocket({
			open: () => {
				// An OBS that greets and then answers nothing.
				made = { send: () => {}, close: () => {}, onopen: null, onmessage: null, onclose: null, onerror: null };
				return made;
			},
			timers: clock.timers,
			mint: () => 'only',
		});
		const connecting = socket.connect(4455, null);
		const wire = made as SocketLike | null;
		wire?.onmessage?.({ data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }) });
		wire?.onmessage?.({ data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) });
		expect(await connecting).toEqual({ ok: true });
		const ended: number[] = [];
		socket.onEnded((code) => ended.push(code));
		const pending = socket.call('GetRecordStatus');
		wire?.onclose?.({ code: 1006 });
		expect(await pending).toEqual({ ok: false, code: OBS_ANSWER_ENDED, comment: null });
		expect(ended).toEqual([1006]);
		expect(socket.open).toBe(false);
		expect(await socket.call('GetVersion')).toEqual({ ok: false, code: OBS_ANSWER_ENDED, comment: null });
		// The clock holds nothing of the answer that will never come.
		expect(clock.waiting).toBe(0);
	});

	it('reads an error on an open conversation as its end, once', async () => {
		const clock = new FakeClock();
		let made: SocketLike | null = null;
		const socket = new ObsSocket({
			open: () => {
				made = { send: () => {}, close: () => {}, onopen: null, onmessage: null, onclose: null, onerror: null };
				return made;
			},
			timers: clock.timers,
			mint: () => 'only',
		});
		const connecting = socket.connect(4455, null);
		const wire = made as SocketLike | null;
		wire?.onmessage?.({ data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }) });
		wire?.onmessage?.({ data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) });
		expect(await connecting).toEqual({ ok: true });
		const ended: number[] = [];
		socket.onEnded((code) => ended.push(code));
		const pending = socket.call('GetRecordStatus');
		const close = wire?.onclose;
		wire?.onerror?.();
		expect(await pending).toEqual({ ok: false, code: OBS_ANSWER_ENDED, comment: null });
		expect(ended).toEqual([1006]);
		expect(socket.open).toBe(false);
		// The close Electron sends after the error tells nobody a second time.
		close?.({ code: 1006 });
		expect(ended).toEqual([1006]);
		expect(clock.waiting).toBe(0);
	});

	it('gives one answer eight seconds, and ignores it when it comes late', async () => {
		const clock = new FakeClock();
		let made: SocketLike | null = null;
		const frames: string[] = [];
		const socket = new ObsSocket({
			open: () => {
				made = {
					send: (text) => {
						frames.push(text);
					},
					close: () => {},
					onopen: null,
					onmessage: null,
					onclose: null,
					onerror: null,
				};
				return made;
			},
			timers: clock.timers,
			mint: () => 'only',
		});
		const connecting = socket.connect(4455, null);
		const wire = made as SocketLike | null;
		wire?.onmessage?.({ data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }) });
		wire?.onmessage?.({ data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) });
		expect(await connecting).toEqual({ ok: true });
		const pending = socket.call('GetVersion');
		await clock.advance(7900);
		await clock.advance(200);
		expect(await pending).toEqual({ ok: false, code: OBS_ANSWER_SILENT, comment: null });
		// The late answer finds nobody waiting and disturbs nothing.
		wire?.onmessage?.({
			data: JSON.stringify({ op: 7, d: { requestId: 'only', requestStatus: { result: true, code: 100 } } }),
		});
		expect(socket.open).toBe(true);
		expect(frames).toHaveLength(2);
	});

	it('passes on what OBS says unasked, until the listener lets go', async () => {
		const { obs, clock, socket } = setup();
		await clock.drive(socket.connect(4455, null));
		const heard: ObsEvent[] = [];
		const release = socket.listen((event) => heard.push(event));
		obs.emit('RecordStateChanged', { outputActive: true });
		await clock.settle();
		release();
		obs.emit('ExitStarted');
		await clock.settle();
		expect(heard).toEqual([{ type: 'RecordStateChanged', data: { outputActive: true } }]);
	});

	it('tells nobody when it is this side that hangs up', async () => {
		const { clock, socket } = setup();
		await clock.drive(socket.connect(4455, null));
		const ended: number[] = [];
		socket.onEnded((code) => ended.push(code));
		socket.close();
		await clock.settle();
		expect(ended).toEqual([]);
		expect(socket.open).toBe(false);
	});
});
