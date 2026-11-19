import { describe, expect, it } from 'vitest';

import type { RecordingSystem } from '../../src/domain';
import {
	recordingFigures,
	recordingStorage,
	resolveRecordingFolder,
	type RecordingPlaceChoice,
	type RecordingPlaceDeps,
} from '../../src/services/recording-place';

/** A vault in memory: its folders, its files with their sizes, and everything asked of it. */
function vault(options: { system?: RecordingSystem; videos?: string | null; roots?: string[]; base?: string | null } = {}) {
	const folders = new Set<string>();
	const files = new Map<string, number>();
	const asked: string[] = [];
	const deps: RecordingPlaceDeps = {
		system: () => options.system ?? 'mac',
		vaultBase: () => (options.base === undefined ? '/Users/ada/Vault' : options.base),
		videosFolder: () => (options.videos === undefined ? '/Users/ada/Movies' : options.videos),
		// Beside the projects, where the archive and the exports stand too.
		defaultVaultFolder: () => 'Novels/Snowflake Recordings',
		projectRoots: () => options.roots ?? ['Novels/Clocktower Snow'],
		fullPath: (path) => `/Users/ada/Vault/${path}`,
		mkdir: (path) => {
			asked.push(`mkdir ${path}`);
			folders.add(path);
			return Promise.resolve();
		},
		list: (path) => {
			asked.push(`list ${path}`);
			if (!folders.has(path)) return Promise.resolve(null);
			return Promise.resolve({ files: [...files.keys()].filter((file) => file.startsWith(`${path}/`)) });
		},
		size: (path) => {
			asked.push(`size ${path}`);
			return Promise.resolve(files.get(path) ?? null);
		},
	};
	return { deps, folders, files, asked };
}

const outside = (folder = ''): RecordingPlaceChoice => ({ location: 'outside', vaultFolder: '', folder });
const inVault = (vaultFolder = ''): RecordingPlaceChoice => ({ location: 'vault', vaultFolder, folder: '' });

describe('where a recording goes', () => {
	it('uses a folder outside the vault as it stands, and asks the vault nothing', async () => {
		const { deps, asked } = vault();
		expect(recordingStorage(outside('/Volumes/Tape/Proof'), deps)).toEqual({
			mode: 'outside',
			path: '/Volumes/Tape/Proof',
		});
		expect(await resolveRecordingFolder(outside('/Volumes/Tape/Proof'), deps)).toEqual({
			ok: true,
			folder: '/Volumes/Tape/Proof',
		});
		expect(await recordingFigures(outside('/Volumes/Tape/Proof'), deps)).toBeNull();
		expect(asked).toEqual([]);
	});

	it('falls to the system’s video folder while none was chosen outside', async () => {
		const { deps } = vault();
		expect(recordingStorage(outside(), deps)).toEqual({ mode: 'default', path: '/Users/ada/Movies' });
		expect(await resolveRecordingFolder(outside(), deps)).toEqual({ ok: true, folder: '/Users/ada/Movies' });
		const none = vault({ videos: null });
		expect(recordingStorage(outside(), none.deps)).toEqual({ mode: 'none' });
		expect(await resolveRecordingFolder(outside(), none.deps)).toEqual({ ok: false, code: 'folder' });
	});

	it('keeps recordings in the vault in one folder beside the projects, made when first recorded into', async () => {
		const { deps, asked } = vault();
		expect(recordingStorage(inVault(), deps)).toEqual({
			mode: 'vault',
			path: '/Users/ada/Vault/Novels/Snowflake Recordings',
			vaultPath: 'Novels/Snowflake Recordings',
			refused: false,
		});
		// Saying where a recording would go makes nothing.
		expect(asked).toEqual([]);
		expect(await resolveRecordingFolder(inVault(), deps)).toEqual({
			ok: true,
			folder: '/Users/ada/Vault/Novels/Snowflake Recordings',
		});
		// One folder for every project: a recording is no project's.
		expect(asked).toEqual(['mkdir Novels/Snowflake Recordings', 'list Novels/Snowflake Recordings']);
	});

	it('uses the vault folder the author names in place of the one beside the projects', async () => {
		const { deps, asked } = vault();
		expect(recordingStorage(inVault('Proof/Video'), deps)).toMatchObject({
			mode: 'vault',
			path: '/Users/ada/Vault/Proof/Video',
			vaultPath: 'Proof/Video',
			refused: false,
		});
		expect(await resolveRecordingFolder(inVault('Proof/Video'), deps)).toEqual({
			ok: true,
			folder: '/Users/ada/Vault/Proof/Video',
		});
		expect(asked).toEqual(['mkdir Proof/Video', 'list Proof/Video']);
	});

	it('takes a folder that was there already', async () => {
		const { deps, folders } = vault();
		folders.add('Novels/Snowflake Recordings');
		deps.mkdir = () => Promise.reject(new Error('Folder already exists.'));
		expect(await resolveRecordingFolder(inVault(), deps)).toEqual({
			ok: true,
			folder: '/Users/ada/Vault/Novels/Snowflake Recordings',
		});
	});

	it('says the folder cannot be used where the vault will not make it', async () => {
		const { deps } = vault();
		deps.mkdir = () => Promise.reject(new Error('No.'));
		expect(await resolveRecordingFolder(inVault(), deps)).toEqual({ ok: false, code: 'folder' });
	});

	it('refuses a project’s own folder and anything under it', async () => {
		const { deps, asked } = vault();
		for (const folder of ['Novels/Clocktower Snow', 'Novels/Clocktower Snow/Video']) {
			expect(recordingStorage(inVault(folder), deps), folder).toMatchObject({ mode: 'vault', refused: true });
			expect(await resolveRecordingFolder(inVault(folder), deps), folder).toEqual({
				ok: false,
				code: 'folder-in-project',
			});
			expect(await recordingFigures(inVault(folder), deps), folder).toBeNull();
		}
		// A folder beside the project whose name only begins as the project's does is not inside it.
		expect(recordingStorage(inVault('Novels/Clocktower Snow 2'), deps)).toMatchObject({ refused: false });
		expect(asked).toEqual([]);
	});

	it('refuses the whole vault where a project is the vault itself', async () => {
		const { deps } = vault({ roots: [''] });
		expect(recordingStorage(inVault(), deps)).toMatchObject({ mode: 'vault', refused: true });
		expect(await resolveRecordingFolder(inVault('Anywhere'), deps)).toEqual({ ok: false, code: 'folder-in-project' });
	});

	it('handles a folder chosen as one outside that lies in the vault after all as the vault’s', async () => {
		const { deps, asked } = vault();
		expect(recordingStorage(outside('/Users/ada/Vault/Proof'), deps)).toEqual({
			mode: 'vault',
			path: '/Users/ada/Vault/Proof',
			vaultPath: 'Proof',
			refused: false,
		});
		expect(await resolveRecordingFolder(outside('/Users/ada/Vault/Novels/Clocktower Snow'), deps)).toEqual({
			ok: false,
			code: 'folder-in-project',
		});
		// The vault's own root is no project's unless a project stands there, and nothing is made for it.
		expect(await resolveRecordingFolder(outside('/Users/ada/Vault'), deps)).toEqual({ ok: false, code: 'folder' });
		expect(asked).toEqual(['list ']);
	});

	it('counts the recordings in the vault’s folder and the room they take, videos alone', async () => {
		const { deps, folders, files } = vault();
		folders.add('Novels/Snowflake Recordings');
		files.set('Novels/Snowflake Recordings/2026-11-19 14.30.05.mov', 1_200_000_000);
		files.set('Novels/Snowflake Recordings/2026-11-20 09.00.00.MKV', 300_000_000);
		files.set('Novels/Snowflake Recordings/notes.md', 2_000);
		expect(await recordingFigures(inVault(), deps)).toEqual({ files: 2, bytes: 1_500_000_000 });
	});

	it('counts nothing in a folder not yet made', async () => {
		const { deps } = vault();
		expect(await recordingFigures(inVault(), deps)).toEqual({ files: 0, bytes: 0 });
	});

	it('keeps nothing in a vault that is on no disk, and reads every chosen folder as outside it', async () => {
		const { deps, asked } = vault({ base: null });
		expect(recordingStorage(inVault(), deps)).toEqual({ mode: 'none' });
		expect(await resolveRecordingFolder(inVault(), deps)).toEqual({ ok: false, code: 'folder' });
		expect(await recordingFigures(inVault(), deps)).toBeNull();
		expect(recordingStorage(outside('/Users/ada/Vault/Proof'), deps)).toEqual({
			mode: 'outside',
			path: '/Users/ada/Vault/Proof',
		});
		expect(asked).toEqual([]);
	});
});
