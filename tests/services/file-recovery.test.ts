import { afterEach, describe, expect, it, vi } from "vitest";

import {
	CORE_PLUGINS_SETTINGS_TAB,
	IdbSnapshotStoreReader,
	boundedBatch,
	fileRecoveryAvailability,
	fileRecoveryPlugin,
	isSnapshotRow,
	openFileRecovery,
	openSettingsTab,
} from "../../src/services";
import { FakeSnapshotStore } from "../helpers/fake-snapshot-store";

/** An app whose internal plugins answer with `plugin` for File recovery. */
const appWith = (plugin: unknown, extra: Record<string, unknown> = {}) =>
	({
		internalPlugins: {
			getEnabledPluginById: (id: string) => (id === "file-recovery" ? plugin : null),
		},
		...extra,
	}) as never;

const db = { transaction: () => ({ objectStore: () => ({ index: () => ({ getAll: () => Promise.resolve([]) }) }) }) };

describe("reaching File recovery", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("finds the instance, handed back bare or wrapped, and nothing else", () => {
		const instance = { db, options: { intervalMinutes: 5, keepDays: 7 } };
		expect(fileRecoveryPlugin(appWith(instance))).toBe(instance);
		expect(fileRecoveryPlugin(appWith({ instance }))).toBe(instance);
		expect(fileRecoveryPlugin(appWith(null))).toBeNull();
		expect(fileRecoveryPlugin(appWith(undefined))).toBeNull();
		expect(fileRecoveryPlugin(appWith({ db }))).toBeNull();
		expect(fileRecoveryPlugin(appWith({ instance: { db } }))).toBeNull();
		expect(fileRecoveryPlugin({} as never)).toBeNull();
	});

	it("reads the settings off the instance, and falls back where they are not numbers", () => {
		expect(fileRecoveryAvailability(appWith({ db, options: { intervalMinutes: 2, keepDays: 30 } }))).toEqual({
			state: "available",
			intervalMinutes: 2,
			keepDays: 30,
			db,
		});
		expect(fileRecoveryAvailability(appWith({ db, options: { intervalMinutes: "2", keepDays: 0 } }))).toMatchObject({
			state: "available",
			intervalMinutes: 5,
			keepDays: 7,
		});
	});

	it("tells the core plugin being off from a surface it does not know", () => {
		expect(fileRecoveryAvailability(appWith(null))).toEqual({ state: "disabled" });
		expect(fileRecoveryAvailability({} as never)).toEqual({ state: "unreadable", reason: "internal-plugins" });
		expect(fileRecoveryAvailability(appWith("file-recovery"))).toEqual({ state: "unreadable", reason: "instance" });
		expect(fileRecoveryAvailability(appWith({ db }))).toEqual({ state: "unreadable", reason: "options" });
		expect(fileRecoveryAvailability(appWith({ db: {}, options: {} }))).toEqual({ state: "unreadable", reason: "db" });
	});

	it("reads a missing database as the device keeping no copies, unless the device could", () => {
		// No IndexedDB at all, as on iOS: nothing will ever be there.
		expect(fileRecoveryAvailability(appWith({ db: null, options: {} }))).toEqual({ state: "unsupported" });
		// A device that has IndexedDB and a database not yet opened: look again later.
		vi.stubGlobal("indexedDB", {});
		expect(fileRecoveryAvailability(appWith({ db: null, options: {} }))).toEqual({
			state: "unreadable",
			reason: "db-not-open",
		});
	});
});

describe("reading the store in batches", () => {
	const row = (ts: number, path = "Novel/One.md") => ({ path, ts, data: `text at ${String(ts)}` });

	it("knows a row by its three fields", () => {
		expect(isSnapshotRow(row(1))).toBe(true);
		expect(isSnapshotRow({ path: "x", ts: "1", data: "" })).toBe(false);
		expect(isSnapshotRow({ path: "x", ts: Number.NaN, data: "" })).toBe(false);
		expect(isSnapshotRow({ path: "x", ts: 1 })).toBe(false);
		expect(isSnapshotRow(null)).toBe(false);
	});

	it("holds the last moment of a full reading back for the next, and takes a short reading whole", () => {
		const found = [row(1), row(2), row(3, "Novel/Two.md"), row(3, "Novel/Three.md")];
		expect(boundedBatch(found, 4)).toEqual({ rows: [row(1), row(2)], through: 2, more: true });
		expect(boundedBatch(found, 5)).toEqual({ rows: found, through: 3, more: false });
		expect(boundedBatch([], 5)).toEqual({ rows: [], through: null, more: false });
		// A reading that is one moment through and through is taken whole.
		const one = [row(7), row(7, "Novel/Two.md")];
		expect(boundedBatch(one, 2)).toEqual({ rows: one, through: 7, more: true });
	});

	it("moves past rows it cannot read, so a store full of them is read once", () => {
		const found = [row(1), { path: "Novel/Odd.md", ts: 2 }, { ts: 3, path: 4, data: "" }];
		expect(boundedBatch(found, 10)).toEqual({ rows: [row(1)], through: 3, more: false });
		expect(boundedBatch(found, 3)).toEqual({ rows: [row(1)], through: 2, more: true });
	});

	it("asks idb for the moments after the watermark, in one read-only transaction", async () => {
		const calls: unknown[] = [];
		const found = [row(10), row(11), { odd: true }];
		const fake = {
			transaction: (store: string, mode: string) => {
				calls.push(["transaction", store, mode]);
				return {
					objectStore: (name: string) => {
						calls.push(["objectStore", name]);
						return {
							index: (index: string) => {
								calls.push(["index", index]);
								return {
									getAll: (query: unknown, count?: number) => {
										calls.push(["getAll", query, count]);
										return Promise.resolve(found);
									},
								};
							},
						};
					},
				};
			},
		};
		const reader = new IdbSnapshotStoreReader(fake, (after) => ({ after }));
		expect(await reader.read(9, 3)).toEqual({ rows: [row(10), row(11)], through: 11, more: true });
		expect(calls).toEqual([
			["transaction", "backups", "readonly"],
			["objectStore", "backups"],
			["index", "ts"],
			["getAll", { after: 9 }, 3],
		]);
	});

	it("is read the same way by the fake the harvester tests use", async () => {
		const store = new FakeSnapshotStore();
		store.add("Novel/Two.md", 3, "b");
		store.add("Novel/One.md", 1, "a");
		store.add("Novel/One.md", 3, "c");
		store.addRaw({ ts: 2 });
		expect(await store.read(0, 10)).toEqual({
			rows: [
				{ path: "Novel/One.md", ts: 1, data: "a" },
				{ path: "Novel/Two.md", ts: 3, data: "b" },
				{ path: "Novel/One.md", ts: 3, data: "c" },
			],
			through: 3,
			more: false,
		});
		expect(await store.read(0, 3)).toMatchObject({ through: 2, more: true });
		expect((await store.read(0, 3)).rows).toEqual([{ path: "Novel/One.md", ts: 1, data: "a" }]);
		expect(store.readCalls).toEqual([
			{ after: 0, limit: 10 },
			{ after: 0, limit: 3 },
			{ after: 0, limit: 3 },
		]);
		store.failNextRead();
		await expect(store.read(0, 10)).rejects.toThrow("could not be read");
		expect(await store.read(3, 10)).toEqual({ rows: [], through: null, more: false });
		store.clear();
		expect(await store.read(0, 10)).toEqual({ rows: [], through: null, more: false });
	});
});

describe("Obsidian's own dialogs", () => {
	it("opens the File recovery dialog on the note, and says why it cannot", () => {
		const opened: unknown[] = [];
		const instance = {
			db,
			options: {},
			openModal(path: string) {
				opened.push([this, path]);
			},
		};
		expect(openFileRecovery(appWith(instance), "Novel/One.md")).toBe("opened");
		expect(opened).toEqual([[instance, "Novel/One.md"]]);
		expect(openFileRecovery(appWith(null), "Novel/One.md")).toBe("off");
		expect(openFileRecovery(appWith({ db: null, options: {}, openModal: () => undefined }), "x")).toBe("unsupported");
		expect(openFileRecovery(appWith({ db, options: {} }), "x")).toBe("unsupported");
	});

	it("opens the settings on the core plugins' tab where the app has one", () => {
		const calls: unknown[] = [];
		const setting = {
			open: () => calls.push("open"),
			openTabById: (id: string) => calls.push(["tab", id]),
		};
		expect(openSettingsTab({ setting } as never)).toBe(true);
		expect(calls).toEqual(["open", ["tab", CORE_PLUGINS_SETTINGS_TAB]]);
		// Obsidian 1.14 names the Core plugins tab "plugins"; "core-plugins" opens nothing.
		expect(CORE_PLUGINS_SETTINGS_TAB).toBe("plugins");
		expect(openSettingsTab({ setting } as never, "file-recovery")).toBe(true);
		expect(calls[3]).toEqual(["tab", "file-recovery"]);
		// Settings that open but know no tabs still open.
		expect(openSettingsTab({ setting: { open: () => calls.push("bare") } } as never)).toBe(true);
		expect(calls[calls.length - 1]).toBe("bare");
		expect(openSettingsTab({} as never)).toBe(false);
		expect(openSettingsTab({ setting: {} } as never)).toBe(false);
	});
});
