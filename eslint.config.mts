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
		'package.json',
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
					allowDefaultProject: [
						'eslint.config.mts',
						'vitest.config.mts',
						'manifest.json',
					],
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
						'Hero’s Journey',
						'Markdown',
						'Obsidian',
						'Obsidian Canvas',
						'Snowflake',
						'Snowflake Method',
					],
					acronyms: ['ID', 'POV'],
					ignoreRegex: [
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
