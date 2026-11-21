import type { RecordingPreferences, RecordingState, RecordingSystem } from '../domain';
import type { ObsProbe, RecordingStorage } from '../services';

/**
 * What the settings page asks of the plugin for the screen recording: the
 * choices the device keeps, whether a recording runs, where a recording
 * would go, and the few ways out of the page: the system's folder dialog,
 * its file manager, its own page on what may record the screen.
 *
 * A recording belongs to the device and to no project, so its choices
 * stand in the plugin's settings beside everything else that is not one
 * project's. They are kept on the device all the same, never in the
 * settings that travel with the vault: a folder on one computer and the
 * recorder installed there mean nothing on another.
 */
export interface RecordingSettingsBridge {
	system(): RecordingSystem;
	state(): RecordingState;
	/** The choices as the device keeps them. */
	preferences(): RecordingPreferences;
	/** Keeps a change to the choices. Refused while a recording runs. */
	update(patch: Partial<RecordingPreferences>): void;
	/** Where a recording would go. */
	storage(): RecordingStorage;
	/** The vault folder recordings go under where the author names none. */
	defaultVaultFolder(): string;
	/** How many recordings the vault's folder holds and their size, where recordings are kept in the vault. */
	figures(): Promise<{ files: number; bytes: number } | null>;
	/** Asks the author for a folder in the system's own dialog, and keeps the one chosen. */
	chooseFolder(): Promise<void>;
	/** Opens the folder a recording would go to in the system's file manager. */
	openFolder(): void;
	/** Whether macOS lets Obsidian record the screen. Unknown off a Mac. */
	screenAccess(): 'granted' | 'denied' | 'unknown';
	/** Opens the system's own page on what may record the screen. */
	openScreenPrivacy(): void;
	/**
	 * What is known of whether this Mac's own recorder films one window
	 * alone, without asking the system: null where it was never asked.
	 */
	windowFilming(): boolean | null;
	/** Asks the system, once, and answers whether it does. */
	learnWindowFilming(): Promise<boolean>;
	/**
	 * Looks at OBS without recording: whether it answers and what it would
	 * record. `onOpening` is told where OBS was closed and is being opened
	 * for the look.
	 */
	testObs(onOpening?: () => void): Promise<ObsProbe>;
	/** Draws Obsidian's own field for a secret into a host, for OBS's password. `changed` is told when another secret is chosen. */
	mountSecret(host: HTMLElement, changed: () => void): void;
	/** Opens OBS's own download page in the browser. */
	openObsDownload(): void;
}
