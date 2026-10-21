import {
	boundedBatch,
	type SnapshotBatch,
	type SnapshotRow,
	type SnapshotStoreReader,
} from "../../src/services/file-recovery";

/**
 * File recovery's store as the harvester tests need it: rows added by hand
 * in any order, read back in bounded batches by the same rule the real
 * reader follows, cleared as Obsidian's "Clear history" would, and made to
 * fail a reading on request.
 */
export class FakeSnapshotStore implements SnapshotStoreReader {
	rows: unknown[] = [];
	readonly readCalls: { after: number; limit: number }[] = [];
	private failures = 0;

	add(path: string, ts: number, data: string): SnapshotRow {
		const row = { path, ts, data };
		this.addRaw(row);
		return row;
	}

	/** A row as the store might hold it, shape unvouched for. */
	addRaw(row: unknown): void {
		this.rows.push(row);
		this.rows.sort((left, right) => momentOf(left) - momentOf(right));
	}

	clear(): void {
		this.rows = [];
	}

	failNextRead(times = 1): void {
		this.failures = times;
	}

	read(after: number, limit: number): Promise<SnapshotBatch> {
		this.readCalls.push({ after, limit });
		if (this.failures > 0) {
			this.failures -= 1;
			return Promise.reject(new Error("The store could not be read."));
		}
		const found = this.rows.filter((row) => momentOf(row) > after).slice(0, limit);
		return Promise.resolve(boundedBatch(found, limit));
	}
}

const momentOf = (row: unknown): number =>
	typeof row === "object" && row !== null && typeof (row as { ts?: unknown }).ts === "number"
		? (row as { ts: number }).ts
		: Number.POSITIVE_INFINITY;
