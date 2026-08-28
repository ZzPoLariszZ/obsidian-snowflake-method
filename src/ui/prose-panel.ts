/**
 * The Prose analysis face of the Data statistics pane: reading time,
 * sentence measures and the dialogue share above a per-chapter table, with
 * the manuscript's word frequency below. A reading of the analysis service,
 * built from stock parts the way the tracking pane is -- the drawn surfaces
 * come later and elsewhere.
 *
 * The panel is mounted once and patched: the dashboard hands it back across
 * frame rebuilds and calls `refresh()`, which is cheap when the stamps
 * behind the service hold. The first cold fill of a large manuscript is the
 * one slow pass, breathed by the service, and the panel says it is
 * computing rather than standing empty.
 */

import { SearchComponent, setIcon, setTooltip } from 'obsidian';

import type { FrequencyRow } from '../domain';
import type { ManuscriptProseStatistics, ManuscriptProseRow } from '../services';
import type { Translate } from './modals';
import {
	averageSentenceLength,
	dialoguePercent,
	filterFrequencyRows,
	formatDecimal,
	formatReadingTime,
	frequencySharePercent,
	proseSummary,
	readingMinutes,
	type ReadingSpeeds,
} from './prose-rows';
import { VirtualTable } from './virtual-table';

export interface ProsePanelBridge {
	t: Translate;
	statistics(): Promise<ManuscriptProseStatistics | null>;
	frequency(options: {
		includeStopwords: boolean;
		includeEntities: boolean;
	}): Promise<{ rows: FrequencyRow[]; total: number } | null>;
	readingSpeeds(): ReadingSpeeds;
	openChapter(path: string): Promise<void>;
	segmenterAvailable(): boolean;
}

export interface ProsePanelHandle {
	refresh(): void;
	dispose(): void;
}

/** Frequency rows drawn at once; the search reaches past them. */
const MAX_FREQUENCY_ROWS = 200;

const PROSE_COLUMNS = [
	'chapter',
	'length',
	'readingTime',
	'sentences',
	'averageSentence',
	'dialogue',
] as const;

export function renderProsePanel(
	container: HTMLElement,
	bridge: ProsePanelBridge,
): ProsePanelHandle {
	const t = bridge.t;
	const root = container.createDiv({ cls: 'snowflake-method-prose-panel' });
	let disposed = false;
	let loading = false;
	let refreshAgain = false;
	let statistics: ManuscriptProseStatistics | null = null;
	let entries: ManuscriptProseRow[] = [];
	let chapterQuery = '';
	let frequency: FrequencyRow[] = [];
	let frequencyTotal = 0;
	let frequencyQuery = '';
	let includeStopwords = false;
	let includeEntities = false;
	let frequencyToken = 0;

	// The head: what the panel is doing, and the one explicit refresh -- a
	// whole-manuscript reading is too heavy to recompute on every vault save.
	const controls = root.createDiv({ cls: 'snowflake-method-prose-controls' });
	const stateText = controls.createSpan({
		cls: 'snowflake-method-prose-state',
		text: t('prose.computing'),
	});
	const refreshButton = controls.createEl('button', {
		cls: 'clickable-icon snowflake-method-prose-refresh',
		attr: { type: 'button' },
	});
	setIcon(refreshButton, 'refresh-cw');
	setTooltip(refreshButton, t('prose.refresh'));
	refreshButton.addEventListener('click', () => {
		refresh();
	});

	const summaryEl = root.createDiv({ cls: 'snowflake-method-prose-summary' });
	// The chapters and the frequency each stand as a titled section, spaced
	// from the cards and from each other the way the session widgets are.
	const chapterSection = root.createDiv({
		cls: 'snowflake-method-prose-section snowflake-method-prose-chapters',
	});
	chapterSection.createEl('h3', {
		cls: 'snowflake-method-prose-section-heading',
		text: t('prose.table.heading'),
	});
	// The member tables' own toolbar above the chapters: Obsidian's search
	// input, filtering the rows by title the way the character table's does.
	const chapterToolbar = chapterSection.createDiv({
		cls: 'snowflake-method-table-toolbar',
	});
	const chapterSearch = new SearchComponent(chapterToolbar);
	chapterSearch.setPlaceholder(t('prose.table.searchChapters'));
	chapterSearch.onChange((next) => {
		chapterQuery = next;
		paint();
	});
	// The dashboard's own table frame, laid by hand the way `buildTableFrame`
	// lays it: one wrap, a header strip the body's scroll carries sideways by
	// a transform (the table-head styles say why it must not scroll itself),
	// and one colgroup worn twice so the halves agree on their columns.
	const tableWrap = chapterSection.createDiv({
		cls: 'snowflake-method-table-wrap snowflake-method-prose-table-wrap',
	});
	const headWrap = tableWrap.createDiv({ cls: 'snowflake-method-table-head' });
	const bodyWrap = tableWrap.createDiv({ cls: 'snowflake-method-table-body' });
	const tableClasses = 'snowflake-method-table snowflake-method-prose-table';
	const headTable = headWrap.createEl('table', { cls: tableClasses });
	const bodyTable = bodyWrap.createEl('table', { cls: tableClasses });
	for (const table of [headTable, bodyTable]) {
		const columns = table.createEl('colgroup');
		for (const column of PROSE_COLUMNS) {
			columns.createEl('col', {
				cls: `snowflake-method-prose-column-${column}`,
			});
		}
	}
	const headRow = headTable.createEl('thead').createEl('tr');
	for (const column of PROSE_COLUMNS) {
		const head = headRow.createEl('th', {
			cls: `snowflake-method-prose-column-${column}`,
			text: t(`prose.table.${column}`),
		});
		if (column !== 'chapter') head.addClass('snowflake-method-prose-numeric');
	}
	const tableBody = bodyTable.createEl('tbody');
	const heights = new Map<string, number>();
	let headCarried = '';
	const virtual = new VirtualTable({
		scroller: bodyWrap,
		body: tableBody,
		columns: PROSE_COLUMNS.length,
		estimatedRowHeight: 28,
		overscan: 8,
		rowKey: (index) => entries[index]?.path ?? `?${String(index)}`,
		heights,
		renderRow: (body, index) => {
			const row = entries[index];
			if (row === undefined) return;
			const speeds = bridge.readingSpeeds();
			const tr = body.createEl('tr', {
				cls: 'snowflake-method-prose-row',
			});
			const cell = (
				column: (typeof PROSE_COLUMNS)[number],
				text: string,
			): HTMLElement => {
				const made = tr.createEl('td', {
					cls: `snowflake-method-prose-column-${column}`,
					text,
					attr: { 'data-label': t(`prose.table.${column}`) },
				});
				if (column !== 'chapter') {
					made.addClass('snowflake-method-prose-numeric');
				}
				return made;
			};
			const title = cell('chapter', row.title);
			title.addClass('snowflake-method-prose-chapter');
			title.addClass('snowflake-method-table-primary');
			title.addEventListener('click', () => {
				void bridge.openChapter(row.path).catch(() => undefined);
			});
			cell('length', String(row.cjk + row.words));
			cell('readingTime', formatReadingTime(readingMinutes(row, speeds), t));
			cell('sentences', String(row.sentences));
			const average = averageSentenceLength(row, row.sentences);
			cell('averageSentence', average === null ? '' : formatDecimal(average));
			const share = dialoguePercent(row);
			cell('dialogue', share === null ? '' : `${formatDecimal(share)}%`);
		},
		renderTail: () => undefined,
		onScroll: () => {
			const shift = `translateX(${String(-bodyWrap.scrollLeft)}px)`;
			if (shift === headCarried) return;
			headCarried = shift;
			headTable.style.transform = shift;
		},
		onMeasure: () => undefined,
	});

	// The frequency block: its filters are read here and applied at the
	// service's own read, so a toggle never re-reads a chapter.
	const frequencySection = root.createDiv({
		cls: 'snowflake-method-prose-section snowflake-method-prose-frequency',
	});
	frequencySection.createEl('h3', {
		cls: 'snowflake-method-prose-section-heading',
		text: t('prose.frequency.heading'),
	});
	const frequencyControls = frequencySection.createDiv({
		cls: 'snowflake-method-table-toolbar snowflake-method-prose-frequency-controls',
	});
	// The search opens the row at the left, the way the chapter table's does;
	// the two filters keep to the right end of the same row.
	const search = new SearchComponent(frequencyControls);
	search.setPlaceholder(t('prose.frequency.searchPlaceholder'));
	search.onChange((next) => {
		frequencyQuery = next;
		paintFrequency();
	});
	const toggle = (
		container: HTMLElement,
		label: string,
		read: () => boolean,
		write: (next: boolean) => void,
		changed: () => void,
	): void => {
		const wrap = container.createEl('label', {
			cls: 'snowflake-method-prose-frequency-toggle',
		});
		const box = wrap.createEl('input', { attr: { type: 'checkbox' } });
		box.checked = read();
		wrap.appendText(label);
		box.addEventListener('change', () => {
			write(box.checked);
			changed();
		});
	};
	toggle(
		frequencyControls,
		t('prose.frequency.includeStopwords'),
		() => includeStopwords,
		(next) => {
			includeStopwords = next;
		},
		() => {
			refreshFrequency();
		},
	);
	toggle(
		frequencyControls,
		t('prose.frequency.includeEntities'),
		() => includeEntities,
		(next) => {
			includeEntities = next;
		},
		() => {
			refreshFrequency();
		},
	);
	if (!bridge.segmenterAvailable()) {
		frequencySection.createDiv({
			cls: 'snowflake-method-mention-view-empty',
			text: t('prose.frequency.fallbackNote'),
		});
	}
	// The frame draws the border and the list inside it scrolls, so the
	// scrollbar can ride the gutter beyond the border the way the tables' do.
	const frequencyFrame = frequencySection.createDiv({
		cls: 'snowflake-method-prose-frequency-frame',
	});
	const frequencyList = frequencyFrame.createDiv({
		cls: 'snowflake-method-prose-frequency-list',
	});

	const paintSummary = (): void => {
		summaryEl.empty();
		if (statistics === null) return;
		const summary = proseSummary(statistics, bridge.readingSpeeds(), t);
		// The widget cards' own order: the muted title above, the figure below.
		const item = (label: string, value: string): void => {
			const box = summaryEl.createDiv({
				cls: 'snowflake-method-prose-summary-item',
			});
			box.createDiv({
				cls: 'snowflake-method-prose-summary-label',
				text: label,
			});
			box.createDiv({
				cls: 'snowflake-method-prose-summary-value',
				text: value,
			});
		};
		item(t('prose.summary.readingTime'), summary.readingTime);
		if (summary.averageChapter !== null) {
			item(t('prose.summary.averageChapter'), summary.averageChapter);
		}
		if (summary.sentencesPerChapter !== null) {
			item(
				t('prose.summary.sentencesPerChapter'),
				formatDecimal(summary.sentencesPerChapter),
			);
		}
		if (summary.averageSentence !== null) {
			item(
				t('prose.summary.averageSentence'),
				formatDecimal(summary.averageSentence),
			);
		}
		if (summary.dialoguePercent !== null) {
			item(
				t('prose.summary.dialogueShare'),
				`${formatDecimal(summary.dialoguePercent)}%`,
			);
		}
	};

	const paintFrequency = (): void => {
		frequencyList.empty();
		// An empty answer keeps an empty frame: whether nothing matched the
		// search or nothing has been counted, the silence says it.
		const filtered = filterFrequencyRows(frequency, frequencyQuery);
		for (const row of filtered.slice(0, MAX_FREQUENCY_ROWS)) {
			const line = frequencyList.createDiv({
				cls: 'snowflake-method-prose-frequency-row',
			});
			// Past one word in two hundred, a term is a habit worth seeing:
			// the row says so in the accent rather than waiting to be read.
			if (
				frequencyTotal > 0 &&
				(row.count / frequencyTotal) * 100 > 0.5
			) {
				line.addClass('is-major');
			}
			line.createSpan({
				cls: 'snowflake-method-prose-frequency-term',
				text: row.term,
			});
			const numbers = line.createSpan({
				cls: 'snowflake-method-prose-frequency-count',
				text: String(row.count),
			});
			const share = frequencySharePercent(row.count, frequencyTotal);
			if (share !== null) {
				numbers.createSpan({
					cls: 'snowflake-method-prose-frequency-share',
					text: `(${share}%)`,
				});
			}
		}
		if (filtered.length > MAX_FREQUENCY_ROWS) {
			frequencyList.createDiv({
				cls: 'snowflake-method-prose-frequency-more',
				text: t('prose.frequency.more', {
					shown: MAX_FREQUENCY_ROWS,
					total: filtered.length,
				}),
			});
		}
	};

	const refreshFrequency = (): void => {
		const token = (frequencyToken += 1);
		void bridge
			.frequency({ includeStopwords, includeEntities })
			.then((read) => {
				if (disposed || token !== frequencyToken) return;
				frequency = read?.rows ?? [];
				frequencyTotal = read?.total ?? 0;
				paintFrequency();
			})
			.catch(() => undefined);
	};

	const paint = (): void => {
		if (statistics === null) {
			stateText.setText(t('prose.noProject'));
			return;
		}
		stateText.setText('');
		paintSummary();
		const needle = chapterQuery.trim().toLowerCase();
		entries =
			needle.length === 0
				? statistics.perNote
				: statistics.perNote.filter((row) =>
						row.title.toLowerCase().includes(needle),
					);
		virtual.setTotal(entries.length);
	};

	const refresh = (): void => {
		if (disposed) return;
		if (loading) {
			refreshAgain = true;
			return;
		}
		loading = true;
		// Paint-at-rest-then-patch: the standing reading keeps showing while
		// the fresh one is walked; only the very first fill says computing.
		if (statistics === null) stateText.setText(t('prose.computing'));
		void bridge
			.statistics()
			.then((next) => {
				loading = false;
				if (disposed) return;
				statistics = next;
				paint();
				refreshFrequency();
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
			virtual.destroy();
			root.remove();
		},
	};
}
