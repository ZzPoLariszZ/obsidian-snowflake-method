import { describe, expect, it } from 'vitest';

import type { MentionAggregate } from '../../src/services';
import {
	mentionEntityRows,
	sensitiveTermRows,
	truncateMiddle,
} from '../../src/ui/mention-rows';

const entity = (
	memberName: string,
	total: number,
): MentionAggregate['entities'][number] => ({
	memberPath: `Demo/20_Character/${memberName}.md`,
	memberName,
	total,
	linked: 0,
	unlinked: total,
	first: null,
	last: null,
	occurrences: [],
});

const aggregate: MentionAggregate = {
	entities: [entity('Alice', 3), entity('Bob', 18), entity('小艾', 3)],
	unresolved: [],
};

describe('mention entity rows', () => {
	it('orders by mentions, name breaking the tie', () => {
		expect(
			mentionEntityRows(aggregate, '').map((row) => row.memberName),
		).toEqual(['Bob', 'Alice', '小艾']);
	});

	it('narrows by name, case set aside', () => {
		expect(
			mentionEntityRows(aggregate, 'ali').map((row) => row.memberName),
		).toEqual(['Alice']);
		expect(
			mentionEntityRows(aggregate, '小').map((row) => row.memberName),
		).toEqual(['小艾']);
	});

	it('reads nothing from nothing', () => {
		expect(mentionEntityRows(null, 'x')).toEqual([]);
	});
});

describe('sensitive rows and truncation', () => {
	it('orders terms by findings, quiet terms still listed', () => {
		const rows = sensitiveTermRows([
			{ term: 'blast', total: 0, occurrences: [] },
			{ term: 'damn', total: 4, occurrences: [] },
			{ term: 'ash', total: 4, occurrences: [] },
		]);
		expect(rows.map((row) => row.term)).toEqual(['ash', 'damn', 'blast']);
		expect(sensitiveTermRows(null)).toEqual([]);
	});

	it('cuts a long speech in the middle, both quote marks surviving', () => {
		expect(truncateMiddle('「短句」', 10)).toBe('「短句」');
		const long = `「${'长'.repeat(40)}」`;
		const cut = truncateMiddle(long, 21);
		expect(cut.length).toBeLessThanOrEqual(21);
		expect(cut.startsWith('「')).toBe(true);
		expect(cut.endsWith('」')).toBe(true);
		expect(cut).toContain('…');
		expect(truncateMiddle('a  b\n\nc', 10)).toBe('a b c');
	});
});
