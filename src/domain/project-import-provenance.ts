/**
 * Where a project's imported parts came from: one entry per part brought
 * over from another Snowflake project, with the source it was copied from
 * and two fingerprints, the source part's design as it stood at the copy
 * and the copy's as written. A later run reads them back to tell a part the
 * source has changed since from one the author has edited here, which is
 * what lets a book take its series' changes without writing over its own.
 *
 * Kept in the project's own folder as one JSON document, the way the
 * timeline and the beat sheet are kept, under the import store. Pure here:
 * readers that take a stored shape leniently and carry what they cannot
 * read, and mutations that answer a new document.
 */

import { IMPORT_PART_KINDS, type ImportPartKind } from './project-import-kinds';

export type ImportClashPolicy = 'skip' | 'replace';

export interface ImportProvenanceEntry {
	readonly kind: ImportPartKind;
	/** The copy's id here, where its kind has one; null for a step, a node, a template, a picture or a chapter. */
	readonly targetId: string | null;
	/** The copy's vault path here, where its kind has one; null for a record kept in a document. */
	readonly targetPath: string | null;
	/** What the copy is called here, so a part gone from its source can still be named. */
	readonly targetName: string;
	readonly sourceProjectId: string;
	/** The part's id in its source: a note's id, a step number, a node's `kind/vocabulary/taxonomy`, a template's name, a file's path. */
	readonly sourceId: string;
	readonly sourcePath: string | null;
	/** The fingerprint of the source part's design projection at the copy. */
	readonly sourceHash: string;
	/** The fingerprint of the copy's design projection as written. */
	readonly copyHash: string;
	readonly importedAt: number;
}

/** What the author ticked the last time they imported from one source, so the dialog can open the same way. */
export interface ImportChoices {
	readonly parts: readonly string[];
	readonly clashPolicy: ImportClashPolicy;
	readonly at: number;
}

export interface ImportProvenanceDocument {
	readonly entries: readonly ImportProvenanceEntry[];
	/** By source project id. */
	readonly lastChoices: Readonly<Record<string, ImportChoices>>;
	/** Entries this build could not read, re-emitted after the readable ones on every write. */
	readonly strays: {
		readonly entries: readonly unknown[];
		readonly choices: Readonly<Record<string, unknown>>;
	};
}

export function emptyImportProvenanceDocument(): ImportProvenanceDocument {
	return { entries: [], lastChoices: {}, strays: { entries: [], choices: {} } };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const isImportPartKind = (value: unknown): value is ImportPartKind =>
	(IMPORT_PART_KINDS as readonly unknown[]).includes(value);
const isClashPolicy = (value: unknown): value is ImportClashPolicy => value === 'skip' || value === 'replace';

/** One stored entry read leniently; null where it is not an entry at all. */
export function readImportProvenanceEntry(value: unknown): ImportProvenanceEntry | null {
	if (!isRecord(value)) return null;
	if (!isImportPartKind(value.kind)) return null;
	if (!nonEmptyString(value.sourceProjectId) || !nonEmptyString(value.sourceId)) return null;
	if (typeof value.sourceHash !== 'string' || typeof value.copyHash !== 'string') return null;
	if (typeof value.importedAt !== 'number' || !Number.isFinite(value.importedAt)) return null;
	return {
		kind: value.kind,
		targetId: stringOrNull(value.targetId),
		targetPath: stringOrNull(value.targetPath),
		targetName: typeof value.targetName === 'string' ? value.targetName : '',
		sourceProjectId: value.sourceProjectId,
		sourceId: value.sourceId,
		sourcePath: stringOrNull(value.sourcePath),
		sourceHash: value.sourceHash,
		copyHash: value.copyHash,
		importedAt: value.importedAt,
	};
}

export function readImportChoices(value: unknown): ImportChoices | null {
	if (!isRecord(value)) return null;
	if (!Array.isArray(value.parts) || !value.parts.every((part) => typeof part === 'string')) return null;
	if (!isClashPolicy(value.clashPolicy)) return null;
	if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return null;
	return { parts: [...value.parts], clashPolicy: value.clashPolicy, at: value.at };
}

/** The document a file holds, every readable entry kept and the rest carried; null where the file is not this document. */
export function readImportProvenanceDocument(file: Record<string, unknown>): ImportProvenanceDocument | null {
	if (!Array.isArray(file.entries)) return null;
	const entries: ImportProvenanceEntry[] = [];
	const strayEntries: unknown[] = [];
	for (const raw of file.entries) {
		const entry = readImportProvenanceEntry(raw);
		if (entry === null) strayEntries.push(raw);
		else entries.push(entry);
	}
	const lastChoices: Record<string, ImportChoices> = {};
	const strayChoices: Record<string, unknown> = {};
	if (isRecord(file.lastChoices)) {
		for (const [sourceProjectId, raw] of Object.entries(file.lastChoices)) {
			const choices = readImportChoices(raw);
			if (choices === null) strayChoices[sourceProjectId] = raw;
			else lastChoices[sourceProjectId] = choices;
		}
	}
	return { entries, lastChoices, strays: { entries: strayEntries, choices: strayChoices } };
}

export function serializeImportProvenanceDocument(held: ImportProvenanceDocument): Record<string, unknown> {
	return {
		entries: [...held.entries, ...held.strays.entries],
		lastChoices: { ...held.strays.choices, ...held.lastChoices },
	};
}

/** The key an entry stands under: one copy per source part, whatever run brought it. */
export function provenanceKey(entry: Pick<ImportProvenanceEntry, 'sourceProjectId' | 'kind' | 'sourceId'>): string {
	return `${entry.sourceProjectId}\u0000${entry.kind}\u0000${entry.sourceId}`;
}

/** The entries from one source, by `kind:sourceId`. */
export function provenanceFrom(
	held: ImportProvenanceDocument,
	sourceProjectId: string,
): ReadonlyMap<string, ImportProvenanceEntry> {
	const found = new Map<string, ImportProvenanceEntry>();
	for (const entry of held.entries) {
		if (entry.sourceProjectId !== sourceProjectId) continue;
		found.set(`${entry.kind}:${entry.sourceId}`, entry);
	}
	return found;
}

/**
 * Records what a run landed: an entry for a part already recorded from the
 * same source replaces it where it stands, and the rest are appended in the
 * order given. Null where nothing is given.
 */
export function recordImports(
	held: ImportProvenanceDocument,
	entries: readonly ImportProvenanceEntry[],
): ImportProvenanceDocument | null {
	if (entries.length === 0) return null;
	const replacing = new Map(entries.map((entry) => [provenanceKey(entry), entry] as const));
	const kept = held.entries.map((entry) => {
		const next = replacing.get(provenanceKey(entry));
		if (next === undefined) return entry;
		replacing.delete(provenanceKey(entry));
		return next;
	});
	const appended = entries.filter((entry) => replacing.has(provenanceKey(entry)));
	// Two entries for one part in the same run: the last word wins, as a replace would.
	const seen = new Set<string>();
	const deduped: ImportProvenanceEntry[] = [];
	for (const entry of [...appended].reverse()) {
		if (seen.has(provenanceKey(entry))) continue;
		seen.add(provenanceKey(entry));
		deduped.unshift(entry);
	}
	return { ...held, entries: [...kept, ...deduped] };
}

/** Lets go of every entry whose copy no longer stands here, as a reader finds them. */
export function forgetImports(
	held: ImportProvenanceDocument,
	gone: (entry: ImportProvenanceEntry) => boolean,
): ImportProvenanceDocument | null {
	const entries = held.entries.filter((entry) => !gone(entry));
	return entries.length === held.entries.length ? null : { ...held, entries };
}

export function rememberChoices(
	held: ImportProvenanceDocument,
	sourceProjectId: string,
	choices: ImportChoices,
): ImportProvenanceDocument {
	return { ...held, lastChoices: { ...held.lastChoices, [sourceProjectId]: choices } };
}
