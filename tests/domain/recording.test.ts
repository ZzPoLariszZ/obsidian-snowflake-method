import { describe, expect, it } from 'vitest';

import {
	OBS_FILE_NAME_FORMAT,
	DEFAULT_OBS_PORT,
	MAC_OPENER,
	NATIVE_CAP_MS,
	classifyNativeExit,
	defaultRecordingPreferences,
	displayIdentifierArguments,
	displayOrderArguments,
	folderTestArguments,
	insideProjectRoot,
	interruptArguments,
	isNativeRecorderLine,
	nativeArguments,
	nativeWindowId,
	obsLaunches,
	processListArguments,
	readDisplayIdentifiers,
	readDisplayOrder,
	readNativeLedger,
	recordingFileNames,
	recordingLaterFileName,
	recordingPlace,
	recordingScopes,
	RECORDING_QUALITIES,
	recordingStamp,
	recordingTools,
	sanitizeRecordingPreferences,
	recordingVaultFolder,
	systemChild,
} from '../../src/domain';

describe('recording preferences', () => {
	it('starts a Mac on its own recorder and the other systems on OBS', () => {
		expect(recordingTools('mac')).toEqual(['native', 'obs']);
		expect(recordingTools('win')).toEqual(['obs']);
		expect(recordingTools('linux')).toEqual(['obs']);
		expect(defaultRecordingPreferences('mac').tool).toBe('native');
		expect(defaultRecordingPreferences('win').tool).toBe('obs');
		expect(defaultRecordingPreferences('linux').tool).toBe('obs');
	});

	it('reads anything that is not the kept choices as the defaults', () => {
		for (const junk of [null, undefined, 3, 'native', [], [{ tool: 'obs' }]]) {
			expect(sanitizeRecordingPreferences(junk, 'mac')).toEqual(defaultRecordingPreferences('mac'));
		}
	});

	it('keeps what was chosen and mends what is out of range', () => {
		expect(
			sanitizeRecordingPreferences(
				{
					tool: 'obs',
					location: 'vault',
					vaultFolder: '/Proof\\Video/',
					folder: '  /Users/ada/Movies  ',
					scope: 'obs',
					quality: '720p',
					obsPort: 4460,
					obsSecret: 'obs-websocket',
					obsReached: true,
					confirm: false,
				},
				'mac',
			),
		).toEqual({
			tool: 'obs',
			location: 'vault',
			vaultFolder: 'Proof/Video',
			folder: '/Users/ada/Movies',
			scope: 'obs',
			quality: '720p',
			obsPort: 4460,
			obsSecret: 'obs-websocket',
			obsReached: true,
			confirm: false,
		});
		const mended = sanitizeRecordingPreferences(
			{
				tool: 'screen',
				location: 'cloud',
				vaultFolder: '../Elsewhere',
				scope: 7,
				quality: '4k',
				obsPort: 70000,
				obsSecret: 'Has Spaces',
				obsReached: 'yes',
			},
			'mac',
		);
		expect(mended).toEqual(defaultRecordingPreferences('mac'));
		expect(sanitizeRecordingPreferences({ obsPort: 0 }, 'win').obsPort).toBe(DEFAULT_OBS_PORT);
		expect(sanitizeRecordingPreferences({ obsPort: 4455.5 }, 'win').obsPort).toBe(DEFAULT_OBS_PORT);
	});

	it('asks before every recording until the author says not to be asked', () => {
		for (const system of ['mac', 'win', 'linux'] as const) expect(defaultRecordingPreferences(system).confirm).toBe(true);
		expect(sanitizeRecordingPreferences({ confirm: false }, 'mac').confirm).toBe(false);
		// Only a plain no turns the question off: anything else asks.
		for (const kept of [true, undefined, null, 0, 'no']) {
			expect(sanitizeRecordingPreferences({ confirm: kept }, 'mac').confirm, String(kept)).toBe(true);
		}
		// An earlier build kept that the notes were agreed to once. That is no word on being asked again.
		expect(sanitizeRecordingPreferences({ acknowledged: true }, 'mac')).toEqual(defaultRecordingPreferences('mac'));
	});

	it('offers OBS’s own size, the full size of what is recorded, and three sizes to hold it to, the largest first', () => {
		expect(RECORDING_QUALITIES).toEqual(['original', 'full', '1440p', '1080p', '720p']);
		expect(defaultRecordingPreferences('win').quality).toBe('1080p');
		for (const quality of RECORDING_QUALITIES) {
			expect(sanitizeRecordingPreferences({ quality }, 'win').quality).toBe(quality);
		}
	});

	it('starts a device on recordings in the vault, of Obsidian alone, written at 1080 lines', () => {
		for (const system of ['mac', 'win', 'linux'] as const) {
			expect(defaultRecordingPreferences(system)).toMatchObject({
				// In the folder beside the projects, since none is named.
				location: 'vault',
				vaultFolder: '',
				folder: '',
				scope: 'obsidian',
				quality: '1080p',
			});
		}
		// Whatever the device kept stands: a folder outside the vault chosen there is kept, and so is its place.
		expect(
			sanitizeRecordingPreferences({ location: 'outside', folder: '/Users/ada/Movies', scope: 'screen', quality: 'original' }, 'mac'),
		).toMatchObject({ location: 'outside', folder: '/Users/ada/Movies', scope: 'screen', quality: 'original' });
		// A choice the device never made takes what a device starts on.
		expect(sanitizeRecordingPreferences({ tool: 'obs' }, 'mac')).toMatchObject({
			location: 'vault',
			scope: 'obsidian',
			quality: '1080p',
		});
	});

	it('writes a vault folder as the vault names one, and takes none that climbs out of the vault', () => {
		expect(recordingVaultFolder('Proof/Video')).toBe('Proof/Video');
		expect(recordingVaultFolder('/Proof//Video/')).toBe('Proof/Video');
		expect(recordingVaultFolder('Proof\\Video')).toBe('Proof/Video');
		expect(recordingVaultFolder('  Proof / Video  ')).toBe('Proof/Video');
		expect(recordingVaultFolder('')).toBe('');
		expect(recordingVaultFolder('/')).toBe('');
		for (const climbing of ['..', '../Elsewhere', 'Proof/../../Elsewhere', './Proof']) {
			expect(recordingVaultFolder(climbing), climbing).toBe('');
		}
	});

	it('never keeps the Mac recorder off a Mac, nor a scope the recorder cannot show', () => {
		// The choices travel with nothing, but a profile copied between
		// computers could still hand a Windows machine a Mac's.
		expect(sanitizeRecordingPreferences({ tool: 'native' }, 'win').tool).toBe('obs');
		expect(sanitizeRecordingPreferences({ tool: 'native' }, 'linux').tool).toBe('obs');
		// The screen Obsidian is on, every screen, Obsidian alone, and with OBS its own scene.
		expect(recordingScopes('native')).toEqual(['screen', 'all', 'obsidian']);
		expect(recordingScopes('obs')).toEqual(['screen', 'all', 'obsidian', 'obs']);
		expect(sanitizeRecordingPreferences({ tool: 'native', scope: 'all' }, 'mac').scope).toBe('all');
		expect(sanitizeRecordingPreferences({ tool: 'obs', scope: 'all' }, 'win').scope).toBe('all');
		// A scope only OBS has goes back to the one a device starts on.
		expect(sanitizeRecordingPreferences({ tool: 'native', scope: 'obs' }, 'mac').scope).toBe('obsidian');
		expect(sanitizeRecordingPreferences({ tool: 'obs', scope: 'obs' }, 'mac').scope).toBe('obs');
	});
});

describe('recording names', () => {
	it('names a recording by the moment it began alone, on the device clock, with no mark a path refuses', () => {
		const at = new Date(2026, 10, 19, 14, 30, 5);
		expect(recordingStamp(at)).toBe('2026-11-19 14.30.05');
		expect(recordingStamp(new Date(2027, 0, 2, 3, 4, 9))).toBe('2027-01-02 03.04.09');
		// A recording is the device's and no project's: nothing of a project is in its name.
		expect(recordingFileNames(recordingStamp(at), 1)).toEqual(['2026-11-19 14.30.05.mov']);
		expect(recordingStamp(at)).toMatch(/^[0-9][0-9 .-]+[0-9]$/u);
	});

	it('asks OBS for the same name, each figure filled in from OBS’s own clock', () => {
		expect(OBS_FILE_NAME_FORMAT).toBe('%CCYY-%MM-%DD %hh.%mm.%ss');
		// The same marks in the same places as the plugin's own stamp.
		expect(OBS_FILE_NAME_FORMAT.replace(/%[A-Za-z]+/gu, '00')).toBe('00-00-00 00.00.00');
	});
});

describe('recording place', () => {
	it('is unset while no folder was chosen, and outside where there is no vault to compare with', () => {
		expect(recordingPlace('', '/Users/ada/Vault', 'mac')).toEqual({ kind: 'unset' });
		expect(recordingPlace('   ', '/Users/ada/Vault', 'mac')).toEqual({ kind: 'unset' });
		expect(recordingPlace('/Users/ada/Movies', null, 'mac')).toEqual({
			kind: 'outside',
			absolute: '/Users/ada/Movies',
		});
	});

	it('tells a folder in the vault from one beside it whose name begins the same', () => {
		expect(recordingPlace('/Users/ada/Vault/Recordings', '/Users/ada/Vault', 'mac')).toEqual({
			kind: 'vault',
			absolute: '/Users/ada/Vault/Recordings',
			vaultPath: 'Recordings',
		});
		expect(recordingPlace('/Users/ada/Vault2', '/Users/ada/Vault', 'mac')).toEqual({
			kind: 'outside',
			absolute: '/Users/ada/Vault2',
		});
		expect(recordingPlace('/Users/ada/Vault-old/Recordings', '/Users/ada/Vault', 'mac').kind).toBe('outside');
		expect(recordingPlace('/Users/ada', '/Users/ada/Vault', 'mac').kind).toBe('outside');
	});

	it('reads the vault itself as inside, with or without a trailing slash', () => {
		expect(recordingPlace('/Users/ada/Vault/', '/Users/ada/Vault', 'mac')).toEqual({
			kind: 'vault',
			absolute: '/Users/ada/Vault/',
			vaultPath: '',
		});
		expect(recordingPlace('/Users/ada/Vault/A/B/', '/Users/ada/Vault/', 'mac')).toMatchObject({
			kind: 'vault',
			vaultPath: 'A/B',
		});
	});

	it('folds letter case on a Mac and on Windows, and never on Linux', () => {
		expect(recordingPlace('/users/ADA/vault/Recordings', '/Users/ada/Vault', 'mac')).toMatchObject({
			kind: 'vault',
			vaultPath: 'Recordings',
		});
		expect(recordingPlace('/home/ada/vault/Recordings', '/home/ada/Vault', 'linux').kind).toBe('outside');
		expect(recordingPlace('/home/ada/Vault/Recordings', '/home/ada/Vault', 'linux')).toMatchObject({
			kind: 'vault',
			vaultPath: 'Recordings',
		});
	});

	it('reads a Windows path by its own separators and names the folder as the vault does', () => {
		expect(recordingPlace('c:\\Users\\Ada\\Vault\\Rec\\Novel', 'C:\\Users\\Ada\\Vault', 'win')).toEqual({
			kind: 'vault',
			absolute: 'c:\\Users\\Ada\\Vault\\Rec\\Novel',
			vaultPath: 'Rec/Novel',
		});
		expect(recordingPlace('D:\\Videos', 'C:\\Users\\Ada\\Vault', 'win').kind).toBe('outside');
	});

	it('joins a file to its folder as the system writes a path', () => {
		expect(systemChild('/Users/ada/Movies', 'a.mov', 'mac')).toBe('/Users/ada/Movies/a.mov');
		expect(systemChild('/Users/ada/Movies/', 'a.mov', 'mac')).toBe('/Users/ada/Movies/a.mov');
		expect(systemChild('D:\\Videos', 'a.mov', 'win')).toBe('D:\\Videos\\a.mov');
		expect(systemChild('D:\\Videos\\', 'a.mov', 'win')).toBe('D:\\Videos\\a.mov');
	});

	it('refuses a project root, anything under one, and everything where a project is the vault itself', () => {
		const roots = ['Novels/Clocktower Snow', 'Novels/Demo'];
		expect(insideProjectRoot('Novels/Clocktower Snow', roots)).toBe(true);
		expect(insideProjectRoot('Novels/Clocktower Snow/70_Tool', roots)).toBe(true);
		expect(insideProjectRoot('Novels/Clocktower Snow 2', roots)).toBe(false);
		expect(insideProjectRoot('Novels', roots)).toBe(false);
		expect(insideProjectRoot('Recordings/Clocktower Snow', roots)).toBe(false);
		expect(insideProjectRoot('Recordings', [''])).toBe(true);
		expect(insideProjectRoot('Recordings', [])).toBe(false);
	});
});

describe('the Mac recorder', () => {
	it('is asked for video with no sound of any kind and no limit of its own, the file last', () => {
		expect(nativeArguments('/Users/ada/Movies/a.mov', { kind: 'main' })).toEqual([
			'-v', '-x', '/Users/ada/Movies/a.mov',
		]);
		for (const target of [
			{ kind: 'main' } as const,
			{ kind: 'display', index: 2 } as const,
			{ kind: 'window', id: 4321 } as const,
		]) {
			const made = nativeArguments('/tmp/a b.mov', target);
			expect(made[0]).toBe('-v');
			expect(made[made.length - 1]).toBe('/tmp/a b.mov');
			// The microphone and the system's sound are never asked for.
			for (const sound of ['-g', '-G', '-A']) expect(made).not.toContain(sound);
			// A recorder given a time limit takes no stop: a signal ends it with nothing saved.
			expect(made).not.toContain('-V');
		}
	});

	it('points at one screen by its number, or one window by its id without its shadow', () => {
		expect(nativeArguments('/tmp/a.mov', { kind: 'display', index: 2 })).toEqual(['-v', '-x', '-D', '2', '/tmp/a.mov']);
		expect(nativeArguments('/tmp/a.mov', { kind: 'window', id: 4321 })).toEqual([
			'-v', '-x', '-o', '-l', '4321', '/tmp/a.mov',
		]);
	});

	it('ends a recording after twelve hours by the plugin’s own clock', () => {
		expect(NATIVE_CAP_MS).toBe(43_200_000);
	});

	it('reads a window id out of what Electron calls the window, and nothing out of anything else', () => {
		expect(nativeWindowId('window:1234:0')).toBe(1234);
		expect(nativeWindowId('window:0:0')).toBeNull();
		expect(nativeWindowId('screen:1:0')).toBeNull();
		expect(nativeWindowId('window:12a:0')).toBeNull();
		expect(nativeWindowId('')).toBeNull();
		expect(nativeWindowId(null)).toBeNull();
	});

	it('asks whether a folder is there and can be written to', () => {
		expect(folderTestArguments('/Users/ada/My Movies')).toEqual([
			'-d', '/Users/ada/My Movies', '-a', '-w', '/Users/ada/My Movies',
		]);
	});

	it('asks the system for screens’ own identifiers with one fixed script, their numbers beside it', () => {
		const args = displayIdentifierArguments([3]);
		expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e']);
		expect(args.slice(4)).toEqual(['3']);
		// The script is the same whatever screens are asked for: nothing is written into it.
		const several = displayIdentifierArguments([69_734_662, 2]);
		expect(several[3]).toBe(args[3]);
		expect(several.slice(4)).toEqual(['69734662', '2']);
		expect(args[3]).toContain('CGDisplayCreateUUIDFromDisplayID(Number(number))');
		expect(args[3]).not.toMatch(/\b3\b/u);
	});

	it('takes only identifiers for the script’s answer, one for each screen asked', () => {
		expect(readDisplayIdentifiers('08C01862-9690-4A1E-B653-10B1A582F805\n', 1)).toEqual([
			'08C01862-9690-4A1E-B653-10B1A582F805',
		]);
		expect(
			readDisplayIdentifiers('08C01862-9690-4A1E-B653-10B1A582F805\n  dcfb4942-f77d-4afc-aac8-471180ef3246 \n', 2),
		).toEqual(['08C01862-9690-4A1E-B653-10B1A582F805', 'DCFB4942-F77D-4AFC-AAC8-471180EF3246']);
		// Half an answer names no screen.
		expect(readDisplayIdentifiers('08C01862-9690-4A1E-B653-10B1A582F805\n', 2)).toBeNull();
		expect(readDisplayIdentifiers('08C01862-9690-4A1E-B653-10B1A582F805\nundefined\n', 2)).toBeNull();
		for (const junk of ['', '\n', 'undefined', 'execution error: Error: (-2700)', '08C01862-9690-4A1E-B653', '08C01862-9690-4A1E-B653-10B1A582F805 x']) {
			expect(readDisplayIdentifiers(junk, 1)).toBeNull();
		}
		expect(readDisplayIdentifiers('', 0)).toBeNull();
	});

	it('asks the system for the order the recorder counts the screens in, with a second fixed script', () => {
		const args = displayOrderArguments();
		expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e']);
		expect(args).toHaveLength(4);
		// The list the Mac's recorder itself reads its screens from.
		expect(args[3]).toContain('CGGetActiveDisplayList');
		expect(displayOrderArguments()[3]).toBe(args[3]);
		expect(args[3]).not.toBe(displayIdentifierArguments([1])[3]);
	});

	it('reads the recorder’s order of the screens: how many, then their numbers', () => {
		const words = (...numbers: number[]): string => {
			const bytes = new Uint8Array(numbers.length * 4);
			const view = new DataView(bytes.buffer);
			numbers.forEach((number, index) => {
				view.setUint32(index * 4, number, true);
			});
			return btoa(String.fromCharCode(...bytes));
		};
		// As this Mac answered: two screens, numbered 1 and 2, in room for thirty-two.
		const room = Array.from({ length: 30 }, () => 0);
		expect(words(2)).toBe('AgAAAA==');
		expect(readDisplayOrder(`AgAAAA==\n${words(1, 2, ...room)}\n`)).toEqual([1, 2]);
		// The system's order need not be the numbers' own.
		expect(readDisplayOrder(`${words(3)}\n${words(69_734_662, 2, 5, 0, 0)}`)).toEqual([69_734_662, 2, 5]);
		expect(readDisplayOrder(`  ${words(1)} \n ${words(7)}\n\n`)).toEqual([7]);
		for (const junk of [
			'',
			'\n',
			'execution error: Error: (-2700)',
			words(2),
			// More screens counted than listed, none at all, and a screen with no number.
			`${words(3)}\n${words(1, 2)}`,
			`${words(0)}\n${words(1, 2)}`,
			`${words(2)}\n${words(1, 0)}`,
			// Not whole numbers of four bytes, and not bytes at all.
			`${words(1)}\nAQAA`,
			`${words(1)}\n***`,
			`${words(1, 1)}\n${words(1, 2)}`,
		]) {
			expect(readDisplayOrder(junk), JSON.stringify(junk)).toBeNull();
		}
	});

	it('names one file for one screen, and a numbered file for each of several', () => {
		expect(recordingFileNames('2026-11-19 14.30.05', 1)).toEqual(['2026-11-19 14.30.05.mov']);
		expect(recordingFileNames('2026-11-19 14.30.05', 0)).toEqual(['2026-11-19 14.30.05.mov']);
		expect(recordingFileNames('2026-11-19 14.30.05', 3)).toEqual([
			'2026-11-19 14.30.05 (1).mov',
			'2026-11-19 14.30.05 (2).mov',
			'2026-11-19 14.30.05 (3).mov',
		]);
	});

	it('gives a file that joins a recording later the next number, whether or not the first carries one', () => {
		expect(recordingLaterFileName('2026-11-19 14.30.05', 2)).toBe('2026-11-19 14.30.05 (2).mov');
		expect(recordingLaterFileName('2026-11-19 14.30.05', 3)).toBe('2026-11-19 14.30.05 (3).mov');
	});

	it('reads the recorders the device keeps, and nothing out of anything else', () => {
		const kept = { pid: 4321, file: '/Users/ada/Movies/a.mov', startedAt: 1_000 };
		const other = { pid: 4322, file: '/Users/ada/Movies/b.mov', startedAt: 1_000 };
		expect(readNativeLedger([kept, other])).toEqual([kept, other]);
		expect(readNativeLedger([{ ...kept, more: true }])).toEqual([kept]);
		// One alone, as an earlier build kept it.
		expect(readNativeLedger(kept)).toEqual([kept]);
		// What is no recorder is left out, and the rest still read.
		expect(readNativeLedger([kept, 'junk', { ...other, pid: 1 }])).toEqual([kept]);
		// One that was sent its stop says so, and nothing but a plain yes says it.
		expect(readNativeLedger([{ ...kept, stopped: true }, other])).toEqual([{ ...kept, stopped: true }, other]);
		expect(readNativeLedger([{ ...kept, stopped: 'yes' }, { ...other, stopped: false }])).toEqual([kept, other]);
		for (const junk of [
			null,
			undefined,
			'4321',
			[],
			{ ...kept, pid: '4321' },
			{ ...kept, pid: 4321.5 },
			// The system's first program is never a recorder, and no number below it is a program.
			{ ...kept, pid: 1 },
			{ ...kept, pid: -7 },
			{ ...kept, file: '' },
			{ ...kept, file: 7 },
			{ ...kept, startedAt: Number.NaN },
		]) {
			expect(readNativeLedger(junk)).toEqual([]);
		}
	});

	it('finds a recorder again by more than its number: the file it writes, or the time it has run', () => {
		expect(processListArguments(4321)).toEqual(['-ww', '-o', 'etime=,command=', '-p', '4321']);
		expect(interruptArguments(4321)).toEqual(['-INT', '4321']);
		const file = '/Users/ada/My Movies/2026-11-19 14.30.05.mov';
		const kept = { pid: 4321, file, startedAt: 1_000_000 };
		// A long while after the kept start, so the time alone proves nothing below.
		const later = 1_000_000 + 9 * 3_600_000;
		expect(isNativeRecorderLine(`   05:23 /usr/sbin/screencapture -v -x ${file}\n`, kept, later)).toBe(true);
		expect(isNativeRecorderLine(`05:23 /usr/sbin/screencapture -v -x -o -l 77 ${file}`, kept, later)).toBe(true);
		// Another program that was given the number since.
		expect(isNativeRecorderLine('05:23 /Applications/Safari.app/Contents/MacOS/Safari', kept, later)).toBe(false);
		// The recorder taking a picture, or writing another file.
		expect(isNativeRecorderLine(`05:23 /usr/sbin/screencapture -x ${file}`, kept, later)).toBe(false);
		expect(isNativeRecorderLine('05:23 /usr/sbin/screencapture -v -x /Users/ada/Movies/Other.mov', kept, later)).toBe(false);
		expect(isNativeRecorderLine(`05:23 /usr/sbin/screencapture -v -x /Other${file}`, kept, later)).toBe(false);
		// A program that only names the recorder among its words.
		expect(isNativeRecorderLine(`05:23 /bin/echo /usr/sbin/screencapture -v -x ${file}`, kept, later)).toBe(false);
		expect(isNativeRecorderLine('', kept, later)).toBe(false);
		expect(isNativeRecorderLine('05:23', kept, later)).toBe(false);
	});

	it('knows the recorder by the time it has run where the list spells its file’s name its own way', () => {
		// A Chinese project's name, as the list writes it where the app has no locale.
		const kept = { pid: 4321, file: '/Users/ada/Movies/钟楼雪 2026-11-19 13.05.10.mov', startedAt: 1_000_000 };
		const spelled = '/usr/sbin/screencapture -v -x /Users/ada/Movies/M-iM^RM^_M-fM-%M-<M-iM^[M-* 2026-11-19 13.05.10.mov';
		const at = (elapsedMs: number): number => kept.startedAt + elapsedMs;
		expect(isNativeRecorderLine(`05:23 ${spelled}`, kept, at(323_000))).toBe(true);
		// The list counts whole seconds, and the start was kept a moment before the recorder was up.
		expect(isNativeRecorderLine(`05:23 ${spelled}`, kept, at(330_000))).toBe(true);
		expect(isNativeRecorderLine(`05:23 ${spelled}`, kept, at(300_000))).toBe(false);
		// Hours and days are counted as the list writes them.
		expect(isNativeRecorderLine(`01:05:23 ${spelled}`, kept, at(3_923_000))).toBe(true);
		expect(isNativeRecorderLine(`2-01:05:23 ${spelled}`, kept, at(2 * 86_400_000 + 3_923_000))).toBe(true);
		// Another recording altogether, begun at another time.
		expect(isNativeRecorderLine(`00:09 ${spelled}`, kept, at(3_923_000))).toBe(false);
		expect(isNativeRecorderLine(`soon ${spelled}`, kept, at(323_000))).toBe(false);
	});

	it('takes an end within the grace of its start as a failure and names the cause it can', () => {
		const early = { code: 1, stopAsked: false, early: true, spawnError: null };
		expect(classifyNativeExit({ ...early, stderr: 'Screen Recording is already running' })).toEqual({
			kind: 'failed',
			code: 'busy',
			detail: null,
		});
		expect(classifyNativeExit({ ...early, stderr: 'You dont have permission to save files' })).toEqual({
			kind: 'failed',
			code: 'permission',
			detail: null,
		});
		expect(
			classifyNativeExit({
				...early,
				stderr: 'screencapture: Invalid display specified. Must be a number from 1-2\n',
			}),
		).toEqual({
			kind: 'failed',
			code: 'recorder-failed',
			detail: 'screencapture: Invalid display specified. Must be a number from 1-2',
		});
		expect(classifyNativeExit({ ...early, stderr: 'first line\n  could not create image from display \n\n' })).toEqual({
			kind: 'failed',
			code: 'recorder-failed',
			detail: 'could not create image from display',
		});
		// A window that is no window ends the recorder without a word.
		expect(classifyNativeExit({ ...early, stderr: '' })).toEqual({
			kind: 'failed',
			code: 'recorder-failed',
			detail: null,
		});
		// Even a clean end is none, this soon and unasked: nothing was recorded.
		expect(classifyNativeExit({ ...early, code: 0, stderr: '' })).toEqual({
			kind: 'failed',
			code: 'recorder-failed',
			detail: null,
		});
	});

	it('takes a clean end as a recording kept, the author’s doing or the Mac’s', () => {
		const late = { stderr: '', code: 0, early: false, spawnError: null };
		expect(classifyNativeExit({ ...late, stopAsked: true })).toEqual({ kind: 'ended', reason: 'stopped' });
		expect(classifyNativeExit({ ...late, stopAsked: false })).toEqual({ kind: 'ended', reason: 'external' });
	});

	it('takes any other end as a recording that was not kept', () => {
		const late = { early: false, stopAsked: true, spawnError: null };
		// The recorder moves its file into place at the end, and says so where it cannot.
		expect(
			classifyNativeExit({
				...late,
				code: 1,
				stderr: 'screencapture: Failed to save to final location /Volumes/Gone/a.mov\n',
			}),
		).toEqual({ kind: 'failed', code: 'folder', detail: null });
		expect(classifyNativeExit({ ...late, code: 1, stderr: 'Cannot write file to intended destination.' })).toEqual({
			kind: 'failed',
			code: 'folder',
			detail: null,
		});
		// Ended by a signal that is not its stop: nothing was saved.
		expect(classifyNativeExit({ ...late, code: null, stderr: '' })).toEqual({
			kind: 'failed',
			code: 'recorder-failed',
			detail: null,
		});
	});

	it('reads a recorder that could not be started as a failure with what the system said', () => {
		expect(
			classifyNativeExit({ stderr: '', code: null, stopAsked: false, early: true, spawnError: 'spawn ENOENT' }),
		).toEqual({ kind: 'failed', code: 'recorder-failed', detail: 'spawn ENOENT' });
	});
});

describe('opening OBS', () => {
	it('opens it on a Mac by its identity through the system opener, in the background', () => {
		const [launch] = obsLaunches('mac');
		expect(launch?.command).toBe(MAC_OPENER);
		expect(launch?.args).toEqual(['-g', '-b', 'com.obsproject.obs-studio', '--args', '--minimize-to-tray']);
	});

	it('starts it on Windows in its own folder', () => {
		const [launch] = obsLaunches('win');
		expect(launch?.command).toBe('C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe');
		expect(launch?.cwd).toBe('C:\\Program Files\\obs-studio\\bin\\64bit');
	});

	it('names every program by its whole path, so nothing on the search path can stand in', () => {
		for (const system of ['mac', 'win', 'linux'] as const) {
			const launches = obsLaunches(system);
			expect(launches.length).toBeGreaterThan(0);
			for (const launch of launches) expect(launch.command).toMatch(/^(\/|[A-Z]:\\)/u);
		}
	});
});
