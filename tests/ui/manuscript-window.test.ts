import { describe, expect, it } from 'vitest';

import { RANK_GAP, type ManuscriptSegment } from '../../src/domain';
import {
	activeSegmentAt,
	planWindow,
} from '../../src/ui/manuscript-window';

const segments: ManuscriptSegment[] = Array.from({ length: 11 }, (_, index) => ({
	path: `Novel/50_Manuscript/Chapter ${index + 1}.md`,
	projectId: 'project-1',
	title: `Chapter ${index + 1}`,
	sequence: (index + 1) * RANK_GAP,
	hasStoredSequence: true,
}));

const at = (index: number): string =>
	`Novel/50_Manuscript/Chapter ${index}.md`;

describe('planWindow', () => {
	it('mounts the window around the active segment when nothing is loaded', () => {
		const plan = planWindow({
			segments,
			activePath: at(6),
			before: 2,
			after: 2,
			loaded: [],
		});

		expect(plan.visible).toEqual([at(4), at(5), at(6), at(7), at(8)]);
		expect(plan.mount).toEqual(plan.visible);
		expect(plan.unmount).toEqual([]);
	});

	it('mounts ahead and lets go behind as the window moves down', () => {
		const plan = planWindow({
			segments,
			activePath: at(7),
			before: 2,
			after: 2,
			loaded: [at(4), at(5), at(6), at(7), at(8)],
		});

		expect(plan.mount).toEqual([at(9)]);
		expect(plan.unmount).toEqual([at(4)]);
	});

	it('does the same in reverse as the window moves up', () => {
		const plan = planWindow({
			segments,
			activePath: at(5),
			before: 2,
			after: 2,
			loaded: [at(4), at(5), at(6), at(7), at(8)],
		});

		expect(plan.mount).toEqual([at(3)]);
		expect(plan.unmount).toEqual([at(8)]);
	});

	it('reports the ends of the manuscript, not the ends of the window', () => {
		const middle = planWindow({
			segments,
			activePath: at(6),
			before: 2,
			after: 2,
			loaded: [],
		});
		expect(middle.atStart).toBe(false);
		expect(middle.atEnd).toBe(false);

		const opening = planWindow({
			segments,
			activePath: at(1),
			before: 5,
			after: 5,
			loaded: [],
		});
		expect(opening.atStart).toBe(true);
		expect(opening.atEnd).toBe(false);

		const closing = planWindow({
			segments,
			activePath: at(11),
			before: 5,
			after: 5,
			loaded: [],
		});
		expect(closing.atEnd).toBe(true);
	});

	it('never lets go of a segment being edited', () => {
		const plan = planWindow({
			segments,
			activePath: at(10),
			before: 1,
			after: 1,
			loaded: [at(1), at(9), at(10), at(11)],
			editing: at(1),
		});

		expect(plan.unmount).toEqual([]);
		expect(plan.visible).toEqual([at(1), at(9), at(10), at(11)]);
	});

	it('keeps the visible list in reading order', () => {
		const plan = planWindow({
			segments,
			activePath: at(3),
			before: 5,
			after: 0,
			loaded: [at(3), at(1)],
		});
		expect(plan.visible).toEqual([at(1), at(2), at(3)]);
		expect(plan.mount).toEqual([at(2)]);
	});

	it('centres on the first segment when the active one is unknown', () => {
		const plan = planWindow({
			segments,
			activePath: null,
			before: 2,
			after: 1,
			loaded: [],
		});
		expect(plan.visible).toEqual([at(1), at(2)]);
		expect(plan.atStart).toBe(true);
	});

	it('plans nothing for an empty manuscript, and sits at both ends', () => {
		const plan = planWindow({
			segments: [],
			activePath: null,
			before: 5,
			after: 5,
			loaded: [],
		});
		expect(plan).toEqual({
			visible: [],
			mount: [],
			unmount: [],
			atStart: true,
			atEnd: true,
		});
	});
});

describe('activeSegmentAt', () => {
	const offsets = [
		{ path: at(1), top: 0, bottom: 400 },
		{ path: at(2), top: 400, bottom: 900 },
		{ path: at(3), top: 900, bottom: 1500 },
	];

	it('is the first segment at the top of the manuscript', () => {
		expect(activeSegmentAt(offsets, 0, 600)).toBe(at(1));
	});

	it('follows the segment whose top has passed the reading line', () => {
		// Reading line at 200 + 150: still inside the first segment.
		expect(activeSegmentAt(offsets, 200, 600)).toBe(at(1));
		// At 300 + 150 the second segment has crossed it.
		expect(activeSegmentAt(offsets, 300, 600)).toBe(at(2));
		expect(activeSegmentAt(offsets, 800, 600)).toBe(at(3));
	});

	it('has no answer for an empty manuscript', () => {
		expect(activeSegmentAt([], 0, 600)).toBeNull();
	});
});
