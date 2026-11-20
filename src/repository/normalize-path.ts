import { normalizePath as normalizeVaultPath } from "obsidian";

/**
 * How many spellings are remembered before the memo starts over. A project
 * of seven thousand notes asks about some twenty thousand distinct paths in
 * one load, so two such projects fit with room to spare, and a vault that
 * outgrows it only pays the old price again for a moment.
 */
const REMEMBERED_PATHS = 40_000;

const remembered = new Map<string, string>();

/**
 * Obsidian's `normalizePath`, answered from memory for a spelling it has
 * already been asked about.
 *
 * The app's own function runs three pattern replacements and a Unicode
 * composition over the path every time. A project load asks it about every
 * note it holds, several times each, and the same paths again on the next
 * load: at seven thousand notes that was fifty milliseconds of every load
 * spent composing strings that were already composed. The answer depends on
 * the spelling alone, so the same spelling can be given the same answer.
 */
export function normalizePath(path: string): string {
  const known = remembered.get(path);
  if (known !== undefined) return known;
  const normalized = normalizeVaultPath(path);
  if (remembered.size >= REMEMBERED_PATHS) remembered.clear();
  // Most paths are already in their normal form: the one string serves as
  // both the question and the answer.
  remembered.set(path, normalized === path ? path : normalized);
  return normalized;
}
