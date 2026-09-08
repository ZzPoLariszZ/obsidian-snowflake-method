/**
 * What the ordered corkboard is handed by the view that mounts it, and what
 * it hands back. The board asks the plugin for nothing but the host's own
 * methods; the model it draws from is the view's, read through `model()`,
 * and a write of the board's own is followed by `refresh()`, which resolves
 * only once a read begun after the write has landed.
 */

import type { App } from 'obsidian';

import type { LentFilterPopover } from './filter-rows';
import type { Translate } from './modals';
import type { CorkboardMemory } from './story-structure-state';
import type { DashboardHost, ProjectDashboardModel } from './view-model';

/** The host's own methods the board calls, and no others. */
export type CorkboardHost = Pick<
	DashboardHost,
	| 'openManagedFile'
	| 'openManuscriptStream'
	| 'openSceneForm'
	| 'openCharacterForm'
	| 'patchScene'
	| 'reorderScene'
	| 'deleteScene'
	| 'listManuscriptNotes'
	| 'isReduceMotionEnabled'
>;

export interface CorkboardControls {
	app: App;
	host: CorkboardHost;
	/** Speaks the loaded project's language; rebuilt with the board when it changes. */
	t: Translate;
	/** The model the view last loaded; null before the first load or with no project. */
	model(): ProjectDashboardModel | null;
	/** Re-reads the project; resolves after `handle.refresh()` has been called with the new model. */
	refresh(): Promise<void>;
	popover: LentFilterPopover;
	memory: CorkboardMemory;
	/** Call after changing the settings the view persists, so it saves the layout. */
	remember(): void;
}

export interface CorkboardHandle {
	/** Redraws from `controls.model()`; the view calls it on every refresh that is not a rebuild. */
	refresh(): void;
	/** Scrolls a scene's card into view and gives it the focus. */
	reveal(id: string): void;
	/** Lays the cards out again for the width the board has now. */
	remeasure(): void;
	/**
	 * Saves the conflict box holding the focus, for the view's own key
	 * scope: the app's keymap takes Mod+Enter at the window before a
	 * textarea ever sees it. True when a box was saved.
	 */
	saveFocusedConflict(): boolean;
	dispose(): void;
}

export type RenderCorkboard = (
	host: HTMLElement,
	controls: CorkboardControls,
) => CorkboardHandle;
