import { describe, expect, it } from 'vitest';

/**
 * Every tooltip the plugin shows is the app's own: an `aria-label`, which
 * Obsidian draws as a `.tooltip` on hover and the Hide tooltips setting puts
 * away. A native `title` is drawn by the browser instead, where no stylesheet
 * reaches, and beside an `aria-label` it is a second tooltip on top of the
 * first.
 */
describe('tooltips', () => {
	const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', {
		query: '?raw',
		import: 'default',
		eager: true,
	});

	it('reads the plugin’s own sources', () => {
		expect(Object.keys(sources).length).toBeGreaterThan(100);
	});

	it('are never native titles', () => {
		const native = [
			/\battr:\s*\{[^}]*\btitle\s*:/u,
			/\battributes:\s*\{[^}]*\btitle\s*:/u,
			/\bsetAttr(?:ibute)?\(\s*['"]title['"]/u,
		];
		const offenders = Object.entries(sources).flatMap(([path, text]) =>
			text
				.split('\n')
				.map((line, index) => ({ path, line: index + 1, text: line.trim() }))
				.filter((entry) => native.some((pattern) => pattern.test(entry.text))),
		);
		expect(offenders).toEqual([]);
	});
});
