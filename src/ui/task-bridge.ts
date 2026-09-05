import type {
	DateFormat,
	DerivedTask,
	EntityRosterEntry,
	ForeshadowingStatus,
	Task,
	TaskStatus,
} from '../domain';
import type { LentFilterPopover } from './filter-rows';
import type { Translate } from './modals';
import type { TaskBoardMemory } from './task-board-rows';

/**
 * What the task board asks of the plugin, and what the dashboard lends it.
 * The board is one surface with two owners: the host answers for the
 * project's tasks and the readings the derived cards are computed from, and
 * the dashboard answers for where a derived card opens -- a tab of its own
 * -- and for the funnel popover it lends every panel.
 */

/** Where a derived card opens: a pane, a tab, and what to narrow it to. */
export type TaskNavigationTarget =
	| { kind: 'sessions' }
	| { kind: 'tracking'; section: 'unresolved' | 'sensitive' }
	| {
			kind: 'foreshadowing';
			status: ForeshadowingStatus[];
			standing: 'unresolved' | '';
	  }
	| { kind: 'revision'; standing: 'conflict' | '' }
	| { kind: 'stickyNotes' };

export interface TaskBoardReading {
	projectPath: string;
	locale: string;
	/** The project cannot be written to, so every action is off. */
	readOnly: boolean;
	/** The day the reading device is on, which is the day a due date is measured against. */
	today: string;
	/** The current week, first day through last, for the due filter. */
	week: { from: string; to: string };
	dateFormat: DateFormat;
	tasks: readonly Task[];
	derived: readonly DerivedTask[];
	/** A source could not be read, so its cards are missing rather than at nothing. */
	derivedFailed: boolean;
	/** Every entity a task can be about, for the funnel and for the names refs go by now. */
	roster: readonly EntityRosterEntry[];
}

export interface TaskBoardBridge {
	t: Translate;
	/** Everything, freshly derived; null while no project stands. */
	read: () => Promise<TaskBoardReading | null>;
	/** Fires when the tasks or any source of a derived card changed. */
	subscribe: (listener: () => void) => () => void;
	/** The day the device is on now, for the watch that notices midnight. */
	today: () => string;
	/** Opens the create form, in the column named. Resolves when the dialog is done with. */
	add: (status?: TaskStatus) => Promise<void>;
	edit: (id: string) => Promise<void>;
	/** Moves one task before a neighbour of the column, or to its end. False on a refusal. */
	move: (id: string, status: TaskStatus, beforeId: string | null) => Promise<boolean>;
	archive: (id: string) => Promise<boolean>;
	restore: (id: string) => Promise<boolean>;
	/** Takes a task out for good, confirmation and all; declining answers true. */
	deleteTask: (id: string) => Promise<boolean>;
	/** Takes every archived task out, confirmation and all; declining answers true. */
	emptyArchive: (ids: readonly string[]) => Promise<boolean>;
}

/** What the dashboard lends the board: its memory, its funnel, and its own tabs. */
export interface TaskBoardControls {
	memory: TaskBoardMemory;
	popover: LentFilterPopover;
	navigate: (target: TaskNavigationTarget) => void;
}
