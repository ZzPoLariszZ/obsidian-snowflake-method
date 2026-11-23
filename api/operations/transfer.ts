import { normalizePath } from 'obsidian';

import {
	closeSelection,
	galleryDraftOf,
	galleryLinkTarget,
	isFreeformResourcePath,
	isImagePath,
	type EntityKindId,
	type ExportFormat,
	type ExportLayout,
	type ExportSeparator,
	type GalleryDraft,
	type ImportInspection,
	type ImportPart,
} from '../../src/domain';
import {
	ExportIntoManuscriptError,
	ExportOverSourceError,
	ImportRefusedError,
	entitiesOf,
	type CanvasExportPlan,
	type CharacterRecord,
	type GalleryWrite,
	type ImportReport,
	type ImportReportItem,
	type ManuscriptExportOptions,
	type ManuscriptExportPlan,
	type ManuscriptExportScope,
	type ProjectSnapshot,
	type SceneRecord,
	type WorldbuildingRecord,
} from '../../src/services';
import { projectSummary } from '../dto/project';
import { ApiError } from '../errors';
import type { JsonObject } from '../json';
import { noSuch } from './board-rules';
import { NOT_THE_AUTHOR, bodyOf, textParam, type ApiContext, type FoundProject, type OperationGroup } from './context';
import { noteAt } from './manuscript-writes';
import { misfit, textOf, type Sent } from './refusals';

// ---- import ----------------------------------------------------------------

/** Why no run could take a pair of projects, in words for a caller. */
const REFUSALS: Readonly<Record<string, string>> = {
	'same-project': 'A project brings nothing in from itself.',
	nested: 'One of the two projects stands inside the other, and nothing is copied between such a pair.',
	'read-only-target': 'A newer version of the plugin wrote this project, and this one may only read it.',
	'read-only-source': 'A newer version of the plugin wrote the other project, and this one cannot read it in full.',
	'kind-refused': 'The project could not be given a kind of worldbuilding the import needs. Nothing else was brought.',
};

/** Runs a part of an import, and says what the importer refuses in the API's own words. */
async function imported<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (!(error instanceof ImportRefusedError)) throw error;
		throw new ApiError('import-refused', REFUSALS[error.code] ?? 'The import cannot be run between these two projects.', {
			reason: error.code,
			...(error.detail === null ? {} : { kind: error.detail }),
		});
	}
}

/** The project things are brought in from: any project of the vault, the archived ones among them. */
async function sourceOf(context: ApiContext, body: Sent): Promise<FoundProject> {
	try {
		return await context.findProject(textOf(body['sourceProjectId']));
	} catch (error) {
		if (error instanceof ApiError && error.code === 'not-found') {
			throw noSuch('/sourceProjectId', 'There is no project with that id to bring things in from. listProjects gives the ids there are.');
		}
		throw error;
	}
}

/** One thing a project has to bring, with how it stands in the project it would be brought into. */
function partOf(inspection: ImportInspection, part: ImportPart): JsonObject {
	const standing = inspection.standing.get(part.key) ?? { kind: 'new' as const };
	return {
		key: part.key,
		kind: part.kind,
		name: part.name,
		group: part.group,
		selectedByDefault: part.defaultSelected,
		requires: [...part.requires],
		links: [...new Set(part.links.map((link) => link.key))],
		state: standing.kind,
		target: standing.kind === 'new' ? null : { name: standing.targetName, path: standing.targetPath },
	};
}

const itemOf = (item: ImportReportItem): JsonObject => ({
	key: item.key,
	kind: item.kind,
	name: item.name,
	targetName: item.targetName,
	path: item.targetPath,
});

function reportOf(report: ImportReport): JsonObject {
	return {
		source: { id: report.source.id, title: report.source.title },
		created: report.created.map(itemOf),
		replaced: report.replaced.map(itemOf),
		skipped: report.skipped.map((item) => ({ ...itemOf(item), reason: item.reason })),
		failed: report.failed.map((item) => ({ ...itemOf(item), detail: item.message })),
		droppedLinks: report.droppedLinks.map((drop) => ({ owner: itemOf(drop.owner), field: drop.field, target: drop.target })),
		pictures: { landed: report.pictures.landed, reused: report.pictures.reused },
		kindsCreated: [...report.kindsCreated],
	};
}

// ---- export ----------------------------------------------------------------

/** A folder as the settings keep one: no slash at either end, and nothing for the vault's own top folder. */
function folderOf(folder: string): string {
	const trimmed = folder.trim();
	return trimmed.length === 0 || /^\/+$/u.test(trimmed) ? '' : normalizePath(trimmed);
}

/** Whether a path stands in a folder or below it, whatever the case of either: a disk may tell `Novels` and `novels` apart or not. */
const within = (path: string, folder: string): boolean => {
	const [at, root] = [path.toLowerCase(), folder.toLowerCase()];
	return at === root || at.startsWith(`${root}/`);
};

const standsThere = (paths: readonly string[]): ApiError =>
	new ApiError('path-conflict', 'A file already stands where this would be written. Send overwrite to write over it.', {
		path: paths[0] ?? '',
		paths: [...paths],
	});

// ---- gallery ---------------------------------------------------------------

type AnyMember = CharacterRecord | SceneRecord | WorldbuildingRecord;

/** A note that keeps a gallery, with the kind whose gallery folder its pictures land in and the way its note is written. */
interface Keeper {
	readonly kind: EntityKindId;
	readonly record: AnyMember;
	readonly write: (gallery: GalleryWrite) => Promise<AnyMember>;
}

function keeperOf(context: ApiContext, project: ProjectSnapshot, id: string): Keeper {
	const projects = context.host.projects;
	const character = project.characters.find((entry) => entry.characterId === id);
	if (character !== undefined) {
		return {
			kind: 'character',
			record: character,
			write: (gallery) => projects.updateCharacterIn(project, id, { ...gallery, expectedRevision: character.revision }, NOT_THE_AUTHOR),
		};
	}
	const scene = project.scenes.find((entry) => entry.sceneId === id);
	if (scene !== undefined) {
		return {
			kind: 'scene',
			record: scene,
			write: (gallery) => projects.updateSceneIn(project, id, { ...gallery, expectedRevision: scene.revision }, NOT_THE_AUTHOR),
		};
	}
	const entity = project.worldbuildingKinds.flatMap((kind) => entitiesOf(project, kind.id)).find((entry) => entry.entityId === id);
	if (entity !== undefined) {
		return {
			kind: entity.kind,
			record: entity,
			write: (gallery) => projects.updateEntityIn(project, id, { ...gallery, expectedRevision: entity.revision }, NOT_THE_AUTHOR),
		};
	}
	throw new ApiError('not-found', 'There is no character, scene or worldbuilding note with that id in the project. listMembers gives the ids there are.');
}

/** Where a gallery's link leads now, as a path in the vault, or null where the picture is gone. */
function pictureAt(context: ApiContext, link: string, sourcePath: string): string | null {
	const target = galleryLinkTarget(link);
	return target === null ? null : (context.host.projects.repository.resolveLink(target, sourcePath)?.path ?? null);
}

/** A note's gallery as it stands now, with whatever a save could not send to the trash. */
async function tellGallery(context: ApiContext, projectId: string, id: string, untrashed: readonly string[]): Promise<JsonObject> {
	const { project } = await context.loadProject(projectId);
	const { record } = keeperOf(context, project, id);
	return {
		member: context.members(project).refAt(record.path),
		pictures: record.gallery.map((link) => ({ link, path: pictureAt(context, link, record.path), main: link === record.galleryMain })),
		untrashed: [...untrashed],
	};
}

/**
 * What is brought in from another project, what is written out for the
 * author to take elsewhere, and the pictures a note keeps. Each goes
 * through the plugin's own service for it. An export is planned first and
 * written second, as the plugin's own is, so a file that already stands is
 * seen before anything is written over it.
 */
export const transferOperations: OperationGroup = {
	inspectImport: async (call, context) => {
		const target = await context.writableProject(textParam(call, 'projectId'));
		const source = await sourceOf(context, bodyOf(call));
		const inspection = await imported(() => context.host.projects.importer.inspectSource(source.ref.projectFile, target.projectFile));
		return {
			status: 200,
			body: {
				source: projectSummary(source.ref, { archived: source.archived, currentPath: context.host.currentProjectPath() }),
				parts: inspection.parts.map((part) => partOf(inspection, part)),
				gone: inspection.gone.map((part) => ({ kind: part.kind, name: part.name, path: part.targetPath })),
			},
		};
	},

	runImport: async (call, context) => {
		const target = await context.writableProject(textParam(call, 'projectId'));
		const body = bodyOf(call);
		const source = await sourceOf(context, body);
		const importer = context.host.projects.importer;
		const inspection = await imported(() => importer.inspectSource(source.ref.projectFile, target.projectFile));
		const known = new Set(inspection.parts.map((part) => part.key));
		const asked = (Array.isArray(body['parts']) ? body['parts'] : []).map((key: unknown) => textOf(key));
		asked.forEach((key, at) => {
			if (!known.has(key)) throw noSuch(`/parts/${String(at)}`, 'The other project has no such part. inspectImport gives the keys there are.');
		});
		// What a part cannot stand without comes with it, as it does when the author ticks it.
		const selection = { parts: closeSelection(inspection.parts, asked), clashPolicy: body['onClash'] === 'replace' ? ('replace' as const) : ('skip' as const) };
		const report = await imported(() => context.host.importing(() => importer.runImport(source.ref.projectFile, target.projectFile, selection)));
		return { status: 200, body: reportOf(report) };
	},

	exportManuscript: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const body = bodyOf(call);
		const settings = context.host.exportDefaults();
		// A file is written only inside the folder the author keeps exports in, or in one below it.
		const below = textOf(body['folder']).trim();
		if (below.length > 0 && !isFreeformResourcePath(below)) {
			throw misfit('/folder', "A folder is named from inside the author's export folder, with forward slashes and no way out of it.");
		}
		const root = folderOf(settings.folder);
		const options: ManuscriptExportOptions = {
			folder: below.length === 0 ? root : root.length === 0 ? below : `${root}/${below}`,
			format: typeof body['format'] === 'string' ? (body['format'] as ExportFormat) : settings.format,
			layout: typeof body['layout'] === 'string' ? (body['layout'] as ExportLayout) : settings.layout,
			separator: typeof body['separator'] === 'string' ? (body['separator'] as ExportSeparator) : settings.separator,
			indent: typeof body['indent'] === 'boolean' ? body['indent'] : settings.indent,
			paragraphSpacing: typeof body['paragraphSpacing'] === 'boolean' ? body['paragraphSpacing'] : settings.paragraphSpacing,
		};
		const segments = await context.host.projects.manuscript.listSegmentsFromFiles(project);
		const scope: ManuscriptExportScope =
			typeof body['note'] === 'string' ? { kind: 'segment', path: noteAt(project, segments, body['note'], '/note').path } : { kind: 'manuscript' };
		// What the author typed and had not saved is saved first, so the files say what the author sees.
		await context.host.settleNotes(scope.kind === 'segment' ? [scope.path] : segments.map((segment) => segment.path));
		let plan: ManuscriptExportPlan;
		try {
			plan = await context.host.projects.exporter.plan(project, scope, options);
		} catch (error) {
			if (error instanceof ExportIntoManuscriptError) {
				throw misfit('/folder', "The author's export folder lies inside the project, where a file written would be read as one of its notes. The author sets the folder in the plugin's settings.");
			}
			if (error instanceof ExportOverSourceError) throw misfit('/note', 'The export of that note would be written over the note itself.');
			throw error;
		}
		// The author may keep exports beside the projects or above them, and a folder below theirs can then
		// be one a project stands in. The folder alone does not say where the files go: they are written
		// under the project's own name, which is the name of its folder. So each file is held to where it
		// would land, and none lands in a project's folder, this project's or another's. A project that
		// stands at the top of the vault has no folder of its own to be kept out of.
		const roster = await context.host.roster();
		const roots = [...roster.active, ...roster.archived].map((ref) => ref.rootPath).filter((folder) => folder.length > 0);
		if (plan.targets.some((target) => roots.some((folder) => within(target.path, folder)))) {
			throw misfit(
				'/folder',
				'The files would be written into the folder of a project, this one or another, where they would stand among its notes or over them. Name a folder no project stands in.',
			);
		}
		const standing = plan.targets.filter((target) => target.exists).map((target) => target.path);
		if (standing.length > 0 && body['overwrite'] !== true) throw standsThere(standing);
		return { status: 200, body: { written: await context.host.projects.exporter.write(plan), unchanged: [] } };
	},

	exportCanvas: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const body = bodyOf(call);
		const id = textOf(body['id']);
		const exporter = context.host.projects.canvasExporter;
		const words = context.host.canvasWords(project);
		let planned: CanvasExportPlan;
		if (body['board'] === 'freeform') planned = await exporter.planFreeform(project, id, words);
		else if (body['board'] === 'timeline') planned = await exporter.planTimeline(project, id, words);
		else planned = await exporter.planBeatSheet(project, id, words);
		if (planned.kind === 'absent') {
			throw noSuch('/id', 'The project has no such board. listFreeformViews, getTimeline and listBeatSheets give the ids there are.');
		}
		// A canvas that says the same already is left as it is, however the author has laid it out since.
		if (planned.exists && planned.unchanged) return { status: 200, body: { written: [], unchanged: [planned.path] } };
		if (planned.exists && body['overwrite'] !== true) throw standsThere([planned.path]);
		await exporter.write(planned);
		return { status: 200, body: { written: [planned.path], unchanged: [] } };
	},

	addGalleryPictures: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const id = textParam(call, 'memberId');
		const keeper = keeperOf(context, project, id);
		const body = bodyOf(call);
		const repository = context.host.projects.repository;
		const draft: GalleryDraft = galleryDraftOf(keeper.record.gallery, keeper.record.galleryMain);
		const main = typeof body['main'] === 'string' ? normalizePath(body['main']) : null;
		let amongSent = false;
		(Array.isArray(body['paths']) ? body['paths'] : []).forEach((sent: unknown, at) => {
			const path = normalizePath(textOf(sent));
			const pointer = `/paths/${String(at)}`;
			if (!isImagePath(path)) throw misfit(pointer, 'A gallery takes pictures: a file Obsidian draws as an image, told by the ending of its name.');
			if (repository.getFile(path) === null) throw noSuch(pointer, 'The vault has no file there. Put the picture into the vault first.');
			if (path === main) {
				draft.mainIndex = draft.entries.length;
				amongSent = true;
			}
			draft.entries.push({ kind: 'vault', path });
		});
		if (main !== null && !amongSent) {
			// The main picture may be one the gallery already has. Asked by whether it was among those sent, and
			// not by whether the draft names a main picture: it begins with the one that stands, which says
			// nothing of the one asked for.
			const kept = keeper.record.gallery.findIndex((link) => pictureAt(context, link, keeper.record.path) === main);
			if (kept === -1) throw noSuch('/main', 'The main picture is one of the pictures sent, or one the gallery already has.');
			draft.mainIndex = kept;
		}
		const saved = await context.host.projects.gallery.commit(project, keeper.kind, draft, keeper.write, (record) => record.path, keeper.record.path);
		return { status: 200, body: await tellGallery(context, projectId, id, saved.trashFailed) };
	},

	removeGalleryPicture: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const id = textParam(call, 'memberId');
		const keeper = keeperOf(context, project, id);
		const wanted = normalizePath(textParam(call, 'picturePath'));
		const { gallery, galleryMain, path } = keeper.record;
		// By where it stands now, or, for a picture whose file is gone, by where its link still says it stood.
		const at = gallery.findIndex((link) => pictureAt(context, link, path) === wanted || normalizePath(galleryLinkTarget(link) ?? '') === wanted);
		const link = gallery[at];
		if (link === undefined) {
			throw new ApiError('not-found', 'The gallery has no picture there. The note\'s own reading gives the pictures it has.');
		}
		const kept = gallery.filter((_link, index) => index !== at);
		const draft: GalleryDraft = { ...galleryDraftOf(kept, galleryMain === link ? null : galleryMain), removed: [link] };
		const saved = await context.host.projects.gallery.commit(project, keeper.kind, draft, keeper.write, (record) => record.path, path);
		return { status: 200, body: await tellGallery(context, projectId, id, saved.trashFailed) };
	},
};
