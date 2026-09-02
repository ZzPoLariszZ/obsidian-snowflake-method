import { beforeEach, describe, expect, it } from "vitest";

import {
	createOrUpdatePlainFile,
	fileStamp,
	parseJsonObject,
	quarantineJsonFile,
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
});
