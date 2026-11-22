import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../../api/json';
import { checkCall, coerce } from '../../api/schema/coerce';
import { check } from '../../api/schema/validate';
import { readDocument } from '../../api/spec/document';
import { readOperations } from '../../api/spec/operations';

const operation = (extra: JsonObject): JsonObject => ({
	operationId: 'changeThing',
	'x-snowflake-access': 'write',
	'x-snowflake-availability': { status: 'available', round: 1 },
	responses: { '200': { description: 'Done.' } },
	...extra,
});

/** A small contract with the shapes the checker has to tell apart. */
const sample = readDocument({
	openapi: '3.1.0',
	info: { title: 'Sample', version: '1.0.0' },
	servers: [{ url: 'http://127.0.0.1:{port}/v1' }],
	paths: {
		'/things/{thingId}': {
			parameters: [{ name: 'thingId', in: 'path', required: true, schema: { type: 'string', minLength: 1 } }],
			patch: operation({
				parameters: [
					{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
					{ name: 'include', in: 'query', schema: { type: 'array', items: { type: 'string', enum: ['counts', 'usage'] } } },
					{ name: 'force', in: 'query', schema: { type: 'boolean' } },
					{ $ref: '#/components/parameters/IfMatch' },
				],
				requestBody: {
					required: true,
					content: { 'application/json': { schema: { $ref: '#/components/schemas/ThingPatch' } } },
				},
			}),
		},
		'/things': { get: operation({ operationId: 'listThings', 'x-snowflake-access': 'read' }) },
	},
	components: {
		parameters: {
			IfMatch: { name: 'If-Match', in: 'header', required: true, schema: { type: 'string' } },
		},
		schemas: {
			Thing: {
				type: 'object',
				additionalProperties: false,
				properties: { id: { type: 'string' }, etag: { type: 'string' }, name: { type: 'string' } },
			},
			ThingPatch: {
				type: 'object',
				additionalProperties: false,
				'x-snowflake-echo': '#/components/schemas/Thing',
				properties: {
					name: { type: 'string', minLength: 1, maxLength: 5 },
					color: { type: ['string', 'null'], enum: ['pink', 'mint', null] },
					size: { type: 'number', minimum: 0, maximum: 10 },
					tags: { type: 'array', maxItems: 2, items: { type: 'string', pattern: '^[a-z]+$' } },
					place: {
						oneOf: [
							{ type: 'object', additionalProperties: false, required: ['after'], properties: { after: { type: 'string' } } },
							{ type: 'object', additionalProperties: false, required: ['position'], properties: { position: { enum: ['start', 'end'] } } },
						],
					},
					fields: { type: 'object', additionalProperties: { type: 'string' } },
				},
			},
		},
	},
});
const patch = readOperations(sample).find((entry) => entry.id === 'changeThing');
const list = readOperations(sample).find((entry) => entry.id === 'listThings');
if (patch === undefined || list === undefined) throw new Error('The sample has both operations.');
const body = patch.body?.schema ?? {};
const faults = (value: unknown): string[] => check(sample, body, value).map((issue) => `${issue.pointer} ${issue.detail}`);

describe('a value held against a schema', () => {
	it('passes when it is what the schema describes', () => {
		expect(faults({ name: 'Anna', color: null, size: 2.5, tags: ['a', 'b'], place: { after: 'x' }, fields: { any: 'text' } })).toEqual([]);
		expect(faults({})).toEqual([]);
	});

	it('is told its type is wrong, and looked at no further there', () => {
		expect(faults('text')).toEqual([' Expected object, found string.']);
		expect(faults({ name: 4 })).toEqual(['/name Expected string, found integer.']);
		expect(faults({ color: 3 })).toEqual(['/color Expected string or null, found integer.']);
		expect(faults({ size: '2' })).toEqual(['/size Expected number, found string.']);
	});

	it('takes a whole number where a number is asked for, and not the other way', () => {
		expect(faults({ size: 3 })).toEqual([]);
		expect(check(sample, { type: 'integer' }, 2.5)).toEqual([{ pointer: '', detail: 'Expected integer, found number.' }]);
	});

	it('holds text to its length, counted by character', () => {
		expect(faults({ name: '' })).toEqual(['/name Must not be empty.']);
		expect(faults({ name: 'Annabel' })).toEqual(['/name Must be at most 5 characters long.']);
		// Five characters, ten units: an emoji is one character to its reader.
		expect(faults({ name: '😀😀😀😀😀' })).toEqual([]);
		expect(faults({ name: '😀😀😀😀😀😀' })).toEqual(['/name Must be at most 5 characters long.']);
		expect(check(sample, { type: 'string', minLength: 3 }, '😀😀')).toEqual([{ pointer: '', detail: 'Must be at least 3 characters long.' }]);
	});

	it('holds a number to its bounds and a list to its size and its items', () => {
		expect(faults({ size: -1 })).toEqual(['/size Must be at least 0.']);
		expect(faults({ size: 11 })).toEqual(['/size Must be at most 10.']);
		expect(faults({ tags: ['a', 'b', 'c'] })).toEqual(['/tags Must hold at most 2 items.']);
		expect(faults({ tags: ['a', 'B'] })).toEqual(['/tags/1 Must match the pattern ^[a-z]+$.']);
		expect(check(sample, { type: 'array', minItems: 1 }, [])).toEqual([{ pointer: '', detail: 'Must hold at least 1 items.' }]);
	});

	it('holds a value to the ones listed', () => {
		expect(faults({ color: 'red' })).toEqual(['/color Expected one of "pink", "mint", null.']);
		expect(check(sample, { const: true }, false)).toEqual([{ pointer: '', detail: 'Expected true.' }]);
	});

	it('names a property that is required and one that is not known', () => {
		const schema: JsonObject = { type: 'object', required: ['a'], additionalProperties: false, properties: { a: { type: 'string' } } };
		expect(check(sample, schema, {})).toEqual([{ pointer: '', detail: 'The property a is required.' }]);
		expect(check(sample, schema, { a: 'x', 'b/c': 1 })).toEqual([{ pointer: '/b~1c', detail: 'The property b/c is not known here.' }]);
	});

	it('holds the properties a schema does not name to the schema given for the rest', () => {
		expect(faults({ fields: { one: 'a', two: 2 } })).toEqual(['/fields/two Expected string, found integer.']);
	});

	it('wants exactly one of the forms a choice allows, and says which it came nearest to', () => {
		expect(faults({ place: { position: 'end' } })).toEqual([]);
		expect(faults({ place: { position: 'middle' } })).toEqual([
			'/place Matches none of the 2 forms allowed here.',
			'/place/position Expected one of "start", "end".',
		]);
		const either: JsonObject = { oneOf: [{ type: 'number' }, { type: 'integer' }] };
		expect(check(sample, either, 3)).toEqual([{ pointer: '', detail: 'Matches more than one of the forms allowed here.' }]);
		expect(check(sample, { anyOf: [{ type: 'number' }, { type: 'integer' }] }, 3)).toEqual([]);
		expect(check(sample, { allOf: [{ type: 'number' }, { minimum: 5 }] }, 3)).toEqual([{ pointer: '', detail: 'Must be at least 5.' }]);
	});

	it('follows a reference, and what stands beside one', () => {
		expect(check(sample, { $ref: '#/components/schemas/Thing' }, { id: 4 })).toEqual([{ pointer: '/id', detail: 'Expected string, found integer.' }]);
		expect(check(sample, { $ref: '#/components/schemas/Thing', required: ['id'] }, {})).toEqual([{ pointer: '', detail: 'The property id is required.' }]);
	});

	it('stops counting faults once there are enough to act on', () => {
		const many = Object.fromEntries(Array.from({ length: 40 }, (_unused, index) => [`extra${String(index)}`, 1]));
		expect(check(sample, body, many)).toHaveLength(20);
	});

	it('refuses what is not JSON at all', () => {
		expect(check(sample, { type: 'object' }, undefined)).toEqual([{ pointer: '', detail: 'Expected object, found undefined.' }]);
	});
});

describe('what a caller read and sends back with its change', () => {
	it('is refused where nothing says it may come back', () => {
		expect(faults({ id: 'thing-1', name: 'Anna' })).toEqual(['/id The property id is not known here.']);
	});

	it('is let through and taken out in a call’s body', () => {
		const sent = { id: 'thing-1', etag: 'fp1-0', name: 'Anna' };
		expect(check(sample, body, sent, { dropEchoed: true })).toEqual([]);
		expect(sent).toEqual({ name: 'Anna' });
	});

	it('still refuses what was never part of the thing', () => {
		const sent = { id: 'thing-1', nonsense: true };
		expect(check(sample, body, sent, { dropEchoed: true })).toEqual([
			{ pointer: '/nonsense', detail: 'The property nonsense is not known here.' },
		]);
	});
});

describe('a parameter’s words turned into its value', () => {
	it('reads a number, a switch and a list out of text', () => {
		expect(coerce(sample, { type: 'integer' }, '50')).toBe(50);
		expect(coerce(sample, { type: 'integer' }, '-3')).toBe(-3);
		expect(coerce(sample, { type: 'number' }, '2.5')).toBe(2.5);
		expect(coerce(sample, { type: 'boolean' }, 'true')).toBe(true);
		expect(coerce(sample, { type: 'boolean' }, 'false')).toBe(false);
		expect(coerce(sample, { type: 'array', items: { type: 'integer' } }, '1,2')).toEqual([1, 2]);
		expect(coerce(sample, { type: 'array', items: { type: 'string' } }, '')).toEqual([]);
		expect(coerce(sample, { type: ['string', 'null'] }, 'null')).toBe('null');
	});

	it('leaves alone what will not turn, for the check to speak of', () => {
		expect(coerce(sample, { type: 'integer' }, '5x')).toBe('5x');
		expect(coerce(sample, { type: 'integer' }, '')).toBe('');
		expect(coerce(sample, { type: 'boolean' }, 'yes')).toBe('yes');
	});

	it('leaves alone what came typed already', () => {
		expect(coerce(sample, { type: 'integer' }, 7)).toBe(7);
		expect(coerce(sample, { type: 'array', items: { type: 'string' } }, ['a'])).toEqual(['a']);
	});
});

describe('a call held against its operation', () => {
	it('reads the version a change is made against apart from the other parameters', () => {
		expect(patch.precondition).toBe('required');
		expect(patch.parameters.map((parameter) => parameter.name)).toEqual(['thingId', 'limit', 'include', 'force']);
		expect(list.precondition).toBe('none');
	});

	it('types what the address carried and fills in what was left out', () => {
		const checked = checkCall(sample, patch, {
			params: { thingId: 'thing-1', include: 'counts,usage', force: 'true' },
			body: { name: 'Anna' },
		});
		expect(checked.issues).toEqual([]);
		expect(checked.params).toEqual({ thingId: 'thing-1', limit: 100, include: ['counts', 'usage'], force: true });
		expect(checked.body).toEqual({ name: 'Anna' });
	});

	it('says which parameter is missing, wrong or not known', () => {
		const checked = checkCall(sample, patch, { params: { limit: '0', include: 'counts,nonsense', page: '2' }, body: {} });
		expect(checked.issues).toEqual([
			{ pointer: 'params/thingId', detail: 'The parameter thingId is required.' },
			{ pointer: 'params/limit', detail: 'Must be at least 1.' },
			{ pointer: 'params/include/1', detail: 'Expected one of "counts", "usage".' },
			{ pointer: 'params/page', detail: 'The parameter page is not known here.' },
		]);
	});

	it('wants a body where the operation needs one, and none where it takes none', () => {
		expect(checkCall(sample, patch, { params: { thingId: 'a' }, body: undefined }).issues).toEqual([
			{ pointer: '', detail: 'This operation needs a body.' },
		]);
		expect(checkCall(sample, list, { params: {}, body: {} }).issues).toEqual([
			{ pointer: '', detail: 'This operation takes no body.' },
		]);
		expect(checkCall(sample, list, { params: {}, body: undefined }).issues).toEqual([]);
	});

	it('takes out of the body what a caller read and sent back', () => {
		const sent = { id: 'thing-1', name: 'Anna' };
		const checked = checkCall(sample, patch, { params: { thingId: 'thing-1' }, body: sent });
		expect(checked.issues).toEqual([]);
		expect(checked.body).toEqual({ name: 'Anna' });
	});
});
