import { describe, expect, it } from 'vitest';

import type { MentionAggregate } from '../../src/services';
import { mentionEntityRows } from '../../src/ui/mention-rows';

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
