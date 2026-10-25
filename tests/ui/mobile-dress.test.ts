// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'obsidian';

// The real plugin dresses a document's body; nothing of Obsidian's is
// reached beyond what the module needs to load.
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
import { DEFAULT_SETTINGS } from '../../src/settings';

const HIDE_SCROLLBARS_CLASS = 'snowflake-method-hide-scrollbars';
const HIDE_TOOLTIPS_CLASS = 'snowflake-method-hide-tooltips';

/** Dresses the document with both hiding settings on, on the given kind of device. */
function dress(mobile: boolean): DOMTokenList {
	Platform.isMobile = mobile;
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as {
		applyBodyPreferencesToDocument(targetDocument: Document): void;
	};
	Object.assign(plugin, {
		settings: { ...DEFAULT_SETTINGS, hideScrollbars: true, hideTooltips: true },
		dressedDocuments: new Set<Document>(),
	});
	plugin.applyBodyPreferencesToDocument(document);
	return document.body.classList;
}

/** The scrollbar and tooltip dresses, worn only where a pointer hovers and a bar takes room. */
describe('the hiding dresses on a mobile device', () => {
	afterEach(() => {
		Platform.isMobile = false;
		document.body.className = '';
		document.body.removeAttribute('style');
	});

	it('wears both dresses on the desktop', () => {
		const classes = dress(false);
		expect(classes.contains(HIDE_SCROLLBARS_CLASS)).toBe(true);
		expect(classes.contains(HIDE_TOOLTIPS_CLASS)).toBe(true);
	});

	it('wears neither dress on a phone or a tablet, whatever the settings say', () => {
		const classes = dress(true);
		expect(classes.contains(HIDE_SCROLLBARS_CLASS)).toBe(false);
		expect(classes.contains(HIDE_TOOLTIPS_CLASS)).toBe(false);
	});

	it('takes a dress off again when the device changes', () => {
		dress(false);
		const classes = dress(true);
		expect(classes.contains(HIDE_SCROLLBARS_CLASS)).toBe(false);
		expect(classes.contains(HIDE_TOOLTIPS_CLASS)).toBe(false);
	});
});
