/**
 * The pictures the plugin shows, read without a vault: which file extensions
 * Obsidian itself draws as an image, stated once for the gallery a note
 * keeps, the canvas's file cards and the canvas export.
 */

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
