function serializeNumber(value: number): string {
	if (Number.isNaN(value)) return 'number:NaN';
	if (value === Number.POSITIVE_INFINITY) return 'number:Infinity';
	if (value === Number.NEGATIVE_INFINITY) return 'number:-Infinity';
	if (Object.is(value, -0)) return 'number:-0';
	return `number:${String(value)}`;
}

/**
 * Deterministic serialization for domain data. Object keys are sorted and all
 * JavaScript primitive types receive explicit tags, avoiding JSON's undefined
 * and special-number ambiguities.
 */
export function stableSerialize(value: unknown): string {
	const ancestors = new Set<object>();

	const visit = (current: unknown): string => {
		if (current === null) return 'null';

		switch (typeof current) {
			case 'undefined':
				return 'undefined';
			case 'boolean':
				return `boolean:${String(current)}`;
			case 'number':
				return serializeNumber(current);
			case 'bigint':
				return `bigint:${current.toString(10)}`;
			case 'string':
				return `string:${JSON.stringify(current)}`;
			case 'symbol':
			case 'function':
				throw new TypeError(`Cannot fingerprint a ${typeof current} value.`);
			case 'object': {
				if (ancestors.has(current)) {
					throw new TypeError('Cannot fingerprint a circular value.');
				}
				ancestors.add(current);
				try {
					if (Array.isArray(current)) {
						return `array:[${current.map((item) => visit(item)).join(',')}]`;
					}

					const record = current as Record<string, unknown>;
					const entries = Object.keys(record)
						.sort((left, right) =>
							left < right ? -1 : left > right ? 1 : 0,
						)
						.map(
							(key) => `${JSON.stringify(key)}:${visit(record[key])}`,
						);
					return `object:{${entries.join(',')}}`;
				} finally {
					ancestors.delete(current);
				}
			}
		}

		throw new TypeError('Cannot fingerprint this value.');
	};

	return visit(value);
}

function fnv1a32(input: string, seed: number): number {
	let hash = seed >>> 0;
	for (let index = 0; index < input.length; index += 1) {
		const codeUnit = input.charCodeAt(index);
		hash ^= codeUnit & 0xff;
		hash = Math.imul(hash, 0x01000193);
		hash ^= codeUnit >>> 8;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function toHex(value: number): string {
	return value.toString(16).padStart(8, '0');
}

/**
 * A synchronous, mobile-safe content fingerprint. This intentionally uses no
 * Node or Web Crypto APIs; two independently-seeded FNV-1a passes provide a
 * compact stable change detector (not a cryptographic signature).
 */
export function fingerprint(value: unknown): string {
	const serialized = stableSerialize(value);
	const first = fnv1a32(serialized, 0x811c9dc5);
	const second = fnv1a32(serialized, 0x9e3779b9);
	return `fp1-${toHex(first)}${toHex(second)}`;
}

export const fingerprintContent = fingerprint;
