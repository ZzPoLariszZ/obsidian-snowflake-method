import { normalizePath } from 'obsidian';

import {
	SESSION_LIMITS,
	fingerprint,
	type MentionIgnore,
	type WritingCountHeadings,
	type WritingCountMode,
	type WritingMode,
	type WritingSessionScope,
	type WritingSessionType,
} from '../../src/domain';
import type { ProjectSnapshot } from '../../src/services';
import { manuscriptNoteRefOf } from '../dto/manuscript';
import type { MemberIndex } from '../dto/member';
import { settingsOf } from '../dto/settings';
import { ApiError } from '../errors';
import type { AuthorSettingsChange } from '../host';
import type { JsonObject } from '../json';
import { idOf, noSuch } from './board-rules';
import { bodyOf, textParam, type ApiContext, type OperationGroup } from './context';
import { noteAt } from './manuscript-writes';
import { isSent, misfit, textOf } from './refusals';
import { tellSession } from './sessions';

/** The most the words the author watches for may come to, all told: what the settings page itself keeps. */
const WATCHED_WORDS_MOST = 20_000;

const tellSettings = (context: ApiContext): JsonObject => settingsOf(context.host.settings(), context.host.exportDefaults());

/**
 * What names a rule the author made about a mention. A rule is kept by what
 * it says and carries no id of its own, so its id here is worked out from
 * what it says: the same rule has the same id for as long as it stands.
 */
const ignoreId = (rule: MentionIgnore): string =>
	`mention-ignore-${fingerprint([
		rule.scope,
		'notePath' in rule ? rule.notePath : '',
		'memberPath' in rule ? rule.memberPath : '',
		rule.matchedText,
		rule.scope === 'occurrence' ? rule.ordinal : -1,
	]).replace(/^fp1-/u, '')}`;

function ignoreOf(index: MemberIndex, project: ProjectSnapshot, rule: MentionIgnore): JsonObject {
	return {
		id: ignoreId(rule),
		scope: rule.scope,
		words: rule.matchedText,
		member: 'memberPath' in rule ? index.refAt(rule.memberPath) : null,
		note: 'notePath' in rule ? manuscriptNoteRefOf(project, rule.notePath) : null,
		ordinal: rule.scope === 'occurrence' ? rule.ordinal : null,
	};
}

async function tellIgnores(context: ApiContext, project: ProjectSnapshot): Promise<JsonObject> {
	const index = context.members(project);
	return { items: (await context.host.projects.mentionStore.readIgnores(project)).map((rule) => ignoreOf(index, project, rule)) };
}

/**
 * The author's settings, their timer and the mentions they set aside. These
 * are the author's own surroundings more than they are a project's, so
 * little of them can be changed from here, and that little is held to what
 * the plugin's own screens hold it to.
 */
export const environmentOperations: OperationGroup = {
	getSettings: (_call, context) => ({ status: 200, body: tellSettings(context) }),

	updateSettings: async (call, context) => {
		const body = bodyOf(call);
		const change: AuthorSettingsChange = {};
		if (isSent(body['counting'])) {
			change.counting = {
				...(typeof body['counting']['mode'] === 'string' ? { mode: body['counting']['mode'] as WritingCountMode } : {}),
				...(typeof body['counting']['headings'] === 'string' ? { headings: body['counting']['headings'] as WritingCountHeadings } : {}),
			};
		}
		if (isSent(body['dailyGoals'])) {
			const goals = body['dailyGoals'];
			change.dailyGoals = {
				...(typeof goals['project'] === 'number' ? { project: goals['project'] } : {}),
				...(typeof goals['manuscript'] === 'number' ? { manuscript: goals['manuscript'] } : {}),
				...(typeof goals['scope'] === 'string' ? { scope: goals['scope'] as WritingSessionScope } : {}),
			};
		}
		if (typeof body['sessionScope'] === 'string') change.sessionScope = body['sessionScope'] as WritingSessionScope;
		if (Array.isArray(body['sensitiveWords'])) {
			// One word or phrase a line is how the author keeps them, so none holds a line break, and none is kept twice.
			const words = [...new Set(body['sensitiveWords'].map((word: unknown) => textOf(word).trim()).filter((word) => word.length > 0))];
			const broken = words.findIndex((word) => /[\r\n]/u.test(word));
			if (broken !== -1) throw misfit(`/sensitiveWords/${String(broken)}`, 'A word or a phrase to watch for is one line.');
			if (words.join('\n').length > WATCHED_WORDS_MOST) {
				throw misfit('/sensitiveWords', `The words to watch for may come to ${String(WATCHED_WORDS_MOST)} characters at most, all told.`);
			}
			change.sensitiveWords = words;
		}
		await context.host.changeSettings(change);
		return { status: 200, body: tellSettings(context) };
	},

	startWritingSession: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const body = call.body === undefined ? {} : bodyOf(call);
		// A session started by the author's own button ends the one under way. Nobody is here to mean that, so it is refused.
		if (context.host.sessions.isRunning()) {
			throw new ApiError('session-running', 'A writing session is already under way. stopWritingSession ends it, on the project it runs on.');
		}
		const type = typeof body['type'] === 'string' ? (body['type'] as WritingSessionType) : null;
		const minutes = typeof body['minutes'] === 'number' ? body['minutes'] : null;
		if (minutes !== null) {
			const { min, max } = SESSION_LIMITS.countdownMinutes;
			if ((type ?? context.host.settings().session.type) !== 'countdown') throw misfit('/minutes', 'Only a countdown is given a length here. Send type as countdown with it.');
			if (minutes < min || minutes > max) throw misfit('/minutes', `A countdown runs from ${String(min)} to ${String(max)} minutes.`);
		}
		await context.host.startSession(project, {
			type,
			writingMode: typeof body['writingMode'] === 'string' ? (body['writingMode'] as WritingMode) : null,
			minutes,
		});
		return { status: 201, body: await tellSession(context, project) };
	},

	stopWritingSession: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		// Only a session of this project is ended. One that runs on another is that project's to stop.
		if (context.host.sessions.live(project.projectFile) !== null) await context.host.stopSession();
		return { status: 200, body: await tellSession(context, project) };
	},

	listMentionIgnores: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		return { status: 200, body: await tellIgnores(context, project) };
	},

	addMentionIgnore: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const body = bodyOf(call);
		const index = context.members(project);
		const scope = textOf(body['scope']);
		const words = textOf(body['words']);
		const memberOf = (): string => {
			if (body['member'] === undefined) throw misfit('/member', 'A rule for a note or for the whole manuscript says which note the words are no mention of.');
			const member = index.byId(idOf(body['member']));
			if (member === null) throw noSuch('/member', 'The project has no note with that id. listMembers gives the ids there are.');
			return member.path;
		};
		const noteOf = async (): Promise<string> => {
			if (typeof body['note'] !== 'string') throw misfit('/note', 'A rule for one note or for one place in it says which manuscript note.');
			const segments = await context.host.projects.manuscript.listSegmentsFromFiles(project);
			return normalizePath(noteAt(project, segments, body['note'], '/note').path);
		};
		let rule: MentionIgnore;
		if (scope === 'manuscript') {
			rule = { scope, memberPath: memberOf(), matchedText: words };
		} else if (scope === 'note') {
			rule = { scope, notePath: await noteOf(), memberPath: memberOf(), matchedText: words };
		} else {
			if (typeof body['ordinal'] !== 'number') throw misfit('/ordinal', 'A rule for one place says which of the note\'s places with those words it is, counted from 0.');
			rule = { scope: 'occurrence', notePath: await noteOf(), matchedText: words, ordinal: body['ordinal'] };
		}
		// A rule that already stands is what was asked for.
		await context.host.projects.mentionStore.addIgnore(project, rule);
		context.host.recordsChanged('mentions');
		return { status: 201, body: { id: ignoreId(rule), ...(await tellIgnores(context, project)) } };
	},

	removeMentionIgnore: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'ignoreId');
		const store = context.host.projects.mentionStore;
		const rule = (await store.readIgnores(project)).find((entry) => ignoreId(entry) === id);
		if (rule === undefined || !(await store.removeIgnore(project, rule))) {
			throw new ApiError('not-found', 'There is no such rule in the project. It may have been taken away. listMentionIgnores gives the ones there are.');
		}
		context.host.recordsChanged('mentions');
		return { status: 204 };
	},
};
