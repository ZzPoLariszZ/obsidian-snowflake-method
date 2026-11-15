/**
 * The timeline strip under the relationship graph: the project's times as
 * one axis, a point each, with the thumb on the time the graph is drawn at.
 * The strip draws and is told; what a time shows, and the time-lapse that
 * runs along the axis, are the shell's.
 *
 * The scrubber is the app's own range control, so a mouse, the arrow keys,
 * Home and End, and a screen reader all move it as they move any slider,
 * and the two buttons beside the play button step it for a hand that would
 * rather press than drag. The app draws the track, the played part and the
 * thumb, as it draws every slider's; behind the control the strip draws the
 * axis's points where the thumb's centre stops, the stronger ones where
 * something in sight changes, and under it the name of the one time the
 * thumb is on, which follows the thumb along the rail and never past either
 * end of it.
 *
 * A finger is the one hand the strip follows itself. A range control
 * answers a touch as the engine under it sees fit: one moves the thumb for
 * a touch on the line of the track alone, another only for a drag begun on
 * the thumb and takes a tap on a point for nothing. So wherever on the row
 * a finger lands and wherever it goes from there, the thumb is set on the
 * time nearest under it, the same on every tablet.
 */

import type { Translate } from './modals';
import { renderEmptyLine } from './pane-parts';
import { ticksFit } from './relationship-graph-timeline-layout';
import { paintSymbol, toolbarIconButton, watchFrameSize, type SymbolMemo } from './workspace-frame';

const BASE = 'snowflake-method-relationship-graph-timeline';
/** Where along the rail a point or the name stands, as a share of the thumb's travel. */
const AT = '--snowflake-method-graph-timeline-at';
/** The app's own measure of how far along a slider its thumb stands, which its rule for the played part reads. */
const FILL = '--slider-fill-ratio';

/** One time of the axis, as the strip draws it. */
export interface TimelinePoint {
	readonly name: string;
	readonly period: boolean;
	/** Whether a line in sight comes or goes at this time. */
	readonly changes: boolean;
}

export interface TimelineStripView {
	/** The axis. The same list handed again is taken as unchanged, and its points are not drawn afresh. */
	readonly points: readonly TimelinePoint[];
	/** The time the graph is drawn at. */
	readonly current: number;
	/** Where the thumb stands: on that time, or on its way to the next while a time-lapse glides. */
	readonly thumb: number;
	readonly playing: boolean;
	/** Whether some line in sight names a time, so there is something to play. */
	readonly dated: boolean;
}

export interface TimelineStripDeps {
	t: Translate;
	/** The thumb was set on a time, by a drag, a press on the rail or a key. */
	seek(index: number): void;
	step(by: 1 | -1): void;
	/** Play, or pause. */
	toggle(): void;
	pause(): void;
	/** The keyboard handed back to the graph. */
	leave(): void;
}

export interface TimelineStrip {
	el: HTMLElement;
	paint(view: TimelineStripView): void;
	dispose(): void;
}

const share = (index: number, count: number): string => String(count < 2 ? 0 : index / (count - 1));

export function renderGraphTimeline(host: HTMLElement, deps: TimelineStripDeps): TimelineStrip {
	const { t } = deps;
	// On a tablet the app reads a sideways drag anywhere in the workspace as a
	// swipe for a sidebar and takes the touch from under it, unless the thing
	// touched says otherwise. The app's own sliders say so, and so does the
	// strip, whole: a finger that lands beside the thumb is still after the axis.
	const el = host.createDiv({
		cls: BASE,
		attr: { role: 'group', 'aria-label': t('relationshipGraph.timeline'), 'data-ignore-swipe': 'true' },
	});

	// -- The transport ---------------------------------------------------------

	const transport = el.createDiv({ cls: `${BASE}-transport` });
	const previous = toolbarIconButton(transport, `${BASE}-previous`, 'skip-back', t('relationshipGraph.timeline.previous'));
	previous.addEventListener('click', () => {
		deps.step(-1);
	});
	const play = toolbarIconButton(transport, `${BASE}-play`, 'play', t('relationshipGraph.timeline.play'));
	const playMemo: SymbolMemo = { icon: 'play' };
	play.addEventListener('click', () => {
		deps.toggle();
	});
	const next = toolbarIconButton(transport, `${BASE}-next`, 'skip-forward', t('relationshipGraph.timeline.next'));
	next.addEventListener('click', () => {
		deps.step(1);
	});

	// -- The scrubber ----------------------------------------------------------

	const scrub = el.createDiv({ cls: `${BASE}-scrub` });
	// The rail is the strip's own drawing, behind the control: decoration, since
	// the control says the same to a screen reader in its own words.
	const rail = scrub.createDiv({ cls: `${BASE}-rail`, attr: { 'aria-hidden': 'true' } });
	// The app's slider class brings its rule for the played part with it.
	const range = scrub.createEl('input', {
		cls: `slider ${BASE}-range`,
		attr: { type: 'range', min: '0', max: '0', step: '1', 'aria-label': t('relationshipGraph.timeline.time') },
	});
	// The name of the time the thumb is on, under the rail: decoration too, the
	// control saying it as its value. The one line also says that no line in
	// sight names a time, where none does.
	const caption = scrub.createDiv({ cls: `${BASE}-caption`, attr: { 'aria-hidden': 'true' } });
	const captionName = caption.createSpan({ cls: `${BASE}-caption-name` });

	range.addEventListener('input', () => {
		const at = Number(range.value);
		if (Number.isFinite(at)) deps.seek(Math.round(at));
	});
	// A hand on the thumb takes the axis from a time-lapse before it moves it.
	range.addEventListener('pointerdown', () => {
		deps.pause();
	});
	range.addEventListener('keydown', (event) => {
		if (event.key === ' ') {
			event.preventDefault();
			event.stopPropagation();
			deps.toggle();
			return;
		}
		if (event.key !== 'Escape' || event.isComposing) return;
		// The view leaves full screen on an Escape it is not told was used, and
		// never hears one struck in a control: the strip answers its own.
		event.preventDefault();
		event.stopPropagation();
		if (playing) deps.pause();
		else deps.leave();
	});

	// -- A finger on the axis --------------------------------------------------

	/** The finger the axis follows, by the name its touches carry; null while none is on it. */
	let finger: number | null = null;
	/** The time nearest under a place across the page; null where there is no axis to be on. */
	const timeUnder = (clientX: number): number | null => {
		const count = points?.length ?? 0;
		if (count < 2 || range.disabled) return null;
		// The rail's box is the thumb's travel: the first time at one end, the last at the other.
		const box = rail.getBoundingClientRect();
		if (!(box.width > 0)) return null;
		const along = (clientX - box.left) / box.width;
		const share = rail.win.getComputedStyle(rail).direction === 'rtl' ? 1 - along : along;
		return Math.max(0, Math.min(count - 1, Math.round(share * (count - 1))));
	};
	const touchOf = (touches: TouchList, id: number): Touch | null => {
		for (let at = 0; at < touches.length; at += 1) {
			const touch = touches[at];
			if (touch !== undefined && touch.identifier === id) return touch;
		}
		return null;
	};
	const follow = (touch: Touch): void => {
		const at = timeUnder(touch.clientX);
		if (at !== null && at !== current) deps.seek(at);
	};
	range.addEventListener(
		'touchstart',
		(event) => {
			const touch = event.changedTouches[0];
			if (touch === undefined || range.disabled) return;
			// A second finger is not the axis's, while the first is still down.
			if (finger !== null && touchOf(event.touches, finger) !== null) return;
			// The touch is the strip's from here. The control's own answer to it is
			// declined, and with it the mouse events a browser makes of a tap, so
			// one hand moves the thumb and not two.
			event.preventDefault();
			finger = touch.identifier;
			deps.pause();
			follow(touch);
		},
		{ passive: false },
	);
	range.addEventListener(
		'touchmove',
		(event) => {
			const touch = finger === null ? null : touchOf(event.changedTouches, finger);
			if (touch === null) return;
			// The drag is the axis's, and none of it the page's to scroll by.
			event.preventDefault();
			follow(touch);
		},
		{ passive: false },
	);
	const lift = (event: TouchEvent): void => {
		if (finger !== null && touchOf(event.changedTouches, finger) !== null) finger = null;
	};
	range.addEventListener('touchend', lift);
	range.addEventListener('touchcancel', lift);

	/** The line a project with no time is told so in, made when it is first needed. */
	let emptyLine: HTMLElement | null = null;

	// -- Painting --------------------------------------------------------------

	let points: readonly TimelinePoint[] | null = null;
	let tickEls: HTMLElement[] = [];
	/** The last point wearing the played part's colour; -1 while none does. */
	let passed = -1;
	let current = -1;
	let playing = false;
	let railWidth = 0;
	/** What the line under the rail was last written for: the time, and whether anything in sight is dated. */
	let captionFor = '';
	let shownThumb = '';
	let shownStep = '';

	const drawTicks = (list: readonly TimelinePoint[]): void => {
		rail.empty();
		passed = -1;
		tickEls = list.map((point, index) => {
			const tick = rail.createSpan({ cls: `${BASE}-tick` });
			tick.toggleClass('is-change', point.changes);
			tick.toggleClass('is-period', point.period);
			tick.setCssProps({ [AT]: share(index, list.length) });
			return tick;
		});
	};

	/**
	 * The one line under the rail: the name of the time the thumb is on, set
	 * along the rail where that time stands, or, where no line in sight names
	 * a time, the word that says so, at the rail's start.
	 */
	const drawCaption = (list: readonly TimelinePoint[], at: number, dated: boolean): void => {
		const name = list[at]?.name ?? '';
		const says = dated || list.length === 0;
		const key = `${String(list.length)}|${String(at)}|${says ? name : ''}|${String(says)}`;
		if (key === captionFor) return;
		captionFor = key;
		captionName.setText(says ? name : t('relationshipGraph.timeline.undated'));
		caption.setCssProps({ [AT]: says ? share(at, list.length) : '0' });
	};

	let last: TimelineStripView | null = null;
	const paint = (view: TimelineStripView): void => {
		last = view;
		const list = view.points;
		const count = list.length;
		const none = count === 0;
		el.toggleClass('is-empty', none);
		if (none && emptyLine === null) {
			emptyLine = renderEmptyLine(el, t('relationshipGraph.timeline.empty')).line;
			emptyLine.addClass(`${BASE}-empty`);
		} else if (!none && emptyLine !== null) {
			emptyLine.remove();
			emptyLine = null;
		}
		if (list !== points) {
			points = list;
			drawTicks(list);
			range.max = String(Math.max(0, count - 1));
			range.disabled = count < 2;
			current = -1;
			captionFor = '';
			// The same time on another axis is another place along it: the thumb and the played part are set again.
			shownThumb = '';
		}
		playing = view.playing;
		el.toggleClass('is-playing', view.playing);
		const at = Math.max(0, Math.min(count - 1, view.current));
		if (at !== current) {
			tickEls[current]?.removeClass('is-current');
			tickEls[at]?.addClass('is-current');
			current = at;
			range.setAttribute('aria-valuetext', list[at]?.name ?? '');
		}
		el.toggleClass('is-undated', !view.dated && !none);
		// Points too close to tell apart are left out: the track says as much without them.
		rail.toggleClass('is-dense', !ticksFit(count, railWidth));
		drawCaption(list, at, view.dated);
		// A time-lapse glides the thumb between two times, which the control
		// allows only while it takes any value; at rest it stops on times alone,
		// so the keys step from one to the next.
		const step = view.playing ? 'any' : '1';
		if (step !== shownStep) {
			shownStep = step;
			range.step = step;
		}
		const thumb = String(view.playing ? view.thumb : at);
		if (thumb !== shownThumb) {
			shownThumb = thumb;
			range.value = thumb;
			range.setCssProps({ [FILL]: share(Number(thumb), count) });
		}
		// The points the thumb has passed, itself included. A time-lapse moves the
		// thumb on every frame, so only the points it crossed since the last are
		// touched, however many the axis has.
		const upTo = Math.min(tickEls.length - 1, Math.floor(Number(thumb)));
		for (let index = passed + 1; index <= upTo; index += 1) tickEls[index]?.addClass('is-passed');
		for (let index = passed; index > upTo; index -= 1) tickEls[index]?.removeClass('is-passed');
		passed = upTo;
		paintSymbol(play, playMemo, {
			icon: view.playing ? 'pause' : 'play',
			label: t(view.playing ? 'relationshipGraph.timeline.pause' : 'relationshipGraph.timeline.play'),
			disabled: !view.dated || count < 2,
		});
		previous.disabled = count < 2 || at <= 0;
		next.disabled = count < 2 || at >= count - 1;
	};

	// Whether the points have room is the rail's width to say, which moves with the pane.
	const measure = (): void => {
		const width = rail.clientWidth;
		if (width === railWidth) return;
		railWidth = width;
		if (last !== null) paint(last);
	};
	const stopWatching = watchFrameSize(el, [rail], measure);
	measure();

	return {
		el,
		paint,
		dispose: () => {
			stopWatching();
			el.remove();
		},
	};
}
