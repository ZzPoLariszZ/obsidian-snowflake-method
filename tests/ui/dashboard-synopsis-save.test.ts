// @vitest-environment happy-dom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const notices = vi.hoisted(() => [] as string[]);

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		MarkdownView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		Notice: class {
			constructor(message: unknown) {
				notices.push(String(message));
			}
		},
	};
});

import SnowflakeMethodPlugin from '../../src/main';
import { SnowflakeProjectService } from '../../src/services';
import { readMarkedSection } from '../../src/templates';
import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { ProjectDashboardModel } from '../../src/ui/view-model';
import { createFakeEnvironment } from '../helpers/fake-vault';
import { installObsidianDom } from '../helpers/obsidian-dom';

beforeAll(() => {
	installObsidianDom(window);
});

beforeEach(() => {
	notices.length = 0;
});

/**
 * The real plugin's model and save over the real project service on the
 * fake vault, drawn by the real synopsis panel: only the view's disclosure
 * helper and its refresh are stood in for.
 */
async function setup() {
	const env = createFakeEnvironment();
	const service = new SnowflakeProjectService(env.vault, env.fileManager, env.metadataCache);
	const project = await service.createProject({ name: 'Alpha', locale: 'en' });
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	Object.assign(plugin, {
		app: { vault: env.vault, fileManager: env.fileManager, metadataCache: env.metadataCache },
		projects: service,
		settings: {
			recentProjectPath: project.projectFile,
			recentManuscriptNotes: {},
			writingCountMode: 'ms-word',
			uiLocale: 'en',
		},
		externalDrafts: new Map(),
		projectLocalesById: new Map(),
		updatableSiblingsByProject: new Map(),
		currentProjectLocale: 'en',
		t: (key: string) => key,
		translateForProject: (_locale: unknown, key: string) => key,
		saveSettings: () => Promise.resolve(),
		dressNotes: () => undefined,
		refreshParagraphLineEditors: () => undefined,
	});
	const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
	const refresh = vi.fn(() => Promise.resolve());
	Object.assign(view, {
		host: plugin,
		t: (key: string) => key,
		renderState: {
			createDisclosure: (parent: HTMLElement, _key: string, cls: string) =>
				parent.createEl('details', { cls }),
		},
		refresh,
		// The chord's binder the constructor makes; the chord itself is tried in dashboard-synopsis.test.ts.
		bindSave: () => undefined,
	});
	const render = (model: ProjectDashboardModel, id: 4 | 6) => {
		const panel = document.body.createDiv();
		const step = model.steps.find((candidate) => candidate.id === id);
		(view as unknown as {
			renderSynopsis(
				panel: HTMLElement,
				step: unknown,
				model: ProjectDashboardModel,
				id: 4 | 6,
				readOnly: boolean,
			): void;
		}).renderSynopsis(panel, step, model, id, false);
		const box = panel.querySelector<HTMLElement>('.snowflake-method-synopsis-input') as HTMLElement;
		const button = (label: string): HTMLButtonElement =>
			Array.from(panel.querySelectorAll('button')).find((one) => one.textContent === label) as HTMLButtonElement;
		return { box, save: button('common.save'), open: button('common.open') };
	};
	return { env, service, project, plugin, refresh, render };
}

/**
 * Steps 4 and 6 written from the dashboard: the model carries each note's
 * section and revision, a save writes the box into the right section, and a
 * missing note takes no words and cannot be opened.
 */
describe('the synopsis write path', () => {
	it.each([
		[4, 'plot-synopsis'],
		[6, 'long-synopsis'],
	] as const)('step %i opens on its %s section and saves the box into it', async (id, sectionId) => {
		const { service, project, plugin, refresh, render } = await setup();
		const before = await service.loadArtifact(project, id);
		if (before === null) throw new Error('no note');
		await service.updateSections(before.path, { [sectionId]: `Written earlier for step ${String(id)}.` }, before.revision);
		const model = await plugin.loadDashboardModel(project.projectFile);
		if (model === null) throw new Error('no model');
		expect(model.stepRevisions[id]?.length ?? 0).toBeGreaterThan(0);
		const { box, save } = render(model, id);
		expect(box.textContent).toBe(`Written earlier for step ${String(id)}.`);
		const words = `Typed into the step ${String(id)} box.`;
		box.textContent = words;
		box.dispatchEvent(new Event('input'));
		save.click();
		await vi.waitFor(() => {
			expect(refresh.mock.calls.length + notices.length).toBeGreaterThan(0);
		});
		expect(notices).toEqual(['messages.stepSaved']);
		const after = await service.loadArtifact(project, id);
		expect(readMarkedSection(after?.content ?? '', sectionId)).toBe(words);
	});

	it('keeps the drafts of steps 4 and 6 apart', async () => {
		const { service, project, plugin, refresh, render } = await setup();
		const model = await plugin.loadDashboardModel(project.projectFile);
		if (model === null) throw new Error('no model');
		const four = render(model, 4);
		four.box.textContent = 'Draft for four';
		four.box.dispatchEvent(new Event('input'));
		const six = render(model, 6);
		expect(six.box.textContent).toBe('');
		six.box.textContent = 'Words for six';
		six.box.dispatchEvent(new Event('input'));
		six.save.click();
		await vi.waitFor(() => {
			expect(refresh.mock.calls.length + notices.length).toBeGreaterThan(0);
		});
		expect(notices).toEqual(['messages.stepSaved']);
		const sixNote = await service.loadArtifact(project, 6);
		expect(readMarkedSection(sixNote?.content ?? '', 'long-synopsis')).toBe('Words for six');
		expect(render(model, 4).box.textContent).toBe('Draft for four');
	});

	it('leaves a missing note’s box, Save and Open all unusable', async () => {
		const { env, service, project, plugin, render } = await setup();
		const path = await service.getArtifactPath(project, 6);
		if (path === null) throw new Error('no note');
		env.fakeVault.delete(path);
		const model = await plugin.loadDashboardModel(project.projectFile);
		if (model === null) throw new Error('no model');
		const { box, save, open } = render(model, 6);
		expect(box.getAttribute('contenteditable')).toBe('false');
		expect(save.disabled).toBe(true);
		expect(open.disabled).toBe(true);
	});
});
