import { describe, expect, it, vi } from 'vitest';

import type { Menu } from 'obsidian';

import { fillProjectSwitcherMenu } from '../../src/ui/project-switcher-menu';

/** A menu that remembers what it was given, row by row. */
interface Row {
	kind: 'item' | 'separator';
	title?: string;
	icon?: string;
	label?: boolean;
	checked?: boolean;
	disabled?: boolean;
	click?: () => void;
}

function recordingMenu(): { menu: Menu; rows: Row[] } {
	const rows: Row[] = [];
	const menu = {
		addItem(build: (item: unknown) => void) {
			const row: Row = { kind: 'item' };
			rows.push(row);
			const item = {
				setTitle(title: string) { row.title = title; return item; },
				setIcon(icon: string) { row.icon = icon; return item; },
				setIsLabel(label: boolean) { row.label = label; return item; },
				setChecked(checked: boolean) { row.checked = checked; return item; },
				setDisabled(disabled: boolean) { row.disabled = disabled; return item; },
				onClick(click: () => void) { row.click = click; return item; },
			};
			build(item);
			return menu;
		},
		addSeparator() { rows.push({ kind: 'separator' }); return menu; },
	};
	return { menu: menu as unknown as Menu, rows };
}

const project = (path: string, series: { name: string; book: number | null } | null, unhealthy = false) => ({
	path,
	title: path,
	series,
	hasStructureIssues: unhealthy,
	hasMarkerIssues: false,
});

describe('fillProjectSwitcherMenu', () => {
	it('lists each series under a label, then the lone projects, then the manager, every row with an icon', () => {
		const { menu, rows } = recordingMenu();
		const onSelect = vi.fn();
		const onManage = vi.fn();
		fillProjectSwitcherMenu(menu, {
			projects: [
				project('Lone', null),
				project('Saga 2', { name: 'Saga', book: 2 }),
				project('Saga 1', { name: 'Saga', book: 1 }, true),
			],
			currentPath: 'Saga 2',
			t: (key) => key,
			onSelect,
			onManage,
		});
		expect(rows.map((row) => row.kind === 'separator' ? '---' : `${row.label ? '#' : ''}${row.title ?? ''}`)).toEqual([
			'#Saga', 'Saga 1', 'Saga 2', '---', 'Lone', '---', 'dashboard.manageProjects',
		]);
		for (const row of rows.filter((entry) => entry.kind === 'item')) expect(row.icon).toBeTruthy();
		expect(rows.find((row) => row.title === 'Saga 1')?.icon).toBe('triangle-alert');
		expect(rows.find((row) => row.title === 'Saga 2')?.icon).toBe('book');
		expect(rows.find((row) => row.title === 'Saga 2')?.checked).toBe(true);
		expect(rows.find((row) => row.title === 'Lone')?.checked).toBe(false);
		rows.find((row) => row.title === 'Lone')?.click?.();
		expect(onSelect).toHaveBeenCalledWith('Lone');
		rows.find((row) => row.title === 'dashboard.manageProjects')?.click?.();
		expect(onManage).toHaveBeenCalledTimes(1);
	});

	it('draws no label and no leading separator when nothing is in a series', () => {
		const { menu, rows } = recordingMenu();
		fillProjectSwitcherMenu(menu, {
			projects: [project('A', null), project('B', null)],
			currentPath: 'A',
			t: (key) => key,
			onSelect: () => undefined,
			onManage: () => undefined,
		});
		expect(rows.map((row) => row.kind === 'separator' ? '---' : row.title)).toEqual([
			'A', 'B', '---', 'dashboard.manageProjects',
		]);
		expect(rows.some((row) => row.label === true)).toBe(false);
	});

	it('offers Import from project above the manager when asked to, greyed while the project cannot be written', () => {
		const { menu, rows } = recordingMenu();
		const onImport = vi.fn();
		fillProjectSwitcherMenu(menu, {
			projects: [project('A', null)],
			currentPath: 'A',
			t: (key) => key,
			onSelect: () => undefined,
			onManage: () => undefined,
			onImport,
			canImport: true,
		});
		expect(rows.map((row) => row.kind === 'separator' ? '---' : row.title)).toEqual([
			'A', '---', 'actions.importFromProject', 'dashboard.manageProjects',
		]);
		const importRow = rows.find((row) => row.title === 'actions.importFromProject');
		expect(importRow).toMatchObject({ icon: 'import', disabled: false });
		importRow?.click?.();
		expect(onImport).toHaveBeenCalledOnce();

		const greyed = recordingMenu();
		fillProjectSwitcherMenu(greyed.menu, {
			projects: [project('A', null)],
			currentPath: 'A',
			t: (key) => key,
			onSelect: () => undefined,
			onManage: () => undefined,
			onImport: () => undefined,
			canImport: false,
		});
		expect(greyed.rows.find((row) => row.title === 'actions.importFromProject')?.disabled).toBe(true);
	});
});
