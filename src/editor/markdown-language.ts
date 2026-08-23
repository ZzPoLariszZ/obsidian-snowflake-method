import {
	Language,
	defineLanguageFacet,
	languageDataProp,
} from '@codemirror/language';
import { parser as markdownParser } from '@lezer/markdown';

/**
 * Markdown for the manuscript editor, from the grammar itself rather than
 * through `@codemirror/lang-markdown`.
 *
 * That package reaches for the HTML, CSS and JavaScript grammars so it can
 * highlight inside fenced code blocks, and none of them can be shaken back out
 * again: together they are 176 KB of the plugin's download, to colour code a
 * novel does not contain. The grammar on its own is 35 KB and knows headings,
 * emphasis, links, quotes and lists, which is what a manuscript is written in.
 *
 * Kept in a module of its own so that what reads the tree — the paragraph
 * layout the page and the editor share — can be exercised on a bare state,
 * with no editor view anywhere near it.
 */
const MARKDOWN_DATA = defineLanguageFacet({
	commentTokens: { block: { open: '<!--', close: '-->' } },
});

export const MARKDOWN_LANGUAGE = new Language(
	MARKDOWN_DATA,
	markdownParser.configure({
		props: [
			languageDataProp.add((type) =>
				type.isTop ? MARKDOWN_DATA : undefined,
			),
		],
	}),
	[],
	'markdown',
);
