import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	analyzeMentions,
	buildEntityMatcher,
	type EntityOccurrence,
	type MentionSource,
} from '../../src/domain';

/** A menu's item as a test reads it back. */
interface DrawnItem {
	title: string;
	icon: string;
	section: string | null;
	click: () => void;
}

/** Every menu shown, with what it offered. */
const shown = vi.hoisted(() => [] as DrawnItem[][]);

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Menu {
		readonly items: DrawnItem[] = [];
		addItem(build: (item: unknown) => void): this {
			const entry: DrawnItem = { title: '', icon: '', section: null, click: () => undefined };
			const handle = {
				setTitle: (title: string) => ((entry.title = title), handle),
				setIcon: (icon: string) => ((entry.icon = icon), handle),
				setSection: (section: string) => ((entry.section = section), handle),
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
	return { ...runtime, Menu };
});

import { Menu } from 'obsidian';

import { addMentionMenuItems, openMentionMenu } from '../../src/ui/mention-menu';

const ALICE = 'Novel/20_Character/Alice.md';
const ROSE_ASHBY = 'Novel/20_Character/Rose Ashby.md';
const ROSE_BELL = 'Novel/20_Character/Rose Bell.md';
const CHAPTER = 'Novel/50_Manuscript/Chapter 1.md';

const source = (label: string, memberPath: string, memberName = label): MentionSource => ({
	label,
	entry: memberName === label ? 'name' : 'alias',
	memberPath,
	memberName,
	group: 'character',
	groupRank: 0,
	rank: 0,
	insert: `[[${memberPath.replace(/\.md$/u, '')}|${label}]]`,
});

// One of each: a settled mention, one two notes answer to, one already
// linked, and words linked to a note that is nobody's here.
const BODY = 'Alice met Rose. [[Novel/20_Character/Alice|Alice]] wrote to [[Elsewhere/Stranger|Rose]].';
const occurrences = analyzeMentions(
	CHAPTER,
	BODY,
	[],
	buildEntityMatcher([
		source('Alice', ALICE),
		source('Rose', ROSE_ASHBY, 'Rose Ashby'),
		source('Rose', ROSE_BELL, 'Rose Bell'),
	]),
	[],
);
const of = (resolution: EntityOccurrence['resolution']): EntityOccurrence => {
	const found = occurrences.find((entry) => entry.resolution === resolution);
	if (found === undefined) throw new Error(`no ${resolution} occurrence in the fixture`);
	return found;
};

/** The items a mention's menu holds, with every choice recorded as it is made. */
function menuFor(
	occurrence: EntityOccurrence,
	over: { writable?: boolean; section?: string } = {},
): { items: DrawnItem[]; added: boolean; calls: string[] } {
	const calls: string[] = [];
	const writable = over.writable ?? true;
	const menu = new Menu();
	const added = addMentionMenuItems(menu, {
		occurrence,
		noteOccurrences: occurrences,
		t: (key, vars) => (vars === undefined ? key : `${key}:${String(vars.name)}`),
		...(writable
			? {
					onConvert: (candidate) => calls.push(`convert:${candidate.memberPath}`),
					onEdit: (candidate) => calls.push(`edit:${candidate.memberPath}`),
				}
			: {}),
		onOpen: (candidate) => calls.push(`open:${candidate.memberPath}`),
		onIgnore: (rule) => calls.push(`ignore:${rule.scope}`),
		...(over.section === undefined ? {} : { section: over.section }),
	});
	return { items: (menu as unknown as { items: DrawnItem[] }).items, added, calls };
}

beforeEach(() => {
	shown.length = 0;
});

describe('the menu a mention answers with', () => {
	it('reads the fixture as one mention of each kind', () => {
		expect(occurrences.map((entry) => entry.resolution)).toEqual([
			'unique',
			'ambiguous',
			'wikilink',
			'foreign-link',
		]);
	});

	it('offers to edit a settled mention right after opening it', () => {
		const { items, added, calls } = menuFor(of('unique'));
		expect(added).toBe(true);
		expect(items.map((item) => item.title)).toEqual([
			'manuscript.mention.convert',
			'manuscript.mention.open',
			'manuscript.mention.edit',
			'manuscript.mention.ignoreOccurrence',
			'manuscript.mention.ignoreNote',
			'manuscript.mention.ignoreManuscript',
		]);
		// Opening and editing are the same group of acts, apart from the ignores.
		expect(items.map((item) => item.section)).toEqual([
			'snowflake-method-mention',
			'snowflake-method-mention',
			'snowflake-method-mention',
			'snowflake-method-mention-ignore',
			'snowflake-method-mention-ignore',
			'snowflake-method-mention-ignore',
		]);
		expect(items[1]?.icon).toBe('file-symlink');
		expect(items[2]?.icon).toBe('pencil');
		items[1]?.click();
		items[2]?.click();
		expect(calls).toEqual([`open:${ALICE}`, `edit:${ALICE}`]);
	});

	it('names every candidate of an ambiguous mention, the edits after the opens', () => {
		const { items, calls } = menuFor(of('ambiguous'));
		expect(items.slice(0, 6).map((item) => item.title)).toEqual([
			'manuscript.mention.convertTo:Rose Ashby',
			'manuscript.mention.convertTo:Rose Bell',
			'manuscript.mention.openOf:Rose Ashby',
			'manuscript.mention.openOf:Rose Bell',
			'manuscript.mention.editOf:Rose Ashby',
			'manuscript.mention.editOf:Rose Bell',
		]);
		items[5]?.click();
		expect(calls).toEqual([`edit:${ROSE_BELL}`]);
	});

	it('opens and edits a linked mention, and offers nothing else about it', () => {
		const { items, calls } = menuFor(of('wikilink'));
		expect(items.map((item) => item.title)).toEqual([
			'manuscript.mention.open',
			'manuscript.mention.edit',
		]);
		items[1]?.click();
		expect(calls).toEqual([`edit:${ALICE}`]);
	});

	it('offers neither a link nor the form in a project that cannot be written', () => {
		expect(menuFor(of('unique'), { writable: false }).items.map((item) => item.title)).toEqual([
			'manuscript.mention.open',
			'manuscript.mention.ignoreOccurrence',
			'manuscript.mention.ignoreNote',
			'manuscript.mention.ignoreManuscript',
		]);
		expect(menuFor(of('wikilink'), { writable: false }).items.map((item) => item.title)).toEqual([
			'manuscript.mention.open',
		]);
	});

	it('puts every item in the section a shared menu names', () => {
		const { items } = menuFor(of('unique'), { section: 'snowflake-method' });
		expect(items.map((item) => item.section)).toEqual(items.map(() => 'snowflake-method'));
	});

	it('has nothing to say about words linked to a note of nobody here', () => {
		const { items, added } = menuFor(of('foreign-link'));
		expect(added).toBe(false);
		expect(items).toEqual([]);
		openMentionMenu({
			occurrence: of('foreign-link'),
			noteOccurrences: occurrences,
			t: (key) => key,
			onOpen: () => undefined,
			onIgnore: () => undefined,
			event: {} as MouseEvent,
		});
		expect(shown).toEqual([]);
	});

	it('shows the standalone menu where the click was', () => {
		openMentionMenu({
			occurrence: of('unique'),
			noteOccurrences: occurrences,
			t: (key) => key,
			onOpen: () => undefined,
			onEdit: () => undefined,
			onIgnore: () => undefined,
			event: {} as MouseEvent,
		});
		expect(shown).toHaveLength(1);
		expect(shown[0]?.map((item) => item.title)).toContain('manuscript.mention.edit');
	});
});
