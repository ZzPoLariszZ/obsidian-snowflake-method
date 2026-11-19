import {
	insideProjectRoot,
	recordingPlace,
	type RecordingPreferences,
	type RecordingSystem,
} from '../domain';

/**
 * Where a recording is put. The author keeps recordings in the vault or
 * outside it, and which of the two decides how far the plugin goes.
 *
 * In the vault they go to one folder beside the projects, as the archive
 * and the exports do, unless the author names another. A recording belongs
 * to no project, so there is one folder for all of them. It is reached
 * through Obsidian's own vault, so the plugin can make it and count what it
 * holds, with no reach into the disk of its own.
 *
 * Outside the vault the author chooses a folder in the system's own dialog.
 * It is used as it is: the plugin reads nothing there and makes nothing
 * there. Where none was chosen the system's own folder for videos stands
 * in.
 */

export interface RecordingPlaceDeps {
	system(): RecordingSystem;
	/** The vault's own folder on the disk, or null where the vault is not on one. */
	vaultBase(): string | null;
	/** The system's folder for videos, where it names one. */
	videosFolder(): string | null;
	/** The vault folder recordings go under where the author names none: the one beside the projects. */
	defaultVaultFolder(): string;
	/** The folders the plugin's projects stand in, as the vault names them. */
	projectRoots(): string[];
	/** A vault folder's whole path on the disk. */
	fullPath(vaultPath: string): string;
	/** Makes a vault folder, and the ones above it. */
	mkdir(vaultPath: string): Promise<void>;
	/** What a vault folder holds, or null where there is no such folder. */
	list(vaultPath: string): Promise<{ files: string[] } | null>;
	/** How large a vault file is, or null where there is no such file. */
	size(vaultPath: string): Promise<number | null>;
}

/** The part of the choices that says where recordings go. */
export type RecordingPlaceChoice = Pick<RecordingPreferences, 'location' | 'vaultFolder' | 'folder'>;

/** The folder a recording would go to, as the settings say it. */
export type RecordingStorage =
	/** Nothing was chosen and the system names no video folder, or the vault is on no disk. */
	| { mode: 'none' }
	/** Nothing was chosen: the system's video folder stands in. */
	| { mode: 'default'; path: string }
	| { mode: 'outside'; path: string }
	| {
			mode: 'vault';
			/** The folder's whole path on the disk. */
			path: string;
			/** The folder as the vault names it. */
			vaultPath: string;
			/** The folder is a project's own or inside one: nothing is recorded there. */
			refused: boolean;
	  };

/** The files a recorder writes, by their ending. */
const VIDEO_ENDINGS = ['.mov', '.mp4', '.mkv', '.m4v', '.flv', '.ts', '.webm'];

type Standing = { kind: 'default' } | { kind: 'outside'; absolute: string } | { kind: 'vault'; vaultPath: string };

function standing(choice: RecordingPlaceChoice, deps: RecordingPlaceDeps): Standing {
	if (choice.location === 'vault') {
		return { kind: 'vault', vaultPath: choice.vaultFolder.length > 0 ? choice.vaultFolder : deps.defaultVaultFolder() };
	}
	const place = recordingPlace(choice.folder, deps.vaultBase(), deps.system());
	if (place.kind === 'unset') return { kind: 'default' };
	// A folder chosen as one outside that lies in the vault after all is the vault's to reach.
	return place.kind === 'vault'
		? { kind: 'vault', vaultPath: place.vaultPath }
		: { kind: 'outside', absolute: place.absolute };
}

/**
 * Whether a vault folder may hold recordings: not a project's own folder
 * and not inside one. A recording grows for hours, and a project's folders
 * are laid out by the plugin.
 */
function refused(vaultPath: string, roots: readonly string[]): boolean {
	return roots.includes('') || insideProjectRoot(vaultPath, roots);
}

export function recordingStorage(choice: RecordingPlaceChoice, deps: RecordingPlaceDeps): RecordingStorage {
	const at = standing(choice, deps);
	if (at.kind === 'default') {
		const videos = deps.videosFolder();
		return videos === null ? { mode: 'none' } : { mode: 'default', path: videos };
	}
	if (at.kind === 'outside') return { mode: 'outside', path: at.absolute };
	if (deps.vaultBase() === null) return { mode: 'none' };
	return {
		mode: 'vault',
		path: deps.fullPath(at.vaultPath),
		vaultPath: at.vaultPath,
		refused: refused(at.vaultPath, deps.projectRoots()),
	};
}

/**
 * The folder one recording goes into, there when this answers: the chosen
 * folder itself outside the vault, the vault's folder for recordings inside
 * it, made now where it was not.
 */
export async function resolveRecordingFolder(
	choice: RecordingPlaceChoice,
	deps: RecordingPlaceDeps,
): Promise<{ ok: true; folder: string } | { ok: false; code: 'folder' | 'folder-in-project' }> {
	const at = standing(choice, deps);
	if (at.kind === 'default') {
		const videos = deps.videosFolder();
		return videos === null ? { ok: false, code: 'folder' } : { ok: true, folder: videos };
	}
	if (at.kind === 'outside') return { ok: true, folder: at.absolute };
	if (deps.vaultBase() === null) return { ok: false, code: 'folder' };
	if (refused(at.vaultPath, deps.projectRoots())) return { ok: false, code: 'folder-in-project' };
	if (at.vaultPath.length > 0) {
		try {
			await deps.mkdir(at.vaultPath);
		} catch {
			// A folder that is there already may refuse to be made again: whether it is there is what counts.
		}
	}
	if ((await deps.list(at.vaultPath)) === null) return { ok: false, code: 'folder' };
	return { ok: true, folder: deps.fullPath(at.vaultPath) };
}

/**
 * How many recordings the vault's folder holds and how much room they
 * take. Null outside the vault: the plugin does not read a disk it was only
 * shown a folder on.
 */
export async function recordingFigures(
	choice: RecordingPlaceChoice,
	deps: RecordingPlaceDeps,
): Promise<{ files: number; bytes: number } | null> {
	const at = standing(choice, deps);
	if (at.kind !== 'vault' || deps.vaultBase() === null) return null;
	if (refused(at.vaultPath, deps.projectRoots())) return null;
	const listed = await deps.list(at.vaultPath);
	if (listed === null) return { files: 0, bytes: 0 };
	let files = 0;
	let bytes = 0;
	for (const file of listed.files) {
		const lower = file.toLowerCase();
		if (!VIDEO_ENDINGS.some((ending) => lower.endsWith(ending))) continue;
		const size = await deps.size(file);
		if (size === null) continue;
		files += 1;
		bytes += size;
	}
	return { files, bytes };
}
