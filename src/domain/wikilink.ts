/**
 * Wikilinks as stored values, read and written without a vault: the shape
 * `[[path#subpath|alias]]`, the way Obsidian and the service write them. The
 * service's `toWikiLink` also normalizes the path through the vault, which a
 * domain module has no vault to do, so the paths given here are expected to
 * come from the vault already normalized.
 */

import { fileStem } from './names';

export interface ParsedWikiLink {
	/** Everything between the brackets before the alias bar. */
	linktext: string;
	/** The note the link names: the linktext before its first `#`. */
	target: string;
	/** The heading or block after the `#`, or '' when the link names the note whole. */
	subpath: string;
	/** The display text after the bar, or null when the link shows its target. */
	alias: string | null;
}

const WIKI_LINK = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/u;

/** Reads one link, or answers null for anything that is not exactly one. */
export function parseWikiLink(raw: string): ParsedWikiLink | null {
	const match = WIKI_LINK.exec(raw.trim());
	if (match === null) return null;
	const linktext = (match[1] ?? '').trim();
	if (linktext.length === 0) return null;
	const hash = linktext.indexOf('#');
	const target = hash === -1 ? linktext : linktext.slice(0, hash);
	const subpath = hash === -1 ? '' : linktext.slice(hash + 1);
	const alias = match[2] === undefined ? null : match[2].trim();
	return { linktext, target: target.trim(), subpath: subpath.trim(), alias };
}

/**
 * Writes a link the way the service writes one: the note's path without the
 * ".md" it would never show, and an alias stripped of what would end the
 * link early. An empty path is no link at all.
 */
export function wikiLinkText(path: string, alias?: string): string {
	const target = path.trim().replace(/\.md$/u, '');
	if (target.length === 0) return '';
	const safeAlias =
		typeof alias === 'string' ? alias.replace(/[|\]]/gu, '').trim() : '';
	return safeAlias.length > 0 ? `[[${target}|${safeAlias}]]` : `[[${target}]]`;
}

/**
 * What a link is shown as: its alias when it carries one, else the note's
 * name, with the heading or block after it when the link points inside the
 * note. Words that are not a link read as themselves.
 */
export function wikiLinkLabel(raw: string): string {
	const link = parseWikiLink(raw);
	if (link === null) return raw.trim();
	if (link.alias !== null && link.alias.length > 0) return link.alias;
	const note = link.target.length > 0 ? fileStem(link.target) : '';
	if (link.subpath.length === 0) return note;
	return note.length === 0 ? link.subpath : `${note} › ${link.subpath}`;
}
