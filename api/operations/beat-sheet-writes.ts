import {
	builtInBeatSheetTemplate,
	builtInBeatSheetTemplates,
	findBeat,
	findBeatRow,
	findBeatSheet,
	findBeatSheetAct,
	findBeatSheetTemplate,
	isBuiltInBeatSheetTemplateId,
	type BeatSheet,
	type BeatSheetDocument,
	type ScenePresentation,
} from '../../src/domain';
import type { BeatSheetSource, ProjectSnapshot } from '../../src/services';
import { beatSheetOf, beatSheetTemplatesOf } from '../dto/boards';
import type { MemberIndex } from '../dto/member';
import { ApiError } from '../errors';
import type { JsonObject } from '../json';
import { anchorOf, landed, made, memberOfKind, noSuch, rowText, scenesOf } from './board-rules';
import { bodyOf, textParam, type ApiContext, type OperationCall, type OperationGroup } from './context';
import { gone } from './records';
import { free, misfit, taken, textOf } from './refusals';

const FILE = 'beat sheets';
const noSheet = (): ApiError => gone('beat sheet', 'listBeatSheets');
const part = (what: string): ApiError =>
	new ApiError('not-found', `The beat sheet has no ${what} with that id. It may have been deleted. getBeatSheet gives the ones it has.`);

/** A project that may be changed, with its beat sheets as they stand and its notes to be found by id. */
interface Standing {
	readonly project: ProjectSnapshot;
	readonly held: BeatSheetDocument;
	readonly index: MemberIndex;
}

async function standingOf(call: OperationCall, context: ApiContext): Promise<Standing> {
	const project = await context.writableProject(textParam(call, 'projectId'));
	return { project, held: await context.host.projects.beatSheet.read(project), index: context.members(project) };
}

function sheetIn(held: BeatSheetDocument, call: OperationCall): BeatSheet {
	const sheet = findBeatSheet(held, textParam(call, 'beatSheetId'));
	if (sheet === undefined) throw noSheet();
	return sheet;
}

/** A beat sheet as it stands in the file now. */
async function tellSheet(context: ApiContext, project: ProjectSnapshot, id: string): Promise<JsonObject> {
	const sheet = findBeatSheet(await context.host.projects.beatSheet.read(project), id);
	if (sheet === undefined) throw noSheet();
	return beatSheetOf(context.members(project), sheet);
}

/**
 * The beat sheets, changed. Every change goes through the plugin's own
 * beat sheet service, one change at a time as its own screen makes them,
 * and the screens are told at once. An act's number is its place in the
 * sheet, so nothing here takes or keeps one.
 */
export const beatSheetWriteOperations: OperationGroup = {
	createBeatSheet: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const { project, held } = await standingOf(call, context);
		const body = bodyOf(call);
		const service = context.host.projects.beatSheet;
		const name = textOf(body['name']).trim();
		if (!free(held.sheets.map((sheet) => sheet.name), name, null)) throw taken('beat sheet', name);
		const templateId = textOf(body['templateId']);
		let source: BeatSheetSource;
		if (isBuiltInBeatSheetTemplateId(templateId)) {
			// The plugin's own templates are worded in the project's language.
			source = { structure: builtInBeatSheetTemplate(project.locale, templateId).structure };
		} else if (findBeatSheetTemplate(held, templateId) !== undefined) {
			source = { templateId };
		} else {
			throw noSuch('/templateId', 'There is no template with that id. listBeatSheetTemplates gives the ones there are.');
		}
		const id = made(await service.createSheet(project, { name, source }), FILE);
		// A sheet the author makes is the one they are then shown. One made here leaves the author looking at the sheet they were.
		if (held.lastSheetId !== null) landed(await service.setLastSheet(project, held.lastSheetId), noSheet(), FILE);
		context.host.recordsChanged('beatSheets');
		return {
			status: 201,
			body: await tellSheet(context, project, id),
			location: `/projects/${encodeURIComponent(projectId)}/beat-sheets/${encodeURIComponent(id)}`,
		};
	},

	updateBeatSheet: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const body = bodyOf(call);
		const service = context.host.projects.beatSheet;
		const name = typeof body['name'] === 'string' ? body['name'].trim() : sheet.name;
		const others = held.sheets.filter((entry) => entry.id !== sheet.id).map((entry) => entry.name);
		if (!free(others, name, sheet.name)) throw taken('beat sheet', name);
		const done = (outcome: 'written' | 'absent' | 'refused'): void => {
			landed(outcome, noSheet(), FILE);
		};
		done(await service.renameSheet(project, sheet.id, name));
		if ('presentation' in body) done(await service.setPresentation(project, sheet.id, body['presentation'] as ScenePresentation | null));
		if (typeof body['showSubDescriptions'] === 'boolean') done(await service.setSubDescriptions(project, sheet.id, body['showSubDescriptions']));
		if (typeof body['reversed'] === 'boolean') done(await service.setReversed(project, sheet.id, body['reversed']));
		context.host.recordsChanged('beatSheets');
		return { status: 200, body: await tellSheet(context, project, sheet.id) };
	},

	deleteBeatSheet: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		landed(await context.host.projects.beatSheet.deleteSheet(project, sheetIn(held, call).id), noSheet(), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 204 };
	},

	addBeatSheetAct: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const body = bodyOf(call);
		const before = anchorOf(body, sheet.acts.map((act) => act.id), 'act');
		const id = made(await context.host.projects.beatSheet.addAct(project, sheet.id, textOf(body['label']).trim(), before), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 201, body: { id, beatSheet: await tellSheet(context, project, sheet.id) } };
	},

	updateBeatSheetAct: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const body = bodyOf(call);
		const actId = textParam(call, 'actId');
		if (findBeatSheetAct(sheet, actId) === undefined) throw part('act');
		const service = context.host.projects.beatSheet;
		const before = 'before' in body ? anchorOf(body, sheet.acts.map((act) => act.id), 'act', actId) : null;
		if (typeof body['label'] === 'string') landed(await service.relabelAct(project, sheet.id, actId, body['label'].trim()), part('act'), FILE);
		if ('before' in body) landed(await service.moveAct(project, sheet.id, actId, before), part('act'), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 200, body: await tellSheet(context, project, sheet.id) };
	},

	deleteBeatSheetAct: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const actId = textParam(call, 'actId');
		if (findBeatSheetAct(sheet, actId) === undefined) throw part('act');
		landed(await context.host.projects.beatSheet.deleteAct(project, sheet.id, actId), noSheet(), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 200, body: await tellSheet(context, project, sheet.id) };
	},

	addBeat: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const body = bodyOf(call);
		const act = findBeatSheetAct(sheet, textOf(body['act']));
		if (act === undefined) throw noSuch('/act', 'The beat sheet has no act with that id. getBeatSheet gives the ones it has.');
		const before = anchorOf(body, act.beats.map((beat) => beat.id), 'beat in that act');
		const draft = { name: textOf(body['name']).trim(), description: textOf(body['description']).trim() };
		const id = made(await context.host.projects.beatSheet.addBeat(project, sheet.id, act.id, draft, before), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 201, body: { id, beatSheet: await tellSheet(context, project, sheet.id) } };
	},

	updateBeat: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const body = bodyOf(call);
		const beatId = textParam(call, 'beatId');
		const place = findBeat(sheet, beatId);
		if (place === null) throw part('beat');
		const service = context.host.projects.beatSheet;
		const moves = 'act' in body || 'before' in body;
		const toAct = 'act' in body ? findBeatSheetAct(sheet, textOf(body['act'])) : place.act;
		if (toAct === undefined) throw noSuch('/act', 'The beat sheet has no act with that id. getBeatSheet gives the ones it has.');
		const before = moves ? anchorOf(body, toAct.beats.map((beat) => beat.id), 'beat in that act', beatId) : null;
		const change = {
			...(typeof body['name'] === 'string' ? { name: body['name'].trim() } : {}),
			...(typeof body['description'] === 'string' ? { description: body['description'].trim() } : {}),
		};
		if ('name' in change || 'description' in change) landed(await service.editBeat(project, sheet.id, beatId, change), part('beat'), FILE);
		if (moves) landed(await service.moveBeat(project, sheet.id, beatId, toAct.id, before), part('beat'), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 200, body: await tellSheet(context, project, sheet.id) };
	},

	deleteBeat: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const beatId = textParam(call, 'beatId');
		if (findBeat(sheet, beatId) === null) throw part('beat');
		landed(await context.host.projects.beatSheet.deleteBeat(project, sheet.id, beatId), noSheet(), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 200, body: await tellSheet(context, project, sheet.id) };
	},

	addBeatRow: async (call, context) => {
		const { project, held, index } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const body = bodyOf(call);
		const place = findBeat(sheet, textOf(body['beat']));
		if (place === null) throw noSuch('/beat', 'The beat sheet has no beat with that id. getBeatSheet gives the ones it has.');
		const scenes = scenesOf(index, body['scenes'], '/scenes');
		const text = rowText(body, scenes);
		const before = anchorOf(body, place.beat.rows.map((row) => row.id), 'row under that beat');
		const id = made(await context.host.projects.beatSheet.addRow(project, sheet.id, place.beat.id, text, before, scenes), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 201, body: { id, beatSheet: await tellSheet(context, project, sheet.id) } };
	},

	updateBeatRow: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const body = bodyOf(call);
		const rowId = textParam(call, 'rowId');
		const place = findBeatRow(sheet, rowId);
		if (place === null) throw part('row');
		const service = context.host.projects.beatSheet;
		const moves = 'beat' in body || 'before' in body;
		const toBeat = 'beat' in body ? (findBeat(sheet, textOf(body['beat']))?.beat ?? null) : place.beat;
		if (toBeat === null) throw noSuch('/beat', 'The beat sheet has no beat with that id. getBeatSheet gives the ones it has.');
		const before = moves ? anchorOf(body, toBeat.rows.map((row) => row.id), 'row under that beat', rowId) : null;
		if (typeof body['text'] === 'string') {
			if (place.row.scenes.length === 0) rowText(body, []);
			landed(await service.editRow(project, sheet.id, rowId, body['text'].trim()), part('row'), FILE);
		}
		if (moves) landed(await service.moveRow(project, sheet.id, rowId, toBeat.id, before), part('row'), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 200, body: await tellSheet(context, project, sheet.id) };
	},

	deleteBeatRow: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const rowId = textParam(call, 'rowId');
		if (findBeatRow(sheet, rowId) === null) throw part('row');
		landed(await context.host.projects.beatSheet.deleteRow(project, sheet.id, rowId), noSheet(), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 200, body: await tellSheet(context, project, sheet.id) };
	},

	placeBeatSheetScene: async (call, context) => {
		const { project, held, index } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const body = bodyOf(call);
		const scene = memberOfKind(index, textParam(call, 'sceneId'), 'scene', 'params/sceneId');
		const rowId = textOf(body['row']);
		const place = findBeatRow(sheet, rowId);
		if (place === null) throw noSuch('/row', 'The beat sheet has no row with that id. getBeatSheet gives the rows there are.');
		const before = anchorOf(body, place.row.scenes, 'scene in that row', scene.id);
		landed(await context.host.projects.beatSheet.placeScene(project, sheet.id, scene.id, rowId, before), part('row'), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 200, body: await tellSheet(context, project, sheet.id) };
	},

	removeBeatSheetScene: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const sheet = sheetIn(held, call);
		const sceneId = textParam(call, 'sceneId');
		// A scene whose note is gone can still be taken off, so it is looked for on the sheet and not among the notes.
		if (!sheet.acts.some((act) => act.beats.some((beat) => beat.rows.some((row) => row.scenes.includes(sceneId))))) {
			throw new ApiError('not-found', 'The beat sheet places no such scene. getBeatSheet gives the scenes it places.');
		}
		landed(await context.host.projects.beatSheet.removeScene(project, sheet.id, sceneId), noSheet(), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 200, body: await tellSheet(context, project, sheet.id) };
	},

	saveBeatSheetTemplate: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const body = bodyOf(call);
		const sheet = findBeatSheet(held, textOf(body['beatSheet']));
		if (sheet === undefined) throw noSuch('/beatSheet', 'There is no beat sheet with that id. listBeatSheets gives the ones there are.');
		const service = context.host.projects.beatSheet;
		const draft = { name: textOf(body['name']).trim(), description: textOf(body['description']).trim() };
		landed(await service.saveTemplate(project, sheet.id, draft), noSheet(), FILE);
		context.host.recordsChanged('beatSheets');
		return { status: 201, body: beatSheetTemplatesOf(builtInBeatSheetTemplates(project.locale), (await service.read(project)).templates) };
	},

	deleteBeatSheetTemplate: async (call, context) => {
		const { project } = await standingOf(call, context);
		const id = textParam(call, 'beatSheetTemplateId');
		if (isBuiltInBeatSheetTemplateId(id)) {
			throw misfit('params/beatSheetTemplateId', 'That is one of the plugin\'s own templates, which are not the project\'s to delete.');
		}
		landed(
			await context.host.projects.beatSheet.deleteTemplate(project, id),
			gone('template of the author\'s own', 'listBeatSheetTemplates'),
			FILE,
		);
		context.host.recordsChanged('beatSheets');
		return { status: 204 };
	},
};
