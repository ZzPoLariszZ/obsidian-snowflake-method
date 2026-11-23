import { hasOwn, isJsonObject, isRecord, type JsonObject, type JsonValue } from '../json';
import { dereference, resolveRef, type ApiDocument } from '../spec/document';
import { ECHO_KEYWORD } from './keywords';

/** One place where a value does not match its schema. */
export interface SchemaIssue {
	/** A JSON Pointer into the value: empty for the value itself. */
	pointer: string;
	/** What is wrong there, in words a caller can act on. */
	detail: string;
}

export interface CheckOptions {
	/**
	 * For what a caller sends. A caller that reads a thing, changes one
	 * property and sends the whole of it back has sent properties that are
	 * not its to change: its id, its path, its etag. Where the schema names
	 * what was read (`x-snowflake-echo`), those are let through and taken
	 * out, so the handler never sees them. Anything else unknown is refused.
	 */
	dropEchoed?: boolean;
}

/** No caller is helped by the hundredth fault of one body. */
const MOST_ISSUES = 20;

const patterns = new Map<string, RegExp>();

function patternOf(source: string): RegExp {
	let found = patterns.get(source);
	if (found === undefined) {
		found = new RegExp(source, 'u');
		patterns.set(source, found);
	}
	return found;
}

/** The JSON type of a value, with a whole number told from the rest. */
function typeOf(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
	return typeof value;
}

const isType = (value: unknown, type: JsonValue): boolean => {
	const actual = typeOf(value);
	return actual === type || (type === 'number' && actual === 'integer');
};

function sameJson(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		return left.length === right.length && left.every((item, index) => sameJson(item, right[index]));
	}
	if (isRecord(left) && isRecord(right)) {
		const keys = Object.keys(left);
		return keys.length === Object.keys(right).length && keys.every((key) => hasOwn(right, key) && sameJson(left[key], right[key]));
	}
	return false;
}

/** A string's length as its reader counts it: by character, a pair of surrogates being one. */
function lengthOf(text: string): number {
	let count = 0;
	for (let at = 0; at < text.length; at += 1) {
		const unit = text.charCodeAt(at);
		// The second half of a pair is no character of its own.
		if (unit < 0xdc00 || unit > 0xdfff) count += 1;
	}
	return count;
}

const escapePointer = (key: string): string => key.replace(/~/gu, '~0').replace(/\//gu, '~1');

const show = (value: JsonValue): string => (typeof value === 'string' ? `"${value}"` : JSON.stringify(value));

class Checker {
	readonly issues: SchemaIssue[] = [];

	constructor(
		private readonly document: ApiDocument,
		private readonly dropEchoed: boolean,
	) {}

	private report(pointer: string, detail: string): void {
		if (this.issues.length < MOST_ISSUES) this.issues.push({ pointer, detail });
	}

	/** Whether a value passes a schema, tried aside: nothing is reported and nothing taken out. */
	private passes(schema: JsonObject, value: unknown): SchemaIssue[] {
		const trial = new Checker(this.document, false);
		trial.visit(schema, value, '');
		return trial.issues;
	}

	visit(schema: JsonObject, value: unknown, pointer: string): void {
		if (this.issues.length >= MOST_ISSUES) return;
		// A number written past what a number holds is read as infinity, which no file keeps: written down
		// it comes back as nothing at all. It is no number a caller meant, whatever the schema asks for.
		if (typeof value === 'number' && !Number.isFinite(value)) {
			this.report(pointer, 'Must be a number, and this one is past what a number can hold.');
			return;
		}
		const ref = schema['$ref'];
		if (typeof ref === 'string') {
			this.visit(resolveRef(this.document, ref), value, pointer);
			const beside: JsonObject = {};
			for (const [key, item] of Object.entries(schema)) if (key !== '$ref') beside[key] = item;
			if (Object.keys(beside).length > 0) this.visit(beside, value, pointer);
			return;
		}

		const type = schema['type'];
		if (type !== undefined) {
			const allowed = Array.isArray(type) ? type : [type];
			if (!allowed.some((candidate) => isType(value, candidate))) {
				const names = allowed.map((candidate) => (typeof candidate === 'string' ? candidate : JSON.stringify(candidate)));
				this.report(pointer, `Expected ${names.join(' or ')}, found ${typeOf(value)}.`);
				return;
			}
		}

		const choices = schema['enum'];
		if (Array.isArray(choices) && !choices.some((choice) => sameJson(choice, value))) {
			this.report(pointer, `Expected one of ${choices.map(show).join(', ')}.`);
		}
		const fixed = schema['const'];
		if (fixed !== undefined && !sameJson(fixed, value)) this.report(pointer, `Expected ${show(fixed)}.`);

		if (typeof value === 'string') this.visitString(schema, value, pointer);
		if (typeof value === 'number') this.visitNumber(schema, value, pointer);
		if (Array.isArray(value)) this.visitList(schema, value, pointer);
		if (isRecord(value)) this.visitObject(schema, value, pointer);

		this.visitChoices(schema, value, pointer);
	}

	private visitString(schema: JsonObject, value: string, pointer: string): void {
		const least = schema['minLength'];
		const most = schema['maxLength'];
		// Counted by character only where the quick count leaves it open.
		if (typeof least === 'number' && (value.length < least || (value.length < least * 2 && lengthOf(value) < least))) {
			this.report(pointer, least === 1 ? 'Must not be empty.' : `Must be at least ${String(least)} characters long.`);
		}
		if (typeof most === 'number' && value.length > most && lengthOf(value) > most) {
			this.report(pointer, `Must be at most ${String(most)} characters long.`);
		}
		const pattern = schema['pattern'];
		if (typeof pattern === 'string' && !patternOf(pattern).test(value)) {
			this.report(pointer, `Must match the pattern ${pattern}.`);
		}
	}

	private visitNumber(schema: JsonObject, value: number, pointer: string): void {
		const least = schema['minimum'];
		const most = schema['maximum'];
		if (typeof least === 'number' && value < least) this.report(pointer, `Must be at least ${String(least)}.`);
		if (typeof most === 'number' && value > most) this.report(pointer, `Must be at most ${String(most)}.`);
	}

	private visitList(schema: JsonObject, value: unknown[], pointer: string): void {
		const least = schema['minItems'];
		const most = schema['maxItems'];
		if (typeof least === 'number' && value.length < least) this.report(pointer, `Must hold at least ${String(least)} items.`);
		if (typeof most === 'number' && value.length > most) this.report(pointer, `Must hold at most ${String(most)} items.`);
		const items = schema['items'];
		if (!isJsonObject(items)) return;
		value.forEach((item, index) => {
			this.visit(items, item, `${pointer}/${String(index)}`);
		});
	}

	private visitObject(schema: JsonObject, value: Record<string, unknown>, pointer: string): void {
		const properties = schema['properties'];
		const known = isJsonObject(properties) ? properties : {};
		const required = schema['required'];
		if (Array.isArray(required)) {
			for (const name of required) {
				if (typeof name === 'string' && !hasOwn(value, name)) this.report(pointer, `The property ${name} is required.`);
			}
		}
		const others = schema['additionalProperties'];
		const echoed = this.dropEchoed ? this.echoedBy(schema) : null;
		for (const key of Object.keys(value)) {
			const at = `${pointer}/${escapePointer(key)}`;
			// Asked by the name alone, `__proto__` would find what every object is born with and be taken for a
			// property the schema describes: one that asks nothing of its value.
			const own = hasOwn(known, key) ? known[key] : undefined;
			if (isJsonObject(own)) {
				this.visit(own, value[key], at);
			} else if (others === false) {
				if (echoed?.has(key) === true) Reflect.deleteProperty(value, key);
				else this.report(at, `The property ${key} is not known here.`);
			} else if (isJsonObject(others)) {
				this.visit(others, value[key], at);
			}
		}
	}

	/** The properties of the thing a caller read, which it may send back with a change. */
	private echoedBy(schema: JsonObject): Set<string> | null {
		const ref = schema[ECHO_KEYWORD];
		if (typeof ref !== 'string') return null;
		const properties = dereference(this.document, resolveRef(this.document, ref))['properties'];
		return new Set(isJsonObject(properties) ? Object.keys(properties) : []);
	}

	private visitChoices(schema: JsonObject, value: unknown, pointer: string): void {
		const all = schema['allOf'];
		if (Array.isArray(all)) {
			for (const part of all) if (isJsonObject(part)) this.visit(part, value, pointer);
		}
		const any = schema['anyOf'];
		if (Array.isArray(any)) this.visitOneOf(any, value, pointer, false);
		const one = schema['oneOf'];
		if (Array.isArray(one)) this.visitOneOf(one, value, pointer, true);
	}

	private visitOneOf(forms: JsonValue[], value: unknown, pointer: string, exactlyOne: boolean): void {
		const schemas = forms.filter(isJsonObject);
		const trials = schemas.map((form) => this.passes(form, value));
		const passing = schemas.filter((_form, index) => trials[index]?.length === 0);
		if (passing.length === 0) {
			this.report(pointer, `Matches none of the ${String(schemas.length)} forms allowed here.`);
			// The form it came nearest to says what a caller most likely meant.
			const nearest = [...trials].sort((left, right) => left.length - right.length)[0] ?? [];
			for (const issue of nearest) this.report(`${pointer}${issue.pointer}`, issue.detail);
			return;
		}
		if (exactlyOne && passing.length > 1) {
			this.report(pointer, 'Matches more than one of the forms allowed here.');
			return;
		}
		// Gone through again in earnest, so what the form lets a caller send back is taken out.
		const chosen = passing[0];
		if (chosen !== undefined && this.dropEchoed) this.visit(chosen, value, pointer);
	}
}

/**
 * Holds a value against a schema of the contract and says where it falls
 * short. An empty answer is a pass. The checker knows the words listed in
 * `keywords.ts` and no others, and a test holds the contract to that list.
 */
export function check(
	document: ApiDocument,
	schema: JsonObject,
	value: unknown,
	options: CheckOptions = {},
): SchemaIssue[] {
	const checker = new Checker(document, options.dropEchoed === true);
	checker.visit(schema, value, '');
	return checker.issues;
}
