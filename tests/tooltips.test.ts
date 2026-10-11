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
		// Read over each whole file, so an attribute object or a call spread
		// over several lines is read as one.
		const native = [
			/\battr:\s*\{[^}]*\btitle\s*:/gu,
			/\battributes:\s*\{[^}]*\btitle\s*:/gu,
			/\bsetAttr(?:ibute)?\(\s*['"]title['"]/gu,
			// An attribute spread in only when there is a title to give.
			/\?\s*\{\}\s*:\s*\{\s*title\s*:/gu,
		];
		const offenders = Object.entries(sources).flatMap(([path, text]) =>
			native.flatMap((pattern) =>
				[...text.matchAll(pattern)].map(
					(match) => `${path}:${text.slice(0, match.index).split('\n').length}`,
				),
			),
		);
		expect(offenders).toEqual([]);
	});
});
