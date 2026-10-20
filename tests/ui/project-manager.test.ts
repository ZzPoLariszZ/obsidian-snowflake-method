import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, CorkboardElement } from '../helpers/corkboard-dom';

/** What every menu the manager opened was given, and every dialog it opened. */
interface MenuRow {
	title?: string;
	icon?: string;
	disabled?: boolean;
	click?: () => void;
}
const { menus, opened } = vi.hoisted(() => ({
	menus: [] as MenuRow[][],
	opened: [] as unknown[],
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		readonly dom = new CorkboardDom();
		modalEl = this.dom.container.createDiv();
		titleEl = this.modalEl.createDiv();
		contentEl = this.modalEl.createDiv();
		setTitle(): void {}
		onOpen(): void {}
		onClose(): void {}
		open(): void { opened.push(this); this.onOpen(); }
		close(): void { this.onClose(); }
	}
	class Menu {
		private readonly rows: MenuRow[] = [];
		constructor() { menus.push(this.rows); }
		setUseNativeMenu(): this { return this; }
		setParentElement(): this { return this; }
		addSeparator(): this { return this; }
		showAtPosition(): this { return this; }
		addItem(build: (item: unknown) => void): this {
			const row: MenuRow = {};
			this.rows.push(row);
			const item = {
				setTitle(title: string) { row.title = title; return item; },
				setIcon(icon: string) { row.icon = icon; return item; },
				setDisabled(disabled: boolean) { row.disabled = disabled; return item; },
				setWarning() { return item; },
				onClick(click: () => void) { row.click = click; return item; },
			};
			build(item);
			return this;
		}
	}
	interface FieldLike {
		inputEl: CorkboardElement;
		setPlaceholder(value: string): FieldLike;
		setValue(value: string): FieldLike;
		onChange(handler: (value: string) => void): FieldLike;
	}
	class Setting {
		settingEl: CorkboardElement;
		nameEl: CorkboardElement;
		descEl: CorkboardElement;
		controlEl: CorkboardElement;
		constructor(container: CorkboardElement) {
			this.settingEl = container.createDiv({ cls: 'setting-item' });
			const info = this.settingEl.createDiv();
			this.nameEl = info.createDiv();
			this.descEl = info.createDiv();
			this.controlEl = this.settingEl.createDiv();
		}
		setName(name: string): this { this.nameEl.setText(name); return this; }
		setDesc(desc: string): this { this.descEl.setText(desc); return this; }
		addText(build: (component: FieldLike) => void): this {
			const inputEl = this.controlEl.createEl('input');
			const component: FieldLike = {
				inputEl,
				setPlaceholder: (value) => { inputEl.setAttribute('placeholder', value); return component; },
				setValue: (value) => { inputEl.value = value; return component; },
				onChange: (handler) => { inputEl.addEventListener('input', () => { handler(inputEl.value); }); return component; },
			};
			build(component);
			return this;
		}
	}
	return { ...runtime, Modal, Menu, Setting, Notice: class {} };
});
vi.mock('../../src/ui/snowflake-evolution', () => ({ renderSnowflakeEvolution: (): void => undefined }));

import type { App } from 'obsidian';

import {
	ManageProjectsModal,
	type ManageProjectLists,
	type ManageProjectOption,
	type Translate,
} from '../../src/ui/modals';

const app = {} as App;
const t: Translate = (key, vars) =>
	key === 'dashboard.seriesBook' ? `Book ${String(vars?.book)}` : key;

const option = (
	title: string,
	series: { name: string; book: number | null } | null,
	readOnly = false,
): ManageProjectOption => ({
	path: `Root/${title}/Project.md`,
	rootPath: `Root/${title}`,
	projectId: title,
	title,
	readOnly,
	series,
	hasStructureIssues: false,
	hasMarkerIssues: false,
});

function openManager(
	projects: ManageProjectOption[],
	onSetSeries = vi.fn(async (): Promise<ManageProjectLists> => ({ projects, archived: [] })),
	onImportProject = vi.fn(),
): {
	manager: ManageProjectsModal;
	content: CorkboardElement;
	onSetSeries: typeof onSetSeries;
	onImportProject: typeof onImportProject;
} {
	const lists = async (): Promise<ManageProjectLists> => ({ projects, archived: [] });
	const manager = new ManageProjectsModal(
		app,
		t,
		projects,
		'0.28.0',
		'en',
		'Root',
		lists,
		async () => undefined,
		() => undefined,
		async () => projects,
		async () => undefined,
		async () => null,
		[],
		lists,
		lists,
		async () => null,
		onSetSeries,
		onImportProject,
	);
	manager.open();
	// The dialog's content as the fake built it, which the app's own element
	// type knows nothing of.
	const content = (manager as unknown as { contentEl: CorkboardElement }).contentEl;
	return { manager, content, onSetSeries, onImportProject };
}

const rowTitles = (section: CorkboardElement): string[] =>
	section
		.querySelectorAll('.snowflake-method-project-manager-project-title')
		.map((title) => title.children.map((part) => part.textContent).join(' '));

beforeEach(() => {
	vi.stubGlobal('window', { setTimeout: (): number => 0 });
	// The row builder tells a button from a block by the DOM's own class,
	// which this runtime has none of; the fake's elements stand in for it.
	vi.stubGlobal('HTMLButtonElement', CorkboardElement);
});
afterEach(() => {
	menus.length = 0;
	opened.length = 0;
	vi.unstubAllGlobals();
});

describe('ManageProjectsModal with series', () => {
	it('groups the books under their series, numbered in order, and the rest under their own heading', () => {
		const { content } = openManager([
			option('Lone', null),
			option('Second', { name: 'Saga', book: 2 }),
			option('First', { name: 'Saga', book: 1 }),
			option('Draft', { name: 'Saga', book: null }),
		]);
		const sections = content.querySelectorAll('.snowflake-method-project-manager-series');
		expect(sections).toHaveLength(2);
		const [saga, loose] = sections as [CorkboardElement, CorkboardElement];
		expect(saga.querySelector('.snowflake-method-project-manager-series-name')?.textContent).toBe('Saga');
		expect(saga.querySelector('.snowflake-method-step-indicator')?.textContent).toBe('3');
		expect(rowTitles(saga)).toEqual(['Book 1 First', 'Book 2 Second', 'Draft']);
		expect(loose.classes.has('is-loose')).toBe(true);
		expect(loose.querySelector('.snowflake-method-project-manager-series-name')?.textContent).toBe(
			'modal.projectManager.noSeries',
		);
		expect(rowTitles(loose)).toEqual(['Lone']);
	});

	it('offers Import from project on a row, greyed when the project is read-only, and steps aside for the dialog', () => {
		const projects = [option('Book', { name: 'Saga', book: 1 }), option('Frozen', null, true)];
		const { manager, content, onImportProject } = openManager(projects);
		const closed = vi.spyOn(manager, 'close');
		const more = content.querySelectorAll('.snowflake-method-project-manager-project-more');
		more[1]?.dispatch('click');
		const frozenRow = menus[menus.length - 1]?.find((row) => row.title === 'actions.importFromProject');
		expect(frozenRow).toMatchObject({ icon: 'import', disabled: true });
		more[0]?.dispatch('click');
		const bookRow = menus[menus.length - 1]?.find((row) => row.title === 'actions.importFromProject');
		expect(bookRow).toMatchObject({ icon: 'import', disabled: false });
		bookRow?.click?.();
		expect(closed).toHaveBeenCalledOnce();
		expect(onImportProject).toHaveBeenCalledExactlyOnceWith(projects[0]);
	});

	it('draws a plain list, no headings, while nothing is in a series', () => {
		const { content } = openManager([option('B', null), option('A', null)]);
		expect(content.querySelectorAll('.snowflake-method-project-manager-series')).toHaveLength(0);
		const list = content.querySelector('.snowflake-method-project-manager-list');
		if (list === null) throw new Error('no list');
		expect(rowTitles(list)).toEqual(['B', 'A']);
	});

	it('offers Set series on a row, disabled when the project is read-only, and writes what the dialog answers', async () => {
		const projects = [option('Book', { name: 'Saga', book: 1 }), option('Frozen', null, true)];
		const { manager, content, onSetSeries } = openManager(projects);
		const more = content.querySelectorAll('.snowflake-method-project-manager-project-more');
		expect(more).toHaveLength(2);
		more[1]?.dispatch('click');
		const frozenRow = menus[menus.length - 1]?.find((row) => row.title === 'actions.setSeries');
		expect(frozenRow).toMatchObject({ icon: 'book-copy', disabled: true });
		more[0]?.dispatch('click');
		const bookRow = menus[menus.length - 1]?.find((row) => row.title === 'actions.setSeries');
		expect(bookRow).toMatchObject({ icon: 'book-copy', disabled: false });
		bookRow?.click?.();
		const dialog = opened[opened.length - 1] as {
			contentEl: CorkboardElement;
			submit(): Promise<boolean>;
		};
		expect(dialog).not.toBe(manager);
		const inputs = dialog.contentEl.querySelectorAll('input') as (CorkboardElement & { type?: string })[];
		const series = inputs.find((input) => input.type !== 'number');
		const book = inputs.find((input) => input.type === 'number');
		if (series === undefined || book === undefined) throw new Error('series dialog incomplete');
		expect(series.value).toBe('Saga');
		expect(book.value).toBe('1');
		series.value = 'Epic';
		series.dispatch('input');
		book.value = '3';
		book.dispatch('input');
		expect(await dialog.submit()).toBe(true);
		expect(onSetSeries).toHaveBeenCalledWith(projects[0], { name: 'Epic', book: 3 });
	});
});
