import type { App } from "obsidian";

/**
 * Obsidian's File recovery, as far as the modification history reaches into
 * it. The core plugin keeps a copy of each note every few minutes as it is
 * edited, for about a week, in an IndexedDB database of this device; the
 * copies are what the history counts. None of it is in the public typings:
 * the instance is found through the internal plugins, its `db` is an
 * idb-wrapped database with one store, `backups`, whose rows are
 * `{ path, ts, data }` under an index by `ts`, and its `options` hold the
 * minutes between copies and the days they are kept. Obsidian's own Sync
 * history reads the store the same way, and so do several community
 * plugins, and the shape has not moved since 2022; all the same, every
 * reach goes through a guard here and a mismatch reads as a state the
 * panel can explain rather than a throw.
 *
 * The reading is read-only, in its own transaction, and never opens the
 * database itself: an open with a version above the plugin's own would
 * run its upgrade and empty the store.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const BACKUPS_STORE = "backups";
const MOMENT_INDEX = "ts";
const PLUGIN_ID = "file-recovery";

/** The settings tab the core plugins are turned on and off in: Obsidian names it `plugins`, the community one `community-plugins`. */
export const CORE_PLUGINS_SETTINGS_TAB = "plugins";
/** The core plugin's own settings tab, there while it is on. */
export const FILE_RECOVERY_SETTINGS_TAB = "file-recovery";

export const DEFAULT_SNAPSHOT_INTERVAL_MINUTES = 5;
export const DEFAULT_SNAPSHOT_KEEP_DAYS = 7;

// --- the private surface ----------------------------------------------------

/** idb's wrapped index, as far as the reader asks: every row in a range, up to a count. */
interface IdbIndexLike {
	getAll(query: unknown, count?: number): Promise<unknown>;
}

interface IdbStoreLike {
	index(name: string): IdbIndexLike;
}

interface IdbTransactionLike {
	objectStore(name: string): IdbStoreLike;
}

/** The instance's database, as far as a read-only reach needs it. */
export interface FileRecoveryDbLike {
	transaction(store: string, mode: "readonly"): IdbTransactionLike;
}

/** The core plugin's instance: its database, or null where the device has none, and its options. */
export interface FileRecoveryInstanceLike {
	db: unknown;
	options: Record<string, unknown>;
}

type Reach =
	| { kind: "instance"; instance: FileRecoveryInstanceLike }
	| { kind: "off" }
	| { kind: "drift"; reason: string };

function reach(app: App): Reach {
	const plugins = (app as unknown as { internalPlugins?: unknown }).internalPlugins;
	if (!isRecord(plugins) || typeof plugins.getEnabledPluginById !== "function") {
		return { kind: "drift", reason: "internal-plugins" };
	}
	const plugin = (plugins.getEnabledPluginById as (id: string) => unknown)(PLUGIN_ID);
	if (plugin === null || plugin === undefined) return { kind: "off" };
	if (!isRecord(plugin)) return { kind: "drift", reason: "instance" };
	// Obsidian 1.14 answers with the instance itself; a wrapper that holds it
	// under `instance` is read the same, should a build hand that back instead.
	const instance = isRecord(plugin.instance) ? plugin.instance : plugin;
	if (!isRecord(instance.options)) return { kind: "drift", reason: "options" };
	return { kind: "instance", instance: instance as unknown as FileRecoveryInstanceLike };
}

/** The File recovery core plugin's instance while the plugin is on and answers as expected, else null. */
export function fileRecoveryPlugin(app: App): FileRecoveryInstanceLike | null {
	const reached = reach(app);
	return reached.kind === "instance" ? reached.instance : null;
}

function isSnapshotDb(db: unknown): db is FileRecoveryDbLike {
	return isRecord(db) && typeof db.transaction === "function";
}

export type FileRecoveryAvailability =
	| {
			state: "available";
			intervalMinutes: number;
			keepDays: number;
			db: FileRecoveryDbLike;
	  }
	/** The core plugin is turned off. */
	| { state: "disabled" }
	/** The device keeps no copies: no IndexedDB, as on iOS. */
	| { state: "unsupported" }
	/** The plugin is on, but its surface is not the one this build knows. */
	| { state: "unreadable"; reason: string };

const positiveOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

/**
 * Whether the copies can be read right now, and under what settings. A
 * database of null is the device's answer where it has no IndexedDB, and
 * a database not yet opened on one that has, which a later look may find.
 */
export function fileRecoveryAvailability(app: App): FileRecoveryAvailability {
	const reached = reach(app);
	if (reached.kind === "off") return { state: "disabled" };
	if (reached.kind === "drift") return { state: "unreadable", reason: reached.reason };
	const { db, options } = reached.instance;
	if (db === null || db === undefined) {
		return typeof indexedDB === "undefined"
			? { state: "unsupported" }
			: { state: "unreadable", reason: "db-not-open" };
	}
	if (!isSnapshotDb(db)) return { state: "unreadable", reason: "db" };
	return {
		state: "available",
		intervalMinutes: positiveOr(options.intervalMinutes, DEFAULT_SNAPSHOT_INTERVAL_MINUTES),
		keepDays: positiveOr(options.keepDays, DEFAULT_SNAPSHOT_KEEP_DAYS),
		db,
	};
}

// --- reading the store ------------------------------------------------------

/** One copy as the store keeps it: the path at the time, the moment, the whole text. */
export interface SnapshotRow {
	path: string;
	ts: number;
	data: string;
}

/** One bounded reading of the store. */
export interface SnapshotBatch {
	/** The rows this build can read, ascending by moment. */
	rows: SnapshotRow[];
	/** The last moment the reading reached, which the next reading starts after; null where it reached nothing. */
	through: number | null;
	/** Whether the store may hold rows beyond `through`. */
	more: boolean;
}

export interface SnapshotStoreReader {
	/** Up to `limit` rows kept after the moment `after`; a moment is never split between two readings. */
	read(after: number, limit: number): Promise<SnapshotBatch>;
}

export function isSnapshotRow(value: unknown): value is SnapshotRow {
	return (
		isRecord(value) &&
		typeof value.path === "string" &&
		typeof value.ts === "number" &&
		Number.isFinite(value.ts) &&
		typeof value.data === "string"
	);
}

const momentOf = (value: unknown): number | null =>
	isRecord(value) && typeof value.ts === "number" && Number.isFinite(value.ts) ? value.ts : null;

/**
 * A reading cut to a batch: the store answers `limit` rows at most, in
 * moment order, and a full answer may have stopped partway through a
 * moment. The rows of that last moment are held back for the next reading,
 * which starts after the moment before them, so no row is lost between two
 * readings and none is read twice -- unless the whole answer is one
 * moment, which is then taken whole. Rows this build cannot read still
 * move the reading past them, or a store full of them would be read over
 * and over.
 */
export function boundedBatch(found: readonly unknown[], limit: number): SnapshotBatch {
	const more = found.length >= limit && limit > 0;
	let kept = found;
	if (more) {
		const last = momentOf(found[found.length - 1]);
		let cut = found.length;
		while (cut > 0 && momentOf(found[cut - 1]) === last) cut -= 1;
		if (cut > 0) kept = found.slice(0, cut);
	}
	let through: number | null = null;
	for (const entry of kept) {
		const moment = momentOf(entry);
		if (moment !== null && (through === null || moment > through)) through = moment;
	}
	return { rows: kept.filter(isSnapshotRow), through, more };
}

/** The key range the store is asked for: every moment after `after`. */
function afterMoment(after: number): unknown {
	return IDBKeyRange.lowerBound(after, true);
}

/**
 * The store read through idb: one read-only transaction per reading, with
 * nothing awaited inside it but the one request, since an IndexedDB
 * transaction ends the moment its task awaits anything else.
 */
export class IdbSnapshotStoreReader implements SnapshotStoreReader {
	constructor(
		private readonly db: FileRecoveryDbLike,
		private readonly range: (after: number) => unknown = afterMoment,
	) {}

	async read(after: number, limit: number): Promise<SnapshotBatch> {
		const found: unknown = await this.db
			.transaction(BACKUPS_STORE, "readonly")
			.objectStore(BACKUPS_STORE)
			.index(MOMENT_INDEX)
			.getAll(this.range(after), limit);
		return boundedBatch(Array.isArray(found) ? found : [], limit);
	}
}

// --- Obsidian's own dialogs -------------------------------------------------

/**
 * Opens Obsidian's own File recovery dialog on a note, where its versions
 * are read and restored. Off where the core plugin is; unsupported where
 * the device keeps no copies, or the instance has no dialog to open.
 */
export function openFileRecovery(app: App, path: string): "opened" | "off" | "unsupported" {
	const instance = fileRecoveryPlugin(app);
	if (instance === null) return "off";
	const open = (instance as unknown as { openModal?: unknown }).openModal;
	if (instance.db === null || instance.db === undefined || typeof open !== "function") {
		return "unsupported";
	}
	(instance as unknown as { openModal: (path: string) => void }).openModal(path);
	return "opened";
}

/**
 * Opens the settings on the tab given, the core plugins' by default, where
 * File recovery is turned on. False where the app has no settings surface
 * to open, and the caller then names the way by hand.
 */
export function openSettingsTab(app: App, tabId: string = CORE_PLUGINS_SETTINGS_TAB): boolean {
	const setting = (app as unknown as { setting?: unknown }).setting;
	if (!isRecord(setting) || typeof setting.open !== "function") return false;
	(setting as { open: () => void }).open();
	if (typeof setting.openTabById === "function") {
		(setting as { openTabById: (id: string) => void }).openTabById(tabId);
	}
	return true;
}
