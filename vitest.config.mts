import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import { parse } from 'yaml';

export default defineConfig({
	plugins: [
		{
			// The local API's contract, read the way the build reads it: the
			// YAML becomes the object it describes before any test sees it, so
			// the tests and the bundle hold the same document. An import that
			// asks for `?raw` is not touched and still gets the text.
			name: 'yaml-as-json',
			enforce: 'pre',
			transform(code: string, id: string) {
				if (!id.endsWith('.yaml')) return null;
				return { code: `export default ${JSON.stringify(parse(code))};`, map: null };
			},
		},
	],
	test: {
		// Stylesheets are stubbed out to nothing here by default, which would
		// hand the styles test an empty file and a guard that always passes.
		css: true,
	},
	resolve: {
		alias: {
			obsidian: fileURLToPath(
				new URL('./tests/helpers/obsidian-runtime.ts', import.meta.url),
			),
		},
	},
});
