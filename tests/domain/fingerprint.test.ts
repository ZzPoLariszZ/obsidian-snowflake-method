import { describe, expect, it } from 'vitest';

import { fingerprint, fingerprintContent, stableSerialize } from '../../src/domain';

describe('stable content fingerprints', () => {
	it('is independent of object insertion order', () => {
		const first = {
			step: 3,
			character: { name: 'Lin', goal: 'Return home' },
			tags: ['lead', 'pov'],
		};
		const second = {
			tags: ['lead', 'pov'],
			character: { goal: 'Return home', name: 'Lin' },
			step: 3,
		};
		expect(stableSerialize(first)).toBe(stableSerialize(second));
		expect(fingerprint(first)).toBe(fingerprint(second));
	});

	it('detects nested content and sequence changes', () => {
		expect(fingerprint({ values: ['a', 'b'] })).not.toBe(
			fingerprint({ values: ['b', 'a'] }),
		);
		expect(fingerprint({ character: { goal: 'A' } })).not.toBe(
			fingerprint({ character: { goal: 'B' } }),
		);
	});

	it('handles unicode, undefined, and special numbers synchronously', () => {
		const value = {
			title: '雪花 ❄️',
			optional: undefined,
			values: [Number.NaN, Number.POSITIVE_INFINITY, -0],
		};
		const result = fingerprintContent(value);
		expect(result).toMatch(/^fp1-[0-9a-f]{16}$/u);
		expect(result).toBe(fingerprintContent(value));
		expect(stableSerialize(value)).toContain('undefined');
	});

	it('distinguishes ambiguous primitive values', () => {
		expect(stableSerialize('null')).not.toBe(stableSerialize(null));
		expect(stableSerialize('1')).not.toBe(stableSerialize(1));
		expect(stableSerialize(-0)).not.toBe(stableSerialize(0));
	});

	it('gives the values the two separate passes gave', () => {
		// Notes keep the fingerprints they were reviewed at, so the hash may
		// be made faster and never different. This is the hash as it was
		// first written: one whole walk of the text for each seed.
		const pass = (input: string, seed: number): number => {
			let hash = seed >>> 0;
			for (let index = 0; index < input.length; index += 1) {
				const codeUnit = input.charCodeAt(index);
				hash ^= codeUnit & 0xff;
				hash = Math.imul(hash, 0x01000193);
				hash ^= codeUnit >>> 8;
				hash = Math.imul(hash, 0x01000193);
			}
			return hash >>> 0;
		};
		const hex = (value: number): string => value.toString(16).padStart(8, '0');
		const twoPasses = (value: unknown): string => {
			const serialized = stableSerialize(value);
			return `fp1-${hex(pass(serialized, 0x811c9dc5))}${hex(pass(serialized, 0x9e3779b9))}`;
		};
		const values: unknown[] = [
			'',
			'a',
			'雪花 ❄️ 钟楼雪',
			'\u0000\uffff\ud83d\ude00',
			{ step: 3, character: { name: 'Lin', goal: 'Return home' }, tags: ['lead', 'pov'] },
			[1, -0, Number.NaN, null, undefined, true, 10n],
			Array.from({ length: 400 }, (_, index) => ({ id: `scene-${String(index)}`, rank: index * 1024, title: '第' + String(index) + '场' })),
			'x'.repeat(70_000),
		];
		for (const value of values) expect(fingerprint(value)).toBe(twoPasses(value));
	});

	it('gives the fingerprints notes were reviewed at', () => {
		// Held as written values, where a comparison against another run of
		// the same code would not see it: notes keep the fingerprints they
		// were reviewed at, and a change to the hashing or to how a value is
		// written out would call every one of them outdated.
		expect(fingerprint('')).toBe('fp1-c29654da2ba376c6');
		expect(fingerprint({ a: 1 })).toBe('fp1-5877acaf91114433');
		// Nested, so the order of keys and the marks between them are held too.
		expect(
			fingerprint({ step: 3, character: { name: 'Lin', goal: 'Return home' }, tags: ['lead', 'pov'] }),
		).toBe('fp1-f9da533b62036237');
		// Written with its keys another way round, it is the same value.
		expect(
			fingerprint({ tags: ['lead', 'pov'], character: { goal: 'Return home', name: 'Lin' }, step: 3 }),
		).toBe('fp1-f9da533b62036237');
	});

	it('rejects circular or non-data values', () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;
		expect(() => fingerprint(circular)).toThrow(/circular/u);
		expect(() => fingerprint(Symbol('scene'))).toThrow(/symbol/u);
		expect(() => fingerprint(() => undefined)).toThrow(/function/u);
	});
});
