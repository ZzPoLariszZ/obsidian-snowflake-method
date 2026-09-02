/**
 * The manuscript as plain text: what the page shows, with everything that is
 * not writing taken out, laid out as lines a reader can take anywhere.
 *
 * This is the count's own reading of a note -- `countablePieces`, the same
 * elision of Markdown and Obsidian syntax the writing count and the analysis
 * read through -- asked for the two things a reader wants that a counter
 * never does: a hard break as the line it draws, and an entity as the
 * character it spells. Over that text, a line pass: paragraphs begin with the
 * manuscript's indent, or not; blank lines stay as written, or go. Headings
 * survive as their words alone, never indented, in both formats: the format
 * chooses the file's name and nothing about its text.
 *
 * Kept free of Obsidian types and of the DOM.
 */

import { countablePieces } from './countable-prose';
import type { CountableRange } from './markdown-scan';

export const EXPORT_FORMATS = ['md', 'txt'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export function isExportFormat(value: unknown): value is ExportFormat {
	return value === 'md' || value === 'txt';
}

export const EXPORT_LAYOUTS = ['single', 'folder'] as const;
/** One file for the whole manuscript, or one file per note in a folder. */
export type ExportLayout = (typeof EXPORT_LAYOUTS)[number];
export function isExportLayout(value: unknown): value is ExportLayout {
	return value === 'single' || value === 'folder';
}

export const EXPORT_SEPARATORS = ['blank', 'rule', 'asterisks'] as const;
/** What stands between two notes in a single file. */
export type ExportSeparator = (typeof EXPORT_SEPARATORS)[number];
export function isExportSeparator(value: unknown): value is ExportSeparator {
	return value === 'blank' || value === 'rule' || value === 'asterisks';
}

export interface ExportProseOptions {
	/**
	 * Begin every paragraph with the manuscript's indent -- two ideographic
	 * spaces for a Chinese manuscript, two em spaces otherwise -- unless the
	 * author typed one. Off strips any indent the author typed.
	 */
	indent: boolean;
	/** Keep the blank lines between paragraphs as written; off drops every one. */
	paragraphSpacing: boolean;
	/** Which indent a paragraph is given. */
	script: 'cjk' | 'latin';
}

const CJK_INDENT = '　　';
const LATIN_INDENT = '  ';

/**
 * One note's body as plain text under the options, ending in one newline,
 * or the empty string for a note holding no writing.
 *
 * Read line by line over the SOURCE, because the source is where a blank
 * line means something. Each source line is one of three things once the
 * syntax is out of it: blank as the author left it, which is spacing;
 * nothing at all, which was syntax alone -- a fence, an embed, a comment, a
 * heading's underline -- and vanishes without leaving a gap; or words. Blank
 * runs parted only by vanished lines are one gap, as wide as the widest of
 * them, so a code block between two paragraphs leaves the one blank line the
 * author put on either side of it rather than the sum.
 */
export function exportProse(
	body: string,
	excluded: readonly CountableRange[],
	options: ExportProseOptions,
): string {
	const pieces = countablePieces(body, excluded, {
		headings: 'count',
		hardBreak: 'newline',
		entities: 'decode',
	});
	// The source's lines, and what each still says once the syntax is out.
	const lineStarts: number[] = [0];
	for (let index = body.indexOf('\n'); index !== -1; index = body.indexOf('\n', index + 1)) {
		lineStarts.push(index + 1);
	}
	const lineOf = (offset: number): number => {
		let low = 0;
		let high = lineStarts.length - 1;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			if ((lineStarts[mid] ?? 0) <= offset) low = mid;
			else high = mid - 1;
		}
		return low;
	};
	const content: string[] = lineStarts.map(() => '');
	const headingLine: boolean[] = lineStarts.map(() => false);
	for (const piece of pieces) {
		// A stand-in's newline is a hard break's: it ends the line and puts
		// nothing on it, and what follows belongs to the line after by its own
		// offset. The body's own text is cut at its newlines, each part on
		// the line its offset says.
		let offset = 0;
		for (const part of piece.text.split('\n')) {
			const line = lineOf((piece.from ?? piece.at) + offset);
			if (part.length > 0) {
				content[line] = (content[line] ?? '') + part;
				if (piece.heading === true) headingLine[line] = true;
			}
			offset += part.length + 1;
		}
	}

	const indent = options.script === 'cjk' ? CJK_INDENT : LATIN_INDENT;
	const out: string[] = [];
	let openParagraph = false;
	let run = 0;
	let gap = 0;
	for (let index = 0; index < lineStarts.length; index += 1) {
		const start = lineStarts[index] ?? 0;
		const end = index + 1 < lineStarts.length ? (lineStarts[index + 1] ?? 0) - 1 : body.length;
		const source = body.slice(start, end);
		if (source.trim().length === 0) {
			run += 1;
			gap = Math.max(gap, run);
			openParagraph = false;
			continue;
		}
		// Inner runs of ASCII spaces collapse as the page collapses them; an
		// ideographic space is a character of the writing and stays.
		const line = (content[index] ?? '')
			.replace(/[ \t]{2,}/gu, ' ')
			.replace(/\s+$/u, '');
		if (line.trim().length === 0) {
			run = 0;
			continue;
		}
		if (options.paragraphSpacing && out.length > 0) {
			for (let blank = 0; blank < gap; blank += 1) out.push('');
		}
		run = 0;
		gap = 0;
		const heading = headingLine[index] === true;
		const lead = line.length - line.trimStart().length;
		let written: string;
		if (heading || openParagraph || !options.indent) written = line.trimStart();
		else written = lead > 0 ? line : indent + line;
		out.push(written);
		openParagraph = !heading;
	}
	return out.length === 0 ? '' : `${out.join('\n')}\n`;
}

/**
 * Several notes' texts as one file: each already ends in its newline, and the
 * separator stands between them with a blank line on either side, so a rule
 * never lands against the words above it -- which is what would make it a
 * heading's underline to a Markdown reader.
 */
export function joinChapters(
	chapters: readonly string[],
	separator: ExportSeparator,
): string {
	const parts = chapters.filter((chapter) => chapter.length > 0);
	const between =
		separator === 'rule'
			? '\n----------\n\n'
			: separator === 'asterisks'
				? '\n* * *\n\n'
				: '\n';
	return parts.join(between);
}

/**
 * The name of one note's file in a folder export: its place in the manuscript
 * first, zero-padded so the folder lists in reading order, then its name.
 */
export function exportFileName(
	index: number,
	count: number,
	title: string,
	format: ExportFormat,
): string {
	const width = Math.max(3, String(count).length);
	return `${String(index + 1).padStart(width, '0')} ${title}.${format}`;
}
