import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';
import {
	renderGraphTimeline,
	type TimelinePoint,
	type TimelineStripView,
} from '../../src/ui/relationship-graph-timeline';

const STRIP = 'snowflake-method-relationship-graph-timeline';
const AT = '--snowflake-method-graph-timeline-at';

const point = (name: string, changes = false, period = false): TimelinePoint => ({ name, period, changes });
/** Seven times: the second, the fourth and the last change something, and the fifth is a period. */
const week = (): TimelinePoint[] => [
	point('Mon'), point('Tue', true), point('Wed'), point('Thu', true), point('Fri', false, true), point('Sat'), point('Sun', true),
];

function strip(view: Partial<TimelineStripView> = {}) {
	const dom = new CorkboardDom();
	const deps = {
		t: (key: string, vars?: Record<string, string | number>) =>
			vars === undefined ? key : `${key} ${Object.values(vars).join('/')}`,
		seek: vi.fn(),
		step: vi.fn(),
		toggle: vi.fn(),
		pause: vi.fn(),
		leave: vi.fn(),
	};
	const handle = renderGraphTimeline(dom.container as unknown as HTMLElement, deps);
	const el = dom.container.querySelector(`.${STRIP}`)!;
	const base: TimelineStripView = { points: week(), current: 0, thumb: 0, playing: false, dated: true, ...view };
	let shown = base;
	const paint = (next: Partial<TimelineStripView> = {}): void => {
		shown = { ...shown, ...next };
		handle.paint(shown);
	};
	paint();
	const part = (suffix: string): CorkboardElement => el.querySelector(`.${STRIP}-${suffix}`)!;
	const ticks = (): CorkboardElement[] => el.querySelectorAll(`.${STRIP}-tick`);
	/** A key struck on the control, as the page would deliver it. */
	const key = (name: string): { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> } => {
		const event = { key: name, isComposing: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
		for (const listener of part('range').listeners.get('keydown') ?? []) {
			(listener as unknown as (given: typeof event) => void)(event);
		}
		return event;
	};
	/** A touch on the control, as the page would deliver it: the fingers it tells of, and every finger still down. */
	const touch = (
		type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
		changed: [id: number, x: number][],
		down: [id: number, x: number][] = changed,
	): { preventDefault: ReturnType<typeof vi.fn> } => {
		const fingers = (list: [number, number][]) => list.map(([identifier, clientX]) => ({ identifier, clientX }));
		const event = { changedTouches: fingers(changed), touches: fingers(down), preventDefault: vi.fn() };
		for (const listener of part('range').listeners.get(type) ?? []) {
			(listener as unknown as (given: typeof event) => void)(event);
		}
		return event;
	};
	return { dom, deps, handle, el, paint, part, ticks, key, touch };
}

describe('the timeline strip', () => {
	it('is a named group: three buttons that step and play, the app\'s own slider named for what it sets, and the time it is on', () => {
		const view = strip();
		expect(view.el.getAttribute('role')).toBe('group');
		// Named by words of its own, out of sight: a label would be shown as a
		// tooltip to a pointer resting on the strip's own ground.
		expect(view.el.getAttribute('aria-label')).toBeNull();
		expect(view.part('name').textContent).toBe('relationshipGraph.timeline');
		expect(view.el.getAttribute('aria-labelledby')).toBe(view.part('name').getAttribute('id'));
		expect(view.part('name').getAttribute('id')).toMatch(new RegExp(`^${STRIP}-name-\\d+$`));
		// A tablet's sidebar swipe would take a finger's drag from under the thumb: the strip is marked as the app marks its own sliders.
		expect(view.el.getAttribute('data-ignore-swipe')).toBe('true');
		expect(view.part('transport').children.map((button) => button.getAttribute('aria-label'))).toEqual([
			'relationshipGraph.timeline.previous', 'relationshipGraph.timeline.play', 'relationshipGraph.timeline.next',
		]);
		const range = view.part('range');
		expect(range.getAttribute('type')).toBe('range');
		// The app's slider class brings the app's rule for the played part.
		expect(range.classes.has('slider')).toBe(true);
		expect(range.getAttribute('aria-label')).toBe('relationshipGraph.timeline.time');
		expect(range.getAttribute('aria-valuetext')).toBe('Mon');
		expect(range.max).toBe('6');
		expect(range.step).toBe('1');
		expect(range.value).toBe('0');
		// Under the rail stands the one name, the current time's, where that time stands along it.
		expect(view.part('caption-name').textContent).toBe('Mon');
		expect(view.part('caption').styles[AT]).toBe('0');
		// Nothing stands at the strip's end: no time's name there and no count of the times.
		expect(view.el.children.map((child) => [...child.classes].find((cls) => cls.startsWith(`${STRIP}-`)))).toEqual([
			`${STRIP}-name`, `${STRIP}-transport`, `${STRIP}-scrub`,
		]);
		expect(view.el.querySelector(`.${STRIP}-readout`)).toBeNull();
		// The points and the name under them are decoration: the control says the same in its own words.
		expect(view.part('rail').getAttribute('aria-hidden')).toBe('true');
		expect(view.part('caption').getAttribute('aria-hidden')).toBe('true');
	});

	it('draws a point for every time where the thumb\'s centre stops on it, the stronger where something changes', () => {
		const view = strip({ current: 3, thumb: 3 });
		expect(view.ticks()).toHaveLength(7);
		expect(view.ticks().map((tick) => tick.styles[AT])).toEqual(['0', String(1 / 6), String(2 / 6), '0.5', String(4 / 6), String(5 / 6), '1']);
		expect(view.ticks().map((tick) => tick.classes.has('is-change'))).toEqual([false, true, false, true, false, false, true]);
		expect(view.ticks().map((tick) => tick.classes.has('is-period'))).toEqual([false, false, false, false, true, false, false]);
		expect(view.ticks().map((tick) => tick.classes.has('is-current'))).toEqual([false, false, false, true, false, false, false]);
		// What the thumb has passed, itself included.
		expect(view.ticks().map((tick) => tick.classes.has('is-passed'))).toEqual([true, true, true, true, false, false, false]);
		expect(view.part('range').styles['--slider-fill-ratio']).toBe('0.5');
	});

	it('takes the played part\'s colour off the points a thumb moves back over, and sets the played part again on another axis', () => {
		const view = strip({ current: 5, thumb: 5 });
		expect(view.ticks().map((tick) => tick.classes.has('is-passed'))).toEqual([true, true, true, true, true, true, false]);
		view.paint({ current: 1, thumb: 1 });
		expect(view.ticks().map((tick) => tick.classes.has('is-passed'))).toEqual([true, true, false, false, false, false, false]);
		// A time-lapse's thumb between two times has passed the one behind it.
		view.paint({ playing: true, current: 1, thumb: 2.5 });
		expect(view.ticks().map((tick) => tick.classes.has('is-passed'))).toEqual([true, true, true, false, false, false, false]);
		view.paint({ playing: false, current: 2, thumb: 2 });
		expect(view.part('range').styles['--slider-fill-ratio']).toBe(String(2 / 6));
		// The same time on a shorter axis stands further along it.
		view.paint({ points: [point('One'), point('Two'), point('Three'), point('Four'), point('Five')], current: 2, thumb: 2 });
		expect(view.part('range').styles['--slider-fill-ratio']).toBe('0.5');
		expect(view.part('range').value).toBe('2');
		expect(view.ticks().map((tick) => tick.classes.has('is-passed'))).toEqual([true, true, true, false, false]);
	});

	it('leaves the points out where the times stand too close to tell apart, and draws them again once there is room', () => {
		const view = strip();
		// Seven points on a thousand pixels each have their room.
		expect(view.part('rail').classes.has('is-dense')).toBe(false);
		// A hundred and one on the same rail are ten pixels apart: one bar, so the axis is left to the track.
		view.paint({ points: Array.from({ length: 101 }, (_, at) => point(`T${String(at)}`)), current: 0, thumb: 0 });
		expect(view.ticks()).toHaveLength(101);
		expect(view.part('rail').classes.has('is-dense')).toBe(true);
		view.dom.resize(1300);
		expect(view.part('rail').classes.has('is-dense')).toBe(false);
		view.dom.resize(400);
		expect(view.part('rail').classes.has('is-dense')).toBe(true);
	});

	it('keeps the points it drew while it is handed the same axis, and draws them again for another', () => {
		const view = strip();
		const first = view.ticks()[0];
		view.paint({ current: 2, thumb: 2 });
		expect(view.ticks()[0]).toBe(first);
		expect(view.ticks()[2]!.classes.has('is-current')).toBe(true);
		expect(view.ticks()[0]!.classes.has('is-current')).toBe(false);
		// The same axis in a list made afresh, as the graph hands it with
		// every picture of its stage: nothing of it is drawn again, and the
		// thumb and the played part stand as they stood.
		view.paint({ points: week(), current: 3, thumb: 3 });
		expect(view.ticks()[0]).toBe(first);
		expect(view.ticks()[3]!.classes.has('is-current')).toBe(true);
		expect(view.ticks().map((tick) => tick.classes.has('is-passed'))).toEqual([true, true, true, true, false, false, false]);
		// One point that now changes something is another axis to draw.
		view.paint({ points: week().map((one, at) => (at === 0 ? { ...one, changes: true } : one)) });
		expect(view.ticks()[0]).not.toBe(first);
		expect(view.ticks()[0]!.classes.has('is-change')).toBe(true);
		view.paint({ points: [point('One'), point('Two')], current: 1, thumb: 1 });
		expect(view.ticks()).toHaveLength(2);
		expect(view.part('range').max).toBe('1');
		expect(view.part('caption-name').textContent).toBe('Two');
		expect(view.part('caption').styles[AT]).toBe('1');
	});

	it('writes one name under the rail, the current time\'s, and moves it along the rail with the time', () => {
		const view = strip({ current: 3, thumb: 3 });
		// No name is written for any other time, however much room the rail has.
		expect(view.el.querySelectorAll(`.${STRIP}-caption-name`)).toHaveLength(1);
		expect(view.el.querySelectorAll(`.${STRIP}-label`)).toEqual([]);
		expect(view.part('caption-name').textContent).toBe('Thu');
		expect(view.part('caption').styles[AT]).toBe('0.5');
		view.paint({ current: 6, thumb: 6 });
		expect(view.part('caption-name').textContent).toBe('Sun');
		expect(view.part('caption').styles[AT]).toBe('1');
		// A narrower pane writes the same one name: there are no others to thin.
		view.dom.resize(300);
		expect(view.el.querySelectorAll(`.${STRIP}-caption-name`)).toHaveLength(1);
		expect(view.part('caption-name').textContent).toBe('Sun');
		// While a time-lapse glides the thumb on, the name stays with the time the picture is of.
		view.paint({ playing: true, current: 2, thumb: 2.7 });
		expect(view.part('caption-name').textContent).toBe('Wed');
		expect(view.part('caption').styles[AT]).toBe(String(2 / 6));
	});

	it('tells of a time the thumb is set on, by whatever hand set it', () => {
		const view = strip();
		const range = view.part('range');
		range.value = '4';
		range.dispatch('input');
		expect(view.deps.seek).toHaveBeenLastCalledWith(4);
		// A value between two times is the nearer.
		range.value = '2.6';
		range.dispatch('input');
		expect(view.deps.seek).toHaveBeenLastCalledWith(3);
		range.value = 'nonsense';
		range.dispatch('input');
		expect(view.deps.seek).toHaveBeenCalledTimes(2);
		// A hand on the thumb takes the axis from a time-lapse first.
		range.dispatch('pointerdown');
		expect(view.deps.pause).toHaveBeenCalledOnce();
	});

	it('follows a finger wherever on the row it lands and goes, to the time nearest under it', () => {
		const view = strip();
		// Seven times a hundred pixels apart, the first at 100.
		view.part('rail').box = { left: 100, width: 600 };
		const down = view.touch('touchstart', [[7, 390]]);
		expect(view.deps.seek).toHaveBeenLastCalledWith(3);
		// The control's own answer to the touch, and the click a browser makes of a tap, are declined: one hand moves the thumb.
		expect(down.preventDefault).toHaveBeenCalledOnce();
		// A finger takes the axis from a time-lapse, as any hand does.
		expect(view.deps.pause).toHaveBeenCalledOnce();
		view.paint({ current: 3, thumb: 3 });
		// Still nearest the same time: nothing more is asked, and the drag is still not the page's to scroll by.
		const still = view.touch('touchmove', [[7, 430]]);
		expect(view.deps.seek).toHaveBeenCalledTimes(1);
		expect(still.preventDefault).toHaveBeenCalledOnce();
		view.touch('touchmove', [[7, 560]]);
		expect(view.deps.seek).toHaveBeenLastCalledWith(5);
		view.paint({ current: 5, thumb: 5 });
		// Past either end is the end.
		view.touch('touchmove', [[7, 2000]]);
		expect(view.deps.seek).toHaveBeenLastCalledWith(6);
		view.touch('touchmove', [[7, -50]]);
		expect(view.deps.seek).toHaveBeenLastCalledWith(0);
	});

	it('follows one finger at a time, and the next once the first is lifted', () => {
		const view = strip();
		view.part('rail').box = { left: 100, width: 600 };
		view.touch('touchstart', [[1, 200]]);
		expect(view.deps.seek).toHaveBeenLastCalledWith(1);
		view.paint({ current: 1, thumb: 1 });
		// A second finger set down beside the first, and its moves, are not the axis's.
		const second = view.touch('touchstart', [[2, 600]], [[1, 200], [2, 600]]);
		expect(second.preventDefault).not.toHaveBeenCalled();
		const moved = view.touch('touchmove', [[2, 650]], [[1, 200], [2, 650]]);
		expect(moved.preventDefault).not.toHaveBeenCalled();
		expect(view.deps.seek).toHaveBeenCalledTimes(1);
		// Lifting the second leaves the first on the axis.
		view.touch('touchend', [[2, 650]], [[1, 200]]);
		view.touch('touchmove', [[1, 300]]);
		expect(view.deps.seek).toHaveBeenLastCalledWith(2);
		view.paint({ current: 2, thumb: 2 });
		// Once it is lifted, a late move of it moves nothing, and another finger is followed.
		view.touch('touchend', [[1, 300]], []);
		view.touch('touchmove', [[1, 500]]);
		expect(view.deps.seek).toHaveBeenCalledTimes(2);
		view.touch('touchstart', [[3, 500]]);
		expect(view.deps.seek).toHaveBeenLastCalledWith(4);
		view.paint({ current: 4, thumb: 4 });
		// A finger whose lift was never told of is not waited for: the next one down alone is followed.
		view.touch('touchstart', [[4, 100]]);
		expect(view.deps.seek).toHaveBeenLastCalledWith(0);
	});

	it('reads the axis from its other end where the page runs right to left, and leaves an axis with nowhere to go to the page', () => {
		const view = strip();
		view.part('rail').box = { left: 100, width: 600 };
		const style = view.dom.win.getComputedStyle;
		view.dom.win.getComputedStyle = (element) => ({ ...style(element), direction: 'rtl' });
		view.touch('touchstart', [[1, 200]]);
		expect(view.deps.seek).toHaveBeenLastCalledWith(5);
		view.touch('touchend', [[1, 200]], []);
		// One time is no axis: the touch is not taken.
		view.paint({ points: [point('Only', true)], current: 0, thumb: 0 });
		const lone = view.touch('touchstart', [[2, 400]]);
		expect(lone.preventDefault).not.toHaveBeenCalled();
		expect(view.deps.seek).toHaveBeenCalledTimes(1);
	});

	it('steps from its two buttons, each stilled at its end', () => {
		const view = strip();
		expect(view.part('previous').disabled).toBe(true);
		expect(view.part('next').disabled).toBe(false);
		view.part('next').click();
		expect(view.deps.step).toHaveBeenLastCalledWith(1);
		view.paint({ current: 6, thumb: 6 });
		expect(view.part('next').disabled).toBe(true);
		view.part('previous').click();
		expect(view.deps.step).toHaveBeenLastCalledWith(-1);
		view.part('next').click();
		expect(view.deps.step).toHaveBeenCalledTimes(2);
	});

	it('plays and pauses from one button, whose symbol says what stands and whose name what a press does', () => {
		const view = strip();
		const play = view.part('play');
		expect(play.getAttribute('aria-label')).toBe('relationshipGraph.timeline.play');
		play.click();
		expect(view.deps.toggle).toHaveBeenCalledOnce();
		view.paint({ playing: true, thumb: 0.4 });
		expect(play.getAttribute('aria-label')).toBe('relationshipGraph.timeline.pause');
		expect(view.el.classes.has('is-playing')).toBe(true);
		// While it plays the thumb glides between two times, which the control allows only while it takes any value.
		expect(view.part('range').step).toBe('any');
		expect(view.part('range').value).toBe('0.4');
		expect(view.part('range').styles['--slider-fill-ratio']).toBe(String(0.4 / 6));
		view.paint({ playing: false, thumb: 0 });
		expect(view.part('range').step).toBe('1');
		expect(view.part('range').value).toBe('0');
	});

	it('answers the space bar and its own Escape on the control, and leaves the arrows to the control', () => {
		const view = strip();
		const space = view.key(' ');
		expect(view.deps.toggle).toHaveBeenCalledOnce();
		expect(space.preventDefault).toHaveBeenCalledOnce();
		expect(space.stopPropagation).toHaveBeenCalledOnce();
		// At rest, Escape hands the keyboard back to the graph; the view never hears it.
		const out = view.key('Escape');
		expect(view.deps.leave).toHaveBeenCalledOnce();
		expect(view.deps.pause).not.toHaveBeenCalled();
		expect(out.stopPropagation).toHaveBeenCalledOnce();
		// While a time-lapse plays, the first Escape only stops it.
		view.paint({ playing: true });
		view.key('Escape');
		expect(view.deps.pause).toHaveBeenCalledOnce();
		expect(view.deps.leave).toHaveBeenCalledOnce();
		const arrow = view.key('ArrowRight');
		expect(arrow.preventDefault).not.toHaveBeenCalled();
		expect(view.deps.seek).not.toHaveBeenCalled();
	});

	it('says so, and stills the three buttons and the thumb together, where no line in sight names a time', () => {
		// In the middle of the axis, where each of the two steps would have somewhere to go.
		const view = strip({ dated: false, current: 3, thumb: 3 });
		expect(view.el.classes.has('is-undated')).toBe(true);
		// The line under the rail says so, from the rail's start, in place of the time's name, which the control still says.
		expect(view.part('caption-name').textContent).toBe('relationshipGraph.timeline.undated');
		expect(view.part('caption').styles[AT]).toBe('0');
		expect(view.part('range').getAttribute('aria-valuetext')).toBe('Thu');
		// Every time draws the same graph, so there is nothing to play, to step to or to drag to.
		expect(view.part('previous').disabled).toBe(true);
		expect(view.part('play').disabled).toBe(true);
		expect(view.part('next').disabled).toBe(true);
		expect(view.part('range').disabled).toBe(true);
		// The axis still stands, its points drawn and the thumb where the time is.
		expect(view.ticks()).toHaveLength(7);
		expect(view.part('range').value).toBe('3');
		// A finger on the stilled axis moves nothing.
		const held = view.touch('touchstart', [[1, 500]]);
		expect(held.preventDefault).not.toHaveBeenCalled();
		expect(view.deps.seek).not.toHaveBeenCalled();
		expect(view.deps.pause).not.toHaveBeenCalled();
		// A line that names a time brings all four back, each step stilled only at its own end.
		view.paint({ dated: true, current: 3, thumb: 3 });
		expect(view.el.classes.has('is-undated')).toBe(false);
		expect(view.part('previous').disabled).toBe(false);
		expect(view.part('play').disabled).toBe(false);
		expect(view.part('next').disabled).toBe(false);
		expect(view.part('range').disabled).toBe(false);
		expect(view.part('caption-name').textContent).toBe('Thu');
		// And the last one going stills them again.
		view.paint({ dated: false, current: 3, thumb: 3 });
		expect(view.part('previous').disabled).toBe(true);
		expect(view.part('next').disabled).toBe(true);
		expect(view.part('range').disabled).toBe(true);
	});

	it('says a project has no time in the words every board says an empty list in, and takes them back when it has one', () => {
		const view = strip({ points: [], dated: false });
		expect(view.el.classes.has('is-empty')).toBe(true);
		const line = view.el.querySelector(`.${STRIP}-empty`)!;
		expect(line.classes.has('snowflake-method-character-empty')).toBe(true);
		expect(line.querySelectorAll('span').map((span) => span.textContent)).toContain('relationshipGraph.timeline.empty');
		expect(view.ticks()).toEqual([]);
		expect(view.part('range').disabled).toBe(true);
		expect(view.part('caption-name').textContent).toBe('');
		view.paint({ points: [point('Only', true)], dated: true });
		expect(view.el.classes.has('is-empty')).toBe(false);
		expect(view.el.querySelector(`.${STRIP}-empty`)).toBeNull();
		// One time is an axis with nowhere to go.
		expect(view.part('range').disabled).toBe(true);
		expect(view.part('play').disabled).toBe(true);
		expect(view.ticks().map((tick) => tick.styles[AT])).toEqual(['0']);
	});

	it('goes with the workspace, and hears no more of the pane\'s width', () => {
		const view = strip();
		view.handle.dispose();
		expect(view.dom.container.querySelector(`.${STRIP}`)).toBeNull();
		expect(view.dom.observers.every((observer) => observer.disconnected)).toBe(true);
	});
});
