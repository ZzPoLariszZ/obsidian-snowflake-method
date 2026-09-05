import {
	moveTaskBefore,
	sameTaskEdit,
	type EntityRef,
	type Task,
	type TaskEdit,
	type TaskStatus,
} from "../domain";
import type { VaultRepository } from "../repository";
import { TaskStore } from "./task-store";
import type { ProjectRef } from "./types";

/** What a write came to: the record now says what was asked, or why not. */
export type TaskWrite = "written" | "absent" | "refused";
/** What a deletion came to. */
export type TaskDeletion = "deleted" | "absent" | "refused";

/** The limbs of a ref alone, whatever else rode in on the object. */
const refOf = (ref: EntityRef): EntityRef => ({
	kind: ref.kind,
	id: ref.id,
	name: ref.name,
});

/**
 * The tasks of one project, as the board asks about them: a list to read
 * and mutations that land in the file at once -- a task is something the
 * author wrote down, so nothing here waits on a quiet timer. The file's
 * order is the board's order, so a move is a record moved, worked out
 * against a neighbour rather than a position (`moveTaskBefore`).
 *
 * `updatedAt` is the author's clock: an edit, a change of column and the
 * archive flag stamp it, and a reorder within a column does not -- the task
 * is the same task standing somewhere else.
 */
export class TaskService {
	private readonly store: TaskStore;
	private readonly now: () => number;

	constructor(
		repository: VaultRepository,
		deps: {
			now: () => number;
			onCorrupt?: (path: string) => void;
			onForeign?: (path: string, version: number) => void;
		},
	) {
		this.now = deps.now;
		this.store = new TaskStore({
			repository,
			now: deps.now,
			...(deps.onCorrupt === undefined ? {} : { onCorrupt: deps.onCorrupt }),
			...(deps.onForeign === undefined ? {} : { onForeign: deps.onForeign }),
		});
	}

	list(project: ProjectRef): Promise<readonly Task[]> {
		return this.store.readTasks(project);
	}

	/** Appends one task, last in its column; false when its id already stands. */
	create(project: ProjectRef, task: Task): Promise<boolean> {
		return this.store.updateTasks(project, (tasks) => {
			if (tasks.some((kept) => kept.id === task.id)) return null;
			return [...tasks, { ...task, related: task.related.map(refOf) }];
		});
	}

	/**
	 * The limbs a form hands back, written in one go: nothing is written
	 * when the form changed nothing. A task the form moved to another column
	 * goes to that column's end, where a dropped card would land.
	 */
	async edit(
		project: ProjectRef,
		id: string,
		next: TaskEdit,
	): Promise<TaskWrite> {
		let asked = false;
		let found = false;
		await this.store.updateTasks(project, (tasks) => {
			asked = true;
			const kept = tasks.find((task) => task.id === id);
			if (kept === undefined) return null;
			found = true;
			const revised: TaskEdit = { ...next, related: next.related.map(refOf) };
			if (sameTaskEdit(kept, revised)) return null;
			const now = this.now();
			const edited: Task = { ...kept, ...revised, updatedAt: now };
			const written = tasks.map((task) => (task.id === id ? edited : task));
			if (edited.status === kept.status) return written;
			return moveTaskBefore(written, id, edited.status, null, now) ?? written;
		});
		if (!asked) return "refused";
		return found ? "written" : "absent";
	}

	/**
	 * One task moved to a column, before a neighbour or at the column's end;
	 * nothing is written when it already stands there.
	 */
	async move(
		project: ProjectRef,
		id: string,
		status: TaskStatus,
		beforeId: string | null,
	): Promise<TaskWrite> {
		let asked = false;
		let found = false;
		await this.store.updateTasks(project, (tasks) => {
			asked = true;
			if (!tasks.some((task) => task.id === id)) return null;
			found = true;
			return moveTaskBefore(tasks, id, status, beforeId, this.now());
		});
		if (!asked) return "refused";
		return found ? "written" : "absent";
	}

	/** Sets a task aside, or brings it back to where it stood. */
	setArchived(
		project: ProjectRef,
		id: string,
		archived: boolean,
	): Promise<TaskWrite> {
		return this.revise(project, id, (kept) =>
			kept.archived === archived
				? null
				: { ...kept, archived, updatedAt: this.now() },
		);
	}

	/**
	 * Takes tasks out for good, one write for one or many, and says which
	 * of three things happened: gone as asked, none of them there, or a
	 * write the store refused with every task left standing.
	 */
	async remove(
		project: ProjectRef,
		ids: readonly string[],
	): Promise<TaskDeletion> {
		const gone = new Set(ids);
		let asked = false;
		let found = false;
		await this.store.updateTasks(project, (tasks) => {
			asked = true;
			const next = tasks.filter((task) => !gone.has(task.id));
			found = next.length !== tasks.length;
			return found ? next : null;
		});
		if (!asked) return "refused";
		return found ? "deleted" : "absent";
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}

	/**
	 * One task changed in one write. `change` answers the task as it should
	 * now stand, or null when it already does; the three-way answer tells a
	 * task that is gone from a write the store refused.
	 */
	private async revise(
		project: ProjectRef,
		id: string,
		change: (kept: Task) => Task | null,
	): Promise<TaskWrite> {
		let asked = false;
		let found = false;
		await this.store.updateTasks(project, (tasks) => {
			asked = true;
			const kept = tasks.find((task) => task.id === id);
			if (kept === undefined) return null;
			found = true;
			const next = change(kept);
			if (next === null) return null;
			return tasks.map((task) => (task.id === id ? next : task));
		});
		if (!asked) return "refused";
		return found ? "written" : "absent";
	}
}
