/**
 * Foreshadowing: threads the author is tracking through the manuscript, each
 * standing at every place it touches the page.
 *
 * A foreshadowing is one record -- a name, what it promises, where it is in
 * its life, the entities it is about -- holding any number of occurrences,
 * one per passage: the plant, its reinforcements, the payoff. An occurrence
 * remembers its place the way a revision does (`revisions.ts`): body
 * offsets, the text that stood there, and a few characters of context to
 * either side, and everything about its standing is derived per reading and
 * never stored. A passage rewritten out from under an occurrence leaves that
 * one occurrence unresolved and nothing else about the thread, and an undo
 * resolves it again by itself, because nothing was written down about the
 * trouble.
 */

import type { ForeshadowingMarkOccurrence, MentionMark } from './mentions';
import {
	type RevisionAnchor,
	type RevisionSpot,
	anchorSpot,
	compareRevisionsAtOneSpot,
	levelledPassage,
	orderPassages,
	passageContext,
	passageStandsAt,
} from './revisions';

/** Where a thread is in its life, in the order the table sorts by. */
export const FORESHADOWING_STATUSES = [
	'planned',
	'active',
	'resolved',
	'abandoned',
] as const;
export type ForeshadowingStatus = (typeof FORESHADOWING_STATUSES)[number];

export function isForeshadowingStatus(
	value: unknown,
): value is ForeshadowingStatus {
	return (FORESHADOWING_STATUSES as readonly unknown[]).includes(value);
}

/** What one appearance does for the thread: laid down, echoed, paid off. */
export const OCCURRENCE_ROLES = ['plant', 'reinforce', 'payoff'] as const;
export type OccurrenceRole = (typeof OCCURRENCE_ROLES)[number];

export function isOccurrenceRole(value: unknown): value is OccurrenceRole {
	return (OCCURRENCE_ROLES as readonly unknown[]).includes(value);
}

/**
 * One entity a foreshadowing is about, named by the stable id its note
 * carries rather than by its name, so a rename keeps the link. `name` is the
 * label last seen, kept only so a deleted entity can still be shown as
 * something rather than as an id.
 */
export interface EntityRef {
	/** 'character', 'scene', or a worldbuilding kind id. */
	kind: string;
	/** The note's snowflake-character-id, -scene-id or -entity-id. */
	id: string;
	name: string;
}

/**
 * One appearance of a foreshadowing in the manuscript. The place limbs are
 * the revision's, read and anchored by the same rules; standing is derived
 * per reading and never stored.
 */
export interface ForeshadowingOccurrence {
	id: string;
	role: OccurrenceRole;
	/** The author's own note about this appearance; empty when none. */
	note: string;
	path: string;
	/** Always a range: `to > from`, `originalText.length === to - from`. */
	from: number;
	to: number;
	originalText: string;
	before: string;
	after: string;
}

export interface Foreshadowing {
	id: string;
	name: string;
	description: string;
	status: ForeshadowingStatus;
	related: EntityRef[];
	createdAt: number;
	/** Bumped by an author's edit alone; a levelling or a carry never touches it. */
	updatedAt: number;
	occurrences: ForeshadowingOccurrence[];
}

/** The place limbs alone, as a fresh capture or a relink hands them over. */
export type OccurrencePlacement = Pick<
	ForeshadowingOccurrence,
	'path' | 'from' | 'to' | 'originalText' | 'before' | 'after'
>;

/** One occurrence with the thread it belongs to. */
export interface ForeshadowingRef {
	item: Foreshadowing;
	occurrence: ForeshadowingOccurrence;
}

/**
 * Everything the edit form saves at once: the thread's own limbs, the role
 * and note of every occurrence the form showed, and the occurrences it took
 * out. One the form never saw -- added from the stream while the form stood
 * open -- is kept as it stands; the places are never touched from here.
 */
export interface ForeshadowingEdit {
	name: string;
	description: string;
	status: ForeshadowingStatus;
	related: EntityRef[];
	occurrences: { id: string; role: OccurrenceRole; note: string }[];
	removed: string[];
}

// --- reading stored shapes -------------------------------------------------

export function isEntityRef(value: unknown): value is EntityRef {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.kind === 'string' &&
		entry.kind.length > 0 &&
		typeof entry.id === 'string' &&
		entry.id.length > 0 &&
		typeof entry.name === 'string'
	);
}

export function isForeshadowingOccurrence(
	value: unknown,
): value is ForeshadowingOccurrence {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.id === 'string' &&
		entry.id.length > 0 &&
		isOccurrenceRole(entry.role) &&
		typeof entry.note === 'string' &&
		typeof entry.path === 'string' &&
		entry.path.length > 0 &&
		typeof entry.from === 'number' &&
		typeof entry.to === 'number' &&
		Number.isInteger(entry.from) &&
		Number.isInteger(entry.to) &&
		entry.from >= 0 &&
		entry.to > entry.from &&
		typeof entry.originalText === 'string' &&
		entry.originalText.length === entry.to - entry.from &&
		typeof entry.before === 'string' &&
		typeof entry.after === 'string'
	);
}

/** The thread's own limbs, without looking inside its lists. */
function foreshadowingLimbsHold(
	entry: Record<string, unknown>,
): entry is Record<string, unknown> & {
	id: string;
	name: string;
	description: string;
	status: ForeshadowingStatus;
	related: unknown[];
	createdAt: number;
	updatedAt: number;
	occurrences: unknown[];
} {
	return (
		typeof entry.id === 'string' &&
		entry.id.length > 0 &&
		typeof entry.name === 'string' &&
		typeof entry.description === 'string' &&
		isForeshadowingStatus(entry.status) &&
		Array.isArray(entry.related) &&
		typeof entry.createdAt === 'number' &&
		Number.isFinite(entry.createdAt) &&
		typeof entry.updatedAt === 'number' &&
		Number.isFinite(entry.updatedAt) &&
		Array.isArray(entry.occurrences)
	);
}

/** Every limb good, every occurrence and ref good: what a served record looks like. */
export function isForeshadowing(value: unknown): value is Foreshadowing {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		foreshadowingLimbsHold(entry) &&
		entry.related.every(isEntityRef) &&
		entry.occurrences.every(isForeshadowingOccurrence)
	);
}

/**
 * One stored entry read leniently: the thread's own limbs must hold, but an
 * occurrence or a related ref this build cannot read is dropped and the
 * thread kept. Answers null where the thread itself will not read, and the
 * store sets that entry aside as a stray.
 */
export function readForeshadowing(value: unknown): Foreshadowing | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	if (!foreshadowingLimbsHold(entry)) return null;
	return {
		id: entry.id,
		name: entry.name,
		description: entry.description,
		status: entry.status,
		related: entry.related.filter(isEntityRef),
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
		occurrences: entry.occurrences.filter(isForeshadowingOccurrence),
	};
}

// --- capture and anchoring -------------------------------------------------

/**
 * Whether an occurrence's words are lost to its note: no body to read, or
 * none the anchor finds. The one rule every surface reads standing by.
 */
export function occurrenceUnresolved(
	body: string | null,
	occurrence: ForeshadowingOccurrence,
): boolean {
	return body === null || anchorOccurrence(body, occurrence).state === 'conflict';
}

/** A place read off the body it was picked in, so every caller stores one truth. */
export function captureOccurrencePlacement(
	path: string,
	body: string,
	from: number,
	to: number,
): OccurrencePlacement {
	return {
		path,
		from,
		to,
		originalText: body.slice(from, to),
		...passageContext(body, from, to),
	};
}

export function captureOccurrence(
	path: string,
	body: string,
	from: number,
	to: number,
	role: OccurrenceRole,
	note: string,
	id: string,
): ForeshadowingOccurrence {
	return { id, role, note, ...captureOccurrencePlacement(path, body, from, to) };
}

/**
 * One occurrence as the anchoring vocabulary reads a place. Always a range:
 * an occurrence is text the author picked out, never a point, so it wears
 * `replace` and the insertion arm of `anchorSpot` is never asked. Written
 * limb by limb rather than spread, so what is load-bearing is in view.
 */
export function occurrenceSpot(occurrence: OccurrencePlacement): RevisionSpot {
	return {
		kind: 'replace',
		from: occurrence.from,
		to: occurrence.to,
		originalText: occurrence.originalText,
		before: occurrence.before,
		after: occurrence.after,
	};
}

/** Where one occurrence stands against the body now: `anchorSpot`. */
export function anchorOccurrence(
	body: string,
	occurrence: OccurrencePlacement,
): RevisionAnchor {
	return anchorSpot(body, occurrenceSpot(occurrence));
}

/**
 * One note's occurrences brought level with its saved body. Only occurrences
 * on `path` are looked at; threads nothing moved in are returned by identity,
 * and no thread's `updatedAt` is touched -- a levelling is the plugin's
 * errand, not the author's edit.
 */
export function refreshOccurrenceAnchors(
	body: string,
	path: string,
	items: readonly Foreshadowing[],
): { next: Foreshadowing[]; changed: boolean } {
	let changed = false;
	const next = items.map((item) => {
		let moved = false;
		const occurrences = item.occurrences.map((occurrence) => {
			if (occurrence.path !== path) return occurrence;
			const levelled = levelledPassage(body, occurrenceSpot(occurrence));
			if (levelled === null) return occurrence;
			moved = true;
			return { ...occurrence, ...levelled };
		});
		if (!moved) return item;
		changed = true;
		return { ...item, occurrences };
	});
	return { next, changed };
}

// --- ordering --------------------------------------------------------------

/** Where one occurrence stands in the manuscript. */
export interface OccurrencePlace {
	/** The note's index in the order handed in. */
	note: number;
	/** Where in that note the words stand now, or last stood. */
	at: number;
}

/** An occurrence dressed as a passage the shared order can walk. */
function placedSpot(
	occurrence: ForeshadowingOccurrence,
): RevisionSpot & { id: string; path: string } {
	return { ...occurrenceSpot(occurrence), id: occurrence.id, path: occurrence.path };
}

/**
 * Two occurrences standing at one spot, told apart by id: settled and random,
 * the same rule the revisions use, so the stack and the arrows agree.
 */
export function compareOccurrencesAtOneSpot(
	left: { id: string },
	right: { id: string },
): number {
	return compareRevisionsAtOneSpot(left, right);
}

/**
 * One thread's occurrences in reading order: `orderPassages` over them. An
 * occurrence on a note the order does not name is left out, as a revision
 * there would be.
 */
export function orderOccurrences(
	item: Foreshadowing,
	paths: readonly string[],
	bodyOf: (path: string) => string | null = () => null,
): ForeshadowingOccurrence[] {
	const byId = new Map(
		item.occurrences.map((occurrence) => [occurrence.id, occurrence] as const),
	);
	return orderPassages(item.occurrences.map(placedSpot), paths, bodyOf)
		.map((spot) => byId.get(spot.id))
		.filter(
			(occurrence): occurrence is ForeshadowingOccurrence =>
				occurrence !== undefined,
		);
}

/**
 * Where a thread first shows: its earliest occurrence in reading order, at
 * the place its words hold now. Null when nothing it holds stands on a note
 * the order names.
 */
export function firstAppearance(
	item: Foreshadowing,
	paths: readonly string[],
	bodyOf: (path: string) => string | null = () => null,
): OccurrencePlace | null {
	const [first] = orderOccurrences(item, paths, bodyOf);
	if (first === undefined) return null;
	const body = bodyOf(first.path);
	return {
		note: paths.indexOf(first.path),
		at: body === null ? first.from : passageStandsAt(body, occurrenceSpot(first)),
	};
}

/**
 * The order two threads stand in: status as FORESHADOWING_STATUSES lists it,
 * then first appearance, a thread with none standing last, then the older
 * thread, then the id. Places are handed in already worked out, because
 * deriving one costs a body read.
 */
export function compareForeshadowings(
	left: Foreshadowing,
	right: Foreshadowing,
	placed: ReadonlyMap<string, OccurrencePlace | null>,
): number {
	const byStatus =
		FORESHADOWING_STATUSES.indexOf(left.status) -
		FORESHADOWING_STATUSES.indexOf(right.status);
	if (byStatus !== 0) return byStatus;
	const leftPlace = placed.get(left.id) ?? null;
	const rightPlace = placed.get(right.id) ?? null;
	if (leftPlace !== null && rightPlace !== null) {
		const byNote = leftPlace.note - rightPlace.note;
		if (byNote !== 0) return byNote;
		const at = leftPlace.at - rightPlace.at;
		if (at !== 0) return at;
	} else if (leftPlace !== null) {
		return -1;
	} else if (rightPlace !== null) {
		return 1;
	}
	const byAge = left.createdAt - right.createdAt;
	if (byAge !== 0) return byAge;
	return compareRevisionsAtOneSpot(left, right);
}

/** Every thread in table order, each body read once. */
export function orderForeshadowings(
	items: readonly Foreshadowing[],
	paths: readonly string[],
	bodyOf: (path: string) => string | null = () => null,
): Foreshadowing[] {
	const bodies = new Map<string, string | null>();
	const read = (path: string): string | null => {
		if (!bodies.has(path)) bodies.set(path, bodyOf(path));
		return bodies.get(path) ?? null;
	};
	const placed = new Map(
		items.map((item) => [item.id, firstAppearance(item, paths, read)] as const),
	);
	return [...items].sort((left, right) =>
		compareForeshadowings(left, right, placed),
	);
}

// --- the dress -------------------------------------------------------------

export interface ForeshadowingPlan {
	/** Marks for the occurrences that anchor, in document order. Overlaps kept. */
	plan: MentionMark[];
	/** Where each planned occurrence stands NOW, by occurrence id. */
	anchors: Map<string, { from: number; to: number }>;
	/** The occurrences the body no longer answers for. */
	conflicts: ForeshadowingRef[];
}

/**
 * One note's foreshadowing dress: a silent mark per anchored occurrence,
 * wearing its role and its thread's status, titled with the thread's name
 * so overlapping threads can be told apart by pointing at them. Sorted by
 * where each begins, which the page's wrap depends on; overlapping marks
 * are kept, because one sentence may carry two threads, and the wrap sorts
 * them into bands of its own.
 */
export function planForeshadowingMarks(
	path: string,
	body: string,
	items: readonly Foreshadowing[],
): ForeshadowingPlan {
	const plan: MentionMark[] = [];
	const anchors = new Map<string, { from: number; to: number }>();
	const conflicts: ForeshadowingRef[] = [];
	for (const item of items) {
		for (const occurrence of item.occurrences) {
			if (occurrence.path !== path) continue;
			const anchor = anchorOccurrence(body, occurrence);
			if (anchor.state === 'conflict') {
				conflicts.push({ item, occurrence });
				continue;
			}
			anchors.set(occurrence.id, { from: anchor.from, to: anchor.to });
			const marked: ForeshadowingMarkOccurrence = {
				type: 'foreshadowing',
				path,
				from: anchor.from,
				to: anchor.to,
				matchedText: body.slice(anchor.from, anchor.to),
				foreshadowingId: item.id,
				occurrenceId: occurrence.id,
			};
			plan.push({
				from: anchor.from,
				to: anchor.to,
				classes: `snowflake-method-foreshadowing is-${occurrence.role} is-${item.status}`,
				title: item.name,
				occurrence: marked,
				silent: true,
			});
		}
	}
	plan.sort((left, right) => left.from - right.from || left.to - right.to);
	return { plan, anchors, conflicts };
}

// --- entity refs against a living roster -----------------------------------

/** One entity a picker may offer, and one a stored ref may resolve to. */
export interface EntityRosterEntry {
	kind: string;
	id: string;
	name: string;
	path: string;
	/** The grouping the pickers list under; a time is a point or a period. */
	group: string;
}

export interface ResolvedEntityRef extends EntityRef {
	/** Where the note stands now; empty when nothing answers the id. */
	path: string;
	missing: boolean;
}

/**
 * Stored refs read against the roster as it is now. Matched on the id alone:
 * ids are prefix-namespaced and unique across kinds, and a note carried from
 * one worldbuilding kind to another is still the same entity -- so the
 * roster's kind and name win, and the stored ones stand in only when it is
 * gone.
 */
export function resolveEntityRefs(
	refs: readonly EntityRef[],
	roster: readonly EntityRosterEntry[],
): ResolvedEntityRef[] {
	const byId = new Map(roster.map((entry) => [entry.id, entry] as const));
	return refs.map((ref) => {
		const hit = byId.get(ref.id);
		if (hit === undefined) return { ...ref, path: '', missing: true };
		return {
			kind: hit.kind,
			id: hit.id,
			name: hit.name,
			path: hit.path,
			missing: false,
		};
	});
}
