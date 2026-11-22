import { fileStem, type WritingCount } from '../../src/domain';
import type { ManuscriptSegmentContent, ManuscriptSegmentRecord, NoteCountOptions, ProjectRef } from '../../src/services';
import type { JsonObject } from '../json';

/**
 * The manuscript as the API tells it. A manuscript note carries nothing of
 * the plugin's but its place in the order, so it has no id to be known by:
 * it is addressed by where it stands inside its project, and that address is
 * what every answer gives beside the note.
 */

/** Where a note stands inside its project: its vault path with the project's folder taken off. */
export function relativePathOf(project: ProjectRef, path: string): string {
	return path.startsWith(`${project.rootPath}/`) ? path.slice(project.rootPath.length + 1) : path;
}

/** One of the manuscript's notes, as another answer names it. */
export function manuscriptNoteRefOf(project: ProjectRef, path: string, title: string = fileStem(path)): JsonObject {
	return { path, relativePath: relativePathOf(project, path), title };
}

/** How much is written, counted every way at once. */
export function writingCountOf(count: WritingCount): JsonObject {
	return {
		total: count.total,
		words: count.words,
		cjkCharacters: count.cjkCharacters,
		punctuationMarks: count.punctuationMarks,
		charactersWithSpaces: count.charactersWithSpaces,
		charactersNoSpaces: count.charactersNoSpaces,
	};
}

/** The convention a count follows. It is the author's setting, so every count says which it was made by. */
export function countingOf(options: NoteCountOptions): JsonObject {
	return { mode: options.mode, headings: options.headings };
}

export function manuscriptNoteSummaryOf(
	project: ProjectRef,
	segment: ManuscriptSegmentRecord,
	index: number,
	total: number | undefined,
): JsonObject {
	const told: JsonObject = {
		relativePath: relativePathOf(project, segment.path),
		path: segment.path,
		title: segment.title,
		index,
		readOnly: segment.readOnly,
	};
	if (total !== undefined) told['total'] = total;
	return told;
}

export function manuscriptNoteOf(
	project: ProjectRef,
	content: ManuscriptSegmentContent,
	place: { index: number; previous: string | null; next: string | null },
	naming: { heading: string | null; matches: boolean },
	count: WritingCount | null,
	options: NoteCountOptions,
): JsonObject {
	return {
		relativePath: relativePathOf(project, content.path),
		path: content.path,
		title: content.title,
		index: place.index,
		readOnly: content.readOnly,
		etag: content.revision,
		body: content.body,
		heading: naming.heading,
		headingMatchesTitle: naming.matches,
		count: count === null ? null : writingCountOf(count),
		counting: countingOf(options),
		previous: place.previous === null ? null : relativePathOf(project, place.previous),
		next: place.next === null ? null : relativePathOf(project, place.next),
	};
}
