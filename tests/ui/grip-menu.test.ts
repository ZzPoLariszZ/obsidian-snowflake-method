// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Menu } from 'obsidian';
import { addMoveNeighbourItems, wireGripMenu } from '../../src/ui/order-menu';
import { installObsidianDom } from '../helpers/obsidian-dom';

interface ShownItem {
	title: string;
	icon: string;
	disabled: boolean;
	click: (() => void) | null;
}

const shown = vi.hoisted(() => [] as { items: ShownItem[]; at: { x: number; y: number } }[]);

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class RecordingMenu {
		readonly items: ShownItem[] = [];
		addItem(build: (item: unknown) => void): this {
			const entry: ShownItem = { title: '', icon: '', disabled: false, click: null };
			const handle = {
				setTitle: (title: string) => ((entry.title = title), handle),
				setIcon: (icon: string) => ((entry.icon = icon), handle),
				setDisabled: (disabled: boolean) => ((entry.disabled = disabled), handle),
				setSection: () => handle,
				onClick: (click: () => void) => ((entry.click = click), handle),
			};
			build(handle);
			this.items.push(entry);
			return this;
		}
		addSeparator(): this {
			return this;
		}
		showAtPosition(at: { x: number; y: number }): this {
			shown.push({ items: this.items, at });
			return this;
		}
	}
	return {
		...runtime,
		Menu: RecordingMenu,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

const t = (key: string): string => key;

describe('wireGripMenu', () => {
	let handle: HTMLElement;
	let outer: string[];
	let built: number;

	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		shown.length = 0;
		document.body.empty();
		const card = document.body.createDiv();
		outer = [];
		card.addEventListener('click', () => outer.push('click'));
		card.addEventListener('contextmenu', () => outer.push('contextmenu'));
		handle = card.createDiv({ cls: 'snowflake-method-record-drag' });
		Object.defineProperty(handle, 'getBoundingClientRect', {
			value: () => ({ left: 12, top: 20, right: 36, bottom: 44, width: 24, height: 24 }),
		});
		built = 0;
		wireGripMenu(handle, () => {
			built += 1;
			const menu = new Menu();
			addMoveNeighbourItems(menu, { t, up: null, down: () => outer.push('down') });
			return menu;
		});
	});

	it('names itself a menu button and opens under the grip on a click, kept from the card', () => {
		expect(handle.getAttribute('aria-haspopup')).toBe('menu');
		expect(handle.getAttribute('tabindex')).toBe('0');
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		handle.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect(outer).toEqual([]);
		expect(shown).toHaveLength(1);
		expect(shown[0]?.at).toEqual({ x: 12, y: 44 });
	});

	it('opens on Enter, Space and a right-click, and on no other key', () => {
		handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
		handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		handle.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		expect(built).toBe(3);
		expect(outer).toEqual([]);
	});

	it('carries Move up and Move down, greyed where there is nowhere to go', () => {
		handle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		const items = shown[0]?.items ?? [];
		expect(items.map((item) => [item.title, item.icon, item.disabled])).toEqual([
			['actions.moveUp', 'arrow-up', true],
			['actions.moveDown', 'arrow-down', false],
		]);
		items[1]?.click?.();
		expect(outer).toEqual(['down']);
	});

	it('opens nothing when the builder has no menu to give', () => {
		const still = document.body.createDiv();
		wireGripMenu(still, () => null);
		still.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(shown).toHaveLength(0);
	});
});
