/**
 * Which lines make up the paragraph the caret is in.
 *
 * Kept free of the editor, in the manner of `manuscript-window.ts`, so the
 * rule can be exercised without one. `segment-editor-backend.ts` turns the
 * answer into line decorations; focus mode's styling is what makes them
 * visible.
 */

/** The lines of a document, however they are stored. One-based. */
export interface LineSource {
	lines: number;
	lineText(line: number): string;
}

/**
 * The paragraph around one line: the run of non-blank lines it sits in, as
 * first and last line numbers — or null when the line itself is blank, because
 * a caret between paragraphs is in neither of them.
 */
export function paragraphAround(
	text: LineSource,
	line: number,
): { first: number; last: number } | null {
	const blank = (at: number): boolean => text.lineText(at).trim().length === 0;
	if (line < 1 || line > text.lines || blank(line)) return null;
	let first = line;
	while (first > 1 && !blank(first - 1)) first -= 1;
	let last = line;
	while (last < text.lines && !blank(last + 1)) last += 1;
	return { first, last };
}
