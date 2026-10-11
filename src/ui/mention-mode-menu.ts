/**
 * Which marks a page wears, offered from a bar's own button: the stream's
 * and a note's alike. Both read the same settings, so a change made from
 * either reaches every page that wears marks.
 *
 * Every family under one button, each a titled section: the entities with
 * their four modes, sensitive words and the custom rules as plain switches,
 * dialogue with its three faces. The settings page's own gear offers the
 * same four in a dialog.
 */

import { Menu } from 'obsidian';

import {
	DIALOGUE_PRESENTATIONS,
	MENTION_HIGHLIGHT_MODES,
	type DialoguePresentation,
	type MentionHighlightMode,
} from '../domain';

/** The choice each family stands at, which the menu shows checked. */
export interface MentionModeChoices {
	mentionHighlight: MentionHighlightMode;
	sensitiveHighlight: boolean;
	dialoguePresentation: DialoguePresentation;
	customHighlights: boolean;
}

/** Where a pick is written: the settings every page reads. */
export interface MentionModeSetters {
	setMentionHighlight(mode: MentionHighlightMode): Promise<void>;
	setSensitiveHighlight(on: boolean): Promise<void>;
	setDialoguePresentation(mode: DialoguePresentation): Promise<void>;
	setCustomHighlights(on: boolean): Promise<void>;
}

export interface MentionModeMenuOptions {
	t: (key: string, vars?: Record<string, string | number>) => string;
	choices: MentionModeChoices;
	set: MentionModeSetters;
	showError(error: unknown): void;
	event: MouseEvent;
}

export function openMentionModeMenu(options: MentionModeMenuOptions): void {
	const { t, choices, set } = options;
	const menu = new Menu();
	const label = (text: string): void => {
		menu.addItem((item) => item.setTitle(text).setIsLabel(true));
	};
	const pick = (
		text: string,
		checked: boolean,
		apply: () => Promise<void>,
	): void => {
		menu.addItem((item) =>
			item
				.setTitle(text)
				.setChecked(checked)
				.onClick(() => {
					void apply().catch((error: unknown) => {
						options.showError(error);
					});
				}),
		);
	};
	const off = t('settings.mentionHighlight.off');
	const on = t('settings.mentionHighlight.on');
	label(t('settings.mentionHighlight.entities'));
	for (const mode of MENTION_HIGHLIGHT_MODES) {
		pick(
			t(`settings.mentionHighlight.${mode}`),
			mode === choices.mentionHighlight,
			() => set.setMentionHighlight(mode),
		);
	}
	menu.addSeparator();
	label(t('settings.sensitiveWords.heading'));
	pick(off, !choices.sensitiveHighlight, () => set.setSensitiveHighlight(false));
	pick(on, choices.sensitiveHighlight, () => set.setSensitiveHighlight(true));
	menu.addSeparator();
	label(t('settings.mentionHighlight.dialogues'));
	for (const mode of DIALOGUE_PRESENTATIONS) {
		pick(
			t(`settings.dialoguePresentation.${mode}`),
			mode === choices.dialoguePresentation,
			() => set.setDialoguePresentation(mode),
		);
	}
	menu.addSeparator();
	label(t('settings.mentionHighlight.custom'));
	pick(off, !choices.customHighlights, () => set.setCustomHighlights(false));
	pick(on, choices.customHighlights, () => set.setCustomHighlights(true));
	menu.showAtMouseEvent(options.event);
}
