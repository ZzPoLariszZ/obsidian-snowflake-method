import {
	isMentionIgnore,
	type MentionHit,
	type MentionIgnore,
	type SensitiveHit,
} from "../domain";
import type { VaultRepository } from "../repository";
import {
	createOrUpdatePlainFile,
	fileStamp,
	parseJsonObject,
	quarantineJsonFile,
} from "./json-store";
import {
	PROJECT_PATH_LAYOUTS,
	getProjectPathLayout,
	type ProjectRef,
} from "./types";

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

/**
 * The manuscript analysis cache is its own file with its own schema line:
 * the constant above is shared by the ignores -- user data whose quarantine
 * must never fire on a cache-format change -- so this one moves alone.
 */
export const ANALYSIS_FILE_SCHEMA_VERSION = 1;

const INDEX_CACHE_SUFFIX = "_mention_index.json";
const ANALYSIS_CACHE_SUFFIX = "_analysis_stats.json";
const CACHE_FOLDER_TAILS = Object.values(PROJECT_PATH_LAYOUTS).map(
	(layout) => ({
		analysis: `/${layout.directories.manuscriptAnalysis}`,
		index: `/${layout.directories.mentionIndex}`,
	}),
);

/**
 * Generated analysis files carry no authored changes. Their writes must not
 * ask the panels that computed them to read again. Match the full folder
 * chain and a device-prefixed cache name, including the analysis cache's
 * former home; ignore rules and other project records are not caches.
 * The caller checks project ownership before using this path-only test.
 */
export function isManuscriptCachePath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return false;
	const name = path.slice(slash + 1);
	const folder = path.slice(0, slash);
	const isIndex =
		name.length > INDEX_CACHE_SUFFIX.length && name.endsWith(INDEX_CACHE_SUFFIX);
	const isAnalysis =
		name.length > ANALYSIS_CACHE_SUFFIX.length && name.endsWith(ANALYSIS_CACHE_SUFFIX);
	if (!isIndex && !isAnalysis) return false;
	return CACHE_FOLDER_TAILS.some(
		(tail) =>
			folder.endsWith(tail.index) ||
			(isAnalysis && folder.endsWith(tail.analysis)),
	);
}

/**
 * What the statistics keep per note: small numbers, cheap to hold.
 *
 * Two measures, because two questions are asked. `cjk` and `words` are the
 * script split -- writing counted one character at a time on one side and in
 * words on the other -- and reading time is the only thing that needs it, a
 * minute of Chinese and a minute of English holding different amounts. Every
 * number a reader is shown is `counted` instead: the note's length under the
 * counting convention the reader chose, the same number their status bar says,
 * so no two places in the plugin can quote one chapter differently.
 */
export interface NoteProseStats {
	cjk: number;
	words: number;
	/** The note's length by the reader's own convention. */
	counted: number;
	sentences: number;
	/** How much of that length stands inside quotation marks. */
	dialogueCounted: number;
}

/**
 * One note's analysis families, each nullable on its own: a family whose
 * fingerprint moved is dropped alone, and the expensive tokens survive a
 * sensitive-list edit untouched.
 */
export interface AnalysisNoteRecord {
	/** `${mtime}:${size}` of the note every kept family was read from. */
	stamp: string;
	sensitive: SensitiveHit[] | null;
	/** Dialogue ranges as `[from, to]` pairs. */
	dialogue: [number, number][] | null;
	stats: NoteProseStats | null;
	/** The note's word tokens as `[term, count]` pairs, filter-free. */
	tokens: [string, number][] | null;
}

export interface AnalysisFile {
	schemaVersion: number;
	sensitiveFingerprint: string;
	dialogueFingerprint: string;
	statsFingerprint: string;
	tokensFingerprint: string;
	notes: Record<string, AnalysisNoteRecord>;
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

	/**
	 * The rules stand beside the index they qualify, under the tab that shows
	 * them: an ignore rule is entity tracking, and the folders are named after
	 * the tabs. A build before this one had these two files in each other's
	 * folders, so both are still read from wherever they stand.
	 */
	ignoresPath(project: ProjectRef): string {
		const layout = getProjectPathLayout(project.locale);
		return `${project.rootPath}/${layout.directories.mentionIndex}/mention_ignores.json`;
	}

	/** Where an older build left the rules: prose analysis, one folder up. */
	private formerIgnoresPath(project: ProjectRef): string {
		const layout = getProjectPathLayout(project.locale);
		return `${project.rootPath}/${layout.directories.manuscriptAnalysis}/mention_ignores.json`;
	}

	/**
	 * The path a rules file actually stands at, its own home preferred. A read
	 * moves nothing: rules written by an older build keep working exactly where
	 * they are, and a vault shared with one goes on agreeing with it.
	 */
	private standingIgnoresPath(project: ProjectRef): string {
		const path = this.ignoresPath(project);
		if (this.deps.repository.getFile(path) !== null) return path;
		const former = this.formerIgnoresPath(project);
		return this.deps.repository.getFile(former) === null ? path : former;
	}

	/**
	 * The same, for a write: a file still standing where the older build left
	 * it moves home first, so one edit never leaves two files to disagree. A
	 * move that will not go is not the edit -- the rules stay where they are
	 * and the change still lands on them.
	 */
	private async settledIgnoresPath(project: ProjectRef): Promise<string> {
		const path = this.ignoresPath(project);
		if (this.deps.repository.getFile(path) !== null) return path;
		const former = this.formerIgnoresPath(project);
		if (this.deps.repository.getFile(former) === null) return path;
		try {
			await this.deps.repository.renameFile(former, path);
		} catch {
			return this.deps.repository.getFile(former) === null ? path : former;
		}
		return path;
	}

	indexPath(project: ProjectRef): string {
		const layout = getProjectPathLayout(project.locale);
		return `${project.rootPath}/${layout.directories.mentionIndex}/${this.deps.deviceId()}${INDEX_CACHE_SUFFIX}`;
	}

	/**
	 * The two files a build before this one filed in each other's folders, each
	 * beside the home it belongs in: the rules, and this device's own analysis
	 * cache. Both move by themselves in time -- the rules on the next edit, the
	 * cache on the next write -- so this is for the health check, which offers
	 * to do it now instead. Another device's cache is not named here: it is
	 * that device's to move, and taking it would cost it a rebuild.
	 */
	formerStatisticsFiles(
		project: ProjectRef,
	): { former: string; home: string }[] {
		return [
			{
				former: this.formerIgnoresPath(project),
				home: this.ignoresPath(project),
			},
			{
				former: this.formerAnalysisPath(project),
				home: this.analysisPath(project),
			},
		];
	}

	/**
	 * The project's ignore rules, read once per file version: a stamp match
	 * answers from memory, anything else re-reads. A file that will not parse
	 * is quarantined and read as empty; a missing file is simply no rules yet.
	 */
	async readIgnores(project: ProjectRef): Promise<readonly MentionIgnore[]> {
		const path = this.standingIgnoresPath(project);
		const file = this.deps.repository.getFile(path);
		if (file === null) {
			this.ignoreMemo.delete(project.rootPath);
			return [];
		}
		const stamp = fileStamp(file);
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
		await this.writeJsonFile(this.indexPath(project), index);
	}

	/**
	 * The prose analysis folder, where the statistics and the word tokens are
	 * shown. The sensitive and dialogue families ride in the same file because
	 * one read refreshes all four, which is the economy the whole cache rests
	 * on; the two that answer the tracking tab are its passengers.
	 */
	analysisPath(project: ProjectRef): string {
		const layout = getProjectPathLayout(project.locale);
		return `${project.rootPath}/${layout.directories.manuscriptAnalysis}/${this.deps.deviceId()}${ANALYSIS_CACHE_SUFFIX}`;
	}

	/** Where an older build left this device's cache: entity tracking. */
	private formerAnalysisPath(project: ProjectRef): string {
		const layout = getProjectPathLayout(project.locale);
		return `${project.rootPath}/${layout.directories.mentionIndex}/${this.deps.deviceId()}${ANALYSIS_CACHE_SUFFIX}`;
	}

	/**
	 * This device's persisted analysis, or null when there is none to trust.
	 * A cache like the index: never quarantined, simply rebuilt. The older
	 * build's copy is read once rather than thrown away, because the word
	 * tokens in it are the expensive half of the whole file.
	 */
	async readAnalysis(project: ProjectRef): Promise<AnalysisFile | null> {
		const own = parseAnalysisFile(
			await this.deps.repository.readPlainFile(this.analysisPath(project)),
		);
		if (own !== null) return own;
		return parseAnalysisFile(
			await this.deps.repository.readPlainFile(this.formerAnalysisPath(project)),
		);
	}

	async writeAnalysis(project: ProjectRef, file: AnalysisFile): Promise<void> {
		await this.writeJsonFile(this.analysisPath(project), file);
		// The numbers now stand in their own folder, so the copy the older
		// build left is stale from this moment. Only this device's own is
		// swept: every other device clears its own the next time it writes.
		const former = this.formerAnalysisPath(project);
		if (this.deps.repository.getFile(former) === null) return;
		try {
			await this.deps.repository.trashFile(former);
		} catch {
			// A cache that will not go is a file the reader can delete
			// themselves; what it held is already written where it belongs.
		}
	}

	/**
	 * Create-or-update, dressed like the session files: a reader opening the
	 * cache in the vault meets lines, not one endless one. Two flushes can
	 * race the first-ever create -- a quiet timer against a walk's end -- so
	 * a create that fails while the file now stands falls through to the
	 * update instead of failing the flush.
	 */
	private async writeJsonFile(path: string, payload: unknown): Promise<void> {
		await createOrUpdatePlainFile(
			this.deps.repository,
			path,
			`${JSON.stringify(payload, null, "\t")}\n`,
		);
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
		const path = await this.settledIgnoresPath(project);
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
			// Two views can race the first-ever create; the loser writes over
			// what the winner made rather than failing the author's click.
			await createOrUpdatePlainFile(
				this.deps.repository,
				path,
				serialize(next),
			);
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
		const aside = await quarantineJsonFile(
			this.deps.repository,
			this.deps.now,
			path,
		);
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

/**
 * One stored hit examined limb by limb: a mangled hit under a still-valid
 * stamp would otherwise be served warm forever, crashing every read that
 * touches its candidates -- exactly what a cache must never manage.
 */
function isStoredHit(value: unknown): value is MentionHit {
	if (typeof value !== "object" || value === null) return false;
	const hit = value as Record<string, unknown>;
	const link = hit.link as Record<string, unknown> | null;
	return (
		typeof hit.from === "number" &&
		typeof hit.to === "number" &&
		typeof hit.matchedText === "string" &&
		(link === null ||
			(typeof link === "object" && typeof link.target === "string")) &&
		Array.isArray(hit.candidates) &&
		hit.candidates.every(
			(candidate) =>
				typeof candidate === "object" &&
				candidate !== null &&
				typeof (candidate as Record<string, unknown>).label === "string" &&
				((candidate as Record<string, unknown>).entry === "name" ||
					(candidate as Record<string, unknown>).entry === "alias") &&
				typeof (candidate as Record<string, unknown>).memberPath ===
					"string" &&
				typeof (candidate as Record<string, unknown>).memberName ===
					"string" &&
				typeof (candidate as Record<string, unknown>).group === "string" &&
				typeof (candidate as Record<string, unknown>).groupRank ===
					"number" &&
				typeof (candidate as Record<string, unknown>).rank === "number" &&
				typeof (candidate as Record<string, unknown>).insert === "string",
		)
	);
}

/** Reads an index file leniently: a note entry that does not hold its shape
 *  is dropped alone -- and recomputed on its next read -- because every
 *  entry stands or falls by its own stamp. */
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
		if (!entry.hits.every(isStoredHit)) continue;
		notes[path] = {
			stamp: entry.stamp,
			hits: entry.hits,
		};
	}
	return {
		schemaVersion: MENTION_STORE_SCHEMA_VERSION,
		fingerprint: parsed.fingerprint,
		notes,
	};
}

/**
 * Reads an analysis file leniently, family by family: a note entry without
 * its stamp is dropped, and a family that does not hold its shape is read
 * as absent -- recomputed lazily -- rather than dooming the note or the
 * file. A schema this build does not write reads as no file at all.
 */
function parseAnalysisFile(content: string | null): AnalysisFile | null {
	const parsed = parseJsonObject(content);
	if (parsed === null) return null;
	if (parsed.schemaVersion !== ANALYSIS_FILE_SCHEMA_VERSION) return null;
	const prints = [
		parsed.sensitiveFingerprint,
		parsed.dialogueFingerprint,
		parsed.statsFingerprint,
		parsed.tokensFingerprint,
	];
	if (prints.some((print) => typeof print !== "string")) return null;
	if (typeof parsed.notes !== "object" || parsed.notes === null) return null;
	// Both halves of a pair carry weight: a null term or a string offset
	// under a valid stamp would be served warm forever, so a list either
	// holds its whole shape or reads as absent and recomputes.
	const isPairList = (value: unknown, first: "string" | "number"): boolean =>
		Array.isArray(value) &&
		value.every(
			(pair) =>
				Array.isArray(pair) &&
				pair.length === 2 &&
				typeof pair[0] === first &&
				typeof pair[1] === "number",
		);
	const isSensitiveHit = (value: unknown): value is SensitiveHit =>
		typeof value === "object" &&
		value !== null &&
		typeof (value as Record<string, unknown>).term === "string" &&
		typeof (value as Record<string, unknown>).matchedText === "string" &&
		typeof (value as Record<string, unknown>).from === "number" &&
		typeof (value as Record<string, unknown>).to === "number";
	const isStats = (value: unknown): value is NoteProseStats =>
		typeof value === "object" &&
		value !== null &&
		["cjk", "words", "counted", "sentences", "dialogueCounted"].every(
			(field) =>
				typeof (value as Record<string, unknown>)[field] === "number",
		);
	const notes: Record<string, AnalysisNoteRecord> = {};
	for (const [path, note] of Object.entries(
		parsed.notes as Record<string, unknown>,
	)) {
		if (typeof note !== "object" || note === null) continue;
		const entry = note as Record<string, unknown>;
		if (typeof entry.stamp !== "string") continue;
		notes[path] = {
			stamp: entry.stamp,
			sensitive:
				Array.isArray(entry.sensitive) && entry.sensitive.every(isSensitiveHit)
					? entry.sensitive
					: null,
			dialogue: isPairList(entry.dialogue, "number")
				? (entry.dialogue as [number, number][])
				: null,
			stats: isStats(entry.stats) ? entry.stats : null,
			tokens: isPairList(entry.tokens, "string")
				? (entry.tokens as [string, number][])
				: null,
		};
	}
	return {
		schemaVersion: ANALYSIS_FILE_SCHEMA_VERSION,
		sensitiveFingerprint: parsed.sensitiveFingerprint as string,
		dialogueFingerprint: parsed.dialogueFingerprint as string,
		statsFingerprint: parsed.statsFingerprint as string,
		tokensFingerprint: parsed.tokensFingerprint as string,
		notes,
	};
}
