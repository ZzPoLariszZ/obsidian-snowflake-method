/**
 * The numbers the file explorer shows beside its rows: a note's total under
 * the counting rule in force, and a folder's sum of the notes beneath it.
 * Notes are counted by the writing count service, which remembers each by
 * its stat; this service remembers the folder sums and lets them go up the
 * ancestor chain when anything beneath changes, so a saved note recounts
 * one note and re-adds its parents from what is already known.
 *
 * Work is asked for in rows, the newest-visible first, and done one at a
 * time with a breath every few milliseconds, so a cold vault fills in
 * without holding the window. Plugin-made notes carry no number and add
 * nothing, so a folder's total never moves with the tidy button.
 */

import { TFile, TFolder, type TAbstractFile } from "obsidian";

export interface ExplorerCountDeps {
	/** One note's headline total under the current rule, or null when it cannot be read. */
	countNote(path: string): Promise<number | null>;
	fileAt(path: string): TAbstractFile | null;
	/** Whether a note is the plugin's own, which counts for nothing here. */
	pluginMade(path: string): boolean;
	/** Told after a note was counted, so the host can let its text go where nothing else wants it. */
	counted(path: string): void;
	breathe(): Promise<void>;
}

export type ExplorerCountListener = (path: string, total: number | null) => void;

/** How long a folder walk works between breaths. */
const BREATH_MS = 12;

function stampOf(file: TFile): string {
	return `${file.stat.mtime}:${file.stat.size}`;
}

export class ExplorerCountService {
	private readonly notes = new Map<string, { stamp: string; total: number | null }>();
	private readonly folders = new Map<string, number>();
	private readonly queue: string[] = [];
	private readonly queued = new Set<string>();
	private readonly waiting = new Map<string, Set<ExplorerCountListener>>();
	private running = false;
	/** Bumped by `clear()`, so a count begun under the old rule is dropped on arrival. */
	private generation = 0;

	constructor(private readonly deps: ExplorerCountDeps) {}

	/** A note's total as remembered: null for a note that will not read, undefined when it must be asked for. */
	noteTotal(path: string): number | null | undefined {
		const file = this.deps.fileAt(path);
		if (!(file instanceof TFile)) return undefined;
		const kept = this.notes.get(path);
		return kept !== undefined && kept.stamp === stampOf(file) ? kept.total : undefined;
	}

	/** A folder's sum as remembered, or undefined when it must be asked for. */
	folderTotal(path: string): number | undefined {
		return this.folders.get(path);
	}

	/** Asks for the totals of these paths, the first of them first, and tells the listener of each as it lands. */
	request(paths: readonly string[], listener: ExplorerCountListener): void {
		for (const path of [...paths].reverse()) {
			const listeners = this.waiting.get(path) ?? new Set<ExplorerCountListener>();
			listeners.add(listener);
			this.waiting.set(path, listeners);
			if (this.queued.has(path)) continue;
			this.queued.add(path);
			this.queue.unshift(path);
		}
		void this.run();
	}

	/** Lets go of what is remembered at a path, beneath it when asked, and of every folder sum above it. */
	invalidate(path: string, { children = false } = {}): void {
		this.notes.delete(path);
		this.folders.delete(path);
		if (children) {
			const prefix = `${path}/`;
			for (const key of [...this.notes.keys()]) {
				if (key.startsWith(prefix)) this.notes.delete(key);
			}
			for (const key of [...this.folders.keys()]) {
				if (key.startsWith(prefix)) this.folders.delete(key);
			}
		}
		let current = path;
		while (current !== "/" && current.length > 0) {
			const slash = current.lastIndexOf("/");
			current = slash === -1 ? "/" : current.slice(0, slash);
			this.folders.delete(current);
		}
	}

	/** Forgets everything: the rule changed, so every number is owed again. */
	clear(): void {
		this.generation += 1;
		this.notes.clear();
		this.folders.clear();
		this.queue.length = 0;
		this.queued.clear();
		this.waiting.clear();
	}

	private async run(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			for (;;) {
				const path = this.queue.shift();
				if (path === undefined) break;
				this.queued.delete(path);
				const generation = this.generation;
				let total: number | null | undefined;
				try {
					total = await this.totalOf(path, generation);
				} catch (error: unknown) {
					console.error(`Snowflake: could not count ${path}`, error);
					total = undefined;
				}
				if (generation !== this.generation) continue;
				const listeners = this.waiting.get(path);
				this.waiting.delete(path);
				if (total === undefined || listeners === undefined) continue;
				for (const listener of listeners) listener(path, total);
			}
		} finally {
			this.running = false;
		}
	}

	private async totalOf(path: string, generation: number): Promise<number | null | undefined> {
		const file = this.deps.fileAt(path);
		if (file instanceof TFile) return this.countFile(file, generation);
		if (file instanceof TFolder) return this.sumFolder(file, generation);
		return undefined;
	}

	private async countFile(file: TFile, generation: number): Promise<number | null> {
		const stamp = stampOf(file);
		const kept = this.notes.get(file.path);
		if (kept !== undefined && kept.stamp === stamp) return kept.total;
		const total = await this.deps.countNote(file.path);
		// Remembered under the stat read before the count: a note written
		// meanwhile stamps differently and is counted again when next asked.
		if (generation === this.generation) this.notes.set(file.path, { stamp, total });
		this.deps.counted(file.path);
		return total;
	}

	private async sumFolder(folder: TFolder, generation: number): Promise<number> {
		const kept = this.folders.get(folder.path);
		if (kept !== undefined) return kept;
		let sum = 0;
		let lastBreath = Date.now();
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				sum += await this.sumFolder(child, generation);
			} else if (
				child instanceof TFile &&
				child.extension === "md" &&
				!this.deps.pluginMade(child.path)
			) {
				const total = await this.countFile(child, generation);
				if (total !== null) sum += total;
			}
			if (generation !== this.generation) return sum;
			if (Date.now() - lastBreath >= BREATH_MS) {
				await this.deps.breathe();
				lastBreath = Date.now();
			}
		}
		if (generation === this.generation) this.folders.set(folder.path, sum);
		return sum;
	}
}
