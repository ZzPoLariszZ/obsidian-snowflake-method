import { describe, expect, it, vi } from 'vitest';
import type { Menu } from 'obsidian';

import { t as translate } from '../../src/i18n';
import { addOpenFileRecoveryItem, type FileRecoveryMenuDeps } from '../../src/ui/history-menu';
import type { Translate } from '../../src/ui/modals';

interface RecordedItem {
	section: string;
	title: string;
	icon: string;
	click: (() => void) | null;
}

/** A menu that remembers what was added to it, as the file menu tests do. */
function recordingMenu(): { menu: Menu; items: RecordedItem[] } {
	const items: RecordedItem[] = [];
	const menu = {
		addItem(build: (item: unknown) => void) {
			const entry: RecordedItem = { section: '', title: '', icon: '', click: null };
			const handle = {
				setSection: (section: string) => ((entry.section = section), handle),
				setTitle: (title: string) => ((entry.title = title), handle),
				setIcon: (icon: string) => ((entry.icon = icon), handle),
				onClick: (click: () => void) => ((entry.click = click), handle),
			};
			build(handle);
			items.push(entry);
			return menu;
		},
	};
	return { menu: menu as unknown as Menu, items };
}

const en: Translate = (key, vars) => translate('en', key, vars);
const zh: Translate = (key, vars) => translate('zh-CN', key, vars);

const deps = (over: Partial<FileRecoveryMenuDeps>): FileRecoveryMenuDeps => ({
	t: en,
	section: 'snowflake-method',
	state: 'available',
	open: () => 'opened',
	notice: vi.fn(),
	...over,
});

describe('the Open File recovery menu item', () => {
	it('stands in the plugin’s section with an icon, in the project’s language', () => {
		const { menu, items } = recordingMenu();
		expect(addOpenFileRecoveryItem(menu, deps({}))).toBe(true);
		expect(items).toMatchObject([
			{ section: 'snowflake-method', title: 'Open File recovery', icon: 'history' },
		]);
		const chinese = recordingMenu();
		addOpenFileRecoveryItem(chinese.menu, deps({ t: zh }));
		expect(chinese.items[0]?.title).toBe('打开文件恢复');
	});

	it('is not offered where the device keeps no copies', () => {
		const { menu, items } = recordingMenu();
		expect(addOpenFileRecoveryItem(menu, deps({ state: 'unsupported' }))).toBe(false);
		expect(items).toEqual([]);
	});

	it('opens the dialog, and says so when the core plugin is off', () => {
		const opened = vi.fn(() => 'opened' as const);
		const quiet = recordingMenu();
		const notice = vi.fn();
		addOpenFileRecoveryItem(quiet.menu, deps({ open: opened, notice }));
		quiet.items[0]?.click?.();
		expect(opened).toHaveBeenCalledTimes(1);
		expect(notice).not.toHaveBeenCalled();
		// The core plugin off: the item stands, and a click says where the switch is.
		const off = recordingMenu();
		addOpenFileRecoveryItem(off.menu, deps({ state: 'disabled', open: () => 'off', notice }));
		off.items[0]?.click?.();
		expect(notice).toHaveBeenCalledWith(en('history.recovery.off'));
		const gone = recordingMenu();
		addOpenFileRecoveryItem(gone.menu, deps({ state: 'unreadable', open: () => 'unsupported', notice }));
		gone.items[0]?.click?.();
		expect(notice).toHaveBeenLastCalledWith(en('history.recovery.unsupported'));
	});
});
