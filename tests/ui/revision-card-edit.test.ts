// @vitest-environment happy-dom

import { beforeAll, describe, expect, it } from 'vitest';

import { captureRevision } from '../../src/domain';
import { EDITING_CARD_CLASS, renderRevisionRail } from '../../src/ui/revision-cards';
import { installObsidianDom } from '../helpers/obsidian-dom';

/**
 * A card with a form open in it is marked for the stylesheet, which keeps
 * it in view when a tight pane holds the other cards back, as it keeps the
 * proposal being written.
 */
describe('a standing card with its form open', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	it('wears the editing mark while the form stands, and only then', () => {
		const content = document.body.createDiv({ cls: 'view-content' });
		const segment = content.createDiv({ cls: 'snowflake-method-segment' });
		const body = 'The grey heron stood in the shallows, watching the water.';
		const revision = captureRevision('50/one.md', body, 'replace', 4, 14, 'x', 'why', 'rev-1', 7);
		const rail = renderRevisionRail(segment, {
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
		rail.sync({
			entries: [{ revision, top: 10 }],
			conflicts: [],
			draft: null,
			readOnly: false,
			foreshadowing: { entries: [], unresolved: [] },
		});
		const card = rail.cardFor('rev-1') as HTMLElement;
		const press = (label: string): void => {
			const button = Array.from(card.querySelectorAll('button')).find((one) => one.textContent === label);
			button?.click();
		};
		expect(card.classList.contains(EDITING_CARD_CLASS)).toBe(false);
		press('actions.edit');
		expect(rail.editing()).toBe(true);
		expect(card.classList.contains(EDITING_CARD_CLASS)).toBe(true);
		// The pane turns tight: the card with its form open is not one held back.
		content.addClass('is-revision-tight');
		const held = '.is-revision-tight .snowflake-method-rail-card:not(.is-draft):not(.is-editing)';
		expect(card.matches(held)).toBe(false);
		press('common.cancel');
		expect(rail.editing()).toBe(false);
		expect(card.classList.contains(EDITING_CARD_CLASS)).toBe(false);
		expect(card.matches(held)).toBe(true);
		rail.dispose();
	});
});

/**
 * A change of the interface language finds the margin's cards standing, one
 * of them perhaps with a form open and words typed into it.
 */
describe('the rail through a change of language', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	it('draws its resting cards again in the new words and leaves an open form as typed', () => {
		let language = 'en';
		const segment = document.body.createDiv({ cls: 'snowflake-method-segment' });
		const body = 'The grey heron stood in the shallows, watching the water.';
		const open = captureRevision('50/one.md', body, 'replace', 4, 14, 'x', 'why', 'rev-1', 7);
		const resting = captureRevision('50/one.md', body, 'replace', 27, 35, 'y', '', 'rev-2', 8);
		const rail = renderRevisionRail(segment, {
			t: (key: string) => `${language}:${key}`,
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
		rail.sync({
			entries: [
				{ revision: open, top: 10 },
				{ revision: resting, top: 200 },
			],
			conflicts: [],
			draft: null,
			readOnly: false,
			foreshadowing: { entries: [], unresolved: [] },
		});
		const words = (card: HTMLElement | null): string[] =>
			Array.from(card?.querySelectorAll('button') ?? []).map((button) => button.textContent ?? '');
		const editing = rail.cardFor('rev-1') as HTMLElement;
		Array.from(editing.querySelectorAll('button')).find((one) => one.textContent === 'en:actions.edit')?.click();
		const box = editing.querySelector<HTMLTextAreaElement>('textarea');
		if (box === null) throw new Error('the form has no box');
		box.value = 'half a thought';
		const standing = rail.cardFor('rev-2');
		expect(words(standing)).toContain('en:actions.edit');

		language = 'fr';
		rail.relabel();

		// The resting card is the same card, saying its words in French.
		expect(rail.cardFor('rev-2')).toBe(standing);
		expect(words(standing)).toContain('fr:actions.edit');
		expect(words(standing)).not.toContain('en:actions.edit');
		// The open form holds the only copy of what was typed: left whole.
		expect(rail.editing()).toBe(true);
		expect(rail.cardFor('rev-1')).toBe(editing);
		expect(editing.querySelector('textarea')).toBe(box);
		expect(box.value).toBe('half a thought');
		rail.dispose();
	});
});

