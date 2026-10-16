import { describe, expect, it } from 'vitest';

import {
	arrowhead,
	clampZoom,
	curvePoint,
	distanceToCurve,
	drawnRadius,
	easeAlpha,
	edgeControl,
	edgeLabelAnchor,
	fitViewport,
	homeViewport,
	inBox,
	laneOffset,
	lineAlpha,
	nodeRadius,
	textAlpha,
	toScreen,
	toWorld,
	zoomAbout,
} from '../../src/ui/relationship-graph-layout';

describe('the native scalars', () => {
	it('sizes a disc by the square root of its links, between 8 and 30, times the node size', () => {
		expect(nodeRadius(0, 1)).toBe(8);
		expect(nodeRadius(8, 1)).toBe(9);
		expect(nodeRadius(99, 1)).toBe(30);
		expect(nodeRadius(0, 2)).toBe(16);
	});

	it('shrinks a disc less than the graph when zoomed out', () => {
		expect(drawnRadius(10, 1)).toBe(10);
		expect(drawnRadius(10, 0.25)).toBe(5);
		expect(drawnRadius(10, 4)).toBe(20);
	});

	it('fades labels a stop below zoom 1, moved by the threshold', () => {
		expect(textAlpha(1, 0)).toBe(1);
		expect(textAlpha(0.5, 0)).toBe(0);
		expect(textAlpha(0.75, 0)).toBeCloseTo(0.585, 3);
		expect(textAlpha(0.5, -1)).toBe(1);
		expect(textAlpha(2, 1)).toBe(1);
		expect(textAlpha(1, 1)).toBe(0);
	});

	it('fades lines out between zoom 0.8 and 0.3', () => {
		expect(lineAlpha(1)).toBe(1);
		expect(lineAlpha(0.8)).toBe(1);
		expect(lineAlpha(0.55)).toBeCloseTo(0.5, 6);
		expect(lineAlpha(0.3)).toBe(0);
		expect(lineAlpha(0.1)).toBe(0);
	});

	it('eases an alpha a tenth of the way, snapping when nearly there', () => {
		expect(easeAlpha(1, 0.2)).toBeCloseTo(0.92, 6);
		expect(easeAlpha(0.2001, 0.2)).toBe(0.2);
	});

	it('clamps the zoom to the native range', () => {
		expect(clampZoom(100)).toBe(8);
		expect(clampZoom(0)).toBe(1 / 128);
		expect(clampZoom(2)).toBe(2);
	});
});

describe('the view', () => {
	it('maps between world and screen and back', () => {
		const view = { x: 100, y: 50, k: 2 };
		expect(toScreen({ x: 10, y: -5 }, view)).toEqual({ x: 120, y: 40 });
		expect(toWorld({ x: 120, y: 40 }, view)).toEqual({ x: 10, y: -5 });
	});

	it('zooms about a screen point, which stays put', () => {
		const view = { x: 100, y: 50, k: 1 };
		const about = { x: 300, y: 200 };
		const zoomed = zoomAbout(view, 2, about);
		expect(zoomed.k).toBe(2);
		expect(toScreen(toWorld(about, view), zoomed)).toEqual(about);
		expect(zoomAbout({ x: 0, y: 0, k: 8 }, 2, about).k).toBe(8);
	});

	it('fits every disc inside the box with a margin, never zooming in past 1', () => {
		const points = [
			{ x: -100, y: 0 },
			{ x: 100, y: 0 },
		];
		const fitted = fitViewport(points, [10, 10], 400, 300, 40);
		// 220 wide with radii, 220 of room: zoom 1, centred.
		expect(fitted.k).toBe(1);
		expect(fitted).toEqual({ x: 200, y: 150, k: 1 });
		const tight = fitViewport(points, [10, 10], 200, 300, 40);
		expect(tight.k).toBeCloseTo(120 / 220, 6);
		expect(toScreen({ x: 0, y: 0 }, tight)).toEqual({ x: 100, y: 150 });
		const close = fitViewport([{ x: 5, y: 5 }], [8], 800, 600);
		expect(close.k).toBe(1);
		expect(toScreen({ x: 5, y: 5 }, close)).toEqual({ x: 400, y: 300 });
		expect(fitViewport([], [], 800, 600)).toEqual(homeViewport(800, 600));
	});

	it('knows what is in the box', () => {
		expect(inBox({ x: -10, y: 10 }, 100, 100, 20)).toBe(true);
		expect(inBox({ x: -30, y: 10 }, 100, 100, 20)).toBe(false);
		expect(inBox({ x: 110, y: 110 }, 100, 100, 20)).toBe(true);
	});
});

describe('the lines', () => {
	const source = { x: 0, y: 0 };
	const target = { x: 200, y: 0 };

	it('runs straight in lane 0 and curves apart in the other lanes, mirrored for a line running back', () => {
		expect(edgeControl(source, target, 0, true)).toEqual({ x: 100, y: 0 });
		const forward = edgeControl(source, target, 1, true);
		const back = edgeControl(target, source, 1, false);
		expect(forward.y).toBeCloseTo(40, 6);
		expect(back.y).toBeCloseTo(40, 6);
		expect(edgeControl(source, target, -1, true).y).toBeCloseTo(-40, 6);
		expect(edgeControl(source, source, 1, true)).toEqual({ x: 0, y: 0 });
	});

	it('widens lanes with the line, between 12 and 48', () => {
		expect(laneOffset(1, 30)).toBe(12);
		expect(laneOffset(1, 200)).toBe(40);
		expect(laneOffset(2, 1000)).toBe(96);
		expect(laneOffset(-0.5, 200)).toBe(-20);
	});

	it('puts the label at the curve’s middle', () => {
		const control = { x: 100, y: 40 };
		expect(curvePoint(source, control, target, 0)).toEqual(source);
		expect(curvePoint(source, control, target, 1)).toEqual(target);
		expect(edgeLabelAnchor(source, control, target)).toEqual({ x: 100, y: 20 });
	});

	it('draws the arrowhead at the target’s rim, pointing along the curve', () => {
		const head = arrowhead(source, { x: 100, y: 0 }, target, 10, 8);
		expect(head.tip).toEqual({ x: 190, y: 0 });
		expect(head.left.x).toBeCloseTo(182, 6);
		expect(head.right.x).toBeCloseTo(182, 6);
		expect(Math.abs(head.left.y)).toBeCloseTo(4, 6);
		expect(head.left.y).toBeCloseTo(-head.right.y, 6);
		expect(arrowhead(source, source, source, 10, 8).tip).toEqual(source);
	});

	it('measures the distance to a curve closely enough to pick a line', () => {
		const control = { x: 100, y: 40 };
		expect(distanceToCurve({ x: 100, y: 20 }, source, control, target)).toBeLessThan(0.5);
		expect(distanceToCurve({ x: 100, y: 0 }, source, control, target)).toBeCloseTo(20, 0);
		expect(distanceToCurve({ x: 100, y: 30 }, source, { x: 100, y: 0 }, target)).toBe(30);
	});
});
