import { describe, expect, it } from 'vitest';

import {
	defaultImportSource,
	groupBySeries,
	importSourceOptions,
	seriesLine,
	seriesNames,
} from '../../src/ui/series';

const t = (key: string, vars?: Record<string, string | number>): string =>
	key === 'dashboard.seriesBook' ? `Book ${String(vars?.book)}` : key;

const book = (title: string, name: string | null, number: number | null = null) => ({
	title,
	series: name === null ? null : { name, book: number },
});

describe('groupBySeries', () => {
	it('puts the books of a series together, numbered first and in number order', () => {
		const grouping = groupBySeries([
			book('Third', 'Saga', 3),
			book('Loose one', null),
			book('Unnumbered', 'Saga'),
			book('First', 'Saga', 1),
			book('Other', 'Another'),
			book('Loose two', null),
		]);
		expect(grouping.series.map((group) => group.name)).toEqual(['Another', 'Saga']);
		expect(grouping.series[1]?.books.map((entry) => entry.title)).toEqual([
			'First',
			'Third',
			'Unnumbered',
		]);
		expect(grouping.loose.map((entry) => entry.title)).toEqual(['Loose one', 'Loose two']);
	});

	it('folds two spellings of a name into one series, named as its first book spells it', () => {
		const grouping = groupBySeries([book('A', 'demo', 2), book('B', 'Demo', 1)]);
		expect(grouping.series).toHaveLength(1);
		expect(grouping.series[0]?.name).toBe('demo');
		expect(grouping.series[0]?.books.map((entry) => entry.title)).toEqual(['B', 'A']);
	});

	it('orders series names as a reader would, with numbers in order and case aside', () => {
		const grouping = groupBySeries([
			book('A', 'Volume 10'),
			book('B', 'volume 2'),
			book('C', 'Alpha'),
		]);
		expect(grouping.series.map((group) => group.name)).toEqual(['Alpha', 'volume 2', 'Volume 10']);
	});

	it('settles two books of one number, or none, by title', () => {
		const grouping = groupBySeries([book('Zeta', 'S', 1), book('Alpha', 'S', 1), book('Mid', 'S')]);
		expect(grouping.series[0]?.books.map((entry) => entry.title)).toEqual(['Alpha', 'Zeta', 'Mid']);
	});

	it('leaves a list without a series as it came', () => {
		const grouping = groupBySeries([book('B', null), book('A', null)]);
		expect(grouping.series).toEqual([]);
		expect(grouping.loose.map((entry) => entry.title)).toEqual(['B', 'A']);
	});
});

describe('seriesLine and seriesNames', () => {
	it('writes the series and the book, or the series alone when unnumbered', () => {
		expect(seriesLine(t, { name: 'Saga', book: 2 })).toBe('Saga · Book 2');
		expect(seriesLine(t, { name: 'Saga', book: null })).toBe('Saga');
	});

	it('lists every series once, in name order', () => {
		expect(
			seriesNames([book('A', 'Saga', 2), book('B', 'saga', 1), book('C', 'Alpha'), book('D', null)]),
		).toEqual(['Alpha', 'Saga']);
	});
});

describe('importSourceOptions', () => {
	const words = { sameSeries: 'Same series', others: 'Other projects', archived: 'Archived' };
	const source = (title: string, name: string | null, number: number | null = null, archived = false) => ({
		path: `Root/${title}/Project.md`,
		title,
		series: name === null ? null : { name, book: number },
		locale: 'en' as const,
		archived,
	});

	it('puts the target’s own books first in book order, then the rest, then the archive, each under its heading', () => {
		const options = importSourceOptions(
			[
				source('Loose', null),
				source('Saga 3', 'Saga', 3),
				source('Old', 'Saga', 1, true),
				source('Saga 1', 'saga', 1),
				source('Other 2', 'Other', 2),
			],
			{ name: 'Saga', book: 4 },
			words,
		);
		expect(options.map((option) => `${option.section}: ${option.label}`)).toEqual([
			'Same series: Saga 1',
			'Same series: Saga 3',
			'Other projects: Loose',
			'Other projects: Other 2',
			'Archived: Old',
		]);
		expect(options[0]?.value).toBe('Root/Saga 1/Project.md');
	});

	it('offers every project as other for a target in no series, and leaves out a heading with nothing under it', () => {
		const options = importSourceOptions([source('Saga 1', 'Saga', 1), source('Loose', null)], null, words);
		expect(options.map((option) => option.section)).toEqual(['Other projects', 'Other projects']);
		expect(options.map((option) => option.label)).toEqual(['Saga 1', 'Loose']);
	});
});

describe('defaultImportSource', () => {
	it('offers the lowest-numbered sibling of the target series', () => {
		const sources = [book('Three', 'Saga', 3), book('Other', 'Alpha', 1), book('Two', 'saga', 2)];
		expect(defaultImportSource(sources, { name: 'Saga', book: 4 })?.title).toBe('Two');
	});

	it('offers nothing to a project in no series, or one whose siblings are not on offer', () => {
		const sources = [book('Other', 'Alpha', 1)];
		expect(defaultImportSource(sources, null)).toBeNull();
		expect(defaultImportSource(sources, { name: 'Saga', book: 1 })).toBeNull();
	});
});
