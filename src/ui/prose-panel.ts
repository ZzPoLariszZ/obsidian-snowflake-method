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

import { setIcon, setTooltip } from 'obsidian';

import type { FrequencyRow } from '../domain';
import type { ManuscriptProseStatistics, ManuscriptProseRow } from '../services';
import type { Translate } from './modals';
import {
	dialoguePercent,
	filterFrequencyRows,
	formatReadingTime,
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
	}): Promise<FrequencyRow[] | null>;
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
	let frequency: FrequencyRow[] = [];
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
	const tableWrap = root.createDiv({ cls: 'snowflake-method-prose-scroll' });
	const table = tableWrap.createEl('table', {
		cls: 'snowflake-method-prose-table',
	});
	const headRow = table.createEl('thead').createEl('tr');
	for (const column of PROSE_COLUMNS) {
		headRow.createEl('th', {
			cls: `snowflake-method-prose-column-${column}`,
			text: t(`prose.table.${column}`),
		});
	}
	const tableBody = table.createEl('tbody');
	const heights = new Map<string, number>();
	const virtual = new VirtualTable({
		scroller: tableWrap,
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
			): HTMLElement =>
				tr.createEl('td', {
					cls: `snowflake-method-prose-column-${column}`,
					text,
					attr: { 'data-label': t(`prose.table.${column}`) },
				});
			const title = cell('chapter', row.title);
			title.addClass('snowflake-method-prose-chapter');
			title.addEventListener('click', () => {
				void bridge.openChapter(row.path).catch(() => undefined);
			});
			cell('length', String(row.cjk + row.words));
			cell('readingTime', formatReadingTime(readingMinutes(row, speeds), t));
			cell('sentences', String(row.sentences));
			const average = averageOf(row);
			cell('averageSentence', average === null ? '' : String(average));
			const share = dialoguePercent(row);
			cell('dialogue', share === null ? '' : `${String(share)}%`);
		},
		renderTail: () => undefined,
		onScroll: () => undefined,
		onMeasure: () => undefined,
	});

	// The frequency block: its filters are read here and applied at the
	// service's own read, so a toggle never re-reads a chapter.
	const frequencySection = root.createDiv({
		cls: 'snowflake-method-prose-frequency',
	});
	frequencySection.createEl('h3', {
		cls: 'snowflake-method-mention-view-heading',
		text: t('prose.frequency.heading'),
	});
	const frequencyControls = frequencySection.createDiv({
		cls: 'snowflake-method-prose-frequency-controls',
	});
	const search = frequencyControls.createEl('input', {
		cls: 'snowflake-method-prose-frequency-search',
		attr: { type: 'search', placeholder: t('prose.frequency.searchPlaceholder') },
	});
	search.addEventListener('input', () => {
		frequencyQuery = search.value;
		paintFrequency();
	});
	const toggle = (
		label: string,
		read: () => boolean,
		write: (next: boolean) => void,
	): void => {
		const wrap = frequencyControls.createEl('label', {
			cls: 'snowflake-method-prose-frequency-toggle',
		});
		const box = wrap.createEl('input', { attr: { type: 'checkbox' } });
		box.checked = read();
		wrap.appendText(label);
		box.addEventListener('change', () => {
			write(box.checked);
			refreshFrequency();
		});
	};
	toggle(
		t('prose.frequency.includeStopwords'),
		() => includeStopwords,
		(next) => {
			includeStopwords = next;
		},
	);
	toggle(
		t('prose.frequency.includeEntities'),
		() => includeEntities,
		(next) => {
			includeEntities = next;
		},
	);
	if (!bridge.segmenterAvailable()) {
		frequencySection.createDiv({
			cls: 'snowflake-method-mention-view-empty',
			text: t('prose.frequency.fallbackNote'),
		});
	}
	const frequencyList = frequencySection.createDiv({
		cls: 'snowflake-method-prose-frequency-list',
	});

	const averageOf = (row: ManuscriptProseRow): number | null => {
		if (row.sentences <= 0) return null;
		return Math.round(((row.cjk + row.words) / row.sentences) * 10) / 10;
	};

	const paintSummary = (): void => {
		summaryEl.empty();
		if (statistics === null) return;
		const summary = proseSummary(statistics, bridge.readingSpeeds(), t);
		const item = (label: string, value: string): void => {
			const box = summaryEl.createDiv({
				cls: 'snowflake-method-prose-summary-item',
			});
			box.createDiv({
				cls: 'snowflake-method-prose-summary-value',
				text: value,
			});
			box.createDiv({
				cls: 'snowflake-method-prose-summary-label',
				text: label,
			});
		};
		item(t('prose.summary.readingTime'), summary.readingTime);
		if (summary.averageChapter !== null) {
			item(t('prose.summary.averageChapter'), summary.averageChapter);
		}
		item(t('prose.summary.sentences'), String(summary.sentences));
		if (summary.averageSentence !== null) {
			item(t('prose.summary.averageSentence'), String(summary.averageSentence));
		}
		if (summary.dialoguePercent !== null) {
			item(
				t('prose.summary.dialogueShare'),
				`${String(summary.dialoguePercent)}%`,
			);
		}
	};

	const paintFrequency = (): void => {
		frequencyList.empty();
		const filtered = filterFrequencyRows(frequency, frequencyQuery);
		if (filtered.length === 0) {
			frequencyList.createDiv({
				cls: 'snowflake-method-mention-view-empty',
				text: t('prose.frequency.empty'),
			});
			return;
		}
		for (const row of filtered.slice(0, MAX_FREQUENCY_ROWS)) {
			const line = frequencyList.createDiv({
				cls: 'snowflake-method-prose-frequency-row',
			});
			line.createSpan({
				cls: 'snowflake-method-prose-frequency-term',
				text: row.term,
			});
			line.createSpan({
				cls: 'snowflake-method-prose-frequency-count',
				text: String(row.count),
			});
		}
		if (filtered.length > MAX_FREQUENCY_ROWS) {
			frequencyList.createDiv({
				cls: 'snowflake-method-mention-view-empty',
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
			.then((rows) => {
				if (disposed || token !== frequencyToken) return;
				frequency = rows ?? [];
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
		entries = statistics.perNote;
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
