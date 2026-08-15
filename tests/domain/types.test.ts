import { describe, expect, it } from 'vitest';

import {
	DOCUMENT_TYPES,
	FRONTMATTER_KEYS,
	PROTECTED_SECTION_IDS,
	TEMPLATE_SECTION_IDS,
	isDocumentType,
} from '../../src/domain';

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
			'definition',
			'template',
			'draft',
			'material',
			'archive',
		]);
		for (const documentType of DOCUMENT_TYPES) {
			expect(isDocumentType(documentType)).toBe(true);
		}
	});

	it('names the template identity keys', () => {
		expect(FRONTMATTER_KEYS.templateType).toBe('snowflake-template-type');
		expect(FRONTMATTER_KEYS.templateId).toBe('snowflake-template-id');
	});

	it('protects the template body while member custom fields stay editable', () => {
		expect(PROTECTED_SECTION_IDS.has('template-fields')).toBe(true);
		expect(PROTECTED_SECTION_IDS.has('custom-fields')).toBe(false);
	});

	it('marks the template body as a template, not a record section', () => {
		expect(TEMPLATE_SECTION_IDS.has('template-fields')).toBe(true);
		expect(TEMPLATE_SECTION_IDS.has('world-status')).toBe(false);
		expect(TEMPLATE_SECTION_IDS.has('relationships')).toBe(false);
	});

	it('rejects values that are not document types', () => {
		for (const value of ['', 'Character', 'unknown', 1, null, undefined]) {
			expect(isDocumentType(value)).toBe(false);
		}
	});
});
