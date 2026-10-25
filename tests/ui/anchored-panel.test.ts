// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { placePanel } from '../../src/ui/anchored-panel';
import { installObsidianDom } from '../helpers/obsidian-dom';

/**
 * A panel hung under a button is placed by arithmetic on the desktop and by
 * the stylesheet on a phone, where it is a sheet at the foot of the screen:
 * a top and left written there would pull it back under the button.
 */
describe('placePanel', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	afterEach(() => {
		document.body.classList.remove('is-phone');
		document.body.replaceChildren();
	});

	function hang(): { panel: HTMLElement; anchor: HTMLElement } {
		const anchor = document.body.createEl('button');
		const panel = document.body.createDiv();
		return { panel, anchor };
	}

	it('writes a top and a left on the desktop', () => {
		const { panel, anchor } = hang();
		placePanel(panel, anchor, window);
		expect(panel.style.top).toMatch(/px$/u);
		expect(panel.style.left).toMatch(/px$/u);
	});

	it('leaves a phone’s sheet to the stylesheet, clearing what an earlier placing wrote', () => {
		const { panel, anchor } = hang();
		placePanel(panel, anchor, window);
		document.body.classList.add('is-phone');
		placePanel(panel, anchor, window);
		expect(panel.style.top).toBe('');
		expect(panel.style.left).toBe('');
	});
});
