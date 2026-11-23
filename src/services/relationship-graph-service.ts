import {
	forgetSceneManuscriptOptions,
	patchEntityGraphState,
	rememberSceneManuscriptOptions,
	sameEntityGraphState,
	type EntityGraphState,
	type GraphMember,
	type GraphTime,
	type NativeGraphOptions,
	type RelationshipGraphDocument,
	type ResolveGraphTarget,
} from "../domain";
import type { VaultRepository } from "../repository";
import { parseTerm } from "../templates";
import { RelationshipGraphStore } from "./relationship-graph-store";
import type { ProjectRef, ProjectSnapshot } from "./types";

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

	/**
	 * The entity view's state, one or more parts at a time. A patch may be
	 * worked out from the state instead of handed in whole: it is then given
	 * the state as the file has it when the write runs, for a change that
	 * leaves some settings of a part as they stand and cannot see the
	 * controls that may be moving them.
	 */
	updateEntities(
		project: ProjectRef,
		patch: Partial<EntityGraphState> | ((held: EntityGraphState) => Partial<EntityGraphState>),
	): Promise<RelationshipGraphWrite> {
		return this.revise(project, (held) => {
			const entities = patchEntityGraphState(
				held.entities,
				typeof patch === 'function' ? patch(held.entities) : patch,
			);
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

/**
 * A project's members as the entity graph reads them: every character,
 * scene and worldbuilding note with its relationship lines, kinds in the
 * project's order so the default colours fall the same way each time.
 */
export function graphMembersOf(project: ProjectSnapshot): GraphMember[] {
	return [
		...project.characters.map(
			(character): GraphMember => ({
				id: character.id,
				group: 'character',
				kind: 'character',
				name: character.name,
				aliases: character.aliases,
				path: character.path,
				relationships: character.relationships,
			}),
		),
		...project.scenes.map(
			(scene): GraphMember => ({
				id: scene.id,
				group: 'scene',
				kind: 'scene',
				name: scene.title,
				aliases: scene.aliases,
				path: scene.path,
				relationships: scene.relationships,
			}),
		),
		...project.worldbuildingKinds.flatMap((kind) =>
			(project.worldbuilding[kind.id] ?? []).map(
				(entity): GraphMember => ({
					id: entity.id,
					group: 'worldbuilding',
					kind: entity.kind,
					name: entity.name,
					aliases: entity.aliases,
					path: entity.path,
					relationships: entity.relationships,
				}),
			),
		),
	];
}

/**
 * A project's time notes as the graph's timeline reads them, in the order
 * the notes keep, which is the Time table's. A period's two ends are stored
 * as the links the form wrote; each is resolved here to the time note it
 * leads to, and an end in plain words, or one whose note has gone, is no
 * end the axis can place.
 */
export function graphTimesOf(
	project: ProjectSnapshot,
	resolve: ResolveGraphTarget,
): GraphTime[] {
	const times = project.worldbuilding.time ?? [];
	const byPath = new Map(times.map((time) => [time.path, time.id]));
	const endOf = (stored: string, sourcePath: string): string | null => {
		const term = parseTerm(stored);
		if (term.kind !== "link") return null;
		const path = resolve(term.path, sourcePath);
		return path === null ? null : (byPath.get(path) ?? null);
	};
	return times.map((time): GraphTime => {
		const period = time.timeKind === "period";
		return {
			id: time.id,
			name: time.name,
			path: time.path,
			kind: period ? "period" : "point",
			start: period ? endOf(time.timeStart, time.path) : null,
			end: period ? endOf(time.timeEnd, time.path) : null,
		};
	});
}
