/**
 * The tracking panel's pure half: where mentions fall across the manuscript
 * and how they gather by chapter, kept apart from the DOM so the shapes are
 * pinned by tests that need no workspace.
 */

/** One raised stretch of the distribution, in fractions of the axis. */
export interface DistributionSpan {
	start: number;
	end: number;
}

/**
 * Where the mentions lie along the manuscript: each chapter an equal slot
 * on the axis, a run of consecutive mentioned chapters one raised span --
 * the wide pulse is a stretch of the book, the narrow blip one chapter.
 */
export function distributionSpans(
	order: readonly string[],
	occupied: ReadonlySet<string>,
): DistributionSpan[] {
	const spans: DistributionSpan[] = [];
	if (order.length === 0) return spans;
	let runStart: number | null = null;
	for (let index = 0; index <= order.length; index += 1) {
		const path = order[index];
		const here = path !== undefined && occupied.has(path);
		if (here && runStart === null) runStart = index;
		if (!here && runStart !== null) {
			spans.push({
				start: runStart / order.length,
				end: index / order.length,
			});
			runStart = null;
		}
	}
	return spans;
}

/**
 * The spans drawn as one square wave: a baseline that rises over each span
 * and falls back after it, the reading a barcode of the book. The axis sits
 * a little in from the ends, so a stretch of bare baseline always leads in
 * and out -- the wave rests on a line rather than filling the frame. Sized
 * to the given box; the stroke is the caller's.
 */
export function distributionPath(
	spans: readonly DistributionSpan[],
	width: number,
	height: number,
): string {
	const base = height - 1.5;
	const top = 1.5;
	const inset = width * 0.04;
	const x = (fraction: number): string =>
		String(Math.round((inset + fraction * (width - 2 * inset)) * 100) / 100);
	let path = `M 0 ${String(base)}`;
	for (const span of spans) {
		path +=
			` H ${x(span.start)} V ${String(top)}` +
			` H ${x(span.end)} V ${String(base)}`;
	}
	path += ` H ${String(width)}`;
	return path;
}

/**
 * An occurrence ignore walked back to its offsets: the ordinal counts the
 * note's same-text occurrences in order, non-overlapping the way the
 * matcher's hits are, so the walk advances by the text's own length. Null
 * where the text has moved and the ordinal no longer lands.
 */
export function occurrenceOffsets(
	body: string,
	matchedText: string,
	ordinal: number,
): { from: number; to: number } | null {
	if (matchedText.length === 0) return null;
	let seen = -1;
	let index = body.indexOf(matchedText);
	while (index !== -1) {
		seen += 1;
		if (seen === ordinal) {
			return { from: index, to: index + matchedText.length };
		}
		index = body.indexOf(matchedText, index + matchedText.length);
	}
	return null;
}

/**
 * A gate over async work: at most `limit` tasks run at once, the rest
 * waiting their turn in the order they arrived. The mention modal reads
 * chapter bodies through one, so a wide book fills its lines steadily
 * instead of bursting every read at the vault at once.
 */
export function taskPool(
	limit: number,
): <T>(task: () => Promise<T>) => Promise<T> {
	let active = 0;
	const waiting: (() => void)[] = [];
	const step = (): void => {
		if (active >= limit) return;
		const next = waiting.shift();
		if (next === undefined) return;
		active += 1;
		next();
	};
	return <T>(task: () => Promise<T>): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			waiting.push(() => {
				void task()
					.then(resolve, reject)
					.finally(() => {
						active -= 1;
						step();
					});
			});
			step();
		});
}

/** Occurrences gathered by chapter, first-seen order kept -- which is the
 *  manuscript's, since the lists arrive in manuscript order. */
export function groupByChapter<T extends { path: string }>(
	occurrences: readonly T[],
): { path: string; occurrences: T[] }[] {
	const groups = new Map<string, T[]>();
	for (const occurrence of occurrences) {
		const held = groups.get(occurrence.path);
		if (held === undefined) groups.set(occurrence.path, [occurrence]);
		else held.push(occurrence);
	}
	return [...groups.entries()].map(([path, grouped]) => ({
		path,
		occurrences: grouped,
	}));
}
