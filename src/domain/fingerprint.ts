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

function toHex(value: number): string {
	return value.toString(16).padStart(8, '0');
}

/**
 * A synchronous, mobile-safe content fingerprint. This intentionally uses no
 * Node or Web Crypto APIs; two independently-seeded FNV-1a passes provide a
 * compact stable change detector (not a cryptographic signature).
 *
 * The two passes are made in one walk of the text, each code unit read once
 * and fed to both: the values are the ones two separate walks gave, which
 * matters, since notes keep the fingerprints they were reviewed at.
 */
export function fingerprint(value: unknown): string {
	const serialized = stableSerialize(value);
	let first = 0x811c9dc5;
	let second = 0x9e3779b9;
	for (let index = 0; index < serialized.length; index += 1) {
		const codeUnit = serialized.charCodeAt(index);
		const low = codeUnit & 0xff;
		const high = codeUnit >>> 8;
		first ^= low;
		first = Math.imul(first, 0x01000193);
		first ^= high;
		first = Math.imul(first, 0x01000193);
		second ^= low;
		second = Math.imul(second, 0x01000193);
		second ^= high;
		second = Math.imul(second, 0x01000193);
	}
	return `fp1-${toHex(first >>> 0)}${toHex(second >>> 0)}`;
}

export const fingerprintContent = fingerprint;
