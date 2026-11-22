import { hasOwn, isJsonObject, type JsonObject, type JsonValue } from '../json';
import { dereference, type ApiDocument } from '../spec/document';
import type { OperationSpec } from '../spec/operations';
import { check, type SchemaIssue } from './validate';

/** The one type a schema asks for, where it asks for one: `null` set aside. */
function wantedType(schema: JsonObject): string | null {
	const type = schema['type'];
	if (typeof type === 'string') return type;
	if (!Array.isArray(type)) return null;
	const named = type.filter((candidate): candidate is string => typeof candidate === 'string' && candidate !== 'null');
	return named.length === 1 ? (named[0] ?? null) : null;
}

/**
 * A parameter's words turned into the value its schema asks for. An address
 * and a query carry nothing but text, so a page size arrives as `"50"` and a
 * list as `"counts,usage"`. Text that will not turn is left as it is, and
 * the check that follows says what is wrong with it. A value that is not
 * text came typed already, through the command line's JSON, and is left alone.
 */
export function coerce(document: ApiDocument, schema: JsonObject, value: unknown): unknown {
	if (typeof value !== 'string') return value;
	const plain = dereference(document, schema);
	const type = wantedType(plain);
	if (type === 'integer') return /^-?\d+$/u.test(value) ? Number(value) : value;
	if (type === 'number') return /^-?\d+(?:\.\d+)?$/u.test(value) ? Number(value) : value;
	if (type === 'boolean') return value === 'true' ? true : value === 'false' ? false : value;
	if (type === 'array') {
		const items = plain['items'];
		const parts = value === '' ? [] : value.split(',');
		return isJsonObject(items) ? parts.map((part) => coerce(document, items, part)) : parts;
	}
	return value;
}

export interface CheckedCall {
	/** The address's and the query's values, typed, with what was left out filled in where the contract says with what. */
	params: Record<string, unknown>;
	body: unknown;
	issues: SchemaIssue[];
}

/**
 * Holds a call against the operation it is for: every parameter the
 * contract declares and no other, and the body against its schema. Nothing
 * a handler is given has skipped this, so a handler reads what it is handed
 * without looking at it again.
 */
export function checkCall(
	document: ApiDocument,
	operation: OperationSpec,
	given: { params: Readonly<Record<string, unknown>>; body: unknown },
): CheckedCall {
	const issues: SchemaIssue[] = [];
	const params: Record<string, unknown> = {};
	const declared = new Set<string>();
	for (const parameter of operation.parameters) {
		declared.add(parameter.name);
		const at = `params/${parameter.name}`;
		const sent = hasOwn(given.params, parameter.name) ? given.params[parameter.name] : undefined;
		if (sent === undefined) {
			const fallback: JsonValue | undefined = dereference(document, parameter.schema)['default'];
			if (fallback !== undefined) params[parameter.name] = fallback;
			else if (parameter.required) issues.push({ pointer: at, detail: `The parameter ${parameter.name} is required.` });
			continue;
		}
		const value = coerce(document, parameter.schema, sent);
		for (const issue of check(document, parameter.schema, value)) {
			issues.push({ pointer: `${at}${issue.pointer}`, detail: issue.detail });
		}
		params[parameter.name] = value;
	}
	for (const name of Object.keys(given.params)) {
		if (!declared.has(name)) issues.push({ pointer: `params/${name}`, detail: `The parameter ${name} is not known here.` });
	}

	if (operation.body === null) {
		if (given.body !== undefined) issues.push({ pointer: '', detail: 'This operation takes no body.' });
	} else if (given.body === undefined) {
		if (operation.body.required) issues.push({ pointer: '', detail: 'This operation needs a body.' });
	} else {
		issues.push(...check(document, operation.body.schema, given.body, { dropEchoed: true }));
	}
	return { params, body: given.body, issues };
}
