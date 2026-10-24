import { describe, expect, it } from 'vitest';

import {
	DATE_FORMATS,
	monthTitle,
	type HistoryDay,
	type HistoryEntry,
	type HistoryNoteEntry,
	type HistoryNoteIdentity,
	type HistoryNoteKind,
	type HistoryReading,
} from '../../src/domain';
import { t as translate, type SupportedLocale } from '../../src/i18n';
import {
	HISTORY_FIXED_KINDS,
	NAME_MARK,
	entryKindKeys,
	entryMatchesKind,
	flattenHistoryRows,
	historyDayTitle,
	numeralRuns,
	historyKindOptions,
	historyRange,
	historyRangeTitle,
	historySentence,
	historyTime,
	historyWhat,
	kindRefOf,
	noteKindKey,
	noteName,
	stepHistoryRange,
	type HistorySentenceLabels,
} from '../../src/ui/history-rows';
import type { Translate } from '../../src/ui/modals';

/**
 * The pure half of the Modification history tab, spoken through the real
 * translator in both languages: the range the reader walks, the funnel,
 * the flattened day list, and what each row says.
 */

const tr = (locale: SupportedLocale): Translate => (key, vars) => translate(locale, key, vars);
const en = tr('en');
const zh = tr('zh-CN');
const ISO = DATE_FORMATS[1];

const at = (day: string, clock: string): number => Date.parse(`${day}T${clock}:00Z`);

const note = (
	path: string,
	kind: HistoryNoteKind,
	over: Partial<HistoryNoteIdentity> = {},
): HistoryNoteIdentity => ({ path, kind, exists: true, ...over });

const day = (stamp: string, entries: HistoryEntry[]): HistoryDay => ({ day: stamp, entries });

const noteEntry = (
	id: string,
	stamp: string,
	clock: string,
	subject: HistoryNoteIdentity,
	over: Partial<HistoryNoteEntry> = {},
): HistoryNoteEntry => ({
	id,
	kind: 'note',
	action: 'edited',
	day: stamp,
	at: at(stamp, clock),
	until: at(stamp, clock),
	note: subject,
	versions: 0,
	words: { added: 0, deleted: 0, net: 0 },
	source: 'ledger',
	sessions: 0,
	...over,
});

const labelsFor = (t: Translate): HistorySentenceLabels => ({
	what: (ref) => historyWhat(t, ref, (wb) => wb.wbKind ?? ''),
	taskStatus: (status) => t(`tasks.status.${status}`),
	threadStatus: (status) => t(`foreshadowing.status.${status}`),
});

const said = (t: Translate, entry: HistoryEntry): string => {
	const sentence = historySentence(t, entry, labelsFor(t));
	return sentence.name === null
		? sentence.before
		: `${sentence.before}[${sentence.name}]${sentence.after}`;
};

describe('the range the reader walks', () => {
	it('cuts a day to itself, a week from the author’s first day, a month to its ends', () => {
		expect(historyRange('2026-10-21', 'day', 'monday')).toEqual({
			unit: 'day',
			from: '2026-10-21',
			through: '2026-10-21',
		});
		expect(historyRange('2026-10-21', 'week', 'monday')).toEqual({
			unit: 'week',
			from: '2026-10-19',
			through: '2026-10-25',
		});
		expect(historyRange('2026-10-21', 'week', 'sunday')).toEqual({
			unit: 'week',
			from: '2026-10-18',
			through: '2026-10-24',
		});
		expect(historyRange('2026-10-21', 'month', 'monday')).toEqual({
			unit: 'month',
			from: '2026-10-01',
			through: '2026-10-31',
		});
		expect(historyRange('2024-02-10', 'month', 'monday').through).toBe('2024-02-29');
	});

	it('steps by its own unit, a month from whichever day it was cut around', () => {
		const week = historyRange('2026-10-21', 'week', 'monday');
		expect(stepHistoryRange(week, 1, 'monday')).toMatchObject({
			from: '2026-10-26',
			through: '2026-11-01',
		});
		expect(stepHistoryRange(week, -2, 'monday')).toMatchObject({ from: '2026-10-05' });
		const month = historyRange('2026-10-31', 'month', 'monday');
		expect(stepHistoryRange(month, -1, 'monday')).toMatchObject({
			from: '2026-09-01',
			through: '2026-09-30',
		});
		expect(stepHistoryRange(month, 4, 'monday')).toMatchObject({ from: '2027-02-01' });
		expect(stepHistoryRange(historyRange('2026-10-21', 'day', 'monday'), 1, 'monday')).toMatchObject(
			{ from: '2026-10-22', through: '2026-10-22' },
		);
	});

	it('titles a day by name where it has one, a week by its ends, a month by its name', () => {
		const options = { t: en, locale: 'en', dateFormat: ISO };
		const today = '2026-10-21';
		expect(historyDayTitle('2026-10-21', today, options)).toBe('Today');
		expect(historyDayTitle('2026-10-20', today, options)).toBe('Yesterday');
		expect(historyDayTitle('2026-10-19', today, options)).toBe('2026-10-19 Mon');
		expect(historyDayTitle('2026-10-19', today, { ...options, t: zh, locale: 'zh-CN' })).toBe(
			'2026-10-19 周一',
		);
		expect(historyRangeTitle(historyRange(today, 'day', 'monday'), today, options)).toBe('Today');
		expect(historyRangeTitle(historyRange(today, 'week', 'monday'), today, options)).toBe(
			'2026-10-19 – 2026-10-25',
		);
		expect(
			historyRangeTitle(historyRange(today, 'week', 'monday'), today, {
				...options,
				t: zh,
				locale: 'zh-CN',
			}),
		).toBe('2026-10-19 至 2026-10-25');
		expect(historyRangeTitle(historyRange(today, 'month', 'monday'), today, options)).toBe(
			monthTitle('2026-10-01', 'en'),
		);
	});
});

describe('the funnel over the kinds', () => {
	it('keys a note by its kind, a worldbuilding note by its own kind', () => {
		expect(noteKindKey({ kind: 'scene' })).toBe('scene');
		expect(noteKindKey({ kind: 'worldbuilding', wbKind: 'time' })).toBe('wb:time');
		expect(kindRefOf('wb:Faction')).toEqual({ path: '', kind: 'worldbuilding', wbKind: 'Faction' });
		expect(kindRefOf('step')).toEqual({ path: '', kind: 'step' });
		expect(kindRefOf('task')).toBeNull();
		expect(kindRefOf('')).toBeNull();
	});

	it('matches a rename or an import by any note it touched', () => {
		const renamed: HistoryEntry = {
			id: 'r',
			kind: 'renamed',
			day: '2026-10-21',
			at: 1,
			until: 1,
			inferred: false,
			items: [
				{ from: '40_Scene/Old.md', note: note('40_Scene/New.md', 'scene') },
				{ from: '20_Character/A.md', note: note('20_Character/B.md', 'character') },
			],
		};
		expect(entryKindKeys(renamed)).toEqual(['scene', 'character']);
		expect(entryMatchesKind(renamed, 'scene')).toBe(true);
		expect(entryMatchesKind(renamed, 'manuscript')).toBe(false);
		expect(entryMatchesKind(renamed, '')).toBe(true);
		const task: HistoryEntry = {
			id: 't',
			kind: 'task',
			event: 'task-created',
			day: '2026-10-21',
			at: 1,
			until: 1,
			task: { id: 'task-1', title: 'Fix the ending' },
		};
		expect(entryKindKeys(task)).toEqual(['task']);
	});

	it('offers the fixed kinds, and any authored kind the reading speaks of', () => {
		expect(historyKindOptions(null)).toEqual([...HISTORY_FIXED_KINDS]);
		const reading: HistoryReading = {
			days: [
				day('2026-10-21', [
					noteEntry('f', '2026-10-21', '09:00', note('60_Worldbuilding/64_Faction/Guild.md', 'worldbuilding', { wbKind: 'Faction' })),
					noteEntry('t', '2026-10-21', '10:00', note('60_Worldbuilding/61_Time/Dawn.md', 'worldbuilding', { wbKind: 'time' })),
				]),
			],
		};
		expect(historyKindOptions(reading)).toEqual([...HISTORY_FIXED_KINDS, 'wb:Faction']);
	});
});

describe('the flattened day list', () => {
	const older = day('2026-10-19', [
		noteEntry('a', '2026-10-19', '09:00', note('40_Scene/One.md', 'scene')),
		{
			id: 'b',
			kind: 'task',
			event: 'task-created',
			day: '2026-10-19',
			at: at('2026-10-19', '10:00'),
			until: at('2026-10-19', '10:00'),
			task: { id: 'task-1', title: 'Fix the ending' },
		},
	]);
	const newer = day('2026-10-21', [
		noteEntry('c', '2026-10-21', '08:00', note('50_Manuscript/Chapter 3.md', 'manuscript')),
	]);
	const empty = day('2026-10-20', []);

	it('heads the newest day first, keeps a day’s entries in order, and skips an empty day', () => {
		expect(flattenHistoryRows([older, empty, newer], '').map((row) => row.key)).toEqual([
			'day:2026-10-21',
			'entry:c',
			'day:2026-10-19',
			'entry:a',
			'entry:b',
		]);
	});

	it('drops a day whole when the funnel leaves nothing of it', () => {
		expect(flattenHistoryRows([older, empty, newer], 'task').map((row) => row.key)).toEqual([
			'day:2026-10-19',
			'entry:b',
		]);
		expect(flattenHistoryRows([older, newer], 'character')).toEqual([]);
	});
});

describe('what a row says', () => {
	it('names a note by its stem', () => {
		expect(noteName('40_Scene/Scene 12.md')).toBe('Scene 12');
		expect(noteName('Scene 12.MD')).toBe('Scene 12');
		expect(noteName('a/b.canvas')).toBe('b.canvas');
	});

	it('says what became of a note, the name set apart for the link', () => {
		const ada = note('20_Character/Ada.md', 'character');
		const created = noteEntry('1', '2026-10-21', '09:00', ada, { action: 'created' });
		expect(said(en, created)).toBe('Created the character “[Ada]”');
		expect(said(zh, created)).toBe('创建了角色“[Ada]”');
		const chapter = note('50_Manuscript/Chapter 3.md', 'manuscript');
		const wrote = noteEntry('2', '2026-10-21', '09:00', chapter, { source: 'sessions' });
		expect(said(en, wrote)).toBe('Wrote in the manuscript note “[Chapter 3]”');
		expect(said(zh, wrote)).toBe('在正文笔记“[Chapter 3]”中写作');
		const edited = noteEntry('3', '2026-10-21', '09:00', chapter, { source: 'snapshots' });
		expect(said(en, edited)).toBe('Edited the manuscript note “[Chapter 3]”');
		const first = noteEntry('4', '2026-10-21', '09:00', chapter, { action: 'first-recorded' });
		expect(said(en, first)).toBe('Edited the manuscript note “[Chapter 3]”');
		const gone = noteEntry('5', '2026-10-21', '09:00', note('40_Scene/Old.md', 'scene', { exists: false }), {
			action: 'deleted',
		});
		expect(said(en, gone)).toBe('Deleted the scene “[Old]”');
		expect(said(zh, gone)).toBe('删除了场景“[Old]”');
		const step = noteEntry('6', '2026-10-21', '09:00', note('10_Step/Summary.md', 'step', { step: 1 }));
		// The layout names a step's file; the sentence names the step.
		expect(said(en, step)).toBe('Edited step 1, [One-sentence summary]');
		expect(said(zh, step)).toBe('修改了第 1 步“[一句话概述]”');
		const brought = noteEntry('7', '2026-10-21', '09:00', ada, {
			action: 'imported',
			importedFrom: { projectId: 'p', title: 'Book 1' },
		});
		expect(said(en, brought)).toBe('Imported the character “[Ada]” from “Book 1”');
		expect(said(zh, brought)).toBe('从“Book 1”导入了角色“[Ada]”');
		const plain = noteEntry('8', '2026-10-21', '09:00', ada, { action: 'imported' });
		expect(said(en, plain)).toBe('Imported the character “[Ada]”');
	});

	it('names a worldbuilding note by its kind, authored kinds in the project’s word', () => {
		const what = (kind: string): string =>
			historyWhat(en, { path: 'x.md', kind: 'worldbuilding', wbKind: kind }, () => 'Faction').replace(
				NAME_MARK,
				'x',
			);
		expect(what('time')).toBe('the time note “x”');
		expect(what('location')).toBe('the location “x”');
		expect(what('item')).toBe('the item “x”');
		expect(what('Faction')).toBe('the Faction note “x”');
		expect(historyWhat(en, { path: 'x.md', kind: 'other' }, () => '').replace(NAME_MARK, 'x')).toBe(
			'the note “x”',
		);
	});

	it('tells a rename, several at once, and an import of many', () => {
		const one: HistoryEntry = {
			id: 'r',
			kind: 'renamed',
			day: '2026-10-21',
			at: 1,
			until: 1,
			inferred: false,
			items: [{ from: '40_Scene/Old.md', note: note('40_Scene/New.md', 'scene') }],
		};
		expect(said(en, one)).toBe('Renamed “Old” to “[New]”');
		expect(said(zh, one)).toBe('将“Old”重命名为“[New]”');
		const many: HistoryEntry = {
			...one,
			items: [...one.items, { from: 'a.md', note: note('b.md', 'other') }, { from: 'c.md', note: note('d.md', 'other') }],
		};
		expect(historySentence(en, many, labelsFor(en))).toEqual({
			before: 'Renamed 3 notes',
			name: null,
			after: '',
		});
		expect(said(zh, many)).toBe('重命名了 3 篇笔记');
		const brought: HistoryEntry = {
			id: 'i',
			kind: 'imported',
			day: '2026-10-21',
			at: 1,
			until: 1,
			from: { projectId: 'p', title: 'Book 1' },
			notes: [note('a.md', 'other'), note('b.md', 'other')],
		};
		expect(said(en, brought)).toBe('Imported 2 notes from “Book 1”');
		expect(said(zh, brought)).toBe('从“Book 1”导入了 2 篇笔记');
		expect(said(en, { ...brought, from: null })).toBe('Imported 2 notes');
	});

	it('tells a task, a thread and a revision in the board’s own words', () => {
		const base = { day: '2026-10-21', at: 1, until: 1 };
		const task = (event: 'task-created' | 'task-status' | 'task-archived' | 'task-deleted', status?: 'done'): HistoryEntry => ({
			...base,
			id: event,
			kind: 'task',
			event,
			task: { id: 'task-1', title: 'Fix the ending' },
			...(status === undefined ? {} : { status }),
		});
		expect(said(en, task('task-created'))).toBe('Added the task “[Fix the ending]”');
		expect(said(en, task('task-status', 'done'))).toBe('Moved the task “[Fix the ending]” to Done');
		expect(said(zh, task('task-status', 'done'))).toBe('将任务“[Fix the ending]”移到已完成');
		expect(said(en, task('task-archived'))).toBe('Archived the task “[Fix the ending]”');
		expect(said(zh, task('task-deleted'))).toBe('删除了任务“[Fix the ending]”');
		const thread = (event: 'thread-created' | 'thread-status' | 'thread-deleted', status?: 'resolved'): HistoryEntry => ({
			...base,
			id: event,
			kind: 'thread',
			event,
			thread: { id: 'thread-1', name: 'The key' },
			...(status === undefined ? {} : { status }),
		});
		expect(said(en, thread('thread-created'))).toBe('Added the foreshadowing “[The key]”');
		expect(said(en, thread('thread-status', 'resolved'))).toBe('Marked the foreshadowing “[The key]” as Resolved');
		expect(said(zh, thread('thread-status', 'resolved'))).toBe('将伏笔“[The key]”标记为已回收');
		expect(said(zh, thread('thread-deleted'))).toBe('删除了伏笔“[The key]”');
		const revision = (event: 'revision-proposed' | 'revision-accepted' | 'revision-discarded'): HistoryEntry => ({
			...base,
			id: event,
			kind: 'revision',
			event,
			revision: { id: 'rev-1' },
			note: note('50_Manuscript/Chapter 3.md', 'manuscript'),
		});
		expect(said(en, revision('revision-proposed'))).toBe('Proposed a revision in the manuscript note “[Chapter 3]”');
		expect(said(en, revision('revision-accepted'))).toBe('Accepted a revision in the manuscript note “[Chapter 3]”');
		expect(said(zh, revision('revision-discarded'))).toBe('放弃了正文笔记“[Chapter 3]”中的一条修订');
	});

	it('reads the clock in the reader’s zone, a stretch by its two ends', () => {
		const chapter = note('50_Manuscript/Chapter 3.md', 'manuscript');
		const moment = noteEntry('1', '2026-10-21', '14:05', chapter);
		expect(historyTime(moment, 'UTC')).toBe('14:05');
		expect(historyTime(moment, 'Asia/Shanghai')).toBe('22:05');
		const stretch = noteEntry('2', '2026-10-21', '14:05', chapter, { until: at('2026-10-21', '15:10') });
		expect(historyTime(stretch, 'UTC')).toBe('14:05–15:10');
		// A stretch under a minute reads as one moment.
		expect(historyTime({ ...moment, until: moment.at + 59_000 }, 'UTC')).toBe('14:05');
	});

	it('cuts a text at its numbers', () => {
		const runs = (text: string): string[] =>
			numeralRuns(text).map((run) => (run.numeral ? `[${run.text}]` : run.text));
		expect(runs('12 notes · 3 versions · +1,632')).toEqual([
			'[12]',
			' notes · ',
			'[3]',
			' versions · ',
			'[+1,632]',
		]);
		expect(runs('since 2026-10-19')).toEqual(['since ', '[2026-10-19]']);
		expect(runs('2026/10/19 – 2026/10/25')).toEqual(['[2026/10/19]', ' – ', '[2026/10/25]']);
		expect(runs('14:05–15:10 Sun')).toEqual(['[14:05]', '–', '[15:10]', ' Sun']);
		expect(runs('-17 字')).toEqual(['[-17]', ' 字']);
		expect(runs('Today')).toEqual(['Today']);
		expect(runs('')).toEqual([]);
	});
});

