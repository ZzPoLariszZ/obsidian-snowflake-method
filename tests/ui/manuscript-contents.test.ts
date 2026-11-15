// @vitest-environment happy-dom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentsHub } from '../../src/ui/contents-hub';
import {
	MILESTONE_LANE_EMS,
	RAIL_GAP,
	RAIL_TIGHT_MARGIN,
	contentsIsTight,
} from '../../src/ui/margin-room';
import { SnowflakeManuscriptView } from '../../src/ui/manuscript-view';
import { installObsidianDom } from '../helpers/obsidian-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {},
		setIcon: (el: HTMLElement, icon: string) => {
			el.setAttribute('data-icon', icon);
		},
		setTooltip: (el: HTMLElement, text: string) => {
			el.setAttribute('data-tooltip', text);
		},
	};
});

/** The parts of the view this file reaches past its public face for. */
interface Inside {
	activePath: string | null;
	shape: string;
	model: {
		projectPath: string;
		readOnly?: boolean;
		segments: { path: string; title: string }[];
	} | null;
	closing: boolean;
	milestoneEdge: number | null;
	milestoneType: number | null;
	renderToolbar(): void;
	mountContents(): void;
	dropContents(): void;
	syncMarginRoom(): void;
	syncContents(): void;
	applyContents(): void;
}

interface Stream {
	view: Inside;
	contentEl: HTMLElement;
	streamEl: HTMLElement;
	column: HTMLElement;
	hub: ContentsHub;
	settings: { contents: boolean; before: number; milestones: { enabled: boolean } };
	/** What the host was asked for, in order. */
	asked: string[];
	/** Every chapter the page was sent to. */
	went: string[];
	/** The pane's measures, which a test moves before asking the view to measure. */
	lay: (streamWidth: number, columnWidth?: number) => void;
}

const COLUMN = 764;

const chapter = (number: number): { path: string; title: string } => ({
	path: `Novel/50_Manuscript/Chapter ${String(number)}.md`,
	title: `Chapter ${String(number)}`,
});

/**
 * A stream over the view's prototype: a pane with a column in it whose
 * widths a test sets, a manuscript of three chapters, and a host that
 * records what it is asked. The wheel is mounted as the page's build mounts
 * it, between where the bar and the page stand.
 */
const stream = (): Stream => {
	const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
	const contentEl = document.body.createDiv();
	const hub = new ContentsHub();
	const asked: string[] = [];
	const went: string[] = [];
	const settings = {
		contents: true,
		before: 5,
		after: 5,
		typewriter: false,
		focusLevel: 'off',
		milestones: { enabled: false },
	};
	const measures = { stream: 1400, column: COLUMN };
	Object.assign(view, {
		contentEl,
		containerEl: contentEl,
		toolbarButtons: [],
		editingPath: null,
		caretCard: null,
		releaseWritingFaces: null,
		modeToggles: {},
		closing: false,
		contents: null,
		contentsMargin: null,
		contentsToggle: null,
		contentsPainted: '',
		contentsRows: [],
		contentsShape: null,
		contentsRoomy: false,
		contentsShown: false,
		contentsTold: null,
		contentsBound: null,
		releaseStreamWatch: null,
		milestoneEdge: null,
		milestoneReach: 0,
		milestoneType: null,
		model: { projectPath: 'Novel/Novel.md', segments: [chapter(1), chapter(2), chapter(3)] },
		shape: 'three chapters',
		activePath: chapter(2).path,
		t: (key: string) => key,
		milestonesFit: () => true,
		goTo: (path: string) => {
			went.push(path);
			return Promise.resolve();
		},
		showError: () => undefined,
		host: {
			mountWritingFaces: () => null,
			manuscriptWindowSettings: () => settings,
			openMarginCards: () => Promise.resolve(),
			marginCards: { spotlight: () => undefined },
			contents: hub,
			isReduceMotionEnabled: () => false,
			openContents: () => {
				asked.push('open');
				return Promise.resolve();
			},
			toggleManuscriptContents: () => {
				asked.push('toggle');
				return Promise.resolve();
			},
		},
	});
	const inside = view as unknown as Inside;
	inside.renderToolbar();
	inside.mountContents();
	const streamEl = contentEl.createDiv({ cls: 'snowflake-method-manuscript-stream' });
	Object.defineProperty(streamEl, 'clientWidth', { get: () => measures.stream });
	Object.defineProperty(streamEl, 'clientHeight', { value: 900 });
	Object.defineProperty(streamEl, 'offsetTop', { value: 73 });
	Object.defineProperty(streamEl, 'offsetLeft', { value: 0 });
	const column = streamEl.createDiv({ cls: 'snowflake-method-segment' });
	Object.defineProperty(column, 'offsetWidth', { get: () => measures.column });
	Object.assign(view, {
		streamEl,
		mounted: new Map([[chapter(2).path, { el: column }]]),
	});
	return {
		view: inside,
		contentEl,
		streamEl,
		column,
		hub,
		settings,
		asked,
		went,
		lay: (streamWidth, columnWidth = COLUMN) => {
			measures.stream = streamWidth;
			measures.column = columnWidth;
		},
	};
};

const door = (contentEl: HTMLElement): HTMLButtonElement => {
	const found = contentEl.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-contents');
	if (found === null) throw new Error('the bar has no door to the wheel');
	return found;
};

const read = (contentEl: HTMLElement, name: string): string =>
	contentEl.style.getPropertyValue(name);

describe('the stream’s wheel of chapters', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		document.body.replaceChildren();
	});

	it('counts the wheel’s room by the rail’s threshold, less the milestones’ lane', () => {
		expect(contentsIsTight(RAIL_TIGHT_MARGIN - 1, 0)).toBe(true);
		expect(contentsIsTight(RAIL_TIGHT_MARGIN, 0)).toBe(false);
		expect(contentsIsTight(RAIL_TIGHT_MARGIN + 85, 86)).toBe(true);
		expect(contentsIsTight(RAIL_TIGHT_MARGIN + 86, 86)).toBe(false);
	});

	it('stands the wheel between the bar and the page, so the Tab key reaches it before the chapters', () => {
		const { contentEl } = stream();
		expect([...contentEl.children].map((child) => child.className.split(' ')[0])).toEqual([
			'snowflake-method-manuscript-toolbar',
			'snowflake-method-contents-margin',
			'snowflake-method-manuscript-stream',
		]);
		expect(
			contentEl.querySelector('.snowflake-method-contents-margin > nav.snowflake-method-contents-wheel'),
		).not.toBeNull();
	});

	it('shows the wheel where the margin holds it, and tells the stylesheet where the page stands', () => {
		const { view, contentEl, lay } = stream();
		// A margin of exactly the card's floor and its room, on either side.
		lay(COLUMN + 2 * RAIL_TIGHT_MARGIN);
		view.syncMarginRoom();
		expect(contentEl.classList.contains('is-contents')).toBe(true);
		expect(read(contentEl, '--snowflake-method-margin-room')).toBe(`${String(RAIL_TIGHT_MARGIN)}px`);
		expect(read(contentEl, '--snowflake-method-contents-lane')).toBe('0px');
		expect(read(contentEl, '--snowflake-method-stream-top')).toBe('73px');
		expect(read(contentEl, '--snowflake-method-stream-left')).toBe('0px');
		expect(read(contentEl, '--snowflake-method-stream-height')).toBe('900px');
		// A pixel less on each side and the wheel is held back, as the cards are.
		lay(COLUMN + 2 * RAIL_TIGHT_MARGIN - 2);
		view.syncMarginRoom();
		expect(contentEl.classList.contains('is-contents')).toBe(false);
		expect(contentEl.classList.contains('is-revision-tight')).toBe(true);
	});

	it('leaves the word milestones a lane beside the column, and counts its room without it', () => {
		const { view, contentEl, column, settings, lay } = stream();
		settings.milestones.enabled = true;
		// The labels' type, as the view reads it once from the wheel's box.
		view.milestoneType = 12;
		const floor = Math.round(MILESTONE_LANE_EMS * 12) + RAIL_GAP;
		expect(floor).toBe(86);
		// The margin that holds a wheel with no milestones is short of one now.
		lay(COLUMN + 2 * (RAIL_TIGHT_MARGIN + floor - 1));
		view.syncMarginRoom();
		expect(read(contentEl, '--snowflake-method-contents-lane')).toBe(`${String(floor)}px`);
		expect(contentEl.classList.contains('is-contents')).toBe(false);
		expect(contentEl.classList.contains('is-revision-tight')).toBe(false);
		lay(COLUMN + 2 * (RAIL_TIGHT_MARGIN + floor));
		view.syncMarginRoom();
		expect(contentEl.classList.contains('is-contents')).toBe(true);
		// A label that reaches further than the floor widens the lane to its
		// reach, and the lane never narrows again as labels come and go.
		column.getBoundingClientRect = () => ({ left: 400 }) as DOMRect;
		view.milestoneEdge = 280;
		view.syncMarginRoom();
		expect(read(contentEl, '--snowflake-method-contents-lane')).toBe(`${String(120 + RAIL_GAP)}px`);
		view.milestoneEdge = 350;
		view.syncMarginRoom();
		expect(read(contentEl, '--snowflake-method-contents-lane')).toBe(`${String(120 + RAIL_GAP)}px`);
		view.milestoneEdge = null;
		view.syncMarginRoom();
		expect(read(contentEl, '--snowflake-method-contents-lane')).toBe(`${String(120 + RAIL_GAP)}px`);
		// With the milestones off there is no lane to leave.
		settings.milestones.enabled = false;
		view.syncMarginRoom();
		expect(read(contentEl, '--snowflake-method-contents-lane')).toBe('0px');
	});

	it('puts the wheel away while the setting is off, however wide the margin', () => {
		const { view, contentEl, settings, lay } = stream();
		lay(1800);
		view.syncMarginRoom();
		expect(contentEl.classList.contains('is-contents')).toBe(true);
		settings.contents = false;
		view.applyContents();
		expect(contentEl.classList.contains('is-contents')).toBe(false);
		settings.contents = true;
		view.applyContents();
		expect(contentEl.classList.contains('is-contents')).toBe(true);
	});

	it('makes the bar’s button a switch where the margin holds the wheel', async () => {
		const { view, contentEl, settings, asked, lay } = stream();
		const button = door(contentEl);
		expect(button.getAttribute('data-icon')).toBe('table-of-contents');
		expect(button.getAttribute('type')).toBe('button');
		lay(1800);
		view.syncMarginRoom();
		expect(button.classList.contains('is-active')).toBe(true);
		expect(button.getAttribute('aria-pressed')).toBe('true');
		expect(button.getAttribute('data-tooltip')).toBe(
			'manuscript.contentsShown\nmanuscript.contentsHide',
		);
		button.click();
		await vi.waitFor(() => expect(asked).toEqual(['toggle']));
		// The host flips the setting for every stream and asks each to follow.
		settings.contents = false;
		view.applyContents();
		expect(button.classList.contains('is-active')).toBe(false);
		expect(button.getAttribute('aria-pressed')).toBe('false');
		expect(button.getAttribute('data-tooltip')).toBe(
			'manuscript.contentsHidden\nmanuscript.contentsShow',
		);
		// Live while the stream is only read.
		expect(button.disabled).toBe(false);
	});

	it('makes the button the door to the sidebar where the margin is too narrow', async () => {
		const { view, contentEl, asked, lay } = stream();
		const button = door(contentEl);
		lay(900);
		view.syncMarginRoom();
		expect(button.classList.contains('is-active')).toBe(false);
		// Not a switch here: a press turns nothing on or off.
		expect(button.hasAttribute('aria-pressed')).toBe(false);
		expect(button.getAttribute('data-tooltip')).toBe(
			'manuscript.contentsTight\nmanuscript.contentsOpen',
		);
		button.click();
		await vi.waitFor(() => expect(asked).toEqual(['open']));
		// Widened, the same button is the switch again.
		lay(1800);
		view.syncMarginRoom();
		button.click();
		await vi.waitFor(() => expect(asked).toEqual(['open', 'toggle']));
	});

	it('turns the wheel and the sidebar to the manuscript: its chapters, the page’s one and the loaded reach', () => {
		const { view, contentEl, hub, settings } = stream();
		view.syncContents();
		const feed = hub.current();
		expect(feed?.rows).toEqual([chapter(1), chapter(2), chapter(3)]);
		expect(feed?.active).toBe(chapter(2).path);
		expect(feed?.reach).toBe(5);
		// A manuscript that may be written to: its rows offer what can be
		// done to a chapter.
		expect(feed?.editable).toBe(true);
		const names = [...contentEl.querySelectorAll('.snowflake-method-contents-item')];
		expect(names.map((name) => name.textContent)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
		expect(names[1]?.getAttribute('aria-current')).toBe('true');
		const wheel = contentEl.querySelector<HTMLElement>('.snowflake-method-contents-wheel');
		expect(wheel?.style.getPropertyValue('--snowflake-method-contents-rows')).toBe('11');
		// The page reads on, and the stream is told to keep fewer notes loaded:
		// the same rows, another mark, a shorter wheel.
		view.activePath = chapter(3).path;
		settings.before = 2;
		view.syncContents();
		expect(hub.current()?.rows).toBe(feed?.rows);
		expect(hub.current()?.active).toBe(chapter(3).path);
		expect(hub.current()?.reach).toBe(2);
		expect(wheel?.style.getPropertyValue('--snowflake-method-contents-rows')).toBe('5');
		expect([...contentEl.querySelectorAll('.snowflake-method-contents-item')][0]).toBe(names[0]);
		// A chapter added is another manuscript to list.
		view.model?.segments.push(chapter(4));
		view.shape = 'four chapters';
		view.syncContents();
		expect(hub.current()?.rows).not.toBe(feed?.rows);
		expect(hub.current()?.rows).toHaveLength(4);
		expect(contentEl.querySelectorAll('.snowflake-method-contents-item')).toHaveLength(4);
	});

	it('tells both wheels when the manuscript may not be written to', () => {
		const { view, contentEl, hub } = stream();
		if (view.model !== null) view.model.readOnly = true;
		view.syncContents();
		expect(hub.current()?.editable).toBe(false);
		// The margin's own wheel hears the same: a right-click is left alone.
		const name = contentEl.querySelector<HTMLElement>('.snowflake-method-contents-item');
		const press = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		name?.dispatchEvent(press);
		expect(press.defaultPrevented).toBe(false);
	});

	it('goes to a chapter pressed on the wheel or in the sidebar, and to none the manuscript has lost', async () => {
		const { view, contentEl, hub, went } = stream();
		view.syncContents();
		const names = contentEl.querySelectorAll<HTMLElement>('.snowflake-method-contents-item');
		names[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await vi.waitFor(() => expect(went).toEqual([chapter(3).path]));
		hub.current()?.go(chapter(1).path);
		await vi.waitFor(() => expect(went).toEqual([chapter(3).path, chapter(1).path]));
		hub.current()?.go('Novel/50_Manuscript/Gone.md');
		await Promise.resolve();
		expect(went).toHaveLength(2);
	});

	it('takes its feed back when the stream has no project, and says nothing as it closes', () => {
		const { view, hub } = stream();
		view.syncContents();
		expect(hub.current()).not.toBeNull();
		view.model = null;
		view.shape = '';
		view.syncContents();
		expect(hub.current()).toBeNull();
		// Closing: the chapters coming down must not publish the stream again.
		view.model = { projectPath: 'Novel/Novel.md', segments: [chapter(1)] };
		view.closing = true;
		view.syncContents();
		expect(hub.current()).toBeNull();
	});

	it('takes the wheel down with the page it stood beside', () => {
		const { view, contentEl, lay } = stream();
		lay(1800);
		view.syncMarginRoom();
		expect(contentEl.classList.contains('is-contents')).toBe(true);
		view.dropContents();
		expect(contentEl.querySelector('.snowflake-method-contents-wheel')).toBeNull();
		expect(contentEl.classList.contains('is-contents')).toBe(false);
	});
});
