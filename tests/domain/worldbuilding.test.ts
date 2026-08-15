import { describe, expect, it } from 'vitest';

import {
	CHARACTER_DETAILS_PROPERTIES,
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
	templateSectionsForDocument,
} from '../../src/domain';

describe('worldbuilding kinds', () => {
	it('registers the built-in kinds with their specific fields', () => {
		expect(WORLDBUILDING_KINDS).toEqual(['time', 'location', 'item']);
		expect(WORLDBUILDING_KIND_DEFINITIONS.time.timeFields).toBe(true);
		expect(WORLDBUILDING_KIND_DEFINITIONS.location.timeFields).toBe(false);
		expect(WORLDBUILDING_KIND_DEFINITIONS.item.detailsProperties).toEqual([
			'owner',
		]);
		expect(CHARACTER_DETAILS_PROPERTIES).toEqual(['age']);
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
		for (const kind of ['point', 'period', 'event']) {
			expect(isTimeKind(kind)).toBe(true);
		}
		expect(isTimeKind('era')).toBe(false);
	});
});

describe('schema acceptance', () => {
	it('writes 2 and still accepts 1', () => {
		expect(SCHEMA_VERSION).toBe(2);
		expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe(1);
		expect(isWritableSchemaVersion(1)).toBe(true);
		expect(isWritableSchemaVersion(2)).toBe(true);
		expect(isWritableSchemaVersion(0)).toBe(false);
		expect(isWritableSchemaVersion(3)).toBe(false);
		expect(isWritableSchemaVersion(null)).toBe(false);
	});
});

describe('record sections', () => {
	it('keeps records protected but never generated', () => {
		for (const id of ['details', 'world-status', 'relationships']) {
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
			expect(template).not.toContain('details');
			expect(template).not.toContain('world-status');
			expect(template).not.toContain('relationships');
		}
		expect(
			templateSectionsForDocument('worldbuilding').map((section) => section.id),
		).toEqual(['entity-fields', 'entity-notes']);
		expect(
			MANAGED_SECTIONS_BY_DOCUMENT.worldbuilding.map((section) => section.id),
		).toEqual([
			'entity-fields',
			'details',
			'world-status',
			'relationships',
			'entity-notes',
		]);
	});
});
