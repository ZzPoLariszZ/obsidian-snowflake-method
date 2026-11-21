import { describe, expect, it } from 'vitest';

import buildConfig from '../esbuild.config.mjs?raw';

/**
 * What the screen recording may reach, held by reading the sources. The
 * plugin runs on phones too and promises its readers that it starts a
 * handful of the system's own programs and OBS and nothing else, speaks to
 * OBS on this computer alone, and reads no file outside the vault: each of
 * those is a line here.
 */
describe('the screen recording’s reach', () => {
	const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', {
		query: '?raw',
		import: 'default',
		eager: true,
	});
	const paths = Object.keys(sources);
	const holding = (pattern: RegExp): string[] => paths.filter((path) => pattern.test(sources[path] ?? ''));

	it('reads the plugin’s own sources', () => {
		expect(paths.length).toBeGreaterThan(100);
	});

	it('reaches Node in one file, for one module, behind the desktop’s guard', () => {
		expect(holding(/import\(\s*['"](?:node:)?[a-z_]+['"]\s*\)/u)).toEqual(['../src/services/desktop-process.ts']);
		const bridge = sources['../src/services/desktop-process.ts'] ?? '';
		expect(bridge.match(/import\(\s*['"][^'"]+['"]\s*\)/gu)).toEqual(["import('child_process')"]);
		// The guard stands first in the function, where the review's rule looks for it.
		expect(bridge).toMatch(
			/export async function desktopProcessRunner\(\): Promise<ProcessRunner \| null> \{\n\tif \(!Platform\.isDesktop\) return null;/u,
		);
		expect(holding(/\brequire\(/u)).toEqual([]);
		expect(holding(/from ['"](?:node:)?(?:fs|path|os|child_process|net|http|https)['"]/u)).toEqual([]);
	});

	it('never asks a shell to read a line', () => {
		const bridge = sources['../src/services/desktop-process.ts'] ?? '';
		expect(bridge).toContain('shell: false');
		expect(holding(/shell:\s*true/u)).toEqual([]);
		expect(holding(/\bexec(?:Sync|File|FileSync)?\(\s*['"`]/u)).toEqual([]);
	});

	it('starts only the programs it names, each by its whole path', () => {
		const logic = sources['../src/domain/recording.ts'] ?? '';
		const named = [...logic.matchAll(/'(\/(?:usr|bin|sbin)\/[^']+)'/gu)].map((match) => match[1]);
		expect(named).toEqual([
			// The Mac's recorder, and the Mac's way of opening OBS.
			'/usr/sbin/screencapture',
			'/usr/bin/open',
			// Is the folder there, does the recorder still run, and its stop.
			'/bin/test',
			'/bin/ps',
			'/bin/kill',
			// What the system calls a screen, for OBS on a Mac.
			'/usr/bin/osascript',
			// Which macOS this is: an older one's recorder cannot film a single window.
			'/usr/bin/sw_vers',
			// OBS on Linux, as a package of the system's or a Flatpak.
			'/usr/bin/obs',
			'/usr/bin/flatpak',
		]);
		// No other file names a program of the system's at all.
		expect(holding(/'\/(?:usr|bin|sbin)\/[a-z]/u)).toEqual(['../src/domain/recording.ts']);
		// Whoever starts one hands the runner a name out of that list, never a line put together.
		const started = paths.flatMap((path) =>
			[...(sources[path] ?? '').matchAll(/\brunner\.run\(([^,)]+)/gu)].map((match) => match[1]),
		);
		expect(started.sort()).toEqual(
			[
				// Asked twice: after the folder, and after a recorder's file.
				'MAC_FOLDER_TEST',
				'MAC_FOLDER_TEST',
				'MAC_PROCESS_LIST',
				'MAC_SCRIPT_RUNNER',
				'MAC_SIGNAL',
				'MAC_VERSION_TOOL',
				'NATIVE_RECORDER',
				'launch.command',
			].sort(),
		);
	});

	it('lowers the guarded import to the require Obsidian gives a plugin', () => {
		expect(buildConfig).toContain("supported: { 'dynamic-import': false }");
	});

	it('speaks to OBS on this computer and nowhere else', () => {
		const sockets = holding(/new WebSocket\(/u);
		expect(sockets).toEqual(['../src/services/obs-socket.ts']);
		const socket = sources['../src/services/obs-socket.ts'] ?? '';
		expect(socket).toContain('return `ws://127.0.0.1:${String(port)}`;');
		expect(holding(/wss?:\/\//u)).toEqual(['../src/services/obs-socket.ts']);
	});

	it('names nothing the way a network call is named', () => {
		// Obsidian's scorecard counts these names in the bundle as network calls.
		const recorders = paths.filter((path) => /recording|obs-socket|desktop-/u.test(path));
		expect(recorders.length).toBeGreaterThan(8);
		for (const path of recorders) {
			expect(sources[path] ?? '', path).not.toMatch(/\b(?:request|fetch|requestUrl)\s*\(/u);
		}
	});
});
