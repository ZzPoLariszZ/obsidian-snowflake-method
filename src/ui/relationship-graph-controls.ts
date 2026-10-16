/**
 * The controls panel of the entity graph: the native graph's own panel, in
 * its own markup, so Obsidian's stylesheet and every theme that restyles
 * the native panel dress this one. Four folding sections, Filters, Groups,
 * Display and Forces, and a fifth, Local graph, that shows while a node is
 * the focus. Every row writes its part of the state through the shell as it
 * is moved; the panel is brought up to date from the state rather than drawn
 * afresh, so a row being typed into keeps the keyboard.
 */

import {
	ColorComponent,
	Setting,
	TextComponent,
	setIcon,
	setTooltip,
	type BaseComponent,
	type SearchComponent,
} from 'obsidian';

import {
	defaultEntityGraphState,
	defaultGraphColorName,
	GRAPH_CENTER_RANGE,
	GRAPH_LABEL_MODES,
	GRAPH_LINE_SIZE_RANGE,
	GRAPH_LINK_DISTANCE_RANGE,
	GRAPH_LINK_RANGE,
	GRAPH_LOCAL_DEPTH_RANGE,
	GRAPH_NODE_SIZE_RANGE,
	GRAPH_REPEL_RANGE,
	GRAPH_TEXT_FADE_RANGE,
	isGraphLabelMode,
	type EntityGraphGroup,
	type EntityGraphState,
} from '../domain';
import type { Translate } from './modals';

export const GRAPH_CONTROLS_CLASS = 'snowflake-method-graph-controls';

/** How long the state may keep changing before it is written to the file. */
export const GRAPH_STATE_SAVE_MS = 300;

/** A node kind the panel offers a toggle for, by its name. */
export interface GraphControlsKind {
	readonly id: string;
	readonly name: string;
}

export interface GraphControlsDeps {
	t: Translate;
	/** The state drawn now; read on every refresh. */
	state(): EntityGraphState;
	/** The words searched for now. */
	query(): string;
	/** The node kinds the graph has, in order, each by its name. */
	kinds(): readonly GraphControlsKind[];
	/** The project's custom kind ids in order, which the default colours cycle through. */
	customKinds(): readonly string[];
	/** The relationship words in the graph, in order. */
	labels(): readonly string[];
	/** The name of the node the local graph is drawn about, or null for the whole graph. */
	focus(): string | null;
	readOnly(): boolean;
	/** The accent a default group draws with, as `#rrggbb`. */
	accentHex(name: string): string;
	onQuery(text: string): void;
	/** A part of the state changed; the shell draws it at once and writes it soon. */
	onChange(patch: Partial<EntityGraphState>): void;
	onFold(open: boolean): void;
	onShowWhole(): void;
}

export interface GraphControlsPanel {
	el: HTMLElement;
	/** The rows brought up to date with the state, the kinds, the words and the focus. */
	refresh(): void;
	setOpen(open: boolean): void;
	/** The toolbar's words mirrored into the panel's own search. */
	setQuery(text: string): void;
	dispose(): void;
}

interface Range {
	readonly min: number;
	readonly max: number;
	readonly step: number;
}

/** The rows of one part of the panel: what keeps them in step with the state, and what is stilled for a read-only project. */
interface Rows {
	syncs: (() => void)[];
	components: BaseComponent[];
	buttons: HTMLButtonElement[];
}

const freshRows = (): Rows => ({ syncs: [], components: [], buttons: [] });

/** A colour as `#rrggbb`, from the `rgb(…)` a computed style gives or a hex already; grey for anything else. */
export function hexOfColor(color: string): string {
	const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
	if (hex !== null) return `#${hex[1]!.toLowerCase()}`;
	const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color.trim());
	if (rgb === null) return '#808080';
	const part = (text: string): string => Math.min(255, Number(text)).toString(16).padStart(2, '0');
	return `#${part(rgb[1]!)}${part(rgb[2]!)}${part(rgb[3]!)}`;
}

/** `#rrggbb` for the next new group: hues forty degrees apart, as the native graph picks them. */
export function nextGroupColor(count: number): string {
	const h = (count * 40) % 360;
	const s = 0.65;
	const l = 0.6;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const sector = Math.floor(h / 60);
	const [r, g, b] =
		sector === 0 ? [c, x, 0] : sector === 1 ? [x, c, 0] : sector === 2 ? [0, c, x] : sector === 3 ? [0, x, c] : sector === 4 ? [x, 0, c] : [c, 0, x];
	const part = (value: number): string =>
		Math.round((value + m) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${part(r)}${part(g)}${part(b)}`;
}

export function renderGraphControls(stage: HTMLElement, deps: GraphControlsDeps): GraphControlsPanel {
	const { t } = deps;
	/** The rows are being brought up to date: what they say back is not a change. */
	let quiet = false;
	const fixed = freshRows();
	const kindRows = freshRows();
	const labelRows = freshRows();
	const groupRows = freshRows();
	const allRows = (): Rows[] => [fixed, kindRows, labelRows, groupRows];

	const el = stage.createDiv({
		cls: `graph-controls ${GRAPH_CONTROLS_CLASS}`,
		attr: { role: 'group', 'aria-label': t('relationshipGraph.controls') },
	});

	// -- The symbols on the panel ---------------------------------------------
	// Obsidian's open symbol is left out: a folded panel is out of sight, and
	// the toolbar's Controls button and the background menu unfold it.

	const symbol = (cls: string, icon: string, label: string, onClick: () => void): HTMLButtonElement => {
		const button = el.createEl('button', {
			cls: `clickable-icon graph-controls-button ${cls}`,
			attr: { type: 'button', 'aria-label': label },
		});
		setIcon(button, icon);
		setTooltip(button, label);
		button.addEventListener('click', onClick);
		return button;
	};
	symbol('mod-close', 'x', t('relationshipGraph.closeControls'), () => {
		deps.onFold(false);
	});
	fixed.buttons.push(
		symbol('mod-reset', 'rotate-ccw', t('relationshipGraph.resetControls'), () => {
			const fresh = defaultEntityGraphState();
			deps.onChange({ filters: fresh.filters, groups: null, display: fresh.display, forces: fresh.forces });
		}),
	);

	// -- Sections -------------------------------------------------------------

	const section = (parent: HTMLElement, name: string, title: string, collapsed: boolean): HTMLElement => {
		const item = parent.createDiv({ cls: `tree-item graph-control-section mod-${name}` });
		// Obsidian's own header, without the clickable class whose hover box
		// would sit tight on the chevron that hangs into the padding; the
		// header is still a button to the keyboard.
		const self = item.createDiv({
			cls: 'tree-item-self mod-collapsible',
			attr: { role: 'button', tabindex: '0' },
		});
		const chevron = self.createDiv({ cls: 'tree-item-icon collapse-icon' });
		setIcon(chevron, 'right-triangle');
		self.createDiv({ cls: 'tree-item-inner' }).createEl('header', { cls: 'graph-control-section-header', text: title });
		const children = item.createDiv({ cls: 'tree-item-children' });
		let folded = false;
		const fold = (on: boolean): void => {
			folded = on;
			item.toggleClass('is-collapsed', on);
			chevron.toggleClass('is-collapsed', on);
			self.setAttribute('aria-expanded', on ? 'false' : 'true');
		};
		self.addEventListener('click', () => {
			fold(!folded);
		});
		self.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			fold(!folded);
		});
		fold(collapsed);
		return children;
	};

	const toggleRow = (parent: HTMLElement, rows: Rows, name: string, value: () => boolean, pick: (on: boolean) => void): void => {
		new Setting(parent)
			.setName(name)
			.setClass('mod-toggle')
			.addToggle((toggle) => {
				toggle.setValue(value()).onChange((on) => {
					if (!quiet) pick(on);
				});
				rows.components.push(toggle);
				rows.syncs.push(() => {
					if (toggle.getValue() !== value()) toggle.setValue(value());
				});
			});
	};
	const sliderRow = (parent: HTMLElement, rows: Rows, name: string, range: Range, value: () => number, pick: (at: number) => void): void => {
		new Setting(parent)
			.setName(name)
			.setClass('mod-slider')
			.addSlider((slider) => {
				slider
					.setLimits(range.min, range.max, range.step)
					.setValue(value())
					.setInstant(true)
					.onChange((at) => {
						if (!quiet) pick(at);
					});
				rows.components.push(slider);
				rows.syncs.push(() => {
					if (slider.getValue() !== value()) slider.setValue(value());
				});
			});
	};

	const state = (): EntityGraphState => deps.state();
	const filters = (): EntityGraphState['filters'] => state().filters;
	const without = (list: readonly string[], item: string): string[] => list.filter((one) => one !== item);

	// -- Filters -----------------------------------------------------------------

	const filterChildren = section(el, 'filter', t('relationshipGraph.filters'), false);
	let search: SearchComponent | null = null;
	const searchRow = new Setting(filterChildren).addSearch((component) => {
		search = component;
		component
			.setPlaceholder(t('relationshipGraph.search'))
			.setValue(deps.query())
			.onChange((text) => {
				if (!quiet) deps.onQuery(text);
			});
		fixed.components.push(component);
	});
	searchRow.settingEl.addClass('mod-search-setting');
	const kindsHost = filterChildren.createDiv({ cls: 'snowflake-method-graph-kinds' });
	let kindsKey = '';
	const paintKinds = (): void => {
		const kinds = deps.kinds();
		const key = JSON.stringify(kinds);
		if (key === kindsKey) return;
		kindsKey = key;
		kindsHost.empty();
		kindRows.syncs = [];
		kindRows.components = [];
		for (const kind of kinds) {
			toggleRow(
				kindsHost,
				kindRows,
				kind.name,
				() => !filters().kindsOff.includes(kind.id),
				(on) => {
					const held = filters();
					deps.onChange({
						filters: { ...held, kindsOff: on ? without(held.kindsOff, kind.id) : [...held.kindsOff, kind.id] },
					});
				},
			);
		}
	};
	// Obsidian's own words: the toggle hides the targets no note answers to.
	toggleRow(
		filterChildren,
		fixed,
		t('relationshipGraph.filter.existing'),
		() => !filters().unresolved,
		(on) => {
			deps.onChange({ filters: { ...filters(), unresolved: !on } });
		},
	);
	toggleRow(
		filterChildren,
		fixed,
		t('relationshipGraph.filter.orphans'),
		() => filters().orphans,
		(on) => {
			deps.onChange({ filters: { ...filters(), orphans: on } });
		},
	);
	const labelsHost = section(filterChildren, 'relationships', t('relationshipGraph.filter.relationships'), true);
	let labelsKey = '';
	const paintLabels = (): void => {
		const labels = deps.labels();
		const key = JSON.stringify(labels);
		if (key === labelsKey) return;
		labelsKey = key;
		labelsHost.empty();
		labelRows.syncs = [];
		labelRows.components = [];
		for (const label of labels) {
			toggleRow(
				labelsHost,
				labelRows,
				label,
				() => !filters().labelsOff.includes(label),
				(on) => {
					const held = filters();
					deps.onChange({
						filters: { ...held, labelsOff: on ? without(held.labelsOff, label) : [...held.labelsOff, label] },
					});
				},
			);
		}
	};

	// -- Groups --------------------------------------------------------------------

	const groupsHost = section(el, 'color-groups', t('relationshipGraph.groups'), true);
	/** The groups the picture is coloured by: the file's, or the per-kind defaults shown as rows a touch makes the file's. */
	const groupsShown = (): EntityGraphGroup[] =>
		state().groups?.slice() ??
		deps.kinds().map((kind) => ({
			query: `kind:${kind.id}`,
			color: deps.accentHex(defaultGraphColorName(kind.id, deps.customKinds())),
		}));
	let groupsKey = '';
	/** The button that returns the groups to the defaults, which has nothing to do while they stand. */
	let groupsReset: HTMLButtonElement | null = null;
	const paintGroups = (): void => {
		const shown = groupsShown();
		const key = JSON.stringify(shown);
		if (key === groupsKey) return;
		groupsKey = key;
		groupsHost.empty();
		groupRows.syncs = [];
		groupRows.components = [];
		groupRows.buttons = [];
		const container = groupsHost.createDiv({ cls: 'graph-color-groups-container' });
		const rows: { query: TextComponent; color: ColorComponent }[] = [];
		const collect = (): EntityGraphGroup[] =>
			rows.map((row) => ({ query: row.query.getValue(), color: row.color.getValue() }));
		// A row that changed the groups itself knows what the state will say
		// back, so the next refresh leaves it standing, keyboard and all.
		const written = (): void => {
			const next = collect();
			groupsKey = JSON.stringify(next);
			deps.onChange({ groups: next });
		};
		for (const group of shown) {
			const row = container.createDiv({ cls: 'graph-color-group' });
			const query = new TextComponent(row).setPlaceholder(t('relationshipGraph.group.query')).setValue(group.query);
			query.inputEl.setAttribute('aria-label', t('relationshipGraph.group.query'));
			const color = new ColorComponent(row).setValue(group.color);
			// The component keeps its input to itself; it is the last thing in the row.
			const pickerEl = row.lastElementChild;
			if (pickerEl?.instanceOf(HTMLInputElement) === true) {
				pickerEl.setAttribute('aria-label', t('relationshipGraph.group.color'));
				setTooltip(pickerEl, t('relationshipGraph.group.color'));
			}
			const entry = { query, color };
			rows.push(entry);
			query.onChange(() => {
				if (!quiet) written();
			});
			color.onChange(() => {
				if (!quiet) written();
			});
			groupRows.components.push(query, color);
			const remove = row.createEl('button', {
				cls: 'clickable-icon snowflake-method-graph-group-remove',
				attr: { type: 'button', 'aria-label': t('relationshipGraph.group.remove') },
			});
			setIcon(remove, 'x');
			setTooltip(remove, t('relationshipGraph.group.remove'));
			remove.addEventListener('click', () => {
				rows.splice(rows.indexOf(entry), 1);
				deps.onChange({ groups: collect() });
			});
			groupRows.buttons.push(remove);
		}
		const buttons = groupsHost.createDiv({ cls: 'graph-color-button-container' });
		const add = buttons.createEl('button', { text: t('relationshipGraph.group.new'), attr: { type: 'button' } });
		add.addEventListener('click', () => {
			deps.onChange({ groups: [...collect(), { query: '', color: nextGroupColor(rows.length) }] });
		});
		const reset = buttons.createEl('button', {
			cls: 'snowflake-method-graph-groups-reset',
			text: t('relationshipGraph.group.reset'),
			attr: { type: 'button' },
		});
		reset.addEventListener('click', () => {
			deps.onChange({ groups: null });
		});
		groupsReset = reset;
		groupRows.buttons.push(add);
	};

	// -- Display ----------------------------------------------------------------

	const displayChildren = section(el, 'display', t('relationshipGraph.display'), true);
	const display = (): EntityGraphState['display'] => state().display;
	toggleRow(
		displayChildren,
		fixed,
		t('relationshipGraph.display.arrows'),
		() => display().arrows,
		(on) => {
			deps.onChange({ display: { ...display(), arrows: on } });
		},
	);
	new Setting(displayChildren)
		.setName(t('relationshipGraph.display.labels'))
		.setClass('mod-dropdown')
		.addDropdown((dropdown) => {
			for (const mode of GRAPH_LABEL_MODES) dropdown.addOption(mode, t(`relationshipGraph.display.labels.${mode}`));
			dropdown.setValue(display().labels).onChange((mode) => {
				if (!quiet && isGraphLabelMode(mode)) deps.onChange({ display: { ...display(), labels: mode } });
			});
			fixed.components.push(dropdown);
			fixed.syncs.push(() => {
				if (dropdown.getValue() !== display().labels) dropdown.setValue(display().labels);
			});
		});
	sliderRow(displayChildren, fixed, t('relationshipGraph.display.textFade'), GRAPH_TEXT_FADE_RANGE, () => display().textFade, (at) => {
		deps.onChange({ display: { ...display(), textFade: at } });
	});
	sliderRow(displayChildren, fixed, t('relationshipGraph.display.nodeSize'), GRAPH_NODE_SIZE_RANGE, () => display().nodeSize, (at) => {
		deps.onChange({ display: { ...display(), nodeSize: at } });
	});
	sliderRow(displayChildren, fixed, t('relationshipGraph.display.lineSize'), GRAPH_LINE_SIZE_RANGE, () => display().lineSize, (at) => {
		deps.onChange({ display: { ...display(), lineSize: at } });
	});

	// -- Forces -------------------------------------------------------------------

	const forcesChildren = section(el, 'forces', t('relationshipGraph.forces'), true);
	const forces = (): EntityGraphState['forces'] => state().forces;
	sliderRow(forcesChildren, fixed, t('relationshipGraph.force.center'), GRAPH_CENTER_RANGE, () => forces().center, (at) => {
		deps.onChange({ forces: { ...forces(), center: at } });
	});
	sliderRow(forcesChildren, fixed, t('relationshipGraph.force.repel'), GRAPH_REPEL_RANGE, () => forces().repel, (at) => {
		deps.onChange({ forces: { ...forces(), repel: at } });
	});
	sliderRow(forcesChildren, fixed, t('relationshipGraph.force.link'), GRAPH_LINK_RANGE, () => forces().link, (at) => {
		deps.onChange({ forces: { ...forces(), link: at } });
	});
	sliderRow(forcesChildren, fixed, t('relationshipGraph.force.distance'), GRAPH_LINK_DISTANCE_RANGE, () => forces().linkDistance, (at) => {
		deps.onChange({ forces: { ...forces(), linkDistance: at } });
	});

	// -- Local graph ----------------------------------------------------------------

	const localChildren = section(el, 'local', t('relationshipGraph.local'), false);
	const localItem = localChildren.parentElement as HTMLElement;
	const about = localChildren.createEl('p', { cls: 'snowflake-method-graph-local-about' });
	const local = (): EntityGraphState['local'] => state().local;
	sliderRow(localChildren, fixed, t('relationshipGraph.local.depth'), GRAPH_LOCAL_DEPTH_RANGE, () => local().depth, (at) => {
		deps.onChange({ local: { ...local(), depth: at } });
	});
	toggleRow(localChildren, fixed, t('relationshipGraph.local.incoming'), () => local().incoming, (on) => {
		deps.onChange({ local: { ...local(), incoming: on } });
	});
	toggleRow(localChildren, fixed, t('relationshipGraph.local.outgoing'), () => local().outgoing, (on) => {
		deps.onChange({ local: { ...local(), outgoing: on } });
	});
	toggleRow(localChildren, fixed, t('relationshipGraph.local.neighbours'), () => local().neighbours, (on) => {
		deps.onChange({ local: { ...local(), neighbours: on } });
	});
	const whole = localChildren.createEl('button', {
		cls: 'mod-cta snowflake-method-graph-local-whole',
		text: t('relationshipGraph.local.whole'),
		attr: { type: 'button' },
	});
	whole.addEventListener('click', () => {
		deps.onShowWhole();
	});
	const paintLocal = (): void => {
		const focus = deps.focus();
		localItem.toggleClass('is-hidden', focus === null);
		about.setText(focus === null ? '' : t('relationshipGraph.local.about', { name: focus }));
	};

	const readOnlyLine = el.createEl('p', {
		cls: 'snowflake-method-graph-read-only',
		text: t('relationshipGraph.sceneManuscript.readOnly'),
	});

	// -- Keeping up -------------------------------------------------------------------

	const refresh = (): void => {
		quiet = true;
		try {
			paintKinds();
			paintLabels();
			paintGroups();
			paintLocal();
			for (const rows of allRows()) for (const sync of rows.syncs) sync();
			const readOnly = deps.readOnly();
			el.toggleClass('is-read-only', readOnly);
			readOnlyLine.toggleClass('is-hidden', !readOnly);
			for (const rows of allRows()) {
				for (const component of rows.components) component.setDisabled(readOnly);
				for (const button of rows.buttons) button.disabled = readOnly;
			}
			if (groupsReset !== null) groupsReset.disabled = readOnly || state().groups === null;
		} finally {
			quiet = false;
		}
	};

	return {
		el,
		refresh,
		setOpen: (open) => {
			el.toggleClass('is-close', !open);
		},
		setQuery: (text) => {
			if (search === null || search.getValue() === text) return;
			quiet = true;
			try {
				search.setValue(text);
			} finally {
				quiet = false;
			}
		},
		dispose: () => {
			el.remove();
		},
	};
}
