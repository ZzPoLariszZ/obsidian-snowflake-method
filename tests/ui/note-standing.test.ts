import { describe, expect, it, vi } from 'vitest';

// The real plugin answers where a note stands; nothing of Obsidian's is
// reached beyond what the module needs to load.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		MarkdownView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import SnowflakeMethodPlugin from '../../src/main';

interface StandingHost {
	noteStanding(path: string): { inProject: boolean; inManuscript: boolean; locale: string | null };
	scanProjects(): Promise<unknown>;
	rememberDraft(project: { rootPath: string; links: { draft: string | null } }): void;
	carryRosterThroughRename(oldPath: string, newPath: string): void;
}

function host(
	projects: { rootPath: string; locale: 'en' | 'zh-CN'; readOnly: boolean }[],
	files: string[] = [],
) {
	const applied: string[] = [];
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as StandingHost;
	Object.assign(plugin, {
		app: { workspace: { getLeavesOfType: () => [] } },
		settings: { projectRoot: 'Projects' },
		projects: {
			discoverProjects: () =>
				Promise.resolve(projects.map((project, index) => ({ ...project, id: `p${String(index)}` }))),
			repository: {
				listDirectFolders: () => [],
				getFile: (path: string) => (files.includes(path) ? { path } : null),
			},
		},
		projectLocalesById: new Map(),
		knownProjectRoots: new Set(),
		projectLocalesByRoot: new Map(),
		knownProjectsByRoot: new Map(),
		externalDrafts: new Map(),
		explorerRoots: new Set(),
		explorer: null,
		notePresentation: { apply: () => applied.push('dress') },
		noteToolbars: { apply: () => undefined },
	});
	return { plugin, applied };
}

/**
 * Where a note stands for the dress: in any project the scan knows, the
 * read-only ones too, or the draft a project links to from outside its
 * folder, which the dress reaches as the domain rule says.
 */
describe('where a note stands', () => {
	it('reaches a read-only project’s notes and a draft linked from outside the folder', async () => {
		const { plugin } = host([
			{ rootPath: 'Projects/Novel', locale: 'en', readOnly: false },
			{ rootPath: 'Projects/Future', locale: 'zh-CN', readOnly: true },
		]);
		await plugin.scanProjects();
		plugin.rememberDraft({ rootPath: 'Projects/Novel', links: { draft: 'Drafts/Novel draft.md' } });
		expect(plugin.noteStanding('Projects/Novel/50_Manuscript/Chapter 1.md')).toEqual({
			inProject: true,
			inManuscript: true,
			locale: 'en',
		});
		expect(plugin.noteStanding('Projects/Future/50_正文/初稿.md')).toEqual({
			inProject: true,
			inManuscript: true,
			locale: 'zh-CN',
		});
		expect(plugin.noteStanding('Drafts/Novel draft.md')).toEqual({
			inProject: false,
			inManuscript: true,
			locale: 'en',
		});
		expect(plugin.noteStanding('Loose/Idea.md')).toEqual({
			inProject: false,
			inManuscript: false,
			locale: null,
		});
	});

	it('knows a project from its paths before the first scan has run', () => {
		const { plugin } = host([], [
			'Projects/Novel/00_System/001_Project_Metadata.md',
			'Projects/小说/00_系统/001_项目元数据.md',
		]);
		expect(plugin.noteStanding('Projects/Novel/50_Manuscript/Chapter 1.md')).toEqual({
			inProject: true,
			inManuscript: true,
			locale: 'en',
		});
		expect(plugin.noteStanding('Projects/小说/50_正文/第一章.md').locale).toBe('zh-CN');
		expect(plugin.noteStanding('Projects/Loose/Idea.md').inProject).toBe(false);
		expect(plugin.noteStanding('Elsewhere/Novel/Idea.md').inProject).toBe(false);
	});

	it('keeps a project’s notes dressed through the rename of its folder', async () => {
		const { plugin } = host([{ rootPath: 'Projects/Novel', locale: 'en', readOnly: false }]);
		await plugin.scanProjects();
		plugin.rememberDraft({ rootPath: 'Projects/Novel', links: { draft: 'Drafts/Novel draft.md' } });
		plugin.carryRosterThroughRename('Projects/Novel', 'Projects/Novel II');
		expect(plugin.noteStanding('Projects/Novel II/50_Manuscript/Chapter 1.md').inProject).toBe(true);
		expect(plugin.noteStanding('Projects/Novel/50_Manuscript/Chapter 1.md').inProject).toBe(false);
		plugin.carryRosterThroughRename('Drafts', 'Old drafts');
		expect(plugin.noteStanding('Old drafts/Novel draft.md')).toEqual({
			inProject: false,
			inManuscript: true,
			locale: 'en',
		});
	});

	it('dresses the notes again when a draft outside its project is learned, and only then', async () => {
		const { plugin, applied } = host([{ rootPath: 'Projects/Novel', locale: 'en', readOnly: false }]);
		await plugin.scanProjects();
		applied.length = 0;
		plugin.rememberDraft({ rootPath: 'Projects/Novel', links: { draft: 'Drafts/Novel draft.md' } });
		expect(applied).toEqual(['dress']);
		plugin.rememberDraft({ rootPath: 'Projects/Novel', links: { draft: 'Drafts/Novel draft.md' } });
		expect(applied).toEqual(['dress']);
		plugin.rememberDraft({ rootPath: 'Projects/Novel', links: { draft: null } });
		expect(applied).toEqual(['dress', 'dress']);
	});
});
