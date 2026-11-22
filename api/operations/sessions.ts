import { addDays, daysBetween, isTaskDay, type BandSpan } from '../../src/domain';
import { dayBandOf, historyDayOf, liveSessionOf, modeTotalsOf, writingDayOf } from '../dto/sessions';
import { ApiError } from '../errors';
import { optionalTextParam, textParam, type OperationCall, type OperationGroup } from './context';

const refuse = (pointer: string, detail: string): ApiError =>
	new ApiError('invalid-request', 'The call does not match what the operation takes.', { errors: [{ pointer, detail }] });

/**
 * The stretch of days a call asks for. The contract holds a day to its
 * shape, and a shape can still name a day no calendar has. A stretch is
 * held to a longest, because every day of it is answered for and every
 * month it touches is read from each device's own file.
 */
function stretchOf(call: OperationCall, today: string, usual: number, longest: number): { from: string; through: string } {
	const day = (name: string): string | null => {
		const asked = optionalTextParam(call, name);
		if (asked !== null && !isTaskDay(asked)) throw refuse(`params/${name}`, 'No calendar has that day.');
		return asked;
	};
	const through = day('through') ?? today;
	const from = day('from') ?? addDays(through, 1 - usual);
	const days = daysBetween(from, through) + 1;
	if (days < 1) throw refuse('params/from', 'The stretch ends before it begins.');
	if (days > longest) throw refuse('params/from', `A stretch may be ${String(longest)} days long at most.`);
	return { from, through };
}

/**
 * The author's writing sessions and the project's history, read. Days are
 * the days of this computer's calendar, as they are on the author's own
 * screens.
 */
export const sessionOperations: OperationGroup = {
	listWritingDays: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const { from, through } = stretchOf(call, context.host.today(), 30, 366);
		const scopes = context.host.sessionScopes();
		const days = await context.host.sessions.totalsBetween(project, from, through);
		return { status: 200, body: { from, through, scope: scopes.shown, goalScope: scopes.goal, items: days.map(writingDayOf) } };
	},

	getWritingSpread: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const span = textParam(call, 'span') as BandSpan;
		const spread = await context.host.sessions.spread(project, span);
		return {
			status: 200,
			body: {
				span,
				scope: context.host.sessionScopes().shown,
				bands: spread.bands.map(dayBandOf),
				modes: spread.modes.map(modeTotalsOf),
			},
		};
	},

	getWritingSession: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const scopes = context.host.sessionScopes();
		const live = context.host.sessions.live(project.projectFile);
		const today = await context.host.sessions.todaySummary(project);
		return {
			status: 200,
			body: {
				session: live === null ? null : liveSessionOf(live),
				today: writingDayOf(today),
				scope: scopes.shown,
				goalScope: scopes.goal,
			},
		};
	},

	getHistory: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const { from, through } = stretchOf(call, context.host.today(), 7, 93);
		const reading = await context.host.history.read(project, from, through);
		return { status: 200, body: { from, through, days: reading.days.map((day) => historyDayOf(project, day)) } };
	},
};
