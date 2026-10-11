import { describe, expect, it } from 'vitest';

import {
	compileTextSearch,
	expandReplacement,
	findTextMatches,
	replaceTextMatches,
	replacementFor,
	unescapeReplacement,
	type TextSearch,
	type TextSearchOptions,
} from '../../src/domain';

const plain: TextSearchOptions = { caseSensitive: false, wholeWord: false, regex: false };

function compiled(query: string, options: Partial<TextSearchOptions> = {}): TextSearch {
	const result = compileTextSearch(query, { ...plain, ...options });
	if (result === null || !result.ok) throw new Error(`did not compile: ${query}`);
	return result.search;
}

const found = (text: string, search: TextSearch): string[] =>
	findTextMatches(text, search).map((range) => text.slice(range.from, range.to));

describe('compileTextSearch', () => {
	it('has nothing to look for in an empty query', () => {
		expect(compileTextSearch('', plain)).toBeNull();
		expect(compileTextSearch('', { ...plain, regex: true })).toBeNull();
	});

	it('says why an expression will not read', () => {
		const result = compileTextSearch('(unclosed', { ...plain, regex: true });
		expect(result?.ok).toBe(false);
		expect(result !== null && !result.ok ? result.error : '').not.toBe('');
	});

	it('reads an expression the Unicode flag refuses in the older dialect', () => {
		// A hyphen after a class escape is a syntax error under the Unicode flag.
		const search = compiled('[\\w-]+', { regex: true });
		expect(found('well-known words', search)).toEqual(['well-known', 'words']);
	});
});

describe('findTextMatches', () => {
	it('finds the words in any case unless the case is asked for', () => {
		const text = 'Ash and ash, ASH.';
		expect(found(text, compiled('ash'))).toEqual(['Ash', 'ash', 'ASH']);
		expect(found(text, compiled('ash', { caseSensitive: true }))).toEqual(['ash']);
	});

	it('reads the words as written, never as an expression', () => {
		expect(found('a.b axb a*b', compiled('a.b'))).toEqual(['a.b']);
		expect(found('cost $5 (net)', compiled('$5 (net)'))).toEqual(['$5 (net)']);
	});

	it('keeps to whole words when asked, as a mention does', () => {
		const text = 'Ann met Anna and Ann_e by Ann.';
		expect(found(text, compiled('Ann', { wholeWord: true }))).toEqual(['Ann', 'Ann']);
		expect(findTextMatches(text, compiled('Ann', { wholeWord: true }))).toEqual([
			{ from: 0, to: 3 },
			{ from: 26, to: 29 },
		]);
	});

	it('draws no word edges in Chinese, so whole words hold every match', () => {
		const text = '林黛玉说黛玉来了。';
		expect(found(text, compiled('黛玉', { wholeWord: true }))).toEqual(['黛玉', '黛玉']);
	});

	it('finds a whole word that starts inside a refused one', () => {
		// "aa" at 0 runs on into the third a; the one at 4 stands alone.
		expect(findTextMatches('aaa aa', compiled('aa', { wholeWord: true }))).toEqual([
			{ from: 4, to: 6 },
		]);
	});

	it('runs an expression line by line, with its groups', () => {
		const text = 'one\ntwo\nthree';
		expect(found(text, compiled('^t\\w+$', { regex: true }))).toEqual(['two', 'three']);
		expect(found('Mr Smith, Mrs Jones', compiled('Mrs? (\\w+)', { regex: true }))).toEqual([
			'Mr Smith',
			'Mrs Jones',
		]);
	});

	it('passes over a match of nothing and goes on', () => {
		expect(findTextMatches('abc', compiled('^', { regex: true }))).toEqual([]);
		expect(found('baaab', compiled('a*', { regex: true }))).toEqual(['aaa']);
	});

	it('never splits a character outside the basic plane', () => {
		const text = 'x𠀋y';
		expect(found(text, compiled('.', { regex: true }))).toEqual(['x', '𠀋', 'y']);
		expect(found(text, compiled('𠀋', { wholeWord: true }))).toEqual(['𠀋']);
	});

	it('stops at the limit', () => {
		expect(findTextMatches('a a a a', compiled('a'), 2)).toHaveLength(2);
		expect(findTextMatches('a a a a', compiled('a'), 0)).toEqual([]);
	});

	it('answers the same twice from one compiled search', () => {
		const search = compiled('o');
		expect(found('foo boo', search)).toEqual(['o', 'o', 'o', 'o']);
		expect(found('foo boo', search)).toEqual(['o', 'o', 'o', 'o']);
	});
});

describe('expandReplacement', () => {
	// Each template is expanded both ways: by the native replace, which the
	// rules are JavaScript's own, and by the expansion under test.
	const templates = [
		'plain',
		'$$',
		'$&!',
		'[$`]',
		"[$']",
		'$1-$2',
		'$01$02',
		'$10',
		'$3',
		'$0',
		'$<first> $<last>',
		'$<missing>',
		'$<open',
		'$',
		'a$',
		'$x',
	];
	const pattern = /(?<first>\w+) (?<last>\w+)/u;
	const text = 'said Jane Eyre softly';

	it.each(templates)('agrees with the native replace on %s', (template) => {
		const match = pattern.exec(text);
		if (match === null) throw new Error('no match');
		const native = text.replace(pattern, template);
		const expanded = expandReplacement(template, match, text);
		const start = match.index;
		const end = start + match[0].length;
		expect(text.slice(0, start) + expanded + text.slice(end)).toBe(native);
	});

	it('reads $<name> as written when the pattern names no group', () => {
		const match = /(\w+)/u.exec('word');
		if (match === null) throw new Error('no match');
		expect(expandReplacement('$<name>', match, 'word')).toBe('$<name>');
	});
});

describe('unescapeReplacement', () => {
	it('reads a line break, a tab and a backslash, and leaves any other escape', () => {
		expect(unescapeReplacement('a\\nb\\tc')).toBe('a\nb\tc');
		expect(unescapeReplacement('one \\\\n two')).toBe('one \\n two');
		expect(unescapeReplacement('\\d stays')).toBe('\\d stays');
	});
});

describe('replacementFor', () => {
	it('puts the words in as typed when the query is words', () => {
		const text = 'Jon met Jon.';
		const search = compiled('jon');
		expect(replacementFor(text, search, { from: 0, to: 3 }, '$1 John\\n')).toBe('$1 John\\n');
	});

	it('expands an expression against the whole text', () => {
		// The lookahead reads past the match: only the whole text answers it.
		const text = 'Mr Smith, and Mr Jones';
		const search = compiled('(\\w+)(?=,)', { regex: true });
		const [first] = findTextMatches(text, search);
		if (first === undefined) throw new Error('no match');
		expect(text.slice(first.from, first.to)).toBe('Smith');
		expect(replacementFor(text, search, first, '[$1]\\n')).toBe('[Smith]\n');
	});

	it('answers null once the text at the range no longer matches', () => {
		const search = compiled('ash');
		expect(replacementFor('ash tree', search, { from: 0, to: 3 }, 'oak')).toBe('oak');
		expect(replacementFor('oak tree', search, { from: 0, to: 3 }, 'oak')).toBeNull();
		expect(replacementFor('ashes', compiled('ash', { wholeWord: true }), { from: 0, to: 3 }, 'oak')).toBeNull();
	});
});

describe('replaceTextMatches', () => {
	it('replaces every match at once and says how many', () => {
		expect(replaceTextMatches('Jon and jon', compiled('jon'), 'John')).toEqual({
			text: 'John and John',
			count: 2,
		});
	});

	it('keeps to whole words and expands groups', () => {
		expect(
			replaceTextMatches('Ann, Anna, Ann.', compiled('Ann', { wholeWord: true }), 'Anne'),
		).toEqual({ text: 'Anne, Anna, Anne.', count: 2 });
		expect(
			replaceTextMatches('Smith, Jane', compiled('(\\w+), (\\w+)', { regex: true }), '$2 $1'),
		).toEqual({ text: 'Jane Smith', count: 1 });
	});

	it('hands the text back untouched when nothing matches', () => {
		const text = 'nothing here';
		expect(replaceTextMatches(text, compiled('absent'), 'x')).toEqual({ text, count: 0 });
	});

	it('deletes the matches when the replacement is empty', () => {
		expect(replaceTextMatches('a-b-c', compiled('-'), '')).toEqual({ text: 'abc', count: 2 });
	});
});
