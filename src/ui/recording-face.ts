import { setTooltip } from 'obsidian';

import { formatClock, type RecordingPhase, type RecordingState } from '../domain';
import type { Translate } from './modals';
import { recordingPhaseKey } from './recording-rows';

/**
 * The recording's mark in the status bar: a dot and the running clock,
 * there only while a recording is being made or brought to its end, so
 * the author sees from anywhere in the app that the screen is being
 * recorded. A press opens its menu, where the recording is stopped.
 */

export interface RecordingFaceDeps {
	t: Translate;
	state(): RecordingState;
	subscribe(listener: () => void): () => void;
	openMenu(event: MouseEvent): void;
}

export const RECORDING_FACE_CLASS = 'snowflake-method-recording-face';
export const RECORDING_RIBBON_CLASS = 'snowflake-method-recording-ribbon';

/**
 * How the ribbon's button stands for a phase: the picture it wears, the
 * string its tooltip is said by, whether a recording runs, and whether one
 * is on its way in or out. The button says what a press will do, so it
 * offers the stop from the first moment of a start: a start still under
 * way can be given up.
 */
export function recordingRibbonFace(phase: RecordingPhase): {
	icon: string;
	key: string;
	recording: boolean;
	busy: boolean;
} {
	if (phase === 'idle') {
		return { icon: 'video', key: 'commands.startScreenRecording', recording: false, busy: false };
	}
	return {
		icon: 'circle-stop',
		key: 'commands.stopScreenRecording',
		recording: phase === 'recording',
		busy: phase !== 'recording',
	};
}

/** Dresses a status-bar item as the recording's mark. Returns the release. */
export function mountRecordingFace(item: HTMLElement, deps: RecordingFaceDeps): () => void {
	item.addClass(RECORDING_FACE_CLASS, 'mod-clickable');
	item.createSpan({ cls: 'snowflake-method-recording-dot', attr: { 'aria-hidden': 'true' } });
	const text = item.createSpan();
	const win = item.win;
	let ticker: number | null = null;

	const write = (): void => {
		const state = deps.state();
		const words =
			state.phase === 'recording' && state.startedAt !== null
				? formatClock(Date.now() - state.startedAt)
				: deps.t(recordingPhaseKey(state.phase));
		if (text.textContent !== words) text.setText(words);
	};
	const paint = (): void => {
		const state = deps.state();
		const recording = state.phase === 'recording';
		if (recording && ticker === null) ticker = win.setInterval(write, 1000);
		if (!recording && ticker !== null) {
			win.clearInterval(ticker);
			ticker = null;
		}
		if (state.phase === 'idle') {
			item.hide();
			return;
		}
		item.toggleClass('is-recording', recording);
		write();
		// The name is the mark's tooltip as well: the app keeps one in `aria-label`.
		setTooltip(item, deps.t('settings.section.recording'));
		item.show();
	};
	const open = (event: MouseEvent): void => {
		deps.openMenu(event);
	};
	item.addEventListener('click', open);
	const release = deps.subscribe(paint);
	paint();
	return () => {
		release();
		item.removeEventListener('click', open);
		if (ticker !== null) win.clearInterval(ticker);
		ticker = null;
	};
}

/** As much of the app's ribbon as placing a button needs: its list of buttons, and the call that draws and keeps their order. */
interface RibbonList {
	items: { buttonEl?: unknown }[];
	onChange(save: boolean): void;
}

function isRibbonList(ribbon: unknown): ribbon is RibbonList {
	if (typeof ribbon !== 'object' || ribbon === null) return false;
	const { items, onChange } = ribbon as { items?: unknown; onChange?: unknown };
	return (
		typeof onChange === 'function' &&
		Array.isArray(items) &&
		items.every((item) => typeof item === 'object' && item !== null)
	);
}

/**
 * Moves one of the ribbon's buttons to stand right under another, and has
 * the ribbon draw the new order and keep it. A button the vault's saved
 * order has never heard of is sorted before every other when the layout
 * loads, which would set a new one above the app's own.
 *
 * The ribbon's list is the app's and no part of what it promises, so it is
 * looked at before it is touched: where it is not what this knows, nothing
 * moves and the answer is no. Buttons are told apart by their elements,
 * since the app names them by their tooltips, which change with language.
 */
export function placeRibbonButtonUnder(ribbon: unknown, button: HTMLElement, above: HTMLElement): boolean {
	if (!isRibbonList(ribbon)) return false;
	const { items } = ribbon;
	const from = items.findIndex((item) => item.buttonEl === button);
	const anchor = items.findIndex((item) => item.buttonEl === above);
	if (from === -1 || anchor === -1 || from === anchor) return false;
	// Already there: nothing to draw, and nothing to save.
	if (from === anchor + 1) return true;
	const [moved] = items.splice(from, 1);
	if (moved === undefined) return false;
	items.splice(items.findIndex((item) => item.buttonEl === above) + 1, 0, moved);
	ribbon.onChange(true);
	return true;
}
