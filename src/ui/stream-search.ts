/**
 * The stream's find bar, as far as it is about words: what is asked for,
 * where in the manuscript it is found, which match the bar stands on, and
 * putting other words in its place.
 *
 * The whole manuscript is searched, not only the notes the page holds: the
 * window is the page's economy, and a match in a chapter the page has not
 * mounted yet is still a match. A note on the page is read from the page,
 * typing not yet saved included; a note off it from the Vault, once, and
 * again only when its stamp moves.
 *
 * The page itself -- which notes it holds, how a match is drawn or brought
 * onto the screen, how a note is written -- is the view's, reached through
 * the host. Kept apart from the view so this half can be exercised without
 * a workspace.
 */

import {
	compileTextSearch,
	findTextMatches,
	passagesLostTo,
	replacementFor,
	replacementsIn,
	type RevisionSpot,
	type TextRange,
	type TextReplacement,
	type TextSearch,
	type TextSearchOptions,
} from '../domain';

/**
 * How many matches the bar keeps hold of before it stops counting and says
 * there are more. A word as common as 的 in a long Chinese novel stays under
 * it; a pattern that matches every character does not, and is not held.
 */
export const STREAM_SEARCH_LIMIT = 50_000;

/** How long typing in a note may pause before its matches are found again. */
const EDIT_DELAY_MS = 200;

/** What the bar shows in its count. */
export type StreamSearchCount =
	| { kind: 'none' }
	| { kind: 'busy' }
	| { kind: 'error'; message: string }
	| { kind: 'count'; index: number; total: number; limited: boolean };

/** One note's matches and what they were found in. */
export interface NoteMatches {
	ranges: readonly TextRange[];
	/** The index among `ranges` of the match the bar stands on, or null. */
	current: number | null;
}

/** A match by where it is: a note, and a stretch of its text. */
export interface StreamMatch extends TextRange {
	path: string;
}

/**
 * A place a revision or a foreshadowing occurrence keeps in a note, as
 * stored: words a replacement can take out from under it.
 */
export interface MarkedPassage extends RevisionSpot {
	path: string;
	family: 'revision' | 'foreshadowing';
}

/** What a replacement breaks: revisions put in conflict, occurrences left unresolved. */
export interface MarksLost {
	revisions: number;
	occurrences: number;
}

/** A note the replacement is about to reach, its matches, and the marks they break. */
export interface ReplacePlanEntry {
	path: string;
	count: number;
	lost: MarksLost;
}

export interface StreamSearchHost {
	/** The window the timers run in: the view's own, a popout's if it is in one. */
	readonly win: Window;
	/** The manuscript's notes in reading order. */
	notes(): readonly string[];
	/** The text a note on the page holds right now, or null for a note off it. */
	heldText(path: string): string | null;
	/** The Vault's stamp on a note, read without opening it; null once it is gone. */
	stamp(path: string): string | null;
	/** One note's text from the Vault, with the stamp it was read at; null if it will not read. */
	read(path: string): Promise<{ body: string; stamp: string } | null>;
	/** Draws a note's matches afresh from `matchesFor`, if the page holds it. */
	paint(path: string): void;
	/** Moves the ring to a note's match of that index, or takes it off with null. */
	markCurrent(path: string, index: number | null): void;
	/** Whether a match stands on the screen already, so nothing need move. */
	isShown(path: string, range: TextRange, index: number): boolean;
	/** Brings a match onto the screen, putting its note on the page first if need be. */
	reveal(path: string, range: TextRange, index: number): Promise<void>;
	/** Where the reader stands, for the first match a new search lands on. */
	origin(): { path: string; at: number } | null;
	showCount(count: StreamSearchCount): void;
	/** Whether the note may be written: its project and the note itself both allow it. */
	writable(path: string): boolean;
	/**
	 * Makes in one note the replacements a plan finds, as one write: the plan
	 * is handed the note's text as it stands when the write is made. Hands
	 * back the text written and how many were made, or null when nothing was.
	 */
	rewrite(
		path: string,
		plan: (text: string) => readonly TextReplacement[],
	): Promise<{ text: string; count: number } | null>;
	/** Every place the project's revisions and foreshadowing keep in its notes, as stored. */
	markedPassages(): Promise<readonly MarkedPassage[]>;
	/** Asks before one replacement breaks marks in a note; true to go ahead. */
	confirmReplaceMarked(path: string, lost: MarksLost): Promise<boolean>;
	/** Asks whether to go ahead, where asking is called for; true to go ahead. */
	confirmReplaceAll(plan: readonly ReplacePlanEntry[]): Promise<boolean>;
	/** Says what a replacement across the manuscript came to. */
	replacedAll(summary: { matches: number; notes: number; plan: readonly ReplacePlanEntry[] }): void;
	/** Says why a match the bar stood on was left as it was. */
	refusedReadOnly(path: string): void;
}

interface FoundIn {
	text: string;
	search: TextSearch;
	ranges: TextRange[];
	/** More matches stood here than the limit left room for. */
	capped: boolean;
}

const sameRange = (left: TextRange, right: TextRange): boolean =>
	left.from === right.from && left.to === right.to;

/** Where a range stands among a note's matches, or null when it is none of them. */
function indexOfRange(ranges: readonly TextRange[], range: TextRange): number | null {
	const index = ranges.findIndex((candidate) => sameRange(candidate, range));
	return index === -1 ? null : index;
}

/** The marks replacements in one text would break there, counted by kind. */
function marksLost(
	text: string,
	marked: readonly MarkedPassage[],
	replacements: readonly TextReplacement[],
): MarksLost {
	const lost: MarksLost = { revisions: 0, occurrences: 0 };
	for (const passage of passagesLostTo(text, marked, replacements)) {
		if (passage.family === 'revision') lost.revisions += 1;
		else lost.occurrences += 1;
	}
	return lost;
}

const breaksMarks = (lost: MarksLost): boolean => lost.revisions + lost.occurrences > 0;

export class StreamSearch {
	private search: TextSearch | null = null;
	private error: string | null = null;
	private active = false;
	/** The notes off the page as last read from the Vault, by stamp. */
	private readonly bodies = new Map<string, { stamp: string; body: string }>();
	private readonly found = new Map<string, FoundIn>();
	private current: StreamMatch | null = null;
	/** Bumped by every new search, so an answer to an older one is let go. */
	private generation = 0;
	/** The latest search's reading of the manuscript, which every move waits for. */
	private ready: Promise<void> = Promise.resolve();
	/** One move or replacement at a time, in the order they were asked for. */
	private work: Promise<void> = Promise.resolve();
	private readonly editTimers = new Map<string, number>();

	constructor(private readonly host: StreamSearchHost) {}

	/** Whether a search stands: the bar is open and holds a query that reads. */
	isActive(): boolean {
		return this.active && this.search !== null;
	}

	/** The match the bar stands on, if any. */
	currentMatch(): StreamMatch | null {
		return this.isActive() ? this.current : null;
	}

	/**
	 * A note's matches for drawing, found afresh when the page holds newer
	 * words than they were found in; null while no search stands.
	 */
	matchesFor(path: string): NoteMatches | null {
		if (!this.isActive()) return null;
		const ranges = this.rangesOf(path);
		const current =
			this.current?.path === path ? indexOfRange(ranges, this.current) : null;
		return { ranges, current };
	}

	/**
	 * A new query, or new options for the old one. The manuscript is read
	 * where it needs to be, every note searched, and the bar set on the first
	 * match at or after where the reader stands -- brought onto the screen
	 * only when it is not there already, so typing a query moves nothing that
	 * need not move.
	 */
	setQuery(query: string, options: TextSearchOptions): Promise<void> {
		this.active = true;
		this.generation += 1;
		const generation = this.generation;
		this.cancelEdits();
		const compiled = compileTextSearch(query, options);
		this.current = null;
		const painted = [...this.found.keys()];
		this.found.clear();
		if (compiled === null || !compiled.ok) {
			this.search = null;
			this.error = compiled === null ? null : compiled.error;
			for (const path of painted) this.host.paint(path);
			this.publishCount();
			this.ready = Promise.resolve();
			return this.ready;
		}
		this.search = compiled.search;
		this.error = null;
		this.ready = (async () => {
			await this.load();
			if (generation !== this.generation || !this.isActive()) return;
			this.findAll();
			for (const path of new Set([...painted, ...this.found.keys()])) {
				this.host.paint(path);
			}
			const first = this.firstFrom(this.host.origin());
			if (first === null) {
				this.publishCount();
				return;
			}
			await this.moveTo(first, 'when-hidden');
		})();
		return this.ready;
	}

	/** The next match on, or the one before; round to the other end past the last. */
	step(direction: 1 | -1): Promise<void> {
		return this.queue(async () => {
			await this.ready;
			if (!this.isActive()) return;
			const next =
				this.current === null
					? this.firstFrom(this.host.origin())
					: this.neighbour(this.current, direction);
			if (next !== null) await this.moveTo(next, 'always');
		});
	}

	/**
	 * Replaces the match the bar stands on and goes on to the next one after
	 * the words put in. With no match stood on yet, the first press only
	 * finds one, so nothing is replaced unseen.
	 */
	replaceCurrent(template: string): Promise<void> {
		return this.queue(async () => {
			await this.ready;
			const search = this.search;
			if (!this.isActive() || search === null) return;
			const target = this.current;
			if (target === null) {
				const first = this.firstFrom(this.host.origin());
				if (first !== null) await this.moveTo(first, 'always');
				return;
			}
			const text = this.textOf(target.path);
			if (text === null) return;
			const insert = replacementFor(text, search, target, template);
			if (insert === null) {
				// The words moved on since the match was found: the bar stands on
				// whatever is there now, and the next press replaces that.
				this.findIn(target.path, text);
				this.host.paint(target.path);
				const next = this.firstFrom({ path: target.path, at: target.from });
				if (next !== null) await this.moveTo(next, 'always');
				else this.dropCurrent();
				return;
			}
			// Words already reading as the replacement would leave them: nothing
			// to write, and the bar goes on to the next match as if it had.
			if (insert === text.slice(target.from, target.to)) {
				const next = this.neighbour(target, 1);
				if (next !== null && !(next.path === target.path && sameRange(next, target))) {
					await this.moveTo(next, 'always');
				}
				return;
			}
			if (!this.host.writable(target.path)) {
				this.host.refusedReadOnly(target.path);
				const next = this.neighbour(target, 1);
				if (next !== null && !(next.path === target.path && sameRange(next, target))) {
					await this.moveTo(next, 'always');
				}
				return;
			}
			// Words a revision or a foreshadowing marks lose their place to a
			// replacement, so the author is asked first. A no leaves the bar
			// where it stands, the match unreplaced.
			const marked = (await this.markedByNote()).get(target.path) ?? [];
			const lost = marksLost(text, marked, [{ from: target.from, to: target.to, insert }]);
			if (breaksMarks(lost) && !(await this.host.confirmReplaceMarked(target.path, lost))) {
				return;
			}
			if (this.search !== search) return;
			// Asked again of the text as the write finds it, which the page may
			// have moved on from since the press.
			let put = insert;
			const done = await this.host.rewrite(target.path, (now) => {
				const fresh = replacementFor(now, search, target, template);
				if (fresh === null) return [];
				put = fresh;
				return [{ from: target.from, to: target.to, insert: fresh }];
			});
			if (done === null || this.search !== search) return;
			this.keep(target.path, done.text);
			this.findIn(target.path, done.text);
			this.host.paint(target.path);
			const next = this.firstFrom({
				path: target.path,
				at: target.from + put.length,
			});
			if (next === null) this.dropCurrent();
			else await this.moveTo(next, 'always');
		});
	}

	/**
	 * Replaces every match in the manuscript, each note in one write. The
	 * notes are searched afresh first and without the limit, so the count
	 * the host may ask about is every match there is, and the read-only
	 * notes are left out of it as they are left out of the writing. The
	 * marks the replacements would break are counted with them.
	 */
	replaceAll(template: string): Promise<void> {
		return this.queue(async () => {
			await this.ready;
			const search = this.search;
			if (!this.isActive() || search === null) return;
			const read = await this.load();
			if (this.search !== search) return;
			if (read) this.publishCount();
			const marked = await this.markedByNote();
			if (this.search !== search) return;
			const plan: ReplacePlanEntry[] = [];
			for (const path of this.host.notes()) {
				if (!this.host.writable(path)) continue;
				const text = this.textOf(path);
				if (text === null) continue;
				const replacements = replacementsIn(text, search, template);
				if (replacements.length === 0) continue;
				plan.push({
					path,
					count: replacements.length,
					lost: marksLost(text, marked.get(path) ?? [], replacements),
				});
			}
			if (plan.length === 0) return;
			if (!(await this.host.confirmReplaceAll(plan))) return;
			// A long manuscript takes a while to write: the count says so.
			this.host.showCount({ kind: 'busy' });
			let matches = 0;
			let notes = 0;
			for (const { path } of plan) {
				const done = await this.host.rewrite(path, (text) =>
					replacementsIn(text, search, template),
				);
				if (done === null || done.count === 0) continue;
				matches += done.count;
				notes += 1;
				this.keep(path, done.text);
				if (this.search === search) {
					this.findIn(path, done.text);
					this.host.paint(path);
				}
			}
			// A query typed while the notes were being written has its own
			// match by now; only this search's is let go of.
			if (this.search === search) {
				const previous = this.current;
				this.current = null;
				if (previous !== null) this.host.markCurrent(previous.path, null);
				const first = this.firstFrom(this.host.origin());
				if (first !== null) await this.moveTo(first, 'when-hidden');
			}
			this.publishCount();
			this.host.replacedAll({ matches, notes, plan });
		});
	}

	/**
	 * A note's text changed under typing: its matches are found again once
	 * the typing pauses, and the bar keeps to the match it stood on, wherever
	 * the typing has carried it. Nothing is brought onto the screen: the
	 * author is writing, not searching.
	 */
	noteEdited(path: string): void {
		if (!this.isActive()) return;
		const win = this.host.win;
		const timer = this.editTimers.get(path);
		if (timer !== undefined) win.clearTimeout(timer);
		this.editTimers.set(
			path,
			win.setTimeout(() => {
				this.editTimers.delete(path);
				if (!this.isActive()) return;
				const text = this.host.heldText(path);
				if (text === null) return;
				const known = this.found.get(path);
				if (known === undefined || known.text !== text || known.search !== this.search) {
					this.findIn(path, text);
				}
				// Settled and drawn even when the matches were found again
				// elsewhere first: whatever found them may not have drawn them.
				this.keepCurrent(path);
				this.host.paint(path);
				this.publishCount();
			}, EDIT_DELAY_MS),
		);
	}

	/**
	 * The manuscript may have changed: a note written elsewhere, arrived,
	 * gone or moved. Every note is asked its stamp, the ones that moved are
	 * read and searched again, and the rest are left exactly as they were.
	 */
	reconcile(): Promise<void> {
		if (!this.isActive()) return Promise.resolve();
		return this.queue(async () => {
			await this.ready;
			const search = this.search;
			if (!this.isActive() || search === null) return;
			const read = await this.load();
			if (this.search !== search) return;
			const notes = new Set(this.host.notes());
			let moved = false;
			for (const path of [...this.found.keys()]) {
				if (notes.has(path)) continue;
				this.found.delete(path);
				moved = true;
			}
			for (const path of [...this.bodies.keys()]) {
				if (!notes.has(path)) this.bodies.delete(path);
			}
			const changed: string[] = [];
			for (const path of notes) {
				const text = this.textOf(path);
				const known = this.found.get(path);
				if (text === null) {
					if (known !== undefined) this.found.delete(path);
					continue;
				}
				if (known !== undefined && known.text === text && known.search === search) {
					continue;
				}
				this.findIn(path, text);
				changed.push(path);
			}
			if (!moved && changed.length === 0) {
				if (read) this.publishCount();
				return;
			}
			// The match the bar stood on is settled before anything is drawn,
			// so each note is drawn once, with its ring where it now belongs.
			if (this.current !== null && !notes.has(this.current.path)) {
				this.current = null;
			}
			if (this.current !== null) this.keepCurrent(this.current.path);
			for (const path of changed) this.host.paint(path);
			this.publishCount();
		});
	}

	/**
	 * The bar has closed: every match taken off the page and every pending
	 * search let go. What was read of the manuscript is kept, by stamp, for
	 * the next time the bar opens.
	 */
	close(): void {
		this.active = false;
		this.generation += 1;
		this.cancelEdits();
		this.current = null;
		this.search = null;
		this.error = null;
		const painted = [...this.found.keys()];
		this.found.clear();
		for (const path of painted) this.host.paint(path);
	}

	private queue(work: () => Promise<void>): Promise<void> {
		const run = this.work.then(work, work);
		this.work = run.catch(() => undefined);
		return run;
	}

	private cancelEdits(): void {
		for (const timer of this.editTimers.values()) this.host.win.clearTimeout(timer);
		this.editTimers.clear();
	}

	/**
	 * The places marked in each note, read afresh for a replacement. Marks
	 * that will not read leave nothing to ask about: a store that cannot
	 * answer must not stop the replacing.
	 */
	private async markedByNote(): Promise<Map<string, MarkedPassage[]>> {
		const passages = await this.host.markedPassages().catch(() => []);
		const byNote = new Map<string, MarkedPassage[]>();
		for (const passage of passages) {
			const kept = byNote.get(passage.path);
			if (kept === undefined) byNote.set(passage.path, [passage]);
			else kept.push(passage);
		}
		return byNote;
	}

	/** A note's text as it stands: the page's where it holds the note, the Vault's otherwise. */
	private textOf(path: string): string | null {
		const held = this.host.heldText(path);
		if (held !== null) return held;
		const kept = this.bodies.get(path);
		return kept !== undefined && kept.stamp === this.host.stamp(path) ? kept.body : null;
	}

	/** Remembers a note off the page as just written, so it is not read straight back. */
	private keep(path: string, text: string): void {
		if (this.host.heldText(path) !== null) return;
		const stamp = this.host.stamp(path);
		if (stamp === null) this.bodies.delete(path);
		else this.bodies.set(path, { stamp, body: text });
	}

	/**
	 * Reads every note off the page that has not been read since its stamp
	 * last moved, and says whether it had any to read. The count says the
	 * manuscript is being read while it is; whoever waited on the reading
	 * puts the count back, once it knows what it came to.
	 */
	private async load(): Promise<boolean> {
		const wanted = this.host
			.notes()
			.filter((path) => this.host.heldText(path) === null && this.textOf(path) === null);
		if (wanted.length === 0) return false;
		this.host.showCount({ kind: 'busy' });
		await Promise.all(
			wanted.map(async (path) => {
				const read = await this.host.read(path).catch(() => null);
				if (read !== null) this.bodies.set(path, read);
			}),
		);
		return true;
	}

	/** Every note searched in reading order, until the limit is spent. */
	private findAll(): void {
		this.found.clear();
		let room = STREAM_SEARCH_LIMIT;
		for (const path of this.host.notes()) {
			const text = this.textOf(path);
			if (text === null) continue;
			room -= this.store(path, text, room).length;
		}
	}

	/** One note searched again, with whatever room the others leave it. */
	private findIn(path: string, text: string): void {
		let others = 0;
		for (const [held, known] of this.found) {
			if (held !== path) others += known.ranges.length;
		}
		this.store(path, text, Math.max(0, STREAM_SEARCH_LIMIT - others));
	}

	private store(path: string, text: string, room: number): TextRange[] {
		const search = this.search;
		if (search === null) return [];
		// One past the room, which is how a note says it held more.
		const ranges = findTextMatches(text, search, room + 1);
		const capped = ranges.length > room;
		if (capped) ranges.length = room;
		this.found.set(path, { text, search, ranges, capped });
		return ranges;
	}

	/**
	 * A note's matches, found again first when the page holds newer words,
	 * and the bar kept on its match there through whatever changed.
	 */
	private rangesOf(path: string): readonly TextRange[] {
		const held = this.host.heldText(path);
		const known = this.found.get(path);
		if (
			held !== null &&
			(known === undefined || known.text !== held || known.search !== this.search)
		) {
			this.findIn(path, held);
			this.keepCurrent(path);
		}
		return this.found.get(path)?.ranges ?? [];
	}

	/**
	 * The first match at or after a place, in reading order, round past the
	 * end to the start and back to the place itself; null when there is none
	 * anywhere. With no place, the first match of the manuscript.
	 */
	private firstFrom(origin: { path: string; at: number } | null): StreamMatch | null {
		const notes = this.host.notes();
		const start = origin === null ? -1 : notes.indexOf(origin.path);
		const from = start === -1 ? 0 : start;
		for (let step = 0; step < notes.length; step += 1) {
			const path = notes[(from + step) % notes.length];
			if (path === undefined) continue;
			const ranges = this.found.get(path)?.ranges ?? [];
			const hit =
				step === 0 && start !== -1 && origin !== null
					? ranges.find((range) => range.from >= origin.at)
					: ranges[0];
			if (hit !== undefined) return { path, from: hit.from, to: hit.to };
		}
		if (start === -1 || origin === null) return null;
		// Round the whole way: what stands before the place in its own note.
		const first = this.found.get(origin.path)?.ranges[0];
		return first === undefined ? null : { path: origin.path, from: first.from, to: first.to };
	}

	/** The match after or before one, in reading order, round past either end. */
	private neighbour(from: StreamMatch, direction: 1 | -1): StreamMatch | null {
		const notes = this.host.notes();
		const start = notes.indexOf(from.path);
		if (start === -1) return this.firstFrom(null);
		const own = this.found.get(from.path)?.ranges ?? [];
		const inOwn =
			direction === 1
				? own.find((range) => range.from > from.from)
				: [...own].reverse().find((range) => range.from < from.from);
		if (inOwn !== undefined) return { path: from.path, from: inOwn.from, to: inOwn.to };
		for (let step = 1; step <= notes.length; step += 1) {
			const index = (((start + direction * step) % notes.length) + notes.length) % notes.length;
			const path = notes[index];
			if (path === undefined) continue;
			const ranges = this.found.get(path)?.ranges ?? [];
			// Round to the note the walk began in: its matches from the far end.
			const hit = direction === 1 ? ranges[0] : ranges[ranges.length - 1];
			if (hit !== undefined) return { path, from: hit.from, to: hit.to };
		}
		return null;
	}

	/**
	 * Keeps the bar on its match through an edit of the note it stands in: the
	 * same stretch if it still matches, else the first match at or after where
	 * it began, which is where typing ahead of it has carried it.
	 */
	private keepCurrent(path: string): void {
		const current = this.current;
		if (current === null || current.path !== path) return;
		const ranges = this.found.get(path)?.ranges ?? [];
		if (indexOfRange(ranges, current) !== null) return;
		const next = this.firstFrom({ path, at: current.from });
		this.current = next;
		if (next !== null && next.path !== path) {
			this.host.markCurrent(next.path, indexOfRange(this.rangesOf(next.path), next));
		}
	}

	private dropCurrent(): void {
		const previous = this.current;
		this.current = null;
		if (previous !== null) this.host.markCurrent(previous.path, null);
		this.publishCount();
	}

	/**
	 * Sets the bar on a match, moves the ring there, and brings it onto the
	 * screen. The note's matches are made fresh first; a match the typing
	 * has since moved is followed to the first one at or after where it was.
	 */
	private async moveTo(wanted: StreamMatch, reveal: 'always' | 'when-hidden'): Promise<void> {
		const ranges = this.rangesOf(wanted.path);
		const index =
			indexOfRange(ranges, wanted) ??
			(() => {
				const at = ranges.findIndex((range) => range.from >= wanted.from);
				return at === -1 ? null : at;
			})();
		const range = index === null ? undefined : ranges[index];
		const previous = this.current;
		if (range === undefined || index === null) {
			this.current = null;
			if (previous !== null) this.host.markCurrent(previous.path, null);
			this.publishCount();
			return;
		}
		const next = { path: wanted.path, from: range.from, to: range.to };
		this.current = next;
		if (previous !== null && previous.path !== next.path) {
			this.host.markCurrent(previous.path, null);
		}
		this.host.markCurrent(next.path, index);
		this.publishCount();
		if (reveal === 'when-hidden' && this.host.isShown(next.path, range, index)) return;
		await this.host.reveal(next.path, range, index);
	}

	private publishCount(): void {
		if (!this.active) return;
		if (this.search === null) {
			this.host.showCount(
				this.error === null ? { kind: 'none' } : { kind: 'error', message: this.error },
			);
			return;
		}
		let total = 0;
		let index = 0;
		let limited = false;
		for (const path of this.host.notes()) {
			const known = this.found.get(path);
			if (known === undefined) continue;
			if (this.current?.path === path) {
				const at = indexOfRange(known.ranges, this.current);
				if (at !== null) index = total + at + 1;
			}
			total += known.ranges.length;
			limited ||= known.capped;
		}
		this.host.showCount({ kind: 'count', index, total, limited });
	}
}
