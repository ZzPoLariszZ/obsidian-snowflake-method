import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import { SnowflakeManuscriptView } from '../../src/ui/manuscript-view';
import { SnowflakeStoryStructureView } from '../../src/ui/story-structure-view';

const firstProject = 'First/First.md';
const secondProject = 'Second/Second.md';

function storyContext(boundPath: string | null, loadedPath: string | null) {
	const view = Object.create(SnowflakeStoryStructureView.prototype) as SnowflakeStoryStructureView;
	Object.assign(view, {
		state: { projectPath: boundPath },
		model: loadedPath === null ? null : { path: loadedPath, locale: 'zh-CN' },
	});
	return view.workspaceProjectContext();
}

function manuscriptContext(boundPath: string | null, loadedPath: string | null) {
	const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
	Object.assign(view, {
		projectPath: boundPath,
		model: loadedPath === null ? null : { projectPath: loadedPath, locale: 'zh-CN' },
	});
	return view.workspaceProjectContext();
}

describe.each([
	['story structure', storyContext],
	['manuscript', manuscriptContext],
] as const)('%s workspace project context', (_name, context) => {
	it('routes commands to the loaded project and its own language', () => {
		expect(context(firstProject, firstProject)).toEqual({ path: firstProject, locale: 'zh-CN' });
	});

	it('leaves an unloaded tab for the host to resolve from its saved state', () => {
		expect(context(firstProject, null)).toBeNull();
	});

	it('does not activate the previous project while replacement state is loading', () => {
		expect(context(secondProject, firstProject)).toBeNull();
	});
});

it('does not activate a stale story project after ownership is explicitly cleared', () => {
	expect(storyContext(null, firstProject)).toBeNull();
});

it('uses the loaded owner of a legacy manuscript whose state had no project', () => {
	expect(manuscriptContext(null, firstProject)).toEqual({ path: firstProject, locale: 'zh-CN' });
});
