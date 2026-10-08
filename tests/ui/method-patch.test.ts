import { describe, expect, it } from 'vitest';

import { patchMethod } from '../../src/ui/method-patch';

describe('patchMethod', () => {
	it('wraps an own method and puts it back', () => {
		const proto = { greet(this: { name: string }) { return `hi ${this.name}`; } };
		const target = Object.create(proto) as { name: string; greet(): string };
		target.name = 'Ann';
		const patch = patchMethod(proto, 'greet', (original) => function (this: unknown, ...args: unknown[]) {
			return `${String(original.apply(this, args))}!`;
		});
		expect(patch).not.toBeNull();
		expect(target.greet()).toBe('hi Ann!');
		patch?.restore();
		expect(target.greet()).toBe('hi Ann');
	});

	it('answers null for a name that is not an own method', () => {
		const base = { shared() { return 1; } };
		const proto = Object.create(base) as { shared(): number };
		expect(patchMethod(proto, 'shared', (original) => original)).toBeNull();
		expect(patchMethod({ value: 1 }, 'value', (original) => original)).toBeNull();
	});

	it('passes calls straight through once restored under another wrapper', () => {
		const proto = { count() { return 1; } };
		const ours = patchMethod(proto, 'count', (original) => function (this: unknown, ...args: unknown[]) {
			return (original.apply(this, args) as number) + 10;
		});
		const theirs = patchMethod(proto, 'count', (original) => function (this: unknown, ...args: unknown[]) {
			return (original.apply(this, args) as number) * 2;
		});
		expect(proto.count()).toBe(22);
		ours?.restore();
		// Theirs still stands on top; ours now hands the call through.
		expect(proto.count()).toBe(2);
		theirs?.restore();
		expect(proto.count()).toBe(1);
	});
});
