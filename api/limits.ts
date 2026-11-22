/**
 * The sizes the API holds a caller to, said once. A caller reads them from
 * the root, so nothing here is a secret it has to find by being refused.
 */

/** The largest body a call may carry over HTTP: a long chapter with room to spare. */
export const BODY_BYTES = 2 * 1024 * 1024;

/**
 * The most a call may carry through Obsidian's command line, its
 * parameters and its body together. A command line is short on every
 * system and Obsidian writes each one to its console, so prose belongs on
 * the other door.
 */
export const BRIDGE_BYTES = 128 * 1024;

/** How many items a list gives when the call names no limit, and the most it gives. */
export const PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;

/** How many calls may wait their turn before the next is told to come back. */
export const QUEUE_DEPTH = 64;

/**
 * The most places a search lists. A search that finds more says so, and a
 * caller narrows the words. Each is told with the line it stands in, cut to
 * so many characters where the line runs longer.
 */
export const SEARCH_HITS = 5000;
export const SEARCH_EXCERPT = 240;
