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
