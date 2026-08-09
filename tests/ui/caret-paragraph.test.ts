import { describe, expect, it } from 'vitest';

import { paragraphAround } from '../../src/ui/caret-paragraph';

const source = (text: string): Parameters<typeof paragraphAround>[0] => {
	const lines = text.split('\n');
	return {
		lines: lines.length,
		lineText: (line: number) => lines[line - 1] ?? '',
	};
};

const chapter = source(
	[
		'The rain had not stopped since Tuesday.', // 1
		'The road out was gone.', // 2
		'', // 3
		'She counted the coins twice.', // 4
		'The kettle had not boiled.', // 5
		'Nobody followed them out.', // 6
		'   ', // 7 — whitespace is as blank as nothing
		'', // 8
		'He said the bridge would hold.', // 9
	].join('\n'),
);

describe('paragraphAround', () => {
	it('finds the run of lines the caret line sits in', () => {
		expect(paragraphAround(chapter, 5)).toEqual({ first: 4, last: 6 });
		expect(paragraphAround(chapter, 4)).toEqual({ first: 4, last: 6 });
		expect(paragraphAround(chapter, 6)).toEqual({ first: 4, last: 6 });
	});

	it('stops at the edges of the document', () => {
		expect(paragraphAround(chapter, 1)).toEqual({ first: 1, last: 2 });
		expect(paragraphAround(chapter, 9)).toEqual({ first: 9, last: 9 });
	});

	it('lights nothing from a blank line, however the blank is spelt', () => {
		// A caret between paragraphs is in neither of them.
		expect(paragraphAround(chapter, 3)).toBeNull();
		expect(paragraphAround(chapter, 7)).toBeNull();
		expect(paragraphAround(chapter, 8)).toBeNull();
	});

	it('takes a document with no blank lines whole', () => {
		const solid = source('One line.\nAnother line.\nA third.');
		expect(paragraphAround(solid, 2)).toEqual({ first: 1, last: 3 });
	});

	it('answers nothing for a line the document does not have', () => {
		expect(paragraphAround(chapter, 0)).toBeNull();
		expect(paragraphAround(chapter, 10)).toBeNull();
	});
});
