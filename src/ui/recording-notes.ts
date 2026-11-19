import { setIcon } from 'obsidian';

import type { Translate } from './modals';
import { RECORDING_NOTES } from './recording-rows';

/**
 * What an author is told before recording, drawn once for the two places
 * that say it: the settings' section, where it stands at all times, and the
 * dialog before a start, where it cannot be missed.
 */

/** How a notice reads: plain words, the accent of something offered, or a warning. */
export type RecordingNoticeTone = 'accent' | 'warning' | 'muted';

/** One notice with a sign before it. A break in the words is a line of its own. */
export function recordingNotice(parent: HTMLElement, tone: RecordingNoticeTone, words: string): HTMLElement {
	const line = parent.createDiv({ cls: 'snowflake-method-history-notice' });
	line.dataset.tone = tone;
	setIcon(
		line.createSpan({ cls: 'snowflake-method-history-notice-icon', attr: { 'aria-hidden': 'true' } }),
		tone === 'warning' ? 'triangle-alert' : 'info',
	);
	const text = line.createSpan({ cls: 'snowflake-method-history-notice-text' });
	const lines = words.split('\n');
	if (lines.length === 1) text.setText(words);
	else for (const each of lines) text.createDiv({ text: each });
	return line;
}

/** What a recording is for, said in the accent, then the one warning of what it shows and what it costs. */
export function renderRecordingNoteLines(parent: HTMLElement, t: Translate): void {
	for (const note of RECORDING_NOTES) recordingNotice(parent, note.tone, t(note.key));
}
