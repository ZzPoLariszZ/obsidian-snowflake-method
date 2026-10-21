import type { Menu } from 'obsidian';

import type { Translate } from './modals';

/**
 * The way into Obsidian's own File recovery dialog from a project note's
 * menu, where the note's versions are read and restored. The plugin counts
 * those versions in its modification history; restoring one is Obsidian's.
 */

/** Whether the device keeps copies at all, as the File recovery service reports it. */
export type FileRecoveryState = 'available' | 'disabled' | 'unsupported' | 'unreadable';

export interface FileRecoveryMenuDeps {
	t: Translate;
	/** The plugin's own section of the menu. */
	section: string;
	state: FileRecoveryState;
	/** Opens the dialog on the note; what it came to. */
	open(): 'opened' | 'off' | 'unsupported';
	/** Says why the dialog did not open. */
	notice(message: string): void;
}

/**
 * Adds "Open File recovery" to the section. Not offered where the device
 * keeps no copies, as on iOS; where the core plugin is merely off, the item
 * stands and a click says so, since turning it on is a moment's work. False
 * where nothing was added.
 */
export function addOpenFileRecoveryItem(menu: Menu, deps: FileRecoveryMenuDeps): boolean {
	if (deps.state === 'unsupported') return false;
	menu.addItem((item) =>
		item
			.setSection(deps.section)
			.setTitle(deps.t('history.openFileRecovery'))
			.setIcon('history')
			.onClick(() => {
				switch (deps.open()) {
					case 'off':
						deps.notice(deps.t('history.recovery.off'));
						return;
					case 'unsupported':
						deps.notice(deps.t('history.recovery.unsupported'));
						return;
					case 'opened':
						return;
				}
			}),
	);
	return true;
}
