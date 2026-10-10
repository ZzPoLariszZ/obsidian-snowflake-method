/**
 * Vite hands a module the plain text of a file when the import asks for
 * `?raw`. Tests use it to read the shipped stylesheet without reaching for a
 * Node module, which the plugin's own sources may not do.
 */
declare module '*?raw' {
	const content: string;
	export default content;
}

/**
 * Vite's own way to read many files at once, for the tests that hold every
 * source file to a rule: each path under the pattern, with its text when the
 * query asks for `?raw`.
 */
interface ImportMeta {
	glob<T = unknown>(
		pattern: string,
		options: { query: '?raw'; import: 'default'; eager: true },
	): Record<string, T>;
}
