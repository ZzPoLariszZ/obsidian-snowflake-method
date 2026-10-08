import { describe, expect, it, vi } from 'vitest';

import { TFile } from 'obsidian';

import { ArrangeController, DROP_ATTRIBUTE, EXPLORER_DRAG_TYPE } from '../../src/ui/file-explorer-arrange';
import type { ExplorerItemShape } from '../../src/ui/file-explorer-shapes';
import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

function row(dom: CorkboardDom, container: CorkboardElement, path: string): ExplorerItemShape {
	const file = Object.assign(new TFile(), { path, name: path.slice(path.lastIndexOf('/') + 1) });
	const el = container.createDiv({ cls: 'tree-item' });
	const selfEl = el.createDiv({ cls: 'tree-item-self', attr: { 'data-path': path } });
	const innerEl = selfEl.createDiv({ cls: 'tree-item-inner', text: file.name });
	return {
		el: el as unknown as HTMLElement,
		selfEl: selfEl as unknown as HTMLElement,
		innerEl: innerEl as unknown as HTMLElement,
		file,
		getTitle: () => file.name,
		updateTitle: () => undefined,
	};
}

function setup(options: { inScope?: (item: ExplorerItemShape) => boolean } = {}) {
	const dom = new CorkboardDom();
	Object.assign(dom.doc, { querySelector: () => null });
	const container = dom.container.createDiv({ cls: 'nav-files-container' });
	const rows = ['Novel/a.md', 'Novel/b.md', 'Novel/c.md'].map((path) => row(dom, container, path));
	const byPath = new Map(rows.map((item) => [item.file.path, item] as const));
	const commit = vi.fn();
	const openMenu = vi.fn();
	const refuse = vi.fn();
	const onExit = vi.fn();
	const escapes: ((event: unknown) => boolean | void)[] = [];
	const scope = {
		register: (_modifiers: unknown, _key: string, handler: (event: unknown) => boolean | void) => {
			escapes.push(handler);
			return { handler };
		},
		unregister: (registered: { handler: (event: unknown) => boolean | void }) => {
			escapes.splice(escapes.indexOf(registered.handler), 1);
		},
	};
	const controller = new ArrangeController({
		container: container as unknown as HTMLElement,
		scope: scope as never,
		itemAt: (target) => {
			const node = target as { closest?: (selector: string) => { getAttribute(name: string): string | null } | null } | null;
			const path = node?.closest?.('.tree-item-self')?.getAttribute('data-path') ?? null;
			return path === null ? null : (byPath.get(path) ?? null);
		},
		siblingsOf: () => rows,
		inScope: options.inScope ?? (() => true),
		rowBounds: (el) => {
			const index = rows.findIndex((item) => item.el === el || item.selfEl === el);
			return { top: 100 + index * 30, bottom: 130 + index * 30 };
		},
		commit,
		openMenu,
		refuse,
		gripLabel: 'Move…',
		onExit,
	});
	const fire = (type: string, event: Record<string, unknown>): void => {
		for (const listener of container.listeners.get(type) ?? []) (listener as (event: unknown) => void)(event);
	};
	const dragEvent = (target: ExplorerItemShape | null, clientY = 0) => ({
		target: target?.selfEl ?? null,
		clientY,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
		dataTransfer: { effectAllowed: '', dropEffect: '', setData: vi.fn() },
	});
	return { dom, container, rows, controller, commit, openMenu, refuse, onExit, fire, dragEvent, escapes };
}

describe('ArrangeController', () => {
	it('takes a drag of a row in scope from Obsidian and lands it by the middles of the rows', () => {
		const { container, rows, controller, commit, fire, dragEvent } = setup();
		controller.enter();
		expect(container.classes.has('snowflake-method-explorer-arranging')).toBe(true);
		const [first, second, third] = rows;
		if (!first || !second || !third) throw new Error('rows');

		const start = dragEvent(third);
		fire('dragstart', start);
		expect(start.stopPropagation).toHaveBeenCalled();
		expect(start.preventDefault).not.toHaveBeenCalled();
		expect(start.dataTransfer.setData).toHaveBeenCalledWith(EXPLORER_DRAG_TYPE, 'Novel/c.md');
		expect(third.selfEl.classList.contains('snowflake-method-explorer-dragging')).toBe(true);

		const over = dragEvent(first, 105);
		fire('dragover', over);
		expect(over.preventDefault).toHaveBeenCalled();
		expect(over.dataTransfer.dropEffect).toBe('move');
		expect(first.el.getAttribute(DROP_ATTRIBUTE)).toBe('before');

		const below = dragEvent(second, 150);
		fire('dragover', below);
		expect(first.el.getAttribute(DROP_ATTRIBUTE)).toBeNull();
		// The dragged row is left out of the reckoning: past the second row's middle is after it.
		expect(second.el.getAttribute(DROP_ATTRIBUTE)).toBe('after');

		const past = dragEvent(third, 300);
		fire('dragover', past);
		expect(past.preventDefault).not.toHaveBeenCalled();
		expect(past.dataTransfer.dropEffect).toBe('none');
		expect(second.el.getAttribute(DROP_ATTRIBUTE)).toBeNull();

		const tail = dragEvent(third, 194);
		fire('dragover', tail);
		expect(second.el.getAttribute(DROP_ATTRIBUTE)).toBe('after');
		fire('drop', dragEvent(third, 194));
		expect(commit).toHaveBeenCalledWith(third, rows, 2);
		commit.mockClear();
		fire('dragstart', dragEvent(third));

		const drop = dragEvent(first, 105);
		fire('drop', drop);
		expect(drop.preventDefault).toHaveBeenCalled();
		expect(commit).toHaveBeenCalledWith(third, rows, 0);
		expect(third.selfEl.classList.contains('snowflake-method-explorer-dragging')).toBe(false);
		expect(third.el.getAttribute(DROP_ATTRIBUTE)).toBeNull();
	});

	it('refuses a drag of a row the mode does not reach, and ignores drags that are not its own', () => {
		const { rows, controller, refuse, commit, fire, dragEvent } = setup({ inScope: (item) => item.file.name !== 'b.md' });
		controller.enter();
		const second = rows[1];
		if (!second) throw new Error('rows');
		const start = dragEvent(second);
		fire('dragstart', start);
		expect(start.preventDefault).toHaveBeenCalled();
		expect(start.stopPropagation).not.toHaveBeenCalled();
		expect(refuse).toHaveBeenCalledTimes(1);
		const over = dragEvent(second, 105);
		fire('dragover', over);
		expect(over.stopPropagation).not.toHaveBeenCalled();
		fire('drop', dragEvent(second, 105));
		expect(commit).not.toHaveBeenCalled();
	});

	it('gives the rows grips that open the menu, and takes everything away on exit', () => {
		const { container, rows, controller, openMenu } = setup({ inScope: (item) => item.file.name !== 'b.md' });
		controller.enter();
		const grips = container.querySelectorAll('.snowflake-method-explorer-grip');
		expect(grips).toHaveLength(2);
		const [first] = rows;
		if (!first) throw new Error('rows');
		const grip = (first.selfEl as unknown as CorkboardElement).querySelector('.snowflake-method-explorer-grip');
		expect(grip?.getAttribute('aria-label')).toBe('Move…');
		grip?.dispatch('click');
		expect(openMenu).toHaveBeenCalledWith(first, expect.anything());
		controller.exit();
		expect(container.querySelectorAll('.snowflake-method-explorer-grip')).toHaveLength(0);
		expect(container.classes.has('snowflake-method-explorer-arranging')).toBe(false);
		expect([...container.listeners.values()].flat()).toHaveLength(0);
	});

	it('leaves on Escape through the keymap unless a drag is under way or a field has the key', () => {
		const { container, rows, controller, onExit, fire, dragEvent, escapes } = setup();
		controller.enter();
		expect(escapes).toHaveLength(1);
		const escape = (target: unknown): boolean | void => escapes[0]?.({ key: 'Escape', target });
		expect(escape({ closest: () => ({}) })).toBeUndefined();
		expect(onExit).not.toHaveBeenCalled();
		fire('dragstart', dragEvent(rows[0] ?? null));
		expect(escape(container)).toBeUndefined();
		expect(onExit).not.toHaveBeenCalled();
		fire('dragend', {});
		expect(escape(container)).toBe(false);
		expect(onExit).toHaveBeenCalledTimes(1);
		controller.exit();
		expect(escapes).toHaveLength(0);
	});
});
