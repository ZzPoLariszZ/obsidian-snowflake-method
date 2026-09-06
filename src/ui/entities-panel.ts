/**
 * The Entity tracking face of the Data statistics pane: the tracking pane's
 * readings laid out as a designed surface -- foldable sections the way the
 * custom field tables fold, a table per kind, and a modal holding any row's
 * every mention. The data is the same index the sidebar pane reads; this is
 * the roomier telling of it.
 */

import { Modal, SearchComponent, setIcon, setTooltip, type App } from 'obsidian';

import {
	occurrenceContext,
	type DialogueOccurrence,
	type EntityOccurrence,
	type MentionIgnore,
} from '../domain';
import type {
	DialogueChapterAggregate,
	EntityMentionAggregate,
	SensitiveTermAggregate,
} from '../services';
import {
	distributionPath,
	distributionSpans,
	groupByChapter,
	taskPool,
} from './entities-rows';
import { mentionNoteTitle, truncateEnd } from './mention-rows';
import type { Translate } from './modals';
import { paintCount } from './pane-parts';
import { refreshLoop } from './refresh-loop';
import { buildTableFrame } from './virtual-table';

/** One kind's table: its label and its mentioned members, busiest first. */
export interface TrackingKindSection {
	id: string;
	label: string;
	rows: EntityMentionAggregate[];
}

/** One dialogue chapter with how much it speaks, units beside stretches. */
export interface TrackingDialogueRow extends DialogueChapterAggregate {
	/**
	 * The chapter's dialogue as the counting rule in force counts it, the
	 * quotation marks included: the same reading the prose table's share
	 * divides by, so the two panes quote one number.
	 */
	units: number;
}

/** Everything the panel shows, assembled by the host in one read. */
export interface TrackingReading {
	kinds: TrackingKindSection[];
	unresolved: EntityOccurrence[];
	sensitive: SensitiveTermAggregate[];
	dialogue: TrackingDialogueRow[];
	ignores: readonly MentionIgnore[];
	/** Every chapter in manuscript order: the distribution's axis. */
	chapters: { path: string; title: string }[];
}

export interface EntitiesPanelBridge {
	t: Translate;
	/** The whole reading, or null while no project stands. */
	tracking(): Promise<TrackingReading | null>;
	/** One chapter's quoted stretches, read fresh for the modal. */
	dialogueOccurrences(path: string): Promise<DialogueOccurrence[]>;
	/** A chapter's body for context lines; empty where it cannot be read. */
	readSegmentBody(path: string): Promise<string>;
	/**
	 * An occurrence ignore walked back to its spot over the same analyzed
	 * occurrences its ordinal was counted in; null where it no longer lands.
	 */
	locateIgnore(rule: {
		notePath: string;
		matchedText: string;
		ordinal: number;
	}): Promise<{ from: number; to: number } | null>;
	openMention(occurrence: {
		path: string;
		from: number;
		to: number;
	}): Promise<void>;
	/** Opens the stream at a chapter's head, for rules without an offset. */
	openChapter(path: string): Promise<void>;
	/** Opens a member's own note, the way the pane's member links do. */
	openMember(path: string): Promise<void>;
	removeIgnore(rule: MentionIgnore): Promise<void>;
}

export interface EntitiesPanelHandle {
	refresh(): void;
	dispose(): void;
}

/** Rows past this many are counted but not drawn, the pane's own bargain. */
const MAX_SECTION_ROWS = 200;

/** One jump the modal can make: a mention's place in the manuscript. */
interface ModalJump {
	path: string;
	from: number;
	to: number;
}

/** One prepared line of a modal row: the words shown around the match. */
interface ModalContext {
	before: string;
	match: string;
	after: string;
}

/** One chapter of the modal: its heading and every jump inside it. */
interface ModalGroup {
	path: string;
	title: string;
	occurrences: ModalJump[];
}

/**
 * Every mention of one row, grouped by chapter the way the search pane
 * groups its hits: one line per chapter at rest, the rest folded behind a
 * count, and each line's words read lazily as its chapter's body arrives --
 * the modal opens before any file is read. A toolbar flips the chapter
 * order and expands or collapses every fold at once; the click on a line
 * jumps, and the modal steps aside.
 */
class MentionListModal extends Modal {
	private readonly expanded = new Set<string>();
	private newestFirst = false;
	/** Lines already read, kept across sort flips and fold toggles. */
	private readonly contexts = new Map<string, ModalContext | null>();
	private listEl: HTMLElement | null = null;
	private expandButton: HTMLButtonElement | null = null;
	private pass = 0;

	constructor(
		app: App,
		private readonly options: {
			title: string;
			subtitle: string | null;
			t: Translate;
			groups: ModalGroup[];
			/** One row's words, read lazily; null where the body cannot be. */
			context: (occurrence: ModalJump) => Promise<ModalContext | null>;
			onJump: (occurrence: ModalJump) => void;
		},
	) {
		super(app);
	}

	onOpen(): void {
		const t = this.options.t;
		this.modalEl.addClass('snowflake-method-tracking-modal');
		this.titleEl.setText(this.options.title);
		const root = this.contentEl;
		root.empty();
		const toolbar = root.createDiv({
			cls: 'snowflake-method-tracking-modal-toolbar',
		});
		if (this.options.subtitle !== null) {
			toolbar.createSpan({
				cls: 'snowflake-method-tracking-modal-subtitle',
				text: this.options.subtitle,
			});
		}
		const actions = toolbar.createDiv({
			cls: 'snowflake-method-tracking-modal-actions',
		});
		// Both buttons stand whatever the shape of the reading -- a lone
		// chapter or a lone line leaves them idle, not missing.
		const sort = actions.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button' },
		});
		const paintSort = (): void => {
			setIcon(
				sort,
				this.newestFirst
					? 'arrow-up-narrow-wide'
					: 'arrow-down-narrow-wide',
			);
			setTooltip(
				sort,
				t(
					this.newestFirst
						? 'tracking.orderFirstFirst'
						: 'tracking.orderLastFirst',
				),
			);
		};
		sort.addEventListener('click', () => {
			this.newestFirst = !this.newestFirst;
			paintSort();
			this.renderList();
		});
		paintSort();
		this.expandButton = actions.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button' },
		});
		this.expandButton.addEventListener('click', () => {
			const opened = this.allExpanded();
			this.expanded.clear();
			if (!opened) {
				for (const group of this.expandable()) {
					this.expanded.add(group.path);
				}
			}
			this.paintExpand();
			this.renderList();
		});
		this.paintExpand();
		this.listEl = root.createDiv({
			cls: 'snowflake-method-tracking-modal-list',
		});
		this.renderList();
	}

	onClose(): void {
		this.pass += 1;
		this.contentEl.empty();
	}

	private expandable(): ModalGroup[] {
		return this.options.groups.filter(
			(group) => group.occurrences.length > 1,
		);
	}

	/** True only where there is something to have opened: a reading with no
	 *  folds rests as "expand all", never as an already-collapsed one. */
	private allExpanded(): boolean {
		const expandable = this.expandable();
		return (
			expandable.length > 0 &&
			expandable.every((group) => this.expanded.has(group.path))
		);
	}

	private paintExpand(): void {
		const button = this.expandButton;
		if (button === null) return;
		const opened = this.allExpanded();
		setIcon(button, opened ? 'chevrons-down-up' : 'chevrons-up-down');
		setTooltip(
			button,
			this.options.t(opened ? 'tracking.collapseAll' : 'tracking.expandAll'),
		);
	}

	/** Chapters land a batch a frame, so a wide book opens without a stall. */
	private renderList(): void {
		const list = this.listEl;
		if (list === null) return;
		this.pass += 1;
		const pass = this.pass;
		list.empty();
		const ordered = this.newestFirst
			? [...this.options.groups].reverse()
			: this.options.groups;
		let done = 0;
		const step = (): void => {
			if (pass !== this.pass || !list.isConnected) return;
			for (const group of ordered.slice(done, done + 40)) {
				this.renderGroup(list.createDiv(), group);
				done += 1;
			}
			if (done < ordered.length) list.win.requestAnimationFrame(step);
		};
		step();
	}

	private renderGroup(host: HTMLElement, group: ModalGroup): void {
		host.empty();
		host.createDiv({
			cls: 'snowflake-method-tracking-modal-chapter',
			text: group.title,
		});
		const open = this.expanded.has(group.path);
		const shown = open ? group.occurrences : group.occurrences.slice(0, 1);
		for (const occurrence of shown) {
			this.renderRow(host, occurrence, group.title);
		}
		const hidden = group.occurrences.length - 1;
		if (hidden <= 0) return;
		const more = host.createDiv({
			cls: 'snowflake-method-tracking-modal-more',
		});
		more.createSpan({
			text: open
				? this.options.t('tracking.showLess')
				: this.options.t('tracking.moreResults', { count: hidden }),
		});
		const chevron = more.createSpan({
			cls: 'snowflake-method-tracking-modal-more-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(chevron, open ? 'chevron-up' : 'chevron-down');
		more.addEventListener('click', () => {
			if (open) this.expanded.delete(group.path);
			else this.expanded.add(group.path);
			this.renderGroup(host, group);
			this.paintExpand();
		});
	}

	private renderRow(
		host: HTMLElement,
		occurrence: ModalJump,
		fallback: string,
	): void {
		const line = host.createDiv({
			cls: 'snowflake-method-mention-view-occurrence',
		});
		const context = line.createSpan({
			cls: 'snowflake-method-mention-view-context',
		});
		const key = `${occurrence.path}|${String(occurrence.from)}`;
		const held = this.contexts.get(key);
		if (held !== undefined) {
			this.paintRow(context, held, fallback);
		} else {
			context.createSpan({
				cls: 'snowflake-method-tracking-modal-pending',
				text: '…',
			});
			void this.options
				.context(occurrence)
				.then((read) => {
					this.contexts.set(key, read);
					if (!context.isConnected) return;
					context.empty();
					this.paintRow(context, read, fallback);
				})
				.catch(() => undefined);
		}
		line.addEventListener('click', () => {
			this.close();
			this.options.onJump(occurrence);
		});
	}

	private paintRow(
		host: HTMLElement,
		read: ModalContext | null,
		fallback: string,
	): void {
		if (read === null) {
			host.createEl('strong', {
				cls: 'snowflake-method-tracking-modal-match',
				text: fallback,
			});
			return;
		}
		host.appendText(read.before);
		host.createEl('strong', {
			cls: 'snowflake-method-tracking-modal-match',
			text: read.match,
		});
		host.appendText(read.after);
	}
}

export function renderEntitiesPanel(
	app: App,
	container: HTMLElement,
	bridge: EntitiesPanelBridge,
	open: Set<string>,
): EntitiesPanelHandle {
	const t = bridge.t;
	// The prose panel's frame: the same relative root whose controls band
	// rides the gap under the tab strip, the same section spacing.
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-tracking-panel',
	});
	let reading: TrackingReading | null = null;
	let titles = new Map<string, string>();
	let query = '';

	const controls = root.createDiv({ cls: 'snowflake-method-prose-controls' });
	// The search opens the band at the left, opposite the refresh: one filter
	// over every section, matched the way the sidebar pane's is.
	const search = new SearchComponent(controls);
	search.setPlaceholder(t('mentionView.searchPlaceholder'));
	search.onChange((next) => {
		query = next;
		paint();
	});
	const stateText = controls.createSpan({
		cls: 'snowflake-method-prose-state',
		text: t('mentionView.computing'),
	});
	const refreshButton = controls.createEl('button', {
		cls: 'clickable-icon snowflake-method-prose-refresh',
		attr: { type: 'button' },
	});
	setIcon(refreshButton, 'refresh-cw');
	setTooltip(refreshButton, t('mentionView.refresh'));
	refreshButton.addEventListener('click', () => {
		refresh();
	});

	// The custom field panes' own fold wrapper, so the tables inside shed
	// their boxes the same way.
	const sections = root.createDiv({
		cls: 'snowflake-method-template-sections snowflake-method-tracking-sections',
	});

	const chapterTitle = (path: string): string =>
		titles.get(path) ?? mentionNoteTitle(path);

	const jump = (occurrence: {
		path: string;
		from: number;
		to: number;
	}): void => {
		void bridge.openMention(occurrence).catch(() => undefined);
	};

	/**
	 * One fold, the definition sections' own markup and memory -- filled
	 * lazily: a closed section is its header and count alone, and the body
	 * is built the first time it opens. A search sets every fold aside the
	 * way the definition trees do, so a hit never hides behind a header.
	 */
	const fold = (
		key: string,
		label: string,
		count: number,
		fill: (body: HTMLElement) => void,
	): void => {
		const section = sections.createDiv({
			cls: 'snowflake-method-definition-section',
		});
		const header = section.createDiv({
			cls: 'snowflake-method-definition-section-header',
		});
		const toggle = header.createEl('button', {
			cls: 'snowflake-method-definition-section-toggle',
			attr: { type: 'button' },
		});
		const chevron = toggle.createSpan({
			cls: 'snowflake-method-definition-section-chevron',
			attr: { 'aria-hidden': 'true' },
		});
		toggle.createSpan({
			cls: 'snowflake-method-definition-section-title',
			text: label,
			attr: { role: 'heading', 'aria-level': '3' },
		});
		paintCount(
			toggle.createSpan({
				cls:
					'snowflake-method-step-indicator snowflake-method-worldbuilding-count ' +
					'snowflake-method-definition-count',
			}),
			count,
		);
		const body = section.createDiv({
			cls: 'snowflake-method-definition-section-body',
		});
		let filled = false;
		const paintFold = (): void => {
			const shown = searching() || open.has(key);
			if (shown && !filled) {
				filled = true;
				fill(body);
			}
			body.toggleClass('is-collapsed', !shown);
			toggle.setAttribute('aria-expanded', String(shown));
			setIcon(chevron, shown ? 'chevron-down' : 'chevron-right');
		};
		toggle.addEventListener('click', () => {
			if (open.has(key)) open.delete(key);
			else open.add(key);
			paintFold();
		});
		paintFold();
	};

	/** The shared split frame, one colgroup worn twice, head carried by
	 *  transform -- the member tables' construction in miniature. */
	const tableFrame = (
		host: HTMLElement,
		columns: readonly string[],
		headers: readonly string[],
	): HTMLElement =>
		buildTableFrame(host, {
			tableCls: 'snowflake-method-tracking-table',
			columns: columns.map(
				(column) => `snowflake-method-tracking-column-${column}`,
			),
			headers,
		}).body;

	/** The one filter over every section, matched the way the pane's is. */
	const matches = (...texts: (string | undefined)[]): boolean => {
		const needle = query.trim().toLowerCase();
		if (needle.length === 0) return true;
		return texts.some((text) => text?.toLowerCase().includes(needle) ?? false);
	};

	const searching = (): boolean => query.trim().length > 0;

	/**
	 * The member panes' own empty sentence: icon beside text, the line in one
	 * ink. Where nothing found is the good news -- no unresolved mention, no
	 * sensitive word -- the line wears a tick and the theme's green instead
	 * of the alert and the accent.
	 */
	const emptyState = (host: HTMLElement, text: string, good: boolean): void => {
		const empty = host.createEl('p', {
			cls: `snowflake-method-character-empty${good ? ' is-good' : ''}`,
		});
		const icon = empty.createSpan({
			cls: 'snowflake-method-character-empty-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, good ? 'check' : 'triangle-alert');
		empty.createSpan({ text });
	};

	/** One line of a count cell: the word at the start, the figure at the
	 *  end in the monospaced tabular face every dashboard number wears. */
	const countLine = (
		host: HTMLElement,
		label: string,
		value: number,
	): void => {
		const line = host.createDiv({
			cls: 'snowflake-method-tracking-count-line',
		});
		line.createSpan({ text: label });
		line.createSpan({
			cls: 'snowflake-method-tracking-count-number',
			text: String(value),
		});
	};

	const moreLine = (host: HTMLElement, total: number): void => {
		if (total <= MAX_SECTION_ROWS) return;
		host.createDiv({
			cls: 'snowflake-method-mention-view-empty',
			text: t('mentionView.more', { shown: MAX_SECTION_ROWS, total }),
		});
	};

	/** The distribution cell: the mentions' barcode across the manuscript. */
	const drawDistribution = (
		cell: HTMLElement,
		occurrences: readonly { path: string }[],
	): void => {
		const order = (reading?.chapters ?? []).map((chapter) => chapter.path);
		if (order.length === 0) return;
		const occupied = new Set(occurrences.map((occurrence) => occurrence.path));
		const covered = order.filter((path) => occupied.has(path)).length;
		const spans = distributionSpans(order, occupied);
		const svg = cell.createSvg('svg', {
			cls: ['snowflake-method-tracking-distribution'],
			attr: { viewBox: '0 0 100 12', preserveAspectRatio: 'none' },
		});
		svg.createSvg('path', {
			cls: ['snowflake-method-tracking-distribution-path'],
			attr: {
				d: distributionPath(spans, 100, 12),
				fill: 'none',
				'vector-effect': 'non-scaling-stroke',
			},
		});
		setTooltip(
			cell,
			t('tracking.distributionLabel', {
				covered,
				total: order.length,
			}),
		);
	};

	/** A chapter named in a cell, the name itself the jump. */
	const chapterLink = (
		host: HTMLElement,
		label: string,
		occurrence: { path: string; from: number; to: number },
	): void => {
		const line = host.createDiv({ cls: 'snowflake-method-tracking-span-line' });
		line.createSpan({
			cls: 'snowflake-method-tracking-span-label',
			text: label,
		});
		const link = line.createSpan({
			cls: 'snowflake-method-tracking-link',
			text: chapterTitle(occurrence.path),
		});
		link.addEventListener('click', (event) => {
			event.stopPropagation();
			jump(occurrence);
		});
	};

	/**
	 * Opens the modal at once over the grouped occurrences: chapter bodies
	 * are read lazily behind it, a few at a time and none twice, and each
	 * line fills in as its chapter arrives -- nothing waits for it all. The
	 * words are the projection's, so a row shows the page's text, the match
	 * held short of the line clamp.
	 */
	const openMentionModal = (
		title: string,
		subtitle: string | null,
		occurrences: readonly ModalJump[],
	): void => {
		const pooled = taskPool(6);
		const bodies = new Map<string, Promise<string>>();
		const bodyOf = (path: string): Promise<string> => {
			const held = bodies.get(path);
			if (held !== undefined) return held;
			const read = pooled(() => bridge.readSegmentBody(path));
			bodies.set(path, read);
			return read;
		};
		new MentionListModal(app, {
			title,
			subtitle,
			t,
			groups: groupByChapter(occurrences).map((group) => ({
				path: group.path,
				title: chapterTitle(group.path),
				occurrences: group.occurrences,
			})),
			context: async (occurrence) => {
				const body = await bodyOf(occurrence.path);
				if (body.length === 0) return null;
				const read = occurrenceContext(
					body,
					occurrence.from,
					occurrence.to,
					24,
					88,
				);
				return { ...read, match: truncateEnd(read.match, 96) };
			},
			onJump: jump,
		}).open();
	};

	const renderUnresolved = (occurrences: readonly EntityOccurrence[]): void => {
		const shown = occurrences.filter((occurrence) =>
			matches(
				occurrence.matchedText,
				chapterTitle(occurrence.path),
				...occurrence.candidates.map((candidate) => candidate.memberName),
			),
		);
		if (searching() && shown.length === 0) return;
		fold(
			'unresolved',
			t('mentionView.unresolvedHeading'),
			shown.length,
			(body) => {
				if (shown.length === 0) {
					emptyState(body, t('mentionView.empty'), true);
					return;
				}
				// The text column holds the width the entity tables' three
				// measured columns hold together, so the candidates and the
				// chapter split exactly the span the distribution takes, and
				// the seams line up.
				const tbody = tableFrame(
					body,
					['mention', 'candidates', 'source'],
					[
						t('tracking.column.text'),
						t('tracking.column.candidates'),
						t('prose.table.chapter'),
					],
				);
				for (const occurrence of shown.slice(0, MAX_SECTION_ROWS)) {
					const tr = tbody.createEl('tr', {
						cls: 'snowflake-method-tracking-row',
					});
					tr.createEl('td', {
						cls: 'snowflake-method-table-primary snowflake-method-tracking-unresolved-text',
						text: occurrence.matchedText,
						attr: { 'data-label': t('tracking.column.text') },
					});
					const candidates = tr.createEl('td', {
						attr: { 'data-label': t('tracking.column.candidates') },
					});
					// One line a candidate, each the way into its member's
					// note; the row's own click keeps meaning the jump.
					for (const candidate of occurrence.candidates) {
						const line = candidates.createDiv();
						const named = line.createSpan({
							cls: 'snowflake-method-tracking-link',
							text: candidate.memberName,
						});
						named.addEventListener('click', (event) => {
							event.stopPropagation();
							void bridge
								.openMember(candidate.memberPath)
								.catch(() => undefined);
						});
					}
					const chapter = tr.createEl('td', {
						attr: { 'data-label': t('prose.table.chapter') },
					});
					const link = chapter.createSpan({
						cls: 'snowflake-method-tracking-link',
						text: chapterTitle(occurrence.path),
					});
					link.addEventListener('click', (event) => {
						event.stopPropagation();
						jump(occurrence);
					});
					tr.addEventListener('click', () => {
						jump(occurrence);
					});
				}
				moreLine(body, shown.length);
			},
		);
	};

	const renderKind = (section: TrackingKindSection): void => {
		const shown = section.rows.filter((entity) =>
			matches(entity.memberName),
		);
		if (searching() && shown.length === 0) return;
		fold(`kind/${section.id}`, section.label, shown.length, (body) => {
			if (shown.length === 0) {
				emptyState(body, t('mentionView.empty'), false);
				return;
			}
			const tbody = tableFrame(
				body,
				['name', 'count', 'span', 'distribution'],
				[
					t('table.name'),
					t('tracking.column.count'),
					t('tracking.column.span'),
					t('tracking.column.distribution'),
				],
			);
			for (const entity of shown.slice(0, MAX_SECTION_ROWS)) {
				const tr = tbody.createEl('tr', {
					cls: 'snowflake-method-tracking-row',
				});
				tr.createEl('td', {
					cls: 'snowflake-method-table-primary',
					text: entity.memberName,
					attr: { 'data-label': t('table.name') },
				});
				const counts = tr.createEl('td', {
					cls: 'snowflake-method-tracking-counts',
					attr: { 'data-label': t('tracking.column.count') },
				});
				countLine(counts, t('tracking.total'), entity.total);
				countLine(counts, t('tracking.linked'), entity.linked);
				countLine(counts, t('tracking.unlinked'), entity.unlinked);
				const span = tr.createEl('td', {
					cls: 'snowflake-method-tracking-span',
					attr: { 'data-label': t('tracking.column.span') },
				});
				const first = entity.occurrences[0];
				const last = entity.occurrences[entity.occurrences.length - 1];
				if (first !== undefined) {
					chapterLink(span, t('tracking.first'), first);
				}
				if (last !== undefined) {
					chapterLink(span, t('tracking.last'), last);
				}
				const distribution = tr.createEl('td', {
					cls: 'snowflake-method-tracking-distribution-cell',
					attr: { 'data-label': t('tracking.column.distribution') },
				});
				drawDistribution(distribution, entity.occurrences);
				tr.addEventListener('click', () => {
					openMentionModal(
						entity.memberName,
						t('mentionView.counts', {
							total: entity.total,
							linked: entity.linked,
							unlinked: entity.unlinked,
						}),
						entity.occurrences,
					);
				});
			}
			moreLine(body, shown.length);
		});
	};

	const renderSensitive = (terms: readonly SensitiveTermAggregate[]): void => {
		// A registered word the manuscript never says is the good silence:
		// only the terms actually found stand in the table.
		const shown = terms.filter(
			(term) => term.total > 0 && matches(term.term),
		);
		if (searching() && shown.length === 0) return;
		fold(
			'sensitive',
			t('mentionView.sensitiveHeading'),
			shown.length,
			(body) => {
				if (shown.length === 0) {
					emptyState(body, t('mentionView.empty'), true);
					return;
				}
				const tbody = tableFrame(
					body,
					['name', 'count', 'span', 'distribution'],
					[
						t('table.name'),
						t('tracking.column.count'),
						t('tracking.column.span'),
						t('tracking.column.distribution'),
					],
				);
				for (const term of shown.slice(0, MAX_SECTION_ROWS)) {
					const tr = tbody.createEl('tr', {
						cls: 'snowflake-method-tracking-row',
					});
					tr.createEl('td', {
						cls: 'snowflake-method-table-primary snowflake-method-tracking-sensitive-name',
						text: term.term,
						attr: { 'data-label': t('table.name') },
					});
					const counts = tr.createEl('td', {
						cls: 'snowflake-method-tracking-counts',
						attr: { 'data-label': t('tracking.column.count') },
					});
					countLine(counts, t('tracking.total'), term.total);
					const span = tr.createEl('td', {
						cls: 'snowflake-method-tracking-span',
						attr: { 'data-label': t('tracking.column.span') },
					});
					const first = term.occurrences[0];
					const last = term.occurrences[term.occurrences.length - 1];
					if (first !== undefined) {
						chapterLink(span, t('tracking.first'), first);
					}
					if (last !== undefined) {
						chapterLink(span, t('tracking.last'), last);
					}
					const distribution = tr.createEl('td', {
						cls: 'snowflake-method-tracking-distribution-cell',
						attr: { 'data-label': t('tracking.column.distribution') },
					});
					drawDistribution(distribution, term.occurrences);
					tr.addEventListener('click', () => {
						openMentionModal(
							term.term,
							t('tracking.countTotal', { count: term.total }),
							term.occurrences,
						);
					});
				}
				moreLine(body, shown.length);
			},
		);
	};

	const renderDialogue = (chapters: readonly TrackingDialogueRow[]): void => {
		const shown = chapters.filter((chapter) => matches(chapter.title));
		if (searching() && shown.length === 0) return;
		fold(
			'dialogue',
			t('mentionView.dialogueHeading'),
			shown.length,
			(body) => {
				if (shown.length === 0) {
					emptyState(body, t('mentionView.empty'), false);
					return;
				}
				// The chapter takes the unresolved text column's width, and
				// the two counts split the pair beside it: the stacked
				// tables keep one grid.
				const tbody = tableFrame(
					body,
					['mention', 'stretches', 'words'],
					[
						t('prose.table.chapter'),
						t('tracking.column.stretches'),
						t('tracking.column.words'),
					],
				);
				for (const chapter of shown.slice(0, MAX_SECTION_ROWS)) {
					const tr = tbody.createEl('tr', {
						cls: 'snowflake-method-tracking-row',
					});
					tr.createEl('td', {
						cls: 'snowflake-method-table-primary',
						text: chapter.title,
						attr: { 'data-label': t('prose.table.chapter') },
					});
					tr.createEl('td', {
						cls: 'snowflake-method-tracking-counts snowflake-method-tracking-numeric',
						text: String(chapter.count),
						attr: { 'data-label': t('tracking.column.stretches') },
					});
					tr.createEl('td', {
						cls: 'snowflake-method-tracking-counts snowflake-method-tracking-numeric',
						text: String(chapter.units),
						attr: { 'data-label': t('tracking.column.words') },
					});
					tr.addEventListener('click', () => {
						void bridge
							.dialogueOccurrences(chapter.path)
							.then((occurrences) => {
								if (loop.disposed) return;
								openMentionModal(chapter.title, null, occurrences);
							})
							.catch(() => undefined);
					});
				}
				moreLine(body, shown.length);
			},
		);
	};

	const renderIgnores = (rules: readonly MentionIgnore[]): void => {
		const badgeOf = (rule: MentionIgnore): string =>
			rule.scope === 'occurrence'
				? `${t('mentionView.ignoreOccurrenceBadge')} · ${chapterTitle(rule.notePath)}`
				: rule.scope === 'note'
					? t('mentionView.ignoreNoteBadge', {
							note: chapterTitle(rule.notePath),
						})
					: t('mentionView.ignoreManuscriptBadge');
		const namedOf = (rule: MentionIgnore): string =>
			'memberPath' in rule
				? `${mentionNoteTitle(rule.memberPath)}: ${rule.matchedText}`
				: rule.matchedText;
		const shown = rules.filter((rule) =>
			matches(rule.matchedText, badgeOf(rule), namedOf(rule)),
		);
		if (searching() && shown.length === 0) return;
		fold('ignores', t('mentionView.ignoreHeading'), shown.length, (body) => {
			if (shown.length === 0) {
				emptyState(body, t('mentionView.ignoreEmpty'), false);
				return;
			}
			// A rule that names one spot or one chapter can be visited: the
			// occurrence rule's ordinal is walked back to its offsets over
			// the analyzed occurrences it was counted in, and a note rule
			// opens its chapter's head. Only the manuscript-wide rule has
			// nowhere to point.
			const visitRule = async (rule: MentionIgnore): Promise<void> => {
				if (rule.scope === 'manuscript') return;
				if (rule.scope === 'note') {
					await bridge.openChapter(rule.notePath);
					return;
				}
				const offsets = await bridge.locateIgnore(rule);
				if (offsets !== null) {
					await bridge.openMention({ path: rule.notePath, ...offsets });
					return;
				}
				await bridge.openChapter(rule.notePath);
			};
			// Two columns only: the scope takes the whole span the
			// distribution takes elsewhere, and carries the remove at its
			// far end -- a red trash on the line, no column of its own.
			const tbody = tableFrame(
				body,
				['mention', 'scope'],
				[t('tracking.column.text'), t('tracking.column.scope')],
			);
			for (const rule of shown.slice(0, MAX_SECTION_ROWS)) {
				const tr = tbody.createEl('tr');
				tr.createEl('td', {
					cls: 'snowflake-method-table-primary',
					text: namedOf(rule),
					attr: { 'data-label': t('tracking.column.text') },
				});
				const scope = tr.createEl('td', {
					attr: { 'data-label': t('tracking.column.scope') },
				});
				const line = scope.createDiv({
					cls: 'snowflake-method-tracking-scope-row',
				});
				if (rule.scope === 'manuscript') {
					line.createSpan({ text: badgeOf(rule) });
				} else {
					const link = line.createSpan({
						cls: 'snowflake-method-tracking-link',
						text: badgeOf(rule),
					});
					link.addEventListener('click', () => {
						void visitRule(rule).catch(() => undefined);
					});
				}
				const remove = line.createEl('button', {
					cls: 'clickable-icon snowflake-method-tracking-remove',
					attr: { type: 'button' },
				});
				setIcon(remove, 'trash-2');
				setTooltip(remove, t('mentionView.remove'));
				remove.addEventListener('click', () => {
					void bridge
						.removeIgnore(rule)
						.then(() => {
							refresh();
						})
						.catch(() => undefined);
				});
			}
			moreLine(body, shown.length);
		});
	};

	const paint = (): void => {
		sections.empty();
		if (reading === null) {
			// Null has three faces: still reading, a read that failed, and a
			// vault with no project. Only the last may claim so.
			stateText.setText(
				loop.loading
					? t('mentionView.computing')
					: loop.failed
						? t('mentionView.loadFailed')
						: t('mentionView.noProject'),
			);
			return;
		}
		stateText.setText('');
		titles = new Map(
			reading.chapters.map((chapter) => [chapter.path, chapter.title]),
		);
		renderUnresolved(reading.unresolved);
		renderSensitive(reading.sensitive);
		for (const kind of reading.kinds) renderKind(kind);
		renderDialogue(reading.dialogue);
		renderIgnores(reading.ignores);
	};

	const loop = refreshLoop<TrackingReading | null>({
		read: () => bridge.tracking(),
		onStart: () => {
			if (reading === null) stateText.setText(t('mentionView.computing'));
		},
		onRead: (next) => {
			reading = next;
			paint();
		},
		onFail: () => {
			if (reading === null) paint();
			else stateText.setText(t('mentionView.loadFailed'));
		},
	});
	const refresh = (): void => {
		loop.refresh();
	};

	refresh();

	return {
		refresh,
		dispose: (): void => {
			loop.dispose();
			root.remove();
		},
	};
}
