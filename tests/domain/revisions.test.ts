import { describe, expect, it } from 'vitest';

import {
	REVISION_CONTEXT_CHARS,
	anchorRevision,
	captureRevision,
	isRevision,
	overlapsLive,
	planRevisionMarks,
	refreshAnchors,
	resolvePassage,
	type Revision,
} from '../../src/domain';

const BODY = 'The grey heron stood in the shallows, watching the water.';

const capture = (
	kind: 'replace' | 'insert' | 'delete',
	from: number,
	to: number,
	proposed = 'proposed',
	body = BODY,
): Revision =>
	captureRevision('50/one.md', body, kind, from, to, proposed, 'a note', 'rev-1', 7);

describe('capturing a revision', () => {
	it('reads the covered text and its context off the body', () => {
		const rev = capture('replace', 4, 14);
		expect(rev.originalText).toBe('grey heron');
		expect(rev.before).toBe('The ');
		expect(rev.after).toBe(' stood in the sh');
		expect(rev.after).toHaveLength(REVISION_CONTEXT_CHARS);
	});

	it('an insertion is a point over nothing', () => {
		const rev = capture('insert', 14, 99);
		expect(rev.from).toBe(14);
		expect(rev.to).toBe(14);
		expect(rev.originalText).toBe('');
		expect(rev.before).toBe('The grey heron');
		expect(rev.after).toBe(' stood in the sh');
	});

	it('a deletion stores no proposed text whatever was passed', () => {
		expect(capture('delete', 4, 14, 'ignored').proposed).toBe('');
	});
});

describe('the stored shape', () => {
	it('accepts what capture writes', () => {
		expect(isRevision(capture('replace', 4, 14))).toBe(true);
		expect(isRevision(capture('insert', 14, 14))).toBe(true);
		expect(isRevision(capture('delete', 4, 14))).toBe(true);
	});

	it('refuses junk and kinds out of their shapes', () => {
		expect(isRevision(null)).toBe(false);
		expect(isRevision({})).toBe(false);
		expect(isRevision({ ...capture('replace', 4, 14), kind: 'merge' })).toBe(false);
		expect(isRevision({ ...capture('insert', 14, 14), to: 15 })).toBe(false);
		expect(
			isRevision({ ...capture('replace', 4, 14), originalText: 'grey' }),
		).toBe(false);
		expect(isRevision({ ...capture('replace', 4, 14), from: -1 })).toBe(false);
		expect(isRevision({ ...capture('replace', 4, 14), from: 4.5 })).toBe(false);
	});
});

describe('anchoring a range', () => {
	it('text still at its offsets is anchored', () => {
		expect(anchorRevision(BODY, capture('replace', 4, 14))).toEqual({
			state: 'anchored',
			from: 4,
			to: 14,
		});
	});

	it('typing before the range moves it to where the text now stands', () => {
		const grown = `Early. ${BODY}`;
		expect(anchorRevision(grown, capture('replace', 4, 14))).toEqual({
			state: 'moved',
			from: 11,
			to: 21,
		});
	});

	it('editing inside the range is a conflict', () => {
		const edited = BODY.replace('grey heron', 'grey-heron');
		expect(anchorRevision(edited, capture('replace', 4, 14))).toEqual({
			state: 'conflict',
		});
	});

	it('a duplicated passage is told apart by its context', () => {
		const body = '她缓缓地走过桥头。他也缓缓地走过桥头。';
		const from = body.indexOf('也') + 1;
		const rev = captureRevision(
			'50/one.md',
			body,
			'replace',
			from,
			from + 5,
			'快步走过',
			'',
			'rev-2',
			7,
		);
		expect(rev.originalText).toBe('缓缓地走过');
		const grown = `开场白。${body}`;
		expect(anchorRevision(grown, rev)).toEqual({
			state: 'moved',
			from: from + 4,
			to: from + 9,
		});
	});

	it('a duplicated passage with the same context both times is a conflict', () => {
		// The full sixteen characters on each side agree between the copies,
		// so once the stored offset no longer holds, nothing can pick one.
		const wall = 'C'.repeat(16);
		const tail = 'D'.repeat(16);
		const body = `${wall}word${tail}x${wall}word${tail}`;
		const rev = captureRevision(
			'50/one.md',
			body,
			'replace',
			16,
			20,
			'x',
			'',
			'rev-3',
			7,
		);
		expect(rev.before).toBe(wall);
		expect(rev.after).toBe(tail);
		expect(anchorRevision(`zz ${body}`, rev)).toEqual({ state: 'conflict' });
	});
});

describe('anchoring an insertion', () => {
	it('holds while the junction holds, and typing at the point breaks it', () => {
		const rev = capture('insert', 14, 14);
		expect(anchorRevision(BODY, rev)).toEqual({
			state: 'anchored',
			from: 14,
			to: 14,
		});
		const typedAt = `${BODY.slice(0, 14)}X${BODY.slice(14)}`;
		expect(anchorRevision(typedAt, rev)).toEqual({ state: 'conflict' });
	});

	it('moves with its junction when text lands elsewhere', () => {
		const rev = capture('insert', 14, 14);
		expect(anchorRevision(`Early. ${BODY}`, rev)).toEqual({
			state: 'moved',
			from: 21,
			to: 21,
		});
	});

	it('captured in an empty note, it lives only while the note stays empty', () => {
		const rev = captureRevision('50/one.md', '', 'insert', 0, 0, 'x', '', 'rev-4', 7);
		expect(anchorRevision('', rev)).toEqual({ state: 'anchored', from: 0, to: 0 });
		expect(anchorRevision('words now', rev)).toEqual({ state: 'conflict' });
	});

	it('at the body end the junction is the before half alone', () => {
		const rev = capture('insert', BODY.length, BODY.length);
		expect(rev.after).toBe('');
		expect(anchorRevision(`Early. ${BODY}`, rev)).toEqual({
			state: 'moved',
			from: BODY.length + 7,
			to: BODY.length + 7,
		});
	});
});

describe('resolving a passage', () => {
	it('a unique passage needs no context', () => {
		expect(resolvePassage(BODY, 'heron', 'wrong', 'wrong')).toEqual({
			from: 9,
			to: 14,
		});
	});

	it('answers null for text found nowhere, or empty text', () => {
		expect(resolvePassage(BODY, 'egret', '', '')).toBeNull();
		expect(resolvePassage(BODY, '', 'a', 'b')).toBeNull();
	});

	it('context picks between copies, and a tie answers null', () => {
		const body = 'one fish two fish';
		expect(resolvePassage(body, 'fish', 'two ', '')).toEqual({
			from: 13,
			to: 17,
		});
		expect(resolvePassage(body, 'fish', 'xx', 'xx')).toBeNull();
	});
});

describe('overlap between live revisions', () => {
	const standing = [capture('replace', 4, 14)];

	it('a crossing range and a point inside are refused', () => {
		expect(overlapsLive(BODY, standing, '50/one.md', 10, 20)).not.toBeNull();
		expect(overlapsLive(BODY, standing, '50/one.md', 8, 8)).not.toBeNull();
	});

	it('edges touch without overlapping, other notes never clash', () => {
		expect(overlapsLive(BODY, standing, '50/one.md', 14, 20)).toBeNull();
		expect(overlapsLive(BODY, standing, '50/one.md', 4, 4)).toBeNull();
		expect(overlapsLive(BODY, standing, '50/two.md', 10, 20)).toBeNull();
	});

	it('a conflicted revision holds no ground', () => {
		const edited = BODY.replace('grey heron', 'grey-heron');
		expect(overlapsLive(edited, standing, '50/one.md', 4, 14)).toBeNull();
	});
});

describe('planning the dress', () => {
	it('range kinds wear their classes at their anchors', () => {
		const { plan, anchors, conflicts } = planRevisionMarks('50/one.md', BODY, [
			capture('replace', 4, 14),
			{ ...capture('delete', 21, 24), id: 'rev-5' },
		]);
		expect(conflicts).toEqual([]);
		expect(plan.map((mark) => mark.classes)).toEqual([
			'snowflake-method-revision is-replace',
			'snowflake-method-revision is-delete',
		]);
		expect(plan[0]?.occurrence).toMatchObject({
			type: 'revision',
			revisionId: 'rev-1',
			matchedText: 'grey heron',
		});
		expect(anchors.get('rev-5')).toEqual({ from: 21, to: 24 });
	});

	it('an insertion borrows the first visible character after the point', () => {
		const { plan } = planRevisionMarks('50/one.md', BODY, [
			capture('insert', 14, 14),
		]);
		// The point sits before the space; the carrier is the "s" of "stood".
		expect(plan).toEqual([
			expect.objectContaining({
				from: 15,
				to: 16,
				classes: 'snowflake-method-revision is-insertion',
			}),
		]);
		expect(plan[0]?.occurrence).toMatchObject({ from: 14, to: 14 });
	});

	it('at the body end it borrows the last character, marked after', () => {
		const { plan } = planRevisionMarks('50/one.md', BODY, [
			capture('insert', BODY.length, BODY.length),
		]);
		expect(plan).toEqual([
			expect.objectContaining({
				from: BODY.length - 1,
				to: BODY.length,
				classes: 'snowflake-method-revision is-insertion is-insertion-after',
			}),
		]);
	});

	it('a whitespace-only body plans no mark but keeps the anchor', () => {
		const body = '  \n\n  ';
		const rev = captureRevision('50/one.md', body, 'insert', 3, 3, 'x', '', 'rev-6', 7);
		const { plan, anchors, conflicts } = planRevisionMarks('50/one.md', body, [rev]);
		expect(plan).toEqual([]);
		expect(anchors.get('rev-6')).toEqual({ from: 3, to: 3 });
		expect(conflicts).toEqual([]);
	});

	it('splits conflicts out and leaves other notes alone', () => {
		const edited = BODY.replace('grey heron', 'grey-heron');
		const { plan, conflicts } = planRevisionMarks('50/one.md', edited, [
			capture('replace', 4, 14),
			{ ...capture('insert', 0, 0), id: 'rev-7', path: '50/two.md' },
		]);
		expect(plan).toEqual([]);
		expect(conflicts.map((rev) => rev.id)).toEqual(['rev-1']);
	});
});

describe('refreshing anchors at save time', () => {
	it('moved revisions take their found offsets and fresh contexts', () => {
		const grown = `Early. ${BODY}`;
		const { next, changed } = refreshAnchors(grown, [capture('replace', 4, 14)]);
		expect(changed).toBe(true);
		expect(next[0]).toMatchObject({
			from: 11,
			to: 21,
			before: 'Early. The ',
			after: ' stood in the sh',
			originalText: 'grey heron',
		});
	});

	it('an anchored revision with drifted context refreshes the context alone', () => {
		const reworded = BODY.replace('stood', 'stalk');
		const rev = capture('replace', 4, 14);
		const { next, changed } = refreshAnchors(reworded, [rev]);
		expect(changed).toBe(true);
		expect(next[0]).toMatchObject({
			from: 4,
			to: 14,
			after: ' stalk in the sh',
		});
	});

	it('a change past the context window writes nothing', () => {
		const reworded = BODY.replace('watching', 'counting');
		const rev = capture('replace', 4, 14);
		const { next, changed } = refreshAnchors(reworded, [rev]);
		expect(changed).toBe(false);
		expect(next[0]).toBe(rev);
	});

	it('a conflict is left exactly as stored', () => {
		const edited = BODY.replace('grey heron', 'grey-heron');
		const rev = capture('replace', 4, 14);
		const { next, changed } = refreshAnchors(edited, [rev]);
		expect(changed).toBe(false);
		expect(next[0]).toBe(rev);
	});

	it('nothing moved writes nothing', () => {
		const rev = capture('replace', 4, 14);
		const { next, changed } = refreshAnchors(BODY, [rev]);
		expect(changed).toBe(false);
		expect(next[0]).toBe(rev);
	});
});
