import { describe, expect, it } from 'vitest';

import { isJsonObject, type JsonValue } from '../../api/json';
import { ANNOTATION_KEYWORDS, CHECKED_KEYWORDS, ECHO_KEYWORD } from '../../api/schema/keywords';
import { check } from '../../api/schema/validate';
import { resolveRef } from '../../api/spec/document';
import { document, operations, writtenSchemas } from './helpers/spec';

/**
 * Every schema of the contract held to what the API's checker can enforce.
 * The checker is small on purpose, and the price of that is here: the
 * contract may say nothing the checker would not hold a caller to.
 */
describe('every schema of the contract', () => {
	const schemas = writtenSchemas();
	const known = new Set([...CHECKED_KEYWORDS, ...ANNOTATION_KEYWORDS]);
	const types = ['null', 'boolean', 'integer', 'number', 'string', 'array', 'object'];

	it('is found, the ones inside others too', () => {
		expect(schemas.length).toBeGreaterThan(20);
		expect(schemas.some((entry) => entry.pointer.includes('/properties/'))).toBe(true);
	});

	it('uses only the words the checker knows', () => {
		for (const { pointer, schema } of schemas) {
			for (const word of Object.keys(schema)) expect(known.has(word), `${pointer}: ${word}`).toBe(true);
		}
	});

	it('names only types there are', () => {
		for (const { pointer, schema } of schemas) {
			const type = schema['type'];
			if (type === undefined) continue;
			for (const name of Array.isArray(type) ? type : [type]) expect(types, pointer).toContain(name);
		}
	});

	it('says of every object whether it takes properties it does not name', () => {
		// Left unsaid, an object takes anything: an answer could then carry a
		// field the contract never promised, and no test would see it.
		for (const { pointer, schema } of schemas) {
			if (!isJsonObject(schema['properties'])) continue;
			expect(schema['additionalProperties'], pointer).toBeDefined();
		}
	});

	it('requires only properties it names', () => {
		for (const { pointer, schema } of schemas) {
			const required = schema['required'];
			if (!Array.isArray(required)) continue;
			const properties = schema['properties'];
			const named = isJsonObject(properties) ? Object.keys(properties) : [];
			for (const name of required) expect(named, `${pointer}: ${JSON.stringify(name)}`).toContain(name);
		}
	});

	it('never joins closed objects, which would each refuse the other’s properties', () => {
		for (const { pointer, schema } of schemas) {
			const parts = schema['allOf'];
			if (!Array.isArray(parts)) continue;
			expect(schema['additionalProperties'], pointer).not.toBe(false);
			for (const part of parts) {
				const whole = isJsonObject(part) && typeof part['$ref'] === 'string' ? resolveRef(document, part['$ref']) : part;
				expect(isJsonObject(whole) ? whole['additionalProperties'] : undefined, pointer).not.toBe(false);
			}
		}
	});

	it('names, where it lets a caller send back what it read, a schema that is there', () => {
		for (const { pointer, schema } of schemas) {
			const echo = schema[ECHO_KEYWORD];
			if (echo === undefined) continue;
			expect(typeof echo, pointer).toBe('string');
			expect(schema['additionalProperties'], pointer).toBe(false);
			if (typeof echo === 'string') expect(() => resolveRef(document, echo), pointer).not.toThrow();
		}
	});
});

describe('what was read, sent back whole', () => {
	/** The schema a property is held to, with what it points at looked up. */
	const takesNull = (schema: JsonValue | undefined): boolean => isJsonObject(schema) && check(document, schema, null).length === 0;

	it('is taken where a property stands empty: what may be read as null may be sent as null', () => {
		const refused: string[] = [];
		for (const { pointer, schema } of writtenSchemas()) {
			const echo = schema[ECHO_KEYWORD];
			if (typeof echo !== 'string') continue;
			const read = resolveRef(document, echo)['properties'];
			const sent = schema['properties'];
			if (!isJsonObject(read) || !isJsonObject(sent)) continue;
			for (const [name, taken] of Object.entries(sent)) {
				// A property only the patch has is nothing a read could have handed back.
				if (!(name in read)) continue;
				if (takesNull(read[name]) && !takesNull(taken)) refused.push(`${pointer}/properties/${name}`);
			}
		}
		expect(refused).toEqual([]);
	});
});

describe('what a call may carry', () => {
	it('never has a property of the body named as a parameter is', () => {
		// A tool's input is one flat object, and so is the command line's.
		for (const operation of operations) {
			if (operation.body === null) continue;
			const schema = operation.body.schema;
			const whole = typeof schema['$ref'] === 'string' ? resolveRef(document, schema['$ref']) : schema;
			const properties = whole['properties'];
			const named = isJsonObject(properties) ? Object.keys(properties) : [];
			for (const parameter of operation.parameters) expect(named, operation.id).not.toContain(parameter.name);
		}
	});

	it('gives every query parameter a type the address can carry', () => {
		for (const operation of operations) {
			for (const parameter of operation.parameters) {
				const schema = typeof parameter.schema['$ref'] === 'string' ? resolveRef(document, parameter.schema['$ref']) : parameter.schema;
				expect(['string', 'integer', 'number', 'boolean', 'array'], `${operation.id}: ${parameter.name}`).toContain(schema['type']);
			}
		}
	});
});
