import { describe, expect, it } from 'vitest';

import {
	offersCreating,
	optionsMatching,
	suggestionRows,
	unpickedOptions,
} from '../../src/ui/option-picker';

const options = [
	{ value: 'omniscient', label: 'Omniscient' },
	{ value: 'multiple', label: 'Multi-POV' },
	{ value: 'a.md', label: 'Ada Lovelace' },
	{ value: 'b.md', label: 'Grace Hopper' },
];

describe('options still on offer', () => {
	it('leaves out the ones already picked', () => {
		expect(
			unpickedOptions(options, ['multiple', 'b.md']).map(
				(option) => option.value,
			),
		).toEqual(['omniscient', 'a.md']);
	});

	it('offers everything when nothing is picked', () => {
		expect(unpickedOptions(options, [])).toHaveLength(4);
	});

	it('offers nothing once every option is picked', () => {
		expect(
			unpickedOptions(
				options,
				options.map((option) => option.value),
			),
		).toEqual([]);
	});

	// A one-value field replaces rather than clears first, so the alternatives
	// have to stay on offer while a value is already picked.
	it('keeps offering the alternatives to a single picked value', () => {
		expect(
			unpickedOptions(options, ['a.md']).map((option) => option.value),
		).toEqual(['omniscient', 'multiple', 'b.md']);
	});
});

describe('matching options against what was typed', () => {
	it('matches anywhere in the label, not just the start', () => {
		expect(optionsMatching(options, 'Hopper').map((o) => o.value)).toEqual([
			'b.md',
		]);
	});

	it('ignores case', () => {
		expect(optionsMatching(options, 'ADA lov').map((o) => o.value)).toEqual([
			'a.md',
		]);
	});

	it('ignores surrounding whitespace', () => {
		expect(optionsMatching(options, '  grace ').map((o) => o.value)).toEqual([
			'b.md',
		]);
	});

	it('returns everything for an empty query, which is how the chevron opens the full list', () => {
		expect(optionsMatching(options, '   ')).toHaveLength(4);
	});

	it('returns nothing when the query matches no label', () => {
		expect(optionsMatching(options, 'Turing')).toEqual([]);
	});

	// The modes are matched by their translated labels like any other option, so
	// typing part of one narrows to it instead of forcing a scroll.
	it('matches a point-of-view mode by its label', () => {
		expect(optionsMatching(options, 'multi-p').map((o) => o.value)).toEqual([
			'multiple',
		]);
	});
});

describe('offering to create what was typed', () => {
	it('offers a name the project does not have', () => {
		expect(offersCreating(options, 'Alan Turing')).toBe(true);
	});

	it('offers a name that only partly matches an existing one', () => {
		expect(offersCreating(options, 'Ada')).toBe(true);
	});

	it('does not offer a name that already exists', () => {
		expect(offersCreating(options, 'Ada Lovelace')).toBe(false);
	});

	it('treats an existing name as taken whatever the casing or spacing', () => {
		expect(offersCreating(options, '  ada LOVELACE ')).toBe(false);
	});

	// Sameness is settled by the same rule the create form applies, so the row is
	// never offered for a name that form would go on to refuse.
	it('treats a name taken but for its inner spacing as taken too', () => {
		expect(offersCreating(options, 'Ada  Lovelace')).toBe(false);
	});

	// The mode labels are options too, so "Omniscient" is a name already spoken
	// for rather than a character waiting to be created.
	it('does not offer a name a point-of-view mode already uses', () => {
		expect(offersCreating(options, 'Omniscient')).toBe(false);
	});

	it('offers nothing for an empty query, which is what the chevron opens with', () => {
		expect(offersCreating(options, '')).toBe(false);
		expect(offersCreating(options, '   ')).toBe(false);
	});

	// The check spans every option rather than the filtered matches, so a name
	// belonging to an already-picked character is not offered for creation.
	it('does not offer a name belonging to an option that is out of the running', () => {
		expect(offersCreating(options, 'Grace Hopper')).toBe(false);
		expect(
			offersCreating(unpickedOptions(options, ['b.md']), 'Grace Hopper'),
		).toBe(true);
	});
});

describe('the rows a list shows', () => {
	const grouped = [
		{ value: 'a', label: 'Arrival', section: 'On this view' },
		{ value: 'b', label: 'Battle', section: 'Not on this view' },
		{ value: 'c', label: 'Chase', section: 'Not on this view' },
		{ value: 'd', label: 'Dusk', section: 'Not on this view' },
	];

	it('names each group above the first of its options that survived the search', () => {
		expect(suggestionRows(grouped, '')).toEqual([
			{ heading: 'On this view' }, grouped[0],
			{ heading: 'Not on this view' }, grouped[1], grouped[2], grouped[3],
		]);
		expect(suggestionRows(grouped, 'us')).toEqual([{ heading: 'Not on this view' }, grouped[3]]);
		expect(suggestionRows(options, 'a')).toEqual([options[2], options[3]]);
	});

	it('shows a capped list up to its cap and says how many were left out, counting options and not headings', () => {
		expect(suggestionRows(grouped, '', { rows: 2 })).toEqual([
			{ heading: 'On this view' }, grouped[0],
			{ heading: 'Not on this view' }, grouped[1],
			{ more: 2 },
		]);
		// Narrowed by typing, the list fits under its cap and says nothing of the rest.
		expect(suggestionRows(grouped, 'a', { rows: 2 })).toEqual([
			{ heading: 'On this view' }, grouped[0],
			{ heading: 'Not on this view' }, grouped[1],
			{ more: 1 },
		]);
		expect(suggestionRows(grouped, 'dusk', { rows: 2 })).toEqual([{ heading: 'Not on this view' }, grouped[3]]);
		expect(suggestionRows(grouped, '', { rows: 4 })).toHaveLength(6);
	});
});
