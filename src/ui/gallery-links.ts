/**
 * Where a note's pictures are found from the links it stores. A gallery link
 * is written as a full vault path, so it resolves the same from any note;
 * resolving it through the app's own index is what makes a picture the
 * author renamed in the vault still found, since the index knows the new
 * name before anything else does.
 */

import type { App, MetadataCache, TFile } from 'obsidian';

import { galleryLinkTarget } from '../domain';

/** The vault file a stored gallery link names, resolved as the app resolves a link from the note; null when it has gone. */
export function resolveGalleryPicture(
	metadataCache: Pick<MetadataCache, 'getFirstLinkpathDest'>,
	raw: string,
	sourcePath: string,
): TFile | null {
	const target = galleryLinkTarget(raw);
	return target === null ? null : metadataCache.getFirstLinkpathDest(target, sourcePath);
}

/** What an image element loads a stored gallery link from, or null while the picture is missing. */
export function galleryPictureSource(
	app: Pick<App, 'vault' | 'metadataCache'>,
	raw: string,
	sourcePath: string,
): string | null {
	const file = resolveGalleryPicture(app.metadataCache, raw, sourcePath);
	return file === null ? null : app.vault.getResourcePath(file);
}
