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

import cloud from 'd3-cloud';
import { SearchComponent, setIcon, setTooltip } from 'obsidian';

import type { FrequencyRow } from '../domain';
import type { ManuscriptProseStatistics, ManuscriptProseRow } from '../services';
import { followAnchor } from './anchored-panel';
import type { Translate } from './modals';
import {
	averageSentenceLength,
	cloudWords,
	dialoguePercent,
	filterChapterRows,
	filterFrequencyRows,
	formatDecimal,
	formatPercent,
	formatReadingTime,
	frequencySharePercent,
	parseLengthBound,
	proseSummary,
	readingMinutes,
	type ReadingSpeeds,
} from './prose-rows';
import { refreshLoop } from './refresh-loop';
import { VirtualTable, buildTableFrame } from './virtual-table';

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

/**
 * The panel's filters, owned by the caller rather than the panel: leaving
 * the tab disposes the panel, and this hands the standing choices back to
 * the next one. The two toggles are one truth for the frequency list and
 * the cloud both -- the two views count the same reading, so their filters
 * agree by construction.
 */
export interface ProseFilterMemory {
	includeStopwords: boolean;
	includeEntities: boolean;
	/** The chapter table's length bounds; null is no bound on that side. */
	lengthMin: number | null;
	lengthMax: number | null;
}

/** Frequency rows drawn at once; the search reaches past them. */
const MAX_FREQUENCY_ROWS = 200;

/** Words offered to the cloud, the frequency list's own top slice: the
 *  layout keeps what fits and lets the rest go. */
const MAX_CLOUD_TERMS = 200;

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
	filters: ProseFilterMemory,
): ProsePanelHandle {
	const t = bridge.t;
	const root = container.createDiv({ cls: 'snowflake-method-prose-panel' });
	let statistics: ManuscriptProseStatistics | null = null;
	let entries: ManuscriptProseRow[] = [];
	let chapterQuery = '';
	let frequency: FrequencyRow[] = [];
	let frequencyTotal = 0;
	let frequencyQuery = '';
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
	const chapterCount = chapterToolbar.createSpan({
		cls: 'snowflake-method-table-count',
	});
	const filterSlot = chapterToolbar.createDiv({
		cls: 'snowflake-method-table-filter',
	});
	const filterButton = filterSlot.createEl('button', {
		cls: 'clickable-icon snowflake-method-filter-button',
		attr: {
			type: 'button',
			'aria-haspopup': 'dialog',
			'aria-expanded': 'false',
			'aria-label': t('table.filter'),
		},
	});
	setIcon(filterButton, 'funnel');
	setTooltip(filterButton, t('table.filter'));
	const markFilterButton = (): void => {
		filterButton.toggleClass(
			'is-active',
			filters.lengthMin !== null || filters.lengthMax !== null,
		);
	};
	markFilterButton();

	// The member tables' own filter dialog, asked the chapter question: the
	// one numeric column worth narrowing by is the length, bounded from
	// either side. A draft until confirmed, nothing until then.
	let filterPanel: { el: HTMLElement; release: () => void } | null = null;
	const closeFilterPanel = (): void => {
		const open = filterPanel;
		if (open === null) return;
		filterPanel = null;
		open.release();
		open.el.remove();
	};
	const openLengthFilter = (anchor: HTMLElement): void => {
		closeFilterPanel();
		const view = anchor.win;
		const panel = view.activeDocument.body.createDiv({
			cls: 'snowflake-method-filter-panel',
			attr: { role: 'dialog', 'aria-label': t('table.filter') },
		});
		panel.createDiv({
			cls: 'snowflake-method-filter-panel-title',
			text: t('table.filter'),
		});
		const body = panel.createDiv({ cls: 'snowflake-method-filter-panel-body' });
		const field = body.createDiv({ cls: 'snowflake-method-filter-row' });
		field.createDiv({
			cls: 'snowflake-method-filter-label',
			text: t('prose.table.length'),
		});
		const range = field.createDiv({ cls: 'snowflake-method-filter-range' });
		const bound = (placeholder: string, value: number | null): HTMLInputElement => {
			const input = range.createEl('input', {
				attr: { type: 'text', inputmode: 'numeric', placeholder },
			});
			if (value !== null) input.value = String(value);
			return input;
		};
		const minInput = bound(t('prose.filter.min'), filters.lengthMin);
		const maxInput = bound(t('prose.filter.max'), filters.lengthMax);
		const actions = panel.createDiv({
			cls: 'snowflake-method-filter-panel-actions',
		});
		const reset = actions.createEl('button', {
			cls: 'snowflake-method-filter-reset',
			text: t('table.filterReset'),
			attr: { type: 'button' },
		});
		// Clears the fields rather than the table, the way the member panel's
		// reset does: the panel has one way out, and this is not it.
		reset.addEventListener('click', () => {
			minInput.value = '';
			maxInput.value = '';
		});
		const confirm = actions.createEl('button', {
			cls: 'mod-cta',
			text: t('table.filterConfirm'),
			attr: { type: 'button' },
		});
		const apply = (): void => {
			filters.lengthMin = parseLengthBound(minInput.value);
			filters.lengthMax = parseLengthBound(maxInput.value);
			closeFilterPanel();
			markFilterButton();
			paint();
		};
		confirm.addEventListener('click', apply);
		for (const input of [minInput, maxInput]) {
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') apply();
			});
		}
		const unfollow = followAnchor(panel, anchor, view);
		anchor.setAttribute('aria-expanded', 'true');
		const dismiss = (event: MouseEvent): void => {
			const target = event.target as Node | null;
			if (target === null) return;
			if (panel.contains(target) || anchor.contains(target)) return;
			closeFilterPanel();
		};
		const onKey = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return;
			closeFilterPanel();
			anchor.focus();
		};
		view.addEventListener('mousedown', dismiss, true);
		view.addEventListener('keydown', onKey, true);
		filterPanel = {
			el: panel,
			release: () => {
				view.removeEventListener('mousedown', dismiss, true);
				view.removeEventListener('keydown', onKey, true);
				unfollow();
				anchor.setAttribute('aria-expanded', 'false');
			},
		};
		minInput.focus();
	};
	filterButton.addEventListener('click', () => {
		if (filterPanel !== null) {
			closeFilterPanel();
			return;
		}
		openLengthFilter(filterButton);
	});
	const { bodyWrap, body: tableBody } = buildTableFrame(chapterSection, {
		wrapCls: 'snowflake-method-prose-table-wrap',
		tableCls: 'snowflake-method-prose-table',
		columns: PROSE_COLUMNS.map(
			(column) => `snowflake-method-prose-column-${column}`,
		),
		headers: PROSE_COLUMNS.map((column) => ({
			cls: `snowflake-method-prose-column-${column}${
				column === 'chapter' ? '' : ' snowflake-method-prose-numeric'
			}`,
			text: t(`prose.table.${column}`),
		})),
	});
	const heights = new Map<string, number>();
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
			cell('length', String(row.counted));
			cell('readingTime', formatReadingTime(readingMinutes(row, speeds), t));
			cell('sentences', String(row.sentences));
			const average = averageSentenceLength(row, row.sentences);
			cell('averageSentence', average === null ? '' : formatDecimal(average));
			const share = dialoguePercent(row);
			// The count first and the share after it in brackets, the way the
			// frequency rows say their numbers: how much, then how much of it.
			cell(
				'dialogue',
				share === null
					? ''
					: `${String(row.dialogueCounted)} (${formatPercent(share)}%)`,
			);
		},
		renderTail: () => undefined,
		onScroll: () => undefined,
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
	): HTMLInputElement => {
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
		return box;
	};
	// One truth, two rows of switches: the frequency's pair and the cloud's
	// pair read and write the same filters, so flipping either updates both
	// faces and one fresh count serves the two of them.
	const stopwordBoxes: HTMLInputElement[] = [];
	const entityBoxes: HTMLInputElement[] = [];
	const syncFilterBoxes = (): void => {
		for (const box of stopwordBoxes) box.checked = filters.includeStopwords;
		for (const box of entityBoxes) box.checked = filters.includeEntities;
	};
	const filterPair = (container: HTMLElement): void => {
		stopwordBoxes.push(
			toggle(
				container,
				t('prose.frequency.includeStopwords'),
				() => filters.includeStopwords,
				(next) => {
					filters.includeStopwords = next;
				},
				() => {
					syncFilterBoxes();
					refreshCounts();
				},
			),
		);
		entityBoxes.push(
			toggle(
				container,
				t('prose.frequency.includeEntities'),
				() => filters.includeEntities,
				(next) => {
					filters.includeEntities = next;
				},
				() => {
					syncFilterBoxes();
					refreshCounts();
				},
			),
		);
	};
	filterPair(frequencyControls);
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

	// The cloud: the same counting read as the frequency list, under its own
	// pair of filters, drawn as scattered type rather than ranked rows.
	const cloudSection = root.createDiv({
		cls: 'snowflake-method-prose-section',
	});
	cloudSection.createEl('h3', {
		cls: 'snowflake-method-prose-section-heading',
		text: t('prose.cloud.heading'),
	});
	const cloudControls = cloudSection.createDiv({
		cls: 'snowflake-method-table-toolbar snowflake-method-prose-cloud-controls',
	});
	filterPair(cloudControls);
	const cloudFrame = cloudSection.createDiv({
		cls: 'snowflake-method-prose-cloud-frame',
	});
	const cloudEl = cloudFrame.createDiv({ cls: 'snowflake-method-prose-cloud' });

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
				`${formatPercent(summary.dialoguePercent)}%`,
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

	const refreshCounts = (): void => {
		const token = (frequencyToken += 1);
		void bridge
			.frequency({
				includeStopwords: filters.includeStopwords,
				includeEntities: filters.includeEntities,
			})
			.then((read) => {
				if (loop.disposed || token !== frequencyToken) return;
				frequency = read?.rows ?? [];
				frequencyTotal = read?.total ?? 0;
				paintFrequency();
				paintCloud();
			})
			.catch(() => undefined);
	};

	/** A second and third die from the one seed, decorrelated by primes. */
	const rollOf = (seed: number, prime: number): number => (seed * prime) % 1;

	// One hue family, graded: the commonest words wear the accent at full
	// strength and the rest recede through mixed-down shades of it, the way
	// printed clouds keep to a palette rather than a paintbox. A little of
	// the die keeps neighbours in one tier from reading as one mass.
	const shadeOf = (weight: number, seed: number): string => {
		const flip = rollOf(seed, 104729) < 0.35;
		if (weight > 0.75) return flip ? 'deep' : 'strong';
		if (weight > 0.45) return flip ? 'strong' : 'deep';
		if (weight > 0.2) return flip ? 'deep' : 'mid';
		return flip ? 'mid' : 'soft';
	};

	interface CloudDatum {
		text: string;
		size: number;
		/** The 0..1 frequency weight; `weight` is d3-cloud's own font field. */
		strength: number;
		seed: number;
		count: number;
		rotate?: number;
		x?: number;
		y?: number;
	}

	const cloudFontWeight = (strength: number): string =>
		strength > 0.75
			? '700'
			: strength > 0.45
				? '600'
				: strength > 0.2
					? '500'
					: '400';

	let cloudPaintedWidth = 0;
	let cloudPaint = 0;
	let cloudLayout: { stop: () => unknown } | null = null;
	const paintCloud = (): void => {
		cloudEl.empty();
		cloudLayout?.stop();
		const frameWidth = cloudEl.clientWidth;
		const frameHeight = cloudEl.clientHeight;
		// Hidden, there is nothing to measure against: the reveal's refresh
		// and the observer below both repaint once there is room.
		cloudPaintedWidth = frameWidth;
		if (frameWidth === 0 || frameHeight === 0) return;
		const paint = (cloudPaint += 1);
		const face = getComputedStyle(cloudEl);
		const basePx = parseFloat(face.fontSize) || 15;
		// Biggest first, so the headliners take the middle of the spiral and
		// everything smaller packs into the coves around them. The weight
		// spans just over a doubling of the base size: enough hierarchy to
		// read at a glance, no single word owning the sky.
		const words = cloudWords(frequency, MAX_CLOUD_TERMS).sort(
			(left, right) => right.count - left.count,
		);
		// The layout rolls its own dice for jitter; handed a die seeded from
		// the reading itself, one reading is one sky, every time it is drawn.
		let state = 0;
		for (const word of words) {
			state = (state + Math.floor(word.seed * 4294967296)) >>> 0;
		}
		const random = (): number => {
			state = (state + 0x6d2b79f5) >>> 0;
			let t = state;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const layout = cloud<CloudDatum>()
			.size([frameWidth, frameHeight])
			.words(
				words.map((word) => ({
					text: word.term,
					size: Math.round((0.85 + word.weight * 1.75) * basePx),
					strength: word.weight,
					seed: word.seed,
					count: word.count,
				})),
			)
			.padding(2)
			.font(face.fontFamily)
			.fontWeight((datum) => cloudFontWeight(datum.strength))
			.fontSize((datum) => datum.size)
			// A few short words stand on end the way printed clouds set them;
			// the biggest stay level, headlines are for reading.
			.rotate((datum) =>
				rollOf(datum.seed, 7919) < 0.16 &&
				datum.strength < 0.7 &&
				datum.text.length <= 6
					? 90
					: 0,
			)
			.random(random)
			.on('end', (placed) => {
				if (loop.disposed || paint !== cloudPaint) return;
				const svg = cloudEl.createSvg('svg', {
					attr: {
						width: frameWidth,
						height: frameHeight,
						viewBox: `0 0 ${String(frameWidth)} ${String(frameHeight)}`,
					},
				});
				const centre = svg.createSvg('g', {
					attr: {
						transform: `translate(${String(frameWidth / 2)},${String(frameHeight / 2)})`,
					},
				});
				for (const word of placed) {
					const el = centre.createSvg('text', {
						// An array rather than one spaced string: the SVG
						// helper feeds classList tokens one at a time.
						cls: [
							'snowflake-method-prose-cloud-word',
							`is-shade-${shadeOf(word.strength, word.seed)}`,
						],
						attr: {
							'text-anchor': 'middle',
							transform: `translate(${String(word.x ?? 0)},${String(word.y ?? 0)}) rotate(${String(word.rotate ?? 0)})`,
							'font-size': `${String(word.size)}px`,
							'font-weight': cloudFontWeight(word.strength),
						},
					});
					el.textContent = word.text;
					const share = frequencySharePercent(word.count, frequencyTotal);
					setTooltip(
						el as unknown as HTMLElement,
						share === null
							? String(word.count)
							: `${String(word.count)} (${share}%)`,
					);
				}
			});
		cloudLayout = layout;
		layout.start();
	};

	// A cloud is packed against its box: when the pane hands the box a new
	// width -- a drag, a reveal from nothing -- the sky is laid again, and
	// the chapter table is renudged for the case where the narrow pane hid
	// it before it ever measured itself.
	const cloudObserver = new ResizeObserver(() => {
		if (loop.disposed || cloudEl.clientWidth === cloudPaintedWidth) return;
		virtual.setTotal(entries.length);
		paintCloud();
	});
	cloudObserver.observe(cloudEl);

	const paint = (): void => {
		if (statistics === null) {
			// Null has three faces: still reading, a read that failed, and a
			// vault with no project. Only the last may claim so.
			stateText.setText(
				loop.loading
					? t('prose.computing')
					: loop.failed
						? t('prose.loadFailed')
						: t('prose.noProject'),
			);
			return;
		}
		stateText.setText('');
		paintSummary();
		entries = filterChapterRows(statistics.perNote, chapterQuery, {
			min: filters.lengthMin,
			max: filters.lengthMax,
		});
		chapterCount.setText(
			entries.length === statistics.perNote.length
				? ''
				: t('table.filteredCount', {
						shown: entries.length,
						total: statistics.perNote.length,
					}),
		);
		virtual.setTotal(entries.length);
	};

	const loop = refreshLoop<ManuscriptProseStatistics | null>({
		read: () => bridge.statistics(),
		// Paint-at-rest-then-patch: the standing reading keeps showing while
		// the fresh one is walked; only the very first fill says computing.
		onStart: () => {
			if (statistics === null) stateText.setText(t('prose.computing'));
		},
		onRead: (next) => {
			statistics = next;
			paint();
			refreshCounts();
		},
		onFail: () => {
			if (statistics === null) paint();
			else stateText.setText(t('prose.loadFailed'));
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
			closeFilterPanel();
			cloudLayout?.stop();
			cloudObserver.disconnect();
			virtual.destroy();
			root.remove();
		},
	};
}
