import { describe, expect, it } from 'vitest';

import { resolveManagedSectionLocale } from '../../src/editor/managed-section-locale';

const note = (projectId: string): string => `---
${JSON.stringify({
	'snowflake-schema': 1,
	'snowflake-document': 'character',
	'snowflake-project-id': projectId,
})}
---

# Character
`;

describe('managed section editor locale', () => {
	it('resolves each open note from its own project id', () => {
		const projectLocalesById = new Map([
			['project-en', 'en' as const],
			['project-zh', 'zh-CN' as const],
		]);
		const shared = {
			uiLocale: 'project' as const,
			obsidianLocale: 'en-gb',
			fallbackProjectLocale: 'en' as const,
			projectLocalesById,
		};

		expect(resolveManagedSectionLocale({ ...shared, content: note('project-en') })).toBe(
			'en',
		);
		expect(resolveManagedSectionLocale({ ...shared, content: note('project-zh') })).toBe(
			'zh-CN',
		);
	});

	it('honours fixed and Obsidian language settings without changing Markdown', () => {
		const content = note('project-zh');
		const projectLocalesById = new Map([['project-zh', 'zh-CN' as const]]);

		expect(
			resolveManagedSectionLocale({
				uiLocale: 'en',
				obsidianLocale: 'zh-CN',
				fallbackProjectLocale: 'zh-CN',
				content,
				projectLocalesById,
			}),
		).toBe('en');
		expect(
			resolveManagedSectionLocale({
				uiLocale: 'system',
				obsidianLocale: 'zh-CN',
				fallbackProjectLocale: 'en',
				content,
				projectLocalesById,
			}),
		).toBe('zh-CN');
		expect(content).toBe(note('project-zh'));
	});

	it('uses the active project locale while the per-project cache is rebuilding', () => {
		expect(
			resolveManagedSectionLocale({
				uiLocale: 'project',
				obsidianLocale: 'en-gb',
				fallbackProjectLocale: 'zh-CN',
				content: note('project-not-cached-yet'),
				projectLocalesById: new Map(),
			}),
		).toBe('zh-CN');
	});

	// Frontmatter is unparsable for as long as the author is midway through a
	// line. Editor copy has to keep resolving, because this runs inside the
	// CodeMirror decoration builder and transaction filter.
	it('falls back to the active project while frontmatter is being edited', () => {
		const halfEdited = ['---', 'snowflake-project-name: Anna: Brave', '---', ''].join(
			'\n',
		);
		const notAMapping = ['---', '"a bare scalar"', '---', ''].join('\n');
		const shared = {
			uiLocale: 'project' as const,
			obsidianLocale: 'en-gb',
			fallbackProjectLocale: 'zh-CN' as const,
			projectLocalesById: new Map([['project-zh', 'zh-CN' as const]]),
		};

		expect(
			resolveManagedSectionLocale({ ...shared, content: halfEdited }),
		).toBe('zh-CN');
		expect(
			resolveManagedSectionLocale({ ...shared, content: notAMapping }),
		).toBe('zh-CN');
		expect(
			resolveManagedSectionLocale({
				...shared,
				uiLocale: 'en',
				content: halfEdited,
			}),
		).toBe('en');
	});
});
