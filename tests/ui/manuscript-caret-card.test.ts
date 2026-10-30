// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import { SnowflakeManuscriptView } from '../../src/ui/manuscript-view';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return { ...runtime, ItemView: class {} };
});

/**
 * The view's caret following over its prototype: one chapter whose editor
 * answers for the caret, dressed with a revision and an occurrence.
 */
const follower = (): { told: (string | null)[]; at: { head: number }; follow: () => void } => {
	const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
	const told: (string | null)[] = [];
	const at = { head: 0 };
	Object.assign(view, {
		caretCard: null,
		mounted: new Map([
			[
				'50/one.md',
				{
					editor: { cursor: () => at.head },
					mentions: {
						revisions: { anchors: new Map([['rev-1', { from: 4, to: 14 }]]) },
						foreshadowing: { anchors: new Map([['occ-1', { from: 20, to: 30 }]]) },
					},
				},
			],
		]),
		host: { marginCards: { caret: (key: string | null) => told.push(key) } },
	});
	return {
		told,
		at,
		follow: () => {
			(view as unknown as { followCaret: (path: string) => void }).followCaret('50/one.md');
		},
	};
};

describe('the caret’s card', () => {
	it('is told to the sidebar once per change, by the key its card wears', () => {
		const { told, at, follow } = follower();
		at.head = 7;
		follow();
		at.head = 14;
		follow();
		expect(told).toEqual(['rev-1']);
		at.head = 25;
		follow();
		expect(told).toEqual(['rev-1', 'fs:occ-1']);
		at.head = 50;
		follow();
		at.head = 51;
		follow();
		expect(told).toEqual(['rev-1', 'fs:occ-1', null]);
	});

	it('is nothing in a chapter that is not being written, or that is not on the page', () => {
		const { told, at, follow } = follower();
		at.head = 7;
		follow();
		const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
		const elsewhere: (string | null)[] = [];
		Object.assign(view, {
			caretCard: 'rev-1',
			mounted: new Map([['50/one.md', { editor: null, mentions: null }]]),
			host: { marginCards: { caret: (key: string | null) => elsewhere.push(key) } },
		});
		(view as unknown as { followCaret: (path: string) => void }).followCaret('50/one.md');
		(view as unknown as { followCaret: (path: string) => void }).followCaret('50/two.md');
		expect(told).toEqual(['rev-1']);
		expect(elsewhere).toEqual([null]);
	});
});
