// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import beatSheetSource from '../../src/ui/beat-sheet.ts?raw';
import corkboardSource from '../../src/ui/corkboard.ts?raw';
import { watchDragPress, type DragPressWatch, type WatchedMenu } from '../../src/ui/drag-press';
import laneCellsSource from '../../src/ui/lane-cells.ts?raw';
import taskBoardSource from '../../src/ui/task-board.ts?raw';
import timelineSource from '../../src/ui/timeline.ts?raw';
import { installObsidianDom } from '../helpers/obsidian-dom';

function mouse(type: string, at: { x: number; y: number }): MouseEvent {
	return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 0 });
}

/** A menu as the watch sees one: it can be closed, and it says when it closes, however it did. */
function fakeMenu(): WatchedMenu & { hidden: number } {
	let onHide: (() => void) | null = null;
	const menu = {
		hidden: 0,
		hide(): void {
			menu.hidden++;
			onHide?.();
		},
		onHide(callback: () => void): void {
			onHide = callback;
		},
	};
	return menu;
}

describe('watchDragPress', () => {
	let root: HTMLElement;
	let card: HTMLElement;
	let watch: DragPressWatch;
	let menus: number;

	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		document.body.empty();
		root = document.body.createDiv();
		card = root.createDiv();
		menus = 0;
		card.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			menus++;
		});
		watch = watchDragPress(root);
	});

	afterEach(() => {
		watch.release();
	});

	/** A right-click, or the long press the platform makes one of: whether the card heard it. */
	const press = (at = { x: 100, y: 100 }): boolean => {
		const before = menus;
		card.dispatchEvent(mouse('contextmenu', at));
		return menus === before + 1;
	};

	it('lets a hold that stays still open its menu, and closes the menu as the finger sets off', () => {
		card.dispatchEvent(mouse('dragstart', { x: 100, y: 100 }));
		expect(press()).toBe(true);
		const menu = fakeMenu();
		watch.opened(menu);
		card.dispatchEvent(mouse('drag', { x: 103, y: 102 }));
		expect(menu.hidden).toBe(0);
		card.dispatchEvent(mouse('drag', { x: 120, y: 100 }));
		expect(menu.hidden).toBe(1);
		card.dispatchEvent(mouse('drag', { x: 140, y: 100 }));
		expect(menu.hidden).toBe(1);
	});

	it('swallows a right-click once the drag has moved, however it is made', () => {
		card.dispatchEvent(mouse('dragstart', { x: 100, y: 100 }));
		root.dispatchEvent(mouse('dragover', { x: 130, y: 100 }));
		const event = mouse('contextmenu', { x: 100, y: 100 });
		card.dispatchEvent(event);
		expect(menus).toBe(0);
		expect(event.defaultPrevented).toBe(true);
	});

	it('takes the drag\u2019s point from its first move where the start carried none', () => {
		card.dispatchEvent(mouse('dragstart', { x: 0, y: 0 }));
		root.dispatchEvent(mouse('dragover', { x: 50, y: 50 }));
		root.dispatchEvent(mouse('dragover', { x: 53, y: 52 }));
		expect(press()).toBe(true);
		root.dispatchEvent(mouse('dragover', { x: 70, y: 50 }));
		expect(press()).toBe(false);
	});

	it('forgets the drag at its end, and at the next press when the end never came', () => {
		card.dispatchEvent(mouse('dragstart', { x: 100, y: 100 }));
		card.dispatchEvent(mouse('drag', { x: 130, y: 100 }));
		expect(press()).toBe(false);
		card.dispatchEvent(mouse('dragend', { x: 130, y: 100 }));
		expect(press()).toBe(true);

		card.dispatchEvent(mouse('dragstart', { x: 100, y: 100 }));
		card.dispatchEvent(mouse('drag', { x: 130, y: 100 }));
		expect(press()).toBe(false);
		root.dispatchEvent(mouse('drop', { x: 130, y: 100 }));
		expect(press()).toBe(true);

		card.dispatchEvent(mouse('dragstart', { x: 100, y: 100 }));
		card.dispatchEvent(mouse('drag', { x: 130, y: 100 }));
		expect(press()).toBe(false);
		card.dispatchEvent(mouse('pointerdown', { x: 100, y: 100 }));
		expect(press()).toBe(true);
	});

	it('counts no drag the board declined', () => {
		card.addEventListener('dragstart', (event) => {
			event.preventDefault();
		});
		card.dispatchEvent(mouse('dragstart', { x: 100, y: 100 }));
		root.dispatchEvent(mouse('dragover', { x: 140, y: 100 }));
		expect(press()).toBe(true);
	});

	it('leaves a menu that closed on its own alone, and only the latest menu is its', () => {
		card.dispatchEvent(mouse('dragstart', { x: 100, y: 100 }));
		const first = fakeMenu();
		watch.opened(first);
		first.hide();
		const second = fakeMenu();
		watch.opened(second);
		card.dispatchEvent(mouse('drag', { x: 140, y: 100 }));
		expect(first.hidden).toBe(1);
		expect(second.hidden).toBe(1);
	});

	it('hears nothing once released', () => {
		watch.release();
		card.dispatchEvent(mouse('dragstart', { x: 100, y: 100 }));
		card.dispatchEvent(mouse('drag', { x: 140, y: 100 }));
		expect(press()).toBe(true);
		watch = watchDragPress(root);
	});

	it('is wired on every board whose cards drag, and told of every menu they open', () => {
		for (const source of [beatSheetSource, corkboardSource, taskBoardSource, timelineSource]) {
			expect(source).toContain('const dragPress = watchDragPress(root);');
			expect(source).toContain('dragPress.release();');
			const shown = source.match(/menu\.showAtMouseEvent\(event\);/gu)?.length ?? 0;
			expect(shown).toBeGreaterThan(0);
			expect(source.match(/dragPress\.opened\(menu\);\n\t\tmenu\.showAtMouseEvent\(event\);/gu)?.length ?? 0).toBe(shown);
		}
		const shown = laneCellsSource.match(/menu\.showAtMouseEvent\(event\);/gu)?.length ?? 0;
		expect(shown).toBeGreaterThan(0);
		expect(laneCellsSource.match(/deps\.menuOpened\(menu\);\n\t\tmenu\.showAtMouseEvent\(event\);/gu)?.length ?? 0).toBe(shown);
		expect(timelineSource).toContain('menuOpened: dragPress.opened,');
	});
});
