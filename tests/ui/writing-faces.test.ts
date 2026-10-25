// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	TOOLBAR_FACES_CLASS,
	WRITING_FACE_CLASS,
	WritingFaces,
	type WritingFaceKind,
} from '../../src/ui/writing-faces';
import { installObsidianDom } from '../helpers/obsidian-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		setIcon: (el: HTMLElement, icon: string) => {
			el.setAttribute('data-icon', icon);
		},
		setTooltip: (el: HTMLElement, text: string) => {
			el.setAttribute('aria-label', text);
		},
	};
});

describe('WritingFaces', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	let appeared: WritingFaceKind[];
	let countMenus: number;
	let sessionMenus: number;
	let faces: WritingFaces;

	beforeEach(() => {
		document.body.empty();
		appeared = [];
		countMenus = 0;
		sessionMenus = 0;
		faces = new WritingFaces({
			openCountMenu: () => {
				countMenus += 1;
			},
			openSessionMenu: () => {
				sessionMenus += 1;
			},
			appeared: (kind) => {
				appeared.push(kind);
			},
		});
	});

	it('dresses a status bar item as the count, hidden until there is a count', () => {
		const item = document.body.createDiv({ cls: 'status-bar-item' });
		faces.mount(item, 'count', 'status-bar');
		expect(item.className).toBe('status-bar-item snowflake-method-word-count mod-clickable');
		expect(item.querySelector('.snowflake-method-word-count-icon')?.getAttribute('data-icon')).toBe('snowflake');
		expect(item.hidden).toBe(true);
		expect(appeared).toEqual(['count']);
		expect(faces.anyShown('count')).toBe(true);
		expect(faces.anyShown('session')).toBe(false);
		faces.paintCount({ line: '1,204 words', breakdown: 'Chapter: 1,204' });
		expect(item.hidden).toBe(false);
		expect(item.textContent).toBe('1,204 words');
		expect(item.getAttribute('aria-label')).toBe('Chapter: 1,204');
		faces.paintCount(null);
		expect(item.hidden).toBe(true);
		item.click();
		expect(countMenus).toBe(1);
		expect(sessionMenus).toBe(0);
	});

	it('adds a toolbar button as the session face and paints its state', () => {
		const bar = document.body.createDiv({ cls: TOOLBAR_FACES_CLASS });
		faces.mount(bar, 'session', 'toolbar');
		const button = bar.querySelector<HTMLButtonElement>('button');
		expect(button?.className).toBe(
			`clickable-icon snowflake-method-toolbar-button ${WRITING_FACE_CLASS} is-session snowflake-method-session`,
		);
		expect(button?.getAttribute('type')).toBe('button');
		expect(button?.querySelector('.snowflake-method-session-icon')?.getAttribute('data-icon')).toBe('clock');
		expect(appeared).toEqual(['session']);
		faces.paintSession({ icon: 'timer', line: '24:59', tooltip: 'Countdown · running', paused: false, idle: true, break: false });
		expect(button?.querySelector('.snowflake-method-session-icon')?.getAttribute('data-icon')).toBe('timer');
		expect(button?.textContent).toBe('24:59');
		expect(button?.classList.contains('is-idle')).toBe(true);
		expect(button?.classList.contains('is-paused')).toBe(false);
		expect(button?.getAttribute('aria-label')).toBe('Countdown · running');
		button?.click();
		expect(sessionMenus).toBe(1);
	});

	it('gives a face mounted later the look already painted', () => {
		faces.paintCount({ line: '12 words', breakdown: 'Scene: 12' });
		faces.paintSession({ icon: 'clock', line: '00:10', tooltip: 'Stopwatch', paused: true, idle: false, break: false });
		const bar = document.body.createDiv();
		faces.mount(bar, 'count', 'toolbar');
		faces.mount(bar, 'session', 'toolbar');
		const [count, session] = [...bar.querySelectorAll('button')];
		expect(count?.hidden).toBe(false);
		expect(count?.textContent).toBe('12 words');
		expect(session?.textContent).toBe('00:10');
		expect(session?.classList.contains('is-paused')).toBe(true);
		expect(appeared).toEqual(['count', 'session']);
	});

	it('paints every face alike and forgets a released one', () => {
		const item = document.body.createDiv();
		const bar = document.body.createDiv();
		const releaseItem = faces.mount(item, 'count', 'status-bar');
		const releaseButton = faces.mount(bar, 'count', 'toolbar');
		faces.paintCount({ line: '3 words', breakdown: 'Scene: 3' });
		expect(item.textContent).toBe('3 words');
		expect(bar.querySelector('button')?.textContent).toBe('3 words');
		releaseButton();
		expect(bar.querySelector('button')).toBeNull();
		expect(faces.anyShown('count')).toBe(true);
		faces.paintCount({ line: '4 words', breakdown: 'Scene: 4' });
		expect(item.textContent).toBe('4 words');
		releaseItem();
		releaseItem();
		expect(faces.anyShown('count')).toBe(false);
		// A status bar item is the app's to remove; the face only lets go of it.
		expect(item.isConnected).toBe(true);
		item.click();
		expect(countMenus).toBe(0);
	});

	it('counts a face off the page as not shown', () => {
		const bar = document.body.createDiv();
		faces.mount(bar, 'session', 'toolbar');
		expect(faces.anyShown('session')).toBe(true);
		bar.remove();
		expect(faces.anyShown('session')).toBe(false);
	});
});
