import { beforeEach, describe, expect, it } from "vitest";

import type { MentionIgnore } from "../../src/domain";
import {
	ANALYSIS_FILE_SCHEMA_VERSION,
	MENTION_STORE_SCHEMA_VERSION,
	MentionStore,
	SnowflakeProjectService,
	type AnalysisFile,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const IGNORES =
	"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/712_Prose_Analysis/mention_ignores.json";
const INDEX =
	"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/713_Entity_Tracking/dev-a_mention_index.json";
const ANALYSIS =
	"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/713_Entity_Tracking/dev-a_analysis_stats.json";

const noteRule: MentionIgnore = {
	scope: "note",
	notePath: "Snowflake Projects/Novel/50_Manuscript/Chapter 1.md",
	memberPath: "Snowflake Projects/Novel/20_Character/Alice.md",
	matchedText: "Alice",
};

describe("MentionStore", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let store: MentionStore;
	let asides: string[];

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
		store = new MentionStore({
			repository: service.repository,
			deviceId: () => "dev-a",
			now: () => 1234,
			onCorrupt: (path) => asides.push(path),
		});
	});

	it("reads no rules where no file stands, and creates one on the first add", async () => {
		expect(await store.readIgnores(project)).toEqual([]);
		expect(await store.addIgnore(project, noteRule)).toBe(true);
		expect(fakeVault.contents.get(IGNORES)).toContain('"scope": "note"');
		expect(await store.readIgnores(project)).toEqual([noteRule]);
	});

	it("refuses a duplicate and removes what stands", async () => {
		await store.addIgnore(project, noteRule);
		expect(await store.addIgnore(project, noteRule)).toBe(false);
		expect(await store.removeIgnore(project, noteRule)).toBe(true);
		expect(await store.readIgnores(project)).toEqual([]);
		expect(await store.removeIgnore(project, noteRule)).toBe(false);
	});

	it("re-reads when the file moved under it", async () => {
		await store.addIgnore(project, noteRule);
		expect(await store.readIgnores(project)).toHaveLength(1);
		// An external edit: the fake ages the stat, so the memo must let go.
		fakeVault.contents.set(
			IGNORES,
			JSON.stringify({
				schemaVersion: MENTION_STORE_SCHEMA_VERSION,
				ignores: [],
			}),
		);
		expect(await store.readIgnores(project)).toEqual([]);
	});

	it("drops malformed entries alone, keeping the readable ones", async () => {
		await fakeVault.seedFile(
			IGNORES,
			JSON.stringify({
				schemaVersion: MENTION_STORE_SCHEMA_VERSION,
				ignores: [noteRule, { scope: "note" }, 7],
			}),
		);
		expect(await store.readIgnores(project)).toEqual([noteRule]);
	});

	it("sets a file that will not parse aside whole and starts fresh", async () => {
		await fakeVault.seedFile(IGNORES, "{ not json");
		expect(await store.readIgnores(project)).toEqual([]);
		const aside = [...fakeVault.contents.keys()].find((path) =>
			path.includes(".corrupted-1234"),
		);
		expect(aside).toBeDefined();
		expect(fakeVault.contents.get(aside as string)).toBe("{ not json");
		expect(asides).toEqual([aside]);
		expect(await store.addIgnore(project, noteRule)).toBe(true);
		expect(await store.readIgnores(project)).toEqual([noteRule]);
	});

	it("refuses a schema it does not write, preserving it aside on the next change", async () => {
		await fakeVault.seedFile(
			IGNORES,
			JSON.stringify({ schemaVersion: 99, ignores: [noteRule] }),
		);
		expect(await store.readIgnores(project)).toEqual([]);
		expect(
			[...fakeVault.contents.keys()].some((path) =>
				path.includes(".corrupted-"),
			),
		).toBe(true);
	});

	it("round-trips this device's index and leaves other devices' files alone", async () => {
		const index = {
			schemaVersion: MENTION_STORE_SCHEMA_VERSION,
			fingerprint: "fp1-abc",
			notes: {
				"Snowflake Projects/Novel/50_Manuscript/Chapter 1.md": {
					stamp: "1:2",
					hits: [],
				},
			},
		};
		await store.writeIndex(project, index);
		expect(fakeVault.contents.has(INDEX)).toBe(true);
		expect(await store.readIndex(project)).toEqual(index);

		const other = new MentionStore({
			repository: service.repository,
			deviceId: () => "dev-b",
			now: () => 1234,
		});
		expect(await other.readIndex(project)).toBeNull();
		await other.writeIndex(project, { ...index, fingerprint: "fp1-def" });
		expect((await store.readIndex(project))?.fingerprint).toBe("fp1-abc");
	});

	it("reads a broken index as absent and drops entries out of shape", async () => {
		await fakeVault.seedFile(INDEX, "{ not json");
		expect(await store.readIndex(project)).toBeNull();
		fakeVault.contents.set(
			INDEX,
			JSON.stringify({
				schemaVersion: MENTION_STORE_SCHEMA_VERSION,
				fingerprint: "fp1-abc",
				notes: { good: { stamp: "1:2", hits: [] }, bad: { stamp: 7 } },
			}),
		);
		expect(Object.keys((await store.readIndex(project))?.notes ?? {})).toEqual([
			"good",
		]);
		fakeVault.contents.set(
			INDEX,
			JSON.stringify({ schemaVersion: 99, fingerprint: "x", notes: {} }),
		);
		expect(await store.readIndex(project)).toBeNull();
	});

	it("drops an index entry whose hits are out of shape, alone", async () => {
		await fakeVault.seedFile(
			INDEX,
			JSON.stringify({
				schemaVersion: MENTION_STORE_SCHEMA_VERSION,
				fingerprint: "fp1-abc",
				notes: {
					// A mangled hit under a valid stamp must never be served warm:
					// the entry reads as absent and recomputes on its next read.
					poisoned: { stamp: "1:2", hits: [42] },
					limbless: {
						stamp: "1:2",
						hits: [{ from: 0, to: 5, matchedText: "Alice", link: null }],
					},
					whole: {
						stamp: "1:2",
						hits: [
							{
								from: 0,
								to: 5,
								matchedText: "Alice",
								link: null,
								candidates: [
									{
										label: "Alice",
										entry: "name",
										memberPath:
											"Snowflake Projects/Novel/20_Character/Alice.md",
										memberName: "Alice",
										group: "character",
										groupRank: 0,
										rank: 0,
										insert: "[[Alice]]",
									},
								],
							},
						],
					},
				},
			}),
		);
		expect(Object.keys((await store.readIndex(project))?.notes ?? {})).toEqual([
			"whole",
		]);
	});

	it("reads a half-shaped pair or hit list as an absent family", async () => {
		await fakeVault.seedFile(
			ANALYSIS,
			JSON.stringify({
				schemaVersion: ANALYSIS_FILE_SCHEMA_VERSION,
				sensitiveFingerprint: "a",
				dialogueFingerprint: "b",
				statsFingerprint: "c",
				tokensFingerprint: "d",
				notes: {
					kept: {
						stamp: "1:2",
						sensitive: [{ term: "damn", from: 0 }],
						dialogue: [["6", 12]],
						stats: null,
						tokens: [[null, 5]],
					},
				},
			}),
		);
		expect((await store.readAnalysis(project))?.notes.kept).toEqual({
			stamp: "1:2",
			sensitive: null,
			dialogue: null,
			stats: null,
			tokens: null,
		});
	});

	it("replaces the index in place on the next write", async () => {
		const base = {
			schemaVersion: MENTION_STORE_SCHEMA_VERSION,
			fingerprint: "fp1-abc",
			notes: {},
		};
		await store.writeIndex(project, base);
		await store.writeIndex(project, { ...base, fingerprint: "fp1-def" });
		expect((await store.readIndex(project))?.fingerprint).toBe("fp1-def");
	});

	it("pins the shipped mention formats: the analysis file moves alone", () => {
		// The ignores and the index validate against this constant; changing
		// it quarantines every reader's own rules on their next edit.
		expect(MENTION_STORE_SCHEMA_VERSION).toBe(1);
		expect(ANALYSIS_FILE_SCHEMA_VERSION).toBe(1);
	});

	it("round-trips this device's analysis under its own name", async () => {
		const file: AnalysisFile = {
			schemaVersion: ANALYSIS_FILE_SCHEMA_VERSION,
			sensitiveFingerprint: "fp1-s",
			dialogueFingerprint: "fp1-d",
			statsFingerprint: "fp1-t",
			tokensFingerprint: "fp1-w",
			notes: {
				"Snowflake Projects/Novel/50_Manuscript/Chapter 1.md": {
					stamp: "1:2",
					sensitive: [{ term: "damn", matchedText: "Damn", from: 0, to: 4 }],
					dialogue: [[6, 12]],
					stats: {
						cjk: 0,
						words: 9,
						counted: 9,
						sentences: 2,
						dialogueCounted: 3,
					},
					tokens: [["fog", 2]],
				},
			},
		};
		await store.writeAnalysis(project, file);
		expect(fakeVault.contents.has(ANALYSIS)).toBe(true);
		expect(await store.readAnalysis(project)).toEqual(file);
		await store.writeAnalysis(project, {
			...file,
			sensitiveFingerprint: "fp1-s2",
		});
		expect((await store.readAnalysis(project))?.sensitiveFingerprint).toBe(
			"fp1-s2",
		);
	});

	it("reads a broken analysis as absent and a family out of shape as null", async () => {
		await fakeVault.seedFile(ANALYSIS, "{ not json");
		expect(await store.readAnalysis(project)).toBeNull();
		fakeVault.contents.set(
			ANALYSIS,
			JSON.stringify({
				schemaVersion: ANALYSIS_FILE_SCHEMA_VERSION,
				sensitiveFingerprint: "a",
				dialogueFingerprint: "b",
				statsFingerprint: "c",
				tokensFingerprint: "d",
				notes: {
					good: {
						stamp: "1:2",
						sensitive: null,
						dialogue: "wrong",
						stats: { cjk: 1 },
						tokens: [["fog", 2]],
					},
					dropped: { sensitive: [] },
				},
			}),
		);
		const read = await store.readAnalysis(project);
		expect(Object.keys(read?.notes ?? {})).toEqual(["good"]);
		expect(read?.notes.good).toEqual({
			stamp: "1:2",
			sensitive: null,
			dialogue: null,
			stats: null,
			tokens: [["fog", 2]],
		});
		fakeVault.contents.set(
			ANALYSIS,
			JSON.stringify({ schemaVersion: 99, notes: {} }),
		);
		expect(await store.readAnalysis(project)).toBeNull();
	});
});
