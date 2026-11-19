// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { t as translate } from '../../src/i18n';
import { mountRecordingSkipBox } from '../../src/ui/recording-dialogs';
import { renderRecordingNoteLines } from '../../src/ui/recording-notes';
import { installObsidianDom } from '../helpers/obsidian-dom';

const t = (key: string, vars?: Record<string, string | number>): string => translate('en', key, vars);

describe('the dialog before a recording starts', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it('says what the settings say, drawn as they draw it: what a recording is for, then the one warning', () => {
		const body = document.body.createDiv();
		renderRecordingNoteLines(body, t);
		const notices = [...body.querySelectorAll<HTMLElement>('.snowflake-method-history-notice')];
		expect(notices.map((notice) => notice.dataset.tone)).toEqual(['accent', 'warning']);
		expect(notices[0]?.textContent).toBe('When someone claims AI wrote your novel, answer with the record of how you wrote it!');
		// The warning keeps its two lines, each in a box of its own.
		expect(
			[...(notices[1]?.querySelectorAll('.snowflake-method-history-notice-text > div') ?? [])].map((line) => line.textContent),
		).toEqual([
			'A recording shows everything on the screen. Watch it yourself before you share it.',
			'Recording may slow the computer, and the video files take a lot of disk space.',
		]);
		expect(notices.every((notice) => notice.querySelector('svg, .snowflake-method-history-notice-icon') !== null)).toBe(true);
	});

	it('puts a box at the head of the buttons that says not to ask again, as Obsidian’s own confirmations do', () => {
		const actions = document.body.createDiv({ cls: 'snowflake-method-modal-actions' });
		actions.createEl('button', { text: 'Cancel' });
		actions.createEl('button', { text: 'Start recording' });
		const heard: boolean[] = [];
		const box = mountRecordingSkipBox(actions, t, (skip) => heard.push(skip));
		const label = actions.firstElementChild;
		expect(label?.tagName).toBe('LABEL');
		// Obsidian's class for such a box, and the plugin's for what leads a row of buttons.
		expect(label?.classList.contains('mod-checkbox')).toBe(true);
		expect(label?.classList.contains('snowflake-method-modal-leading-action')).toBe(true);
		expect(label?.textContent).toBe('Don’t ask again');
		expect([box.type, box.checked, label?.contains(box)]).toEqual(['checkbox', false, true]);
		// Unlike Obsidian's, it can be reached with the keyboard.
		expect(box.hasAttribute('tabindex')).toBe(false);
		box.checked = true;
		box.dispatchEvent(new Event('change'));
		box.checked = false;
		box.dispatchEvent(new Event('change'));
		expect(heard).toEqual([true, false]);
		expect([...actions.children].map((child) => child.tagName)).toEqual(['LABEL', 'BUTTON', 'BUTTON']);
	});
});
