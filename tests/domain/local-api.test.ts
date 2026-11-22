import { describe, expect, it } from 'vitest';

import {
	DEFAULT_LOCAL_API_PREFERENCES,
	LOCAL_API_ACCESS_LEVELS,
	LOCAL_API_DEFAULT_PORT,
	isLocalApiPort,
	sanitizeLocalApiPreferences,
} from '../../src/domain/local-api';

describe('the local API’s choices', () => {
	it('start closed: nothing listens, no command answers, and a caller may only read', () => {
		expect(DEFAULT_LOCAL_API_PREFERENCES).toEqual({ http: false, port: 27125, access: 'read', cli: false });
		expect(LOCAL_API_DEFAULT_PORT).toBe(27125);
		expect([...LOCAL_API_ACCESS_LEVELS]).toEqual(['read', 'write', 'delete']);
	});

	it('are read back as they were kept', () => {
		const kept = { http: true, port: 31999, access: 'delete', cli: true };
		expect(sanitizeLocalApiPreferences(kept)).toEqual(kept);
		expect(sanitizeLocalApiPreferences({ ...kept, access: 'write' }).access).toBe('write');
	});

	it('fall back to the closed start wherever what was kept is not a choice', () => {
		for (const damaged of [null, undefined, 'on', 7, [], {}]) {
			expect(sanitizeLocalApiPreferences(damaged), JSON.stringify(damaged)).toEqual(DEFAULT_LOCAL_API_PREFERENCES);
		}
		expect(sanitizeLocalApiPreferences({ http: 'true', port: '27125', access: 'admin', cli: 1 })).toEqual(DEFAULT_LOCAL_API_PREFERENCES);
		// One part damaged leaves the others as they were kept.
		expect(sanitizeLocalApiPreferences({ http: true, port: 80, access: 'write', cli: true })).toEqual({
			http: true,
			port: 27125,
			access: 'write',
			cli: true,
		});
	});

	it('never hand back the defaults themselves, which a caller could then change', () => {
		const first = sanitizeLocalApiPreferences(null);
		first.http = true;
		expect(sanitizeLocalApiPreferences(null).http).toBe(false);
		expect(DEFAULT_LOCAL_API_PREFERENCES.http).toBe(false);
	});

	it('take a port an ordinary program may ask for', () => {
		expect(isLocalApiPort(1024)).toBe(true);
		expect(isLocalApiPort(65535)).toBe(true);
		expect(isLocalApiPort(27125)).toBe(true);
		for (const other of [0, 80, 1023, 65536, 27125.5, Number.NaN, '27125', null]) {
			expect(isLocalApiPort(other), String(other)).toBe(false);
		}
	});
});
