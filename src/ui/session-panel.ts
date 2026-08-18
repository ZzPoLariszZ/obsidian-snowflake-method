import { setIcon } from 'obsidian';

import {
	HEATMAP_DAYS,
	HEATMAP_MEASURES,
	HEAT_LEVELS,
	axisScale,
	formatDay,
	heatLevels,
	trendTone,
	TREND_MEASURES,
	TREND_RANGES,
	addDays,
	dayOfMonth,
	dayOfWeek,
	daysBetween,
	formatClock,
	monthLabels,
	monthOfDay,
	weekStartIndex,
	weekdayLabels,
	type DateFormat,
	type HeatmapMeasure,
	type TrendMeasure,
	type WeekStartDay,
	type WritingMode,
	type WritingSessionScope,
	type WritingSessionType,
} from '../domain';
import type {
	LiveWritingSession,
	TodayWritingSummary,
	WritingDayTotals,
} from '../services';

/**
 * Which project a session panel is for, and how it should speak. Both are
 * omitted by a panel that belongs to no project in particular.
 */
export interface SessionPanelContext {
	/** The project metadata note whose day this panel reads. */
	projectPath?: string | null;
	/** That project's language, when the host already knows it. */
	locale?: 'en' | 'zh-CN' | null;
}

/**
 * Which reading each of the two history widgets is left on. It outlives the
 * panel -- a chart the author chose stays chosen when they come back to it,
 * and both panels are looking at the same one.
 */
export interface SessionHistoryView {
	trendDays: number;
	trendMeasure: TrendMeasure;
	heatmapMeasure: HeatmapMeasure;
}

/** What a panel puts in, beyond the three widgets every panel carries. */
export interface SessionPanelOptions {
	/** Whether the readings that span more than a day are shown. */
	history?: boolean;
}

/** The clock a new session starts on, and the conditions it starts under. */
export interface SessionSetup {
	type: WritingSessionType;
	countdownMinutes: number;
	pomodoroWorkMinutes: number;
	pomodoroBreakMinutes: number;
	/** Net words the session aims at, or 0 for no such condition. */
	goalNetWords: number;
	/** Focus minutes the session aims at, or 0 for no such condition. */
	goalFocusMinutes: number;
	/** The stage of the writing a session begins in. */
	writingMode: WritingMode;
	/** What the session counts words across: the project, or its manuscript. */
	scope: WritingSessionScope;
	/**
	 * Minutes a stopwatch sitting is aimed at, or 0 for none. A stopwatch runs
	 * until it is stopped either way -- this is what the ring closes over, not
	 * a condition on the session.
	 */
	stopwatchExpectedMinutes: number;
}

/**
 * What a session panel needs from the plugin, and nothing else: the panel is
 * rendered twice -- in the statistics sidebar and in the dashboard's data
 * statistics pane -- and both must be the same panel over the same session.
 */
export interface SessionPanelBridge {
	t: (key: string, vars?: Record<string, string | number>) => string;
	/** The language the panel's calendar names are read in. */
	locale(): string;
	/** The day the author draws a week from. */
	weekStart(): WeekStartDay;
	/** How the author writes a date down. */
	dateFormat(): DateFormat;
	live(): LiveWritingSession | null;
	todaySummary(): Promise<WritingDayTotals | null>;
	/** The last `days` days of this panel's project, oldest first. */
	history(days: number): Promise<WritingDayTotals[] | null>;
	view(): SessionHistoryView;
	setView(patch: Partial<SessionHistoryView>): void;
	/** Fires on every change; `structural` marks a start, stop or recovery. */
	subscribe(listener: (structural: boolean) => void): () => void;
	/** Net words a day is aimed at, or 0 when no goal is set. */
	dailyWordGoal(): number;
	setup(): SessionSetup;
	/**
	 * Opens the dialog that sets the daily word goal. Saving it reaches every
	 * panel through `subscribe`, so no widget has to be told twice.
	 */
	editDailyWordGoal(): void;
	/** Opens the dialog that sets the clock, reaching panels the same way. */
	editSetup(): void;
	start(): void;
	pauseOrResume(): void;
	stop(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The gauge's arc: a half circle over its own centre. Its length is what the
 * dash offset is measured against, so the two are derived from one radius
 * rather than written down twice.
 */
const GAUGE_RADIUS = 48;
const GAUGE_LENGTH = Math.PI * GAUGE_RADIUS;
const GAUGE_PATH = `M ${60 - GAUGE_RADIUS} 60 A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 0 1 ${60 + GAUGE_RADIUS} 60`;

/**
 * The sweep runs past the goal rather than stopping at it: the far end is
 * 120%, and the mark at five sixths of the way round is the goal itself. A day
 * that beats its target has somewhere to show it, and the mark is what says
 * which part of the arc was the asking.
 */
const GAUGE_CEILING = 1.2;
const GAUGE_MARK_PATH = gaugeMarkPath(1 / GAUGE_CEILING);

/** The tick across the arc at `fraction` of its sweep, drawn along a radius. */
function gaugeMarkPath(fraction: number): string {
	const angle = Math.PI * (1 - fraction);
	const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
	const point = (radius: number): string =>
		`${(60 + radius * cos).toFixed(2)} ${(60 - radius * sin).toFixed(2)}`;
	return `M ${point(GAUGE_RADIUS - 9)} L ${point(GAUGE_RADIUS + 9)}`;
}

/** The clock's ring, measured the same way: one radius, one circumference. */
const RING_RADIUS = 54;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** A minute of focus before a speed is worth saying; below it, nothing is. */
const PACE_FLOOR_MS = 60_000;

/** How often the day's own totals are read back off disk while a session runs. */
const DAY_REREAD_MS = 10_000;

/**
 * Renders the three session widgets into `container` and keeps them current:
 * the day's goal, the clock, and what the day came to. The once-a-second
 * updates patch these widgets' own text nodes; nothing here ever asks a host
 * view to re-render itself. Returns the disposer, which the host must call
 * before it empties the container.
 */
export function renderSessionPanel(
	container: HTMLElement,
	bridge: SessionPanelBridge,
	options: SessionPanelOptions = {},
): () => void {
	// The grid's own box, so the widgets that span it can be measured against
	// it. A container cannot measure itself, which is why this is a wrapper
	// rather than a property of the grid.
	const panel = container.createDiv({ cls: 'snowflake-method-session-panel' });
	const root = panel.createDiv({ cls: 'snowflake-method-session-widgets' });

	const goal = renderGoalWidget(root, bridge);
	const timer = renderTimerWidget(root, bridge);
	const today = renderTodayWidget(root, bridge);
	// The sidebar is a column beside the writing, not a page to read the year
	// off: it carries the day's three and leaves the stretches to the pane.
	const showHistory = options.history ?? true;
	const trend = showHistory ? renderTrendWidget(root, bridge) : null;
	const heatmap = showHistory ? renderHeatmapWidget(root, bridge) : null;

	// A refresh may find the panel already gone; the token stops a late
	// answer from writing into a detached element for nothing.
	let disposed = false;
	let lastReadAt = 0;
	let history: WritingDayTotals[] = [];
	const paintHistory = (): void => {
		trend?.update(history);
		heatmap?.update(history);
	};
	const refreshHistory = (): void => {
		if (!showHistory) return;
		void bridge
			.history(HEATMAP_DAYS)
			.then((days) => {
				if (disposed || days === null) return;
				history = days;
				paintHistory();
			})
			.catch(() => {
				// A year that cannot be read leaves the last one standing.
			});
	};
	const refreshToday = (): void => {
		lastReadAt = Date.now();
		void bridge
			.todaySummary()
			.then((summary) => {
				if (disposed) return;
				today.update(summary);
				goal.update(summary);
				if (summary === null) return;
				// Today is the last day of the year behind it, and it moves while
				// it is written. The fresher reading is dropped into place rather
				// than the whole year being read again every few seconds -- and
				// when the day has rolled over it is a different year, so that is
				// read again instead.
				const tail = history.length - 1;
				const shown = history[tail];
				if (shown === undefined) return;
				if (shown.day !== summary.day) {
					refreshHistory();
					return;
				}
				history[tail] = summary;
				paintHistory();
			})
			.catch(() => {
				// A day that cannot be read leaves the last reading standing.
			});
	};

	const unsubscribe = bridge.subscribe((structural) => {
		timer.update();
		// The day's totals count the live session in, so they move while it is
		// written rather than only when it ends. Reading them costs a walk over
		// the month's records, and the change events arrive once a second, so
		// the day is re-read on its own slower beat -- fast enough for a figure
		// measured over a whole day, and at once when a session begins or ends.
		if (structural) refreshHistory();
		if (structural || Date.now() - lastReadAt >= DAY_REREAD_MS) refreshToday();
	});
	timer.update();
	refreshHistory();
	refreshToday();

	return () => {
		disposed = true;
		unsubscribe();
		trend?.dispose();
		panel.remove();
	};
}

interface WidgetFrame {
	header: HTMLElement;
	body: HTMLElement;
}

/** One widget: a titled square with an optional dialog behind its corner. */
function createWidget(
	parent: HTMLElement,
	spec: { title: string; cls: string; settings?: { label: string; open: () => void } },
): WidgetFrame {
	const widget = parent.createDiv({
		cls: `snowflake-method-widget ${spec.cls}`,
	});
	const header = widget.createDiv({ cls: 'snowflake-method-widget-header' });
	header.createSpan({
		cls: 'snowflake-method-widget-title',
		text: spec.title,
	});
	if (spec.settings !== undefined) {
		const button = header.createEl('button', {
			cls: 'clickable-icon snowflake-method-widget-settings',
			attr: { type: 'button', 'aria-label': spec.settings.label },
		});
		setIcon(button, 'settings-2');
		button.addEventListener('click', spec.settings.open);
	}
	return {
		header,
		body: widget.createDiv({ cls: 'snowflake-method-widget-body' }),
	};
}

/** The day's net words against the day's goal, drawn as a filling arc. */
function renderGoalWidget(
	parent: HTMLElement,
	bridge: SessionPanelBridge,
): { update: (summary: TodayWritingSummary | null) => void } {
	const t = bridge.t;
	const frame = createWidget(parent, {
		title: t('sessionWidget.goal.title'),
		cls: 'snowflake-method-widget-goal',
		settings: {
			label: t('sessionWidget.goal.edit'),
			open: () => {
				bridge.editDailyWordGoal();
			},
		},
	});

	const gauge = frame.body.createDiv({ cls: 'snowflake-method-gauge' });
	const svg = frame.body.doc.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', '0 0 120 66');
	svg.setAttribute('focusable', 'false');
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('snowflake-method-gauge-dial');
	for (const cls of ['snowflake-method-gauge-track', 'snowflake-method-gauge-fill']) {
		const arc = frame.body.doc.createElementNS(SVG_NS, 'path');
		arc.setAttribute('d', GAUGE_PATH);
		arc.classList.add(cls);
		svg.append(arc);
	}
	const fill = svg.lastElementChild as SVGPathElement;
	fill.setAttribute('stroke-dasharray', `${GAUGE_LENGTH}`);
	fill.setAttribute('stroke-dashoffset', `${GAUGE_LENGTH}`);
	// Over the fill, so the goal stays visible on the part already reached.
	const mark = frame.body.doc.createElementNS(SVG_NS, 'path');
	mark.setAttribute('d', GAUGE_MARK_PATH);
	mark.classList.add('snowflake-method-gauge-mark');
	svg.append(mark);
	gauge.append(svg);
	const percent = gauge.createDiv({ cls: 'snowflake-method-gauge-percent' });
	const caption = frame.body.createDiv({
		cls: 'snowflake-method-widget-caption',
	});

	return {
		update: (summary) => {
			const target = bridge.dailyWordGoal();
			const net = summary?.trackedNet ?? 0;
			// A dial with no goal on it has no goal to mark.
			mark.setAttribute('visibility', target > 0 ? 'visible' : 'hidden');
			if (target <= 0) {
				percent.setText('—');
				caption.setText(t('sessionWidget.goal.unset'));
				fill.setAttribute('stroke-dashoffset', `${GAUGE_LENGTH}`);
				return;
			}
			const share = net / target;
			// The reading is the day's own number, however far past the goal it
			// went. The arc is what the dial can hold: words lost leave it at
			// nothing rather than behind it, and a day beyond 120% fills it.
			const drawn = Math.min(GAUGE_CEILING, Math.max(0, share));
			percent.setText(`${Math.round(share * 100)}%`);
			caption.setText(
				t('sessionWidget.goal.progress', {
					net: grouped(net),
					goal: grouped(target),
				}),
			);
			fill.setAttribute(
				'stroke-dashoffset',
				`${GAUGE_LENGTH * (1 - drawn / GAUGE_CEILING)}`,
			);
		},
	};
}

/** The clock, what it is counting, and the three ways to move it. */
function renderTimerWidget(
	parent: HTMLElement,
	bridge: SessionPanelBridge,
): { update: () => void } {
	const t = bridge.t;
	const frame = createWidget(parent, {
		title: t('sessionWidget.timer.title'),
		cls: 'snowflake-method-widget-timer',
		settings: {
			label: t('sessionWidget.timer.edit'),
			open: () => {
				bridge.editSetup();
			},
		},
	});

	// Everything the clock is -- which clock, what it is doing, which turn
	// round -- said in one line over the ring, leaving the ring to hold the
	// reading and nothing else.
	const kindText = frame.body.createDiv({
		cls: 'snowflake-method-timer-kind',
	});
	const dial = frame.body.createDiv({ cls: 'snowflake-method-timer-dial' });
	const ring = frame.body.doc.createElementNS(SVG_NS, 'svg');
	ring.setAttribute('viewBox', '0 0 120 120');
	ring.setAttribute('focusable', 'false');
	ring.setAttribute('aria-hidden', 'true');
	ring.classList.add('snowflake-method-timer-ring');
	for (const cls of ['snowflake-method-timer-track', 'snowflake-method-timer-fill']) {
		const circle = frame.body.doc.createElementNS(SVG_NS, 'circle');
		circle.setAttribute('cx', '60');
		circle.setAttribute('cy', '60');
		circle.setAttribute('r', `${RING_RADIUS}`);
		circle.classList.add(cls);
		ring.append(circle);
	}
	const ringFill = ring.lastElementChild as SVGCircleElement;
	ringFill.setAttribute('stroke-dasharray', `${RING_LENGTH}`);
	ringFill.setAttribute('stroke-dashoffset', `${RING_LENGTH}`);
	dial.append(ring);

	const face = dial.createDiv({ cls: 'snowflake-method-timer-face' });
	const clock = face.createDiv({ cls: 'snowflake-method-widget-clock' });

	const controls = frame.body.createDiv({
		cls: 'snowflake-method-widget-controls',
	});
	const primary = createControl(controls, 'play', '', true);
	const stop = createControl(controls, 'square', t('sessionWidget.stop'));
	primary.addEventListener('click', () => {
		if (bridge.live() === null) bridge.start();
		else bridge.pauseOrResume();
	});
	stop.addEventListener('click', () => {
		bridge.stop();
	});

	const expectedMs = (): number =>
		bridge.setup().stopwatchExpectedMinutes * 60_000;
	const showRing = (done: number | null): void => {
		ringFill.setAttribute(
			'stroke-dashoffset',
			`${RING_LENGTH * (1 - (done ?? 0))}`,
		);
	};

	return {
		update: () => {
			const live = bridge.live();
			stop.disabled = live === null;
			if (live === null) {
				const setup = bridge.setup();
				kindText.setText(t(`session.type.${setup.type}`));
				clock.setText(formatClock(idleClockMs(setup)));
				setControl(primary, 'play', t('sessionWidget.start'));
				primary.disabled = false;
				// A clock that runs down starts whole; one that fills starts
				// empty. A stopwatch with nothing to fill towards is whole and
				// stays whole, which is the ring saying it is not measuring.
				showRing(
					setup.type !== 'stopwatch' || setup.stopwatchExpectedMinutes <= 0
						? 1
						: 0,
				);
				return;
			}
			const state = live.pomodoro?.phase === 'break' ? 'break' : live.state;
			kindText.setText(
				[
					t(`session.type.${live.type}`),
					t(`session.state.${state}`),
					...(live.pomodoro === null
						? []
						: [
								t('sessionWidget.cycle', {
									// Two digits, so the line holds its length from
									// the first turn round to the tenth.
									cycle: `${live.pomodoro.cycle}`.padStart(2, '0'),
								}),
							]),
				].join(' · '),
			);
			clock.setText(
				live.state === 'starting'
					? t('statusBar.sessionStarting')
					: live.type === 'stopwatch'
						? formatClock(live.durations.totalMs)
						: formatClock(live.remainingMs ?? 0),
			);
			showRing(ringFraction(live, expectedMs()));
			const paused = live.state === 'paused';
			setControl(
				primary,
				paused ? 'play' : 'pause',
				t(paused ? 'sessionWidget.resume' : 'sessionWidget.pause'),
			);
			// A break is not the author's pause to lift.
			primary.disabled = live.pomodoro?.phase === 'break';
		},
	};
}

/**
 * How much of the ring is drawn, which follows the way the clock itself runs.
 * A countdown and a pomodoro run *down*, so the ring starts whole and empties
 * as their time goes. A stopwatch runs *up*, so its ring starts empty and
 * fills towards the length the author said they were aiming for -- and once
 * that length is passed it simply stays whole, because a stopwatch has no
 * limit to have exceeded. With no expectation set there is nothing to fill
 * towards, and the ring stands whole throughout rather than empty: an
 * unmeasured clock should not read as one at zero.
 */
function ringFraction(
	live: LiveWritingSession,
	expectedMs: number,
): number | null {
	if (live.type === 'stopwatch') {
		if (expectedMs <= 0) return 1;
		return Math.min(1, live.durations.totalMs / expectedMs);
	}
	const seconds =
		live.type === 'countdown'
			? live.timing.targetDurationSeconds
			: live.pomodoro?.phase === 'break'
				? live.timing.breakDurationSeconds
				: live.timing.workDurationSeconds;
	if (seconds === undefined || seconds <= 0) return null;
	const total = seconds * 1000;
	const left = Math.min(total, Math.max(0, live.remainingMs ?? total));
	return left / total;
}

/** What the day came to, one measure to a row. */
function renderTodayWidget(
	parent: HTMLElement,
	bridge: SessionPanelBridge,
): { update: (summary: TodayWritingSummary | null) => void } {
	const t = bridge.t;
	const frame = createWidget(parent, {
		title: t('sessionWidget.today.title'),
		cls: 'snowflake-method-widget-today',
	});
	const list = frame.body.createDiv({ cls: 'snowflake-method-widget-rows' });
	const reading = (key: string): HTMLElement => {
		const row = list.createDiv({ cls: 'snowflake-method-widget-row' });
		row.createSpan({ text: t(`sessionWidget.today.${key}`) });
		return row.createSpan({ cls: 'snowflake-method-widget-row-value' });
	};
	const sessions = reading('sessions');
	const total = reading('total');
	const focus = reading('focus');
	const idle = reading('idle');
	// The two halves the day's net is made of, on one row and signed the way a
	// diff signs them, so which way each went reads without a legend.
	const words = reading('words');
	const added = words.createSpan({ cls: 'snowflake-method-widget-added' });
	const deleted = words.createSpan({ cls: 'snowflake-method-widget-deleted' });
	const pace = reading('pace');

	return {
		update: (summary) => {
			const day: TodayWritingSummary = summary ?? {
				sessions: 0,
				focusMs: 0,
				idleMs: 0,
				totalMs: 0,
				added: 0,
				deleted: 0,
				trackedNet: 0,
			};
			sessions.setText(`${day.sessions}`);
			total.setText(formatClock(day.totalMs));
			focus.setText(formatClock(day.focusMs));
			idle.setText(formatClock(day.idleMs));
			added.setText(`+${grouped(day.added)}`);
			deleted.setText(`-${grouped(day.deleted)}`);
			// Under a minute of focus, a rate says more about the arithmetic
			// than about the writing.
			pace.setText(
				day.focusMs < PACE_FLOOR_MS
					? '—'
					: t('sessionWidget.today.paceValue', {
							pace: Math.round(
								(day.trackedNet * 3_600_000) / day.focusMs,
							),
						}),
			);
		},
	};
}

/**
 * The two readings that span more than a day. Both are drawn as one SVG each
 * over a fixed coordinate space and scaled to whatever room they are given,
 * so a year of days fits a sidebar and a pane alike without either measuring
 * itself in pixels.
 */
const TREND_WIDTH = 640;
const TREND_INSET = { left: 58, right: 10, top: 12, bottom: 22 };
/** Roughly how wide a character of a date label is, in drawing units. */
const LABEL_EM = 4.6;

/** Enough of a day to see, however thin the slot it is drawn in. */
const TREND_BAR_SHARE = 0.68;

/** A heatmap cell and the room round it, in the same coordinate space. */
const CELL_SIZE = 11;
const CELL_GAP = 3;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const HEAT_INSET = { left: 26, top: 14 };

/** How dark a cell of each level is drawn, from the faintest to the full. */
const HEAT_OPACITIES = Array.from(
	{ length: HEAT_LEVELS },
	(_unused, at) => (at + 1) / HEAT_LEVELS,
);

/** What the recent trend measures, and the day's writing put into bars. */
function renderTrendWidget(
	parent: HTMLElement,
	bridge: SessionPanelBridge,
): { update: (history: WritingDayTotals[]) => void; dispose: () => void } {
	const t = bridge.t;
	const frame = createWidget(parent, {
		title: t('sessionWidget.trend.title'),
		cls: 'snowflake-method-widget-wide snowflake-method-widget-trend',
	});
	const picks = frame.header.createDiv({ cls: 'snowflake-method-widget-picks' });
	const range = createPick(
		picks,
		t('sessionWidget.trend.range'),
		TREND_RANGES.map((days) => [
			`${days}`,
			t('sessionWidget.trend.days', { days }),
		]),
	);
	const measure = createPick(
		picks,
		t('sessionWidget.trend.measure'),
		TREND_MEASURES.map((name) => [name, t(`sessionWidget.trend.${name}`)]),
	);
	range.addEventListener('change', () => {
		bridge.setView({ trendDays: Number(range.value) });
	});
	measure.addEventListener('change', () => {
		bridge.setView({ trendMeasure: measure.value as TrendMeasure });
	});

	const chart = frame.body.createDiv({ cls: 'snowflake-method-trend-chart' });
	// The drawing is emptied and rebuilt; the card a reader opened over a day
	// is not, so it lives beside the drawing rather than inside it.
	const plot = chart.createDiv({ cls: 'snowflake-method-trend-plot' });
	const detail = createDetail(chart);
	const stats = frame.body.createDiv({ cls: 'snowflake-method-trend-stats' });
	const reading = (key: string): HTMLElement => {
		const cell = stats.createDiv({ cls: 'snowflake-method-trend-stat' });
		cell.createSpan({
			cls: 'snowflake-method-trend-stat-label',
			text: t(`sessionWidget.trend.${key}`),
		});
		return cell.createSpan({ cls: 'snowflake-method-trend-stat-value' });
	};
	const average = reading('average');
	const highest = reading('highest');
	const cumulative = reading('total');

	// The chart fills whatever box it is given rather than deciding its own
	// height from its width, because the widget's height is set by the grid it
	// spans. So the drawing is told the box, and redrawn when the box changes.
	let shown: WritingDayTotals[] = [];
	let shape: TrendMeasure = 'net';
	let picked: string | null = null;
	const paint = (): void => {
		drawTrend(plot, bridge, shown, shape);
		const day = shown.find((one) => one.day === picked);
		const band = picked === null ? null : plot.querySelector(`[data-day="${picked}"]`);
		if (day === undefined || band === null) {
			picked = null;
			detail.hide();
			return;
		}
		detail.show(band, dayDetail(bridge, day, shape), false);
	};
	chart.addEventListener('click', (event) => {
		const day = dayClicked(event);
		picked = day === null || day === picked ? null : day;
		paint();
	});
	const view = chart.ownerDocument.defaultView;
	const observer = view === null ? null : new view.ResizeObserver(paint);
	observer?.observe(plot);

	return {
		dispose: () => {
			observer?.disconnect();
		},
		update: (history) => {
			const view = bridge.view();
			range.value = `${view.trendDays}`;
			measure.value = view.trendMeasure;
			const days = history.slice(Math.max(0, history.length - view.trendDays));
			const totals = days.map((day) => trendValue(day, view.trendMeasure));
			const sum = totals.reduce((carried, one) => carried + one, 0);
			const top = Math.max(0, ...totals.map(Math.abs));
			const words = view.trendMeasure !== 'time';
			const say = (value: number): string =>
				words ? grouped(Math.round(value)) : formatClock(Math.round(value));
			average.setText(say(days.length === 0 ? 0 : sum / days.length));
			highest.setText(say(top));
			cumulative.setText(say(sum));
			shown = days;
			shape = view.trendMeasure;
			paint();
		},
	};
}

/** The day a click landed on, or nothing where it landed on no day at all. */
function dayClicked(event: MouseEvent): string | null {
	const target = event.target;
	if (!(target instanceof Element)) return null;
	return target.closest('[data-day]')?.getAttribute('data-day') ?? null;
}

/** What a day says when it is opened: its date, and what it came to. */
function dayDetail(
	bridge: SessionPanelBridge,
	day: WritingDayTotals,
	measure: TrendMeasure,
): string[] {
	return [
		formatDay(day.day, bridge.dateFormat()),
		measure === 'time'
			? bridge.t('sessionWidget.trend.timeDetail', {
					focus: formatClock(day.focusMs),
					idle: formatClock(day.idleMs),
					total: formatClock(day.totalMs),
				})
			: bridge.t('sessionWidget.trend.wordsDetail', {
					added: grouped(day.added),
					deleted: grouped(day.deleted),
					net: grouped(day.trackedNet),
				}),
	];
}

/**
 * A card naming one day, put where that day was pointed at. The frame it is
 * given must be a box that does not scroll: a card inside a scroller counts
 * towards that scroller's content, so placing one near the right edge grows a
 * scrollbar and then clips the card against it.
 */
function createDetail(frame: HTMLElement): {
	show: (target: Element, lines: string[], above: boolean) => void;
	hide: () => void;
} {
	const card = frame.createDiv({
		cls: 'snowflake-method-chart-detail is-hidden',
	});
	return {
		hide: () => {
			card.addClass('is-hidden');
		},
		show: (target, lines, above) => {
			card.empty();
			for (const [at, line] of lines.entries()) {
				card.createDiv({
					cls:
						at === 0
							? 'snowflake-method-chart-detail-day'
							: 'snowflake-method-chart-detail-value',
					text: line,
				});
			}
			card.removeClass('is-hidden');
			const spot = target.getBoundingClientRect();
			const box = frame.getBoundingClientRect();
			const x = spot.left - box.left + spot.width / 2 - card.offsetWidth / 2;
			const y = spot.top - box.top;
			card.style.left = `${Math.round(
				Math.min(
					Math.max(x, 0),
					Math.max(0, frame.clientWidth - card.offsetWidth),
				),
			)}px`;
			// Above the day where there is room for it, and below it where there
			// is not: a card that clamped to the top edge would cover the very
			// cell the reader had just picked.
			const wanted = above ? y - card.offsetHeight - 6 : y + 4;
			card.style.top = `${Math.round(
				wanted >= 0 ? wanted : y + spot.height + 6,
			)}px`;
		},
	};
}

/**
 * What one day contributes to a trend. Time answers with the focus it held --
 * the sitting is what the bar draws, and the writing in it is what the
 * readings underneath are about.
 */
function trendValue(day: WritingDayTotals, measure: TrendMeasure): number {
	if (measure === 'net') return day.trackedNet;
	if (measure === 'added') return day.added;
	if (measure === 'deleted') return day.deleted;
	return day.focusMs;
}

/**
 * The bars and the axes they are read against. Every bar stands on the axis,
 * whichever way its day went: a day that ended shorter than it began is drawn
 * as far as it moved and coloured for having moved the wrong way, which reads
 * at a glance where a bar hanging below the line had to be measured.
 */
function drawTrend(
	chart: HTMLElement,
	bridge: SessionPanelBridge,
	days: WritingDayTotals[],
	measure: TrendMeasure,
): void {
	const t = bridge.t;
	chart.empty();
	const doc = chart.doc;
	const box = chart.getBoundingClientRect();
	if (box.width <= 0 || box.height <= 0) return;
	// One width, and the height the box asks for at that width, so the drawing
	// fills the box exactly instead of being letterboxed inside it.
	const tall = Math.round((TREND_WIDTH * box.height) / box.width);
	const plot = {
		left: TREND_INSET.left,
		right: TREND_WIDTH - TREND_INSET.right,
		top: TREND_INSET.top,
		bottom: tall - TREND_INSET.bottom,
	};
	if (plot.bottom <= plot.top) return;
	const svg = svgEl(doc, 'svg', {
		viewBox: `0 0 ${TREND_WIDTH} ${tall}`,
		preserveAspectRatio: 'none',
		focusable: 'false',
		class: 'snowflake-method-trend-dial',
	});

	const words = measure !== 'time';
	const top = words
		? Math.max(0, ...days.map((day) => Math.abs(trendValue(day, measure))))
		: Math.max(0, ...days.map((day) => day.totalMs));
	const scale = axisScale(top, measure);
	const ceiling = scale.top;
	const height = plot.bottom - plot.top;
	const rise = (value: number): number =>
		(height * Math.abs(value)) / ceiling;

	// Ruled at round numbers up to a round ceiling, so the days can be read
	// against a scale rather than only against each other.
	for (let value = 0; value <= ceiling; value += scale.step) {
		const y = plot.bottom - (height * value) / ceiling;
		svg.append(
			svgEl(doc, 'line', {
				x1: plot.left,
				x2: plot.right,
				y1: y,
				y2: y,
				class:
					value === 0
						? 'snowflake-method-trend-axis'
						: 'snowflake-method-trend-grid',
			}),
		);
		const label = svgEl(doc, 'text', {
			x: plot.left - 6,
			y: y + 3,
			class: 'snowflake-method-trend-scale',
		});
		label.textContent = words
			? grouped(value)
			: t('sessionWidget.trend.hours', {
					hours: (value / 3_600_000).toFixed(
						scale.step % 3_600_000 === 0 ? 0 : 1,
					),
				});
		svg.append(label);
	}

	const slot = (plot.right - plot.left) / Math.max(1, days.length);
	const bar = Math.max(1, slot * TREND_BAR_SHARE);
	for (const [at, day] of days.entries()) {
		const x = plot.left + slot * (at + 0.5) - bar / 2;
		if (words) {
			const value = trendValue(day, measure);
			const size = rise(value);
			if (size <= 0) continue;
			svg.append(
				svgEl(doc, 'rect', {
					x,
					y: plot.bottom - size,
					width: bar,
					height: size,
					// Deleted words are a loss however the day is read, and a
					// negative net is one too; everything else is a gain.
					class: `snowflake-method-trend-${trendTone(measure, value)}`,
				}),
			);
			continue;
		}
		// A sitting, split where the writing stopped: focus on the axis, and
		// the rest of the time standing on it.
		for (const [part, span] of [
			['focus', day.focusMs],
			['idle', day.idleMs],
		] as const) {
			const size = rise(span);
			if (size <= 0) continue;
			const below = part === 'focus' ? 0 : rise(day.focusMs);
			svg.append(
				svgEl(doc, 'rect', {
					x,
					y: plot.bottom - below - size,
					width: bar,
					height: size,
					class: `snowflake-method-trend-${part}`,
				}),
			);
		}
	}

	// Dates, as many as fit without touching: a label under every day of a long
	// stretch would be unreadable, and under none of it unplaceable. How many
	// fit depends on how the reader writes a date, so the count is measured
	// from the format rather than fixed.
	const format = bridge.dateFormat();
	const wide = format.length * LABEL_EM;
	const room = Math.max(
		1,
		Math.min(8, Math.floor((plot.right - plot.left) / (wide * 1.9))),
	);
	const ticks = new Set<number>();
	for (let at = 0; at <= room; at += 1) {
		ticks.add(Math.round(((days.length - 1) * at) / room));
	}
	for (const at of ticks) {
		const day = days[at];
		if (day === undefined) continue;
		const label = svgEl(doc, 'text', {
			// Pulled inside the plot at either end, so the first and last dates
			// stay under the chart rather than hanging off it.
			x: Math.min(
				Math.max(plot.left + slot * (at + 0.5), plot.left + wide / 2),
				plot.right - wide / 2,
			),
			y: tall - 6,
			class: 'snowflake-method-trend-date',
		});
		label.textContent = formatDay(day.day, format);
		svg.append(label);
	}

	// One reachable band per day, over everything else, so a day is opened by
	// clicking anywhere in its column rather than on the bar itself.
	for (const [at, day] of days.entries()) {
		const band = svgEl(doc, 'rect', {
			x: plot.left + slot * at,
			y: plot.top,
			width: slot,
			height,
			class: 'snowflake-method-trend-band',
			'data-day': day.day,
		});
		svg.append(band);
	}
	chart.append(svg);
}

/** A year of days, each shaded by how much of it was written. */
function renderHeatmapWidget(
	parent: HTMLElement,
	bridge: SessionPanelBridge,
): { update: (history: WritingDayTotals[]) => void } {
	const t = bridge.t;
	const frame = createWidget(parent, {
		title: t('sessionWidget.heatmap.title'),
		cls: 'snowflake-method-widget-wide snowflake-method-widget-heatmap',
	});
	const measure = createPick(
		frame.header.createDiv({ cls: 'snowflake-method-widget-picks' }),
		t('sessionWidget.heatmap.measure'),
		HEATMAP_MEASURES.map((name) => [
			name,
			t(`sessionWidget.heatmap.${name}`),
		]),
	);
	measure.addEventListener('change', () => {
		bridge.setView({ heatmapMeasure: measure.value as HeatmapMeasure });
	});
	// The card is a sibling of the scroller rather than a child of it: an
	// absolutely placed child counts towards a scroll container's own content,
	// so a card near the right edge grew the grid a scrollbar it did not need
	// and was then clipped by the very box it had just widened.
	const field = frame.body.createDiv({ cls: 'snowflake-method-heatmap-frame' });
	const grid = field.createDiv({ cls: 'snowflake-method-heatmap-grid' });
	const cells = grid.createDiv({ cls: 'snowflake-method-heatmap-cells' });
	const detail = createDetail(field);
	const key = frame.body.createDiv({ cls: 'snowflake-method-heatmap-key' });

	let drawn = '';
	let shown: WritingDayTotals[] = [];
	let chosen: HeatmapMeasure = 'net';
	let picked: string | null = null;
	const paintDetail = (): void => {
		const day = shown.find((one) => one.day === picked);
		const cell =
			picked === null ? null : cells.querySelector(`[data-day="${picked}"]`);
		if (day === undefined || cell === null) {
			picked = null;
			detail.hide();
			return;
		}
		detail.show(cell, heatDetail(bridge, day, chosen), true);
	};
	field.addEventListener('click', (event) => {
		const day = dayClicked(event);
		picked = day === null || day === picked ? null : day;
		paintDetail();
	});
	// The card is placed against what is on screen, so scrolling the grid
	// would leave it pointing at a day that has moved out from under it.
	grid.addEventListener('scroll', () => {
		picked = null;
		detail.hide();
	});

	return {
		update: (history) => {
			chosen = bridge.view().heatmapMeasure;
			shown = history;
			measure.value = chosen;
			const levels = heatLevels(history, chosen, bridge.dailyWordGoal());
			const start = bridge.weekStart();
			const mark = [chosen, start, levels.join('')].join('|');
			if (mark === drawn) return;
			drawn = mark;
			drawKey(key, t, chosen);
			drawHeatmap(cells, bridge, history, levels, chosen);
			paintDetail();
		},
	};
}

/**
 * What the shading means, said in the shape the reading has. Degrees get the
 * ladder from less to more; met or unmet gets its two states -- which is not a
 * ladder, but is still a key, and leaving the row empty for it would open a
 * hole under the grid where the other readings have a line.
 */
function drawKey(
	key: HTMLElement,
	t: SessionPanelBridge['t'],
	measure: HeatmapMeasure,
): void {
	key.empty();
	const swatch = (heat: string, level: number): void => {
		const mark = key.createSpan({ cls: 'snowflake-method-heat-swatch' });
		mark.dataset.heat = heat;
		mark.style.setProperty('--snowflake-method-heat', `${level}`);
	};
	if (measure === 'goal') {
		key.createSpan({ text: t('sessionWidget.heatmap.uncompleted') });
		swatch('none', 1);
		swatch('accent', 1);
		key.createSpan({ text: t('sessionWidget.heatmap.completed') });
		return;
	}
	key.createSpan({ text: t('sessionWidget.heatmap.less') });
	for (const level of HEAT_OPACITIES) {
		swatch(measure === 'net' ? 'gain' : 'accent', level);
	}
	key.createSpan({ text: t('sessionWidget.heatmap.more') });
}

/** What one day of the grid says when it is opened. */
function heatDetail(
	bridge: SessionPanelBridge,
	day: WritingDayTotals,
	measure: HeatmapMeasure,
): string[] {
	const t = bridge.t;
	const goal = bridge.dailyWordGoal();
	const said =
		measure === 'focus'
			? t('sessionWidget.heatmap.focusDetail', {
					focus: formatClock(day.focusMs),
				})
			: measure === 'net'
				? t('sessionWidget.heatmap.netDetail', { net: grouped(day.trackedNet) })
				: goal <= 0
					? t('sessionWidget.heatmap.noGoalDetail')
					: // The grid reads a goal as met or unmet, and so does the card:
						// a share of the way there is a reading the shading does not
						// offer and the day was not judged on.
						t(
							day.trackedNet >= goal
								? 'sessionWidget.heatmap.completed'
								: 'sessionWidget.heatmap.uncompleted',
						);
	return [formatDay(day.day, bridge.dateFormat()), said];
}

/** The grid itself: weeks across, days down, from the week's chosen start. */
function drawHeatmap(
	grid: HTMLElement,
	bridge: SessionPanelBridge,
	history: WritingDayTotals[],
	levels: number[],
	measure: HeatmapMeasure,
): void {
	grid.empty();
	const doc = grid.doc;
	const first = history[0];
	const last = history[history.length - 1];
	if (first === undefined || last === undefined) return;
	// The grid starts on the reader's own first day of the week, so every
	// column is a whole week and the rows mean the same thing all the way
	// across. The days before the stretch begins are simply left empty.
	const offset = bridge.weekStart();
	const lead = (dayOfWeek(first.day) - weekStartIndex(offset) + 7) % 7;
	const start = addDays(first.day, -lead);
	const columns = Math.ceil((daysBetween(start, last.day) + 1) / 7);
	const width = HEAT_INSET.left + columns * CELL_STEP;
	const height = HEAT_INSET.top + 7 * CELL_STEP;
	const svg = svgEl(doc, 'svg', {
		viewBox: `0 0 ${width} ${height}`,
		preserveAspectRatio: 'xMidYMid meet',
		focusable: 'false',
		class: 'snowflake-method-heatmap-dial',
	});

	const locale = bridge.locale();
	const weekdays = weekdayLabels(locale, 'short');
	const months = monthLabels(locale);
	// Every other row named from the first, which is enough to place the rest
	// and puts the names on the days the week was drawn from.
	for (let row = 0; row < 6; row += 2) {
		const label = svgEl(doc, 'text', {
			x: HEAT_INSET.left - 5,
			y: HEAT_INSET.top + row * CELL_STEP + CELL_SIZE * 0.8,
			class: 'snowflake-method-heat-label snowflake-method-heat-weekday',
		});
		label.textContent = weekdays[(weekStartIndex(offset) + row) % 7] ?? '';
		svg.append(label);
	}

	let named = -1;
	for (let column = 0; column < columns; column += 1) {
		for (let row = 0; row < 7; row += 1) {
			const day = addDays(start, column * 7 + row);
			const at = daysBetween(first.day, day);
			const x = HEAT_INSET.left + column * CELL_STEP;
			const y = HEAT_INSET.top + row * CELL_STEP;
			// A month is named above the first column that begins in it.
			if (row === 0 && dayOfMonth(day) <= 7 && monthOfDay(day) !== named) {
				named = monthOfDay(day);
				const label = svgEl(doc, 'text', {
					x,
					y: HEAT_INSET.top - 5,
					class: 'snowflake-method-heat-label',
				});
				label.textContent = months[named] ?? '';
				svg.append(label);
			}
			if (at < 0 || at >= history.length) continue;
			const level = levels[at] ?? 0;
			const cell = svgEl(doc, 'rect', {
				x,
				y,
				width: CELL_SIZE,
				height: CELL_SIZE,
				rx: 2,
				class: 'snowflake-method-heat-cell',
			});
			cell.dataset.heat =
				level === 0 ? 'none' : level < 0 ? 'loss' : measure === 'net' ? 'gain' : 'accent';
			cell.style.setProperty(
				'--snowflake-method-heat',
				`${HEAT_OPACITIES[Math.abs(level) - 1] ?? 1}`,
			);
			cell.dataset.day = day;
			svg.append(cell);
		}
	}
	grid.append(svg);
}

/** A labelled chooser, dressed the way the app dresses its own. */
function createPick(
	parent: HTMLElement,
	label: string,
	options: (readonly [string, string])[],
): HTMLSelectElement {
	const select = parent.createEl('select', {
		cls: 'dropdown snowflake-method-widget-pick',
		attr: { 'aria-label': label },
	});
	for (const [value, text] of options) select.createEl('option', { value, text });
	return select;
}

/** One SVG element with its attributes, which is most of what is drawn here. */
function svgEl<K extends keyof SVGElementTagNameMap>(
	doc: Document,
	name: K,
	attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
	const element = doc.createElementNS(SVG_NS, name);
	for (const [key, value] of Object.entries(attrs)) {
		element.setAttribute(key, `${value}`);
	}
	return element;
}

/**
 * A count as a reader groups it. Both languages this plugin speaks group by
 * threes with a comma, so one grouping serves them both.
 */
function grouped(value: number): string {
	return value.toLocaleString('en-US');
}

/** The clock a session would start on, which is what a stopped widget shows. */
function idleClockMs(setup: SessionSetup): number {
	if (setup.type === 'countdown') return setup.countdownMinutes * 60_000;
	if (setup.type === 'pomodoro') return setup.pomodoroWorkMinutes * 60_000;
	return 0;
}

function createControl(
	parent: HTMLElement,
	icon: string,
	label: string,
	primary = false,
): HTMLButtonElement {
	const button = parent.createEl('button', {
		cls: primary
			? 'mod-cta snowflake-method-widget-control'
			: 'snowflake-method-widget-control',
		attr: { type: 'button' },
	});
	button.createSpan({ attr: { 'aria-hidden': 'true' } });
	button.createSpan({ cls: 'snowflake-method-widget-control-label' });
	setControl(button, icon, label);
	return button;
}

/** Re-dresses a control in place, so the row never rebuilds under a click. */
function setControl(button: HTMLElement, icon: string, label: string): void {
	const [iconEl, labelEl] = Array.from(button.children);
	if (iconEl instanceof HTMLElement && button.dataset.icon !== icon) {
		button.dataset.icon = icon;
		setIcon(iconEl, icon);
	}
	if (labelEl instanceof HTMLElement) labelEl.setText(label);
	button.setAttribute('aria-label', label);
}
