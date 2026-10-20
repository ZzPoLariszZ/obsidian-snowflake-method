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
	class ToggleComponent {
		readonly toggleEl: CorkboardElement;
		private value = false;
		private handler: ((on: boolean) => void) | null = null;
		constructor(container: CorkboardElement) {
			this.toggleEl = container.createDiv({ cls: 'checkbox-container' });
			this.toggleEl.addEventListener('click', () => {
				if (this.toggleEl.disabled) return;
				this.setValue(!this.value);
				this.handler?.(this.value);
			});
		}
		setValue(on: boolean): this { this.value = on; this.toggleEl.toggleClass('is-enabled', on); return this; }
		getValue(): boolean { return this.value; }
		setDisabled(disabled: boolean): this { this.toggleEl.disabled = disabled; return this; }
		onChange(handler: (on: boolean) => void): this { this.handler = handler; return this; }
	}
	return {
		...runtime,
		Modal,
		Setting,
		SearchComponent,
		ToggleComponent,
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

import type { App } from 'obsidian';

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
	type ImportChoice,
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
	it('counts the units in their order, then what is skipped, replaced, dropped and left unselected', () => {
		const held = inspection();
		const model = new ImportSelectionModel(held.parts);
		model.tick(['character:c1'], false);
		const words = importPlanWords(t, fakePlan(held, model.selection('skip')), model.count());
		expect(words.units).toBe(
			[
				'modal.import.summary.notes{"count":3}',
				'modal.import.summary.timelinesOne{"count":1}',
				'modal.import.summary.beatSheetsOne{"count":1}',
				'modal.import.summary.viewsOne{"count":1}',
				'modal.import.summary.tasksOne{"count":1}',
				'modal.import.summary.foreshadowingOne{"count":1}',
				'modal.import.summary.stickyNotesOne{"count":1}',
			].join(', '),
		);
		expect(words.clauses).toEqual([]);
		expect(words.unselected).toBe(1);
		model.tick(['character:c1'], true);
		const skipping = importPlanWords(t, fakePlan(held, model.selection('skip')), model.count());
		expect(skipping.clauses).toEqual(['modal.import.summary.skippedOne{"count":1}']);
		expect(skipping.unselected).toBe(0);
		const replacing = importPlanWords(t, fakePlan(held, model.selection('replace')), model.count());
		expect(replacing.units).toContain('modal.import.summary.notes{"count":4}');
		expect(replacing.clauses).toEqual(['modal.import.summary.replacedOne{"count":1}']);
		expect(importReplacedNames(t, fakePlan(held, model.selection('replace')))).toEqual(['Alice']);
		expect(importPlanWords(t, fakePlan(held, { parts: new Set(), clashPolicy: 'skip' }), 0).units).toBe(
			'modal.import.summary.nothing',
		);
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

const flush = async (): Promise<void> => {
	for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

async function openDialog(
	held: ImportInspection = inspection(),
	options: { initialSource?: string | null; onSubmit?: (choice: ImportChoice) => Promise<void> } = {},
): Promise<{ dialog: DialogLike; inspect: ReturnType<typeof vi.fn>; onSubmit: ReturnType<typeof vi.fn> }> {
	const inspect = vi.fn(() => Promise.resolve(held));
	const onSubmit = vi.fn(options.onSubmit ?? (() => Promise.resolve()));
	const modal = new ImportProjectModal(
		app,
		t,
		{
			target: { path: 'Book 2/Project.md', title: 'Book 2', series: { name: 'Saga', book: 2 } },
			sources: [
				{ path: 'Other/Project.md', title: 'Other', series: null, archived: false },
				{ path: 'Book 1/Project.md', title: 'Book 1', series: { name: 'Saga', book: 1 }, archived: false },
			],
			initialSource: options.initialSource,
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
const rowNamed = (dialog: DialogLike, name: string): CorkboardElement => {
	const row = rows(dialog).find(
		(candidate) => candidate.querySelector('.snowflake-method-import-row-name')?.textContent === name,
	);
	if (row === undefined) throw new Error(`no row ${name}`);
	return row;
};
const toggleOf = (element: CorkboardElement): CorkboardElement => {
	const toggle = element.querySelector('.checkbox-container');
	if (toggle === null) throw new Error('no toggle');
	return toggle;
};
const openGroup = (dialog: DialogLike, title: string): void => {
	const fold = dialog.contentEl
		.querySelectorAll('.snowflake-method-import-fold')
		.find((button) => button.querySelector('.snowflake-method-import-group-title')?.textContent === title);
	if (fold === undefined) throw new Error(`no group ${title}`);
	fold.dispatch('click');
};
const summaryText = (dialog: DialogLike): string => {
	const summary = dialog.modalEl.querySelector('.snowflake-method-import-summary');
	if (summary === null) throw new Error('no summary');
	return summary.children.map((child) => child.textContent).join('');
};
const search = (dialog: DialogLike, query: string): void => {
	const box = dialog.contentEl.querySelector('.search-input');
	if (box === null) throw new Error('no search box');
	box.value = query;
	box.dispatch('input');
};

describe('ImportProjectModal', () => {
	it('opens on the series’ lowest book, reads the source, and draws the groups folded with their counts', async () => {
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
		// Alice stands here already and the policy skips her, which the foot says.
		expect(summaryText(dialog)).toContain('modal.import.summary.notes{"count":3}');
		expect(summaryText(dialog)).toContain(' · modal.import.summary.skippedOne{"count":1}');
	});

	it('opens on the source it was handed, and the first offered when the target is in no series', async () => {
		const named = await openDialog(inspection(), { initialSource: 'Other/Project.md' });
		expect(named.inspect).toHaveBeenCalledExactlyOnceWith('Other/Project.md');
		const inspect = vi.fn(() => Promise.resolve(inspection()));
		new ImportProjectModal(
			app,
			t,
			{
				target: { path: 'Book 2/Project.md', title: 'Book 2', series: null },
				sources: [{ path: 'Other/Project.md', title: 'Other', series: null, archived: false }],
				bridge: { inspect, plan: fakePlan },
			},
			() => Promise.resolve(),
		).open();
		await flush();
		expect(inspect).toHaveBeenCalledExactlyOnceWith('Other/Project.md');
	});

	it('draws the rows of a group when it opens, marks a note already here, and the policy turns the mark', async () => {
		const { dialog } = await openDialog();
		openGroup(dialog, 'modal.import.group.characters');
		const names = rows(dialog).map((row) => row.querySelector('.snowflake-method-import-row-name')?.textContent);
		expect(names).toEqual(['Alice', 'Bob', 'modal.import.row.pictures']);
		const alice = rowNamed(dialog, 'Alice');
		expect(alice.classes.has('is-here')).toBe(true);
		expect(alice.querySelector('.snowflake-method-import-row-mark')?.textContent).toBe('modal.import.mark.here');
		expect(toggleOf(alice).classes.has('is-enabled')).toBe(true);
		const select = dialog.contentEl.querySelector('select');
		if (select === null) throw new Error('no policy dropdown');
		select.value = 'replace';
		select.dispatch('change');
		const replaced = rowNamed(dialog, 'Alice');
		expect(replaced.classes.has('is-replaced')).toBe(true);
		expect(replaced.querySelector('.snowflake-method-import-row-mark')?.textContent).toBe('modal.import.mark.replace');
		// The policy moved no tick.
		expect(toggleOf(replaced).classes.has('is-enabled')).toBe(true);
		const policyRow = select.closest('.setting-item');
		expect(policyRow?.classes.has('is-replacing')).toBe(true);
		dialog.dom.flushFrame();
		expect(summaryText(dialog)).toContain('modal.import.summary.replacedOne{"count":1}');
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
		expect(toggleOf(rowNamed(dialog, 'Chapter 1')).classes.has('is-enabled')).toBe(true);
		expect(rowNamed(dialog, 'tasks.tab.revision').classes.has('is-unavailable')).toBe(false);
		toggleOf(rowNamed(dialog, 'tasks.tab.revision')).dispatch('click');
		expect(toggleOf(rowNamed(dialog, 'tasks.tab.revision')).classes.has('is-enabled')).toBe(true);
		rowNamed(dialog, 'Chapter 1').querySelector('.snowflake-method-import-row-name')?.dispatch('click');
		expect(toggleOf(rowNamed(dialog, 'tasks.tab.revision')).classes.has('is-enabled')).toBe(false);
		dialog.dom.flushFrame();
		expect(summaryText(dialog)).not.toContain('chapters');
	});

	it('takes a group whole or lets it go, and a search narrows what the group’s toggle takes', async () => {
		const { dialog } = await openDialog();
		const characters = headers(dialog)[1];
		if (characters === undefined) throw new Error('no characters header');
		toggleOf(characters).dispatch('click');
		expect(headers(dialog)[1]?.querySelector('.snowflake-method-import-group-count')?.textContent).toBe(
			'modal.import.groupCount{"selected":0,"count":3}',
		);
		expect(toggleOf(headers(dialog)[1] as CorkboardElement).classes.has('is-enabled')).toBe(false);
		search(dialog, 'bob');
		expect(groupTitles(dialog)).toEqual(['modal.import.group.characters']);
		expect(rows(dialog).map((row) => row.querySelector('.snowflake-method-import-row-name')?.textContent)).toEqual(['Bob']);
		toggleOf(headers(dialog)[0] as CorkboardElement).dispatch('click');
		search(dialog, '');
		openGroup(dialog, 'modal.import.group.characters');
		expect(toggleOf(rowNamed(dialog, 'Bob')).classes.has('is-enabled')).toBe(true);
		expect(toggleOf(rowNamed(dialog, 'Alice')).classes.has('is-enabled')).toBe(false);
		expect(toggleOf(headers(dialog)[1] as CorkboardElement).classes.has('is-mixed')).toBe(true);
		search(dialog, 'nothing of the kind');
		expect(groupTitles(dialog)).toEqual([]);
		expect(dialog.contentEl.querySelector('.snowflake-method-import-status')?.textContent).toBe('modal.import.noMatches');
	});

	it('offers to select the notes the ticked ones point at, one hop at a time', async () => {
		const { dialog } = await openDialog();
		openGroup(dialog, 'modal.import.group.characters');
		toggleOf(rowNamed(dialog, 'Alice')).dispatch('click');
		dialog.dom.flushFrame();
		expect(summaryText(dialog)).toContain('modal.import.summary.unselectedLinksOne{"count":1}');
		const select = dialog.modalEl.querySelector('.snowflake-method-import-select-linked');
		if (select === null) throw new Error('no select-them button');
		select.dispatch('click');
		expect(toggleOf(rowNamed(dialog, 'Alice')).classes.has('is-enabled')).toBe(true);
		expect(summaryText(dialog)).not.toContain('unselectedLinks');
	});

	it('refuses to submit nothing, and hands over the source and the ticks with the policy', async () => {
		const { dialog, onSubmit } = await openDialog();
		for (const header of headers(dialog)) {
			if (toggleOf(header).classes.has('is-enabled')) toggleOf(header).dispatch('click');
		}
		expect(await dialog.submit()).toBe(false);
		expect(notices).toHaveBeenLastCalledWith('modal.import.summary.nothing');
		expect(onSubmit).not.toHaveBeenCalled();
		openGroup(dialog, 'modal.import.group.scenes');
		toggleOf(rowNamed(dialog, 'Opening')).dispatch('click');
		expect(await dialog.submit()).toBe(true);
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

	it('tells of a source that could not be read, and an empty one', async () => {
		const inspect = vi.fn(() => Promise.reject(new Error('cannot read')));
		new ImportProjectModal(
			app,
			t,
			{
				target: { path: 'Book 2/Project.md', title: 'Book 2', series: null },
				sources: [{ path: 'Other/Project.md', title: 'Other', series: null, archived: false }],
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
				droppedLinks: [{ owner: item, field: 'cast', target: 'Dave' }],
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
			'Eve | disk full',
		]);
		expect(content.querySelectorAll('button').map((button) => button.textContent)).toEqual(['common.close']);
	});
});
