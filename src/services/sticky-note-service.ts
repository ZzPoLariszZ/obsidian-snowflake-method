import {
	DEFAULT_STICKY_NOTE_COLOR,
	FRONTMATTER_KEYS,
	STICKY_NOTE_FRONTMATTER_ORDER,
	fingerprint,
	formatStickyNoteCreated,
	readStickyNoteFrontmatter,
	stickyNoteFileStem,
	stickyNoteFrontmatter,
	type StickyNote,
	type StickyNoteColor,
} from "../domain";
import {
	ManagedFileNotFoundError,
	type ManagedFileRecord,
	type VaultRepository,
} from "../repository";
import { fileStamp } from "./json-store";
import {
	PROJECT_PATH_LAYOUTS,
	getProjectPathLayout,
	type ProjectRef,
} from "./types";

/** A sticky note as read from its file, with what a writer needs to write it back. */
export interface StickyNoteRecord extends StickyNote {
	/** `fingerprint(content)`: what a save must still match to land. */
	revision: string;
	/** `${mtime}:${size}`: what a refresh compares before reading again. */
	stamp: string;
	/** The note declares a schema this build may not write. */
	readOnly: boolean;
}

/** The folder tails a sticky note's path ends in, one per project language. */
const STICKY_NOTE_FOLDER_TAILS = Object.values(PROJECT_PATH_LAYOUTS).map(
	(layout) => `/${layout.directories.stickyNotes}`,
);

/**
 * Whether a path is a note standing directly in some project's sticky-note
 * folder: the whole task-management chain has to end the folder, so a folder
 * of the same last name elsewhere is an ordinary note. Asked of every vault
 * event, so it reads the path and nothing else; the caller has already
 * checked the path belongs to a project.
 */
export function isStickyNotePath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return false;
	const folder = path.slice(0, slash);
	return STICKY_NOTE_FOLDER_TAILS.some((tail) => folder.endsWith(tail));
}

/**
 * The sticky notes of one project: each a Markdown file the repository reads
 * and writes like any managed note, with the frontmatter this service knows
 * how to read leniently and write in order. Nothing is cached here beyond
 * what the repository keeps: a listing of unchanged files costs no reads.
 */
export class StickyNoteService {
	constructor(
		private readonly repository: VaultRepository,
		private readonly deps: { mintId: () => string },
	) {}

	folderOf(project: Pick<ProjectRef, "rootPath" | "locale">): string {
		const layout = getProjectPathLayout(project.locale);
		return `${project.rootPath}/${layout.directories.stickyNotes}`;
	}

	/**
	 * Every sticky note in the folder, in path order; the callers sort. A
	 * file that is not a sticky note, or cannot be read as a managed note at
	 * all, is left out rather than allowed to spoil the listing.
	 */
	async list(project: ProjectRef): Promise<StickyNoteRecord[]> {
		const notes: StickyNoteRecord[] = [];
		for (const file of this.repository.listDirectFiles(this.folderOf(project))) {
			if (file.extension !== "md") continue;
			const record = await this.repository.tryReadManaged(file.path);
			if (record === null) continue;
			const note = toStickyNote(record);
			if (note !== null) notes.push(note);
		}
		return notes.sort((left, right) =>
			left.path.localeCompare(right.path, "en"),
		);
	}

	/** One note by path; null when the file is gone or is not a sticky note. */
	async read(path: string): Promise<StickyNoteRecord | null> {
		const record = await this.repository.tryReadManaged(path);
		return record === null ? null : toStickyNote(record);
	}

	/**
	 * Writes a new, empty note named for the moment of its making, in the
	 * device's own offset; a second note born in the same millisecond takes the
	 * repository's numbered name. The folder is made on the way when missing.
	 */
	async create(
		project: ProjectRef,
		color: StickyNoteColor = DEFAULT_STICKY_NOTE_COLOR,
		now: Date = new Date(),
		offsetMinutes: number = now.getTimezoneOffset(),
	): Promise<StickyNoteRecord> {
		const stem = stickyNoteFileStem(now, offsetMinutes);
		const created = await this.repository.createManagedFile({
			path: `${this.folderOf(project)}/${stem}.md`,
			template: { body: "", sections: [] },
			frontmatter: stickyNoteFrontmatter({
				projectId: project.id,
				id: this.deps.mintId(),
				color,
				created: formatStickyNoteCreated(now, offsetMinutes),
			}),
			uniqueOnConflict: true,
			userInput: false,
		});
		const note = await this.read(created.path);
		if (note === null) throw new ManagedFileNotFoundError(created.path);
		return note;
	}

	/**
	 * Puts text below the frontmatter and answers with the note as it now
	 * stands. A revision that no longer matches means the file moved under the
	 * writer, and the repository's `ConcurrentChangeError` says so untouched.
	 */
	async writeBody(
		path: string,
		body: string,
		expectedRevision: string,
	): Promise<StickyNoteRecord> {
		await this.repository.replaceBody(path, body, expectedRevision, {
			userInput: true,
		});
		const note = await this.read(path);
		if (note === null) throw new ManagedFileNotFoundError(path);
		return note;
	}

	setColor(path: string, color: StickyNoteColor): Promise<void> {
		return this.repository.updateFrontmatter(
			path,
			{ [FRONTMATTER_KEYS.stickyNoteColor]: color },
			STICKY_NOTE_FRONTMATTER_ORDER,
		);
	}

	/** Sets a note aside or brings it back; the key is written either way, never removed. */
	setArchived(path: string, archived: boolean): Promise<void> {
		return this.repository.updateFrontmatter(
			path,
			{ [FRONTMATTER_KEYS.archived]: archived },
			STICKY_NOTE_FRONTMATTER_ORDER,
		);
	}

	trash(path: string): Promise<void> {
		return this.repository.trashFile(path);
	}

	/** How the Vault last saw the file, without opening it; null when it is gone. */
	stamp(path: string): string | null {
		const file = this.repository.getFile(path);
		return file === null ? null : fileStamp(file);
	}
}

function toStickyNote(record: ManagedFileRecord): StickyNoteRecord | null {
	const fields = readStickyNoteFrontmatter(record.frontmatter, {
		createdAt: record.file.stat.ctime,
	});
	if (fields === null) return null;
	return {
		...fields,
		path: record.path,
		body: record.body,
		revision: fingerprint(record.content),
		stamp: fileStamp(record.file),
		readOnly: record.readOnly,
	};
}
