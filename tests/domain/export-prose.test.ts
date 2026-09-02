import { describe, expect, it } from 'vitest';

import {
	exportFileName,
	exportProse,
	isExportFormat,
	isExportLayout,
	isExportSeparator,
	joinChapters,
	type ExportProseOptions,
} from '../../src/domain';

const cjk: ExportProseOptions = { indent: true, paragraphSpacing: true, script: 'cjk' };
const latin: ExportProseOptions = { indent: true, paragraphSpacing: true, script: 'latin' };

describe('export prose', () => {
	it('keeps a heading as its words, never indented, and indents the paragraphs', () => {
		const body = '# 第一章 相遇\n\n第一段。\n\n第二段。\n';
		expect(exportProse(body, [], cjk)).toBe('第一章 相遇\n\n　　第一段。\n\n　　第二段。\n');
		const setext = 'Her winter\n----------\n\nOne two.\n';
		expect(exportProse(setext, [], latin)).toBe('Her winter\n\n  One two.\n');
	});

	it('leaves an indent the author typed and strips every indent when asked', () => {
		const body = '　　已缩进。\n\n未缩进。\n';
		expect(exportProse(body, [], cjk)).toBe('　　已缩进。\n\n　　未缩进。\n');
		expect(exportProse(body, [], { ...cjk, indent: false })).toBe('已缩进。\n\n未缩进。\n');
	});

	it('drops the blank lines between paragraphs when asked, and keeps every one otherwise', () => {
		const body = '第一段。\n\n\n\n第二段。\n';
		expect(exportProse(body, [], cjk)).toBe('　　第一段。\n\n\n\n　　第二段。\n');
		expect(exportProse(body, [], { ...cjk, paragraphSpacing: false })).toBe(
			'　　第一段。\n　　第二段。\n',
		);
		// A heading under the tight rule stands on its own line still.
		expect(
			exportProse('# Title\n\nOne.\n\nTwo.\n', [], {
				...latin,
				paragraphSpacing: false,
			}),
		).toBe('Title\n  One.\n  Two.\n');
	});

	it('draws a hard break as the line it is, its continuation unindented', () => {
		expect(exportProse('line one\\\nline two\n', [], latin)).toBe(
			'  line one\nline two\n',
		);
	});

	it('spells an entity, shows a link by its text, and hides what the page hides', () => {
		const body =
			'see [[Character/Alice|Alice]] %% hidden %% and Tom &amp; Jerry now ^ab12\n\n```js\ncode\n```\n\n![[Embed]]\n\nEnd.\n';
		expect(exportProse(body, [], { ...latin, indent: false })).toBe(
			'see Alice and Tom & Jerry now\n\nEnd.\n',
		);
	});

	it('drops emphasis, list and quote marks but keeps their words', () => {
		const body = '**Bold** and _lean_\n\n- first\n- second\n\n> quoted line\n';
		expect(exportProse(body, [], { ...latin, indent: false })).toBe(
			'Bold and lean\n\nfirst\nsecond\n\nquoted line\n',
		);
	});

	it('reads Windows line ends and trailing whitespace the same', () => {
		expect(exportProse('a  \r\n\r\nb\t\r\n', [], { ...latin, indent: false })).toBe(
			'a\n\nb\n',
		);
	});

	it('leaves out what the caller excluded, and answers nothing for no writing', () => {
		expect(exportProse('PLUGIN one two\n', [{ from: 0, to: 7 }], { ...latin, indent: false })).toBe(
			'one two\n',
		);
		expect(exportProse('', [], cjk)).toBe('');
		expect(exportProse('\n\n   \n', [], cjk)).toBe('');
	});

	it('never begins a file with a blank line', () => {
		expect(exportProse('\n\n# Title\n\nOne.\n', [], { ...latin, indent: false })).toBe(
			'Title\n\nOne.\n',
		);
	});
});

describe('joining notes into one file', () => {
	it('stands the chosen separator between notes with a blank line on either side', () => {
		expect(joinChapters(['A\n', 'B\n'], 'blank')).toBe('A\n\nB\n');
		expect(joinChapters(['A\n', 'B\n'], 'rule')).toBe('A\n\n----------\n\nB\n');
		expect(joinChapters(['A\n', 'B\n'], 'asterisks')).toBe('A\n\n* * *\n\nB\n');
	});

	it('passes over a note with nothing in it', () => {
		expect(joinChapters(['A\n', '', 'B\n'], 'rule')).toBe('A\n\n----------\n\nB\n');
		expect(joinChapters(['A\n'], 'rule')).toBe('A\n');
		expect(joinChapters([], 'blank')).toBe('');
	});
});

describe('naming the files', () => {
	it('puts the note in reading order ahead of its name, padded to the manuscript', () => {
		expect(exportFileName(0, 12, '第一章', 'md')).toBe('001 第一章.md');
		expect(exportFileName(9, 1500, 'x', 'txt')).toBe('0010 x.txt');
	});

	it('knows its options', () => {
		expect(isExportFormat('md')).toBe(true);
		expect(isExportFormat('docx')).toBe(false);
		expect(isExportLayout('folder')).toBe(true);
		expect(isExportLayout('zip')).toBe(false);
		expect(isExportSeparator('asterisks')).toBe(true);
		expect(isExportSeparator('title')).toBe(false);
	});
});
