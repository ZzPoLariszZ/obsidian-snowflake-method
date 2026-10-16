/**
 * The pictures the plugin shows, read without a vault: which file extensions
 * Obsidian itself draws as an image, stated once for the gallery a note
 * keeps, the canvas's file cards and the canvas export; and the gallery
 * itself as a note stores it, a list of links and the one of them shown
 * first, with the draft a form holds of it before its save.
 */

import { parseWikiLink } from './wikilink';

/** The extensions Obsidian renders as a picture, lower case and without their dots. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
	'avif',
	'bmp',
	'gif',
	'jpeg',
	'jpg',
	'png',
	'svg',
	'webp',
]);

/** The extension a path's file name ends in, lower case and without its dot; '' for a name that has none. */
export function fileExtensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Whether a path names a file Obsidian shows as a picture. */
export function isImagePath(path: string): boolean {
	return IMAGE_EXTENSIONS.has(fileExtensionOf(path));
}

// -- The gallery a note keeps ---------------------------------------------------

/** What a stored gallery link points at, as a path without its brackets; null for words that are no link. */
export function galleryLinkTarget(raw: string): string | null {
	const link = parseWikiLink(raw);
	return link === null || link.target.length === 0 ? null : link.target;
}

/**
 * What a link is matched by: the path it names, or the words themselves
 * where they are no link. Every place that asks whether two gallery links
 * name one picture asks this: the pane, the save and the tidy after it.
 */
export function galleryKeyOf(raw: string): string {
	return galleryLinkTarget(raw) ?? raw.trim();
}

/**
 * The entry of the list the stored main link names, matched by what it points
 * at rather than by its spelling; null while no main is stored or the stored
 * one names no entry, so a main is always one of the list or none.
 */
export function galleryMainOf(gallery: readonly string[], stored: unknown): string | null {
	if (typeof stored !== 'string') return null;
	const wanted = galleryKeyOf(stored);
	if (wanted.length === 0) return null;
	return gallery.find((raw) => galleryKeyOf(raw) === wanted) ?? null;
}

/** The picture a card shows for a note: its main one, else its first; null while it has none. */
export function galleryCover(gallery: readonly string[], galleryMain: string | null): string | null {
	return galleryMain ?? gallery[0] ?? null;
}

/**
 * One picture a form holds before its save: a stored link kept, a file of
 * the vault to land in the gallery folder, or a file from the device, whose
 * bytes are read at the save and not before, so a form holding a dozen
 * pictures does not hold their bytes while it stands open.
 */
export type GalleryDraftEntry =
	| { kind: 'kept'; link: string }
	| { kind: 'vault'; path: string }
	| { kind: 'data'; name: string; read: () => Promise<ArrayBuffer> };

/** An entry that lands a file: every kind but a link kept as it was. */
export type GalleryPictureSource = Exclude<GalleryDraftEntry, { kind: 'kept' }>;

/** What a form says about a note's gallery when it saves. */
export interface GalleryDraft {
	entries: GalleryDraftEntry[];
	/** Stored links the author took off the gallery, for the save to tidy after. */
	removed: string[];
	/** Which entry is the main picture, by its place in `entries`; null for none. */
	mainIndex: number | null;
}

/** A note's stored gallery as a form first holds it: every link kept, nothing removed. */
export function galleryDraftOf(gallery: readonly string[], galleryMain: string | null): GalleryDraft {
	const entries = gallery.map((link) => ({ kind: 'kept' as const, link }));
	const at = galleryMain === null ? -1 : gallery.indexOf(galleryMain);
	return { entries, removed: [], mainIndex: at === -1 ? null : at };
}

/** The entries of a draft that land a file, in the draft's order. */
export function galleryPicks(draft: GalleryDraft): GalleryPictureSource[] {
	return draft.entries.filter((entry): entry is GalleryPictureSource => entry.kind !== 'kept');
}

/**
 * The gallery as a draft writes it once its picks have landed: a kept entry
 * keeps its link, a pick takes the link it landed under, in the draft's
 * order, each picture once however often it was picked, and the main
 * follows its entry. `landed` holds one link per pick, in the order
 * `galleryPicks` gives them; a pick that landed nowhere is left out.
 */
export function composeGallery(
	draft: GalleryDraft,
	landed: readonly string[],
): { gallery: string[]; galleryMain: string | null } {
	const links: string[] = [];
	let pick = 0;
	for (const entry of draft.entries) {
		if (entry.kind === 'kept') {
			links.push(entry.link);
		} else {
			links.push(landed[pick] ?? '');
			pick += 1;
		}
	}
	const gallery: string[] = [];
	const seen = new Set<string>();
	for (const raw of links) {
		if (raw.trim().length === 0) continue;
		const key = galleryKeyOf(raw);
		if (seen.has(key)) continue;
		seen.add(key);
		gallery.push(raw);
	}
	const main = draft.mainIndex === null ? undefined : links[draft.mainIndex];
	return { gallery, galleryMain: main === undefined ? null : galleryMainOf(gallery, main) };
}
