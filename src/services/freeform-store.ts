import {
	MAIN_FREEFORM_VIEW_ID,
	freshFreeformDocument,
	readFreeformView,
	serializeFreeformView,
	type FreeformDocument,
	type FreeformView,
} from "../domain";
import type { VaultRepository } from "../repository";
import { fileStamp } from "./json-store";
import {
	JsonDocumentStore,
	type JsonDocumentStoreDeps,
} from "./json-document-store";
import {
	PROJECT_PATH_LAYOUTS,
	getProjectPathLayout,
	type ProjectRef,
} from "./types";

/**
 * The freeform files: one for each view the author laid out, all in one
 * folder. The timeline and the beat sheet each keep a single file, and a
 * canvas cannot: it is written at the end of every drag, a file is written
 * whole, and twenty views in one file would have every drag in one of them
 * rewrite the other nineteen -- and have a device that moved one node on a
 * copy a day old put the other nineteen back as they stood that day. So a
 * view is a file, and exists exactly when its file does: making, naming and
 * deleting one are each a single file's affair, and no list of views is kept
 * anywhere that could fall out of step with the folder.
 *
 * Each file is kept by the document store (`json-document-store.ts`) as the
 * timeline's is, under a schema line of its own, so one that will not parse
 * is set aside and one a newer build wrote is left where it stands. A view is
 * read leniently: what this build can read of it is served, and an entry it
 * cannot is carried through every write as it came.
 */

export const FREEFORM_STORE_SCHEMA_VERSION = 1;
export const FREEFORM_VIEW_ID_PREFIX = "freeform-view";

/** The folder tails a view file's path ends in, one per project language. */
const FREEFORM_FOLDER_TAILS = Object.values(PROJECT_PATH_LAYOUTS).map(
	(layout) => `/${layout.directories.freeform}`,
);

const VIEW_FILE_NAME = /^(freeform-view-[A-Za-z0-9-]+)\.json$/u;

/**
 * The view a file's name says it holds, or null for a file that is no view:
 * a copy set aside as damaged wears a second dot and is an ordinary file, as
 * is anything else an author keeps in the folder.
 */
export function freeformViewIdOfFileName(name: string): string | null {
	return VIEW_FILE_NAME.exec(name)?.[1] ?? null;
}

/**
 * Whether a path is one of some project's freeform views: the whole
 * visualization chain has to end the folder and the name has to be a view's
 * own. Asked of every vault event, so it reads the path and nothing else;
 * the caller has already checked the path belongs to a project.
 */
export function isFreeformViewFilePath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return false;
	if (freeformViewIdOfFileName(path.slice(slash + 1)) === null) return false;
	const folder = path.slice(0, slash);
	return FREEFORM_FOLDER_TAILS.some((tail) => folder.endsWith(tail));
}

/** What one file reads as: its view, or none for a file that is missing, set aside or a newer build's. */
interface HeldView {
	view: FreeformView | null;
}

export class FreeformStore {
	/** One keeper per view's file, made when the view is first asked for; each keeps its memo by project. */
	private readonly stores = new Map<string, JsonDocumentStore<HeldView>>();
	/**
	 * The document last handed out, by project root, with the views it was
	 * made of. While every view read is the very object it was, the document
	 * is the very object too, which is what lets a workspace tell at a glance
	 * that nothing it draws has moved.
	 */
	private readonly documents = new Map<string, FreeformDocument>();
	/** What a project reads while it has no view of its own, one per project, so every read hands back the same object. */
	private readonly fresh = new Map<string, { locale: ProjectRef["locale"]; held: FreeformDocument }>();
	/** The newer schema met during the reading under way, told once when it ends. */
	private foreign: { version: number } | null = null;
	private reading = 0;

	constructor(private readonly deps: JsonDocumentStoreDeps) {}

	private get repository(): VaultRepository {
		return this.deps.repository;
	}

	folderPath(project: Pick<ProjectRef, "rootPath" | "locale">): string {
		const layout = getProjectPathLayout(project.locale);
		return `${project.rootPath}/${layout.directories.freeform}`;
	}

	viewPath(project: Pick<ProjectRef, "rootPath" | "locale">, viewId: string): string {
		return `${this.folderPath(project)}/${viewId}.json`;
	}

	private storeOf(viewId: string): JsonDocumentStore<HeldView> {
		let store = this.stores.get(viewId);
		if (store === undefined) {
			store = new JsonDocumentStore<HeldView>(
				{
					pathOf: (project) => this.viewPath(project, viewId),
					schemaVersion: FREEFORM_STORE_SCHEMA_VERSION,
					empty: () => ({ view: null }),
					readDocument: (file) => {
						const view = readFreeformView(file, viewId);
						return view === null ? null : { view };
					},
					// A keeper is never handed no view to write: `updateView` answers
					// null for one, and the store then writes nothing.
					writeDocument: (held) =>
						held.view === null ? {} : serializeFreeformView(held.view),
				},
				{
					repository: this.deps.repository,
					now: this.deps.now,
					...(this.deps.onCorrupt === undefined
						? {}
						: { onCorrupt: this.deps.onCorrupt }),
					onForeign: (path, version) => {
						// A folder read meets every newer file at once; they are told
						// together when it ends. A write meets one, and says so.
						if (this.reading > 0) {
							this.foreign = {
								version: Math.max(this.foreign?.version ?? 0, version),
							};
							return;
						}
						this.deps.onForeign?.(path, version);
					},
				},
			);
			this.stores.set(viewId, store);
		}
		return store;
	}

	/**
	 * Every view in the folder, in the order they were made. A file changed
	 * since it was last read is read again and the rest are answered from
	 * memory, so a drag in one view costs the others nothing.
	 */
	async readDocument(project: ProjectRef): Promise<FreeformDocument> {
		const ids: string[] = [];
		for (const file of this.repository.listDirectFiles(this.folderPath(project))) {
			const id = freeformViewIdOfFileName(file.name);
			if (id !== null) ids.push(id);
		}
		this.reading += 1;
		let views: FreeformView[];
		try {
			const held = await Promise.all(
				ids.map((id) => this.storeOf(id).read(project)),
			);
			views = held.flatMap((entry) => (entry.view === null ? [] : [entry.view]));
		} finally {
			this.reading -= 1;
		}
		if (this.reading === 0 && this.foreign !== null) {
			const { version } = this.foreign;
			this.foreign = null;
			this.deps.onForeign?.(this.folderPath(project), version);
		}
		views.sort(
			(left, right) =>
				left.createdAt - right.createdAt || left.id.localeCompare(right.id, "en"),
		);
		// No view of its own yet: the project reads as one fresh view, named in
		// its language, which the first change to it writes.
		if (views.length === 0) return this.freshDocument(project);
		const last = this.documents.get(project.rootPath);
		if (
			last !== undefined &&
			last.views.length === views.length &&
			last.views.every((view, index) => view === views[index])
		) {
			return last;
		}
		const document: FreeformDocument = { views };
		this.documents.set(project.rootPath, document);
		return document;
	}

	/** One view as its file holds it now; null where it has none, or none this build can read. */
	async readView(project: ProjectRef, viewId: string): Promise<FreeformView | null> {
		return (await this.storeOf(viewId).read(project)).view;
	}

	/**
	 * Read-modify-write of one view's file. `mutate` is handed the view, or
	 * null where the file is not there, and answers the view to write, or null
	 * for nothing to write: a view that has gone is never made again by a
	 * change that was meant for it. `fresh` lets a change meant for the view a
	 * project starts with find it before it is written; a leave, which is no
	 * change, is given false and finds nothing.
	 */
	updateView(
		project: ProjectRef,
		viewId: string,
		mutate: (held: FreeformView | null) => FreeformView | null,
		fresh = true,
	): Promise<boolean> {
		return this.storeOf(viewId).update(project, (held) => {
			// The fresh view a project starts with is handed to a change meant for it, and the change writes it.
			const standing = held.view ?? (fresh && viewId === MAIN_FREEFORM_VIEW_ID ? this.freshView(project) : null);
			const next = mutate(standing);
			return next === null ? null : { view: next };
		});
	}

	private freshDocument(project: ProjectRef): FreeformDocument {
		const kept = this.fresh.get(project.rootPath);
		if (kept !== undefined && kept.locale === project.locale) return kept.held;
		const held = freshFreeformDocument(project.locale);
		this.fresh.set(project.rootPath, { locale: project.locale, held });
		return held;
	}

	/**
	 * The fresh view a project starts with, as a change meant for it finds it:
	 * handed out only while the folder holds no view file at all, as the read
	 * decides it. Once any view is written, a Main that is not there has gone,
	 * and a change meant for it finds nothing, as one meant for any other view does.
	 */
	private freshView(project: ProjectRef): FreeformView | null {
		for (const file of this.repository.listDirectFiles(this.folderPath(project))) {
			if (freeformViewIdOfFileName(file.name) !== null) return null;
		}
		return this.freshDocument(project).views[0] ?? null;
	}

	/**
	 * Takes a view's file to the trash, where the author can still find it. A
	 * file this build cannot read is refused rather than thrown away unread:
	 * it is a newer build's view, and this one does not know what it holds.
	 * The view a project starts with is refused too while it is no file: there
	 * is nothing to take, and the project would read it again all the same.
	 */
	async trashView(
		project: ProjectRef,
		viewId: string,
	): Promise<"deleted" | "absent" | "refused"> {
		const path = this.viewPath(project, viewId);
		if (this.repository.getFile(path) === null) {
			return viewId === MAIN_FREEFORM_VIEW_ID && this.freshView(project) !== null ? "refused" : "absent";
		}
		const view = await this.readView(project, viewId);
		if (view === null) {
			return this.repository.getFile(path) === null ? "absent" : "refused";
		}
		await this.repository.trashFile(path);
		// Its keeper goes with it: a view's id is never used again.
		this.stores.delete(viewId);
		return "deleted";
	}

	/** How the vault last saw a view's file, without opening it; null when it is not there. */
	stamp(project: ProjectRef, viewId: string): string | null {
		const file = this.repository.getFile(this.viewPath(project, viewId));
		return file === null ? null : fileStamp(file);
	}

	/** Lets a project's memos go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		for (const store of this.stores.values()) store.evict(rootPath);
		this.documents.delete(rootPath);
	}
}
