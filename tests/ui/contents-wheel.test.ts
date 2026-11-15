// @vitest-environment happy-dom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContentsRow } from '../../src/ui/contents-hub';
import {
	CONTENTS_QUIET_MS,
	CONTENTS_REST_MS,
	contentsRows,
	renderContentsWheel,
	type ContentsWheel,
} from '../../src/ui/contents-wheel';
import { installObsidianDom } from '../helpers/obsidian-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		setTooltip: (el: HTMLElement, text: string, options?: { placement?: string }) => {
			el.setAttribute('data-tooltip', text);
			el.setAttribute('data-tooltip-side', options?.placement ?? '');
		},
		setIcon: (el: HTMLElement, icon: string) => {
			el.setAttribute('data-icon', icon);
		},
	};
});

/** One row's height in the layout the tests stand in for. */
const PITCH = 28;

/** Whether the wheel has a layout: a wheel in a drawer put away has none. */
let laidOut = true;

const chapters = (count: number): ContentsRow[] =>
	Array.from({ length: count }, (_, at) => ({
		path: `Novel/50_Manuscript/Chapter ${String(at + 1)}.md`,
		title: `Chapter ${String(at + 1)}`,
	}));

interface Mounted {
	wheel: ContentsWheel;
	list: HTMLElement;
	/** Every chapter the wheel asked the page to go to. */
	went: string[];
	/** Every move of the wheel's own making: where to, and whether it glided. */
	turns: { top: number; behavior: string }[];
	/** How many times the keys were handed back. */
	left: { count: number };
	/** What was asked of a chapter itself: its menu, a new name, its deletion. */
	asked: string[];
	items: () => HTMLButtonElement[];
	held: () => boolean;
}

/** How long the tests' wheels stand still before they are looked at, in place of the real moment. */
const QUIET = 8;

const mount = (
	options: {
		still?: boolean;
		leave?: boolean;
		rest?: number;
		quiet?: number;
		/** Whether rows offer their menu and the two keys. */
		acts?: boolean;
		/** Whether a pointer can rest over a row: a mouse's screen unless a test says a finger's. */
		hovers?: boolean;
	} = {},
): Mounted => {
	const host = document.body.createDiv();
	const went: string[] = [];
	const left = { count: 0 };
	const asked: string[] = [];
	const wheel = renderContentsWheel(host, {
		t: (key) => key,
		go: (path) => {
			went.push(path);
		},
		still: () => options.still === true,
		...(options.leave === true
			? {
					leave: () => {
						left.count += 1;
					},
				}
			: {}),
		...(options.rest === undefined ? {} : { rest: options.rest }),
		...(options.acts === true
			? {
					menu: (path: string) => {
						asked.push(`menu ${path}`);
					},
					rename: (path: string) => {
						asked.push(`rename ${path}`);
					},
					remove: (path: string) => {
						asked.push(`remove ${path}`);
					},
				}
			: {}),
		quiet: options.quiet ?? QUIET,
		hovers: options.hovers ?? true,
	});
	const list = wheel.el.querySelector<HTMLElement>('.snowflake-method-contents-list');
	if (list === null) throw new Error('the wheel has no list');
	const turns: Mounted['turns'] = [];
	list.scrollTo = ((to: ScrollToOptions) => {
		turns.push({ top: to.top ?? 0, behavior: to.behavior ?? 'auto' });
		list.scrollTop = to.top ?? 0;
	}) as typeof list.scrollTo;
	const items = (): HTMLButtonElement[] => [
		...list.querySelectorAll<HTMLButtonElement>('.snowflake-method-contents-item'),
	];
	return {
		wheel,
		list,
		went,
		turns,
		left,
		asked,
		items,
		held: () => wheel.el.contains(document.activeElement),
	};
};

/** A pointer coming to the wheel, moving on it or leaving it; the kind of pointer is the whole of what is read. */
const pointer = (
	type: 'pointerenter' | 'pointermove' | 'pointerleave',
	pointerType: string,
): Event => Object.assign(new Event(type), { pointerType });

/** A turn of the mouse wheel, saying where the pointer is as a real one does. */
const turn = (at: { x: number; y: number } = { x: -1, y: -1 }): Event =>
	new MouseEvent('wheel', { bubbles: true, clientX: at.x, clientY: at.y });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const key = (name: string, extra: KeyboardEventInit = {}): KeyboardEvent =>
	new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra });

const stops = (items: readonly HTMLButtonElement[]): number[] =>
	items.flatMap((item, at) => (item.getAttribute('tabindex') === '0' ? [at] : []));

describe('the wheel of chapters', () => {
	beforeAll(() => {
		installObsidianDom(window);
		// The rows where a browser would lay them: one pitch apart, moved by
		// the list's own scroll, and nowhere while the wheel is hidden.
		Object.defineProperty(HTMLLIElement.prototype, 'getBoundingClientRect', {
			configurable: true,
			value(this: HTMLLIElement) {
				const list = this.parentElement;
				const at = list === null ? 0 : [...list.children].indexOf(this);
				const top = laidOut && list !== null ? at * PITCH - list.scrollTop : 0;
				const height = laidOut ? PITCH : 0;
				return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top };
			},
		});
	});

	beforeEach(() => {
		laidOut = true;
		document.body.replaceChildren();
	});

	it('shows the chapter in the middle and the reach either side', () => {
		expect(contentsRows(5)).toBe(11);
		expect(contentsRows(0)).toBe(1);
		expect(contentsRows(25)).toBe(51);
		const { wheel } = mount();
		wheel.sync({ rows: chapters(3), active: null, reach: 5 });
		expect(wheel.el.style.getPropertyValue('--snowflake-method-contents-rows')).toBe('11');
		wheel.sync({ rows: chapters(3), active: null, reach: 2 });
		expect(wheel.el.style.getPropertyValue('--snowflake-method-contents-rows')).toBe('5');
	});

	it('is a navigation landmark holding a list of buttons, the page’s chapter the current one', () => {
		const { wheel, list, items } = mount();
		const rows = chapters(4);
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		expect(wheel.el.tagName).toBe('NAV');
		// Named by words of its own, out of sight, and not by a label: the app
		// shows a label as a tooltip to a pointer resting on anything inside.
		expect(wheel.el.hasAttribute('aria-label')).toBe(false);
		const named = wheel.el.getAttribute('aria-labelledby') ?? '';
		expect(document.getElementById(named)?.textContent).toBe('contents.viewTitle');
		expect(document.getElementById(named)?.parentElement).toBe(wheel.el);
		// Two wheels may stand in one window, the margin's and the sidebar's.
		const second = mount().wheel;
		expect(second.el.getAttribute('aria-labelledby')).not.toBe(named);
		expect(list.tagName).toBe('UL');
		expect(list.getAttribute('role')).toBe('list');
		expect([...list.children].map((row) => row.tagName)).toEqual(['LI', 'LI', 'LI', 'LI']);
		expect(items().map((item) => item.textContent)).toEqual([
			'Chapter 1',
			'Chapter 2',
			'Chapter 3',
			'Chapter 4',
		]);
		expect(items().map((item) => item.getAttribute('type'))).toEqual([
			'button',
			'button',
			'button',
			'button',
		]);
		expect(items().map((item) => item.getAttribute('aria-current'))).toEqual([
			null,
			null,
			'true',
			null,
		]);
		expect(items().map((item) => item.classList.contains('is-active'))).toEqual([
			false,
			false,
			true,
			false,
		]);
		// One stop for the Tab key, on the page's chapter.
		expect(stops(items())).toEqual([2]);
	});

	it('stands on the page’s chapter at once when drawn, and glides to the one the page moves to', () => {
		const { wheel, turns } = mount();
		const rows = chapters(30);
		wheel.sync({ rows, active: rows[4]?.path ?? null, reach: 5 });
		expect(turns).toEqual([{ top: 4 * PITCH, behavior: 'instant' }]);
		wheel.sync({ rows, active: rows[5]?.path ?? null, reach: 5 });
		expect(turns[1]).toEqual({ top: 5 * PITCH, behavior: 'smooth' });
		// Nothing moved: nothing turns.
		wheel.sync({ rows, active: rows[5]?.path ?? null, reach: 5 });
		expect(turns).toHaveLength(2);
	});

	it('stands a wheelful short of a chapter far off and glides the rest, from the side it came', () => {
		const { wheel, turns } = mount();
		const rows = chapters(400);
		wheel.sync({ rows, active: rows[5]?.path ?? null, reach: 5 });
		turns.length = 0;
		// Eleven rows show at once: a chapter within that is glided to whole.
		wheel.sync({ rows, active: rows[16]?.path ?? null, reach: 5 });
		expect(turns).toEqual([{ top: 16 * PITCH, behavior: 'smooth' }]);
		turns.length = 0;
		// Three hundred chapters on: stood eleven rows before it, then glided.
		wheel.sync({ rows, active: rows[316]?.path ?? null, reach: 5 });
		expect(turns).toEqual([
			{ top: (316 - 11) * PITCH, behavior: 'instant' },
			{ top: 316 * PITCH, behavior: 'smooth' },
		]);
		turns.length = 0;
		// And back: stood eleven rows after it, so the wheel turns the other way.
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		expect(turns).toEqual([
			{ top: (2 + 11) * PITCH, behavior: 'instant' },
			{ top: 2 * PITCH, behavior: 'smooth' },
		]);
	});

	it('moves at once, with no glide, while the plugin holds its animations still', () => {
		const { wheel, turns } = mount({ still: true });
		const rows = chapters(10);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		wheel.sync({ rows, active: rows[6]?.path ?? null, reach: 5 });
		expect(turns).toEqual([{ top: 6 * PITCH, behavior: 'instant' }]);
	});

	it('draws nothing again while the manuscript keeps its shape', () => {
		const { wheel, items } = mount();
		const rows = chapters(5);
		wheel.sync({ rows, active: rows[1]?.path ?? null, reach: 5 });
		const first = items();
		wheel.sync({ rows, active: rows[3]?.path ?? null, reach: 5 });
		expect(items().every((item, at) => item === first[at])).toBe(true);
	});

	it('keeps every row whose chapter is still in the book when the manuscript changes', () => {
		const { wheel, list, turns, items } = mount();
		const rows = chapters(5);
		wheel.sync({ rows, active: rows[3]?.path ?? null, reach: 5 });
		const first = items();
		const moves: string[] = [];
		const insertBefore = list.insertBefore.bind(list);
		list.insertBefore = <T extends Node>(node: T, before: Node | null): T => {
			moves.push(node.textContent ?? '');
			return insertBefore(node, before);
		};
		// A chapter renamed: its row is reworded where it stands, and the
		// mark and the stop stay with the page's chapter.
		const renamed = rows.map((row, at) => (at === 0 ? { ...row, title: 'Prologue' } : row));
		wheel.sync({ rows: renamed, active: rows[3]?.path ?? null, reach: 5 });
		expect(items().every((item, at) => item === first[at])).toBe(true);
		expect(items()[0]?.textContent).toBe('Prologue');
		expect(items()[3]?.getAttribute('aria-current')).toBe('true');
		expect(stops(items())).toEqual([3]);
		expect(moves).toEqual([]);
		// A chapter added in the middle: one row put in, the others left
		// standing, and the wheel stood on the page's chapter where it is now.
		const added = [
			...renamed.slice(0, 2),
			{ path: 'Novel/50_Manuscript/Interlude.md', title: 'Interlude' },
			...renamed.slice(2),
		];
		wheel.sync({ rows: added, active: rows[3]?.path ?? null, reach: 5 });
		expect(items().map((item) => item.textContent)).toEqual([
			'Prologue',
			'Chapter 2',
			'Interlude',
			'Chapter 3',
			'Chapter 4',
			'Chapter 5',
		]);
		expect([...list.children].map((row) => row.textContent)).toEqual(
			items().map((item) => item.textContent),
		);
		expect(moves).toEqual(['Interlude']);
		expect(items()[0]).toBe(first[0]);
		expect(items()[3]).toBe(first[2]);
		expect(items()[4]?.getAttribute('aria-current')).toBe('true');
		expect(items().filter((item) => item.hasAttribute('aria-current'))).toHaveLength(1);
		expect(stops(items())).toEqual([4]);
		expect(turns[turns.length - 1]).toEqual({ top: 4 * PITCH, behavior: 'instant' });
		// Two chapters taken away, one of them the page's: their rows go, and
		// no row is left wearing the mark.
		const fewer = added.filter((row) => row.title !== 'Chapter 2' && row.title !== 'Chapter 4');
		wheel.sync({ rows: fewer, active: rows[3]?.path ?? null, reach: 5 });
		expect([...list.children].map((row) => row.textContent)).toEqual([
			'Prologue',
			'Interlude',
			'Chapter 3',
			'Chapter 5',
		]);
		expect(items().some((item) => item.hasAttribute('aria-current'))).toBe(false);
		expect(stops(items())).toEqual([0]);
		// Chapters put in another order: the rows are carried, not drawn again.
		const turned = [...fewer].reverse();
		wheel.sync({ rows: turned, active: null, reach: 5 });
		expect([...list.children].map((row) => row.textContent)).toEqual([
			'Chapter 5',
			'Chapter 3',
			'Interlude',
			'Prologue',
		]);
		expect(items()[3]).toBe(first[0]);
	});

	it('moves one row for one chapter moved, whichever way it went', () => {
		const { wheel, list } = mount();
		const rows = chapters(50);
		wheel.sync({ rows, active: null, reach: 5 });
		let moves = 0;
		const insertBefore = list.insertBefore.bind(list);
		list.insertBefore = <T extends Node>(node: T, before: Node | null): T => {
			moves += 1;
			return insertBefore(node, before);
		};
		const appendChild = list.appendChild.bind(list);
		list.appendChild = <T extends Node>(node: T): T => {
			moves += 1;
			return appendChild(node);
		};
		const names = (): (string | null)[] => [...list.children].map((row) => row.textContent);
		// The first chapter moved to the end of the book.
		const [head, ...rest] = rows;
		if (head === undefined) throw new Error('no rows');
		const down = [...rest, head];
		wheel.sync({ rows: down, active: null, reach: 5 });
		expect(names()).toEqual(down.map((row) => row.title));
		expect(moves).toBe(1);
		// And the last one moved to the front.
		moves = 0;
		const up = [head, ...rest];
		wheel.sync({ rows: up, active: null, reach: 5 });
		expect(names()).toEqual(up.map((row) => row.title));
		expect(moves).toBe(1);
		// A chapter renamed on disk is another note at the same place: one
		// row out, one row in, and no other row touched.
		moves = 0;
		const renamed = up.map((row, at) =>
			at === 19 ? { path: 'Novel/50_Manuscript/Chapter 20 renamed.md', title: 'Chapter 20 renamed' } : row,
		);
		wheel.sync({ rows: renamed, active: null, reach: 5 });
		expect(names()).toEqual(renamed.map((row) => row.title));
		expect(moves).toBe(1);
	});

	it('leaves a turn made by hand as it stands when the manuscript changes under it', () => {
		const { wheel, list, turns } = mount();
		const rows = chapters(30);
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		wheel.el.dispatchEvent(pointer('pointerenter', 'mouse'));
		list.dispatchEvent(turn());
		list.scrollTop = 20 * PITCH;
		const before = turns.length;
		const renamed = rows.map((row, at) => (at === 9 ? { ...row, title: 'Renamed' } : row));
		wheel.sync({ rows: renamed, active: rows[2]?.path ?? null, reach: 5 });
		expect(turns).toHaveLength(before);
		expect(list.scrollTop).toBe(20 * PITCH);
	});

	it('drops a reworded row\u2019s old tooltip with its old name', () => {
		const { wheel, items } = mount();
		const rows = chapters(2);
		wheel.sync({ rows, active: null, reach: 5 });
		const long = items()[0];
		if (long === undefined) throw new Error('no rows');
		Object.defineProperty(long, 'scrollWidth', { configurable: true, value: 300 });
		Object.defineProperty(long, 'clientWidth', { configurable: true, value: 244 });
		long.setAttribute('aria-label', 'Chapter 1');
		long.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		expect(long.getAttribute('data-tooltip')).toBe('Chapter 1');
		wheel.sync({
			rows: rows.map((row, at) => (at === 0 ? { ...row, title: 'A much longer name for the first chapter' } : row)),
			active: null,
			reach: 5,
		});
		// The row is the same one, and nothing of the old name speaks for it.
		expect(items()[0]).toBe(long);
		expect(long.hasAttribute('aria-label')).toBe(false);
		long.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		expect(long.getAttribute('data-tooltip')).toBe('A much longer name for the first chapter');
	});

	it('goes to a pressed chapter, marked before the page answers, and stands on it', () => {
		const { wheel, went, turns, items } = mount();
		const rows = chapters(12);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		items()[7]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(went).toEqual([rows[7]?.path]);
		expect(items()[7]?.classList.contains('is-active')).toBe(true);
		expect(items()[0]?.classList.contains('is-active')).toBe(false);
		expect(turns[turns.length - 1]).toEqual({ top: 7 * PITCH, behavior: 'smooth' });
		// The page's answer, when it comes, finds the wheel already there.
		const before = turns.length;
		wheel.sync({ rows, active: rows[7]?.path ?? null, reach: 5 });
		expect(turns).toHaveLength(before);
	});

	it('leaves the keys where they were on a press with the mouse', () => {
		const { wheel, items } = mount();
		const rows = chapters(3);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		items()[1]?.dispatchEvent(press);
		expect(press.defaultPrevented).toBe(true);
	});

	it('only browses while turned by hand, and goes back to the page’s chapter once the pointer has left and it rests', async () => {
		const { wheel, list, went, turns, items } = mount();
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		wheel.el.dispatchEvent(pointer('pointerenter', 'mouse'));
		list.dispatchEvent(turn());
		list.scrollTop = 9 * PITCH;
		const before = turns.length;
		// The page reads on meanwhile: its chapter is marked, and the wheel
		// stays under the hand.
		wheel.sync({ rows, active: rows[3]?.path ?? null, reach: 5 });
		expect(turns).toHaveLength(before);
		expect(items()[3]?.getAttribute('aria-current')).toBe('true');
		expect(went).toEqual([]);
		// However long the pointer rests on it, the wheel is the reader's.
		await sleep(QUIET * 4);
		expect(turns).toHaveLength(before);
		wheel.el.dispatchEvent(pointer('pointerleave', 'mouse'));
		// Not at the very moment of leaving: once it has stood still.
		expect(turns).toHaveLength(before);
		await vi.waitFor(() => {
			expect(turns[turns.length - 1]).toEqual({ top: 3 * PITCH, behavior: 'smooth' });
		});
		// Given back, it follows the page again.
		wheel.sync({ rows, active: rows[4]?.path ?? null, reach: 5 });
		expect(turns[turns.length - 1]).toEqual({ top: 4 * PITCH, behavior: 'smooth' });
	});

	it('waits out a flick that goes on turning the wheel after the pointer has left', async () => {
		expect(CONTENTS_QUIET_MS).toBe(160);
		const { wheel, list, turns } = mount({ quiet: 80 });
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		wheel.el.dispatchEvent(pointer('pointerenter', 'mouse'));
		list.dispatchEvent(turn());
		list.scrollTop = 19 * PITCH;
		const before = turns.length;
		wheel.el.dispatchEvent(pointer('pointerleave', 'mouse'));
		// The flick's turns keep arriving at the wheel, a few milliseconds
		// apart, for longer than the wheel would otherwise wait: a glide begun
		// now would be turned straight back to the end.
		for (let step = 0; step < 12; step += 1) {
			await sleep(10);
			list.dispatchEvent(turn());
			list.dispatchEvent(new Event('scroll'));
			expect(turns).toHaveLength(before);
		}
		// Once it has come to rest, it goes home, and only once.
		await vi.waitFor(() => {
			expect(turns[turns.length - 1]).toEqual({ top: 2 * PITCH, behavior: 'smooth' });
		});
		await sleep(200);
		expect(turns.filter((one) => one.behavior === 'smooth')).toHaveLength(1);
	});

	it('does not take a flick’s late turns for a pointer back over the wheel', async () => {
		const { wheel, list, turns } = mount();
		wheel.el.getBoundingClientRect = () =>
			({ left: 100, right: 360, top: 200, bottom: 508 }) as DOMRect;
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		wheel.el.dispatchEvent(pointer('pointerenter', 'mouse'));
		list.dispatchEvent(turn({ x: 200, y: 300 }));
		list.scrollTop = 19 * PITCH;
		wheel.el.dispatchEvent(pointer('pointerleave', 'mouse'));
		// A turn that says it happened over the wheel, after the pointer left it.
		list.dispatchEvent(turn({ x: 200, y: 300 }));
		await vi.waitFor(() => {
			expect(turns[turns.length - 1]).toEqual({ top: 2 * PITCH, behavior: 'smooth' });
		});
	});

	it('keeps a wheel turned under a pointer that was resting there when it was drawn', async () => {
		const { wheel, list, turns } = mount();
		wheel.el.getBoundingClientRect = () =>
			({ left: 100, right: 360, top: 200, bottom: 508 }) as DOMRect;
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		const before = turns.length;
		// No pointer ever came in: the turn itself says the pointer is here.
		list.dispatchEvent(turn({ x: 200, y: 300 }));
		list.scrollTop = 12 * PITCH;
		list.dispatchEvent(new Event('scroll'));
		await sleep(QUIET * 5);
		expect(turns).toHaveLength(before);
		// And its leaving gives the wheel back, as any pointer's does.
		wheel.el.dispatchEvent(pointer('pointerleave', 'mouse'));
		await vi.waitFor(() => {
			expect(turns[turns.length - 1]).toEqual({ top: 2 * PITCH, behavior: 'smooth' });
		});
	});

	it('gives back a wheel turned with no pointer in sight, once it rests', async () => {
		const { wheel, list, turns } = mount();
		wheel.el.getBoundingClientRect = () =>
			({ left: 100, right: 360, top: 200, bottom: 508 }) as DOMRect;
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		list.dispatchEvent(turn({ x: 900, y: 300 }));
		list.scrollTop = 12 * PITCH;
		await vi.waitFor(() => {
			expect(turns[turns.length - 1]).toEqual({ top: 2 * PITCH, behavior: 'smooth' });
		});
	});

	it('comes back to the page’s chapter when something leaves it at rest elsewhere', async () => {
		const { wheel, list, turns } = mount();
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		const before = turns.length;
		// Out of the reader's hand, and moved all the same: a turn that outran
		// a glide, the browser settling on another row.
		list.scrollTop = 19 * PITCH;
		list.dispatchEvent(new Event('scroll'));
		expect(turns).toHaveLength(before);
		await vi.waitFor(() => {
			expect(turns[turns.length - 1]).toEqual({ top: 2 * PITCH, behavior: 'smooth' });
		});
		// Standing where it should, a movement asks for nothing.
		const settled = turns.length;
		list.dispatchEvent(new Event('scroll'));
		await sleep(QUIET * 4);
		expect(turns).toHaveLength(settled);
		// Half a row off is still that row: the browser brings it to rest there.
		list.scrollTop = 2 * PITCH + PITCH / 2 - 1;
		list.dispatchEvent(new Event('scroll'));
		await sleep(QUIET * 4);
		expect(turns).toHaveLength(settled);
	});

	it('stops sending a wheel back that will not stay, until the page or the reader says something new', async () => {
		const { wheel, list, turns } = mount();
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		turns.length = 0;
		// A wheel that takes every glide and ends at the end again.
		list.scrollTo = ((to: ScrollToOptions) => {
			turns.push({ top: to.top ?? 0, behavior: to.behavior ?? 'auto' });
			list.scrollTop = 19 * PITCH;
			list.dispatchEvent(new Event('scroll'));
		}) as typeof list.scrollTo;
		list.scrollTop = 19 * PITCH;
		list.dispatchEvent(new Event('scroll'));
		await sleep(QUIET * 12);
		expect(turns.filter((one) => one.behavior === 'smooth')).toHaveLength(3);
		// The page moving to another chapter starts the count again.
		wheel.sync({ rows, active: rows[5]?.path ?? null, reach: 5 });
		await sleep(QUIET * 12);
		expect(turns.filter((one) => one.top === 5 * PITCH && one.behavior === 'smooth').length).toBeGreaterThan(1);
	});

	it('follows the page under a pointer that only rests on it', () => {
		const { wheel, turns } = mount();
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		wheel.el.dispatchEvent(pointer('pointerenter', 'mouse'));
		wheel.sync({ rows, active: rows[6]?.path ?? null, reach: 5 });
		expect(turns[turns.length - 1]).toEqual({ top: 6 * PITCH, behavior: 'smooth' });
	});

	it('gives a wheel a finger turned back once it has rested', async () => {
		expect(CONTENTS_REST_MS).toBe(4000);
		const { wheel, list, turns } = mount({ rest: 60 });
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[2]?.path ?? null, reach: 5 });
		// A finger's own pointer comes and goes with every touch: it is not a
		// pointer standing over the wheel, and its leaving gives nothing back.
		wheel.el.dispatchEvent(pointer('pointerenter', 'touch'));
		list.dispatchEvent(new Event('touchstart', { bubbles: true }));
		list.scrollTop = 11 * PITCH;
		wheel.el.dispatchEvent(pointer('pointerleave', 'touch'));
		const before = turns.length;
		wheel.sync({ rows, active: rows[3]?.path ?? null, reach: 5 });
		expect(turns).toHaveLength(before);
		// The moment a pointer's leaving waits is not the finger's rest: the
		// finger may be on its way back for another flick.
		await sleep(QUIET * 2);
		expect(turns).toHaveLength(before);
		await vi.waitFor(() => {
			expect(turns[turns.length - 1]).toEqual({ top: 3 * PITCH, behavior: 'smooth' });
		});
	});

	it('walks the rows with the keys from its one stop, bringing each to the middle itself', () => {
		const { wheel, turns, items, held } = mount();
		const rows = chapters(40);
		wheel.sync({ rows, active: rows[10]?.path ?? null, reach: 5 });
		const focused: boolean[] = [];
		for (const item of items()) {
			const focus = item.focus.bind(item);
			item.focus = (options?: FocusOptions) => {
				focused.push(options?.preventScroll === true);
				focus(options);
			};
		}
		items()[10]?.focus();
		focused.length = 0;
		const press = (name: string): KeyboardEvent => {
			const event = key(name);
			document.activeElement?.dispatchEvent(event);
			return event;
		};
		expect(press('ArrowDown').defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(items()[11]);
		expect(stops(items())).toEqual([11]);
		expect(turns[turns.length - 1]).toEqual({ top: 11 * PITCH, behavior: 'smooth' });
		press('ArrowUp');
		press('ArrowUp');
		expect(document.activeElement).toBe(items()[9]);
		// A page is the wheel's own height less the row that stays in sight.
		press('PageDown');
		expect(document.activeElement).toBe(items()[19]);
		press('PageUp');
		expect(document.activeElement).toBe(items()[9]);
		press('End');
		expect(document.activeElement).toBe(items()[39]);
		press('ArrowDown');
		expect(document.activeElement).toBe(items()[39]);
		press('Home');
		expect(document.activeElement).toBe(items()[0]);
		expect(stops(items())).toEqual([0]);
		// Every move asked the browser not to reveal the row its own way,
		// which would scroll the page around the wheel.
		expect(focused.length).toBeGreaterThan(0);
		expect(focused.every(Boolean)).toBe(true);
		expect(held()).toBe(true);
		// The page's chapter keeps its mark while the keys walk elsewhere.
		expect(items()[10]?.getAttribute('aria-current')).toBe('true');
	});

	it('leaves a chord to the app, and Enter to the button', () => {
		const { wheel, items } = mount();
		const rows = chapters(5);
		wheel.sync({ rows, active: rows[1]?.path ?? null, reach: 5 });
		items()[1]?.focus();
		const chord = key('ArrowDown', { metaKey: true });
		items()[1]?.dispatchEvent(chord);
		expect(chord.defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(items()[1]);
		const enter = key('Enter');
		items()[1]?.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(false);
	});

	it('puts the stop back on the page’s chapter and turns back once the keys leave', async () => {
		const { wheel, turns, items } = mount();
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[4]?.path ?? null, reach: 5 });
		items()[4]?.focus();
		items()[4]?.dispatchEvent(key('End'));
		expect(stops(items())).toEqual([19]);
		const elsewhere = document.body.createEl('button');
		elsewhere.focus();
		expect(stops(items())).toEqual([4]);
		await vi.waitFor(() => {
			expect(turns[turns.length - 1]).toEqual({ top: 4 * PITCH, behavior: 'smooth' });
		});
	});

	it('hands the keys back on Escape where the page takes them, and turns back', () => {
		const { wheel, turns, items, left } = mount({ leave: true });
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[4]?.path ?? null, reach: 5 });
		items()[4]?.focus();
		items()[4]?.dispatchEvent(key('End'));
		const escape = key('Escape');
		document.activeElement?.dispatchEvent(escape);
		expect(escape.defaultPrevented).toBe(true);
		expect(left.count).toBe(1);
		expect(turns[turns.length - 1]).toEqual({ top: 4 * PITCH, behavior: 'smooth' });
		// An input method's Escape takes its syllables back and nothing else.
		const composing = key('Escape', { isComposing: true });
		items()[4]?.dispatchEvent(composing);
		expect(left.count).toBe(1);
	});

	it('leaves Escape alone where nothing takes the keys', () => {
		const { wheel, items } = mount();
		const rows = chapters(3);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		items()[0]?.focus();
		const escape = key('Escape');
		items()[0]?.dispatchEvent(escape);
		expect(escape.defaultPrevented).toBe(false);
	});

	it('keeps the keys on a chapter through a list drawn again', () => {
		const { wheel, turns, items } = mount();
		const rows = chapters(8);
		wheel.sync({ rows, active: rows[1]?.path ?? null, reach: 5 });
		items()[1]?.focus();
		items()[1]?.dispatchEvent(key('End'));
		// A chapter is added ahead of the one in hand.
		const longer = [{ path: 'Novel/50_Manuscript/Prologue.md', title: 'Prologue' }, ...rows];
		wheel.sync({ rows: longer, active: rows[1]?.path ?? null, reach: 5 });
		expect(document.activeElement).toBe(items()[8]);
		expect(document.activeElement?.textContent).toBe('Chapter 8');
		expect(stops(items())).toEqual([8]);
		expect(turns[turns.length - 1]).toEqual({ top: 8 * PITCH, behavior: 'instant' });
	});

	it('says a name it cuts short whole under the pointer, and only that name', () => {
		const { wheel, items } = mount();
		const rows = chapters(2);
		wheel.sync({ rows, active: null, reach: 5 });
		const [long, short] = items();
		if (long === undefined || short === undefined) throw new Error('no rows');
		Object.defineProperty(long, 'scrollWidth', { value: 300 });
		Object.defineProperty(long, 'clientWidth', { value: 244 });
		Object.defineProperty(short, 'scrollWidth', { value: 80 });
		Object.defineProperty(short, 'clientWidth', { value: 244 });
		long.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		short.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		expect(long.getAttribute('data-tooltip')).toBe('Chapter 1');
		expect(long.getAttribute('data-tooltip-side')).toBe('right');
		expect(short.hasAttribute('data-tooltip')).toBe(false);
	});

	it('finds its place when shown: a wheel drawn in a drawer put away has none to keep', () => {
		laidOut = false;
		const { wheel, turns } = mount();
		const rows = chapters(20);
		wheel.sync({ rows, active: rows[6]?.path ?? null, reach: 5 });
		expect(turns).toEqual([]);
		laidOut = true;
		wheel.settle();
		expect(turns).toEqual([{ top: 6 * PITCH, behavior: 'instant' }]);
		// Already standing there, a second look moves nothing.
		wheel.settle();
		expect(turns).toHaveLength(1);
	});

	it('marks no row for a chapter the manuscript does not hold', () => {
		const { wheel, turns, items } = mount();
		const rows = chapters(3);
		wheel.sync({ rows, active: 'Novel/50_Manuscript/Gone.md', reach: 5 });
		expect(items().some((item) => item.classList.contains('is-active'))).toBe(false);
		expect(turns).toEqual([]);
		// The Tab key still has a stop: the first row.
		expect(stops(items())).toEqual([0]);
	});

	it('opens a row’s menu for a right-click, and leaves the page where it is', () => {
		const { wheel, asked, went, items } = mount({ acts: true });
		const rows = chapters(5);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		const press = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		items()[3]?.dispatchEvent(press);
		expect(asked).toEqual([`menu ${rows[3]?.path ?? ''}`]);
		// The app's own menu stays away, and asking is not going.
		expect(press.defaultPrevented).toBe(true);
		expect(went).toEqual([]);
	});

	it('takes the lift of a finger that asked for a menu as no press on the row', () => {
		const { wheel, asked, went, items } = mount({ acts: true });
		const rows = chapters(5);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		const row = items()[2];
		row?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		// The lift is the hold's own: cancelled, so the browser makes no
		// mouse events of it for the menu to close on.
		const lift = new Event('touchend', { bubbles: true, cancelable: true });
		row?.dispatchEvent(lift);
		expect(lift.defaultPrevented).toBe(true);
		// Some hands end a long press with a click all the same: the menu is
		// what was asked for.
		row?.click();
		expect(asked).toEqual([`menu ${rows[2]?.path ?? ''}`]);
		expect(went).toEqual([]);
		// The next press is a press again, and its lift is left alone.
		row?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		const tap = new Event('touchend', { bubbles: true, cancelable: true });
		row?.dispatchEvent(tap);
		expect(tap.defaultPrevented).toBe(false);
		row?.click();
		expect(went).toEqual([rows[2]?.path]);
	});

	it('leaves a right-click to the app where rows offer nothing more', () => {
		const { wheel, asked, items } = mount();
		const rows = chapters(3);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		const press = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		items()[1]?.dispatchEvent(press);
		expect(press.defaultPrevented).toBe(false);
		expect(asked).toEqual([]);
		// And the two keys do nothing there, the way they did before.
		items()[1]?.focus();
		const rename = key('F2');
		items()[1]?.dispatchEvent(rename);
		const erase = key('Delete');
		items()[1]?.dispatchEvent(erase);
		expect(rename.defaultPrevented).toBe(false);
		expect(erase.defaultPrevented).toBe(false);
	});

	it('renames on F2 and deletes on Delete, the keys the file explorer gives a file', () => {
		const { wheel, asked, went, items } = mount({ acts: true });
		const rows = chapters(6);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		items()[4]?.focus();
		const rename = key('F2');
		items()[4]?.dispatchEvent(rename);
		const erase = key('Delete');
		items()[4]?.dispatchEvent(erase);
		// Backspace with the command key, as a Mac's file explorer has it.
		const chord = key('Backspace', { metaKey: true });
		items()[4]?.dispatchEvent(chord);
		const path = rows[4]?.path ?? '';
		expect(asked).toEqual([`rename ${path}`, `remove ${path}`, `remove ${path}`]);
		expect([rename, erase, chord].every((event) => event.defaultPrevented)).toBe(true);
		expect(went).toEqual([]);
		// A bare Backspace is nobody's, and a key held while an input method
		// is composing is the composition's.
		const bare = key('Backspace');
		items()[4]?.dispatchEvent(bare);
		items()[4]?.dispatchEvent(key('F2', { isComposing: true }));
		items()[4]?.dispatchEvent(key('F2', { shiftKey: true }));
		expect(bare.defaultPrevented).toBe(false);
		expect(asked).toHaveLength(3);
	});

	it('says which chapter holds the keys, for a key the app takes first', () => {
		const { wheel, items } = mount({ acts: true });
		const rows = chapters(4);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		expect(wheel.held()).toBeNull();
		items()[2]?.focus();
		expect(wheel.held()).toBe(rows[2]?.path);
		items()[2]?.blur();
		expect(wheel.held()).toBeNull();
	});

	/** A pointer coming over something on the wheel, of the kind a test names. */
	const over = (pointerType: string): Event =>
		Object.assign(new Event('pointerover', { bubbles: true }), { pointerType });

	const dotsOf = (list: HTMLElement): HTMLElement[] => [
		...list.querySelectorAll<HTMLElement>('.snowflake-method-contents-more'),
	];

	it('stands its dots in the row under the pointer, one set for the whole wheel, and takes them away with it', () => {
		const { wheel, list, items } = mount({ acts: true });
		const rows = chapters(8);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		// Nothing until a row is pointed at: a hint, not a column of buttons.
		expect(dotsOf(list)).toEqual([]);
		items()[3]?.dispatchEvent(over('mouse'));
		const dots = dotsOf(list);
		expect(dots).toHaveLength(1);
		expect(dots[0]?.parentElement).toBe(items()[3]?.parentElement);
		expect(items()[3]?.parentElement?.classList.contains('has-more')).toBe(true);
		// The app's own dots, a menu's button, named out of sight and not by
		// a label, which the app would show as a tooltip.
		expect(dots[0]?.getAttribute('data-icon')).toBe('ellipsis');
		expect(dots[0]?.getAttribute('aria-haspopup')).toBe('menu');
		expect(dots[0]?.hasAttribute('aria-label')).toBe(false);
		expect(dots[0]?.hasAttribute('data-tooltip')).toBe(false);
		expect(dots[0]?.textContent).toBe('table.actions');
		// The one Tab stop stays the row's.
		expect(dots[0]?.getAttribute('tabindex')).toBe('-1');
		// Another row: the same dots move there.
		items()[5]?.dispatchEvent(over('mouse'));
		expect(dotsOf(list)).toEqual(dots);
		expect(dots[0]?.parentElement).toBe(items()[5]?.parentElement);
		expect(items()[3]?.parentElement?.classList.contains('has-more')).toBe(false);
		// Pointing at the dots themselves keeps them where they are.
		dots[0]?.dispatchEvent(over('mouse'));
		expect(dots[0]?.parentElement).toBe(items()[5]?.parentElement);
		// The rows are still the rows: the dots are no chapter.
		expect(items()).toHaveLength(8);
		wheel.el.dispatchEvent(pointer('pointerleave', 'mouse'));
		expect(dotsOf(list)).toEqual([]);
		expect(list.querySelector('.has-more')).toBeNull();
	});

	it('opens the row’s menu for a press on its dots, and goes nowhere', () => {
		const { wheel, list, asked, went, items } = mount({ acts: true });
		const rows = chapters(6);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		items()[4]?.dispatchEvent(over('mouse'));
		const dots = dotsOf(list)[0];
		// A press on the picture inside the button is a press on the button.
		const picture = dots?.createSpan();
		picture?.click();
		expect(asked).toEqual([`menu ${rows[4]?.path ?? ''}`]);
		expect(went).toEqual([]);
		// A right-click on them is the same ask.
		const press = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		dots?.dispatchEvent(press);
		expect(press.defaultPrevented).toBe(true);
		expect(asked).toHaveLength(2);
	});

	it('shows no dots for a finger, whose press is not a rest, and keeps them on the page’s chapter where nothing can rest', () => {
		const pointing = mount({ acts: true });
		const rows = chapters(6);
		pointing.wheel.sync({ rows, active: rows[1]?.path ?? null, reach: 5 });
		pointing.items()[3]?.dispatchEvent(over('touch'));
		expect(dotsOf(pointing.list)).toEqual([]);
		// A screen with no pointer to wait for: the page's row keeps them.
		const touching = mount({ acts: true, hovers: false });
		touching.wheel.sync({ rows, active: rows[1]?.path ?? null, reach: 5 });
		const dots = dotsOf(touching.list);
		expect(dots).toHaveLength(1);
		expect(dots[0]?.parentElement).toBe(touching.items()[1]?.parentElement);
		// They go with the page to its next chapter, and a mouse plugged into
		// such a screen moves nothing.
		touching.wheel.sync({ rows, active: rows[4]?.path ?? null, reach: 5 });
		expect(dots[0]?.parentElement).toBe(touching.items()[4]?.parentElement);
		touching.items()[2]?.dispatchEvent(over('mouse'));
		touching.wheel.el.dispatchEvent(pointer('pointerleave', 'mouse'));
		expect(dots[0]?.parentElement).toBe(touching.items()[4]?.parentElement);
		// A page that stands in no chapter of the book has no row to keep them.
		touching.wheel.sync({ rows, active: null, reach: 5 });
		expect(dotsOf(touching.list)).toEqual([]);
	});

	it('offers nothing in a manuscript that may not be written to: no dots, no menu, no keys', () => {
		const { wheel, list, asked, items } = mount({ acts: true });
		const rows = chapters(5);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		items()[2]?.dispatchEvent(over('mouse'));
		expect(dotsOf(list)).toHaveLength(1);
		// The manuscript turns read-only under the pointer: the dots go.
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5, editable: false });
		expect(dotsOf(list)).toEqual([]);
		items()[2]?.dispatchEvent(over('mouse'));
		expect(dotsOf(list)).toEqual([]);
		const press = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		items()[2]?.dispatchEvent(press);
		expect(press.defaultPrevented).toBe(false);
		items()[2]?.focus();
		const rename = key('F2');
		items()[2]?.dispatchEvent(rename);
		const erase = key('Delete');
		items()[2]?.dispatchEvent(erase);
		expect(rename.defaultPrevented).toBe(false);
		expect(erase.defaultPrevented).toBe(false);
		expect(asked).toEqual([]);
		// And back once it may be written to again.
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5, editable: true });
		items()[2]?.dispatchEvent(over('mouse'));
		expect(dotsOf(list)).toHaveLength(1);
	});

	it('draws no dots where rows offer nothing more', () => {
		const { wheel, list, items } = mount();
		const rows = chapters(3);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		items()[1]?.dispatchEvent(over('mouse'));
		expect(dotsOf(list)).toEqual([]);
		const quiet = mount({ hovers: false });
		quiet.wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		expect(dotsOf(quiet.list)).toEqual([]);
	});

	it('lets the dots go with a row whose chapter left the book, and stands them again when asked', () => {
		const { wheel, list, items } = mount({ acts: true });
		const rows = chapters(5);
		wheel.sync({ rows, active: rows[0]?.path ?? null, reach: 5 });
		items()[2]?.dispatchEvent(over('mouse'));
		expect(dotsOf(list)).toHaveLength(1);
		const fewer = rows.filter((_, at) => at !== 2);
		wheel.sync({ rows: fewer, active: rows[0]?.path ?? null, reach: 5 });
		expect(dotsOf(list)).toEqual([]);
		expect(items()).toHaveLength(4);
		items()[2]?.dispatchEvent(over('mouse'));
		const dots = dotsOf(list);
		expect(dots).toHaveLength(1);
		expect(dots[0]?.parentElement).toBe(items()[2]?.parentElement);
		expect(list.querySelectorAll('.has-more')).toHaveLength(1);
	});

	it('takes itself out of the page when let go', () => {
		const { wheel } = mount();
		wheel.sync({ rows: chapters(2), active: null, reach: 5 });
		expect(wheel.el.isConnected).toBe(true);
		wheel.dispose();
		expect(wheel.el.isConnected).toBe(false);
	});
});
