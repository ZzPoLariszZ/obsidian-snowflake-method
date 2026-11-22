import { Platform } from 'obsidian';

/**
 * Starting a program of the system's, on the desktop alone. This is the
 * only place the plugin reaches into Node, and it reaches for two things.
 * The screen recorder's programs are started by their whole path with their
 * words as a list: no shell is ever asked to read a line, and nothing an
 * author typed is ever run. And the local API, where the author has
 * switched it on, is given Node's listener: see `desktopListenerModule`
 * at the foot of this file.
 *
 * On a phone or a tablet there is no Node to reach: neither import is ever
 * made there, and whoever asks is told there is nothing to hand over.
 */

/** A program that was started, as far as its starter follows it. */
export interface RunningProcess {
	/** The system's number for the program, or null where it could not be started. */
	readonly pid: number | null;
	/** Sends the program a signal. Nothing happens once it has gone. */
	signal(name: 'SIGINT' | 'SIGTERM' | 'SIGKILL'): void;
	/** Hears what the program prints, on either stream. */
	onText(stream: 'out' | 'err', listener: (text: string) => void): void;
	/**
	 * Settles once the program has gone and everything it printed was read.
	 * A program that could not be started settles with why. Never rejects.
	 */
	readonly closed: Promise<ProcessExit>;
}

export interface ProcessExit {
	code: number | null;
	signal: string | null;
	/** Why the program could not be started, where it could not. */
	error: string | null;
}

export interface ProcessOptions {
	/** The folder the program is started in. */
	cwd?: string;
	/** The program is to outlive Obsidian, and is not followed: another application being opened. */
	detached?: boolean;
	/**
	 * The program's input is held open and never written to, where it would
	 * otherwise be closed. One that waits there for a key takes the end of a
	 * closed input for one: the Mac's recorder on macOS 14 ended its
	 * recording a tenth of a second in. The input ends with Obsidian, or
	 * with the program. One left to itself has no input to hold.
	 */
	heldInput?: boolean;
}

export interface ProcessRunner {
	run(command: string, args: readonly string[], options?: ProcessOptions): RunningProcess;
}

// --- Node's module, as far as it is used --------------------------------------

interface PipeLike {
	on(event: 'data', listener: (chunk: unknown) => void): unknown;
	on(event: 'error', listener: (error: unknown) => void): unknown;
}

interface ChildLike {
	pid?: number;
	/** The program's input, where it was held open. Nothing is ever written to it. */
	stdin: { on(event: 'error', listener: (error: unknown) => void): unknown } | null;
	stdout: PipeLike | null;
	stderr: PipeLike | null;
	kill(signal: string): boolean;
	unref(): void;
	on(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
	on(event: 'error', listener: (error: unknown) => void): unknown;
}

interface ProcessModuleLike {
	spawn(
		command: string,
		args: string[],
		options: { cwd?: string; detached: boolean; stdio: string[]; windowsHide: boolean; shell: false },
	): ChildLike;
}

const isProcessModule = (value: unknown): value is ProcessModuleLike =>
	typeof value === 'object' && value !== null && typeof (value as { spawn?: unknown }).spawn === 'function';

const asText = (chunk: unknown): string =>
	typeof chunk === 'string' ? chunk : chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : '';

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : 'unknown');

function follow(child: ChildLike, detached: boolean): RunningProcess {
	let gone = false;
	const listeners: Record<'out' | 'err', ((text: string) => void)[]> = { out: [], err: [] };
	const closed = new Promise<ProcessExit>((resolve) => {
		// One that cannot be started says so here, and never closes.
		child.on('error', (error) => {
			gone = true;
			resolve({ code: null, signal: null, error: reasonOf(error) });
		});
		child.on('close', (code, signal) => {
			gone = true;
			resolve({ code, signal, error: null });
		});
	});
	// A pipe of a program that has gone raises an error of its own, which
	// would otherwise reach the window as an uncaught one.
	for (const [stream, pipe] of [['out', child.stdout], ['err', child.stderr]] as const) {
		if (pipe === null) continue;
		pipe.on('error', () => {});
		pipe.on('data', (chunk) => {
			const said = asText(chunk);
			for (const listener of listeners[stream]) listener(said);
		});
	}
	// An input held open ends with the program, and what it raises then is not the window's to hear either.
	child.stdin?.on('error', () => {});
	if (detached) child.unref();
	return {
		pid: typeof child.pid === 'number' ? child.pid : null,
		signal: (name) => {
			if (gone) return;
			try {
				child.kill(name);
			} catch {
				// Gone between the look and the signal.
			}
		},
		onText: (stream, listener) => {
			listeners[stream].push(listener);
		},
		closed,
	};
}

/**
 * The desktop's runner of programs, or null where there is none: on a phone
 * or a tablet, and on a desktop whose Node could not be reached.
 */
export async function desktopProcessRunner(): Promise<ProcessRunner | null> {
	if (!Platform.isDesktop) return null;
	let loaded: unknown;
	try {
		loaded = await import('child_process');
	} catch {
		return null;
	}
	if (!isProcessModule(loaded)) return null;
	const node = loaded;
	return {
		run: (command, args, options = {}) => {
			const detached = options.detached === true;
			try {
				return follow(
					node.spawn(command, [...args], {
						...(options.cwd === undefined ? {} : { cwd: options.cwd }),
						detached,
						// No program is ever typed to: its input is closed, or held
						// open and left silent where that was asked. One left to
						// itself is given no pipe to fill either.
						stdio: detached
							? ['ignore', 'ignore', 'ignore']
							: [options.heldInput === true ? 'pipe' : 'ignore', 'pipe', 'pipe'],
						windowsHide: true,
						shell: false,
					}),
					detached,
				);
			} catch (error) {
				return {
					pid: null,
					signal: () => {},
					onText: () => {},
					closed: Promise.resolve({ code: null, signal: null, error: reasonOf(error) }),
				};
			}
		},
	};
}

/**
 * Node's own module for answering on a port, for the local API, or null
 * where there is none: on a phone or a tablet, and on a desktop whose Node
 * could not be reached. It is handed over as it came, looked at by nobody
 * here: `desktop-listener.ts` is where it is read, and where the one
 * address it is ever asked to answer on, this computer's own, is written.
 */
export async function desktopListenerModule(): Promise<unknown> {
	if (!Platform.isDesktop) return null;
	try {
		return await import('http');
	} catch {
		return null;
	}
}
