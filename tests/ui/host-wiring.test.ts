import { describe, expect, it } from 'vitest';

import main from '../../src/main.ts?raw';

/**
 * What the plugin's start-up wires, read off its source. The hooks
 * themselves are tested where they can be called; that they are hung on
 * the app at all is only said here, and a hook left unwired fails nothing
 * else: every typed word waiting on a timer would be lost at a quit with
 * the rest of the suite green.
 */
describe('what the plugin hangs on the app as it starts', () => {
	it('settles for a quit and for going out of sight once the layout is ready', () => {
		expect(main).toContain('\t\t\tthis.registerVaultListeners();\n\t\t\tthis.registerSettling();\n');
		expect(main).toContain("this.app.workspace.on('quit', (tasks) => {\n\t\t\t\tholdQuit(tasks, this.settleForQuit(), window);");
		expect(main).toContain("this.registerDomEvent(this.app.workspace.containerEl.win, 'pagehide', (event) => {");
		expect(main).toContain('if (doc.hidden && !this.pageLeaving) this.settleOutOfSight();');
	});

	it('counts the vault\u2019s changes from the moment the project service is made', () => {
		expect(main).toContain('this.register(this.watchVault());');
	});

	it('saves the explorer\u2019s own choices without counting them as a change to what a dashboard draws', () => {
		for (const choice of [
			'saveOrders: (next) => {\n\t\t\t\tthis.settings.explorerOrders = next;\n\t\t\t\tthis.armSettingsSave();',
			'saveToggle: (key, value) => {\n\t\t\t\tthis.settings[key] = value;\n\t\t\t\tthis.armSettingsSave();',
			'saveFolds: (paths) => {\n\t\t\t\tthis.settings.explorerImmersiveFolds = [...paths];\n\t\t\t\tthis.armSettingsSave();',
			'if (foldsMoved) this.settings.explorerImmersiveFolds = folds;\n\t\tthis.armSettingsSave();',
		]) {
			expect(main).toContain(choice);
		}
	});

	it('hands the app its panes drawn, for the picture of the last session to wait on', () => {
		// The layout's callback ends by handing back the dashboards drawn and
		// the streams read: the app, from 1.15.1, lifts its picture only then.
		expect(main).toContain(
			'\t\t\tconst dashboards = this.drawDashboardsOnShow();\n',
		);
		expect(main).toContain(
			'\t\t\treturn Promise.all([dashboards, this.streamsOnShowRead()]).then(\n\t\t\t\t() => undefined,\n\t\t\t\t() => undefined,\n\t\t\t);\n\t\t});\n\t}\n\n\tonunload(): void {',
		);
		// The project in front is made the current one behind the dashboards alone.
		expect(main).toContain(
			'\t\t\tvoid dashboards\n\t\t\t\t.then(() => this.activateProjectLeaf(this.app.workspace.getMostRecentLeaf()))\n',
		);
	});

	it('hears the index read a note again, for the snapshots and for the dashboards', () => {
		for (const event of ['changed', 'deleted']) {
			expect(main).toContain(
				`this.app.metadataCache.on('${event}', (file) => {\n\t\t\t\tthis.projects.indexMoved(file.path);\n\t\t\t\tthis.touchDashboardData();`,
			);
		}
	});
});
