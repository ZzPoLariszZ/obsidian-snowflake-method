import { isJsonObject, type JsonObject } from '../../../api/json';
import { check } from '../../../api/schema/validate';
import { dereference } from '../../../api/spec/document';
import { document, writtenOperations } from './spec';

/** The schema the contract gives an operation's answer under a status, or null where that answer has no body. */
export function answerSchema(operationId: string, status: number): JsonObject | null {
	const operation = writtenOperations().find((entry) => entry.id === operationId);
	if (operation === undefined) throw new Error(`The contract has no operation ${operationId}.`);
	const responses = operation.written['responses'];
	const answer = isJsonObject(responses) ? responses[String(status)] : undefined;
	if (!isJsonObject(answer)) throw new Error(`${operationId} does not describe an answer under ${String(status)}.`);
	const content = dereference(document, answer)['content'];
	if (!isJsonObject(content)) return null;
	const media = content['application/json'];
	const schema = isJsonObject(media) ? media['schema'] : undefined;
	return isJsonObject(schema) ? schema : null;
}

/** Where a value is something JSON cannot carry: an `undefined`, a function, a date, a file. */
export function notJson(value: unknown, at = ''): string[] {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return [];
	if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${at} is not a finite number`];
	if (Array.isArray(value)) return value.flatMap((item, index) => notJson(item, `${at}/${String(index)}`));
	if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
		return Object.entries(value).flatMap(([key, item]) => notJson(item, `${at}/${key}`));
	}
	return [`${at} is ${typeof value === 'object' ? 'an object of a class' : typeof value}`];
}

/**
 * Where an answer falls short of what the contract promises for it. Empty
 * when it is plain JSON of exactly the described shape.
 */
export function shapeFaults(operationId: string, status: number, body: unknown): string[] {
	const schema = answerSchema(operationId, status);
	if (schema === null) return body === undefined ? [] : ['an answer with no body carried one'];
	return [
		...notJson(body),
		...check(document, schema, body).map((issue) => `${issue.pointer} ${issue.detail}`),
	];
}

/** The same for a failure: every one is the problem document. */
export function problemFaults(body: unknown): string[] {
	return [
		...notJson(body),
		...check(document, { $ref: '#/components/schemas/Problem' }, body).map((issue) => `${issue.pointer} ${issue.detail}`),
	];
}
