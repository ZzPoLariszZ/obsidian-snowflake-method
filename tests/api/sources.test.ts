import { describe, expect, it } from 'vitest';

/**
 * What the local API's own folder may reach, held by reading its sources.
 * The plugin promises its readers that it reaches Node in one file behind
 * the desktop's guard, makes no call to the internet, and keeps its hands
 * off the page. The API is bundled into the same file as everything else,
 * so each of those is a line here too, and the folder is held to one more:
 * it knows the services and nothing of the screens.
 */
describe('the local API’s reach', () => {
	const sources = import.meta.glob<string>('../../api/**/*.ts', {
		query: '?raw',
		import: 'default',
		eager: true,
	});
	const paths = Object.keys(sources);
	const holding = (pattern: RegExp): string[] => paths.filter((path) => pattern.test(sources[path] ?? ''));

	it('reads the API’s own sources', () => {
		expect(paths.length).toBeGreaterThanOrEqual(5);
		expect(paths.every((path) => path.startsWith('../../api/'))).toBe(true);
	});

	it('never reaches Node: the one bridge to it stands in the plugin’s services', () => {
		expect(holding(/\bimport\(\s*['"]/u)).toEqual([]);
		expect(holding(/\brequire\(/u)).toEqual([]);
		expect(
			holding(
				/from ['"](?:node:)?(?:fs|path|os|child_process|net|http|https|http2|tls|dgram|dns|crypto|url|stream|buffer|events|util|zlib|worker_threads)(?:\/[a-z]+)?['"]/u,
			),
		).toEqual([]);
		expect(holding(/\bprocess\.(?:env|argv|cwd|platform)\b/u)).toEqual([]);
	});

	it('names nothing the way a network call is named', () => {
		// Obsidian's review counts these names in the bundle as network calls,
		// whatever they are a part of.
		expect(holding(/\b(?:request|fetch|requestUrl)\s*\(/u)).toEqual([]);
		expect(holding(/XMLHttpRequest|sendBeacon|EventSource/u)).toEqual([]);
		expect(holding(/new WebSocket\(/u)).toEqual([]);
		expect(holding(/wss?:\/\//u)).toEqual([]);
	});

	it('uses no encoding or evaluation the review would have to disclose', () => {
		expect(holding(/\b(?:btoa|atob)\b/u)).toEqual([]);
		expect(holding(/\beval\(|new Function\b/u)).toEqual([]);
	});

	it('keeps its hands off the page and the page’s storage', () => {
		expect(holding(/\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/u)).toEqual([]);
		expect(holding(/\b(?:localStorage|sessionStorage|indexedDB)\b/u)).toEqual([]);
		expect(holding(/\bdocument\.(?:body|head|querySelector|createElement|cookie)\b/u)).toEqual([]);
	});

	it('keeps no clock of its own', () => {
		// A hidden window's timers crawl, and an agent calls while Obsidian
		// stands behind another application. What must wait is handed a way
		// to wait by the plugin.
		expect(holding(/\b(?:setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\b/u)).toEqual([]);
	});

	it('knows the services and nothing of the screens', () => {
		expect(holding(/from ['"][^'"]*\/src\/(?:ui|editor|i18n)\//u)).toEqual([]);
		expect(holding(/from ['"][^'"]*\/src\/(?:main|settings)['"]/u)).toEqual([]);
		// Every other import is of the API's own files, the plugin's services,
		// repository, domain and templates, or Obsidian.
		const imports = paths.flatMap((path) =>
			[...(sources[path] ?? '').matchAll(/(?:^|\n)(?:import|export)[^'"\n]*?from ['"]([^'"]+)['"]/gu)].map(
				(match) => match[1] ?? '',
			),
		);
		expect(imports.length).toBeGreaterThan(0);
		for (const from of imports) {
			expect(from, from).toMatch(/^(?:\.\.?\/(?:[\w.-]+\/)*[\w.-]+|(?:\.\.\/)+src\/(?:services|repository|domain|templates)(?:\/[\w.-]+)*|obsidian)$/u);
		}
	});

	it('says nothing to the console that could carry the author’s words', () => {
		expect(holding(/\bconsole\.(?:log|info|table|dir)\b/u)).toEqual([]);
	});
});
