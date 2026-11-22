import type { CallHandler, LoopbackListener, LoopbackListenerFactory } from '../../src/services/desktop-listener';

/** Where the listener stands, for the settings page to show. */
export type ServerStatus =
	| { readonly state: 'off' }
	| { readonly state: 'listening'; readonly port: number }
	| {
			readonly state: 'failed';
			readonly port: number;
			/**
			 * Another program has the port; the system will not give it; it
			 * could not be started for another reason; this device has no
			 * listener to start; there is no access token, none having been
			 * made or the one there was having been taken away.
			 */
			readonly reason: 'in-use' | 'denied' | 'failed' | 'no-listener' | 'no-token';
	  };

export interface ApiServerDeps {
	/** The desktop's way to answer on a port, or null where there is none. */
	listeners(): Promise<LoopbackListenerFactory | null>;
	/** The door a call is handed to, told which port it answers on. */
	door(port: () => number): CallHandler;
	/** The author's token, or null where none has been made. */
	token(): string | null;
	/** Told each time the listener's standing changes. */
	changed(status: ServerStatus): void;
}

/**
 * The listener's life: started on the port the author chose, stopped, and
 * started again when the port changes. One thing at a time: a start asked
 * for while a stop is under way waits for it, so two listeners never stand
 * at once and a port is never asked for while this plugin still holds it.
 *
 * A port that cannot be had is said and left at that. No other port is
 * tried: whoever calls must know where, and a listener that moved by itself
 * would be one nobody could find.
 */
export class ApiServer {
	private listener: LoopbackListener | null = null;
	private standing: ServerStatus = { state: 'off' };
	private line: Promise<void> = Promise.resolve();

	constructor(private readonly deps: ApiServerDeps) {}

	status(): ServerStatus {
		return this.standing;
	}

	/** Starts answering on the port, in place of whatever answered before. Never rejects. */
	start(port: number): Promise<ServerStatus> {
		return this.inTurn(() => this.open(port)).then(() => this.standing);
	}

	/**
	 * Told that the author's token was changed or taken away somewhere else:
	 * in Obsidian's own keychain, where it is kept. A listener is not left
	 * standing with nobody it could let in, so it stops where the token is
	 * gone, and says why. One that had stopped for want of a token starts
	 * again where there now is one. Everything else stands as it stood: a
	 * token put in place of another is what the next call is held against,
	 * with nothing here to be done about it. Never rejects.
	 */
	tokenChanged(): Promise<ServerStatus> {
		return this.inTurn(async () => {
			const standing = this.standing;
			if (standing.state === 'off') return;
			const held = this.deps.token() !== null;
			const lost = standing.state === 'listening' && !held;
			const found = standing.state === 'failed' && standing.reason === 'no-token' && held;
			if (lost || found) await this.open(standing.port);
		}).then(() => this.standing);
	}

	private async open(port: number): Promise<void> {
		await this.close();
		// Without a token nobody could be told from anybody, so nothing is opened.
		if (this.deps.token() === null) {
			this.set({ state: 'failed', port, reason: 'no-token' });
			return;
		}
		const factory = await this.deps.listeners();
		if (factory === null) {
			this.set({ state: 'failed', port, reason: 'no-listener' });
			return;
		}
		const bound = { port };
		const outcome = await factory.listen(port, this.deps.door(() => bound.port));
		if (!outcome.ok) {
			this.set({ state: 'failed', port, reason: outcome.reason });
			return;
		}
		bound.port = outcome.listener.port;
		this.listener = outcome.listener;
		this.set({ state: 'listening', port: outcome.listener.port });
	}

	/** Stops answering. Settles once the port is let go, and never rejects. */
	stop(): Promise<void> {
		return this.inTurn(async () => {
			await this.close();
			this.set({ state: 'off' });
		});
	}

	private async close(): Promise<void> {
		const listener = this.listener;
		this.listener = null;
		if (listener !== null) await listener.close();
	}

	private set(status: ServerStatus): void {
		this.standing = status;
		this.deps.changed(status);
	}

	private inTurn(work: () => Promise<void>): Promise<void> {
		const run = this.line.then(work).catch(() => {
			// A start that threw leaves nothing listening and says it failed.
			this.listener = null;
			this.set({ state: 'failed', port: 0, reason: 'failed' });
		});
		this.line = run;
		return run;
	}
}
