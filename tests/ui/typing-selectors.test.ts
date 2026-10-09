// @vitest-environment happy-dom

import { beforeAll, describe, expect, it } from 'vitest';

import { TYPING_SELECTOR } from '../../src/ui/file-explorer-arrange';
import { CANVAS_FIELD_SELECTOR } from '../../src/ui/freeform-canvas-port';
import { installObsidianDom } from '../helpers/obsidian-dom';

/**
 * The two places that tell a key being typed into a field from a key meant
 * for them: the explorer's arrange mode, which leaves on Escape unless a
 * field has the key, and the freeform canvas. Each knows an editable block
 * of every kind -- the plain-text ones the dashboard's steps are written in
 * as well -- and none shown only to be read.
 */
describe('the selectors that tell a field being typed in', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	for (const [name, selector] of [
		['the explorer’s arrange mode', TYPING_SELECTOR],
		['the freeform canvas', CANVAS_FIELD_SELECTOR],
	] as const) {
		it(`${name} knows every editable block and every control, and nothing read-only`, () => {
			const host = document.body.createDiv();
			// The key lands on whatever stands inside the block, as a typed key does.
			const inside = (value: string): HTMLElement => {
				const block = host.createDiv();
				block.setAttribute('contenteditable', value);
				return block.createSpan();
			};
			expect(inside('plaintext-only').closest(selector)).not.toBeNull();
			expect(inside('true').closest(selector)).not.toBeNull();
			expect(inside('').closest(selector)).not.toBeNull();
			expect(inside('false').closest(selector)).toBeNull();
			expect(host.createEl('textarea').closest(selector)).not.toBeNull();
			expect(host.createEl('input').closest(selector)).not.toBeNull();
			expect(host.createEl('select').closest(selector)).not.toBeNull();
			expect(host.createDiv().closest(selector)).toBeNull();
		});
	}
});
