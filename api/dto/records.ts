import {
	anchorOccurrence,
	anchorRevision,
	fileStem,
	stickyNotePreview,
	taskOverdue,
	type Foreshadowing,
	type ForeshadowingOccurrence,
	type Revision,
	type RevisionAnchor,
	type Task,
} from '../../src/domain';
import type { ProjectRef, StickyNoteRecord } from '../../src/services';
import type { JsonObject } from '../json';
import { relativePathOf } from './manuscript';
import type { MemberIndex } from './member';

/**
 * The records an author keeps beside a project, as the API tells them: the
 * tasks, the foreshadowing threads, the proposed revisions and the sticky
 * notes.
 *
 * A thread's appearance and a revision are both a passage marked in a
 * manuscript note. The record keeps where the passage was when it was
 * marked, and the note goes on being written. So where it stands is never
 * told from the record: it is looked for in the note as the note is now,
 * each time it is asked about.
 */

/** The furthest moment either way that a date can name, in milliseconds. */
const FURTHEST_MOMENT = 8.64e15;

/**
 * A moment the plugin keeps as a count of milliseconds, told in RFC 3339.
 * Null where none was kept, or where a file edited by hand holds a number
 * that names no moment.
 */
export function instantOf(milliseconds: number): string | null {
	if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > FURTHEST_MOMENT) return null;
	return new Date(milliseconds).toISOString();
}

export function taskOf(index: MemberIndex, task: Task, today: string): JsonObject {
	return {
		id: task.id,
		title: task.title,
		description: task.description,
		status: task.status,
		priority: task.priority,
		dueDate: task.dueDate,
		related: task.related.map((stored) => index.refOfStored(stored)),
		archived: task.archived,
		overdue: taskOverdue(task, today),
		createdAt: instantOf(task.createdAt),
		updatedAt: instantOf(task.updatedAt),
	};
}

/**
 * The manuscript as far as marked passages need it: its notes in reading
 * order with what each says. Only the manuscript's own notes are read. A
 * record that still names some other note has nothing to be held against,
 * and its passage is told as lost.
 */
export class PassageNotes {
	private readonly titles = new Map<string, string>();
	private readonly bodies = new Map<string, string | null>();

	constructor(
		private readonly project: ProjectRef,
		notes: readonly { path: string; title: string }[],
	) {
		for (const note of notes) this.titles.set(note.path, note.title);
	}

	/** Whether a path is one of the manuscript's notes. */
	holds(path: string): boolean {
		return this.titles.has(path);
	}

	/** What a note says, once it has been read. Null stands for a note that could not be. */
	keep(path: string, body: string | null): void {
		if (this.titles.has(path)) this.bodies.set(path, body);
	}

	bodyOf = (path: string): string | null => this.bodies.get(path) ?? null;

	/**
	 * The order passages are read in: the manuscript's notes, then any
	 * other note a record still names, which the plugin's own tables list
	 * last too.
	 */
	order(named: readonly string[]): string[] {
		return [...this.titles.keys(), ...new Set(named.filter((path) => !this.titles.has(path)))];
	}

	refOf(path: string): JsonObject {
		const title = this.titles.get(path);
		return {
			path,
			relativePath: title === undefined ? null : relativePathOf(this.project, path),
			title: title ?? fileStem(path),
		};
	}
}

const LOST: RevisionAnchor = { state: 'conflict' };

/** Where a passage stands now, or where it last stood once it is lost. */
function rangeOf(anchor: RevisionAnchor, stored: { from: number; to: number }): JsonObject {
	return anchor.state === 'conflict' ? { from: stored.from, to: stored.to } : { from: anchor.from, to: anchor.to };
}

export function occurrenceOf(notes: PassageNotes, occurrence: ForeshadowingOccurrence): JsonObject {
	const body = notes.bodyOf(occurrence.path);
	const anchor = body === null ? LOST : anchorOccurrence(body, occurrence);
	return {
		id: occurrence.id,
		role: occurrence.role,
		// The record calls the author's remark a note, which here would be taken for the manuscript note beside it.
		comment: occurrence.note,
		note: notes.refOf(occurrence.path),
		range: rangeOf(anchor, occurrence),
		text: occurrence.originalText,
		context: { before: occurrence.before, after: occurrence.after },
		state: anchor.state,
	};
}

/** One thread. Its appearances are handed in already in reading order. */
export function foreshadowingOf(
	index: MemberIndex,
	notes: PassageNotes,
	item: Foreshadowing,
	occurrences: readonly ForeshadowingOccurrence[],
): JsonObject {
	return {
		id: item.id,
		name: item.name,
		description: item.description,
		status: item.status,
		related: item.related.map((stored) => index.refOfStored(stored)),
		createdAt: instantOf(item.createdAt),
		updatedAt: instantOf(item.updatedAt),
		occurrences: occurrences.map((occurrence) => occurrenceOf(notes, occurrence)),
	};
}

export function revisionOf(notes: PassageNotes, revision: Revision): JsonObject {
	const body = notes.bodyOf(revision.path);
	const anchor = body === null ? LOST : anchorRevision(body, revision);
	return {
		id: revision.id,
		note: notes.refOf(revision.path),
		kind: revision.kind,
		range: rangeOf(anchor, revision),
		originalText: revision.originalText,
		proposed: revision.proposed,
		comment: revision.comment,
		context: { before: revision.before, after: revision.after },
		createdAt: instantOf(revision.createdAt),
		state: anchor.state,
	};
}

/** A sticky note. Everything it says is told only where one note was asked for. */
export function stickyNoteOf(note: StickyNoteRecord, full: boolean): JsonObject {
	const told: JsonObject = {
		id: note.id,
		path: note.path,
		color: note.color,
		createdAt: instantOf(note.createdAt),
		archived: note.archived,
		etag: note.revision,
		readOnly: note.readOnly,
		preview: stickyNotePreview(note.body),
	};
	if (full) told['body'] = note.body;
	return told;
}
