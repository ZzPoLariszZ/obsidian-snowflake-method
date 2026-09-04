import {
	occurrenceSpot,
	passageStandsAt,
	passageTravels,
	refreshOccurrenceAnchors,
	type EntityRef,
	type Foreshadowing,
	type ForeshadowingEdit,
	type ForeshadowingOccurrence,
	type OccurrencePlacement,
	type OccurrenceRole,
} from "../domain";
import { movedWithRename } from "../project-root";
import type { VaultRepository } from "../repository";
import { ForeshadowingStore } from "./foreshadowing-store";
import type { ProjectRef } from "./types";

/** What a write came to: the record now says what was asked, or why not. */
export type ForeshadowingWrite = "written" | "absent" | "refused";
/** What a deletion came to. */
export type ForeshadowingDeletion = "deleted" | "absent" | "refused";

/** The limbs of a ref alone, whatever else rode in on the object. */
const refOf = (ref: EntityRef): EntityRef => ({
	kind: ref.kind,
	id: ref.id,
	name: ref.name,
});

/** Whether an edit would leave a thread saying exactly what it says now. */
function sameThread(kept: Foreshadowing, next: Foreshadowing): boolean {
	return (
		kept.name === next.name &&
		kept.description === next.description &&
		kept.status === next.status &&
		kept.related.length === next.related.length &&
		kept.related.every((ref, index) => {
			const other = next.related[index];
			return (
				other !== undefined &&
				ref.kind === other.kind &&
				ref.id === other.id &&
				ref.name === other.name
			);
		}) &&
		kept.occurrences.length === next.occurrences.length &&
		kept.occurrences.every(
			(occurrence, index) => occurrence === next.occurrences[index],
		)
	);
}

/**
 * The foreshadowing of one project, as the hosts ask about it: a list to
 * read, mutations that land in the file at once -- a thread is something the
 * author wrote down, so nothing here waits on a quiet timer -- and the
 * save-time pass that brings stored places level with the note that moved
 * under them. Standing (anchored, moved, unresolved) is never kept here;
 * every reader derives it against the body in hand.
 *
 * `updatedAt` is the author's clock: the mutations an author asks for stamp
 * it, and the levelling, the rename carry and the split carry never do.
 * Those are the plugin keeping up with the text, not the author changing
 * their mind, and a table sorted on "recently touched" must not fill with
 * threads whose only news is that a chapter was saved.
 */
export class ForeshadowingService {
	private readonly store: ForeshadowingStore;
	private readonly now: () => number;

	constructor(
		repository: VaultRepository,
		deps: {
			now: () => number;
			onCorrupt?: (path: string) => void;
			onForeign?: (path: string, version: number) => void;
		},
	) {
		this.now = deps.now;
		this.store = new ForeshadowingStore({
			repository,
			now: deps.now,
			...(deps.onCorrupt === undefined ? {} : { onCorrupt: deps.onCorrupt }),
			...(deps.onForeign === undefined ? {} : { onForeign: deps.onForeign }),
		});
	}

	list(project: ProjectRef): Promise<readonly Foreshadowing[]> {
		return this.store.readForeshadowings(project);
	}

	/** Appends one thread; false when its id already stands. */
	create(project: ProjectRef, item: Foreshadowing): Promise<boolean> {
		return this.store.updateForeshadowings(project, (items) => {
			if (items.some((kept) => kept.id === item.id)) return null;
			return [...items, item];
		});
	}

	/**
	 * The edit form's save, one write: the thread's own limbs and the role
	 * and note of every occurrence it still holds. An occurrence left out of
	 * `next` is deleted, one it names but the record lacks is ignored, and
	 * no place limb is touched -- a place changes only by a relink.
	 *
	 * Answered on whether the record now says what was asked, not on whether
	 * a write was needed to make it say so: a form saved over its own words
	 * is a finished edit rather than a refused one.
	 */
	edit(
		project: ProjectRef,
		id: string,
		next: ForeshadowingEdit,
	): Promise<ForeshadowingWrite> {
		return this.revise(project, id, (kept) => {
			const asked = new Map(
				next.occurrences.map((occurrence) => [occurrence.id, occurrence] as const),
			);
			const occurrences = kept.occurrences.flatMap((occurrence) => {
				const wanted = asked.get(occurrence.id);
				if (wanted === undefined) return [];
				const note = wanted.note.trim();
				if (occurrence.role === wanted.role && occurrence.note === note) {
					return [occurrence];
				}
				return [{ ...occurrence, role: wanted.role, note }];
			});
			const revised: Foreshadowing = {
				...kept,
				name: next.name.trim(),
				description: next.description.trim(),
				status: next.status,
				related: next.related.map(refOf),
				occurrences,
			};
			if (sameThread(kept, revised)) return null;
			return { ...revised, updatedAt: this.now() };
		});
	}

	/**
	 * Takes one thread out with every occurrence it holds, and says which of
	 * three things happened: gone as asked, already gone, or a write the
	 * store refused with the thread left standing.
	 */
	async deleteItem(
		project: ProjectRef,
		id: string,
	): Promise<ForeshadowingDeletion> {
		// The store calls the mutate only over a file it will write; a
		// refused file never reaches it.
		let asked = false;
		let found = false;
		await this.store.updateForeshadowings(project, (items) => {
			asked = true;
			const next = items.filter((item) => item.id !== id);
			found = next.length !== items.length;
			return found ? next : null;
		});
		if (!asked) return "refused";
		return found ? "deleted" : "absent";
	}

	/**
	 * Appends one occurrence to a thread. An occurrence id already standing
	 * is left exactly as it is: the record holds an occurrence under the id
	 * asked for, which is what was asked.
	 */
	addOccurrence(
		project: ProjectRef,
		id: string,
		occurrence: ForeshadowingOccurrence,
	): Promise<ForeshadowingWrite> {
		return this.revise(project, id, (kept) => {
			if (kept.occurrences.some((held) => held.id === occurrence.id)) {
				return null;
			}
			return {
				...kept,
				updatedAt: this.now(),
				occurrences: [...kept.occurrences, occurrence],
			};
		});
	}

	/** Rewrites one occurrence's role and note; its place is not touched. */
	updateOccurrence(
		project: ProjectRef,
		id: string,
		occurrenceId: string,
		patch: { role: OccurrenceRole; note: string },
	): Promise<ForeshadowingWrite> {
		return this.reviseOccurrence(project, id, occurrenceId, (occurrence) => {
			// Trimmed as the form trims it, so a note of spaces is no note on
			// either path.
			const note = patch.note.trim();
			if (occurrence.role === patch.role && occurrence.note === note) {
				return null;
			}
			return { ...occurrence, role: patch.role, note };
		});
	}

	/**
	 * Puts one occurrence on a fresh passage, in whatever note the author
	 * selected it in; role, note and the thread's other occurrences stand.
	 */
	relinkOccurrence(
		project: ProjectRef,
		id: string,
		occurrenceId: string,
		placement: OccurrencePlacement,
	): Promise<ForeshadowingWrite> {
		return this.reviseOccurrence(project, id, occurrenceId, (occurrence) => ({
			...occurrence,
			path: placement.path,
			from: placement.from,
			to: placement.to,
			originalText: placement.originalText,
			before: placement.before,
			after: placement.after,
		}));
	}

	/** Takes one occurrence out; the thread stands even when it was the last. */
	async deleteOccurrence(
		project: ProjectRef,
		id: string,
		occurrenceId: string,
	): Promise<ForeshadowingDeletion> {
		let held = false;
		const wrote = await this.revise(project, id, (kept) => {
			if (!kept.occurrences.some((occurrence) => occurrence.id === occurrenceId)) {
				return null;
			}
			held = true;
			return {
				...kept,
				updatedAt: this.now(),
				occurrences: kept.occurrences.filter(
					(occurrence) => occurrence.id !== occurrenceId,
				),
			};
		});
		if (wrote === "refused") return "refused";
		return wrote === "written" && held ? "deleted" : "absent";
	}

	/**
	 * Brings one note's stored places level with its saved body. Nothing is
	 * written when nothing moved, which is the common case of every save
	 * that changed only text far from any occurrence.
	 */
	async refreshAnchorsOnSave(
		project: ProjectRef,
		path: string,
		savedBody: string,
	): Promise<boolean> {
		const standing = await this.store.readForeshadowings(project);
		if (!standing.some((item) => this.holdsNote(item, path))) return false;
		return this.store.updateForeshadowings(project, (items) => {
			const { next, changed } = refreshOccurrenceAnchors(savedBody, path, items);
			return changed ? next : null;
		});
	}

	/**
	 * Carries occurrences along with a renamed note or folder. Offsets and
	 * contexts are untouched: the text did not move, only its address did.
	 */
	async renameNotePaths(
		project: ProjectRef,
		oldPath: string,
		newPath: string,
	): Promise<boolean> {
		// The rule the root setting moves by, so a rename carries the threads
		// and the setting the same way.
		const carried = (path: string): string | null =>
			movedWithRename(path, oldPath, newPath);
		const moves = (occurrence: ForeshadowingOccurrence): boolean =>
			carried(occurrence.path) !== null;
		const touched = (items: readonly Foreshadowing[]): boolean =>
			items.some((item) => item.occurrences.some(moves));
		const standing = await this.store.readForeshadowings(project);
		if (!touched(standing)) return false;
		return this.store.updateForeshadowings(project, (items) => {
			// Asked again over the file as it is: a folder rename arrives as
			// one event per note inside it, and every one of them read the
			// same memo before the first had written. Only the one that finds
			// something still to move writes.
			if (!touched(items)) return null;
			return items.map((item) =>
				item.occurrences.some(moves)
					? {
							...item,
							occurrences: item.occurrences.map((occurrence) => {
								const moved = carried(occurrence.path);
								return moved === null
									? occurrence
									: { ...occurrence, path: moved };
							}),
						}
					: item,
			);
		});
	}

	/**
	 * Carries occurrences after text that moved from one note into another,
	 * which a split and a merge both do. Which occurrences travel is decided
	 * against `body` -- the departing note as it stood at the moment of the
	 * move -- and never against the offsets on file, for the reason the
	 * revision carry gives at length: the store is a memory of the last
	 * levelling, and an author who typed a paragraph and split below it has
	 * a store still describing the note as it was two paragraphs ago.
	 *
	 * An occurrence moves as one piece, never as two ends: its width is the
	 * length of the text it remembers, and the store's own reader drops an
	 * entry whose offsets stop saying so.
	 */
	async carryTextBetweenNotes(
		project: ProjectRef,
		from: string,
		into: string,
		body: string,
		at: number,
		shift: number,
	): Promise<boolean> {
		const goes = (occurrence: ForeshadowingOccurrence): boolean =>
			occurrence.path === from &&
			passageTravels(body, occurrenceSpot(occurrence), at);
		const touched = (items: readonly Foreshadowing[]): boolean =>
			items.some((item) => item.occurrences.some(goes));
		const standing = await this.store.readForeshadowings(project);
		if (!touched(standing)) return false;
		return this.store.updateForeshadowings(project, (items) => {
			if (!touched(items)) return null;
			return items.map((item) =>
				item.occurrences.some(goes)
					? {
							...item,
							occurrences: item.occurrences.map((occurrence) => {
								if (!goes(occurrence)) return occurrence;
								const start = Math.max(
									0,
									passageStandsAt(body, occurrenceSpot(occurrence)) - shift,
								);
								return {
									...occurrence,
									path: into,
									from: start,
									to: start + (occurrence.to - occurrence.from),
								};
							}),
						}
					: item,
			);
		});
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}

	private holdsNote(item: Foreshadowing, path: string): boolean {
		return item.occurrences.some((occurrence) => occurrence.path === path);
	}

	/**
	 * One thread changed in one write. `change` answers the thread as it
	 * should now stand, or null when it already does; the three-way answer
	 * tells a thread that is gone from a write the store refused, because a
	 * form that has already closed over the author's edit is owed the
	 * difference.
	 */
	private async revise(
		project: ProjectRef,
		id: string,
		change: (kept: Foreshadowing) => Foreshadowing | null,
	): Promise<ForeshadowingWrite> {
		let asked = false;
		let found = false;
		await this.store.updateForeshadowings(project, (items) => {
			asked = true;
			const kept = items.find((item) => item.id === id);
			if (kept === undefined) return null;
			found = true;
			const next = change(kept);
			if (next === null) return null;
			return items.map((item) => (item.id === id ? next : item));
		});
		if (!asked) return "refused";
		return found ? "written" : "absent";
	}

	/** One occurrence of one thread changed in one write; absent when either is gone. */
	private async reviseOccurrence(
		project: ProjectRef,
		id: string,
		occurrenceId: string,
		change: (
			occurrence: ForeshadowingOccurrence,
		) => ForeshadowingOccurrence | null,
	): Promise<ForeshadowingWrite> {
		let held = false;
		const wrote = await this.revise(project, id, (kept) => {
			const occurrence = kept.occurrences.find(
				(candidate) => candidate.id === occurrenceId,
			);
			if (occurrence === undefined) return null;
			held = true;
			const next = change(occurrence);
			if (next === null) return null;
			return {
				...kept,
				updatedAt: this.now(),
				occurrences: kept.occurrences.map((candidate) =>
					candidate.id === occurrenceId ? next : candidate,
				),
			};
		});
		return wrote === "written" && !held ? "absent" : wrote;
	}
}
