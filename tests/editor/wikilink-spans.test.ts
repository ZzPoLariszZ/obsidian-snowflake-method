import { describe, expect, it } from 'vitest';
import { wikilinkAt } from '../../src/editor/wikilink-spans';

describe('wikilinkAt', () => {
	const line = 'before [[Demo/Alice|Ali]] middle [[Demo/Bob]] after';

	it('finds the link containing the offset, alias and all', () => {
		const first = wikilinkAt(line, 10);
		expect(first).toEqual({
			from: 7,
			to: 25,
			linktext: 'Demo/Alice',
			alias: 'Ali',
		});
	});

	it('tells adjacent links apart', () => {
		const second = wikilinkAt(line, 40);
		expect(second?.linktext).toBe('Demo/Bob');
		expect(second?.alias).toBeNull();
	});

	it('answers null between and outside links', () => {
		expect(wikilinkAt(line, 3)).toBeNull();
		expect(wikilinkAt(line, 30)).toBeNull();
		expect(wikilinkAt(line, line.length)).toBeNull();
	});

	it('includes both edges of a link', () => {
		expect(wikilinkAt(line, 7)?.linktext).toBe('Demo/Alice');
		expect(wikilinkAt(line, 25)?.linktext).toBe('Demo/Alice');
	});

	it('refuses a link with nothing before the alias bar', () => {
		expect(wikilinkAt('[[  |name]]', 4)).toBeNull();
		expect(wikilinkAt('no links here', 4)).toBeNull();
	});
});
