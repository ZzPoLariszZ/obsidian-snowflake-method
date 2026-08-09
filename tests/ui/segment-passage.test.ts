import { describe, expect, it } from 'vitest';

import { findPassage } from '../../src/ui/segment-editor-backend';

const chapter = [
	'# Chapter Eleven',
	'',
	'The rain had not stopped since Tuesday and the road out was gone.',
	'',
	'She counted the coins twice. The rain had not stopped since Tuesday',
	'and by then it hardly mattered which way the road went.',
].join('\n');

describe('findPassage', () => {
	it('finds the words the reader was pointing at', () => {
		expect(findPassage(chapter, 'road out was gone', 0)).toBe(
			chapter.indexOf('road out was gone'),
		);
	});

	it('takes the copy nearest to where the reader was', () => {
		const repeated = 'The rain had not stopped since Tuesday';
		const first = chapter.indexOf(repeated);
		const second = chapter.indexOf(repeated, first + 1);

		expect(findPassage(chapter, repeated, first)).toBe(first);
		expect(findPassage(chapter, repeated, second)).toBe(second);
		// Between the two, and the nearer one still wins.
		expect(findPassage(chapter, repeated, second - 10)).toBe(second);
	});

	it('gives up rather than guess at a passage too short to place', () => {
		// Eleven characters would be found in almost any chapter, and acting on
		// the wrong copy moves the page somewhere the author never was.
		expect(findPassage(chapter, 'the road', 0)).toBeNull();
		expect(findPassage(chapter, '   \n  ', 0)).toBeNull();
	});

	it('gives up on words the markup broke apart', () => {
		// What the reader saw was `rain had not stopped`; what the file holds is
		// `rain had *not* stopped`, and no amount of looking will match them.
		expect(findPassage('rain had *not* stopped since', 'rain had not stopped', 0))
			.toBeNull();
	});
});
