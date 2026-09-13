/**
 * What the corkboard is handed by the view that mounts it, and what
 * it hands back. The board asks the plugin for nothing but the host's own
 * methods; the model it draws from is the view's, read through `model()`,
 * and a write of the board's own is followed by `refresh()`, which resolves
 * only once a read begun after the write has landed.
 */

import type { App } from 'obsidian';

import type { LentFilterPopover } from './filter-rows';
import type { Translate } from './modals';
import type { CorkboardMemory, CorkboardPreferences } from './story-structure-state';
import type { DashboardHost, ProjectDashboardModel, SceneViewModel } from './view-model';

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
	| 'listDefinitionPaths'
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
	/** Makes the board's project current before a host action reads or writes it. */
	activateProject(): void;
	/** Re-reads the project; resolves after `handle.refresh()` has been called with the new model. */
	refresh(): Promise<void>;
	popover: LentFilterPopover;
	memory: CorkboardMemory;
	/** Save the tab layout and, when provided, the individual project preferences changed. */
	remember(changes?: Partial<CorkboardPreferences>): void;
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

/**
 * How a board may stand apart from the plain corkboard: as a pool of some
 * scenes rather than all, dealt in one column, its cards leaving under
 * another surface's drag type and that surface's cards landing on it. With
 * nothing set the board is the corkboard.
 */
export interface CorkboardVariant {
	/**
	 * The scenes the board may show at all, applied after the search and the
	 * funnel so a card keeps its narrative number. A board showing a subset
	 * never offers the neighbourly actions, since its neighbours are not the
	 * order's.
	 */
	include?: (scene: SceneViewModel) => boolean;
	/** The band's add button: the labelled call to action, or a plus icon alone. */
	addButton?: 'label' | 'icon';
	/** A fixed column count, whatever the width. */
	columns?: number;
	/** The gap between cards in rem; the board's own leaves room for its insertion buttons. */
	gap?: number;
	/** Said when the board has no scene to offer, instead of the corkboard's own line. */
	emptyText?: string;
	/**
	 * Cards leave the board under this type, whatever the adjacency; the
	 * board's own reorder drag is off. The type must not be the corkboard's
	 * own, or a card would land on a corkboard in another leaf.
	 */
	dragOut?: {
		type: string;
		onStart: (sceneId: string, transfer: DataTransfer) => void;
		onEnd: () => void;
	};
	/** Drops of another surface's type land on the board as a whole. */
	dropIn?: {
		accepts: (types: readonly string[]) => boolean;
		onDrop: (transfer: DataTransfer) => void;
	};
}

export type RenderCorkboard = (
	host: HTMLElement,
	controls: CorkboardControls,
	variant?: CorkboardVariant,
) => CorkboardHandle;
