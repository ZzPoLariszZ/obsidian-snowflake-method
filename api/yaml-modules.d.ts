/**
 * The contract is written as YAML and reaches the code as JSON text, behind
 * a function that hands the text over when it is asked for: the build and
 * the tests both read the file before anything imports it. What the text
 * holds is not taken on trust. `spec/document.ts` reads it the first time
 * the contract is wanted, and that is where it is looked at.
 */
declare module '*.yaml' {
	const text: () => string;
	export default text;
}
