import { refreshAnchors, type Revision } from "../domain";
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
		deps: { now: () => number; onCorrupt?: (path: string) => void },
	) {
		this.store = new RevisionStore({
			repository,
			now: deps.now,
			...(deps.onCorrupt === undefined ? {} : { onCorrupt: deps.onCorrupt }),
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
	 * The kind follows the proposal the same way it did at creation: a range
	 * revision left proposing nothing is a deletion, and one given words
	 * again is a replacement, so the two are the same revision seen at two
	 * moments rather than two things the author must choose between. An
	 * insertion has no text under it to fall back to and stays what it is.
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
			if (kept.proposed === patch.proposed && kept.comment === patch.comment) {
				return null;
			}
			return revisions.map((revision) =>
				revision.id === id
					? {
							...revision,
							kind:
								revision.kind === 'insert'
									? revision.kind
									: patch.proposed.length === 0
										? 'delete'
										: 'replace',
							proposed: patch.proposed,
							comment: patch.comment,
						}
					: revision,
			);
		});
		return stood;
	}

	/** Takes one revision out -- an accept, a reject, or a discard alike. */
	remove(project: ProjectRef, id: string): Promise<boolean> {
		return this.store.updateRevisions(project, (revisions) => {
			const next = revisions.filter((revision) => revision.id !== id);
			return next.length === revisions.length ? null : next;
		});
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
		const standing = await this.store.readRevisions(project);
		const folder = `${oldPath}/`;
		const carried = (path: string): string | null => {
			if (path === oldPath) return newPath;
			if (path.startsWith(folder)) {
				return `${newPath}/${path.slice(folder.length)}`;
			}
			return null;
		};
		if (!standing.some((revision) => carried(revision.path) !== null)) {
			return false;
		}
		return this.store.updateRevisions(project, (revisions) =>
			revisions.map((revision) => {
				const moved = carried(revision.path);
				return moved === null ? revision : { ...revision, path: moved };
			}),
		);
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}
}
