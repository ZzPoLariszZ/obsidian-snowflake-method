import type {
	ProcessExit,
	ProcessOptions,
	ProcessRunner,
	RunningProcess,
} from '../../src/services/desktop-process';

type Signal = 'SIGINT' | 'SIGTERM' | 'SIGKILL';

/**
 * A runner of programs that starts none: each run is kept as it was asked
 * for, and the test plays the program's part, printing, ending, or
 * answering a signal the way the program under study does.
 */
export class FakeProcess implements RunningProcess {
	readonly signals: string[] = [];
	readonly closed: Promise<ProcessExit>;
	ended = false;
	/**
	 * What a signal does to this program: the code it ends with where it
	 * takes the signal as its stop, or `killed` where the signal itself ends
	 * it. A signal not listed here is not heard at all.
	 */
	onSignal: Partial<Record<Signal, number | 'killed'>> = {};
	private settle: (exit: ProcessExit) => void = () => {};
	private readonly listeners: Record<'out' | 'err', ((text: string) => void)[]> = { out: [], err: [] };

	constructor(
		readonly command: string,
		readonly args: readonly string[],
		readonly options: ProcessOptions,
		readonly pid: number | null,
	) {
		this.closed = new Promise((resolve) => {
			this.settle = resolve;
		});
	}

	signal(name: Signal): void {
		if (this.ended) return;
		this.signals.push(name);
		const answer = this.onSignal[name];
		if (answer === undefined) return;
		if (answer === 'killed') this.end(null, name);
		else this.end(answer);
	}

	onText(stream: 'out' | 'err', listener: (text: string) => void): void {
		this.listeners[stream].push(listener);
	}

	/** The program prints something. */
	say(stream: 'out' | 'err', text: string): void {
		for (const listener of this.listeners[stream]) listener(text);
	}

	/** The program ends. */
	end(code: number | null, signal: string | null = null): void {
		if (this.ended) return;
		this.ended = true;
		this.settle({ code, signal, error: null });
	}

	/** The program could not be started at all. */
	fail(error: string): void {
		if (this.ended) return;
		this.ended = true;
		this.settle({ code: null, signal: null, error });
	}
}

export class FakeProcessRunner implements ProcessRunner {
	readonly runs: FakeProcess[] = [];
	/** Dresses each program as it is started, before its starter sees it. */
	onRun: (process: FakeProcess) => void = () => {};
	/**
	 * The small programs that answer and end by themselves, by their path:
	 * each is played a turn after it was started, as a real one would be.
	 */
	readonly played = new Map<string, (process: FakeProcess) => void>();
	private nextPid = 5000;

	run(command: string, args: readonly string[], options: ProcessOptions = {}): RunningProcess {
		this.nextPid += 1;
		const process = new FakeProcess(command, args, options, this.nextPid);
		this.onRun(process);
		this.runs.push(process);
		const play = this.played.get(command);
		if (play !== undefined) {
			void Promise.resolve().then(() => {
				play(process);
			});
		}
		return process;
	}

	/** The last program started. */
	get last(): FakeProcess {
		const process = this.runs[this.runs.length - 1];
		if (process === undefined) throw new Error('No program was started.');
		return process;
	}

	/** The programs started by one path, in order. */
	of(command: string): FakeProcess[] {
		return this.runs.filter((process) => process.command === command);
	}
}
