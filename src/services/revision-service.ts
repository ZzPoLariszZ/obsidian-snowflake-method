import {
	anchorRevision,
	refreshAnchors,
	revisionKindFor,
	type Revision,
} from "../domain";
import { movedWithRename } from "../project-root";
import type { VaultRepository } from "../repository";
import { RevisionStore } from "./revision-store";
import type { ProjectRef } from "./types";

/**
 * The revisions of one project, as the hosts ask about them: a list to read,
 * mutations that land in the file at once -- a revision is a decision the
 * author wrote down, so nothing here waits on a quiet timer -- and a save-time
 * pass that brings stored offsets level with the note that moved under them.
 * Standing (anchored, moved, conflict) is never kept here; every reader
 * derives it against the body in hand.
 */
export class RevisionService {
	private readonly store: RevisionStore;

	constructor(
		repository: VaultRepository,
		deps: {
			now: () => number;
			onCorrupt?: (path: string) => void;
			onForeign?: (path: string, version: number) => void;
		},
	) {
		this.store = new RevisionStore({
			repository,
			now: deps.now,
			...(deps.onCorrupt === undefined ? {} : { onCorrupt: deps.onCorrupt }),
			...(deps.onForeign === undefined ? {} : { onForeign: deps.onForeign }),
		});
	}

	list(project: ProjectRef): Promise<readonly Revision[]> {
		return this.store.readRevisions(project);
	}

	/** Appends one revision; false when its id already stands. */
	create(project: ProjectRef, revision: Revision): Promise<boolean> {
		return this.store.updateRevisions(project, (revisions) => {
			if (revisions.some((kept) => kept.id === revision.id)) return null;
			return [...revisions, revision];
		});
	}

	/**
	 * Rewrites one revision's proposed text and comment; false when gone.
	 * The kind follows the proposal the way `revisionKindFor` says, the same
	 * rule the draft was saved by.
	 */
	async update(
		project: ProjectRef,
		id: string,
		patch: { proposed: string; comment: string },
	): Promise<boolean> {
		// Answered on whether the record now says what was asked, not on
		// whether a write was needed to make it say so: the card in the margin
		// closes on this, and re-typing a proposal into the same words is a
		// finished edit rather than a refused one.
		let stood = false;
		await this.store.updateRevisions(project, (revisions) => {
			const kept = revisions.find((revision) => revision.id === id);
			if (kept === undefined) return null;
			stood = true;
			if (
				kept.proposed === patch.proposed &&
				kept.comment === patch.comment.trim()
			) {
				return null;
			}
			return revisions.map((revision) =>
				revision.id === id
					? {
							...revision,
							kind: revisionKindFor(revision.kind, patch.proposed),
							proposed: patch.proposed,
							// Trimmed as it is at creation, so a comment of spaces
							// is no comment on either path.
							comment: patch.comment.trim(),
						}
					: revision,
			);
		});
		return stood;
	}

	/**
	 * Takes one revision out -- an accept, a reject, or a discard alike --
	 * and says which of three things happened. A record already gone and a
	 * write the store refused both end with nothing written, but they are not
	 * the same news: the first is what was asked for, the second leaves the
	 * record standing, and a caller that has already applied the proposal to
	 * the author's text is owed the difference.
	 */
	async remove(
		project: ProjectRef,
		id: string,
	): Promise<'removed' | 'absent' | 'refused'> {
		// The store calls the mutate only over a file it will write; a
		// refused file never reaches it.
		let asked = false;
		let found = false;
		await this.store.updateRevisions(project, (revisions) => {
			asked = true;
			const next = revisions.filter((revision) => revision.id !== id);
			found = next.length !== revisions.length;
			return found ? next : null;
		});
		if (!asked) return 'refused';
		return found ? 'removed' : 'absent';
	}

	/**
	 * Brings one note's stored offsets and contexts level with its saved
	 * body. Nothing is written when nothing moved, which is the common case
	 * of every save that changed only text far from any revision.
	 */
	async refreshAnchorsOnSave(
		project: ProjectRef,
		path: string,
		savedBody: string,
	): Promise<boolean> {
		const standing = await this.store.readRevisions(project);
		if (!standing.some((revision) => revision.path === path)) return false;
		return this.store.updateRevisions(project, (revisions) => {
			const mine = revisions.filter((revision) => revision.path === path);
			const { next, changed } = refreshAnchors(savedBody, mine);
			if (!changed) return null;
			const byId = new Map(next.map((revision) => [revision.id, revision]));
			return revisions.map(
				(revision) => byId.get(revision.id) ?? revision,
			);
		});
	}

	/**
	 * Carries revisions along with a renamed note or folder. Offsets and
	 * contexts are untouched: the text did not move, only its address did.
	 */
	async renameNotePaths(
		project: ProjectRef,
		oldPath: string,
		newPath: string,
	): Promise<boolean> {
		// The rule the root setting moves by, so a rename carries the
		// revisions and the setting the same way.
		const carried = (path: string): string | null =>
			movedWithRename(path, oldPath, newPath);
		const standing = await this.store.readRevisions(project);
		if (!standing.some((revision) => carried(revision.path) !== null)) {
			return false;
		}
		return this.store.updateRevisions(project, (revisions) => {
			// Asked again over the file as it is: a folder rename arrives as
			// one event per note inside it, and every one of them read the
			// same memo before the first had written. Only the one that finds
			// something still to move writes.
			if (!revisions.some((revision) => carried(revision.path) !== null)) {
				return null;
			}
			return revisions.map((revision) => {
				const moved = carried(revision.path);
				return moved === null ? revision : { ...revision, path: moved };
			});
		});
	}

	/**
	 * Carries revisions after text that moved from one note into another,
	 * which a split and a merge both do.
	 *
	 * Which revisions travel is decided against `body` -- the departing note
	 * as it stood at the moment of the move -- and never against the offsets
	 * on file. Those offsets are a memory of the last levelling, and the
	 * levelling is a quiet errand behind each save: an author who types a
	 * paragraph and splits below it has a store still describing the note as
	 * it was two paragraphs ago. Sorted by that memory, a proposal whose words
	 * went into the new note is left behind on the old one, pointing at
	 * whatever now stands where it used to be -- which is the one outcome
	 * this whole hook exists to prevent.
	 *
	 * So each revision is put back on the departing body first, and it is the
	 * place its own words hold THERE that decides. Everything after `at`
	 * follows them, offsets moved by `shift`, and so does a range beginning
	 * at `at` itself; a point standing at `at` stays with the text behind it.
	 * A range that STRADDLES the departure point stays where it is: its text
	 * was torn in two, and a conflict is the honest answer rather than half a
	 * proposal carried to a note that holds half its words. A revision whose words are already gone
	 * from the departing body has nothing better than its stored offsets to be
	 * placed by, and is carried on those, since being on the surviving note is
	 * still nearer the truth than being on one that is about to be trashed.
	 *
	 * The offsets this lands on are exact wherever the words were found, and
	 * whoever writes the bodies levels the contexts afterwards.
	 */
	async carryTextBetweenNotes(
		project: ProjectRef,
		from: string,
		into: string,
		body: string,
		at: number,
		shift: number,
	): Promise<boolean> {
		// Where each revision's own words stand in the note being left, which
		// is the only reading of it that can be trusted here.
		const standsAt = (revision: Revision): number => {
			const anchor = anchorRevision(body, revision);
			return anchor.state === 'conflict' ? revision.from : anchor.from;
		};
		// A range beginning at the cut travels: its words are the new note's
		// first. A point standing exactly there does not, unless nothing
		// stands behind it: a point holds to the text behind it, and that text
		// stays where it is, while the words ahead of it lose the seam's blank
		// lines on the way and could no longer speak for it there.
		const goes = (revision: Revision): boolean => {
			if (revision.path !== from) return false;
			const stands = standsAt(revision);
			if (stands !== at) return stands > at;
			return revision.kind !== 'insert' || revision.before.length === 0;
		};
		const standing = await this.store.readRevisions(project);
		if (!standing.some(goes)) return false;
		return this.store.updateRevisions(project, (revisions) => {
			if (!revisions.some(goes)) return null;
			return revisions.map((revision) => {
				if (!goes(revision)) return revision;
				// Moved as one piece, never as two ends. A revision's width is
				// the length of the text it remembers, and the store's own
				// reader drops an entry whose offsets stop saying so -- which
				// clamping each end on its own would do to anything landing
				// at the head of the note it arrives in.
				const start = Math.max(0, standsAt(revision) - shift);
				return {
					...revision,
					path: into,
					from: start,
					to: start + (revision.to - revision.from),
				};
			});
		});
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}
}
