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
	occurrenceOffsets,
} from './entities-rows';
import { mentionNoteTitle, truncateMiddle } from './mention-rows';
import type { Translate } from './modals';

/** One kind's table: its label and its mentioned members, busiest first. */
export interface TrackingKindSection {
	id: string;
	label: string;
	rows: EntityMentionAggregate[];
}

/** One dialogue chapter with how much it speaks, units beside stretches. */
export interface TrackingDialogueRow extends DialogueChapterAggregate {
	/** The chapter's counted dialogue units: characters plus words. */
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

/** One prepared line of the modal: the jump and the words shown for it. */
interface ModalRow {
	occurrence: { path: string; from: number; to: number };
	before: string;
	match: string;
	after: string;
}

interface ModalGroup {
	title: string;
	rows: ModalRow[];
}

/**
 * Every mention of one row, grouped by chapter: the click jumps and the
 * modal steps aside, so the spot is reachable the moment it is named.
 */
class MentionListModal extends Modal {
	constructor(
		app: App,
		private readonly options: {
			title: string;
			subtitle: string | null;
			groups: ModalGroup[];
			onJump: (occurrence: {
				path: string;
				from: number;
				to: number;
			}) => void;
		},
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('snowflake-method-tracking-modal');
		this.titleEl.setText(this.options.title);
		const root = this.contentEl;
		root.empty();
		if (this.options.subtitle !== null) {
			root.createDiv({
				cls: 'snowflake-method-tracking-modal-subtitle',
				text: this.options.subtitle,
			});
		}
		for (const group of this.options.groups) {
			root.createDiv({
				cls: 'snowflake-method-tracking-modal-chapter',
				text: group.title,
			});
			for (const row of group.rows) {
				const line = root.createDiv({
					cls: 'snowflake-method-mention-view-occurrence',
				});
				const context = line.createSpan({
					cls: 'snowflake-method-mention-view-context',
				});
				context.appendText(row.before);
				context.createEl('strong', { text: row.match });
				context.appendText(row.after);
				line.addEventListener('click', () => {
					this.close();
					this.options.onJump(row.occurrence);
				});
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function renderEntitiesPanel(
	app: App,
	container: HTMLElement,
	bridge: EntitiesPanelBridge,
	collapse: Set<string>,
): EntitiesPanelHandle {
	const t = bridge.t;
	// The prose panel's frame: the same relative root whose controls band
	// rides the gap under the tab strip, the same section spacing.
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-tracking-panel',
	});
	let disposed = false;
	let loading = false;
	let refreshAgain = false;
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

	/** One fold, the definition sections' own markup and memory. */
	const fold = (key: string, label: string, count: number): HTMLElement => {
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
		toggle.createSpan({
			cls:
				'snowflake-method-step-indicator snowflake-method-worldbuilding-count ' +
				'snowflake-method-definition-count',
			text: String(count),
		});
		const body = section.createDiv({
			cls: 'snowflake-method-definition-section-body',
		});
		const paint = (): void => {
			const open = !collapse.has(key);
			body.toggleClass('is-collapsed', !open);
			toggle.setAttribute('aria-expanded', String(open));
			setIcon(chevron, open ? 'chevron-down' : 'chevron-right');
		};
		toggle.addEventListener('click', () => {
			if (collapse.has(key)) collapse.delete(key);
			else collapse.add(key);
			paint();
		});
		paint();
		return body;
	};

	/** The shared split frame, one colgroup worn twice, head carried by
	 *  transform -- the member tables' construction in miniature. */
	const tableFrame = (
		host: HTMLElement,
		columns: readonly string[],
		headers: readonly string[],
	): HTMLElement => {
		const wrap = host.createDiv({ cls: 'snowflake-method-table-wrap' });
		const headWrap = wrap.createDiv({ cls: 'snowflake-method-table-head' });
		const bodyWrap = wrap.createDiv({ cls: 'snowflake-method-table-body' });
		const tableClasses = 'snowflake-method-table snowflake-method-tracking-table';
		const headTable = headWrap.createEl('table', { cls: tableClasses });
		const bodyTable = bodyWrap.createEl('table', { cls: tableClasses });
		for (const table of [headTable, bodyTable]) {
			const cols = table.createEl('colgroup');
			for (const column of columns) {
				cols.createEl('col', {
					cls: `snowflake-method-tracking-column-${column}`,
				});
			}
		}
		const headRow = headTable.createEl('thead').createEl('tr');
		for (const text of headers) headRow.createEl('th', { text });
		let carried = '';
		bodyWrap.addEventListener('scroll', () => {
			const shift = `translateX(${String(-bodyWrap.scrollLeft)}px)`;
			if (shift === carried) return;
			carried = shift;
			headTable.style.transform = shift;
		});
		return bodyTable.createEl('tbody');
	};

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

	/** Reads the involved chapters and opens the modal over their words. */
	const openMentionModal = (
		title: string,
		subtitle: string | null,
		occurrences: readonly { path: string; from: number; to: number }[],
	): void => {
		void (async () => {
			const bodies = new Map<string, string>();
			for (const occurrence of occurrences) {
				if (bodies.has(occurrence.path)) continue;
				bodies.set(
					occurrence.path,
					await bridge.readSegmentBody(occurrence.path),
				);
			}
			const groups = new Map<string, ModalRow[]>();
			for (const occurrence of occurrences) {
				const body = bodies.get(occurrence.path) ?? '';
				const context =
					body.length > 0
						? occurrenceContext(body, occurrence.from, occurrence.to)
						: { before: '', match: chapterTitle(occurrence.path), after: '' };
				const row: ModalRow = { occurrence, ...context };
				const held = groups.get(occurrence.path);
				if (held === undefined) groups.set(occurrence.path, [row]);
				else held.push(row);
			}
			if (disposed) return;
			new MentionListModal(app, {
				title,
				subtitle,
				groups: [...groups.entries()].map(([path, rows]) => ({
					title: chapterTitle(path),
					rows,
				})),
				onJump: jump,
			}).open();
		})().catch(() => undefined);
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
		const body = fold(
			'unresolved',
			t('mentionView.unresolvedHeading'),
			shown.length,
		);
		if (shown.length === 0) {
			emptyState(body, t('mentionView.empty'), true);
			return;
		}
		// The text column holds the width the entity tables' three measured
		// columns hold together, so the candidates and the chapter split
		// exactly the span the distribution takes, and the seams line up.
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
			// One line a candidate, each the way into its member's note; the
			// row's own click keeps meaning the jump to the spot.
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
	};

	const renderKind = (section: TrackingKindSection): void => {
		const shown = section.rows.filter((entity) =>
			matches(entity.memberName),
		);
		if (searching() && shown.length === 0) return;
		const body = fold(`kind/${section.id}`, section.label, shown.length);
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
	};

	const renderSensitive = (terms: readonly SensitiveTermAggregate[]): void => {
		// A registered word the manuscript never says is the good silence:
		// only the terms actually found stand in the table.
		const shown = terms.filter(
			(term) => term.total > 0 && matches(term.term),
		);
		if (searching() && shown.length === 0) return;
		const body = fold(
			'sensitive',
			t('mentionView.sensitiveHeading'),
			shown.length,
		);
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
			if (first !== undefined) chapterLink(span, t('tracking.first'), first);
			if (last !== undefined) chapterLink(span, t('tracking.last'), last);
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
	};

	const renderDialogue = (chapters: readonly TrackingDialogueRow[]): void => {
		const shown = chapters.filter((chapter) => matches(chapter.title));
		if (searching() && shown.length === 0) return;
		const body = fold(
			'dialogue',
			t('mentionView.dialogueHeading'),
			shown.length,
		);
		if (shown.length === 0) {
			emptyState(body, t('mentionView.empty'), false);
			return;
		}
		// The chapter takes the unresolved text column's width, and the two
		// counts split the pair beside it: the stacked tables keep one grid.
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
						if (disposed) return;
						new MentionListModal(app, {
							title: chapter.title,
							subtitle: null,
							groups: [
								{
									title: chapter.title,
									rows: occurrences.map((occurrence) => ({
										occurrence,
										before: '',
										match: truncateMiddle(occurrence.matchedText, 64),
										after: '',
									})),
								},
							],
							onJump: jump,
						}).open();
					})
					.catch(() => undefined);
			});
		}
		moreLine(body, shown.length);
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
		const body = fold('ignores', t('mentionView.ignoreHeading'), shown.length);
		if (shown.length === 0) {
			emptyState(body, t('mentionView.ignoreEmpty'), false);
			return;
		}
		// A rule that names one spot or one chapter can be visited: the
		// occurrence rule's ordinal is walked back to its offsets over the
		// chapter's body, and a note rule opens its chapter's head. Only the
		// manuscript-wide rule has nowhere to point.
		const visitRule = async (rule: MentionIgnore): Promise<void> => {
			if (rule.scope === 'manuscript') return;
			if (rule.scope === 'note') {
				await bridge.openChapter(rule.notePath);
				return;
			}
			const chapterBody = await bridge.readSegmentBody(rule.notePath);
			const offsets = occurrenceOffsets(
				chapterBody,
				rule.matchedText,
				rule.ordinal,
			);
			if (offsets !== null) {
				await bridge.openMention({ path: rule.notePath, ...offsets });
				return;
			}
			await bridge.openChapter(rule.notePath);
		};
		// Two columns only: the scope takes the whole span the distribution
		// takes elsewhere, and carries the remove at its far end -- a red
		// trash on the line, no column of its own.
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
	};

	const paint = (): void => {
		sections.empty();
		if (reading === null) {
			stateText.setText(t('mentionView.noProject'));
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

	const refresh = (): void => {
		if (disposed) return;
		if (loading) {
			refreshAgain = true;
			return;
		}
		loading = true;
		if (reading === null) stateText.setText(t('mentionView.computing'));
		void bridge
			.tracking()
			.then((next) => {
				loading = false;
				if (disposed) return;
				reading = next;
				paint();
				if (refreshAgain) {
					refreshAgain = false;
					refresh();
				}
			})
			.catch(() => {
				loading = false;
			});
	};

	refresh();

	return {
		refresh,
		dispose: (): void => {
			disposed = true;
			root.remove();
		},
	};
}
