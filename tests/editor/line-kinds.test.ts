import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import {
	classifyLinesByText,
	lineKeepsPlainEnter,
	paragraphLayoutByText,
} from '../../src/editor';

/**
 * The text read line by line, as the layout and Enter both read it: one
 * kind per line, and the kinds that keep CodeMirror's own Enter.
 */
describe('classifyLinesByText', () => {
	const note = [
		'---',
		'title: A',
		'---',
		'# Heading',
		'',
		'Prose line one.',
		'Prose line two.',
		'',
		'- item',
		'',
		'- item two',
		'  continued',
		'',
		'> quoted',
		'',
		'```',
		'code',
		'```',
		'$$',
		'x',
		'$$',
		'%% hidden',
		'still %%',
		'<!-- marker -->',
		'<div>',
		'tag block',
		'',
		'| a | b |',
		'[ref]: https://example.com',
		'    indented code',
		'',
		'Last words.',
	].join('\n');

	it('names every line', () => {
		expect(classifyLinesByText(Text.of(note.split('\n')))).toEqual([
			'frontmatter', 'frontmatter', 'frontmatter',
			'heading',
			'blank',
			'text', 'text',
			'blank',
			'list', 'list', 'list', 'list',
			'blank',
			'quote',
			'blank',
			'fence', 'fence', 'fence',
			'math', 'math', 'math',
			'comment', 'comment',
			'html',
			'html', 'html',
			'blank',
			'table',
			'definition',
			'code',
			'blank',
			'text',
		]);
	});

	it('stops where it is told, and the layout reads the same kinds', () => {
		const doc = Text.of(note.split('\n'));
		expect(classifyLinesByText(doc, 6)).toHaveLength(6);
		expect(classifyLinesByText(doc, 6)[5]).toBe('text');
		const layout = paragraphLayoutByText(doc);
		expect(layout.first).toEqual([doc.line(6).from, doc.line(32).from]);
		expect(layout.lines).toEqual([doc.line(6).from, doc.line(7).from, doc.line(32).from]);
	});

	it('keeps the app’s Enter in every block that is not prose, and not on prose', () => {
		const doc = Text.of(note.split('\n'));
		const plain = (number: number): boolean => lineKeepsPlainEnter(doc, number);
		expect(plain(2)).toBe(true); // front matter
		expect(plain(4)).toBe(false); // a heading takes the break
		expect(plain(5)).toBe(false); // a gap takes the break
		expect(plain(6)).toBe(false); // prose
		expect(plain(10)).toBe(true); // a blank line the list goes on past
		expect(plain(12)).toBe(true); // an item's continuation
		expect(plain(14)).toBe(true); // a quote
		expect(plain(17)).toBe(true); // code
		expect(plain(20)).toBe(true); // math
		expect(plain(23)).toBe(true); // a comment
		expect(plain(26)).toBe(true); // an HTML tag block
		expect(plain(30)).toBe(true); // indented code
		expect(plain(32)).toBe(false);
	});

	const kinds = (...lines: string[]) => classifyLinesByText(Text.of(lines));

	/**
	 * A comment, a math block and a fence open only where the app's editor
	 * opens one, so a line that merely holds their marks leaves the rest of
	 * the note as it is.
	 */
	it('opens a comment, a math block or a fence only where the app does', () => {
		// A comment opened partway along a line is closed by the next `%%`,
		// which does not open another.
		expect(
			kinds('She paused. %%', 'note to self', '%%', '', 'The next morning came.', '', 'And the next.'),
		).toEqual(['text', 'comment', 'comment', 'blank', 'text', 'blank', 'text']);
		// One closed on its own line opens nothing, and `%%` in a code span is no mark.
		expect(kinds('A %%quiet%% aside.', 'Use `%%` to hide.', 'More.')).toEqual(['text', 'text', 'text']);
		// Display math with words after it is a paragraph's; a lone `$$` opens a block.
		expect(kinds('$$E=mc^2$$ said he.', '', 'Second.', '', '$$', 'x', '$$', 'Third.')).toEqual([
			'text', 'blank', 'text', 'blank', 'math', 'math', 'math', 'text',
		]);
		// A backtick fence's info string holds no backtick.
		expect(kinds('```code``` begins this line.', '', 'Second.')).toEqual(['text', 'blank', 'text']);
		expect(kinds('```js', 'x', '```', 'After.')).toEqual(['fence', 'fence', 'fence', 'text']);
	});

	/**
	 * A paragraph that opens with inline HTML is a paragraph, a heading ends
	 * the list or quote above it, and a spaced rule is a scene break, as the
	 * stream's grammar and the app's own reader both read them.
	 */
	it('reads inline HTML, a heading under a list and a spaced rule as the stream does', () => {
		expect(kinds('First.', '', '<u>Under</u> the second opens.', 'It goes on.', '', 'Third.')).toEqual([
			'text', 'blank', 'text', 'text', 'blank', 'text',
		]);
		expect(kinds('<https://example.com> is a site.', '<span>A</span> b.')).toEqual(['text', 'text']);
		// A block tag opens a block, and so does a tag alone where no paragraph runs on.
		expect(kinds('<div>x</div> and more', '', '<u>', 'y', '', 'Prose.', '<u>')).toEqual([
			'html', 'blank', 'html', 'html', 'blank', 'text', 'text',
		]);
		expect(
			kinds('## Traits', '- brave', '- stubborn', '## Backstory', 'She grew up by the sea.', '', 'Later.'),
		).toEqual(['heading', 'list', 'list', 'heading', 'text', 'blank', 'text']);
		expect(kinds('> [!note] Remember', '> the plan', '## Chapter', 'Prose here.')).toEqual([
			'quote', 'quote', 'heading', 'text',
		]);
		// A heading indented under an item is the item's.
		expect(kinds('- item', '  ## inside', 'lazy line')).toEqual(['list', 'list', 'list']);
		expect(kinds('Before.', '', '* * *', 'After the break.', '', '- - -', '', 'More.')).toEqual([
			'text', 'blank', 'rule', 'text', 'blank', 'rule', 'blank', 'text',
		]);
		const doc = Text.of(['Before.', '', '* * *']);
		expect(lineKeepsPlainEnter(doc, 3)).toBe(false);
	});
});
