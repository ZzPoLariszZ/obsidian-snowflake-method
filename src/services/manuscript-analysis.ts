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
	type CountableRange,
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
import type { NoteCountOptions, WritingCountService } from "./writing-count";
import {
	ANALYSIS_FILE_SCHEMA_VERSION,
	type AnalysisNoteRecord,
	type MentionStore,
	type NoteProseStats,
} from "./mention-store";
import {
	BREATH_MS,
	QuietFlushingNoteCache,
	type NoteCacheState,
	type NoteCacheTimers,
} from "./note-cache";
import type { ProjectRef } from "./types";

/** Bump when what `stats` measures changes: it drops the stored numbers. */
const STATS_VERSION = 2;

/** One matcher for every no-terms ask, so it never contests the memo slot. */
const EMPTY_SENSITIVE_MATCHER = buildSensitiveMatcher([]);

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
	/**
	 * The convention the reader counts by, and what headings are worth to it:
	 * the same options the status bar counts with, so a chapter's length is one
	 * number wherever it is quoted.
	 */
	count: NoteCountOptions;
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

interface ProjectAnalysisState extends NoteCacheState<AnalysisNoteRecord> {
	prints: FamilyPrints;
	/**
	 * Moves whenever any note's tokens change hands -- recomputed, forgotten,
	 * or pruned -- so the frequency memo below knows when its merge stands.
	 */
	tokensEpoch: number;
}

/** The last path segment, extension set aside: how a chapter is titled. */
const titleOf = (path: string): string =>
	path.replace(/\.md$/u, "").split("/").pop() ?? path;

/**
 * Everything a body holds except these ranges, which is how a count is asked
 * about one part of a note: the counting rule takes what to leave out, never
 * what to read, so that every offset stays the note's own and a plugin-written
 * block inside the part drops out of it exactly as it drops out of the whole.
 * The ranges arrive in order and never overlap, as `dialogueRanges` leaves them.
 */
function outside(
	ranges: readonly { from: number; to: number }[],
	length: number,
): CountableRange[] {
	const gaps: CountableRange[] = [];
	let at = 0;
	for (const range of ranges) {
		if (range.from > at) gaps.push({ from: at, to: range.from });
		at = Math.max(at, range.to);
	}
	if (at < length) gaps.push({ from: at, to: length });
	return gaps;
}

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
export class ManuscriptAnalysisService extends QuietFlushingNoteCache<
	AnalysisNoteRecord,
	ProjectAnalysisState
> {
	/** One matcher at a time, validated by the term list's fingerprint. */
	private sensitiveMatcher: SensitiveMatcher | null = null;

	/** One lexicon at a time, validated the same way. */
	private lexicon: TokenLexicon | null = null;

	/**
	 * The whole manuscript's tokens merged once and sorted once: the panel
	 * asks again on every filter flip and every handback, and only the
	 * filters change between those asks. Valid while the state stands and no
	 * note's tokens moved.
	 */
	private frequencyMemo: {
		state: ProjectAnalysisState;
		tokensEpoch: number;
		rows: FrequencyRow[];
		total: number;
	} | null = null;

	constructor(
		private readonly repository: VaultRepository,
		private readonly manuscript: ManuscriptService,
		/** The counting rule itself, so a chapter's length is measured once. */
		private readonly writingCount: WritingCountService,
		private readonly store: MentionStore,
		/** The main window's clock, or null for the timerless test shape. */
		timers: NoteCacheTimers | null = null,
	) {
		super(timers);
	}

	protected persist(state: ProjectAnalysisState): Promise<void> {
		return this.store.writeAnalysis(state.project, {
			schemaVersion: ANALYSIS_FILE_SCHEMA_VERSION,
			sensitiveFingerprint: state.prints.sensitive,
			dialogueFingerprint: state.prints.dialogue,
			statsFingerprint: state.prints.stats,
			tokensFingerprint: state.prints.tokens,
			notes: Object.fromEntries(state.notes),
		});
	}

	protected override noteForgotten(state: ProjectAnalysisState): void {
		state.tokensEpoch += 1;
	}

	sensitiveMatcherFor(terms: readonly string[]): SensitiveMatcher {
		// The no-terms ask goes to a shared empty matcher: the dress path
		// asks with an empty list whenever highlighting is off, and must not
		// evict the analysis path's real matcher from the one slot.
		if (terms.length === 0) return EMPTY_SENSITIVE_MATCHER;
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
			counted: 0,
			sentences: 0,
			dialogueCounted: 0,
			chapters: 0,
		};
		await this.walk(project, state, config, "stats", (path, record) => {
			const stats = record.stats;
			if (stats === null) return;
			perNote.push({ path, title: titleOf(path), ...stats });
			totals.cjk += stats.cjk;
			totals.words += stats.words;
			totals.counted += stats.counted;
			totals.sentences += stats.sentences;
			totals.dialogueCounted += stats.dialogueCounted;
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
		const kept = this.frequencyMemo;
		let rows: FrequencyRow[];
		let total: number;
		if (
			kept !== null &&
			kept.state === state &&
			kept.tokensEpoch === state.tokensEpoch
		) {
			({ rows, total } = kept);
		} else {
			const merged = mergeTokenCounts(maps);
			total = 0;
			for (const count of merged.values()) total += count;
			rows = frequencyRows(merged, { stopwords: null, exclude: null });
			this.frequencyMemo = {
				state,
				tokensEpoch: state.tokensEpoch,
				rows,
				total,
			};
		}
		// The filters ask only whether a term stays, so filtering the sorted
		// whole preserves exactly the order a filtered sort would give.
		return {
			rows: rows.filter(
				(row) =>
					(filters.stopwords === null || !filters.stopwords.has(row.term)) &&
					(filters.exclude === null || !filters.exclude.has(row.term)),
			),
			total,
		};
	}

	private printsFor(config: AnalysisConfig): FamilyPrints {
		const dialogue = fingerprint(
			config.dialogueStyles.map((style) => style.open + style.close).sort(),
		);
		return {
			sensitive: sensitiveFingerprint(config.sensitiveTerms),
			dialogue,
			// The stats carry the dialogue split, so they stale together -- and
			// the length they hold is counted by the reader's convention, so a
			// changed convention drops them the same way.
			stats: fingerprint([
				STATS_VERSION,
				dialogue,
				config.count.mode,
				config.count.headings,
			]),
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
			if (same(kept.prints, prints)) {
				await kept.hydrated;
				return kept;
			}
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
				hydrated: Promise.resolve(),
				dirty: false,
				notes: carried,
				tokensEpoch: 0,
			};
			this.states.set(project.rootPath, moved);
			// Through `markDirty`, not a bare queue add: the nulled families
			// are a change worth persisting even if no walk follows, and only
			// `markDirty` arms the quiet timer that writes them.
			this.markDirty(moved);
			return moved;
		}
		const state: ProjectAnalysisState = {
			project,
			prints,
			hydrated: Promise.resolve(),
			dirty: false,
			notes: new Map(),
			tokensEpoch: 0,
		};
		this.states.set(project.rootPath, state);
		state.hydrated = (async () => {
			const persisted = await this.store.readAnalysis(project);
			if (persisted === null) return;
			let pruned = false;
			for (const [path, note] of Object.entries(persisted.notes)) {
				// A note deleted or renamed while no state was loaded left its
				// record behind; the fold-in is where such orphans die.
				if (this.manuscript.segmentStamp(path) === null) {
					pruned = true;
					continue;
				}
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
			if (pruned) this.markDirty(state);
		})();
		try {
			await state.hydrated;
		} catch (error) {
			// A failed read must not poison the slot: the next caller retries.
			this.states.delete(project.rootPath);
			throw error;
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
		// A write that fails does not take the computed answer with it: the
		// flush re-marked itself and the quiet timer retries.
		await this.flush(project).catch(() => undefined);
	}

	/**
	 * One note's record with the needed family standing: the stat answers
	 * first so a warm entry costs no read. A missing family costs one read,
	 * and only the families actually gone are recomputed from it -- a
	 * sensitive-list edit must not pay for re-tokenizing the whole book when
	 * the tokens rode through warm.
	 */
	private async ensure(
		state: ProjectAnalysisState,
		config: AnalysisConfig,
		path: string,
		need: keyof Omit<AnalysisNoteRecord, "stamp">,
	): Promise<AnalysisNoteRecord | null> {
		const probed = this.manuscript.segmentStamp(path);
		if (probed === null) {
			if (state.notes.delete(path)) {
				this.noteForgotten(state);
				this.markDirty(state);
			}
			return null;
		}
		const kept = state.notes.get(path);
		if (kept !== undefined && kept.stamp === probed && kept[need] !== null) {
			return kept;
		}
		const record = await this.repository.tryReadManaged(path);
		if (record === null) {
			if (state.notes.delete(path)) {
				this.noteForgotten(state);
				this.markDirty(state);
			}
			return null;
		}
		const stamp = `${String(record.file.stat.mtime)}:${String(record.file.stat.size)}`;
		// Warm families carry over only against the read's own stamp, not the
		// probe's: the file may have moved between the two, and then nothing
		// the old record holds speaks for what was just read.
		const warm = kept !== undefined && kept.stamp === stamp ? kept : null;
		const declared = documentTypeOf(record.frontmatter);
		const excluded = pluginWrittenRanges(
			record.body,
			isDocumentType(declared) ? declared : null,
		);
		// The dialogue ranges feed both the dialogue family and the stats
		// split, so they are computed once and only when either needs them.
		let laidRanges: ReturnType<typeof dialogueRanges> | null = null;
		const rangesOf = (): ReturnType<typeof dialogueRanges> =>
			(laidRanges ??= dialogueRanges(
				record.body,
				config.dialogueStyles,
				excluded,
			));
		const fresh: AnalysisNoteRecord = {
			stamp,
			sensitive:
				warm?.sensitive ??
				this.sensitiveMatcherFor(config.sensitiveTerms).collect(
					record.body,
					excluded,
				),
			dialogue:
				warm?.dialogue ?? rangesOf().map((range) => [range.from, range.to]),
			stats:
				warm?.stats ??
				((): NoteProseStats => {
					const quoted = rangesOf();
					const split = dialogueSplit(record.body, quoted, excluded);
					// The length the reader is shown is counted by the counting
					// rule itself -- the same call the status bar makes -- and
					// the dialogue's length is that same call with everything
					// outside the quotation marks set aside, so the share
					// divides into the length it is a share of.
					const length = (also: readonly CountableRange[] = []): number =>
						this.writingCount.countExcluding(
							record.body,
							also.length === 0 ? excluded : [...excluded, ...also],
							config.count,
						).total;
					return {
						// The two halves of the split cover exactly the
						// analyzable prose, so their sum is the whole writing.
						cjk: split.dialogue.cjk + split.narrative.cjk,
						words: split.dialogue.words + split.narrative.words,
						counted: length(),
						sentences: countSentences(record.body, excluded),
						dialogueCounted:
							quoted.length === 0
								? 0
								: length(outside(quoted, record.body.length)),
					};
				})(),
			tokens:
				warm?.tokens ?? [
					...tokenizeProse(
						record.body,
						excluded,
						config.locale,
						this.lexiconFor(config.entityTerms),
					),
				],
		};
		if (fresh.tokens !== warm?.tokens) state.tokensEpoch += 1;
		state.notes.set(path, fresh);
		this.markDirty(state);
		return fresh;
	}

}
