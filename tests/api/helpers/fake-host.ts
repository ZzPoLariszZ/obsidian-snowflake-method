import type { ApiHost } from '../../../api/host';
import type { Access } from '../../../api/spec/operations';
import { SnowflakeProjectService, type NoteCountOptions } from '../../../src/services';
import { createFakeEnvironment } from '../../helpers/fake-vault';

/**
 * A plugin for the API to stand on in a test: the real project service on a
 * vault kept in memory, every other answer the real plugin gives made
 * settable, and a record of what was asked of it.
 */
export interface FakeHost extends ApiHost {
	state: {
		access: Access;
		ready: boolean;
		leaving: boolean;
		port: number;
		token: string | null;
		cli: boolean;
		/** The metadata note of the project the author last worked in. */
		current: string | null;
		/** The convention writing is counted by. */
		counting: NoteCountOptions;
	};
	/** The vault the services stand on, with its own records of what was read and written. */
	readonly environment: ReturnType<typeof createFakeEnvironment>;
	/** Makes the plugin ready, as Obsidian does once it has read the vault. */
	becomeReady(): void;
	/** How many pieces of work ran as the plugin's own. */
	ranAsPlugin: number;
}

export function createFakeHost(start: Partial<FakeHost['state']> = {}): FakeHost {
	const state: FakeHost['state'] = {
		access: 'delete',
		ready: true,
		leaving: false,
		port: 27125,
		token: 'snowflake_test',
		cli: true,
		current: null,
		counting: { mode: 'ms-word', headings: 'count' },
		...start,
	};
	let release: (() => void) | null = null;
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	const environment = createFakeEnvironment();
	const projects = new SnowflakeProjectService(environment.vault, environment.fileManager, environment.metadataCache);
	const host: FakeHost = {
		state,
		environment,
		ranAsPlugin: 0,
		becomeReady: () => {
			state.ready = true;
			release?.();
		},
		projects,
		roster: async () => ({
			active: await projects.discoverProjects(),
			archived: await projects.listArchivedProjects(),
		}),
		currentProjectPath: () => state.current,
		countOptions: () => state.counting,
		pluginVersion: () => '9.9.9',
		vaultName: () => 'Test Vault',
		projectsRoot: () => 'Snowflake Projects',
		port: () => state.port,
		access: () => state.access,
		token: () => state.token,
		cliEnabled: () => state.cli,
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
