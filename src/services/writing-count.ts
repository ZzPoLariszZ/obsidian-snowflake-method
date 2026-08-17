import {
	countWriting,
	countableProse,
	isDocumentType,
	managedSectionsForDocument,
	type CountableProseOptions,
	type CountableRange,
	type DocumentType,
	type WritingCount,
	type WritingCountOptions,
} from "../domain";
import { documentTypeOf, type VaultRepository } from "../repository";
import { inspectMarkedSection } from "../templates";
import type { ManuscriptService } from "./manuscript-service";
import type { ProjectRef } from "./types";

/**
 * What a count may later stand for. Everything here is countable -- the
 * number can be asked for at any time -- but only what is written into notes
 * is trackable: the writing whose growth future features (sessions, goals,
 * analytics) may follow. A dashboard field or a form input is counted with
 * `countWriting` directly and stays countable, because text that has not
 * reached a note is not yet part of the work.
 */
export type CountTracking = "countable" | "trackable";

/**
 * Everything counting a note asks for: the convention its numbers follow, and
 * what the Markdown around the writing is worth. Text that never was Markdown
 * -- a form field, a dashboard input -- needs only the first half.
 */
export type NoteCountOptions = WritingCountOptions & CountableProseOptions;

export type WritingCountScope = "project" | "manuscript";

/** A whole scope's writing, with how many notes it was read from. */
export interface ScopeWritingCount extends WritingCount {
	scope: WritingCountScope;
	notes: number;
}

/**
 * Counts the writing in notes: one note, a manuscript, a whole project.
 *
 * Counting reads the note the way the page shows it -- `countableProse`
 * strips what is syntax and keeps what is writing -- and a note that carries
 * managed sections has its plugin-written ones taken out first: a fields
 * block is a view of the properties, a record section is storage, and a
 * template body is scaffolding, none of them words the author wrote. The
 * marker lines around the sections that do count are HTML comments and
 * disappear on their own.
 *
 * Every result of this service is trackable in the sense above. Reads ride
 * the repository's stat-checked record cache and a stat-keyed memo of the
 * finished numbers, so recounting a project touches only the notes that
 * changed since the last time.
 */
export class WritingCountService {
	constructor(
		private readonly repository: VaultRepository,
		private readonly manuscript: ManuscriptService,
	) {}

	private readonly memo = new Map<
		string,
		{ stamp: string; count: WritingCount }
	>();

	/** One body's writing count, its plugin-written sections excluded. */
	countBody(
		body: string,
		documentType: DocumentType | null,
		options: NoteCountOptions,
	): WritingCount {
		const excluded: CountableRange[] = [];
		for (const descriptor of documentType === null
			? []
			: managedSectionsForDocument(documentType)) {
			if (descriptor.generated !== true && descriptor.protected !== true) {
				continue;
			}
			const inspection = inspectMarkedSection(body, descriptor.id);
			if (inspection.status !== "present") continue;
			excluded.push({
				from: inspection.contentStart,
				to: inspection.contentEnd,
			});
		}
		return countWriting(countableProse(body, excluded, options), options);
	}

	/** One note's writing count, or null when the note cannot be read. */
	async countNote(
		path: string,
		options: NoteCountOptions,
	): Promise<WritingCount | null> {
		const record = await this.repository.tryReadManaged(path);
		if (record === null) return null;
		// Every option belongs in the stamp: the same unchanged note counts
		// differently under each, and a memo that forgot which one it held
		// would answer the second convention with the first one's number.
		const stamp = `${record.file.stat.mtime}:${record.file.stat.size}:${options.mode}:${options.headings}`;
		const kept = this.memo.get(path);
		if (kept !== undefined && kept.stamp === stamp) return kept.count;
		const declared = documentTypeOf(record.frontmatter);
		const count = this.countBody(
			record.body,
			isDocumentType(declared) ? declared : null,
			options,
		);
		this.memo.set(path, { stamp, count });
		return count;
	}

	/**
	 * A whole scope's writing count: the manuscript alone, or every Markdown
	 * note under the project's folder -- managed or not, because a free note
	 * an author keeps inside the project is their writing too.
	 */
	async countProject(
		project: ProjectRef,
		scope: WritingCountScope,
		options: NoteCountOptions,
	): Promise<ScopeWritingCount> {
		const paths =
			scope === "manuscript"
				? (await this.manuscript.listSegments(project)).map(
						(segment) => segment.path,
					)
				: this.repository
						.listFilesBelow(project.rootPath)
						.filter((file) => file.extension === "md")
						.map((file) => file.path);
		const sum: ScopeWritingCount = {
			scope,
			notes: 0,
			cjkCharacters: 0,
			words: 0,
			punctuationMarks: 0,
			total: 0,
		};
		for (const path of paths) {
			const count = await this.countNote(path, options);
			if (count === null) continue;
			sum.notes += 1;
			sum.cjkCharacters += count.cjkCharacters;
			sum.words += count.words;
			sum.punctuationMarks += count.punctuationMarks;
			sum.total += count.total;
		}
		return sum;
	}
}
