import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

const { notices, opened } = vi.hoisted(() => ({ notices: vi.fn(), opened: [] as unknown[] }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		readonly dom = new CorkboardDom();
		modalEl = this.dom.container.createDiv();
		titleEl = this.modalEl.createDiv();
		contentEl = this.modalEl.createDiv();
		title = '';
		setTitle(title: string): void { this.title = title; }
		onOpen(): void {}
		onClose(): void {}
		open(): void { opened.push(this); this.onOpen(); }
		close(): void { this.onClose(); }
	}
	interface DropdownLike {
		selectEl: CorkboardElement;
		addOption(value: string, label: string): DropdownLike;
		setValue(value: string): DropdownLike;
		onChange(handler: (value: string) => void): DropdownLike;
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
		addDropdown(build: (component: DropdownLike) => void): this {
			const selectEl = this.controlEl.createEl('select');
			const component: DropdownLike = {
				selectEl,
				addOption: (value, label) => { selectEl.createEl('option', { value, text: label }); return component; },
				setValue: (value) => { selectEl.value = value; return component; },
				onChange: (handler) => { selectEl.addEventListener('change', () => { handler(selectEl.value); }); return component; },
			};
			build(component);
			return this;
		}
	}
	class SearchComponent {
		readonly inputEl: CorkboardElement;
		constructor(container: CorkboardElement) { this.inputEl = container.createEl('input', { cls: 'search-input' }); }
		setPlaceholder(value: string): this { this.inputEl.setAttribute('placeholder', value); return this; }
		setValue(value: string): this { this.inputEl.value = value; return this; }
		getValue(): string { return this.inputEl.value; }
		onChange(handler: (value: string) => void): this {
			this.inputEl.addEventListener('input', () => { handler(this.inputEl.value); });
			return this;
		}
	}
	return {
		...runtime,
		Modal,
		Setting,
		SearchComponent,
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

import type { App } from 'obsidian';
import type { KeymapEventHandler } from '../helpers/obsidian-runtime';

import {
	linkedParts,
	IMPORT_PART_KINDS,
	type ImportInspection,
	type ImportPart,
	type ImportPartKind,
	type ImportPlan,
	type ImportPlanEntry,
	type ImportSelection,
	type ImportStanding,
} from '../../src/domain';
import type { ImportReport } from '../../src/services';
import {
	ImportProjectModal,
	ImportReportModal,
	ImportSelectionModel,
	importPlanWords,
	importReplacedNames,
	importReportSummary,
	importReportWanted,
	importTree,
	updateTree,
	type ImportChoice,
	type ImportDialogConfig,
} from '../../src/ui/import-dialog';
import type { Translate } from '../../src/ui/modals';

const app = {} as App;
const t: Translate = (key, vars) => (vars === undefined ? key : `${key}${JSON.stringify(vars)}`);

// ---- Fixtures ---------------------------------------------------------------------

type PartSpec = Pick<ImportPart, 'key' | 'kind' | 'name'> & Partial<ImportPart>;

function part(spec: PartSpec): ImportPart {
	return {
		sourceId: spec.key.slice(spec.key.indexOf(':') + 1),
		sourcePath: null,
		group: null,
		bucket: null,
		defaultSelected: true,
		requires: [],
		links: [],
		record: {} as ImportPart['record'],
		...spec,
	};
}

/** A source with one of everything: Alice stands in the target already, Bob links to her. */
function parts(): ImportPart[] {
	return [
		part({ key: 'step:1', kind: 'step', name: 'Step 1' }),
		part({ key: 'character:c1', kind: 'character', name: 'Alice', group: 'character' }),
		part({
			key: 'character:c2',
			kind: 'character',
			name: 'Bob',
			group: 'character',
			links: [{ key: 'character:c1', field: 'related' }],
		}),
		part({
			key: 'picture:Book 1/Pictures/alice.png',
			kind: 'picture',
			name: 'alice.png',
			group: 'character',
			bucket: 'pictures',
			defaultSelected: false,
		}),
		part({
			key: 'scene:s1',
			kind: 'scene',
			name: 'Opening',
			group: 'scene',
			links: [{ key: 'character:c2', field: 'cast' }],
		}),
		part({ key: 'worldbuilding:w1', kind: 'worldbuilding', name: 'Harbor', group: 'location' }),
		part({ key: 'vocabulary:character/category/Hero', kind: 'vocabulary', name: 'Hero', bucket: 'character/category' }),
		part({ key: 'custom-field-template:character/Combatant', kind: 'custom-field-template', name: 'Combatant', bucket: 'character' }),
		part({ key: 'chapter:Book 1/Draft/Chapter 1.md', kind: 'chapter', name: 'Chapter 1', defaultSelected: false }),
		part({ key: 'chapter:Book 1/Draft/Chapter 2.md', kind: 'chapter', name: 'Chapter 2', defaultSelected: false }),
		part({ key: 'task:t1', kind: 'task', name: 'Fix the ending' }),
		part({ key: 'foreshadowing:f1', kind: 'foreshadowing', name: 'The crane' }),
		part({ key: 'revision:r1', kind: 'revision', name: 'Revision 1', defaultSelected: false }),
		part({ key: 'sticky-note:n1', kind: 'sticky-note', name: 'Remember' }),
		part({ key: 'freeform-view:v1', kind: 'freeform-view', name: 'Board' }),
		part({ key: 'timeline:tl1', kind: 'timeline', name: 'Main' }),
		part({ key: 'beat-sheet:b1', kind: 'beat-sheet', name: 'Act one' }),
		part({ key: 'beat-sheet-template:Classic', kind: 'beat-sheet-template', name: 'Classic' }),
	];
}

function inspection(held: ImportPart[] = parts(), standing: [string, ImportStanding][] = []): ImportInspection {
	return {
		parts: held,
		standing: new Map<string, ImportStanding>([
			['character:c1', { kind: 'existing', targetId: 'x1', targetPath: 'Book 2/Characters/Alice.md', targetName: 'Alice' }],
			...standing,
		]),
		source: { project: { kinds: [{ id: 'location' }] } },
	} as unknown as ImportInspection;
}

/** The planner as the dialog needs it: a ticked part is made, or skipped or replaced when it stands here. */
function fakePlan(held: ImportInspection, selection: ImportSelection): ImportPlan {
	const entries: ImportPlanEntry[] = [];
	const counts: Record<ImportPartKind, { create: number; replace: number; skip: number }> = Object.fromEntries(
		IMPORT_PART_KINDS.map((kind) => [kind, { create: 0, replace: 0, skip: 0 }]),
	) as Record<ImportPartKind, { create: number; replace: number; skip: number }>;
	for (const candidate of held.parts) {
		if (!selection.parts.has(candidate.key)) continue;
		const here = held.standing.get(candidate.key);
		const action = here !== undefined && here.kind !== 'new'
			? (selection.clashPolicy === 'replace' ? 'replace' : 'skip')
			: 'create';
		entries.push({
			part: candidate,
			action,
			reason: action === 'skip' ? 'name-taken' : null,
			targetName: candidate.name,
			targetId: null,
			targetPath: null,
			rank: 0,
		});
		counts[candidate.kind][action] += 1;
	}
	return {
		entries,
		kindsToCreate: [],
		droppedLinks: [],
		unselectedLinks: linkedParts(held.parts, selection.parts),
		counts,
	};
}

function report(overrides: Partial<ImportReport> = {}): ImportReport {
	return {
		source: { id: 's', title: 'Book 1' },
		target: { id: 't', title: 'Book 2', projectFile: 'Book 2/Project.md' },
		created: [],
		replaced: [],
		skipped: [],
		failed: [],
		droppedLinks: [],
		pictures: { landed: 0, reused: 0 },
		kindsCreated: [],
		counts: {},
		...overrides,
	} as unknown as ImportReport;
}

beforeEach(() => {
	vi.stubGlobal('window', { setTimeout: (): number => 0 });
});
afterEach(() => {
	notices.mockClear();
	opened.length = 0;
	vi.unstubAllGlobals();
});

// ---- The model ---------------------------------------------------------------------

describe('ImportSelectionModel', () => {
	it('ticks everything but the manuscript, the pictures and the revisions to begin with', () => {
		const model = new ImportSelectionModel(parts());
		expect(model.has('character:c1')).toBe(true);
		expect(model.has('chapter:Book 1/Draft/Chapter 1.md')).toBe(false);
		expect(model.has('picture:Book 1/Pictures/alice.png')).toBe(false);
		expect(model.has('revision:r1')).toBe(false);
		expect(model.count()).toBe(14);
	});

	it('lets a revision ride only on a ticked chapter, and takes it off with the last one', () => {
		const model = new ImportSelectionModel(parts());
		expect(model.available('revision:r1')).toBe(false);
		model.tick(['revision:r1'], true);
		expect(model.has('revision:r1')).toBe(false);
		model.tick(['chapter:Book 1/Draft/Chapter 1.md'], true);
		expect(model.available('revision:r1')).toBe(true);
		model.tick(['revision:r1'], true);
		expect(model.has('revision:r1')).toBe(true);
		model.tick(['chapter:Book 1/Draft/Chapter 1.md'], false);
		expect(model.has('revision:r1')).toBe(false);
		expect(model.available('revision:r1')).toBe(false);
	});

	it('reads how much of a set is ticked, and ticks what the ticked parts point at one hop out', () => {
		const model = new ImportSelectionModel(parts());
		model.tick(['character:c1'], false);
		expect(model.state(['character:c1', 'character:c2'])).toBe('some');
		expect(model.state(['character:c1'])).toBe('none');
		expect(model.state(['character:c2', 'scene:s1'])).toBe('all');
		expect(model.selectLinked()).toBe(1);
		expect(model.has('character:c1')).toBe(true);
		expect(model.selection('replace')).toEqual({ parts: new Set(model.ticked), clashPolicy: 'replace' });
	});
});

// ---- The tree ----------------------------------------------------------------------

describe('importTree', () => {
	it('lists the groups in the dialog’s order, each row standing for its parts, and leaves out an empty group', () => {
		const groups = importTree(inspection(), t);
		expect(groups.map((group) => group.id)).toEqual([
			'summary',
			'characters',
			'scenes',
			'kind:location',
			'vocabulary',
			'templates',
			'manuscript',
			'tools',
			'visualization',
		]);
		expect(groups[0]?.rows.map((row) => row.label)).toEqual(['steps.1.title']);
		expect(groups[1]?.rows.map((row) => row.label)).toEqual(['Alice', 'Bob', 'modal.import.row.pictures']);
		expect(groups[1]?.rows[2]?.keys).toEqual(['picture:Book 1/Pictures/alice.png']);
		expect(groups[3]?.title).toBe('worldbuilding.kind.location');
		expect(groups[4]?.rows.map((row) => row.label)).toEqual([
			'modal.import.vocabulary{"kind":"freeform.character","file":"modal.import.vocabulary.category"}',
		]);
		expect(groups[5]?.rows.map((row) => row.label)).toEqual(['modal.import.templates{"kind":"freeform.character"}']);
		expect(groups[6]?.title).toBe('manuscript.title');
		expect(groups[7]?.rows.map((row) => [row.id, row.keys.length])).toEqual([
			['tools:task', 1],
			['tools:foreshadowing', 1],
			['tools:revision', 1],
			['tools:sticky-note', 1],
		]);
		expect(groups[8]?.rows.map((row) => row.label)).toEqual([
			'modal.import.row.view{"name":"Board"}',
			'modal.import.row.timeline{"name":"Main"}',
			'modal.import.row.beatSheet{"name":"Act one"}',
			'modal.import.row.beatSheetTemplates',
		]);
		const few = importTree(inspection([part({ key: 'scene:s1', kind: 'scene', name: 'Opening', group: 'scene' })]), t);
		expect(few.map((group) => group.id)).toEqual(['scenes']);
	});
});

// ---- The words ---------------------------------------------------------------------

describe('the summary words', () => {
	it('counts the units in their order, few enough for the foot, and what is left unselected', () => {
		const held = inspection();
		const model = new ImportSelectionModel(held.parts);
		model.tick(['character:c1'], false);
		const words = importPlanWords(t, fakePlan(held, model.selection('skip')), model.count());
		// The six tool records are one unit: the tree counts each kind already.
		expect(words.units).toBe(
			['modal.import.summary.notes{"count":3}', 'modal.import.summary.toolRecords{"count":6}'].join(
				'modal.import.summary.separator',
			),
		);
		expect(words.unselected).toBe(1);
		model.tick(['character:c1'], true);
		// Alice stands here already: skipped she is not counted, replaced she is.
		const skipping = importPlanWords(t, fakePlan(held, model.selection('skip')), model.count());
		expect(skipping.units).toContain('modal.import.summary.notes{"count":3}');
		expect(skipping.unselected).toBe(0);
		const replacing = importPlanWords(t, fakePlan(held, model.selection('replace')), model.count());
		expect(replacing.units).toContain('modal.import.summary.notes{"count":4}');
		expect(importReplacedNames(t, fakePlan(held, model.selection('replace')))).toEqual(['Alice']);
		expect(importPlanWords(t, fakePlan(held, { parts: new Set(), clashPolicy: 'skip' }), 0).units).toBe(
			'modal.import.summary.nothing',
		);
		// Ticks that all stand here unchanged are not "nothing selected".
		const base = fakePlan(held, model.selection('replace'));
		const settled: ImportPlan = {
			...base,
			counts: Object.fromEntries(
				Object.keys(base.counts).map((kind) => [kind, { create: 0, replace: 0, skip: 1 }]),
			) as ImportPlan['counts'],
			entries: base.entries.map((entry) => ({ ...entry, action: 'skip' as const, reason: 'unchanged' as const })),
			droppedLinks: [],
			unselectedLinks: [],
		};
		const settledWords = importPlanWords(t, settled, model.count());
		expect(settledWords.units).toBe('modal.import.summary.nothingToImport');
		expect(settledWords.unselected).toBe(0);
	});

	it('sums a report the same way, and wants a report only for a skip, a dropped link or a failure', () => {
		const item = { kind: 'character' as const, key: 'character:c1', name: 'Alice', targetName: 'Alice', targetPath: null };
		expect(importReportSummary(t, report({ created: [item], replaced: [{ ...item, kind: 'scene' }] }))).toBe(
			'modal.import.summary.notes{"count":2}',
		);
		expect(importReportSummary(t, report())).toBe('modal.import.summary.nothing');
		expect(importReportWanted(report())).toBe(false);
		expect(importReportWanted(report({ skipped: [{ ...item, reason: 'unchanged' }] }))).toBe(false);
		expect(importReportWanted(report({ skipped: [{ ...item, reason: 'name-taken' }] }))).toBe(true);
		expect(importReportWanted(report({ droppedLinks: [{ owner: item, field: 'cast', target: 'Bob' }] }))).toBe(true);
		expect(importReportWanted(report({ failed: [{ ...item, message: 'disk full' }] }))).toBe(true);
	});
});

// ---- The dialog --------------------------------------------------------------------

interface DialogLike {
	dom: CorkboardDom;
	modalEl: CorkboardElement;
	contentEl: CorkboardElement;
	submit(): Promise<boolean>;
	close(): void;
}

/** Strikes Mod+Enter on a dialog's own scope, as the app's keymap would. */
const strikeModEnter = (modal: unknown): void => {
	const handler = (modal as { scope: { keys: KeymapEventHandler[] } }).scope.keys.find(
		(held) => held.key === 'Enter' && held.modifiers?.length === 1 && held.modifiers[0] === 'Mod',
	);
	if (handler === undefined) throw new Error('the dialog carries no Mod+Enter handler');
	handler.func({ isComposing: false, repeat: false } as KeyboardEvent, {});
};
const flush = async (): Promise<void> => {
	for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

async function openDialog(
	held: ImportInspection = inspection(),
	options: { initialSource?: string | null; onSubmit?: (choice: ImportChoice) => Promise<void> } = {},
): Promise<{ dialog: DialogLike; inspect: ReturnType<typeof vi.fn>; onSubmit: ReturnType<typeof vi.fn> }> {
	const inspect = vi.fn(() => Promise.resolve(held));
	const onSubmit = vi.fn(options.onSubmit ?? (() => Promise.resolve()));
	// Handed Book 1 unless the test says otherwise: an import opens on no source of its own.
	const initialSource = 'initialSource' in options ? options.initialSource : 'Book 1/Project.md';
	const modal = new ImportProjectModal(
		app,
		t,
		{
			target: { path: 'Book 2/Project.md', title: 'Book 2', locale: 'en', series: { name: 'Saga', book: 2 } },
			sources: [
				{ path: 'Other/Project.md', title: 'Other', series: null, locale: 'en', archived: false },
				{ path: 'Book 1/Project.md', title: 'Book 1', series: { name: 'Saga', book: 1 }, locale: 'en', archived: false },
				{ path: 'Far/Project.md', title: '远方', series: null, locale: 'zh-CN', archived: false },
			],
			initialSource,
			bridge: { inspect, plan: fakePlan },
		},
		onSubmit,
	);
	modal.open();
	await flush();
	const dialog = modal as unknown as DialogLike;
	dialog.dom.flushFrame();
	return { dialog, inspect, onSubmit };
}

const headers = (dialog: DialogLike): CorkboardElement[] =>
	dialog.contentEl.querySelectorAll('.snowflake-method-import-group-header');
const groupTitles = (dialog: DialogLike): string[] =>
	dialog.contentEl.querySelectorAll('.snowflake-method-import-group-title').map((title) => title.textContent);
const rows = (dialog: DialogLike): CorkboardElement[] =>
	dialog.contentEl.querySelectorAll('.snowflake-method-import-row');
/** The row's name as written: the fake keeps each element's own text, and the name sits in the last span. */
const labelOf = (row: CorkboardElement): string => {
	const name = row.querySelector('.snowflake-method-import-row-name');
	if (name === null) return '';
	return name.children[name.children.length - 1]?.textContent ?? name.textContent;
};
const rowNamed = (dialog: DialogLike, name: string): CorkboardElement => {
	const row = rows(dialog).find((candidate) => labelOf(candidate) === name);
	if (row === undefined) throw new Error(`no row ${name}`);
	return row;
};
/** The row's or the group's box. A change is what a click leaves behind in a browser, and the fake has only the change. */
const toggleOf = (element: CorkboardElement): CorkboardElement => {
	const box = element.querySelector('.snowflake-method-import-tick');
	if (box === null) throw new Error('no box');
	return box;
};
const openGroup = (dialog: DialogLike, title: string): void => {
	const fold = dialog.contentEl
		.querySelectorAll('.snowflake-method-import-fold')
		.find((button) => button.querySelector('.snowflake-method-import-group-title')?.textContent === title);
	if (fold === undefined) throw new Error(`no group ${title}`);
	fold.dispatch('click');
};
/** The summary read back as one line: the units, then each clause, which stands on a line of its own. */
const summaryText = (dialog: DialogLike): string => {
	const summary = dialog.modalEl.querySelector('.snowflake-method-import-summary');
	if (summary === null) throw new Error('no summary');
	const units = summary.querySelector('.snowflake-method-import-summary-units')?.textContent ?? '';
	const clauses = summary
		.querySelectorAll('.snowflake-method-import-summary-clause')
		.map((clause) => clause.children.map((child) => child.textContent).join(' '));
	return [units, ...clauses].join(' · ');
};
/** The source From shows, which is the title of the one held, or nothing. */
const fromValue = (dialog: DialogLike): string =>
	dialog.contentEl.querySelector('.snowflake-method-option-picker-input')?.value ?? '';
/** The dialog's own way in for a pick in From, which the fake list cannot make. */
const pickerOf = (dialog: DialogLike): { chooseSource(path: string): Promise<void> } =>
	dialog as unknown as { chooseSource(path: string): Promise<void> };
const search = (dialog: DialogLike, query: string): void => {
	const box = dialog.contentEl.querySelector('.search-input');
	if (box === null) throw new Error('no search box');
	box.value = query;
	box.dispatch('input');
};

describe('ImportProjectModal', () => {
	it('opens on no source of its own, so no project is read unasked', async () => {
		const { dialog, inspect } = await openDialog(inspection(), { initialSource: null });
		expect(inspect).not.toHaveBeenCalled();
		expect(fromValue(dialog)).toBe('');
		expect(groupTitles(dialog)).toEqual([]);
		expect(dialog.contentEl.querySelector('.snowflake-method-import-status')?.textContent).toBe('');
		expect(summaryText(dialog)).toBe('');
		expect(opened).toHaveLength(1);
	});

	it('reads the source it opens on, and draws the groups folded with their counts', async () => {
		const { dialog, inspect } = await openDialog();
		expect(inspect).toHaveBeenCalledExactlyOnceWith('Book 1/Project.md');
		expect(dialog.modalEl.classes.has('snowflake-method-import-modal')).toBe(true);
		expect(dialog.modalEl.dataset.snowflakeProject).toBe('Book 2/Project.md');
		expect(groupTitles(dialog)).toEqual([
			'modal.import.group.summary',
			'modal.import.group.characters',
			'modal.import.group.scenes',
			'worldbuilding.kind.location',
			'modal.import.group.vocabulary',
			'modal.import.group.templates',
			'manuscript.title',
			'dashboard.tasks',
			'modal.import.group.visualization',
		]);
		expect(rows(dialog)).toHaveLength(0);
		const counts = dialog.contentEl
			.querySelectorAll('.snowflake-method-import-group-count')
			.map((count) => count.textContent);
		expect(counts[1]).toBe('modal.import.groupCount{"selected":2,"count":3}');
		expect(counts[6]).toBe('modal.import.groupCount{"selected":0,"count":2}');
		// Alice stands here already and the policy skips her: the foot counts
		// the three notes that come, and her row's mark says why not four.
		expect(summaryText(dialog)).toContain('modal.import.summary.notes{"count":3}');
		expect(summaryText(dialog)).not.toContain('skipped');
		const summary = dialog.modalEl.querySelector('.snowflake-method-import-summary');
		expect(summary?.children.map((line) => [...line.classes][0])).toEqual(['snowflake-method-import-summary-units']);
	});

	it('opens on the source it was handed, and on none when handed none, even with one project offered', async () => {
		const named = await openDialog(inspection(), { initialSource: 'Other/Project.md' });
		expect(named.inspect).toHaveBeenCalledExactlyOnceWith('Other/Project.md');
		const inspect = vi.fn(() => Promise.resolve(inspection()));
		new ImportProjectModal(
			app,
			t,
			{
				target: { path: 'Book 2/Project.md', title: 'Book 2', locale: 'en', series: null },
				sources: [{ path: 'Other/Project.md', title: 'Other', series: null, locale: 'en', archived: false }],
				bridge: { inspect, plan: fakePlan },
			},
			() => Promise.resolve(),
		).open();
		await flush();
		expect(inspect).not.toHaveBeenCalled();
	});

	it('marks a copy that still matches its source as up to date, which no policy replaces', async () => {
		const { dialog } = await openDialog(
			inspection(parts(), [['character:c1', { kind: 'unchanged', targetId: 'x1', targetPath: 'Book 2/Characters/Alice.md', targetName: 'Alice' }]]),
		);
		openGroup(dialog, 'modal.import.group.characters');
		const alice = rowNamed(dialog, 'Alice');
		expect(alice.querySelector('.snowflake-method-import-row-mark')?.textContent).toBe('modal.import.mark.upToDate');
		const select = dialog.contentEl.querySelector('select');
		if (select === null) throw new Error('no policy dropdown');
		select.value = 'replace';
		select.dispatch('change');
		const still = rowNamed(dialog, 'Alice');
		expect(still.classes.has('is-replaced')).toBe(false);
		expect(still.querySelector('.snowflake-method-import-row-mark')?.textContent).toBe('modal.import.mark.upToDate');
	});

	it('draws the rows of a group when it opens, marks a note already here, and the policy turns the mark', async () => {
		const { dialog } = await openDialog();
		openGroup(dialog, 'modal.import.group.characters');
		expect(rows(dialog).map(labelOf)).toEqual(['Alice', 'Bob', 'modal.import.row.pictures']);
		const alice = rowNamed(dialog, 'Alice');
		expect(alice.classes.has('is-here')).toBe(true);
		expect(alice.querySelector('.snowflake-method-import-row-mark')?.textContent).toBe('modal.import.mark.here');
		expect(toggleOf(alice).checked).toBe(true);
		const select = dialog.contentEl.querySelector('select');
		if (select === null) throw new Error('no policy dropdown');
		select.value = 'replace';
		select.dispatch('change');
		const replaced = rowNamed(dialog, 'Alice');
		expect(replaced.classes.has('is-replaced')).toBe(true);
		expect(replaced.querySelector('.snowflake-method-import-row-mark')?.textContent).toBe('modal.import.mark.replace');
		// The policy moved no tick.
		expect(toggleOf(replaced).checked).toBe(true);
		const policyRow = select.closest('.setting-item');
		expect(policyRow?.classes.has('is-replacing')).toBe(true);
		dialog.dom.flushFrame();
		expect(summaryText(dialog)).toContain('modal.import.summary.notes{"count":4}');
	});

	it('keeps a revision out of reach until a chapter is ticked, and lets the name flip a row', async () => {
		const { dialog } = await openDialog();
		openGroup(dialog, 'dashboard.tasks');
		const revisions = rowNamed(dialog, 'tasks.tab.revision');
		expect(revisions.classes.has('is-unavailable')).toBe(true);
		expect(toggleOf(revisions).disabled).toBe(true);
		expect(revisions.querySelector('.snowflake-method-import-row-mark')?.textContent).toBe(
			'modal.import.mark.needsManuscript',
		);
		openGroup(dialog, 'manuscript.title');
		rowNamed(dialog, 'Chapter 1').querySelector('.snowflake-method-import-row-name')?.dispatch('click');
		expect(toggleOf(rowNamed(dialog, 'Chapter 1')).checked).toBe(true);
		expect(rowNamed(dialog, 'tasks.tab.revision').classes.has('is-unavailable')).toBe(false);
		toggleOf(rowNamed(dialog, 'tasks.tab.revision')).dispatch('change');
		expect(toggleOf(rowNamed(dialog, 'tasks.tab.revision')).checked).toBe(true);
		rowNamed(dialog, 'Chapter 1').querySelector('.snowflake-method-import-row-name')?.dispatch('click');
		expect(toggleOf(rowNamed(dialog, 'tasks.tab.revision')).checked).toBe(false);
		dialog.dom.flushFrame();
		expect(summaryText(dialog)).not.toContain('chapters');
	});

	it('takes a group whole or lets it go, and a search narrows what the group’s box takes', async () => {
		const { dialog } = await openDialog();
		const characters = headers(dialog)[1];
		if (characters === undefined) throw new Error('no characters header');
		// Two of three ticked: the box shows a dash, and a change on a dash takes the whole.
		expect(toggleOf(characters).indeterminate).toBe(true);
		toggleOf(characters).dispatch('change');
		expect(headers(dialog)[1]?.querySelector('.snowflake-method-import-group-count')?.textContent).toBe(
			'modal.import.groupCount{"selected":3,"count":3}',
		);
		expect(toggleOf(headers(dialog)[1] as CorkboardElement).checked).toBe(true);
		toggleOf(headers(dialog)[1] as CorkboardElement).dispatch('change');
		expect(headers(dialog)[1]?.querySelector('.snowflake-method-import-group-count')?.textContent).toBe(
			'modal.import.groupCount{"selected":0,"count":3}',
		);
		expect(toggleOf(headers(dialog)[1] as CorkboardElement).checked).toBe(false);
		search(dialog, 'bob');
		expect(groupTitles(dialog)).toEqual(['modal.import.group.characters']);
		expect(rows(dialog).map(labelOf)).toEqual(['Bob']);
		toggleOf(headers(dialog)[0] as CorkboardElement).dispatch('change');
		search(dialog, '');
		openGroup(dialog, 'modal.import.group.characters');
		expect(toggleOf(rowNamed(dialog, 'Bob')).checked).toBe(true);
		expect(toggleOf(rowNamed(dialog, 'Alice')).checked).toBe(false);
		expect(toggleOf(headers(dialog)[1] as CorkboardElement).indeterminate).toBe(true);
		search(dialog, 'nothing of the kind');
		expect(groupTitles(dialog)).toEqual([]);
		expect(dialog.contentEl.querySelector('.snowflake-method-import-status')?.textContent).toBe('modal.import.noMatches');
	});

	it('offers to select the notes the ticked ones point at, one hop at a time', async () => {
		const { dialog } = await openDialog();
		openGroup(dialog, 'modal.import.group.characters');
		toggleOf(rowNamed(dialog, 'Alice')).dispatch('change');
		dialog.dom.flushFrame();
		expect(summaryText(dialog)).toContain('modal.import.summary.unselectedLinksOne{"count":1}');
		const select = dialog.modalEl.querySelector('.snowflake-method-import-select-linked');
		if (select === null) throw new Error('no select-them button');
		select.dispatch('click');
		expect(toggleOf(rowNamed(dialog, 'Alice')).checked).toBe(true);
		expect(summaryText(dialog)).not.toContain('unselectedLinks');
	});

	it('refuses to submit nothing, and hands over the source and the ticks with the policy', async () => {
		const { dialog, onSubmit } = await openDialog();
		// The tree is repainted on every change, so each header is read afresh;
		// a box with a dash goes to a tick first, as the browser's does.
		for (let i = 0; i < headers(dialog).length; i += 1) {
			const box = (): CorkboardElement => toggleOf(headers(dialog)[i] as CorkboardElement);
			if (box().indeterminate) box().dispatch('change');
			if (box().checked) box().dispatch('change');
		}
		expect(await dialog.submit()).toBe(false);
		expect(notices).toHaveBeenLastCalledWith('modal.import.summary.nothing');
		expect(onSubmit).not.toHaveBeenCalled();
		expect(opened).toHaveLength(1);
		openGroup(dialog, 'modal.import.group.scenes');
		toggleOf(rowNamed(dialog, 'Opening')).dispatch('change');
		const submitting = dialog.submit();
		await flush();
		const confirm = opened[opened.length - 1] as { contentEl: CorkboardElement; title: string };
		expect(confirm.title).toBe('modal.importConfirm.title{"source":"Book 1"}');
		confirm.contentEl.querySelectorAll('button')[1]?.dispatch('click');
		expect(await submitting).toBe(true);
		expect(onSubmit).toHaveBeenCalledOnce();
		const choice = onSubmit.mock.calls[0]?.[0] as ImportChoice;
		expect(choice.sourcePath).toBe('Book 1/Project.md');
		expect([...choice.selection.parts]).toEqual(['scene:s1']);
		expect(choice.selection.clashPolicy).toBe('skip');
	});

	it('confirms a replace first, names what is written over, and a refusal keeps the dialog open', async () => {
		const { dialog, onSubmit } = await openDialog();
		const closed = vi.spyOn(dialog, 'close');
		const select = dialog.contentEl.querySelector('select');
		if (select === null) throw new Error('no policy dropdown');
		select.value = 'replace';
		select.dispatch('change');
		const submitting = dialog.submit();
		await flush();
		const confirm = opened[opened.length - 1] as { contentEl: CorkboardElement; title: string };
		expect(confirm).not.toBe(dialog);
		expect(confirm.title).toBe('modal.importReplace.titleOne{"count":1}');
		expect(confirm.contentEl.querySelectorAll('li').map((item) => item.textContent)).toEqual(['Alice']);
		const buttons = confirm.contentEl.querySelectorAll('button');
		buttons[0]?.dispatch('click');
		expect(await submitting).toBe(false);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(closed).not.toHaveBeenCalled();
		const again = dialog.submit();
		await flush();
		const second = opened[opened.length - 1] as { contentEl: CorkboardElement };
		second.contentEl.querySelectorAll('button')[1]?.dispatch('click');
		expect(await again).toBe(true);
		expect(onSubmit).toHaveBeenCalledOnce();
		expect((onSubmit.mock.calls[0]?.[0] as ImportChoice).selection.clashPolicy).toBe('replace');
		expect(closed).toHaveBeenCalled();
	});

	it('confirms every import, since none can be undone, and a refusal keeps the dialog open', async () => {
		const { dialog, onSubmit } = await openDialog();
		const closed = vi.spyOn(dialog, 'close');
		const submitting = dialog.submit();
		await flush();
		const confirm = opened[opened.length - 1] as { contentEl: CorkboardElement; title: string };
		expect(confirm).not.toBe(dialog);
		expect(confirm.title).toBe('modal.importConfirm.title{"source":"Book 1"}');
		expect(confirm.contentEl.querySelectorAll('p').map((line) => line.textContent)).toEqual([
			'modal.importConfirm.note{"source":"Book 1"}',
		]);
		const buttons = confirm.contentEl.querySelectorAll('button');
		expect(buttons.map((button) => button.textContent)).toEqual(['common.cancel', 'modal.import.submit']);
		expect(buttons[1]?.classes.has('mod-cta')).toBe(true);
		buttons[0]?.dispatch('click');
		expect(await submitting).toBe(false);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(closed).not.toHaveBeenCalled();
	});

	it('points out a source in the other language when it is picked, and declining keeps the one held', async () => {
		const { dialog, inspect } = await openDialog();
		expect(fromValue(dialog)).toBe('Book 1');
		const declined = pickerOf(dialog).chooseSource('Far/Project.md');
		await flush();
		const notice = opened[opened.length - 1] as { contentEl: CorkboardElement; title: string };
		expect(notice).not.toBe(dialog);
		expect(notice.title).toBe('modal.importLanguage.title');
		expect(notice.contentEl.querySelectorAll('p').map((line) => line.textContent)).toEqual([
			'modal.importLanguage.note{"source":"远方","language":"modal.importLanguage.zh-CN","own":"modal.importLanguage.en"}',
		]);
		const buttons = notice.contentEl.querySelectorAll('button');
		expect(buttons.map((button) => button.textContent)).toEqual(['common.cancel', 'modal.importLanguage.confirm']);
		buttons[0]?.dispatch('click');
		await declined;
		expect(inspect).toHaveBeenCalledExactlyOnceWith('Book 1/Project.md');
		expect(fromValue(dialog)).toBe('Book 1');

		const accepted = pickerOf(dialog).chooseSource('Far/Project.md');
		await flush();
		(opened[opened.length - 1] as { contentEl: CorkboardElement }).contentEl.querySelectorAll('button')[1]?.dispatch('click');
		await accepted;
		expect(inspect).toHaveBeenLastCalledWith('Far/Project.md');
		expect(fromValue(dialog)).toBe('远方');

		// A source in this project's own language is read without a word.
		const count = opened.length;
		await pickerOf(dialog).chooseSource('Other/Project.md');
		expect(opened).toHaveLength(count);
		expect(inspect).toHaveBeenLastCalledWith('Other/Project.md');
		expect(fromValue(dialog)).toBe('Other');
	});

	it('points out a source in the other language the dialog opens on, and declining leaves From empty', async () => {
		const { dialog, inspect } = await openDialog(inspection(), { initialSource: 'Far/Project.md' });
		const notice = opened[opened.length - 1] as { contentEl: CorkboardElement; title: string };
		expect(notice).not.toBe(dialog);
		expect(notice.title).toBe('modal.importLanguage.title');
		expect(inspect).not.toHaveBeenCalled();
		notice.contentEl.querySelectorAll('button')[0]?.dispatch('click');
		await flush();
		expect(inspect).not.toHaveBeenCalled();
		expect(fromValue(dialog)).toBe('');
		expect(dialog.contentEl.querySelector('.snowflake-method-import-status')?.textContent).toBe('');
		expect(await dialog.submit()).toBe(false);
		expect(notices).toHaveBeenLastCalledWith('modal.import.chooseSource');
		expect(opened).toHaveLength(2);
	});

	it('answers Mod+Enter in its confirmations as the dialog does', async () => {
		const { dialog, inspect, onSubmit } = await openDialog();
		// The language notice: the chord is Continue.
		const accepted = pickerOf(dialog).chooseSource('Far/Project.md');
		await flush();
		strikeModEnter(opened[opened.length - 1]);
		await accepted;
		expect(inspect).toHaveBeenLastCalledWith('Far/Project.md');
		expect(fromValue(dialog)).toBe('远方');
		// The run confirmation: the chord is Import.
		const submitting = dialog.submit();
		await flush();
		expect((opened[opened.length - 1] as { title: string }).title).toBe('modal.importConfirm.title{"source":"远方"}');
		strikeModEnter(opened[opened.length - 1]);
		expect(await submitting).toBe(true);
		expect(onSubmit).toHaveBeenCalledOnce();
		// The replace confirmation: the chord is Replace.
		const second = await openDialog();
		const select = second.dialog.contentEl.querySelector('select');
		if (select === null) throw new Error('no policy dropdown');
		select.value = 'replace';
		select.dispatch('change');
		const replacing = second.dialog.submit();
		await flush();
		expect((opened[opened.length - 1] as { title: string }).title).toBe('modal.importReplace.titleOne{"count":1}');
		strikeModEnter(opened[opened.length - 1]);
		expect(await replacing).toBe(true);
		expect((second.onSubmit.mock.calls[0]?.[0] as ImportChoice).selection.clashPolicy).toBe('replace');
	});

	it('tells of a source that could not be read, and an empty one', async () => {
		const inspect = vi.fn(() => Promise.reject(new Error('cannot read')));
		new ImportProjectModal(
			app,
			t,
			{
				target: { path: 'Book 2/Project.md', title: 'Book 2', locale: 'en', series: null },
				sources: [{ path: 'Other/Project.md', title: 'Other', series: null, locale: 'en', archived: false }],
				initialSource: 'Other/Project.md',
				bridge: { inspect, plan: fakePlan },
			},
			() => Promise.resolve(),
		).open();
		await flush();
		expect(notices).toHaveBeenLastCalledWith('cannot read');
		const { dialog } = await openDialog(inspection([]));
		expect(dialog.contentEl.querySelector('.snowflake-method-import-status')?.textContent).toBe('modal.import.empty');
	});
});

// ---- Update mode -------------------------------------------------------------------

/** Book 2 against Book 1: Alice changed there, Bob changed in both, Carol new, Dave gone, the Harbor as it was. */
function updateInspection(): ImportInspection {
	const held = [
		part({ key: 'step:1', kind: 'step', name: 'Step 1' }),
		part({ key: 'character:c1', kind: 'character', name: 'Alice', group: 'character' }),
		part({ key: 'character:c2', kind: 'character', name: 'Bob', group: 'character' }),
		part({ key: 'character:c3', kind: 'character', name: 'Carol', group: 'character' }),
		part({ key: 'worldbuilding:w1', kind: 'worldbuilding', name: 'Harbor', group: 'location' }),
		part({ key: 'vocabulary:character/category/Hero', kind: 'vocabulary', name: 'Hero', bucket: 'character/category' }),
		part({ key: 'scene:s1', kind: 'scene', name: 'Opening', group: 'scene' }),
		part({ key: 'chapter:Book 1/Draft/Chapter 1.md', kind: 'chapter', name: 'Chapter 1', defaultSelected: false }),
		part({ key: 'task:t1', kind: 'task', name: 'Fix the ending' }),
	];
	const copy = (kind: Exclude<ImportStanding['kind'], 'new'>, name: string): ImportStanding => ({
		kind,
		targetId: `t-${name}`,
		targetPath: `Book 2/${name}.md`,
		targetName: name,
	});
	return {
		parts: held,
		standing: new Map<string, ImportStanding>([
			['step:1', copy('update', 'Step 1')],
			['character:c1', copy('update', 'Alice')],
			['character:c2', copy('conflict', 'Bob')],
			['worldbuilding:w1', copy('unchanged', 'Harbor')],
			['vocabulary:character/category/Hero', copy('unchanged', 'Hero')],
			['scene:s1', copy('existing', 'Opening')],
			['task:t1', copy('unchanged', 'Fix the ending')],
		]),
		gone: [
			{ kind: 'character', name: 'Dave', targetId: 't-Dave', targetPath: 'Book 2/Dave.md' },
			{ kind: 'chapter', name: 'Old chapter', targetId: null, targetPath: 'Book 2/Draft/Old.md' },
		],
		source: { project: { kinds: [{ id: 'location' }] } },
	} as unknown as ImportInspection;
}

describe('updateTree', () => {
	it('sorts the design parts by their standing, ticks the sibling’s own changes, counts what matches and names the gone', () => {
		const tree = updateTree(updateInspection(), t, 'Book 1');
		expect(tree.groups.map((group) => [group.id, group.title])).toEqual([
			['changed', 'modal.import.update.changed{"book":"Book 1"}'],
			['conflict', 'modal.import.update.conflict'],
			['new', 'modal.import.update.new{"book":"Book 1"}'],
			['gone', 'modal.import.update.gone{"book":"Book 1"}'],
		]);
		const rows = (id: string) => tree.groups.find((group) => group.id === id)?.rows ?? [];
		expect(rows('changed').map((row) => `${row.prefix ?? ''} · ${row.label}`)).toEqual([
			'modal.import.group.summary · steps.1.title',
			'freeform.character · Alice',
		]);
		expect(rows('conflict').map((row) => [row.label, row.note])).toEqual([['Bob', 'edited']]);
		expect(rows('new').map((row) => [row.label, row.note])).toEqual([
			['Carol', null],
			['Opening', 'here'],
		]);
		// The chapter gone from the sibling is a one-shot kind, and not the update's business.
		expect(rows('gone').map((row) => [row.label, row.note, row.keys.length, row.prefix])).toEqual([
			['Dave', 'gone', 0, 'freeform.character'],
		]);
		expect([...tree.initial]).toEqual(['step:1', 'character:c1']);
		expect(tree.unchanged).toBe(2);
	});
});

async function openUpdate(
	held: ImportInspection = updateInspection(),
	overrides: Partial<ImportDialogConfig> = {},
): Promise<{ dialog: DialogLike; inspect: ReturnType<typeof vi.fn>; onSubmit: ReturnType<typeof vi.fn>; title: () => string }> {
	const inspect = vi.fn(() => Promise.resolve(held));
	const onSubmit = vi.fn(() => Promise.resolve());
	const modal = new ImportProjectModal(
		app,
		t,
		{
			mode: 'update',
			target: { path: 'Book 3/Project.md', title: 'Book 3', locale: 'en', series: { name: 'Saga', book: 3 } },
			sources: [
				{ path: 'Book 2/Project.md', title: 'Book 2', series: { name: 'Saga', book: 2 }, locale: 'en', archived: false },
				{ path: 'Book 1/Project.md', title: 'Book 1', series: { name: 'Saga', book: 1 }, locale: 'en', archived: false },
			],
			bridge: { inspect, plan: fakePlan },
			...overrides,
		},
		onSubmit,
	);
	modal.open();
	await flush();
	const dialog = modal as unknown as DialogLike;
	dialog.dom.flushFrame();
	return { dialog, inspect, onSubmit, title: () => (modal as unknown as { title: string }).title };
}

describe('ImportProjectModal in update mode', () => {
	it('opens on the lowest book under that book’s name, without a policy row, the note under From', async () => {
		const { dialog, inspect, title } = await openUpdate();
		expect(title()).toBe('modal.import.updateTitle{"book":"Book 1"}');
		expect(inspect).toHaveBeenCalledExactlyOnceWith('Book 1/Project.md');
		expect(dialog.modalEl.classes.has('is-updating')).toBe(true);
		expect(dialog.contentEl.querySelector('select')).toBeNull();
		expect(dialog.contentEl.querySelector('.snowflake-method-import-note')?.textContent).toBe(
			'modal.import.updateNote{"book":"Book 1"}',
		);
		expect(dialog.modalEl.querySelectorAll('button').map((button) => button.textContent)).toContain(
			'modal.import.updateSubmit',
		);
		const named = await openUpdate(updateInspection(), { initialSource: 'Book 2/Project.md' });
		expect(named.title()).toBe('modal.import.updateTitle{"book":"Book 2"}');
	});

	it('draws the four sections, the sibling’s changes ticked, the gone rows without a toggle, and sums it at the foot', async () => {
		const { dialog } = await openUpdate();
		expect(groupTitles(dialog)).toEqual([
			'modal.import.update.changed{"book":"Book 1"}',
			'modal.import.update.conflict',
			'modal.import.update.new{"book":"Book 1"}',
			'modal.import.update.gone{"book":"Book 1"}',
		]);
		const counts = dialog.contentEl
			.querySelectorAll('.snowflake-method-import-group-count')
			.map((count) => count.textContent);
		expect(counts).toEqual([
			'modal.import.groupCount{"selected":2,"count":2}',
			'modal.import.groupCount{"selected":0,"count":1}',
			'modal.import.groupCount{"selected":0,"count":2}',
			'1',
		]);
		expect(headers(dialog).map((header) => header.querySelector('.snowflake-method-import-tick') !== null)).toEqual([
			true,
			true,
			true,
			false,
		]);
		openGroup(dialog, 'modal.import.update.gone{"book":"Book 1"}');
		const dave = rowNamed(dialog, 'Dave');
		expect(dave.classes.has('is-gone')).toBe(true);
		expect(dave.querySelector('.snowflake-method-import-tick')).toBeNull();
		expect(dave.querySelector('.snowflake-method-import-tick-blank')).not.toBeNull();
		expect(dave.querySelector('.snowflake-method-import-row-mark')?.textContent).toBe('modal.import.mark.kept');
		openGroup(dialog, 'modal.import.update.new{"book":"Book 1"}');
		const opening = rowNamed(dialog, 'Opening');
		expect(opening.classes.has('is-here')).toBe(true);
		expect(opening.querySelector('.snowflake-method-import-row-mark')?.textContent).toBe('modal.import.mark.here');
		openGroup(dialog, 'modal.import.update.changed{"book":"Book 1"}');
		expect(rowNamed(dialog, 'Alice').querySelector('.snowflake-method-import-row-prefix')?.textContent).toBe(
			'freeform.character · ',
		);
		expect(toggleOf(rowNamed(dialog, 'Alice')).checked).toBe(true);
		expect(summaryText(dialog)).toBe('modal.import.update.summary{"count":2}');
	});

	it('reads a sibling in the other language without a word when it chose that sibling itself', async () => {
		const { inspect } = await openUpdate(updateInspection(), {
			sources: [
				{ path: 'Book 2/Project.md', title: 'Book 2', series: { name: 'Saga', book: 2 }, locale: 'en', archived: false },
				{ path: 'Book 1/Project.md', title: '第一卷', series: { name: 'Saga', book: 1 }, locale: 'zh-CN', archived: false },
			],
		});
		expect(opened).toHaveLength(1);
		expect(inspect).toHaveBeenCalledExactlyOnceWith('Book 1/Project.md');
	});

	it('confirms the update, names the edited copies only when they are ticked, and hands the ticks over as a replace', async () => {
		const { dialog, onSubmit } = await openUpdate();
		await flush();
		const updating = dialog.submit();
		await flush();
		expect(opened).toHaveLength(2);
		const asked = opened[opened.length - 1] as { contentEl: CorkboardElement; title: string };
		expect(asked.title).toBe('modal.updateConfirm.title{"source":"Book 1"}');
		expect(asked.contentEl.querySelectorAll('p').map((line) => line.textContent)).toEqual([
			'modal.updateConfirm.note{"source":"Book 1"}',
		]);
		expect(asked.contentEl.querySelectorAll('button')[1]?.textContent).toBe('modal.import.updateSubmit');
		// The chord answers an update's confirmation as it answers an import's.
		strikeModEnter(asked);
		expect(await updating).toBe(true);
		const choice = onSubmit.mock.calls[0]?.[0] as ImportChoice;
		expect(choice).toMatchObject({ sourcePath: 'Book 1/Project.md', mode: 'update' });
		expect(choice.selection.clashPolicy).toBe('replace');
		expect([...choice.selection.parts]).toEqual(['step:1', 'character:c1']);

		const second = await openUpdate();
		openGroup(second.dialog, 'modal.import.update.conflict');
		toggleOf(rowNamed(second.dialog, 'Bob')).dispatch('change');
		expect(rowNamed(second.dialog, 'Bob').classes.has('is-replaced')).toBe(true);
		second.dialog.dom.flushFrame();
		expect(summaryText(second.dialog)).toBe(
			'modal.import.update.summary{"count":3} · modal.import.update.editedOne{"count":1}',
		);
		const submitting = second.dialog.submit();
		await flush();
		const confirm = opened[opened.length - 1] as { contentEl: CorkboardElement; title: string };
		expect(confirm.title).toBe('modal.importReplace.titleOne{"count":1}');
		expect(confirm.contentEl.querySelectorAll('li').map((item) => item.textContent)).toEqual(['Bob']);
		confirm.contentEl.querySelectorAll('button')[1]?.dispatch('click');
		expect(await submitting).toBe(true);
		expect([...(second.onSubmit.mock.calls[0]?.[0] as ImportChoice).selection.parts]).toEqual([
			'step:1',
			'character:c1',
			'character:c2',
		]);
	});

	it('says everything is up to date when nothing differs', async () => {
		const held = {
			...updateInspection(),
			parts: [part({ key: 'worldbuilding:w1', kind: 'worldbuilding', name: 'Harbor', group: 'location' })],
			gone: [],
		} as unknown as ImportInspection;
		const { dialog } = await openUpdate(held);
		expect(groupTitles(dialog)).toEqual([]);
		expect(dialog.contentEl.querySelector('.snowflake-method-import-status')?.textContent).toBe(
			'modal.import.update.nothing{"book":"Book 1"}',
		);
		expect(summaryText(dialog)).toBe('modal.import.update.nothing{"book":"Book 1"}');
		expect(await dialog.submit()).toBe(false);
		expect(notices).toHaveBeenLastCalledWith('modal.import.summary.nothing');
	});
});

describe('ImportReportModal', () => {
	it('sums the run and lists what was skipped, dropped and failed, each with its reason', () => {
		const item = { kind: 'character' as const, key: 'character:c1', name: 'Alice', targetName: 'Alice', targetPath: null };
		const modal = new ImportReportModal(
			app,
			t,
			report({
				created: [item],
				skipped: [
					{ ...item, name: 'Bob', reason: 'name-taken' },
					{ ...item, name: 'Carol', reason: 'unchanged' },
					{ ...item, name: 'Revision 1', kind: 'revision', reason: 'no-chapter' },
				],
				droppedLinks: [
					{ owner: item, field: 'cast', target: 'Dave' },
					{ owner: item, field: 'file', target: '80_Material/Figure.png' },
				],
				failed: [{ ...item, name: 'Eve', message: 'disk full' }],
			}),
		);
		modal.open();
		const content = (modal as unknown as DialogLike).contentEl;
		expect((modal as unknown as DialogLike).modalEl.classes.has('snowflake-method-dialog')).toBe(true);
		expect(content.querySelector('p')?.textContent).toBe(
			'modal.importReport.summary{"summary":"modal.import.summary.notesOne{\\"count\\":1}","source":"Book 1"}',
		);
		expect(content.querySelectorAll('h3').map((heading) => heading.textContent)).toEqual([
			'modal.importReport.skipped',
			'modal.importReport.dropped',
			'modal.importReport.failed',
		]);
		const lines = content
			.querySelectorAll('li')
			.map((line) => line.children.map((child) => child.textContent).join(' | '));
		expect(lines).toEqual([
			'Bob | modal.importReport.reason.exists',
			'Revision 1 | modal.importReport.reason.noChapter',
			'Alice → Dave | modal.importReport.reason.missingTarget',
			'Alice → 80_Material/Figure.png | modal.importReport.reason.missingFile',
			'Eve | disk full',
		]);
		expect(content.querySelectorAll('button').map((button) => button.textContent)).toEqual(['common.close']);
	});

	it('says that nothing was imported rather than counting nothing', () => {
		const item = { kind: 'character' as const, key: 'character:c1', name: 'Bob', targetName: 'Bob', targetPath: null };
		const modal = new ImportReportModal(app, t, report({ skipped: [{ ...item, reason: 'name-taken' }] }));
		modal.open();
		const content = (modal as unknown as { contentEl: CorkboardElement }).contentEl;
		expect(content.querySelector('p')?.textContent).toBe('modal.importReport.nothing{"source":"Book 1"}');
	});
});
