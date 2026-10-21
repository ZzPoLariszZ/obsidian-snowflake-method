import { beforeEach, describe, expect, it } from "vitest";

import {
	appendJsonRecordFile,
	createOrUpdatePlainFile,
	fileStamp,
	parseJsonObject,
	quarantineJsonFile,
	readStampedJson,
	type StampedMemo,
} from "../../src/services/json-store";
import { SnowflakeProjectService } from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

describe("the JSON file helpers every store shares", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;

	beforeEach(() => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
	});

	it("stamps a file by its time and size", () => {
		expect(fileStamp({ stat: { mtime: 12, size: 34 } })).toBe("12:34");
	});

	it("reads an object, and nothing else", () => {
		expect(parseJsonObject('{"a": 1}')).toEqual({ a: 1 });
		expect(parseJsonObject("[1]")).not.toBeNull();
		expect(parseJsonObject("7")).toBeNull();
		expect(parseJsonObject("{ not json")).toBeNull();
		expect(parseJsonObject(null)).toBeNull();
	});

	it("creates a file, and writes over one that appeared meanwhile", async () => {
		const path = "Notes/kept.json";
		await createOrUpdatePlainFile(service.repository, path, "one\n");
		expect(fakeVault.contents.get(path)).toBe("one\n");
		await createOrUpdatePlainFile(service.repository, path, "two\n");
		expect(fakeVault.contents.get(path)).toBe("two\n");
	});

	it("sets a file aside under a name that says when", async () => {
		await fakeVault.seedFile("Notes/bad.json", "{ not json");
		const aside = await quarantineJsonFile(
			service.repository,
			() => 99,
			"Notes/bad.json",
		);
		expect(aside).toBe("Notes/bad.corrupted-99.json");
		expect(fakeVault.contents.get(aside)).toBe("{ not json");
		expect(fakeVault.contents.has("Notes/bad.json")).toBe(false);
	});

	// ---- Record files ----

	interface ItemsFile {
		items: number[];
	}

	const parseItems = (content: string | null): ItemsFile | null => {
		const object = parseJsonObject(content);
		if (object === null || !Array.isArray(object.items)) return null;
		return { items: object.items as number[] };
	};

	const serializeItems = (file: ItemsFile): string =>
		`${JSON.stringify(file)}\n`;

	const fileAt = (path: string) => {
		const file = service.repository.getFile(path);
		if (file === null) throw new Error(`No file at ${path}`);
		return file;
	};

	it("parses a file once per on-disk state", async () => {
		const path = "Notes/items.json";
		await fakeVault.seedFile(path, '{"items": [1]}');
		const memo: StampedMemo<ItemsFile> = new Map();
		let parses = 0;
		const parse = (content: string | null): ItemsFile | null => {
			parses += 1;
			return parseItems(content);
		};
		const first = await readStampedJson(service.repository, memo, fileAt(path), parse);
		const again = await readStampedJson(service.repository, memo, fileAt(path), parse);
		expect(first).toEqual({ items: [1] });
		expect(again).toBe(first);
		expect(parses).toBe(1);
		// A rewrite moves the stamp, so the next reading parses afresh.
		await service.repository.updatePlainFile(path, () => '{"items": [1, 2]}');
		const after = await readStampedJson(service.repository, memo, fileAt(path), parse);
		expect(after).toEqual({ items: [1, 2] });
		expect(parses).toBe(2);
	});

	it("creates the record file, then merges into it", async () => {
		const path = "Notes/records.json";
		const append = (item: number) =>
			appendJsonRecordFile(service.repository, () => 7, path, parseItems, serializeItems, {
				fresh: () => ({ items: [item] }),
				merge: (parsed) => ({ items: [...parsed.items, item] }),
			});
		expect(await append(1)).toEqual({ aside: null });
		expect(fakeVault.contents.get(path)).toBe('{"items":[1]}\n');
		expect(await append(2)).toEqual({ aside: null });
		expect(fakeVault.contents.get(path)).toBe('{"items":[1,2]}\n');
	});

	it("sets a record file that will not parse aside and starts afresh", async () => {
		const path = "Notes/records.json";
		await fakeVault.seedFile(path, "{ not json");
		const result = await appendJsonRecordFile(
			service.repository,
			() => 42,
			path,
			parseItems,
			serializeItems,
			{ fresh: () => ({ items: [9] }), merge: (parsed) => parsed },
		);
		expect(result).toEqual({ aside: "Notes/records.corrupted-42.json" });
		expect(fakeVault.contents.get("Notes/records.corrupted-42.json")).toBe("{ not json");
		expect(fakeVault.contents.get(path)).toBe('{"items":[9]}\n');
	});
});
