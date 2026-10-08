/**
 * A method of an object replaced for a while and put back. The explorer
 * patches live on prototypes Obsidian owns, where another plugin may wrap
 * the same method after this one: a patch restored while something sits
 * above it would tear that something's chain, so a patch that is no longer
 * on top stays in place and hands every call straight to what it wrapped.
 */

export interface MethodPatch {
	restore(): void;
}

export type PatchedMethod = (this: unknown, ...args: unknown[]) => unknown;

/**
 * Installs `build(original)` as `target[key]`, or answers null when there is
 * no own method of that name to wrap: a build of Obsidian that moved the
 * method takes the feature away, not the explorer.
 */
export function patchMethod(
	target: object,
	key: string,
	build: (original: PatchedMethod) => PatchedMethod,
): MethodPatch | null {
	const record = target as Record<string, unknown>;
	if (!Object.prototype.hasOwnProperty.call(record, key)) return null;
	const original = record[key];
	if (typeof original !== 'function') return null;
	const originalMethod = original as PatchedMethod;
	const state = { alive: true };
	const wrapped = build(originalMethod);
	const installed: PatchedMethod = function (this: unknown, ...args: unknown[]): unknown {
		return state.alive ? wrapped.apply(this, args) : originalMethod.apply(this, args);
	};
	record[key] = installed;
	return {
		restore(): void {
			state.alive = false;
			if (record[key] === installed) record[key] = original;
		},
	};
}
