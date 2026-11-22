import { describe, expect, it } from 'vitest';

import { createLocalApi } from '../../api/index';
import { isJsonObject } from '../../api/json';
import { allHandlers } from '../../api/operations/registry';
import { createFakeHost } from './helpers/fake-host';
import { problemFaults, shapeFaults } from './helpers/shapes';
import { document, operations } from './helpers/spec';

const call = (operationId: string, authenticated = true) => ({
	operationId,
	params: {},
	body: undefined,
	ifMatch: null,
	authenticated,
});

describe('the handlers and the contract', () => {
	it('answer exactly the operations the contract calls available', () => {
		expect([...allHandlers().keys()].sort()).toEqual(
			operations
				.filter((operation) => operation.available)
				.map((operation) => operation.id)
				.sort(),
		);
	});
});

describe('what the API says of itself', () => {
	it('tells a caller with no token which service and contract this is, and nothing of the author’s', async () => {
		const reply = await createLocalApi(createFakeHost()).dispatcher.dispatch(call('getApiRoot', false));
		expect(reply.status).toBe(200);
		expect(reply.body).toEqual({ service: 'snowflake-method', contract: document.version, authenticated: false });
		expect(shapeFaults('getApiRoot', 200, reply.body)).toEqual([]);
	});

	it('tells a caller with one the plugin, the vault, the access level and the limits', async () => {
		const host = createFakeHost({ access: 'write' });
		const reply = await createLocalApi(host).dispatcher.dispatch(call('getApiRoot'));
		expect(reply.body).toEqual({
			service: 'snowflake-method',
			contract: document.version,
			authenticated: true,
			plugin: { id: 'snowflake-method', version: '9.9.9' },
			vault: { name: 'Test Vault' },
			access: 'write',
			projectsRoot: 'Snowflake Projects',
			limits: { bodyBytes: 2097152, bridgeBytes: 131072, pageSize: 100, maxPageSize: 500 },
		});
		expect(shapeFaults('getApiRoot', 200, reply.body)).toEqual([]);
	});

	it('says whether it is ready without waiting to be', async () => {
		const host = createFakeHost({ ready: false });
		const api = createLocalApi(host);
		const early = await api.dispatcher.dispatch(call('getReadiness', false));
		expect(early.status).toBe(503);
		expect(early.body).toMatchObject({ code: 'not-ready' });
		expect(problemFaults(early.body)).toEqual([]);
		host.becomeReady();
		const later = await api.dispatcher.dispatch(call('getReadiness', false));
		expect(later.body).toEqual({ ready: true });
		expect(shapeFaults('getReadiness', 200, later.body)).toEqual([]);
	});

	it('hands out its own description to a caller with the token only', async () => {
		const api = createLocalApi(createFakeHost({ port: 31999 }));
		expect((await api.dispatcher.dispatch(call('getOpenApiDocument', false))).status).toBe(401);
		const reply = await api.dispatcher.dispatch(call('getOpenApiDocument'));
		expect(reply.status).toBe(200);
		const shown = reply.body;
		expect(isJsonObject(shown) ? shown['openapi'] : null).toBe('3.1.0');
		expect(JSON.stringify(isJsonObject(shown) ? shown['servers'] : null)).toContain('"default":"31999"');
		expect(shapeFaults('getOpenApiDocument', 200, shown)).toEqual([]);
	});

	it('answers about itself even while the plugin cannot yet list projects', async () => {
		const api = createLocalApi(createFakeHost({ ready: false }));
		expect((await api.dispatcher.dispatch(call('getApiRoot'))).status).toBe(200);
		expect((await api.dispatcher.dispatch(call('getOpenApiDocument'))).status).toBe(200);
	});
});
