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
	 * under them and shows only in the gaps between. An outline turned inward
	 * takes no room and rounds with the radius, but it is painted with the
	 * board and not after it, so the room it draws in has to be made for it.
	 * This shipped as an inset shadow, square and buried, until the rule was
	 * read here.
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
		// The mark needs room of its own, and in one column a card is given the
		// canvas's whole width, so it is drawn under every card unless the board
		// comes in. The board's padding is the only inset the pool keeps: the head,
		// the band and the board each span the pool's whole width, so the rule under
		// the name and the mark below it run to the same two ends, and the cards
		// alone give up the room. Insetting the head and the band as well shipped,
		// and left the rule an inset short of the mark at either end.
		const declarations = (selector: string): string => {
			const found = styles
				.replace(/\/\*[\s\S]*?\*\//g, ' ')
				.split('}')
				.find((entry) =>
					(entry.split('{')[0] ?? '')
						.split(',')
						.map((one) => one.trim())
						.includes(selector),
				);
			expect(found, selector).toBeDefined();
			return (found ?? '').split('{')[1] ?? '';
		};
		const inset = 'var(--snowflake-method-timeline-pool-inset)';
		// The padding sets the card's width as much as the mark's room: a card in
		// one column is given the canvas's whole width, so bringing the canvas down
		// to a lane's scene width is what makes a scene the same size in the pool as
		// in a lane, and sharing the rest between the sides is what centres it. The
		// inset is the floor, so the mark keeps room where a card would not fit.
		const board = declarations('.snowflake-method-timeline-pool .snowflake-method-corkboard');
		expect(board).toContain(`padding-inline: max(`);
		expect(board).toContain(inset);
		expect(board).toContain('(100% - var(--snowflake-method-timeline-scene-width)) / 2');
		for (const spanning of [
			'.snowflake-method-timeline-pool-head',
			'.snowflake-method-timeline-pool .snowflake-method-prose-controls',
		]) {
			expect(declarations(spanning), spanning).not.toMatch(/(?:margin|padding|inset)-inline(?:-(?:start|end))?:/);
		}
		// The count circle is smaller than the icon button standing above it at the
		// same end, so it comes in by half the difference: what the eye pairs is the
		// count with the plus, not the ring's edge with the button's. The button is
		// the icon with Obsidian's own padding at either side, which is wider than
		// this plugin's action size: measuring it from that token left the two
		// middles two pixels apart.
		expect(declarations('.snowflake-method-timeline-pool-count')).toContain(
			'margin-inline-end: calc((var(--icon-s) + 2 * var(--size-2-3) - 1.25rem) / 2)',
		);
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
	/**
	 * A `column-*` property reads as CSS multicolumn to the plugin review, which
	 * calls that feature only partly supported, even where the property is a
	 * grid's own gap and nothing multicolumn is meant. The `gap` shorthand says
	 * the same thing without the word. Flagged against the timeline's shared row
	 * template, where the gap between lanes had been written as `column-gap`.
	 */
	it('sets a grid gap without naming a multicolumn property', () => {
		const named = styles
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.split(/[{}]/)
			.flatMap((block) => block.split(';'))
			.map((entry) => entry.trim())
			.filter((entry) => /^(columns|column-gap|column-count|column-width|column-rule|column-span|column-fill)\s*:/.test(entry));
		expect(named).toEqual([]);
	});

	it('indents a first line without naming the flagged property', () => {
		const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, ' ');
		expect(declarations.includes('text-indent')).toBe(false);
		const spacers = styles.match(
			/::before\s*\{[^}]*width:\s*var\(--snowflake-method-manuscript-indent[^}]*\}/g,
		);
		expect(spacers?.length).toBe(2);
	});
});
