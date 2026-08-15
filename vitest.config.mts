import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
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
