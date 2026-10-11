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
