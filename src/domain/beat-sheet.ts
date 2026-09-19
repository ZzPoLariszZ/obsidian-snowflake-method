/**
 * Beat sheets: a story's scenes laid out under acts and beats, kept apart
 * from the notes it points at. A sheet is an ordered list of acts, an act an
 * ordered list of beats, and a beat holds what a time holds on a timeline:
 * sub-description rows, each carrying the scenes placed on it. Unlike a time,
 * neither an act nor a beat is a note, so a beat's name and its main
 * description live here with it, and an act's number is never stored: it is
 * the act's place in the sheet, read off the order at every dress. A scene
 * is named by its `snowflake-scene-id` and stands once in a whole sheet.
 *
 * The file also keeps the project's own templates: the acts and beats of a
 * sheet saved under a name, with none of its rows or placements, for a later
 * sheet to start from. The presets the plugin ships with are not stored;
 * `beat-sheet-templates.ts` states them.
 *
 * Everything below is pure, as the timeline's module is: readers that take a
 * stored shape leniently, mutations that answer a new document or null when
 * nothing would change, and queries the surfaces read from.
 */

import { foldName } from './names';
import {
	insertedBefore,
	isScenePresentation,
	movedBefore,
	readSceneRow,
	sameIds,
	scenesWith,
	uniqueIds,
	type ScenePresentation,
	type SceneRow,
} from './scene-rows';

/** One sub-description of a beat, with the scenes placed on it. */
export type BeatRow = SceneRow;

export interface Beat {
	readonly id: string;
	readonly name: string;
	/** The beat's main description; may be empty. */
	readonly description: string;
	readonly rows: readonly BeatRow[];
}

export interface BeatSheetAct {
	readonly id: string;
	/** What follows the act's number; empty for an act that wears its number alone. */
	readonly label: string;
	readonly beats: readonly Beat[];
}

export interface BeatSheet {
	readonly id: string;
	readonly name: string;
	readonly acts: readonly BeatSheetAct[];
	/** How the scenes are shown; null means the layout's own default. */
	readonly presentation: ScenePresentation | null;
	/** Whether the beats show their rows' words; a sheet that keeps them away shows the scenes alone. */
	readonly showSubDescriptions: boolean;
	/**
	 * Whether the sheet is shown from its end: the last act first, and each
	 * act's last beat first. Only the showing turns about. The acts and the
	 * beats are kept in the story's own order, which an act's number is read
	 * off, and what stands under a beat is shown as it is kept.
	 */
	readonly reversed: boolean;
	readonly createdAt: number;
	readonly updatedAt: number;
}

/** A beat as a template keeps one: what it is called and what it is for, with nothing written under it. */
export interface BeatSheetStructureBeat {
	readonly name: string;
	readonly description: string;
}

export interface BeatSheetStructureAct {
	readonly label: string;
	readonly beats: readonly BeatSheetStructureBeat[];
}

/** The acts and beats a sheet starts from, with no ids of their own: each sheet made from them mints its own. */
export interface BeatSheetStructure {
	readonly acts: readonly BeatSheetStructureAct[];
}

/** A structure the author saved under a name, to start later sheets from. */
export interface BeatSheetTemplate extends BeatSheetStructure {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface BeatSheetDocument {
	readonly sheets: readonly BeatSheet[];
	readonly templates: readonly BeatSheetTemplate[];
	/** The sheet opened last, so the workspace opens where it was left. */
	readonly lastSheetId: string | null;
	/** Entries this build could not read, re-emitted after the readable ones on every write. */
	readonly strays: {
		readonly sheets: readonly unknown[];
		readonly templates: readonly unknown[];
	};
}

/**
 * What a project reads before its beat sheet file is written: no sheet at
 * all. A sheet is made from a template the author picks, so none is made on
 * their behalf, and the first change is the first sheet.
 */
export function emptyBeatSheetDocument(): BeatSheetDocument {
	return {
		sheets: [],
		templates: [],
		lastSheetId: null,
		strays: { sheets: [], templates: [] },
	};
}

/** The object written under the schema line: the readable entries first, the strays after. */
export function serializeBeatSheetDocument(held: BeatSheetDocument): Record<string, unknown> {
	return {
		sheets: [...held.sheets, ...held.strays.sheets],
		templates: [...held.templates, ...held.strays.templates],
		lastSheetId: held.lastSheetId,
	};
}

// --- reading stored shapes -------------------------------------------------

const finiteOrZero = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : 0;

const nonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0;

const stringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * One sheet read leniently: the id and the name must hold, and the rest is
 * read as far as it goes. Containers gather: an act named twice keeps its
 * first place and label and takes the later one's beats, and a beat named
 * twice anywhere in the sheet keeps its first act, name and description and
 * takes the later one's rows. A row id met twice drops the later row, and a
 * scene placed twice keeps its first place. An act or a beat with no id is
 * passed over with what stands under it. Null where the sheet itself will
 * not read, which the document sets aside as a stray.
 */
export function readBeatSheet(value: unknown): BeatSheet | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	if (!nonEmptyString(entry.id) || typeof entry.name !== 'string') return null;
	const acts: { id: string; label: string; beats: { id: string; name: string; description: string; rows: BeatRow[] }[] }[] = [];
	const actsById = new Map<string, (typeof acts)[number]>();
	const beatsById = new Map<string, (typeof acts)[number]['beats'][number]>();
	const rowIds = new Set<string>();
	const placed = new Set<string>();
	if (Array.isArray(entry.acts)) {
		for (const item of entry.acts) {
			if (typeof item !== 'object' || item === null) continue;
			const stored = item as Record<string, unknown>;
			if (!nonEmptyString(stored.id)) continue;
			let act = actsById.get(stored.id);
			if (act === undefined) {
				act = { id: stored.id, label: stringOrEmpty(stored.label), beats: [] };
				actsById.set(stored.id, act);
				acts.push(act);
			}
			if (!Array.isArray(stored.beats)) continue;
			for (const raw of stored.beats) {
				if (typeof raw !== 'object' || raw === null) continue;
				const storedBeat = raw as Record<string, unknown>;
				if (!nonEmptyString(storedBeat.id)) continue;
				let beat = beatsById.get(storedBeat.id);
				if (beat === undefined) {
					beat = {
						id: storedBeat.id,
						name: stringOrEmpty(storedBeat.name),
						description: stringOrEmpty(storedBeat.description),
						rows: [],
					};
					beatsById.set(storedBeat.id, beat);
					act.beats.push(beat);
				}
				if (!Array.isArray(storedBeat.rows)) continue;
				for (const rawRow of storedBeat.rows) {
					const row = readSceneRow(rawRow, rowIds, placed);
					if (row !== null) beat.rows.push(row);
				}
			}
		}
	}
	return {
		id: entry.id,
		name: entry.name,
		acts,
		presentation: isScenePresentation(entry.presentation) ? entry.presentation : null,
		showSubDescriptions: entry.showSubDescriptions !== false,
		reversed: entry.reversed === true,
		createdAt: finiteOrZero(entry.createdAt),
		updatedAt: finiteOrZero(entry.updatedAt),
	};
}

/** A structure's acts read leniently: what is not an act or a beat is passed over, and missing words read as none. */
function readStructureActs(value: unknown): BeatSheetStructureAct[] {
	if (!Array.isArray(value)) return [];
	const acts: BeatSheetStructureAct[] = [];
	for (const item of value) {
		if (typeof item !== 'object' || item === null) continue;
		const stored = item as Record<string, unknown>;
		const beats: BeatSheetStructureBeat[] = [];
		if (Array.isArray(stored.beats)) {
			for (const raw of stored.beats) {
				if (typeof raw !== 'object' || raw === null) continue;
				const beat = raw as Record<string, unknown>;
				beats.push({ name: stringOrEmpty(beat.name), description: stringOrEmpty(beat.description) });
			}
		}
		acts.push({ label: stringOrEmpty(stored.label), beats });
	}
	return acts;
}

/** One template read leniently: the id and the name must hold; the acts are read as far as they go. */
export function readBeatSheetTemplate(value: unknown): BeatSheetTemplate | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	if (!nonEmptyString(entry.id) || typeof entry.name !== 'string') return null;
	return {
		id: entry.id,
		name: entry.name,
		description: stringOrEmpty(entry.description),
		acts: readStructureActs(entry.acts),
		createdAt: finiteOrZero(entry.createdAt),
		updatedAt: finiteOrZero(entry.updatedAt),
	};
}

/**
 * The file's object read into a document, or null where it is not one at
 * all. A sheet or a template that will not read, or one whose id an earlier
 * entry already took, is kept as a stray rather than served. The last sheet
 * is kept as found, unchecked: what it names may be a stray this build
 * cannot read, and clearing it would lose a newer build's choice.
 */
export function readBeatSheetDocument(file: Record<string, unknown>): BeatSheetDocument | null {
	if (!Array.isArray(file.sheets) || !Array.isArray(file.templates)) return null;
	const readInto = <T extends { id: string }>(
		entries: unknown[],
		read: (value: unknown) => T | null,
	): { kept: T[]; strays: unknown[] } => {
		const ids = new Set<string>();
		const kept: T[] = [];
		const strays: unknown[] = [];
		for (const entry of entries) {
			const record = read(entry);
			if (record === null || ids.has(record.id)) {
				strays.push(entry);
				continue;
			}
			ids.add(record.id);
			kept.push(record);
		}
		return { kept, strays };
	};
	const sheets = readInto(file.sheets, readBeatSheet);
	const templates = readInto(file.templates, readBeatSheetTemplate);
	return {
		sheets: sheets.kept,
		templates: templates.kept,
		lastSheetId: nonEmptyString(file.lastSheetId) ? file.lastSheetId : null,
		strays: { sheets: sheets.strays, templates: templates.strays },
	};
}

// --- queries ---------------------------------------------------------------

export function findBeatSheet(held: BeatSheetDocument, id: string): BeatSheet | undefined {
	return held.sheets.find((sheet) => sheet.id === id);
}

export function findBeatSheetTemplate(held: BeatSheetDocument, id: string): BeatSheetTemplate | undefined {
	return held.templates.find((template) => template.id === id);
}

export function findBeatSheetAct(sheet: Pick<BeatSheet, 'acts'>, actId: string): BeatSheetAct | undefined {
	return sheet.acts.find((act) => act.id === actId);
}

/** Where a beat stands, by its id: its act, itself, and its place among the act's beats. */
export function findBeat(
	sheet: Pick<BeatSheet, 'acts'>,
	beatId: string,
): { act: BeatSheetAct; beat: Beat; index: number } | null {
	for (const act of sheet.acts) {
		const index = act.beats.findIndex((beat) => beat.id === beatId);
		if (index !== -1) return { act, beat: act.beats[index]!, index };
	}
	return null;
}

/** Where a row stands, by its id. */
export function findBeatRow(
	sheet: Pick<BeatSheet, 'acts'>,
	rowId: string,
): { act: BeatSheetAct; beat: Beat; row: BeatRow; index: number } | null {
	for (const act of sheet.acts) {
		for (const beat of act.beats) {
			const index = beat.rows.findIndex((row) => row.id === rowId);
			if (index !== -1) return { act, beat, row: beat.rows[index]!, index };
		}
	}
	return null;
}

export interface BeatScenePlacement {
	actId: string;
	beatId: string;
	rowId: string;
	/** Where the scene stands among the row's scenes. */
	index: number;
}

/** Where every placed scene stands on one sheet. */
export function beatScenePlacements(sheet: Pick<BeatSheet, 'acts'>): Map<string, BeatScenePlacement> {
	const placements = new Map<string, BeatScenePlacement>();
	for (const act of sheet.acts) {
		for (const beat of act.beats) {
			for (const row of beat.rows) {
				row.scenes.forEach((sceneId, index) => {
					placements.set(sceneId, { actId: act.id, beatId: beat.id, rowId: row.id, index });
				});
			}
		}
	}
	return placements;
}

/** How a sheet shows its scenes when it has not said: flat, since a sheet is one lane. */
export function derivedBeatSheetPresentation(sheet: Pick<BeatSheet, 'presentation'>): ScenePresentation {
	return sheet.presentation ?? 'flat';
}

/**
 * The sheet to show: the one picked while it stands, else the one opened
 * last, else the first; null with no sheet at all.
 */
export function shownBeatSheetId(held: BeatSheetDocument, picked: string | null): string | null {
	if (picked !== null && findBeatSheet(held, picked) !== undefined) return picked;
	if (held.lastSheetId !== null && findBeatSheet(held, held.lastSheetId) !== undefined) return held.lastSheetId;
	return held.sheets[0]?.id ?? null;
}

/**
 * Where a beat lands one step up or down the sheet as it is read, top to
 * bottom through the acts: within its act while a neighbour stands there,
 * else across the act's edge, to the end of the act above or the head of the
 * act below, an empty act included. Null at the sheet's two ends, and for a
 * beat the sheet does not hold. What it answers is what `moveBeat` takes.
 */
export function beatStep(
	sheet: Pick<BeatSheet, 'acts'>,
	beatId: string,
	direction: 'up' | 'down',
): { actId: string; beforeBeatId: string | null } | null {
	const place = findBeat(sheet, beatId);
	if (place === null) return null;
	const actIndex = sheet.acts.indexOf(place.act);
	if (direction === 'up') {
		if (place.index > 0) return { actId: place.act.id, beforeBeatId: place.act.beats[place.index - 1]!.id };
		const above = sheet.acts[actIndex - 1];
		return above === undefined ? null : { actId: above.id, beforeBeatId: null };
	}
	if (place.index < place.act.beats.length - 1) {
		return { actId: place.act.id, beforeBeatId: place.act.beats[place.index + 2]?.id ?? null };
	}
	const below = sheet.acts[actIndex + 1];
	return below === undefined ? null : { actId: below.id, beforeBeatId: below.beats[0]?.id ?? null };
}

/** The act an act lands before one step up or down, null for the end; null itself where there is nowhere to go. */
export function beatSheetActStep(
	sheet: Pick<BeatSheet, 'acts'>,
	actId: string,
	direction: 'up' | 'down',
): { beforeActId: string | null } | null {
	const index = sheet.acts.findIndex((act) => act.id === actId);
	if (index === -1) return null;
	if (direction === 'up') return index === 0 ? null : { beforeActId: sheet.acts[index - 1]!.id };
	return index >= sheet.acts.length - 1 ? null : { beforeActId: sheet.acts[index + 2]?.id ?? null };
}

/** What a template keeps of a sheet: its acts' labels and its beats' names and descriptions, and nothing written under them. */
export function beatSheetStructureOf(sheet: Pick<BeatSheet, 'acts'>): BeatSheetStructure {
	return {
		acts: sheet.acts.map((act) => ({
			label: act.label,
			beats: act.beats.map((beat) => ({ name: beat.name, description: beat.description })),
		})),
	};
}

/** A sheet made from a structure, every act and beat under an id of its own from the mint handed in. */
export function beatSheetFromStructure(
	draft: { id: string; name: string; structure: BeatSheetStructure; now: number },
	mint: (kind: 'act' | 'beat') => string,
): BeatSheet {
	return {
		id: draft.id,
		name: draft.name,
		acts: draft.structure.acts.map((act) => ({
			id: mint('act'),
			label: act.label,
			beats: act.beats.map((beat) => ({
				id: mint('beat'),
				name: beat.name,
				description: beat.description,
				rows: [],
			})),
		})),
		presentation: null,
		showSubDescriptions: true,
		reversed: false,
		createdAt: draft.now,
		updatedAt: draft.now,
	};
}

/** The template a name would land on: the first whose name reads the same once folded. */
export function beatSheetTemplateNamesake(
	held: Pick<BeatSheetDocument, 'templates'>,
	name: string,
): BeatSheetTemplate | undefined {
	const folded = foldName(name);
	if (folded.length === 0) return undefined;
	return held.templates.find((template) => foldName(template.name) === folded);
}

// --- mutations -------------------------------------------------------------

function replaceSheet(
	held: BeatSheetDocument,
	id: string,
	change: (sheet: BeatSheet) => BeatSheet | null,
	now: number,
): BeatSheetDocument | null {
	const sheet = findBeatSheet(held, id);
	if (sheet === undefined) return null;
	const next = change(sheet);
	if (next === null) return null;
	const stamped: BeatSheet = { ...next, updatedAt: now };
	return {
		...held,
		sheets: held.sheets.map((candidate) => (candidate === sheet ? stamped : candidate)),
	};
}

/** The sheet with one act changed; the act handed back unchanged leaves the sheet as it was. */
function withAct(sheet: BeatSheet, actId: string, change: (act: BeatSheetAct) => BeatSheetAct): BeatSheet {
	let changed = false;
	const acts = sheet.acts.map((act) => {
		if (act.id !== actId) return act;
		const next = change(act);
		if (next !== act) changed = true;
		return next;
	});
	return changed ? { ...sheet, acts } : sheet;
}

/** The sheet with one beat changed, wherever it stands. */
function withBeat(sheet: BeatSheet, beatId: string, change: (beat: Beat) => Beat): BeatSheet {
	const place = findBeat(sheet, beatId);
	if (place === null) return sheet;
	return withAct(sheet, place.act.id, (act) => {
		const next = change(place.beat);
		return next === place.beat ? act : { ...act, beats: act.beats.map((beat) => (beat === place.beat ? next : beat)) };
	});
}

/** The sheet with every placement of the scenes named taken out, or itself when none stood. */
function withoutScenes(sheet: BeatSheet, sceneIds: ReadonlySet<string>): BeatSheet {
	if (sceneIds.size === 0) return sheet;
	let changed = false;
	const acts = sheet.acts.map((act) => {
		let actTouched = false;
		const beats = act.beats.map((beat) => {
			if (!beat.rows.some((row) => row.scenes.some((sceneId) => sceneIds.has(sceneId)))) return beat;
			actTouched = true;
			return {
				...beat,
				rows: beat.rows.map((row) =>
					row.scenes.some((sceneId) => sceneIds.has(sceneId))
						? { ...row, scenes: row.scenes.filter((sceneId) => !sceneIds.has(sceneId)) }
						: row),
			};
		});
		if (!actTouched) return act;
		changed = true;
		return { ...act, beats };
	});
	return changed ? { ...sheet, acts } : sheet;
}

/**
 * Appends a sheet and makes it the one opened last, since a sheet just made
 * is the one the author is looking at. Read through the sheet's own reader on
 * the way in, so what is kept is what a later read would serve. Null when its
 * id already stands, or it would not read.
 */
export function createBeatSheet(held: BeatSheetDocument, sheet: BeatSheet): BeatSheetDocument | null {
	if (findBeatSheet(held, sheet.id) !== undefined) return null;
	const read = readBeatSheet(sheet);
	if (read === null) return null;
	return { ...held, sheets: [...held.sheets, read], lastSheetId: read.id };
}

export function renameBeatSheet(
	held: BeatSheetDocument,
	id: string,
	name: string,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, id, (sheet) => (sheet.name === name ? null : { ...sheet, name }), now);
}

/** Takes a sheet out, with everything under it and the memory of it as the last one opened; the scenes stand. */
export function deleteBeatSheet(held: BeatSheetDocument, id: string): BeatSheetDocument | null {
	if (findBeatSheet(held, id) === undefined) return null;
	return {
		...held,
		sheets: held.sheets.filter((sheet) => sheet.id !== id),
		lastSheetId: held.lastSheetId === id ? null : held.lastSheetId,
		strays: {
			// Only a stray a reader can make sense of could stand in the deleted
			// one's place on the next read, so only such a twin goes with it.
			...held.strays,
			sheets: held.strays.sheets.filter((entry) => readBeatSheet(entry)?.id !== id),
		},
	};
}

/** Remembers the sheet opened last, or none; null when nothing moves or the id names no sheet. */
export function setLastBeatSheet(held: BeatSheetDocument, id: string | null): BeatSheetDocument | null {
	if (id !== null && findBeatSheet(held, id) === undefined) return null;
	if (held.lastSheetId === id) return null;
	return { ...held, lastSheetId: id };
}

export function setBeatSheetPresentation(
	held: BeatSheetDocument,
	sheetId: string,
	presentation: ScenePresentation | null,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) =>
		sheet.presentation === presentation ? null : { ...sheet, presentation }, now);
}

/** Shows the rows' words on the sheet, or keeps them away. */
export function setBeatSheetSubDescriptions(
	held: BeatSheetDocument,
	sheetId: string,
	shown: boolean,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) =>
		sheet.showSubDescriptions === shown ? null : { ...sheet, showSubDescriptions: shown }, now);
}

/** Shows the sheet from its end, or from its beginning again; the order the sheet keeps is left as it is. */
export function setBeatSheetReversed(
	held: BeatSheetDocument,
	sheetId: string,
	reversed: boolean,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) =>
		sheet.reversed === reversed ? null : { ...sheet, reversed }, now);
}

/** A new act with no beats yet, before another or at the end; null when its id already stands in the sheet. */
export function addBeatSheetAct(
	held: BeatSheetDocument,
	sheetId: string,
	act: { id: string; label: string },
	beforeActId: string | null,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) =>
		findBeatSheetAct(sheet, act.id) !== undefined
			? null
			: { ...sheet, acts: insertedBefore(sheet.acts, { id: act.id, label: act.label, beats: [] }, beforeActId) }, now);
}

export function relabelBeatSheetAct(
	held: BeatSheetDocument,
	sheetId: string,
	actId: string,
	label: string,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		const next = withAct(sheet, actId, (act) => (act.label === label ? act : { ...act, label }));
		return next === sheet ? null : next;
	}, now);
}

/** An act moved, with all under it, in front of another or to the end; its number follows its place. */
export function moveBeatSheetAct(
	held: BeatSheetDocument,
	sheetId: string,
	actId: string,
	beforeActId: string | null,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		const order = movedBefore(sheet.acts.map((act) => act.id), actId, beforeActId);
		if (order === null) return null;
		return { ...sheet, acts: order.map((id) => findBeatSheetAct(sheet, id)!) };
	}, now);
}

/** An act leaves the sheet with its beats, their rows and their placements; the scenes are simply unplaced. */
export function deleteBeatSheetAct(
	held: BeatSheetDocument,
	sheetId: string,
	actId: string,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) =>
		findBeatSheetAct(sheet, actId) === undefined
			? null
			: { ...sheet, acts: sheet.acts.filter((act) => act.id !== actId) }, now);
}

/**
 * A new beat in an act, before another of its beats or at the end. Null when
 * the act is not the sheet's, or the beat's id already stands anywhere in it.
 */
export function addBeat(
	held: BeatSheetDocument,
	sheetId: string,
	actId: string,
	beat: { id: string; name: string; description: string },
	beforeBeatId: string | null,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		if (findBeatSheetAct(sheet, actId) === undefined || findBeat(sheet, beat.id) !== null) return null;
		return withAct(sheet, actId, (act) => ({
			...act,
			beats: insertedBefore(act.beats, { id: beat.id, name: beat.name, description: beat.description, rows: [] }, beforeBeatId),
		}));
	}, now);
}

/** A beat's name, its description, or both; what is not named is left as it stands. */
export function editBeat(
	held: BeatSheetDocument,
	sheetId: string,
	beatId: string,
	change: { name?: string; description?: string },
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		const next = withBeat(sheet, beatId, (beat) => {
			const name = change.name ?? beat.name;
			const description = change.description ?? beat.description;
			return name === beat.name && description === beat.description ? beat : { ...beat, name, description };
		});
		return next === sheet ? null : next;
	}, now);
}

/**
 * A beat moved, with its rows and their scenes, into an act before another
 * of that act's beats, or to the act's end when no anchor is named or the one
 * named is not among them: one call for a drag, a step up or down across an
 * act's edge, and a move to another act. Null when the beat or the act is not
 * the sheet's, or the beat already stands exactly there.
 */
export function moveBeat(
	held: BeatSheetDocument,
	sheetId: string,
	beatId: string,
	toActId: string,
	beforeBeatId: string | null,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		const place = findBeat(sheet, beatId);
		if (place === null || findBeatSheetAct(sheet, toActId) === undefined || beforeBeatId === beatId) return null;
		const acts = sheet.acts.map((act) => {
			const rest = act === place.act ? act.beats.filter((beat) => beat !== place.beat) : act.beats;
			if (act.id !== toActId) return rest === act.beats ? act : { ...act, beats: rest };
			return { ...act, beats: insertedBefore(rest, place.beat, beforeBeatId) };
		});
		const unmoved = acts.every((act, index) =>
			sameIds(act.beats.map((beat) => beat.id), sheet.acts[index]!.beats.map((beat) => beat.id)));
		return unmoved ? null : { ...sheet, acts };
	}, now);
}

/** A beat leaves the sheet with its rows; their scenes are simply unplaced. */
export function deleteBeat(
	held: BeatSheetDocument,
	sheetId: string,
	beatId: string,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		const place = findBeat(sheet, beatId);
		if (place === null) return null;
		return withAct(sheet, place.act.id, (act) => ({ ...act, beats: act.beats.filter((beat) => beat !== place.beat) }));
	}, now);
}

/**
 * A new row under a beat, before a neighbour or at the end. The beat must
 * stand: unlike a time, which is a note a timeline may name again, a beat
 * that has gone has nothing to come back as. The row's id must be new to the
 * sheet, and scenes placed on the way lose any earlier place on it.
 */
export function addBeatRow(
	held: BeatSheetDocument,
	sheetId: string,
	beatId: string,
	row: { id: string; text: string; scenes?: readonly string[] },
	beforeRowId: string | null,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		if (findBeat(sheet, beatId) === null || findBeatRow(sheet, row.id) !== null) return null;
		const scenes = uniqueIds(row.scenes ?? []);
		const cleared = withoutScenes(sheet, new Set(scenes));
		return withBeat(cleared, beatId, (beat) => ({
			...beat,
			rows: insertedBefore(beat.rows, { id: row.id, text: row.text, scenes }, beforeRowId),
		}));
	}, now);
}

export function editBeatRow(
	held: BeatSheetDocument,
	sheetId: string,
	rowId: string,
	text: string,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		const place = findBeatRow(sheet, rowId);
		if (place === null || place.row.text === text) return null;
		return withBeat(sheet, place.beat.id, (beat) => ({
			...beat,
			rows: beat.rows.map((row) => (row === place.row ? { ...row, text } : row)),
		}));
	}, now);
}

/**
 * A row moved, with its scenes, before a neighbour under a beat of the same
 * sheet, or to that beat's end. Null when the row or the beat is not the
 * sheet's, or the row already stands exactly there.
 */
export function moveBeatRow(
	held: BeatSheetDocument,
	sheetId: string,
	rowId: string,
	toBeatId: string,
	beforeRowId: string | null,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		const place = findBeatRow(sheet, rowId);
		if (place === null || findBeat(sheet, toBeatId) === null || beforeRowId === rowId) return null;
		const taken = withBeat(sheet, place.beat.id, (beat) => ({ ...beat, rows: beat.rows.filter((row) => row !== place.row) }));
		const next = withBeat(taken, toBeatId, (beat) => ({ ...beat, rows: insertedBefore(beat.rows, place.row, beforeRowId) }));
		const landed = findBeat(next, toBeatId)!.beat.rows;
		const unmoved = place.beat.id === toBeatId && sameIds(landed.map((row) => row.id), place.beat.rows.map((row) => row.id));
		return unmoved ? null : next;
	}, now);
}

/** A row leaves the sheet; its scenes are simply unplaced. */
export function deleteBeatRow(
	held: BeatSheetDocument,
	sheetId: string,
	rowId: string,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		const place = findBeatRow(sheet, rowId);
		if (place === null) return null;
		return withBeat(sheet, place.beat.id, (beat) => ({ ...beat, rows: beat.rows.filter((row) => row !== place.row) }));
	}, now);
}

/**
 * A scene placed on a row, before another scene of that row or at its end,
 * any earlier place on this sheet given up first: a scene stands once on a
 * sheet, and moving it is where it stands changing. Null when the row is not
 * the sheet's, or the scene already stands exactly there.
 */
export function placeBeatScene(
	held: BeatSheetDocument,
	sheetId: string,
	sceneId: string,
	rowId: string,
	beforeSceneId: string | null,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		const before = findBeatRow(sheet, rowId);
		if (before === null) return null;
		const cleared = withoutScenes(sheet, new Set([sceneId]));
		const place = findBeatRow(cleared, rowId);
		if (place === null) return null;
		const scenes = scenesWith(place.row.scenes, sceneId, beforeSceneId);
		if (sameIds(before.row.scenes, scenes)) return null;
		return withBeat(cleared, place.beat.id, (beat) => ({
			...beat,
			rows: beat.rows.map((row) => (row === place.row ? { ...row, scenes } : row)),
		}));
	}, now);
}

/** A scene's place on the sheet given up; the scene itself is untouched. */
export function removeBeatScene(
	held: BeatSheetDocument,
	sheetId: string,
	sceneId: string,
	now: number,
): BeatSheetDocument | null {
	return replaceSheet(held, sheetId, (sheet) => {
		const cleared = withoutScenes(sheet, new Set([sceneId]));
		return cleared === sheet ? null : cleared;
	}, now);
}

const sameStructure = (left: BeatSheetStructure, right: BeatSheetStructure): boolean =>
	left.acts.length === right.acts.length &&
	left.acts.every((act, index) => {
		const other = right.acts[index]!;
		return (
			act.label === other.label &&
			act.beats.length === other.beats.length &&
			act.beats.every((beat, at) => beat.name === other.beats[at]!.name && beat.description === other.beats[at]!.description)
		);
	});

/**
 * A structure kept under a name. A namesake, by folded name, is replaced
 * where it stands and keeps its id and the day it was made, taking the name
 * as typed, the description and the new acts; with no namesake the template
 * is appended under the id handed in. Null for a blank name, an id that
 * already stands under another name, or a save that would change nothing.
 */
export function saveBeatSheetTemplate(
	held: BeatSheetDocument,
	draft: { id: string; name: string; description: string; structure: BeatSheetStructure },
	now: number,
): BeatSheetDocument | null {
	const name = draft.name.trim();
	if (name.length === 0) return null;
	const acts = readStructureActs(draft.structure.acts);
	const namesake = beatSheetTemplateNamesake(held, name);
	if (namesake !== undefined) {
		if (namesake.name === name && namesake.description === draft.description && sameStructure(namesake, { acts })) {
			return null;
		}
		const replaced: BeatSheetTemplate = { ...namesake, name, description: draft.description, acts, updatedAt: now };
		return { ...held, templates: held.templates.map((template) => (template === namesake ? replaced : template)) };
	}
	if (findBeatSheetTemplate(held, draft.id) !== undefined) return null;
	return {
		...held,
		templates: [
			...held.templates,
			{ id: draft.id, name, description: draft.description, acts, createdAt: now, updatedAt: now },
		],
	};
}

/** Takes a template out; the sheets made from it stand, since they took its words and not its name. */
export function deleteBeatSheetTemplate(held: BeatSheetDocument, id: string): BeatSheetDocument | null {
	if (findBeatSheetTemplate(held, id) === undefined) return null;
	return {
		...held,
		templates: held.templates.filter((template) => template.id !== id),
		strays: {
			...held.strays,
			templates: held.strays.templates.filter((entry) => readBeatSheetTemplate(entry)?.id !== id),
		},
	};
}

