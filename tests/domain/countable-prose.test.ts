import { describe, expect, it } from 'vitest';

import {
	countWriting,
	countableProse,
	type WritingCountHeadings,
} from '../../src/domain';

// Counted the way a word processor does, so a mark left clinging to a word
// cannot move a number that is here to say what the stripping kept.
const count = (body: string): number =>
	countWriting(countableProse(body), { mode: 'ms-word' }).total;

describe('countable prose', () => {
	it('keeps a wikilink display text and drops the target', () => {
		expect(countableProse('[[Character/Alice|Alice]]')).toBe('Alice');
		expect(count('[[Character/Alice|Alice]]')).toBe(1);
	});

	it('keeps a bare wikilink target as its display text', () => {
		expect(countableProse('[[Alice]]')).toBe('Alice');
		expect(count('[[Alice]]')).toBe(1);
	});

	it('keeps a markdown link text and drops the URL', () => {
		expect(countableProse('[Alice](https://example.com)')).toBe('Alice');
		expect(count('[Alice](https://example.com)')).toBe(1);
	});

	it('counts an embed as nothing', () => {
		expect(count('![[Chapter_01]]')).toBe(0);
		expect(count('One ![[Chapter_01]] two')).toBe(2);
	});

	it('counts heading text without the marks', () => {
		expect(count('# A Winter Story')).toBe(3);
		expect(countableProse('## 第二章')).not.toContain('#');
	});

	describe('headings the count is asked to pass over', () => {
		const NOTE = '# Alice\n\nOne two three.\n\n## Her winter\n\nFour five.';
		const counted = (headings: WritingCountHeadings): number =>
			countWriting(countableProse(NOTE, [], { headings }), {
				mode: 'ms-word',
			}).total;

		it('counts every heading by default', () => {
			expect(counted('count')).toBe(8);
		});

		it('passes over the first level alone', () => {
			// Alice goes; Her winter stays.
			expect(counted('skip-h1')).toBe(7);
			expect(counted('skip-first-h1')).toBe(7);
		});

		it('spends a title once, and leaves a later H1 standing', () => {
			const body = '# Alice\n\nOne two.\n\n# Part two\n\nThree four.';
			const total = (headings: WritingCountHeadings): number =>
				countWriting(countableProse(body, [], { headings }), {
					mode: 'ms-word',
				}).total;
			// Alice, One two, Part two, Three four.
			expect(total('count')).toBe(7);
			expect(total('skip-first-h1')).toBe(6);
			expect(total('skip-h1')).toBe(4);
		});

		it('spends the title on the first H1 the count would have read', () => {
			// The one in the comment is on nobody's page, so the real title is
			// still the one that goes.
			const hidden = '%%\n# Draft name\n%%\n\n# Alice\n\nOne two.';
			expect(
				countWriting(countableProse(hidden, [], { headings: 'skip-first-h1' }), {
					mode: 'ms-word',
				}).total,
			).toBe(2);
			// The same when the H1 sits inside an excluded section.
			const excluded = '# Scaffolding\n\n# Alice\n\nOne two.';
			expect(
				countWriting(
					countableProse(excluded, [{ from: 0, to: 15 }], {
						headings: 'skip-first-h1',
					}),
					{ mode: 'ms-word' },
				).total,
			).toBe(2);
		});

		it('passes over every level', () => {
			expect(counted('skip-all')).toBe(5);
		});

		it('reads the underlined spelling as the heading it is', () => {
			const setext = 'Alice\n=====\n\nOne two three.';
			expect(
				countWriting(countableProse(setext, [], { headings: 'skip-h1' }), {
					mode: 'ms-word',
				}).total,
			).toBe(3);
		});

		it('takes what a skipped heading holds with it', () => {
			const body = '# [[Character/Alice|Alice]] and **her** winter\n\nOne two.';
			expect(
				countWriting(countableProse(body, [], { headings: 'skip-h1' }), {
					mode: 'ms-word',
				}).total,
			).toBe(2);
		});

		it('never fuses the words a skipped heading stood between', () => {
			expect(countableProse('one\n\n# Title\n\ntwo', [], {
				headings: 'skip-all',
			})).toBe('one\n\n\n\ntwo');
		});
	});

	it('drops emphasis, list, and quote marks but keeps their text', () => {
		expect(count('**bold** and _lean_')).toBe(3);
		expect(count('- first\n- second')).toBe(2);
		expect(count('> quoted line')).toBe(2);
	});

	it('splices marks out without splitting the word around them', () => {
		expect(countableProse('re**do**')).toBe('redo');
		expect(count('re**do**')).toBe(1);
	});

	it('counts code as nothing, fenced, indented, or inline', () => {
		expect(count('```js\nconst a = 1;\n```')).toBe(0);
		expect(count('before\n\n    indented code\n\nafter')).toBe(2);
		expect(count('one `code words` two')).toBe(2);
	});

	it('counts comments as nothing', () => {
		expect(count('one %% hidden words %% two')).toBe(2);
		expect(count('one <!-- hidden words --> two')).toBe(2);
	});

	it('hides an unclosed comment to the end of the note', () => {
		expect(count('one two %% hidden to the end')).toBe(2);
	});

	it('drops block IDs and horizontal rules', () => {
		expect(count('A paragraph here. ^ab12-cd')).toBe(3);
		expect(count('one\n\n---\n\ntwo')).toBe(2);
	});

	it('leaves a wikilink inside code or a comment dead', () => {
		expect(count('`[[Alice]]`')).toBe(0);
		expect(count('%% [[Alice]] %%')).toBe(0);
	});

	it('drops excluded ranges together with everything in them', () => {
		const body = 'kept one\nEXCLUDED [[Alice]] words\nkept two';
		const from = body.indexOf('EXCLUDED');
		const to = body.indexOf('\nkept two');
		expect(count(body)).toBe(7);
		expect(
			countWriting(countableProse(body, [{ from, to }]), { mode: 'ms-word' })
				.total,
		).toBe(4);
	});

	it('keeps an escaped character and stands a space in for an entity', () => {
		expect(countableProse('a \\* b')).toBe('a * b');
		expect(countableProse('a&nbsp;b')).toBe('a b');
	});

	it('keeps whitespace as the source wrote it', () => {
		expect(countableProse('one  two\nthree')).toBe('one  two\nthree');
	});

	it('reads CJK prose through markdown unharmed', () => {
		expect(count('**雪花**写作法之[[角色/爱丽丝|爱丽丝]]')).toBe(9);
	});
});
