import { describe, expect, it, vi } from 'vitest';

import type { ItemView, Modal } from 'obsidian';

import { answerEscapeKey, keepEscapeInView } from '../../src/ui/escape-key';

type Listener = (event: KeyboardEvent) => void;

/** A view whose root hears keys, standing in the main area or in one of the docks. */
function viewIn(where: 'main' | 'left' | 'right'): {
	fire: (init: { key: string; isComposing?: boolean }) => { stopPropagation: ReturnType<typeof vi.fn> };
} {
	const leftSplit = {};
	const rightSplit = {};
	const main = {};
	const listeners = new Map<string, Listener>();
	const containerEl = {
		addEventListener: (type: string, listener: Listener): void => {
			listeners.set(type, listener);
		},
	};
	const view = {
		containerEl,
		leaf: { getRoot: () => (where === 'left' ? leftSplit : where === 'right' ? rightSplit : main) },
		app: { workspace: { leftSplit, rightSplit } },
		registerDomEvent: (el: typeof containerEl, type: string, listener: Listener): void => {
			el.addEventListener(type, listener);
		},
	} as unknown as ItemView;
	keepEscapeInView(view);
	return {
		fire: (init) => {
			const event = { key: init.key, isComposing: init.isComposing ?? false, stopPropagation: vi.fn() };
			listeners.get('keydown')?.(event as unknown as KeyboardEvent);
			return event;
		},
	};
}

describe('keepEscapeInView', () => {
	it('stops an Escape at the root of a view in the main area, so the workspace never hands the keys to a note', () => {
		const { fire } = viewIn('main');
		expect(fire({ key: 'Escape' }).stopPropagation).toHaveBeenCalledTimes(1);
		expect(fire({ key: 'Escape', isComposing: true }).stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('lets every other key through', () => {
		const { fire } = viewIn('main');
		expect(fire({ key: 'Enter' }).stopPropagation).not.toHaveBeenCalled();
		expect(fire({ key: 'a', isComposing: true }).stopPropagation).not.toHaveBeenCalled();
	});

	it('keeps the sidebar idiom in a dock: a plain Escape goes on to the editor, a composing one stays', () => {
		for (const side of ['left', 'right'] as const) {
			const { fire } = viewIn(side);
			expect(fire({ key: 'Escape' }).stopPropagation).not.toHaveBeenCalled();
			expect(fire({ key: 'Escape', isComposing: true }).stopPropagation).toHaveBeenCalledTimes(1);
		}
	});
});

describe('answerEscapeKey', () => {
	function strike(init: { isComposing?: boolean; defaultPrevented?: boolean }): {
		modal: Modal;
		event: KeyboardEvent;
		closed: ReturnType<typeof vi.fn>;
		prevented: ReturnType<typeof vi.fn>;
	} {
		const closed = vi.fn();
		const prevented = vi.fn();
		const modal = { close: closed } as unknown as Modal;
		const event = {
			isComposing: init.isComposing ?? false,
			defaultPrevented: init.defaultPrevented ?? false,
			preventDefault: prevented,
		} as unknown as KeyboardEvent;
		return { modal, event, closed, prevented };
	}

	it('closes the dialog on a plain Escape, as Obsidian does, and takes the key', () => {
		const { modal, event, closed, prevented } = strike({});
		expect(answerEscapeKey(modal, event)).toBeUndefined();
		expect(closed).toHaveBeenCalledTimes(1);
		expect(prevented).toHaveBeenCalledTimes(1);
	});

	it('leaves an Escape struck while an input method composes to the composition, and stops it there', () => {
		const { modal, event, closed, prevented } = strike({ isComposing: true });
		expect(answerEscapeKey(modal, event)).toBe(false);
		expect(closed).not.toHaveBeenCalled();
		expect(prevented).not.toHaveBeenCalled();
	});

	it('does nothing with an Escape something else answered already', () => {
		const { modal, event, closed, prevented } = strike({ defaultPrevented: true });
		expect(answerEscapeKey(modal, event)).toBeUndefined();
		expect(closed).not.toHaveBeenCalled();
		expect(prevented).not.toHaveBeenCalled();
	});
});
