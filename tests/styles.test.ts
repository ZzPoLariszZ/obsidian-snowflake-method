import { describe, expect, it } from 'vitest';

import engine from '@xyflow/react/dist/base.css?raw';

import styles from '../styles.css?raw';
import { TINT_REACH_CLASSES } from '../src/domain';
import { scopeCss } from './helpers/scope-css';

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
					.map((one) => one.trim().replace(/\s+/gu, ' '))
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

	it('keeps the modification history to theme tokens, and lets a day keep its one cell', () => {
		const history = section('Modification history');
		expect(history.includes('!important')).toBe(false);
		expect(history.includes(':has(')).toBe(false);
		expect(history).not.toMatch(/column-(gap|count|width)/u);
		expect(history).not.toMatch(/text-indent/u);
		expect(
			declarations(
				':where(.snowflake-method-table-wrap.is-stacked) .snowflake-method-table.snowflake-method-history-table tr.snowflake-method-history-day > td::before',
			),
		).toContain('content: none');
		// The arrows and the title are one piece of the range row that never
		// breaks: a narrow pane wraps the picks under them, and a narrower one
		// wraps the title between arrows that stay put.
		const nav = declarations('.snowflake-method-history-range-nav');
		expect(nav).toContain('display: flex');
		expect(nav).toContain('flex: 0 1 auto');
		expect(nav).toContain('min-width: 0');
		expect(nav).not.toContain('flex-wrap');
		expect(declarations('.snowflake-method-history-range')).toContain('flex-wrap: wrap');
		expect(declarations('.snowflake-method-history-range-heading')).toContain('min-width: 9em');
		expect(declarations('.snowflake-method-history-range-title')).not.toContain('white-space');
	});

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
	/** The cover must win over an element's own width, as the task lanes' `thin`. */
	it('hides every scrollbar under the body class, descendants included', () => {
		const scrollbars = section('Scrollbars');
		expect(scrollbars.includes('!important')).toBe(false);
		expect(declarations('body.snowflake-method-hide-scrollbars')).toContain('--scrollbar-native-width: none');
		expect(declarations('body.snowflake-method-hide-scrollbars *:not(.snowflake-method-scrollbar-probe)')).toContain('scrollbar-width: none');
		expect(declarations('body.snowflake-method-hide-scrollbars :not(.snowflake-method-scrollbar-probe)::-webkit-scrollbar')).toContain('display: none');
	});

	/**
	 * Obsidian draws every tooltip, the plugin's and the app's alike, as a
	 * `.tooltip` on the body of its window, so the one rule under the body
	 * class reaches them all, as Hider's does, but for the warning a section
	 * marker shows, which wears a class of its own, and the app's error
	 * messages, which it draws as the same element marked `mod-error`.
	 */
	it('hides every tooltip under the body class but the section markers’ warning and the app’s errors', () => {
		const tooltips = section('Tooltips');
		expect(tooltips.includes('!important')).toBe(false);
		expect(
			declarations(
				'body.snowflake-method-hide-tooltips .tooltip:not(.snowflake-method-boundary-tooltip):not(.mod-error)',
			),
		).toContain('display: none');
		expect(styles).not.toMatch(/hide-tooltips \.tooltip\s*\{/u);
		expect(styles).not.toMatch(/hide-tooltips \.tooltip:not\(\.snowflake-method-boundary-tooltip\)\s*\{/u);
	});

	/**
	 * The page's alignment reaches the multi-line fields only under the body
	 * class the plugin puts there, and only as far as the plugin's own
	 * dashboard and dialogs: a textarea of the app's or another plugin's is
	 * never justified by this file.
	 */
	it('justifies the dashboard’s and the dialogs’ fields under the body class alone', () => {
		const fields = section('Field alignment');
		expect(fields.includes('!important')).toBe(false);
		expect(fields.includes(':has(')).toBe(false);
		for (const selector of [
			'body.snowflake-method-justify-fields .snowflake-method-dashboard textarea',
			'body.snowflake-method-justify-fields .snowflake-method-form-modal textarea',
			'body.snowflake-method-justify-fields .snowflake-method-compact-form-modal textarea',
			'body.snowflake-method-justify-fields textarea.snowflake-method-corkboard-recovered-text',
		]) {
			expect(declarations(selector)).toContain('text-align: justify');
		}
		// The prose boxes and the quoted paragraphs are justified with them.
		expect(fields).toContain('body.snowflake-method-justify-fields .snowflake-method-prose-box');
		expect(fields).toContain('body.snowflake-method-justify-fields .snowflake-method-source-summary-content');
		// The indent, under its own body class: on the prose boxes alone,
		// for every paragraph and only where the browser can set every
		// paragraph in, and on the quoted paragraphs with a box before each.
		// A textarea sets its first line in and no other, so none wears it.
		expect(fields).toContain('@supports (text-indent: 1em each-line)');
		expect(fields).toContain('body.snowflake-method-indent-fields .snowflake-method-prose-box');
		expect(fields).toContain('text-indent: var(--snowflake-method-field-indent, 0) each-line');
		const rules = fields.replace(/\/\*[\s\S]*?\*\//g, ' ');
		expect(rules).not.toMatch(/textarea[^{]*\{[^}]*text-indent/u);
		expect(fields).toContain('body.snowflake-method-indent-fields .snowflake-method-source-summary-content');
		// The placeholder is the box's prompt, not a paragraph: flush.
		expect(rules).toMatch(/body\.snowflake-method-indent-fields \.snowflake-method-prose-box:empty \{\s*text-indent: 0;/u);
		// Every textarea rule in the section stands under a body class.
		const selectors = fields
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.replace(/@supports[^{]*\{/g, ' ')
			.split('}')
			.map((entry) => entry.split('{')[0] ?? '')
			.flatMap((list) => list.split(','))
			.map((one) => one.trim())
			.filter((one) => one.includes('textarea'));
		expect(selectors.length).toBeGreaterThan(0);
		for (const selector of selectors) {
			expect(selector, selector).toMatch(/^body\.snowflake-method-justify-fields /u);
		}
	});

	/**
	 * A note of Obsidian's own wears the stream's dress from the same
	 * variables, under the one marker class the plugin puts on the leaf, with
	 * the theme's own values as fallback -- so a value left at the theme's
	 * renders exactly as the theme would, as the stream's rules promise.
	 */
	it('dresses a note of Obsidian’s own from the stream’s variables under the marker class', () => {
		const notes = section('Note typography');
		expect(notes.includes('!important')).toBe(false);
		expect(notes.includes(':has(')).toBe(false);
		expect(notes).not.toMatch(/text-indent/u);
		const typed = declarations(
			'.snowflake-method-note-dressed .markdown-source-view.mod-cm6 .cm-scroller',
		);
		expect(typed).toContain('font-family: var(--snowflake-method-manuscript-font, var(--font-text))');
		expect(typed).toContain('--snowflake-method-manuscript-line-height');
		expect(declarations('.snowflake-method-note-dressed .markdown-source-view')).toContain(
			'font-size: var(--snowflake-method-manuscript-font-size, var(--font-preferred-size))',
		);
		expect(declarations('.snowflake-method-note-dressed .markdown-preview-section > div > p')).toContain(
			'text-align: var(--snowflake-method-manuscript-align, start)',
		);
		expect(declarations('.snowflake-method-note-dressed .markdown-preview-section > div > p::before')).toContain(
			'width: var(--snowflake-method-manuscript-indent, 0)',
		);
		expect(declarations('.snowflake-method-note-dressed .markdown-source-view .cm-line.snowflake-method-paragraph-line')).toContain(
			'hyphens: var(--snowflake-method-manuscript-hyphens, manual)',
		);
		// The ground outweighs the app's own `.workspace-split.mod-root .view-content`,
		// and the header's its `.is-focused .workspace-leaf.mod-active .view-header`;
		// both under the stream's own name, which the bar above the note paints.
		expect(declarations('.snowflake-method-note-dressed.snowflake-method-note-dressed.snowflake-method-note-dressed .view-content')).toContain(
			'background-color: var(--snowflake-method-manuscript-surface)',
		);
		expect(declarations('.snowflake-method-note-dressed.snowflake-method-note-dressed.snowflake-method-note-dressed.snowflake-method-note-dressed .view-header')).toContain(
			'background-color: var(--snowflake-method-manuscript-surface)',
		);
		expect(declarations('body.theme-light .snowflake-method-note-dressed')).toContain(
			'--snowflake-method-manuscript-surface',
		);
		// The properties and the section markers keep the app's own type, and
		// the empty section's placeholder takes the prose's.
		const chrome = declarations('.snowflake-method-note-dressed .metadata-container');
		expect(chrome).toContain('font-size: var(--font-preferred-size)');
		expect(chrome).toContain('font-family: var(--font-text)');
		expect(chrome).toContain('line-height: var(--line-height-normal)');
		expect(declarations('.snowflake-method-note-dressed .snowflake-managed-section-placeholder')).toContain(
			'font-family: var(--snowflake-method-manuscript-font, var(--font-text))',
		);
		// What the theme paints a shade off the page is painted a shade off the
		// tint: the generated block, a file embed and, through the name the
		// app's own rules read, code inline and in blocks. Without a tint the
		// theme's own stand, through the fallbacks.
		expect(declarations('.snowflake-method-note-dressed .cm-line.snowflake-managed-generated-line')).toContain(
			'background-color: var(--snowflake-method-manuscript-surface-alt, var(--background-primary-alt))',
		);
		expect(declarations('.snowflake-method-note-dressed .file-embed')).toContain(
			'var(--snowflake-method-manuscript-surface-alt, var(--background-primary-alt))',
		);
		const code = declarations('.snowflake-method-note-dressed');
		expect(code).toContain('--code-background: var(');
		expect(code).toContain('--snowflake-method-theme-code-background');
		const alt = declarations('body.theme-light .snowflake-method-note-dressed');
		expect(alt).toContain('--snowflake-method-manuscript-surface-alt: color-mix(');
		expect(alt).toContain('var(--snowflake-method-manuscript-tint-light)');
		expect(declarations('body.theme-dark .snowflake-method-note-dressed')).toContain(
			'var(--snowflake-method-manuscript-tint-dark)',
		);
		// The grid lines are the stream's alone: a heading or a marker in a
		// note of the app's own sits at a pitch of its own, and rules through
		// it read as a mess, so no rule is drawn on a note at all.
		expect(notes).not.toMatch(/::after|mask-image|is-guide-/u);
		// Every rule in the section stands under the marker class or names it.
		const selectors = notes
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.split('}')
			.map((entry) => entry.split('{')[0] ?? '')
			.flatMap((list) => list.split(','))
			.map((one) => one.trim())
			.filter((one) => one.length > 0);
		expect(selectors.length).toBeGreaterThan(0);
		for (const selector of selectors) {
			expect(selector, selector).toContain('.snowflake-method-note-dressed');
		}
	});

	/**
	 * The same paragraph breaks into the same rows in the stream and in a
	 * dressed note beside it: both editors let a space hang at a row's end
	 * rather than carry it to the next row, a table cell's editor keeping the
	 * app's own, and the stream's column is a note's -- the measure as a text
	 * column, inside the app's own margin across a note.
	 */
	it('breaks a paragraph into the same rows in the stream and in a dressed note', () => {
		expect(declarations('.snowflake-method-two-faces .cm-content.cm-lineWrapping')).toContain('white-space: pre-wrap');
		expect(
			declarations('.snowflake-method-note-dressed .markdown-source-view.mod-cm6 .cm-content.cm-lineWrapping:not(.cm-table-widget *)'),
		).toContain('white-space: pre-wrap');
		const column = declarations('.snowflake-method-manuscript-end').replace(/\s+/gu, ' ');
		expect(column).toContain('--snowflake-method-page-margin: var(--file-margins-x, var(--size-4-8))');
		expect(column).toContain(
			'max-width: calc( var(--snowflake-method-manuscript-width, var(--file-line-width)) + var(--snowflake-method-page-margin) * 2 )',
		);
		expect(column).toContain('padding-inline: var(--snowflake-method-page-margin)');
		expect(styles).not.toContain('--snowflake-method-manuscript-box');
	});

	/**
	 * The stream derives the same shade off its tinted page for code and
	 * embeds, and takes the theme's code background down from the body first,
	 * so a leaf without a tint shows the theme's own.
	 */
	it('paints code a shade off the stream’s tinted page, and the theme’s own without one', () => {
		expect(styles).toContain('--snowflake-method-theme-code-background: var(--code-background)');
		const leaf = declarations(".workspace-leaf-content[data-type='snowflake-method-manuscript']");
		expect(leaf).toContain('--code-background: var(');
		expect(leaf).toContain('--snowflake-method-manuscript-surface-alt');
		expect(leaf).toContain('--snowflake-method-theme-code-background');
		const light = declarations("body.theme-light .workspace-leaf-content[data-type='snowflake-method-manuscript']");
		expect(light).toContain('--snowflake-method-manuscript-surface-alt: color-mix(');
		expect(light).toContain('var(--snowflake-method-manuscript-tint-light)');
		expect(declarations("body.theme-dark .workspace-leaf-content[data-type='snowflake-method-manuscript']")).toContain(
			'var(--snowflake-method-manuscript-tint-dark)',
		);
		expect(declarations(".workspace-leaf-content[data-type='snowflake-method-manuscript'] .file-embed")).toContain(
			'var(--snowflake-method-manuscript-surface-alt, var(--background-primary-alt))',
		);
	});

	/**
	 * A pane too narrow for a margin holds the cards back as it holds the
	 * milestone labels back, hidden rather than gone, and leaves only a
	 * proposal being written, or a card whose form is open, on view.
	 */
	it('holds the margin cards back in a tight pane, all but the ones being written', () => {
		expect(styles.includes('is-revision-overlay')).toBe(false);
		const held = '.is-revision-tight .snowflake-method-rail-card:not(.is-draft):not(.is-editing)';
		expect(declarations(held)).toContain('visibility: hidden');
		expect(declarations(held)).not.toContain('display');
		const rail = declarations('.is-revision-tight .snowflake-method-revision-rail');
		expect(rail).toContain('right: 0');
		expect(rail).toContain('left: auto');
		expect(declarations('.is-milestone-tight .snowflake-method-milestone::before')).toContain(
			'visibility: hidden',
		);
	});

	/**
	 * A dialog's text box grows and shrinks with its words from the floor
	 * its own rule gives it, without a handle, and the rule outweighs the
	 * compact forms' own by naming it again after it.
	 */
	it('fits the dialogs’ text boxes to their words', () => {
		const rules = styles
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.replace(/\s+/gu, ' ')
			.split('}')
			.map((entry) => {
				const [head = '', body = ''] = entry.split('{');
				return { head: head.trim(), body };
			});
		const growing = rules.filter((rule) => rule.body.includes('field-sizing: content'));
		expect(growing).toHaveLength(1);
		const [grow] = growing;
		expect(grow?.head).toContain('.modal:is(.snowflake-method-form-modal, .snowflake-method-compact-form-modal) .modal-content textarea');
		expect(grow?.head).toContain('textarea.snowflake-method-corkboard-recovered-text');
		expect(grow?.body).toContain('resize: none');
		// The compact forms' rule, handle and all, comes first and is named
		// again by the growing rule after it, which so outweighs it.
		const compact = '.modal:is( .snowflake-method-project-modal, .snowflake-method-compact-form-modal ) .modal-content.snowflake-method-project-form textarea';
		const formRule = rules.findIndex((rule) => rule.head === compact && rule.body.includes('resize: vertical'));
		expect(formRule).toBeGreaterThan(-1);
		expect(grow?.head).toContain(compact);
		expect(rules.indexOf(grow!)).toBeGreaterThan(formRule);
	});

	/**
	 * The bar above a dressed note is the stream's bar, so the section owns
	 * no look of its own: only the room the leaf's content gives up, and only
	 * while the bar stands before it.
	 */
	it('dresses the prose box as the app dresses a textarea, and holds the quoted text to half the frame', () => {
		const box = declarations(':where(.snowflake-method-prose-box)');
		expect(box).toContain('background: var(--background-modifier-form-field)');
		expect(box).toContain('white-space: pre-wrap');
		expect(box).toContain('overflow-y: auto');
		// Selectable, as the app makes its own editors: an older WebKit puts
		// no caret in text the body has made unselectable.
		expect(box).toContain('-webkit-user-select: text');
		expect(box).toContain('user-select: text');
		expect(declarations('.snowflake-method-prose-box:empty::before')).toContain('content: attr(data-placeholder)');
		expect(declarations('.snowflake-method-prose-box.is-disabled')).toContain('cursor: not-allowed');
		expect(declarations('.snowflake-method-source-summary-body')).toContain(
			'max-height: calc(var(--snowflake-method-frame-height, 100vh) / 3)',
		);
		expect(declarations('.snowflake-method-source-summary-body')).toContain('overflow-y: auto');
		// Both hold the scrollbar's room on both edges, so neither jumps when
		// one of them scrolls and the other does not.
		expect(declarations('.snowflake-method-source-summary-body')).toContain('scrollbar-gutter: stable both-edges');
		expect(box).toContain('scrollbar-gutter: stable both-edges');
		expect(declarations('.snowflake-method-guided-section > p.snowflake-method-length-hint')).toContain('max-width: none');
		// Hidden bars leave the room as padding, a bar's native width, which
		// the hiding rule lets the plugin's probe go on measuring.
		expect(declarations('body.snowflake-method-hide-scrollbars .snowflake-method-prose-box')).toContain(
			'padding-inline: calc(var(--size-4-2) + var(--snowflake-method-scrollbar-native-width, 0px))',
		);
		expect(declarations('body.snowflake-method-hide-scrollbars .snowflake-method-source-summary-body')).toContain(
			'--snowflake-method-scrollbar-native-width',
		);
		// The quote's header stands where the hints' header above it does, the
		// same stripe and the same inset, so the icons and the names line up;
		// the bar's room is the body's alone.
		const header = declarations('.snowflake-method-source-summary-header');
		expect(header).toContain('padding-inline: var(--size-4-4)');
		expect(header).not.toContain('--snowflake-method-scrollbar-native-width');
		expect(declarations('.snowflake-method-writing-hints')).toContain('padding: var(--size-4-3) var(--size-4-4)');
		for (const box of ['.snowflake-method-writing-hints', '.snowflake-method-source-summary']) {
			expect(declarations(box), box).toContain('border-inline-start: 3px solid var(--interactive-accent)');
		}
		// A one-line field on the dashboard keeps the same room, a picker's
		// inner box for it; a search box is left alone, and no dialog rule
		// takes the room at all: a dialog keeps the app's spacing.
		const oneLine = declarations(".snowflake-method-dashboard input[type='text']:not(.snowflake-method-option-picker-input)");
		expect(oneLine).toContain('padding-inline: calc(var(--size-4-2) + var(--snowflake-method-scrollbar-native-width, 0px))');
		expect(declarations('.snowflake-method-dashboard .snowflake-method-option-picker-values')).toBe(oneLine);
		expect(styles).not.toMatch(/input\[type='search'\][^{]*\{[^}]*--snowflake-method-scrollbar-native-width/u);
		const rulesOnly = styles.replace(/\/\*[\s\S]*?\*\//g, ' ').split('}').map((entry) => entry.split('{'));
		for (const [selector = '', body = ''] of rulesOnly) {
			if (selector.includes('.modal') && body.includes('--snowflake-method-scrollbar-native-width')) {
				throw new Error(`a dialog rule keeps the scrollbar's room: ${selector.trim()}`);
			}
		}
		expect(declarations('body.snowflake-method-hide-scrollbars *:not(.snowflake-method-scrollbar-probe)')).toContain('scrollbar-width: none');
		expect(styles).toContain('body.snowflake-method-hide-scrollbars :not(.snowflake-method-scrollbar-probe)::-webkit-scrollbar');
		expect(declarations('.snowflake-method-source-summary-content')).toContain('font-size: var(--font-text-size)');
		// The summary boxes and the synopsis boxes take the column by one rule,
		// from a floor of six lines, and the boxes inside the steps' sections
		// share the type and the floor without taking a column. No rule gives
		// any of the five a height of its own any more.
		const floor = 'min-height: calc(6 * 1.65em + 2 * var(--size-4-2))';
		const stepBox = declarations('.snowflake-method-field .snowflake-method-synopsis-input');
		expect(stepBox).toContain('flex: 1 1 0');
		expect(stepBox).toContain(floor);
		expect(stepBox).toContain('resize: none');
		expect(declarations('.snowflake-method-field .snowflake-method-one-sentence-summary-input')).toBe(stepBox);
		expect(declarations('.snowflake-method-field .snowflake-method-one-paragraph-summary-input')).toBe(stepBox);
		const sectionBox = declarations('.snowflake-method-field .snowflake-method-description-input');
		expect(sectionBox).not.toContain('flex:');
		for (const line of [floor, 'font-size: var(--font-text-size)', 'line-height: 1.65', 'resize: none']) {
			expect(stepBox).toContain(line);
			expect(sectionBox).toContain(line);
		}
		expect(declarations('.snowflake-method-field .snowflake-method-audience-reasons-input')).toBe(sectionBox);
		expect(styles).not.toMatch(
			/snowflake-method-(?:one-(?:sentence|paragraph)-summary|audience-reasons|description)-input[^{]*\{[^}]*(?<![-\w])height:/u,
		);
		expect(declarations('.snowflake-method-length-hint + .snowflake-method-actions')).toContain('margin-top: var(--size-4-4)');
	});

	/**
	 * The custom field pane's frame is drawn over its sections as the
	 * definition panes draw theirs over the trees, so their headings start on
	 * the same pixel; a pane too narrow for the definition panes' two columns
	 * lays its templates down the page as they lay their trees.
	 */
	it('frames the custom field pane as the definition panes are framed', () => {
		const frame = declarations('.snowflake-method-template-panel .snowflake-method-template-sections');
		expect(frame).toContain('border: 0');
		expect(frame).toContain('position: relative');
		const stroke = declarations('.snowflake-method-template-panel .snowflake-method-template-sections::after');
		expect(stroke).toContain('border: 1px solid var(--background-modifier-border)');
		expect(stroke).toContain('pointer-events: none');
		expect(stroke).toContain('z-index: 3');
		// The narrow block for this pane stands after the pane's own rules,
		// which an earlier block of the same weight would not outweigh.
		const query = '@container snowflake-dashboard (max-width: 60rem) {';
		const blocks: { start: number; body: string }[] = [];
		for (let at = styles.indexOf(query); at !== -1; at = styles.indexOf(query, at + 1)) {
			blocks.push({ start: at, body: styles.slice(at + query.length).split(/\n\}\n/u)[0] ?? '' });
		}
		const narrow = blocks.find((block) => block.body.includes('.snowflake-method-template-scroll {'));
		expect(narrow).toBeDefined();
		expect(styles.indexOf('.snowflake-method-template-scroll {')).toBeLessThan(narrow?.start ?? -1);
		expect(narrow?.body).toMatch(/\.snowflake-method-template-panel \.snowflake-method-template-sections \{[^}]*flex: 0 0 auto;[^}]*border: 1px solid/u);
		expect(narrow?.body).toMatch(/\.snowflake-method-template-panel \.snowflake-method-template-sections::after \{[^}]*content: none/u);
		expect(narrow?.body).toMatch(/\.snowflake-method-template-scroll \{[^}]*overflow-y: visible;[^}]*padding-inline-end: 0/u);
	});

	it('gives the note toolbar its room without a look of its own', () => {
		const toolbar = section('Note toolbar');
		expect(toolbar.includes('!important')).toBe(false);
		expect(toolbar.includes(':has(')).toBe(false);
		const room = declarations('.snowflake-method-note-toolbar + .view-content');
		expect(room).toContain('flex: 1 1 auto');
		expect(room).toContain('min-height: 0');
		expect(room).toContain('height: auto');
		expect(toolbar).not.toMatch(/background|color:|font/u);
		// The header over the bar keeps the app's height over the stream and a
		// note alike, so the lines under the two bars stand level.
		expect(
			declarations(
				".workspace-leaf-content[data-type='snowflake-method-manuscript'] > .view-header",
			),
		).toContain('flex-shrink: 0');
		expect(declarations('.snowflake-method-note-dressed > .view-header')).toContain('flex-shrink: 0');
	});

	/**
	 * The typography's choice rows share the sliders' column, but the scope
	 * row above them keeps the width the app fits to the answer chosen, as the
	 * explorer's scope and the statistics' do: `width: auto` would size it to
	 * its longest answer instead, a gap before the chevron whenever a shorter
	 * one is chosen.
	 */
	it('leaves the typography scope at the width the app fits to its answer', () => {
		// The background scope's row too, which marks itself for it.
		const column = declarations(
			'.snowflake-method-typography-settings .setting-item:not(.snowflake-method-settings-dress + .setting-item):not(.snowflake-method-tint-scope-row) select.dropdown',
		);
		expect(column).toContain('width: var(--snowflake-method-presentation-control, 100px)');
		expect(styles).not.toMatch(/settings-dress\s*\+\s*\.setting-item\s+select\.dropdown\s*\{/u);
	});

	/**
	 * The ground past the typography, read only under the classes the plugin
	 * puts on a window's body for a mode with a tint: over the whole app on
	 * the body itself, over the plugin alone on what it draws. Both rebuild
	 * the app's own palette from the tint, and the plugin's reach derives
	 * again what the app derives once on the body.
	 */
	it('carries the ground past the typography only under the body’s reach classes', () => {
		const scope = section('Background scope');
		const drawn = [
			".workspace-leaf-content[data-type='snowflake-method-manuscript']",
			".workspace-tab-header[data-type='snowflake-method-manuscript']",
			'.snowflake-method-note-dressed',
			'.snowflake-method-note-dressed-tab',
			".workspace-leaf-content[data-type^='snowflake-method-']",
			".workspace-tab-header[data-type^='snowflake-method-']",
			'.snowflake-method-dialog',
			'.snowflake-method-suggestions',
		];
		for (const target of drawn) expect(scope).toContain(target);
		for (const cls of Object.values(TINT_REACH_CLASSES)) expect(scope).toContain(cls);
		for (const mode of ['light', 'dark']) {
			expect(scope).toContain(`body.theme-${mode}.snowflake-method-tint-obsidian-${mode},`);
			expect(scope).toContain(`--snowflake-method-tint: var(--snowflake-method-manuscript-tint-${mode});`);
		}
		// Every tint read sits under a reach class: the body's own variables
		// are written only for a mode that has one.
		const blocks = scope.replace(/\/\*[\s\S]*?\*\//gu, ' ').split('}');
		for (const block of blocks.filter((one) => one.includes('--snowflake-method-manuscript-tint-'))) {
			expect(block).toMatch(/snowflake-method-tint-(?:typography|snowflake|obsidian)-(?:light|dark)/u);
		}
		// The app's ramp, rebuilt from the tint toward the text, and the names
		// the app paints by set from it.
		expect(scope).toContain('--color-base-00: var(--snowflake-method-tint);');
		expect(scope).toContain('--color-base-30: color-mix(in srgb, var(--snowflake-method-tint), var(--color-base-100) 12%);');
		expect(scope).toContain('--background-primary: var(--color-base-00);');
		expect(scope).toContain('--background-modifier-border: var(--color-base-30);');
		expect(scope).toContain('--text-faint: var(--color-base-50);');
		// The plugin's reach derives the app's derived names again, the
		// buttons on a Mac from the borders as the app has them there.
		expect(scope).toContain('--modal-background: var(--background-primary);');
		expect(scope).toContain('--tab-background-active: var(--background-primary);');
		// The names derived from those in turn: a table's header rule, an
		// embedded base, the rail's ink, the option pickers' group headings.
		expect(scope).toContain('--table-header-border-color: var(--table-border-color);');
		expect(scope).toContain('--bases-table-header-background: var(--background-primary);');
		expect(scope).toContain('--bases-table-group-background: var(--background-primary-alt);');
		expect(scope).toContain('--nav-item-color: var(--text-muted);');
		expect(scope).toContain('--snowflake-method-list-heading-rule: 1px solid var(--background-modifier-border);');
		expect(scope).toContain('--snowflake-method-list-heading-color: var(--text-muted);');
		expect(scope).toContain('body.mod-macos.theme-light.snowflake-method-tint-snowflake-light');
		expect(scope).toContain('--interactive-normal: var(--background-modifier-border);');
		for (const mode of ['light', 'dark']) {
			// A view in a sidebar paints the sidebar's ground the app leaves
			// outside it, but never over a translucent window's glass, which
			// the app paints beneath everything and lifts in full screen.
			for (const solid of [':not(.is-translucent)', '.is-fullscreen']) {
				expect(
					declarations(
						`body.theme-${mode}.snowflake-method-tint-snowflake-${mode}${solid} .mod-sidedock .workspace-leaf-content[data-type^='snowflake-method-']`,
					),
				).toContain('background-color: var(--background-secondary)');
			}
			// Over the whole app the glass is the tint, at the app's strength.
			expect(
				declarations(`body.theme-${mode}.snowflake-method-tint-obsidian-${mode}.is-translucent`).replace(/\s+/gu, ' '),
			).toContain(
				'--workspace-background-translucent: color-mix( in srgb, var(--snowflake-method-tint) 60%, transparent );',
			);
		}
		expect(scope).not.toMatch(/snowflake-method-tint-snowflake-(?:light|dark)\s+\.mod-sidedock/u);
	});

	/**
	 * Within the typography's reach the stream, a dressed note and the tabs
	 * over both take the whole rebuilt palette at every scope, so the line
	 * under their bar is the same line at every reach, and a tab joins its
	 * page whether the tabs are in a row or stacked.
	 */
	it('tints the stream, a dressed note and their tabs alike at every reach', () => {
		const scope = section('Background scope');
		for (const mode of ['light', 'dark']) {
			const typography = `body.theme-${mode}.snowflake-method-tint-typography-${mode}\n\t:is(\n\t\t.workspace-leaf-content[data-type='snowflake-method-manuscript'],\n\t\t.workspace-tab-header[data-type='snowflake-method-manuscript'],\n\t\t.snowflake-method-note-dressed,\n\t\t.snowflake-method-note-dressed-tab\n\t)`;
			// The ramp, the names painted by, the aliases and the buttons.
			expect(scope.split(typography).length - 1).toBe(4);
			expect(scope).toContain(`body.mod-macos.theme-${mode}.snowflake-method-tint-typography-${mode}`);
		}
		// A tab joins its page in a row by the active face, stacked by the ground.
		expect(scope).toContain('--tab-background-active: var(--background-primary);');
		expect(scope).toContain('--background-primary: var(--color-base-00);');
	});

	/**
	 * A locked section marker steps back to a quarter of its strength and
	 * comes back when pointed at or when the caret is on its line; an
	 * unlocked one is left alone, and the fade honours reduced motion.
	 */
	it('fades locked section markers until they are looked at', () => {
		// The marker's parts fade, never the line, whose background is a share
		// of the tint behind a plugin-written block in source mode.
		expect(declarations('.cm-line.snowflake-managed-boundary-line.is-locked > *')).toContain('opacity: 0.25');
		expect(styles).not.toMatch(/boundary-line\.is-locked\s*\{[^}]*opacity/u);
		expect(declarations('.cm-line.snowflake-managed-boundary-line.is-locked:hover > *')).toContain('opacity: 1');
		expect(declarations('.cm-line.snowflake-managed-boundary-line.is-locked.cm-active > *')).toContain('opacity: 1');
		expect(styles).not.toMatch(/boundary-line\.is-unlocked[^{]*\{[^}]*opacity/u);
		expect(
			declarations('.snowflake-method-reduce-motion .cm-line.snowflake-managed-boundary-line.is-locked > *'),
		).toContain('transition: none');
	});

	/**
	 * A row's split button is as wide as its word, and Edit's width at the
	 * least: Open is wider in English, and a fixed width cut it at both ends.
	 * The foreshadowing table's pair is the same button, not halves of its
	 * cell with the words adrift in them.
	 */
	it('fits a row\u2019s split button to its word, in every table', () => {
		const split = declarations('.snowflake-method-character-split-button');
		expect(split).toMatch(/(?:^|\s)width: auto;/u);
		expect(split).toContain('flex: 0 0 auto');
		expect(split).toContain('min-width: 4.75rem');
		expect(styles).not.toMatch(/foreshadowing-table[^{]*\.snowflake-method-character-split-button\s*\{/u);
		expect(styles).not.toMatch(/foreshadowing-table\.has-actions-column[^{]*\.snowflake-method-table-actions\s*\{/u);
	});

	/**
	 * The chevron's seam is a border of one width on every side, coloured on
	 * the seam's side alone: the app's superellipse corners bend a one-sided
	 * border into a wedge of page colour, a finger wide on a phone.
	 */
	it('draws the split button\u2019s seam as a uniform border coloured on one side', () => {
		const trigger = declarations('.snowflake-method-character-action-menu-trigger');
		expect(trigger).toContain('border: 1px solid transparent');
		expect(trigger).toContain('border-inline-start-color: var(--background-modifier-border-hover)');
		expect(trigger).not.toMatch(/border-inline-start: 1px/u);
	});

	/**
	 * A table becomes cards when its own frame is too narrow for it, not when
	 * the dashboard is: a table held at its floor in a narrower frame ran past
	 * the frame's edge. The floors are a property the frame reads, and the
	 * card rules key on the frame's word, weighing what they did before.
	 */
	it('stacks a table into cards by its own frame, at the table\u2019s own floor', () => {
		expect(styles).toMatch(/--snowflake-method-table-floor: 40rem;\s*min-width: var\(--snowflake-method-table-floor\);/u);
		expect(declarations('.snowflake-method-table.has-actions-column')).toContain('--snowflake-method-table-floor: 52rem');
		// The foreshadowing table's columns are slim enough to share the member
		// tables' floors, with the buttons and without.
		expect(declarations('.snowflake-method-table.snowflake-method-foreshadowing-table')).toContain(
			'--snowflake-method-table-floor: 52rem',
		);
		expect(
			declarations('.snowflake-method-table.snowflake-method-foreshadowing-table:not(.has-actions-column)'),
		).toContain('--snowflake-method-table-floor: 40rem');
		expect(styles).not.toMatch(/min-width: (?:40|52|60)rem;/u);
		expect(declarations('.snowflake-method-table-wrap:where(.is-stacked)')).toContain('border: 0');
		expect(declarations(':where(.snowflake-method-table-wrap.is-stacked) > .snowflake-method-table-head')).toContain(
			'display: none',
		);
		expect(declarations(':where(.snowflake-method-table-wrap.is-stacked) .snowflake-method-table td')).toContain(
			'display: grid',
		);
		// A card's labels share one column whatever room a cell keeps at its
		// end: a share of the card, which the cards' list measures.
		expect(declarations(':where(.snowflake-method-table-wrap.is-stacked) .snowflake-method-table td')).toContain(
			'grid-template-columns: minmax(7rem, 34cqi) minmax(0, 1fr)',
		);
		expect(declarations(':where(.snowflake-method-table-wrap.is-stacked) .snowflake-method-table tbody')).toContain(
			'container-type: inline-size',
		);
		expect(
			declarations(':where(.snowflake-method-table-wrap.is-stacked) .snowflake-method-table td:not(:last-child)'),
		).toContain('border-inline-end: 0');
		// A category cell's lines all keep to the value column, one under
		// another and as close as the wide row's: the grid used to place the
		// second one under the label.
		expect(
			declarations(':where(.snowflake-method-table-wrap.is-stacked) .snowflake-method-table td.snowflake-method-member-categories'),
		).toContain('row-gap: 0');
		expect(
			declarations(
				':where(.snowflake-method-table-wrap.is-stacked) .snowflake-method-table td.snowflake-method-member-categories > .snowflake-method-member-category',
			),
		).toContain('grid-column: 2');
		// At its floor the foreshadowing description keeps room for a long
		// English word, 8.5rem, with the buttons' column and without it.
		const rem = (selector: string): number => Number(/(?:width|floor): ([\d.]+)rem/u.exec(declarations(selector))?.[1]);
		const fixed = ['name', 'related', 'role', 'place']
			.map((column) => rem(`col.snowflake-method-foreshadowing-column-${column}`))
			.reduce((sum, width) => sum + width, 0);
		const buttons = rem('col.snowflake-method-foreshadowing-column-actions');
		const floor = rem('.snowflake-method-table.snowflake-method-foreshadowing-table');
		const bare = rem('.snowflake-method-table.snowflake-method-foreshadowing-table:not(.has-actions-column)');
		expect(floor - fixed - buttons).toBeGreaterThanOrEqual(8.5);
		expect(bare - fixed).toBeGreaterThanOrEqual(8.5);
		const narrow = styles
			.replace(/\/\*[\s\S]*?\*\//gu, ' ')
			.split('@container snowflake-dashboard (max-width: 42rem) {')
			.slice(1)
			.map((block) => block.split(/\n\}\n/u)[0] ?? '');
		expect(narrow.length).toBeGreaterThan(0);
		for (const block of narrow) expect(block).not.toMatch(/\.snowflake-method-table(?:[\s.:{>]|-wrap|-head)/u);
	});

	/**
	 * Folding the rail takes the words away and narrows it, and moves nothing
	 * else: the toggle, the headings and every row's frame, mark and count
	 * stand where they stood open. So the folded rules may not set the rail's
	 * padding, the toggle's place, the scroller's reach, a heading's columns
	 * or a row's padding and height; a row only lays its two marks at its
	 * ends, in the open row's own columns, and the folded rail is as wide as
	 * two circles and the open row's gap inside the two paddings and hairlines.
	 */
	it('folds the rail without moving its toggle, its headings or its rows', () => {
		const sheet = styles.replace(/\/\*[\s\S]*?\*\//gu, ' ');
		const folded = sheet
			.split('}')
			.map((entry) => entry.split('{'))
			.filter(([selector]) => (selector ?? '').includes('is-rail-compact'))
			.map(([selector, body]) => ({ selector: (selector ?? '').trim().replace(/\s+/gu, ' '), body: body ?? '' }));
		const still = [
			/\.snowflake-method-step-nav$/u,
			/\.snowflake-method-step-nav-head$/u,
			/\.snowflake-method-step-nav-scroll$/u,
			/button\.snowflake-method-rail-group-header$/u,
		];
		for (const { selector } of folded) {
			for (const pattern of still) expect(selector).not.toMatch(pattern);
		}
		const open = declarations('.snowflake-method-dashboard button.snowflake-method-step-button');
		expect(open).toContain('grid-template-columns: 1.75rem minmax(0, 1fr) 1.75rem');
		const row = declarations('.snowflake-method-dashboard:where(.is-rail-compact) button.snowflake-method-step-button');
		expect(row).toContain('grid-template-columns: 1.75rem 1.75rem');
		expect(row).toContain('justify-content: space-between');
		expect(row).not.toMatch(/padding|min-height|gap/u);
		expect(declarations(':where(.snowflake-method-dashboard.is-rail-compact) .snowflake-method-project-footer')).not.toContain(
			'margin',
		);
		// Two 28px circles and the open row's 8px gap, inside a row's 8px padding
		// and hairline on each side, inside the rail's own: 100px.
		expect(declarations(':where(.snowflake-method-dashboard.is-rail-compact) .snowflake-method-layout')).toContain(
			'grid-template-columns: 6.25rem minmax(0, 1fr)',
		);
		expect(6.25 * 16).toBe(28 + 8 + 28 + 2 * (8 + 1) + 2 * (8 + 1));
		// A workspace row keeps its sparkles' room folded, so the rows below it stay put.
		expect(declarations('.snowflake-method-dashboard button.snowflake-method-workspace-entry')).toContain('padding-block: 0.9rem');
		// The footer reaches the walls through the open rail's padding at every width.
		const narrow = sheet.split('@container snowflake-dashboard (max-width: 42rem) {')[1]?.split(/\n\}\n/u)[0] ?? '';
		expect(narrow).not.toContain('.snowflake-method-project-footer');
	});

	/**
	 * The rail's scrollbar stands outside it, just past its border in the gap
	 * before the main column: the scroller reaches through the end padding,
	 * the hairline and the bar's own width, and pads the rows back. So no bar
	 * changes the rail's padding, the rows' width or where the toggle stands,
	 * and the gap is never narrower than the bar and a little air.
	 */
	it('stands the rail\u2019s scrollbar outside its frame, in the gap before the main column', () => {
		const flat = (rule: string): string => rule.replace(/\s+/gu, ' ');
		const nav = declarations('.snowflake-method-step-nav');
		expect(nav).not.toContain('scrollbar-width');
		expect(nav).toContain('padding: var(--size-4-2) var(--size-4-2) 0');
		const scroller = flat(declarations('.snowflake-method-step-nav-scroll'));
		expect(scroller).toContain(
			'margin-inline-end: calc( -1 * (var(--size-4-2) + 1px + var(--snowflake-method-scrollbar-width, 0px)) )',
		);
		expect(scroller).toContain('padding-inline-end: calc(var(--size-4-2) + 1px)');
		expect(scroller).toContain('scrollbar-gutter: stable');
		expect(declarations('.snowflake-method-step-nav-head')).toContain('padding-inline-end: var(--size-4-2)');
		expect(declarations('.snowflake-method-step-nav-head')).not.toContain('scrollbar-width');
		expect(declarations('.snowflake-method-project-footer')).not.toContain('scrollbar-width');
		const gaps = styles
			.replace(/\/\*[\s\S]*?\*\//gu, ' ')
			.split('}')
			.filter((entry) => {
				const parts = entry.split('{');
				return (parts[parts.length - 2] ?? '').trim() === '.snowflake-method-layout';
			})
			.map((entry) => flat(/gap:([^;]+);/u.exec(entry)?.[1] ?? ''));
		expect(gaps).toEqual([
			' max( var(--size-4-5), calc(var(--snowflake-method-scrollbar-width, 0px) + var(--size-4-1)) )',
			' max( var(--size-4-3), calc(var(--snowflake-method-scrollbar-width, 0px) + var(--size-4-1)) )',
		]);
	});

	/**
	 * A rail row's circle at its end is the mark at its start over again: as
	 * large, and filled with no line round it, since a line drew it a size
	 * larger to the eye. Only there: the same circle on a board's lane or a
	 * card keeps its own size and its ring. A warning stands in a step's disc
	 * as its status would, tinted orange, its sign drawn as the marks' icons
	 * are. The link arrow stands alone with nothing behind it, which its own
	 * rule says later in the sheet at the same weight.
	 */
	it('draws a rail row\u2019s end circle as the mark at its start: as large, filled, with no line, a warning too', () => {
		const mark = declarations('.snowflake-method-step-number');
		const disc = declarations('.snowflake-method-step-button .snowflake-method-step-indicator');
		for (const side of ['width', 'height']) {
			const size = new RegExp(`${side}: ([\\d.]+rem)`, 'u');
			expect(size.exec(disc)?.[1]).toBe(size.exec(mark)?.[1]);
		}
		expect(disc).toContain('border: 0');
		expect(mark).toContain('background: var(--background-modifier-border)');
		expect(disc.replace(/\s+/gu, ' ')).toContain(
			'background: var( --snowflake-method-rail-disc, var(--background-modifier-border) )',
		);
		expect(declarations('.snowflake-method-step-indicator')).toContain('width: 1.25rem');
		expect(declarations('.snowflake-method-step-button .snowflake-method-step-indicator[data-digits=\'4\']')).toContain(
			'font-size: calc(var(--font-ui-smaller) * 0.75)',
		);
		const warning = '.snowflake-method-step-button .snowflake-method-step-indicator.has-managed-section-issue';
		expect(declarations(warning)).toContain('background: rgba(var(--color-orange-rgb), 0.15)');
		const sign = declarations(`${warning} svg`);
		const icon = declarations('.snowflake-method-worldbuilding-icon svg');
		for (const side of ['width: var(--icon-s)', 'height: var(--icon-s)']) {
			expect(sign).toContain(side);
			expect(icon).toContain(side);
		}
		expect(sign).toContain('stroke-width: var(--icon-s-stroke-width)');
		const discAt = styles.indexOf('.snowflake-method-step-button .snowflake-method-step-indicator {');
		const link = '.snowflake-method-step-indicator.snowflake-method-step-link-mark';
		expect(declarations(link)).toContain('background: transparent');
		expect(styles.indexOf(`${link} {`)).toBeGreaterThan(discAt);
		// A status mark takes the row's ink on its disc, over the status
		// colours set later at a lighter weight; a warning keeps its own.
		const status = '.snowflake-method-step-button .snowflake-method-step-indicator[data-status]:not(.has-managed-section-issue)';
		const flat = styles.replace(/\s+/gu, ' ');
		expect(flat).toContain(`${status} { color: inherit; }`);
		expect(flat.indexOf(`${status} {`)).toBeGreaterThan(
			flat.indexOf(".snowflake-method-step-indicator[data-status='skipped'] {"),
		);
		expect(flat).toContain(
			".snowflake-method-step-button .snowflake-method-step-indicator[data-status='not-started']::after { background: currentColor; }",
		);
	});

	/**
	 * The explorer section dresses Obsidian's own rows, where a colour of
	 * the plugin's own would clash with every theme: tokens alone, and
	 * nothing the explorer's own rules say is overruled.
	 */
	it('dresses the file explorer in the theme’s own tokens', () => {
		const explorer = section('File explorer');
		expect(explorer).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/iu);
		expect(explorer.includes('!important')).toBe(false);
		expect(explorer.includes(':has(')).toBe(false);
		expect(declarations('.nav-files-container .snowflake-method-explorer-count')).toContain('margin-inline-start: auto');
		expect(declarations('.nav-files-container .snowflake-method-explorer-count')).toContain('tabular-nums');
		expect(declarations('.nav-files-container .snowflake-method-explorer-count')).toContain('align-self: center');
		// Dressed as the app's own type tag, by the tag's variables.
		expect(declarations('.nav-files-container .snowflake-method-explorer-count')).toContain('color: var(--nav-tag-color)');
		expect(declarations('.nav-files-container .snowflake-method-explorer-count')).toContain('font-weight: var(--nav-tag-weight)');
		expect(declarations('.nav-files-container .snowflake-method-explorer-count')).toContain('background-color: var(--nav-tag-background)');
		expect(declarations('.nav-files-container .snowflake-method-explorer-count')).toContain('border-radius: var(--nav-tag-radius)');
		expect(declarations('.nav-files-container .snowflake-method-explorer-count')).toContain('font-size: 9px');
		expect(declarations('.nav-files-container .snowflake-method-explorer-count')).toContain('letter-spacing: 0.05em');
		expect(declarations('.nav-files-container .snowflake-method-explorer-count')).not.toContain('var(--font-monospace)');
		expect(declarations('.nav-files-container .snowflake-method-explorer-count')).toContain('padding: 0 var(--size-4-1)');
		expect(declarations('.snowflake-method-explorer-arranging .tree-item-self:not(.snowflake-method-explorer-row)')).toContain('pointer-events: none');
		expect(declarations('.snowflake-method-explorer-drag .tree-item-self:not(.snowflake-method-explorer-sibling)')).toContain('pointer-events: none');
		expect(declarations('.nav-files-container')).toContain('scrollbar-gutter: stable');
		expect(declarations('.snowflake-method-explorer-immersive .tree-item-self.snowflake-method-explorer-covered:not(.is-being-renamed) .tree-item-inner')).toContain('color: transparent');
		expect(declarations('.snowflake-method-explorer-immersive .tree-item-self.snowflake-method-explorer-covered .snowflake-method-explorer-count')).toContain('opacity: 0');
		expect(explorer.includes('animation')).toBe(false);
		expect(declarations('.nav-files-container .tree-item[data-snowflake-method-drop]::after')).toContain('var(--interactive-accent)');
		expect(declarations('.nav-files-container .tree-item[data-snowflake-method-drop]::after')).toContain('pointer-events: none');
	});

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
		// The symbols and the words stand together at the toolbar's end, in the end group every balanced
		// toolbar carries; no symbol of its own carries the margin that once sent the rest after it.
		expect(declarations('.snowflake-method-balanced-toolbar > .snowflake-method-toolbar-end')).toContain('justify-self: end');
		expect(styles).not.toContain('.snowflake-method-timeline-view-edit {');
		expect(styles).not.toContain('.snowflake-method-beat-sheet-export {');
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
	 * rule runs level with the pool's. Each act's axis starts at its first node
	 * by a class the painter sets: the stylesheet may not ask which beat is
	 * first, since an act's header and foot stand between the rows. It runs on
	 * to the foot of the last beat's cell, as a timeline's does: stopped at the
	 * last node, the last beat's cell looked cut off from the rest.
	 */
	it('sizes an act from the timeline\u2019s own measures and starts each axis by the painter\u2019s word', () => {
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
		const sheet = section('Beat sheet').replace(/\/\*[\s\S]*?\*\//g, ' ');
		// Nothing shortens the axis at its foot.
		expect(sheet).not.toContain('is-act-last');
		expect(sheet).not.toMatch(/axis::before\s*\{[^}]*inset-block-end/);
		expect(sheet).not.toMatch(/:(?:first|last|nth)-(?:of-type|child)/);
	});

	/**
	 * The timeline's own axis runs the whole of every cell. Two rules once
	 * trimmed it at the first and the last row by asking which row that was,
	 * and never matched one: a row stands among the table's head, its empty
	 * line and its tail, all boxes of one kind, so it is neither the first of
	 * its type nor the last. What they would have done had they matched is not
	 * what is wanted, so they are gone, and no rule asks a row its place again.
	 */
	it('runs a timeline\u2019s axis the whole of every cell, and asks no row whether it is the first or the last', () => {
		const timeline = section('Timeline').replace(/\/\*[\s\S]*?\*\//g, ' ');
		expect(declarations('.snowflake-method-timeline-axis::before')).toContain('inset-block: 0');
		expect(timeline).not.toMatch(/timeline-row:(?:first|last|nth)-(?:of-type|child)/);
		expect(timeline).not.toMatch(/timeline-axis::before\s*\{[^}]*inset-block-(?:start|end)/);
	});

	/**
	 * The line under an empty act starts under the act's words, and where those
	 * start is said once, from the header's own measures: written out again at
	 * the foot, it stayed put when a project that cannot be written hid the
	 * handle and the words moved. The words' colour and size are set over the
	 * lane name's the button also wears, so their rule outweighs that one
	 * rather than merely following it in the file.
	 */
	it('starts the line under an act where the act\u2019s words start, handle or none, and sets the words over the lane name\u2019s by weight', () => {
		const start = 'var(--snowflake-method-beat-sheet-act-words-start)';
		expect(declarations('.snowflake-method-beat-sheet-act-foot .snowflake-method-character-empty')).toContain(`padding-inline: ${start}`);
		const stated = declarations('.snowflake-method-beat-sheet');
		expect(stated).toContain('--snowflake-method-beat-sheet-act-words-start:');
		expect(stated).toContain('var(--snowflake-method-corkboard-action-size)');
		const header = declarations('.snowflake-method-beat-sheet-act');
		expect(header).toContain('padding-inline: var(--snowflake-method-beat-sheet-act-padding-start)');
		expect(header).toContain('gap: var(--snowflake-method-beat-sheet-act-gap)');
		// No handle, no room for one.
		expect(declarations('.snowflake-method-beat-sheet-act .snowflake-method-beat-sheet-act-handle:disabled')).toContain('display: none');
		const readOnly = declarations('.snowflake-method-beat-sheet.is-read-only');
		expect(readOnly).toContain('--snowflake-method-beat-sheet-act-words-start:');
		expect(readOnly).not.toContain('action-size');
		const weight = (selector: string): number => (selector.match(/\./g) ?? []).length;
		const title = '.snowflake-method-beat-sheet .snowflake-method-beat-sheet-act button.snowflake-method-beat-sheet-act-title';
		const laneName = '.snowflake-method-timeline button.snowflake-method-timeline-lane-name';
		expect(declarations(title)).toContain('color: var(--text-accent)');
		expect(declarations(title)).toContain('font-size: var(--font-ui-medium)');
		expect(declarations(laneName)).toContain('color: var(--text-muted)');
		expect(weight(title)).toBeGreaterThan(weight(laneName));
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

	/**
	 * The canvas is React Flow's, and a plugin's one stylesheet is all the app
	 * loads for it, so the library's own sheet is kept in this one. It is kept
	 * as the version installed ships it, with nothing changed but where it
	 * reaches: a library moved to another version without its sheet, or a rule
	 * of it mended by hand, is found here rather than on a canvas that draws
	 * its lines a little wrong.
	 */
	it('keeps the canvas engine\u2019s own stylesheet as the installed version ships it, and keeps it to the canvas', () => {
		const kept = section('Freeform engine');
		const scoped = scopeCss(engine, {
			under: '.snowflake-method-freeform-canvas',
			keyframes: 'snowflake-method-freeform-',
		});
		expect(scoped.length).toBeGreaterThan(engine.length);
		expect(kept.includes(scoped)).toBe(true);
		const selectors = [...kept.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{/g)]
			.map((rule) => (rule[1] ?? '').trim())
			.filter((prelude) => !prelude.startsWith('@') && !/^(?:from|to|\d+%)$/.test(prelude))
			.flatMap((prelude) => prelude.split(',').map((selector) => selector.trim()));
		expect(selectors.length).toBeGreaterThan(100);
		expect(selectors.filter((selector) => !selector.startsWith('.snowflake-method-freeform-canvas '))).toEqual([]);
		const animations = [...kept.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
		expect(animations).toEqual(['snowflake-method-freeform-dashdraw']);
		expect(kept).not.toMatch(/animation:\s*dashdraw/);
	});

	/**
	 * The frame a freeform node is sized by is the app's own canvas's: bands
	 * along every side and squares on every corner, none of them drawn, each
	 * sized on the screen by the measure the engine writes of the zoom. The
	 * chosen node wears the app's ring, two pixels of the accent. The whole of
	 * a node is a handle a line may land on, which the engine's own indicator
	 * class lets be pressed only while a line is drawn, so no rule here says
	 * when it may be.
	 */
	it('frames a freeform node as the app\u2019s canvas does, seen nowhere, and rings the chosen one by two pixels', () => {
		const band = declarations('.snowflake-method-freeform-canvas .react-flow__resize-control.snowflake-method-freeform-resize-line');
		expect(band).toContain('background-color: transparent');
		expect(band).toContain('border: 0');
		expect(band).toContain('var(--snowflake-method-freeform-unzoom, 1)');
		const sides = declarations('.snowflake-method-freeform-canvas .react-flow__resize-control.line.right.snowflake-method-freeform-resize-line');
		expect(sides).toContain('width: var(--snowflake-method-freeform-reach)');
		expect(sides).toContain('transform: none');
		expect(declarations('.snowflake-method-freeform-canvas .react-flow__resize-control.handle.right.snowflake-method-freeform-resize-handle'))
			.toContain('right: calc(-1 * var(--snowflake-method-freeform-reach-out))');
		expect(declarations('.snowflake-method-freeform-canvas .snowflake-method-freeform-flow.is-connecting .react-flow__resize-control'))
			.toContain('pointer-events: none');
		const whole = declarations('.snowflake-method-freeform-canvas .react-flow__handle.snowflake-method-freeform-handle-body');
		expect(whole).toContain('inset: 0');
		expect(whole).not.toContain('pointer-events');
		for (const selector of ['.snowflake-method-freeform-face.is-selected', '.snowflake-method-freeform-face.is-frame.is-selected']) {
			expect(declarations(selector), selector).toContain('0 0 0 2px var(--interactive-accent)');
		}
		// The card kinds' rule names them inside :is(), which the splitter above cannot read: found by its text.
		const cards = '.snowflake-method-freeform-face:is(.is-scene, .is-card, .is-task, .is-foreshadowing, .is-revision, .is-sticky).is-selected {';
		const from = styles.indexOf(cards);
		expect(from).toBeGreaterThan(-1);
		expect(styles.slice(from, styles.indexOf('}', from))).toContain('box-shadow: 0 0 0 2px var(--interactive-accent)');
		// On the card inside a face the ring would be cut off at the face's edge, so the card wears the colour alone.
		const card = declarations('.snowflake-method-freeform-face.is-sticky.is-selected > .snowflake-method-sticky-card');
		expect(card).toContain('border-color: var(--interactive-accent)');
		expect(card).not.toContain('box-shadow');
	});

	it('picks a line\u2019s look by sight on one line with its name, every such row\u2019s looks one width', () => {
		const row = declarations('.modal.snowflake-method-compact-form-modal .modal-content.snowflake-method-project-form > .setting-item.snowflake-method-look-setting');
		expect(row).toContain('flex-direction: row');
		expect(row).toContain('align-items: center');
		const control = declarations('.snowflake-method-project-form > .snowflake-method-look-setting > .setting-item-control');
		expect(control).toContain('flex: 0 0 auto');
		expect(control).toContain('width: var(--snowflake-method-look-picker-width, 12rem)');
		expect(declarations('.snowflake-method-look-picker > button.snowflake-method-look-choice')).toContain('flex: 1 1 0');
		expect(declarations('.snowflake-method-look-picker > button.snowflake-method-look-choice.is-chosen')).toContain('background: var(--interactive-accent)');
		expect(declarations('.snowflake-method-look-glyph')).toContain('height: 2px');
		expect(declarations('.snowflake-method-look-glyph.is-line-dotted')).toContain('repeating-linear-gradient(to right, currentColor 0 2px, transparent 2px 5px)');
		expect(declarations('.snowflake-method-look-glyph.is-line-dash-dot')).toContain('currentColor 5px 12px');
		expect(declarations('.snowflake-method-freeform-canvas .snowflake-method-freeform-edge.is-dash-dot .react-flow__edge-path')).toContain('stroke-dasharray: 8 6 1 6');
		expect(declarations('.snowflake-method-look-glyph.is-arrow-start::before')).toContain('border-block: 4px solid transparent');
		expect(styles).toContain('inset-inline-start: -1px;\n\tborder-inline-end: 7px solid currentColor;');
		expect(styles).toContain('inset-inline-end: -1px;\n\tborder-inline-start: 7px solid currentColor;');
	});

	/**
	 * A dot a line starts from is shown as the pointer comes to its side, as
	 * the app's own canvas shows one, and not on a node merely under the
	 * pointer or chosen. A finger comes to no side, so on a coarse pointer
	 * the chosen node shows its four.
	 */
	it('shows a freeform dot only as the pointer comes to its side, or on a chosen node under a finger', () => {
		expect(styles).not.toContain('.react-flow__node:hover .snowflake-method-freeform-handle');
		const shown = declarations('.snowflake-method-freeform-canvas .react-flow__resize-control.line.right:hover ~ .react-flow__handle-right.snowflake-method-freeform-handle.connectable::before');
		expect(shown).toContain('opacity: 1');
		expect(declarations('.snowflake-method-freeform-canvas .snowflake-method-freeform-handle.connectingto::before')).toContain('opacity: 1');
		const coarse = styles.slice(styles.indexOf('@media (pointer: coarse)'));
		expect(coarse).toContain('.snowflake-method-freeform-canvas .react-flow__node.selected .snowflake-method-freeform-handle.connectable::before');
		expect(styles.slice(0, styles.indexOf('@media (pointer: coarse)'))).not.toContain('.react-flow__node.selected .snowflake-method-freeform-handle');
	});

	/**
	 * Every workspace's toolbar is balanced about its search by one rule: two
	 * sides of one least width, the search between them up to its full width,
	 * and, told it is too narrow for that, each side its own width with the
	 * search in the middle of what is left.
	 */
	it('balances every toolbar about its search, and gives the balance up before the search', () => {
		const balanced = declarations('.snowflake-method-balanced-toolbar');
		expect(balanced).toContain('display: grid');
		expect(balanced).toContain('minmax(6rem, var(--snowflake-method-toolbar-search-width, 22rem))');
		expect(balanced).toContain('max(var(--snowflake-method-toolbar-start, 0px), var(--snowflake-method-toolbar-end, 0px))');
		expect(declarations('.snowflake-method-balanced-toolbar.is-cramped')).toContain('max-content minmax(6rem, 1fr) max-content');
		expect(declarations('.snowflake-method-balanced-toolbar.is-cramped > .snowflake-method-toolbar-search')).toContain('justify-self: center');
		for (const toolbar of ['.snowflake-method-timeline-toolbar', '.snowflake-method-freeform-toolbar']) {
			expect(declarations(toolbar), toolbar).toContain('--snowflake-method-toolbar-start:');
			expect(declarations(toolbar), toolbar).not.toContain('display:');
		}
		expect(declarations('.snowflake-method-corkboard-band.snowflake-method-balanced-toolbar')).toContain('--snowflake-method-toolbar-start: var(--snowflake-method-view-field-width)');
	});

	it('shows an entity card\'s picture in a fixed pane above the words, hidden under the two barer styles', () => {
		const pane = declarations('.snowflake-method-corkboard-picture');
		expect(pane).toContain('aspect-ratio: 1 / 1');
		expect(pane).toContain('flex: 0 0 auto');
		expect(pane).not.toContain('min-height');
		expect(pane).toContain('overflow: hidden');
		expect(pane).toContain('position: relative');
		expect(declarations('.snowflake-method-corkboard-picture-frame > img')).toContain('object-fit: contain');
		// The pane's buttons show under the pointer, the arrows a little see-through, and the landing mark carries on over the pane's ground.
		expect(declarations('.snowflake-method-corkboard-picture > .clickable-icon')).toContain('opacity: 0');
		expect(declarations('.snowflake-method-corkboard-picture:hover > .clickable-icon')).toContain('opacity: 0.7');
		expect(declarations('.snowflake-method-corkboard-card.is-drop-before > .snowflake-method-corkboard-picture::before')).toContain('inset-inline-start: 0');
		expect(styles).toMatch(/corkboard-picture::before \{\n\tcontent: '';\n\tposition: absolute;\n\tz-index: 1;\n\tinset-block: 0;\n\twidth: 3px;\n\tbackground-color: var\(--interactive-accent\);/u);
		expect(declarations('.snowflake-method-corkboard-picture::after')).toContain('height: 1px');
		// On the canvas a still title follows the node's own cursor, the hand that drags it.
		expect(styles).toMatch(/button\.snowflake-method-corkboard-title\[aria-disabled='true'\] \{\n\topacity: 1;\n\tcolor: var\(--text-normal\);\n\tcursor: inherit;/u);
		// The body is a prose box, so the field rules' alignment and indent reach it, and the card gives it no dress of its own.
		const body = declarations('.snowflake-method-scene-cards .snowflake-method-prose-box.snowflake-method-corkboard-body-text');
		expect(body).toContain('background: transparent');
		expect(body).toContain('border: 0');
		expect(body).toContain('scrollbar-gutter: auto');
		expect(styles).not.toMatch(/textarea\.snowflake-method-corkboard-body-text/u);
		expect(styles).toMatch(/\.snowflake-method-freeform-face:is\(\.is-scene, \.is-card\) \.snowflake-method-prose-box\.snowflake-method-corkboard-body-text \{\n\toverflow: hidden;\n\tpointer-events: none;/u);
		const hidden = styles
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.split('}')
			.filter((entry) => (entry.split('{')[1] ?? '').includes('display: none'))
			.map((entry) => entry.split('{')[0] ?? '')
			.join('\n');
		for (const mode of ['compact', 'standard']) {
			expect(hidden).toContain(`.snowflake-method-scene-cards[data-mode='${mode}'] .snowflake-method-corkboard-picture`);
		}
		// The gallery style gives the words' room to the pane; a scene's fullest style keeps its links and no pane.
		expect(hidden).toContain(`.snowflake-method-scene-cards[data-mode='gallery'] .snowflake-method-corkboard-body`);
		expect(hidden).toContain(`.snowflake-method-scene-cards[data-mode='extended'] .is-scene-card .snowflake-method-corkboard-picture`);
		expect(declarations(`.snowflake-method-scene-cards[data-mode='gallery']`)).toContain('--snowflake-method-corkboard-card-height: 21rem');
		expect(declarations('.snowflake-method-corkboard-word')).toContain('text-overflow: ellipsis');
	});

	it('scopes a sheet without touching what its rules say', () => {
		const scoped = scopeCss(
			[
				'/* a note */',
				'.a, .b:hover,',
				'  svg.c > path {',
				'  color: red; /* kept */',
				'}',
				'@keyframes spin {',
				'  from { rotate: 0deg; }',
				'  50% { rotate: 180deg; }',
				'}',
				'.d { animation: spin 1s; animation-name: spinner; }',
				'@media (pointer: coarse) {',
				'  .e { width: 1px; }',
				'}',
				'',
			].join('\n'),
			{ under: '.scope', keyframes: 'mine-' },
		);
		expect(scoped).toBe([
			'/* a note */',
			'.scope .a,',
			'.scope .b:hover,',
			'.scope svg.c > path {',
			'  color: red; /* kept */',
			'}',
			'@keyframes mine-spin {',
			'  from { rotate: 0deg; }',
			'  50% { rotate: 180deg; }',
			'}',
			'.scope .d { animation: mine-spin 1s; animation-name: spinner; }',
			'@media (pointer: coarse) {',
			'  .scope .e { width: 1px; }',
			'}',
			'',
		].join('\n'));
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

	it('indents a first line without naming the flagged property, outside the fields', () => {
		// A textarea has no box to set a line in with, so the fields section
		// alone names text-indent; nowhere else does.
		const declarations = styles
			.replace(section('Field alignment'), ' ')
			.replace(/\/\*[\s\S]*?\*\//g, ' ');
		expect(declarations.includes('text-indent')).toBe(false);
		const spacers = styles.match(
			/::before\s*\{[^}]*width:\s*var\(--snowflake-method-manuscript-indent[^}]*\}/g,
		);
		// The stream's two faces, and the two faces of a note of Obsidian's
		// own wearing the same dress.
		expect(spacers?.length).toBe(4);
	});

	/**
	 * Obsidian marks every body child after the app container as ground the
	 * window cannot be dragged by, so that its menus and popups do not carry
	 * the tab strip's drag. The floating layer spans the window, and marked so
	 * it took every drag region with it: the window could not be moved while
	 * the plugin was on. The layer claims no region, the cards on it refuse
	 * the drag, and nothing of the plugin's ever claims a drag of its own.
	 */
	it('lets the window be dragged past the floating layer, and never by a floating card', () => {
		expect(
			declarations('body.is-frameless > .app-container ~ .snowflake-method-sticky-layer'),
		).toContain('-webkit-app-region: initial');
		expect(declarations('.snowflake-method-sticky-card.is-floating')).toContain(
			'-webkit-app-region: no-drag',
		);
		expect(styles).not.toMatch(/app-region:\s*drag/u);
	});

	/**
	 * What the plugin does differently on a phone or a tablet stands in one
	 * section, under the body classes the app sets, so a desktop reader of
	 * the sheet never meets it unawares: every rule there is rooted at
	 * `body.is-mobile`, `body.is-phone` or `body.is-tablet`, or repeats, in a
	 * coarse-pointer block, a selector written earlier in the sheet, since a
	 * media query adds no specificity of its own. The app's phone and tablet
	 * classes appear nowhere else but the explorer's drawer rules, which came
	 * first. The section measures nothing by the window, which the keyboard
	 * shrinks without telling `vh`, and asks for no safe area the app does
	 * not name; the one rule the section reveals on a phone, the rail's
	 * stand-in, is hidden where it is drawn.
	 */
	it('keeps the mobile rules to their section, rooted at the app’s body classes', () => {
		const mobile = section('Mobile').replace(/\/\*[\s\S]*?\*\//gu, ' ');
		const from = styles.indexOf('/* == Mobile ');
		const earlier = styles.slice(0, from).replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/\s+/gu, ' ');
		const coarse: string[] = [];
		const plain = mobile.replace(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/gu, (_match, block: string) => {
			coarse.push(block);
			return ' ';
		});
		expect(coarse.length).toBeGreaterThan(0);
		const selectors = (sheet: string): string[] =>
			[...sheet.matchAll(/([^{}]+)\{/gu)]
				.flatMap((rule) => (rule[1] ?? '').split(','))
				.map((one) => one.trim().replace(/\s+/gu, ' '))
				.filter((one) => one !== '');
		const rooted = selectors(plain);
		expect(rooted.length).toBeGreaterThan(20);
		for (const selector of rooted) {
			expect(selector, selector).toMatch(/^body\.is-(?:mobile|phone|tablet)\b/u);
		}
		for (const selector of coarse.flatMap(selectors)) {
			expect(earlier.includes(`${selector} {`) || earlier.includes(`${selector},`), selector).toBe(true);
		}
		expect(mobile).not.toMatch(/\d(?:vh|vw|dvh)\b|env\(|!important|:has\(|#[0-9a-f]{3}|rgb\(|position: sticky|@container/u);
		const elsewhere = styles.replace(section('Mobile'), ' ').replace(section('File explorer'), ' ');
		expect(elsewhere).not.toMatch(/is-phone|is-tablet/u);
		expect(declarations('.snowflake-method-rail-menu-row')).toContain('display: none');
		expect(declarations('body.is-phone .snowflake-method-dashboard.is-rail-hidden .snowflake-method-rail-menu-row')).toContain('display: flex');
		expect(declarations('body.is-phone .snowflake-method-dashboard.is-rail-hidden .snowflake-method-step-nav')).toContain('display: none');
		expect(declarations('body.is-mobile .snowflake-method-settings')).toMatch(
			/--background-modifier-form-field: color-mix\(\s*in srgb,\s*var\(--text-normal\) 10%,\s*transparent\s*\)/u,
		);
		expect(declarations('body.is-mobile .snowflake-method-settings .dropdown')).toContain(
			'background-color: var(--background-modifier-form-field)',
		);
		// The entity dialogs' custom field rows, status and relationship cards
		// stand on the same tone, as the user asked to see checked.
		expect(declarations('body.is-mobile .modal.snowflake-method-dialog')).toMatch(
			/--background-modifier-form-field: color-mix\(\s*in srgb,\s*var\(--text-normal\) 10%,\s*transparent\s*\)/u,
		);
		expect(declarations('body.is-mobile .modal.snowflake-method-dialog .dropdown')).toContain(
			'background-color: var(--background-modifier-form-field)',
		);
		// The chevron grown to a finger's size gets a column of that size, or it
		// spills past its wrapper under the button beside it.
		expect(declarations('body.is-mobile .snowflake-method-character-split-button')).toContain(
			'grid-template-columns: minmax(0, 1fr) var(--touch-size-m, 2.75rem)',
		);
		expect(declarations('body.is-mobile .snowflake-method-character-split-button:not(.snowflake-method-base-split-button)')).toContain(
			'min-width: calc(2.75rem + var(--touch-size-m, 2.75rem))',
		);
		// A week's two dates with the finger-wide arrows at the desktop's size
		// are a few pixels wider than a phone's row: the title takes the pane's
		// own size there and the arrows stand a touch closer.
		expect(declarations('body.is-phone .snowflake-method-history-range-nav')).toContain('gap: var(--size-4-1)');
		expect(declarations('body.is-phone .snowflake-method-history-range-title')).toContain('font-size: 1em');
		// The control band rides the strip's gap on the desktop. On a phone it
		// stands in the flow a touch under the strip, and a task tab's search
		// shares its row with the funnel alone.
		const band = declarations('body.is-phone .snowflake-method-prose-controls');
		expect(band).toContain('position: static');
		expect(band).toContain('flex-wrap: wrap');
		expect(band).toContain('margin-block-start: calc(var(--size-4-2) - var(--snowflake-method-tab-height, 2.75rem))');
		expect(declarations('body.is-phone .snowflake-method-sticky-board .snowflake-method-prose-controls')).toContain(
			'margin-block-end: 0',
		);
		expect(declarations('body.is-phone .snowflake-method-task-board .snowflake-method-prose-controls')).toContain(
			'--snowflake-method-band-beside: calc(var(--touch-size-s, 2.5rem) + var(--size-2-2))',
		);
		expect(declarations('body.is-phone .snowflake-method-sticky-board .snowflake-method-prose-controls')).toContain(
			'--snowflake-method-band-beside: calc(2 * (var(--touch-size-s, 2.5rem) + var(--size-2-2)))',
		);
		expect(declarations('body.is-phone .snowflake-method-prose-controls .search-input-container')).toContain(
			'flex: 1 1 calc(100% - var(--snowflake-method-band-beside, 0px))',
		);
		expect(declarations('body.is-phone .snowflake-method-tracking-panel .snowflake-method-prose-controls .search-input-container')).toContain(
			'flex: 1 1 50%',
		);
		expect(declarations('body.is-phone .snowflake-method-task-archive-actions')).toContain('flex-wrap: wrap');
		expect(declarations('body.is-phone .snowflake-method-settings .setting-item-control textarea')).toContain('min-width: 0');
		expect(declarations('body.is-tablet .snowflake-method-settings .setting-item-control textarea')).toContain(
			'min-width: var(--snowflake-method-settings-box)',
		);
		expect(declarations('body.is-phone .modal .snowflake-method-settings .setting-item.snowflake-method-settings-beside')).toContain(
			'flex-direction: row',
		);
		expect(declarations('body.is-phone .snowflake-method-settings .snowflake-method-font-picker')).toContain('max-width: none');
		expect(declarations('body.is-phone .snowflake-method-dashboard.is-rail-hidden .snowflake-method-layout')).toContain(
			'grid-template-columns: minmax(0, 1fr)',
		);
		expect(declarations('body.is-phone .modal.snowflake-method-dialog')).toContain(
			'max-height: calc(100% - var(--safe-area-inset-top, 0px) - var(--keyboard-height, 0px))',
		);
		expect(declarations('body.is-phone .snowflake-method-filter-panel')).toContain('inset: auto 0 var(--keyboard-height, 0px) 0');
		expect(declarations('body.is-phone .snowflake-method-sticky-layer')).toContain('display: none');
		expect(
			declarations("body.is-phone .mod-root .workspace-leaf-content[data-type^='snowflake-method-'] > .view-content"),
		).toContain('margin-bottom: max(0px, var(--view-bottom-spacing, 0px))');
		expect(declarations('.snowflake-method-diagnostics-report')).toContain('white-space: pre-wrap');
		// The dashboard scrolls as one page on a phone and its frames run to
		// their content. The workspace is not offered there: its ribbon action
		// is away, a tab that opens all the same shows its note, and no phone
		// rule lays out a board of it.
		expect(declarations('body.is-phone .snowflake-method-dashboard .snowflake-method-layout')).toContain('flex: 0 0 auto');
		expect(declarations('body.is-phone .snowflake-method-dashboard .snowflake-method-table-body')).toContain('overflow: visible');
		expect(declarations('body.is-phone .snowflake-method-dashboard .snowflake-method-field .snowflake-method-prose-box')).toContain(
			'overflow-y: visible',
		);
		expect(declarations('body.is-phone .snowflake-method-workspace-ribbon')).toContain('display: none');
		expect(declarations('body.is-phone .snowflake-method-workspace-phone')).toContain('display: flex');
		expect(plain.replace(/\/\*[\s\S]*?\*\//gu, ' ')).not.toMatch(
			/body\.is-phone[^{]*snowflake-method-(?:timeline|beat-sheet|freeform|relationship-graph|graph-controls|corkboard)/u,
		);
	});
});
