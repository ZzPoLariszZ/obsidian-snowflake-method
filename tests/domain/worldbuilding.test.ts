import { describe, expect, it } from 'vitest';

import {
	CUSTOM_KIND_PREFIXES,
	GENERATED_SECTION_IDS,
	MANAGED_SECTIONS_BY_DOCUMENT,
	MIN_SUPPORTED_SCHEMA_VERSION,
	PROTECTED_SECTION_IDS,
	SCHEMA_VERSION,
	WORLDBUILDING_KINDS,
	WORLDBUILDING_KIND_DEFINITIONS,
	isProgressStatus,
	isTimeKind,
	isWorldbuildingKind,
	isWritableSchemaVersion,
	kindIdFromFolderName,
	nextCustomKindPrefix,
	templateSectionsForDocument,
	type ProjectWorldbuildingKind,
} from '../../src/domain';

describe('worldbuilding kinds', () => {
	it('registers the built-in kinds with their specific fields', () => {
		expect(WORLDBUILDING_KINDS).toEqual(['time', 'location', 'item']);
		expect(WORLDBUILDING_KIND_DEFINITIONS.time.timeFields).toBe(true);
		expect(WORLDBUILDING_KIND_DEFINITIONS.location.timeFields).toBe(false);
		for (const kind of WORLDBUILDING_KINDS) {
			expect(isWorldbuildingKind(kind)).toBe(true);
		}
		expect(isWorldbuildingKind('character')).toBe(false);
	});

	it('accepts only the entity progress vocabulary and time kinds', () => {
		for (const status of [
			'not-started',
			'in-progress',
			'in-revision',
			'complete',
		]) {
			expect(isProgressStatus(status)).toBe(true);
		}
		expect(isProgressStatus('skipped')).toBe(false);
		for (const kind of ['point', 'period']) {
			expect(isTimeKind(kind)).toBe(true);
		}
		// A time note is a moment or the stretch between two of them.
		expect(isTimeKind('event')).toBe(false);
		expect(isTimeKind('era')).toBe(false);
	});
});

describe('schema acceptance', () => {
	it('writes 3 and still accepts 1', () => {
		expect(SCHEMA_VERSION).toBe(3);
		expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe(1);
		expect(isWritableSchemaVersion(1)).toBe(true);
		expect(isWritableSchemaVersion(2)).toBe(true);
		expect(isWritableSchemaVersion(3)).toBe(true);
		expect(isWritableSchemaVersion(0)).toBe(false);
		expect(isWritableSchemaVersion(4)).toBe(false);
		expect(isWritableSchemaVersion(null)).toBe(false);
	});
});

describe('record sections', () => {
	it('keeps records protected but never generated', () => {
		for (const id of ['world-status', 'relationships']) {
			expect(PROTECTED_SECTION_IDS.has(id)).toBe(true);
			expect(GENERATED_SECTION_IDS.has(id)).toBe(false);
		}
		for (const id of GENERATED_SECTION_IDS) {
			expect(PROTECTED_SECTION_IDS.has(id)).toBe(true);
		}
	});

	it('defers record sections out of fresh notes for every member type', () => {
		for (const documentType of ['character', 'scene', 'worldbuilding'] as const) {
			const template = templateSectionsForDocument(documentType).map(
				(section) => section.id,
			);
			expect(template).not.toContain('world-status');
			expect(template).not.toContain('relationships');
			expect(template).not.toContain('custom-fields');
		}
		expect(
			templateSectionsForDocument('worldbuilding').map((section) => section.id),
		).toEqual(['entity-fields', 'entity-notes']);
		expect(
			MANAGED_SECTIONS_BY_DOCUMENT.worldbuilding.map((section) => section.id),
		).toEqual([
			'entity-fields',
			'world-status',
			'relationships',
			'entity-notes',
			'custom-fields',
		]);
	});

	it('has no details section left to register', () => {
		// The built-in properties it held are gone: the age from a character,
		// the owner from an item. What a note records now is all taxonomy.
		for (const sections of Object.values(MANAGED_SECTIONS_BY_DOCUMENT)) {
			expect(sections.map((section) => section.id)).not.toContain('details');
		}
	});
});

/**
 * Custom kind folders run 64 through 69, then 6A through 6Z, and stop: the
 * family never spills into 70, where other top-level folders live.
 */
describe('custom kind prefixes', () => {
	const custom = (folderName: string): ProjectWorldbuildingKind => ({
		id: kindIdFromFolderName(folderName),
		folderName,
		custom: true,
		missingFolder: false,
		icon: null,
		description: null,
	});

	it('runs six digits and the alphabet, thirty-two slots in all', () => {
		expect(CUSTOM_KIND_PREFIXES).toHaveLength(32);
		expect(CUSTOM_KIND_PREFIXES[0]).toBe('64');
		expect(CUSTOM_KIND_PREFIXES[5]).toBe('69');
		expect(CUSTOM_KIND_PREFIXES[6]).toBe('6A');
		expect(CUSTOM_KIND_PREFIXES[31]).toBe('6Z');
	});

	it('fills the first free slot, a retired one included', () => {
		expect(nextCustomKindPrefix([])).toBe('64');
		expect(nextCustomKindPrefix([custom('64_Faction')])).toBe('65');
		// A deleted kind frees its slot: 64 comes back before anything new.
		expect(
			nextCustomKindPrefix([custom('65_Guild'), custom('66_Order')]),
		).toBe('64');
	});

	it('crosses from 69 to 6A rather than into 70', () => {
		const digits = ['64', '65', '66', '67', '68', '69'];
		expect(
			nextCustomKindPrefix(digits.map((prefix) => custom(`${prefix}_K`))),
		).toBe('6A');
	});

	it('hands out 6Z itself, and refuses only a full run', () => {
		const allButLast = CUSTOM_KIND_PREFIXES.slice(0, -1).map((prefix) =>
			custom(`${prefix}_K`),
		);
		expect(nextCustomKindPrefix(allButLast)).toBe('6Z');
		expect(
			nextCustomKindPrefix([...allButLast, custom('6Z_K')]),
		).toBeNull();
	});

	it('reads the id from behind a lettered prefix', () => {
		expect(kindIdFromFolderName('6A_Faction')).toBe('Faction');
		expect(kindIdFromFolderName('64_Faction')).toBe('Faction');
	});
});
