/**
 * How much of the margin the revision rail may take. The rail stands a gap
 * from the column and keeps a little room to the pane's edge, and what lies
 * between is the card's width: the full card where the margin is wide, a
 * narrower one where it is not, down to a floor. The stylesheet draws the
 * width from these same figures through `--snowflake-method-margin-room`,
 * which the stream sets to the margin it measured, and the style tests hold
 * the two together. Under the floor plus the room the pane is tight and the
 * cards are held back.
 */

/** The card's full width, where the margin has room for it. */
export const RAIL_WIDTH = 260;

/**
 * The narrowest card drawn. Three answers no longer stand abreast at this
 * width in English and the action row breaks, but every field still reads.
 */
export const RAIL_FLOOR = 192;

/** The rail's gap from the column, the app's --size-4-2. */
export const RAIL_GAP = 8;

/** The room the rail keeps to the pane's edge. */
export const RAIL_EDGE = 12;

/** What the margin gives to spacing before the card. */
export const RAIL_ROOM = RAIL_GAP + RAIL_EDGE;

/** The margin, in pixels, under which the rail is held back. */
export const RAIL_TIGHT_MARGIN = RAIL_FLOOR + RAIL_ROOM;

export const marginIsTight = (margin: number): boolean =>
	margin < RAIL_TIGHT_MARGIN;
