/**
 * What a copy of freeform nodes is put on the clipboard as, and how one is
 * read back off it. The words are plain text holding the nodes as the file
 * writes them, under a name of their own, so a copy carries between views,
 * projects and windows, and words that merely look like a copy are never
 * taken for one. Pure: nothing here reads the clipboard itself.
 */

import { freeformBounds, readFreeformView, type FreeformClip } from '../domain';
import type { CanvasSize } from './freeform-canvas-port';

/** The name the words carry, and the one form of them this build writes. */
export const FREEFORM_CLIP_MARK = 'snowflake-method-freeform';
export const FREEFORM_CLIP_SCHEMA = 1;

export function writeFreeformClip(clip: FreeformClip): string {
	return JSON.stringify({
		[FREEFORM_CLIP_MARK]: FREEFORM_CLIP_SCHEMA,
		placements: clip.placements,
		frames: clip.frames,
		edges: clip.edges,
	});
}

/**
 * A copy read back, or null for words that are not one: not JSON, not
 * carrying the name, written by a newer plugin, or holding no node that
 * reads. Entries that do not read are left out, as a file's strays are; a
 * line whose end was not copied with it goes when the copy is laid down.
 */
export function readFreeformClip(text: string): FreeformClip | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith('{')) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
	const record = parsed as Record<string, unknown>;
	const schema = record[FREEFORM_CLIP_MARK];
	if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1 || schema > FREEFORM_CLIP_SCHEMA) return null;
	const view = readFreeformView(
		{ name: '', placements: record.placements, frames: record.frames, edges: record.edges },
		'clip',
	);
	if (view === null) return null;
	const ids = [...view.frames.map((frame) => frame.id), ...view.placements.map((placement) => placement.id)];
	if (ids.length === 0) return null;
	const box = freeformBounds(view, ids);
	return {
		placements: view.placements,
		frames: view.frames,
		edges: view.edges,
		origin: { x: box?.x ?? 0, y: box?.y ?? 0 },
	};
}

/** The room a copy takes on the plane, measured from its corner. */
export function freeformClipSize(clip: FreeformClip): CanvasSize {
	let right = clip.origin.x;
	let bottom = clip.origin.y;
	for (const node of [...clip.frames, ...clip.placements]) {
		right = Math.max(right, node.x + node.width);
		bottom = Math.max(bottom, node.y + node.height);
	}
	return { width: right - clip.origin.x, height: bottom - clip.origin.y };
}
