import { normalizePath } from 'obsidian';

import {
	applyFreeformSteps,
	fileStem,
	findFreeformView,
	isFreeformAddress,
	isFreeformResourcePath,
	plainFirstLine,
	type FreeformArrow,
	type FreeformDocument,
	type FreeformEdgeDraft,
	type FreeformFrameDraft,
	type FreeformLine,
	type FreeformPlace,
	type FreeformPlacementDraft,
	type FreeformRecordType,
	type FreeformResource,
	type FreeformStep,
	type FreeformView,
	type MacaronColor,
} from '../../src/domain';
import type { ProjectSnapshot } from '../../src/services';
import { freeformViewOf } from '../dto/boards';
import type { MemberIndex } from '../dto/member';
import { ApiError } from '../errors';
import type { JsonObject } from '../json';
import { allows } from '../spec/operations';
import { idOf, landed, made, noSuch } from './board-rules';
import { bodyOf, textParam, type ApiContext, type OperationCall, type OperationGroup } from './context';
import { gone } from './records';
import { foreign, free, isSent, misfit, taken, textOf, type Sent } from './refusals';

const FILE = 'freeform views';
const noView = (): ApiError => gone('freeform view', 'listFreeformViews');
const full = (): ApiError =>
	new ApiError('view-full', 'The view has no room for that. A view holds a set number of cards, frames and lines, and this would go past it.');

/** How many of a record's first words a card is called by, as the plugin's own cards are. */
const LABEL = 80;

/** A project that may be changed, with its views as they stand and its notes to be found by id. */
interface Standing {
	readonly project: ProjectSnapshot;
	readonly held: FreeformDocument;
	readonly index: MemberIndex;
}

async function standingOf(call: OperationCall, context: ApiContext): Promise<Standing> {
	const project = await context.writableProject(textParam(call, 'projectId'));
	return { project, held: await context.host.projects.freeform.read(project), index: context.members(project) };
}

function viewIn(held: FreeformDocument, call: OperationCall): FreeformView {
	const view = findFreeformView(held, textParam(call, 'freeformViewId'));
	if (view === undefined) throw noView();
	return view;
}

/** A view as it stands in its file now. */
async function tellView(context: ApiContext, project: ProjectSnapshot, id: string): Promise<JsonObject> {
	const view = findFreeformView(await context.host.projects.freeform.read(project), id);
	if (view === undefined) throw noView();
	return freeformViewOf(context.members(project), project, view);
}

type Kind = 'placement' | 'frame' | 'edge';

/**
 * The names a call gives the things it makes. Each new card, frame and line
 * is kept under an id minted as the plugin mints its own. A call may name
 * one, so that a later step of the same call can speak of it, and the name
 * holds for that call alone: the answer says which id each was given.
 */
class Names {
	private readonly given = new Map<string, string>();
	readonly made: { kind: Kind; id: string; as: string | null }[] = [];

	constructor(
		private readonly mint: (kind: Kind) => string,
		private readonly standing: ReadonlySet<string>,
	) {}

	fresh(kind: Kind, name: unknown, pointer: string): string {
		const as = typeof name === 'string' && name.length > 0 ? name : null;
		if (as !== null && this.given.has(as)) throw misfit(pointer, 'Two things of one call are given the same name.');
		if (as !== null && this.standing.has(as)) throw misfit(pointer, 'That is the id of something the view already has.');
		const id = this.mint(kind);
		if (as !== null) this.given.set(as, id);
		this.made.push({ kind, id, as });
		return id;
	}

	/** The id a step means: one of the call's own names, or the id of something that stood on the view before. */
	of(sent: unknown): string {
		const named = textOf(sent);
		return this.given.get(named) ?? named;
	}
}

const listOf = (value: unknown): Sent[] => (Array.isArray(value) ? value.filter(isSent) : []);
const sized = (draft: Sent): { width?: number; height?: number } => ({
	...(typeof draft['width'] === 'number' ? { width: draft['width'] } : {}),
	...(typeof draft['height'] === 'number' ? { height: draft['height'] } : {}),
});
const drawn = (draft: Sent): { label?: string; arrow?: FreeformArrow; line?: FreeformLine } => ({
	...(typeof draft['label'] === 'string' ? { label: draft['label'] } : {}),
	...(typeof draft['arrow'] === 'string' ? { arrow: draft['arrow'] as FreeformArrow } : {}),
	...(typeof draft['line'] === 'string' ? { line: draft['line'] as FreeformLine } : {}),
});
const tint = (value: unknown): MacaronColor | null => (typeof value === 'string' ? (value as MacaronColor) : null);

/**
 * What a card is to show, as a view keeps it. A note or a record is named
 * by its id and must be one the project has: a card of something that was
 * never there would stand on the author's view as a thing gone missing.
 */
function resourcesOf(context: ApiContext, project: ProjectSnapshot, index: MemberIndex): (sent: unknown, pointer: string) => Promise<FreeformResource> {
	const lists = new Map<FreeformRecordType, Map<string, string>>();
	const called = async (type: FreeformRecordType): Promise<Map<string, string>> => {
		const kept = lists.get(type);
		if (kept !== undefined) return kept;
		const projects = context.host.projects;
		const names = new Map<string, string>();
		if (type === 'task') {
			for (const task of await projects.tasks.list(project)) names.set(task.id, task.title);
		} else if (type === 'foreshadowing') {
			for (const thread of await projects.foreshadowing.list(project)) names.set(thread.id, thread.name);
		} else if (type === 'revision') {
			for (const revision of await projects.revisions.list(project)) {
				const first = plainFirstLine(revision.originalText.length > 0 ? revision.originalText : revision.proposed, LABEL);
				names.set(revision.id, first.length === 0 ? fileStem(revision.path) : first);
			}
		} else {
			for (const note of await projects.stickyNotes.list(project)) names.set(note.id, plainFirstLine(note.body, LABEL));
		}
		lists.set(type, names);
		return names;
	};
	return async (sent, pointer) => {
		const resource = isSent(sent) ? sent : {};
		switch (resource['type']) {
			case 'entity': {
				const member = index.byId(idOf(resource['member']));
				if (member === null) throw noSuch(`${pointer}/member`, 'The project has no note with that id. listMembers gives the ids there are.');
				return { type: 'entity', kind: member.kind, id: member.id, name: member.name };
			}
			case 'file': {
				const path = textOf(resource['relativePath']);
				if (!isFreeformResourcePath(path)) {
					throw misfit(`${pointer}/relativePath`, 'A file is named by where it stands inside the project, with forward slashes and no way out of it.');
				}
				if (context.host.projects.repository.getFile(normalizePath(`${project.rootPath}/${path}`)) === null) {
					throw noSuch(`${pointer}/relativePath`, 'The project has no file there.');
				}
				return { type: 'file', path };
			}
			case 'link': {
				const url = textOf(resource['url']);
				if (!isFreeformAddress(url)) throw misfit(`${pointer}/url`, 'A link card keeps a web address that begins with http or https.');
				return { type: 'link', url, label: textOf(resource['label']) };
			}
			case 'text':
				return { type: 'text', text: textOf(resource['text']) };
			default: {
				const type = resource['type'] as FreeformRecordType;
				const id = textOf(resource['id']);
				const name = (await called(type)).get(id);
				if (name === undefined) throw noSuch(`${pointer}/id`, `The project has no ${type === 'sticky-note' ? 'sticky note' : type} with that id.`);
				return { type, id, name };
			}
		}
	};
}

/** The steps of a call as the plugin's own view takes them, each new thing under an id of its own. */
async function stepsOf(
	sent: readonly unknown[],
	names: Names,
	resource: (sent: unknown, pointer: string) => Promise<FreeformResource>,
): Promise<FreeformStep[]> {
	const steps: FreeformStep[] = [];
	for (const [at, entry] of sent.entries()) {
		const step = isSent(entry) ? entry : {};
		const here = `/steps/${String(at)}`;
		switch (step['do']) {
			case 'add': {
				const placements: FreeformPlacementDraft[] = [];
				for (const [place, draft] of listOf(step['placements']).entries()) {
					const pointer = `${here}/placements/${String(place)}`;
					placements.push({
						id: names.fresh('placement', draft['id'], `${pointer}/id`),
						resource: await resource(draft['resource'], `${pointer}/resource`),
						x: Number(draft['x']),
						y: Number(draft['y']),
						...sized(draft),
						...('frameId' in draft ? { frameId: draft['frameId'] === null ? null : names.of(draft['frameId']) } : {}),
					});
				}
				steps.push({ do: 'add', placements });
				break;
			}
			case 'add-frames':
				steps.push({
					do: 'add-frames',
					frames: listOf(step['frames']).map(
						(draft, frame): FreeformFrameDraft => ({
							id: names.fresh('frame', draft['id'], `${here}/frames/${String(frame)}/id`),
							title: textOf(draft['title']),
							color: tint(draft['color']),
							x: Number(draft['x']),
							y: Number(draft['y']),
							...sized(draft),
						}),
					),
				});
				break;
			case 'connect':
				steps.push({
					do: 'connect',
					edges: listOf(step['edges']).map(
						(draft, edge): FreeformEdgeDraft => ({
							id: names.fresh('edge', draft['id'], `${here}/edges/${String(edge)}/id`),
							source: names.of(draft['source']),
							target: names.of(draft['target']),
							...drawn(draft),
						}),
					),
				});
				break;
			case 'place':
				steps.push({
					do: 'place',
					places: listOf(step['places']).map(
						(draft): FreeformPlace => ({
							id: names.of(draft['id']),
							x: Number(draft['x']),
							y: Number(draft['y']),
							...sized(draft),
							...('frameId' in draft ? { frameId: draft['frameId'] === null ? null : names.of(draft['frameId']) } : {}),
						}),
					),
				});
				break;
			case 'text':
				steps.push({ do: 'text', id: names.of(step['id']), text: textOf(step['text']) });
				break;
			case 'edit-frame':
				steps.push({
					do: 'edit-frame',
					id: names.of(step['id']),
					...(typeof step['title'] === 'string' ? { title: step['title'] } : {}),
					...('color' in step ? { color: tint(step['color']) } : {}),
				});
				break;
			case 'edit-edges':
				steps.push({ do: 'edit-edges', edits: listOf(step['edits']).map((draft) => ({ id: names.of(draft['id']), ...drawn(draft) })) });
				break;
			default:
				steps.push({
					do: 'delete',
					nodes: (Array.isArray(step['nodes']) ? step['nodes'] : []).map((id: unknown) => names.of(id)),
					edges: (Array.isArray(step['edges']) ? step['edges'] : []).map((id: unknown) => names.of(id)),
				});
		}
	}
	return steps;
}

/**
 * The freeform views, changed. A view is named, renamed and deleted as its
 * own screen does it. What stands on a view is changed by a list of steps
 * taken together or not at all, which is how the plugin's own view takes
 * every gesture: a drag of forty cards, a paste, a frame drawn round a
 * selection.
 */
export const freeformWriteOperations: OperationGroup = {
	createFreeformView: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const { project, held } = await standingOf(call, context);
		const name = textOf(bodyOf(call)['name']).trim();
		if (!free(held.views.map((view) => view.name), name, null)) throw taken('freeform view', name);
		const id = made(await context.host.projects.freeform.createView(project, { name }), FILE);
		context.host.recordsChanged('freeform');
		return {
			status: 201,
			body: await tellView(context, project, id),
			location: `/projects/${encodeURIComponent(projectId)}/freeform-views/${encodeURIComponent(id)}`,
		};
	},

	updateFreeformView: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const view = viewIn(held, call);
		const body = bodyOf(call);
		const name = typeof body['name'] === 'string' ? body['name'].trim() : view.name;
		const others = held.views.filter((entry) => entry.id !== view.id).map((entry) => entry.name);
		if (!free(others, name, view.name)) throw taken('freeform view', name);
		landed(await context.host.projects.freeform.renameView(project, view.id, name), noView(), FILE);
		context.host.recordsChanged('freeform');
		return { status: 200, body: await tellView(context, project, view.id) };
	},

	deleteFreeformView: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		landed(await context.host.projects.freeform.deleteView(project, viewIn(held, call).id), noView(), FILE);
		context.host.recordsChanged('freeform');
		return { status: 204 };
	},

	applyFreeformSteps: async (call, context) => {
		const sent = bodyOf(call)['steps'];
		const list: readonly unknown[] = Array.isArray(sent) ? sent : [];
		// The operation asks the write level, and one kind of step takes things off the view. That is a
		// removal like a scene taken off any other board, and is held to the level those are held to.
		// Asked before anything is looked up, as the level of every operation is.
		const level = context.host.access();
		const removal = list.findIndex((step) => isSent(step) && step['do'] === 'delete');
		if (removal !== -1 && !allows(level, 'delete')) {
			throw new ApiError('access-denied', `A step that takes things off a view needs the delete level, and the author has set ${level}.`, {
				needs: 'delete',
				level,
				pointer: `/steps/${String(removal)}`,
			});
		}
		const { project, held, index } = await standingOf(call, context);
		const view = viewIn(held, call);
		const service = context.host.projects.freeform;
		const standing = new Set([...view.placements, ...view.frames, ...view.edges].map((entry) => entry.id));
		const names = new Names((kind) => service.mint(kind), standing);
		const steps = await stepsOf(list, names, resourcesOf(context, project, index));
		// Taken one at a time over the view as it stands, so that a step the view will not take is told by its place in the call.
		let tried = view;
		steps.forEach((step, at) => {
			const outcome = applyFreeformSteps(tried, [step], context.host.now(), service.limits());
			const pointer = `/steps/${String(at)}`;
			if (outcome.came === 'full') throw full();
			if (outcome.came === 'absent') {
				throw noSuch(pointer, 'The step names something the view does not have, or has no longer. getFreeformView gives what stands on it.');
			}
			if (outcome.came === 'refused') {
				throw misfit(pointer, 'The view cannot take that step: a line from a thing to itself, a place that is no number, or words longer than a card holds.');
			}
			tried = outcome.view;
		});
		const done = await service.transact(project, view.id, steps);
		if (done.came === 'full') throw full();
		// The steps were taken against the view a moment ago. A refusal now is the file's own.
		if (done.came === 'refused') throw foreign(FILE);
		if (done.came === 'absent') throw noView();
		context.host.recordsChanged('freeform');
		return { status: 200, body: { view: await tellView(context, project, view.id), created: names.made } };
	},
};
