import { Platform } from 'obsidian';

/** The three bodies the stylesheet knows: `is-phone`, `is-tablet`, and neither. */
export type DeviceClass = 'desktop' | 'tablet' | 'phone';

/**
 * Obsidian's own rule for a phone against a tablet: under 600 px in either
 * dimension is a phone, read again at every resize, so an iPad in split view
 * can flip while the app runs.
 */
export const TABLET_QUERY = '(min-width: 600px) and (min-height: 600px)';

/** The one place the platform flag is read, so a test flips a single switch. */
export function isMobileDevice(): boolean {
	return Platform.isMobile;
}

type MediaWindow = Pick<Window, 'matchMedia'>;

/** The device class a window is drawn for: a desktop unless the app is the mobile one. */
export function deviceClass(win: MediaWindow): DeviceClass {
	if (!isMobileDevice()) return 'desktop';
	return win.matchMedia(TABLET_QUERY).matches ? 'tablet' : 'phone';
}

/** Whether a document wears Obsidian's phone body, for code that mirrors the stylesheet. */
export function isPhoneBody(doc: Document): boolean {
	return doc.body.classList.contains('is-phone');
}

/** A touch screen in front, whatever the app says of itself. */
export function coarsePointer(win: MediaWindow): boolean {
	return win.matchMedia('(pointer: coarse)').matches;
}

/** Obsidian hides the status bar on mobile, so an item added there is never seen. */
export function statusBarShown(): boolean {
	return !isMobileDevice();
}

/**
 * Calls back when the device class flips while the app runs. Nothing to
 * watch on a desktop. Returns the release.
 */
export function watchDeviceClass(
	win: MediaWindow,
	callback: (next: DeviceClass, previous: DeviceClass) => void,
): () => void {
	if (!isMobileDevice()) return () => {};
	const query = win.matchMedia(TABLET_QUERY);
	let previous: DeviceClass = query.matches ? 'tablet' : 'phone';
	const onChange = (): void => {
		const next: DeviceClass = query.matches ? 'tablet' : 'phone';
		if (next === previous) return;
		const was = previous;
		previous = next;
		callback(next, was);
	};
	query.addEventListener('change', onChange);
	return () => {
		query.removeEventListener('change', onChange);
	};
}
