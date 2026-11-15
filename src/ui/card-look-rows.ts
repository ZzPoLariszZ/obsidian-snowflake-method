/**
 * The rows a Display panel asks a surface's look by: the card style, and
 * the three sizes on their rails. The corkboard asks them of its own cards,
 * a scene pool of its own, and a timeline or a beat sheet of the cards on
 * its lanes, so the three panels read alike and a size means the same on
 * each: a card's width, the standard card's height, the type of the text.
 *
 * The rows hold no surface. Each is told the look kept, which a
 * confirmation writes, and how to show a draft, which the panel does while
 * it stands open and takes back when it closes any other way.
 */

import { CORKBOARD_TEXT_MODES } from './corkboard-layout';
import type { FilterOptionRow, FilterSliderRow } from './filter-rows';
import type { Translate } from './modals';
import {
	CORKBOARD_MODES,
	CORKBOARD_SIZE_STOPS,
	isCorkboardMode,
	type CorkboardLook,
	type CorkboardMode,
	type CorkboardSizeKey,
} from './story-structure-state';

/** The words each size is named by. */
const SIZE_LABELS: Readonly<Record<CorkboardSizeKey, string>> = {
	cardWidth: 'corkboard.cardWidth',
	cardHeight: 'corkboard.cardHeight',
	textSize: 'corkboard.textSize',
};

/**
 * The card style's row. With a way to show a draft, the style picked is
 * drawn while the panel stands open; without one it is kept on Confirm
 * alone, as a surface with no sizes to set has always had it.
 */
export function cardStyleRow(
	t: Translate,
	held: { mode: CorkboardMode },
	preview?: (mode: CorkboardMode) => void,
): FilterOptionRow {
	const read = (value: string): CorkboardMode => (isCorkboardMode(value) ? value : 'standard');
	return {
		label: t('corkboard.cards'),
		placeholder: t('corkboard.cards.standard'),
		empty: 'standard',
		options: () =>
			CORKBOARD_MODES.filter((mode) => mode !== 'standard').map((mode) => ({
				value: mode,
				label: t(`corkboard.cards.${mode}`),
			})),
		value: held.mode,
		apply: (value) => {
			held.mode = read(value);
		},
		...(preview === undefined
			? {}
			: {
					preview: (value: string) => {
						preview(read(value));
					},
				}),
	};
}

export interface CardSizeRowsDeps {
	t: Translate;
	/** The look kept, which the panel opens on and a confirmation writes. */
	held: CorkboardLook;
	/** The look drawn now: the one kept under whatever the panel is trying. */
	shown: () => CorkboardLook;
	/** A drafted size, shown on the surface while the panel stands open. */
	tryLook: (change: Partial<CorkboardLook>) => void;
	/** What the surface draws while its width is its own, where the handle waits. */
	ownWidth: () => number;
	/** The standard card's height while it is the surface's own. */
	ownHeight: () => number;
	/**
	 * Whether the type size sets words that stand whatever the card shows,
	 * the descriptions beside a lane's cards. It is then offered for every
	 * style; otherwise only for a style that shows a text box.
	 */
	wordsBesideCards: boolean;
}

/**
 * The three sizes' rows. A height is offered only for a style that shows a
 * text box, which takes the whole of it, and so is a type size unless there
 * are other words for it to set.
 */
export function cardSizeRows(deps: CardSizeRowsDeps): FilterSliderRow[] {
	const { t, held } = deps;
	const boxless = (): boolean => !CORKBOARD_TEXT_MODES.includes(deps.shown().mode);
	const wordless = (): boolean => !deps.wordsBesideCards && boxless();
	/** A size in words: its pixels, or that it is the surface's own. */
	const words = (value: number): string =>
		value === 0 ? t('corkboard.size.auto') : t('settings.manuscriptAppearance.pixels', { value });
	const size = (
		key: CorkboardSizeKey,
		extra: Pick<FilterSliderRow, 'rest' | 'themeVar' | 'hidden'>,
	): FilterSliderRow => ({
		presentation: 'stop-slider',
		label: t(SIZE_LABELS[key]),
		stops: CORKBOARD_SIZE_STOPS[key],
		value: held[key],
		empty: 0,
		resetLabel: t('settings.manuscriptAppearance.reset'),
		format: words,
		preview: (value) => {
			deps.tryLook({ [key]: value });
		},
		apply: (value) => {
			held[key] = value;
		},
		...extra,
	});
	return [
		// While each is the surface's own, its handle waits at what the surface
		// draws: the width it gives a card, the standard card's height, the
		// theme's small type.
		size('cardWidth', { rest: deps.ownWidth }),
		size('cardHeight', { rest: deps.ownHeight, hidden: boxless }),
		size('textSize', { themeVar: '--font-ui-small', hidden: wordless }),
	];
}
