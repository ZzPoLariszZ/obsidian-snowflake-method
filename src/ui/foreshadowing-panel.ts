import { Menu, Notice, SearchComponent, setIcon, setTooltip } from 'obsidian';

import {
	FORESHADOWING_STATUSES,
	OCCURRENCE_ROLES,
	isForeshadowingStatus,
	isOccurrenceRole,
	type ForeshadowingStatus,
	type OccurrenceRole,
} from '../domain';
import type { FilterRow, LentFilterPopover } from './filter-rows';
import {
	filterForeshadowingItems,
	flattenForeshadowingRows,
	type ForeshadowingFlatRow,
	type ForeshadowingTableItem,
} from './foreshadowing-rows';
import type { Translate } from './modals';
import { renderEmptyLine, renderSplitButton } from './pane-parts';
import { refreshLoop } from './refresh-loop';
import { VirtualTable, buildTableFrame } from './virtual-table';

/**
 * The Foreshadowing face of the Task management pane: every thread the
 * project holds, one row per occurrence, the thread's own cells written on
 * its first row and read as standing over the rows beneath. The revision
 * table's frame and mechanism -- the tracking band, the split header, the
 * virtual window drawing a windowful -- with its own six columns and the
 * member tables' split buttons at the end of each row.
 */

export interface ForeshadowingReading {
	items: ForeshadowingTableItem[];
	/** The project cannot be written to, so every action is off. */
	readOnly: boolean;
}

export interface ForeshadowingPanelBridge {
	t: Translate;
	/** Everything, freshly anchored; null while no project stands. */
	read(): Promise<ForeshadowingReading | null>;
	/** Opens the stream at one occurrence and flashes it. */
	open(occurrence: { path: string; from: number; to: number }): Promise<void>;
	/**
	 * Opens the chapter an unresolved occurrence was lost in and lights its
	 * card, pinned at the head of the chapter's rail.
	 */
	openUnresolved(path: string, occurrenceId: string): Promise<void>;
	/** The two table settings the palette toggles, as the member tables read them. */
	showsProgressStatus(): boolean;
	showsActionsColumn(): boolean;
	/** Opens the create form. Resolves when the dialog is done with. */
	add(): Promise<void>;
	editItem(id: string): Promise<void>;
	editOccurrence(id: string, occurrenceId: string): Promise<void>;
	/** Takes the whole thread out, confirmation and all. False on a refusal. */
	deleteItem(id: string): Promise<boolean>;
	/** Takes one occurrence out. False on a refusal. */
	deleteOccurrence(id: string, occurrenceId: string): Promise<boolean>;
}

/** The filters, owned by the dashboard so they outlive the panel; status and role take several. */
export interface ForeshadowingFilterMemory {
	status: string[];
	role: string[];
	standing: string;
}

/** What the dashboard lends the panel: its funnel popover and its memory. */
export interface ForeshadowingPanelControls extends LentFilterPopover {
	filters: ForeshadowingFilterMemory;
}

export interface ForeshadowingPanelHandle {
	refresh(): void;
	dispose(): void;
}

const COLUMNS = [
	'name',
	'description',
	'related',
	'role',
	'place',
	'actions',
] as const;
type Column = (typeof COLUMNS)[number];

export function renderForeshadowingPanel(
	container: HTMLElement,
	bridge: ForeshadowingPanelBridge,
	controls: ForeshadowingPanelControls,
): ForeshadowingPanelHandle {
	const t = bridge.t;
	const filters = controls.filters;
	// Read as the panel is built: the dashboard keys the panel by the two
	// settings, so a toggle builds a fresh one rather than reshaping this.
	const withActions = bridge.showsActionsColumn();
	const columns: readonly Column[] = withActions
		? COLUMNS
		: COLUMNS.filter((column) => column !== 'actions');
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-foreshadowing-panel',
	});
	const band = root.createDiv({ cls: 'snowflake-method-prose-controls' });
	let query = '';
	const search = new SearchComponent(band);
	search.setPlaceholder(t('foreshadowingTable.searchPlaceholder'));
	search.onChange((next) => {
		query = next;
		paint();
	});
	const searchBox = band.querySelector('.search-input-container');
	const filterButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-filter-button',
		attr: {
			type: 'button',
			'aria-haspopup': 'dialog',
			'aria-label': t('table.filter'),
		},
	});
	setIcon(filterButton, 'funnel');
	setTooltip(filterButton, t('table.filter'));
	const stateText = band.createSpan({ cls: 'snowflake-method-prose-state' });
	const refreshButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-prose-refresh',
		attr: { type: 'button', 'aria-label': t('foreshadowingTable.refresh') },
	});
	setIcon(refreshButton, 'refresh-cw');
	setTooltip(refreshButton, t('foreshadowingTable.refresh'));
	const addButton = band.createEl('button', {
		cls: 'mod-cta snowflake-method-foreshadowing-add',
		text: t('foreshadowingTable.add'),
		attr: { type: 'button' },
	});
	addButton.disabled = true;

	const labels = {
		status: (status: ForeshadowingStatus): string =>
			t(`foreshadowing.status.${status}`),
		role: (role: OccurrenceRole): string => t(`foreshadowing.role.${role}`),
		unresolved: t('manuscript.foreshadowing.unresolved'),
	};
	// Status and role take several answers: a thread standing in any of the
	// statuses picked, an occurrence in any of the roles.
	const removeLabel = (label: string): string => t('table.filterRemove', { label });
	const filterRows = (): FilterRow[] => [
		{
			kind: 'many',
			label: t('status.label'),
			placeholder: t('foreshadowingTable.filterAllStatuses'),
			empty: '',
			options: () =>
				FORESHADOWING_STATUSES.map((status) => ({
					value: status,
					label: labels.status(status),
				})),
			values: filters.status,
			apply: (values) => {
				filters.status = values;
			},
			removeLabel,
		},
		{
			kind: 'many',
			label: t('foreshadowingTable.role'),
			placeholder: t('foreshadowingTable.filterAllRoles'),
			empty: '',
			options: () =>
				OCCURRENCE_ROLES.map((role) => ({ value: role, label: labels.role(role) })),
			values: filters.role,
			apply: (values) => {
				filters.role = values;
			},
			removeLabel,
		},
		{
			kind: 'one',
			label: t('foreshadowingTable.standing'),
			placeholder: t('foreshadowingTable.filterAllStandings'),
			empty: '',
			options: () => [
				{ value: 'unresolved', label: t('foreshadowingTable.unresolvedOnly') },
			],
			value: filters.standing,
			apply: (value) => {
				filters.standing = value;
			},
		},
	];
	const markFilterButton = (): void => {
		filterButton.toggleClass(
			'is-active',
			filters.status.length > 0 ||
				filters.role.length > 0 ||
				filters.standing !== '',
		);
	};
	filterButton.addEventListener('click', () => {
		if (controls.filterOpen()) {
			controls.closeFilter();
			return;
		}
		controls.openFilter(filterButton, filterRows(), () => {
			markFilterButton();
			paint();
		});
	});
	markFilterButton();

	const {
		wrap: tableWrap,
		bodyWrap,
		body: tableBody,
	} = buildTableFrame(root, {
		wrapCls: 'snowflake-method-foreshadowing-table-wrap',
		tableCls: `snowflake-method-foreshadowing-table${
			withActions ? ' has-actions-column' : ''
		}`,
		columns: columns.map((column) => `snowflake-method-foreshadowing-column-${column}`),
		headers: columns.map((column) => ({
			cls: `snowflake-method-foreshadowing-column-${column}`,
			text: column === 'actions' ? t('table.actions') : t(`foreshadowingTable.${column}`),
		})),
	});
	const { line: emptyLine } = renderEmptyLine(root, t('foreshadowingTable.empty'));

	const heights = new Map<string, number>();
	let reading: ForeshadowingReading | null = null;
	let rows: ForeshadowingFlatRow[] = [];

	/** A refused change is said, as the revision table says it; so is one that failed. */
	const told = (work: Promise<boolean>): void => {
		void work
			.then((done) => {
				if (!done) new Notice(t('foreshadowingTable.refused'));
			})
			.catch(() => {
				new Notice(t('foreshadowingTable.refused'));
			});
	};
	const opened = (work: Promise<void>): void => {
		void work.catch((error: unknown) => {
			new Notice(error instanceof Error ? error.message : t('errors.unknown'));
		});
	};
	/** The thread's cells are the head row's; hovering any row lights them all. */
	const hoverGroup = (itemId: string, on: boolean): void => {
		for (const tr of Array.from(tableBody.querySelectorAll('tr[data-item]'))) {
			if (tr.getAttribute('data-item') !== itemId) continue;
			tr.toggleClass('is-group-hover', on);
		}
	};
	const none = (cell: HTMLElement): void => {
		cell.createSpan({
			cls: 'snowflake-method-foreshadowing-none',
			text: '—',
			attr: { 'aria-label': t('foreshadowingTable.none') },
		});
	};
	/** The member tables' own split button, the primary dressed for this table. */
	const splitButton = (
		host: HTMLElement,
		primary: { label: string; tip: string; cls: string; run: () => void },
		items: (menu: Menu) => void,
		readOnly: boolean,
	): void => {
		renderSplitButton(host, {
			primary: {
				cls: `snowflake-method-split-primary ${primary.cls}`,
				label: primary.label,
				tip: primary.tip,
				disabled: readOnly,
				run: primary.run,
			},
			menuLabel: t('table.actions'),
			items,
		});
	};

	const virtual = new VirtualTable({
		scroller: bodyWrap,
		body: tableBody,
		columns: columns.length,
		estimatedRowHeight: 40,
		overscan: 8,
		rowKey: (index) => rows[index]?.key ?? `?${String(index)}`,
		heights,
		renderRow: (body, index) => {
			const row = rows[index];
			if (row === undefined) return;
			const { item, occurrence } = row;
			const readOnly = reading?.readOnly === true;
			const tr = body.createEl('tr', {
				cls: 'snowflake-method-foreshadowing-row',
				attr: { 'data-item': item.id },
			});
			tr.toggleClass('is-group-head', row.groupHead);
			tr.toggleClass('is-group-tail', row.groupTail);
			tr.toggleClass('is-match', row.matched);
			tr.toggleClass('is-occurrenceless', occurrence === null);
			tr.addEventListener('mouseenter', () => {
				hoverGroup(item.id, true);
			});
			tr.addEventListener('mouseleave', () => {
				hoverGroup(item.id, false);
			});
			const cell = (column: Column): HTMLElement =>
				tr.createEl('td', {
					cls: `snowflake-method-foreshadowing-column-${column}`,
					attr: {
						'data-label':
							column === 'actions'
								? t('table.actions')
								: t(`foreshadowingTable.${column}`),
					},
				});
			// The thread's own cells, drawn on every row of the thread and
			// shown on the head row alone in the wide layout, where the head's
			// cell reads as one cell standing over the rows beneath; the
			// narrow layout shows every card whole.
			const itemCell = (column: Column, fill: (host: HTMLElement) => void): void => {
				const td = cell(column);
				td.addClass('is-item');
				if (!row.groupHead) td.addClass('is-continued');
				fill(td.createDiv({ cls: 'snowflake-method-foreshadowing-item-cell' }));
			};
			itemCell('name', (host) => {
				const block = host.createDiv({ cls: 'snowflake-method-member-name-cell' });
				const line = block.createDiv({ cls: 'snowflake-method-member-name-line' });
				line.createSpan({ text: item.name, attr: { title: item.name } });
				// The status word follows the member tables' setting.
				if (bridge.showsProgressStatus()) {
					block.createDiv({
						cls: `snowflake-method-entity-status snowflake-method-member-status is-${item.status}`,
						text: labels.status(item.status),
					});
				}
			});
			itemCell('description', (host) => {
				host.setText(item.description);
			});
			itemCell('related', (host) => {
				if (item.related.length === 0) {
					none(host);
					return;
				}
				// One entity to a line, as the thread's editor lists them.
				const list = host.createDiv({
					cls: 'snowflake-method-foreshadowing-related-list',
				});
				for (const ref of item.related) {
					const name = list.createDiv({
						cls: 'snowflake-method-foreshadowing-related-name',
						text: ref.name,
					});
					// A ref the project no longer holds keeps its name and says
					// the name is all that is left.
					if (ref.missing) {
						name.addClass('is-missing');
						setTooltip(name, t('table.referenceMissing', { name: ref.name }));
					}
				}
			});
			const roleCell = cell('role');
			if (occurrence === null) none(roleCell);
			else {
				roleCell.createSpan({
					cls: 'snowflake-method-foreshadowing-role',
					text: labels.role(occurrence.role),
					attr: { 'data-role': occurrence.role },
				});
			}
			const placeCell = cell('place');
			if (occurrence === null) none(placeCell);
			else {
				const line = placeCell.createDiv({ cls: 'snowflake-method-tracking-scope-row' });
				if (occurrence.standing === 'unresolved') {
					// The warning is the link: there is no passage left to
					// flash, so it opens the chapter the words were lost in and
					// lights the card pinned at the head of its rail.
					const warned = line.createSpan({
						cls: 'snowflake-method-foreshadowing-unresolved is-link',
					});
					const icon = warned.createSpan({
						cls: 'snowflake-method-character-empty-icon',
						attr: { 'aria-hidden': 'true' },
					});
					setIcon(icon, 'triangle-alert');
					warned.createSpan({ text: occurrence.title });
					setTooltip(warned, t('foreshadowingTable.unresolved'));
					warned.addEventListener('click', () => {
						opened(bridge.openUnresolved(occurrence.path, occurrence.id));
					});
				} else {
					const jump = line.createSpan({
						cls: 'snowflake-method-tracking-link',
						text: occurrence.title,
					});
					jump.addEventListener('click', () => {
						const spot = occurrence.reveal ?? {
							from: occurrence.from,
							to: occurrence.to,
						};
						opened(bridge.open({ path: occurrence.path, from: spot.from, to: spot.to }));
					});
				}
			}
			// The menus offer the occurrence first, then the thread; the
			// primaries act on the occurrence, and on the thread where the row
			// has none.
			const editItems = (menu: Menu): void => {
				menu.addItem((entry) =>
					entry
						.setTitle(t('foreshadowingTable.editOccurrence'))
						.setIcon('pencil')
						.setDisabled(readOnly || occurrence === null)
						.onClick(() => {
							if (occurrence !== null) {
								opened(bridge.editOccurrence(item.id, occurrence.id));
							}
						}),
				);
				menu.addItem((entry) =>
					entry
						.setTitle(t('foreshadowingTable.editItem'))
						.setIcon('pencil-line')
						.setDisabled(readOnly)
						.onClick(() => {
							opened(bridge.editItem(item.id));
						}),
				);
			};
			const deleteItems = (menu: Menu): void => {
				menu.addItem((entry) =>
					entry
						.setTitle(t('foreshadowingTable.deleteOccurrence'))
						.setIcon('trash')
						.setWarning(true)
						.setDisabled(readOnly || occurrence === null)
						.onClick(() => {
							if (occurrence !== null) {
								told(bridge.deleteOccurrence(item.id, occurrence.id));
							}
						}),
				);
				menu.addItem((entry) =>
					entry
						.setTitle(t('foreshadowingTable.deleteItem'))
						.setIcon('trash-2')
						.setWarning(true)
						.setDisabled(readOnly)
						.onClick(() => {
							told(bridge.deleteItem(item.id));
						}),
				);
			};
			if (!withActions) {
				// No column: everything the row can be asked to do stands
				// behind the ellipsis at the end of its last cell, the member
				// tables' own shape for the same setting.
				const more = placeCell.createEl('button', {
					cls: 'clickable-icon snowflake-method-table-more',
					attr: {
						type: 'button',
						'aria-haspopup': 'menu',
						'aria-label': t('table.options', { name: item.name }),
					},
				});
				setIcon(more, 'ellipsis');
				more.addEventListener('click', (event) => {
					const menu = new Menu();
					menu.setParentElement(more);
					editItems(menu);
					menu.addSeparator();
					deleteItems(menu);
					menu.showAtMouseEvent(event);
				});
			} else {
				const actions = cell('actions').createDiv({
					cls: 'snowflake-method-table-actions',
				});
				splitButton(
					actions,
					{
						label: t('actions.edit'),
						tip:
							occurrence === null
								? t('foreshadowingTable.editItem')
								: t('foreshadowingTable.editOccurrence'),
						cls: '',
						run: () => {
							opened(
								occurrence === null
									? bridge.editItem(item.id)
									: bridge.editOccurrence(item.id, occurrence.id),
							);
						},
					},
					editItems,
					readOnly,
				);
				splitButton(
					actions,
					{
						label: t('actions.delete'),
						tip:
							occurrence === null
								? t('foreshadowingTable.deleteItem')
								: t('foreshadowingTable.deleteOccurrence'),
						cls: 'snowflake-method-foreshadowing-delete',
						run: () => {
							told(
								occurrence === null
									? bridge.deleteItem(item.id)
									: bridge.deleteOccurrence(item.id, occurrence.id),
							);
						},
					},
					deleteItems,
					readOnly,
				);
			}
		},
		renderTail: () => undefined,
		onScroll: () => undefined,
		onMeasure: () => undefined,
	});

	/** What the frame shows: the table, the empty line, or neither. */
	const paint = (): void => {
		const total = reading?.items.length ?? 0;
		searchBox?.toggleClass('is-hidden', total === 0);
		filterButton.toggleClass('is-hidden', total === 0);
		addButton.disabled = reading === null || reading.readOnly;
		if (reading === null) {
			rows = [];
			tableWrap.addClass('is-hidden');
			emptyLine.addClass('is-hidden');
			virtual.setTotal(0);
			stateText.setText(
				loop.loading
					? t('foreshadowingTable.loading')
					: loop.failed
						? t('foreshadowingTable.loadFailed')
						: t('foreshadowingTable.noProject'),
			);
			return;
		}
		const match = filterForeshadowingItems(
			reading.items,
			query,
			{
				status: filters.status.filter(isForeshadowingStatus),
				role: filters.role.filter(isOccurrenceRole),
				standing: filters.standing === 'unresolved' ? 'unresolved' : '',
			},
			labels,
		);
		rows = flattenForeshadowingRows(match.items, match.matched);
		stateText.setText(
			match.items.length === total
				? ''
				: t('table.filteredCount', { shown: match.items.length, total }),
		);
		tableWrap.toggleClass('is-hidden', rows.length === 0);
		emptyLine.toggleClass('is-hidden', rows.length > 0);
		virtual.setTotal(rows.length);
	};

	const loop = refreshLoop<ForeshadowingReading | null>({
		read: () => bridge.read(),
		onStart: () => {
			if (reading === null) paint();
		},
		onRead: (next) => {
			reading = next;
			heights.clear();
			paint();
		},
		onFail: () => {
			if (reading === null) paint();
			else stateText.setText(t('foreshadowingTable.loadFailed'));
		},
	});
	const refresh = (): void => {
		loop.refresh();
	};
	refreshButton.addEventListener('click', () => {
		refresh();
	});
	addButton.addEventListener('click', () => {
		opened(bridge.add());
	});
	refresh();

	return {
		refresh,
		dispose: (): void => {
			loop.dispose();
			virtual.destroy();
			controls.closeFilter();
			root.remove();
		},
	};
}
