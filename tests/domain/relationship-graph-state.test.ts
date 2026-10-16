import { describe, expect, it } from 'vitest';

import {
	DEFAULT_GRAPH_FORCES,
	defaultEntityGraphState,
	defaultGraphColorName,
	forceSlider,
	patchEntityGraphState,
	readEntityGraphState,
	repelStrength,
	sameEntityGraphState,
	serializeEntityGraphState,
	sliderForce,
} from '../../src/domain/relationship-graph-state';

describe('the entity graph state', () => {
	it('starts with scenes hidden, relationship words on the lines and the native forces', () => {
		const state = defaultEntityGraphState();
		expect(state.filters).toEqual({ kindsOff: ['scene'], labelsOff: [], unresolved: true, orphans: true });
		expect(state.groups).toBeNull();
		expect(state.display).toEqual({ arrows: true, labels: 'relationship', textFade: 0, nodeSize: 1, lineSize: 1 });
		expect(state.forces.center).toBeCloseTo(0.5187, 3);
		expect(state.forces).toMatchObject({ repel: 10, link: 1, linkDistance: 250 });
		expect(state.local).toEqual({ depth: 1, incoming: true, outgoing: true, neighbours: false });
		expect(state.viewport).toBeNull();
	});

	it('maps a strength to the native slider and back', () => {
		for (const strength of [0.01, 0.1, 0.5, 1]) {
			expect(sliderForce(forceSlider(strength))).toBeCloseTo(strength, 9);
		}
		expect(forceSlider(1)).toBeCloseTo(1, 9);
		expect(sliderForce(0)).toBeCloseTo(0, 9);
		expect(sliderForce(1)).toBeCloseTo(1, 9);
		expect(DEFAULT_GRAPH_FORCES.center).toBe(forceSlider(0.1));
		expect(repelStrength(10)).toBe(1000);
	});

	it('reads anything that is not an object as the default state', () => {
		for (const value of [undefined, null, 7, 'state', []]) {
			expect(readEntityGraphState(value)).toEqual(defaultEntityGraphState());
		}
	});

	it('keeps every part that reads and falls back on every part that does not', () => {
		const read = readEntityGraphState({
			filters: { kindsOff: ['scene', 'scene', 'time', 7, ''], labelsOff: 'Family', unresolved: false, orphans: 'yes' },
			groups: [
				{ query: 'kind:location', color: '#FF0000' },
				{ query: 'kind:item', color: 'red' },
				{ query: 7, color: '#00ff00' },
				'group',
			],
			display: { arrows: false, labels: 'both', textFade: 9, nodeSize: -1, lineSize: 'thin' },
			forces: { center: 2, repel: 0.5, link: 'strong', linkDistance: 29 },
			local: { depth: 2.4, incoming: false, outgoing: 'no', neighbours: true },
			viewport: { x: 10, y: -5, k: 2 },
		});
		expect(read.filters).toEqual({ kindsOff: ['scene', 'time'], labelsOff: [], unresolved: false, orphans: true });
		expect(read.groups).toEqual([{ query: 'kind:location', color: '#ff0000' }]);
		expect(read.display).toEqual({ arrows: false, labels: 'both', textFade: 3, nodeSize: 0.1, lineSize: 1 });
		expect(read.forces).toEqual({ center: 1, repel: 0.5, link: DEFAULT_GRAPH_FORCES.link, linkDistance: 30 });
		expect(read.local).toEqual({ depth: 2, incoming: false, outgoing: true, neighbours: true });
		expect(read.viewport).toEqual({ x: 10, y: -5, k: 2 });
	});

	it('reads a label mode it does not know, a bad viewport and groups that are not a list as their defaults', () => {
		const read = readEntityGraphState({
			display: { labels: 'everything' },
			viewport: { x: 1, y: 2, k: 0 },
			groups: 'none',
		});
		expect(read.display.labels).toBe('relationship');
		expect(read.viewport).toBeNull();
		expect(read.groups).toBeNull();
		expect(readEntityGraphState({ viewport: { x: 1, y: Number.NaN, k: 1 } }).viewport).toBeNull();
		expect(readEntityGraphState({ groups: [] }).groups).toEqual([]);
	});

	it('writes what it reads', () => {
		const state = readEntityGraphState({
			filters: { kindsOff: [], labelsOff: ['Family'] },
			groups: [{ query: 'alice', color: '#123456' }],
			display: { labels: 'none' },
			viewport: { x: 1, y: 2, k: 0.5 },
		});
		expect(readEntityGraphState(serializeEntityGraphState(state))).toEqual(state);
		expect(sameEntityGraphState(state, readEntityGraphState(serializeEntityGraphState(state)))).toBe(true);
		expect(sameEntityGraphState(state, defaultEntityGraphState())).toBe(false);
	});

	it('patches whole parts, and tells a cleared viewport or groups from one left alone', () => {
		const state = defaultEntityGraphState();
		const moved = patchEntityGraphState(state, { viewport: { x: 1, y: 1, k: 1 } });
		expect(moved.viewport).toEqual({ x: 1, y: 1, k: 1 });
		expect(patchEntityGraphState(moved, { display: { ...state.display, arrows: false } }).viewport).toEqual(moved.viewport);
		expect(patchEntityGraphState(moved, { viewport: null }).viewport).toBeNull();
		const grouped = patchEntityGraphState(state, { groups: [{ query: 'kind:scene', color: '#000000' }] });
		expect(patchEntityGraphState(grouped, { filters: state.filters }).groups).toEqual(grouped.groups);
		expect(patchEntityGraphState(grouped, { groups: null }).groups).toBeNull();
	});

	it('colours the built-in kinds each their own way and cycles custom kinds in kind order', () => {
		expect(defaultGraphColorName('character', [])).toBe('purple');
		expect(defaultGraphColorName('scene', [])).toBe('orange');
		expect(defaultGraphColorName('time', [])).toBe('cyan');
		expect(defaultGraphColorName('location', [])).toBe('green');
		expect(defaultGraphColorName('item', [])).toBe('yellow');
		const customs = ['faction', 'spell', 'creature', 'ship'];
		expect(customs.map((kind) => defaultGraphColorName(kind, customs))).toEqual(['pink', 'blue', 'red', 'pink']);
		expect(defaultGraphColorName('unknown', customs)).toBe('pink');
	});
});
