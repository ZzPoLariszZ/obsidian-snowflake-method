/**
 * A look being tried over the one kept: what a surface's Display panel has
 * drafted while it stands open, a style or a size that has to be seen to be
 * chosen. The surface draws the look kept under whatever is being tried,
 * and none of it is the kept look's until the panel is confirmed. The
 * corkboard tries the look of its own cards this way, and a workspace the
 * look of the cards on its lanes, so what counts as a draft is said once.
 */

import { CORKBOARD_SIZE_KEYS, type CorkboardLook } from './story-structure-state';

export interface LookTrial {
	/** The look drawn now: the one kept under whatever is being tried. */
	readonly shown: () => CorkboardLook;
	/** Whether anything is being tried. */
	readonly trying: () => boolean;
	/**
	 * Takes a drafted style or size. One that says what is kept is no
	 * draft: it lets go of whatever was tried of that part before.
	 */
	readonly draft: (change: Partial<CorkboardLook>) => void;
	/** Lets every draft go: the panel was confirmed, or the look kept is drawn again. */
	readonly end: () => void;
}

/**
 * A trial over a look that is read each time it is asked for, so a
 * confirmation written into it is what the next `shown` answers with.
 */
export function createLookTrial(held: Readonly<CorkboardLook>): LookTrial {
	const tried: { [Key in keyof CorkboardLook]: CorkboardLook[Key] | null } = {
		mode: null,
		cardWidth: null,
		cardHeight: null,
		textSize: null,
	};
	return {
		shown: () => ({
			mode: tried.mode ?? held.mode,
			cardWidth: tried.cardWidth ?? held.cardWidth,
			cardHeight: tried.cardHeight ?? held.cardHeight,
			textSize: tried.textSize ?? held.textSize,
		}),
		trying: () =>
			tried.mode !== null || tried.cardWidth !== null || tried.cardHeight !== null || tried.textSize !== null,
		draft: (change) => {
			if (change.mode !== undefined) tried.mode = change.mode === held.mode ? null : change.mode;
			for (const key of CORKBOARD_SIZE_KEYS) {
				const size = change[key];
				if (size !== undefined) tried[key] = size === held[key] ? null : size;
			}
		},
		end: () => {
			tried.mode = null;
			tried.cardWidth = null;
			tried.cardHeight = null;
			tried.textSize = null;
		},
	};
}
