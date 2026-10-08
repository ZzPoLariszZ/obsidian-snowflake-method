import { describe, expect, it, vi } from 'vitest';

// The explorer's menu reaches the move dialogs, which extend classes the
// runtime stub leaves out; nothing here ever opens one.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import { addOrderMenuItems } from '../../src/ui/order-menu';

function fakeMenu() {
	const titles: string[] = [];
	const sections: (string | undefined)[] = [];
	let separators = 0;
	const menu = {
		addItem(build: (item: unknown) => void) {
			let section: string | undefined;
			const item = {
				setTitle(title: string) { titles.push(title); sections.push(section); return item; },
				setIcon() { return item; },
				setDisabled() { return item; },
				setSection(name: string) { section = name; return item; },
				onClick() { return item; },
			};
			build(item);
			return menu;
		},
		addSeparator() { separators += 1; return menu; },
	};
	return { menu, titles, sections, separators: () => separators };
}

describe('addOrderMenuItems', () => {
	const deps = {
		app: {} as never,
		t: (key: string) => key,
		run: vi.fn(async (action: () => Promise<void>) => action()),
		refresh: vi.fn(async () => undefined),
	};
	const config = {
		index: 1, total: 3, locked: false, readOnly: false, up: 0, down: 2,
		options: () => [], move: vi.fn(async () => undefined), reveal: vi.fn(),
	};

	it('leaves the insert item out when a list only moves', () => {
		const { menu, titles, separators } = fakeMenu();
		addOrderMenuItems(menu as never, deps, config);
		expect(titles).toEqual(['actions.moveUp', 'actions.moveDown', 'table.moveToPosition', 'table.moveAfter']);
		expect(separators()).toBe(1);
	});

	it('adds the insert item when one is named, and puts every item in the section asked for', () => {
		const { menu, titles, sections, separators } = fakeMenu();
		addOrderMenuItems(menu as never, { ...deps, section: 'own' }, { ...config, insertTitle: 'Add', insert: vi.fn() });
		expect(titles).toEqual(['actions.moveUp', 'actions.moveDown', 'table.moveToPosition', 'table.moveAfter', 'Add']);
		expect(sections.every((section) => section === 'own')).toBe(true);
		expect(separators()).toBe(2);
	});
});
