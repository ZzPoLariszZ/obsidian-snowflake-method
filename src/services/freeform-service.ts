import {
	FREEFORM_LIMITS,
	applyFreeformSteps,
	leaveFreeformView,
	newFreeformView,
	readFreeformViewport,
	renameFreeformFilePaths,
	renameFreeformView,
	type FreeformCame,
	type FreeformDocument,
	type FreeformLabels,
	type FreeformLimits,
	type FreeformStep,
	type FreeformTransaction,
	type FreeformView,
	type FreeformViewport,
} from "../domain";
import { movedWithRename } from "../project-root";
import type { VaultRepository } from "../repository";
import { FREEFORM_VIEW_ID_PREFIX, FreeformStore } from "./freeform-store";
import type { ProjectRef } from "./types";

/**
 * What a write came to: the view now says what was asked, what it names is
 * not there, the view has no room for it, or the write was refused.
 */
export type FreeformWrite = FreeformCame;
/** What a write that adds nothing came to: a name, or where a leaf stood, which no view is ever too full for. */
export type FreeformViewWrite = Exclude<FreeformWrite, "full">;
/** What a deletion came to. */
export type FreeformDeletion = "deleted" | "absent" | "refused";

/** The prefixes the ids minted here wear, one per kind of thing. */
export type FreeformIdPrefix =
	| typeof FREEFORM_VIEW_ID_PREFIX
	| "freeform-placement"
	| "freeform-frame"
	| "freeform-edge";

/** What a change to a view came to, and the steps that take it back. */
export interface FreeformTransacted {
	came: FreeformWrite;
	/** None where the change was not made, or found the view already as asked. */
	inverse: readonly FreeformStep[];
}

/**
 * The freeform views of one project, as the workspace asks about them. A
 * change to what stands on a view is a list of steps worked out against the
 * file as it is when the write runs, not as the workspace last painted it,
 * and lands as one write whatever it holds: a drag of forty nodes, a paste,
 * a frame made round a selection. A change that would change nothing writes
 * nothing, and answers as written all the same, since the file says what was
 * asked.
 */
export class FreeformService {
	private readonly store: FreeformStore;
	private readonly now: () => number;
	private readonly mintId: (prefix: FreeformIdPrefix) => string;
	private readonly held: Readonly<FreeformLimits>;

	constructor(
		repository: VaultRepository,
		deps: {
			now: () => number;
			mintId: (prefix: FreeformIdPrefix) => string;
			limits?: Readonly<FreeformLimits>;
			onCorrupt?: (path: string) => void;
			onForeign?: (path: string, version: number) => void;
		},
	) {
		this.now = deps.now;
		this.mintId = deps.mintId;
		this.held = deps.limits ?? FREEFORM_LIMITS;
		this.store = new FreeformStore({
			repository,
			now: deps.now,
			...(deps.onCorrupt === undefined ? {} : { onCorrupt: deps.onCorrupt }),
			...(deps.onForeign === undefined ? {} : { onForeign: deps.onForeign }),
		});
	}

	folderPath(project: Pick<ProjectRef, "rootPath" | "locale">): string {
		return this.store.folderPath(project);
	}

	viewPath(project: Pick<ProjectRef, "rootPath" | "locale">, viewId: string): string {
		return this.store.viewPath(project, viewId);
	}

	read(project: ProjectRef): Promise<FreeformDocument> {
		return this.store.readDocument(project);
	}

	/** How much a view may hold, which the workspace says before it is reached. */
	limits(): Readonly<FreeformLimits> {
		return this.held;
	}

	/** A fresh id for something about to be placed, so the canvas shows it under the id the file will keep. */
	mint(kind: "placement" | "frame" | "edge"): string {
		return this.mintId(`freeform-${kind}`);
	}

	/** A new view with nothing on it; its id, or null where the store refused. */
	async createView(project: ProjectRef, draft: { name: string }): Promise<string | null> {
		const id = this.mintId(FREEFORM_VIEW_ID_PREFIX);
		const wrote = await this.store.updateView(project, id, (held) =>
			held === null ? newFreeformView({ id, name: draft.name, now: this.now() }) : null,
		);
		return wrote ? id : null;
	}

	renameView(project: ProjectRef, viewId: string, name: string): Promise<FreeformViewWrite> {
		return this.revise(project, viewId, (held) => renameFreeformView(held, name, this.now()));
	}

	/** Takes a view out with everything on it; what its placements show is no part of it, and stands. */
	deleteView(project: ProjectRef, viewId: string): Promise<FreeformDeletion> {
		return this.store.trashView(project, viewId);
	}

	/**
	 * What a leaf leaves behind as it goes from a view: where it stood
	 * looking, and what its resources are called now. The one write a view
	 * takes that changes nothing on it.
	 */
	leaveView(
		project: ProjectRef,
		viewId: string,
		left: { viewport?: FreeformViewport; labels?: FreeformLabels },
	): Promise<FreeformViewWrite> {
		// No change, so the view a project starts with is not written for it.
		return this.revise(project, viewId, (held) => leaveFreeformView(held, left), false);
	}

	/**
	 * Every change to what stands on a view: one write, worked out against
	 * the file as it is, all of it or none. Where the leaf stands looking
	 * rides along with a change that landed, and is never written for itself
	 * here: a pan is not a change.
	 */
	async transact(
		project: ProjectRef,
		viewId: string,
		steps: readonly FreeformStep[],
		viewport: FreeformViewport | null = null,
	): Promise<FreeformTransacted> {
		let asked = false;
		let taken: FreeformTransaction | null = null;
		await this.store.updateView(project, viewId, (held) => {
			asked = true;
			taken = null;
			if (held === null) return null;
			const outcome = applyFreeformSteps(held, steps, this.now(), this.held);
			taken = outcome;
			if (outcome.came !== "written" || !outcome.changed) return null;
			return viewport === null
				? outcome.view
				: { ...outcome.view, viewport: readFreeformViewport(viewport) };
		});
		if (!asked) return { came: "refused", inverse: [] };
		const outcome = taken as FreeformTransaction | null;
		if (outcome === null) return { came: "absent", inverse: [] };
		return { came: outcome.came, inverse: outcome.inverse };
	}

	/**
	 * Carries the files the views place along with a renamed note or folder.
	 * A path is kept from the project's root, so a rename of the project
	 * itself, or of anything above it, moves nothing here. A file carried out
	 * of the project keeps the path it had and reads as missing: a view names
	 * what stands in its project, and nothing beyond it.
	 */
	async renameFilePaths(
		project: ProjectRef,
		oldPath: string,
		newPath: string,
	): Promise<boolean> {
		const root = `${project.rootPath}/`;
		if (!oldPath.startsWith(root)) return false;
		const carried = (path: string): string | null => {
			const moved = movedWithRename(`${root}${path}`, oldPath, newPath);
			if (moved === null || !moved.startsWith(root)) return null;
			return moved.slice(root.length);
		};
		let carriedAny = false;
		for (const view of (await this.store.readDocument(project)).views) {
			if (renameFreeformFilePaths(view, carried) === null) continue;
			// Asked again over the file as it is: a folder rename arrives as one
			// event per note inside it, and every one of them read the same memo
			// before the first had written. Only the one that finds something
			// still to move writes.
			const wrote = await this.store.updateView(project, view.id, (held) =>
				held === null ? null : renameFreeformFilePaths(held, carried),
			);
			if (wrote) carriedAny = true;
		}
		return carriedAny;
	}

	/** Lets a project's memos go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}

	/**
	 * One change to a view worked out against its file as it is: refused
	 * where the store would not take a write, absent where the view is not
	 * there, written otherwise -- also where nothing needed changing, since
	 * the file then already says what was asked.
	 */
	private async revise(
		project: ProjectRef,
		viewId: string,
		change: (held: FreeformView) => FreeformView | null,
		fresh = true,
	): Promise<FreeformViewWrite> {
		let asked = false;
		let present = false;
		await this.store.updateView(project, viewId, (held) => {
			asked = true;
			present = false;
			if (held === null) return null;
			present = true;
			return change(held);
		}, fresh);
		if (!asked) return "refused";
		return present ? "written" : "absent";
	}
}
