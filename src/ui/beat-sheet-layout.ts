/**
 * The beat sheet workspace's arithmetic, with no workspace to draw on: the
 * sheet seen as the one lane its cells stand in, the order its table is read
 * in, what an act is called, and where a dragged beat or act would land.
 * Pure, so the tests read it without a DOM.
 */

import { beatScenePlacements, findBeat, type Beat, type BeatSheet, type BeatSheetAct } from '../domain';
import type { Lane } from './lane-cells';
import type { Translate } from './modals';
import { dropIndexAt } from './task-board-rows';
import { joinKey } from './timeline-layout';

/**
 * A sheet as the lanes' cells know a lane: its beats the slots its rows
 * stand under, in the order the sheet is read. The acts are the table's to
 * draw; to the cells a sheet is one lane of beats.
 */
export function sheetAsLane(sheet: Pick<BeatSheet, 'id' | 'name' | 'acts'>): Lane {
	return {
		id: sheet.id,
		name: sheet.name,
		times: sheet.acts.flatMap((act) => act.beats.map((beat) => ({ timeId: beat.id, rows: beat.rows }))),
	};
}

/** The scenes a sheet has placed, wherever on it. */
export function assignedSceneIds(sheet: Pick<BeatSheet, 'acts'>): Set<string> {
	return new Set(beatScenePlacements(sheet).keys());
}

/** Under which name a row's stack remembers the card it shows, for the session. */
export function beatStackKey(sheetId: string, rowId: string): string {
	return joinKey(sheetId, rowId);
}

export type TableEntryKind = 'act' | 'beat' | 'foot';

/** The key an entry of the table is kept under: its kind and its id, so an act and its foot never meet a beat's. */
export function tableKey(kind: TableEntryKind, id: string): string {
	return joinKey(kind, id);
}

/**
 * One entry of the table, top to bottom: an act's header, each of its beats,
 * and its foot, which says an act holds no beat and takes a beat dropped at
 * the act's end.
 */
export type TableEntry =
	| { kind: 'act'; key: string; act: BeatSheetAct; number: number }
	| { kind: 'beat'; key: string; act: BeatSheetAct; beat: Beat; first: boolean; last: boolean }
	| { kind: 'foot'; key: string; act: BeatSheetAct };

/** The table as the sheet is read: act by act, each header over its beats and its foot. */
export function tableOrder(sheet: Pick<BeatSheet, 'acts'>): TableEntry[] {
	const entries: TableEntry[] = [];
	sheet.acts.forEach((act, index) => {
		entries.push({ kind: 'act', key: tableKey('act', act.id), act, number: index + 1 });
		act.beats.forEach((beat, at) => {
			entries.push({
				kind: 'beat',
				key: tableKey('beat', beat.id),
				act,
				beat,
				first: at === 0,
				last: at === act.beats.length - 1,
			});
		});
		entries.push({ kind: 'foot', key: tableKey('foot', act.id), act });
	});
	return entries;
}

/** What an act is called: its number, read off its place, and its label where it has one. */
export function actTitle(t: Translate, number: number, label: string): string {
	const words = label.trim();
	return words.length === 0
		? t('beatSheet.act.title', { number })
		: t('beatSheet.act.titleLabelled', { number, label: words });
}

/** Where a beat stands, as a writer would name it: its act, then itself. */
export function beatPlaceName(t: Translate, sheet: Pick<BeatSheet, 'acts'>, beatId: string): string | null {
	const place = findBeat(sheet, beatId);
	if (place === null) return null;
	const act = actTitle(t, sheet.acts.indexOf(place.act) + 1, place.act.label);
	const name = place.beat.name.trim();
	return `${act} · ${name.length > 0 ? name : t('beatSheet.beat.unnamed')}`;
}

/** The drag in flight at the table's own two levels; a row's and a scene's are the cells'. */
export type BeatSheetDrag =
	| { kind: 'act'; actId: string }
	| { kind: 'beat'; beatId: string };

/** What a dragged beat may land before: another beat, or an act's foot for the act's end. */
export interface BeatLandingCandidate {
	kind: 'beat' | 'foot';
	key: string;
	actId: string;
	/** The beat's own id; null for a foot. */
	beatId: string | null;
	/** Where the entry's middle stands on the page. */
	middle: number;
}

/**
 * Where a dragged beat would land, from where the pointer is: before the
 * first beat whose middle is below it, or at the end of the act whose foot
 * comes first, an empty act included. Past every entry is the end of the
 * last act; null with no act to land in. The candidates come in the table's
 * order, the dragged beat left out.
 */
export function beatLandingAt(
	candidates: readonly BeatLandingCandidate[],
	clientY: number,
): { key: string; actId: string; beforeBeatId: string | null } | null {
	if (candidates.length === 0) return null;
	const at = dropIndexAt(candidates.map((candidate) => candidate.middle), clientY);
	const landing = candidates[at] ?? candidates[candidates.length - 1]!;
	if (at >= candidates.length) {
		// Past the last entry, which is always the last act's foot.
		return { key: landing.key, actId: landing.actId, beforeBeatId: null };
	}
	return { key: landing.key, actId: landing.actId, beforeBeatId: landing.beatId };
}

/** Whether a beat already stands exactly where a move would put it. */
export function beatMoveIsNoop(
	sheet: Pick<BeatSheet, 'acts'>,
	beatId: string,
	toActId: string,
	beforeBeatId: string | null,
): boolean {
	const place = findBeat(sheet, beatId);
	if (place === null || place.act.id !== toActId) return false;
	if (beforeBeatId === beatId) return true;
	const next = place.act.beats[place.index + 1]?.id ?? null;
	const anchor = beforeBeatId !== null && place.act.beats.some((beat) => beat.id === beforeBeatId) ? beforeBeatId : null;
	return next === anchor;
}

/** An act's whole group on the page, header to foot, for a dragged act to land among. */
export interface ActLandingCandidate {
	actId: string;
	top: number;
	bottom: number;
}

/**
 * The act a dragged act would land before, null for the end: the first act
 * whose middle, header to foot, is below the pointer. The candidates come in
 * the sheet's order, the dragged act left out.
 */
export function actLandingAt(
	candidates: readonly ActLandingCandidate[],
	clientY: number,
): { beforeActId: string | null } {
	const at = dropIndexAt(candidates.map((candidate) => (candidate.top + candidate.bottom) / 2), clientY);
	return { beforeActId: candidates[at]?.actId ?? null };
}
