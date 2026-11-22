import type { NoteCountOptions, ProjectRef, SnowflakeProjectService } from '../src/services';
import type { Access } from './spec/operations';

/**
 * What the plugin hands the local API. The API is given the services and a
 * handful of answers only the plugin can give, and nothing of the screens:
 * no view, no dialog, no notice. Everything here is asked for by name, so
 * what the API can reach is read off this one list.
 */
export interface ApiHost {
	/** The plugin's own service for projects, with every other service it owns. */
	readonly projects: SnowflakeProjectService;
	/**
	 * Every project under the folder the author keeps projects in, and every
	 * one in the archive beside them, each by its title.
	 */
	roster(): Promise<{ active: ProjectRef[]; archived: ProjectRef[] }>;
	/** The metadata note of the project the author last worked in, or null. */
	currentProjectPath(): string | null;
	/** The convention writing is counted by, as the author set it. */
	countOptions(): NoteCountOptions;
	/** The day it is on this computer's calendar, as `YYYY-MM-DD`: the day the author's own boards go by. */
	today(): string;
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
	/** The access token, or null where none has been made or the store for secrets cannot be read. */
	token(): string | null;
	/** Whether the author lets calls in through Obsidian's own command line. */
	cliEnabled(): boolean;
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
