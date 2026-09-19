import { describe, expect, it } from 'vitest';

import styles from '../styles.css?raw';

/**
 * What the shipped stylesheet may not contain. Nothing lints CSS here, so the
 * rules the plugin review holds this file to are kept by these tests.
 */
describe('styles.css', () => {
	/** What one rule says, found by the whole selector it is written under. */
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

	/**
	 * One workspace's own rules: from its banner to the next, or to the file's
	 * end. A workspace added under another must not be read as part of it.
	 */
	const section = (name: string): string => {
		const from = styles.indexOf(`/* == ${name} `);
		expect(from, name).toBeGreaterThan(-1);
		const next = styles.indexOf('/* == ', from + 1);
		return next === -1 ? styles.slice(from) : styles.slice(from, next);
	};

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
		const timeline = section('Timeline');
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
		const timeline = section('Timeline');
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
	 * The way to delete a template stands beside the field that picks one. Awake
	 * it is red, in the theme's own token for an error and never a colour written
	 * into the file, so a theme that changes its red changes this one; asleep,
	 * for a preset that cannot go, it keeps the quiet of a control asleep.
	 */
	it('inks the template delete in the theme\u2019s own red, and only while it can be pressed', () => {
		const selector = '.snowflake-method-beat-sheet-template-line > .clickable-icon.snowflake-method-beat-sheet-template-delete';
		const awake = declarations(`${selector}:not(:disabled)`);
		expect(awake).toContain('color: var(--text-error)');
		expect(awake).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
		// The rule for the control in every state says nothing of its ink.
		expect(declarations(selector)).not.toMatch(/(?:^|;|\s)color:/);
	});

	/**
	 * The beat sheet wears the timeline's classes, so the timeline's rules dress
	 * it and its own section says only what an act adds. Three things hold that
	 * up. Nothing in it hides a control until hover, so it needs no block for a
	 * coarse pointer and none can be forgotten. Nothing in it is sticky, since
	 * the parts that stuck inside a lane were taken out of the timeline for
	 * good. And an act's landing line is the timeline's own line, drawn again
	 * for the two elements the timeline has no name for.
	 */
	it('adds the acts to the timeline look and hides nothing a touch would need', () => {
		const sheet = section('Beat sheet').replace(/\/\*[\s\S]*?\*\//g, ' ');
		expect(sheet).not.toContain('@media');
		expect(sheet).not.toMatch(/opacity:\s*0\s*;/);
		expect(sheet).not.toMatch(/visibility:\s*hidden/);
		expect(sheet).not.toContain('position: sticky');
		const line = (selector: string): string[] =>
			declarations(selector)
				.split(';')
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0);
		const timelineLine = line('.snowflake-method-timeline-row.is-drop-before::before');
		expect(timelineLine.length).toBeGreaterThan(0);
		expect(line('.snowflake-method-beat-sheet-act.is-drop-before::before')).toEqual(timelineLine);
		expect(line('.snowflake-method-beat-sheet-act-foot.is-drop-before::before')).toEqual(timelineLine);
		// The line is drawn from the element's own box, so both must be one.
		expect(declarations('.snowflake-method-beat-sheet-act')).toContain('position: relative');
		expect(declarations('.snowflake-method-beat-sheet-act-foot')).toContain('position: relative');
		// The symbols stand at the toolbar's end from the first of them. On the timeline that is the
		// pencil; on a sheet the export comes first, and was left beside the field until it took the margin.
		expect(declarations('.snowflake-method-timeline-toolbar .snowflake-method-timeline-view-edit')).toContain('margin-inline-start: auto');
		expect(declarations('.snowflake-method-timeline-toolbar .snowflake-method-beat-sheet-export')).toContain('margin-inline-start: auto');
		// The template field's description is two sentences the copy breaks onto two lines.
		expect(declarations('.snowflake-method-beat-sheet-template-setting .setting-item-description')).toContain('white-space: pre-line');
		// What a template's author wrote of it is set off as a quotation, by the app's own measures for one, and goes when there is none.
		const quote = declarations('.snowflake-method-beat-sheet-template-description');
		expect(quote).toContain('border-inline-start: var(--blockquote-border-thickness, 2px) solid');
		expect(quote).toContain('margin: 0');
		expect(quote).toContain('white-space: pre-wrap');
		expect(declarations('.snowflake-method-beat-sheet-template-description.is-hidden')).toContain('display: none');
	});

	/**
	 * An act's header is as wide as a beat's row at the least, or its rule would
	 * stop short of the rows once the field is too narrow and the table scrolls;
	 * and as tall as the head a timeline's lanes stand under, so the first act's
	 * rule runs level with the pool's. Each act's axis runs from its first node
	 * to its last by classes the painter sets: the stylesheet may not ask which
	 * beat is first, since an act's header and foot stand between the rows.
	 */
	it('sizes an act from the timeline\u2019s own measures and ends each axis by the painter\u2019s word', () => {
		const act = declarations('.snowflake-method-beat-sheet-act');
		for (const measure of [
			'var(--snowflake-method-timeline-time-width)',
			'var(--snowflake-method-timeline-lane-gap)',
			'var(--snowflake-method-timeline-lane-width)',
		]) {
			expect(act, measure).toContain(measure);
		}
		expect(act).toContain('min-height: var(--snowflake-method-timeline-head-height)');
		const offset = 'var(--snowflake-method-timeline-node-offset)';
		expect(
			declarations('.snowflake-method-beat-sheet-beat.is-act-first .snowflake-method-timeline-axis::before'),
		).toContain(`inset-block-start: ${offset}`);
		expect(
			declarations('.snowflake-method-beat-sheet-beat.is-act-last .snowflake-method-timeline-axis::before'),
		).toContain(`inset-block-end: calc(100% - ${offset})`);
		const sheet = section('Beat sheet').replace(/\/\*[\s\S]*?\*\//g, ' ');
		expect(sheet).not.toMatch(/:(?:first|last|nth)-(?:of-type|child)/);
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
		// The pool is one scene card wide with that room on either side of it, so
		// the padding above has nothing to share out and a card stands its lane
		// width. Sizing the pool by its band instead cost it a further rem.
		const poolWidth = /--snowflake-method-timeline-pool-width:([^;]*);/.exec(styles)?.[1] ?? '';
		expect(poolWidth).toContain('var(--snowflake-method-timeline-scene-width)');
		expect(poolWidth).toContain(`2 * ${inset}`);
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

	/**
	 * A group head is its name and a rule across whatever the name leaves. The
	 * name stood at its full width however narrow the board, so in the pool,
	 * which is one card wide, a linked chapter's name ran out over the cards and
	 * past the frame and pushed the rule off the end entirely.
	 */
	it('trims a group name to the board it heads', () => {
		const label = declarations('.snowflake-method-corkboard-group-label');
		expect(label).not.toContain('flex: 0 0');
		expect(label).toContain('min-width: 0');
		expect(label).toContain('white-space: nowrap');
		expect(label).toContain('overflow: hidden');
		expect(label).toContain('text-overflow: ellipsis');
		// A stub of rule is kept, so a head trimmed to the last letter still reads
		// as a head and not as a line of text that happens to stand above the cards.
		expect(declarations('.snowflake-method-corkboard-group-rule')).toMatch(/min-width:\s*var\(/);
	});

	/**
	 * The pool's band holds a field and five controls in one card's width. The
	 * count of what a search leaves standing has no room there: given it, the two
	 * numbers stack one above the other and push the band taller than the row it
	 * rides beside the workspace's own toolbar.
	 */
	it('leaves the pool band no count to stack', () => {
		expect(declarations('.snowflake-method-timeline-pool .snowflake-method-prose-state')).toContain(
			'display: none',
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
