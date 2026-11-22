import {
	DAY_BANDS,
	type BandTotals,
	type HistoryDay,
	type HistoryEntry,
	type HistoryImportSource,
	type HistoryNoteIdentity,
	type ModeTotals,
} from '../../src/domain';
import type { LiveWritingSession, ProjectRef, WritingDayTotals } from '../../src/services';
import type { JsonObject } from '../json';
import { instantOf } from './records';

/**
 * The author's sittings and what happened to a project day by day, as the
 * API tells them. The plugin calls a session's net its tracked net, and a
 * note's place under the project its path. They are told here as `net` and
 * `relativePath`, to read as every other answer does.
 */

export function writingDayOf(day: WritingDayTotals): JsonObject {
	return {
		day: day.day,
		sessions: day.sessions,
		focusMs: day.focusMs,
		idleMs: day.idleMs,
		totalMs: day.totalMs,
		added: day.added,
		deleted: day.deleted,
		net: day.trackedNet,
		timedNet: day.timedNet,
		goalNet: day.goalNet,
	};
}

/** One part of the day, by the hours it runs between. The parts come in the plugin's own order. */
export function dayBandOf(band: BandTotals, at: number): JsonObject {
	const hours = DAY_BANDS[at];
	return {
		fromHour: hours?.from ?? 0,
		toHour: hours?.to ?? 24,
		focusMs: band.focusMs,
		totalMs: band.totalMs,
		added: band.added,
		deleted: band.deleted,
		net: band.trackedNet,
	};
}

export function modeTotalsOf(mode: ModeTotals): JsonObject {
	return { mode: mode.mode, sessions: mode.sessions, focusMs: mode.focusMs, totalMs: mode.totalMs, net: mode.trackedNet };
}

export function liveSessionOf(live: LiveWritingSession): JsonObject {
	return {
		id: live.id,
		type: live.type,
		startMode: live.startMode,
		writingMode: live.writingMode,
		state: live.state,
		startedAt: live.startedAt === null ? null : instantOf(live.startedAt),
		focusMs: live.durations.focusMs,
		idleMs: live.durations.idleMs,
		pausedMs: live.durations.pausedMs,
		totalMs: live.durations.totalMs,
		remainingMs: live.remainingMs,
		pomodoro: live.pomodoro === null ? null : { phase: live.pomodoro.phase, cycle: live.pomodoro.cycle },
		startWordCount: live.startWordCount,
		added: live.added,
		deleted: live.deleted,
		net: live.trackedNet,
		goalNet: live.goalNet,
		notes: live.files,
	};
}

function historyNoteOf(project: ProjectRef, note: HistoryNoteIdentity): JsonObject {
	const told: JsonObject = { path: `${project.rootPath}/${note.path}`, relativePath: note.path, kind: note.kind };
	if (note.wbKind !== undefined) told['worldbuildingKind'] = note.wbKind;
	if (note.step !== undefined) told['step'] = note.step;
	if (note.documentType !== undefined) told['documentType'] = note.documentType;
	told['exists'] = note.exists;
	return told;
}

const importSourceOf = (source: HistoryImportSource): JsonObject => ({ projectId: source.projectId, title: source.title });

function historyEntryOf(project: ProjectRef, entry: HistoryEntry): JsonObject {
	const told: JsonObject = { kind: entry.kind, id: entry.id, day: entry.day, at: instantOf(entry.at), until: instantOf(entry.until) };
	switch (entry.kind) {
		case 'note':
			told['action'] = entry.action;
			told['note'] = historyNoteOf(project, entry.note);
			told['versions'] = entry.versions;
			told['words'] = { added: entry.words.added, deleted: entry.words.deleted, net: entry.words.net };
			told['source'] = entry.source;
			told['sessions'] = entry.sessions;
			if (entry.origin !== undefined) told['origin'] = entry.origin;
			if (entry.createdWords !== undefined) told['createdWords'] = entry.createdWords;
			if (entry.importedFrom !== undefined) told['importedFrom'] = importSourceOf(entry.importedFrom);
			if (entry.since !== undefined) told['since'] = entry.since;
			return told;
		case 'renamed':
			told['items'] = entry.items.map((item) => ({ from: item.from, note: historyNoteOf(project, item.note) }));
			told['inferred'] = entry.inferred;
			return told;
		case 'imported':
			told['from'] = entry.from === null ? null : importSourceOf(entry.from);
			told['notes'] = entry.notes.map((note) => historyNoteOf(project, note));
			return told;
		case 'task':
			told['event'] = entry.event;
			told['task'] = { id: entry.task.id, title: entry.task.title };
			if (entry.status !== undefined) told['status'] = entry.status;
			return told;
		case 'thread':
			told['event'] = entry.event;
			told['thread'] = { id: entry.thread.id, name: entry.thread.name };
			if (entry.status !== undefined) told['status'] = entry.status;
			return told;
		case 'revision':
			told['event'] = entry.event;
			told['revision'] = { id: entry.revision.id };
			told['note'] = historyNoteOf(project, entry.note);
			return told;
	}
}

export function historyDayOf(project: ProjectRef, day: HistoryDay): JsonObject {
	return { day: day.day, entries: day.entries.map((entry) => historyEntryOf(project, entry)) };
}
