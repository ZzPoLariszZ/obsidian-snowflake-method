/**
 * The file explorer's own order of a folder's entries, as the author dragged
 * them: one list per parent folder, in which folders and files mix freely.
 * The list holds names rather than paths, so a renamed parent carries its
 * list along and nothing is said twice. Entries the list does not name
 * follow the named ones in Obsidian's own order, so a new note lands after
 * everything the author placed, and a name the folder no longer holds names
 * nothing.
 *
 * Every function answers the same object when nothing changed, so a caller
 * can skip a save by identity, and every move writes the whole list, so a
 * stale list heals itself on the next move.
 */

export type ExplorerOrders = Readonly<Record<string, readonly string[]>>;

/** The Vault root as the record keys it. Obsidian's own '/' is never stored. */
export const VAULT_ROOT_ORDER_KEY = '';

/** Enough for any vault a settings file should carry; a record past this is damage. */
const MAX_ORDER_KEYS = 5000;
const MAX_ORDER_NAMES = 5000;

/** The record's key for a folder: its path with no slash at either end. */
export function orderKeyOf(folderPath: string): string {
	return folderPath.replace(/^\/+/u, '').replace(/\/+$/u, '');
}

function parentKeyOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? VAULT_ROOT_ORDER_KEY : path.slice(0, slash);
}

function nameOfPath(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Where a key lands when a folder is renamed, or null when the rename does
 * not contain it. The same rule as `movedWithRename` in the project root
 * helpers, kept here so this layer stays free of the app: the Vault root is
 * the empty key and is never renamed.
 */
function movedKey(key: string, oldPath: string, newPath: string): string | null {
	if (key.length === 0) return null;
	if (key === oldPath) return newPath;
	return key.startsWith(`${oldPath}/`)
		? `${newPath}${key.slice(oldPath.length)}`
		: null;
}

function hasOwn(record: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((entry, at) => entry === right[at]);
}

function withoutDuplicates(names: readonly string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const name of names) {
		if (seen.has(name)) continue;
		seen.add(name);
		unique.push(name);
	}
	return unique;
}

/**
 * A folder's entries in the order the author placed them: the recorded
 * names first, in their recorded order, then everything else in the order
 * handed in, which is Obsidian's own. The input comes back itself when the
 * record changes nothing, so the caller can tell a settled folder apart.
 */
export function applyExplorerOrder<T>(
	recorded: readonly string[] | undefined,
	items: T[],
	nameOf: (item: T) => string,
): T[] {
	if (recorded === undefined || recorded.length === 0 || items.length < 2) return items;
	const byName = new Map<string, T>();
	for (const item of items) {
		const name = nameOf(item);
		if (!byName.has(name)) byName.set(name, item);
	}
	const placed = new Set<T>();
	const ordered: T[] = [];
	for (const name of recorded) {
		const item = byName.get(name);
		if (item === undefined || placed.has(item)) continue;
		placed.add(item);
		ordered.push(item);
	}
	if (ordered.length === 0) return items;
	for (const item of items) {
		if (!placed.has(item)) ordered.push(item);
	}
	return ordered.every((item, at) => item === items[at]) ? items : ordered;
}

/** The list with `name` set down beside `target`, or null when nothing moves. */
export function moveBeside(
	list: readonly string[],
	name: string,
	target: string,
	side: 'before' | 'after',
): string[] | null {
	if (name === target || !list.includes(name) || !list.includes(target)) return null;
	const next = list.filter((entry) => entry !== name);
	next.splice(next.indexOf(target) + (side === 'after' ? 1 : 0), 0, name);
	return sameList(next, list) ? null : next;
}

/** The list with `name` one place up or down, or null at the end it is already at. */
export function moveByStep(
	list: readonly string[],
	name: string,
	step: -1 | 1,
): string[] | null {
	const from = list.indexOf(name);
	if (from === -1) return null;
	return moveToIndex(list, name, from + step);
}

/** The list with `name` at `index`, held within the list, or null when it is there already. */
export function moveToIndex(
	list: readonly string[],
	name: string,
	index: number,
): string[] | null {
	const from = list.indexOf(name);
	if (from === -1) return null;
	const to = Math.max(0, Math.min(index, list.length - 1));
	if (to === from) return null;
	const next = list.filter((entry) => entry !== name);
	next.splice(to, 0, name);
	return next;
}

/** The record with a folder's whole list written as it is shown. */
export function recordOrder(
	orders: ExplorerOrders,
	parent: string,
	names: readonly string[],
): ExplorerOrders {
	const key = orderKeyOf(parent);
	const unique = withoutDuplicates(names);
	if (unique.length === 0) return forgetOrder(orders, parent);
	const current = orders[key];
	if (current !== undefined && sameList(current, unique)) return orders;
	return { ...orders, [key]: unique };
}

/** The record without a folder's list, so Obsidian's order holds there again. */
export function forgetOrder(orders: ExplorerOrders, parent: string): ExplorerOrders {
	const key = orderKeyOf(parent);
	if (!hasOwn(orders, key)) return orders;
	return Object.fromEntries(Object.entries(orders).filter(([entry]) => entry !== key));
}

/**
 * The record after a rename. A name changed within its folder is replaced in
 * its place; an entry moved to another folder is left alone on both sides,
 * since it is unrecorded where it lands and the stale name is pruned on the
 * next load. Every list under a renamed folder moves with the folder, and a
 * list already standing where one would land is kept over the mover.
 *
 * Obsidian tells a folder's rename and then each descendant's, in no
 * promised order, so the answer is the same whichever comes first and the
 * same again when the event is repeated.
 */
export function renameInOrders(
	orders: ExplorerOrders,
	oldPath: string,
	newPath: string,
): ExplorerOrders {
	if (oldPath === newPath || oldPath.length === 0 || newPath.length === 0) return orders;
	let next: Record<string, readonly string[]> = { ...orders };
	let changed = false;
	const oldParent = parentKeyOf(oldPath);
	const oldName = nameOfPath(oldPath);
	const newName = nameOfPath(newPath);
	if (oldParent === parentKeyOf(newPath) && oldName !== newName) {
		const list = next[oldParent];
		if (list !== undefined && list.includes(oldName) && !list.includes(newName)) {
			next[oldParent] = list.map((entry) => (entry === oldName ? newName : entry));
			changed = true;
		}
	}
	const rekeyed: Record<string, readonly string[]> = {};
	let moved = false;
	for (const [key, list] of Object.entries(next)) {
		const target = movedKey(key, oldPath, newPath);
		if (target === null) {
			rekeyed[key] = list;
			continue;
		}
		moved = true;
		// A list already standing at the target outranks the one moving in.
		if (hasOwn(next, target)) continue;
		rekeyed[target] = list;
	}
	if (moved) {
		next = rekeyed;
		changed = true;
	}
	return changed ? next : orders;
}

/** The record after a delete: the name leaves its folder's list, and every list beneath the path goes. */
export function deleteFromOrders(orders: ExplorerOrders, path: string): ExplorerOrders {
	if (path.length === 0) return orders;
	const parent = parentKeyOf(path);
	const name = nameOfPath(path);
	const next: Record<string, readonly string[]> = {};
	let changed = false;
	for (const [key, list] of Object.entries(orders)) {
		if (key === path || key.startsWith(`${path}/`)) {
			changed = true;
			continue;
		}
		if (key === parent && list.includes(name)) {
			changed = true;
			const kept = list.filter((entry) => entry !== name);
			if (kept.length > 0) next[key] = kept;
			continue;
		}
		next[key] = list;
	}
	return changed ? next : orders;
}

export interface ExplorerOrderVault {
	/** Whether a folder stands at the key; the root key always does. */
	folderExists(key: string): boolean;
	childExists(parentKey: string, name: string): boolean;
}

/** The record with every folder the vault no longer has, and every name a folder no longer holds, let go. */
export function pruneOrders(orders: ExplorerOrders, vault: ExplorerOrderVault): ExplorerOrders {
	const next: Record<string, readonly string[]> = {};
	let changed = false;
	for (const [key, list] of Object.entries(orders)) {
		if (key !== VAULT_ROOT_ORDER_KEY && !vault.folderExists(key)) {
			changed = true;
			continue;
		}
		const kept = list.filter((name) => vault.childExists(key, name));
		if (kept.length !== list.length) changed = true;
		if (kept.length > 0) next[key] = kept.length === list.length ? list : kept;
	}
	return changed ? next : orders;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What a settings file may hold as the record: keys as folder paths, lists of plain names, bounded. */
export function sanitizeExplorerOrders(raw: unknown): ExplorerOrders {
	if (!isRecord(raw)) return {};
	const result: Record<string, readonly string[]> = {};
	let keys = 0;
	for (const [rawKey, value] of Object.entries(raw)) {
		if (!Array.isArray(value) || rawKey.includes('\\')) continue;
		const key = orderKeyOf(rawKey);
		const segments = key.length === 0 ? [] : key.split('/');
		if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) continue;
		if (hasOwn(result, key)) continue;
		const names: string[] = [];
		const seen = new Set<string>();
		for (const entry of value) {
			if (typeof entry !== 'string' || entry.length === 0) continue;
			if (entry.includes('/') || entry.includes('\\') || entry === '.' || entry === '..') continue;
			if (seen.has(entry)) continue;
			seen.add(entry);
			names.push(entry);
			if (names.length >= MAX_ORDER_NAMES) break;
		}
		if (names.length === 0) continue;
		result[key] = names;
		if (++keys >= MAX_ORDER_KEYS) break;
	}
	return result;
}
