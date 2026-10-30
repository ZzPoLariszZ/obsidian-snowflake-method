import { describe, expect, it, vi } from 'vitest';

import beatSheetSource from '../../src/ui/beat-sheet.ts?raw';
import corkboardSource from '../../src/ui/corkboard.ts?raw';
import freeformSource from '../../src/ui/freeform.ts?raw';
import relationshipGraphSource from '../../src/ui/relationship-graph.ts?raw';
import timelineSource from '../../src/ui/timeline.ts?raw';

import { CorkboardDom, CorkboardElement } from '../helpers/corkboard-dom';

const { icons, tooltips } = vi.hoisted(() => ({
	icons: [] as { el: unknown; icon: string }[],
	tooltips: [] as { el: unknown; text: string }[],
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		setIcon: (el: unknown, icon: string): void => { icons.push({ el, icon }); },
		setTooltip: (el: unknown, text: string): void => { tooltips.push({ el, text }); },
	};
});

import { mountFullScreenButton, toolbarKept, type FullScreenControl } from '../../src/ui/full-screen';

const t = (key: string): string => key;

/** A toolbar's end group with a refresh button standing in it, as every board has. */
function end(): { end: HTMLElement; refresh: HTMLElement } {
	const dom = new CorkboardDom();
	const end = dom.container.createDiv({ cls: 'snowflake-method-toolbar-end' }) as unknown as HTMLElement;
	const refresh = (end as unknown as CorkboardElement).createEl('button', { cls: 'clickable-icon snowflake-method-timeline-refresh' }) as unknown as HTMLElement;
	return { end, refresh };
}

/** A control as the view hands it, whose answer the test moves itself. */
function control(): FullScreenControl & { listeners: (() => void)[]; on: boolean } {
	const made = {
		on: false,
		listeners: [] as (() => void)[],
		active: () => made.on,
		toggle: () => {
			made.on = !made.on;
		},
		changed: (listener: () => void) => {
			made.listeners.push(listener);
		},
	};
	return made;
}

describe('the full screen button', () => {
	it('stands before the refresh button, wears the expand symbol and its name, and says it is off', () => {
		const made = end();
		const asked = control();
		const button = mountFullScreenButton(made.end, made.refresh, t, asked)!;
		expect(button).not.toBeNull();
		expect((made.end as unknown as CorkboardElement).children.map((child) => [...child.classes].pop())).toEqual([
			'snowflake-method-toolbar-full-screen', 'snowflake-method-timeline-refresh',
		]);
		expect(button.getAttribute('aria-label')).toBe('storyStructure.fullScreen');
		expect(button.getAttribute('aria-pressed')).toBe('false');
		expect(icons.filter((entry) => entry.el === button).map((entry) => entry.icon)).toEqual(['expand']);
		expect(tooltips.filter((entry) => entry.el === button).map((entry) => entry.text)).toEqual(['storyStructure.fullScreen']);
	});

	it('asks the control to fill the window from a press, and then wears the shrink symbol and the way back', () => {
		const made = end();
		const asked = control();
		const button = mountFullScreenButton(made.end, made.refresh, t, asked)!;
		(button as unknown as CorkboardElement).click();
		expect(asked.on).toBe(true);
		expect(button.getAttribute('aria-label')).toBe('storyStructure.fullScreen.exit');
		expect(button.getAttribute('aria-pressed')).toBe('true');
		expect(icons.filter((entry) => entry.el === button).map((entry) => entry.icon)).toEqual(['expand', 'shrink']);
		(button as unknown as CorkboardElement).click();
		expect(asked.on).toBe(false);
		expect(button.getAttribute('aria-label')).toBe('storyStructure.fullScreen');
		expect(icons.filter((entry) => entry.el === button).map((entry) => entry.icon)).toEqual(['expand', 'shrink', 'expand']);
	});

	/**
	 * The boards' fit buttons wear the maximize brackets, and the full screen
	 * button beside them wore the same, which read as one control twice on
	 * the relationship graph. Its arrows are its own: no board's toolbar
	 * button wears them.
	 */
	it('wears symbols no board’s toolbar button wears', () => {
		for (const source of [beatSheetSource, corkboardSource, freeformSource, relationshipGraphSource, timelineSource]) {
			expect(source).not.toMatch(/(?:toolbarIconButton|iconButton)\([^)]*'(?:expand|shrink)'/u);
		}
		expect(relationshipGraphSource).toMatch(/relationship-graph-fit', 'maximize'/u);
	});

	it('repaints when the answer moved elsewhere, as it does when Escape or a hidden tab hands the window back', () => {
		const made = end();
		const asked = control();
		const button = mountFullScreenButton(made.end, made.refresh, t, asked)!;
		expect(asked.listeners).toHaveLength(1);
		asked.on = true;
		for (const listener of asked.listeners) listener();
		expect(button.getAttribute('aria-pressed')).toBe('true');
		expect(button.getAttribute('aria-label')).toBe('storyStructure.fullScreen.exit');
		asked.on = false;
		for (const listener of asked.listeners) listener();
		expect(button.getAttribute('aria-pressed')).toBe('false');
	});

	it('makes no button for a board handed no control, and keeps only the buttons that were made', () => {
		const made = end();
		expect(mountFullScreenButton(made.end, made.refresh, t, undefined)).toBeNull();
		expect((made.end as unknown as CorkboardElement).children).toHaveLength(1);
		expect(toolbarKept(null, made.refresh)).toEqual([made.refresh]);
		expect(toolbarKept(made.refresh, null, made.end)).toEqual([made.refresh, made.end]);
	});
});
