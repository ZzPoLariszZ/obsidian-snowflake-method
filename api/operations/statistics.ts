import { countingOf, manuscriptNoteRefOf } from '../dto/manuscript';
import {
	mentionSummaryOf,
	noteMentionOf,
	proseNumbersOf,
	quotationMarksOf,
	quotedStretchOf,
	scopeCountOf,
	sensitiveWordOf,
} from '../dto/statistics';
import { pageOf } from '../paging';
import { flagParam, listParam, optionalTextParam, textParam, type OperationGroup } from './context';
import { findManuscriptNote } from './manuscript';
import { knownKind } from './members';

/**
 * Counts, prose statistics and mentions, read. All of it is worked out by
 * the plugin's own services, with the settings the author's own screens
 * use, so a number here is the number the author sees. What a walk over
 * the manuscript works out is kept by those services, note by note, until
 * the note changes.
 */
export const statisticsOperations: OperationGroup = {
	getWritingCounts: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const options = context.host.countOptions();
		const counts = await context.host.projects.writingCount.countScopes(project, options);
		return {
			status: 200,
			body: { project: scopeCountOf(counts.project), manuscript: scopeCountOf(counts.manuscript), counting: countingOf(options) },
		};
	},

	getProseStatistics: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const config = await context.host.analysisConfig(project);
		const statistics = await context.host.projects.analysis.statistics(project, config);
		return {
			status: 200,
			body: {
				...pageOf(statistics.perNote, call, (row) => ({
					note: manuscriptNoteRefOf(project, row.path, row.title),
					...proseNumbersOf(row),
				})),
				notes: statistics.totals.chapters,
				manuscript: proseNumbersOf(statistics.totals),
				counting: countingOf(config.count),
			},
		};
	},

	getWordFrequency: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const config = await context.host.analysisConfig(project);
		const filters = await context.host.frequencyFilters(project);
		const frequency = await context.host.projects.analysis.frequency(project, config, {
			stopwords: flagParam(call, 'includeStopwords') ? null : filters.stopwords,
			exclude: flagParam(call, 'includeNames') ? null : filters.names,
		});
		return {
			status: 200,
			body: { ...pageOf(frequency.rows, call, (row) => ({ term: row.term, count: row.count })), tokens: frequency.total },
		};
	},

	getSensitiveWords: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const config = await context.host.analysisConfig(project);
		const words = await context.host.projects.analysis.sensitiveAggregate(project, config);
		const withOccurrences = listParam(call, 'include').includes('occurrences');
		return { status: 200, body: { terms: words.map((word) => sensitiveWordOf(project, word, withOccurrences)) } };
	},

	getDialogue: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const config = await context.host.analysisConfig(project);
		const chapters = await context.host.projects.analysis.dialogueChapters(project, config);
		return {
			status: 200,
			body: {
				...pageOf(chapters, call, (chapter) => ({
					note: manuscriptNoteRefOf(project, chapter.path, chapter.title),
					count: chapter.count,
				})),
				marks: config.dialogueStyles.map(quotationMarksOf),
			},
		};
	},

	listNoteDialogue: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const { segment } = await findManuscriptNote(context, project, call);
		const config = await context.host.analysisConfig(project);
		const stretches = await context.host.projects.analysis.dialogueOccurrences(config, segment.path);
		return { status: 200, body: pageOf(stretches, call, quotedStretchOf) };
	},

	getMentions: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const kind = knownKind(project, optionalTextParam(call, 'kind'));
		const member = optionalTextParam(call, 'member');
		const mentions = context.host.projects.mentions;
		const aggregate = await mentions.aggregate(project, mentions.matcherFor(await context.host.mentionSources(project)));
		const index = context.members(project);
		const rows = aggregate.entities.filter((entity) => {
			const entry = index.at(entity.memberPath);
			return (kind === null || entry?.kind === kind) && (member === null || entry?.id === member);
		});
		return {
			status: 200,
			body: {
				...pageOf(rows, call, (entity) => mentionSummaryOf(index, project, entity)),
				unresolved: aggregate.unresolved.length,
			},
		};
	},

	listNoteMentions: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const { segment } = await findManuscriptNote(context, project, call);
		const mentions = context.host.projects.mentions;
		const matcher = mentions.matcherFor(await context.host.mentionSources(project));
		const found = await mentions.occurrencesOf(project, matcher, segment.path);
		const index = context.members(project);
		return { status: 200, body: pageOf(found, call, (occurrence) => noteMentionOf(index, occurrence)) };
	},
};
