import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		MarkdownView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import SnowflakeMethodPlugin from '../../src/main';
import { STORY_STRUCTURE_VIEW_TYPE } from '../../src/ui/story-structure-view';

const PROJECT = 'Story/Project.md';

/** Only the ancestry queries used to distinguish a plugin field from other UI. */
class SurfaceElement {
	constructor(
		private readonly classes: readonly string[],
		private readonly parent: SurfaceElement | null = null,
	) {}

	closest(selector: string): SurfaceElement | null {
		const matches = selector === '[class*="snowflake-method-"]'
			? this.classes.some((name) => name.includes('snowflake-method-'))
			: selector.startsWith('.') && this.classes.includes(selector.slice(1));
		return matches ? this : this.parent?.closest(selector) ?? null;
	}

	contains(element: SurfaceElement): boolean {
		return element === this || element.parent !== null && this.contains(element.parent);
	}
}

class Textarea extends SurfaceElement {
	value = 'one two three';
	selectionStart = 0;
	selectionEnd = 0;
}

interface WritingSurfaceHost {
	currentWritingCount(): Promise<{ count: { total: number }; selection: boolean } | null>;
	registerWritingSurfaceWatch(doc: unknown): void;
}

function surface(kind: 'corkboard' | 'modal' | 'unrelated') {
	vi.stubGlobal('HTMLTextAreaElement', Textarea);
	vi.stubGlobal('HTMLInputElement', class {});
	// Focus/motion modes can mark the document body without owning every field.
	const body = new SurfaceElement(['snowflake-method-reduce-motion']);
	const board = new SurfaceElement(['snowflake-method-story-structure'], body);
	const parent = kind === 'corkboard' ? board
		: new SurfaceElement(kind === 'modal' ? ['modal', 'snowflake-method-scene-modal'] : ['other-plugin-view'], body);
	const field = new Textarea(
		[kind === 'corkboard' ? 'snowflake-method-corkboard-conflict'
			: kind === 'modal' ? 'snowflake-method-scene-conflict' : 'other-plugin-editor'],
		parent,
	);
	const doc = { activeElement: field };
	const surfaceActivity = vi.fn();
	let onInput = (_event: { target: Textarea }): void => undefined;
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as WritingSurfaceHost;
	Object.assign(plugin, {
		settings: { writingCountMode: 'ms-word', writingCountHeadings: 'skip-first-h1', recentProjectPath: PROJECT },
		sessions: { surfaceActivity },
		registerDomEvent: (_doc: unknown, type: string, callback: typeof onInput) => {
			if (type === 'input') onInput = callback;
		},
		app: { workspace: {
			containerEl: { doc },
			getActiveViewOfType: () => null,
			getLeavesOfType: (type: string) => type === STORY_STRUCTURE_VIEW_TYPE
				? [{ view: { containerEl: board } }] : [],
		} },
	});
	plugin.registerWritingSurfaceWatch(doc);
	return { field, plugin, surfaceActivity, input: () => onInput({ target: field }) };
}

afterEach(() => vi.unstubAllGlobals());

describe.each(['corkboard', 'modal'] as const)('%s writing surface', (kind) => {
	it('counts the focused text and selection before any save', async () => {
		const { field, plugin } = surface(kind);
		expect(await plugin.currentWritingCount()).toMatchObject({ count: { total: 3 }, selection: false });
		field.value += ' four';
		expect(await plugin.currentWritingCount()).toMatchObject({ count: { total: 4 }, selection: false });
		field.selectionStart = 4;
		field.selectionEnd = 7;
		expect(await plugin.currentWritingCount()).toMatchObject({ count: { total: 1 }, selection: true });
	});

	it('reports typing to the writing session without waiting for a save', () => {
		const { input, surfaceActivity } = surface(kind);
		input();
		expect(surfaceActivity).toHaveBeenCalledExactlyOnceWith(PROJECT);
	});
});

it('ignores another view even when the document body carries a plugin class', async () => {
	const { plugin, input, surfaceActivity } = surface('unrelated');
	expect(await plugin.currentWritingCount()).toBeNull();
	input();
	expect(surfaceActivity).not.toHaveBeenCalled();
});
