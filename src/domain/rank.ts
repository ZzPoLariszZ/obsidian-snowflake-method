export const RANK_GAP = 1024;

/**
 * Anything the plugin keeps in an order the author chose: characters and scenes
 * in their tables, segments in a manuscript. Only the stable id and the sparse
 * position are needed to order them, and every record that has an order already
 * carries both, so each of them reaches this module as itself.
 */
export interface Ranked {
	id: string;
	rank: number;
}

function assertRank(rank: number, label: string): void {
	if (!Number.isSafeInteger(rank)) {
		throw new TypeError(`${label} rank must be a safe integer.`);
	}
}

/** Returns an integer rank between neighbours, or null when ranks need repair. */
export function rankBetween(
	before?: number | null,
	after?: number | null,
): number | null {
	if (before !== undefined && before !== null) assertRank(before, 'Before');
	if (after !== undefined && after !== null) assertRank(after, 'After');

	if (before === undefined || before === null) {
		if (after === undefined || after === null) return RANK_GAP;
		const candidate = after - RANK_GAP;
		return Number.isSafeInteger(candidate) ? candidate : null;
	}

	if (after === undefined || after === null) {
		const candidate = before + RANK_GAP;
		return Number.isSafeInteger(candidate) ? candidate : null;
	}

	if (before >= after) return null;
	const candidate = before + Math.floor((after - before) / 2);
	return candidate > before && candidate < after ? candidate : null;
}

export function sortByRank<T extends Ranked>(records: readonly T[]): T[] {
	return records
		.map((record, index) => ({ record, index }))
		.sort((left, right) => {
			const byRank = left.record.rank - right.record.rank;
			if (byRank !== 0) return byRank;
			const byId =
				left.record.id < right.record.id
					? -1
					: left.record.id > right.record.id
						? 1
						: 0;
			return byId !== 0 ? byId : left.index - right.index;
		})
		.map(({ record }) => record);
}

/** Assigns regular ranks while preserving the supplied array order. */
export function normalizeRanks<T extends Ranked>(records: readonly T[]): T[] {
	if (records.length > Math.floor(Number.MAX_SAFE_INTEGER / RANK_GAP)) {
		throw new RangeError('Too many records to assign safe ranks.');
	}
	return records.map((record, index) => {
		const rank = (index + 1) * RANK_GAP;
		return record.rank === rank ? record : { ...record, rank };
	});
}

/** Sorts by the existing rank before assigning regular rank intervals. */
export function repairRanks<T extends Ranked>(records: readonly T[]): T[] {
	return normalizeRanks(sortByRank(records));
}

/**
 * Moves a record in rank order. Usually only the moved record gets a new rank;
 * when no integer gap remains, the returned order is fully normalized.
 */
export function moveRanked<T extends Ranked>(
	records: readonly T[],
	id: string,
	toIndex: number,
): T[] {
	if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= records.length) {
		throw new RangeError(`Target index is out of range: ${toIndex}.`);
	}

	const ordered = sortByRank(records);
	const fromIndex = ordered.findIndex((record) => record.id === id);
	if (fromIndex === -1) {
		throw new Error(`Unknown record: ${id}`);
	}
	if (ordered.filter((record) => record.id === id).length > 1) {
		throw new Error(`Duplicate record id: ${id}`);
	}
	if (fromIndex === toIndex) return ordered;

	const reordered = [...ordered];
	const [moved] = reordered.splice(fromIndex, 1);
	if (moved === undefined) throw new Error(`Unknown record: ${id}`);
	reordered.splice(toIndex, 0, moved);

	const previous = reordered[toIndex - 1];
	const next = reordered[toIndex + 1];
	const rank = rankBetween(previous?.rank, next?.rank);
	if (rank === null) return normalizeRanks(reordered);

	reordered[toIndex] = { ...moved, rank };
	return reordered;
}
