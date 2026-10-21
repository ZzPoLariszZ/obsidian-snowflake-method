import {
	SNAPSHOT_FILE_SUFFIX,
	addMonths,
	calendarDay,
	emptyNoteSnapshotMonthFile,
	fingerprint,
	historyFilePath,
	historyYearFolder,
	monthKeyOfDay,
	parseNoteSnapshotMonthFile,
	serializeNoteSnapshotMonthFile,
	snapshotConvention,
	withSnapshots,
	type NoteSnapshotMonthFile,
	type NoteSnapshotRecord,
} from "../domain";
import { isPathAtOrBelow } from "../project-root";
import {
	frontmatterLength,
	parseMarkdownFrontmatter,
	type ManagedFrontmatter,
	type VaultRepository,
} from "../repository";
import type { SnapshotRow, SnapshotStoreReader } from "./file-recovery";
import { classifyHistoryPath } from "./history-classify";
import { appendJsonRecordFile, parseJsonObject } from "./json-store";
import { getProjectPathLayout, type ProjectRef } from "./types";
import type { NoteCountOptions, WritingCountService } from "./writing-count";
import type { WritingSessionTimers } from "./writing-session";

/**
 * The harvester: what turns the copies File recovery keeps into the
 * history's own records. The store is a rolling week of this device, with
 * no word when a copy lands, so the harvester reads it on a timer, from
 * where it last left off, in bounded batches; reduces each copy it has
 * not seen to a count and a fingerprint; and files the result under the
 * project, per month, in this device's own file. The text is never kept.
 *
 * Where it stands between passes is the cursor: the moment the store has
 * been read through, and the last version seen of every note, which is
 * what a delta is read against and how a copy of the same text -- synced
 * back, or kept again after a clear -- is known for the same version. The
 * cursor is this device's own, kept beside the plugin's other per-device
 * state and never in the vault, and rebuilt from this device's own files
 * when it is missing.
 */

export const HARVEST_BATCH_ROWS = 200;
export const HARVEST_FIRST_PASS_MS = 30_000;
export const HARVEST_INTERVAL_MS = 5 * 60_000;
export const HARVEST_BACKOFF_MAX_MS = 30 * 60_000;
const HARVEST_BREATH_MS = 12;
/**
 * How long a sighting is kept after its last version: well past File
 * recovery's week, so a copy kept again after a clear is still known for
 * the version it is, and bounded, so the cursor cannot grow with every
 * note a project ever had.
 */
const SIGHTING_RETENTION_MS = 90 * 24 * 60 * 60_000;
export const HARVEST_CURSOR_SCHEMA_VERSION = 1;

/** The last version this device saw of one note, and the convention it was counted under. */
export interface LastSighting {
	ts: number;
	words: number;
	hash: string;
	mode: string;
	headings: string;
}

export interface HarvestProjectCursor {
	/** The project's root as last seen, so a rename or a deletion can be read without asking. */
	root: string;
	/** By path under the root. */
	notes: Record<string, LastSighting>;
}

export interface HarvestCursor {
	schemaVersion: typeof HARVEST_CURSOR_SCHEMA_VERSION;
	/** The moment the store has been read through. */
	watermark: number;
	/** By project id. */
	projects: Record<string, HarvestProjectCursor>;
}

export interface HarvestCursorStore {
	load(): unknown;
	save(cursor: HarvestCursor | null): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

function parseSighting(value: unknown): LastSighting | null {
	if (!isRecord(value)) return null;
	if (!isFiniteNumber(value.ts) || !isFiniteNumber(value.words)) return null;
	if (typeof value.hash !== "string" || value.hash.length === 0) return null;
	if (typeof value.mode !== "string" || typeof value.headings !== "string") return null;
	return {
		ts: value.ts,
		words: value.words,
		hash: value.hash,
		mode: value.mode,
		headings: value.headings,
	};
}

/** A stored cursor, or null for one this build cannot read, which is then rebuilt. */
export function parseHarvestCursor(value: unknown): HarvestCursor | null {
	if (!isRecord(value)) return null;
	if (value.schemaVersion !== HARVEST_CURSOR_SCHEMA_VERSION) return null;
	if (!isFiniteNumber(value.watermark) || value.watermark < 0) return null;
	if (!isRecord(value.projects)) return null;
	const projects: Record<string, HarvestProjectCursor> = {};
	for (const [id, entry] of Object.entries(value.projects)) {
		if (!isRecord(entry) || typeof entry.root !== "string" || !isRecord(entry.notes)) {
			return null;
		}
		const notes: Record<string, LastSighting> = {};
		for (const [path, sighting] of Object.entries(entry.notes)) {
			const parsed = parseSighting(sighting);
			if (parsed === null) return null;
			notes[path] = parsed;
		}
		projects[id] = { root: entry.root, notes };
	}
	return { schemaVersion: HARVEST_CURSOR_SCHEMA_VERSION, watermark: value.watermark, projects };
}

export interface HarvestStatus {
	running: boolean;
	/** The moment the store has been read through, or null before any reading. */
	readThrough: number | null;
	lastPassAt: number | null;
	/** Why the last pass failed, or null when it did not. */
	lastError: string | null;
}

export type HarvesterEvent =
	/** Rows were filed. */
	| { kind: "harvested"; rows: number }
	/** The status moved: a pass began or ended, or failed. */
	| { kind: "status" }
	| { kind: "corrupt-file-preserved"; path: string }
	/**
	 * A note first seen under one path with exactly the text another path
	 * last had, that other path's note being gone: the same note, renamed
	 * where the plugin could not see it, told so the history can chain the
	 * two. Paths under the project root.
	 */
	| { kind: "inferred-rename"; project: ProjectRef; from: string; to: string; ts: number };

export interface SnapshotHarvesterDeps {
	repository: VaultRepository;
	writingCount: WritingCountService;
	/**
	 * The store to read, or null while there is none: the core plugin off,
	 * the setting off, the device without one. Asked at the start of every
	 * pass, so a change takes at the next.
	 */
	reader: () => SnapshotStoreReader | null;
	/** Every project known, for rebuilding the cursor from this device's files. */
	projects: () => readonly ProjectRef[];
	/** The project a vault path belongs to, or null; synchronous, as the sessions ask it. */
	projectAtPath: (path: string) => ProjectRef | null;
	/** What the note's frontmatter says now, for a copy that carries none. */
	frontmatterNow: (path: string) => ManagedFrontmatter | null;
	/** The counting convention in force, read once per pass. */
	countOptions: () => NoteCountOptions;
	cursor: HarvestCursorStore;
	deviceId: () => string;
	timezone: () => string;
	timers: WritingSessionTimers;
	now?: () => number;
	batchRows?: number;
}

/** A record waiting to be filed, with the convention it was counted under. */
interface Pending {
	record: NoteSnapshotRecord;
	mode: string;
	headings: string;
}

const parseSnapshotJson = (content: string | null): NoteSnapshotMonthFile | null =>
	parseNoteSnapshotMonthFile(parseJsonObject(content));

export class SnapshotHarvester {
	private cursor: HarvestCursor | null;
	/** Records gathered and not yet filed, by the file they go in. */
	private readonly unwritten = new Map<string, Pending[]>();
	private running: Promise<void> | null = null;
	private disposed = false;
	private tick: unknown = null;
	private backoffMs = 0;
	private readonly listeners = new Set<(event: HarvesterEvent) => void>();
	private state: HarvestStatus = {
		running: false,
		readThrough: null,
		lastPassAt: null,
		lastError: null,
	};
	private readonly now: () => number;
	private readonly batchRows: number;

	constructor(private readonly deps: SnapshotHarvesterDeps) {
		this.now = deps.now ?? (() => Date.now());
		this.batchRows = deps.batchRows ?? HARVEST_BATCH_ROWS;
		// The stored cursor is read at once, so a rename or a deletion before
		// the first pass moves the sightings it names; one that is missing or
		// unreadable is rebuilt from this device's files when the pass comes.
		this.cursor = parseHarvestCursor(deps.cursor.load());
		if (this.cursor !== null) this.state.readThrough = this.cursor.watermark;
	}

	/** Arms the first pass; the passes then follow one another on the interval. */
	start(): void {
		this.arm(HARVEST_FIRST_PASS_MS);
	}

	/** A pass now, or the one in flight. */
	harvestNow(): Promise<void> {
		return this.pass();
	}

	status(): HarvestStatus {
		return { ...this.state };
	}

	subscribe(listener: (event: HarvesterEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		this.disposed = true;
		this.clearTick();
		this.listeners.clear();
	}

	/** A path moved: the sightings under it move with it, or go where it left the project. */
	notePathRenamed(oldPath: string, newPath: string): void {
		const cursor = this.cursor;
		if (cursor === null) return;
		const shifted = (path: string): string =>
			path === oldPath ? newPath : `${newPath}${path.slice(oldPath.length)}`;
		let moved = false;
		for (const entry of Object.values(cursor.projects)) {
			// The project itself, or a folder above it: the root follows, and
			// every path under it is the same path under the new root.
			if (isPathAtOrBelow(entry.root, oldPath)) {
				entry.root = shifted(entry.root);
				moved = true;
				continue;
			}
			if (!isPathAtOrBelow(oldPath, entry.root)) continue;
			const relOld = oldPath.slice(entry.root.length + 1);
			const relNew = isPathAtOrBelow(newPath, entry.root)
				? newPath.slice(entry.root.length + 1)
				: null;
			for (const key of Object.keys(entry.notes)) {
				if (key !== relOld && !key.startsWith(`${relOld}/`)) continue;
				const sighting = entry.notes[key];
				delete entry.notes[key];
				moved = true;
				if (sighting === undefined || relNew === null) continue;
				entry.notes[key === relOld ? relNew : `${relNew}${key.slice(relOld.length)}`] = sighting;
			}
		}
		if (moved) this.saveCursor(cursor);
	}

	/** A path went: its sightings go with it, a whole project's when the root did. */
	noteDeleted(path: string, { children = false } = {}): void {
		const cursor = this.cursor;
		if (cursor === null) return;
		let dropped = false;
		for (const [id, entry] of Object.entries(cursor.projects)) {
			if (children && isPathAtOrBelow(entry.root, path)) {
				delete cursor.projects[id];
				dropped = true;
				continue;
			}
			if (path === entry.root || !isPathAtOrBelow(path, entry.root)) continue;
			const rel = path.slice(entry.root.length + 1);
			for (const key of Object.keys(entry.notes)) {
				if (key !== rel && !(children && key.startsWith(`${rel}/`))) continue;
				delete entry.notes[key];
				dropped = true;
			}
		}
		if (dropped) this.saveCursor(cursor);
	}

	// ---- the pass ----

	private arm(ms: number): void {
		if (this.disposed) return;
		this.clearTick();
		this.tick = this.deps.timers.set(() => {
			this.tick = null;
			void this.pass();
		}, ms);
	}

	private clearTick(): void {
		if (this.tick === null) return;
		this.deps.timers.clear(this.tick);
		this.tick = null;
	}

	private pass(): Promise<void> {
		if (this.running !== null) return this.running;
		const run = this.runPass()
			.then(
				() => {
					this.backoffMs = 0;
				},
				(error: unknown) => {
					// Read again later, and later still while it keeps failing:
					// a store that cannot be read is not read every five minutes
					// for the rest of the session.
					this.backoffMs = Math.min(
						this.backoffMs === 0 ? HARVEST_INTERVAL_MS : this.backoffMs * 2,
						HARVEST_BACKOFF_MAX_MS,
					);
					this.setStatus({
						lastError: error instanceof Error ? error.message : String(error),
					});
				},
			)
			.finally(() => {
				this.running = null;
				this.setStatus({ running: false });
				if (this.deps.reader() !== null) {
					this.arm(this.backoffMs === 0 ? HARVEST_INTERVAL_MS : this.backoffMs);
				}
			});
		this.running = run;
		return run;
	}

	private async runPass(): Promise<void> {
		const reader = this.deps.reader();
		if (reader === null || this.disposed) return;
		this.setStatus({ running: true });
		const cursor = await this.loadCursor();
		if (this.disposed) return;
		// What a failed pass left unfiled lands first, before the reading
		// moves on past it.
		await this.flushUnwritten();
		const options = this.deps.countOptions();
		for (;;) {
			if (this.disposed) return;
			const batch = await reader.read(cursor.watermark, this.batchRows);
			const kept = await this.gather(cursor, batch.rows, options);
			if (this.disposed) return;
			if (batch.through !== null) cursor.watermark = Math.max(cursor.watermark, batch.through);
			await this.flushUnwritten();
			// Only once the records stand in the vault does the cursor say the
			// store was read through here: a crash between the two reads the
			// same rows again, and reads them the same way.
			this.saveCursor(cursor);
			this.setStatus({ readThrough: cursor.watermark });
			if (kept > 0) this.emit({ kind: "harvested", rows: kept });
			if (!batch.more) break;
		}
		this.setStatus({ lastPassAt: this.now(), lastError: null });
	}

	/** Reduces each row to a record, breathing as it goes; answers how many were kept. */
	private async gather(
		cursor: HarvestCursor,
		rows: readonly SnapshotRow[],
		options: NoteCountOptions,
	): Promise<number> {
		let lastBreath = this.now();
		let kept = 0;
		for (const row of rows) {
			if (this.now() - lastBreath >= HARVEST_BREATH_MS) {
				await this.breathe();
				lastBreath = this.now();
			}
			if (this.disposed) return kept;
			if (this.keep(cursor, row, options)) kept += 1;
		}
		return kept;
	}

	/** A macrotask's worth of air, so a heavy pass never freezes the app. */
	private breathe(): Promise<void> {
		return new Promise((resolve) => {
			this.deps.timers.set(() => {
				resolve();
			}, 0);
		});
	}

	/**
	 * One copy: passed over where it is not a note of a writable project, or
	 * not a note the history speaks of, or a row read before; else counted,
	 * the same text kept again as much as a change, read against the last
	 * version under the same convention, and queued for its month's file.
	 */
	private keep(cursor: HarvestCursor, row: SnapshotRow, options: NoteCountOptions): boolean {
		if (!row.path.toLowerCase().endsWith(".md")) return false;
		const project = this.deps.projectAtPath(row.path);
		if (project === null || project.readOnly) return false;
		if (!isPathAtOrBelow(row.path, project.rootPath) || row.path === project.rootPath) {
			return false;
		}
		const rel = row.path.slice(project.rootPath.length + 1);
		const { frontmatter, body } = splitSnapshot(row.data);
		const ref = classifyHistoryPath(project, rel, [frontmatter, this.deps.frontmatterNow(row.path)]);
		if (ref === null) return false;

		const entry = (cursor.projects[project.id] ??= { root: project.rootPath, notes: {} });
		entry.root = project.rootPath;
		const hash = fingerprint(row.data);
		let seen = entry.notes[rel];
		if (seen === undefined) seen = this.inferRename(project, entry, rel, hash, row.ts);
		// A row read before (a pass that filed its rows and lost its cursor)
		// is known. A later row with the same text is a version the core
		// plugin kept and its dialog lists, so it counts, with nothing added.
		if (seen !== undefined && seen.hash === hash && row.ts <= seen.ts) return false;
		const words = this.deps.writingCount.countBodyWhole(body, options).total;
		// A delta is read only against a version counted the same way; across
		// a change of convention the row is a baseline again.
		const previous =
			seen !== undefined && seen.mode === options.mode && seen.headings === options.headings
				? seen
				: null;
		const record: NoteSnapshotRecord = {
			...ref,
			ts: row.ts,
			words,
			delta: previous === null ? null : words - previous.words,
			...(previous === null ? {} : { prevTs: previous.ts }),
			hash,
		};
		entry.notes[rel] = { ts: row.ts, words, hash, mode: options.mode, headings: options.headings };
		const path = historyFilePath(
			project.rootPath,
			getProjectPathLayout(project.locale).directories.modificationHistory,
			row.ts,
			this.deps.timezone(),
			this.deps.deviceId(),
			SNAPSHOT_FILE_SUFFIX,
		);
		const pending = this.unwritten.get(path) ?? [];
		pending.push({ record, mode: options.mode, headings: options.headings });
		this.unwritten.set(path, pending);
		return true;
	}

	/**
	 * A path never seen whose text is exactly what another path last had,
	 * that other note being gone from the vault: the same note under a new
	 * name, renamed where the plugin could not see it. The sighting moves,
	 * so the versions chain on, and the history is told.
	 */
	private inferRename(
		project: ProjectRef,
		entry: HarvestProjectCursor,
		rel: string,
		hash: string,
		ts: number,
	): LastSighting | undefined {
		for (const [other, sighting] of Object.entries(entry.notes)) {
			if (sighting.hash !== hash) continue;
			if (this.deps.repository.getFile(`${entry.root}/${other}`) !== null) continue;
			delete entry.notes[other];
			entry.notes[rel] = sighting;
			this.emit({ kind: "inferred-rename", project, from: other, to: rel, ts });
			return sighting;
		}
		return undefined;
	}

	/** Files every queued record, a month file at a time; a file that fails stays queued. */
	private async flushUnwritten(): Promise<void> {
		for (const [path, pending] of [...this.unwritten]) {
			const first = pending[0];
			if (first === undefined) {
				this.unwritten.delete(path);
				continue;
			}
			const { aside } = await appendJsonRecordFile(
				this.deps.repository,
				this.now,
				path,
				parseSnapshotJson,
				serializeNoteSnapshotMonthFile,
				{
					fresh: () =>
						withSnapshots(
							emptyNoteSnapshotMonthFile(first.mode, first.headings),
							stamped(pending, { countMode: first.mode, countHeadings: first.headings }),
						),
					merge: (parsed) => withSnapshots(parsed, stamped(pending, parsed)),
				},
			);
			this.unwritten.delete(path);
			if (aside !== null) this.emit({ kind: "corrupt-file-preserved", path: aside });
		}
	}

	// ---- the cursor ----

	private async loadCursor(): Promise<HarvestCursor> {
		if (this.cursor !== null) return this.cursor;
		const cursor: HarvestCursor = {
			schemaVersion: HARVEST_CURSOR_SCHEMA_VERSION,
			watermark: 0,
			projects: {},
		};
		// This device's own files of the current month and the one before
		// say what it last saw: the rows are its own readings of its own
		// store, so the latest of them is where the reading left off.
		const today = calendarDay(this.now(), this.deps.timezone());
		const months = [monthKeyOfDay(addMonths(today, -1)), monthKeyOfDay(today)];
		for (const project of this.deps.projects()) {
			const directory = getProjectPathLayout(project.locale).directories.modificationHistory;
			for (const { year, month } of months) {
				const path = `${historyYearFolder(project.rootPath, directory, year)}/${year}_${month}_${this.deps.deviceId()}${SNAPSHOT_FILE_SUFFIX}`;
				const file = parseSnapshotJson(await this.deps.repository.readPlainFile(path));
				if (file === null) continue;
				const entry = (cursor.projects[project.id] ??= { root: project.rootPath, notes: {} });
				for (const row of file.snapshots) {
					cursor.watermark = Math.max(cursor.watermark, row.ts);
					const seen = entry.notes[row.path];
					if (seen !== undefined && seen.ts > row.ts) continue;
					const convention = snapshotConvention(file, row);
					entry.notes[row.path] = {
						ts: row.ts,
						words: row.words,
						hash: row.hash,
						mode: convention.countMode,
						headings: convention.countHeadings,
					};
				}
			}
		}
		this.cursor = cursor;
		return cursor;
	}

	private saveCursor(cursor: HarvestCursor): void {
		const horizon = this.now() - SIGHTING_RETENTION_MS;
		for (const entry of Object.values(cursor.projects)) {
			for (const [path, sighting] of Object.entries(entry.notes)) {
				if (sighting.ts < horizon) delete entry.notes[path];
			}
		}
		this.deps.cursor.save(cursor);
	}

	// ---- telling ----

	private setStatus(patch: Partial<HarvestStatus>): void {
		const next = { ...this.state, ...patch };
		if (
			next.running === this.state.running &&
			next.readThrough === this.state.readThrough &&
			next.lastPassAt === this.state.lastPassAt &&
			next.lastError === this.state.lastError
		) {
			return;
		}
		this.state = next;
		this.emit({ kind: "status" });
	}

	private emit(event: HarvesterEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}
}

/**
 * A copy's frontmatter and body: the frontmatter null where the copy has
 * none or holds YAML that will not parse, and the body everything after
 * the fences either way, as the count reads a note.
 */
function splitSnapshot(data: string): { frontmatter: ManagedFrontmatter | null; body: string } {
	try {
		const parsed = parseMarkdownFrontmatter(data);
		return { frontmatter: parsed.hasFrontmatter ? parsed.frontmatter : null, body: parsed.body };
	} catch {
		return { frontmatter: null, body: data.slice(frontmatterLength(data)) };
	}
}

/** The records as the file keeps them: the convention stamped only where it differs from the file's own. */
function stamped(
	pending: readonly Pending[],
	header: { countMode: string; countHeadings: string },
): NoteSnapshotRecord[] {
	return pending.map(({ record, mode, headings }) => ({
		...record,
		...(mode === header.countMode ? {} : { countMode: mode }),
		...(headings === header.countHeadings ? {} : { countHeadings: headings }),
	}));
}
