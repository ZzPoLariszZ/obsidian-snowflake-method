/**
 * The plugin's entries for selected words and the note they stand in, shared
 * by the manuscript stream's right-click menu, a project note's own, and the
 * menu over a box of the dashboard or a dialog (`field-menu.ts`), so all of
 * them offer the same things in the same words: the words made into an
 * entity, added to one the project has as an alias, or made into a sticky
 * note, and the note, the manuscript or the words written out as plain text.
 *
 * An entry that needs selected words stands greyed while there are none, as
 * the stream's foreshadowing entries do, so the menu keeps one shape and says
 * what it would do. Nothing here acts: every entry hands back through a
 * callback, and the callbacks are where the guards live.
 */

import type { Menu } from 'obsidian';

import { exportProse } from '../domain';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** A name read off selected words: their text without the markup, on one line. */
export function nameFromSelection(selection: string): string {
	return exportProse(selection, [], {
		indent: false,
		paragraphSpacing: false,
		script: 'latin',
	})
		.replace(/\s+/gu, ' ')
		.trim();
}

export interface SelectionMakerOptions {
	t: Translate;
	/** The menu section every entry joins. */
	section: string;
	/** The words selected, as the note holds them; empty where nothing is. */
	selection: string;
	/** The selected words as a name, for the kind the author picks next. */
	addEntity: (name: string) => void;
	/** The selected words as an alias, for the note the author picks next. */
	addAlias: (name: string) => void;
	/** The selected words as a sticky note's text. */
	addStickyNote: (text: string) => void;
}

/** The entries that make something of the selected words: a note, an alias of one, a sticky note. */
export function addSelectionMakers(menu: Menu, options: SelectionMakerOptions): void {
	const { t, section } = options;
	const name = nameFromSelection(options.selection);
	const text = options.selection.trim();
	menu.addItem((item) =>
		item
			.setSection(section)
			.setTitle(t('manuscript.menu.addEntity'))
			.setIcon('square-plus')
			.setDisabled(name.length === 0)
			.onClick(() => {
				options.addEntity(name);
			}),
	);
	menu.addItem((item) =>
		item
			.setSection(section)
			.setTitle(t('manuscript.menu.addAlias'))
			.setIcon('tags')
			.setDisabled(name.length === 0)
			.onClick(() => {
				options.addAlias(name);
			}),
	);
	menu.addItem((item) =>
		item
			.setSection(section)
			.setTitle(t('manuscript.menu.addStickyNote'))
			.setIcon('sticker')
			.setDisabled(text.length === 0)
			.onClick(() => {
				options.addStickyNote(text);
			}),
	);
}

export interface ExportEntryOptions {
	t: Translate;
	section: string;
	/** The words selected, as the note holds them; empty where nothing is. */
	selection: string;
	/** Only where the words stand in a note: a box of a dialog is in none. */
	exportNote?: () => void;
	/** Only where the whole manuscript is in view: the stream. */
	exportManuscript?: () => void;
	exportSelection: (text: string) => void;
}

/** The note, the manuscript where it is in view, and the selected words, as plain text. */
export function addExportEntries(menu: Menu, options: ExportEntryOptions): void {
	const { t, section, exportNote, exportManuscript } = options;
	if (exportNote !== undefined) {
		menu.addItem((item) =>
			item
				.setSection(section)
				.setTitle(t('manuscript.exportNote'))
				.setIcon('file-down')
				.onClick(() => {
					exportNote();
				}),
		);
	}
	if (exportManuscript !== undefined) {
		menu.addItem((item) =>
			item
				.setSection(section)
				.setTitle(t('commands.exportManuscript'))
				.setIcon('book-down')
				.onClick(() => {
					exportManuscript();
				}),
		);
	}
	const text = options.selection.trim();
	menu.addItem((item) =>
		item
			.setSection(section)
			.setTitle(t('manuscript.menu.exportSelection'))
			.setIcon('text-select')
			.setDisabled(text.length === 0)
			.onClick(() => {
				options.exportSelection(text);
			}),
	);
}
