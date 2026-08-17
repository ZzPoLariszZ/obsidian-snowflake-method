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

		it('spends the title on the first H1 the page shows', () => {
			// The one in the comment is on nobody's page, so the real title is
			// still the one that goes.
			const hidden = '%%\n# Draft name\n%%\n\n# Alice\n\nOne two.';
			expect(
				countWriting(countableProse(hidden, [], { headings: 'skip-first-h1' }), {
					mode: 'ms-word',
				}).total,
			).toBe(2);
		});

		it('leaves the title where the caller excluded it', () => {
			// Counting one stretch of a note excludes the rest of the note, and
			// the note still has exactly one title. An excluded stretch is off
			// this count, not off the page, so the H1 inside it spends the title
			// and the heading the author wrote further down survives -- without
			// that, a section would report one heading less than the same words
			// contribute to the note.
			const body = '# Alice\n\n# Her winter\n\nOne two.';
			expect(
				countWriting(
					countableProse(body, [{ from: 0, to: 7 }], {
						headings: 'skip-first-h1',
					}),
					{ mode: 'ms-word' },
				).total,
			).toBe(4);
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

	it('opens no comment from a marker shown inside code', () => {
		// Code is shown as written, so a marker quoted in it comments nothing
		// and the chapter under it still counts.
		expect(countableProse('Use `%%` here.\n\nChapter one had words.')).toBe(
			'Use  here.\n\nChapter one had words.',
		);
		expect(count('Use `%%` here.\n\nChapter one had words.')).toBe(6);
		expect(
			count('```js\nconst a = "%%";\n```\n\nChapter one had words.'),
		).toBe(4);
		// The marker in code takes no part, so the two in prose pair with each
		// other and hide what is between them: one, two, and four remain.
		expect(count('`%%` one two %% three %% four')).toBe(3);
	});

	describe('syntax the page draws rather than says', () => {
		it('counts a table by its cells, not its pipes', () => {
			const table = '| One | Two |\n| --- | --- |\n| a | b |';
			expect(count(table)).toBe(4);
			expect(countableProse(table).replace(/\s+/g, ' ').trim()).toBe(
				'One Two a b',
			);
		});

		it('keeps struck-through text and drops its tildes', () => {
			// A line through a word does not take it off the page.
			expect(countableProse('a ~~struck~~ b')).toBe('a struck b');
			expect(count('a ~~struck~~ b')).toBe(3);
		});

		it('keeps a highlight and drops its equals', () => {
			expect(countableProse('记住==这句话==吧')).toBe('记住这句话吧');
			// A lone pair with a space inside highlights nothing, as in Obsidian.
			expect(countableProse('one == two == three')).toBe('one == two == three');
			// What a highlight holds is prose still, links and emphasis included.
			expect(countableProse('==**[[Alice]]** now==')).toBe('Alice now');
		});

		it('drops a task box and keeps the task', () => {
			expect(count('- [ ] do the thing\n- [x] and this one')).toBe(6);
			expect(countableProse('- [ ] do it').trim()).toBe('do it');
		});

		it('drops a callout kind and keeps its title', () => {
			expect(countableProse('> [!note] Title here\n> body words').trim()).toBe(
				'Title here\n body words',
			);
			expect(count('> [!warning]- Folded title\n> body words')).toBe(4);
			// A nested callout names itself the same way.
			expect(count('> > [!tip] Inner title')).toBe(2);
		});

		it('drops a footnote marker and its definition label', () => {
			expect(countableProse('text[^1]')).toBe('text');
			expect(countableProse('[^1]: The note itself.').trim()).toBe(
				'The note itself.',
			);
			expect(count('A claim[^src] worth making.\n\n[^src]: Where from.')).toBe(6);
		});

		it('leaves all of it dead inside code', () => {
			expect(count('`| a | b |`')).toBe(0);
			expect(count('```\n==bright== [^1] > [!note] x\n```')).toBe(0);
		});
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

	it('removes an excluded range whose ends arrive the wrong way round', () => {
		// An empty managed section reports its content ending before it starts.
		// Read as written that rewinds the splice and emits the stretch twice,
		// which puts writing into the count that the caller asked to take out.
		expect(countableProse('abcdefghij', [{ from: 5, to: 3 }])).toBe(
			'abcdefghij',
		);
		expect(countableProse('one two three', [{ from: 8, to: 4 }])).toBe(
			'one two three',
		);
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
