// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'obsidian';

import {
	TABLET_QUERY,
	coarsePointer,
	deviceClass,
	isMobileDevice,
	isPhoneBody,
	statusBarShown,
	watchDeviceClass,
} from '../../src/ui/device';
import { nextFocusLevel } from '../../src/ui/view-model';

type Listener = () => void;

/** A window whose media answers are chosen, with a hand on the tablet query. */
function mediaWindow(answers: Record<string, boolean>) {
	const listeners = new Map<string, Set<Listener>>();
	const lists = new Map<string, { matches: boolean }>();
	const win = {
		matchMedia: (query: string) => {
			const list = lists.get(query) ?? { matches: answers[query] === true };
			lists.set(query, list);
			return {
				get matches() {
					return list.matches;
				},
				media: query,
				addEventListener: (_type: string, fn: Listener) => {
					if (!listeners.has(query)) listeners.set(query, new Set());
					listeners.get(query)?.add(fn);
				},
				removeEventListener: (_type: string, fn: Listener) => {
					listeners.get(query)?.delete(fn);
				},
			} as unknown as MediaQueryList;
		},
	};
	const flip = (query: string, matches: boolean): void => {
		const list = lists.get(query);
		if (list) list.matches = matches;
		for (const fn of listeners.get(query) ?? []) fn();
	};
	const count = (query: string): number => listeners.get(query)?.size ?? 0;
	return { win, flip, count };
}

afterEach(() => {
	Platform.isMobile = false;
});

describe('device class', () => {
	it('is a desktop whatever the window says while the app is not the mobile one', () => {
		const { win } = mediaWindow({ [TABLET_QUERY]: false });
		expect(isMobileDevice()).toBe(false);
		expect(deviceClass(win)).toBe('desktop');
		expect(statusBarShown()).toBe(true);
	});

	it('reads Obsidian\'s tablet query on the mobile app', () => {
		Platform.isMobile = true;
		expect(deviceClass(mediaWindow({ [TABLET_QUERY]: true }).win)).toBe('tablet');
		expect(deviceClass(mediaWindow({ [TABLET_QUERY]: false }).win)).toBe('phone');
		expect(statusBarShown()).toBe(false);
	});

	it('names the phone body and the coarse pointer from the document and window', () => {
		document.body.classList.remove('is-phone');
		expect(isPhoneBody(document)).toBe(false);
		document.body.classList.add('is-phone');
		expect(isPhoneBody(document)).toBe(true);
		document.body.classList.remove('is-phone');
		expect(coarsePointer(mediaWindow({ '(pointer: coarse)': true }).win)).toBe(true);
		expect(coarsePointer(mediaWindow({}).win)).toBe(false);
	});

	it('watches the flip between tablet and phone and releases its listener', () => {
		Platform.isMobile = true;
		const media = mediaWindow({ [TABLET_QUERY]: true });
		const seen = vi.fn();
		const release = watchDeviceClass(media.win, seen);
		expect(media.count(TABLET_QUERY)).toBe(1);
		media.flip(TABLET_QUERY, true);
		expect(seen).not.toHaveBeenCalled();
		media.flip(TABLET_QUERY, false);
		expect(seen).toHaveBeenCalledWith('phone', 'tablet');
		media.flip(TABLET_QUERY, true);
		expect(seen).toHaveBeenLastCalledWith('tablet', 'phone');
		release();
		expect(media.count(TABLET_QUERY)).toBe(0);
	});

	it('watches nothing on a desktop', () => {
		const media = mediaWindow({ [TABLET_QUERY]: true });
		const release = watchDeviceClass(media.win, vi.fn());
		expect(media.count(TABLET_QUERY)).toBe(0);
		release();
	});
});

describe('focus ladder', () => {
	it('climbs to solo where the device offers it and stops at deep where it does not', () => {
		expect(nextFocusLevel('off', { solo: true })).toBe('on');
		expect(nextFocusLevel('deep', { solo: true })).toBe('solo');
		expect(nextFocusLevel('solo', { solo: true })).toBe('off');
		expect(nextFocusLevel('deep', { solo: false })).toBe('off');
		expect(nextFocusLevel('solo', { solo: false })).toBe('off');
		expect(nextFocusLevel('on', { solo: false })).toBe('deep');
	});
});
