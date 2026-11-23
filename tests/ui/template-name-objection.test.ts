import { describe, expect, it, vi } from 'vitest';

// The real dashboard answers; only Obsidian's own classes are stood in for.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';

type Objection = (model: unknown, kind: string, name: string, previousName: string | null) => string | null;

describe('what stands in the way of a template name, as its dialog is told while a name is typed', () => {
	const dashboard = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
	Object.assign(dashboard, {
		t: (key: string, vars?: Record<string, string | number>): string => `${key}${JSON.stringify(vars ?? {})}`,
	});
	const model = { customFieldTemplates: { character: [{ name: 'Combatant' }] } };
	const ask = (name: string, previousName: string | null = null): string | null =>
		(dashboard as unknown as { templateNameObjection: Objection }).templateNameObjection(model, 'character', name, previousName);

	it('is nothing for a name a note can wear, and a namesake for one the kind already has', () => {
		expect(ask('Profile')).toBeNull();
		expect(ask('combatant')).toBe('modal.customFieldTemplate.nameTaken{"name":"combatant"}');
		// The one being edited keeps its own name.
		expect(ask('combatant', 'Combatant')).toBeNull();
	});

	it('is an objection for a name no file can wear, a name of dots alone among them, and never a throw', () => {
		expect(ask('Sliced/Name')).toBe('modal.customFieldTemplate.invalidName{"name":"Sliced/Name"}');
		// Of dots alone nothing is left, which is said like any other name a file cannot wear. Thrown, it
		// left the dialog with no word under the field and a Save that did nothing.
		for (const name of ['...', '.', '. .']) {
			expect(ask(name), name).toBe(`modal.customFieldTemplate.invalidName{"name":"${name}"}`);
		}
	});
});
