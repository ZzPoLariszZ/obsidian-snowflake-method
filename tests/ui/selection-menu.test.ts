import { describe, expect, it, vi } from 'vitest';

import {
	addExportEntries,
	addSelectionMakers,
	nameFromSelection,
} from '../../src/ui/selection-menu';

/** One entry as the menu was given it: its words, its icon, its section, whether it stands greyed, and what pressing it does. */
interface Entry {
	title: string;
	icon: string;
	section: string;
	disabled: boolean;
	press: () => void;
}

/** A menu that keeps every entry it is given. */
function fakeMenu() {
	const entries: Entry[] = [];
	const menu = {
		addItem(build: (item: unknown) => void) {
			const entry: Entry = { title: '', icon: '', section: '', disabled: false, press: () => undefined };
			const item = {
				setTitle(title: string) { entry.title = title; return item; },
				setIcon(icon: string) { entry.icon = icon; return item; },
				setSection(section: string) { entry.section = section; return item; },
				setDisabled(disabled: boolean) { entry.disabled = disabled; return item; },
				onClick(press: () => void) { entry.press = press; return item; },
			};
			build(item);
			entries.push(entry);
			return menu;
		},
	};
	return { menu, entries };
}

const t = (key: string): string => key;

describe('nameFromSelection', () => {
	it('reads a name off the words as shown, markup out and on one line', () => {
		expect(nameFromSelection('[[Characters/Jon Snow|Jon]]')).toBe('Jon');
		expect(nameFromSelection('**萧炎**')).toBe('萧炎');
		expect(nameFromSelection('  the *ash*\ntree  ')).toBe('the ash tree');
		expect(nameFromSelection('   ')).toBe('');
	});
});

describe('addSelectionMakers', () => {
	it('makes an entity named by the words, and a sticky note holding them as written', () => {
		const { menu, entries } = fakeMenu();
		const addEntity = vi.fn();
		const addStickyNote = vi.fn();
		addSelectionMakers(menu as never, {
			t,
			section: 'snowflake-method',
			selection: ' The **ash** tree. ',
			addEntity,
			addStickyNote,
		});
		expect(entries.map((entry) => [entry.title, entry.section, entry.disabled])).toEqual([
			['manuscript.menu.addEntity', 'snowflake-method', false],
			['manuscript.menu.addStickyNote', 'snowflake-method', false],
		]);
		entries[0]?.press();
		entries[1]?.press();
		expect(addEntity).toHaveBeenCalledWith('The ash tree.');
		expect(addStickyNote).toHaveBeenCalledWith('The **ash** tree.');
	});

	it('stands greyed while nothing is selected', () => {
		const { menu, entries } = fakeMenu();
		addSelectionMakers(menu as never, {
			t,
			section: 'snowflake-method',
			selection: '',
			addEntity: vi.fn(),
			addStickyNote: vi.fn(),
		});
		expect(entries.map((entry) => entry.disabled)).toEqual([true, true]);
	});
});

describe('addExportEntries', () => {
	it('writes out the note, the manuscript where it is in view, and the words selected', () => {
		const { menu, entries } = fakeMenu();
		const exportNote = vi.fn();
		const exportManuscript = vi.fn();
		const exportSelection = vi.fn();
		addExportEntries(menu as never, {
			t,
			section: 'snowflake-method',
			selection: '\nFirst words.\n',
			exportNote,
			exportManuscript,
			exportSelection,
		});
		expect(entries.map((entry) => [entry.title, entry.icon, entry.disabled])).toEqual([
			['manuscript.exportNote', 'file-down', false],
			['commands.exportManuscript', 'book-down', false],
			['manuscript.menu.exportSelection', 'text-select', false],
		]);
		for (const entry of entries) entry.press();
		expect(exportNote).toHaveBeenCalledOnce();
		expect(exportManuscript).toHaveBeenCalledOnce();
		expect(exportSelection).toHaveBeenCalledWith('First words.');
	});

	it('offers the words alone where no note holds them', () => {
		const { menu, entries } = fakeMenu();
		addExportEntries(menu as never, {
			t,
			section: 'snowflake-method',
			selection: 'Words in a box.',
			exportSelection: vi.fn(),
		});
		expect(entries.map((entry) => entry.title)).toEqual(['manuscript.menu.exportSelection']);
	});

	it('leaves the manuscript to the stream, and greys the selection while there is none', () => {
		const { menu, entries } = fakeMenu();
		addExportEntries(menu as never, {
			t,
			section: 'snowflake-method',
			selection: '',
			exportNote: vi.fn(),
			exportSelection: vi.fn(),
		});
		expect(entries.map((entry) => [entry.title, entry.disabled])).toEqual([
			['manuscript.exportNote', false],
			['manuscript.menu.exportSelection', true],
		]);
	});
});
