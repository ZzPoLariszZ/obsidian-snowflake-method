// @vitest-environment happy-dom

import { beforeAll, describe, expect, it } from 'vitest';

import { PROSE_BOX_CLASS, ProseBox, isProseBox, proseBoxText } from '../../src/ui/prose-box';
import { installObsidianDom } from '../helpers/obsidian-dom';

/**
 * The editable block that stands in for a textarea: its value read off
 * the nodes the browser leaves, its emptiness kept honest for the
 * placeholder, and its disabled state told to the browser and the reader.
 */
describe('ProseBox', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	it('stands as an editable plain-text block with its name and placeholder', () => {
		const box = new ProseBox(document.body.createDiv(), {
			cls: 'extra',
			label: 'Plot synopsis',
			placeholder: 'Write it here.',
			value: 'one\n\ntwo',
		});
		expect(box.el.classList.contains(PROSE_BOX_CLASS)).toBe(true);
		expect(box.el.classList.contains('extra')).toBe(true);
		expect(box.el.getAttribute('contenteditable')).toBe('plaintext-only');
		expect(box.el.getAttribute('role')).toBe('textbox');
		expect(box.el.getAttribute('aria-label')).toBe('Plot synopsis');
		expect(box.el.dataset.placeholder).toBe('Write it here.');
		expect(box.value).toBe('one\n\ntwo');
		expect(isProseBox(box.el)).toBe(true);
		expect(isProseBox(document.body.createDiv())).toBe(false);
		expect(isProseBox(null)).toBe(false);
	});

	it('reads breaks the browser put in as elements, and empties itself for the placeholder', () => {
		const box = new ProseBox(document.body.createDiv(), { label: 'a', placeholder: 'p' });
		box.el.append('first', box.el.createEl('br'), 'second');
		const nested = box.el.createDiv();
		nested.textContent = 'Third';
		expect(box.value).toBe('first\nsecond\nThird');
		expect(proseBoxText(box.el)).toBe(box.value);

		box.el.replaceChildren(box.el.createEl('br'));
		box.el.dispatchEvent(new Event('input'));
		expect(box.el.childNodes.length).toBe(0);
		expect(box.value).toBe('');
		box.value = '';
		expect(box.el.matches(':empty')).toBe(true);
	});

	it('tells the browser and the reader when it is disabled', () => {
		const box = new ProseBox(document.body.createDiv(), { label: 'a', placeholder: 'p', disabled: true });
		expect(box.disabled).toBe(true);
		expect(box.el.getAttribute('contenteditable')).toBe('false');
		expect(box.el.getAttribute('aria-disabled')).toBe('true');
		expect(box.el.classList.contains('is-disabled')).toBe(true);
		box.disabled = false;
		expect(box.el.getAttribute('contenteditable')).toBe('plaintext-only');
		expect(box.el.classList.contains('is-disabled')).toBe(false);
	});
});
