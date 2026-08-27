import {
	isMentionIgnore,
	type MentionHit,
	type MentionIgnore,
} from "../domain";
import type { VaultRepository } from "../repository";
import { getProjectPathLayout, type ProjectRef } from "./types";

/**
 * The two files the mention analysis keeps in a project, written the way the
 * writing sessions write theirs: JSON in the project's own data folders,
 * atomic full rewrites, stat-stamped reads, and a file that will not parse
 * set aside whole rather than destroyed.
 *
 * They differ in what they are. The ignores are the reader's own choices --
 * user data, one shared file that travels with the vault, quarantined on
 * corruption so nothing a reader decided is ever thrown away. The index is a
 * derived cache -- one file per device, named like a session file so vault
 * sync never contests it, rebuilt from the manuscript whenever it is stale,
 * and overwritten without ceremony when it will not read.
 */

export const MENTION_STORE_SCHEMA_VERSION = 1;

export interface MentionIgnoreFile {
	schemaVersion: number;
	ignores: MentionIgnore[];
}

export interface MentionIndexNote {
	/** `${mtime}:${size}` of the note the hits were read from. */
	stamp: string;
	hits: MentionHit[];
}

export interface MentionIndexFile {
	schemaVersion: number;
	/** The entity matcher's combined fingerprint the hits were found with. */
	fingerprint: string;
	notes: Record<string, MentionIndexNote>;
}

export interface MentionStoreDeps {
	repository: VaultRepository;
	/** The device the index file is named for; the session device id. */
	deviceId: () => string;
	now: () => number;
	/** Told when a corrupt ignores file was set aside, for a notice upstream. */
	onCorrupt?: (path: string) => void;
}

export class MentionStore {
	/** Ignores by project root, valid only while the file's stamp holds. */
	private readonly ignoreMemo = new Map<
		string,
		{ stamp: string; ignores: readonly MentionIgnore[] }
	>();

	constructor(private readonly deps: MentionStoreDeps) {}

	ignoresPath(project: ProjectRef): string {
		const layout = getProjectPathLayout(project.locale);
		return `${project.rootPath}/${layout.directories.manuscriptAnalysis}/mention_ignores.json`;
	}

	indexPath(project: ProjectRef): string {
		const layout = getProjectPathLayout(project.locale);
		return `${project.rootPath}/${layout.directories.mentionIndex}/${this.deps.deviceId()}_mention_index.json`;
	}

	/**
	 * The project's ignore rules, read once per file version: a stamp match
	 * answers from memory, anything else re-reads. A file that will not parse
	 * is quarantined and read as empty; a missing file is simply no rules yet.
	 */
	async readIgnores(project: ProjectRef): Promise<readonly MentionIgnore[]> {
		const path = this.ignoresPath(project);
		const file = this.deps.repository.getFile(path);
		if (file === null) {
			this.ignoreMemo.delete(project.rootPath);
			return [];
		}
		const stamp = `${String(file.stat.mtime)}:${String(file.stat.size)}`;
		const kept = this.ignoreMemo.get(project.rootPath);
		if (kept !== undefined && kept.stamp === stamp) return kept.ignores;
		const content = await this.deps.repository.readPlainFile(path);
		const parsed = parseIgnoreFile(content);
		if (parsed === null) {
			await this.quarantine(path);
			this.ignoreMemo.delete(project.rootPath);
			return [];
		}
		this.ignoreMemo.set(project.rootPath, { stamp, ignores: parsed.ignores });
		return parsed.ignores;
	}

	/** Appends one rule; false when an identical rule already stands. */
	async addIgnore(project: ProjectRef, rule: MentionIgnore): Promise<boolean> {
		return this.updateIgnores(project, (ignores) => {
			if (ignores.some((kept) => sameIgnore(kept, rule))) return null;
			return [...ignores, rule];
		});
	}

	/** Removes one rule; false when no matching rule stands. */
	async removeIgnore(
		project: ProjectRef,
		rule: MentionIgnore,
	): Promise<boolean> {
		return this.updateIgnores(project, (ignores) => {
			const next = ignores.filter((kept) => !sameIgnore(kept, rule));
			return next.length === ignores.length ? null : next;
		});
	}

	/**
	 * This device's persisted index, or null when there is none to trust: a
	 * missing file, a schema this build does not write, or content that will
	 * not read. The index is a cache, so nothing is quarantined here; the
	 * next write simply replaces it.
	 */
	async readIndex(project: ProjectRef): Promise<MentionIndexFile | null> {
		const content = await this.deps.repository.readPlainFile(
			this.indexPath(project),
		);
		return parseIndexFile(content);
	}

	async writeIndex(
		project: ProjectRef,
		index: MentionIndexFile,
	): Promise<void> {
		const path = this.indexPath(project);
		const serialized = JSON.stringify(index);
		if (this.deps.repository.getFile(path) === null) {
			await this.deps.repository.createPlainFile(path, serialized);
			return;
		}
		await this.deps.repository.updatePlainFile(path, () => serialized);
	}

	/**
	 * Read-modify-write with the sessions' quarantine choreography: a file
	 * that will not parse is renamed aside whole and a healthy one starts
	 * where the change can land.
	 */
	private async updateIgnores(
		project: ProjectRef,
		mutate: (ignores: readonly MentionIgnore[]) => MentionIgnore[] | null,
	): Promise<boolean> {
		const path = this.ignoresPath(project);
		this.ignoreMemo.delete(project.rootPath);
		const serialize = (ignores: MentionIgnore[]): string =>
			`${JSON.stringify(
				{ schemaVersion: MENTION_STORE_SCHEMA_VERSION, ignores },
				null,
				"\t",
			)}\n`;
		if (this.deps.repository.getFile(path) === null) {
			const next = mutate([]);
			if (next === null) return false;
			await this.deps.repository.createPlainFile(path, serialize(next));
			return true;
		}
		let corrupt = false;
		let changed = false;
		await this.deps.repository.updatePlainFile(path, (current) => {
			const parsed = parseIgnoreFile(current);
			if (parsed === null) {
				corrupt = true;
				return current;
			}
			const next = mutate(parsed.ignores);
			if (next === null) return current;
			changed = true;
			return serialize(next);
		});
		if (!corrupt) return changed;
		await this.quarantine(path);
		const next = mutate([]);
		if (next === null) return false;
		await this.deps.repository.createPlainFile(path, serialize(next));
		return true;
	}

	private async quarantine(path: string): Promise<void> {
		const aside = path.replace(
			/\.json$/u,
			`.corrupted-${String(this.deps.now())}.json`,
		);
		await this.deps.repository.renameFile(path, aside);
		this.deps.onCorrupt?.(aside);
	}
}

const ignoreKey = (rule: MentionIgnore): string =>
	JSON.stringify([
		rule.scope,
		"notePath" in rule ? rule.notePath : "",
		"memberPath" in rule ? rule.memberPath : "",
		rule.matchedText,
		rule.scope === "occurrence" ? rule.ordinal : -1,
	]);

const sameIgnore = (left: MentionIgnore, right: MentionIgnore): boolean =>
	ignoreKey(left) === ignoreKey(right);

/**
 * Reads an ignores file, or refuses it whole. Individual entries that fail
 * the shape are dropped rather than dooming the file; a schema this build
 * does not know refuses instead, so a downgrade quarantines rather than
 * silently rewriting what a newer build meant.
 */
function parseIgnoreFile(content: string | null): MentionIgnoreFile | null {
	const parsed = parseJsonObject(content);
	if (parsed === null) return null;
	if (parsed.schemaVersion !== MENTION_STORE_SCHEMA_VERSION) return null;
	if (!Array.isArray(parsed.ignores)) return null;
	return {
		schemaVersion: MENTION_STORE_SCHEMA_VERSION,
		ignores: parsed.ignores.filter(isMentionIgnore),
	};
}

/** Reads an index file leniently: a note entry that does not hold its shape
 *  is dropped alone, because every entry stands or falls by its own stamp. */
function parseIndexFile(content: string | null): MentionIndexFile | null {
	const parsed = parseJsonObject(content);
	if (parsed === null) return null;
	if (parsed.schemaVersion !== MENTION_STORE_SCHEMA_VERSION) return null;
	if (typeof parsed.fingerprint !== "string") return null;
	if (typeof parsed.notes !== "object" || parsed.notes === null) return null;
	const notes: Record<string, MentionIndexNote> = {};
	for (const [path, note] of Object.entries(
		parsed.notes as Record<string, unknown>,
	)) {
		if (typeof note !== "object" || note === null) continue;
		const entry = note as Record<string, unknown>;
		if (typeof entry.stamp !== "string" || !Array.isArray(entry.hits)) {
			continue;
		}
		notes[path] = {
			stamp: entry.stamp,
			hits: entry.hits as MentionHit[],
		};
	}
	return {
		schemaVersion: MENTION_STORE_SCHEMA_VERSION,
		fingerprint: parsed.fingerprint,
		notes,
	};
}

function parseJsonObject(
	content: string | null,
): Record<string, unknown> | null {
	if (content === null) return null;
	try {
		const parsed: unknown = JSON.parse(content);
		if (typeof parsed !== "object" || parsed === null) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}
