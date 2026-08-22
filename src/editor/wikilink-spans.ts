/**
 * Finding the wikilink under a position in one line of raw Markdown.
 *
 * The stream's editor shows links as the text they are, so hovering one has
 * no anchor element to ask; the line's own text is the only witness. Pure,
 * so the span arithmetic is pinned headless.
 */
export interface WikilinkSpan {
	from: number;
	to: number;
	/** The path half of the link, trimmed. */
	linktext: string;
	/** The alias half, or null when the link shows its target. */
	alias: string | null;
}

const WIKILINK = /\[\[([^\][|]+)(?:\|([^\][]*))?\]\]/gu;

/** The wikilink containing `offset` in `lineText`, or null. */
export function wikilinkAt(lineText: string, offset: number): WikilinkSpan | null {
	for (const match of lineText.matchAll(WIKILINK)) {
		const from = match.index ?? 0;
		const to = from + match[0].length;
		// Matches arrive in order, so a link starting past the offset means
		// nothing further can contain it.
		if (offset < from) return null;
		if (offset > to) continue;
		const linktext = match[1]?.trim() ?? '';
		if (linktext.length === 0) return null;
		return { from, to, linktext, alias: match[2] ?? null };
	}
	return null;
}
