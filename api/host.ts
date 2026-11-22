import type { Access } from './spec/operations';

/**
 * What the plugin hands the local API. The API is given the services and a
 * handful of answers only the plugin can give, and nothing of the screens:
 * no view, no dialog, no notice. Everything here is asked for by name, so
 * what the API can reach is read off this one list.
 */
export interface ApiHost {
	/** The plugin's version, as its manifest states it. */
	pluginVersion(): string;
	/** The name of the vault this window has open. */
	vaultName(): string;
	/** The folder the author keeps projects in, as a path in the vault. Empty for the vault's own top folder. */
	projectsRoot(): string;
	/** The port the author chose for the listener. */
	port(): number;
	/** How far the author lets a caller go. */
	access(): Access;
	/**
	 * Settles once the plugin can list projects, which is after Obsidian has
	 * read the vault. `isReady` answers the same question without waiting.
	 */
	ready(): Promise<void>;
	isReady(): boolean;
	/** The plugin is being switched off, or the window is going. No call is started after this. */
	leaving(): boolean;
	/**
	 * Runs work whose writes are the plugin's own and not the author's
	 * typing. Whatever the history would put down to the author while it
	 * runs is put down to the plugin instead.
	 */
	asPlugin<T>(run: () => Promise<T>): Promise<T>;
}
