import { afterEach, describe, expect, it, vi } from 'vitest';

// The real plugin routes the import; the dialogs, the notices and the
// project service are stood in for.
const { notices, dialogs, reports } = vi.hoisted(() => ({
	notices: [] as { message: string; duration: number | undefined; hidden: boolean }[],
	dialogs: [] as { t: (key: string, vars?: Record<string, string | number>) => string; config: unknown; onSubmit: (choice: unknown) => Promise<void> }[],
	reports: [] as unknown[],
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		Notice: class {
			private readonly entry: { message: string; duration: number | undefined; hidden: boolean };
			constructor(message: string, duration?: number) {
				this.entry = { message, duration, hidden: false };
				notices.push(this.entry);
			}
			setMessage(message: string): this { this.entry.message = message; return this; }
			hide(): void { this.entry.hidden = true; }
		},
	};
});

vi.mock('../../src/ui/import-dialog', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/import-dialog')>();
	return {
		...actual,
		ImportProjectModal: class {
			constructor(
				_app: unknown,
				t: (key: string, vars?: Record<string, string | number>) => string,
				config: unknown,
				onSubmit: (choice: unknown) => Promise<void>,
			) {
				dialogs.push({ t, config, onSubmit });
			}
			open(): void {}
		},
		ImportReportModal: class {
			constructor(_app: unknown, _t: unknown, report: unknown) { reports.push(report); }
			open(): void {}
		},
	};
});

import SnowflakeMethodPlugin from '../../src/main';
import { ImportRefusedError, type ImportReport } from '../../src/services';

interface Ref {
	projectFile: string;
	rootPath: string;
	id: string;
	title: string;
	locale: 'en' | 'zh-CN';
	readOnly: boolean;
	series: { name: string; book: number | null } | null;
}

const ref = (title: string, overrides: Partial<Ref> = {}): Ref => ({
	projectFile: `Root/${title}/Project.md`,
	rootPath: `Root/${title}`,
	id: title,
	title,
	locale: 'zh-CN',
	readOnly: false,
	series: null,
	...overrides,
});

function report(target: Ref, overrides: Partial<ImportReport> = {}): ImportReport {
	return {
		source: { id: 'Book 1', title: 'Book 1' },
		target: { id: target.id, title: target.title, projectFile: target.projectFile },
		created: [],
		replaced: [],
		skipped: [],
		failed: [],
		droppedLinks: [],
		pictures: { landed: 0, reused: 0 },
		kindsCreated: [],
		counts: {},
		...overrides,
	} as unknown as ImportReport;
}

function pluginWith(active: Ref[], archived: Ref[] = [], imported: Record<string, string[]> = {}) {
	const importer = {
		inspectSource: vi.fn(() => Promise.resolve({ parts: [] })),
		plan: vi.fn(() => ({ entries: [] })),
		runImport: vi.fn(
			(_source: string, target: string, _selection: unknown, _options?: { onProgress?: (p: unknown) => void }) =>
				Promise.resolve(report(ref(target.split('/')[1] ?? ''))),
		),
	};
	const projects = {
		loadProject: vi.fn((path: string) => {
			const found = [...active, ...archived].find((project) => project.projectFile === path);
			return found === undefined ? Promise.reject(new Error(`no project at ${path}`)) : Promise.resolve(found);
		}),
		listArchivedProjects: vi.fn(() => Promise.resolve(archived)),
		importer,
		// The import record of each project: which source ids its copies came from.
		imports: {
			readDocument: vi.fn((project: Ref) =>
				Promise.resolve({
					entries: (imported[project.id] ?? []).map((sourceProjectId) => ({ sourceProjectId })),
					lastChoices: {},
					strays: { entries: [], keys: {} },
				}),
			),
		},
	};
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	const refreshDashboards = vi.fn(() => Promise.resolve());
	const projectHealth = new Map<string, Promise<unknown>>(
		[...active, ...archived].map((project) => [project.rootPath, Promise.resolve({})]),
	);
	const pendingFieldsReconciles = new Set<string>(['Root/Book 2/Characters/Alice.md']);
	// The history hears the run begin and end; what it records is its own suite's.
	const history = { beginImport: vi.fn(), endImport: vi.fn() };
	Object.assign(plugin, {
		app: { workspace: { getLeavesOfType: () => [] } },
		settings: { projectRoot: 'Root', recentProjectPath: 'Root/Book 2/Project.md' },
		t: (key: string, vars?: Record<string, string | number>) => `${key}${vars === undefined ? '' : JSON.stringify(vars)}`,
		translateForProject: (locale: string, key: string, vars?: Record<string, string | number>) =>
			`${locale}:${key}${vars === undefined ? '' : JSON.stringify(vars)}`,
		projects,
		discoverProjects: vi.fn(() => Promise.resolve(active)),
		projectHealth,
		projectDiscoveryPromise: Promise.resolve(active),
		updatableSiblingsByProject: new Map(),
		pendingFieldsReconciles,
		fieldsReconcilePaused: false,
		// The history hears the run begin and end; what it records is its own suite's.
		history,
		refreshDashboards,
	});
	return { plugin, importer, projects, refreshDashboards, projectHealth, pendingFieldsReconciles, history };
}

afterEach(() => {
	notices.length = 0;
	dialogs.length = 0;
	reports.length = 0;
});

const lastDialog = () => {
	const dialog = dialogs[dialogs.length - 1];
	if (dialog === undefined) throw new Error('no dialog opened');
	return dialog;
};

describe('importSources', () => {
	it('offers the writable projects without the target, then the archived ones, and never one written by a newer release', async () => {
		const { plugin } = pluginWith(
			[ref('Book 1', { series: { name: 'Saga', book: 1 } }), ref('Book 2'), ref('Newer', { readOnly: true })],
			[ref('Old'), ref('Frozen', { readOnly: true })],
		);
		expect(await plugin.importSources('Root/Book 2/Project.md')).toEqual([
			{ path: 'Root/Book 1/Project.md', title: 'Book 1', locale: 'zh-CN', series: { name: 'Saga', book: 1 }, archived: false },
			{ path: 'Root/Old/Project.md', title: 'Old', locale: 'zh-CN', series: null, archived: true },
		]);
		expect((await plugin.importSources(null)).map((source) => source.title)).toEqual(['Book 1', 'Book 2', 'Old']);
	});
});

describe('openImportDialog', () => {
	it('refuses a target that cannot be written, in the target’s own words', async () => {
		const { plugin } = pluginWith([ref('Book 1'), ref('Book 2', { readOnly: true })]);
		await expect(plugin.openImportDialog('Root/Book 2/Project.md')).rejects.toThrow('zh-CN:errors.readOnly');
		expect(dialogs).toHaveLength(0);
	});

	it('says so when there is nothing to import from, and opens no dialog', async () => {
		const { plugin } = pluginWith([ref('Book 2')]);
		await plugin.openImportDialog('Root/Book 2/Project.md');
		expect(dialogs).toHaveLength(0);
		expect(notices[notices.length - 1]?.message).toBe('zh-CN:modal.import.noSources');
	});

	it('opens the dialog on the target in its language, the source it was handed chosen, the bridge speaking the host’s words', async () => {
		const { plugin, importer } = pluginWith([
			ref('Book 1', { series: { name: 'Saga', book: 1 } }),
			ref('Book 2', { series: { name: 'Saga', book: 2 } }),
		]);
		await plugin.openImportDialog('Root/Book 2/Project.md', 'Root/Book 1/Project.md');
		const dialog = lastDialog();
		expect(dialog.t('modal.import.title')).toBe('zh-CN:modal.import.title');
		const config = dialog.config as {
			target: { path: string; title: string; series: unknown };
			sources: { path: string }[];
			initialSource: string | null;
			bridge: { inspect(path: string): Promise<unknown>; plan(i: unknown, s: unknown): unknown };
		};
		expect(config.target).toEqual({
			path: 'Root/Book 2/Project.md',
			title: 'Book 2',
			locale: 'zh-CN',
			series: { name: 'Saga', book: 2 },
		});
		expect(config.sources.map((source) => source.path)).toEqual(['Root/Book 1/Project.md']);
		expect(config.initialSource).toBe('Root/Book 1/Project.md');
		await config.bridge.inspect('Root/Book 1/Project.md');
		expect(importer.inspectSource).toHaveBeenCalledExactlyOnceWith('Root/Book 1/Project.md', 'Root/Book 2/Project.md');
		config.bridge.plan('inspection', 'selection');
		expect(importer.plan).toHaveBeenCalledExactlyOnceWith('inspection', 'selection');
		importer.inspectSource.mockRejectedValueOnce(new ImportRefusedError('same-project', 'raw words'));
		await expect(config.bridge.inspect('Root/Book 2/Project.md')).rejects.toThrow('errors.importSameProject{"name":""}');
	});
});

describe('openUpdateFromSeries', () => {
	it('says when the project is in no series, and when no book of its series has been imported from', async () => {
		const loose = pluginWith([ref('Book 1'), ref('Book 2')]);
		await loose.plugin.openUpdateFromSeries('Root/Book 2/Project.md');
		expect(notices[notices.length - 1]?.message).toBe('zh-CN:modal.import.notInSeries');
		expect(dialogs).toHaveLength(0);
		const fresh = pluginWith([
			ref('Book 1', { series: { name: 'Saga', book: 1 } }),
			ref('Book 2', { series: { name: 'Saga', book: 2 } }),
		]);
		await fresh.plugin.openUpdateFromSeries('Root/Book 2/Project.md');
		expect(notices[notices.length - 1]?.message).toBe('zh-CN:modal.import.noSiblings');
		expect(dialogs).toHaveLength(0);
		// Its own record, then the sibling's: a book that imported from this one holds the pairing.
		expect(fresh.projects.imports.readDocument).toHaveBeenCalledTimes(2);
	});

	it('offers the book that never imported the books holding copies of its notes, read from their own records', async () => {
		const { plugin } = pluginWith(
			[
				ref('Book 1', { series: { name: 'Saga', book: 1 } }),
				ref('Book 2', { series: { name: 'Saga', book: 2 } }),
				ref('Book 3', { series: { name: 'Saga', book: 3 } }),
				ref('Other', { series: { name: 'Other', book: 1 } }),
			],
			[],
			{ 'Book 3': ['Book 1'], Other: ['Book 1'] },
		);
		await plugin.openUpdateFromSeries('Root/Book 1/Project.md');
		const config = lastDialog().config as { mode: string; sources: { title: string }[] };
		expect(config.mode).toBe('update');
		expect(config.sources.map((source) => source.title)).toEqual(['Book 3']);
	});

	it('opens the update dialog on the books of the series imported from, lowest first, and no other', async () => {
		const { plugin } = pluginWith(
			[
				ref('Book 3', { series: { name: 'Saga', book: 3 } }),
				ref('Book 1', { series: { name: 'saga', book: 1 } }),
				ref('Book 2', { series: { name: 'Saga', book: 2 } }),
				ref('Other', { series: { name: 'Other', book: 1 } }),
				ref('Loose'),
			],
			[],
			{ 'Book 3': ['Book 2', 'Book 1', 'Other', 'Loose'] },
		);
		await plugin.openUpdateFromSeries('Root/Book 3/Project.md');
		const dialog = lastDialog();
		const config = dialog.config as { mode: string; target: { path: string }; sources: { title: string; archived: boolean }[] };
		expect(config.mode).toBe('update');
		expect(config.target.path).toBe('Root/Book 3/Project.md');
		expect(config.sources.map((source) => source.title)).toEqual(['Book 1', 'Book 2']);
		expect(config.sources.every((source) => !source.archived)).toBe(true);
	});

	it('refuses a target that cannot be written', async () => {
		const { plugin } = pluginWith([ref('Book 2', { readOnly: true, series: { name: 'Saga', book: 2 } })]);
		await expect(plugin.openUpdateFromSeries('Root/Book 2/Project.md')).rejects.toThrow('zh-CN:errors.readOnly');
	});
});

describe('runImport', () => {
	const choice = {
		sourcePath: 'Root/Book 1/Project.md',
		selection: { parts: new Set(['character:c1']), clashPolicy: 'skip' as const },
		mode: 'import' as const,
	};

	it('pauses the reconcile pass for the run, counts it in one notice, then tells the caches and the dashboards', async () => {
		const target = ref('Book 2');
		const { plugin, importer, refreshDashboards, projectHealth, pendingFieldsReconciles, history } = pluginWith([ref('Book 1'), target]);
		let pausedDuringRun = false;
		importer.runImport.mockImplementationOnce(async (_source: string, _target: string, _selection: unknown, options?: { onProgress?: (p: unknown) => void }) => {
			pausedDuringRun = (plugin as unknown as { fieldsReconcilePaused: boolean }).fieldsReconcilePaused;
			options?.onProgress?.({ phase: 'members', done: 3, total: 9 });
			expect(notices[notices.length - 1]?.message).toBe('zh-CN:modal.import.progress{"done":3,"total":9}');
			await Promise.resolve();
			return report(target, {
				created: [{ kind: 'character', key: 'character:c1', name: 'Alice', targetName: 'Alice', targetPath: null }],
			});
		});
		await plugin.openImportDialog('Root/Book 2/Project.md');
		await lastDialog().onSubmit(choice);
		// The dialog's handler lets the run go on after it has closed.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(importer.runImport).toHaveBeenCalledOnce();
		expect(importer.runImport.mock.calls[0]?.slice(0, 3)).toEqual([
			'Root/Book 1/Project.md',
			'Root/Book 2/Project.md',
			choice.selection,
		]);
		expect(pausedDuringRun).toBe(true);
		expect((plugin as unknown as { fieldsReconcilePaused: boolean }).fieldsReconcilePaused).toBe(false);
		expect(pendingFieldsReconciles.size).toBe(0);
		// The history held the run's events and names the source once the report is in.
		expect(history.beginImport).toHaveBeenCalledOnce();
		expect(history.endImport).toHaveBeenCalledOnce();
		expect(history.endImport.mock.calls[0]?.[0]).toMatchObject({
			source: { title: 'Book 1' },
			created: [{ targetPath: null }],
		});
		const progress = notices.find((notice) => notice.duration === 0);
		expect(progress?.hidden).toBe(true);
		expect(projectHealth.has('Root/Book 2')).toBe(false);
		expect(projectHealth.has('Root/Book 1')).toBe(true);
		expect((plugin as unknown as { projectDiscoveryPromise: unknown }).projectDiscoveryPromise).toBeNull();
		expect(refreshDashboards).toHaveBeenCalledExactlyOnceWith({ streams: true });
		expect(notices[notices.length - 1]?.message).toBe(
			'zh-CN:messages.importDone{"source":"Book 1","summary":"zh-CN:modal.import.summary.notesOne{\\"count\\":1}"}',
		);
		expect(reports).toHaveLength(0);
	});

	it('counts an update in its own words and says what was updated', async () => {
		const target = ref('Book 2', { series: { name: 'Saga', book: 2 } });
		const { plugin, importer } = pluginWith(
			[ref('Book 1', { series: { name: 'Saga', book: 1 } }), target],
			[],
			{ 'Book 2': ['Book 1'] },
		);
		importer.runImport.mockImplementationOnce(async (_source, _target, _selection, options?: { onProgress?: (p: unknown) => void }) => {
			options?.onProgress?.({ phase: 'members', done: 1, total: 2 });
			expect(notices[notices.length - 1]?.message).toBe('zh-CN:modal.import.updating{"done":1,"total":2}');
			await Promise.resolve();
			return report(target, {
				replaced: [{ kind: 'character', key: 'character:c1', name: 'Alice', targetName: 'Alice', targetPath: null }],
			});
		});
		await plugin.openUpdateFromSeries('Root/Book 2/Project.md');
		await lastDialog().onSubmit({ ...choice, selection: { ...choice.selection, clashPolicy: 'replace' }, mode: 'update' });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(notices[notices.length - 1]?.message).toBe(
			'zh-CN:messages.updateDone{"source":"Book 1","summary":"zh-CN:modal.import.summary.notesOne{\\"count\\":1}"}',
		);
	});

	it('says everything is up to date when a run wrote nothing and had nothing to report', async () => {
		const target = ref('Book 2');
		const { plugin, importer } = pluginWith([ref('Book 1'), target]);
		importer.runImport.mockResolvedValueOnce(
			report(target, {
				skipped: [{ kind: 'character', key: 'character:c1', name: 'Alice', targetName: 'Alice', targetPath: null, reason: 'unchanged' }],
			}),
		);
		await plugin.openImportDialog('Root/Book 2/Project.md');
		await lastDialog().onSubmit(choice);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(reports).toHaveLength(0);
		expect(notices[notices.length - 1]?.message).toBe('zh-CN:messages.importUpToDate{"source":"Book 1"}');
	});

	it('opens the report instead of the notice when something was skipped, dropped or failed', async () => {
		const target = ref('Book 2');
		const { plugin, importer } = pluginWith([ref('Book 1'), target]);
		const failed = report(target, {
			failed: [{ kind: 'scene', key: 'scene:s1', name: 'Opening', targetName: 'Opening', targetPath: null, message: 'disk full' }],
		});
		importer.runImport.mockResolvedValueOnce(failed);
		await plugin.openImportDialog('Root/Book 2/Project.md');
		await lastDialog().onSubmit(choice);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(reports).toEqual([failed]);
		expect(notices.some((notice) => notice.message.includes('messages.importDone'))).toBe(false);
	});

	it('puts a refusal in the author’s words, the pause lifted and the notice gone', async () => {
		const target = ref('Book 2');
		const { plugin, importer, history } = pluginWith([ref('Book 1'), target]);
		importer.runImport.mockRejectedValueOnce(new ImportRefusedError('kind-refused', 'raw words', '势力'));
		await plugin.openImportDialog('Root/Book 2/Project.md');
		await lastDialog().onSubmit(choice);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect((plugin as unknown as { fieldsReconcilePaused: boolean }).fieldsReconcilePaused).toBe(false);
		expect(notices.find((notice) => notice.duration === 0)?.hidden).toBe(true);
		expect(notices[notices.length - 1]?.message).toBe('errors.importKindRefused{"name":"势力"}');
		// A run that brought nothing still ends: the held events file as their own.
		expect(history.endImport).toHaveBeenCalledWith(null);
	});
});
