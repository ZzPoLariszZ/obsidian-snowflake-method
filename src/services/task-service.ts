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

/** What a write changed, told once the file holds it, for the history to record. */
export type TaskServiceEvent =
	| { kind: "created"; tasks: readonly Task[] }
	/** A task now standing in another column; the task carries the new status. */
	| { kind: "status"; task: Task }
	| { kind: "archived"; task: Task }
	| { kind: "deleted"; tasks: readonly Task[] };

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

	/**
	 * Told about every write that changed what a task is or where it
	 * stands -- never a reorder within its column -- once the file holds
	 * it. The modification history listens. These are the acting device's
	 * own calls, so another device's write synced in never sounds here.
	 */
	onEvent: ((project: ProjectRef, event: TaskServiceEvent) => void) | null = null;

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
	async create(project: ProjectRef, task: Task): Promise<boolean> {
		const wrote = await this.store.updateTasks(project, (tasks) => {
			if (tasks.some((kept) => kept.id === task.id)) return null;
			return [...tasks, { ...task, related: task.related.map(refOf) }];
		});
		if (wrote) this.tell(project, { kind: "created", tasks: [task] });
		return wrote;
	}

	/**
	 * Appends tasks in order, in one write; a task whose id already stands,
	 * in the file or earlier in the batch, is left out. The ids appended.
	 */
	async createMany(project: ProjectRef, tasks: readonly Task[]): Promise<string[]> {
		let fresh: Task[] = [];
		const wrote = await this.store.updateTasks(project, (kept) => {
			const standing = new Set(kept.map((task) => task.id));
			fresh = [];
			for (const task of tasks) {
				if (standing.has(task.id)) continue;
				standing.add(task.id);
				fresh.push({ ...task, related: task.related.map(refOf) });
			}
			return fresh.length === 0 ? null : [...kept, ...fresh];
		});
		if (!wrote) return [];
		this.tell(project, { kind: "created", tasks: fresh });
		return fresh.map((task) => task.id);
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
		let moved = null as Task | null;
		const wrote = await this.store.updateTasks(project, (tasks) => {
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
			moved = edited;
			return moveTaskBefore(written, id, edited.status, null, now) ?? written;
		});
		if (!asked) return "refused";
		if (wrote && moved !== null) this.tell(project, { kind: "status", task: moved });
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
		let moved = null as Task | null;
		const wrote = await this.store.updateTasks(project, (tasks) => {
			asked = true;
			const kept = tasks.find((task) => task.id === id);
			if (kept === undefined) return null;
			found = true;
			const next = moveTaskBefore(tasks, id, status, beforeId, this.now());
			// A move to another column is news; a reorder within one is not.
			if (next !== null && kept.status !== status) {
				moved = next.find((task) => task.id === id) ?? null;
			}
			return next;
		});
		if (!asked) return "refused";
		if (wrote && moved !== null) this.tell(project, { kind: "status", task: moved });
		return found ? "written" : "absent";
	}

	/** Sets a task aside, or brings it back to where it stood. */
	async setArchived(
		project: ProjectRef,
		id: string,
		archived: boolean,
	): Promise<TaskWrite> {
		let changed = null as Task | null;
		const outcome = await this.revise(project, id, (kept) => {
			if (kept.archived === archived) return null;
			changed = { ...kept, archived, updatedAt: this.now() };
			return changed;
		});
		if (outcome === "written" && changed !== null && archived) {
			this.tell(project, { kind: "archived", task: changed });
		}
		return outcome;
	}

	/**
	 * Takes tasks out for good, one write for one or many, and says which
	 * of three things happened: gone as asked, none of them there, or a
	 * write the store refused with every task left standing. Emptying the
	 * archive asks for the archived ones alone: the ids were gathered
	 * before a confirmation stood open, and a task brought back meanwhile
	 * -- by another window, another device, or a hand in the file -- is
	 * spared by the flag it wears at the moment of the write, not the
	 * moment of the question.
	 */
	async remove(
		project: ProjectRef,
		ids: readonly string[],
		options: { archivedOnly?: boolean } = {},
	): Promise<TaskDeletion> {
		const gone = new Set(ids);
		let asked = false;
		let found = false;
		let removed: Task[] = [];
		const wrote = await this.store.updateTasks(project, (tasks) => {
			asked = true;
			const spared = (task: Task): boolean =>
				!gone.has(task.id) || (options.archivedOnly === true && !task.archived);
			const next = tasks.filter(spared);
			removed = tasks.filter((task) => !spared(task));
			found = next.length !== tasks.length;
			return found ? next : null;
		});
		if (!asked) return "refused";
		if (wrote && removed.length > 0) this.tell(project, { kind: "deleted", tasks: removed });
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

	private tell(project: ProjectRef, event: TaskServiceEvent): void {
		this.onEvent?.(project, event);
	}
}
