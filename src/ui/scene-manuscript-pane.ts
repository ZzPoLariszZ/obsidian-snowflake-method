/**
 * The pane that stands in for Obsidian's own graph inside the relationship
 * graph tab. The graph cannot live in a tab of ours, so this one says where
 * it opens, opens it, and lets the remembered settings go. It says no more
 * than that, on the notice pane the plugin's panes share, in the middle of
 * the frame, as an empty board says what it waits for.
 */

import type { Translate } from './modals';
import { renderNoticePane } from './pane-parts';

export interface SceneManuscriptStanding {
	/** Whether the graph core plugin is there to open. */
	available: boolean;
	/** Whether one of our graph tabs shows the project now. */
	open: boolean;
}

export interface SceneManuscriptPaneDeps {
	t: Translate;
	standing: SceneManuscriptStanding;
	/** Whether the project's file remembers settings from an earlier tab. */
	stored: boolean;
	readOnly: boolean;
	open(): void;
	reset(): void;
}

const words = (t: Translate, key: string): string => t(`relationshipGraph.sceneManuscript.${key}`);

export function renderSceneManuscriptPane(stage: HTMLElement, deps: SceneManuscriptPaneDeps): HTMLElement {
	const { t, standing } = deps;
	const { pane, body, actions } = renderNoticePane(stage, {
		name: 'scene-manuscript',
		lead: words(t, 'lead'),
	});
	const openButton = actions.createEl('button', {
		cls: 'mod-cta snowflake-method-scene-manuscript-open',
		text: words(t, 'open'),
		attr: { type: 'button' },
	});
	openButton.disabled = !standing.available;
	openButton.addEventListener('click', () => deps.open());
	if (deps.stored && !deps.readOnly) {
		const resetButton = actions.createEl('button', {
			cls: 'snowflake-method-scene-manuscript-reset',
			text: words(t, 'reset'),
			attr: { type: 'button' },
		});
		resetButton.addEventListener('click', () => deps.reset());
	}

	// Only what stands in the way is said: the plugin being off, or a project that keeps nothing.
	if (!standing.available) {
		body.createEl('p', { cls: 'snowflake-method-scene-manuscript-state is-disabled', text: words(t, 'disabled') });
	}
	if (deps.readOnly) {
		body.createEl('p', { cls: 'snowflake-method-scene-manuscript-read-only', text: words(t, 'readOnly') });
	}
	return pane;
}
