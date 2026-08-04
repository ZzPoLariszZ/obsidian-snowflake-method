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

	it('rejects circular or non-data values', () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;
		expect(() => fingerprint(circular)).toThrow(/circular/u);
		expect(() => fingerprint(Symbol('scene'))).toThrow(/symbol/u);
		expect(() => fingerprint(() => undefined)).toThrow(/function/u);
	});
});
