// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { WorkspaceLeaf } from 'obsidian';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {
			app: unknown;
			constructor(public leaf: { app: unknown }) {
				this.app = leaf.app;
			}
		},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

/** The session panel as its labels: one line, written once in the bridge's language. */
vi.mock('../../src/ui/session-panel', async (importOriginal) => {
	const original = await importOriginal<typeof import('../../src/ui/session-panel')>();
	return {
		...original,
		renderSessionPanel: (host: HTMLElement, bridge: { t: (key: string) => string }) => {
			host.createDiv({ cls: 'panel-title', text: bridge.t('sessionWidget.goal.title') });
			return () => undefined;
		},
	};
});

import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { DashboardHost } from '../../src/ui/view-model';
import { installObsidianDom } from '../helpers/obsidian-dom';

/**
 * A dashboard over a project in English, whose interface language a test
 * can move as the setting does: the project and its language stay put.
 */
function dashboard(): {
	shown: () => { el: Element | null; text: string | null };
	speak: (language: string) => void;
} {
	let language = 'en';
	const host = {
		getRecentStep: () => 1,
		isFreeformModeEnabled: () => false,
		interfaceLocale: () => language,
		translateForProject: (_locale: string | null, key: string) => `${language}:${key}`,
		writingSessions: () => ({ t: (key: string) => `${language}:${key}` }),
	} as unknown as DashboardHost;
	const view = new SnowflakeDashboardView({ app: {} } as unknown as WorkspaceLeaf, host);
	Object.assign(view, {
		projectPath: 'Novel/00_System/001_Project_Metadata.md',
		projectLocale: 'en',
	});
	return {
		// One frame rebuild: a fresh body, and the sessions face drawn into it.
		shown: () => {
			const body = document.body.createDiv();
			(view as unknown as { renderStatisticsBody(body: HTMLElement, tab: 'sessions'): void })
				.renderStatisticsBody(body, 'sessions');
			const el = body.firstElementChild;
			return { el, text: el?.querySelector('.panel-title')?.textContent ?? null };
		},
		speak: (next) => {
			language = next;
		},
	};
}

describe('the dashboard’s kept panels through a change of language', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	it('hands the session panel back while the language stands', () => {
		const panel = dashboard();
		const first = panel.shown();
		const again = panel.shown();
		expect(again.el).toBe(first.el);
		expect(again.text).toBe('en:sessionWidget.goal.title');
	});

	it('builds the session panel afresh in the language the setting moved to', () => {
		const panel = dashboard();
		const before = panel.shown();
		panel.speak('es');
		const after = panel.shown();
		expect(after.el).not.toBe(before.el);
		expect(after.text).toBe('es:sessionWidget.goal.title');
		// The panel let go of is out of every frame, not left beside the new one.
		expect(before.el?.isConnected).toBe(false);
		// And the new one is the one handed back from there on.
		expect(panel.shown().el).toBe(after.el);
	});
});
