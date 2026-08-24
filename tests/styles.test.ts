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

	/**
	 * A hyphenated name in element position is a custom element, and naming
	 * one ties the stylesheet to whatever library happens to draw it: the
	 * wikilink popup's group heading was `completion-section` in one
	 * CodeMirror and `li.cm-completionSection` in another, so the file named
	 * both and would have had to name the next. The plugin draws that heading
	 * itself now, and every element the file names is one the browser knows.
	 */
	it('names no element a browser would not know', () => {
		const bare = /(^|[\s>+~(,])([a-z][a-z\d]*(?:-[a-z\d]+)+)(?![-\w])/g;
		const offenders = [
			...styles.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{/g),
		]
			.map((rule) => (rule[1] ?? '').trim())
			.filter((prelude) => !prelude.startsWith('@'))
			.flatMap((prelude) => [...prelude.matchAll(bare)].map((hit) => hit[2]));
		expect(offenders).toEqual([]);
	});
});
