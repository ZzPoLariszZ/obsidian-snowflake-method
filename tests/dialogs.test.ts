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

	/** Every dialog declared in the sources, with the file it stands in and the base it is built on. */
	function declared(): { path: string; name: string; base: string; body: string }[] {
		const found: { path: string; name: string; base: string; body: string }[] = [];
		const declaration =
			/class (\w+)(?:<[^>]*>)? extends ((?:Snowflake)?(?:Modal|SuggestModal|FuzzySuggestModal))(?:<[^>]*>)?\s*\{/gu;
		for (const [path, text] of Object.entries(sources)) {
			for (const match of text.matchAll(declaration)) {
				// The class reads to the next one declared in the file.
				const rest = text.slice(match.index);
				const next = rest.slice(1).search(/\n(?:export )?(?:abstract )?class /u);
				const body = next === -1 ? rest : rest.slice(0, next + 1);
				found.push({ path, name: match[1] ?? '', base: match[2] ?? '', body });
			}
		}
		return found;
	}

	it('all build on the plugin’s own bases, which leave a composing Escape to the input method', () => {
		const onObsidian = declared()
			.filter((dialog) => !dialog.path.endsWith('/dialog-base.ts') && !dialog.base.startsWith('Snowflake'))
			.map((dialog) => `${dialog.path}: ${dialog.name}`);
		expect(onObsidian).toEqual([]);
	});

	it('all wear the plugin’s dialog class', () => {
		const dialogs: string[] = [];
		const bare: string[] = [];
		for (const { path, name, body } of declared()) {
			// The three bases wear nothing themselves: they are Obsidian's
			// dialogs with one key answered differently.
			if (path.endsWith('/dialog-base.ts')) continue;
			// A dialog built on one of the plugin's form or confirm bases wears
			// what its base puts on.
			dialogs.push(name);
			if (!body.includes(`this.modalEl.addClass(${'DIALOG_CLASS'}`)) {
				bare.push(`${path}: ${name}`);
			}
		}
		expect(dialogs.length).toBeGreaterThan(20);
		expect(dialogs).toContain('SnowflakeFormModal');
		expect(dialogs).toContain('ConfirmModal');
		expect(bare).toEqual([]);
	});

	it('and so does everything else hung on a window’s body: the panels, the editors’ popups, the floating notes', () => {
		for (const file of [
			'anchored-panel',
			'filter-panel',
			'presentation-panel',
			'segment-editor-backend',
			'sticky-note-float',
		]) {
			const text = sources[`../src/ui/${file}.ts`] ?? '';
			expect(text, file).toMatch(/body\.createDiv\(\{\s*cls: `\$\{DIALOG_CLASS\} /u);
		}
	});

	it('is a class the stylesheet reads', () => {
		expect(DIALOG_CLASS).toBe('snowflake-method-dialog');
	});
});
