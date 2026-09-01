import { describe, expect, it } from 'vitest';

import {
	REVISION_CONTEXT_CHARS,
	anchorRevision,
	captureRevision,
	insertionPointHolds,
	isRevision,
	orderRevisions,
	overlapsLive,
	passageContext,
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
	it('holds while its sides hold', () => {
		expect(anchorRevision(BODY, capture('insert', 14, 14))).toEqual({
			state: 'anchored',
			from: 14,
			to: 14,
		});
	});

	it('words typed at the point leave it standing in front of them', () => {
		// The text behind still ends where the point was put, so the point is
		// still there: it holds to what is behind it, as the bar is drawn.
		const rev = capture('insert', 14, 14);
		const typedAt = `${BODY.slice(0, 14)}, and then,${BODY.slice(14)}`;
		expect(anchorRevision(typedAt, rev)).toEqual({
			state: 'anchored',
			from: 14,
			to: 14,
		});
	});

	it('rewriting ahead of the point leaves the side behind holding it', () => {
		const rev = capture('insert', 14, 14);
		const reworded = BODY.replace('stood', 'waited');
		expect(reworded.slice(14, 14 + rev.after.length)).not.toBe(rev.after);
		expect(anchorRevision(reworded, rev)).toEqual({
			state: 'anchored',
			from: 14,
			to: 14,
		});
	});

	it('rewriting behind the point leaves the side ahead holding it', () => {
		const rev = capture('insert', 14, 14);
		const reworded = BODY.replace('grey', 'great grey');
		expect(reworded).not.toContain(rev.before);
		expect(anchorRevision(reworded, rev)).toEqual({
			state: 'moved',
			from: 20,
			to: 20,
		});
	});

	it('moves with both sides when the text lands elsewhere', () => {
		const rev = capture('insert', 14, 14);
		expect(anchorRevision(`Early. ${BODY}`, rev)).toEqual({
			state: 'moved',
			from: 21,
			to: 21,
		});
	});

	it('sides that answer with different places are a conflict', () => {
		// Each half of the sentence is still in the note, but they no longer
		// meet anywhere, so no offset can be called the place.
		const rev = capture('insert', 14, 14);
		const pulledApart = `${BODY.slice(14)} ${BODY.slice(0, 14)}`;
		expect(anchorRevision(pulledApart, rev)).toEqual({ state: 'conflict' });
	});

	it('both sides gone is a conflict', () => {
		const rev = capture('insert', 14, 14);
		expect(anchorRevision('A wholly different sentence.', rev)).toEqual({
			state: 'conflict',
		});
	});

	it('captured in an empty note, it lives only while the note stays empty', () => {
		const rev = captureRevision('50/one.md', '', 'insert', 0, 0, 'x', '', 'rev-4', 7);
		expect(anchorRevision('', rev)).toEqual({ state: 'anchored', from: 0, to: 0 });
		expect(anchorRevision('words now', rev)).toEqual({ state: 'conflict' });
	});

	it('at the body end the side behind is the only side there is', () => {
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

describe('reading order across the manuscript', () => {
	const at = (id: string, path: string, from: number): Revision => ({
		...capture('replace', 4, 14),
		id,
		path,
		from,
		to: from + 4,
	});

	it('follows the notes as the manuscript orders them, then the offsets', () => {
		const order = orderRevisions(
			[at('c', '50/two.md', 10), at('b', '50/one.md', 40), at('a', '50/one.md', 4)],
			['50/one.md', '50/two.md'],
		);
		expect(order.map((rev) => rev.id)).toEqual(['a', 'b', 'c']);
	});

	it('a revision whose note the stream does not carry is left out', () => {
		const order = orderRevisions(
			[at('a', '50/one.md', 4), at('gone', '50/deleted.md', 0)],
			['50/one.md'],
		);
		expect(order.map((rev) => rev.id)).toEqual(['a']);
	});

	it('two at one point keep a settled order, and the input is untouched', () => {
		const given = [at('z', '50/one.md', 4), at('a', '50/one.md', 4)];
		expect(orderRevisions(given, ['50/one.md']).map((rev) => rev.id)).toEqual([
			'a',
			'z',
		]);
		expect(given.map((rev) => rev.id)).toEqual(['z', 'a']);
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

	it('an insertion touching a word borrows it, marked before', () => {
		const { plan } = planRevisionMarks('50/one.md', BODY, [
			capture('insert', 15, 15),
		]);
		// The point stands on the "s" of "stood", with nothing in between.
		expect(plan).toEqual([
			expect.objectContaining({
				from: 15,
				to: 16,
				classes: 'snowflake-method-revision is-insertion',
			}),
		]);
		expect(plan[0]?.occurrence).toMatchObject({ from: 15, to: 15 });
	});

	it('a point before a space belongs to the word behind it', () => {
		const { plan } = planRevisionMarks('50/one.md', BODY, [
			capture('insert', 14, 14),
		]);
		// The space between "heron" and "stood": the bar goes at the end of
		// "heron", not a space away at the head of "stood".
		expect(plan).toEqual([
			expect.objectContaining({
				from: 13,
				to: 14,
				classes: 'snowflake-method-revision is-insertion is-insertion-after',
			}),
		]);
		expect(plan[0]?.occurrence).toMatchObject({ from: 14, to: 14 });
	});

	it('a point inside a run of spaces belongs to the word behind it', () => {
		const body = 'The grey heron    stood in the shallows.';
		// Every position in the run, the one against the next word included.
		for (const at of [14, 15, 16, 17]) {
			const rev = captureRevision('50/one.md', body, 'insert', at, at, 'x', '', `rev-${String(at)}`, 7);
			const { plan } = planRevisionMarks('50/one.md', body, [rev]);
			expect(plan).toEqual([
				expect.objectContaining({
					from: 13,
					to: 14,
					classes: 'snowflake-method-revision is-insertion is-insertion-after',
				}),
			]);
		}
	});

	it('the word behind is taken across a break as readily as along a line', () => {
		const body = `${BODY}\n\n   The water held still.`;
		// A blank line, and the whitespace opening the line after it: the page
		// shows one gap between two paragraphs however these positions differ,
		// and its near edge is where the paragraph above ends.
		for (const at of [
			BODY.length,
			BODY.length + 1,
			BODY.length + 2,
			BODY.length + 3,
			BODY.length + 4,
		]) {
			const rev = captureRevision('50/one.md', body, 'insert', at, at, 'x', '', `rev-${String(at)}`, 7);
			const { plan } = planRevisionMarks('50/one.md', body, [rev]);
			expect(plan).toEqual([
				expect.objectContaining({
					from: BODY.length - 1,
					to: BODY.length,
					classes: 'snowflake-method-revision is-insertion is-insertion-after',
				}),
			]);
		}
	});

	it('only a point with nothing behind it anywhere looks ahead', () => {
		const body = `\n   The water held still.`;
		for (const at of [0, 1, 2, 3]) {
			const rev = captureRevision('50/one.md', body, 'insert', at, at, 'x', '', `rev-${String(at)}`, 7);
			const { plan } = planRevisionMarks('50/one.md', body, [rev]);
			expect(plan).toEqual([
				expect.objectContaining({
					from: 4,
					to: 5,
					classes: 'snowflake-method-revision is-insertion',
				}),
			]);
		}
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

	it('at a paragraph end it stays on that paragraph, marked after', () => {
		const body = `${BODY}\n\nThe water held still.`;
		const rev = captureRevision(
			'50/one.md',
			body,
			'insert',
			BODY.length,
			BODY.length,
			' It waited.',
			'',
			'rev-8',
			7,
		);
		const { plan } = planRevisionMarks('50/one.md', body, [rev]);
		// The full stop that ends the paragraph, not the "T" of the next one.
		expect(plan).toEqual([
			expect.objectContaining({
				from: BODY.length - 1,
				to: BODY.length,
				classes: 'snowflake-method-revision is-insertion is-insertion-after',
			}),
		]);
	});

	it('at a paragraph start it stays on that paragraph, marked before', () => {
		const body = `${BODY}\n\nThe water held still.`;
		const at = BODY.length + 2;
		const rev = captureRevision('50/one.md', body, 'insert', at, at, 'x', '', 'rev-9', 7);
		const { plan } = planRevisionMarks('50/one.md', body, [rev]);
		expect(plan).toEqual([
			expect.objectContaining({
				from: at,
				to: at + 1,
				classes: 'snowflake-method-revision is-insertion',
			}),
		]);
	});

	it('a point on a blank line takes the paragraph above, not the one below', () => {
		const body = `${BODY}\n\nThe water held still.`;
		const at = BODY.length + 1;
		const rev = captureRevision('50/one.md', body, 'insert', at, at, 'x', '', 'rev-10', 7);
		const { plan } = planRevisionMarks('50/one.md', body, [rev]);
		expect(plan[0]).toMatchObject({
			from: BODY.length - 1,
			to: BODY.length,
			classes: 'snowflake-method-revision is-insertion is-insertion-after',
		});
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

/**
 * The editor's own plan. It borrows no character at all: an insertion is a mark
 * of no width standing in the position, drawn there as a bar, so there is no
 * case where the point is shown somewhere other than where the caret was and
 * none where it cannot be shown.
 */
describe('planning the dress for the editor', () => {
	const point = (body: string, at: number): unknown => {
		const rev = captureRevision('50/one.md', body, 'insert', at, at, 'x', '', 'rev-x', 7);
		return planRevisionMarks('50/one.md', body, [rev], true).plan[0];
	};
	const bar = (
		at: number,
	): { from: number; to: number; classes: string } => ({
		from: at,
		to: at,
		classes: 'snowflake-method-revision is-insertion is-point',
	});

	it('stands in the position, whatever the position is', () => {
		const body = `${BODY}   \n\n\n   The water held still.`;
		const places = [
			0, // the head of the note
			14, // a single space between two words
			15, // hard against a word
			BODY.length, // the end of a paragraph
			BODY.length + 1, // inside its trailing spaces
			BODY.length + 3, // past them, at the break
			BODY.length + 5, // a blank line between two paragraphs
			BODY.length + 8, // the whitespace opening the next line
			body.length, // the end of the note
		];
		for (const at of places) {
			expect(point(body, at)).toMatchObject(bar(at));
		}
	});

	it('every position in a run of spaces keeps its own place', () => {
		const body = 'The grey heron    stood in the shallows.';
		for (const at of [14, 15, 16, 17, 18]) {
			expect(point(body, at)).toMatchObject(bar(at));
		}
	});

	it('a body with nothing in it still shows its point', () => {
		// The page has no character to borrow here and draws nothing; the
		// editor has a position, which is all it ever needed.
		for (const body of ['', '  \n\n  ']) {
			const at = Math.min(3, body.length);
			const rev = captureRevision('50/one.md', body, 'insert', at, at, 'x', '', 'rev-6', 7);
			const { plan, anchors } = planRevisionMarks('50/one.md', body, [rev], true);
			expect(plan).toEqual([expect.objectContaining(bar(at))]);
			expect(anchors.get('rev-6')).toEqual({ from: at, to: at });
			expect(planRevisionMarks('50/one.md', body, [rev]).plan).toEqual([]);
		}
	});

	it('covers every revision the page covers, and the same anchors', () => {
		const body = 'The grey heron    stood in the shallows.';
		const revisions = [
			captureRevision('50/one.md', body, 'insert', 15, 15, 'x', '', 'rev-a', 7),
			captureRevision('50/one.md', body, 'replace', 4, 8, 'x', '', 'rev-b', 7),
			captureRevision('50/one.md', body, 'insert', 30, 30, 'x', '', 'rev-c', 7),
		];
		const page = planRevisionMarks('50/one.md', body, revisions);
		const editor = planRevisionMarks('50/one.md', body, revisions, true);
		const ids = (marks: typeof page.plan): unknown[] =>
			marks
				.map((mark) =>
					mark.occurrence.type === 'revision' ? mark.occurrence.revisionId : null,
				)
				.sort();
		// Only where the bars are drawn differs: nothing is left unmarked in
		// one half that the other marks, and the cards read the same offsets.
		expect(ids(editor.plan)).toEqual(ids(page.plan));
		expect(ids(page.plan)).toEqual(['rev-a', 'rev-b', 'rev-c']);
		expect([...editor.anchors]).toEqual([...page.anchors]);
		expect(editor.conflicts).toEqual(page.conflicts);
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

describe('a point and a range over one letter', () => {
	// `overlapsLive` lets a point stand at a range's edge on purpose, and
	// relocation can bring the two together besides. The page holds no two
	// marks over one character -- the wrap verifies what each gathered and
	// drops the pair -- so the plan must never hand it a pair.
	const overlapping = (plan: { from: number; to: number }[]): boolean =>
		plan.some((mark, index) =>
			plan.some(
				(other, at) => at !== index && mark.from < other.to && other.from < mark.to,
			),
		);

	it('a point at a replacement head wears its bar on the replacement', () => {
		const { plan, anchors } = planRevisionMarks('50/one.md', BODY, [
			capture('replace', 4, 14),
			{ ...capture('insert', 4, 4), id: 'rev-point' },
		]);
		expect(overlapping(plan)).toBe(false);
		expect(plan).toEqual([
			expect.objectContaining({
				from: 4,
				to: 14,
				classes: 'snowflake-method-revision is-replace is-insertion',
			}),
		]);
		// The replacement keeps its own element and its own anchor; the point
		// gives up an element, never its place.
		expect(plan[0]?.occurrence).toMatchObject({ revisionId: 'rev-1' });
		expect(anchors.get('rev-point')).toEqual({ from: 4, to: 4 });
	});

	it('a point at a replacement tail wears its bar there too', () => {
		// The character behind offset 14 is the "n" of "heron", inside the
		// range: borrowing it would take the replacement off the page.
		const { plan } = planRevisionMarks('50/one.md', BODY, [
			capture('replace', 4, 14),
			{ ...capture('insert', 14, 14), id: 'rev-point' },
		]);
		expect(overlapping(plan)).toBe(false);
		expect(plan).toEqual([
			expect.objectContaining({
				from: 4,
				to: 14,
				classes:
					'snowflake-method-revision is-replace is-insertion is-insertion-after',
			}),
		]);
	});

	it('two points at one spot raise one bar between them', () => {
		const { plan, anchors } = planRevisionMarks('50/one.md', BODY, [
			{ ...capture('insert', 15, 15), id: 'rev-a' },
			{ ...capture('insert', 15, 15), id: 'rev-b' },
		]);
		expect(overlapping(plan)).toBe(false);
		expect(plan).toHaveLength(1);
		expect(anchors.get('rev-a')).toEqual({ from: 15, to: 15 });
		expect(anchors.get('rev-b')).toEqual({ from: 15, to: 15 });
	});

	it('the editor keeps them apart, having room for a mark of no width', () => {
		const { plan } = planRevisionMarks(
			'50/one.md',
			BODY,
			[capture('replace', 4, 14), { ...capture('insert', 4, 4), id: 'rev-point' }],
			true,
		);
		expect(plan).toHaveLength(2);
		expect(plan.map((mark) => mark.classes)).toEqual([
			'snowflake-method-revision is-insertion is-point',
			'snowflake-method-revision is-replace',
		]);
	});
});

describe('proving an insertion point again', () => {
	it('either side standing is enough, and neither is not', () => {
		const rev = capture('insert', 14, 14);
		expect(insertionPointHolds(BODY, 14, rev.before, rev.after)).toBe(true);
		// The words behind rewritten: the side ahead still holds it.
		const ahead = `The great grey heron${BODY.slice(14)}`;
		expect(insertionPointHolds(ahead, 20, rev.before, rev.after)).toBe(true);
		// Both sides gone from that offset: the point is no longer proved.
		expect(insertionPointHolds('Nothing of the kind at all.', 14, rev.before, rev.after)).toBe(
			false,
		);
	});

	it('a point captured with no witnesses belongs to an empty note alone', () => {
		expect(insertionPointHolds('', 0, '', '')).toBe(true);
		expect(insertionPointHolds('Words.', 0, '', '')).toBe(false);
	});

	it('the context a place is written down with is the same everywhere', () => {
		const rev = capture('replace', 4, 14);
		expect(passageContext(BODY, 4, 14)).toEqual({
			before: rev.before,
			after: rev.after,
		});
	});
});
