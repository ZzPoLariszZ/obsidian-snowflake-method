// @vitest-environment happy-dom

import { beforeAll, describe, expect, it } from 'vitest';

import { captureRevision } from '../../src/domain';
import {
	renderRevisionRail,
	type RevisionRailCallbacks,
	type RevisionRailModel,
} from '../../src/ui/revision-cards';
import { installObsidianDom } from '../helpers/obsidian-dom';

const BODY = 'The grey heron stood in the shallows, watching the water.';

const callbacks = (): RevisionRailCallbacks => ({
	t: (key: string) => key,
	onAccept: () => undefined,
	onRetire: () => undefined,
	onEditSave: () => Promise.resolve(true),
	onDraftSave: () => Promise.resolve(true),
	onDraftCancel: () => undefined,
	hasNeighbour: () => false,
	onJump: () => undefined,
	foreshadowing: {
		onEditSave: () => Promise.resolve(true),
		onDelete: () => undefined,
		onOpen: () => undefined,
		hasNeighbour: () => false,
		onJump: () => undefined,
	},
});

const first = captureRevision('50/one.md', BODY, 'replace', 4, 14, 'x', 'why', 'rev-1', 7);
const second = captureRevision('50/one.md', BODY, 'replace', 30, 38, 'y', '', 'rev-2', 7);
const lost = captureRevision('50/one.md', BODY, 'replace', 40, 45, 'z', '', 'rev-3', 7);

/** Two standing cards at the tops given, and a conflict pinned at the head. */
const model = (tops: [number, number]): RevisionRailModel => ({
	entries: [
		{ revision: first, top: tops[0] },
		{ revision: second, top: tops[1] },
	],
	conflicts: [lost],
	draft: null,
	readOnly: false,
	foreshadowing: { entries: [], unresolved: [] },
});

const keysIn = (host: HTMLElement): (string | null)[] =>
	[...host.querySelectorAll('.snowflake-method-rail-card')].map((card) =>
		card.getAttribute('data-snowflake-method-card'),
	);

describe('the rail as a list', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	it('stands the cards in the flow in the margin’s order, the pinned first', () => {
		const host = document.body.createDiv();
		const located: string[] = [];
		const rail = renderRevisionRail(host, callbacks(), {
			layout: 'list',
			locate: { label: 'marginCards.show', act: (key) => located.push(key) },
		});
		rail.sync({
			...model([300, 10]),
			draft: {
				path: '50/one.md',
				kind: 'insert',
				from: 2,
				to: 2,
				originalText: '',
				before: 'Th',
				after: 'e grey',
				top: 5,
			},
		});
		expect(host.querySelector('.snowflake-method-revision-rail')?.classList.contains('is-list')).toBe(true);
		expect(keysIn(host)).toEqual(['conflict:rev-3', 'rev-2', 'rev-1']);
		// No top to glide to, and no draft: the proposal being written stays
		// with the stream.
		const cards = [...host.querySelectorAll<HTMLElement>('.snowflake-method-rail-card')];
		expect(cards.every((card) => card.style.top === '')).toBe(true);
		expect(host.querySelector('.is-draft')).toBeNull();
		// Each card's compass leads with the way to its words.
		const locate = rail.cardFor('rev-1')?.querySelector<HTMLButtonElement>('.snowflake-method-rail-locate');
		expect(locate?.getAttribute('aria-label')).toBe('marginCards.show');
		expect(locate?.parentElement?.classList.contains('snowflake-method-rail-nav')).toBe(true);
		expect(locate?.parentElement?.firstElementChild).toBe(locate);
		locate?.click();
		expect(located).toEqual(['rev-1']);
		// The order follows the words as they move, and the visitor sees
		// every card by its key.
		rail.sync(model([10, 300]));
		expect(keysIn(host)).toEqual(['conflict:rev-3', 'rev-1', 'rev-2']);
		const seen: string[] = [];
		rail.each((key) => seen.push(key));
		expect(seen.sort()).toEqual(['conflict:rev-3', 'rev-1', 'rev-2']);
		rail.dispose();
	});

	it('holds the order while a form is open, and takes it up once the form closes', () => {
		const host = document.body.createDiv();
		const rail = renderRevisionRail(host, callbacks(), { layout: 'list' });
		rail.sync(model([10, 300]));
		const card = rail.cardFor('rev-1') as HTMLElement;
		const press = (label: string): void => {
			[...card.querySelectorAll('button')].find((one) => one.textContent === label)?.click();
		};
		press('actions.edit');
		expect(rail.editing()).toBe(true);
		rail.sync(model([300, 10]));
		expect(keysIn(host)).toEqual(['conflict:rev-3', 'rev-1', 'rev-2']);
		press('common.cancel');
		expect(rail.editing()).toBe(false);
		expect(keysIn(host)).toEqual(['conflict:rev-3', 'rev-2', 'rev-1']);
		rail.dispose();
	});
});
