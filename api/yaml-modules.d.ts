/**
 * The contract is written as YAML and reaches the code as the object it
 * describes: the build and the tests both read the file before anything
 * imports it. What that object holds is not taken on trust. It arrives as
 * `unknown`, and `spec/document.ts` is where it is looked at.
 */
declare module '*.yaml' {
	const document: unknown;
	export default document;
}
