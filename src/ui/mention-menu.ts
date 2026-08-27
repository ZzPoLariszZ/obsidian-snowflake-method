/**
 * The one menu a mention answers with, whichever half of the stream it was
 * asked in. What it offers follows the resolution: a settled mention
 * converts and opens; an ambiguous one offers every candidate by name, and
 * ignoring one candidate is a different act from silencing the spot -- the
 * first can resolve what remains, the second says this stretch is not a
 * mention at all. A linked mention only opens, and a foreign link gets no
 * menu: the author already said whom they meant.
 *
 * Nothing here modifies the manuscript. Every item hands the choice back
 * through a callback, and the callbacks are where the guards live.
 */

import { Menu } from 'obsidian';

import {
	mentionIgnoreOf,
	type EntityOccurrence,
	type MentionCandidate,
	type MentionIgnore,
} from '../domain';

export interface MentionMenuOptions {
	occurrence: EntityOccurrence;
	/** The note's occurrences in document order, for the ordinal. */
	noteOccurrences: readonly EntityOccurrence[];
	t: (key: string, vars?: Record<string, string | number>) => string;
	/** Absent while the note cannot be written: nothing offers to convert. */
	onConvert?: (candidate: MentionCandidate) => void;
	onOpen: (candidate: MentionCandidate) => void;
	onIgnore: (rule: MentionIgnore) => void;
	/**
	 * The menu section every item joins. A menu shared with other groups --
	 * the segment's own right-click -- names the plugin's section so the
	 * items stand inside it; the standalone click menu leaves this unset and
	 * keeps its own two groups, actions apart from ignores.
	 */
	section?: string;
	event: MouseEvent;
}

/** Builds the items onto a menu the caller owns; false when there are none. */
export function addMentionMenuItems(
	menu: Menu,
	options: Omit<MentionMenuOptions, 'event'>,
): boolean {
	const { occurrence, noteOccurrences, t, onConvert, onOpen, onIgnore } =
		options;
	if (occurrence.resolution === 'foreign-link') return false;
	const ambiguous = occurrence.resolution === 'ambiguous';
	const convertible =
		onConvert !== undefined &&
		(occurrence.resolution === 'unique' || ambiguous);
	const actionSection = options.section ?? 'snowflake-method-mention';
	const ignoreSection = options.section ?? 'snowflake-method-mention-ignore';

	if (convertible) {
		for (const candidate of occurrence.candidates) {
			menu.addItem((item) =>
				item
					.setSection(actionSection)
					.setTitle(
						ambiguous
							? t('manuscript.mention.convertTo', {
									name: candidate.memberName,
								})
							: t('manuscript.mention.convert'),
					)
					.setIcon('link')
					.onClick(() => {
						onConvert(candidate);
					}),
			);
		}
	}
	for (const candidate of occurrence.candidates) {
		menu.addItem((item) =>
			item
				.setSection(actionSection)
				.setTitle(
					ambiguous
						? t('manuscript.mention.openOf', { name: candidate.memberName })
						: t('manuscript.mention.open'),
				)
				.setIcon('file-symlink')
				.onClick(() => {
					onOpen(candidate);
				}),
		);
	}
	if (occurrence.resolution === 'wikilink') return true;

	const ignore = (title: string, rule: MentionIgnore): void => {
		menu.addItem((item) =>
			item
				.setSection(ignoreSection)
				.setTitle(title)
				.setIcon('eye-off')
				.onClick(() => {
					onIgnore(rule);
				}),
		);
	};
	ignore(
		t('manuscript.mention.ignoreOccurrence'),
		mentionIgnoreOf(occurrence, noteOccurrences, 'occurrence'),
	);
	if (ambiguous) {
		for (const candidate of occurrence.candidates) {
			ignore(
				t('manuscript.mention.ignoreCandidateNote', {
					name: candidate.memberName,
				}),
				mentionIgnoreOf(
					occurrence,
					noteOccurrences,
					'note',
					candidate.memberPath,
				),
			);
			ignore(
				t('manuscript.mention.ignoreCandidateManuscript', {
					name: candidate.memberName,
				}),
				mentionIgnoreOf(
					occurrence,
					noteOccurrences,
					'manuscript',
					candidate.memberPath,
				),
			);
		}
	} else {
		ignore(
			t('manuscript.mention.ignoreNote'),
			mentionIgnoreOf(occurrence, noteOccurrences, 'note'),
		);
		ignore(
			t('manuscript.mention.ignoreManuscript'),
			mentionIgnoreOf(occurrence, noteOccurrences, 'manuscript'),
		);
	}
	return true;
}

/** The standalone menu a click on a rendered mention opens. */
export function openMentionMenu(options: MentionMenuOptions): void {
	const menu = new Menu();
	if (!addMentionMenuItems(menu, options)) return;
	menu.showAtMouseEvent(options.event);
}
