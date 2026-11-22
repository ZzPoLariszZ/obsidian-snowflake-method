import { describe, expect, it } from 'vitest';

import { isJsonObject } from '../../api/json';
import { resolveRef } from '../../api/spec/document';
import { document, operations, problemRegistry, refsUnder, specText, textOf, writtenOperations } from './helpers/spec';

/**
 * The contract held to its own rules. The API reads its routes, its checks
 * and its access classes out of this file, and the package that will call it
 * builds its tools from the same file, so a slip here is a slip in both.
 */
describe('the contract as a document', () => {
	it('is an OpenAPI 3.1 document with a version of its own', () => {
		expect(document.root['openapi']).toBe('3.1.0');
		expect(document.version).toMatch(/^\d+\.\d+\.\d+$/u);
	});

	it('stands under one base path on this computer and nowhere else', () => {
		expect(document.basePath).toBe('/v1');
		const servers = document.root['servers'];
		expect(Array.isArray(servers) ? servers.length : 0).toBe(1);
		const first = Array.isArray(servers) ? servers[0] : null;
		expect(isJsonObject(first) ? first['url'] : null).toBe('http://127.0.0.1:{port}/v1');
	});

	it('points only at parts of itself, and at parts that are there', () => {
		const refs = refsUnder(document.root);
		expect(refs.length).toBeGreaterThan(0);
		for (const { pointer, ref } of refs) {
			expect(() => resolveRef(document, ref), `${pointer} points at ${ref}`).not.toThrow();
		}
	});

	it('asks for the token everywhere unless an operation says otherwise', () => {
		expect(document.root['security']).toEqual([{ bearer: [] }]);
		const open = operations.filter((operation) => operation.open).map((operation) => operation.id);
		expect(open.sort()).toEqual(['getApiRoot', 'getReadiness']);
	});
});

describe('every operation of the contract', () => {
	const written = writtenOperations();
	const tagNames = new Set(
		(Array.isArray(document.root['tags']) ? document.root['tags'] : []).flatMap((tag) =>
			isJsonObject(tag) && typeof tag['name'] === 'string' ? [tag['name']] : [],
		),
	);

	it('is read by the API, none skipped', () => {
		expect(operations.map((operation) => operation.id)).toEqual(written.map((operation) => operation.id));
		expect(operations.length).toBeGreaterThan(0);
	});

	it('has a name of its own that reads as a tool’s', () => {
		const ids = operations.map((operation) => operation.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z][A-Za-z0-9]{2,47}$/u);
	});

	it('says in a few plain words what it does, and then at more length', () => {
		for (const { id, written: operation } of written) {
			const summary = textOf(operation['summary']);
			const description = textOf(operation['description']);
			expect(summary.length, id).toBeGreaterThan(0);
			expect(summary.length, id).toBeLessThanOrEqual(60);
			// No word of the transport: the same operation is a tool and a command.
			expect(summary, id).not.toMatch(/\b(?:GET|POST|PUT|PATCH|DELETE|HTTP|endpoint)\b/u);
			expect(summary, id).not.toMatch(/\.$/u);
			expect(description.trim().length, id).toBeGreaterThan(40);
		}
	});

	it('stands under a group the contract names', () => {
		for (const { id, written: operation } of written) {
			const tags = operation['tags'];
			expect(Array.isArray(tags) && tags.length === 1, id).toBe(true);
			for (const tag of Array.isArray(tags) ? tags : []) expect(tagNames.has(textOf(tag)), `${id}: ${textOf(tag)}`).toBe(true);
		}
	});

	it('names its access class, whether it is answered yet, and its tier', () => {
		for (const { id, written: operation } of written) {
			expect(['read', 'write', 'delete'], id).toContain(operation['x-snowflake-access']);
			const availability = operation['x-snowflake-availability'];
			expect(isJsonObject(availability), id).toBe(true);
			if (!isJsonObject(availability)) continue;
			expect(['available', 'planned'], id).toContain(availability['status']);
			expect(Number.isInteger(availability['round']) && Number(availability['round']) >= 1, id).toBe(true);
			// The first round was answered from the start, so nothing of it is ever planned.
			if (availability['status'] === 'planned') expect(Number(availability['round']), id).toBeGreaterThan(1);
			expect(['core', 'extended', 'advanced'], id).toContain(operation['x-snowflake-tier']);
		}
	});

	it('only reads where the method says it reads', () => {
		for (const operation of operations) {
			if (operation.method === 'GET') expect(operation.access, operation.id).toBe('read');
			if (operation.method === 'DELETE') expect(operation.access, operation.id).toBe('delete');
		}
	});

	it('declares each place its address leaves open, and no other', () => {
		for (const operation of operations) {
			const places = operation.segments.flatMap((segment) => (segment.kind === 'parameter' ? [segment.name] : []));
			const declared = operation.parameters.filter((parameter) => parameter.where === 'path').map((parameter) => parameter.name);
			expect(declared.sort(), operation.id).toEqual([...places].sort());
			expect(new Set(places).size, operation.id).toBe(places.length);
		}
	});

	it('answers a failure with the problem document', () => {
		for (const { id, written: operation } of written) {
			const responses = operation['responses'];
			expect(isJsonObject(responses), id).toBe(true);
			if (!isJsonObject(responses)) continue;
			expect(responses['default'], id).toEqual({ $ref: '#/components/responses/Problem' });
			const answers = Object.keys(responses).filter((status) => status !== 'default');
			expect(answers.length, id).toBeGreaterThan(0);
			for (const status of answers) expect(status, id).toMatch(/^2\d\d$/u);
		}
	});

	it('names only problems the contract lists', () => {
		const registry = problemRegistry();
		for (const { id, written: operation } of written) {
			const errors = operation['x-snowflake-errors'];
			if (errors === undefined) continue;
			expect(Array.isArray(errors), id).toBe(true);
			for (const code of Array.isArray(errors) ? errors : []) {
				expect(Object.keys(registry), `${id}: ${textOf(code)}`).toContain(code);
			}
		}
	});
});

describe('the problems the contract lists', () => {
	it('each have a status that is an error’s and a title', () => {
		const registry = problemRegistry();
		expect(Object.keys(registry).length).toBeGreaterThan(10);
		for (const [code, entry] of Object.entries(registry)) {
			expect(code).toMatch(/^[a-z][a-z-]+[a-z]$/u);
			expect(entry.status, code).toBeGreaterThanOrEqual(400);
			expect(entry.status, code).toBeLessThan(600);
			expect(entry.title, code).toMatch(/\.$/u);
		}
	});
});

describe('the contract as a file', () => {
	it('is plain YAML that every reader takes the same way', () => {
		expect(specText).not.toMatch(/\r/u);
		expect(specText).not.toMatch(/\t/u);
		// No anchors, aliases or merge keys: a second way to say a thing twice,
		// and the one corner where YAML readers differ.
		expect(specText).not.toMatch(/^\s*<<:/mu);
		expect(specText).not.toMatch(/:\s+[&*][A-Za-z]/u);
		// The words YAML 1.1 took for true and false, left bare.
		expect(specText).not.toMatch(/:\s+(?:yes|no|on|off|y|n)\s*$/imu);
	});

	it('names nothing the way a network call is named', () => {
		// The text is carried in the bundle, and Obsidian's review counts these
		// names there whatever they are part of.
		expect(specText).not.toMatch(/\b(?:request|fetch|requestUrl)\s*\(/u);
		expect(specText).not.toMatch(/XMLHttpRequest|WebSocket|sendBeacon|EventSource/u);
	});

	it('is written in plain short sentences', () => {
		expect(specText).not.toContain(String.fromCodePoint(0x2014));
		expect(specText).not.toContain(';');
	});
});
