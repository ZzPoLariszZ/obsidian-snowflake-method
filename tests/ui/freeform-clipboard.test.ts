import { describe, expect, it } from 'vitest';

import type { FreeformClip, FreeformEdge, FreeformFrame, FreeformPlacement } from '../../src/domain';
import { FREEFORM_CLIP_MARK, FREEFORM_CLIP_SCHEMA, freeformClipSize, readFreeformClip, writeFreeformClip } from '../../src/ui/freeform-clipboard';

const placement = (id: string, extra: Partial<FreeformPlacement> = {}): FreeformPlacement => ({
	id,
	resource: { type: 'text', text: `Words of ${id}` },
	x: 100,
	y: 200,
	width: 256,
	height: 160,
	displayMode: 'auto',
	zIndex: 0,
	frameId: null,
	...extra,
});
const frame = (id: string, extra: Partial<FreeformFrame> = {}): FreeformFrame => ({
	id, title: 'Opening', color: 'macaron-2', x: 60, y: 140, width: 480, height: 320, zIndex: 0, ...extra,
});
const edge = (id: string, source: string, target: string): FreeformEdge => ({
	id, source, target, sourceSide: 'right', targetSide: 'left', label: 'then', arrow: 'end', line: 'dashed',
});

const clip: FreeformClip = {
	placements: [placement('p1', { frameId: 'f1' }), placement('p2', { x: 400, y: 260, zIndex: 1 })],
	frames: [frame('f1')],
	edges: [edge('e1', 'p1', 'p2')],
	origin: { x: 60, y: 140 },
};

describe('a copy of freeform nodes on the clipboard', () => {
	it('is written as words that carry its name, and read back whole', () => {
		const words = writeFreeformClip(clip);
		const parsed = JSON.parse(words) as Record<string, unknown>;
		expect(parsed[FREEFORM_CLIP_MARK]).toBe(FREEFORM_CLIP_SCHEMA);
		expect(readFreeformClip(words)).toEqual(clip);
		// Room about the words changes nothing.
		expect(readFreeformClip(`\n  ${words}\n`)).toEqual(clip);
	});

	it('takes nothing for a copy that is not one', () => {
		expect(readFreeformClip('')).toBeNull();
		expect(readFreeformClip('Some words a reader copied')).toBeNull();
		expect(readFreeformClip('{not json')).toBeNull();
		expect(readFreeformClip('[]')).toBeNull();
		// JSON of another kind, and the file's own shape without the name.
		expect(readFreeformClip(JSON.stringify({ nodes: [], edges: [] }))).toBeNull();
		expect(readFreeformClip(JSON.stringify({ placements: clip.placements }))).toBeNull();
		// The name carried by a newer plugin, or by nothing that counts.
		expect(readFreeformClip(JSON.stringify({ [FREEFORM_CLIP_MARK]: FREEFORM_CLIP_SCHEMA + 1, placements: clip.placements }))).toBeNull();
		expect(readFreeformClip(JSON.stringify({ [FREEFORM_CLIP_MARK]: '1', placements: clip.placements }))).toBeNull();
		expect(readFreeformClip(JSON.stringify({ [FREEFORM_CLIP_MARK]: 0, placements: clip.placements }))).toBeNull();
		// A copy of nothing.
		expect(readFreeformClip(JSON.stringify({ [FREEFORM_CLIP_MARK]: 1 }))).toBeNull();
		expect(readFreeformClip(JSON.stringify({ [FREEFORM_CLIP_MARK]: 1, placements: [], frames: [], edges: [] }))).toBeNull();
		// A list that is not one is damage, as it is in a file.
		expect(readFreeformClip(JSON.stringify({ [FREEFORM_CLIP_MARK]: 1, placements: 'p1' }))).toBeNull();
	});

	it('reads what reads and leaves the rest, as a file is read', () => {
		const read = readFreeformClip(JSON.stringify({
			[FREEFORM_CLIP_MARK]: 1,
			placements: [
				placement('p1', { frameId: 'gone' }),
				{ id: 'p2', resource: { type: 'unknown' }, x: 0, y: 0 },
				{ ...placement('p3', { x: 700, y: 900 }), width: 'wide', displayMode: 'huge' },
			],
			frames: [{ id: 'f9', x: 'left' }],
			edges: [edge('e1', 'p1', 'p3'), edge('e2', 'p1', 'p2')],
		}));
		expect(read).not.toBeNull();
		expect(read!.frames).toEqual([]);
		expect(read!.placements.map((entry) => entry.id)).toEqual(['p1', 'p3']);
		// A frame the copy does not carry holds nothing; a size or a mode that does not read takes the default.
		expect(read!.placements[0]!.frameId).toBeNull();
		expect(read!.placements[1]).toMatchObject({ width: 256, displayMode: 'auto' });
		// A line to a node that did not read is a stray, and is not laid down.
		expect(read!.edges.map((entry) => entry.id)).toEqual(['e1']);
		// The corner is worked out afresh from what read, whatever the words said.
		expect(read!.origin).toEqual({ x: 100, y: 200 });
	});

	it('measures the room a copy takes from its corner', () => {
		expect(freeformClipSize(clip)).toEqual({ width: 596, height: 320 });
		expect(freeformClipSize({ ...clip, frames: [], origin: { x: 100, y: 200 } })).toEqual({ width: 556, height: 220 });
		expect(freeformClipSize({ placements: [], frames: [], edges: [], origin: { x: 5, y: 5 } })).toEqual({ width: 0, height: 0 });
	});
});
