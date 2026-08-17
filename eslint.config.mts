import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'coverage',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		// package.json is deliberately not here: Obsidian's own config lints it
		// for dependencies it would rather a plugin did without, and ignoring the
		// file turned that check off.
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'vitest.config.mts'],
					// These two run in Node and are the only files here that may say
					// so. The project's own tsconfig takes `types: []`, which is what
					// stops a Node declaration quietly lending the plugin a method
					// the browsers it targets do not have.
					defaultProject: 'tsconfig.tools.json',
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		rules: {
			'obsidianmd/prefer-active-doc': 'error',
			'obsidianmd/prefer-instanceof': 'error',
		},
	},
	{
		files: ['src/i18n/en.ts'],
		rules: {
			'obsidianmd/ui/sentence-case-locale-module': [
				'error',
				{
					brands: [
						'Chenggua',
						'Hero’s Journey',
						'Jinjiang',
						'Lucide',
						'MS Word',
						'NovelBuddy',
						'Qidian',
						'Qidian / NovelBuddy',
						'Markdown',
						'Obsidian',
						'Obsidian Canvas',
						'Snowflake',
						'Snowflake Archive',
						'Snowflake Method',
					],
					acronyms: ['CJK', 'H1', 'ID', 'POV', '6Z'],
					ignoreRegex: [
						// A frontmatter key, quoted so an author can find it in the
						// note. It is spelled the way the file spells it, which is
						// lowercase, and is not the brand.
						'snowflake-manuscript-sequence',
						'^conflict$',
						'^ \\(don’t add a scene',
						'^point-of-view character$',
						'^ and describe exactly what happens',
						'^to create a “timeline”',
					],
				},
			],
		},
	},
	{
		files: ['vitest.config.mts'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
);
