// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'obsidian';
import {
	RECORDER_WINDOW_MS,
	describeTarget,
	diagnosticsReport,
	readBuildStamp,
	recordTouches,
	reportText,
	type RecordedEvent,
} from '../../src/ui/mobile-diagnostics';
import { TABLET_QUERY } from '../../src/ui/device';

const t = (key: string, vars?: Record<string, string | number>): string =>
	vars === undefined ? key : `${key} ${JSON.stringify(vars)}`;

const EXPECTED_FIELDS = [
	'plugin',
	'platform',
	'userAgent',
	'maxTouchPoints',
	'body',
	'viewport',
	'visualViewport',
	'--safe-area-inset-top',
	'--safe-area-inset-bottom',
	'--safe-area-inset-left',
	'--safe-area-inset-right',
	'--keyboard-height',
	'--navbar-height',
	'--mobile-toolbar-height',
	'--touch-size-m',
	'--input-height',
	'--view-header-height',
	'root font size',
	'(pointer: coarse)',
	'(hover: none)',
	'(any-hover: hover)',
	TABLET_QUERY,
	'fullscreenEnabled',
	'requestFullscreen',
	'queryLocalFonts',
	'electron',
	'clipboard.readText',
	'clipboard.writeText',
	'indexedDB',
];

type StampedWindow = Window & { __snowflakeBuild?: unknown };

describe('diagnosticsReport', () => {
	const stamped = window as StampedWindow;
	const matchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

	beforeEach(() => {
		Object.defineProperty(window, 'matchMedia', {
			configurable: true,
			writable: true,
			value: (query: string) => ({ matches: query === '(pointer: coarse)' }) as MediaQueryList,
		});
		Platform.isMobile = true;
		Platform.isPhone = true;
	});

	afterEach(() => {
		if (matchMedia === undefined) delete (window as { matchMedia?: unknown }).matchMedia;
		else Object.defineProperty(window, 'matchMedia', matchMedia);
		delete stamped.__snowflakeBuild;
		Platform.isMobile = false;
		Platform.isPhone = false;
		document.body.className = '';
	});

	it('lists every field in order', () => {
		const names = diagnosticsReport(window, '1.2.3').map(([name]) => name);
		expect(names).toEqual(EXPECTED_FIELDS);
	});

	it('names the version, the platform flags and the media answers', () => {
		document.body.classList.add('is-mobile', 'is-phone', 'theme-dark', 'mod-macos');
		const lines = new Map(diagnosticsReport(window, '1.2.3'));
		expect(lines.get('plugin')).toBe('1.2.3');
		expect(lines.get('platform')?.split(' ')).toEqual(expect.arrayContaining(['isMobile', 'isPhone']));
		expect(lines.get('platform')).not.toContain('isTablet');
		expect(lines.get('body')).toBe('is-mobile is-phone theme-dark');
		expect(lines.get('viewport')).toBe(`${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}`);
		expect(lines.get('(pointer: coarse)')).toBe('true');
		expect(lines.get('(hover: none)')).toBe('false');
		expect(lines.get('maxTouchPoints')).toBe(String(window.navigator.maxTouchPoints));
	});

	it('carries a build stamp when the deploy left one', () => {
		expect(readBuildStamp(window)).toBeNull();
		stamped.__snowflakeBuild = '2026-10-25T18:29:27.979Z 1590631+';
		expect(readBuildStamp(window)).toBe('2026-10-25T18:29:27.979Z 1590631+');
		const lines = new Map(diagnosticsReport(window, '1.2.3'));
		expect(lines.get('plugin')).toBe('1.2.3 (2026-10-25T18:29:27.979Z 1590631+)');
		stamped.__snowflakeBuild = 7;
		expect(readBuildStamp(window)).toBeNull();
	});
});

describe('describeTarget', () => {
	it('names an element by tag, plugin class and label', () => {
		const button = document.createElementNS('http://www.w3.org/1999/xhtml', 'button');
		button.classList.add('clickable-icon', 'snowflake-method-toolbar-button');
		button.setAttribute('aria-label', 'Add scene');
		expect(describeTarget(button)).toBe('button.snowflake-method-toolbar-button[Add scene]');
		expect(describeTarget(document.createElementNS('http://www.w3.org/1999/xhtml', 'div'))).toBe('div');
		expect(describeTarget(document.createTextNode('x'))).toBe('node');
		expect(describeTarget(null)).toBe('none');
	});
});

describe('recordTouches', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('records the sequence, folds repeated moves and stops after its window', () => {
		const done = vi.fn<(events: RecordedEvent[]) => void>();
		const host = document.body.appendChild(document.createElementNS('http://www.w3.org/1999/xhtml', 'div'));
		host.classList.add('snowflake-method-dashboard');
		recordTouches(window, RECORDER_WINDOW_MS, done);
		document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
		host.dispatchEvent(new Event('touchstart', { bubbles: true }));
		host.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
		for (let i = 0; i < 3; i += 1) host.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
		host.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
		host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 0 }));
		host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
		document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
		expect(done).not.toHaveBeenCalled();
		vi.advanceTimersByTime(RECORDER_WINDOW_MS - 1);
		expect(done).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(done).toHaveBeenCalledTimes(1);
		const events = done.mock.calls[0]?.[0] ?? [];
		expect(events.map((event) => event.type)).toEqual([
			'touchstart',
			'pointerdown',
			'pointermove',
			'pointerup',
			'contextmenu',
			'click',
			'selectionchange',
		]);
		expect(events[0]).toMatchObject({ at: 0, trusted: false, button: null, target: 'div.snowflake-method-dashboard' });
		expect(events[1]?.button).toBe(0);
		expect(events.every((event, i) => i === 0 || event.at >= (events[i - 1]?.at ?? 0))).toBe(true);
		host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(events).toHaveLength(7);
		host.remove();
	});

	it('stops recording when released early', () => {
		const done = vi.fn<(events: RecordedEvent[]) => void>();
		const release = recordTouches(window, RECORDER_WINDOW_MS, done);
		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		release();
		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		vi.advanceTimersByTime(RECORDER_WINDOW_MS);
		expect(done).not.toHaveBeenCalled();
		release();
	});
});

describe('reportText', () => {
	const lines: [string, string][] = [
		['plugin', '1.2.3'],
		['platform', 'isMobile isPhone'],
	];

	it('writes the report alone without a recording', () => {
		expect(reportText(lines, null, t)).toBe('plugin: 1.2.3\nplatform: isMobile isPhone');
	});

	it('says when the window saw no touch', () => {
		expect(reportText(lines, [], t)).toBe(
			'plugin: 1.2.3\nplatform: isMobile isPhone\n\ndiagnostics.recorded:\ndiagnostics.noTouches',
		);
	});

	it('lists the recorded events with their offsets, trust and button', () => {
		const events: RecordedEvent[] = [
			{ type: 'touchstart', trusted: true, button: null, at: 0, target: 'div' },
			{ type: 'contextmenu', trusted: false, button: 0, at: 802, target: 'div.snowflake-method-card[Scene A]' },
		];
		expect(reportText(lines, events, t).split('\n').slice(3)).toEqual([
			'diagnostics.recorded:',
			'    0 ms  touchstart  div',
			'  802 ms  contextmenu (synthetic) button 0  div.snowflake-method-card[Scene A]',
		]);
	});
});
