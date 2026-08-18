import { setIcon } from 'obsidian';

import {
	WRITING_MODES,
	WRITING_SESSION_TYPES,
	formatClock,
	type WritingMode,
	type WritingSessionType,
} from '../domain';
import type { LiveWritingSession, TodayWritingSummary } from '../services';

/**
 * What a session panel needs from the plugin, and nothing else: the panel is
 * rendered twice -- in the statistics sidebar and in the dashboard's
 * statistics pane -- and both must be the same panel over the same session.
 */
export interface SessionPanelBridge {
	t: (key: string, vars?: Record<string, string | number>) => string;
	live(): LiveWritingSession | null;
	todaySummary(): Promise<TodayWritingSummary | null>;
	/** Fires on every change; `structural` marks a start, stop or recovery. */
	subscribe(listener: (structural: boolean) => void): () => void;
	startQuick(type: WritingSessionType): void;
	startWithOptions(): void;
	pauseOrResume(): void;
	stop(): void;
	setWritingMode(mode: WritingMode): void;
}

const TYPE_ICONS: Record<WritingSessionType, string> = {
	stopwatch: 'clock',
	countdown: 'timer',
	pomodoro: 'snowflake-method-pomodoro',
};

/**
 * Renders the live session card and today's totals into `container` and keeps
 * them current. The once-a-second updates patch this panel's own text nodes;
 * nothing here ever asks a host view to re-render itself. Returns the
 * disposer, which the host must call before it empties the container.
 */
export function renderSessionPanel(
	container: HTMLElement,
	bridge: SessionPanelBridge,
): () => void {
	const t = bridge.t;
	const root = container.createDiv({ cls: 'snowflake-method-session-panel' });

	const start = root.createDiv({ cls: 'snowflake-method-session-start' });
	for (const type of WRITING_SESSION_TYPES) {
		const button = start.createEl('button', {
			cls: 'snowflake-method-session-start-button',
			attr: { type: 'button' },
		});
		const iconEl = button.createSpan({ attr: { 'aria-hidden': 'true' } });
		setIcon(iconEl, TYPE_ICONS[type]);
		button.createSpan({ text: t(`sessionMenu.start.${type}`) });
		button.addEventListener('click', () => {
			bridge.startQuick(type);
		});
	}
	const withOptions = start.createEl('button', {
		cls: 'snowflake-method-session-start-button',
		attr: { type: 'button' },
	});
	const optionsIcon = withOptions.createSpan({ attr: { 'aria-hidden': 'true' } });
	setIcon(optionsIcon, 'sliders-horizontal');
	withOptions.createSpan({ text: t('sessionMenu.startWithOptions') });
	withOptions.addEventListener('click', () => {
		bridge.startWithOptions();
	});

	const card = root.createDiv({ cls: 'snowflake-method-session-card' });
	const header = card.createDiv({ cls: 'snowflake-method-session-header' });
	const typeIcon = header.createSpan({
		cls: 'snowflake-method-session-type-icon',
		attr: { 'aria-hidden': 'true' },
	});
	const headerText = header.createSpan();
	const clock = card.createDiv({ cls: 'snowflake-method-session-clock' });
	const rows = card.createDiv({ cls: 'snowflake-method-session-rows' });
	const focusRow = rows.createDiv();
	const idleRow = rows.createDiv();
	const totalRow = rows.createDiv();
	const wordsRow = rows.createDiv();
	const paceRow = rows.createDiv();
	const goalRow = rows.createDiv();
	const controls = card.createDiv({ cls: 'snowflake-method-session-controls' });
	const pauseButton = controls.createEl('button', { attr: { type: 'button' } });
	pauseButton.addEventListener('click', () => {
		bridge.pauseOrResume();
	});
	const stopButton = controls.createEl('button', {
		text: t('sessionMenu.stop'),
		attr: { type: 'button' },
	});
	stopButton.addEventListener('click', () => {
		bridge.stop();
	});
	const modeSelect = controls.createEl('select', {
		cls: 'dropdown',
		attr: { 'aria-label': t('session.modal.mode') },
	});
	for (const mode of WRITING_MODES) {
		modeSelect.createEl('option', {
			value: mode,
			text: t(`session.mode.${mode}`),
		});
	}
	modeSelect.addEventListener('change', () => {
		const mode = modeSelect.value;
		if ((WRITING_MODES as readonly string[]).includes(mode)) {
			bridge.setWritingMode(mode as WritingMode);
		}
	});

	const today = root.createDiv({ cls: 'snowflake-method-session-today' });
	today.createDiv({
		cls: 'snowflake-method-session-today-title',
		text: t('sessionPanel.today'),
	});
	const todayLine = today.createDiv({
		cls: 'snowflake-method-session-today-line',
		text: t('sessionPanel.todayEmpty'),
	});

	let shownIcon = '';
	const update = (): void => {
		const live = bridge.live();
		start.toggle(live === null);
		card.toggle(live !== null);
		if (live === null) return;
		if (shownIcon !== TYPE_ICONS[live.type]) {
			shownIcon = TYPE_ICONS[live.type];
			setIcon(typeIcon, shownIcon);
		}
		const state = live.pomodoro?.phase === 'break' ? 'break' : live.state;
		headerText.setText(
			[
				t(`session.type.${live.type}`),
				t(`session.state.${state}`),
				t(`session.mode.${live.writingMode}`),
				...(live.pomodoro === null
					? []
					: [t('session.stat.cycle', { cycle: live.pomodoro.cycle })]),
			].join(' · '),
		);
		clock.setText(
			live.state === 'starting'
				? t('statusBar.sessionStarting')
				: live.type === 'stopwatch'
					? formatClock(live.durations.totalMs)
					: formatClock(live.remainingMs ?? 0),
		);
		focusRow.setText(
			t('session.stat.focus', {
				duration: formatClock(live.durations.focusMs),
			}),
		);
		idleRow.setText(
			t('session.stat.idle', { duration: formatClock(live.durations.idleMs) }),
		);
		totalRow.setText(
			t('session.stat.total', {
				duration: formatClock(live.durations.totalMs),
			}),
		);
		wordsRow.setText(
			t('session.stat.words', {
				added: live.added,
				deleted: live.deleted,
				net: live.trackedNet,
			}),
		);
		const showPace = live.durations.focusMs >= 60_000;
		paceRow.toggle(showPace);
		if (showPace) {
			paceRow.setText(
				t('session.stat.pace', {
					pace: Math.round(
						(live.trackedNet * 3_600_000) / live.durations.focusMs,
					),
				}),
			);
		}
		goalRow.toggle(live.goal !== null);
		if (live.goal !== null) {
			goalRow.setText(
				live.goalMet
					? t('session.stat.goalReached')
					: [
							...(live.goal.netWordTarget === undefined
								? []
								: [
										t('session.stat.goalNet', {
											net: live.trackedNet,
											target: live.goal.netWordTarget,
										}),
									]),
							...(live.goal.focusTimeTargetSeconds === undefined
								? []
								: [
										t('session.stat.goalFocus', {
											done: formatClock(live.durations.focusMs),
											target: formatClock(
												live.goal.focusTimeTargetSeconds * 1000,
											),
										}),
									]),
						].join(' · '),
			);
		}
		const paused = live.state === 'paused';
		pauseButton.setText(t(paused ? 'sessionMenu.resume' : 'sessionMenu.pause'));
		// A break is not the author's pause to lift.
		pauseButton.toggle(live.pomodoro?.phase !== 'break');
		if (modeSelect.value !== live.writingMode) {
			modeSelect.value = live.writingMode;
		}
	};

	// A refresh may find the panel already gone; the token stops a late
	// answer from writing into a detached element for nothing.
	let disposed = false;
	const refreshToday = (): void => {
		void bridge
			.todaySummary()
			.then((summary) => {
				if (disposed || summary === null) return;
				todayLine.setText(
					summary.sessions === 0
						? t('sessionPanel.todayEmpty')
						: t('sessionPanel.todayLine', {
								sessions: summary.sessions,
								focus: formatClock(summary.focusMs),
								total: formatClock(summary.totalMs),
								net: summary.trackedNet,
							}),
				);
			})
			.catch(() => {
				// A summary that cannot be read leaves yesterday's line standing.
			});
	};

	const unsubscribe = bridge.subscribe((structural) => {
		update();
		if (structural) refreshToday();
	});
	update();
	refreshToday();

	return () => {
		disposed = true;
		unsubscribe();
		root.remove();
	};
}
