import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	analyzeMentions,
	buildEntityMatcher,
	planMentionMarks,
	type EntityOccurrence,
	type MentionMark,
	type MentionSource,
} from '../../src/domain';

/** A menu's item as a test reads it back. */
interface DrawnItem {
	title: string;
	click: () => void;
}

/** Every menu shown, with what it offered. */
const shown = vi.hoisted(() => [] as DrawnItem[][]);

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Menu {
		readonly items: DrawnItem[] = [];
		addItem(build: (item: unknown) => void): this {
			const entry: DrawnItem = { title: '', click: () => undefined };
			const handle = {
				setTitle: (title: string) => ((entry.title = title), handle),
				setIcon: () => handle,
				setSection: () => handle,
				onClick: (click: () => void) => ((entry.click = click), handle),
			};
			build(handle);
			this.items.push(entry);
			return this;
		}
		showAtMouseEvent(): this {
			shown.push(this.items);
			return this;
		}
	}
	return { ...runtime, ItemView: class {}, Menu };
});

import { SnowflakeManuscriptView } from '../../src/ui/manuscript-view';

const PROJECT = 'Novel/00_System/001_Project_Metadata.md';
const CHAPTER = 'Novel/50_Manuscript/Chapter 1.md';
const ALICE = 'Novel/20_Character/Alice.md';

const alice: MentionSource = {
	label: 'Alice',
	entry: 'name',
	memberPath: ALICE,
	memberName: 'Alice',
	group: 'character',
	groupRank: 0,
	rank: 0,
	insert: '[[Novel/20_Character/Alice|Alice]]',
};

/** The parts of the view this file reaches past its public face for. */
interface Inside {
	openRenderedMentionMenu(
		entry: { mentions: { marks: MentionMark[]; occurrences: EntityOccurrence[] } | null },
		el: { getAttribute(name: string): string | null },
		event: MouseEvent,
	): void;
}

/** A stream over one chapter whose page reads "Alice waits.", the name marked as the page marks it. */
function stream(readOnly = false) {
	const occurrences = analyzeMentions(CHAPTER, 'Alice waits.', [], buildEntityMatcher([alice]), []);
	const marks = planMentionMarks(occurrences, [], 'all');
	const host = {
		openManagedFile: vi.fn((_path: string) => Promise.resolve()),
		editMentionedEntity: vi.fn((_project: string | null, _member: string) => Promise.resolve()),
		addMentionIgnore: vi.fn(() => Promise.resolve()),
	};
	const errors: unknown[] = [];
	const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
	Object.assign(view, {
		host,
		t: (key: string) => key,
		model: { projectPath: PROJECT, readOnly },
		projectPath: PROJECT,
		showError: (error: unknown) => {
			errors.push(error);
		},
	});
	const press = (): DrawnItem[] => {
		(view as unknown as Inside).openRenderedMentionMenu(
			{ mentions: { marks, occurrences } },
			{ getAttribute: () => '0' },
			{} as MouseEvent,
		);
		return shown[shown.length - 1] ?? [];
	};
	return { host, press, errors };
}

beforeEach(() => {
	shown.length = 0;
});

describe('a click on a mention in the stream’s reading half', () => {
	it('offers the entity’s form right after its note, and asks the host for it by the note', async () => {
		const { host, press, errors } = stream();
		const items = press();
		expect(items.map((item) => item.title)).toEqual([
			'manuscript.mention.convert',
			'manuscript.mention.open',
			'manuscript.mention.edit',
			'manuscript.mention.ignoreOccurrence',
			'manuscript.mention.ignoreNote',
			'manuscript.mention.ignoreManuscript',
		]);
		items[2]?.click();
		expect(host.editMentionedEntity).toHaveBeenCalledExactlyOnceWith(PROJECT, ALICE);
		// The note itself is still one entry up, and opening it is another act.
		expect(host.openManagedFile).not.toHaveBeenCalled();
		items[1]?.click();
		expect(host.openManagedFile).toHaveBeenCalledExactlyOnceWith(ALICE);
		await Promise.resolve();
		expect(errors).toEqual([]);
	});

	it('says what went wrong when the form could not be asked for', async () => {
		const { host, press, errors } = stream();
		const failure = new Error('no dashboard');
		host.editMentionedEntity.mockRejectedValueOnce(failure);
		press()[2]?.click();
		await vi.waitFor(() => expect(errors).toEqual([failure]));
	});

	it('offers no form in a project that cannot be written', () => {
		const { press } = stream(true);
		expect(press().map((item) => item.title)).toEqual([
			'manuscript.mention.open',
			'manuscript.mention.ignoreOccurrence',
			'manuscript.mention.ignoreNote',
			'manuscript.mention.ignoreManuscript',
		]);
	});
});
