import type { ServerStatus } from '../../api/index';
import type { LocalApiPreferences } from '../domain';

/**
 * What the settings page asks of the plugin for the local API: the choices
 * the device keeps, where the listener stands, and the access token.
 *
 * The API belongs to the device and to no project, so its choices stand in
 * the plugin's settings beside everything else that is not one project's.
 * They are kept on the device all the same, never in the settings that
 * travel with the vault: a port is a port of this computer, and a listener
 * switched on here must not be found switched on on another.
 */
export interface LocalApiSettingsBridge {
	/** The choices as the device keeps them. */
	preferences(): LocalApiPreferences;
	/**
	 * Keeps a change to the choices and brings the listener in line with it.
	 * Settles once the listener stands as chosen, and never rejects.
	 */
	update(patch: Partial<LocalApiPreferences>): Promise<void>;
	/** Where the listener stands. */
	status(): ServerStatus;
	/** The access token, or null where none has been made. It is handed to the page for the clipboard and never drawn. */
	token(): string | null;
	/**
	 * Asks the author, then makes a new token in place of the old one. The
	 * old one is worth nothing from that moment.
	 */
	renewToken(): Promise<'renewed' | 'declined' | 'failed'>;
	/** Tries the listener again as it is chosen. Never rejects. */
	retry(): Promise<void>;
}
