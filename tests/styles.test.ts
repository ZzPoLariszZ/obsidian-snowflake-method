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
	 * A cell's foot keeps to itself until its own cell is asked for. It used to
	 * stay in sight wherever no row stood above it, which is one invitation
	 * beside a lone lane but the same invitation repeated through every empty
	 * cell once lanes stand side by side, so every foot now waits alike. Each
	 * way of asking must bring it back, or the foot a row drag lands on and the
	 * foot a scene is dropped onto would both be invisible while wanted.
	 */
	it('keeps every foot quiet until its own cell is asked for, and brings it back', () => {
		const timeline = styles.slice(styles.indexOf('/* == Timeline '));
		const feet = (opacity: string): string[] =>
			timeline
				.replace(/\/\*[\s\S]*?\*\//g, ' ')
				.split('}')
				.filter((rule) => new RegExp(`opacity:\\s*${opacity}\\s*;`).test(rule))
				.flatMap((rule) => (rule.split('{')[0] ?? '').split(','))
				.map((selector) => selector.trim())
				.filter((selector) => selector.includes('snowflake-method-timeline-subrow-input'));
		// Nothing narrows the dimming to some feet and not others.
		expect(feet('0')).toEqual([
			'.snowflake-method-timeline-subrow.is-trailing textarea.snowflake-method-timeline-subrow-input',
		]);
		const shown = feet('1').join(' ');
		for (const asking of [':hover', ':focus-within', '.is-time-drag', '.is-row-drag', '.is-scene-drag']) {
			expect(shown).toContain(asking);
		}
	});

	/** The selectors must also beat the hiding rules; a media query adds no specificity. */
	it('shows the timeline menus and add controls without hover on a coarse pointer', () => {
		const timeline = styles.slice(styles.indexOf('/* == Timeline '));
		const coarse = [...timeline.matchAll(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/g)];
		expect(coarse).toHaveLength(1);
		const shown = (coarse[0]?.[1] ?? '')
			.split('}')
			.filter((rule) => /opacity:\s*1\s*;/.test(rule))
			.flatMap((rule) => (rule.split('{')[0] ?? '').split(','))
			.map((selector) => selector.trim());
		expect(shown).toEqual([
			'.snowflake-method-timeline-subrow-text .clickable-icon.snowflake-method-timeline-subrow-more',
			'.snowflake-method-timeline .clickable-icon.snowflake-method-timeline-time-more',
			'.snowflake-method-timeline .clickable-icon.snowflake-method-timeline-seam-add',
			'.snowflake-method-timeline .clickable-icon.snowflake-method-timeline-cell-add',
			'.snowflake-method-timeline-subrow.is-trailing textarea.snowflake-method-timeline-subrow-input',
			'.snowflake-method-timeline button.snowflake-method-timeline-subrow-label.is-empty',
		]);
	});

	/**
	 * A hyphenated name in element position is a custom element, and naming
	 * one ties the stylesheet to whatever library happens to draw it: the
	 * wikilink popup's group heading was `completion-section` in one
	 * CodeMirror and `li.cm-completionSection` in another, so the file named
	 * both and would have had to name the next. The plugin draws that heading
	 * itself now, and every element the file names is one the browser knows.
	 */
	/**
	 * A board that takes another surface's drop lights its whole field. The mark
	 * must add no box: the cards stand flush with both of the board's edges, so
	 * a border would move every one of them, and an inset shadow is painted
	 * under them and shows only in the gaps between. An outline turned inward is
	 * the one mark that lands on top while taking no room, and it rounds with
	 * the radius. This shipped as an inset shadow, square and buried, until the
	 * rule was read here.
	 */
	it('marks a board taking a whole drop without moving what stands on it', () => {
		const rule = styles
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.split('}')
			.find((entry) => (entry.split('{')[0] ?? '').includes('.snowflake-method-corkboard.is-drop-target'));
		expect(rule).toBeDefined();
		const body = (rule ?? '').split('{')[1] ?? '';
		expect(body).toContain('outline: 2px dashed var(--interactive-accent)');
		expect(body).toContain('outline-offset: -2px');
		expect(body).toContain('border-radius:');
		expect(body).toContain('color-mix(in srgb, var(--interactive-accent) 8%, transparent)');
		expect(body).not.toContain('border:');
		expect(body).not.toContain('box-shadow');
		// The mark also needs room of its own. A card is positioned and paints over
		// an outline drawn on the edge it stands on, so the board stands in from the
		// pool's edges and the cards come in with it.
		const board = styles
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.split('}')
			.find((entry) =>
				(entry.split('{')[0] ?? '')
					.split(',')
					.map((selector) => selector.trim())
					.includes('.snowflake-method-timeline-pool .snowflake-method-corkboard'),
			);
		expect(board).toBeDefined();
		expect((board ?? '').split('{')[1] ?? '').toContain('padding-inline:');
	});

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

	/**
	 * The property that sets a first line in is flagged by the review's
	 * browser-support check, for keywords the manuscript never asks for but
	 * which the check cannot see past. The page and the editor both indent
	 * with a blank inline-block standing before the first line instead, the
	 * way the other writing plugins do, so the property never appears.
	 */
	it('indents a first line without naming the flagged property', () => {
		const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, ' ');
		expect(declarations.includes('text-indent')).toBe(false);
		const spacers = styles.match(
			/::before\s*\{[^}]*width:\s*var\(--snowflake-method-manuscript-indent[^}]*\}/g,
		);
		expect(spacers?.length).toBe(2);
	});
});
