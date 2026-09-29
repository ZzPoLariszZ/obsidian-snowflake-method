import { describe, expect, it } from 'vitest';

import {
	DEFAULT_FREEFORM_VIEWPORT,
	FREEFORM_FRAME_HEAD,
	FREEFORM_FRAME_PADDING,
	FREEFORM_LIMITS,
	FREEFORM_SIZE,
	applyFreeformSteps,
	copyFreeformSelection,
	emptyFreeformDocument,
	findFreeformFrame,
	findFreeformPlacement,
	freeformBounds,
	freeformClipSteps,
	freeformEdgesOf,
	freeformFrameMembers,
	freeformPlacedFilePaths,
	freeformPlacedTypes,
	freeformResourceKey,
	freeformRoom,
	freeformStacking,
	isFreeformAddress,
	isFreeformResourcePath,
	leaveFreeformView,
	newFreeformView,
	readFreeformResource,
	readFreeformView,
	readFreeformViewport,
	renameFreeformFilePaths,
	renameFreeformView,
	serializeFreeformView,
	shownFreeformViewId,
	type FreeformEdge,
	type FreeformFrame,
	type FreeformLimits,
	type FreeformPlacement,
	type FreeformResource,
	type FreeformStep,
	type FreeformView,
} from '../../src/domain';

const text = (words: string): FreeformResource => ({ type: 'text', text: words });
const scene = (id: string, name = id): FreeformResource => ({ type: 'entity', kind: 'scene', id, name });

const placement = (id: string, extra: Partial<FreeformPlacement> = {}): FreeformPlacement => ({
	id, resource: text(id), x: 0, y: 0, width: 100, height: 60, displayMode: 'auto', zIndex: 0, frameId: null, ...extra,
});
const frame = (id: string, extra: Partial<FreeformFrame> = {}): FreeformFrame => ({
	id, title: `Frame ${id}`, color: null, x: 0, y: 0, width: 400, height: 300, zIndex: 0, ...extra,
});
const edge = (id: string, source: string, target: string, extra: Partial<FreeformEdge> = {}): FreeformEdge => ({
	id, source, target, sourceSide: null, targetSide: null, label: '', arrow: 'end', line: 'solid', ...extra,
});
const view = (extra: Partial<FreeformView> = {}): FreeformView => ({
	...newFreeformView({ id: 'v', name: 'View', now: 1 }), ...extra,
});

const take = (held: FreeformView, steps: readonly FreeformStep[], limits?: FreeformLimits) =>
	applyFreeformSteps(held, steps, 9, limits);

const byId = <T extends { readonly id: string }>(entries: readonly T[]): T[] =>
	[...entries].sort((left, right) => left.id.localeCompare(right.id));

/**
 * What a view holds, with nothing of when it was changed: what a change and
 * its undoing are measured by. Each list is read in the order of its ids,
 * since what is put back stands at the list's end and a node's place among
 * the others is its number's to say, never the list's.
 */
const held = (of: FreeformView) => ({
	placements: byId(of.placements),
	frames: byId(of.frames),
	edges: byId(of.edges),
});

/** Takes the steps, then the steps that take them back, and says the view stands as it stood. */
function undone(before: FreeformView, steps: readonly FreeformStep[]): FreeformView {
	const done = take(before, steps);
	expect(done.came).toBe('written');
	expect(done.changed).toBe(true);
	const back = take(done.view, done.inverse);
	expect(back.came).toBe('written');
	expect(held(back.view)).toEqual(held(before));
	return done.view;
}

describe('reading a resource', () => {
	it('reads every type this build knows, a label that will not read as none', () => {
		expect(readFreeformResource({ type: 'entity', kind: 'character', id: 'c1', name: 'Ada' }))
			.toEqual({ type: 'entity', kind: 'character', id: 'c1', name: 'Ada' });
		expect(readFreeformResource({ type: 'entity', kind: 'Faction', id: 'e1' }))
			.toEqual({ type: 'entity', kind: 'Faction', id: 'e1', name: '' });
		for (const type of ['task', 'foreshadowing', 'revision', 'sticky-note'] as const) {
			expect(readFreeformResource({ type, id: 'r1', name: 7 })).toEqual({ type, id: 'r1', name: '' });
		}
		expect(readFreeformResource({ type: 'file', path: '80_Material/map.png' }))
			.toEqual({ type: 'file', path: '80_Material/map.png' });
		expect(readFreeformResource({ type: 'link', url: 'https://example.com/a?b=1' }))
			.toEqual({ type: 'link', url: 'https://example.com/a?b=1', label: '' });
		expect(readFreeformResource({ type: 'text', text: '' })).toEqual({ type: 'text', text: '' });
	});

	it('reads nothing of a type it has never heard of, or of one that does not say what it names', () => {
		expect(readFreeformResource({ type: 'mind-map', id: 'm' })).toBeNull();
		expect(readFreeformResource({ type: 'entity', kind: 'scene' })).toBeNull();
		expect(readFreeformResource({ type: 'entity', id: 's1' })).toBeNull();
		expect(readFreeformResource({ type: 'task', id: '' })).toBeNull();
		expect(readFreeformResource({ type: 'text' })).toBeNull();
		expect(readFreeformResource(null)).toBeNull();
		expect(readFreeformResource('text')).toBeNull();
	});

	it('keeps a file only by a path from the project’s root that never climbs out', () => {
		expect(isFreeformResourcePath('a/b.md')).toBe(true);
		expect(isFreeformResourcePath('b.md')).toBe(true);
		for (const path of ['', '/a/b.md', '../b.md', 'a/../b.md', 'a//b.md', 'a\\b.md', './b.md', 'a/']) {
			expect(isFreeformResourcePath(path), path).toBe(false);
		}
		expect(readFreeformResource({ type: 'file', path: '../secret.md' })).toBeNull();
	});

	it('keeps a link only by an http or https address with no gap in it', () => {
		expect(isFreeformAddress('http://a.b')).toBe(true);
		expect(isFreeformAddress('HTTPS://A.B/c')).toBe(true);
		for (const url of ['', 'ftp://a.b', 'javascript:alert(1)', 'obsidian://open', 'https://a b', 'a.b', 'https://']) {
			expect(isFreeformAddress(url), url).toBe(false);
		}
		expect(readFreeformResource({ type: 'link', url: 'file:///etc/passwd', label: 'x' })).toBeNull();
	});
});

describe('reading a view', () => {
	it('needs a name, reads an absent list as none and takes its id from the file', () => {
		expect(readFreeformView({}, 'v')).toBeNull();
		expect(readFreeformView({ name: 7 }, 'v')).toBeNull();
		const read = readFreeformView({ id: 'another', name: 'Overview' }, 'v');
		expect(read).toEqual({
			id: 'v',
			name: 'Overview',
			placements: [],
			frames: [],
			edges: [],
			viewport: DEFAULT_FREEFORM_VIEWPORT,
			createdAt: 0,
			updatedAt: 0,
			strays: { placements: [], frames: [], edges: [] },
		});
	});

	it('takes a list that stands as anything but a list for damage', () => {
		expect(readFreeformView({ name: 'A', placements: {} }, 'v')).toBeNull();
		expect(readFreeformView({ name: 'A', frames: 'none' }, 'v')).toBeNull();
		expect(readFreeformView({ name: 'A', edges: null }, 'v')).toBeNull();
	});

	it('sets aside a placement of a type it has never heard of, one with no place, and a twin', () => {
		const unknown = { id: 'p2', resource: { type: 'mind-map', id: 'm' }, x: 0, y: 0 };
		const nowhere = { id: 'p3', resource: { type: 'text', text: 'a' }, x: 'left', y: 0 };
		const endless = { id: 'p4', resource: { type: 'text', text: 'a' }, x: Infinity, y: 0 };
		const twin = { id: 'p1', resource: { type: 'text', text: 'second' }, x: 5, y: 5 };
		const read = readFreeformView({
			name: 'A',
			placements: [{ id: 'p1', resource: { type: 'text', text: 'first' }, x: 1, y: 2 }, unknown, nowhere, endless, twin, 7],
		}, 'v');
		expect(read?.placements.map((entry) => entry.id)).toEqual(['p1']);
		expect(read?.placements[0]?.resource).toEqual({ type: 'text', text: 'first' });
		expect(read?.strays.placements).toEqual([unknown, nowhere, endless, twin, 7]);
	});

	it('reads the rest of a placement as far as it goes', () => {
		const read = readFreeformView({
			name: 'A',
			frames: [{ id: 'f1', x: 0, y: 0 }],
			placements: [
				{ id: 'p1', resource: { type: 'text', text: 'a' }, x: 1.4, y: -2.6, width: -5, height: 'tall', displayMode: 'huge', frameId: 'gone' },
				{ id: 'p2', resource: { type: 'text', text: 'b' }, x: 0, y: 0, width: 1, height: 99_999, displayMode: 'compact', zIndex: 7, frameId: 'f1' },
				{ id: 'p3', resource: { type: 'text', text: 'c' }, x: 0, y: 0 },
			],
		}, 'v');
		expect(read?.placements).toEqual([
			placement('p1', { resource: text('a'), x: 1, y: -3, width: FREEFORM_SIZE.width, height: FREEFORM_SIZE.height, zIndex: 0 }),
			placement('p2', { resource: text('b'), width: FREEFORM_SIZE.min, height: FREEFORM_SIZE.max, displayMode: 'compact', zIndex: 7, frameId: 'f1' }),
			// No place said among the placements: the next after those that read.
			placement('p3', { resource: text('c'), width: FREEFORM_SIZE.width, height: FREEFORM_SIZE.height, zIndex: 8 }),
		]);
		expect(read?.strays.placements).toEqual([]);
	});

	it('shares one id space between frames and placements, since an edge’s end names either', () => {
		const clash = { id: 'n1', resource: { type: 'text', text: 'a' }, x: 0, y: 0 };
		const read = readFreeformView({ name: 'A', frames: [{ id: 'n1', x: 0, y: 0 }], placements: [clash] }, 'v');
		expect(read?.frames.map((entry) => entry.id)).toEqual(['n1']);
		expect(read?.placements).toEqual([]);
		expect(read?.strays.placements).toEqual([clash]);
	});

	it('reads a frame leniently and sets aside one with no id or no place', () => {
		const read = readFreeformView({
			name: 'A',
			frames: [
				{ id: 'f1', title: 9, color: 'red', x: 10, y: 20, width: 300, height: 200 },
				{ id: 'f2', title: 'Act I', color: 'macaron-3', x: 0, y: 0, zIndex: 4 },
				{ title: 'No id', x: 0, y: 0 },
				{ id: 'f3', x: null, y: 0 },
			],
		}, 'v');
		expect(read?.frames).toEqual([
			frame('f1', { title: '', x: 10, y: 20, width: 300, height: 200 }),
			frame('f2', { title: 'Act I', color: 'macaron-3', width: FREEFORM_SIZE.width, height: FREEFORM_SIZE.height, zIndex: 4 }),
		]);
		expect(read?.strays.frames).toHaveLength(2);
	});

	it('keeps an edge whose end it cannot place as a stray, and never drops it', () => {
		const dangling = { id: 'e2', source: 'p1', target: 'lost' };
		const loop = { id: 'e3', source: 'p1', target: 'p1' };
		const twin = { id: 'e1', source: 'p2', target: 'p1' };
		const read = readFreeformView({
			name: 'A',
			frames: [{ id: 'f1', x: 0, y: 0 }],
			placements: [
				{ id: 'p1', resource: { type: 'text', text: 'a' }, x: 0, y: 0 },
				{ id: 'p2', resource: { type: 'text', text: 'b' }, x: 0, y: 0 },
			],
			edges: [
				{ id: 'e1', source: 'p1', target: 'p2', sourceSide: 'right', targetSide: 'inside', label: 3, arrow: 'start', line: 'wavy' },
				dangling, loop, twin,
				{ id: 'e4', source: 'p1', target: 'f1', arrow: 'both', line: 'dotted', label: 'holds' },
			],
		}, 'v');
		expect(read?.edges).toEqual([
			edge('e1', 'p1', 'p2', { sourceSide: 'right' }),
			edge('e4', 'p1', 'f1', { arrow: 'both', line: 'dotted', label: 'holds' }),
		]);
		expect(read?.strays.edges).toEqual([dangling, loop, twin]);
	});

	it('reads a viewport that will not read as the plane’s middle, and keeps a zoom within bounds', () => {
		expect(readFreeformViewport(undefined)).toEqual(DEFAULT_FREEFORM_VIEWPORT);
		expect(readFreeformViewport({ x: 1, y: 2, zoom: 0 })).toEqual(DEFAULT_FREEFORM_VIEWPORT);
		expect(readFreeformViewport({ x: NaN, y: 2, zoom: 1 })).toEqual(DEFAULT_FREEFORM_VIEWPORT);
		expect(readFreeformViewport({ x: -40.5, y: 12, zoom: 0.8 })).toEqual({ x: -40.5, y: 12, zoom: 0.8 });
		expect(readFreeformViewport({ x: 0, y: 0, zoom: 50 }).zoom).toBe(4);
		expect(readFreeformViewport({ x: 0, y: 0, zoom: 0.001 }).zoom).toBe(0.1);
	});

	it('writes the readable entries first and the strays after, so a second read serves the same', () => {
		const stored = {
			name: 'A',
			frames: [{ id: 'f1', title: 'T', color: 'macaron-1', x: 0, y: 0, width: 400, height: 300, zIndex: 0 }, { bad: true }],
			placements: [
				{ id: 'p1', resource: { type: 'entity', kind: 'scene', id: 's1', name: 'One' }, x: 1, y: 2, width: 100, height: 60, displayMode: 'standard', zIndex: 0, frameId: 'f1' },
				{ id: 'p9', resource: { type: 'hologram' }, x: 0, y: 0 },
			],
			edges: [{ id: 'e1', source: 'p1', target: 'f1', sourceSide: null, targetSide: 'top', label: 'l', arrow: 'none', line: 'dashed' }, { id: 'e9', source: 'p1', target: 'p9' }],
			viewport: { x: 3, y: 4, zoom: 2 },
			createdAt: 5,
			updatedAt: 6,
		};
		const read = readFreeformView(stored, 'v')!;
		const written = serializeFreeformView(read);
		expect(written).toEqual({ id: 'v', ...stored });
		expect(readFreeformView(written, 'v')).toEqual(read);
	});

	it('reads whatever ids it is handed without a throw', () => {
		for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
			const read = readFreeformView({
				name: 'A',
				frames: [{ id, x: 0, y: 0 }],
				placements: [{ id: `${id}-p`, resource: { type: 'text', text: '' }, x: 0, y: 0, frameId: id }],
				edges: [{ id, source: id, target: `${id}-p` }],
			}, id);
			expect(read?.frames[0]?.id).toBe(id);
			expect(read?.placements[0]?.frameId).toBe(id);
			expect(read?.edges).toHaveLength(1);
		}
	});
});

describe('views', () => {
	it('starts a view with nothing on it, looked at from the plane’s middle', () => {
		expect(newFreeformView({ id: 'v', name: 'Overview', now: 4 })).toMatchObject({
			id: 'v', name: 'Overview', placements: [], viewport: DEFAULT_FREEFORM_VIEWPORT, createdAt: 4, updatedAt: 4,
		});
		expect(emptyFreeformDocument()).toEqual({ views: [] });
	});

	it('renames a view and stamps it, and says nothing for the name it has', () => {
		expect(renameFreeformView(view(), 'Act I', 7)).toMatchObject({ name: 'Act I', updatedAt: 7 });
		expect(renameFreeformView(view(), 'View', 7)).toBeNull();
	});

	it('shows the view picked while it stands, else the one changed last, else none', () => {
		const doc = { views: [view({ id: 'a', updatedAt: 5 }), view({ id: 'b', updatedAt: 9 }), view({ id: 'c', updatedAt: 2 })] };
		expect(shownFreeformViewId(doc, 'c')).toBe('c');
		expect(shownFreeformViewId(doc, 'gone')).toBe('b');
		expect(shownFreeformViewId(doc, null)).toBe('b');
		expect(shownFreeformViewId(emptyFreeformDocument(), 'a')).toBeNull();
	});

	it('leaves behind where a leaf stood and what its resources are called, and stamps nothing', () => {
		const before = view({
			placements: [placement('p1', { resource: scene('s1', 'Old name') }), placement('p2', { resource: { type: 'task', id: 't1', name: 'Old' } }), placement('p3')],
			updatedAt: 3,
		});
		const left = leaveFreeformView(before, {
			viewport: { x: 10, y: 20, zoom: 0.5 },
			labels: new Map([
				['p1', { name: 'New name', kind: 'scene' }],
				['p2', { name: 'New' }],
				['p3', { name: 'A text keeps no name' }],
				['gone', { name: 'x' }],
			]),
		});
		expect(left?.viewport).toEqual({ x: 10, y: 20, zoom: 0.5 });
		expect(left?.updatedAt).toBe(3);
		expect(left?.placements[0]?.resource).toEqual(scene('s1', 'New name'));
		expect(left?.placements[1]?.resource).toEqual({ type: 'task', id: 't1', name: 'New' });
		expect(left?.placements[2]).toBe(before.placements[2]);
	});

	it('writes nothing for a leaving that finds everything already so', () => {
		const before = view({ placements: [placement('p1', { resource: scene('s1', 'Name') })], viewport: { x: 1, y: 2, zoom: 1 } });
		expect(leaveFreeformView(before, {})).toBeNull();
		expect(leaveFreeformView(before, {
			viewport: { x: 1, y: 2, zoom: 1 },
			labels: new Map([['p1', { name: 'Name', kind: 'scene' }]]),
		})).toBeNull();
	});

	it('carries a file along with a rename, and leaves one the rename did not move', () => {
		const before = view({
			placements: [
				placement('p1', { resource: { type: 'file', path: 'a/old.md' } }),
				placement('p2', { resource: { type: 'file', path: 'b/kept.md' } }),
				placement('p3'),
			],
			updatedAt: 3,
		});
		const carried = renameFreeformFilePaths(before, (path) => (path === 'a/old.md' ? 'a/new.md' : null));
		expect(carried?.placements.map((entry) => entry.resource)).toEqual([
			{ type: 'file', path: 'a/new.md' }, { type: 'file', path: 'b/kept.md' }, text('p3'),
		]);
		expect(carried?.updatedAt).toBe(3);
		expect(renameFreeformFilePaths(before, () => null)).toBeNull();
		// A path that would climb out of the project is not one a node may keep.
		expect(renameFreeformFilePaths(before, () => '../out.md')).toBeNull();
	});
});

describe('queries', () => {
	const standing = view({
		frames: [frame('f1', { x: 0, y: 0, width: 300, height: 200 })],
		placements: [
			placement('p1', { x: 10, y: 50, frameId: 'f1', resource: scene('s1') }),
			placement('p2', { x: 500, y: 400, resource: { type: 'file', path: 'a/b.png' } }),
			placement('p3', { x: 20, y: 60, frameId: 'f1', resource: { type: 'task', id: 't1', name: '' } }),
			placement('p4', { resource: { type: 'file', path: 'a/b.png' } }),
			placement('p5', { resource: { type: 'link', url: 'https://a.b', label: '' } }),
		],
		edges: [edge('e1', 'p1', 'p2'), edge('e2', 'p3', 'f1'), edge('e3', 'p4', 'p5')],
	});

	it('finds a frame’s members, a node’s edges and the box that holds what is named', () => {
		expect(freeformFrameMembers(standing, 'f1').map((entry) => entry.id)).toEqual(['p1', 'p3']);
		expect(freeformEdgesOf(standing, new Set(['p1', 'f1'])).map((entry) => entry.id)).toEqual(['e1', 'e2']);
		expect(freeformBounds(standing, ['p1', 'p2', 'gone'])).toEqual({ x: 10, y: 50, width: 590, height: 410 });
		expect(freeformBounds(standing, ['gone'])).toBeNull();
		expect(findFreeformPlacement(standing, 'f1')).toBeUndefined();
		expect(findFreeformFrame(standing, 'f1')?.id).toBe('f1');
	});

	it('says which families the view places, and which files, each once', () => {
		expect([...freeformPlacedTypes(standing)].sort()).toEqual(['file', 'task']);
		expect(freeformPlacedFilePaths(standing)).toEqual(['a/b.png']);
	});

	it('keys what is the same thing twice, and nothing that is its own words', () => {
		expect(freeformResourceKey(scene('s1'))).toBe('entity s1');
		expect(freeformResourceKey({ type: 'task', id: 't1', name: '' })).toBe('task t1');
		expect(freeformResourceKey({ type: 'file', path: 'a/b.png' })).toBe('file a/b.png');
		expect(freeformResourceKey(text('a'))).toBeNull();
		expect(freeformResourceKey({ type: 'link', url: 'https://a.b', label: '' })).toBeNull();
	});

	it('counts the room a view has left', () => {
		expect(freeformRoom(standing)).toEqual({
			placements: FREEFORM_LIMITS.placements - 5,
			frames: FREEFORM_LIMITS.frames - 1,
			edges: FREEFORM_LIMITS.edges - 3,
		});
		expect(freeformRoom(standing, { ...FREEFORM_LIMITS, placements: 2 }).placements).toBe(0);
	});

	it('paints a band low under high, equals in the order kept', () => {
		const band = [placement('a', { zIndex: 2 }), placement('b', { zIndex: 0 }), placement('c', { zIndex: 2 }), placement('d', { zIndex: 1 })];
		expect(freeformStacking(band).map((entry) => entry.id)).toEqual(['b', 'd', 'a', 'c']);
	});
});

describe('adding', () => {
	it('adds one and many, each over the last, and stamps the view', () => {
		const before = view({ placements: [placement('p0', { zIndex: 4 })] });
		const done = take(before, [{
			do: 'add',
			placements: [
				{ id: 'p1', resource: scene('s1'), x: 10.6, y: 20.2, width: 200, height: 120, displayMode: 'compact' },
				{ id: 'p2', resource: text('hello'), x: 0, y: 0 },
			],
		}]);
		expect(done.came).toBe('written');
		expect(done.view.updatedAt).toBe(9);
		expect(done.view.placements.slice(1)).toEqual([
			placement('p1', { resource: scene('s1'), x: 11, y: 20, width: 200, height: 120, displayMode: 'compact', zIndex: 5 }),
			placement('p2', { resource: text('hello'), width: FREEFORM_SIZE.width, height: FREEFORM_SIZE.height, zIndex: 6 }),
		]);
		expect(done.inverse).toEqual([{ do: 'delete', nodes: ['p1', 'p2'], edges: [] }]);
		undone(before, [{ do: 'add', placements: [{ id: 'p1', resource: text('a'), x: 0, y: 0 }] }]);
	});

	it('lands a node free where the frame it was aimed at has gone', () => {
		const before = view({ frames: [frame('f1')] });
		const done = take(before, [{
			do: 'add',
			placements: [
				{ id: 'p1', resource: text('a'), x: 0, y: 0, frameId: 'f1' },
				{ id: 'p2', resource: text('b'), x: 0, y: 0, frameId: 'gone' },
			],
		}]);
		expect(done.view.placements.map((entry) => entry.frameId)).toEqual(['f1', null]);
	});

	it('refuses a twin, a draft that will not read, and words past the cap, all or nothing', () => {
		const before = view({ placements: [placement('p0')], frames: [frame('f0')] });
		const good = { id: 'p1', resource: text('a'), x: 0, y: 0 };
		for (const bad of [
			{ id: 'p0', resource: text('a'), x: 0, y: 0 },
			{ id: 'f0', resource: text('a'), x: 0, y: 0 },
			{ id: 'p1', resource: text('twice'), x: 0, y: 0 },
			{ id: '', resource: text('a'), x: 0, y: 0 },
			{ id: 'p2', resource: { type: 'link', url: 'nowhere', label: '' } as FreeformResource, x: 0, y: 0 },
			{ id: 'p2', resource: text('a'), x: NaN, y: 0 },
			{ id: 'p2', resource: text('x'.repeat(FREEFORM_LIMITS.textLength + 1)), x: 0, y: 0 },
			{ id: 'p2', resource: { type: 'link', url: 'https://a.b', label: 'x'.repeat(FREEFORM_LIMITS.labelLength + 1) } as FreeformResource, x: 0, y: 0 },
		]) {
			const done = take(before, [{ do: 'add', placements: [good, bad] }]);
			expect(done.came, JSON.stringify(bad).slice(0, 60)).toBe('refused');
			expect(done.view).toBe(before);
			expect(done.inverse).toEqual([]);
		}
	});

	it('says a view is full rather than taking some of what was asked', () => {
		const limits = { ...FREEFORM_LIMITS, placements: 2, frames: 1, edges: 1 };
		const before = view({ placements: [placement('p0'), placement('p1')], frames: [frame('f0')], edges: [edge('e0', 'p0', 'p1')] });
		expect(take(before, [{ do: 'add', placements: [{ id: 'p2', resource: text('a'), x: 0, y: 0 }] }], limits).came).toBe('full');
		expect(take(before, [{ do: 'add-frames', frames: [{ id: 'f1', title: '', color: null, x: 0, y: 0 }] }], limits).came).toBe('full');
		expect(take(before, [{ do: 'connect', edges: [{ id: 'e1', source: 'p1', target: 'p0' }] }], limits).came).toBe('full');
		expect(take(before, [{ do: 'group', frame: { id: 'f1', title: '', color: null }, members: ['p0'] }], limits).came).toBe('full');
	});

	it('adds frames over the frames that stand, and takes them back', () => {
		const before = view({ frames: [frame('f0', { zIndex: 2 })] });
		const after = undone(before, [{ do: 'add-frames', frames: [{ id: 'f1', title: 'Act I', color: 'macaron-2', x: 5, y: 6, width: 500, height: 400 }] }]);
		expect(after.frames[1]).toEqual(frame('f1', { title: 'Act I', color: 'macaron-2', x: 5, y: 6, width: 500, height: 400, zIndex: 3 }));
		expect(take(before, [{ do: 'add-frames', frames: [{ id: 'f1', title: 'x'.repeat(FREEFORM_LIMITS.labelLength + 1), color: null, x: 0, y: 0 }] }]).came).toBe('refused');
	});
});

describe('placing', () => {
	const standing = (): FreeformView => view({
		frames: [frame('f1', { x: 0, y: 0, width: 400, height: 300 }), frame('f2', { x: 1000, y: 0 })],
		placements: [
			placement('p1', { x: 10, y: 50, frameId: 'f1' }),
			placement('p2', { x: 100, y: 60, frameId: 'f1' }),
			placement('p3', { x: 600, y: 600 }),
		],
	});

	it('stands a node where it is told, in whole units, and at the size it is told', () => {
		const after = undone(standing(), [{ do: 'place', places: [{ id: 'p3', x: 12.4, y: -7.5, width: 300.2, height: 10 }] }]);
		expect(findFreeformPlacement(after, 'p3')).toMatchObject({ x: 12, y: -7, width: 300, height: FREEFORM_SIZE.min });
	});

	it('writes nothing for a nudge that stays within the unit, and takes it for written', () => {
		const before = standing();
		const done = take(before, [{ do: 'place', places: [{ id: 'p3', x: 600.4, y: 599.6 }] }]);
		expect(done).toEqual({ came: 'written', view: before, inverse: [], changed: false });
	});

	it('moves nothing twice for a write made twice, since a place is a target', () => {
		const once = take(standing(), [{ do: 'place', places: [{ id: 'p3', x: 700, y: 700 }] }]).view;
		const twice = take(once, [{ do: 'place', places: [{ id: 'p3', x: 700, y: 700 }] }]);
		expect(twice.changed).toBe(false);
		expect(findFreeformPlacement(twice.view, 'p3')).toMatchObject({ x: 700, y: 700 });
	});

	it('carries a frame’s members by as far as the frame went, and takes it all back', () => {
		const after = undone(standing(), [{ do: 'place', places: [{ id: 'f1', x: 30, y: -20 }] }]);
		expect(findFreeformFrame(after, 'f1')).toMatchObject({ x: 30, y: -20, width: 400, height: 300 });
		expect(findFreeformPlacement(after, 'p1')).toMatchObject({ x: 40, y: 30 });
		expect(findFreeformPlacement(after, 'p2')).toMatchObject({ x: 130, y: 40 });
		expect(findFreeformPlacement(after, 'p3')).toMatchObject({ x: 600, y: 600 });
	});

	it('gives a member named beside its frame the place it was itself given', () => {
		const after = undone(standing(), [{ do: 'place', places: [{ id: 'f1', x: 30, y: 0 }, { id: 'p1', x: 500, y: 500 }] }]);
		expect(findFreeformPlacement(after, 'p1')).toMatchObject({ x: 500, y: 500, frameId: 'f1' });
		expect(findFreeformPlacement(after, 'p2')).toMatchObject({ x: 130, y: 60 });
	});

	it('moves no member for a frame that was only resized', () => {
		const after = undone(standing(), [{ do: 'place', places: [{ id: 'f1', x: 0, y: 0, width: 800, height: 600 }] }]);
		expect(findFreeformPlacement(after, 'p1')).toMatchObject({ x: 10, y: 50 });
	});

	it('takes a node into a frame, out of one and across in the write that moves it', () => {
		const into = undone(standing(), [{ do: 'place', places: [{ id: 'p3', x: 50, y: 50, frameId: 'f1' }] }]);
		expect(findFreeformPlacement(into, 'p3')?.frameId).toBe('f1');
		const out = undone(standing(), [{ do: 'place', places: [{ id: 'p1', x: 900, y: 900, frameId: null }] }]);
		expect(findFreeformPlacement(out, 'p1')?.frameId).toBeNull();
		const across = undone(standing(), [{ do: 'place', places: [{ id: 'p1', x: 1010, y: 50, frameId: 'f2' }] }]);
		expect(findFreeformPlacement(across, 'p1')?.frameId).toBe('f2');
		// With no frame named, the one that holds the node is kept.
		const kept = take(standing(), [{ do: 'place', places: [{ id: 'p1', x: 11, y: 50 }] }]).view;
		expect(findFreeformPlacement(kept, 'p1')?.frameId).toBe('f1');
	});

	it('passes over a node that has gone, and names nothing when none of them stands', () => {
		const some = take(standing(), [{ do: 'place', places: [{ id: 'gone', x: 1, y: 1 }, { id: 'p3', x: 1, y: 1 }] }]);
		expect(some.came).toBe('written');
		expect(findFreeformPlacement(some.view, 'p3')).toMatchObject({ x: 1, y: 1 });
		expect(take(standing(), [{ do: 'place', places: [{ id: 'gone', x: 1, y: 1 }] }]).came).toBe('absent');
		expect(take(standing(), [{ do: 'place', places: [{ id: 'p3', x: 1, y: 1, frameId: 'gone' }] }]).came).toBe('absent');
		expect(take(standing(), [{ do: 'place', places: [{ id: 'p3', x: Infinity, y: 1 }] }]).came).toBe('refused');
	});

	it('gives placements to a frame and sets them free where they stand', () => {
		const after = undone(standing(), [{ do: 'reframe', members: [{ id: 'p3', frameId: 'f2' }, { id: 'p1', frameId: null }] }]);
		expect(after.placements.map((entry) => entry.frameId)).toEqual([null, 'f1', 'f2']);
		expect(findFreeformPlacement(after, 'p3')).toMatchObject({ x: 600, y: 600 });
		expect(take(standing(), [{ do: 'reframe', members: [{ id: 'p3', frameId: 'gone' }] }]).came).toBe('absent');
		expect(take(standing(), [{ do: 'reframe', members: [{ id: 'gone', frameId: 'f1' }] }]).came).toBe('absent');
		expect(take(standing(), [{ do: 'reframe', members: [{ id: 'p1', frameId: 'f1' }] }]).changed).toBe(false);
	});
});

describe('frames', () => {
	it('makes a frame round the placements named, which it then holds, and takes it back', () => {
		const before = view({
			frames: [frame('f0', { x: -500, y: -500 })],
			placements: [
				placement('p1', { x: 100, y: 100, width: 100, height: 60, frameId: 'f0' }),
				placement('p2', { x: 300, y: 200, width: 100, height: 60 }),
				placement('p3', { x: 900, y: 900 }),
			],
		});
		const after = undone(before, [{ do: 'group', frame: { id: 'f1', title: 'Act I', color: 'macaron-4' }, members: ['p1', 'p2', 'gone'] }]);
		expect(findFreeformFrame(after, 'f1')).toEqual(frame('f1', {
			title: 'Act I',
			color: 'macaron-4',
			x: 100 - FREEFORM_FRAME_PADDING,
			y: 100 - FREEFORM_FRAME_PADDING - FREEFORM_FRAME_HEAD,
			width: 300 + 2 * FREEFORM_FRAME_PADDING,
			height: 160 + 2 * FREEFORM_FRAME_PADDING + FREEFORM_FRAME_HEAD,
			zIndex: 1,
		}));
		expect(after.placements.map((entry) => entry.frameId)).toEqual(['f1', 'f1', null]);
	});

	it('makes no frame round nothing', () => {
		expect(take(view({ frames: [frame('f0')] }), [{ do: 'group', frame: { id: 'f1', title: '', color: null }, members: ['gone', 'f0'] }]).came).toBe('absent');
	});

	it('retitles and recolours a frame, each only where it was named', () => {
		const before = view({ frames: [frame('f1', { title: 'Old', color: 'macaron-1' })] });
		expect(undone(before, [{ do: 'edit-frame', id: 'f1', title: 'New' }]).frames[0]).toMatchObject({ title: 'New', color: 'macaron-1' });
		expect(undone(before, [{ do: 'edit-frame', id: 'f1', color: null }]).frames[0]).toMatchObject({ title: 'Old', color: null });
		expect(take(before, [{ do: 'edit-frame', id: 'f1', title: 'Old' }]).changed).toBe(false);
		expect(take(before, [{ do: 'edit-frame', id: 'gone', title: 'x' }]).came).toBe('absent');
		expect(take(before, [{ do: 'edit-frame', id: 'f1', color: 'red' as never }]).came).toBe('refused');
	});

	it('keeps a deleted frame’s members where they stood, free of it, and gives them back with it', () => {
		const before = view({
			frames: [frame('f1')],
			placements: [placement('p1', { x: 10, y: 50, frameId: 'f1' }), placement('p2', { x: 700, y: 700 })],
			edges: [edge('e1', 'p1', 'f1'), edge('e2', 'p1', 'p2')],
		});
		const after = undone(before, [{ do: 'delete', nodes: ['f1'], edges: [] }]);
		expect(after.frames).toEqual([]);
		expect(after.placements).toEqual([placement('p1', { x: 10, y: 50 }), placement('p2', { x: 700, y: 700 })]);
		expect(after.edges.map((entry) => entry.id)).toEqual(['e2']);
	});

	it('takes a frame and its members together when both are named', () => {
		const before = view({
			frames: [frame('f1')],
			placements: [placement('p1', { frameId: 'f1', zIndex: 3 }), placement('p2', { zIndex: 1 })],
			edges: [edge('e1', 'p1', 'p2')],
		});
		const after = undone(before, [{ do: 'delete', nodes: ['f1', 'p1'], edges: [] }]);
		expect(after.placements.map((entry) => entry.id)).toEqual(['p2']);
		expect(after.edges).toEqual([]);
	});
});

describe('depth', () => {
	/** Four in a pile and one that stands apart: a, b, c, d lie across one another, e across none. */
	const pile = (): FreeformView => view({
		placements: [
			placement('a', { zIndex: 0 }),
			placement('b', { zIndex: 1, x: 10 }),
			placement('e', { zIndex: 2, x: 5000 }),
			placement('c', { zIndex: 3, x: 20 }),
			placement('d', { zIndex: 4, x: 30 }),
		],
		frames: [frame('f1', { zIndex: 0 }), frame('f2', { zIndex: 1 })],
	});
	const order = (of: FreeformView): string[] => freeformStacking(of.placements).map((entry) => entry.id);

	it('sends what is chosen to the front and to the back, in the order it stood in', () => {
		expect(order(undone(pile(), [{ do: 'restack', ids: ['b', 'a'], to: 'front' }]))).toEqual(['e', 'c', 'd', 'a', 'b']);
		expect(order(undone(pile(), [{ do: 'restack', ids: ['d', 'c'], to: 'back' }]))).toEqual(['c', 'd', 'a', 'b', 'e']);
	});

	it('steps forward past the nearest node it lies across, not past whatever is numbered next', () => {
		// b lies under e by number, but across c: it rises over c.
		expect(order(undone(pile(), [{ do: 'restack', ids: ['b'], to: 'forward' }]))).toEqual(['a', 'e', 'c', 'b', 'd']);
		expect(order(undone(pile(), [{ do: 'restack', ids: ['c'], to: 'backward' }]))).toEqual(['a', 'c', 'b', 'e', 'd']);
	});

	it('keeps the chosen in their own order as they step together', () => {
		expect(order(undone(pile(), [{ do: 'restack', ids: ['a', 'b'], to: 'forward' }]))).toEqual(['e', 'c', 'a', 'b', 'd']);
	});

	it('leaves a node that lies across nothing, and the one already on top, where they stand', () => {
		expect(take(pile(), [{ do: 'restack', ids: ['e'], to: 'forward' }]).changed).toBe(false);
		expect(take(pile(), [{ do: 'restack', ids: ['d'], to: 'forward' }]).changed).toBe(false);
		expect(take(pile(), [{ do: 'restack', ids: ['a'], to: 'backward' }]).changed).toBe(false);
		expect(take(pile(), [{ do: 'restack', ids: ['d'], to: 'front' }]).changed).toBe(false);
	});

	it('numbers the band afresh from nothing, and leaves a node whose number did not move as it was', () => {
		const before = view({ placements: [placement('a', { zIndex: 10 }), placement('b', { zIndex: 20, x: 10 }), placement('c', { zIndex: 30, x: 20 })] });
		const done = take(before, [{ do: 'restack', ids: ['a'], to: 'front' }]);
		expect(done.view.placements.map((entry) => [entry.id, entry.zIndex])).toEqual([['a', 2], ['b', 0], ['c', 1]]);
		expect(done.inverse).toEqual([{ do: 'stack', order: [{ id: 'a', zIndex: 10 }, { id: 'b', zIndex: 20 }, { id: 'c', zIndex: 30 }] }]);
	});

	it('restacks frames among frames and placements among placements', () => {
		const after = undone(pile(), [{ do: 'restack', ids: ['f1', 'a'], to: 'front' }]);
		expect(freeformStacking(after.frames).map((entry) => entry.id)).toEqual(['f2', 'f1']);
		expect(order(after)).toEqual(['b', 'e', 'c', 'd', 'a']);
	});

	it('names nothing when none of what was chosen stands', () => {
		expect(take(pile(), [{ do: 'restack', ids: ['gone'], to: 'front' }]).came).toBe('absent');
		expect(take(pile(), [{ do: 'stack', order: [{ id: 'gone', zIndex: 1 }] }]).came).toBe('absent');
		expect(take(pile(), [{ do: 'stack', order: [{ id: 'a', zIndex: NaN }] }]).came).toBe('refused');
	});
});

describe('words and modes', () => {
	it('edits a text node’s words and takes the old ones back', () => {
		const before = view({ placements: [placement('p1', { resource: text('old') }), placement('p2', { resource: scene('s1') })] });
		expect(undone(before, [{ do: 'text', id: 'p1', text: 'new' }]).placements[0]?.resource).toEqual(text('new'));
		expect(take(before, [{ do: 'text', id: 'p1', text: 'old' }]).changed).toBe(false);
		expect(take(before, [{ do: 'text', id: 'p2', text: 'new' }]).came).toBe('absent');
		expect(take(before, [{ do: 'text', id: 'gone', text: 'new' }]).came).toBe('absent');
		expect(take(before, [{ do: 'text', id: 'p1', text: 'x'.repeat(FREEFORM_LIMITS.textLength + 1) }]).came).toBe('refused');
	});

	it('edits a link’s address and label, each only where it was named', () => {
		const before = view({ placements: [placement('p1', { resource: { type: 'link', url: 'https://a.b', label: 'A' } })] });
		expect(undone(before, [{ do: 'link', id: 'p1', url: 'https://c.d' }]).placements[0]?.resource)
			.toEqual({ type: 'link', url: 'https://c.d', label: 'A' });
		expect(undone(before, [{ do: 'link', id: 'p1', label: '' }]).placements[0]?.resource)
			.toEqual({ type: 'link', url: 'https://a.b', label: '' });
		expect(take(before, [{ do: 'link', id: 'p1', url: 'mailto:a@b.c' }]).came).toBe('refused');
		expect(take(before, [{ do: 'link', id: 'p1', url: 'https://a.b', label: 'A' }]).changed).toBe(false);
	});

	it('sets the mode of each placement named, and names nothing when none stands', () => {
		const before = view({ placements: [placement('p1'), placement('p2', { displayMode: 'compact' })] });
		const after = undone(before, [{ do: 'display', modes: [{ id: 'p1', mode: 'extended' }, { id: 'p2', mode: 'compact' }, { id: 'gone', mode: 'auto' }] }]);
		expect(after.placements.map((entry) => entry.displayMode)).toEqual(['extended', 'compact']);
		expect(after.placements[1]).toBe(before.placements[1]);
		expect(take(before, [{ do: 'display', modes: [{ id: 'gone', mode: 'auto' }] }]).came).toBe('absent');
		expect(take(before, [{ do: 'display', modes: [{ id: 'p1', mode: 'huge' as never }] }]).came).toBe('refused');
	});
});

describe('edges', () => {
	const standing = (): FreeformView => view({
		frames: [frame('f1')],
		placements: [placement('p1'), placement('p2'), placement('p3')],
		edges: [edge('e1', 'p1', 'p2', { label: 'knows', arrow: 'both', line: 'dashed', sourceSide: 'right', targetSide: 'left' })],
	});

	it('connects two nodes, a frame among them, and takes the line back', () => {
		const after = undone(standing(), [{ do: 'connect', edges: [{ id: 'e2', source: 'p3', target: 'f1', targetSide: 'top', label: 'in' }] }]);
		expect(after.edges[1]).toEqual(edge('e2', 'p3', 'f1', { targetSide: 'top', label: 'in' }));
	});

	it('refuses a loop and a twin, and names nothing where an end is not there', () => {
		expect(take(standing(), [{ do: 'connect', edges: [{ id: 'e2', source: 'p1', target: 'p1' }] }]).came).toBe('refused');
		expect(take(standing(), [{ do: 'connect', edges: [{ id: 'e1', source: 'p2', target: 'p3' }] }]).came).toBe('refused');
		expect(take(standing(), [{ do: 'connect', edges: [{ id: 'e2', source: 'p1', target: 'gone' }] }]).came).toBe('absent');
		expect(take(standing(), [{ do: 'connect', edges: [{ id: 'e2', source: 'p1', target: 'p3', label: 'x'.repeat(FREEFORM_LIMITS.labelLength + 1) }] }]).came).toBe('refused');
	});

	it('moves an end to another node or another side, and turns a line about', () => {
		expect(undone(standing(), [{ do: 'reconnect', id: 'e1', target: 'p3', targetSide: null }]).edges[0])
			.toMatchObject({ source: 'p1', target: 'p3', sourceSide: 'right', targetSide: null });
		expect(undone(standing(), [{ do: 'reconnect', id: 'e1', source: 'p2', target: 'p1', sourceSide: 'left', targetSide: 'right' }]).edges[0])
			.toMatchObject({ source: 'p2', target: 'p1', sourceSide: 'left', targetSide: 'right' });
		expect(take(standing(), [{ do: 'reconnect', id: 'e1', target: 'p1' }]).came).toBe('refused');
		expect(take(standing(), [{ do: 'reconnect', id: 'e1', target: 'gone' }]).came).toBe('absent');
		expect(take(standing(), [{ do: 'reconnect', id: 'gone', target: 'p3' }]).came).toBe('absent');
		expect(take(standing(), [{ do: 'reconnect', id: 'e1', targetSide: 'left' }]).changed).toBe(false);
	});

	it('restyles the edges named, each part only where it was named', () => {
		const after = undone(standing(), [{ do: 'edit-edges', edits: [{ id: 'e1', label: 'hates', line: 'dotted' }] }]);
		expect(after.edges[0]).toMatchObject({ label: 'hates', arrow: 'both', line: 'dotted' });
		expect(take(standing(), [{ do: 'edit-edges', edits: [{ id: 'e1', arrow: 'start' as never }] }]).came).toBe('refused');
		expect(take(standing(), [{ do: 'edit-edges', edits: [{ id: 'gone', label: 'x' }] }]).came).toBe('absent');
	});

	it('takes an edge off by its own name, and with either of its ends', () => {
		const before = view({
			placements: [placement('p1'), placement('p2'), placement('p3')],
			edges: [edge('e1', 'p1', 'p2'), edge('e2', 'p2', 'p3'), edge('e3', 'p3', 'p1')],
		});
		expect(undone(before, [{ do: 'delete', nodes: [], edges: ['e2'] }]).edges.map((entry) => entry.id)).toEqual(['e1', 'e3']);
		expect(undone(before, [{ do: 'delete', nodes: ['p1'], edges: [] }]).edges.map((entry) => entry.id)).toEqual(['e2']);
		expect(take(before, [{ do: 'delete', nodes: ['gone'], edges: ['nor this'] }]).came).toBe('absent');
	});
});

describe('deleting and restoring', () => {
	it('takes a twin stray with what it deletes, which would else stand in its place at the next read', () => {
		const twin = { id: 'p1', resource: { type: 'text', text: 'twin' }, x: 0, y: 0 };
		const other = { id: 'p9', resource: { type: 'hologram' }, x: 0, y: 0 };
		const before = view({ placements: [placement('p1')], strays: { placements: [twin, other], frames: [], edges: [] } });
		const done = take(before, [{ do: 'delete', nodes: ['p1'], edges: [] }]);
		expect(done.view.strays.placements).toEqual([other]);
	});

	it('restores what went under the very ids and places it had', () => {
		const before = view({
			frames: [frame('f1', { zIndex: 3 })],
			placements: [placement('p1', { zIndex: 7, frameId: 'f1', resource: scene('s1', 'One') }), placement('p2', { zIndex: 2 })],
			edges: [edge('e1', 'p1', 'p2', { label: 'l' })],
		});
		const done = take(before, [{ do: 'delete', nodes: ['p1', 'f1'], edges: [] }]);
		const back = take(done.view, done.inverse);
		expect(back.came).toBe('written');
		expect(findFreeformPlacement(back.view, 'p1')).toEqual(before.placements[0]);
		expect(findFreeformFrame(back.view, 'f1')).toEqual(before.frames[0]);
		expect(back.view.edges).toEqual(before.edges);
		// What was put back stands at its list's end, and is painted where its number says.
		expect(back.view.placements.map((entry) => entry.id)).toEqual(['p2', 'p1']);
		expect(freeformStacking(back.view.placements).map((entry) => entry.id)).toEqual(['p2', 'p1']);
		// And what takes the restoring back is the deleting again.
		expect(held(take(back.view, back.inverse).view)).toEqual(held(done.view));
	});

	it('will not restore over an id taken since, or an edge whose end has gone since', () => {
		const before = view({ placements: [placement('p1'), placement('p2')], edges: [edge('e1', 'p1', 'p2')] });
		const done = take(before, [{ do: 'delete', nodes: ['p1'], edges: [] }]);
		const retaken = take(done.view, [{ do: 'add', placements: [{ id: 'p1', resource: text('another'), x: 0, y: 0 }] }]).view;
		expect(take(retaken, done.inverse).came).toBe('refused');
		const emptied = take(done.view, [{ do: 'delete', nodes: ['p2'], edges: [] }]).view;
		expect(take(emptied, done.inverse).came).toBe('absent');
		expect(take(done.view, done.inverse, { ...FREEFORM_LIMITS, placements: 1 }).came).toBe('full');
	});
});

describe('a list of steps', () => {
	it('takes them together, and undoes them last first', () => {
		const before = view({ placements: [placement('p1', { x: 0, y: 0 })] });
		const steps: FreeformStep[] = [
			{ do: 'add-frames', frames: [{ id: 'f1', title: 'Act I', color: null, x: 0, y: 0, width: 500, height: 400 }] },
			{ do: 'place', places: [{ id: 'p1', x: 40, y: 80, frameId: 'f1' }] },
			{ do: 'add', placements: [{ id: 'p2', resource: text('b'), x: 200, y: 80, frameId: 'f1' }] },
			{ do: 'connect', edges: [{ id: 'e1', source: 'p1', target: 'p2' }] },
		];
		const after = undone(before, steps);
		expect(after.placements.map((entry) => [entry.id, entry.frameId])).toEqual([['p1', 'f1'], ['p2', 'f1']]);
		expect(after.edges).toHaveLength(1);
		expect(take(before, steps).inverse.map((step) => step.do)).toEqual(['delete', 'delete', 'place', 'delete']);
	});

	it('takes none of them when one names what is not there', () => {
		const before = view({ placements: [placement('p1')] });
		const done = take(before, [
			{ do: 'place', places: [{ id: 'p1', x: 40, y: 80 }] },
			{ do: 'text', id: 'gone', text: 'x' },
		]);
		expect(done).toEqual({ came: 'absent', view: before, inverse: [], changed: false });
	});

	it('passes over a step that finds the view already as asked, and stamps only a view that moved', () => {
		const before = view({ placements: [placement('p1', { x: 5 })], updatedAt: 3 });
		const same = take(before, [{ do: 'place', places: [{ id: 'p1', x: 5, y: 0 }] }, { do: 'delete', nodes: [], edges: [] }, { do: 'add', placements: [] }]);
		expect(same.came).toBe('written');
		expect(same.view).toBe(before);
		const moved = take(before, [{ do: 'place', places: [{ id: 'p1', x: 5, y: 0 }] }, { do: 'text', id: 'p1', text: 'new' }]);
		expect(moved.view.updatedAt).toBe(9);
		expect(moved.inverse).toEqual([{ do: 'text', id: 'p1', text: 'p1' }]);
	});

	it('never changes the view it was handed', () => {
		const before = view({
			frames: [frame('f1')],
			placements: [placement('p1', { frameId: 'f1' }), placement('p2')],
			edges: [edge('e1', 'p1', 'p2')],
		});
		const frozen = JSON.stringify(before);
		take(before, [
			{ do: 'place', places: [{ id: 'f1', x: 50, y: 50 }] },
			{ do: 'restack', ids: ['p1'], to: 'front' },
			{ do: 'delete', nodes: ['p2'], edges: [] },
		]);
		expect(JSON.stringify(before)).toBe(frozen);
	});
});

describe('the clip', () => {
	const standing = (): FreeformView => view({
		frames: [frame('f1', { x: 100, y: 100, width: 400, height: 300, title: 'Act I', color: 'macaron-2' })],
		placements: [
			placement('p1', { x: 120, y: 160, frameId: 'f1', resource: scene('s1', 'One'), displayMode: 'compact', zIndex: 1 }),
			placement('p2', { x: 300, y: 160, frameId: 'f1', zIndex: 0 }),
			placement('p3', { x: 900, y: 900, zIndex: 2 }),
		],
		edges: [edge('e1', 'p1', 'p2', { label: 'then' }), edge('e2', 'p2', 'p3'), edge('e3', 'p1', 'f1')],
	});
	const mint = () => {
		const counts = { placement: 0, frame: 0, edge: 0 };
		return (kind: 'placement' | 'frame' | 'edge'): string => `${kind}-${++counts[kind]}`;
	};

	it('takes the nodes chosen, the members of the frames chosen, and the edges among them', () => {
		const clip = copyFreeformSelection(standing(), { nodes: ['f1'] });
		expect(clip?.frames.map((entry) => entry.id)).toEqual(['f1']);
		expect(clip?.placements.map((entry) => entry.id)).toEqual(['p1', 'p2']);
		expect(clip?.edges.map((entry) => entry.id)).toEqual(['e1', 'e3']);
		expect(clip?.origin).toEqual({ x: 100, y: 100 });
		expect(copyFreeformSelection(standing(), { nodes: ['gone'] })).toBeNull();
	});

	it('lays a copy down with its corner where it is told, under ids of its own', () => {
		const clip = copyFreeformSelection(standing(), { nodes: ['f1'] })!;
		const { steps, nodes } = freeformClipSteps(clip, { x: 1000, y: 2000 }, mint());
		expect(nodes).toEqual(['frame-1', 'placement-1', 'placement-2']);
		const after = take(standing(), steps);
		expect(after.came).toBe('written');
		expect(findFreeformFrame(after.view, 'frame-1')).toMatchObject({ x: 1000, y: 2000, width: 400, height: 300, title: 'Act I', color: 'macaron-2' });
		// In the order they were painted in, so the copy piles as the first did.
		expect(findFreeformPlacement(after.view, 'placement-1')).toMatchObject({ x: 1200, y: 2060, frameId: 'frame-1', resource: text('p2') });
		expect(findFreeformPlacement(after.view, 'placement-2')).toMatchObject({ x: 1020, y: 2060, frameId: 'frame-1', resource: scene('s1', 'One'), displayMode: 'compact' });
		expect(after.view.edges.slice(3)).toEqual([
			edge('edge-1', 'placement-2', 'placement-1', { label: 'then' }),
			edge('edge-2', 'placement-2', 'frame-1'),
		]);
	});

	it('sets a member free whose frame was not copied with it', () => {
		const clip = copyFreeformSelection(standing(), { nodes: ['p1', 'p3'] })!;
		expect(clip.edges).toEqual([]);
		const { steps } = freeformClipSteps(clip, { x: 0, y: 0 }, mint());
		const after = take(standing(), steps).view;
		expect(findFreeformPlacement(after, 'placement-1')?.frameId).toBeNull();
		expect(findFreeformPlacement(after, 'placement-1')).toMatchObject({ x: 0, y: 0 });
		expect(findFreeformPlacement(after, 'placement-2')).toMatchObject({ x: 780, y: 740 });
	});
});
