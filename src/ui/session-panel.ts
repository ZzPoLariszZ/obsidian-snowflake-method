import { setIcon } from 'obsidian';

import {
	BAND_SPANS,
	DAY_BANDS,
	HEATMAP_DAYS,
	HEAT_LEVELS,
	WRITING_MODES,
	axisScale,
	bandLabel,
	formatDay,
	heatLevels,
	trendTone,
	READING_MEASURES,
	TREND_RANGES,
	addDays,
	addMonths,
	dayOfMonth,
	dayOfWeek,
	daysBetween,
	daysInMonth,
	formatClock,
	monthLabels,
	monthOfDay,
	monthTitle,
	startOfMonth,
	startOfWeek,
	weekOfYear,
	emptyModes,
	weekStartIndex,
	weekdayLabels,
	type BandSpan,
	type BandTotals,
	type DateFormat,
	type HeatmapMeasure,
	type ModeTotals,
	type ReadingMeasure,
	type WeekStartDay,
	type WritingMode,
	type WritingSessionScope,
	type WritingSessionType,
} from '../domain';
import type {
	LiveWritingSession,
	TodayWritingSummary,
	WritingDayTotals,
	WritingSpread,
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
	/**
	 * What all four readings of the writing are measuring. They share it: a
	 * reader who has just asked the trend about deleted words has asked the
	 * year, the month and the hours of the day the same question.
	 */
	measure: ReadingMeasure;
	/** Whether the year is shading the goal instead, which only it can. */
	heatmapGoal: boolean;
	bandSpan: BandSpan;
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
	/** Whether a finished break rolls straight into the next work period. */
	pomodoroAutoRepeat: boolean;
	/** The stage of the writing a session begins in. */
	writingMode: WritingMode;
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
	/** The day the reading device is on, which is the day a calendar marks. */
	today(): string;
	live(): LiveWritingSession | null;
	todaySummary(): Promise<WritingDayTotals | null>;
	/** The last `days` days of this panel's project, oldest first. */
	history(days: number): Promise<WritingDayTotals[] | null>;
	/** Every day of the month `anchor` falls in, the empty ones included. */
	month(anchor: string): Promise<WritingDayTotals[] | null>;
	/** How this project's sittings fell across a day, and across the work. */
	spread(span: BandSpan): Promise<WritingSpread | null>;
	view(): SessionHistoryView;
	setView(patch: Partial<SessionHistoryView>): void;
	/** Fires on every change; `structural` marks a start, stop or recovery. */
	subscribe(listener: (structural: boolean) => void): () => void;
	/** Net words a day is aimed at, or 0 when no goal is set. */
	dailyWordGoal(): number;
	/** Which scope that target, and every goal mark, is measured in. */
	goalScope(): WritingSessionScope;
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
	const calendar = showHistory ? renderCalendarWidget(root, bridge) : null;
	const goals = showHistory
		? SPAN_GOALS.map((span) => renderSpanGoalWidget(root, bridge, span))
		: [];
	const bands = showHistory ? renderBandsWidget(root, bridge) : null;
	const modes = showHistory ? renderModesWidget(root, bridge) : null;

	// A refresh may find the panel already gone; the token stops a late
	// answer from writing into a detached element for nothing.
	let disposed = false;
	let lastReadAt = 0;
	let history: WritingDayTotals[] = [];
	const paintHistory = (): void => {
		trend?.update(history);
		heatmap?.update(history);
		for (const gauge of goals) gauge.update(history);
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
	// The two readings drawn from the sittings themselves rather than from the
	// days they fell on. One walk answers both, so a span two widgets want is
	// fetched once and the answer handed to each of them.
	let spreads = new Map<BandSpan, Promise<WritingSpread | null>>();
	const spreadFor = (span: BandSpan): Promise<WritingSpread | null> => {
		let pending = spreads.get(span);
		if (pending === undefined) {
			pending = bridge.spread(span).catch(() => null);
			spreads.set(span, pending);
		}
		return pending;
	};
	const paintSpread = (): void => {
		if (bands !== null) {
			void spreadFor(bridge.view().bandSpan).then((spread) => {
				if (!disposed && spread !== null) bands.update(spread);
			});
		}
		// Which stages the work went through is a question about the whole of
		// it, whatever stretch the hours beside it are being read over.
		if (modes !== null) {
			void spreadFor('all').then((spread) => {
				if (!disposed && spread !== null) modes.update(spread);
			});
		}
	};
	const refreshSpread = (): void => {
		if (!showHistory) return;
		spreads = new Map();
		paintSpread();
	};
	const refreshToday = (): void => {
		lastReadAt = Date.now();
		void bridge
			.todaySummary()
			.then((summary) => {
				if (disposed) return;
				today.update(summary);
				goal.update(summary);
				calendar?.patch(summary);
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
		if (structural) {
			refreshHistory();
			refreshSpread();
			calendar?.refresh();
		}
		if (structural || Date.now() - lastReadAt >= DAY_REREAD_MS) refreshToday();
	});
	timer.update();
	// The dials and the day are painted at their resting state now, before
	// anything is read off disk. Every one of them carries labels with numbers
	// under them, and a first frame that draws the labels over nothing and
	// fills them in once the read lands reads as a flicker rather than as a
	// widget arriving. The clock beside them has always painted straight away;
	// these now do the same, and the read that follows moves a number instead
	// of conjuring one. The charts are left alone: they have no text to leave
	// blank, and an axis cannot be ruled before the box has been laid out.
	goal.update(null);
	today.update(null);
	for (const gauge of goals) gauge.update([]);
	refreshHistory();
	refreshSpread();
	refreshToday();

	return () => {
		disposed = true;
		unsubscribe();
		trend?.dispose();
		calendar?.dispose();
		panel.remove();
	};
}

interface WidgetFrame {
	header: HTMLElement;
	/** The name itself, for a widget whose name answers to a setting. */
	title: HTMLElement;
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
	const title = header.createSpan({
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
		title,
		body: widget.createDiv({ cls: 'snowflake-method-widget-body' }),
	};
}

/**
 * A gauge's name, which says whose goal it is measuring. Re-read on every
 * repaint rather than fixed when the widget was built: the goal can be aimed
 * somewhere else while the panel is on screen, and a dial still labelled with
 * the scope it used to answer for would be worse than one labelled with none.
 */
function goalTitle(
	bridge: SessionPanelBridge,
	widget: 'goal' | SpanGoal,
): string {
	return bridge.t(`sessionWidget.${widget}.title`, {
		scope: bridge.t(`session.scope.short.${bridge.goalScope()}`),
	});
}

/** The two stretches a daily goal adds up to, beside the day itself. */
const SPAN_GOALS = ['week', 'month'] as const;
type SpanGoal = (typeof SPAN_GOALS)[number];

/**
 * A half circle filling towards a target, with the reading standing in its
 * bowl rather than beside it. Three widgets ask the same question over three
 * lengths of time, so the dial that answers it is built once and told the two
 * numbers.
 */
function createGauge(
	frame: WidgetFrame,
	t: SessionPanelBridge['t'],
): (net: number, target: number) => void {
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

	return (net, target) => {
		// A dial with no goal on it has no goal to mark.
		mark.setAttribute('visibility', target > 0 ? 'visible' : 'hidden');
		if (target <= 0) {
			percent.setText('—');
			caption.setText(t('sessionWidget.goal.unset'));
			fill.setAttribute('stroke-dashoffset', `${GAUGE_LENGTH}`);
			return;
		}
		const share = net / target;
		// The reading is the stretch's own number, however far past the goal it
		// went. The arc is what the dial can hold: words lost leave it at
		// nothing rather than behind it, and anything beyond 120% fills it.
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
	};
}

/** The day's net words against the day's goal, drawn as a filling arc. */
function renderGoalWidget(
	parent: HTMLElement,
	bridge: SessionPanelBridge,
): { update: (summary: TodayWritingSummary | null) => void } {
	const t = bridge.t;
	const frame = createWidget(parent, {
		title: goalTitle(bridge, 'goal'),
		cls: 'snowflake-method-widget-goal',
		settings: {
			label: t('sessionWidget.goal.edit'),
			open: () => {
				bridge.editDailyWordGoal();
			},
		},
	});
	const show = createGauge(frame, t);
	return {
		update: (summary) => {
			frame.title.setText(goalTitle(bridge, 'goal'));
			show(summary?.goalNet ?? 0, bridge.dailyWordGoal());
		},
	};
}

/**
 * The same dial over a week and over a month. Neither carries a goal of its
 * own: a week asks for seven days of the daily one and a month for as many
 * days as it holds, so one number set in one place moves all three widgets --
 * and a short February asks for less than a long March, which is the only way
 * a month's target can be honest about the month it is.
 */
function renderSpanGoalWidget(
	parent: HTMLElement,
	bridge: SessionPanelBridge,
	span: SpanGoal,
): { update: (history: WritingDayTotals[]) => void } {
	const t = bridge.t;
	const frame = createWidget(parent, {
		title: goalTitle(bridge, span),
		cls: `snowflake-method-widget-goal snowflake-method-widget-${span}`,
		settings: {
			label: t('sessionWidget.goal.edit'),
			open: () => {
				bridge.editDailyWordGoal();
			},
		},
	});
	const show = createGauge(frame, t);
	return {
		update: (history) => {
			frame.title.setText(goalTitle(bridge, span));
			const today = bridge.today();
			const from =
				span === 'week'
					? startOfWeek(today, bridge.weekStart())
					: startOfMonth(today);
			// The history ends today, so the days still to come in this week or
			// this month are simply not in it to be counted.
			let net = 0;
			for (const day of history) {
				if (day.day >= from) net += day.goalNet;
			}
			show(net, bridge.dailyWordGoal() * (span === 'week' ? 7 : daysInMonth(today)));
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
				goalNet: 0,
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

/** How far the top of a bar is rounded, in the chart's own units. */
const TREND_RADIUS = 3;

/**
 * A bar standing on the axis. Only the top is rounded, and only when the bar
 * is the top of its pillar: where a sitting is split into its writing and the
 * rest of it, the line between the two is a boundary rather than an end. The
 * radius gives way to whatever the bar can spare, so a hundred and eighty days
 * of two-pixel bars stay bars rather than turning into beads.
 */
function barPath(
	x: number,
	top: number,
	width: number,
	height: number,
	round: boolean,
): string {
	const r = round ? Math.min(TREND_RADIUS, width / 2, height) : 0;
	const right = x + width;
	const bottom = top + height;
	const to = (value: number): string => value.toFixed(2);
	return [
		`M ${to(x)} ${to(bottom)}`,
		`L ${to(x)} ${to(top + r)}`,
		`A ${r} ${r} 0 0 1 ${to(x + r)} ${to(top)}`,
		`L ${to(right - r)} ${to(top)}`,
		`A ${r} ${r} 0 0 1 ${to(right)} ${to(top + r)}`,
		`L ${to(right)} ${to(bottom)}`,
		'Z',
	].join(' ');
}

/**
 * How many weeks a month is drawn over, whatever it needs. A grid that grew
 * and shrank by a row would move every date under it from one month to the
 * next; six is what the longest month can ask for, so six is what every month
 * is given. The month is anchored at the top of it -- its first day always
 * falls in the first row -- and the spare week trails off into the next month.
 */
const CALENDAR_WEEKS = 6;

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
		measureOptions(t),
	);
	range.addEventListener('change', () => {
		bridge.setView({ trendDays: Number(range.value) });
	});
	measure.addEventListener('change', () => {
		bridge.setView({ measure: measure.value as ReadingMeasure });
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
	let shape: ReadingMeasure = 'net';
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
			measure.value = view.measure;
			const days = history.slice(Math.max(0, history.length - view.trendDays));
			const totals = days.map((day) => trendValue(day, view.measure));
			const sum = totals.reduce((carried, one) => carried + one, 0);
			const top = Math.max(0, ...totals.map(Math.abs));
			const words = view.measure !== 'time';
			const say = (value: number): string =>
				words ? grouped(Math.round(value)) : formatClock(Math.round(value));
			average.setText(say(days.length === 0 ? 0 : sum / days.length));
			highest.setText(say(top));
			cumulative.setText(say(sum));
			shown = days;
			shape = view.measure;
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
	measure: ReadingMeasure,
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
function trendValue(day: WritingDayTotals, measure: ReadingMeasure): number {
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
	measure: ReadingMeasure,
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
				svgEl(doc, 'path', {
					d: barPath(x, plot.bottom - size, bar, size, true),
					// Deleted words are a loss however the day is read, and a
					// negative net is one too; everything else is a gain.
					class: `snowflake-method-trend-${trendTone(measure, value)}`,
				}),
			);
			continue;
		}
		// A sitting drawn as one pillar with the writing inside it: the whole
		// of the time in the paler accent, and the focus standing in front of
		// it from the axis up. Both are rounded at the top, which is what makes
		// the writing read as a pillar within a pillar rather than as two
		// blocks stacked -- a rounded top under a square bottom would leave two
		// notches of background where they met.
		for (const [part, span] of [
			['idle', day.totalMs],
			['focus', day.focusMs],
		] as const) {
			const size = rise(span);
			if (size <= 0) continue;
			svg.append(
				svgEl(doc, 'path', {
					d: barPath(x, plot.bottom - size, bar, size, true),
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
		[...measureOptions(t), ['goal', t('sessionWidget.heatmap.goal')] as const],
	);
	measure.addEventListener('change', () => {
		// The goal is this reading's own; anything else is the measure all four
		// share, so choosing it moves the other three -- and choosing one of
		// them anywhere puts this reading back on it.
		const chosen = measure.value as HeatmapMeasure;
		bridge.setView(
			chosen === 'goal' ? { heatmapGoal: true } : { measure: chosen },
		);
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
			const view = bridge.view();
			chosen = view.heatmapGoal ? 'goal' : view.measure;
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
		swatch(heatHue(measure), level);
	}
	key.createSpan({ text: t('sessionWidget.heatmap.more') });
}

/**
 * The hue a reading is shaded in: time takes the accent, words the colour of
 * the way they went. Net is drawn as a gain here because a day below nothing
 * is shaded negative and takes the loss colour from its own level.
 */
function heatHue(measure: HeatmapMeasure): string {
	if (measure === 'time' || measure === 'goal') return 'accent';
	return measure === 'deleted' ? 'loss' : 'gain';
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
		measure === 'goal'
			? goal <= 0
				? t('sessionWidget.heatmap.noGoalDetail')
				: // The grid reads a goal as met or unmet, and so does the card:
					// a share of the way there is a reading the shading does not
					// offer and the day was not judged on.
					t(
						day.goalNet >= goal
							? 'sessionWidget.heatmap.completed'
							: 'sessionWidget.heatmap.uncompleted',
					)
			: // Every other reading names itself and says its number, so the
				// card reads the same whichever of them the grid is on.
				`${t(`sessionWidget.measure.${measure}`)} ${dayReading(day, measure)}`;
	return [formatDay(day.day, bridge.dateFormat()), said];
}

/** What one day comes to under a measure, written the way that measure reads. */
function dayReading(day: WritingDayTotals, measure: ReadingMeasure): string {
	if (measure === 'time') return formatClock(day.focusMs);
	return grouped(dayValue(day, measure));
}

/** And the number behind it, unwritten. */
function dayValue(day: WritingDayTotals, measure: ReadingMeasure): number {
	if (measure === 'time') return day.focusMs;
	if (measure === 'added') return day.added;
	if (measure === 'deleted') return day.deleted;
	return day.trackedNet;
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
				level === 0 ? 'none' : level < 0 ? 'loss' : heatHue(measure);
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

/**
 * A month at a time, one cell to a day: what the day came to, and a mark on
 * the days that met the goal. The weeks are drawn from the day the reader
 * starts a week on, and the days either side of the month are drawn empty so
 * that every row is a whole week rather than a ragged one.
 *
 * It reads its own month rather than taking a slice of the year the two
 * readings above it share, because a reader can walk back past that year --
 * and a month is one or two files to open, which is what the year cost too.
 */
function renderCalendarWidget(
	parent: HTMLElement,
	bridge: SessionPanelBridge,
): {
	refresh: () => void;
	patch: (summary: WritingDayTotals | null) => void;
	dispose: () => void;
} {
	const t = bridge.t;
	const frame = createWidget(parent, {
		title: t('sessionWidget.calendar.title'),
		cls: 'snowflake-method-widget-span-2 snowflake-method-widget-tall snowflake-method-widget-calendar',
	});
	const measure = createPick(
		frame.header.createDiv({ cls: 'snowflake-method-widget-picks' }),
		t('sessionWidget.calendar.measure'),
		measureOptions(t),
	);
	measure.addEventListener('change', () => {
		bridge.setView({ measure: measure.value as ReadingMeasure });
	});

	const bar = frame.body.createDiv({ cls: 'snowflake-method-calendar-bar' });
	const back = stepButton(bar, 'chevron-left', t('sessionWidget.calendar.previous'));
	const title = bar.createSpan({ cls: 'snowflake-method-calendar-month' });
	const forward = stepButton(bar, 'chevron-right', t('sessionWidget.calendar.next'));
	const grid = frame.body.createDiv({ cls: 'snowflake-method-calendar-grid' });

	let alive = true;
	let anchor = startOfMonth(bridge.today());
	let days = new Map<string, WritingDayTotals>();

	const paint = (): void => {
		const chosen = bridge.view().measure;
		const locale = bridge.locale();
		const start = bridge.weekStart();
		const today = bridge.today();
		measure.value = chosen;
		title.setText(monthTitle(anchor, locale));
		// There is nothing ahead of today to read, so this month is as far
		// forward as the walk goes.
		forward.disabled = anchor === startOfMonth(today);
		grid.empty();
		const weekdays = weekdayLabels(locale, 'short');
		const head = grid.createDiv({ cls: 'snowflake-method-calendar-head' });
		// The names line up over the days, so they start where the days do.
		head.createSpan({ cls: 'snowflake-method-calendar-weekno' });
		for (let at = 0; at < 7; at += 1) {
			head.createDiv({
				cls: 'snowflake-method-calendar-weekday',
				text: weekdays[(weekStartIndex(start) + at) % 7] ?? '',
			});
		}
		const lead = (dayOfWeek(anchor) - weekStartIndex(start) + 7) % 7;
		const goal = bridge.dailyWordGoal();
		for (let week = 0; week < CALENDAR_WEEKS; week += 1) {
			const opening = addDays(anchor, week * 7 - lead);
			const row = grid.createDiv({ cls: 'snowflake-method-calendar-week' });
			// The week's own number, at the left end of the line it opens. It is
			// built like a day -- a number over a reading line, the reading
			// line left empty -- so that the two columns stack to the same
			// height and their numbers come out level with one another.
			const weekno = row.createSpan({
				cls: 'snowflake-method-calendar-weekno',
			});
			weekno.createSpan({
				cls: 'snowflake-method-calendar-weekno-text',
				text: `${weekOfYear(opening, start)}`,
			});
			weekno.createSpan({ cls: 'snowflake-method-calendar-value' });
			for (let at = 0; at < 7; at += 1) {
				const day = addDays(opening, at);
				const cell = row.createDiv({ cls: 'snowflake-method-calendar-day' });
				// The days either side keep the weeks whole and say nothing:
				// they belong to a month this reading is not of.
				const outside = day.slice(0, 7) !== anchor.slice(0, 7);
				if (outside) cell.addClass('is-outside');
				if (day === today) cell.addClass('is-today');
				cell.createSpan({
					cls: 'snowflake-method-calendar-date',
					text: `${dayOfMonth(day)}`,
				});
				// Every day of the month says what it came to, nothing
				// included: a day that moved nothing is a reading, and leaving
				// it blank would make it look like a day with no answer.
				const reading = cell.createSpan({
					cls: 'snowflake-method-calendar-value',
				});
				const totals = outside ? undefined : days.get(day);
				// A day still being written is not a day with a reading: today
				// would say what it has come to so far and be wrong again a
				// sentence later, and a day that has not happened has nothing
				// to be wrong about. Both stay blank.
				if (totals === undefined || day >= today) continue;
				if (goal > 0 && totals.goalNet >= goal) {
					const met = cell.createSpan({
						cls: 'snowflake-method-calendar-met',
						attr: { 'aria-label': t('sessionWidget.calendar.met') },
					});
					// The same mark step ten awards a finished project, which is
					// what a day that met its goal has earned in miniature.
					setIcon(met, 'badge-check');
				}
				const value = dayValue(totals, chosen);
				reading.setText(dayReading(totals, chosen));
				// Words gained and words lost read the way they do everywhere
				// else here, and time takes the accent the rest of the panel
				// measures time in. Nothing at all is coloured as nothing:
				// a day that moved no words did not gain any.
				if (value !== 0) {
					reading.dataset.tone =
						chosen === 'time' ? 'focus' : trendTone(chosen, value);
				}
			}
		}
	};

	const refresh = (): void => {
		const wanted = anchor;
		void bridge
			.month(wanted)
			.then((month) => {
				if (!alive || month === null || wanted !== anchor) return;
				days = new Map(month.map((day) => [day.day, day]));
				paint();
			})
			.catch(() => {
				// A month that cannot be read leaves the last one standing.
			});
	};
	const step = (count: number): void => {
		anchor = addMonths(anchor, count);
		// The shape is redrawn at once and filled in when the month arrives, so
		// a click never leaves the reader looking at the month they left.
		days = new Map();
		paint();
		refresh();
	};
	back.addEventListener('click', () => {
		step(-1);
	});
	forward.addEventListener('click', () => {
		step(1);
	});
	paint();
	refresh();

	return {
		refresh,
		patch: (summary) => {
			const shown = summary === null ? undefined : days.get(summary.day);
			if (summary === null || shown === undefined) return;
			if (
				shown.trackedNet === summary.trackedNet &&
				shown.goalNet === summary.goalNet &&
				shown.focusMs === summary.focusMs
			) {
				return;
			}
			days.set(summary.day, summary);
			paint();
		},
		dispose: () => {
			alive = false;
		},
	};
}

/** A quiet arrow, dressed the way the app dresses its icon buttons. */
function stepButton(
	parent: HTMLElement,
	icon: string,
	label: string,
): HTMLButtonElement {
	const button = parent.createEl('button', {
		cls: 'clickable-icon snowflake-method-calendar-step',
		attr: { type: 'button', 'aria-label': label },
	});
	setIcon(button, icon);
	return button;
}

/**
 * Which hours of the day the writing happened in. A session is cut at every
 * boundary it crosses, so the reading is of the clock rather than of the day
 * a sitting was filed to -- one that ran from eleven at night to one in the
 * morning shows in both of the parts it touched.
 */
function renderBandsWidget(
	parent: HTMLElement,
	bridge: SessionPanelBridge,
): { update: (spread: WritingSpread) => void } {
	const t = bridge.t;
	const frame = createWidget(parent, {
		title: t('sessionWidget.bands.title'),
		cls: 'snowflake-method-widget-span-2 snowflake-method-widget-bands',
	});
	const picks = frame.header.createDiv({ cls: 'snowflake-method-widget-picks' });
	const span = createPick(
		picks,
		t('sessionWidget.bands.span'),
		BAND_SPANS.map((name) => [name, t(`sessionWidget.bands.${name}`)]),
	);
	const measure = createPick(picks, t('sessionWidget.bands.measure'), measureOptions(t));
	span.addEventListener('change', () => {
		bridge.setView({ bandSpan: span.value as BandSpan });
	});
	measure.addEventListener('change', () => {
		bridge.setView({ measure: measure.value as ReadingMeasure });
	});
	const list = frame.body.createDiv({ cls: 'snowflake-method-band-rows' });
	const rows = DAY_BANDS.map((_unused, at) => {
		const row = list.createDiv({ cls: 'snowflake-method-band-row' });
		row.createSpan({ cls: 'snowflake-method-band-label', text: bandLabel(at) });
		const track = row.createDiv({ cls: 'snowflake-method-band-track' });
		return {
			row,
			fill: track.createDiv({ cls: 'snowflake-method-band-fill' }),
			share: row.createSpan({ cls: 'snowflake-method-band-share' }),
		};
	});

	return {
		update: (spread) => {
			const view = bridge.view();
			span.value = view.bandSpan;
			measure.value = view.measure;
			const chosen = view.measure;
			const words = chosen !== 'time';
			const value = (band: BandTotals): number =>
				chosen === 'time'
					? band.focusMs
					: chosen === 'added'
						? band.added
						: chosen === 'deleted'
							? band.deleted
							: band.trackedNet;
			// A share is of the work that happened, whichever way a part of it
			// went: a morning that lost two hundred words was as much of the
			// day's writing as an evening that gained them.
			const whole = spread.bands.reduce(
				(carried, band) => carried + Math.abs(value(band)),
				0,
			);
			for (const [at, band] of spread.bands.entries()) {
				const row = rows[at];
				if (row === undefined) continue;
				const share = whole === 0 ? 0 : Math.abs(value(band)) / whole;
				row.fill.style.width = `${(share * 100).toFixed(1)}%`;
				row.fill.dataset.tone = words ? trendTone(chosen, value(band)) : 'focus';
				row.share.setText(
					whole === 0
						? '—'
						: t('sessionWidget.bands.share', {
								share: (share * 100).toFixed(1),
							}),
				);
				// The number the share is of, for a reader who wants it: a
				// percentage says how the day divided, not how much it came to.
				row.row.setAttribute(
					'title',
					`${bandLabel(at)} · ${
						words
							? grouped(Math.round(value(band)))
							: formatClock(value(band))
					}`,
				);
			}
		},
	};
}

/**
 * The ring of writing stages: the circle its thickness is measured from, how
 * thick it is, how far its corners are rounded, and the arc taken out between
 * one stage and the next. The gap is an arc length at the middle of the ring,
 * so it looks the same width wherever it falls.
 */
const MODE_MID = 42;
const MODE_THICK = 18;
const MODE_CORNER = 4;
const MODE_GAP = 7;

/** How much thicker a stage is drawn while it is the one being read. */
const MODE_LIFT = 5;

/** The least a stage may be drawn as, so a few minutes still show. */
const MODE_SLIVER = 1.5 / MODE_MID;

/**
 * How strongly each stage is drawn, palest first. One hue throughout at four
 * strengths: these are four parts of one piece of work rather than four
 * different things, and the ring darkens as the work moves from planning to
 * proofreading.
 */
const MODE_SHADES = WRITING_MODES.map(
	(_unused, at) => 0.5 + (0.5 * at) / Math.max(1, WRITING_MODES.length - 1),
);

/**
 * One stage as a filled shape: a slice of the ring with all four of its
 * corners rounded. A stroked arc cannot draw this -- a stroke's ends are
 * either cut square or capped with a half circle as wide as the stroke, and
 * that cap is a bulge, not a corner -- so each stage is its own path.
 *
 * Two concentric circles are tangent along the line through their centres, so
 * a corner's own circle sits on the ray through the point it rounds: that is
 * what makes the four fillets meet the arcs and the radial edges cleanly
 * rather than nearly.
 */
function stagePath(from: number, to: number, thick: number): string {
	const outer = MODE_MID + thick / 2;
	const inner = MODE_MID - thick / 2;
	// A corner can be no more than half the ring is thick, and no more of the
	// sweep than the sweep has to give: a stage of a few minutes would
	// otherwise be all corner and no arc.
	const corner = Math.max(
		0.01,
		Math.min(MODE_CORNER, thick / 2, ((to - from) * inner) / 2),
	);
	const outerSeat = outer - corner;
	const innerSeat = inner + corner;
	const outerTurn = Math.asin(corner / outerSeat);
	const innerTurn = Math.asin(corner / innerSeat);
	const outerReach = Math.sqrt(outerSeat * outerSeat - corner * corner);
	const innerReach = Math.sqrt(innerSeat * innerSeat - corner * corner);
	const at = (radius: number, angle: number): string =>
		`${(60 + radius * Math.cos(angle)).toFixed(2)} ${(
			60 +
			radius * Math.sin(angle)
		).toFixed(2)}`;
	const wide = (span: number): number => (span > Math.PI ? 1 : 0);
	return [
		`M ${at(outer, from + outerTurn)}`,
		`A ${outer} ${outer} 0 ${wide(to - from - 2 * outerTurn)} 1 ${at(outer, to - outerTurn)}`,
		`A ${corner} ${corner} 0 0 1 ${at(outerReach, to)}`,
		`L ${at(innerReach, to)}`,
		`A ${corner} ${corner} 0 0 1 ${at(inner, to - innerTurn)}`,
		`A ${inner} ${inner} 0 ${wide(to - from - 2 * innerTurn)} 0 ${at(inner, from + innerTurn)}`,
		`A ${corner} ${corner} 0 0 1 ${at(innerReach, from)}`,
		`L ${at(outerReach, from)}`,
		`A ${corner} ${corner} 0 0 1 ${at(outer, from + outerTurn)}`,
		'Z',
	].join(' ');
}

/**
 * How the whole of the work divided between the stages of it. Sittings are
 * weighed by the focus time in them rather than by the words they produced:
 * planning and proofreading are writing that shows in the manuscript hardly at
 * all, and counting them by their words would say they never happened.
 *
 * The ring says the shares and the key says which stage is which. An exact
 * number is a question rather than a caption, so it is asked by clicking a
 * stage and answered in the middle of the ring.
 */
function renderModesWidget(
	parent: HTMLElement,
	bridge: SessionPanelBridge,
): { update: (spread: WritingSpread) => void } {
	const t = bridge.t;
	const frame = createWidget(parent, {
		title: t('sessionWidget.modes.title'),
		cls: 'snowflake-method-widget-modes',
	});
	const doc = frame.body.doc;
	const dial = frame.body.createDiv({ cls: 'snowflake-method-modes-dial' });
	const svg = svgEl(doc, 'svg', {
		viewBox: '0 0 120 120',
		focusable: 'false',
		class: 'snowflake-method-modes-ring',
	});
	// Drawn only while there is nothing to divide: behind separated stages it
	// would fill the very gaps that separate them.
	const track = svgEl(doc, 'circle', {
		cx: 60,
		cy: 60,
		r: MODE_MID,
		'stroke-width': MODE_THICK,
		class: 'snowflake-method-modes-track',
	});
	svg.append(track);
	const arcs = WRITING_MODES.map((mode, at) => {
		const arc = svgEl(doc, 'path', { class: 'snowflake-method-modes-arc' });
		arc.dataset.mode = mode;
		arc.style.setProperty('--snowflake-method-stage', `${MODE_SHADES[at] ?? 1}`);
		svg.append(arc);
		return arc;
	});
	dial.append(svg);
	// What the ring is of, standing in the hole it leaves: the whole of the
	// focus time until a stage is asked about, and that stage's own reading
	// after.
	const middle = dial.createDiv({ cls: 'snowflake-method-modes-middle' });
	const name = middle.createDiv({ cls: 'snowflake-method-modes-name' });
	const value = middle.createDiv({ cls: 'snowflake-method-modes-value' });
	const note = middle.createDiv({ cls: 'snowflake-method-modes-note' });
	const key = frame.body.createDiv({ cls: 'snowflake-method-modes-key' });
	const entries = WRITING_MODES.map((mode, at) => {
		const row = key.createDiv({ cls: 'snowflake-method-modes-entry' });
		row.dataset.mode = mode;
		const dot = row.createSpan({ cls: 'snowflake-method-modes-dot' });
		dot.style.setProperty('--snowflake-method-stage', `${MODE_SHADES[at] ?? 1}`);
		row.createSpan({
			cls: 'snowflake-method-modes-label',
			text: t(`session.mode.${mode}`),
		});
		return row;
	});

	let totals: ModeTotals[] = emptyModes();
	let picked: WritingMode | null = null;
	const paint = (): void => {
		const whole = totals.reduce((carried, mode) => carried + mode.focusMs, 0);
		track.setAttribute('visibility', whole === 0 ? 'visible' : 'hidden');
		// A quarter of the way round is a quarter of the ring, read from twelve
		// o'clock rather than from three.
		const gap = MODE_GAP / MODE_MID;
		let before = 0;
		for (const [at, mode] of totals.entries()) {
			const share = whole === 0 ? 0 : mode.focusMs / whole;
			const arc = arcs[at];
			if (arc !== undefined) {
				arc.setAttribute('visibility', share > 0 ? 'visible' : 'hidden');
				if (share > 0) {
					const from = -Math.PI / 2 + before * 2 * Math.PI + gap / 2;
					const to = -Math.PI / 2 + (before + share) * 2 * Math.PI - gap / 2;
					arc.setAttribute(
						'd',
						stagePath(
							from,
							from + Math.max(MODE_SLIVER, to - from),
							mode.mode === picked ? MODE_THICK + MODE_LIFT : MODE_THICK,
						),
					);
				}
			}
			const entry = entries[at];
			entry?.classList.toggle('is-picked', mode.mode === picked);
			entry?.setAttribute(
				'title',
				`${t(`session.mode.${mode.mode}`)} · ${formatClock(mode.focusMs)}`,
			);
			before += share;
		}
		const chosen = totals.find((mode) => mode.mode === picked);
		name.setText(chosen === undefined ? '' : t(`session.mode.${chosen.mode}`));
		value.setText(whole === 0 ? '—' : formatClock(chosen?.focusMs ?? whole));
		note.setText(
			chosen === undefined || whole === 0
				? t('sessionWidget.modes.focus')
				: t('sessionWidget.modes.share', {
						share: Math.round((chosen.focusMs / whole) * 100),
					}),
		);
	};
	frame.body.addEventListener('click', (event) => {
		const found =
			event.target instanceof Element
				? event.target.closest('[data-mode]')
				: null;
		const mode =
			found instanceof HTMLElement || found instanceof SVGElement
				? found.dataset.mode
				: undefined;
		// The same stage twice puts the whole back, and so does anywhere else.
		picked =
			mode === undefined || mode === picked ? null : (mode as WritingMode);
		paint();
	});
	paint();

	return {
		update: (spread) => {
			totals = spread.modes;
			paint();
		},
	};
}

/**
 * The measures a reading offers, named once. Every widget builds its chooser
 * from this, so the four of them offer the same words for the same things --
 * which is the half of sharing a measure that a reader actually sees.
 */
function measureOptions(
	t: SessionPanelBridge['t'],
): (readonly [string, string])[] {
	return READING_MEASURES.map((name) => [
		name,
		t(`sessionWidget.measure.${name}`),
	]);
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
