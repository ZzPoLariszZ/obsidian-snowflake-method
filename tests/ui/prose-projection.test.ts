import { describe, expect, it } from 'vitest';
import {
	findPassage,
	projectedIndexAt,
	projectProse,
} from '../../src/ui/prose-projection';

/**
 * `projectedIndexAt` is the departure half of the pair: a place in the file,
 * answered as a place in the projected prose, so the caller can walk the
 * rendered page against it. `findPassage` is the arrival half and is exercised
 * here only far enough to pin that the two agree.
 */
describe('projectedIndexAt', () => {
	it('answers the projected place of a source position', () => {
		const source = 'One two.\n\nThree four.';
		const { text, sourceIndexOf } = projectProse(source);
		expect(text).toBe('Onetwo.Threefour.');
		// 'T' of Three: source index 10.
		expect(source.charAt(10)).toBe('T');
		const at = projectedIndexAt(source, 10);
		expect(at).not.toBeNull();
		expect(text.charAt(at ?? 0)).toBe('T');
		expect(sourceIndexOf[at ?? 0]).toBe(10);
	});

	it('steps over the markup a position lands in', () => {
		const source = 'A **bold** word.';
		const { text } = projectProse(source);
		expect(text).toBe('Aboldword.');
		// Inside the opening `**`, which the page never shows: the next thing
		// the reader can actually see is the word it wraps.
		const at = projectedIndexAt(source, source.indexOf('**') + 1);
		expect(text.charAt(at ?? 0)).toBe('b');
	});

	it('holds the end of the note for a position past the last of it', () => {
		const source = 'Only this.\n\n';
		const { text } = projectProse(source);
		const at = projectedIndexAt(source, source.length);
		expect(at).toBe(text.length - 1);
	});

	it('says nothing about a note with no prose in it', () => {
		expect(projectedIndexAt('', 0)).toBeNull();
		expect(projectedIndexAt('\n\n   \n', 2)).toBeNull();
	});

	it('rises with the source, so every position lands in order', () => {
		const source = '# Heading\n\nSome *prose* with a [link](http://x).\n\nMore.';
		let last = -1;
		for (let at = 0; at < source.length; at += 1) {
			const index = projectedIndexAt(source, at);
			if (index === null) continue;
			expect(index).toBeGreaterThanOrEqual(last);
			last = index;
		}
	});

	it('round-trips with findPassage, which reads the other way', () => {
		const source = 'A paragraph worth finding again.\n\nAnd a second one here.';
		const { text, sourceIndexOf } = projectProse(source);
		const found = findPassage(source, 'A paragraph worth finding again.', 0, 0);
		expect(found).toBe(0);
		// Any source position maps to a projected index whose own source
		// position is the first surviving one at or after it.
		const at = projectedIndexAt(source, 2);
		expect(text.charAt(at ?? 0)).toBe('p');
		expect(sourceIndexOf[at ?? 0]).toBe(2);
	});
});
