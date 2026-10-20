import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

/** A component as a test drives it: what it holds, and the user's hand on it. */
interface Driven {
	change(value: unknown): void;
	getValue(): unknown;
	disabled: boolean;
}

interface Recorded {
	name: string;
	kind: string;
	component: Driven;
}

const { rows, fields } = vi.hoisted(() => ({
	rows: [] as Recorded[],
	fields: [] as { kind: 'text' | 'color'; component: Driven }[],
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	type Build = (component: never) => unknown;
	/** The runtime's Setting, with every component it makes written down under its row's name. */
	class Setting extends runtime.Setting {
		private rowName = '';
		setName(name?: string): this {
			this.rowName = name ?? '';
			return super.setName(name);
		}
		private record(kind: string, build?: Build): Build {
			return (component) => {
				rows.push({ name: this.rowName, kind, component: component });
				build?.(component);
			};
		}
		addToggle(build?: Build): this {
			return super.addToggle(this.record('toggle', build));
		}
		addSlider(build?: Build): this {
			return super.addSlider(this.record('slider', build));
		}
		addDropdown(build?: Build): this {
			return super.addDropdown(this.record('dropdown', build));
		}
		addSearch(build?: Build): this {
			return super.addSearch(this.record('search', build));
		}
	}
	class TextComponent extends runtime.TextComponent {
		constructor(container?: unknown) {
			super(container);
			fields.push({ kind: 'text', component: this });
		}
	}
	class ColorComponent extends runtime.ColorComponent {
		constructor(container?: unknown) {
			super(container);
			fields.push({ kind: 'color', component: this });
		}
	}
	return { ...runtime, Setting, TextComponent, ColorComponent };
});

import { defaultEntityGraphState, patchEntityGraphState, type EntityGraphState } from '../../src/domain';
import {
	hexOfColor,
	nextGroupColor,
	renderGraphControls,
	type GraphControlsKind,
} from '../../src/ui/relationship-graph-controls';

interface PanelOptions {
	state?: Partial<EntityGraphState>;
	kinds?: GraphControlsKind[];
	labels?: string[];
	focus?: string | null;
	readOnly?: boolean;
	query?: string;
}

const ACCENTS: Record<string, string> = { purple: '#7852ee', orange: '#ec7500', green: '#08b94e' };

function mountPanel(options: PanelOptions = {}) {
	rows.length = 0;
	fields.length = 0;
	const dom = new CorkboardDom();
	let state: EntityGraphState = { ...defaultEntityGraphState(), ...options.state };
	let focus = options.focus ?? null;
	const deps = {
		t: (key: string, vars?: Record<string, string | number>) => (vars?.name === undefined ? key : `${key} ${vars.name}`),
		state: () => state,
		query: () => options.query ?? '',
		kinds: () =>
			options.kinds ?? [
				{ id: 'character', name: 'Characters' },
				{ id: 'scene', name: 'Scenes' },
				{ id: 'location', name: 'Location' },
			],
		customKinds: () => [],
		labels: () => options.labels ?? ['Family', 'Rival'],
		focus: () => focus,
		readOnly: () => options.readOnly ?? false,
		accentHex: (name: string) => ACCENTS[name] ?? '#808080',
		onQuery: vi.fn(),
		// The shell takes each change into the state at once; the test refreshes as the shell's paint would.
		onChange: vi.fn((patch: Partial<EntityGraphState>) => {
			state = patchEntityGraphState(state, patch);
		}),
		onFold: vi.fn(),
		onShowWhole: vi.fn(),
	};
	const panel = renderGraphControls(dom.container as unknown as HTMLElement, deps);
	panel.refresh();
	const el = dom.container.querySelector('.snowflake-method-graph-controls')!;
	return {
		dom,
		el,
		panel,
		deps,
		state: () => state,
		setState: (next: EntityGraphState) => {
			state = next;
		},
		setFocus: (next: string | null) => {
			focus = next;
		},
		/** The last component drawn under a row name: a rebuilt row is the one that stands. */
		row: (name: string, kind?: string): Driven =>
			rows.filter((one) => one.name === name && (kind === undefined || one.kind === kind)).pop()!.component,
		section: (name: string): CorkboardElement => el.querySelector(`.mod-${name}`)!,
		lastChange: (): Partial<EntityGraphState> => deps.onChange.mock.calls[deps.onChange.mock.calls.length - 1]![0],
	};
}

describe('the graph controls panel', () => {
	it('builds the native panel: two symbols, five sections, filters open and the rest folded', () => {
		const fixture = mountPanel();
		expect(fixture.el.classes.has('graph-controls')).toBe(true);
		for (const symbol of ['mod-close', 'mod-reset']) {
			const button = fixture.el.querySelector(`.graph-controls-button.${symbol}`)!;
			expect(button.classes.has('clickable-icon')).toBe(true);
			expect(button.getAttribute('aria-label')).toBeTruthy();
		}
		expect(fixture.el.querySelector('.graph-controls-button.mod-open')).toBeNull();
		expect(fixture.section('filter').classes.has('is-collapsed')).toBe(false);
		for (const name of ['color-groups', 'display', 'forces', 'relationships']) {
			expect(fixture.section(name).classes.has('is-collapsed')).toBe(true);
		}
		const local = fixture.section('local');
		expect(local.classes.has('is-collapsed')).toBe(false);
		expect(local.classes.has('is-hidden')).toBe(true);
		expect(fixture.el.querySelector('.snowflake-method-graph-read-only')!.classes.has('is-hidden')).toBe(true);
		expect(fixture.el.querySelector('.mod-search-setting')).not.toBeNull();
	});

	it('folds a section from its header by click and by key', () => {
		const fixture = mountPanel();
		const section = fixture.section('display');
		const header = section.querySelector('.tree-item-self')!;
		expect(header.getAttribute('aria-expanded')).toBe('false');
		header.dispatch('click');
		expect(section.classes.has('is-collapsed')).toBe(false);
		expect(section.querySelector('.collapse-icon')!.classes.has('is-collapsed')).toBe(false);
		expect(header.getAttribute('aria-expanded')).toBe('true');
		// The fake's dispatch carries no key, so the key handler is called as the page would call it.
		const keyed = header as unknown as {
			listeners: Map<string, ((event: { key: string; preventDefault(): void }) => void)[]>;
		};
		keyed.listeners.get('keydown')![0]!({ key: 'Enter', preventDefault: () => undefined });
		expect(section.classes.has('is-collapsed')).toBe(true);
		keyed.listeners.get('keydown')![0]!({ key: 'a', preventDefault: () => undefined });
		expect(section.classes.has('is-collapsed')).toBe(true);
	});

	it('offers a toggle per kind, writing the kinds hidden', () => {
		const fixture = mountPanel();
		expect(fixture.row('Scenes', 'toggle').getValue()).toBe(false);
		expect(fixture.row('Characters', 'toggle').getValue()).toBe(true);
		expect(fixture.row('Location', 'toggle').getValue()).toBe(true);
		fixture.row('Scenes').change(true);
		expect(fixture.lastChange()).toEqual({ filters: { ...defaultEntityGraphState().filters, kindsOff: [] } });
		fixture.row('Characters').change(false);
		expect(fixture.state().filters.kindsOff).toEqual(['character']);
	});

	it('writes the existing-only and orphan toggles, the first inverted', () => {
		const fixture = mountPanel();
		expect(fixture.row('relationshipGraph.filter.existing', 'toggle').getValue()).toBe(false);
		fixture.row('relationshipGraph.filter.existing').change(true);
		expect(fixture.state().filters.unresolved).toBe(false);
		expect(fixture.row('relationshipGraph.filter.existing', 'toggle').getValue()).toBe(true);
		fixture.row('relationshipGraph.filter.orphans').change(false);
		expect(fixture.state().filters.orphans).toBe(false);
		expect(fixture.state().filters.kindsOff).toEqual(['scene']);
	});

	it('offers a toggle per relationship word, writing the words hidden', () => {
		const fixture = mountPanel();
		fixture.row('Rival', 'toggle').change(false);
		expect(fixture.state().filters.labelsOff).toEqual(['Rival']);
		fixture.panel.refresh();
		fixture.row('Rival', 'toggle').change(true);
		expect(fixture.state().filters.labelsOff).toEqual([]);
	});

	it("shows the default groups as rows a touch makes the file's", () => {
		const fixture = mountPanel();
		const texts = fields.filter((field) => field.kind === 'text').map((field) => field.component.getValue());
		const colors = fields.filter((field) => field.kind === 'color').map((field) => field.component.getValue());
		expect(texts).toEqual(['kind:"character"', 'kind:"scene"', 'kind:"location"']);
		expect(colors).toEqual(['#7852ee', '#ec7500', '#08b94e']);
		const reset = fixture.el.querySelector('.snowflake-method-graph-groups-reset')!;
		expect(reset.disabled).toBe(true);
		fields[0]!.component.change('kind:character OR alice');
		expect(fixture.lastChange()).toEqual({
			groups: [
				{ query: 'kind:character OR alice', color: '#7852ee' },
				{ query: 'kind:"scene"', color: '#ec7500' },
				{ query: 'kind:"location"', color: '#08b94e' },
			],
		});
		fixture.panel.refresh();
		expect(fixture.el.querySelector('.snowflake-method-graph-groups-reset')!.disabled).toBe(false);
	});

	it('adds a group in the next hue, removes one and returns to the defaults', () => {
		const fixture = mountPanel();
		fixture.el.querySelector('.graph-color-button-container')!.children[0]!.dispatch('click');
		const groups = fixture.state().groups!;
		expect(groups).toHaveLength(4);
		expect(groups[3]).toEqual({ query: '', color: nextGroupColor(3) });
		fixture.panel.refresh();
		fixture.el.querySelector('.snowflake-method-graph-group-remove')!.dispatch('click');
		expect(fixture.state().groups!.map((group) => group.query)).toEqual(['kind:"scene"', 'kind:"location"', '']);
		fixture.panel.refresh();
		fixture.el.querySelector('.snowflake-method-graph-groups-reset')!.dispatch('click');
		expect(fixture.lastChange()).toEqual({ groups: null });
	});

	it('writes the display rows', () => {
		const fixture = mountPanel();
		fixture.row('relationshipGraph.display.arrows').change(false);
		expect(fixture.state().display.arrows).toBe(false);
		fixture.row('relationshipGraph.display.labels', 'dropdown').change('both');
		expect(fixture.state().display.labels).toBe('both');
		fixture.row('relationshipGraph.display.labels', 'dropdown').change('nonsense');
		expect(fixture.state().display.labels).toBe('both');
		fixture.row('relationshipGraph.display.textFade').change(1.5);
		fixture.row('relationshipGraph.display.nodeSize').change(2);
		fixture.row('relationshipGraph.display.lineSize').change(0.5);
		expect(fixture.state().display).toEqual({ arrows: false, labels: 'both', textFade: 1.5, nodeSize: 2, lineSize: 0.5 });
	});

	it('writes the force sliders', () => {
		const fixture = mountPanel();
		fixture.row('relationshipGraph.force.center').change(0.2);
		fixture.row('relationshipGraph.force.repel').change(15);
		fixture.row('relationshipGraph.force.link').change(0.7);
		fixture.row('relationshipGraph.force.distance').change(120);
		expect(fixture.state().forces).toEqual({ center: 0.2, repel: 15, link: 0.7, linkDistance: 120 });
	});

	it('shows the local section around the focused node and writes its rows', () => {
		const fixture = mountPanel({ focus: 'Alice' });
		const local = fixture.section('local');
		expect(local.classes.has('is-hidden')).toBe(false);
		expect(local.querySelector('.snowflake-method-graph-local-about')!.textContent).toBe('relationshipGraph.local.about Alice');
		fixture.row('relationshipGraph.local.depth').change(3);
		fixture.row('relationshipGraph.local.incoming').change(false);
		fixture.row('relationshipGraph.local.neighbours').change(true);
		expect(fixture.state().local).toEqual({ depth: 3, incoming: false, outgoing: true, neighbours: true });
		local.querySelector('.snowflake-method-graph-local-whole')!.dispatch('click');
		expect(fixture.deps.onShowWhole).toHaveBeenCalledTimes(1);
		fixture.setFocus(null);
		fixture.panel.refresh();
		expect(local.classes.has('is-hidden')).toBe(true);
	});

	it('restores the defaults from the symbol, the groups among them', () => {
		const fixture = mountPanel({
			state: { groups: [{ query: 'alice', color: '#ff0000' }], display: { ...defaultEntityGraphState().display, arrows: false } },
		});
		fixture.el.querySelector('.graph-controls-button.mod-reset')!.dispatch('click');
		const fresh = defaultEntityGraphState();
		expect(fixture.lastChange()).toEqual({ filters: fresh.filters, groups: null, display: fresh.display, forces: fresh.forces });
	});

	it('brings the rows up to date with the state without saying anything back', () => {
		const fixture = mountPanel();
		const fresh = defaultEntityGraphState();
		fixture.setState({
			...fresh,
			filters: { ...fresh.filters, kindsOff: [], orphans: false },
			display: { ...fresh.display, arrows: false, labels: 'none', nodeSize: 3 },
			forces: { ...fresh.forces, repel: 2 },
		});
		fixture.panel.refresh();
		expect(fixture.deps.onChange).not.toHaveBeenCalled();
		expect(fixture.row('Scenes', 'toggle').getValue()).toBe(true);
		expect(fixture.row('relationshipGraph.filter.orphans').getValue()).toBe(false);
		expect(fixture.row('relationshipGraph.display.arrows').getValue()).toBe(false);
		expect(fixture.row('relationshipGraph.display.labels', 'dropdown').getValue()).toBe('none');
		expect(fixture.row('relationshipGraph.display.nodeSize').getValue()).toBe(3);
		expect(fixture.row('relationshipGraph.force.repel').getValue()).toBe(2);
	});

	it('stills every row for a read-only project and says so', () => {
		const fixture = mountPanel({ readOnly: true });
		expect(fixture.el.classes.has('is-read-only')).toBe(true);
		expect(fixture.el.querySelector('.snowflake-method-graph-read-only')!.classes.has('is-hidden')).toBe(false);
		expect(rows.every((row) => row.component.disabled)).toBe(true);
		expect(fields.every((field) => field.component.disabled)).toBe(true);
		expect(fixture.el.querySelector('.graph-color-button-container')!.children[0]!.disabled).toBe(true);
		expect(fixture.el.querySelector('.graph-controls-button.mod-reset')!.disabled).toBe(true);
	});

	it("folds from its own symbol and mirrors the toolbar's words", () => {
		const fixture = mountPanel({ query: 'bob' });
		fixture.el.querySelector('.graph-controls-button.mod-close')!.dispatch('click');
		expect(fixture.deps.onFold).toHaveBeenLastCalledWith(false);
		fixture.panel.setOpen(false);
		expect(fixture.el.classes.has('is-close')).toBe(true);
		fixture.panel.setOpen(true);
		expect(fixture.el.classes.has('is-close')).toBe(false);
		const search = fixture.row('', 'search');
		expect(search.getValue()).toBe('bob');
		search.change('alice');
		expect(fixture.deps.onQuery).toHaveBeenCalledWith('alice');
		fixture.panel.setQuery('carol');
		expect(search.getValue()).toBe('carol');
		expect(fixture.deps.onQuery).toHaveBeenCalledTimes(1);
	});

	it('keeps the rows while nothing about them changed, so a row being typed into keeps the keyboard', () => {
		const fixture = mountPanel();
		const before = fields.length;
		expect(before).toBe(6);
		fixture.panel.refresh();
		expect(fields.length).toBe(before);
		// Typing into a row, even the first touch that makes the defaults the file's, rebuilds nothing.
		fields[0]!.component.change('kind:char');
		fixture.panel.refresh();
		fields[0]!.component.change('kind:character OR bob');
		fixture.panel.refresh();
		expect(fields.length).toBe(before);
		expect(fixture.state().groups![0]!.query).toBe('kind:character OR bob');
		// A row added is a row drawn.
		fixture.el.querySelector('.graph-color-button-container')!.children[0]!.dispatch('click');
		fixture.panel.refresh();
		expect(fields.length).toBe(before + 8);
	});
});

describe('the panel colours', () => {
	it('reads a computed colour or a hex as a hex, and grey for anything else', () => {
		expect(hexOfColor('rgb(120, 82, 238)')).toBe('#7852ee');
		expect(hexOfColor('rgba(8, 109, 221, 0.5)')).toBe('#086ddd');
		expect(hexOfColor('#ABCDEF')).toBe('#abcdef');
		expect(hexOfColor('')).toBe('#808080');
		expect(hexOfColor('color(display-p3 1 0 0)')).toBe('#808080');
	});

	it('picks hues forty degrees apart for new groups', () => {
		expect(nextGroupColor(0)).toBe('#db5757');
		expect(nextGroupColor(3)).toBe('#57db57');
		expect(nextGroupColor(9)).toBe(nextGroupColor(0));
	});
});
