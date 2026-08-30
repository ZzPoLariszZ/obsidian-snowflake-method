import {
	applyOccurrenceIgnores,
	buildEntityMatcher,
	collectMentionHits,
	entityMatcherFingerprints,
	isDocumentType,
	resolveMentions,
	splitMentionIgnores,
	type EntityMatcher,
	type EntityOccurrence,
	type MentionHit,
	type MentionSource,
} from "../domain";
import { documentTypeOf, type VaultRepository } from "../repository";
import { pluginWrittenRanges } from "../templates";
import type { ManuscriptService } from "./manuscript-service";
import {
	MENTION_STORE_SCHEMA_VERSION,
	type MentionStore,
} from "./mention-store";
import {
	BREATH_MS,
	QuietFlushingNoteCache,
	type NoteCacheState,
	type NoteCacheTimers,
} from "./note-cache";
import type { ProjectRef } from "./types";

export interface EntityMentionAggregate {
	memberPath: string;
	memberName: string;
	/** Resolved occurrences only: definite text plus links, never guesses. */
	total: number;
	linked: number;
	unlinked: number;
	first: { path: string; from: number } | null;
	last: { path: string; from: number } | null;
	/** The entity's resolved occurrences, in manuscript order. */
	occurrences: EntityOccurrence[];
}

export interface MentionAggregate {
	entities: EntityMentionAggregate[];
	/** Ambiguous mentions: real, but no single entity's to count. */
	unresolved: EntityOccurrence[];
}

interface NoteHits {
	stamp: string;
	hits: MentionHit[];
}

interface ProjectIndexState extends NoteCacheState<NoteHits> {
	/** The matcher fingerprint every held entry was found under. */
	fingerprint: string;
}

/**
 * The per-note mention index: raw hits kept against each note's stamp and
 * the matcher's fingerprint, in memory and in this device's index file, so
 * a chapter is re-read exactly when it changed and a reload starts warm.
 *
 * Freshness is had on read, never by background work: a stale stamp
 * recomputes before answering, and nothing here listens to vault events --
 * the one wiring is `forget`, called where every other per-note cache is
 * told about deletes and renames. Ignores are applied at read time and
 * invalidate nothing stored, which is why what is stored is hits rather
 * than occurrences: candidate ignores act before overlap resolution, so
 * any resolved form would bake yesterday's rules in.
 */
export class MentionIndexService extends QuietFlushingNoteCache<
	NoteHits,
	ProjectIndexState
> {
	/**
	 * One matcher at a time, validated by fingerprint. The automaton is not
	 * cached apart from its metadata: the payloads inside it are the
	 * candidate metadata, so a rank or name edit needs the rebuild anyway,
	 * and roster edits are rare, hand-paced changes.
	 */
	private matcher: EntityMatcher | null = null;

	constructor(
		private readonly repository: VaultRepository,
		private readonly manuscript: ManuscriptService,
		private readonly store: MentionStore,
		/**
		 * The main window's clock, handed down the way the sessions take
		 * theirs, so a popout closing never takes the flush timer with it.
		 * Without one there is no pacing and no quiet flush -- the walks run
		 * straight through and writing waits for an explicit `flush` -- which
		 * is the honest shape wherever no window stands, the tests included.
		 */
		timers: NoteCacheTimers | null = null,
	) {
		super(timers);
	}

	protected persist(state: ProjectIndexState): Promise<void> {
		return this.store.writeIndex(state.project, {
			schemaVersion: MENTION_STORE_SCHEMA_VERSION,
			fingerprint: state.fingerprint,
			notes: Object.fromEntries(state.notes),
		});
	}

	matcherFor(sources: readonly MentionSource[]): EntityMatcher {
		const prints = entityMatcherFingerprints(sources);
		if (this.matcher !== null && this.matcher.fingerprint === prints.combined) {
			return this.matcher;
		}
		this.matcher = buildEntityMatcher(sources);
		return this.matcher;
	}

	/**
	 * One note's occurrences, the reader's ignores applied: fresh by stamp,
	 * warm from memory or the persisted file everywhere else.
	 */
	async occurrencesOf(
		project: ProjectRef,
		matcher: EntityMatcher,
		path: string,
	): Promise<EntityOccurrence[]> {
		const state = await this.stateFor(project, matcher);
		const hits = await this.hitsFor(state, matcher, path);
		if (hits === null) return [];
		const { candidate, occurrence } = splitMentionIgnores(
			await this.store.readIgnores(project),
		);
		return applyOccurrenceIgnores(
			resolveMentions(path, hits, candidate),
			occurrence,
		);
	}

	/**
	 * The whole manuscript folded per entity, in reading order, breathing as
	 * it walks so a cold 1500-chapter pass never freezes the app. Ambiguous
	 * mentions come back beside the entities rather than inside any of them.
	 */
	async aggregate(
		project: ProjectRef,
		matcher: EntityMatcher,
	): Promise<MentionAggregate> {
		const state = await this.stateFor(project, matcher);
		const { candidate, occurrence } = splitMentionIgnores(
			await this.store.readIgnores(project),
		);
		const segments = await this.manuscript.listSegments(project);
		const entities = new Map<string, EntityMentionAggregate>();
		const unresolved: EntityOccurrence[] = [];
		let lastBreath = Date.now();
		for (const segment of segments) {
			const hits = await this.hitsFor(state, matcher, segment.path);
			if (hits !== null) {
				const resolved = applyOccurrenceIgnores(
					resolveMentions(segment.path, hits, candidate),
					occurrence,
				);
				for (const entry of resolved) {
					if (entry.resolution === "foreign-link") continue;
					if (entry.resolvedMemberPath === null) {
						unresolved.push(entry);
						continue;
					}
					const at = { path: entry.path, from: entry.from };
					const kept =
						entities.get(entry.resolvedMemberPath) ??
						({
							memberPath: entry.resolvedMemberPath,
							memberName:
								entry.candidates[0]?.memberName ?? entry.matchedText,
							total: 0,
							linked: 0,
							unlinked: 0,
							first: null,
							last: null,
							occurrences: [],
						} satisfies EntityMentionAggregate);
					kept.total += 1;
					if (entry.resolution === "wikilink") kept.linked += 1;
					else kept.unlinked += 1;
					kept.first ??= at;
					kept.last = at;
					kept.occurrences.push(entry);
					entities.set(entry.resolvedMemberPath, kept);
				}
			}
			if (Date.now() - lastBreath >= BREATH_MS) {
				await this.breathe();
				lastBreath = Date.now();
			}
		}
		// The cold walk is the one worth remembering: everything it computed
		// lands in this device's file before the answer goes out. A write
		// that fails does not take the computed answer with it -- the flush
		// re-marked itself and the quiet timer retries.
		await this.flush(project).catch(() => undefined);
		return { entities: [...entities.values()], unresolved };
	}

	private async stateFor(
		project: ProjectRef,
		matcher: EntityMatcher,
	): Promise<ProjectIndexState> {
		const kept = this.states.get(project.rootPath);
		if (kept !== undefined && kept.fingerprint === matcher.fingerprint) {
			await kept.hydrated;
			return kept;
		}
		// A moved fingerprint invalidates every held entry at once: the
		// patterns or their meaning changed, so nothing found before stands.
		const state: ProjectIndexState = {
			project,
			fingerprint: matcher.fingerprint,
			hydrated: Promise.resolve(),
			dirty: false,
			notes: new Map(),
		};
		this.states.set(project.rootPath, state);
		state.hydrated = (async () => {
			const persisted = await this.store.readIndex(project);
			if (persisted === null || persisted.fingerprint !== matcher.fingerprint) {
				return;
			}
			let pruned = false;
			for (const [path, note] of Object.entries(persisted.notes)) {
				// A note deleted or renamed while no state was loaded left its
				// record behind; the fold-in is where such orphans die.
				if (this.manuscript.segmentStamp(path) === null) {
					pruned = true;
					continue;
				}
				state.notes.set(path, note);
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

	private async hitsFor(
		state: ProjectIndexState,
		matcher: EntityMatcher,
		path: string,
	): Promise<MentionHit[] | null> {
		// The stat answers first, so a warm entry costs no read at all: that
		// is the whole worth of the persisted file after a reload, when the
		// repository's own cache is empty and every read would hit the disk.
		const probed = this.manuscript.segmentStamp(path);
		if (probed === null) {
			if (state.notes.delete(path)) this.markDirty(state);
			return null;
		}
		const kept = state.notes.get(path);
		if (kept !== undefined && kept.stamp === probed) return kept.hits;
		const record = await this.repository.tryReadManaged(path);
		if (record === null) {
			if (state.notes.delete(path)) this.markDirty(state);
			return null;
		}
		// Stored against the read's own stat, so the pair cannot disagree; a
		// write landing between the probe and the read only re-reads next time.
		const stamp = `${String(record.file.stat.mtime)}:${String(record.file.stat.size)}`;
		const declared = documentTypeOf(record.frontmatter);
		const hits = collectMentionHits(
			record.body,
			pluginWrittenRanges(
				record.body,
				isDocumentType(declared) ? declared : null,
			),
			matcher,
		);
		state.notes.set(path, { stamp, hits });
		this.markDirty(state);
		return hits;
	}

}
