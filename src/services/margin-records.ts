/**
 * What every store of records kept beside the manuscript answers for: the
 * revisions and the foreshadowing each keep places in the chapters, and a
 * chapter written, renamed, split or merged is told to both the same way.
 * The plugin walks the list rather than naming each, so a third family of
 * records joins by joining the list.
 */

import type { ProjectRef } from "./types";

export interface MarginRecordService {
	/** Brings one note's stored places level with its saved body; true when anything moved. */
	refreshAnchorsOnSave(
		project: ProjectRef,
		path: string,
		savedBody: string,
	): Promise<boolean>;
	/** Carries records along with a renamed note or folder; true when any went. */
	renameNotePaths(
		project: ProjectRef,
		oldPath: string,
		newPath: string,
	): Promise<boolean>;
	/** Carries the records standing on text that walked into another note; true when any went. */
	carryTextBetweenNotes(
		project: ProjectRef,
		from: string,
		into: string,
		left: string,
		at: number,
		shift: number,
	): Promise<boolean>;
	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void;
}
