import { Platform } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';

import { desktopProcessRunner, type ProcessRunner } from '../../src/services/desktop-process';

describe('starting a program', () => {
	const desktop = Platform.isDesktop;
	afterEach(() => {
		Platform.isDesktop = desktop;
	});

	it('has no runner on a phone or a tablet, where there is no Node to reach', async () => {
		Platform.isDesktop = false;
		expect(await desktopProcessRunner()).toBeNull();
	});
});

// The plain programs every Unix carries stand in for the recorder here. They
// are started for real, so what is pinned is the bridge itself: the path and
// the words as they are, the closed input, the signals, and how an end is told.
const windows = (globalThis as { process?: { platform?: string } }).process?.platform === 'win32';

async function runner(): Promise<ProcessRunner> {
	const found = await desktopProcessRunner();
	if (found === null) throw new Error('A desktop has a runner.');
	return found;
}

describe.skipIf(windows)('a program started for real', () => {
	it('is started by its path and heard on what it prints', async () => {
		const program = (await runner()).run('/bin/echo', ['one word', 'another']);
		let heard = '';
		program.onText('out', (text) => {
			heard += text;
		});
		expect(await program.closed).toEqual({ code: 0, signal: null, error: null });
		expect(heard).toBe('one word another\n');
	});

	it('hands its words over as they are, with no shell to read them', async () => {
		const words = '$HOME; echo broken `id` && * > /dev/null';
		const program = (await runner()).run('/bin/echo', [words]);
		let heard = '';
		program.onText('out', (text) => {
			heard += text;
		});
		await program.closed;
		expect(heard).toBe(`${words}\n`);
	});

	it('gives the program no input: one that reads finds the end at once', async () => {
		const program = (await runner()).run('/bin/cat', []);
		let heard = '';
		program.onText('out', (text) => {
			heard += text;
		});
		expect(await program.closed).toEqual({ code: 0, signal: null, error: null });
		expect(heard).toBe('');
	});

	it('holds the input open where asked: one that reads goes on waiting', async () => {
		const program = (await runner()).run('/bin/cat', [], { heldInput: true });
		const waiting = new Promise<'waiting'>((resolve) => {
			setTimeout(() => {
				resolve('waiting');
			}, 200);
		});
		// It finds no end to read, and nothing is ever written for it.
		expect(await Promise.race([program.closed.then(() => 'ended' as const), waiting])).toBe('waiting');
		program.signal('SIGTERM');
		expect(await program.closed).toEqual({ code: null, signal: 'SIGTERM', error: null });
	});

	it('holds no input for a program left to itself', async () => {
		const program = (await runner()).run('/bin/cat', [], { detached: true, heldInput: true });
		// Its input is closed all the same: it reads the end at once and goes.
		expect(await program.closed).toEqual({ code: 0, signal: null, error: null });
	});

	it('knows the program by the system’s number for it', async () => {
		const program = (await runner()).run('/bin/sleep', ['30']);
		expect(Number.isSafeInteger(program.pid)).toBe(true);
		expect(program.pid).toBeGreaterThan(1);
		program.signal('SIGKILL');
		await program.closed;
	});

	it('tells which signal ended a program', async () => {
		const interrupted = (await runner()).run('/bin/sleep', ['30']);
		interrupted.signal('SIGINT');
		expect(await interrupted.closed).toEqual({ code: null, signal: 'SIGINT', error: null });
		const ended = (await runner()).run('/bin/sleep', ['30']);
		ended.signal('SIGTERM');
		expect(await ended.closed).toEqual({ code: null, signal: 'SIGTERM', error: null });
	});

	it('passes on the code a program ends with, and what it said of it', async () => {
		const program = (await runner()).run('/bin/sleep', ['not a number']);
		let said = '';
		program.onText('err', (text) => {
			said += text;
		});
		const exit = await program.closed;
		expect(exit.error).toBeNull();
		expect(exit.signal).toBeNull();
		expect(exit.code).toBeGreaterThan(0);
		expect(said.length).toBeGreaterThan(0);
	});

	it('starts the program in the folder asked', async () => {
		const program = (await runner()).run('/bin/pwd', [], { cwd: '/tmp' });
		let heard = '';
		program.onText('out', (text) => {
			heard += text;
		});
		await program.closed;
		// A Mac's `/tmp` is a link into `/private`.
		expect(heard).toMatch(/\/tmp\n$/u);
	});

	it('says why a program could not be started, and never throws', async () => {
		const program = (await runner()).run('/no/such/folder/program', ['word']);
		const exit = await program.closed;
		expect(exit.code).toBeNull();
		expect(exit.signal).toBeNull();
		expect(exit.error).toContain('ENOENT');
		expect(program.pid).toBeNull();
		// It never ran: a signal does nothing, and does not throw.
		program.signal('SIGKILL');
	});

	it('does nothing to a program that has gone', async () => {
		const program = (await runner()).run('/bin/echo', []);
		await program.closed;
		program.signal('SIGINT');
		expect(await program.closed).toEqual({ code: 0, signal: null, error: null });
	});

	it('leaves a program meant to outlive Obsidian to itself', async () => {
		const program = (await runner()).run('/bin/sleep', ['0'], { detached: true });
		let heard = '';
		program.onText('out', (text) => {
			heard += text;
		});
		// It has no pipes to fill: nothing is heard of it.
		expect(await program.closed).toEqual({ code: 0, signal: null, error: null });
		expect(heard).toBe('');
	});
});
