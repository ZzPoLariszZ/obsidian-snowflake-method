import { describe, expect, it } from 'vitest';

import {
	countWriting,
	countableProse,
	isMilestoneMode,
	milestonePositions,
	planMilestoneMarks,
	type MilestoneCountOptions,
} from '../../src/domain';

const words: MilestoneCountOptions = { mode: 'ms-word', headings: 'count' };
const cjk: MilestoneCountOptions = { mode: 'chenggua', headings: 'count' };

describe('milestone positions', () => {
	it('stands on the character where the count reaches each multiple of the interval', () => {
		const body = 'one two three four five six seven';
		const plan = milestonePositions(body, [], words, 3);
		expect(plan.total).toBe(7);
		expect(plan.positions).toEqual([
			{ at: body.indexOf('three'), to: body.indexOf('three') + 1, count: 3 },
			{ at: body.indexOf('six'), to: body.indexOf('six') + 1, count: 6 },
		]);
	});

	it('carries the manuscript held before this note into the counts', () => {
		const body = 'one two three four five';
		// 498 units before: the second word here is the 500th of the book.
		expect(milestonePositions(body, [], words, 500, 498).positions).toEqual([
			{ at: 4, to: 5, count: 500 },
		]);
		// 500 before: the next multiple is further than this note reaches.
		expect(milestonePositions(body, [], words, 500, 500).positions).toEqual([]);
		// 999 before: the first word reaches a thousand.
		expect(milestonePositions(body, [], words, 500, 999).positions).toEqual([
			{ at: 0, to: 1, count: 1000 },
		]);
	});

	it('reads the count the status bar reads, syntax and all', () => {
		const body =
			'# Title\n\n**Bold** and [[Character/Alice|Alice]] met.\n\n%% hidden words here %%\n\nEnd.';
		for (const options of [
			words,
			{ ...words, headings: 'skip-first-h1' as const },
		]) {
			const plan = milestonePositions(body, [], options, 1);
			expect(plan.total).toBe(
				countWriting(countableProse(body, [], options), options).total,
			);
			expect(plan.positions.map((position) => position.count)).toEqual(
				Array.from({ length: plan.total }, (_, index) => index + 1),
			);
		}
	});

	it('labels the title when it counts and passes over it when it does not', () => {
		const body = '# Alice\n\nOne two three.';
		expect(milestonePositions(body, [], words, 1).positions[0]).toMatchObject({
			at: body.indexOf('Alice'),
			count: 1,
		});
		expect(
			milestonePositions(body, [], { ...words, headings: 'skip-first-h1' }, 1)
				.positions[0],
		).toMatchObject({ at: body.indexOf('One'), count: 1 });
	});

	it('stands on a link display text where the page shows it', () => {
		const body = 'see [[Character/Alice|Alice]] now';
		const alias = body.indexOf('|Alice') + 1;
		expect(milestonePositions(body, [], words, 2).positions).toEqual([
			{ at: alias, to: alias + 1, count: 2 },
		]);
	});

	it('spans both units of a character past the BMP, and marks it once', () => {
		// Chenggua reads 𠮷 as two: counts one and two both stand on it, and the
		// second is not drawn again on the same character.
		const body = '𠮷野家';
		const plan = milestonePositions(body, [], cjk, 1);
		expect(plan.total).toBe(4);
		expect(plan.positions).toEqual([
			{ at: 0, to: 2, count: 1 },
			{ at: 2, to: 3, count: 3 },
			{ at: 3, to: 4, count: 4 },
		]);
	});

	it('answers nothing for an interval the note never reaches, or no interval at all', () => {
		const body = 'one two three';
		expect(milestonePositions(body, [], words, 500).positions).toEqual([]);
		expect(milestonePositions(body, [], words, 0).positions).toEqual([]);
		expect(milestonePositions(body, [], words, 2.5).positions).toEqual([]);
		expect(milestonePositions('', [], words, 1)).toEqual({
			positions: [],
			total: 0,
		});
	});

	it('reads a note with Windows line ends the same', () => {
		const lf = 'one two\n\nthree four';
		const crlf = 'one two\r\n\r\nthree four';
		const counts = (body: string): number[] =>
			milestonePositions(body, [], words, 2).positions.map(
				(position) => position.count,
			);
		expect(counts(crlf)).toEqual(counts(lf));
		expect(milestonePositions(crlf, [], words, 2).positions[1]).toMatchObject({
			at: crlf.indexOf('four'),
		});
	});

	it('leaves out what the caller excluded', () => {
		const body = 'PLUGIN WRITTEN one two three';
		const plan = milestonePositions(body, [{ from: 0, to: 15 }], words, 1);
		expect(plan.total).toBe(3);
		expect(plan.positions[0]).toMatchObject({ at: 15, count: 1 });
	});

	it('knows its two modes', () => {
		expect(isMilestoneMode('manuscript')).toBe(true);
		expect(isMilestoneMode('chapter')).toBe(true);
		expect(isMilestoneMode('note')).toBe(false);
		expect(isMilestoneMode(undefined)).toBe(false);
	});
});

describe('milestone marks', () => {
	it('dresses each position as a silent one-character mark carrying its label', () => {
		const body = 'one two three four';
		const plan = milestonePositions(body, [], words, 2);
		expect(
			planMilestoneMarks('note.md', body, plan, (count) => `${count} words`),
		).toEqual([
			{
				from: 4,
				to: 5,
				classes: 'snowflake-method-milestone',
				silent: true,
				label: '2 words',
				occurrence: {
					type: 'milestone',
					path: 'note.md',
					from: 4,
					to: 5,
					matchedText: 't',
					count: 2,
				},
			},
			{
				from: 14,
				to: 15,
				classes: 'snowflake-method-milestone',
				silent: true,
				label: '4 words',
				occurrence: {
					type: 'milestone',
					path: 'note.md',
					from: 14,
					to: 15,
					matchedText: 'f',
					count: 4,
				},
			},
		]);
	});
});
