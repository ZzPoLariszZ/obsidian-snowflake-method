import { describe, expect, it } from 'vitest';

import {
	emptyImportProvenanceDocument,
	forgetImports,
	provenanceFrom,
	provenanceKey,
	readImportChoices,
	readImportProvenanceDocument,
	readImportProvenanceEntry,
	recordImports,
	rememberChoices,
	serializeImportProvenanceDocument,
	type ImportProvenanceEntry,
} from '../../src/domain';

const entry = (overrides: Partial<ImportProvenanceEntry> = {}): ImportProvenanceEntry => ({
	kind: 'character',
	targetId: 'character-copy',
	targetPath: 'Snowflake Projects/Book 2/30_Character/Alice.md',
	targetName: 'Alice',
	sourceProjectId: 'project-book-1',
	sourceId: 'character-source',
	sourcePath: 'Snowflake Projects/Book 1/30_Character/Alice.md',
	sourceHash: 'fp1-source',
	copyHash: 'fp1-copy',
	importedAt: 1000,
	...overrides,
});

describe('reading provenance', () => {
	it('round-trips a document through its stored form', () => {
		const held = rememberChoices(
			recordImports(emptyImportProvenanceDocument(), [
				entry(),
				entry({ kind: 'vocabulary', targetId: null, sourceId: 'character/category/Houses', targetName: 'Houses' }),
			]) ?? emptyImportProvenanceDocument(),
			'project-book-1',
			{ parts: ['character:character-source'], clashPolicy: 'skip', at: 2000 },
		);
		const stored = serializeImportProvenanceDocument(held);
		expect(Object.keys(stored)).toEqual(['entries', 'lastChoices']);
		expect(readImportProvenanceDocument(stored)).toEqual(held);
	});

	it('reads an entry leniently and refuses what is not one', () => {
		expect(readImportProvenanceEntry(entry())).toEqual(entry());
		expect(readImportProvenanceEntry({ ...entry(), targetName: undefined, sourcePath: 7 })).toEqual(
			entry({ targetName: '', sourcePath: null }),
		);
		expect(readImportProvenanceEntry({ ...entry(), kind: 'poem' })).toBeNull();
		expect(readImportProvenanceEntry({ ...entry(), sourceId: '' })).toBeNull();
		expect(readImportProvenanceEntry({ ...entry(), importedAt: 'yesterday' })).toBeNull();
		expect(readImportProvenanceEntry('entry')).toBeNull();
	});

	it('reads choices and refuses a policy it does not know', () => {
		expect(readImportChoices({ parts: ['a', 'b'], clashPolicy: 'replace', at: 5 })).toEqual({
			parts: ['a', 'b'],
			clashPolicy: 'replace',
			at: 5,
		});
		expect(readImportChoices({ parts: ['a', 2], clashPolicy: 'replace', at: 5 })).toBeNull();
		expect(readImportChoices({ parts: [], clashPolicy: 'merge', at: 5 })).toBeNull();
	});

	it('carries entries and choices it cannot read through a write, after the readable ones', () => {
		const held = readImportProvenanceDocument({
			entries: [{ kind: 'later-kind', sourceProjectId: 'p', sourceId: 'x' }, entry()],
			lastChoices: { 'project-book-1': { parts: 'all' }, 'project-book-3': { parts: [], clashPolicy: 'skip', at: 1 } },
		});
		expect(held).not.toBeNull();
		expect(held?.entries).toEqual([entry()]);
		expect(held?.strays.entries).toEqual([{ kind: 'later-kind', sourceProjectId: 'p', sourceId: 'x' }]);
		expect(held?.strays.choices).toEqual({ 'project-book-1': { parts: 'all' } });
		expect(Object.keys(held?.lastChoices ?? {})).toEqual(['project-book-3']);
		const stored = serializeImportProvenanceDocument(held ?? emptyImportProvenanceDocument());
		expect(stored.entries).toEqual([entry(), { kind: 'later-kind', sourceProjectId: 'p', sourceId: 'x' }]);
		expect(Object.keys(stored.lastChoices as Record<string, unknown>)).toEqual(['project-book-1', 'project-book-3']);
	});

	it('is not this document without an entries list', () => {
		expect(readImportProvenanceDocument({ sheets: [] })).toBeNull();
	});
});

describe('recording imports', () => {
	it('replaces the entry of a part already recorded from the same source and appends the rest', () => {
		const first = recordImports(emptyImportProvenanceDocument(), [entry(), entry({ sourceId: 'character-b', targetId: 'copy-b' })]);
		expect(first?.entries.map((held) => held.sourceId)).toEqual(['character-source', 'character-b']);
		const second = recordImports(first ?? emptyImportProvenanceDocument(), [
			entry({ sourceHash: 'fp1-later', importedAt: 3000 }),
			entry({ sourceId: 'character-c', targetId: 'copy-c' }),
		]);
		expect(second?.entries.map((held) => [held.sourceId, held.sourceHash])).toEqual([
			['character-source', 'fp1-later'],
			['character-b', 'fp1-source'],
			['character-c', 'fp1-source'],
		]);
	});

	it('keeps one entry per part when a run names it twice, the last word winning', () => {
		const held = recordImports(emptyImportProvenanceDocument(), [entry({ copyHash: 'a' }), entry({ copyHash: 'b' })]);
		expect(held?.entries).toHaveLength(1);
		expect(held?.entries[0]?.copyHash).toBe('b');
	});

	it('answers null for nothing to record and for nothing to forget', () => {
		const held = recordImports(emptyImportProvenanceDocument(), [entry()]) ?? emptyImportProvenanceDocument();
		expect(recordImports(held, [])).toBeNull();
		expect(forgetImports(held, () => false)).toBeNull();
		expect(forgetImports(held, (candidate) => candidate.targetId === 'character-copy')?.entries).toEqual([]);
	});

	it('keys an entry by source project, kind and source id, and lists one source at a time', () => {
		expect(provenanceKey(entry())).toBe('project-book-1\u0000character\u0000character-source');
		const held =
			recordImports(emptyImportProvenanceDocument(), [
				entry(),
				entry({ sourceProjectId: 'project-book-3', sourceId: 'character-elsewhere' }),
			]) ?? emptyImportProvenanceDocument();
		expect([...provenanceFrom(held, 'project-book-1').keys()]).toEqual(['character:character-source']);
		expect(provenanceFrom(held, 'project-book-9').size).toBe(0);
	});
});
