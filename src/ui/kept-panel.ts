/**
 * A panel kept across the frame rebuilds around it. The dashboard redraws
 * its whole frame on every refresh; a panel that keeps itself current -- by
 * its own subscription, or by a refresh that costs only stamp checks --
 * is handed back into the new frame rather than torn down and refetched.
 * The key says what it was built for, its project and its language, so a
 * frame for another project builds a panel of its own.
 */
export class KeptPanel<T extends { dispose(): void }> {
	private handle: T | null = null;
	private host: HTMLElement | null = null;
	private key: string | null = null;

	/**
	 * Hands the standing panel back into `body` when it was built for `key`,
	 * and answers with it; null when there is nothing to hand back.
	 */
	reuse(body: HTMLElement, key: string): T | null {
		if (this.handle === null || this.host === null || this.key !== key) {
			return null;
		}
		body.appendChild(this.host);
		return this.handle;
	}

	/** Keeps a panel just built in `host`, letting any earlier one go. */
	keep(host: HTMLElement, key: string, handle: T): T {
		this.dispose();
		this.host = host;
		this.key = key;
		this.handle = handle;
		return handle;
	}

	/** Lets the panel go and takes its element out of whatever holds it. */
	dispose(): void {
		this.handle?.dispose();
		this.handle = null;
		this.host?.remove();
		this.host = null;
		this.key = null;
	}
}
