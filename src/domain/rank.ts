export const RANK_GAP = 1024;

export interface RankedScene {
	sceneId: string;
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

export function sortScenesByRank<T extends RankedScene>(
	scenes: readonly T[],
): T[] {
	return scenes
		.map((scene, index) => ({ scene, index }))
		.sort((left, right) => {
			const byRank = left.scene.rank - right.scene.rank;
			if (byRank !== 0) return byRank;
			const byId =
				left.scene.sceneId < right.scene.sceneId
					? -1
					: left.scene.sceneId > right.scene.sceneId
						? 1
						: 0;
			return byId !== 0 ? byId : left.index - right.index;
		})
		.map(({ scene }) => scene);
}

/** Assigns regular ranks while preserving the supplied array order. */
export function normalizeSceneRanks<T extends RankedScene>(
	scenes: readonly T[],
): T[] {
	if (scenes.length > Math.floor(Number.MAX_SAFE_INTEGER / RANK_GAP)) {
		throw new RangeError('Too many scenes to assign safe ranks.');
	}
	return scenes.map((scene, index) => {
		const rank = (index + 1) * RANK_GAP;
		return scene.rank === rank ? scene : { ...scene, rank };
	});
}

/** Sorts by the existing rank before assigning regular rank intervals. */
export function repairSceneRanks<T extends RankedScene>(scenes: readonly T[]): T[] {
	return normalizeSceneRanks(sortScenesByRank(scenes));
}

/**
 * Moves a scene in rank order. Usually only the moved scene gets a new rank;
 * when no integer gap remains, the returned order is fully normalized.
 */
export function moveScene<T extends RankedScene>(
	scenes: readonly T[],
	sceneId: string,
	toIndex: number,
): T[] {
	if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= scenes.length) {
		throw new RangeError(`Scene target index is out of range: ${toIndex}.`);
	}

	const ordered = sortScenesByRank(scenes);
	const fromIndex = ordered.findIndex((scene) => scene.sceneId === sceneId);
	if (fromIndex === -1) {
		throw new Error(`Unknown scene: ${sceneId}`);
	}
	if (ordered.filter((scene) => scene.sceneId === sceneId).length > 1) {
		throw new Error(`Duplicate scene id: ${sceneId}`);
	}
	if (fromIndex === toIndex) return ordered;

	const reordered = [...ordered];
	const [moved] = reordered.splice(fromIndex, 1);
	if (moved === undefined) throw new Error(`Unknown scene: ${sceneId}`);
	reordered.splice(toIndex, 0, moved);

	const previous = reordered[toIndex - 1];
	const next = reordered[toIndex + 1];
	const rank = rankBetween(previous?.rank, next?.rank);
	if (rank === null) return normalizeSceneRanks(reordered);

	reordered[toIndex] = { ...moved, rank };
	return reordered;
}
