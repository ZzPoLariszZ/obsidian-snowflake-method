import {
	forgetSceneManuscriptOptions,
	patchEntityGraphState,
	rememberSceneManuscriptOptions,
	sameEntityGraphState,
	type EntityGraphState,
	type NativeGraphOptions,
	type RelationshipGraphDocument,
} from "../domain";
import type { VaultRepository } from "../repository";
import { RelationshipGraphStore } from "./relationship-graph-store";
import type { ProjectRef } from "./types";

/** What a write came to: the document now says what was asked, or why not. */
export type RelationshipGraphWrite = "written" | "absent" | "refused";

/**
 * The relationship graph's file for one project, as the workspace asks
 * about it: a document to read, and writes that land at once. Each write is
 * a pure change from `domain/relationship-graph-document.ts` worked out
 * against the file as it is when the write runs; a change that would change
 * nothing writes nothing, and answers as written all the same, since the
 * file says what was asked. Nothing here reads a note: the graph's lines
 * come from the project's members, and the file keeps only the view.
 */
export class RelationshipGraphService {
	private readonly store: RelationshipGraphStore;
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
		this.store = new RelationshipGraphStore({
			repository,
			now: deps.now,
			...(deps.onCorrupt === undefined ? {} : { onCorrupt: deps.onCorrupt }),
			...(deps.onForeign === undefined ? {} : { onForeign: deps.onForeign }),
		});
	}

	relationshipGraphPath(project: ProjectRef): string {
		return this.store.relationshipGraphPath(project);
	}

	read(project: ProjectRef): Promise<RelationshipGraphDocument> {
		return this.store.readDocument(project);
	}

	/** The native graph's options as the scenes-and-manuscript tab left them, for the project's root. */
	saveSceneManuscriptOptions(
		project: ProjectRef,
		options: NativeGraphOptions,
	): Promise<RelationshipGraphWrite> {
		return this.revise(project, (held) =>
			rememberSceneManuscriptOptions(held, options, project.rootPath, this.now()),
		);
	}

	/** The memory let go, so the next open starts from the project's preset. */
	clearSceneManuscriptOptions(project: ProjectRef): Promise<RelationshipGraphWrite> {
		return this.revise(project, forgetSceneManuscriptOptions);
	}

	/** The entity view's state, one or more parts at a time. */
	updateEntities(
		project: ProjectRef,
		patch: Partial<EntityGraphState>,
	): Promise<RelationshipGraphWrite> {
		return this.revise(project, (held) => {
			const entities = patchEntityGraphState(held.entities, patch);
			return sameEntityGraphState(entities, held.entities) ? null : { ...held, entities };
		});
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}

	/**
	 * One change against the file as it stands: refused where the store would
	 * not write (a foreign schema), written otherwise, a no-op included. There
	 * is nothing in this document that can be absent, so that answer is never
	 * given here; the type is shared with the other documents' bridges.
	 */
	private async revise(
		project: ProjectRef,
		change: (held: RelationshipGraphDocument) => RelationshipGraphDocument | null,
	): Promise<RelationshipGraphWrite> {
		let asked = false;
		await this.store.updateDocument(project, (held) => {
			asked = true;
			return change(held);
		});
		return asked ? "written" : "refused";
	}
}
