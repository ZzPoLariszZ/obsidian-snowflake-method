import { describe, expect, it } from 'vitest';

import styles from '../styles.css?raw';

/**
 * What the shipped stylesheet may not contain. Nothing lints CSS here, so the
 * rules the plugin review holds this file to are kept by these tests.
 */
describe('styles.css', () => {
	/**
	 * `:has()` asks what an element contains, which the browser re-checks
	 * broadly as the page changes. It was taken out once in 0.5.1 and grew
	 * back by 0.8.1, because nothing was watching. A class the plugin puts on
	 * the element says the same thing and costs nothing to check.
	 */
	it('asks nothing about what an element contains', () => {
		const offenders = styles
			.split('\n')
			.map((line, index) => ({ line: line.trim(), number: index + 1 }))
			.filter((entry) => entry.line.includes(':has('));
		expect(offenders).toEqual([]);
	});

	/**
	 * A theme is the reader's choice, and `!important` overrules it. The file
	 * has never needed one, so a new one is a decision worth making on
	 * purpose rather than in passing.
	 */
	it('leaves the theme its say', () => {
		expect(styles.includes('!important')).toBe(false);
	});
});
