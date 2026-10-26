import { App, Notice, Platform } from 'obsidian';

import { TABLET_QUERY } from './device';
import { SnowflakeModal } from './dialog-base';
import { DIALOG_CLASS } from './dialog-class';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface MobileDiagnosticsDeps {
	t: Translate;
	/** The plugin's manifest version. */
	version: string;
}

/** How long the recorder listens for the next touch sequence. */
export const RECORDER_WINDOW_MS = 20_000;

/** The events a touch sequence is made of, in the order a phone fires them. */
const RECORDED_EVENTS = [
	'touchstart',
	'touchmove',
	'touchend',
	'touchcancel',
	'pointerdown',
	'pointermove',
	'pointerup',
	'pointercancel',
	'mousedown',
	'mouseup',
	'click',
	'dblclick',
	'contextmenu',
	'dragstart',
	'selectionchange',
] as const;

/** The platform flags the API publishes, read by name so a missing one shows as such. */
const PLATFORM_FLAGS = [
	'isDesktop',
	'isMobile',
	'isDesktopApp',
	'isMobileApp',
	'isIosApp',
	'isAndroidApp',
	'isPhone',
	'isTablet',
	'isMacOS',
	'isWin',
	'isLinux',
	'isSafari',
] as const;

const CSS_VARIABLES = [
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
] as const;

const MEDIA_QUERIES = ['(pointer: coarse)', '(hover: none)', '(any-hover: hover)', TABLET_QUERY] as const;

/** The build stamp a deploy script appends to the bundle, if any. */
export function readBuildStamp(win: Window): string | null {
	const stamp = (win as Window & { __snowflakeBuild?: unknown }).__snowflakeBuild;
	return typeof stamp === 'string' ? stamp : null;
}

/** The facts a device can tell about itself, as name and value pairs. */
export function diagnosticsReport(win: Window, version: string): [string, string][] {
	const doc = win.document;
	const flags = Platform as unknown as Record<string, unknown>;
	const lines: [string, string][] = [];
	lines.push(['plugin', `${version}${readBuildStamp(win) === null ? '' : ` (${readBuildStamp(win) ?? ''})`}`]);
	lines.push(['platform', PLATFORM_FLAGS.filter((flag) => flags[flag] === true).join(' ') || 'none'] );
	lines.push(['userAgent', win.navigator.userAgent]);
	lines.push(['maxTouchPoints', String(win.navigator.maxTouchPoints)]);
	lines.push(['body', [...doc.body.classList].filter((name) => /^(is-|theme-)/.test(name)).join(' ')]);
	lines.push(['viewport', `${win.innerWidth}×${win.innerHeight} @${win.devicePixelRatio}`]);
	const visual = win.visualViewport as VisualViewport | null | undefined;
	lines.push([
		'visualViewport',
		visual === null || visual === undefined
			? 'none'
			: `${Math.round(visual.width)}×${Math.round(visual.height)} offset ${Math.round(visual.offsetLeft)},${Math.round(visual.offsetTop)} scale ${visual.scale}`,
	]);
	const body = win.getComputedStyle(doc.body);
	for (const name of CSS_VARIABLES) lines.push([name, body.getPropertyValue(name).trim() || 'unset']);
	lines.push(['root font size', win.getComputedStyle(doc.documentElement).fontSize]);
	for (const query of MEDIA_QUERIES) lines.push([query, String(win.matchMedia(query).matches)]);
	lines.push(['fullscreenEnabled', String(doc.fullscreenEnabled)]);
	lines.push(['requestFullscreen', typeof doc.documentElement.requestFullscreen]);
	lines.push(['queryLocalFonts', typeof (win as Window & { queryLocalFonts?: unknown }).queryLocalFonts]);
	lines.push(['electron', String((win as Window & { electron?: unknown }).electron !== undefined)]);
	lines.push(['clipboard.readText', typeof win.navigator.clipboard?.readText]);
	lines.push(['clipboard.writeText', typeof win.navigator.clipboard?.writeText]);
	lines.push(['indexedDB', typeof win.indexedDB]);
	return lines;
}

/** One recorded event: what fired, whether the browser fired it, when, and on what. */
export interface RecordedEvent {
	type: string;
	trusted: boolean;
	button: number | null;
	/** Milliseconds since the first recorded event. */
	at: number;
	target: string;
}

/** A short name for an event's target: tag, the plugin's first class, a label. */
export function describeTarget(target: EventTarget | null): string {
	if (!(target instanceof Element)) return target === null ? 'none' : 'node';
	const own = [...target.classList].find((name) => name.startsWith('snowflake-method'));
	const label = target.getAttribute('aria-label') ?? '';
	return `${target.tagName.toLowerCase()}${own === undefined ? '' : `.${own}`}${label === '' ? '' : `[${label}]`}`;
}

/**
 * Records the touch sequence of the next window: every touch, pointer, mouse
 * and menu event the window fires, with whether the browser fired it (a long
 * press Obsidian synthesises is not trusted) and its offset from the first.
 * Hands the list back when the window closes, and returns the release for
 * an earlier stop.
 */
export function recordTouches(
	win: Window,
	windowMs: number,
	done: (events: RecordedEvent[]) => void,
): () => void {
	const events: RecordedEvent[] = [];
	let first: number | null = null;
	const onEvent = (event: Event): void => {
		if (event.type === 'selectionchange' && events.length === 0) return;
		const now = win.performance.now();
		if (first === null) first = now;
		const last = events[events.length - 1];
		if (last !== undefined && last.type === event.type && /move$|^selectionchange$/.test(event.type)) return;
		events.push({
			type: event.type,
			trusted: event.isTrusted === true,
			button: event instanceof MouseEvent ? event.button : null,
			at: Math.round(now - first),
			target: describeTarget(event.target),
		});
	};
	for (const type of RECORDED_EVENTS) win.addEventListener(type, onEvent, { capture: true, passive: true });
	let timer: number | null = win.setTimeout(() => {
		timer = null;
		release();
		done(events);
	}, windowMs);
	const release = (): void => {
		for (const type of RECORDED_EVENTS) win.removeEventListener(type, onEvent, { capture: true });
		if (timer !== null) {
			win.clearTimeout(timer);
			timer = null;
		}
	};
	return release;
}

/** The report as the text the Copy button writes. */
export function reportText(lines: [string, string][], recording: RecordedEvent[] | null, t: Translate): string {
	const head = lines.map(([name, value]) => `${name}: ${value}`);
	if (recording === null) return head.join('\n');
	const tail = recording.length === 0
		? [t('diagnostics.noTouches')]
		: recording.map((event) => `${String(event.at).padStart(5, ' ')} ms  ${event.type}${event.trusted ? '' : ' (synthetic)'}${event.button === null ? '' : ` button ${event.button}`}  ${event.target}`);
	return [...head, '', `${t('diagnostics.recorded')}:`, ...tail].join('\n');
}

/**
 * The dialog behind the mobile-only command: a read-only report of what the
 * device says about itself, a Copy button, and a recorder for the next touch
 * sequence. The App Store build cannot be inspected, so this is the one
 * evidence a phone can give. Recording closes the dialog, since a touch
 * outside it would only close it, and the dialog returns with the recording.
 */
export class MobileDiagnosticsModal extends SnowflakeModal {
	constructor(
		app: App,
		private readonly deps: MobileDiagnosticsDeps,
		private readonly recording: RecordedEvent[] | null = null,
	) {
		super(app);
	}

	onOpen(): void {
		const { t } = this.deps;
		const win = this.contentEl.win;
		this.modalEl.addClass(DIALOG_CLASS, 'snowflake-method-diagnostics');
		this.titleEl.setText(t('diagnostics.title'));
		this.contentEl.createEl('p', { cls: 'snowflake-method-diagnostics-hint', text: t('diagnostics.hint') });
		const lines = diagnosticsReport(win, this.deps.version);
		const text = reportText(lines, this.recording, t);
		this.contentEl.createEl('pre', { cls: 'snowflake-method-diagnostics-report', text });
		const actions = this.contentEl.createDiv({ cls: 'snowflake-method-modal-actions' });
		const record = actions.createEl('button', { text: t('diagnostics.record') });
		record.addEventListener('click', () => {
			this.close();
			new Notice(t('diagnostics.recordingNotice', { seconds: RECORDER_WINDOW_MS / 1000 }));
			recordTouches(win, RECORDER_WINDOW_MS, (events) => {
				new MobileDiagnosticsModal(this.app, this.deps, events).open();
			});
		});
		const copy = actions.createEl('button', { cls: 'mod-cta', text: t('diagnostics.copy') });
		copy.addEventListener('click', () => {
			void win.navigator.clipboard.writeText(text).then(() => {
				new Notice(t('diagnostics.copied'));
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
