import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseQuotePair, type DialogueStyle } from "../../src/domain";
import {
	ManuscriptAnalysisService,
	SnowflakeProjectService,
	type AnalysisConfig,
	type ProjectSnapshot,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const ANALYSIS_FILE =
	"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/713_Mention_Index/device_analysis_stats.json";

const styles = (...tokens: readonly string[]): DialogueStyle[] =>
	tokens
		.map((token) => parseQuotePair(token))
		.filter((style): style is DialogueStyle => style !== null);

const config = (over: Partial<AnalysisConfig> = {}): AnalysisConfig => ({
	sensitiveTerms: ["damn"],
	dialogueStyles: styles("「」", "“”"),
	locale: "zh",
	...over,
});

describe("ManuscriptAnalysisService", () => {
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

	it("measures every chapter in manuscript order and folds the totals", async () => {
		const first = await chapter("One", "他说：「你好啊」然后走了。");
		const second = await chapter("Two", "It rained. He left.");
		const { perNote, totals } = await service.analysis.statistics(
			project,
			config(),
		);
		// The seeded Draft chapter walks first, measuring nothing.
		expect(perNote.map((row) => row.path)).toEqual([
			"Snowflake Projects/Novel/50_Manuscript/Draft.md",
			first,
			second,
		]);
		expect(perNote[1]).toMatchObject({
			title: "One",
			cjk: 9,
			words: 0,
			sentences: 1,
			dialogueCjk: 3,
			dialogueWords: 0,
		});
		expect(perNote[2]).toMatchObject({
			cjk: 0,
			words: 4,
			sentences: 2,
			dialogueCjk: 0,
		});
		// The Draft seed is measured honestly: "# Draft" and "Write here."
		// are three words and two sentences of its own.
		expect(perNote[0]).toMatchObject({ cjk: 0, words: 3, sentences: 2 });
		expect(totals).toEqual({
			cjk: 9,
			words: 7,
			sentences: 5,
			dialogueCjk: 3,
			dialogueWords: 0,
			chapters: 3,
		});
	});

	it("folds sensitive terms with zero-count rows kept", async () => {
		const path = await chapter("One", "Damn the fog. He said damn.");
		const rows = await service.analysis.sensitiveAggregate(
			project,
			config({ sensitiveTerms: ["damn", "blast"] }),
		);
		expect(rows.map((row) => [row.term, row.total])).toEqual([
			["damn", 2],
			["blast", 0],
		]);
		expect(rows[0]?.occurrences[0]).toMatchObject({
			type: "sensitive",
			path,
			matchedText: "Damn",
			term: "damn",
		});
	});

	it("lists dialogue chapters and answers one chapter's quoted text live", async () => {
		await chapter("One", "没有引号的一段。");
		const spoken = await chapter("Two", "「走吧」他说。又是「好」。");
		const chapters = await service.analysis.dialogueChapters(
			project,
			config(),
		);
		expect(chapters).toEqual([{ path: spoken, title: "Two", count: 2 }]);
		const occurrences = await service.analysis.dialogueOccurrences(
			config(),
			spoken,
		);
		expect(occurrences.map((entry) => entry.matchedText)).toEqual([
			"「走吧」",
			"「好」",
		]);
	});

	it("answers warm walks without a single read", async () => {
		await chapter("One", "Damn the fog. 「走吧」他说。");
		await service.analysis.statistics(project, config());
		const reads = vi.spyOn(service.repository, "tryReadManaged");
		await service.analysis.statistics(project, config());
		await service.analysis.frequency(project, config(), {
			stopwords: null,
			exclude: null,
		});
		await service.analysis.sensitiveAggregate(project, config());
		await service.analysis.dialogueChapters(project, config());
		expect(reads).not.toHaveBeenCalled();
		reads.mockRestore();
	});

	it("keeps the other families warm when one fingerprint moves", async () => {
		await chapter("One", "Damn the fog.");
		await service.analysis.statistics(project, config());
		const reads = vi.spyOn(service.repository, "tryReadManaged");
		// A new sensitive list: the tokens' fingerprint has not moved, so the
		// frequency walk still answers from what it holds.
		const edited = config({ sensitiveTerms: ["blast"] });
		await service.analysis.frequency(project, edited, {
			stopwords: null,
			exclude: null,
		});
		expect(reads).not.toHaveBeenCalled();
		// The sensitive family itself went stale and pays the read.
		await service.analysis.sensitiveAggregate(project, edited);
		expect(reads).toHaveBeenCalled();
		reads.mockRestore();
	});

	it("re-reads exactly the chapter whose stamp moved", async () => {
		const path = await chapter("One", "Damn it.");
		await chapter("Two", "Quiet here.");
		await service.analysis.sensitiveAggregate(project, config());
		const read = await service.manuscript.readSegment(path);
		await service.manuscript.writeSegment(path, "All calm.", read.revision);
		const reads = vi.spyOn(service.repository, "tryReadManaged");
		const rows = await service.analysis.sensitiveAggregate(project, config());
		expect(reads).toHaveBeenCalledTimes(1);
		expect(rows.find((row) => row.term === "damn")?.total).toBe(0);
		reads.mockRestore();
	});

	it("persists per device and starts the next service warm, family by family", async () => {
		await chapter("One", "Damn the fog. 「走吧」");
		await service.analysis.statistics(project, config());
		const written = JSON.parse(
			fakeVault.contents.get(ANALYSIS_FILE) ?? "null",
		) as {
			sensitiveFingerprint: string;
			notes: Record<string, { sensitive: unknown[]; tokens: unknown[] }>;
		} | null;
		expect(written).not.toBeNull();
		expect(Object.values(written?.notes ?? {})[0]?.tokens.length).toBeGreaterThan(
			0,
		);

		const fresh = new ManuscriptAnalysisService(
			service.repository,
			service.manuscript,
			service.mentionStore,
		);
		const reads = vi.spyOn(service.repository, "tryReadManaged");
		// The same config answers wholly warm; a changed sensitive list keeps
		// the persisted tokens and re-reads only for its own family.
		await fresh.frequency(project, config({ sensitiveTerms: ["other"] }), {
			stopwords: null,
			exclude: null,
		});
		expect(reads).not.toHaveBeenCalled();
		await fresh.sensitiveAggregate(
			project,
			config({ sensitiveTerms: ["other"] }),
		);
		expect(reads).toHaveBeenCalled();
		reads.mockRestore();
	});

	it("filters frequency at read time", async () => {
		await chapter("One", "The fog and the fog again.");
		const rows = await service.analysis.frequency(project, config(), {
			stopwords: new Set(["the", "and"]),
			exclude: new Set(["again"]),
		});
		expect(rows[0]).toEqual({ term: "fog", count: 2 });
		expect(rows.some((row) => row.term === "the")).toBe(false);
		expect(rows.some((row) => row.term === "again")).toBe(false);
	});

	it("forgets a note and its children like every other cache", async () => {
		const path = await chapter("One", "Damn it.");
		await service.analysis.sensitiveAggregate(project, config());
		service.analysis.forget(path);
		await service.analysis.flush(project);
		const written = JSON.parse(
			fakeVault.contents.get(ANALYSIS_FILE) ?? "null",
		) as { notes: Record<string, unknown> } | null;
		expect(written?.notes[path]).toBeUndefined();
		const rows = await service.analysis.sensitiveAggregate(project, config());
		expect(rows.find((row) => row.term === "damn")?.total).toBe(1);
	});

	it("reuses one sensitive matcher for one list", () => {
		const first = service.analysis.sensitiveMatcherFor(["damn"]);
		expect(service.analysis.sensitiveMatcherFor(["damn"])).toBe(first);
		expect(service.analysis.sensitiveMatcherFor(["blast"])).not.toBe(first);
	});

	it("reads disabled features as simply nothing", async () => {
		await chapter("One", "「走吧」他说。");
		const off = config({ sensitiveTerms: [], dialogueStyles: [] });
		expect(await service.analysis.sensitiveAggregate(project, off)).toEqual([]);
		expect(await service.analysis.dialogueChapters(project, off)).toEqual([]);
		const { totals } = await service.analysis.statistics(project, off);
		expect(totals.dialogueCjk).toBe(0);
		expect(totals.cjk).toBe(4);
	});
});
