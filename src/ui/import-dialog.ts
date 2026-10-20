import {
	App,
	Modal,
	Notice,
	SearchComponent,
	Setting,
	setIcon,
} from 'obsidian';

import {
	DEFINITION_FILE_IDS,
	IMPORT_DESIGN_KINDS,
	isWorldbuildingKind,
	linkedParts,
	type DefinitionFileId,
	type ImportClashPolicy,
	type ImportInspection,
	type ImportPart,
	type ImportPartKind,
	type ImportPlan,
	type ImportSelection,
	type ProjectLanguage,
} from '../domain';
import type { ImportReport, ProjectSeries } from '../services';
import { memberMatches } from './dashboard-state';
import { DIALOG_CLASS } from './dialog-class';
import {
	ConfirmModal,
	SnowflakeFormModal,
	type SubmitHandler,
	type Translate,
} from './modals';
import { buildOptionField, type OptionPicker } from './option-picker';
import {
	defaultImportSource,
	importSourceOptions,
	type ImportSourceOption,
} from './series';

// ---- The selection ----------------------------------------------------------

/**
 * What the author has ticked, kept apart from the dialog that draws it. A
 * tick means "I want this from the source"; what happens to a note already
 * here is the policy's business, and ticks never move when the policy does.
 * The closure over what a part requires is the planner's, applied at plan
 * time and never shown as ticks.
 */
export class ImportSelectionModel {
	readonly ticked = new Set<string>();
	private readonly byKey = new Map<string, ImportPart>();

	constructor(
		readonly parts: readonly ImportPart[],
		/** What starts ticked, when it is not each part's own default. */
		initial?: ReadonlySet<string>,
	) {
		for (const part of parts) {
			this.byKey.set(part.key, part);
			const on = initial === undefined ? part.defaultSelected : initial.has(part.key);
			if (on) this.ticked.add(part.key);
		}
	}

	has(key: string): boolean {
		return this.ticked.has(key);
	}

	/** How many parts are ticked. */
	count(): number {
		return this.ticked.size;
	}

	/** True while any chapter is ticked: what a revision rides on. */
	manuscriptTicked(): boolean {
		for (const key of this.ticked) {
			if (this.byKey.get(key)?.kind === 'chapter') return true;
		}
		return false;
	}

	/** A revision rides the manuscript: it can be ticked only while a chapter is. */
	available(key: string): boolean {
		const part = this.byKey.get(key);
		if (part === undefined) return false;
		return part.kind !== 'revision' || this.manuscriptTicked();
	}

	/**
	 * Ticks or unticks the keys named, those that can be, and takes every
	 * revision off with the last chapter.
	 */
	tick(keys: Iterable<string>, on: boolean): void {
		for (const key of keys) {
			if (!on) {
				this.ticked.delete(key);
			} else if (this.available(key)) {
				this.ticked.add(key);
			}
		}
		if (this.manuscriptTicked()) return;
		for (const key of [...this.ticked]) {
			if (this.byKey.get(key)?.kind === 'revision') this.ticked.delete(key);
		}
	}

	/** How much of a set of keys is ticked. */
	state(keys: readonly string[]): 'none' | 'some' | 'all' {
		let on = 0;
		for (const key of keys) if (this.ticked.has(key)) on += 1;
		if (on === 0) return 'none';
		return on === keys.length ? 'all' : 'some';
	}

	/** Ticks what the ticked parts point at, one hop out, and answers how many that was. */
	selectLinked(): number {
		const linked = linkedParts(this.parts, this.ticked);
		this.tick(linked, true);
		return linked.length;
	}

	selection(clashPolicy: ImportClashPolicy): ImportSelection {
		return { parts: new Set(this.ticked), clashPolicy };
	}
}

// ---- The tree ------------------------------------------------------------------

export interface ImportTreeRow {
	/** The part's key, or the bucket's name for a row standing for several parts. */
	readonly id: string;
	readonly label: string;
	/** Every part the row ticks; none for a row that only reports. */
	readonly keys: readonly string[];
	/** The one part a row stands for, when it stands for one. */
	readonly part: ImportPart | null;
	/** What kind of thing the row names, said before the name in a quieter voice. */
	readonly prefix: string | null;
	/** A mark the row carries whatever the policy: edited here too, already here, or gone from the source and kept here. */
	readonly note: 'edited' | 'here' | 'gone' | null;
}

export interface ImportTreeGroup {
	readonly id: string;
	readonly title: string;
	readonly rows: readonly ImportTreeRow[];
}

/** A kind's name in the dialog's own words: the two member kinds, the seeded worldbuilding kinds, a custom kind by its name. */
export function importKindTitle(t: Translate, kind: string): string {
	if (kind === 'character') return t('freeform.character');
	if (kind === 'scene') return t('freeform.scene');
	return isWorldbuildingKind(kind) ? t(`worldbuilding.kind.${kind}`) : kind;
}

const VOCABULARY_WORDS: Record<DefinitionFileId, string> = {
	category: 'modal.import.vocabulary.category',
	'world-status': 'modal.import.vocabulary.world-status',
	relationship: 'modal.import.vocabulary.relationship',
};

/**
 * The parts arranged as the dialog lists them: the steps, the members by
 * kind with their pictures last, the vocabularies and the field templates
 * by kind, the manuscript, the tool records and the visual documents. A
 * group with nothing in it is left out.
 */
export function importTree(inspection: ImportInspection, t: Translate): ImportTreeGroup[] {
	const parts = inspection.parts;
	const groups: ImportTreeGroup[] = [];
	const push = (id: string, title: string, rows: ImportTreeRow[]): void => {
		if (rows.length > 0) groups.push({ id, title, rows });
	};
	const rowOf = (part: ImportPart, label = part.name): ImportTreeRow => ({
		id: part.key,
		label,
		keys: [part.key],
		part,
		prefix: null,
		note: null,
	});
	const bucketRow = (id: string, label: string, members: readonly ImportPart[]): ImportTreeRow => ({
		id,
		label,
		keys: members.map((part) => part.key),
		part: null,
		prefix: null,
		note: null,
	});
	const kinds = ['character', 'scene', ...inspection.source.project.kinds.map((kind) => kind.id)];

	push(
		'summary',
		t('modal.import.group.summary'),
		parts.filter((part) => part.kind === 'step').map((part) => rowOf(part, t(`steps.${part.sourceId}.title`))),
	);
	const memberGroup = (id: string, title: string, kind: string, members: readonly ImportPart[]): void => {
		const rows = members.map((part) => rowOf(part));
		const pictures = parts.filter((part) => part.kind === 'picture' && part.group === kind);
		if (pictures.length > 0) rows.push(bucketRow(`pictures:${kind}`, t('modal.import.row.pictures'), pictures));
		push(id, title, rows);
	};
	memberGroup(
		'characters',
		t('modal.import.group.characters'),
		'character',
		parts.filter((part) => part.kind === 'character'),
	);
	memberGroup(
		'scenes',
		t('modal.import.group.scenes'),
		'scene',
		parts.filter((part) => part.kind === 'scene'),
	);
	for (const kind of inspection.source.project.kinds) {
		memberGroup(
			`kind:${kind.id}`,
			importKindTitle(t, kind.id),
			kind.id,
			parts.filter((part) => part.kind === 'worldbuilding' && part.group === kind.id),
		);
	}

	const vocabulary: ImportTreeRow[] = [];
	for (const kind of kinds) {
		for (const id of DEFINITION_FILE_IDS) {
			const nodes = parts.filter((part) => part.kind === 'vocabulary' && part.bucket === `${kind}/${id}`);
			if (nodes.length === 0) continue;
			vocabulary.push(
				bucketRow(
					`vocabulary:${kind}/${id}`,
					t('modal.import.vocabulary', { kind: importKindTitle(t, kind), file: t(VOCABULARY_WORDS[id]) }),
					nodes,
				),
			);
		}
	}
	push('vocabulary', t('modal.import.group.vocabulary'), vocabulary);

	const templates: ImportTreeRow[] = [];
	for (const kind of kinds) {
		const held = parts.filter((part) => part.kind === 'custom-field-template' && part.bucket === kind);
		if (held.length === 0) continue;
		templates.push(bucketRow(`templates:${kind}`, t('modal.import.templates', { kind: importKindTitle(t, kind) }), held));
	}
	push('templates', t('modal.import.group.templates'), templates);

	push(
		'manuscript',
		t('manuscript.title'),
		parts.filter((part) => part.kind === 'chapter').map((part) => rowOf(part)),
	);

	const tools: ImportTreeRow[] = [];
	const toolRow = (kind: ImportPartKind, label: string): void => {
		const held = parts.filter((part) => part.kind === kind);
		if (held.length > 0) tools.push(bucketRow(`tools:${kind}`, label, held));
	};
	toolRow('task', t('tasks.tab.tasks'));
	toolRow('foreshadowing', t('tasks.tab.foreshadowing'));
	toolRow('revision', t('tasks.tab.revision'));
	toolRow('sticky-note', t('tasks.tab.stickyNotes'));
	push('tools', t('dashboard.tasks'), tools);

	const visual: ImportTreeRow[] = [];
	for (const part of parts) {
		if (part.kind === 'freeform-view') visual.push(rowOf(part, t('modal.import.row.view', { name: part.name })));
		if (part.kind === 'timeline') visual.push(rowOf(part, t('modal.import.row.timeline', { name: part.name })));
		if (part.kind === 'beat-sheet') visual.push(rowOf(part, t('modal.import.row.beatSheet', { name: part.name })));
	}
	const sheetTemplates = parts.filter((part) => part.kind === 'beat-sheet-template');
	if (sheetTemplates.length > 0) {
		visual.push(bucketRow('tools:beat-sheet-template', t('modal.import.row.beatSheetTemplates'), sheetTemplates));
	}
	push('visualization', t('modal.import.group.visualization'), visual);

	return groups;
}

/** The words before a design part's name in the update dialog: its kind, its vocabulary, its template group. */
function updatePrefix(t: Translate, kind: ImportPartKind, group: string | null, bucket: string | null): string | null {
	switch (kind) {
		case 'step':
			return t('modal.import.group.summary');
		case 'character':
		case 'scene':
			return importKindTitle(t, kind);
		case 'worldbuilding':
			return group === null ? null : importKindTitle(t, group);
		case 'vocabulary': {
			const slash = bucket?.indexOf('/') ?? -1;
			if (bucket === null || slash < 0) return t('modal.import.group.vocabulary');
			const file = bucket.slice(slash + 1);
			const word = (DEFINITION_FILE_IDS as readonly string[]).includes(file)
				? t(VOCABULARY_WORDS[file as DefinitionFileId])
				: file;
			return t('modal.import.vocabulary', { kind: importKindTitle(t, bucket.slice(0, slash)), file: word });
		}
		case 'custom-field-template':
			return bucket === null
				? t('modal.import.group.templates')
				: t('modal.import.templates', { kind: importKindTitle(t, bucket) });
		default:
			return null;
	}
}

export interface UpdateTree {
	readonly groups: readonly ImportTreeGroup[];
	/** What starts ticked: every copy the sibling changed and this book has not. */
	readonly initial: ReadonlySet<string>;
	/** How many design parts stand here as the sibling has them. */
	readonly unchanged: number;
}

/**
 * The design parts arranged by how they stand against the sibling: changed
 * there alone, changed in both, new there, and gone from there but kept
 * here. Parts that match are counted and not drawn, and the one-shot kinds
 * (the manuscript, the pictures, the tool records) are left to the import
 * dialog, since an update is about the design.
 */
export function updateTree(inspection: ImportInspection, t: Translate, book: string): UpdateTree {
	const changed: ImportTreeRow[] = [];
	const conflict: ImportTreeRow[] = [];
	const fresh: ImportTreeRow[] = [];
	const initial = new Set<string>();
	let unchanged = 0;
	for (const part of inspection.parts) {
		if (!IMPORT_DESIGN_KINDS.has(part.kind)) continue;
		const standing = inspection.standing.get(part.key)?.kind ?? 'new';
		const row = (note: ImportTreeRow['note']): ImportTreeRow => ({
			id: part.key,
			label: part.kind === 'step' ? t(`steps.${part.sourceId}.title`) : part.name,
			keys: [part.key],
			part,
			prefix: updatePrefix(t, part.kind, part.group, part.bucket),
			note,
		});
		if (standing === 'unchanged') unchanged += 1;
		else if (standing === 'update') {
			changed.push(row(null));
			initial.add(part.key);
		} else if (standing === 'conflict') conflict.push(row('edited'));
		else fresh.push(row(standing === 'existing' ? 'here' : null));
	}
	const gone: ImportTreeRow[] = inspection.gone
		.filter((entry) => IMPORT_DESIGN_KINDS.has(entry.kind))
		.map((entry) => ({
			id: `gone:${entry.kind}:${entry.targetPath ?? entry.name}`,
			label: entry.name,
			keys: [],
			part: null,
			prefix: updatePrefix(t, entry.kind, null, null),
			note: 'gone',
		}));
	const groups: ImportTreeGroup[] = [];
	const push = (id: string, title: string, rows: ImportTreeRow[]): void => {
		if (rows.length > 0) groups.push({ id, title, rows });
	};
	push('changed', t('modal.import.update.changed', { book }), changed);
	push('conflict', t('modal.import.update.conflict'), conflict);
	push('new', t('modal.import.update.new', { book }), fresh);
	push('gone', t('modal.import.update.gone', { book }), gone);
	return { groups, initial, unchanged };
}

// ---- The words ------------------------------------------------------------------

/** One translation per count, in the singular where the count is one. */
function counted(t: Translate, key: string, count: number): string {
	return t(count === 1 ? `${key}One` : key, { count });
}

interface ImportUnit {
	readonly key: string;
	readonly kinds: readonly ImportPartKind[];
}

/** The units a report counts in, one for each kind of thing that lands. */
const UNITS: readonly ImportUnit[] = [
	{ key: 'notes', kinds: ['character', 'scene', 'worldbuilding'] },
	{ key: 'pictures', kinds: ['picture'] },
	{ key: 'chapters', kinds: ['chapter'] },
	{ key: 'timelines', kinds: ['timeline'] },
	{ key: 'beatSheets', kinds: ['beat-sheet'] },
	{ key: 'views', kinds: ['freeform-view'] },
	{ key: 'tasks', kinds: ['task'] },
	{ key: 'foreshadowing', kinds: ['foreshadowing'] },
	{ key: 'revisions', kinds: ['revision'] },
	{ key: 'stickyNotes', kinds: ['sticky-note'] },
];

/**
 * The units the dialog's foot counts in, few enough to take in at a glance:
 * the tree counts every kind by its group already, so the foot sums the
 * notes, the pictures, the manuscript and the tool records.
 */
const FOOT_UNITS: readonly ImportUnit[] = [
	{ key: 'notes', kinds: ['character', 'scene', 'worldbuilding'] },
	{ key: 'pictures', kinds: ['picture'] },
	{ key: 'chapters', kinds: ['chapter'] },
	{
		key: 'toolRecords',
		kinds: ['timeline', 'beat-sheet', 'freeform-view', 'task', 'foreshadowing', 'revision', 'sticky-note'],
	},
];

function unitsOf(units: readonly ImportUnit[], t: Translate, countOf: (kind: ImportPartKind) => number): string[] {
	const words: string[] = [];
	for (const unit of units) {
		let count = 0;
		for (const kind of unit.kinds) count += countOf(kind);
		if (count > 0) words.push(counted(t, `modal.import.summary.${unit.key}`, count));
	}
	return words;
}

/** The non-zero units in their fixed order: "14 notes, 3 pictures, 2 timelines". */
export function importUnits(t: Translate, countOf: (kind: ImportPartKind) => number): string[] {
	return unitsOf(UNITS, t, countOf);
}

/** The kinds the replace confirmation names: each is a note of the target's. */
const NOTE_KINDS: ReadonlySet<ImportPartKind> = new Set<ImportPartKind>([
	'step',
	'character',
	'scene',
	'worldbuilding',
	'vocabulary',
	'custom-field-template',
]);

export interface ImportPlanWords {
	/** The units, or the sentence for nothing selected. */
	units: string;
	/** How many linked parts stand outside the selection, for the offer to select them. */
	unselected: number;
}

/**
 * What a plan comes to, as the dialog's foot says it: what lands, in the
 * foot's few units, and how many linked notes stand outside the ticks. What
 * is skipped, replaced or dropped is not repeated here: each row's mark
 * says what becomes of it, and the report after the run lists the rest.
 */
export function importPlanWords(t: Translate, plan: ImportPlan, ticked: number): ImportPlanWords {
	if (ticked === 0) return { units: t('modal.import.summary.nothing'), unselected: 0 };
	const units = unitsOf(FOOT_UNITS, t, (kind) => plan.counts[kind].create + plan.counts[kind].replace);
	return {
		// Ticks that come to nothing are not "nothing selected": every one
		// of them is already here as it stands, which its row's mark says.
		units: units.length === 0 ? t('modal.import.summary.nothingToImport') : units.join(t('modal.import.summary.separator')),
		unselected: plan.unselectedLinks.length,
	};
}

/** What a run brought, in the same units. */
export function importReportSummary(t: Translate, report: ImportReport): string {
	const counts = new Map<ImportPartKind, number>();
	for (const item of [...report.created, ...report.replaced]) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
	const units = importUnits(t, (kind) => counts.get(kind) ?? 0);
	return units.length === 0 ? t('modal.import.summary.nothing') : units.join(t('modal.import.summary.separator'));
}

/** The names a replace confirmation lists: the notes the plan writes over. */
export function importReplacedNames(t: Translate, plan: ImportPlan): string[] {
	const names: string[] = [];
	for (const entry of plan.entries) {
		if (entry.action !== 'replace' || !NOTE_KINDS.has(entry.part.kind)) continue;
		names.push(entry.part.kind === 'step' ? t(`steps.${entry.part.sourceId}.title`) : entry.targetName);
	}
	return names;
}

/** Whether a run has anything to say beyond its notice: a skip, a dropped link or a failure. */
export function importReportWanted(report: ImportReport): boolean {
	return (
		report.failed.length > 0 ||
		report.droppedLinks.length > 0 ||
		report.skipped.some((item) => item.reason !== 'unchanged')
	);
}

// ---- The dialog -------------------------------------------------------------------

/** What the dialog asks the host for: the source read against the target, and a plan over it. */
export interface ImportDialogBridge {
	inspect(sourcePath: string): Promise<ImportInspection>;
	plan(inspection: ImportInspection, selection: ImportSelection): ImportPlan;
}

export type ImportDialogMode = 'import' | 'update';

export interface ImportDialogConfig {
	/** Import, the default, offers everything; update offers what changed in a sibling of the series. */
	mode?: ImportDialogMode;
	target: { path: string; title: string; locale: ProjectLanguage; series: ProjectSeries | null };
	sources: readonly ImportSourceOption[];
	/**
	 * The source to open on: the author's own pick, so one in another language
	 * is pointed out as it is read. Without one an import opens on no source,
	 * and an update on the lowest book of the series.
	 */
	initialSource?: string | null;
	bridge: ImportDialogBridge;
}

/** What the author settled on: where from, what, and whether it was an update. */
export interface ImportChoice {
	sourcePath: string;
	selection: ImportSelection;
	mode: ImportDialogMode;
}

function initialSourceOf(config: ImportDialogConfig): string | null {
	if (config.initialSource !== undefined && config.initialSource !== null) return config.initialSource;
	if ((config.mode ?? 'import') !== 'update') return null;
	return defaultImportSource(config.sources, config.target.series)?.path ?? config.sources[0]?.path ?? null;
}

/**
 * A native checkbox, drawn by Obsidian: ticked for the whole, a dash for a
 * part. A change hands over what the browser just made of it, so a dash
 * goes to a tick as a dash does everywhere.
 */
function tickBox(parent: HTMLElement, state: 'none' | 'some' | 'all', label: string): HTMLInputElement {
	const box = parent.createEl('input', {
		cls: 'snowflake-method-import-tick',
		attr: { type: 'checkbox', 'aria-label': label },
	});
	box.checked = state === 'all';
	box.indeterminate = state === 'some';
	return box;
}

function sourceTitleOf(config: ImportDialogConfig, path: string | null): string {
	return config.sources.find((source) => source.path === path)?.title ?? '';
}

function dialogTitle(t: Translate, mode: ImportDialogMode, book: string): string {
	return mode === 'update' ? t('modal.import.updateTitle', { book }) : t('modal.import.title');
}

/** The name of each project language, said in the words of the dialog's own. */
const LANGUAGE_WORDS: Readonly<Record<ProjectLanguage, string>> = {
	en: 'modal.importLanguage.en',
	'zh-CN': 'modal.importLanguage.zh-CN',
};

const SUMMARY_DELAY_MS = 150;

/**
 * Import from project: a source, a policy for notes already here, a search
 * over the parts and the tree of them, with a summary of what the ticks come
 * to standing above the buttons. Words in the target project's language. A source
 * in another language is pointed out before it is read, and every run is
 * confirmed on submit, since none can be undone; a refusal keeps the dialog.
 */
export class ImportProjectModal extends SnowflakeFormModal<ImportChoice> {
	private readonly mode: ImportDialogMode;
	private sourcePath: string | null;
	private policy: ImportClashPolicy = 'skip';
	private query = '';
	private inspection: ImportInspection | null = null;
	private model: ImportSelectionModel | null = null;
	private groups: readonly ImportTreeGroup[] = [];
	/** In update mode, how many design parts stand here as the sibling has them. */
	private readonly unfolded = new Set<string>();
	private treeEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private summaryEl: HTMLElement | null = null;
	private sourceField: OptionPicker | null = null;
	/** In update mode, the line under From that says what an update does. */
	private noteEl: HTMLElement | null = null;
	private loadSequence = 0;
	private summaryTimer: number | null = null;
	private summarySequence = 0;

	constructor(
		app: App,
		t: Translate,
		private readonly config: ImportDialogConfig,
		onSubmit: SubmitHandler<ImportChoice>,
	) {
		const mode = config.mode ?? 'import';
		const sourcePath = initialSourceOf(config);
		super(
			app,
			t,
			dialogTitle(t, mode, sourceTitleOf(config, sourcePath)),
			onSubmit,
			mode === 'update' ? 'modal.import.updateSubmit' : 'modal.import.submit',
		);
		this.mode = mode;
		this.sourcePath = sourcePath;
		this.modalEl.addClass('snowflake-method-project-modal', 'snowflake-method-import-modal');
		this.modalEl.toggleClass('is-updating', mode === 'update');
		// Stamped with the project it writes into, as every form is with its own.
		this.modalEl.dataset.snowflakeProject = config.target.path;
	}

	/** The title of the source chosen now, for the words that name it. */
	private book(): string {
		return sourceTitleOf(this.config, this.sourcePath);
	}

	onClose(): void {
		this.sourceField?.destroy();
		this.sourceField = null;
		this.clearSummaryTimer();
		this.loadSequence += 1;
		super.onClose();
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-project-form', 'snowflake-method-import-form');
		const t = this.t;
		const from = new Setting(this.contentEl).setName(t('modal.import.from'));
		this.sourceField?.destroy();
		this.sourceField = buildOptionField(this.app, from.controlEl, {
			label: t('modal.import.from'),
			placeholder: t('modal.import.fromPlaceholder'),
			emptyPlaceholder: t('modal.import.noSources'),
			options: () =>
				importSourceOptions(this.config.sources, this.config.target.series, {
					sameSeries: t('modal.import.section.sameSeries'),
					others: t('modal.import.section.others'),
					archived: t('modal.import.section.archived'),
				}),
			value: () => this.sourcePath ?? '',
			choose: (value) => {
				if (value === this.sourcePath) return;
				void this.chooseSource(value);
			},
		});

		this.noteEl = null;
		if (this.mode === 'update') {
			// Under From, since it is about the source chosen there: what an
			// update does to the copies, and what it leaves alone.
			this.noteEl = this.contentEl.createDiv({
				cls: 'snowflake-method-import-note',
				text: t('modal.import.updateNote', { book: this.book() }),
			});
		} else {
			const policy = new Setting(this.contentEl).setName(t('modal.import.policy'));
			const describePolicy = (): void => {
				policy.setDesc(this.policy === 'replace' ? t('modal.import.policyReplaceDesc') : '');
				policy.settingEl.toggleClass('is-replacing', this.policy === 'replace');
			};
			policy.addDropdown((dropdown) =>
				dropdown
					.addOption('skip', t('modal.import.policy.skip'))
					.addOption('replace', t('modal.import.policy.replace'))
					.setValue(this.policy)
					.onChange((value) => {
						this.policy = value === 'replace' ? 'replace' : 'skip';
						describePolicy();
						this.paintTree();
						this.scheduleSummary();
					}),
			);
			describePolicy();
		}

		const search = new Setting(this.contentEl).setName(t('modal.import.search'));
		const box = new SearchComponent(search.controlEl);
		box.setPlaceholder(t('modal.import.searchPlaceholder'));
		box.setValue(this.query);
		box.onChange((value) => {
			this.query = value;
			this.paintTree('top');
		});
		// Escape clears a search before it closes the dialog: the key is
		// taken here, on the box, so the dialog's own handler never sees it.
		box.inputEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || this.query.trim().length === 0) return;
			event.preventDefault();
			event.stopPropagation();
			box.setValue('');
			this.query = '';
			this.paintTree('top');
		});

		this.treeEl = this.contentEl.createDiv({
			cls: 'snowflake-method-import-tree',
			attr: { role: 'tree', 'aria-label': t('modal.import.tree') },
		});
		this.statusEl = this.contentEl.createDiv({ cls: 'snowflake-method-import-status' });
		if (this.inspection === null) {
			void this.openSource();
		} else {
			this.paintTree();
		}
	}

	protected leadingActions(actions: HTMLElement): void {
		this.summaryEl = actions.createDiv({
			cls: 'snowflake-method-import-summary',
			attr: { 'aria-live': 'polite' },
		});
		this.scheduleSummary();
	}

	protected collectValue(): ImportChoice | null {
		if (this.sourcePath === null || this.inspection === null || this.model === null) {
			new Notice(this.t(this.config.sources.length === 0 ? 'modal.import.noSources' : 'modal.import.chooseSource'));
			return null;
		}
		if (this.model.count() === 0) {
			new Notice(this.t('modal.import.summary.nothing'));
			return null;
		}
		// An update replaces: that is what taking a sibling's change means.
		const policy = this.mode === 'update' ? 'replace' : this.policy;
		return { sourcePath: this.sourcePath, selection: this.model.selection(policy), mode: this.mode };
	}

	/**
	 * Confirms the run before the base closes and starts it, since no run
	 * can be undone; declining keeps the dialog. A run that writes over
	 * notes names them instead. An update names only the copies edited
	 * here, and a note that stands here on its own: the copies this book
	 * has not touched are what the update is for.
	 */
	protected async submit(): Promise<boolean> {
		const choice = this.collectValue();
		if (choice === null || this.inspection === null) return false;
		const names =
			this.mode === 'update'
				? this.editedHere()
				: importReplacedNames(this.t, this.config.bridge.plan(this.inspection, choice.selection));
		const agreed =
			names.length > 0
				? await confirmImportReplace(this.app, this.t, names)
				: await confirmImportRun(this.app, this.t, this.mode, this.book());
		if (!agreed) return false;
		return super.submit();
	}

	/** The ticked parts an update writes over against this book's own hand: its edited copies and its own namesakes. */
	private editedHere(): string[] {
		const inspection = this.inspection;
		const model = this.model;
		if (inspection === null || model === null) return [];
		const names: string[] = [];
		for (const part of inspection.parts) {
			if (!model.has(part.key)) continue;
			const standing = inspection.standing.get(part.key);
			if (standing === undefined || standing.kind === 'new') continue;
			if (standing.kind !== 'conflict' && standing.kind !== 'existing') continue;
			names.push(part.kind === 'step' ? this.t(`steps.${part.sourceId}.title`) : standing.targetName);
		}
		return names;
	}

	// ---- Loading ------------------------------------------------------------------

	/**
	 * The first read, of the source the dialog opened on. One the author
	 * picked, in Start from, is pointed out before it is read when it is in
	 * another language, as one picked in From is, and declining leaves From
	 * empty; one the dialog chose for an update is read without a word. The
	 * notice waits a turn so the dialog has finished opening and the notice
	 * stands on top of it.
	 */
	private async openSource(): Promise<void> {
		await Promise.resolve();
		const path = this.sourcePath;
		const picked = path !== null && path === (this.config.initialSource ?? null);
		if (picked && this.otherLanguage(path) && !(await this.confirmLanguage(path))) {
			this.sourcePath = null;
			this.sourceField?.refresh();
		}
		await this.loadSource();
	}

	/** A source picked in From: one in another language is pointed out first, and declining keeps the one held. */
	private async chooseSource(path: string): Promise<void> {
		if (this.otherLanguage(path) && !(await this.confirmLanguage(path))) return;
		this.sourcePath = path;
		this.sourceField?.refresh();
		if (this.mode === 'update') {
			this.setTitle(dialogTitle(this.t, this.mode, this.book()));
			this.noteEl?.setText(this.t('modal.import.updateNote', { book: this.book() }));
		}
		await this.loadSource();
	}

	private sourceOf(path: string): ImportSourceOption | undefined {
		return this.config.sources.find((source) => source.path === path);
	}

	/** True when the source is written in a language other than this project's. */
	private otherLanguage(path: string): boolean {
		const source = this.sourceOf(path);
		return source !== undefined && source.locale !== this.config.target.locale;
	}

	private confirmLanguage(path: string): Promise<boolean> {
		const t = this.t;
		const locale = this.sourceOf(path)?.locale ?? this.config.target.locale;
		return confirmImportLanguage(this.app, t, {
			source: sourceTitleOf(this.config, path),
			language: t(LANGUAGE_WORDS[locale]),
			own: t(LANGUAGE_WORDS[this.config.target.locale]),
		});
	}

	private async loadSource(): Promise<void> {
		const sequence = ++this.loadSequence;
		this.inspection = null;
		this.model = null;
		this.groups = [];
		this.paintTree();
		this.scheduleSummary();
		if (this.sourcePath === null) return;
		let inspection: ImportInspection;
		try {
			inspection = await this.config.bridge.inspect(this.sourcePath);
		} catch (error) {
			if (sequence !== this.loadSequence) return;
			new Notice(error instanceof Error ? error.message : this.t('errors.unknown'));
			return;
		}
		if (sequence !== this.loadSequence) return;
		this.inspection = inspection;
		if (this.mode === 'update') {
			const tree = updateTree(inspection, this.t, this.book());
			this.model = new ImportSelectionModel(inspection.parts, tree.initial);
			this.groups = tree.groups;
		} else {
			this.model = new ImportSelectionModel(inspection.parts);
			this.groups = importTree(inspection, this.t);
		}
		this.paintTree();
		this.scheduleSummary();
	}

	// ---- The tree ---------------------------------------------------------------

	private paintTree(scroll: 'keep' | 'top' = 'keep'): void {
		const tree = this.treeEl;
		const status = this.statusEl;
		if (tree === null || status === null) return;
		// The tree is rebuilt whole on every change, and the reader's place
		// in it is kept, unless the rows now answer different words.
		const scrollTop = scroll === 'keep' ? tree.scrollTop : 0;
		tree.empty();
		status.empty();
		const model = this.model;
		if (model === null) {
			status.setText(this.config.sources.length === 0 ? this.t('modal.import.noSources') : '');
			return;
		}
		if (this.groups.length === 0) {
			status.setText(
				this.mode === 'update'
					? this.t('modal.import.update.nothing', { book: this.book() })
					: this.t('modal.import.empty'),
			);
			return;
		}
		const searching = this.query.trim().length > 0;
		let shown = 0;
		for (const group of this.groups) {
			const rows = searching
				? group.rows.filter((row) => memberMatches([row.prefix ?? '', row.label], this.query))
				: group.rows;
			// A group with nothing to answer steps aside, and one with an
			// answer opens while the search stands.
			if (searching && rows.length === 0) continue;
			shown += 1;
			this.paintGroup(tree, model, group, rows, searching || this.unfolded.has(group.id));
		}
		if (shown === 0) status.setText(this.t('modal.import.noMatches'));
		tree.scrollTop = scrollTop;
	}

	private paintGroup(
		tree: HTMLElement,
		model: ImportSelectionModel,
		group: ImportTreeGroup,
		rows: readonly ImportTreeRow[],
		opened: boolean,
	): void {
		const t = this.t;
		const groupEl = tree.createDiv({
			cls: 'snowflake-method-import-group',
			attr: { role: 'treeitem', 'aria-expanded': String(opened) },
		});
		groupEl.toggleClass('is-open', opened);
		const header = groupEl.createDiv({ cls: 'snowflake-method-import-group-header' });
		const keys = group.rows.flatMap((row) => row.keys);
		const selected = keys.filter((key) => model.has(key)).length;
		// A group that only reports, as the gone one does, counts its rows and
		// has no box: there is nothing in it to take.
		const reporting = keys.length === 0;
		if (reporting) {
			header.createSpan({ cls: 'snowflake-method-import-tick-blank' });
		} else {
			// The group's box stands for every row the group shows now that can
			// be ticked: a search narrows that to what it found, and a revision
			// out of reach until a chapter is ticked is left out, or the box
			// would show a dash it could never clear.
			const shownKeys = rows.flatMap((row) => row.keys).filter((key) => model.available(key));
			const state = model.state(shownKeys);
			const box = tickBox(header, state, t('modal.import.takeAll', { name: group.title }));
			box.addEventListener('change', () => {
				model.tick(shownKeys, state !== 'all');
				this.paintTree();
				this.scheduleSummary();
			});
		}
		const fold = header.createEl('button', {
			cls: 'snowflake-method-import-fold',
			attr: { type: 'button', 'aria-expanded': String(opened), 'aria-label': group.title },
		});
		const chevron = fold.createSpan({ cls: 'snowflake-method-import-chevron' });
		setIcon(chevron, 'chevron-right');
		fold.createSpan({ cls: 'snowflake-method-import-group-title', text: group.title });
		fold.addEventListener('click', () => {
			if (this.unfolded.has(group.id)) this.unfolded.delete(group.id);
			else this.unfolded.add(group.id);
			this.paintTree();
		});
		header.createSpan({
			cls: 'snowflake-method-import-group-count',
			text: reporting
				? String(group.rows.length)
				: t('modal.import.groupCount', { selected, count: keys.length }),
		});
		if (!opened) return;
		// The rows are made when the fold opens and unmade when it closes,
		// so a project of thousands of scenes costs nine headers until asked.
		const list = groupEl.createDiv({ cls: 'snowflake-method-import-rows', attr: { role: 'group' } });
		for (const row of rows) this.paintRow(list, model, row);
	}

	private paintRow(list: HTMLElement, model: ImportSelectionModel, row: ImportTreeRow): void {
		const t = this.t;
		const rowEl = list.createDiv({ cls: 'snowflake-method-import-row', attr: { role: 'treeitem' } });
		const paintName = (): void => {
			const name = rowEl.createSpan({ cls: 'snowflake-method-import-row-name' });
			if (row.prefix !== null) {
				name.createSpan({ cls: 'snowflake-method-import-row-prefix', text: `${row.prefix} · ` });
			}
			name.createSpan({ text: row.label });
			return;
		};
		if (row.note === 'gone') {
			// Gone from the source and kept here: nothing to tick, only to know.
			rowEl.addClass('is-gone');
			rowEl.createSpan({ cls: 'snowflake-method-import-tick-blank' });
			paintName();
			rowEl.createSpan({ cls: 'snowflake-method-import-row-mark', text: t('modal.import.mark.kept') });
			return;
		}
		const available = row.keys.some((key) => model.available(key));
		const state = model.state(row.keys);
		const standing = row.part === null ? null : (this.inspection?.standing.get(row.part.key) ?? null);
		const here = standing !== null && standing.kind !== 'new';
		// A copy that still matches its source is written by neither policy.
		const upToDate = standing !== null && standing.kind === 'unchanged';
		const updating = this.mode === 'update';
		// Under import the policy says what becomes of a note already here;
		// under update a tick on a note this book's hand is on says it.
		const replacing = updating ? row.note !== null && state !== 'none' : here && !upToDate && this.policy === 'replace';
		rowEl.toggleClass('is-unavailable', !available);
		rowEl.toggleClass('is-here', (updating ? row.note === 'here' : here) && !replacing);
		rowEl.toggleClass('is-replaced', replacing);
		const flip = (): void => {
			model.tick(row.keys, state !== 'all');
			this.paintTree();
			this.scheduleSummary();
		};
		const box = tickBox(rowEl, state, t('modal.import.take', { name: row.label }));
		box.disabled = !available;
		box.addEventListener('change', flip);
		paintName();
		const name = rowEl.querySelector('.snowflake-method-import-row-name');
		// The words are part of the control, as a checkbox's label is: a
		// click on them does what a click on the box does. The tree is
		// repainted on every change, so the state read here is current.
		name?.addEventListener('click', () => {
			if (available) flip();
		});
		const mark = rowEl.createSpan({ cls: 'snowflake-method-import-row-mark' });
		if (!available) mark.setText(t('modal.import.mark.needsManuscript'));
		else if (updating) {
			if (row.note === 'edited') mark.setText(t('modal.import.update.conflictDesc'));
			else if (row.note === 'here') mark.setText(t('modal.import.mark.here'));
		} else if (upToDate) {
			mark.setText(t('modal.import.mark.upToDate'));
		} else if (here) {
			mark.setText(t(this.policy === 'replace' ? 'modal.import.mark.replace' : 'modal.import.mark.here'));
		}
	}

	// ---- The summary --------------------------------------------------------------

	private clearSummaryTimer(): void {
		if (this.summaryTimer === null) return;
		this.modalEl.win.clearTimeout(this.summaryTimer);
		this.summaryTimer = null;
	}

	/** Repaints the summary a moment after the last change, so a run of ticks costs one plan. */
	private scheduleSummary(): void {
		this.clearSummaryTimer();
		const sequence = ++this.summarySequence;
		this.summaryTimer = this.modalEl.win.setTimeout(() => {
			this.summaryTimer = null;
			if (sequence !== this.summarySequence) return;
			this.paintSummary();
		}, SUMMARY_DELAY_MS);
	}

	private paintSummary(): void {
		const summary = this.summaryEl;
		if (summary === null) return;
		summary.empty();
		const model = this.model;
		if (this.inspection === null || model === null) return;
		if (this.mode === 'update') {
			this.paintUpdateSummary(summary, this.inspection, model);
			return;
		}
		const plan = this.config.bridge.plan(this.inspection, model.selection(this.policy));
		const words = importPlanWords(this.t, plan, model.count());
		const offer =
			words.unselected > 0
				? {
						text: counted(this.t, 'modal.import.summary.unselectedLinks', words.unselected),
						select: (): void => {
							model.tick(plan.unselectedLinks, true);
							this.paintTree();
							this.paintSummary();
						},
					}
				: null;
		this.paintSummaryLines(summary, words.units, [], offer);
	}

	/**
	 * The units on a line of their own, in the full voice, and under them
	 * each clause on a line of its own in the quieter one, so nothing runs
	 * together and no line opens on a divider. The offer to select the
	 * linked notes ends the clause that counts them.
	 */
	private paintSummaryLines(
		summary: HTMLElement,
		units: string,
		clauses: readonly string[],
		offer: { text: string; select: () => void } | null,
	): void {
		summary.createDiv({ cls: 'snowflake-method-import-summary-units', text: units });
		if (clauses.length === 0 && offer === null) return;
		const lines = summary.createDiv({ cls: 'snowflake-method-import-summary-clauses' });
		const clause = (text: string): HTMLElement => {
			const el = lines.createDiv({ cls: 'snowflake-method-import-summary-clause' });
			el.createSpan({ text });
			return el;
		};
		for (const text of clauses) clause(text);
		if (offer === null) return;
		const select = clause(offer.text).createEl('button', {
			cls: 'snowflake-method-import-select-linked',
			text: this.t('modal.import.selectLinked'),
			attr: { type: 'button' },
		});
		select.addEventListener('click', offer.select);
	}

	/** What an update comes to: the notes taken, and those of them this book had edited. */
	private paintUpdateSummary(summary: HTMLElement, inspection: ImportInspection, model: ImportSelectionModel): void {
		const t = this.t;
		if (this.groups.length === 0) {
			this.paintSummaryLines(summary, t('modal.import.update.nothing', { book: this.book() }), [], null);
			return;
		}
		const ticked = model.count();
		let edited = 0;
		for (const key of model.ticked) {
			const standing = inspection.standing.get(key)?.kind;
			if (standing === 'conflict' || standing === 'existing') edited += 1;
		}
		const clauses: string[] = [];
		if (edited > 0) clauses.push(counted(t, 'modal.import.update.edited', edited));
		this.paintSummaryLines(
			summary,
			ticked === 0 ? t('modal.import.summary.nothing') : counted(t, 'modal.import.update.summary', ticked),
			clauses,
			null,
		);
	}
}

// ---- Confirming a replace ------------------------------------------------------

class ConfirmImportReplaceModal extends ConfirmModal {
	constructor(
		app: App,
		t: Translate,
		private readonly names: readonly string[],
		onResolve: (confirmed: boolean) => void,
	) {
		super(app, t, { label: t('modal.importReplace.confirm'), style: 'mod-warning' }, onResolve);
		this.setTitle(counted(t, 'modal.importReplace.title', names.length));
		this.proceedOnModEnter();
	}

	protected renderBody(body: HTMLElement): void {
		body.createEl('p', { text: this.t('modal.importReplace.question') });
		const shown = this.names.slice(0, 8);
		const list = body.createEl('ul', { cls: 'snowflake-method-export-paths' });
		for (const name of shown) list.createEl('li', { text: name });
		if (this.names.length > shown.length) {
			list.createEl('li', { text: this.t('modal.exportReplace.more', { count: this.names.length - shown.length }) });
		}
		body.createEl('p', { text: this.t('modal.importReplace.consequence') });
	}
}

/** True when the author agreed to write over the notes named. */
export function confirmImportReplace(app: App, t: Translate, names: readonly string[]): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmImportReplaceModal(app, t, names, resolve).open();
	});
}

// ---- Confirming a run ----------------------------------------------------------

/** What an import or an update does, and that it cannot be undone, before it runs. */
class ConfirmImportRunModal extends ConfirmModal {
	private readonly keys: string;

	constructor(
		app: App,
		t: Translate,
		mode: ImportDialogMode,
		private readonly source: string,
		onResolve: (confirmed: boolean) => void,
	) {
		super(
			app,
			t,
			{ label: t(mode === 'update' ? 'modal.import.updateSubmit' : 'modal.import.submit'), style: 'mod-cta' },
			onResolve,
		);
		this.keys = mode === 'update' ? 'modal.updateConfirm' : 'modal.importConfirm';
		this.setTitle(t(`${this.keys}.title`, { source }));
		this.proceedOnModEnter();
	}

	protected renderBody(body: HTMLElement): void {
		body.createEl('p', { text: this.t(`${this.keys}.note`, { source: this.source }) });
	}
}

/** True when the author agreed to run the import, or the update, from the source named. */
export function confirmImportRun(app: App, t: Translate, mode: ImportDialogMode, source: string): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmImportRunModal(app, t, mode, source, resolve).open();
	});
}

// ---- A source in another language ---------------------------------------------

/** What crosses translated and what crosses as it is, before a source in another language is read. */
class ConfirmImportLanguageModal extends ConfirmModal {
	constructor(
		app: App,
		t: Translate,
		private readonly words: { source: string; language: string; own: string },
		onResolve: (confirmed: boolean) => void,
	) {
		super(app, t, { label: t('modal.importLanguage.confirm'), style: 'mod-cta' }, onResolve);
		this.setTitle(t('modal.importLanguage.title'));
		this.proceedOnModEnter();
	}

	// One line, which is all the notice has to say: which language the
	// source is written in, and which this project is.
	protected renderBody(body: HTMLElement): void {
		body.createEl('p', { text: this.t('modal.importLanguage.note', this.words) });
	}
}

/** True when the author went on with a source written in another language. */
export function confirmImportLanguage(
	app: App,
	t: Translate,
	words: { source: string; language: string; own: string },
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmImportLanguageModal(app, t, words, resolve).open();
	});
}

// ---- The report --------------------------------------------------------------------

const SKIP_REASON_WORDS: Record<string, string> = {
	'name-taken': 'modal.importReport.reason.exists',
	'file-name-taken': 'modal.importReport.reason.fileTaken',
	'no-chapter': 'modal.importReport.reason.noChapter',
};

/**
 * What a run has to say when its notice would not do: what was skipped and
 * why, which links were dropped, and what failed. One surface, Close only.
 */
export class ImportReportModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly report: ImportReport,
	) {
		super(app);
		this.modalEl.addClass(DIALOG_CLASS, 'snowflake-method-import-report-modal');
		this.setTitle(t('modal.importReport.title'));
	}

	onOpen(): void {
		const t = this.t;
		const report = this.report;
		this.contentEl.empty();
		const callout = this.contentEl.createDiv({ cls: 'snowflake-method-repair-callout snowflake-method-import-report' });
		const brought = report.created.length + report.replaced.length > 0;
		callout.createEl('p', {
			text: brought
				? t('modal.importReport.summary', { summary: importReportSummary(t, report), source: report.source.title })
				: t('modal.importReport.nothing', { source: report.source.title }),
		});
		const section = (title: string, lines: readonly { name: string; note: string }[]): void => {
			if (lines.length === 0) return;
			callout.createEl('h3', { text: title });
			const list = callout.createEl('ul', { cls: 'snowflake-method-import-report-list' });
			for (const line of lines) {
				const item = list.createEl('li');
				item.createSpan({ text: line.name });
				item.createSpan({ cls: 'snowflake-method-import-report-note', text: line.note });
			}
		};
		section(
			t('modal.importReport.skipped'),
			report.skipped
				.filter((item) => item.reason !== 'unchanged')
				.map((item) => ({ name: item.name, note: t(SKIP_REASON_WORDS[item.reason] ?? 'modal.importReport.reason.exists') })),
		);
		section(
			t('modal.importReport.dropped'),
			report.droppedLinks.map((drop) => ({
				name: `${drop.owner.name} → ${drop.target}`,
				note: t(drop.field === 'file' ? 'modal.importReport.reason.missingFile' : 'modal.importReport.reason.missingTarget'),
			})),
		);
		section(
			t('modal.importReport.failed'),
			report.failed.map((item) => ({ name: item.name, note: item.message })),
		);
		const actions = this.contentEl.createDiv({ cls: 'snowflake-method-modal-actions' });
		const close = actions.createEl('button', { cls: 'mod-cta', text: t('common.close'), attr: { type: 'button' } });
		close.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
