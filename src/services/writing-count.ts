import {
	PROTECTED_SECTION_IDS,
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
	/**
	 * Notes the scope holds that could not be read -- broken frontmatter,
	 * almost always. Their writing is missing from the numbers above, and a
	 * total that quietly shrank by a chapter is worse than one that says so.
	 */
	unreadable: number;
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

	/**
	 * Where a body's plugin-written sections sit: the generated views and the
	 * record storage, which the domain already names in one place. Every count
	 * here asks this rather than re-deciding what the plugin wrote, so the
	 * whole and the parts can never disagree about it.
	 */
	private pluginWritten(
		body: string,
		documentType: DocumentType | null,
	): CountableRange[] {
		const ranges: CountableRange[] = [];
		for (const descriptor of documentType === null
			? []
			: managedSectionsForDocument(documentType)) {
			if (!PROTECTED_SECTION_IDS.has(descriptor.id)) continue;
			const inspection = inspectMarkedSection(body, descriptor.id);
			if (inspection.status !== "present") continue;
			ranges.push({
				from: inspection.contentStart,
				to: inspection.contentEnd,
			});
		}
		return ranges;
	}

	/** One body's writing count, its plugin-written sections excluded. */
	countBody(
		body: string,
		documentType: DocumentType | null,
		options: NoteCountOptions,
	): WritingCount {
		return countWriting(
			countableProse(body, this.pluginWritten(body, documentType), options),
			options,
		);
	}

	/**
	 * One stretch of a body, counted as the part of its note that it is.
	 *
	 * Everything outside the stretch is excluded rather than sliced away, so
	 * every offset stays the note's own: a plugin-written block nested inside
	 * the stretch drops out exactly as it does from the note's total, and the
	 * note's title is still the note's, so a stretch holding an author's own
	 * level-1 heading counts it.
	 */
	countRange(
		body: string,
		documentType: DocumentType | null,
		range: CountableRange,
		options: NoteCountOptions,
	): WritingCount {
		return countWriting(
			countableProse(
				body,
				[
					...this.pluginWritten(body, documentType),
					{ from: 0, to: range.from },
					{ from: range.to, to: body.length },
				],
				options,
			),
			options,
		);
	}

	/**
	 * The marked section an offset sits in, counted on its own, or null when
	 * the offset is in none the count reads.
	 *
	 * A note's sections are where the writing for one step, one synopsis, one
	 * field goes, so while the caret is in one that is the piece being
	 * written. Sections the note's total leaves out never answer: a generated
	 * block is a view of the properties and a record section is storage, and
	 * neither is a number anybody is writing towards.
	 */
	countSectionAt(
		body: string,
		documentType: DocumentType,
		offset: number,
		options: NoteCountOptions,
	): WritingCount | null {
		for (const descriptor of managedSectionsForDocument(documentType)) {
			if (PROTECTED_SECTION_IDS.has(descriptor.id)) continue;
			const inspection = inspectMarkedSection(body, descriptor.id);
			if (inspection.status !== "present") continue;
			if (offset < inspection.contentStart || offset > inspection.contentEnd) {
				continue;
			}
			return this.countRange(
				body,
				documentType,
				{ from: inspection.contentStart, to: inspection.contentEnd },
				options,
			);
		}
		return null;
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
	 * Lets go of the counts held for a path the vault no longer has, and with
	 * `children`, for everything under a folder. Mirrors the repository's own
	 * `forget` and is called beside it: `mtime` and `size` both survive a
	 * rename, so a note moved out of a path and another moved in can stamp
	 * alike, and the second would be answered with the first one's number.
	 * Renaming through a long session would otherwise leave an entry behind
	 * for every path a note has ever had.
	 */
	forget(path: string, { children = false } = {}): void {
		this.memo.delete(path);
		if (!children) return;
		const prefix = `${path}/`;
		for (const key of this.memo.keys()) {
			if (key.startsWith(prefix)) this.memo.delete(key);
		}
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
			unreadable: 0,
			cjkCharacters: 0,
			words: 0,
			punctuationMarks: 0,
			charactersWithSpaces: 0,
			charactersNoSpaces: 0,
			total: 0,
		};
		for (const path of paths) {
			const count = await this.countNote(path, options);
			// The paths came from the vault a moment ago, so a note that will
			// not read is a note that will not parse rather than one that is
			// gone. Said out loud: silence here reads as writing that vanished.
			if (count === null) {
				sum.unreadable += 1;
				continue;
			}
			sum.notes += 1;
			sum.cjkCharacters += count.cjkCharacters;
			sum.words += count.words;
			sum.punctuationMarks += count.punctuationMarks;
			sum.charactersWithSpaces += count.charactersWithSpaces;
			sum.charactersNoSpaces += count.charactersNoSpaces;
			sum.total += count.total;
		}
		return sum;
	}
}
