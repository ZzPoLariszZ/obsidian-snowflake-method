import { describe, expect, it } from 'vitest';

import { mentionNoteTitle, truncateEnd } from '../../src/ui/mention-rows';

describe('naming and clipping', () => {
	it('titles a note by its file name, extension set aside', () => {
		expect(mentionNoteTitle('演示/50_正文/第 1 章.md')).toBe('第 1 章');
		expect(mentionNoteTitle('Loose.md')).toBe('Loose');
	});

	it('cuts a clamped line at the end, the head kept whole', () => {
		expect(truncateEnd('「短句」', 10)).toBe('「短句」');
		expect(truncateEnd(`「${'长'.repeat(40)}」`, 11)).toBe(`「${'长'.repeat(9)}…`);
		expect(truncateEnd('a  b\n\nc', 10)).toBe('a b c');
	});

	it('never cuts between the halves of a surrogate pair', () => {
		// 𠮷 is two UTF-16 units; a cut through it would render a lone �.
		const body = `abc${'𠮷'.repeat(4)}`;
		expect(truncateEnd(body, 6)).toBe('abc𠮷…');
		expect(truncateEnd(body, 5)).toBe('abc…');
	});
});
