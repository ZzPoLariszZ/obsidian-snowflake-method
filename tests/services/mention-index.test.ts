import { beforeEach, describe, expect, it } from "vitest";

import type { MentionSource } from "../../src/domain";
import {
	MentionIndexService,
	SnowflakeProjectService,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const ALICE = "Snowflake Projects/Novel/20_Character/Alice.md";
const BOB = "Snowflake Projects/Novel/20_Character/Bob.md";
const INDEX_FILE =
	"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/713_Mention_Index/device_mention_index.json";

const source = (
	label: string,
	entry: "name" | "alias",
	memberPath: string,
): MentionSource => ({
	label,
	entry,
	memberPath,
	memberName: memberPath.replace(/\.md$/u, "").split("/").pop() ?? memberPath,
	group: "character",
	groupRank: 0,
	rank: 0,
	insert: `[[${memberPath.replace(/\.md$/u, "")}|${label}]]`,
});

const ROSTER = [
	source("Alice", "name", ALICE),
	source("Bob", "name", BOB),
	source("小艾", "alias", ALICE),
	source("小艾", "alias", BOB),
];

describe("MentionIndexService", () => {
	let fakeVault: FakeVault;
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;

	const chapter = async (title: string, body: string): Promise<string> => {
		const path = await service.manuscript.appendSegment(project, title);
		const read = await service.manuscript.readSegment(path);
		await service.manuscript.writeSegment(path, body, read.revision);
		return path;
	};

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		service = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await service.createProject({ title: "Novel", locale: "en" });
	});

	it("answers one note's occurrences with the reader's ignores applied", async () => {
		const path = await chapter("One", "Alice met [[Elsewhere|Alice]] and 小艾.");
		const matcher = service.mentions.matcherFor(ROSTER);
		const found = await service.mentions.occurrencesOf(project, matcher, path);
		expect(found.map((entry) => entry.resolution)).toEqual([
			"unique",
			"foreign-link",
			"ambiguous",
		]);

		await service.mentionStore.addIgnore(project, {
			scope: "manuscript",
			memberPath: BOB,
			matchedText: "小艾",
		});
		const after = await service.mentions.occurrencesOf(project, matcher, path);
		expect(after.map((entry) => entry.resolution)).toEqual([
			"unique",
			"foreign-link",
			"unique",
		]);
		expect(after[2]?.resolvedMemberPath).toBe(ALICE);
	});

	it("folds the manuscript per entity, in reading order, guesses set apart", async () => {
		const first = await chapter("One", "Alice woke. 小艾 stirred.");
		const second = await chapter(
			"Two",
			"[[Snowflake Projects/Novel/20_Character/Alice|Alice]] met Bob.",
		);
		const matcher = service.mentions.matcherFor(ROSTER);
		const { entities, unresolved } = await service.mentions.aggregate(
			project,
			matcher,
		);

		const alice = entities.find((entry) => entry.memberPath === ALICE);
		expect(alice).toMatchObject({ total: 2, linked: 1, unlinked: 1 });
		expect(alice?.first).toEqual({ path: first, from: 0 });
		expect(alice?.last?.path).toBe(second);
		const bob = entities.find((entry) => entry.memberPath === BOB);
		expect(bob).toMatchObject({ total: 1, linked: 0, unlinked: 1 });
		expect(unresolved.map((entry) => entry.matchedText)).toEqual(["小艾"]);
	});

	it("re-reads exactly the chapter whose stamp moved", async () => {
		const path = await chapter("One", "Alice waited.");
		const matcher = service.mentions.matcherFor(ROSTER);
		expect(
			(await service.mentions.aggregate(project, matcher)).entities,
		).toHaveLength(1);

		const read = await service.manuscript.readSegment(path);
		await service.manuscript.writeSegment(path, "Bob waited.", read.revision);
		const { entities } = await service.mentions.aggregate(project, matcher);
		expect(entities.map((entry) => entry.memberPath)).toEqual([BOB]);
	});

	it("persists raw hits for this device and starts the next service warm", async () => {
		const path = await chapter("One", "Alice waited.");
		const matcher = service.mentions.matcherFor(ROSTER);
		await service.mentions.aggregate(project, matcher);

		const written = JSON.parse(
			fakeVault.contents.get(INDEX_FILE) ?? "null",
		) as {
			fingerprint: string;
			notes: Record<string, { stamp: string; hits: unknown[] }>;
		} | null;
		expect(written?.fingerprint).toBe(matcher.fingerprint);
		expect(written?.notes[path]?.hits).toHaveLength(1);

		const fresh = new MentionIndexService(
			service.repository,
			service.manuscript,
			service.mentionStore,
		);
		const { entities } = await fresh.aggregate(
			project,
			fresh.matcherFor(ROSTER),
		);
		expect(entities.map((entry) => entry.memberPath)).toEqual([ALICE]);
	});

	it("lets a roster change invalidate everything at once", async () => {
		await chapter("One", "Alice waited.");
		const matcher = service.mentions.matcherFor(ROSTER);
		await service.mentions.aggregate(project, matcher);

		const renamed = service.mentions.matcherFor([
			source("Alicia", "name", ALICE),
		]);
		expect(renamed.fingerprint).not.toBe(matcher.fingerprint);
		const { entities } = await service.mentions.aggregate(project, renamed);
		expect(entities).toHaveLength(0);
		const written = JSON.parse(
			fakeVault.contents.get(INDEX_FILE) ?? "null",
		) as { fingerprint: string } | null;
		expect(written?.fingerprint).toBe(renamed.fingerprint);
	});

	it("forgets a note and its children like every other cache", async () => {
		const path = await chapter("One", "Alice waited.");
		const matcher = service.mentions.matcherFor(ROSTER);
		await service.mentions.aggregate(project, matcher);

		service.mentions.forget(path);
		await service.mentions.flush(project);
		const written = JSON.parse(
			fakeVault.contents.get(INDEX_FILE) ?? "null",
		) as { notes: Record<string, unknown> } | null;
		expect(written?.notes[path]).toBeUndefined();

		// The next walk simply reads it back in.
		const { entities } = await service.mentions.aggregate(project, matcher);
		expect(entities).toHaveLength(1);
	});

	it("reuses one matcher for one roster, however often it is asked", () => {
		const first = service.mentions.matcherFor(ROSTER);
		expect(service.mentions.matcherFor([...ROSTER].reverse())).toBe(first);
		expect(
			service.mentions.matcherFor([source("Alice", "name", ALICE)]),
		).not.toBe(first);
	});
});
