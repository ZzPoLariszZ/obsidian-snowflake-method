import { describe, expect, it } from 'vitest';

import { DIALOG_CLASS } from '../src/ui/dialog-class';

/**
 * Everything the plugin raises over the workspace wears one class, which is
 * how the page's ground reaches all of it when the background scope is set
 * to the plugin's whole interface. A dialog that went without would stand in
 * the theme's own color over a tinted view, with nothing failing to say so.
 */
describe('dialogs', () => {
	const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', {
		query: '?raw',
		import: 'default',
		eager: true,
	});

	it('all wear the plugin’s dialog class', () => {
		const dialogs: string[] = [];
		const bare: string[] = [];
		const declaration =
			/class (\w+)(?:<[^>]*>)? extends (?:Modal|SuggestModal<[^>]*>|FuzzySuggestModal<[^>]*>)\s*\{/gu;
		for (const [path, text] of Object.entries(sources)) {
			for (const match of text.matchAll(declaration)) {
				// The class reads to the next one declared in the file. A dialog
				// built on one of the plugin's own bases wears what its base puts on.
				const rest = text.slice(match.index);
				const next = rest.slice(1).search(/\n(?:export )?(?:abstract )?class /u);
				const body = next === -1 ? rest : rest.slice(0, next + 1);
				dialogs.push(match[1] ?? '');
				if (!body.includes(`this.modalEl.addClass(${'DIALOG_CLASS'}`)) {
					bare.push(`${path}: ${match[1] ?? ''}`);
				}
			}
		}
		expect(dialogs.length).toBeGreaterThan(20);
		expect(dialogs).toContain('SnowflakeFormModal');
		expect(dialogs).toContain('ConfirmModal');
		expect(bare).toEqual([]);
	});

	it('and so do the panels hung under a button', () => {
		for (const file of ['anchored-panel', 'filter-panel', 'presentation-panel']) {
			const text = sources[`../src/ui/${file}.ts`] ?? '';
			expect(text, file).toMatch(/body\.createDiv\(\{\s*cls: `\$\{DIALOG_CLASS\} /u);
		}
	});

	it('is a class the stylesheet reads', () => {
		expect(DIALOG_CLASS).toBe('snowflake-method-dialog');
	});
});
