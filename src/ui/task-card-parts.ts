import { setIcon, setTooltip } from 'obsidian';

import { formatDay, taskOverdue, type DateFormat, type Task } from '../domain';
import type { Translate } from './modals';

/**
 * The second row of a task's card, stated once for every surface that deals
 * one: the board's lanes and its shelf, and the canvas. The priority as its
 * mark in colour and the word beside it, and the day it is due, said as the
 * author writes dates and red once the day has passed.
 */

/** The mark each priority wears: a rising chevron pair for the urgent, a level pair of lines for the middle. */
export const PRIORITY_ICONS: Record<Task['priority'], string> = {
	low: 'chevron-down',
	medium: 'equal',
	high: 'chevron-up',
	urgent: 'chevrons-up',
};

/** The day the reading device is on, and how a day is written. */
export interface TaskCardWhen {
	today: string;
	dateFormat: DateFormat;
}

/** Fills the row afresh from the task: what stood there is taken out first. */
export function paintTaskMeta(host: HTMLElement, task: Task, when: TaskCardWhen, t: Translate): void {
	host.empty();
	const priority = host.createSpan({ cls: 'snowflake-method-task-priority' });
	const mark = priority.createSpan({
		cls: 'snowflake-method-task-glyph',
		attr: { 'aria-hidden': 'true' },
	});
	setIcon(mark, PRIORITY_ICONS[task.priority]);
	priority.createSpan({ text: t(`tasks.priority.${task.priority}`) });
	if (task.dueDate === null) return;
	const overdue = taskOverdue(task, when.today);
	const due = host.createSpan({ cls: 'snowflake-method-task-due' });
	due.toggleClass('is-overdue', overdue);
	const icon = due.createSpan({
		cls: 'snowflake-method-task-glyph',
		attr: { 'aria-hidden': 'true' },
	});
	setIcon(icon, 'calendar');
	const date = formatDay(task.dueDate, when.dateFormat);
	due.createSpan({ text: date });
	setTooltip(
		due,
		overdue ? `${t('taskBoard.overdue')} · ${t('taskBoard.due', { date })}` : t('taskBoard.due', { date }),
	);
}
