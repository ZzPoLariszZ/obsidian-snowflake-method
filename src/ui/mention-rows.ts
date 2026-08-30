/**
 * The tracking surfaces' pure half: naming and clipping helpers kept apart
 * from the view so their shapes are pinned without a workspace.
 */

/** The name a note is filed under, which is how chapters are shown here. */
export const mentionNoteTitle = (path: string): string =>
	path.replace(/\.md$/u, '').split('/').pop() ?? path;

/**
 * A long text cut at the end: for rows clamped to a single line, where only
 * the head can ever show and a middle ellipsis would promise a close that
 * the clamp hides anyway.
 */
export function truncateEnd(text: string, max: number): string {
	const flat = text.replace(/\s+/gu, ' ');
	if (flat.length <= max) return flat;
	let cut = Math.max(1, max - 1);
	// Never between the halves of a surrogate pair: an astral character on
	// the cut would otherwise render as a lone replacement mark.
	const unit = flat.charCodeAt(cut - 1);
	if (cut > 1 && unit >= 0xd800 && unit <= 0xdbff) cut -= 1;
	return `${flat.slice(0, cut)}…`;
}
