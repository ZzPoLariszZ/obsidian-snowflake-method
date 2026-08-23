import { setIcon, setTooltip, Setting, type App } from 'obsidian';

import { followAnchor } from './anchored-panel';

import {
	CONTENT_WIDTH_STOPS,
	DEFAULT_MANUSCRIPT_PRESENTATION,
	FIRST_LINE_INDENT_STOPS,
	FONT_SIZE_STOPS,
	LINE_HEIGHT_STOPS,
	MANUSCRIPT_GUIDES,
	MANUSCRIPT_TEXT_ALIGNS,
	MANUSCRIPT_TINTS,
	PARAGRAPH_SPACING_STOPS,
	PRESENTATION_THEME_VARS,
	type ManuscriptPresentation,
} from '../domain';
import {
	addChoicePicker,
	addFontFamilyPicker,
	addStopSlider,
	addTintSwatches,
	addToggleControl,
} from './presentation-controls';

/**
 * The popover that dresses the page from the page: the same controls the
 * settings tab offers, hung under the formatting bar's palette button, over
 * the manuscript, so a change is seen as it is made. Built in the manner of
 * the dashboard's filter panel — body-parented, placed against its anchor,
 * dismissed by a click outside or Escape — and writing through the host,
 * so the settings tab and every other stream read the same values.
 */
export interface PresentationPanelDeps {
	app: App;
	/** The button the panel hangs under. */
	anchor: HTMLElement;
	t: (key: string, vars?: Record<string, string | number>) => string;
	look: () => ManuscriptPresentation;
	set: (patch: Partial<ManuscriptPresentation>) => Promise<void>;
	/** The faces set lately, newest first, offered at the top of the font list. */
	recentFonts: () => readonly string[];
	/** Whether Enter puts the paragraph break: shown among the paragraph rows. */
	enterParagraph: () => boolean;
	setEnterParagraph: (on: boolean) => Promise<void>;
	/** Told when the panel has gone, by whichever route it went. */
	onClose: (how: PanelCloseReason) => void;
}

/** How a panel came to close: by the keyboard, by a click elsewhere, or by the view. */
export type PanelCloseReason = 'keyboard' | 'pointer' | 'view';

export interface PresentationPanel {
	el: HTMLElement;
	/** Shows a dress that changed elsewhere. Ignored while the panel is writing one. */
	sync(look: ManuscriptPresentation): void;
	close(how?: PanelCloseReason): void;
}


export function openPresentationPanel(
	deps: PresentationPanelDeps,
): PresentationPanel {
	const { anchor, t } = deps;
	const win = anchor.win;
	const doc = win.activeDocument;
	// The row for the ground shows the mode in force; the other mode's is
	// on the settings page, where both sit side by side.
	const dark = doc.body.hasClass('theme-dark');
	const panel = doc.body.createDiv({
		cls: 'snowflake-method-presentation-panel',
		attr: {
			role: 'dialog',
			'aria-label': t('settings.manuscriptAppearance.heading'),
		},
	});
	// A dialog's header, because that is what this is: the title in the size
	// the app titles a dialog with, and the close in the corner where the app
	// puts it, so the popover reads as one of the plugin's own windows rather
	// than as a menu that happens to hold settings.
	const header = panel.createDiv({
		cls: 'snowflake-method-presentation-panel-header',
	});
	header.createDiv({
		cls: 'snowflake-method-presentation-panel-title',
		text: t('settings.manuscriptAppearance.heading'),
	});
	const closeButton = header.createEl('button', {
		cls: 'clickable-icon snowflake-method-presentation-panel-close',
		attr: { type: 'button', 'aria-label': t('common.close') },
	});
	setIcon(closeButton, 'x');
	setTooltip(closeButton, t('common.close'));
	closeButton.addEventListener('click', () => {
		close('pointer');
	});
	const body = panel.createDiv({ cls: 'snowflake-method-presentation-panel-body' });

	// While the panel's own change is on its way round — saved, announced,
	// applied to this very stream — the echo is not news; what comes back
	// after the write is, because the host held the value to its range.
	let writing = false;
	const write = (patch: Partial<ManuscriptPresentation>): void => {
		writing = true;
		void deps.set(patch).finally(() => {
			writing = false;
			sync(deps.look());
		});
	};
	const writeEnter = (on: boolean): void => {
		writing = true;
		void deps.setEnterParagraph(on).finally(() => {
			writing = false;
			sync(deps.look());
		});
	};
	const row = (name: string): Setting => new Setting(body).setName(name);
	const look = deps.look();
	const themeDefault = t('settings.manuscriptAppearance.themeDefault');
	const resetLabel = t('settings.manuscriptAppearance.reset');
	const fallback = DEFAULT_MANUSCRIPT_PRESENTATION;
	const pixels = (value: number): string =>
		value === 0
			? themeDefault
			: t('settings.manuscriptAppearance.pixels', { value });

	// The rows in the order the page is built up: the type first, then how it
	// sits in the column, then the paper it sits on.
	const familyName = t('settings.manuscriptFontFamily.name');
	const family = addFontFamilyPicker(deps.app, row(familyName), {
		value: look.fontFamily,
		themeLabel: t('settings.manuscriptFontFamily.placeholder'),
		placeholder: t('settings.manuscriptFontFamily.placeholder'),
		label: familyName,
		recent: () => deps.recentFonts(),
		sections: {
			recent: t('settings.manuscriptFontFamily.recent'),
			all: t('settings.manuscriptFontFamily.all'),
		},
		useLabel: (typed) => t('settings.manuscriptFontFamily.use', { value: typed }),
		missingLabel: (face) => t('settings.manuscriptFontFamily.missing', { value: face }),
		onPick: (value) => {
			write({ fontFamily: value });
		},
	});
	const size = addStopSlider(row(t('settings.manuscriptFontSize.name')), {
		stops: FONT_SIZE_STOPS,
		value: look.fontSize,
		resetValue: fallback.fontSize,
		resetLabel,
		themeVar: PRESENTATION_THEME_VARS.fontSize,
		format: pixels,
		onPick: (value) => {
			write({ fontSize: value });
		},
	});
	const lineHeight = addStopSlider(row(t('settings.manuscriptLineHeight.name')), {
		stops: LINE_HEIGHT_STOPS,
		value: look.lineHeight,
		resetValue: fallback.lineHeight,
		resetLabel,
		themeVar: PRESENTATION_THEME_VARS.lineHeight,
		format: (value) => (value === 0 ? themeDefault : String(value)),
		onPick: (value) => {
			write({ lineHeight: value });
		},
	});
	const width = addStopSlider(row(t('settings.manuscriptContentWidth.name')), {
		stops: CONTENT_WIDTH_STOPS,
		value: look.contentWidth,
		resetValue: fallback.contentWidth,
		resetLabel,
		themeVar: PRESENTATION_THEME_VARS.contentWidth,
		format: pixels,
		onPick: (value) => {
			write({ contentWidth: value });
		},
	});
	const spacing = addStopSlider(
		row(t('settings.manuscriptParagraphSpacing.name')),
		{
			stops: PARAGRAPH_SPACING_STOPS,
			value: look.paragraphSpacing,
			resetValue: fallback.paragraphSpacing,
			resetLabel,
			format: (value) =>
				t(
					value === 1
						? 'settings.manuscriptParagraphSpacing.line'
						: 'settings.manuscriptParagraphSpacing.lines',
					{ value },
				),
			onPick: (value) => {
				write({ paragraphSpacing: value });
			},
		},
	);
	const indent = addStopSlider(row(t('settings.manuscriptFirstLineIndent.name')), {
		stops: FIRST_LINE_INDENT_STOPS,
		value: look.firstLineIndent,
		resetValue: fallback.firstLineIndent,
		resetLabel,
		format: (value) =>
			value === 0
				? t('settings.manuscriptFirstLineIndent.none')
				: t('settings.manuscriptFirstLineIndent.value', { value }),
		onPick: (value) => {
			write({ firstLineIndent: value });
		},
	});
	const align = addChoicePicker(row(t('settings.manuscriptTextAlign.name')), {
		value: look.textAlign,
		options: MANUSCRIPT_TEXT_ALIGNS.map((value) => ({
			value,
			label: t(`settings.manuscriptTextAlign.${value}`),
		})),
		onPick: (value) => {
			write({ textAlign: value });
		},
	});
	const guide = addChoicePicker(row(t('settings.manuscriptGuide.name')), {
		value: look.guide,
		options: MANUSCRIPT_GUIDES.map((value) => ({
			value,
			label: t(`settings.manuscriptGuide.${value}`),
		})),
		onPick: (value) => {
			write({ guide: value });
		},
	});
	const hyphens = addToggleControl(row(t('settings.manuscriptHyphenation.name')), {
		value: look.hyphenation,
		onPick: (value) => {
			write({ hyphenation: value });
		},
	});
	const enter = addToggleControl(
		row(t('settings.manuscriptEnterParagraph.name')),
		{
			value: deps.enterParagraph(),
			onPick: (on) => {
				writeEnter(on);
			},
		},
	);
	const tint = addTintSwatches(
		row(
			t(
				dark
					? 'settings.manuscriptTintDark.name'
					: 'settings.manuscriptTintLight.name',
			),
		),
		{
			value: dark ? look.tintDark : look.tintLight,
			presets: (dark ? MANUSCRIPT_TINTS.dark : MANUSCRIPT_TINTS.light).map(
				(preset) => ({
					hex: preset.hex,
					label: t(`settings.manuscriptTint.${preset.name}`),
				}),
			),
			labels: {
				themeDefault: t('settings.manuscriptTint.themeDefault'),
				custom: t('settings.manuscriptTint.custom'),
			},
			onPick: (value) => {
				write(dark ? { tintDark: value } : { tintLight: value });
			},
		},
	);

	const sync = (next: ManuscriptPresentation): void => {
		if (writing) return;
		family.sync(next.fontFamily);
		size.sync(next.fontSize);
		lineHeight.sync(next.lineHeight);
		width.sync(next.contentWidth);
		spacing.sync(next.paragraphSpacing);
		indent.sync(next.firstLineIndent);
		enter.sync(deps.enterParagraph());
		align.sync(next.textAlign);
		hyphens.sync(next.hyphenation);
		tint.sync(dark ? next.tintDark : next.tintLight);
		guide.sync(next.guide);
	};

	// Under the button and lined up with its end, in the layer above the
	// workspace: the panel covers a page that scrolls, and a panel inside it
	// would be clipped by it. Where exactly, and keeping it there, is the
	// shared panel helper's -- the dashboard's filter panel hangs the same way.
	const unfollow = followAnchor(panel, anchor, win);
	anchor.setAttribute('aria-expanded', 'true');

	let open = true;
	const close = (how: PanelCloseReason = 'view'): void => {
		if (!open) return;
		open = false;
		win.removeEventListener('mousedown', dismiss, true);
		win.removeEventListener('keydown', onKey, true);
		unfollow();
		anchor.setAttribute('aria-expanded', 'false');
		family.destroy?.();
		panel.remove();
		deps.onClose(how);
	};
	/** The list a field can open, which the app parents to the body. */
	const suggestions = (): HTMLElement | null =>
		doc.querySelector('.suggestion-container');
	// A click inside the panel is the author using it; one on the button is
	// the button's own business, which closes the panel itself. A click in a
	// field's suggestion list is the author using the panel too, even though
	// the list hangs off the body rather than off the panel -- without this
	// the panel closed under the pointer and the pick never landed.
	const dismiss = (event: MouseEvent): void => {
		const target = event.target as Node | null;
		if (target === null) return;
		if (panel.contains(target) || anchor.contains(target)) return;
		const el = target.instanceOf(HTMLElement) ? target : target.parentElement;
		if (el?.closest('.suggestion-container') != null) return;
		close('pointer');
	};
	const onKey = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		// A list open over the panel answers the key first: one Escape puts the
		// list away, the next puts the panel away.
		if (suggestions() !== null) return;
		close('keyboard');
	};
	win.addEventListener('mousedown', dismiss, true);
	win.addEventListener('keydown', onKey, true);

	return { el: panel, sync, close };
}
