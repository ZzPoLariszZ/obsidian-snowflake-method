import { describe, expect, it } from 'vitest';

import { createFakeHost } from './helpers/fake-host';
import { createFakeListeners, createTestApi, place } from './helpers/fake-listener';
import { document } from './helpers/spec';

describe('the listener’s life', () => {
	it('opens nothing by being made', () => {
		const { api, listeners, statuses } = createTestApi(createFakeHost());
		expect(api.server.status()).toEqual({ state: 'off' });
		expect(listeners.started).toBe(0);
		expect(statuses).toEqual([]);
	});

	it('answers on the port it was started on, and says so', async () => {
		const { api, listeners, statuses } = createTestApi(createFakeHost());
		expect(await api.server.start(27125)).toEqual({ state: 'listening', port: 27125 });
		expect(api.server.status()).toEqual({ state: 'listening', port: 27125 });
		expect(statuses).toEqual([{ state: 'listening', port: 27125 }]);
		const door = listeners.open.get(27125);
		expect(door).toBeDefined();
		if (door === undefined) return;
		const answer = await place(door, { target: '/v1' });
		expect(answer?.json).toEqual({ service: 'snowflake-method', contract: document.version, authenticated: false });
	});

	it('holds a call to the port it really answers on, where the system chose it', async () => {
		const { api, listeners } = createTestApi(createFakeHost());
		const status = await api.server.start(0);
		expect(status.state).toBe('listening');
		const port = status.state === 'listening' ? status.port : 0;
		expect(port).toBeGreaterThan(0);
		const door = listeners.open.get(port);
		if (door === undefined) throw new Error('The listener stands.');
		expect((await place(door, { target: '/v1' }, `127.0.0.1:${String(port)}`))?.status).toBe(200);
		expect((await place(door, { target: '/v1' }, '127.0.0.1:0'))?.status).toBe(421);
	});

	it('opens nothing where no token has been made', async () => {
		const { api, listeners, statuses } = createTestApi(createFakeHost({ token: null }));
		expect(await api.server.start(27125)).toEqual({ state: 'failed', port: 27125, reason: 'no-token' });
		expect(listeners.started).toBe(0);
		expect(statuses).toEqual([{ state: 'failed', port: 27125, reason: 'no-token' }]);
	});

	it('says so where the device has no listener to start', async () => {
		const { api } = createTestApi(createFakeHost(), { listeners: null });
		expect(await api.server.start(27125)).toEqual({ state: 'failed', port: 27125, reason: 'no-listener' });
	});

	it('says whose the port is when it cannot be had, and tries no other', async () => {
		const listeners = createFakeListeners();
		listeners.open.set(27125, () => {});
		const { api } = createTestApi(createFakeHost(), { listeners });
		expect(await api.server.start(27125)).toEqual({ state: 'failed', port: 27125, reason: 'in-use' });
		expect(listeners.started).toBe(0);
		listeners.refuse = 'denied';
		expect(await api.server.start(80)).toEqual({ state: 'failed', port: 80, reason: 'denied' });
	});

	it('lets the old port go before it answers on a new one', async () => {
		const { api, listeners } = createTestApi(createFakeHost());
		await api.server.start(27125);
		expect(await api.server.start(27200)).toEqual({ state: 'listening', port: 27200 });
		expect([...listeners.open.keys()]).toEqual([27200]);
		expect([listeners.started, listeners.closed]).toEqual([2, 1]);
	});

	it('stops answering when it is stopped, however often', async () => {
		const { api, listeners, statuses } = createTestApi(createFakeHost());
		await api.server.start(27125);
		await api.server.stop();
		await api.server.stop();
		expect(api.server.status()).toEqual({ state: 'off' });
		expect(listeners.open.size).toBe(0);
		expect([listeners.started, listeners.closed]).toEqual([1, 1]);
		expect(statuses[statuses.length - 1]).toEqual({ state: 'off' });
	});

	it('takes what it is asked one thing at a time, so two never stand at once', async () => {
		const { api, listeners } = createTestApi(createFakeHost());
		const first = api.server.start(27125);
		const second = api.server.start(27200);
		const stopped = api.server.stop();
		const third = api.server.start(27300);
		await Promise.all([first, second, stopped, third]);
		expect(api.server.status()).toEqual({ state: 'listening', port: 27300 });
		expect([...listeners.open.keys()]).toEqual([27300]);
		expect([listeners.started, listeners.closed]).toEqual([3, 2]);
	});

	it('starts with the token of the moment, so a new one is believed at once', async () => {
		const host = createFakeHost({ token: 'snowflake_first' });
		const { api, listeners } = createTestApi(host);
		await api.server.start(27125);
		const door = listeners.open.get(27125);
		if (door === undefined) throw new Error('The listener stands.');
		const ask = (token: string) => place(door, { target: '/v1/openapi.json', headers: { authorization: `Bearer ${token}` } });
		expect((await ask('snowflake_first'))?.status).toBe(200);
		host.state.token = 'snowflake_second';
		expect((await ask('snowflake_first'))?.status).toBe(401);
		expect((await ask('snowflake_second'))?.status).toBe(200);
	});

	it('stops where the token is taken away, and starts again where one is made', async () => {
		const host = createFakeHost({ token: 'snowflake_first' });
		const { api, listeners, statuses } = createTestApi(host);
		await api.server.start(27125);
		// A token put in place of another changes nothing for the listener.
		host.state.token = 'snowflake_second';
		expect(await api.server.tokenChanged()).toEqual({ state: 'listening', port: 27125 });
		expect([listeners.started, listeners.closed]).toEqual([1, 0]);
		host.state.token = null;
		expect(await api.server.tokenChanged()).toEqual({ state: 'failed', port: 27125, reason: 'no-token' });
		expect(listeners.open.size).toBe(0);
		expect([listeners.started, listeners.closed]).toEqual([1, 1]);
		// Told again with none still there, it has nothing new to say.
		const told = statuses.length;
		await api.server.tokenChanged();
		expect(statuses.length).toBe(told);
		host.state.token = 'snowflake_third';
		expect(await api.server.tokenChanged()).toEqual({ state: 'listening', port: 27125 });
		expect([...listeners.open.keys()]).toEqual([27125]);
	});

	it('is not started by a token while it is off, or stopped for another reason', async () => {
		const host = createFakeHost({ token: null });
		const listeners = createFakeListeners();
		const { api } = createTestApi(host, { listeners });
		host.state.token = 'snowflake_first';
		expect(await api.server.tokenChanged()).toEqual({ state: 'off' });
		listeners.open.set(27125, () => {});
		await api.server.start(27125);
		expect(await api.server.tokenChanged()).toEqual({ state: 'failed', port: 27125, reason: 'in-use' });
		expect(listeners.started).toBe(0);
	});
});
