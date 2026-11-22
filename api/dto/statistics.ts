import type { DialogueOccurrence, DialogueStyle, EntityOccurrence, SensitiveOccurrence } from '../../src/domain';
import type {
	EntityMentionAggregate,
	NoteProseStats,
	ProjectRef,
	ScopeWritingCount,
	SensitiveTermAggregate,
} from '../../src/services';
import type { JsonObject } from '../json';
import { manuscriptNoteRefOf, writingCountOf } from './manuscript';
import type { MemberIndex } from './member';

/**
 * What the plugin works out from the manuscript, as the API tells it: how
 * much is written, what the prose is made of, and where the project's own
 * notes are named. Every place is told by the manuscript note it stands in
 * and by where in that note's text.
 */

export function scopeCountOf(count: ScopeWritingCount): JsonObject {
	return { notes: count.notes, unreadable: count.unreadable, count: writingCountOf(count) };
}

/** What a stretch of prose comes to. The plugin's own names for these are shorter than they are clear. */
export function proseNumbersOf(stats: NoteProseStats): JsonObject {
	return {
		total: stats.counted,
		words: stats.words,
		cjkCharacters: stats.cjk,
		sentences: stats.sentences,
		dialogueTotal: stats.dialogueCounted,
	};
}

function foundPassageOf(project: ProjectRef, found: SensitiveOccurrence): JsonObject {
	return { note: manuscriptNoteRefOf(project, found.path), range: { from: found.from, to: found.to }, text: found.matchedText };
}

export function sensitiveWordOf(project: ProjectRef, word: SensitiveTermAggregate, withOccurrences: boolean): JsonObject {
	const told: JsonObject = { term: word.term, total: word.total };
	if (withOccurrences) told['occurrences'] = word.occurrences.map((found) => foundPassageOf(project, found));
	return told;
}

export const quotationMarksOf = (style: DialogueStyle): JsonObject => ({ open: style.open, close: style.close });

export const quotedStretchOf = (found: DialogueOccurrence): JsonObject => ({
	range: { from: found.from, to: found.to },
	text: found.matchedText,
});

/** How the manuscript mentions one note. Its mentions come in reading order, and so do the notes they are counted by. */
export function mentionSummaryOf(index: MemberIndex, project: ProjectRef, entity: EntityMentionAggregate): JsonObject {
	const byNote = new Map<string, number>();
	for (const found of entity.occurrences) byNote.set(found.path, (byNote.get(found.path) ?? 0) + 1);
	const placeOf = (place: { path: string; from: number } | null): JsonObject | null =>
		place === null ? null : { note: manuscriptNoteRefOf(project, place.path), from: place.from };
	return {
		member: index.refAt(entity.memberPath),
		total: entity.total,
		linked: entity.linked,
		unlinked: entity.unlinked,
		first: placeOf(entity.first),
		last: placeOf(entity.last),
		notes: [...byNote].map(([path, count]) => ({ note: manuscriptNoteRefOf(project, path), count })),
	};
}

export function noteMentionOf(index: MemberIndex, found: EntityOccurrence): JsonObject {
	// A note can be a candidate twice over, by its name and by an alias that reads the same.
	const candidates = [...new Set(found.candidates.map((candidate) => candidate.memberPath))];
	return {
		range: { from: found.from, to: found.to },
		text: found.matchedText,
		resolution: found.resolution,
		member: found.resolvedMemberPath === null ? null : index.refAt(found.resolvedMemberPath),
		candidates: candidates.map((path) => index.refAt(path)),
	};
}
