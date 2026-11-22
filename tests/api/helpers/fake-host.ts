import type { ApiHost } from '../../../api/host';
import type { Access } from '../../../api/spec/operations';

/**
 * A plugin for the API to stand on in a test: every answer the real one
 * gives, each settable, with a record of what was asked of it.
 */
export interface FakeHost extends ApiHost {
	state: {
		access: Access;
		ready: boolean;
		leaving: boolean;
		port: number;
		token: string | null;
	};
	/** Makes the plugin ready, as Obsidian does once it has read the vault. */
	becomeReady(): void;
	/** How many pieces of work ran as the plugin's own. */
	ranAsPlugin: number;
}

export function createFakeHost(start: Partial<FakeHost['state']> = {}): FakeHost {
	const state: FakeHost['state'] = { access: 'delete', ready: true, leaving: false, port: 27125, token: 'snowflake_test', ...start };
	let release: (() => void) | null = null;
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	const host: FakeHost = {
		state,
		ranAsPlugin: 0,
		becomeReady: () => {
			state.ready = true;
			release?.();
		},
		pluginVersion: () => '9.9.9',
		vaultName: () => 'Test Vault',
		projectsRoot: () => 'Snowflake Projects',
		port: () => state.port,
		access: () => state.access,
		token: () => state.token,
		ready: () => (state.ready ? Promise.resolve() : waiting),
		isReady: () => state.ready,
		leaving: () => state.leaving,
		asPlugin: async (run) => {
			host.ranAsPlugin += 1;
			return run();
		},
	};
	return host;
}
