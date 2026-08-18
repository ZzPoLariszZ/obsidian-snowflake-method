import { setIcon } from 'obsidian';

import {
	formatClock,
	type WritingMode,
	type WritingSessionScope,
	type WritingSessionType,
} from '../domain';
import type { LiveWritingSession, TodayWritingSummary } from '../services';

/**
 * Which project a session panel is for, and how it should speak. Both are
 * omitted by a panel that belongs to no project in particular.
 */
export interface SessionPanelContext {
	t?: (key: string, vars?: Record<string, string | number>) => string;
	/** The project metadata note whose day this panel reads. */
	projectPath?: string | null;
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
	live(): LiveWritingSession | null;
	todaySummary(): Promise<TodayWritingSummary | null>;
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
): () => void {
	const root = container.createDiv({ cls: 'snowflake-method-session-widgets' });

	const goal = renderGoalWidget(root, bridge);
	const timer = renderTimerWidget(root, bridge);
	const today = renderTodayWidget(root, bridge);

	// A refresh may find the panel already gone; the token stops a late
	// answer from writing into a detached element for nothing.
	let disposed = false;
	let lastReadAt = 0;
	const refreshToday = (): void => {
		lastReadAt = Date.now();
		void bridge
			.todaySummary()
			.then((summary) => {
				if (disposed) return;
				today.update(summary);
				goal.update(summary);
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
		if (structural || Date.now() - lastReadAt >= DAY_REREAD_MS) refreshToday();
	});
	timer.update();
	refreshToday();

	return () => {
		disposed = true;
		unsubscribe();
		root.remove();
	};
}

interface WidgetFrame {
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
	return { body: widget.createDiv({ cls: 'snowflake-method-widget-body' }) };
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
