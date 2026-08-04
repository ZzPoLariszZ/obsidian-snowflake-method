import { normalizePath } from 'obsidian';

/** Display value used by the setting control for the current Vault root. */
export const VAULT_ROOT_DISPLAY_PATH = '/';

/**
 * Obsidian represents the Vault root with an empty path. Keep that canonical
 * representation internally while accepting a slash in the settings UI.
 */
export function normalizeProjectRoot(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0 || /^\/+$/u.test(trimmed)) return '';
	return normalizePath(trimmed);
}

export function isValidProjectRoot(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.length === 0 || /^\/+$/u.test(trimmed)) return true;
	if (trimmed.startsWith('/') || trimmed.includes('\\')) return false;
	if (/[\0\r\n]/u.test(trimmed)) return false;
	return trimmed
		.split('/')
		.filter((segment) => segment.length > 0)
		.every((segment) => segment !== '.' && segment !== '..');
}

export function displayProjectRoot(value: string): string {
	const normalized = normalizeProjectRoot(value);
	return normalized.length === 0 ? VAULT_ROOT_DISPLAY_PATH : normalized;
}

export function isPathAtOrBelow(path: string, parent: string): boolean {
	const normalizedParent = normalizeProjectRoot(parent);
	if (normalizedParent.length === 0) return true;
	const normalizedPath = normalizePath(path);
	return (
		normalizedPath === normalizedParent ||
		normalizedPath.startsWith(`${normalizedParent}/`)
	);
}

/**
 * True when a change at `path` can affect one of the discovered projects:
 * either it sits inside a project folder, or it is a folder that contains one.
 *
 * Containment in the configured root is deliberately not the test. That root
 * defaults to the Vault root, where every note in the Vault is "in the root",
 * and nesting depth does not help either -- an ordinary `Inbox/note.md` is just
 * as deep as a project note. Only the project folders themselves can answer it.
 */
export function touchesAnyProject(
	path: string,
	projectRoots: Iterable<string>,
): boolean {
	for (const rootPath of projectRoots) {
		if (isPathAtOrBelow(path, rootPath) || isPathAtOrBelow(rootPath, path)) {
			return true;
		}
	}
	return false;
}

/**
 * Where `subject` ends up when `oldPath` is renamed to `newPath`, or null when
 * the rename does not contain it. The Vault root is an empty path and can never
 * be renamed, so it never moves.
 */
export function movedWithRename(
	subject: string,
	oldPath: string,
	newPath: string,
): string | null {
	if (subject.length === 0) return null;
	if (subject === oldPath) return newPath;
	return subject.startsWith(`${oldPath}/`)
		? `${newPath}${subject.slice(oldPath.length)}`
		: null;
}
