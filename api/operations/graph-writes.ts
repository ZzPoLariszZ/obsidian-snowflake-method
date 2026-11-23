import {
	buildEntityGraph,
	type EntityGraphState,
	type GraphLabelMode,
	type GraphTimeRule,
	type GraphUndatedRule,
} from '../../src/domain';
import { graphMembersOf } from '../../src/services';
import { relationshipGraphViewOf } from '../dto/boards';
import { ApiError } from '../errors';
import { landed, noSuch } from './board-rules';
import { bodyOf, textParam, type OperationGroup } from './context';
import { isSent, textOf, type Sent } from './refusals';

const FILE = 'relationship graph';
/** The graph's file is the project's own and is never absent, so this is never said. It is here for the answer the file's bridge shares with the other boards. */
const noGraph = (): ApiError => new ApiError('not-found', 'The project keeps no relationship graph.');

type Parts = { -readonly [Part in keyof EntityGraphState]?: EntityGraphState[Part] };

/** A flag a call sends, or the one that stands. */
const flag = (sent: Sent, name: string, standing: boolean): boolean => (typeof sent[name] === 'boolean' ? sent[name] : standing);
/** A number a call sends, or the one that stands. */
const measure = (sent: Sent, name: string, standing: number): number => (typeof sent[name] === 'number' ? sent[name] : standing);

/**
 * The names a call hides, each once and in the order sent. Each must be one
 * the graph has, or one the view already hides: a name that answers to
 * nothing would hide nothing and say so nowhere.
 */
function hidden(sent: unknown, known: ReadonlySet<string>, pointer: string, detail: string): string[] {
	const names: string[] = [];
	(Array.isArray(sent) ? sent : []).forEach((entry: unknown, at) => {
		const name = textOf(entry);
		if (!known.has(name)) throw noSuch(`${pointer}/${String(at)}`, detail);
		if (!names.includes(name)) names.push(name);
	});
	return names;
}

/**
 * The relationship graph, set as its own panel of controls sets it: what is
 * shown, how the nodes are coloured, how the picture is drawn, how hard the
 * forces pull, how far a local graph reaches, and how its timeline reads the
 * lines. The lines themselves are the notes' own relationships, and are
 * changed where a note is changed.
 */
export const graphWriteOperations: OperationGroup = {
	updateRelationshipGraphView: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const body = bodyOf(call);
		const service = context.host.projects.relationshipGraph;
		// What a call hides is held to what the project has before anything is written. The names the view hides already are read for that alone.
		const standing = (await service.read(project)).entities.filters;
		const filters = isSent(body['filters']) ? body['filters'] : null;
		let kindsOff: string[] | null = null;
		let labelsOff: string[] | null = null;
		if (filters !== null && 'hiddenKinds' in filters) {
			const kinds = new Set(['character', 'scene', ...project.worldbuildingKinds.map((kind) => kind.id), ...standing.kindsOff]);
			kindsOff = hidden(filters['hiddenKinds'], kinds, '/filters/hiddenKinds', 'The project has no such kind of note. A kind is character, scene, or the id of a worldbuilding kind as listKinds gives it.');
		}
		if (filters !== null && 'hiddenLabels' in filters) {
			const index = context.members(project);
			const graph = buildEntityGraph(graphMembersOf(project), (link, sourcePath) => index.pathOf(link, sourcePath));
			labelsOff = hidden(
				filters['hiddenLabels'],
				new Set([...graph.labels, ...standing.labelsOff]),
				'/filters/hiddenLabels',
				'No relationship of the project goes by that label. getRelationshipGraph gives the labels there are.',
			);
		}
		const groups =
			'groups' in body
				? Array.isArray(body['groups'])
					? body['groups'].filter(isSent).map((group) => ({ query: textOf(group['query']), color: textOf(group['color']).toLowerCase() }))
					: null
				: undefined;
		const place = body['viewport'];
		const viewport = 'viewport' in body ? (isSent(place) ? { x: Number(place['x']), y: Number(place['y']), k: Number(place['zoom']) } : null) : undefined;
		// A setting the call leaves out is the one that stands when the write runs, and not the one read a moment
		// before it: the author may be moving another control of the same part in the graph they have open.
		const change = (held: EntityGraphState): Parts => {
			const parts: Parts = {};
			if (filters !== null) {
				parts.filters = {
					kindsOff: kindsOff ?? held.filters.kindsOff,
					labelsOff: labelsOff ?? held.filters.labelsOff,
					unresolved: flag(filters, 'unresolved', held.filters.unresolved),
					orphans: flag(filters, 'orphans', held.filters.orphans),
				};
			}
			if (groups !== undefined) parts.groups = groups;
			if (isSent(body['display'])) {
				const sent = body['display'];
				parts.display = {
					arrows: flag(sent, 'arrows', held.display.arrows),
					labels: typeof sent['captions'] === 'string' ? (sent['captions'] as GraphLabelMode) : held.display.labels,
					textFade: measure(sent, 'textFade', held.display.textFade),
					nodeSize: measure(sent, 'nodeSize', held.display.nodeSize),
					lineSize: measure(sent, 'lineSize', held.display.lineSize),
				};
			}
			if (isSent(body['forces'])) {
				const sent = body['forces'];
				parts.forces = {
					center: measure(sent, 'center', held.forces.center),
					repel: measure(sent, 'repel', held.forces.repel),
					link: measure(sent, 'link', held.forces.link),
					linkDistance: measure(sent, 'linkDistance', held.forces.linkDistance),
				};
			}
			if (isSent(body['local'])) {
				const sent = body['local'];
				parts.local = {
					depth: measure(sent, 'depth', held.local.depth),
					incoming: flag(sent, 'incoming', held.local.incoming),
					outgoing: flag(sent, 'outgoing', held.local.outgoing),
					neighbours: flag(sent, 'neighbours', held.local.neighbours),
				};
			}
			if (isSent(body['timeline'])) {
				const sent = body['timeline'];
				parts.timeline = {
					rule: typeof sent['rule'] === 'string' ? (sent['rule'] as GraphTimeRule) : held.timeline.rule,
					undated: typeof sent['undated'] === 'string' ? (sent['undated'] as GraphUndatedRule) : held.timeline.undated,
				};
			}
			if (viewport !== undefined) parts.viewport = viewport;
			return parts;
		};
		landed(await service.updateEntities(project, change), noGraph(), FILE);
		context.host.recordsChanged('relationshipGraph');
		return { status: 200, body: relationshipGraphViewOf((await service.read(project)).entities) };
	},
};
