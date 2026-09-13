import { beforeEach, describe, expect, it } from "vitest";

import {
	JsonDocumentStore,
	SnowflakeProjectService,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

/** A toy document: one line of text, and the entries a reader could not place. */
interface Note {
	text: string;
	strays: readonly unknown[];
}

const FILE = "Snowflake Projects/Novel/70_Tool/notes/note.json";

describe("JsonDocumentStore", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let store: JsonDocumentStore<Note>;
	let asides: string[];
	let foreign: [string, number][];
	let clock: number;

	const reads = (): number =>
		fakeVault.readCalls.filter((path) => path === FILE).length;

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await service.createProject({ title: "Novel", locale: "en" });
		asides = [];
		foreign = [];
		clock = 1234;
		store = new JsonDocumentStore<Note>(
			{
				pathOf: (ref) => `${ref.rootPath}/70_Tool/notes/note.json`,
				schemaVersion: 1,
				empty: () => ({ text: "", strays: [] }),
				readDocument: (file) => {
					if (typeof file.text !== "string") return null;
					return {
						text: file.text,
						strays: Array.isArray(file.strays) ? file.strays : [],
					};
				},
				writeDocument: (held) => ({
					text: held.text,
					strays: held.strays,
				}),
			},
			{
				repository: service.repository,
				now: () => clock,
				onCorrupt: (path) => asides.push(path),
				onForeign: (path, version) => foreign.push([path, version]),
			},
		);
	});

	it("reads an empty document where no file stands, and creates the file on the first write", async () => {
		expect(await store.read(project)).toEqual({ text: "", strays: [] });
		expect(
			await store.update(project, (held) => ({ ...held, text: "one" })),
		).toBe(true);
		const written = fakeVault.contents.get(FILE) ?? "";
		expect(written.startsWith('{\n\t"schemaVersion": 1,\n\t"text": "one"')).toBe(true);
		expect(written.endsWith("\n")).toBe(true);
		expect(await store.read(project)).toEqual({ text: "one", strays: [] });
	});

	it("a mutate answering null on the first write leaves no file behind", async () => {
		expect(await store.update(project, () => null)).toBe(false);
		expect(fakeVault.contents.has(FILE)).toBe(false);
	});

	it("hands each reader a fresh empty document", async () => {
		const first = await store.read(project);
		const second = await store.read(project);
		expect(first).not.toBe(second);
	});

	it("reads once per file version, and lets the memo go only over a write", async () => {
		await store.update(project, (held) => ({ ...held, text: "one" }));
		await store.read(project);
		const before = reads();
		await store.read(project);
		expect(reads()).toBe(before);
		// A write reads the file inside `process`; the memo is what spares the
		// reader that follows a mutate that changed nothing.
		expect(await store.update(project, () => null)).toBe(false);
		expect(reads()).toBe(before + 1);
		await store.read(project);
		expect(reads()).toBe(before + 1);
		await store.update(project, (held) => ({ ...held, text: "two" }));
		expect(reads()).toBe(before + 2);
		expect(await store.read(project)).toEqual({ text: "two", strays: [] });
		expect(reads()).toBe(before + 3);
	});

	it("answers concurrent readers from one read of the file", async () => {
		await store.update(project, (held) => ({ ...held, text: "one" }));
		const before = reads();
		const [first, second] = await Promise.all([
			store.read(project),
			store.read(project),
		]);
		expect(first).toBe(second);
		expect(reads()).toBe(before + 1);
	});

	it("carries what the reader kept back through every write", async () => {
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({ schemaVersion: 1, text: "one", strays: [{ id: 7 }] }),
		);
		expect(await store.read(project)).toEqual({ text: "one", strays: [{ id: 7 }] });
		await store.update(project, (held) => ({ ...held, text: "two" }));
		expect(JSON.parse(fakeVault.contents.get(FILE) ?? "{}")).toEqual({
			schemaVersion: 1,
			text: "two",
			strays: [{ id: 7 }],
		});
	});

	it("leaves a file written to a newer schema exactly as it stands, once told per version", async () => {
		const content = JSON.stringify({ schemaVersion: 2, text: "newer" });
		await fakeVault.seedFile(FILE, content);
		expect(await store.read(project)).toEqual({ text: "", strays: [] });
		await store.read(project);
		expect(foreign).toEqual([[FILE, 2]]);
		expect(
			await store.update(project, (held) => ({ ...held, text: "mine" })),
		).toBe(false);
		expect(fakeVault.contents.get(FILE)).toBe(content);
		expect(foreign).toEqual([[FILE, 2], [FILE, 2]]);
		expect(asides).toEqual([]);
	});

	it("reads the schema line before the shape, so a newer layout is never taken for damage", async () => {
		await fakeVault.seedFile(
			FILE,
			JSON.stringify({ schemaVersion: 2, body: { text: "laid out anew" } }),
		);
		expect(await store.read(project)).toEqual({ text: "", strays: [] });
		expect(foreign).toEqual([[FILE, 2]]);
		expect(asides).toEqual([]);
	});

	it("sets a file that will not read aside, and reads on as empty", async () => {
		await fakeVault.seedFile(FILE, "{ not json");
		expect(await store.read(project)).toEqual({ text: "", strays: [] });
		const aside = FILE.replace(/\.json$/u, ".corrupted-1234.json");
		expect(asides).toEqual([aside]);
		expect(fakeVault.contents.get(aside)).toBe("{ not json");
		expect(fakeVault.contents.has(FILE)).toBe(false);
	});

	it("treats a document the reader refuses, and a schema from before the first, as damage", async () => {
		await fakeVault.seedFile(FILE, JSON.stringify({ schemaVersion: 1, text: 7 }));
		expect(await store.read(project)).toEqual({ text: "", strays: [] });
		expect(asides).toHaveLength(1);
		clock = 5678;
		await fakeVault.seedFile(FILE, JSON.stringify({ schemaVersion: 0, text: "old" }));
		expect(await store.read(project)).toEqual({ text: "", strays: [] });
		expect(asides).toEqual([
			FILE.replace(/\.json$/u, ".corrupted-1234.json"),
			FILE.replace(/\.json$/u, ".corrupted-5678.json"),
		]);
	});

	it("sets a corrupt file aside on a write too, and writes the mutation over an empty document", async () => {
		await fakeVault.seedFile(FILE, "{ not json");
		expect(
			await store.update(project, (held) => ({ ...held, text: "fresh" })),
		).toBe(true);
		expect(asides).toHaveLength(1);
		expect(JSON.parse(fakeVault.contents.get(FILE) ?? "{}")).toEqual({
			schemaVersion: 1,
			text: "fresh",
			strays: [],
		});
	});

	it("forgets a root on eviction", async () => {
		await store.update(project, (held) => ({ ...held, text: "one" }));
		await store.read(project);
		const before = reads();
		store.evict(project.rootPath);
		await store.read(project);
		expect(reads()).toBe(before + 1);
	});
});
