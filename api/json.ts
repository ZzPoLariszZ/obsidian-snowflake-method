/**
 * A value as JSON carries it. Everything that crosses the API is one of
 * these: what a caller sends, what a handler answers, and the contract
 * itself.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

export interface JsonObject {
	[key: string]: JsonValue;
}

/** An object with keys, as against a list or nothing. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** The same for a value already known to be JSON. */
export const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether an object has a property by that name itself. Every object is
 * born with a handful it did not write, `constructor` and `__proto__` among
 * them, and a name a caller sends must never be taken for one of those.
 */
export const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

/** A copy that shares nothing with what it was made from. */
export function cloneJson<T extends JsonValue>(value: T): T {
	if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
	if (isJsonObject(value)) {
		const copy: JsonObject = {};
		for (const [key, item] of Object.entries(value)) copy[key] = cloneJson(item);
		return copy as T;
	}
	return value;
}
