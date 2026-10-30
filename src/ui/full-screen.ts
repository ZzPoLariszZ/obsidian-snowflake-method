import type { Translate } from './modals';
import { paintSymbol, toolbarIconButton, type SymbolMemo } from './workspace-frame';

/** The class the view's leaf wears while a board fills the window. */
export const FULL_SCREEN_CLASS = 'snowflake-method-full-screen';
/** The class the leaf's tab group wears meanwhile, for a tablet to put the group's tab bar away. */
export const FULL_SCREEN_GROUP_CLASS = 'snowflake-method-full-screen-group';

/**
 * What a board's toolbar asks of the view it stands in: to fill the window
 * with the board, and to hand the window back. The view answers for the
 * leaf, its tab group and the window's sidebars; the board only asks.
 */
export interface FullScreenControl {
	/** Whether the board fills the window now. */
	active(): boolean;
	/** Fills the window with the board, or hands the window back. */
	toggle(): void;
	/**
	 * Hears every change of the answer, however it came about: by the
	 * button, by Escape, or by the tab leaving the screen. The view forgets
	 * the listener with the board.
	 */
	changed(listener: () => void): void;
}

/**
 * The full screen button of a board's toolbar, standing before the button
 * handed in, the refresh, which is where a tablet's toolbar keeps the two
 * while the rest go into a menu. A board with no control, one that stands in
 * another's frame, gets no button and null. Its symbols are the arrows that
 * reach out to the corners and back, not the corner brackets the boards'
 * fit buttons wear, which read as the same control beside them.
 */
export function mountFullScreenButton(
	end: HTMLElement,
	before: HTMLElement,
	t: Translate,
	control: FullScreenControl | undefined,
): HTMLButtonElement | null {
	if (control === undefined) return null;
	const button = toolbarIconButton(end, 'snowflake-method-toolbar-full-screen', 'expand', t('storyStructure.fullScreen'));
	end.insertBefore(button, before);
	const memo: SymbolMemo = { icon: 'expand' };
	const paint = (): void => {
		const active = control.active();
		paintSymbol(button, memo, {
			icon: active ? 'shrink' : 'expand',
			label: t(active ? 'storyStructure.fullScreen.exit' : 'storyStructure.fullScreen'),
			pressed: active,
			disabled: false,
		});
	};
	button.addEventListener('click', () => {
		control.toggle();
		paint();
	});
	control.changed(paint);
	paint();
	return button;
}

/** The buttons a tablet's toolbar keeps beside its menu, with a button that was not made left out. */
export function toolbarKept(...buttons: readonly (HTMLElement | null)[]): HTMLElement[] {
	return buttons.filter((button): button is HTMLElement => button !== null);
}
