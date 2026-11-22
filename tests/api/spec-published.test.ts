import { describe, expect, it } from 'vitest';

import { isJsonObject, type JsonObject } from '../../api/json';
import { readDocument, resolveRef } from '../../api/spec/document';
import { readOperations, segmentsOf } from '../../api/spec/operations';
import { publishedDocument } from '../../api/spec/published';
import { document, operations, refsUnder } from './helpers/spec';

const operation = (id: string, status: 'available' | 'planned', schema: string): JsonObject => ({
	operationId: id,
	tags: [status === 'available' ? 'Now' : 'Later'],
	'x-snowflake-access': 'read',
	'x-snowflake-availability': { status, round: status === 'available' ? 1 : 2 },
	responses: {
		'200': { description: 'It.', content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } },
	},
});

/** A small contract with one operation answered and two planned, each pointing at schemas of its own. */
const sample = readDocument({
	openapi: '3.1.0',
	info: { title: 'Sample', version: '1.0.0' },
	servers: [{ url: 'http://127.0.0.1:{port}/v1', variables: { port: { default: '27125' } } }],
	tags: [{ name: 'Now' }, { name: 'Later' }],
	paths: {
		'/things': { get: operation('listThings', 'available', 'Thing'), post: operation('makeThing', 'planned', 'Draft') },
		'/later': { get: operation('listLater', 'planned', 'Draft') },
	},
	components: {
		securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
		schemas: {
			Thing: { type: 'object', properties: { part: { $ref: '#/components/schemas/Part' } } },
			Part: { type: 'string' },
			Draft: { type: 'object', properties: { part: { $ref: '#/components/schemas/Unfinished' } } },
			Unfinished: { type: 'string' },
		},
	},
});

describe('the contract a caller is shown', () => {
	const shown = publishedDocument(sample, readOperations(sample), 31999);

	it('holds the operations this build answers and leaves the planned ones out', () => {
		expect(shown['paths']).toEqual({ '/things': { get: operation('listThings', 'available', 'Thing') } });
	});

	it('keeps what those operations point at, however far, and drops the rest', () => {
		const components = shown['components'];
		expect(isJsonObject(components) ? Object.keys(components['schemas'] as JsonObject).sort() : []).toEqual(['Part', 'Thing']);
		expect(isJsonObject(components) ? components['securitySchemes'] : null).toEqual({ bearer: { type: 'http', scheme: 'bearer' } });
	});

	it('names only the groups that still have an operation', () => {
		expect(shown['tags']).toEqual([{ name: 'Now' }]);
	});

	it('carries the port the listener is on', () => {
		expect(shown['servers']).toEqual([{ url: 'http://127.0.0.1:{port}/v1', variables: { port: { default: '31999' } } }]);
	});

	it('leaves the contract it was made from as it was', () => {
		expect(Object.keys(sample.paths)).toEqual(['/things', '/later']);
		const servers = sample.root['servers'];
		expect(JSON.stringify(servers)).toContain('"27125"');
	});
});

describe('the real contract as a caller is shown it', () => {
	const shown = publishedDocument(document, operations, 27125);

	it('is whole: every reference it keeps still leads somewhere in it', () => {
		const standing = readDocument(shown);
		for (const { pointer, ref } of refsUnder(shown)) {
			expect(() => resolveRef(standing, ref), `${pointer} points at ${ref}`).not.toThrow();
		}
	});

	it('shows every operation that is answered and none that is planned', () => {
		const standing = readOperations(readDocument(shown));
		expect(standing.map((entry) => entry.id)).toEqual(
			operations.filter((entry) => entry.available).map((entry) => entry.id),
		);
		expect(standing.every((entry) => entry.available)).toBe(true);
	});
});

describe('an address read into its steps', () => {
	it('tells a word from a place a value goes', () => {
		expect(segmentsOf('/')).toEqual([]);
		expect(segmentsOf('/projects/{projectId}/manuscript/notes/{notePath}/body')).toEqual([
			{ kind: 'literal', text: 'projects' },
			{ kind: 'parameter', name: 'projectId' },
			{ kind: 'literal', text: 'manuscript' },
			{ kind: 'literal', text: 'notes' },
			{ kind: 'parameter', name: 'notePath' },
			{ kind: 'literal', text: 'body' },
		]);
	});
});
