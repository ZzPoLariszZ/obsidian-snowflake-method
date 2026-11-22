/**
 * The local API's choices, as the device keeps them.
 *
 * They are the device's and not the vault's. A port is a port of this
 * computer, and a listener switched on here says nothing about the author's
 * other computers: kept with the vault's settings, one switch would open a
 * port on every machine the vault is synced to. So none of this is in
 * `data.json`.
 *
 * Everything starts closed. Nothing listens and no command answers until
 * the author says so, and a caller let in may only read until the author
 * says more.
 */

/** How far a caller may go: read only, read and write, or read, write and delete. */
export type LocalApiAccess = 'read' | 'write' | 'delete';

export const LOCAL_API_ACCESS_LEVELS: readonly LocalApiAccess[] = ['read', 'write', 'delete'];

/** The port the listener answers on unless the author chooses another. */
export const LOCAL_API_DEFAULT_PORT = 27125;

/** The ports a program may ask the system for without being the system itself. */
export const LOCAL_API_PORT_MIN = 1024;
export const LOCAL_API_PORT_MAX = 65535;

export interface LocalApiPreferences {
	/** Whether the listener answers on this computer's own address. */
	http: boolean;
	port: number;
	access: LocalApiAccess;
	/** Whether calls through Obsidian's own command line are answered. */
	cli: boolean;
}

export const DEFAULT_LOCAL_API_PREFERENCES: LocalApiPreferences = {
	http: false,
	port: LOCAL_API_DEFAULT_PORT,
	access: 'read',
	cli: false,
};

export const isLocalApiPort = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= LOCAL_API_PORT_MIN && value <= LOCAL_API_PORT_MAX;

const isAccess = (value: unknown): value is LocalApiAccess =>
	typeof value === 'string' && (LOCAL_API_ACCESS_LEVELS as readonly string[]).includes(value);

/**
 * The choices read back from the device, whatever was found there. A switch
 * is on only where it was kept as exactly that, and anything else falls
 * back to the closed start: a store that was damaged, or written by a build
 * that kept something else, opens nothing.
 */
export function sanitizeLocalApiPreferences(raw: unknown): LocalApiPreferences {
	if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_LOCAL_API_PREFERENCES };
	const kept = raw as Record<string, unknown>;
	return {
		http: kept['http'] === true,
		port: isLocalApiPort(kept['port']) ? kept['port'] : LOCAL_API_DEFAULT_PORT,
		access: isAccess(kept['access']) ? kept['access'] : 'read',
		cli: kept['cli'] === true,
	};
}
