import { describe, expect, it, vi } from 'vitest';

import { TFile } from 'obsidian';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import SnowflakeMethodPlugin from '../../src/main';
import { PROJECT_PATH_LAYOUTS } from '../../src/services/types';

const projectRoot = 'Pressure';

function vaultRouting() {
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	const scheduleRefresh = vi.fn();
	const invalidateProjectHealth = vi.fn();
	const scheduleFieldsBlockReconcile = vi.fn();
	const scheduleWritingCountRefresh = vi.fn();
	const scheduleTaskNotify = vi.fn();
	const scheduleTimelineNotify = vi.fn();
	const scheduleBeatSheetNotify = vi.fn();
	const scheduleStickyNoteNotify = vi.fn();
	Object.assign(plugin, {
		settings: { projectRoot: '' },
		knownProjectRoots: new Set([projectRoot]),
		externalDrafts: new Map(),
		scheduleRefresh,
		invalidateProjectHealth,
		scheduleFieldsBlockReconcile,
		scheduleWritingCountRefresh,
		scheduleTaskNotify,
		scheduleTimelineNotify,
		scheduleBeatSheetNotify,
		scheduleStickyNoteNotify,
	});
	const route = plugin as unknown as { handleVaultEvent(file: TFile): void };
	return {
		changed: (path: string) => route.handleVaultEvent(Object.assign(new TFile(), { path })),
		scheduleRefresh,
		invalidateProjectHealth,
		scheduleFieldsBlockReconcile,
		scheduleWritingCountRefresh,
		scheduleTaskNotify,
		scheduleTimelineNotify,
		scheduleBeatSheetNotify,
		scheduleStickyNoteNotify,
	};
}

describe.each(Object.entries(PROJECT_PATH_LAYOUTS))('manuscript cache vault routing (%s)', (_locale, layout) => {
	const prose = `${projectRoot}/${layout.directories.manuscriptAnalysis}`;
	const entities = `${projectRoot}/${layout.directories.mentionIndex}`;

	it('rings the timeline bell for a write to its file, without asking the dashboards to reconcile', () => {
		const routing = vaultRouting();
		routing.changed(`${projectRoot}/${layout.directories.timeline}/timeline.json`);
		expect(routing.scheduleTimelineNotify).toHaveBeenCalledOnce();
		// A write to the file cannot move the health verdict, which turns on the
		// folder standing, so the dashboards that are shown are left as they are
		// rather than each building its whole model again a moment later.
		expect(routing.scheduleTimelineNotify).toHaveBeenCalledWith();
		expect(routing.scheduleRefresh).not.toHaveBeenCalled();
	});

	it('rings the beat sheet bell for a write to its file, and neither the timeline\'s nor the dashboards\'', () => {
		const routing = vaultRouting();
		routing.changed(`${projectRoot}/${layout.directories.beatSheet}/beat-sheet.json`);
		expect(routing.scheduleBeatSheetNotify).toHaveBeenCalledOnce();
		// As with the timeline: a write to the file cannot move the health
		// verdict, so no dashboard is asked to build its model again.
		expect(routing.scheduleBeatSheetNotify).toHaveBeenCalledWith();
		expect(routing.scheduleTimelineNotify).not.toHaveBeenCalled();
		expect(routing.scheduleRefresh).not.toHaveBeenCalled();
	});

	it.each([
		`${prose}/dev-a_analysis_stats.json`,
		`${entities}/dev-a_mention_index.json`,
		`${entities}/dev-a_analysis_stats.json`,
	])('does not restart panels when a cold scan persists %s', (path) => {
		const routing = vaultRouting();

		// Both the initial create and later partial/completed flushes enter
		// this handler. None represents a changed chapter or a user decision.
		for (let flush = 0; flush < 3; flush += 1) routing.changed(path);

		expect(routing.scheduleRefresh).not.toHaveBeenCalled();
		expect(routing.invalidateProjectHealth).not.toHaveBeenCalled();
		expect(routing.scheduleFieldsBlockReconcile).not.toHaveBeenCalled();
		expect(routing.scheduleWritingCountRefresh).not.toHaveBeenCalled();
		expect(routing.scheduleTaskNotify).not.toHaveBeenCalled();
		expect(routing.scheduleStickyNoteNotify).not.toHaveBeenCalled();
	});

	it.each([
		`${entities}/mention_ignores.json`,
		`${prose}/mention_ignores.json`,
		`${projectRoot}/Chapter.md`,
		`${projectRoot}/Scene.md`,
		`${projectRoot}/dev-a_analysis_stats.json`,
	])('still refreshes panels after an authored file changes: %s', (path) => {
		const routing = vaultRouting();

		routing.changed(path);

		expect(routing.scheduleRefresh).toHaveBeenCalledExactlyOnceWith(false);
		expect(routing.invalidateProjectHealth).toHaveBeenCalledExactlyOnceWith(path);
		expect(routing.scheduleFieldsBlockReconcile).toHaveBeenCalledExactlyOnceWith(path);
		expect(routing.scheduleWritingCountRefresh).toHaveBeenCalledExactlyOnceWith(1000);
	});

	it('still routes a task edit to the task board without rebuilding the dashboard', () => {
		const routing = vaultRouting();
		const path = `${projectRoot}/${layout.directories.tasks}/tasks.json`;

		routing.changed(path);

		expect(routing.scheduleTaskNotify).toHaveBeenCalledOnce();
		expect(routing.invalidateProjectHealth).toHaveBeenCalledExactlyOnceWith(path);
		expect(routing.scheduleRefresh).not.toHaveBeenCalled();
	});

	it('routes a timeline edit to the timeline workspaces without rebuilding the dashboard', () => {
		const routing = vaultRouting();
		const path = `${projectRoot}/${layout.directories.timeline}/timeline.json`;

		routing.changed(path);

		expect(routing.scheduleTimelineNotify).toHaveBeenCalledOnce();
		expect(routing.scheduleTaskNotify).not.toHaveBeenCalled();
		expect(routing.invalidateProjectHealth).toHaveBeenCalledExactlyOnceWith(path);
		expect(routing.scheduleRefresh).not.toHaveBeenCalled();
	});

	it('still refreshes project locales when the metadata changes', () => {
		const routing = vaultRouting();
		const path = `${projectRoot}/${layout.directories.system}/${layout.projectFileName}`;

		routing.changed(path);

		expect(routing.scheduleRefresh).toHaveBeenCalledExactlyOnceWith(true);
	});
});
