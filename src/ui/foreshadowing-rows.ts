import {
	anchorOccurrence,
	orderForeshadowings,
	orderOccurrences,
	resolveEntityRefs,
	revealSpan,
	type EntityRosterEntry,
	type Foreshadowing,
	type ForeshadowingStatus,
	type OccurrenceRole,
	type ResolvedEntityRef,
} from '../domain';

/**
 * The pure half of the Foreshadowing table: the rows shaped from the store,
 * the notes and the roster, the search and the funnel over them, and the
 * flat list the virtual window draws. Nothing here touches the DOM, so all
 * of it runs under the node test runtime; the panel beside it only draws.
 */

/** One chapter as the table needs it. The map's key order is manuscript order. */
export interface ForeshadowingNoteReading {
	title: string;
	/** The body as read; null where the note could not be read at all. */
	body: string | null;
}

export interface ForeshadowingOccurrenceRow {
	id: string;
	itemId: string;
	role: OccurrenceRole;
	note: string;
	path: string;
	/** The chapter's title, or its stem where the manuscript never listed it. */
	title: string;
	/** Anchored and moved both read as live; a conflict reads as unresolved. */
	standing: 'live' | 'unresolved';
	/** Where it stands now; the stored offsets when unresolved. */
	from: number;
	to: number;
	/** The stretch the page can actually flash; null when unresolved. */
	reveal: { from: number; to: number } | null;
	/** The manuscript text it was captured over, which the search reaches. */
	originalText: string;
}

export interface ForeshadowingTableItem {
	id: string;
	name: string;
	description: string;
	status: ForeshadowingStatus;
	related: ResolvedEntityRef[];
	/** In manuscript order. */
	occurrences: ForeshadowingOccurrenceRow[];
	/** How many table rows the thread's own cells stand over: at least one. */
	span: number;
	createdAt: number;
}

const stemOf = (path: string): string =>
	(path.split('/').pop() ?? path).replace(/\.md$/u, '');

/**
 * Every thread shaped for the table: in table order, each occurrence placed
 * by where its words stand in the body handed in -- standing is derived
 * against the body, never trusted stored -- and each ref read against the
 * roster as it is now. A chapter the manuscript never listed is still a row,
 * titled by its stem, as the revision table does.
 */
export function foreshadowingTableItems(
	items: readonly Foreshadowing[],
	notes: ReadonlyMap<string, ForeshadowingNoteReading>,
	roster: readonly EntityRosterEntry[],
): ForeshadowingTableItem[] {
	const strays = [
		...new Set(
			items
				.flatMap((item) => item.occurrences.map((occurrence) => occurrence.path))
				.filter((path) => !notes.has(path)),
		),
	];
	const paths = [...notes.keys(), ...strays];
	const bodyOf = (path: string): string | null => notes.get(path)?.body ?? null;
	return orderForeshadowings(items, paths, bodyOf).map((item) => {
		const occurrences = orderOccurrences(item, paths, bodyOf).map(
			(occurrence): ForeshadowingOccurrenceRow => {
				const body = bodyOf(occurrence.path);
				const anchor =
					body === null
						? { state: 'conflict' as const }
						: anchorOccurrence(body, occurrence);
				const live = anchor.state !== 'conflict';
				const from = anchor.state === 'conflict' ? occurrence.from : anchor.from;
				const to = anchor.state === 'conflict' ? occurrence.to : anchor.to;
				return {
					id: occurrence.id,
					itemId: item.id,
					role: occurrence.role,
					note: occurrence.note,
					path: occurrence.path,
					title: notes.get(occurrence.path)?.title ?? stemOf(occurrence.path),
					standing: live ? 'live' : 'unresolved',
					from,
					to,
					reveal: live && body !== null ? revealSpan(body, from, to) : null,
					originalText: occurrence.originalText,
				};
			},
		);
		return {
			id: item.id,
			name: item.name,
			description: item.description,
			status: item.status,
			related: resolveEntityRefs(item.related, roster),
			occurrences,
			span: Math.max(1, occurrences.length),
			createdAt: item.createdAt,
		};
	});
}

export interface ForeshadowingFilters {
	/** '' means the question is not being asked. */
	status: ForeshadowingStatus | '';
	role: OccurrenceRole | '';
	standing: 'unresolved' | '';
}

/** What a row is drawn in, so the search reaches what the reader can see. */
export interface ForeshadowingLabels {
	status(status: ForeshadowingStatus): string;
	role(role: OccurrenceRole): string;
	/** The word an unresolved place cell wears. */
	unresolved: string;
}

export interface ForeshadowingMatch {
	items: ForeshadowingTableItem[];
	/** Occurrence ids the query or an occurrence-level filter landed on. */
	matched: ReadonlySet<string>;
}

/**
 * The search and the funnel together. The status filter drops whole threads.
 * The role and standing filters are row-level: they name the candidate
 * occurrences, and a thread stands only while it has one. The query is the
 * thread's: it holds on the thread's own text -- name, description, related
 * names, status -- or on any candidate occurrence's. A standing thread keeps
 * every row, and the rows indicated are the candidates the query landed on;
 * a query that landed on the thread itself indicates the candidates the
 * funnel chose and, with no funnel, nothing -- the match was the thread's,
 * not any row's.
 */
export function filterForeshadowingItems(
	items: readonly ForeshadowingTableItem[],
	query: string,
	filters: ForeshadowingFilters,
	labels: ForeshadowingLabels,
): ForeshadowingMatch {
	const needle = query.trim().toLowerCase();
	const holds = (text: string): boolean => text.toLowerCase().includes(needle);
	const rowLevel = filters.role !== '' || filters.standing !== '';
	const passes = (occurrence: ForeshadowingOccurrenceRow): boolean =>
		(filters.role === '' || occurrence.role === filters.role) &&
		(filters.standing === '' || occurrence.standing === filters.standing);
	const hits = (occurrence: ForeshadowingOccurrenceRow): boolean =>
		holds(
			[
				labels.role(occurrence.role),
				occurrence.title,
				occurrence.note,
				occurrence.originalText,
				occurrence.standing === 'unresolved' ? labels.unresolved : '',
			].join('\n'),
		);
	const matched = new Set<string>();
	const kept = items.filter((item) => {
		if (filters.status !== '' && item.status !== filters.status) return false;
		const candidates = rowLevel ? item.occurrences.filter(passes) : item.occurrences;
		if (rowLevel && candidates.length === 0) return false;
		if (needle.length === 0) {
			if (rowLevel) for (const candidate of candidates) matched.add(candidate.id);
			return true;
		}
		const own = holds(
			[
				item.name,
				item.description,
				...item.related.map((ref) => ref.name),
				labels.status(item.status),
			].join('\n'),
		);
		const landed = candidates.filter(hits);
		if (!own && landed.length === 0) return false;
		for (const candidate of own ? (rowLevel ? candidates : []) : landed) {
			matched.add(candidate.id);
		}
		return true;
	});
	return { items: kept, matched };
}

/** One row the virtual window draws: an occurrence, or a thread with none. */
export interface ForeshadowingFlatRow {
	/** Stable across a filter, so a measured height survives one. */
	key: string;
	item: ForeshadowingTableItem;
	occurrence: ForeshadowingOccurrenceRow | null;
	/** The first row of its thread, which carries the thread's own cells. */
	groupHead: boolean;
	groupTail: boolean;
	matched: boolean;
}

/**
 * The threads laid out one row per occurrence, a thread with none taking
 * one row of its own, so the virtual window can draw exactly one `<tr>` per
 * index the way every other table on the dashboard does.
 */
export function flattenForeshadowingRows(
	items: readonly ForeshadowingTableItem[],
	matched: ReadonlySet<string>,
): ForeshadowingFlatRow[] {
	return items.flatMap((item): ForeshadowingFlatRow[] => {
		if (item.occurrences.length === 0) {
			return [
				{
					key: `${item.id}:`,
					item,
					occurrence: null,
					groupHead: true,
					groupTail: true,
					matched: false,
				},
			];
		}
		return item.occurrences.map((occurrence, index) => ({
			key: `${item.id}:${occurrence.id}`,
			item,
			occurrence,
			groupHead: index === 0,
			groupTail: index === item.occurrences.length - 1,
			matched: matched.has(occurrence.id),
		}));
	});
}
