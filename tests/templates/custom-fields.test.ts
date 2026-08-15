import { describe, expect, it } from 'vitest';

import {
	customFieldTemplateNote,
	duplicateFieldTitle,
	parseCustomFields,
	serializeCustomFields,
	templateCustomFields,
	templateNoteFields,
} from '../../src/templates';

const BLOCK = [
	'### Eye color',
	'',
	'Grey, going pale in winter.',
	'',
	'### Sword style',
	'',
	'Two-handed, taught by her mother.',
].join('\n');

describe('custom fields parsing', () => {
	it('reads one row per heading with trimmed content', () => {
		expect(parseCustomFields(BLOCK).fields).toEqual([
			{ title: 'Eye color', content: 'Grey, going pale in winter.' },
			{ title: 'Sword style', content: 'Two-handed, taught by her mother.' },
		]);
	});

	it('keeps hand-written text before the first heading aside, not as a field', () => {
		const block = `A line someone typed here.\n\n${BLOCK}`;
		const parsed = parseCustomFields(block);
		expect(parsed.leading).toBe('A line someone typed here.\n');
		expect(parsed.fields).toHaveLength(2);
	});

	it('loads duplicate titles as separate rows, dropping nothing', () => {
		const block = '### Twin\n\nfirst\n\n### Twin\n\nsecond';
		expect(parseCustomFields(block).fields).toEqual([
			{ title: 'Twin', content: 'first' },
			{ title: 'Twin', content: 'second' },
		]);
	});

	it('does not open a field on deeper or shallower headings', () => {
		const block = '## Prose heading\n\n#### Detail\n\n### Real\n\nvalue';
		const parsed = parseCustomFields(block);
		expect(parsed.fields).toEqual([{ title: 'Real', content: 'value' }]);
		expect(parsed.leading).toContain('## Prose heading');
		expect(parsed.leading).toContain('#### Detail');
	});
});

describe('custom fields serialization', () => {
	it('returns the original byte for byte when nothing changed', () => {
		const odd = '### A\n\n\ntext with odd spacing\n\n\n### B\ncompact';
		expect(serializeCustomFields(odd, parseCustomFields(odd).fields)).toBe(odd);
	});

	it('keeps untouched rows in their own written shape when another row changes', () => {
		const fields = parseCustomFields(BLOCK).fields;
		const edited = [fields[0]!, { title: 'Sword style', content: 'Changed.' }];
		expect(serializeCustomFields(BLOCK, edited)).toBe(
			[
				'### Eye color',
				'',
				'Grey, going pale in winter.',
				'',
				'### Sword style',
				'',
				'Changed.',
			].join('\n'),
		);
	});

	it('appends, removes and reorders rows', () => {
		const fields = parseCustomFields(BLOCK).fields;
		const reordered = [
			{ title: 'Scars', content: '' },
			fields[1]!,
		];
		expect(serializeCustomFields(BLOCK, reordered)).toBe(
			['### Scars', '', '### Sword style', '', 'Two-handed, taught by her mother.'].join(
				'\n',
			),
		);
	});

	it('carries hand-written leading text through every save', () => {
		const block = `Kept line.\n\n${BLOCK}`;
		const out = serializeCustomFields(block, [
			{ title: 'Only', content: 'left' },
		]);
		expect(out).toBe('Kept line.\n\n### Only\n\nleft');
	});

	it('serializes zero fields with no leading text to the empty string', () => {
		expect(serializeCustomFields(BLOCK, [])).toBe('');
		expect(serializeCustomFields('', [])).toBe('');
	});

	it('pairs duplicate titles positionally so both survive an unrelated edit', () => {
		const block = '### Twin\n\nfirst\n\n### Twin\n\nsecond';
		const fields = [
			...parseCustomFields(block).fields,
			{ title: 'New', content: '' },
		];
		expect(serializeCustomFields(block, fields)).toBe(
			'### Twin\n\nfirst\n\n### Twin\n\nsecond\n\n### New',
		);
	});
});

describe('duplicateFieldTitle', () => {
	it('finds the first repeated title under fold', () => {
		expect(duplicateFieldTitle(['Eyes', 'Hair', ' eyes '])).toBe('eyes');
	});

	it('ignores blank titles and answers null when all differ', () => {
		expect(duplicateFieldTitle(['', 'Eyes', '  ', 'Hair'])).toBeNull();
	});
});

describe('templateCustomFields', () => {
	it('reads H3 blocks of a plain note, skipping frontmatter and prose', () => {
		const note = [
			'---',
			'{"snowflake-document": "material"}',
			'---',
			'# Character sheet',
			'',
			'Fill these in for every character.',
			'',
			'### Appearance',
			'',
			'What they look like.',
			'',
			'### Voice',
		].join('\n');
		expect(templateCustomFields(note)).toEqual([
			{ title: 'Appearance', content: 'What they look like.' },
			{ title: 'Voice', content: '' },
		]);
	});

	it('ignores managed marker ranges and keeps the first of repeated titles', () => {
		const note = [
			'<!-- snowflake:section:entity-fields:start -->',
			'### Not a field',
			'inside a managed range',
			'<!-- snowflake:section:entity-fields:end -->',
			'',
			'### Appearance',
			'',
			'first',
			'',
			'### appearance',
			'',
			'second',
		].join('\n');
		expect(templateCustomFields(note)).toEqual([
			{ title: 'Appearance', content: 'first' },
		]);
	});
});

describe('template notes', () => {
	it('stores the fields in one protected block and reads them back', () => {
		const note = customFieldTemplateNote([
			{ title: 'Motto', content: 'Words to live by.' },
			{ title: 'Sigil', content: '' },
		]);
		expect(note.sections.map((section) => section.id)).toEqual([
			'template-fields',
		]);
		expect(note.body).toContain(
			'<!-- snowflake:section:template-fields:start -->',
		);
		expect(note.body).toContain(
			'<!-- snowflake:section:template-fields:end -->',
		);
		const content = `---\nsnowflake-schema: 3\n---\n${note.body}`;
		expect(templateNoteFields(content)).toEqual([
			{ title: 'Motto', content: 'Words to live by.' },
			{ title: 'Sigil', content: '' },
		]);
	});

	it('keeps the first spelling when a hand edit repeats a title', () => {
		const note = customFieldTemplateNote([{ title: 'Motto', content: 'One.' }]);
		const tampered = note.body.replace(
			'### Motto\n\nOne.',
			'### Motto\n\nOne.\n\n### motto\n\nTwo.',
		);
		expect(tampered).not.toBe(note.body);
		expect(templateNoteFields(tampered)).toEqual([
			{ title: 'Motto', content: 'One.' },
		]);
	});

	it('reads a note without the block the free-form way', () => {
		const note = ['# Anything', '', '### Motto', '', 'Words.'].join('\n');
		expect(templateNoteFields(note)).toEqual([
			{ title: 'Motto', content: 'Words.' },
		]);
	});
});
