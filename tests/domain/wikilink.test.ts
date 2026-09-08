import { describe, expect, it } from 'vitest';

import { parseWikiLink, wikiLinkLabel, wikiLinkText } from '../../src/domain';

describe('wikilinks as stored values', () => {
	it('writes a link the way the service writes one', () => {
		expect(wikiLinkText('Manuscript/Chapter 08.md')).toBe(
			'[[Manuscript/Chapter 08]]',
		);
		expect(wikiLinkText(' Manuscript/Chapter 08 ', 'Eight')).toBe(
			'[[Manuscript/Chapter 08|Eight]]',
		);
		expect(wikiLinkText('Manuscript/Chapter 08', 'Eig|ht]')).toBe(
			'[[Manuscript/Chapter 08|Eight]]',
		);
		expect(wikiLinkText('Manuscript/Chapter 08', '  ')).toBe(
			'[[Manuscript/Chapter 08]]',
		);
		expect(wikiLinkText('   ')).toBe('');
	});

	it('reads the linktext, the target, the subpath and the alias', () => {
		expect(parseWikiLink('[[A/B#Scene 12|Twelve]]')).toEqual({
			linktext: 'A/B#Scene 12',
			target: 'A/B',
			subpath: 'Scene 12',
			alias: 'Twelve',
		});
		expect(parseWikiLink('[[A/B#^scene-12]]')).toEqual({
			linktext: 'A/B#^scene-12',
			target: 'A/B',
			subpath: '^scene-12',
			alias: null,
		});
		expect(parseWikiLink('  [[A/B]]  ')).toEqual({
			linktext: 'A/B',
			target: 'A/B',
			subpath: '',
			alias: null,
		});
	});

	it('labels a link by its alias, else by the note and its subpath', () => {
		expect(wikiLinkLabel('[[Manuscript/Chapter 08|Eight]]')).toBe('Eight');
		expect(wikiLinkLabel('[[Manuscript/Chapter 08]]')).toBe('Chapter 08');
		expect(wikiLinkLabel('[[Manuscript/Chapter 08#Scene 12]]')).toBe(
			'Chapter 08 › Scene 12',
		);
		expect(wikiLinkLabel('[[Manuscript/Chapter 08.md]]')).toBe('Chapter 08');
		expect(wikiLinkLabel('[[Manuscript/Chapter 08|]]')).toBe('Chapter 08');
		expect(wikiLinkLabel('[[#Scene 12]]')).toBe('Scene 12');
	});

	it('reads plain words as a link to themselves', () => {
		expect(parseWikiLink('Chapter 08')).toBeNull();
		expect(wikiLinkLabel('  Chapter 08 ')).toBe('Chapter 08');
	});

	it('refuses what is not one link', () => {
		expect(parseWikiLink('[[a]] [[b]]')).toBeNull();
		expect(parseWikiLink('[[]]')).toBeNull();
		expect(parseWikiLink('[[ ]]')).toBeNull();
		expect(parseWikiLink('')).toBeNull();
	});
});
