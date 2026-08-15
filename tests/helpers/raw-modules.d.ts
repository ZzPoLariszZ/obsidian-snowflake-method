/**
 * Vite hands a module the plain text of a file when the import asks for
 * `?raw`. Tests use it to read the shipped stylesheet without reaching for a
 * Node module, which the plugin's own sources may not do.
 */
declare module '*?raw' {
	const content: string;
	export default content;
}
