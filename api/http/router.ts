import type { Method, OperationSpec } from '../spec/operations';

/** Where an address led. */
export type Route =
	| {
			readonly kind: 'found';
			readonly operation: OperationSpec;
			/** The address's and the query's values, as text. */
			readonly params: Record<string, string>;
	  }
	/** Something stands at the address, and not under this method. */
	| { readonly kind: 'wrong-method'; readonly allow: readonly Method[] }
	/** Nothing stands there. */
	| { readonly kind: 'none' };

/** One step of an address as it was sent, read back into its own characters. Null where it cannot be. */
function decodeStep(step: string): string | null {
	try {
		return decodeURIComponent(step);
	} catch {
		return null;
	}
}

/**
 * Finds the operation an address and a method lead to.
 *
 * An address is cut at its slashes as it was sent and only then is each
 * step read back into its own characters. That is what lets one step carry
 * a path: a manuscript note is addressed by where it stands in its project,
 * `50_Manuscript%2FChapter%201.md`, and read the other way round that would
 * be three steps and no note at all.
 */
export class Router {
	private readonly byLength = new Map<number, OperationSpec[]>();

	constructor(
		operations: readonly OperationSpec[],
		private readonly basePath: string,
	) {
		for (const operation of operations) {
			const held = this.byLength.get(operation.segments.length) ?? [];
			held.push(operation);
			this.byLength.set(operation.segments.length, held);
		}
		// A word that must stand in a place is tried before a value that may:
		// `/tasks/purge-archived` is itself and never a task of that id.
		const words = (operation: OperationSpec): number =>
			operation.segments.filter((segment) => segment.kind === 'literal').length;
		for (const held of this.byLength.values()) held.sort((left, right) => words(right) - words(left));
	}

	route(method: string, target: string): Route {
		const mark = target.indexOf('?');
		const path = mark === -1 ? target : target.slice(0, mark);
		const query = mark === -1 ? '' : target.slice(mark + 1);
		if (path !== this.basePath && !path.startsWith(`${this.basePath}/`)) return { kind: 'none' };
		let rest = path.slice(this.basePath.length);
		// One closing slash is taken as none: `/v1/` is `/v1`.
		if (rest.endsWith('/')) rest = rest.slice(0, -1);
		const steps: string[] = [];
		if (rest !== '') {
			for (const raw of rest.slice(1).split('/')) {
				const step = decodeStep(raw);
				if (step === null || step === '') return { kind: 'none' };
				steps.push(step);
			}
		}

		const allow: Method[] = [];
		for (const operation of this.byLength.get(steps.length) ?? []) {
			const params: Record<string, string> = {};
			const fits = operation.segments.every((segment, index) => {
				const step = steps[index] ?? '';
				if (segment.kind === 'literal') return segment.text === step;
				params[segment.name] = step;
				return true;
			});
			if (!fits) continue;
			if (operation.method !== method) {
				if (!allow.includes(operation.method)) allow.push(operation.method);
				continue;
			}
			// Kept by name in a map and not on an object: a name such as `constructor` or `__proto__` is one
			// every object answers to already, and a query that sent it would be read as said twice, or lost.
			const asked = new Map<string, string>();
			new URLSearchParams(query).forEach((value, name) => {
				// A name said twice is taken as a list of its values.
				const before = asked.get(name);
				asked.set(name, before === undefined ? value : `${before},${value}`);
			});
			// What the address itself says is not the query's to say again.
			return { kind: 'found', operation, params: { ...Object.fromEntries(asked), ...params } };
		}
		return allow.length > 0 ? { kind: 'wrong-method', allow } : { kind: 'none' };
	}
}
