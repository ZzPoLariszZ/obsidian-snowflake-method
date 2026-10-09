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
});
