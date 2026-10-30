// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { RAIL_TIGHT_MARGIN, marginIsTight } from '../../src/ui/margin-room';
import { SnowflakeManuscriptView } from '../../src/ui/manuscript-view';
import { installObsidianDom } from '../helpers/obsidian-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return { ...runtime, ItemView: class {} };
});

/**
 * The view's margin measuring over its prototype: a stream this wide around
 * a column that wide, the milestones always fitting.
 */
const measure = (streamWidth: number, columnWidth: number): HTMLElement => {
	const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
	const contentEl = document.body.createDiv();
	const streamEl = contentEl.createDiv();
	Object.defineProperty(streamEl, 'clientWidth', { value: streamWidth });
	const column = streamEl.createDiv();
	Object.defineProperty(column, 'offsetWidth', { value: columnWidth });
	Object.assign(view, {
		contentEl,
		streamEl,
		mounted: new Map([['50/one.md', { el: column }]]),
		milestonesFit: () => true,
	});
	(view as unknown as { syncMarginRoom(): void }).syncMarginRoom();
	return contentEl;
};

describe('the margin\'s room', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	it('is tight under the floor plus the rail\'s room, and not at it', () => {
		expect(marginIsTight(RAIL_TIGHT_MARGIN - 1)).toBe(true);
		expect(marginIsTight(RAIL_TIGHT_MARGIN)).toBe(false);
	});

	it('publishes the margin on the pane and holds the rail back only under the threshold', () => {
		// A tablet in portrait around the narrowest column: room for a
		// narrower card, which the full card's threshold used to refuse.
		const tablet = measure(820, 368);
		expect(tablet.style.getPropertyValue('--snowflake-method-margin-room')).toBe('226px');
		expect(tablet.classList.contains('is-revision-tight')).toBe(false);
		// A phone: the column fills the pane but for a sliver.
		const phone = measure(390, 368);
		expect(phone.style.getPropertyValue('--snowflake-method-margin-room')).toBe('11px');
		expect(phone.classList.contains('is-revision-tight')).toBe(true);
		// A margin that splits a pixel is read down, so a card never asks for
		// a pixel the margin does not have.
		expect(measure(821, 368).style.getPropertyValue('--snowflake-method-margin-room')).toBe('226px');
	});

	it('reads an empty stream as having no margin at all', () => {
		const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
		const contentEl = document.body.createDiv();
		Object.assign(view, {
			contentEl,
			streamEl: contentEl.createDiv(),
			mounted: new Map(),
			milestonesFit: () => true,
		});
		(view as unknown as { syncMarginRoom(): void }).syncMarginRoom();
		expect(contentEl.style.getPropertyValue('--snowflake-method-margin-room')).toBe('0px');
		expect(contentEl.classList.contains('is-revision-tight')).toBe(true);
	});
});
