/**
 * Importing one project's design into another, and the series that rests
 * on it: a book takes a sibling's characters, scenes, worldbuilding,
 * vocabulary, templates, pictures, step texts, manuscript and tool records
 * as copies of its own, every link pointed at the copy, every id fresh,
 * every word credited to the plugin rather than the author.
 *
 * The domain module (`project-import.ts`) catalogues, inspects, plans and
 * rewrites; this service reads two projects into the shapes it takes,
 * writes what the plan says through the batch seams of the project service
 * and the tool services, and records in the import store where every copy
 * came from (`project-import-provenance.ts`), so a later run can tell a
 * part the source has changed from one the author has edited here.
 *
 * A run never trusts a plan made while a dialog stood open: it inspects and
 * plans again against fresh snapshots. Writes go in dependency order: the
 * custom kinds a part needs, then the vocabulary, the field templates, the
 * pictures, the members (times before anything that names a period),
 * the step texts, the chapters, the records anchored in them, and the
 * views over everything. A part that fails to write is reported and the
 * run goes on; the provenance of what landed is written in a `finally`.
 */

import { normalizePath } from "obsidian";

import {
	CHARACTER_TYPES,
	DEFINITION_FILE_IDS,
	STEP_SECTION_IDS,
	anchorOccurrence,
	anchorRevision,
	characterInputOf,
	entityInputOf,
	fingerprint,
	foldName,
	importCopyKey,
	importHash,
	importKindHasOwnId,
	importLinkResolver,
	importPathKey,
	importRewriteContext,
	inspectImport,
	isImagePath,
	planImport,
	recordImports,
	refreshImports,
	rememberChoices,
	remapBeatSheet,
	remapForeshadowing,
	remapFreeformView,
	remapRevision,
	remapTask,
	remapTimeline,
	rewriteProseLinks,
	sceneInputOf,
	type BeatSheet,
	type CharacterType,
	type DefinitionFileId,
	type EditableStepId,
	type EntityKindId,
	type EntityRef,
	type Foreshadowing,
	type ForeshadowingOccurrence,
	type ImportCharacter,
	type ImportCount,
	type ImportDrop,
	type ImportEntity,
	type ImportFieldTemplate,
	type ImportInspection,
	type ImportLinkResolver,
	type ImportBeatSheetTemplate,
	type ImportMapping,
	type ImportPartKind,
	type ImportPicture,
	type ImportPlan,
	type ImportPlanEntry,
	type ImportPlanHooks,
	type ImportProjectContents,
	type ImportProjectShape,
	type ImportProvenanceEntry,
	type ImportProvenanceRefresh,
	type ImportRecord,
	type ImportRewriteContext,
	type ImportScene,
	type ImportSelection,
	type ImportSkipReason,
	type ImportStep,
	type ImportVocabularyNode,
	type ProjectWorldbuildingKind,
	type Revision,
	type Task,
	type Timeline,
} from "../domain";
import type { VaultRepository } from "../repository";
import { readMarkedSection, templateNoteFields } from "../templates";
import { characterRoleName, characterStarterNames } from "./definition-files";
import { galleryFolderPath } from "./gallery-service";
import type { SnowflakeProjectService } from "./project-service";
import {
	entitiesOf,
	entityKindFolder,
	getProjectPathLayout,
	type CharacterPatch,
	type CharacterRecord,
	type EntityPatch,
	type KindScope,
	type ProjectLocator,
	type ProjectRef,
	type ProjectSnapshot,
	type ScenePatch,
	type SceneRecord,
	type WorldbuildingRecord,
} from "./types";

export type ImportRefusalCode =
	| "same-project"
	| "read-only-target"
	| "read-only-source"
	| "nested"
	| "kind-refused";

/** An import that cannot run at all, before anything is written; the code names why. */
export class ImportRefusedError extends Error {
	constructor(
		readonly code: ImportRefusalCode,
		message: string,
		/** What the code is about, for a message in the author's words: the kind a refusal names. */
		readonly detail: string | null = null,
	) {
		super(message);
		this.name = "ImportRefusedError";
	}
}

export const IMPORT_PHASES = [
	"kinds",
	"vocabulary",
	"templates",
	"pictures",
	"members",
	"steps",
	"chapters",
	"records",
	"views",
	"provenance",
] as const;
export type ImportPhase = (typeof IMPORT_PHASES)[number];

export interface ImportProgress {
	readonly phase: ImportPhase;
	/** Parts landed, written or given up on so far, of every part the plan writes. It never goes back. */
	readonly done: number;
	readonly total: number;
}

export interface ImportRunOptions {
	onProgress?: (progress: ImportProgress) => void;
}

/** One part as the report names it: what it is, what it was called, and where its copy stands. */
export interface ImportReportItem {
	readonly kind: ImportPartKind;
	readonly key: string;
	readonly name: string;
	readonly targetName: string;
	readonly targetPath: string | null;
}

export interface ImportReportSkip extends ImportReportItem {
	readonly reason: ImportSkipReason;
}

export interface ImportReportFailure extends ImportReportItem {
	readonly message: string;
}

/** A link a copy could not keep: which field held it on which part, and what it named in the source. */
export interface ImportReportDrop {
	readonly owner: ImportReportItem;
	readonly field: string;
	readonly target: string;
}

export interface ImportReport {
	readonly source: { readonly id: string; readonly title: string };
	readonly target: { readonly id: string; readonly title: string; readonly projectFile: string };
	readonly created: ImportReportItem[];
	readonly replaced: ImportReportItem[];
	readonly skipped: ImportReportSkip[];
	readonly failed: ImportReportFailure[];
	readonly droppedLinks: ImportReportDrop[];
	readonly pictures: { landed: number; reused: number };
	readonly kindsCreated: string[];
	/** What the plan meant to do, by kind. */
	readonly counts: Readonly<Record<ImportPartKind, ImportCount>>;
}

/** What the project service hands the importer besides itself: the module-private path helpers and the id mint. */
export interface ProjectImportDeps {
	definitionRootPath: (project: KindScope, kind: EntityKindId, id: DefinitionFileId) => string;
	customFieldRootPath: (project: KindScope, kind: EntityKindId) => string;
	mint: (prefix: string) => string;
	now: () => number;
}

/** How many parts are written between two turns handed back to the event loop. */
const YIELD_EVERY = 25;

const yieldToEventLoop = (): Promise<void> =>
	new Promise((resolve) => {
		// The app's window where there is one; a test runtime has none and need not wait.
		const host = typeof window === "undefined" ? null : window;
		if (host === null) resolve();
		else host.setTimeout(resolve, 0);
	});

const foldPath = (path: string): string => path.normalize("NFC").toLowerCase();

const isUnder = (path: string, root: string): boolean =>
	foldPath(path).startsWith(`${foldPath(root).replace(/\/+$/u, "")}/`);

const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

// ---- Reading a project into the shapes the domain takes --------------------

const characterOf = (record: CharacterRecord): ImportCharacter => ({
	id: record.characterId,
	path: record.path,
	name: record.name,
	rank: record.rank,
	progressStatus: record.progressStatus,
	aliases: record.aliases,
	categories: record.categories,
	color: record.color,
	gallery: record.gallery,
	galleryMain: record.galleryMain,
	worldStatus: record.worldStatus,
	relationships: record.relationships,
	worldStatusUnrecognized: record.worldStatusUnrecognized,
	relationshipsUnrecognized: record.relationshipsUnrecognized,
	customFields: record.customFields,
	type: record.type,
	oneSentenceStoryline: record.oneSentenceStoryline,
	motivation: record.motivation,
	goal: record.goal,
	conflict: record.conflict,
	growth: record.growth,
	oneParagraphStoryline: record.oneParagraphStoryline,
	characterSynopsis: record.characterSynopsis,
	characterProfile: record.characterProfile,
});

const sceneOf = (record: SceneRecord): ImportScene => ({
	id: record.sceneId,
	path: record.path,
	name: record.title,
	rank: record.rank,
	progressStatus: record.progressStatus,
	aliases: record.aliases,
	categories: record.categories,
	color: record.color,
	gallery: record.gallery,
	galleryMain: record.galleryMain,
	worldStatus: record.worldStatus,
	relationships: record.relationships,
	worldStatusUnrecognized: record.worldStatusUnrecognized,
	relationshipsUnrecognized: record.relationshipsUnrecognized,
	customFields: record.customFields,
	povPath: record.povPath,
	times: record.times,
	locations: record.locations,
	characters: record.characters,
	conflict: record.conflict,
	linkedManuscript: record.linkedManuscript,
	events: record.events,
	planning: record.planning,
});

const entityOf = (record: WorldbuildingRecord): ImportEntity => ({
	id: record.entityId,
	path: record.path,
	name: record.name,
	rank: record.rank,
	progressStatus: record.progressStatus,
	aliases: record.aliases,
	categories: record.categories,
	color: record.color,
	gallery: record.gallery,
	galleryMain: record.galleryMain,
	worldStatus: record.worldStatus,
	relationships: record.relationships,
	worldStatusUnrecognized: record.worldStatusUnrecognized,
	relationshipsUnrecognized: record.relationshipsUnrecognized,
	customFields: record.customFields,
	kind: record.kind,
	description: record.description,
	timeKind: record.timeKind,
	timeStart: record.timeStart,
	timeEnd: record.timeEnd,
	notes: record.notes,
});

const entityKindIdsOf = (project: ProjectRef): string[] => [
	"character",
	"scene",
	...project.worldbuildingKinds.map((kind) => kind.id),
];

const EDITABLE_STEPS = [1, 2, 4, 6] as const satisfies readonly EditableStepId[];

/**
 * Which custom kinds of a source stand in a target under a name that folds
 * the same: `faction` beside `Faction`. The registry refuses a second kind
 * of a folded namesake, so the source's is read as the target's.
 */
function kindAliases(
	source: readonly ProjectWorldbuildingKind[],
	target: readonly ProjectWorldbuildingKind[],
): Map<string, string> {
	const aliases = new Map<string, string>();
	const targetIds = new Set(target.map((kind) => kind.id));
	for (const kind of source) {
		if (targetIds.has(kind.id)) continue;
		const namesake = target.find((candidate) => foldName(candidate.id) === foldName(kind.id));
		if (namesake !== undefined) aliases.set(kind.id, namesake.id);
	}
	return aliases;
}

/** The source said in the target's kind ids wherever the two fold the same. */
function withKindAliases(contents: ImportProjectContents, aliases: ReadonlyMap<string, string>): ImportProjectContents {
	if (aliases.size === 0) return contents;
	const of = (kind: string): string => aliases.get(kind) ?? kind;
	const rekey = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
		Object.fromEntries(Object.entries(record).map(([kind, value]) => [of(kind), value]));
	const ref = (held: EntityRef): EntityRef => (aliases.has(held.kind) ? { ...held, kind: of(held.kind) } : held);
	const project: ImportProjectShape = {
		...contents.project,
		kinds: contents.project.kinds.map((kind) => (aliases.has(kind.id) ? { ...kind, id: of(kind.id) } : kind)),
		memberFolders: rekey(contents.project.memberFolders),
		definitionRoots: rekey(contents.project.definitionRoots),
		galleryFolders: rekey(contents.project.galleryFolders),
		customFieldRoots: rekey(contents.project.customFieldRoots),
	};
	return {
		...contents,
		project,
		entities: contents.entities.map((entity) => (aliases.has(entity.kind) ? { ...entity, kind: of(entity.kind) } : entity)),
		vocabulary: contents.vocabulary.map((node) => (aliases.has(node.kind) ? { ...node, kind: of(node.kind) } : node)),
		templates: contents.templates.map((template) =>
			aliases.has(template.kind) ? { ...template, kind: of(template.kind) } : template,
		),
		pictures: contents.pictures.map((picture) => (aliases.has(picture.kind) ? { ...picture, kind: of(picture.kind) } : picture)),
		tasks: contents.tasks.map((task) => ({ ...task, related: task.related.map(ref) })),
		foreshadowing: contents.foreshadowing.map((thread) => ({ ...thread, related: thread.related.map(ref) })),
		timelines: contents.timelines.map((timeline) =>
			timeline.binding === null ? timeline : { ...timeline, binding: ref(timeline.binding) },
		),
		freeformViews: contents.freeformViews.map((view) => ({
			...view,
			placements: view.placements.map((placement) =>
				placement.resource.type === "entity" && aliases.has(placement.resource.kind)
					? { ...placement, resource: { ...placement.resource, kind: of(placement.resource.kind) } }
					: placement,
			),
		})),
	};
}

/** A project as read for an import, with what the shapes leave out: which template each kind seeds its fields from. */
interface GatheredProject {
	readonly snapshot: ProjectSnapshot;
	readonly contents: ImportProjectContents;
	/** By kind id, the chosen template's path without its extension; absent where the kind has no choice. */
	readonly templateChoices: ReadonlyMap<string, string>;
}

/** A snapshot the run appends to as it writes, so each create sees the ones before it without a reload. */
function workingSnapshotOf(project: ProjectSnapshot): ProjectSnapshot {
	const worldbuilding: Record<string, WorldbuildingRecord[]> = {};
	for (const [kind, records] of Object.entries(project.worldbuilding)) worldbuilding[kind] = [...records];
	return {
		...project,
		characters: [...project.characters],
		scenes: [...project.scenes],
		worldbuilding,
	};
}

function replaceIn<T>(records: T[], match: (record: T) => boolean, next: T): void {
	const index = records.findIndex(match);
	if (index === -1) records.push(next);
	else records[index] = next;
}

// ---- The service -----------------------------------------------------------

export class ProjectImportService {
	constructor(
		private readonly repository: VaultRepository,
		private readonly projects: SnowflakeProjectService,
		private readonly deps: ProjectImportDeps,
	) {}

	/**
	 * What a source offers a target and how each part already stands there,
	 * for the dialog to tick from. Writes nothing but a record found out of
	 * date, where the two sides agree though it remembers otherwise. Refuses
	 * the pairs no run could take: a project and itself, nested roots, a
	 * project this build may not write or may not read in full.
	 */
	async inspectSource(sourceLocator: ProjectLocator, targetLocator: ProjectLocator): Promise<ImportInspection> {
		const source = await this.projects.loadProject(sourceLocator);
		const target = await this.projects.loadProject(targetLocator);
		this.refuse(source, target);
		const { inspection } = await this.inspectLoaded(source, target);
		await this.refreshRecords(source, target, inspection.refresh);
		return inspection;
	}

	/** Entries an inspection found out of date, written back where they are held, so the next reading agrees without a run. */
	private async refreshRecords(
		source: ProjectRef,
		target: ProjectRef,
		refresh: readonly ImportProvenanceRefresh[],
	): Promise<void> {
		const own = refresh.filter((found) => found.record === "own").map((found) => found.entry);
		const theirs = refresh.filter((found) => found.record === "source").map((found) => found.entry);
		if (own.length > 0) await this.projects.imports.updateDocument(target, (held) => recordImports(held, own));
		if (theirs.length > 0) {
			await this.projects.imports.updateDocument(source, (held) => refreshImports(held, theirs, importCopyKey));
		}
	}

	/** The plan a selection comes to against an inspection, as the dialog's summary shows it; pure over the inspection. */
	plan(inspection: ImportInspection, selection: ImportSelection): ImportPlan {
		return planImport(inspection, selection, this.hooks(inspection.target.project)).plan;
	}

	/**
	 * Copies the selection from the source into the target. Inspects and plans
	 * afresh, makes the custom kinds the plan needs and plans once more over
	 * the target as it then stands, then writes phase by phase. What lands is
	 * recorded in the target's import store whatever else happened.
	 */
	async runImport(
		sourceLocator: ProjectLocator,
		targetLocator: ProjectLocator,
		selection: ImportSelection,
		options: ImportRunOptions = {},
	): Promise<ImportReport> {
		const source = await this.projects.loadProject(sourceLocator);
		let target = await this.projects.loadProject(targetLocator);
		this.refuse(source, target);
		let gathered = await this.inspectLoaded(source, target);
		let planned = planImport(gathered.inspection, selection, this.hooks(target));

		const kindsCreated: string[] = [];
		if (planned.plan.kindsToCreate.length > 0) options.onProgress?.({ phase: "kinds", done: 0, total: 0 });
		for (const kind of planned.plan.kindsToCreate) {
			const made = await this.projects.createWorldbuildingKind(target, kind.id, {
				...(kind.icon === null ? {} : { icon: kind.icon }),
				...(kind.description === null ? {} : { description: kind.description }),
			});
			if (!made.ok) {
				throw new ImportRefusedError(
					"kind-refused",
					`The kind "${kind.id}" could not be made in "${target.title}": ${made.code}.`,
					kind.id,
				);
			}
			kindsCreated.push(made.kind.id);
		}
		if (kindsCreated.length > 0) {
			// Every path under a kind derives from the target's own folder
			// prefix, which only the registry knows, so the plan is made again
			// over the target as it now stands.
			target = await this.projects.loadProject(target.projectFile);
			gathered = await this.inspectLoaded(source, target);
			planned = planImport(gathered.inspection, selection, this.hooks(target));
		}

		const run = new ImportRun(
			this.repository,
			this.projects,
			this.deps,
			gathered,
			planned.plan,
			planned.mapping,
			kindsCreated,
			options.onProgress,
		);
		try {
			await run.write();
		} finally {
			await run.recordProvenance(selection);
		}
		return run.report;
	}

	private hooks(target: Pick<ProjectRef, "rootPath" | "locale">): ImportPlanHooks {
		return {
			mint: (prefix) => this.deps.mint(prefix),
			chapterPath: (title) => this.projects.manuscript.plannedSegmentPath(target, title),
		};
	}

	private refuse(source: ProjectRef, target: ProjectRef): void {
		if (source.id === target.id || foldPath(source.rootPath) === foldPath(target.rootPath)) {
			throw new ImportRefusedError("same-project", `"${target.title}" cannot import from itself.`);
		}
		if (isUnder(source.rootPath, target.rootPath) || isUnder(target.rootPath, source.rootPath)) {
			throw new ImportRefusedError(
				"nested",
				`"${source.title}" and "${target.title}" stand one inside the other.`,
			);
		}
		if (target.readOnly) {
			throw new ImportRefusedError(
				"read-only-target",
				`"${target.title}" was written by a newer release and cannot be written to.`,
			);
		}
		if (source.readOnly) {
			throw new ImportRefusedError(
				"read-only-source",
				`"${source.title}" was written by a newer release and cannot be read in full.`,
			);
		}
	}

	private async inspectLoaded(
		source: ProjectSnapshot,
		target: ProjectSnapshot,
	): Promise<{ inspection: ImportInspection; source: GatheredProject; target: GatheredProject }> {
		const gatheredTarget = await this.gather(target);
		const gatheredSource = await this.gather(source);
		const aliases = kindAliases(source.worldbuildingKinds, target.worldbuildingKinds);
		const contents = withKindAliases(gatheredSource.contents, aliases);
		const provenance = await this.projects.imports.readDocument(target);
		const sourceProvenance = await this.projects.imports.readDocument(source);
		const inspection = inspectImport({
			source: contents,
			target: gatheredTarget.contents,
			takenPaths: this.repository.listFilesBelow(target.rootPath).map((file) => file.path),
			provenance,
			sourceProvenance,
		});
		return {
			inspection,
			source: { ...gatheredSource, contents },
			target: gatheredTarget,
		};
	}

	private shapeOf(project: ProjectSnapshot): ImportProjectShape {
		const layout = getProjectPathLayout(project.locale);
		const memberFolders: Record<string, string> = {};
		const definitionRoots: Record<string, Partial<Record<DefinitionFileId, string>>> = {};
		const galleryFolders: Record<string, string> = {};
		const customFieldRoots: Record<string, string> = {};
		for (const kind of entityKindIdsOf(project)) {
			memberFolders[kind] = normalizePath(`${project.rootPath}/${entityKindFolder(project, kind)}`);
			const roots: Partial<Record<DefinitionFileId, string>> = {};
			for (const id of DEFINITION_FILE_IDS) roots[id] = this.deps.definitionRootPath(project, kind, id);
			definitionRoots[kind] = roots;
			galleryFolders[kind] = galleryFolderPath(project, kind);
			customFieldRoots[kind] = this.deps.customFieldRootPath(project, kind);
		}
		const roles = {} as Record<CharacterType, string>;
		for (const type of CHARACTER_TYPES) roles[type] = characterRoleName(project.locale, type);
		const starters = {} as Record<DefinitionFileId, readonly string[]>;
		for (const id of DEFINITION_FILE_IDS) starters[id] = characterStarterNames(project.locale, id);
		return {
			id: project.id,
			title: project.title,
			rootPath: project.rootPath,
			locale: project.locale,
			kinds: project.worldbuildingKinds,
			memberFolders,
			definitionRoots,
			galleryFolders,
			customFieldRoots,
			draftFolder: normalizePath(`${project.rootPath}/${layout.directories.draft}`),
			roles,
			starters,
		};
	}

	/** Everything a project holds that an import can carry, read through the services that keep it. */
	private async gather(project: ProjectSnapshot): Promise<GatheredProject> {
		const shape = this.shapeOf(project);
		const kinds = entityKindIdsOf(project);

		const vocabulary: ImportVocabularyNode[] = [];
		for (const id of DEFINITION_FILE_IDS) {
			const forest = await this.projects.listDefinitionForest(project, id);
			for (const kind of kinds) {
				for (const node of forest[kind]?.nodes ?? []) {
					if (node.missing) continue;
					vocabulary.push({
						kind,
						id,
						taxonomyPath: node.taxonomyPath,
						selfPath: node.selfPath,
						description: node.description,
					});
				}
			}
		}

		const templates: ImportFieldTemplate[] = [];
		const templateChoices = new Map<string, string>();
		const listing = await this.projects.listCustomFieldTemplates(project);
		for (const kind of kinds) {
			const infos = listing[kind] ?? [];
			for (const info of infos) {
				const record = await this.repository.tryReadManaged(info.path);
				templates.push({
					kind,
					name: info.name,
					description: info.description,
					path: info.path,
					fields: record === null ? [] : templateNoteFields(record.content),
				});
			}
			if (infos.length === 0) continue;
			const chosen = await this.projects.kindTemplatePath(project, kind);
			if (chosen !== null) templateChoices.set(kind, importPathKey(chosen));
		}

		const pictures: ImportPicture[] = [];
		for (const kind of kinds) {
			for (const file of this.repository.listDirectFiles(galleryFolderPath(project, kind))) {
				if (isImagePath(file.path)) pictures.push({ kind, path: file.path, name: file.name });
			}
		}

		const steps: ImportStep[] = [];
		for (const step of EDITABLE_STEPS) {
			const artifact = project.artifacts[step];
			if (artifact === undefined) continue;
			const sections: Record<string, string> = {};
			for (const id of STEP_SECTION_IDS[step]) sections[id] = readMarkedSection(artifact.content, id) ?? "";
			steps.push({ step, path: artifact.path, sections });
		}

		const chapters = (await this.projects.manuscript.listSegments(project)).map((segment) => ({
			path: segment.path,
			title: segment.title,
		}));
		const beatSheets = await this.projects.beatSheet.read(project);

		const contents: ImportProjectContents = {
			project: shape,
			characters: project.characters.map(characterOf),
			scenes: project.scenes.map(sceneOf),
			entities: project.worldbuildingKinds.flatMap((kind) => entitiesOf(project, kind.id).map(entityOf)),
			vocabulary,
			templates,
			pictures,
			chapters,
			steps,
			tasks: await this.projects.tasks.list(project),
			foreshadowing: await this.projects.foreshadowing.list(project),
			revisions: await this.projects.revisions.list(project),
			stickyNotes: await this.projects.stickyNotes.list(project),
			freeformViews: (await this.projects.freeform.read(project)).views,
			timelines: (await this.projects.timeline.read(project)).timelines,
			beatSheets: beatSheets.sheets,
			beatSheetTemplates: beatSheets.templates.map((template) => ({
				name: template.name,
				description: template.description,
				structure: { acts: template.acts },
			})),
		};
		return { snapshot: project, contents, templateChoices };
	}
}

// ---- One run ---------------------------------------------------------------

/** The outcome of writing one planned part. */
type Outcome =
	| { readonly state: "created" | "replaced"; readonly targetName: string; readonly targetPath: string | null }
	| { readonly state: "failed"; readonly message: string };

/** A member as written: its outcome, the copy as read back for the provenance, and the links the rewrite let go. */
interface Written {
	readonly outcome: Outcome;
	readonly copy: ImportRecord;
	readonly dropped: readonly ImportDrop[];
}

/** A record or a document waiting on a batch write, with the links its rewrite let go, reported once it lands. */
interface Pending<T> {
	readonly entry: ImportPlanEntry;
	readonly value: T;
	readonly dropped: readonly ImportDrop[];
}

/** A part that landed, hashed once the run is over, when every note a copy's links name is there to resolve. */
interface Landed {
	readonly entry: ImportPlanEntry;
	readonly targetId: string | null;
	readonly targetName: string;
	readonly targetPath: string | null;
	readonly copy: ImportRecord | null;
}

/** The resolver of a snapshot's members, as `importLinkResolver` reads gathered contents. */
function resolverOf(project: ProjectSnapshot): ImportLinkResolver {
	const ids = new Map<string, string>();
	for (const character of project.characters) ids.set(importPathKey(character.path), character.characterId);
	for (const scene of project.scenes) ids.set(importPathKey(scene.path), scene.sceneId);
	for (const entities of Object.values(project.worldbuilding)) {
		for (const entity of entities) ids.set(importPathKey(entity.path), entity.entityId);
	}
	return (target) => ids.get(importPathKey(target)) ?? null;
}

class ImportRun {
	readonly report: ImportReport;
	private working: ProjectSnapshot;
	private readonly source: GatheredProject;
	private readonly inspection: ImportInspection;
	private readonly context: ImportRewriteContext;
	private readonly landed: Landed[] = [];
	/** Chapter bodies read for anchoring, by path. */
	private readonly bodies = new Map<string, string>();
	/** Source part names by the paths and ids a drop names, for the report. */
	private readonly namesByPath = new Map<string, string>();
	private readonly namesById = new Map<string, string>();
	private readonly total: number;
	private done = 0;
	private told = 0;
	private sinceYield = 0;
	private phase: ImportPhase = "kinds";

	constructor(
		private readonly repository: VaultRepository,
		private readonly projects: SnowflakeProjectService,
		private readonly deps: ProjectImportDeps,
		gathered: { inspection: ImportInspection; source: GatheredProject; target: GatheredProject },
		private readonly plan: ImportPlan,
		private readonly mapping: ImportMapping,
		kindsCreated: string[],
		private readonly onProgress: ((progress: ImportProgress) => void) | undefined,
	) {
		this.source = gathered.source;
		this.inspection = gathered.inspection;
		this.working = workingSnapshotOf(gathered.target.snapshot);
		this.context = importRewriteContext(gathered.inspection.source, gathered.inspection.target, mapping);
		for (const part of gathered.inspection.parts) {
			if (part.sourcePath !== null) this.namesByPath.set(importPathKey(part.sourcePath), part.name);
			this.namesById.set(part.sourceId, part.name);
		}
		this.total = plan.entries.filter((entry) => entry.action !== "skip").length;
		const target = gathered.target.snapshot;
		this.report = {
			source: { id: this.source.snapshot.id, title: this.source.snapshot.title },
			target: { id: target.id, title: target.title, projectFile: target.projectFile },
			created: [],
			replaced: [],
			skipped: plan.entries
				.filter((entry) => entry.action === "skip")
				.map((entry) => ({ ...itemOf(entry), reason: entry.reason ?? "name-taken" })),
			failed: [],
			droppedLinks: [],
			pictures: { landed: 0, reused: 0 },
			kindsCreated,
			counts: plan.counts,
		};
	}

	async write(): Promise<void> {
		await this.writeVocabulary();
		await this.writeTemplates();
		await this.writePictures();
		await this.writeMembers();
		await this.writeSteps();
		await this.writeChapters();
		await this.writeRecords();
		await this.writeViews();
	}

	/**
	 * What landed, remembered in the target's import store with the choices
	 * this run was made with. A copy is hashed now rather than as it was
	 * written: its links name notes this run went on to create, and the
	 * projection reads those by id only once they stand. The source's own
	 * entries about the parts just copied from this project are brought up to
	 * date as well, with the note written here as their source, so the source
	 * reads them as unchanged rather than as changed on both sides.
	 */
	async recordProvenance(selection: ImportSelection): Promise<void> {
		this.begin("provenance");
		const now = this.deps.now();
		const choices = { parts: [...selection.parts], clashPolicy: selection.clashPolicy, at: now };
		const sourceId = this.source.snapshot.id;
		const resolveSource = importLinkResolver(this.source.contents);
		const resolveTarget = resolverOf(this.working);
		const entries: ImportProvenanceEntry[] = [];
		const theirs: ImportProvenanceEntry[] = [];
		for (const { entry, targetId, targetName, targetPath, copy } of this.landed) {
			const sourceHash = importHash(entry.part.record, resolveSource);
			const copyHash = copy === null ? sourceHash : importHash(copy, resolveTarget);
			entries.push({
				kind: entry.part.kind,
				targetId,
				targetPath,
				targetName,
				sourceProjectId: sourceId,
				sourceId: entry.part.sourceId,
				sourcePath: entry.part.sourcePath,
				sourceHash,
				copyHash,
				importedAt: now,
			});
			const held = this.inspection.reverse.get(entry.part.key);
			if (held === undefined) continue;
			theirs.push({
				...held,
				sourceId: importKindHasOwnId(held.kind) && targetId !== null ? targetId : held.sourceId,
				sourcePath: targetPath ?? held.sourcePath,
				sourceHash: copyHash,
				copyHash: sourceHash,
				importedAt: now,
			});
		}
		for (const found of this.inspection.refresh) (found.record === "own" ? entries : theirs).push(found.entry);
		await this.projects.imports.updateDocument(this.working, (held) => {
			const remembered = rememberChoices(held, sourceId, choices);
			return recordImports(remembered, entries) ?? remembered;
		});
		if (theirs.length > 0) {
			await this.projects.imports.updateDocument(this.source.snapshot, (held) =>
				refreshImports(held, theirs, importCopyKey),
			);
		}
	}

	// ---- Phases -------------------------------------------------------------

	private async writeVocabulary(): Promise<void> {
		this.begin("vocabulary");
		const groups = new Map<string, { kind: string; id: DefinitionFileId; replace: boolean; entries: ImportPlanEntry[] }>();
		for (const entry of this.entriesOf("vocabulary")) {
			if (entry.part.record.kind !== "vocabulary") continue;
			const node = entry.part.record.node;
			const replace = entry.action === "replace";
			const key = `${node.kind}/${node.id}/${replace ? "replace" : "create"}`;
			const group = groups.get(key) ?? { kind: node.kind, id: node.id, replace, entries: [] };
			group.entries.push(entry);
			groups.set(key, group);
		}
		for (const group of groups.values()) {
			const nodes = group.entries.map((entry) => ({
				taxonomyPath: entry.targetName,
				description: entry.part.record.kind === "vocabulary" ? entry.part.record.node.description : "",
			}));
			let refused = new Set<string>();
			let stood = new Map<string, { taxonomyPath: string; selfPath: string }>();
			let failure: string | null = null;
			try {
				const made = await this.projects.ensureDefinitionPaths(this.working, group.kind, group.id, nodes, {
					replaceDescriptions: group.replace,
					userInput: false,
				});
				refused = new Set(made.refused);
				stood = made.nodes;
			} catch (error) {
				failure = messageOf(error);
			}
			for (const entry of group.entries) {
				if (failure !== null) {
					await this.settle(entry, { state: "failed", message: failure });
				} else if (refused.has(entry.targetName)) {
					await this.settle(entry, { state: "failed", message: "The node's name cannot be a folder name." });
				} else if (entry.part.record.kind === "vocabulary") {
					// As raised rather than as planned: a folder on the way may already stand under another spelling, which the note's path takes.
					const node = stood.get(entry.targetName);
					const taxonomyPath = node?.taxonomyPath ?? entry.targetName;
					const selfPath = node?.selfPath ?? entry.targetPath;
					if (selfPath !== null) this.mapping.paths.set(importPathKey(entry.part.record.node.selfPath), selfPath);
					const copy: ImportRecord = {
						kind: "vocabulary",
						node: { ...entry.part.record.node, taxonomyPath, selfPath: selfPath ?? "" },
					};
					await this.settle(
						entry,
						{ state: group.replace ? "replaced" : "created", targetName: taxonomyPath, targetPath: selfPath },
						copy,
					);
				}
			}
		}
	}

	private async writeTemplates(): Promise<void> {
		this.begin("templates");
		const chosen = new Map<string, string>();
		for (const entry of this.entriesOf("custom-field-template")) {
			if (entry.part.record.kind !== "custom-field-template") continue;
			const template = entry.part.record.template;
			try {
				const saved = await this.projects.saveCustomFieldTemplate(
					this.working,
					template.kind,
					{ name: entry.targetName, description: template.description, fields: [...template.fields] },
					{ overwrite: entry.action === "replace", userInput: false },
				);
				if (!saved.ok) {
					await this.settle(entry, { state: "failed", message: `The template was refused: ${saved.code}.` });
					continue;
				}
				this.mapping.paths.set(importPathKey(template.path), saved.path);
				if (this.source.templateChoices.get(template.kind) === importPathKey(template.path)) {
					chosen.set(template.kind, saved.path);
				}
				await this.settle(
					entry,
					{ state: entry.action === "replace" ? "replaced" : "created", targetName: entry.targetName, targetPath: saved.path },
					{ kind: "custom-field-template", template: { ...template, name: entry.targetName, path: saved.path } },
				);
			} catch (error) {
				await this.settle(entry, { state: "failed", message: messageOf(error) });
			}
		}
		// The source's choice seeds the target's only where the target has made none.
		for (const [kind, path] of chosen) {
			if ((await this.projects.kindTemplatePath(this.working, kind)) !== null) continue;
			await this.projects.setKindTemplate(this.working, kind, importPathKey(path));
		}
	}

	private async writePictures(): Promise<void> {
		this.begin("pictures");
		for (const entry of this.entriesOf("picture")) {
			if (entry.part.record.kind !== "picture") continue;
			const picture = entry.part.record.picture;
			try {
				const file = this.repository.getFile(picture.path);
				if (file === null) throw new Error(`The picture "${picture.path}" is not there.`);
				const data = await this.repository.vault.readBinary(file);
				const [landed] = await this.projects.gallery.landMatching(this.working, picture.kind, [
					{ name: picture.name, data },
				]);
				if (landed === undefined) throw new Error("The picture did not land.");
				this.mapping.paths.set(importPathKey(picture.path), landed.path);
				if (landed.created) this.report.pictures.landed += 1;
				else this.report.pictures.reused += 1;
				await this.settle(entry, { state: "created", targetName: entry.targetName, targetPath: landed.path });
			} catch (error) {
				await this.settle(entry, { state: "failed", message: messageOf(error) });
			}
		}
	}

	private async writeMembers(): Promise<void> {
		this.begin("members");
		// Periods first: a `when` clause is rendered against the times the
		// snapshot knows, so a time has to stand before anything names it.
		const entities = this.entriesOf("worldbuilding");
		const ordered = [
			...entities.filter((entry) => entry.part.group === "time"),
			...entities.filter((entry) => entry.part.group !== "time"),
			...this.entriesOf("character"),
			...this.entriesOf("scene"),
		];
		for (const entry of ordered) {
			const stood = entry.targetPath !== null && this.repository.getFile(entry.targetPath) !== null;
			try {
				const written = await this.writeMember(entry);
				this.noteDrops(entry, written.dropped);
				await this.settle(entry, written.outcome, written.copy);
			} catch (error) {
				// A create that failed after the file was made leaves a stub
				// nothing lists; it goes before the next part is tried.
				if (!stood && entry.action === "create" && entry.targetPath !== null && this.repository.getFile(entry.targetPath) !== null) {
					try {
						await this.repository.trashFile(entry.targetPath);
					} catch {
						// The stub stays; the failure below says what went wrong.
					}
				}
				await this.settle(entry, { state: "failed", message: messageOf(error) });
			}
		}
	}

	/** One member written through the batch seams: what came of it, the copy as read back, and the links the rewrite let go. */
	private async writeMember(entry: ImportPlanEntry): Promise<Written> {
		const record = entry.part.record;
		const options = { userInput: false };
		const made = { userInput: false, ...(entry.targetId === null ? {} : { id: entry.targetId }), ...(entry.rank === null ? {} : { rank: entry.rank }) };
		const state = entry.action === "replace" ? "replaced" : "created";
		// A copy this source made follows the source's name, a rename being a
		// change like any other; a namesake the author made here keeps its own.
		const standing = this.inspection.standing.get(entry.part.key);
		const renames = standing !== undefined && (standing.kind === "update" || standing.kind === "conflict");
		switch (record.kind) {
			case "character": {
				const rewrite = characterInputOf(record.member, this.context);
				const input = rewrite.value;
				let written: CharacterRecord;
				if (entry.action === "replace" && entry.targetId !== null) {
					const held = this.working.characters.find((candidate) => candidate.characterId === entry.targetId);
					if (held === undefined) throw new Error(`The character "${entry.targetName}" is no longer here.`);
					const patch: CharacterPatch = {
						expectedRevision: held.revision,
						...(renames ? { name: input.name } : {}),
						...(input.type === undefined ? {} : { type: input.type }),
						aliases: input.aliases,
						categoryPaths: input.categoryPaths,
						progressStatus: input.progressStatus,
						oneSentenceStoryline: input.oneSentenceStoryline,
						motivation: input.motivation,
						goal: input.goal,
						conflict: input.conflict,
						growth: input.growth,
						worldStatus: input.worldStatus,
						relationships: input.relationships,
						oneParagraphStoryline: input.oneParagraphStoryline,
						characterSynopsis: input.characterSynopsis,
						characterProfile: input.characterProfile,
						customFields: input.customFields,
						color: input.color,
						gallery: input.gallery,
						galleryMain: input.galleryMain,
					};
					written = await this.projects.updateCharacterIn(this.working, entry.targetId, patch, options);
					replaceIn(this.working.characters, (candidate) => candidate.characterId === written.characterId, written);
					if (written.name !== held.name) await this.reloadWorking();
				} else {
					written = await this.projects.createCharacterIn(this.working, input, made);
					this.working.characters.push(written);
				}
				this.mapping.paths.set(importPathKey(record.member.path), written.path);
				return {
					outcome: { state, targetName: written.name, targetPath: written.path },
					copy: { kind: "character", member: characterOf(written) },
					dropped: rewrite.dropped,
				};
			}
			case "scene": {
				const rewrite = sceneInputOf(record.member, this.context);
				const input = rewrite.value;
				let written: SceneRecord;
				if (entry.action === "replace" && entry.targetId !== null) {
					const held = this.working.scenes.find((candidate) => candidate.sceneId === entry.targetId);
					if (held === undefined) throw new Error(`The scene "${entry.targetName}" is no longer here.`);
					const patch: ScenePatch = {
						expectedRevision: held.revision,
						...(renames ? { title: input.title } : {}),
						povPath: input.povPath,
						aliases: input.aliases,
						categoryPaths: input.categoryPaths,
						progressStatus: input.progressStatus,
						times: input.times,
						locations: input.locations,
						characters: input.characters,
						conflict: input.conflict,
						worldStatus: input.worldStatus,
						relationships: input.relationships,
						events: input.events,
						planning: input.planning,
						customFields: input.customFields,
						color: input.color,
						linkedManuscript: input.linkedManuscript,
						gallery: input.gallery,
						galleryMain: input.galleryMain,
					};
					written = await this.projects.updateSceneIn(this.working, entry.targetId, patch, options);
					replaceIn(this.working.scenes, (candidate) => candidate.sceneId === written.sceneId, written);
					if (written.title !== held.title) await this.reloadWorking();
				} else {
					written = await this.projects.createSceneIn(this.working, input, made);
					this.working.scenes.push(written);
				}
				this.mapping.paths.set(importPathKey(record.member.path), written.path);
				return {
					outcome: { state, targetName: written.title, targetPath: written.path },
					copy: { kind: "scene", member: sceneOf(written) },
					dropped: rewrite.dropped,
				};
			}
			case "worldbuilding": {
				const rewrite = entityInputOf(record.member, this.context);
				const input = rewrite.value;
				let written: WorldbuildingRecord;
				if (entry.action === "replace" && entry.targetId !== null) {
					const held = entitiesOf(this.working, input.kind).find((candidate) => candidate.entityId === entry.targetId);
					if (held === undefined) throw new Error(`The entity "${entry.targetName}" is no longer here.`);
					const patch: EntityPatch = {
						expectedRevision: held.revision,
						...(renames ? { name: input.name } : {}),
						aliases: input.aliases,
						categoryPaths: input.categoryPaths,
						progressStatus: input.progressStatus,
						description: input.description,
						timeKind: input.timeKind,
						timeStart: input.timeStart,
						timeEnd: input.timeEnd,
						worldStatus: input.worldStatus,
						relationships: input.relationships,
						notes: input.notes,
						customFields: input.customFields,
						color: input.color,
						gallery: input.gallery,
						galleryMain: input.galleryMain,
					};
					written = await this.projects.updateEntityIn(this.working, entry.targetId, patch, options);
					if (written.name !== held.name) await this.reloadWorking();
				} else {
					written = await this.projects.createEntityIn(this.working, input, made);
				}
				const bucket = this.working.worldbuilding[written.kind] ?? [];
				this.working.worldbuilding[written.kind] = bucket;
				replaceIn(bucket, (candidate) => candidate.entityId === written.entityId, written);
				this.mapping.paths.set(importPathKey(record.member.path), written.path);
				return {
					outcome: { state, targetName: written.name, targetPath: written.path },
					copy: { kind: "worldbuilding", member: entityOf(written) },
					dropped: rewrite.dropped,
				};
			}
			default:
				throw new Error(`Not a member: ${record.kind}.`);
		}
	}

	private async writeSteps(): Promise<void> {
		this.begin("steps");
		for (const entry of this.entriesOf("step")) {
			if (entry.part.record.kind !== "step") continue;
			const step = entry.part.record.step;
			try {
				if (entry.targetPath === null) throw new Error("The target has no note for this step.");
				const standing = await this.repository.readManaged(entry.targetPath);
				const values: Record<string, string> = {};
				for (const [id, value] of Object.entries(step.sections)) values[id] = rewriteProseLinks(value, this.mapping);
				await this.repository.updateSections(entry.targetPath, values, fingerprint(standing.content), {
					userInput: false,
				});
				await this.settle(
					entry,
					{ state: entry.action === "replace" ? "replaced" : "created", targetName: entry.targetName, targetPath: entry.targetPath },
					{ kind: "step", step: { step: step.step, path: entry.targetPath, sections: values } },
				);
			} catch (error) {
				await this.settle(entry, { state: "failed", message: messageOf(error) });
			}
		}
	}

	private async writeChapters(): Promise<void> {
		this.begin("chapters");
		const entries = this.entriesOf("chapter");
		if (entries.length === 0) return;
		const drafts: { entry: ImportPlanEntry; title: string; body: string }[] = [];
		for (const entry of entries) {
			if (entry.part.record.kind !== "chapter") continue;
			try {
				const read = await this.projects.manuscript.readSegment(entry.part.record.chapter.path);
				drafts.push({ entry, title: entry.targetName, body: rewriteProseLinks(read.body, this.mapping) });
			} catch (error) {
				await this.settle(entry, { state: "failed", message: messageOf(error) });
			}
		}
		let paths: string[] = [];
		let failure: string | null = null;
		let landed = 0;
		try {
			paths = await this.projects.manuscript.appendSegments(
				this.working,
				drafts.map((draft) => ({ title: draft.title, body: draft.body })),
				{
					userInput: false,
					// The batch is settled afterwards; meanwhile the progress is told each chapter as it lands.
					onCreated: () => {
						landed += 1;
						this.peek(landed);
					},
				},
			);
		} catch (error) {
			failure = messageOf(error);
		}
		for (const [index, draft] of drafts.entries()) {
			const { entry } = draft;
			if (entry.part.record.kind !== "chapter") continue;
			const chapter = entry.part.record.chapter;
			// On a failure part way through, what landed is what stands at its planned path.
			const path =
				paths[index] ??
				(entry.targetPath !== null && this.repository.getFile(entry.targetPath) !== null ? entry.targetPath : null);
			if (path === null) {
				await this.settle(entry, { state: "failed", message: failure ?? "The note did not land." });
				continue;
			}
			this.mapping.paths.set(importPathKey(chapter.path), path);
			this.mapping.names.set(chapter.path, draft.title);
			try {
				if (draft.title !== chapter.title) {
					await this.repository.updateFirstHeading(path, draft.title, { userInput: false });
				}
				await this.settle(entry, { state: "created", targetName: draft.title, targetPath: path });
			} catch (error) {
				await this.settle(entry, { state: "failed", message: messageOf(error) });
			}
		}
	}

	private async writeRecords(): Promise<void> {
		this.begin("records");
		await this.writeTasks();
		await this.writeForeshadowing();
		await this.writeRevisions();
		await this.writeStickyNotes();
	}

	private async writeTasks(): Promise<void> {
		const pending: Pending<Task>[] = [];
		for (const entry of this.entriesOf("task")) {
			if (entry.part.record.kind !== "task" || entry.targetId === null) continue;
			const rewrite = remapTask(entry.part.record.task, entry.targetId, this.mapping);
			pending.push({ entry, value: rewrite.value, dropped: rewrite.dropped });
		}
		await this.appendRecords(pending, (items) => this.projects.tasks.createMany(this.working, items));
	}

	private async writeForeshadowing(): Promise<void> {
		const pending: Pending<Foreshadowing>[] = [];
		for (const entry of this.entriesOf("foreshadowing")) {
			if (entry.part.record.kind !== "foreshadowing" || entry.targetId === null) continue;
			const rewrite = remapForeshadowing(entry.part.record.thread, entry.targetId, this.mapping);
			const dropped = [...rewrite.dropped];
			const occurrences: ForeshadowingOccurrence[] = [];
			try {
				for (const occurrence of rewrite.value.occurrences) {
					const body = await this.bodyOf(occurrence.path);
					const anchor = body === null ? null : anchorOccurrence(body, occurrence);
					if (anchor === null || anchor.state === "conflict") {
						dropped.push({ field: "occurrence", target: occurrence.path });
						continue;
					}
					occurrences.push({ ...occurrence, from: anchor.from, to: anchor.to });
				}
			} catch (error) {
				// A chapter copy that stands but cannot be read fails this thread alone, as a failed read does in every other phase.
				await this.settle(entry, { state: "failed", message: messageOf(error) });
				continue;
			}
			pending.push({ entry, value: { ...rewrite.value, occurrences }, dropped });
		}
		await this.appendRecords(pending, (items) => this.projects.foreshadowing.createMany(this.working, items));
	}

	private async writeRevisions(): Promise<void> {
		const pending: Pending<Revision>[] = [];
		for (const entry of this.entriesOf("revision")) {
			if (entry.part.record.kind !== "revision" || entry.targetId === null) continue;
			const moved = remapRevision(entry.part.record.revision, entry.targetId, this.mapping);
			if (moved === null) {
				await this.settle(entry, { state: "failed", message: "Its chapter was not imported." });
				continue;
			}
			let body: string | null;
			try {
				body = await this.bodyOf(moved.path);
			} catch (error) {
				await this.settle(entry, { state: "failed", message: messageOf(error) });
				continue;
			}
			const anchor = body === null ? null : anchorRevision(body, moved);
			if (anchor === null || anchor.state === "conflict") {
				await this.settle(entry, { state: "failed", message: "The words it was made over were not found in the copy." });
				continue;
			}
			pending.push({ entry, value: { ...moved, from: anchor.from, to: anchor.to }, dropped: [] });
		}
		await this.appendRecords(pending, (items) => this.projects.revisions.createMany(this.working, items));
	}

	/** One write for a batch of records: every one lands under its minted id, or the batch fails as one. */
	private async appendRecords<T>(
		pending: Pending<T>[],
		append: (items: T[]) => Promise<string[]>,
	): Promise<void> {
		if (pending.length === 0) return;
		let landed = new Set<string>();
		let failure: string | null = null;
		try {
			landed = new Set(await append(pending.map((item) => item.value)));
		} catch (error) {
			failure = messageOf(error);
		}
		for (const { entry, dropped } of pending) {
			if (entry.targetId !== null && landed.has(entry.targetId)) {
				this.noteDrops(entry, dropped);
				await this.settle(entry, { state: "created", targetName: entry.targetName, targetPath: null });
			} else {
				await this.settle(entry, { state: "failed", message: failure ?? "The record was not written." });
			}
		}
	}

	private async writeStickyNotes(): Promise<void> {
		for (const entry of this.entriesOf("sticky-note")) {
			if (entry.part.record.kind !== "sticky-note") continue;
			const note = entry.part.record.note;
			try {
				const created = new Date(note.createdAt);
				const made = await this.projects.stickyNotes.create(
					this.working,
					note.color,
					created,
					created.getTimezoneOffset(),
					rewriteProseLinks(note.body, this.mapping),
					note.archived,
				);
				this.mapping.ids.set(note.id, made.id);
				this.mapping.paths.set(importPathKey(note.path), made.path);
				await this.settle(entry, { state: "created", targetName: entry.targetName, targetPath: made.path }, null, made.id);
			} catch (error) {
				await this.settle(entry, { state: "failed", message: messageOf(error) });
			}
		}
	}

	private async writeViews(): Promise<void> {
		this.begin("views");
		for (const entry of this.entriesOf("freeform-view")) {
			if (entry.part.record.kind !== "freeform-view") continue;
			const rewrite = remapFreeformView(entry.part.record.view, entry.targetName, this.mapping);
			try {
				const id = await this.projects.freeform.importView(this.working, rewrite.value);
				if (id === null) throw new Error("The view was refused.");
				this.mapping.ids.set(entry.part.sourceId, id);
				this.noteDrops(entry, rewrite.dropped);
				await this.settle(entry, { state: "created", targetName: entry.targetName, targetPath: null }, null, id);
			} catch (error) {
				await this.settle(entry, { state: "failed", message: messageOf(error) });
			}
		}

		const timelines: Pending<Omit<Timeline, "id">>[] = [];
		for (const entry of this.entriesOf("timeline")) {
			if (entry.part.record.kind !== "timeline") continue;
			const rewrite = remapTimeline(entry.part.record.timeline, entry.targetName, this.mapping);
			timelines.push({ entry, value: rewrite.value, dropped: rewrite.dropped });
		}
		await this.appendDocuments(timelines, (items) => this.projects.timeline.importTimelines(this.working, items));

		const sheets: Pending<Omit<BeatSheet, "id">>[] = [];
		for (const entry of this.entriesOf("beat-sheet")) {
			if (entry.part.record.kind !== "beat-sheet") continue;
			const rewrite = remapBeatSheet(entry.part.record.sheet, entry.targetName, this.mapping);
			sheets.push({ entry, value: rewrite.value, dropped: rewrite.dropped });
		}
		await this.appendDocuments(sheets, (items) => this.projects.beatSheet.importSheets(this.working, items));

		const templates: Pending<ImportBeatSheetTemplate>[] = [];
		for (const entry of this.entriesOf("beat-sheet-template")) {
			if (entry.part.record.kind !== "beat-sheet-template") continue;
			templates.push({ entry, value: { ...entry.part.record.template, name: entry.targetName }, dropped: [] });
		}
		const replacing = templates.some(({ entry }) => entry.action === "replace");
		await this.appendDocuments(
			templates,
			(items) => this.projects.beatSheet.importTemplates(this.working, items, replacing ? "replace" : "skip"),
			(template) => ({ kind: "beat-sheet-template", template }),
		);
	}

	/** One write for a batch of documents, each answered with the id it stands under now or null. */
	private async appendDocuments<T>(
		pending: Pending<T>[],
		append: (items: T[]) => Promise<(string | null)[]>,
		copyOf: (value: T) => ImportRecord | null = () => null,
	): Promise<void> {
		if (pending.length === 0) return;
		let ids: (string | null)[] = pending.map(() => null);
		let failure: string | null = null;
		try {
			ids = await append(pending.map((item) => item.value));
		} catch (error) {
			failure = messageOf(error);
		}
		for (const [index, { entry, value, dropped }] of pending.entries()) {
			const id = ids[index] ?? null;
			if (id === null) {
				await this.settle(entry, { state: "failed", message: failure ?? "The document was not written." });
				continue;
			}
			this.mapping.ids.set(entry.part.sourceId, id);
			this.noteDrops(entry, dropped);
			await this.settle(
				entry,
				{ state: entry.action === "replace" ? "replaced" : "created", targetName: entry.targetName, targetPath: null },
				copyOf(value),
				id,
			);
		}
	}

	// ---- Bookkeeping --------------------------------------------------------

	private entriesOf(kind: ImportPartKind): ImportPlanEntry[] {
		return this.plan.entries.filter((entry) => entry.part.kind === kind && entry.action !== "skip");
	}

	private begin(phase: ImportPhase): void {
		this.phase = phase;
		this.tell(this.done);
	}

	/** Tells the progress about parts a batch has landed but not yet settled, so a long batch does not sit on one number. */
	private peek(ahead: number): void {
		this.tell(this.done + ahead);
	}

	/** The progress never goes back: parts told ahead by a batch stay counted while their settling catches up. */
	private tell(done: number): void {
		this.told = Math.max(this.told, done);
		this.onProgress?.({ phase: this.phase, done: this.told, total: this.total });
	}

	/** Records one part's outcome in the report and the provenance, then tells the progress and yields now and then. */
	private async settle(
		entry: ImportPlanEntry,
		outcome: Outcome,
		copy: ImportRecord | null = null,
		targetId: string | null = entry.targetId,
	): Promise<void> {
		const item = itemOf(entry);
		if (outcome.state === "failed") {
			this.report.failed.push({ ...item, message: outcome.message });
		} else {
			const landed = { ...item, targetName: outcome.targetName, targetPath: outcome.targetPath };
			(outcome.state === "created" ? this.report.created : this.report.replaced).push(landed);
			this.landed.push({ entry, targetId, targetName: outcome.targetName, targetPath: outcome.targetPath, copy });
		}
		this.done += 1;
		this.tell(this.done);
		this.sinceYield += 1;
		if (this.sinceYield >= YIELD_EVERY) {
			this.sinceYield = 0;
			await yieldToEventLoop();
		}
	}

	private noteDrops(entry: ImportPlanEntry, dropped: readonly ImportDrop[]): void {
		for (const drop of dropped) {
			this.report.droppedLinks.push({ owner: itemOf(entry), field: drop.field, target: this.nameOf(drop.target) });
		}
	}

	/** The name of the source part a path or an id names, else the words as given. */
	private nameOf(target: string): string {
		return this.namesByPath.get(importPathKey(target)) ?? this.namesById.get(target) ?? target;
	}

	/** A written chapter's body, read once; null where the note is not there. */
	private async bodyOf(path: string): Promise<string | null> {
		const held = this.bodies.get(path);
		if (held !== undefined) return held;
		if (this.repository.getFile(path) === null) return null;
		const body = (await this.projects.manuscript.readSegment(path)).body;
		this.bodies.set(path, body);
		return body;
	}

	/**
	 * The snapshot read again after a replace renamed a member: the service
	 * rewrites the link in every other note that named it, and a replace
	 * that follows checks its revision against the file as it now stands.
	 */
	private async reloadWorking(): Promise<void> {
		this.working = workingSnapshotOf(await this.projects.loadProject(this.working.projectFile));
	}
}

const itemOf = (entry: ImportPlanEntry): ImportReportItem => ({
	kind: entry.part.kind,
	key: entry.part.key,
	name: entry.part.name,
	targetName: entry.targetName,
	targetPath: entry.targetPath,
});

