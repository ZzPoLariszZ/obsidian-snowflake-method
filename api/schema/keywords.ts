/**
 * The words of JSON Schema the API's checker understands. The contract is
 * held to them by a test, so that nothing can be written into it which the
 * checker would pass over in silence: a rule the document states and the
 * API does not enforce is a promise broken where nobody sees it.
 */
export const CHECKED_KEYWORDS: readonly string[] = [
	'$ref',
	'type',
	'enum',
	'const',
	'properties',
	'required',
	'additionalProperties',
	'items',
	'minItems',
	'maxItems',
	'minLength',
	'maxLength',
	'minimum',
	'maximum',
	'pattern',
	'oneOf',
	'anyOf',
	'allOf',
];

/** Words that tell a reader something and ask nothing of a value. */
export const ANNOTATION_KEYWORDS: readonly string[] = [
	'title',
	'description',
	'default',
	'examples',
	'format',
	'readOnly',
	'deprecated',
	// Where a member's property is kept in its note.
	'x-snowflake-section',
	'x-snowflake-frontmatter',
	// What a caller may send back unchanged with a change: see `validate.ts`.
	'x-snowflake-echo',
];

/** The word that names what a caller read and may send back: the schema whose properties are let through and dropped. */
export const ECHO_KEYWORD = 'x-snowflake-echo';
