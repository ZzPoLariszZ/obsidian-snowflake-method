import { describe, expect, it, vi } from 'vitest';

import { Modal, type App } from 'obsidian';

import { SnowflakeFuzzySuggestModal, SnowflakeModal, SnowflakeSuggestModal } from '../../src/ui/dialog-base';
import type { KeymapEventHandler } from '../helpers/obsidian-runtime';

const app = {} as App;

class PlainDialog extends SnowflakeModal {
	closed = 0;
	close(): void {
		this.closed += 1;
	}
}

class ListDialog extends SnowflakeSuggestModal<string> {
	closed = 0;
	close(): void {
		this.closed += 1;
	}
	getSuggestions(): string[] {
		return [];
	}
	renderSuggestion(): void {}
	onChooseSuggestion(): void {}
}

class FuzzyDialog extends SnowflakeFuzzySuggestModal<string> {
	closed = 0;
	close(): void {
		this.closed += 1;
	}
	getItems(): string[] {
		return [];
	}
	getItemText(item: string): string {
		return item;
	}
	onChooseItem(): void {}
}

/** Obsidian's own dialog, as the runtime stands in for it: Escape closes, composing or not. */
class ObsidianDialog extends Modal {
	closed = 0;
	close(): void {
		this.closed += 1;
	}
}

/** Strikes Escape on the dialog's scope, as the keymap would. */
function escape(dialog: Modal, init: { isComposing?: boolean; defaultPrevented?: boolean } = {}): {
	result: unknown;
	prevented: ReturnType<typeof vi.fn>;
} {
	const handler = (dialog as unknown as { scope: { keys: KeymapEventHandler[] } }).scope.keys.find(
		(key) => key.key === 'Escape',
	);
	if (handler === undefined) throw new Error('no Escape handler on the scope');
	const prevented = vi.fn();
	const event = {
		isComposing: init.isComposing ?? false,
		defaultPrevented: init.defaultPrevented ?? false,
		preventDefault: prevented,
	} as unknown as KeyboardEvent;
	return { result: handler.func(event, {}), prevented };
}

describe('the plugin’s dialog bases', () => {
	it.each([
		['a plain dialog', (): PlainDialog => new PlainDialog(app)],
		['a list dialog', (): ListDialog => new ListDialog(app)],
		['a fuzzy list dialog', (): FuzzyDialog => new FuzzyDialog(app)],
	])('%s stays open on an Escape struck while an input method composes', (_name, make) => {
		const dialog = make();
		const { result, prevented } = escape(dialog, { isComposing: true });
		expect(dialog.closed).toBe(0);
		expect(result).toBe(false);
		expect(prevented).not.toHaveBeenCalled();
	});

	it.each([
		['a plain dialog', (): PlainDialog => new PlainDialog(app)],
		['a list dialog', (): ListDialog => new ListDialog(app)],
		['a fuzzy list dialog', (): FuzzyDialog => new FuzzyDialog(app)],
	])('%s closes on a plain Escape, taking the key as Obsidian does', (_name, make) => {
		const dialog = make();
		const { result, prevented } = escape(dialog);
		expect(dialog.closed).toBe(1);
		expect(result).toBeUndefined();
		expect(prevented).toHaveBeenCalledTimes(1);
	});

	it('leaves an Escape that something else answered alone', () => {
		const dialog = new PlainDialog(app);
		escape(dialog, { defaultPrevented: true });
		expect(dialog.closed).toBe(0);
	});

	it('differs from Obsidian’s own dialog, which closes on the composing Escape too', () => {
		const dialog = new ObsidianDialog(app);
		escape(dialog, { isComposing: true });
		expect(dialog.closed).toBe(1);
	});
});
