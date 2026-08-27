/**
 * Aho-Corasick over plain strings: every occurrence of every pattern in one
 * pass, whatever the pattern count. This layer knows nothing about entities,
 * words, cases or links -- a pattern is a string and a payload is whatever
 * the caller ties to it -- so the same matcher serves entity mentions today
 * and user-registered text later without changing shape.
 *
 * Matching runs over UTF-16 code units, which is also how offsets are
 * counted everywhere else in the plugin, so a hit's `from`/`to` slice the
 * searched text exactly.
 *
 * Kept free of Obsidian types and of the DOM.
 */

export interface PatternEntry<P> {
	pattern: string;
	payload: P;
}

export interface PatternHit<P> {
	/** Absolute offsets: `base` is already added in. */
	from: number;
	to: number;
	pattern: string;
	/**
	 * Every payload registered for this exact string, one shared list per
	 * pattern. Read-only by contract: a caller that filters it copies first.
	 */
	payloads: readonly P[];
}

export interface PatternMatcher<P> {
	/** How many distinct pattern strings the automaton carries. */
	readonly patternCount: number;
	findAll(text: string, base: number): PatternHit<P>[];
}

interface TrieNode {
	next: Map<number, number>;
	fail: number;
	/** Ids of the patterns that end at this node, fail-chain outputs merged. */
	out: number[];
}

/**
 * Builds the goto/fail/output automaton once; `findAll` then costs the text
 * plus the hits, however many patterns there are. Entries sharing one exact
 * string share one pattern and carry all their payloads together; an empty
 * pattern matches nowhere and is skipped.
 */
export function buildPatternMatcher<P>(
	entries: readonly PatternEntry<P>[],
): PatternMatcher<P> {
	const payloadsOf = new Map<string, P[]>();
	for (const entry of entries) {
		if (entry.pattern.length === 0) continue;
		const kept = payloadsOf.get(entry.pattern);
		if (kept === undefined) payloadsOf.set(entry.pattern, [entry.payload]);
		else kept.push(entry.payload);
	}
	const patterns = [...payloadsOf.keys()];
	const payloads = patterns.map((pattern) => payloadsOf.get(pattern) ?? []);

	const nodes: TrieNode[] = [{ next: new Map(), fail: 0, out: [] }];
	patterns.forEach((pattern, id) => {
		let at = 0;
		for (let index = 0; index < pattern.length; index += 1) {
			const unit = pattern.charCodeAt(index);
			let follow = nodes[at]?.next.get(unit);
			if (follow === undefined) {
				follow = nodes.length;
				nodes.push({ next: new Map(), fail: 0, out: [] });
				nodes[at]?.next.set(unit, follow);
			}
			at = follow;
		}
		nodes[at]?.out.push(id);
	});

	// Fail links breadth-first, outputs merged along them as they are set, so
	// a match inside a longer pattern's path is still reported.
	const queue: number[] = [...(nodes[0]?.next.values() ?? [])];
	for (let head = 0; head < queue.length; head += 1) {
		const at = queue[head] as number;
		const node = nodes[at] as TrieNode;
		for (const [unit, follow] of node.next) {
			queue.push(follow);
			let fail = node.fail;
			while (fail !== 0 && !nodes[fail]?.next.has(unit)) {
				fail = nodes[fail]?.fail ?? 0;
			}
			const child = nodes[follow] as TrieNode;
			child.fail = nodes[fail]?.next.get(unit) ?? 0;
			child.out.push(...(nodes[child.fail]?.out ?? []));
		}
	}

	return {
		patternCount: patterns.length,
		findAll(text: string, base: number): PatternHit<P>[] {
			const hits: PatternHit<P>[] = [];
			let state = 0;
			for (let index = 0; index < text.length; index += 1) {
				const unit = text.charCodeAt(index);
				while (state !== 0 && !nodes[state]?.next.has(unit)) {
					state = nodes[state]?.fail ?? 0;
				}
				state = nodes[state]?.next.get(unit) ?? 0;
				for (const id of nodes[state]?.out ?? []) {
					const pattern = patterns[id] as string;
					hits.push({
						from: base + index + 1 - pattern.length,
						to: base + index + 1,
						pattern,
						payloads: payloads[id] as readonly P[],
					});
				}
			}
			return hits.sort(
				(left, right) => left.from - right.from || left.to - right.to,
			);
		},
	};
}
