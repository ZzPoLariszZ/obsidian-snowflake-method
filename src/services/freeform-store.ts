import {
	MAIN_FREEFORM_VIEW_ID,
	freshFreeformDocument,
	readFreeformView,
	serializeFreeformView,
	type FreeformDocument,
	type FreeformView,
} from "../domain";
import type { VaultRepository } from "../repository";
import { createOrUpdatePlainFile, fileStamp } from "./json-store";
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
 *
 * One more file stands in the folder once the author has taken every view
 * away. A project with no view file reads as one fresh view, so a folder
 * emptied by the author would read as one never written in, and the view
 * they took away would stand again. The deletion that leaves the folder
 * without a view writes `freeform.json` beside where the views were, and the
 * project reads with no view from then on, as the timeline does once its
 * file says so. It holds the schema line and nothing else: the one thing the
 * view files cannot say is that there are none, and a list of views is still
 * kept nowhere.
 */

export const FREEFORM_STORE_SCHEMA_VERSION = 1;
export const FREEFORM_VIEW_ID_PREFIX = "freeform-view";
/** The folder's own file, written when a deletion leaves it without a view; see above. */
export const FREEFORM_FOLDER_FILE_NAME = "freeform.json";

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

/** Whether a folder's path is some project's freeform folder: the whole visualization chain has to end it. */
const isFreeformFolderPath = (folder: string): boolean =>
	FREEFORM_FOLDER_TAILS.some((tail) => folder.endsWith(tail));

/**
 * Whether a path is one of some project's freeform views: the whole
 * visualization chain has to end the folder and the name has to be a view's
 * own. It reads the path and nothing else; the caller has already checked
 * the path belongs to a project.
 */
export function isFreeformViewFilePath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return false;
	if (freeformViewIdOfFileName(path.slice(slash + 1)) === null) return false;
	return isFreeformFolderPath(path.slice(0, slash));
}

/**
 * Whether a path is one of some project's freeform files: a view's, or the
 * folder's own. Asked of every vault event and by the project digest, since
 * a change to either is the freeform's to hear of and no one else's.
 */
export function isFreeformFilePath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return false;
	const name = path.slice(slash + 1);
	if (name !== FREEFORM_FOLDER_FILE_NAME && freeformViewIdOfFileName(name) === null) return false;
	return isFreeformFolderPath(path.slice(0, slash));
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

	/** Where the folder's own file stands, written once the author has taken every view away. */
	folderFilePath(project: Pick<ProjectRef, "rootPath" | "locale">): string {
		return `${this.folderPath(project)}/${FREEFORM_FOLDER_FILE_NAME}`;
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
		let emptied = false;
		for (const file of this.repository.listDirectFiles(this.folderPath(project))) {
			const id = freeformViewIdOfFileName(file.name);
			if (id !== null) ids.push(id);
			else if (file.name === FREEFORM_FOLDER_FILE_NAME) emptied = true;
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
		// its language, which the first change to it writes. Not so once the
		// author has taken every view away: the folder's own file says so, and
		// the project reads with none.
		if (views.length === 0 && !emptied) return this.freshDocument(project);
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
	 * handed out only while the folder holds no view file and has not been
	 * emptied, as the read decides it. Once any view is written, a Main that
	 * is not there has gone, and a change meant for it finds nothing, as one
	 * meant for any other view does; so too once the author has taken the
	 * last view away.
	 */
	private freshView(project: ProjectRef): FreeformView | null {
		return this.untouched(project) ? (this.freshDocument(project).views[0] ?? null) : null;
	}

	/** Whether the folder holds no view file and has not been emptied: a project that reads as fresh. */
	private untouched(project: ProjectRef): boolean {
		return !this.repository.listDirectFiles(this.folderPath(project)).some(
			(file) => file.name === FREEFORM_FOLDER_FILE_NAME || freeformViewIdOfFileName(file.name) !== null,
		);
	}

	/** Whether the folder holds a view's file other than the one named. */
	private holdsViewBeside(project: ProjectRef, viewId: string): boolean {
		return this.repository.listDirectFiles(this.folderPath(project)).some((file) => {
			const id = freeformViewIdOfFileName(file.name);
			return id !== null && id !== viewId;
		});
	}

	/**
	 * Takes a view's file to the trash, where the author can still find it. A
	 * file this build cannot read is refused rather than thrown away unread:
	 * it is a newer build's view, and this one does not know what it holds.
	 * The view a project starts with has no file to take while it is fresh;
	 * taking it away is a deletion all the same, written as the folder's own
	 * file, or the project would read the view again. The last view taken
	 * away writes the same, for the same reason.
	 */
	async trashView(
		project: ProjectRef,
		viewId: string,
	): Promise<"deleted" | "absent" | "refused"> {
		const path = this.viewPath(project, viewId);
		if (this.repository.getFile(path) === null) {
			if (viewId !== MAIN_FREEFORM_VIEW_ID || !this.untouched(project)) return "absent";
			await this.markEmptied(project);
			return "deleted";
		}
		const view = await this.readView(project, viewId);
		if (view === null) {
			return this.repository.getFile(path) === null ? "absent" : "refused";
		}
		// Judged before the file goes, so nothing waits on the vault to notice it has.
		const last = !this.holdsViewBeside(project, viewId);
		await this.repository.trashFile(path);
		// Its keeper goes with it: a view's id is never used again.
		this.stores.delete(viewId);
		if (last) await this.markEmptied(project);
		return "deleted";
	}

	/** Writes the folder's own file, once: the folder stands emptied, and reads with no view from here on. */
	private async markEmptied(project: ProjectRef): Promise<void> {
		const path = this.folderFilePath(project);
		if (this.repository.getFile(path) !== null) return;
		await createOrUpdatePlainFile(
			this.repository,
			path,
			`${JSON.stringify({ schemaVersion: FREEFORM_STORE_SCHEMA_VERSION }, null, "\t")}\n`,
		);
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
