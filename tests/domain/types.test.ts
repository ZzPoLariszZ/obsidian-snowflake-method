import { describe, expect, it } from 'vitest';

import { DOCUMENT_TYPES, isDocumentType } from '../../src/domain';

describe('document types', () => {
	it('exposes the complete document type set', () => {
		expect(DOCUMENT_TYPES).toEqual([
			'project-metadata',
			'one-sentence-summary',
			'one-paragraph-summary',
			'plot-synopsis',
			'long-synopsis',
			'character',
			'scene',
			'worldbuilding',
			'draft',
			'material',
			'archive',
		]);
		for (const documentType of DOCUMENT_TYPES) {
			expect(isDocumentType(documentType)).toBe(true);
		}
	});

	it('rejects values that are not document types', () => {
		for (const value of ['', 'Character', 'unknown', 1, null, undefined]) {
			expect(isDocumentType(value)).toBe(false);
		}
	});
});
