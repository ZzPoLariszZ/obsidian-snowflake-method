import { ApiError } from '../errors';
import { BODY_BYTES, BRIDGE_BYTES, MAX_PAGE_SIZE, PAGE_SIZE } from '../limits';
import type { OperationGroup } from './context';

/** The plugin's id, which is also the name the service answers under. */
export const SERVICE = 'snowflake-method';

/**
 * What the API says of itself. These three wait for nothing and stand in no
 * queue: a caller that cannot yet be told about projects can still be told
 * what answers here, whether it is ready, and what it may ask.
 */
export const systemOperations: OperationGroup = {
	// To a caller with no token: that this is the plugin, and which contract
	// it speaks, so a client can tell a wrong port from a missing token.
	// Nothing of the author's is in that answer, not even the vault's name.
	getApiRoot: (call, context) => {
		const known = { service: SERVICE, contract: context.document.version };
		if (!call.authenticated) return { status: 200, body: { ...known, authenticated: false } };
		const host = context.host;
		return {
			status: 200,
			body: {
				...known,
				authenticated: true,
				plugin: { id: SERVICE, version: host.pluginVersion() },
				vault: { name: host.vaultName() },
				access: host.access(),
				canRename: !host.asksBeforeLinkUpdates(),
				projectsRoot: host.projectsRoot(),
				limits: {
					bodyBytes: BODY_BYTES,
					bridgeBytes: BRIDGE_BYTES,
					pageSize: PAGE_SIZE,
					maxPageSize: MAX_PAGE_SIZE,
				},
			},
		};
	},

	getReadiness: (_call, context) => {
		if (!context.host.isReady()) {
			throw new ApiError('not-ready', 'Obsidian is still reading the vault. Ask again in a moment.');
		}
		return { status: 200, body: { ready: true } };
	},

	getOpenApiDocument: (_call, context) => ({ status: 200, body: context.published() }),
};
