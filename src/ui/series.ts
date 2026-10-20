import { foldName } from '../domain';
import type { ProjectSeries } from '../services';

/** What a project row has to carry to be put with its series. */
export interface SeriesMember {
	title: string;
	series: ProjectSeries | null;
}

export interface SeriesGroup<T extends SeriesMember> {
	/** The series as the first book to name it spells it. */
	name: string;
	books: T[];
}

export interface SeriesGrouping<T extends SeriesMember> {
	series: SeriesGroup<T>[];
	/** The projects in no series, in the order they came. */
	loose: T[];
}

type Words = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The projects put with their series: one group per series name, folded so
 * two spellings of a name are one series, the groups in name order and the
 * books in number order with the unnumbered last and ties settled by title.
 * Then the projects in no series, in the order they arrived, which is the
 * order the rest of the plugin shows them in.
 */
export function groupBySeries<T extends SeriesMember>(
	projects: readonly T[],
): SeriesGrouping<T> {
	const groups = new Map<string, SeriesGroup<T>>();
	const loose: T[] = [];
	for (const project of projects) {
		if (project.series === null) {
			loose.push(project);
			continue;
		}
		const key = foldName(project.series.name);
		const group = groups.get(key);
		if (group === undefined) {
			groups.set(key, { name: project.series.name.trim(), books: [project] });
		} else {
			group.books.push(project);
		}
	}
	const series = [...groups.values()].sort((left, right) =>
		compareNames(left.name, right.name),
	);
	for (const group of series) group.books.sort(compareBooks);
	return { series, loose };
}

/** Name order as a reader expects it: "Book 2" before "Book 10", case aside. */
function compareNames(left: string, right: string): number {
	return left.localeCompare(right, undefined, {
		numeric: true,
		sensitivity: 'base',
	});
}

function compareBooks(left: SeriesMember, right: SeriesMember): number {
	const first = left.series?.book ?? Number.POSITIVE_INFINITY;
	const second = right.series?.book ?? Number.POSITIVE_INFINITY;
	if (first !== second) return first < second ? -1 : 1;
	return compareNames(left.title, right.title);
}

/** Where a project stands, as one line: the series, and the book when numbered. */
export function seriesLine(t: Words, series: ProjectSeries): string {
	if (series.book === null) return series.name;
	return `${series.name} · ${t('dashboard.seriesBook', { book: series.book })}`;
}

/**
 * Every series name the projects use, once each and in name order, for the
 * field that offers them.
 */
export function seriesNames(projects: readonly SeriesMember[]): string[] {
	return groupBySeries(projects).series.map((group) => group.name);
}

/**
 * The project an import offers first: the lowest-numbered sibling in the
 * target's own series, or null when the target has no series or the series
 * has no other book among the sources.
 */
export function defaultImportSource<T extends SeriesMember>(
	sources: readonly T[],
	target: ProjectSeries | null,
): T | null {
	if (target === null) return null;
	const key = foldName(target.name);
	const siblings = sources.filter(
		(source) =>
			source.series !== null && foldName(source.series.name) === key,
	);
	siblings.sort(compareBooks);
	return siblings[0] ?? null;
}
