/**
 * What the corkboard is handed by the view that mounts it, and what
 * it hands back. The board asks the plugin for nothing but the host's own
 * methods; the model it draws from is the view's, read through `model()`,
 * and a write of the board's own is followed by `refresh()`, which resolves
 * only once a read begun after the write has landed.
 */

import type { App, Menu } from 'obsidian';

import type { LentFilterPopover } from './filter-rows';
import type { FullScreenControl } from './full-screen';
import type { Translate } from './modals';
import type { EntityFilters } from './entity-filters';
import type { SceneFilters } from './scene-filters';
import type { CorkboardMemory, CorkboardPreferences, CorkboardView } from './story-structure-state';
import type { DashboardHost, ProjectDashboardModel, SceneViewModel } from './view-model';

/** The host's own methods the board calls, and no others. */
export type CorkboardHost = Pick<
	DashboardHost,
	| 'openManagedFile'
	| 'openManuscriptStream'
	| 'openSceneForm'
	| 'openCharacterForm'
	| 'openCreateCharacterForm'
	| 'openEntityForm'
	| 'patchScene'
	| 'patchCharacter'
	| 'patchEntity'
	| 'reorderScene'
	| 'reorderCharacter'
	| 'reorderEntity'
	| 'deleteScene'
	| 'deleteCharacter'
	| 'deleteEntity'
	| 'listDefinitionPaths'
	| 'listManuscriptNotes'
	| 'isReduceMotionEnabled'
>;

/** The funnel's answers a board may be handed: the scene view's, or an entity view's. */
export type CorkboardFilters = SceneFilters | EntityFilters;

export interface CorkboardControls<Filters = CorkboardFilters> {
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
	/** True while the plugin is unloading, when a dialog opened now would outlive its owner. */
	unloading?(): boolean;
	popover: LentFilterPopover;
	memory: CorkboardMemory<Filters>;
	/** Save the tab layout and, when provided, the individual project preferences changed. */
	remember(changes?: Partial<CorkboardPreferences>): void;
	/**
	 * The views the board may show, for the field at its band's start; a
	 * board with none, the pools, shows the scenes with no field.
	 */
	views?: {
		choose(view: CorkboardView): void;
	};
	/** The window, to fill with the board and to hand back; none on a board that stands in another's frame. */
	fullScreen?: FullScreenControl;
}

export interface CorkboardHandle {
	/** Redraws from `controls.model()`; the view calls it on every refresh that is not a rebuild. */
	refresh(): void;
	/** Scrolls a scene's card into view and gives it the focus. */
	reveal(id: string): void;
	/** Lays the cards out again for the width the board has now. */
	remeasure(): void;
	/**
	 * Saves the body box holding the focus, a scene's conflict or an
	 * entity's one sentence, for the view's own key scope: the app's keymap
	 * takes Mod+Enter at the window before a textarea ever sees it. True
	 * when a box was saved.
	 */
	saveFocusedBody(): boolean;
	dispose(): void;
}

/**
 * How a board may stand apart from the plain corkboard: as a pool of some
 * scenes rather than all, dealt in one column, its cards leaving under
 * another surface's drag type and that surface's cards landing on it. With
 * nothing set the board is the corkboard.
 */
export interface CorkboardVariant<Member = SceneViewModel> {
	/**
	 * The notes the board may show at all, applied after the search and the
	 * funnel so a card keeps its narrative number. A board showing a subset
	 * never offers the neighbourly actions, since its neighbours are not the
	 * order's.
	 */
	include?: (member: Member) => boolean;
	/** The band's add button: the labelled call to action, or a plus icon alone. */
	addButton?: 'label' | 'icon';
	/**
	 * Where the search field says what it searches: written in the field, or
	 * kept quiet, for a band with no room to spare for the words. Quiet leaves
	 * the name on the field for a screen reader and under the pointer, so only
	 * the sighted reader glancing past it gives anything up.
	 */
	searchLabel?: 'placeholder' | 'quiet';
	/** A fixed column count, whatever the width. */
	columns?: number;
	/** The gap between cards in rem; the board's own leaves room for its insertion buttons. */
	gap?: number;
	/** Said when the board has no scene to offer, instead of the corkboard's own line. */
	emptyText?: string;
	/**
	 * The card style chosen on this board dresses cards on another surface
	 * as well, so the display control stays while the board shows nothing.
	 */
	modeShared?: boolean;
	/** Items the hosting surface adds to a card's menu beside its own drag actions. */
	menuItems?: (sceneId: string, menu: Menu) => void;
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
