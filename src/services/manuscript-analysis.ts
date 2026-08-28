import {
	buildSensitiveMatcher,
	buildTokenLexicon,
	dialogueOccurrencesOf,
	dialogueRanges,
	dialogueSplit,
	countSentences,
	fingerprint,
	frequencyRows,
	hasWordSegmenter,
	isDocumentType,
	lexiconFingerprint,
	mergeTokenCounts,
	sensitiveFingerprint,
	sensitiveOccurrencesOf,
	tokenizeProse,
	WORD_TOKENIZER_VERSION,
	type DialogueOccurrence,
	type DialogueStyle,
	type FrequencyRow,
	type SensitiveMatcher,
	type SensitiveOccurrence,
	type TokenLexicon,
} from "../domain";
import { documentTypeOf, type VaultRepository } from "../repository";
import { pluginWrittenRanges } from "../templates";
import type { ManuscriptService } from "./manuscript-service";
import {
	ANALYSIS_FILE_SCHEMA_VERSION,
	type AnalysisNoteRecord,
	type MentionStore,
	type NoteProseStats,
} from "./mention-store";
import type { ProjectRef } from "./types";

/** The mention index's own rhythm, kept in step deliberately. */
const BREATH_MS = 12;
const FLUSH_QUIET_MS = 5_000;

/** Bump when what `stats` measures changes: it drops the stored numbers. */
const STATS_VERSION = 1;

export type { NoteProseStats } from "./mention-store";

export interface SensitiveTermAggregate {
	term: string;
	total: number;
	/** The term's occurrences, in manuscript order. */
	occurrences: SensitiveOccurrence[];
}

export interface DialogueChapterAggregate {
	path: string;
	title: string;
	/** How many quoted stretches the chapter holds. */
	count: number;
}

export interface ManuscriptProseRow extends NoteProseStats {
	path: string;
	title: string;
}

export interface ManuscriptProseStatistics {
	/** Every chapter's numbers, in manuscript order. */
	perNote: ManuscriptProseRow[];
	totals: NoteProseStats & { chapters: number };
}

/**
 * What the analysis reads of the settings, derived by the host: empty lists
 * where a feature is off, so "disabled" and "nothing registered" are the
 * same cheap answer.
 */
export interface AnalysisConfig {
	sensitiveTerms: readonly string[];
	dialogueStyles: readonly DialogueStyle[];
	/** The tokenizer's locale hint, usually the project's. */
	locale: string;
	/**
	 * Every entity name and alias as the roster spells it: the tokenizer's
	 * user dictionary, so an invented name counts whole instead of as the
	 * fragments a general dictionary would cut it into.
	 */
	entityTerms: readonly string[];
}

/** The four family fingerprints one config answers to. */
interface FamilyPrints {
	sensitive: string;
	dialogue: string;
	stats: string;
	tokens: string;
}

interface ProjectAnalysisState {
	project: ProjectRef;
	prints: FamilyPrints;
	dirty: boolean;
	notes: Map<string, AnalysisNoteRecord>;
}

/** The last path segment, extension set aside: how a chapter is titled. */
const titleOf = (path: string): string =>
	path.replace(/\.md$/u, "").split("/").pop() ?? path;

/**
 * The manuscript analysis beside the mention index: sensitive-word hits,
 * dialogue ranges, prose statistics and word tokens, each a family with its
 * own fingerprint in one per-device file. Any family gone stale recomputes
 * from one read that refreshes all four -- the read is the cost, the
 * computing is not -- while the families whose fingerprints still hold ride
 * through untouched, which is what lets a sensitive-list edit keep the
 * expensive tokens warm.
 *
 * Custom highlight rules are deliberately absent: their matches are
 * transient dress over loaded segments, never indexed, never persisted.
 *
 * Freshness is had on read, never by background work, exactly as the
 * mention index has it; `forget` is the one wiring into vault events.
 */
export class ManuscriptAnalysisService {
	/** One matcher at a time, validated by the term list's fingerprint. */
	private sensitiveMatcher: SensitiveMatcher | null = null;

	/** One lexicon at a time, validated the same way. */
	private lexicon: TokenLexicon | null = null;

	private readonly states = new Map<string, ProjectAnalysisState>();
	private readonly flushQueue = new Set<string>();
	private flushHandle: unknown = null;

	constructor(
		private readonly repository: VaultRepository,
		private readonly manuscript: ManuscriptService,
		private readonly store: MentionStore,
		/** The main window's clock, or null for the timerless test shape. */
		private readonly timers: {
			set: (handler: () => void, ms: number) => unknown;
			clear: (handle: unknown) => void;
		} | null = null,
	) {}

	sensitiveMatcherFor(terms: readonly string[]): SensitiveMatcher {
		const print = sensitiveFingerprint(terms);
		if (
			this.sensitiveMatcher !== null &&
			this.sensitiveMatcher.fingerprint === print
		) {
			return this.sensitiveMatcher;
		}
		this.sensitiveMatcher = buildSensitiveMatcher(terms);
		return this.sensitiveMatcher;
	}

	private lexiconFor(labels: readonly string[]): TokenLexicon {
		const print = lexiconFingerprint(labels);
		if (this.lexicon !== null && this.lexicon.fingerprint === print) {
			return this.lexicon;
		}
		this.lexicon = buildTokenLexicon(labels);
		return this.lexicon;
	}

	/** Every sensitive term's spots, folded per term in list order. */
	async sensitiveAggregate(
		project: ProjectRef,
		config: AnalysisConfig,
	): Promise<SensitiveTermAggregate[]> {
		const state = await this.stateFor(project, config);
		const byTerm = new Map<string, SensitiveTermAggregate>();
		for (const term of config.sensitiveTerms) {
			byTerm.set(term, { term, total: 0, occurrences: [] });
		}
		await this.walk(project, state, config, "sensitive", (path, record) => {
			for (const occurrence of sensitiveOccurrencesOf(
				path,
				record.sensitive ?? [],
			)) {
				const kept = byTerm.get(occurrence.term);
				if (kept === undefined) continue;
				kept.total += 1;
				kept.occurrences.push(occurrence);
			}
		});
		return [...byTerm.values()];
	}

	/** Which chapters hold dialogue, and how much, in manuscript order. */
	async dialogueChapters(
		project: ProjectRef,
		config: AnalysisConfig,
	): Promise<DialogueChapterAggregate[]> {
		const state = await this.stateFor(project, config);
		const chapters: DialogueChapterAggregate[] = [];
		await this.walk(project, state, config, "dialogue", (path, record) => {
			const count = record.dialogue?.length ?? 0;
			if (count === 0) return;
			chapters.push({ path, title: titleOf(path), count });
		});
		return chapters;
	}

	/**
	 * One chapter's dialogue as occurrences, quoted text included: computed
	 * live from a fresh read, because the expansion that asks for them shows
	 * the text itself and the cache keeps only offsets.
	 */
	async dialogueOccurrences(
		config: AnalysisConfig,
		path: string,
	): Promise<DialogueOccurrence[]> {
		const record = await this.repository.tryReadManaged(path);
		if (record === null || config.dialogueStyles.length === 0) return [];
		const declared = documentTypeOf(record.frontmatter);
		const ranges = dialogueRanges(
			record.body,
			config.dialogueStyles,
			pluginWrittenRanges(
				record.body,
				isDocumentType(declared) ? declared : null,
			),
		);
		return dialogueOccurrencesOf(path, record.body, ranges);
	}

	/** The whole manuscript's numbers, chapter by chapter and folded. */
	async statistics(
		project: ProjectRef,
		config: AnalysisConfig,
	): Promise<ManuscriptProseStatistics> {
		const state = await this.stateFor(project, config);
		const perNote: ManuscriptProseRow[] = [];
		const totals = {
			cjk: 0,
			words: 0,
			sentences: 0,
			dialogueCjk: 0,
			dialogueWords: 0,
			chapters: 0,
		};
		await this.walk(project, state, config, "stats", (path, record) => {
			const stats = record.stats;
			if (stats === null) return;
			perNote.push({ path, title: titleOf(path), ...stats });
			totals.cjk += stats.cjk;
			totals.words += stats.words;
			totals.sentences += stats.sentences;
			totals.dialogueCjk += stats.dialogueCjk;
			totals.dialogueWords += stats.dialogueWords;
			totals.chapters += 1;
		});
		return { perNote, totals };
	}

	/**
	 * The manuscript's word frequency, filters applied at this read alone.
	 * The total counts every token before any filter, so a term's share of
	 * the writing holds still while the stopword toggle flips.
	 */
	async frequency(
		project: ProjectRef,
		config: AnalysisConfig,
		filters: {
			stopwords: ReadonlySet<string> | null;
			exclude: ReadonlySet<string> | null;
		},
	): Promise<{ rows: FrequencyRow[]; total: number }> {
		const state = await this.stateFor(project, config);
		const maps: (readonly (readonly [string, number])[])[] = [];
		await this.walk(project, state, config, "tokens", (path, record) => {
			if (record.tokens !== null) maps.push(record.tokens);
		});
		const merged = mergeTokenCounts(maps);
		let total = 0;
		for (const count of merged.values()) total += count;
		return { rows: frequencyRows(merged, filters), total };
	}

	/** The mirror of every other per-note cache's `forget`. */
	forget(path: string, { children = false } = {}): void {
		for (const state of this.states.values()) {
			if (state.notes.delete(path)) this.markDirty(state);
			if (!children) continue;
			const prefix = `${path}/`;
			for (const key of state.notes.keys()) {
				if (!key.startsWith(prefix)) continue;
				state.notes.delete(key);
				this.markDirty(state);
			}
		}
	}

	/** Writes what this project's state holds, when anything changed. */
	async flush(project: ProjectRef): Promise<void> {
		const state = this.states.get(project.rootPath);
		if (state === undefined || !state.dirty) return;
		state.dirty = false;
		this.flushQueue.delete(project.rootPath);
		if (
			this.flushQueue.size === 0 &&
			this.flushHandle !== null &&
			this.timers !== null
		) {
			this.timers.clear(this.flushHandle);
			this.flushHandle = null;
		}
		await this.store.writeAnalysis(project, {
			schemaVersion: ANALYSIS_FILE_SCHEMA_VERSION,
			sensitiveFingerprint: state.prints.sensitive,
			dialogueFingerprint: state.prints.dialogue,
			statsFingerprint: state.prints.stats,
			tokensFingerprint: state.prints.tokens,
			notes: Object.fromEntries(state.notes),
		});
	}

	private printsFor(config: AnalysisConfig): FamilyPrints {
		const dialogue = fingerprint(
			config.dialogueStyles.map((style) => style.open + style.close).sort(),
		);
		return {
			sensitive: sensitiveFingerprint(config.sensitiveTerms),
			dialogue,
			// The stats carry the dialogue split, so they stale together.
			stats: fingerprint([STATS_VERSION, dialogue]),
			// The roster is the tokenizer's dictionary, so a renamed entity
			// re-tokenizes: the walk is breathed and the other families ride.
			tokens: fingerprint([
				WORD_TOKENIZER_VERSION,
				config.locale,
				hasWordSegmenter(),
				lexiconFingerprint(config.entityTerms),
			]),
		};
	}

	/**
	 * The project's state under this config. A moved fingerprint drops its
	 * own family from every held note and leaves the others standing -- in
	 * memory when the state is already loaded, against the persisted file's
	 * own fingerprints on a cold start.
	 */
	private async stateFor(
		project: ProjectRef,
		config: AnalysisConfig,
	): Promise<ProjectAnalysisState> {
		const prints = this.printsFor(config);
		const same = (left: FamilyPrints, right: FamilyPrints): boolean =>
			left.sensitive === right.sensitive &&
			left.dialogue === right.dialogue &&
			left.stats === right.stats &&
			left.tokens === right.tokens;
		const kept = this.states.get(project.rootPath);
		if (kept !== undefined) {
			if (same(kept.prints, prints)) return kept;
			const carried = new Map<string, AnalysisNoteRecord>();
			for (const [path, note] of kept.notes) {
				carried.set(path, {
					stamp: note.stamp,
					sensitive:
						kept.prints.sensitive === prints.sensitive ? note.sensitive : null,
					dialogue:
						kept.prints.dialogue === prints.dialogue ? note.dialogue : null,
					stats: kept.prints.stats === prints.stats ? note.stats : null,
					tokens: kept.prints.tokens === prints.tokens ? note.tokens : null,
				});
			}
			const moved: ProjectAnalysisState = {
				project,
				prints,
				dirty: true,
				notes: carried,
			};
			this.states.set(project.rootPath, moved);
			this.flushQueue.add(project.rootPath);
			return moved;
		}
		const state: ProjectAnalysisState = {
			project,
			prints,
			dirty: false,
			notes: new Map(),
		};
		this.states.set(project.rootPath, state);
		const persisted = await this.store.readAnalysis(project);
		if (persisted !== null) {
			for (const [path, note] of Object.entries(persisted.notes)) {
				state.notes.set(path, {
					stamp: note.stamp,
					sensitive:
						persisted.sensitiveFingerprint === prints.sensitive
							? note.sensitive
							: null,
					dialogue:
						persisted.dialogueFingerprint === prints.dialogue
							? note.dialogue
							: null,
					stats:
						persisted.statsFingerprint === prints.stats ? note.stats : null,
					tokens:
						persisted.tokensFingerprint === prints.tokens
							? note.tokens
							: null,
				});
			}
		}
		return state;
	}

	/**
	 * Every manuscript note visited fresh, breathing as it walks, the
	 * cold-computed answers flushed at the end. `need` names the one family
	 * the caller reads, so an entry warm in that family costs nothing even
	 * while another family sits invalidated.
	 */
	private async walk(
		project: ProjectRef,
		state: ProjectAnalysisState,
		config: AnalysisConfig,
		need: keyof Omit<AnalysisNoteRecord, "stamp">,
		read: (path: string, record: AnalysisNoteRecord) => void,
	): Promise<void> {
		const segments = await this.manuscript.listSegments(project);
		let lastBreath = Date.now();
		for (const segment of segments) {
			const record = await this.ensure(state, config, segment.path, need);
			if (record !== null) read(segment.path, record);
			if (Date.now() - lastBreath >= BREATH_MS) {
				await this.breathe();
				lastBreath = Date.now();
			}
		}
		await this.flush(project);
	}

	/**
	 * One note's record with the needed family standing: the stat answers
	 * first so a warm entry costs no read, and a missing family costs the
	 * one read that refreshes all four -- the read is the expense, not the
	 * computing.
	 */
	private async ensure(
		state: ProjectAnalysisState,
		config: AnalysisConfig,
		path: string,
		need: keyof Omit<AnalysisNoteRecord, "stamp">,
	): Promise<AnalysisNoteRecord | null> {
		const probed = this.manuscript.segmentStamp(path);
		if (probed === null) {
			if (state.notes.delete(path)) this.markDirty(state);
			return null;
		}
		const kept = state.notes.get(path);
		if (kept !== undefined && kept.stamp === probed && kept[need] !== null) {
			return kept;
		}
		const record = await this.repository.tryReadManaged(path);
		if (record === null) {
			if (state.notes.delete(path)) this.markDirty(state);
			return null;
		}
		const stamp = `${String(record.file.stat.mtime)}:${String(record.file.stat.size)}`;
		const declared = documentTypeOf(record.frontmatter);
		const excluded = pluginWrittenRanges(
			record.body,
			isDocumentType(declared) ? declared : null,
		);
		const ranges = dialogueRanges(record.body, config.dialogueStyles, excluded);
		const split = dialogueSplit(record.body, ranges, excluded);
		const fresh: AnalysisNoteRecord = {
			stamp,
			sensitive: this.sensitiveMatcherFor(config.sensitiveTerms).collect(
				record.body,
				excluded,
			),
			dialogue: ranges.map((range) => [range.from, range.to]),
			stats: {
				// The two halves of the split cover exactly the analyzable
				// prose, so their sum is the note's whole writing.
				cjk: split.dialogue.cjk + split.narrative.cjk,
				words: split.dialogue.words + split.narrative.words,
				sentences: countSentences(record.body, excluded),
				dialogueCjk: split.dialogue.cjk,
				dialogueWords: split.dialogue.words,
			},
			tokens: [
				...tokenizeProse(
					record.body,
					excluded,
					config.locale,
					this.lexiconFor(config.entityTerms),
				),
			],
		};
		state.notes.set(path, fresh);
		this.markDirty(state);
		return fresh;
	}

	private markDirty(state: ProjectAnalysisState): void {
		state.dirty = true;
		this.flushQueue.add(state.project.rootPath);
		if (this.timers === null || this.flushHandle !== null) return;
		this.flushHandle = this.timers.set(() => {
			this.flushHandle = null;
			for (const rootPath of [...this.flushQueue]) {
				const queued = this.states.get(rootPath);
				if (queued === undefined) {
					this.flushQueue.delete(rootPath);
					continue;
				}
				void this.flush(queued.project);
			}
		}, FLUSH_QUIET_MS);
	}

	/** A macrotask's worth of air, so a cold walk never freezes the app. */
	private breathe(): Promise<void> {
		const timers = this.timers;
		if (timers === null) return Promise.resolve();
		return new Promise((resolve) => {
			timers.set(() => {
				resolve();
			}, 0);
		});
	}
}
