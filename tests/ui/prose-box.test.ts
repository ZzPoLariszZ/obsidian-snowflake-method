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

	it('follows another box node for node, keeping the text node it already has', () => {
		const typedIn = new ProseBox(document.body.createDiv(), { label: 'a', placeholder: 'p', value: 'orig' });
		const follower = new ProseBox(document.body.createDiv(), { label: 'a', placeholder: 'p', value: 'orig' });
		const own = follower.el.firstChild;
		(typedIn.el.firstChild as Text).appendData('AB');
		follower.follow(typedIn);
		expect(follower.value).toBe('origAB');
		expect(Array.from(follower.el.childNodes)).toEqual([own]);
	});

	it('puts back its very copies when the other box gets its nodes back, as an Undo does', () => {
		const typedIn = new ProseBox(document.body.createDiv(), { label: 'a', placeholder: 'p' });
		const follower = new ProseBox(document.body.createDiv(), { label: 'a', placeholder: 'p' });
		// Enter splits the words into nodes of their own.
		const lines = [document.createTextNode('alpha'), document.createTextNode('\n'), document.createTextNode('beta')];
		typedIn.el.replaceChildren(...lines);
		follower.follow(typedIn);
		const copies = Array.from(follower.el.childNodes);
		expect(follower.value).toBe('alpha\nbeta');
		// Everything selected and typed over: one new node in their place.
		typedIn.el.replaceChildren(document.createTextNode('Q'));
		follower.follow(typedIn);
		expect(follower.value).toBe('Q');
		// Undone: the browser puts its own nodes back, and the copies come back with them.
		typedIn.el.replaceChildren(...lines);
		follower.follow(typedIn);
		expect(Array.from(follower.el.childNodes)).toEqual(copies);
		expect(follower.value).toBe('alpha\nbeta');
	});

	it('takes a box drawn since into the families its words already have, keeping their nodes', () => {
		const first = new ProseBox(document.body.createDiv(), { label: 'a', placeholder: 'p', value: 'orig' });
		const second = new ProseBox(document.body.createDiv(), { label: 'a', placeholder: 'p', value: 'orig' });
		second.follow(first);
		const kept = [first.el.firstChild, second.el.firstChild];
		// A third box, drawn afresh from the same words, typed in before anything copied it.
		const third = new ProseBox(document.body.createDiv(), { label: 'a', placeholder: 'p', value: 'orig' });
		(third.el.firstChild as Text).appendData('CD');
		first.follow(third);
		second.follow(third);
		expect([first.el.firstChild, second.el.firstChild]).toEqual(kept);
		expect([first.value, second.value]).toEqual(['origCD', 'origCD']);
	});

	it('copies breaks as breaks, and sets words whole past anything else', () => {
		const typedIn = new ProseBox(document.body.createDiv(), { label: 'a', placeholder: 'p' });
		const follower = new ProseBox(document.body.createDiv(), { label: 'a', placeholder: 'p' });
		typedIn.el.append('first', typedIn.el.createEl('br'), 'second');
		follower.follow(typedIn);
		expect(Array.from(follower.el.childNodes).map((node) => node.nodeName)).toEqual(['#text', 'BR', '#text']);
		expect(follower.value).toBe('first\nsecond');
		typedIn.el.createDiv({ text: 'nested' });
		follower.follow(typedIn);
		expect(follower.value).toBe(typedIn.value);
	});
});
