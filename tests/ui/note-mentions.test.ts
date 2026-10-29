// @vitest-environment happy-dom

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform, type MarkdownPostProcessorContext } from 'obsidian';

import {
	buildEntityMatcher,
	buildSensitiveMatcher,
	compileCustomHighlightRules,
	type MentionHighlightMode,
	type MentionMark,
	type MentionSource,
} from '../../src/domain';
import { mentionHighlights } from '../../src/editor';
import {
	NoteMentions,
	planNoteMentions,
	type MentionNote,
	type NoteMentionFeed,
} from '../../src/ui/note-mentions';
import { noteSelectionMoved } from '../../src/ui/selection-press';
import { installObsidianDom } from '../helpers/obsidian-dom';

interface ShownItem {
	title: string;
	section: string | null;
	click: (() => void) | null;
}

// Every menu shown and every notice told, kept where a test can read them.
const shown = vi.hoisted(() => ({ menus: [] as ShownItem[][], notices: [] as string[] }));
// The mention a right-click on an editor lands on: a layout this suite does
// not have is the editor's business, so the test says where the click fell.
const pointedMark = vi.hoisted(() => ({ mark: null as MentionMark | null }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class RecordingMenu {
		readonly items: ShownItem[] = [];
		addItem(build: (item: unknown) => void): this {
			const entry: ShownItem = { title: '', section: null, click: null };
			const handle = {
				setTitle: (title: string) => ((entry.title = title), handle),
				setSection: (section: string) => ((entry.section = section), handle),
				setIcon: () => handle,
				setIsLabel: () => handle,
				onClick: (click: () => void) => ((entry.click = click), handle),
			};
			build(handle);
			this.items.push(entry);
			return this;
		}
		addSeparator(): this {
			return this;
		}
		showAtMouseEvent(): this {
			shown.menus.push(this.items);
			return this;
		}
	}
	return {
		...runtime,
		Menu: RecordingMenu,
		Notice: class {
			constructor(message: unknown) {
				shown.notices.push(String(message));
			}
		},
	};
});

vi.mock('../../src/editor', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/editor')>();
	return { ...actual, mentionMarkAt: () => pointedMark.mark };
});

const ALICE = 'Novel/20_Character/Alice.md';
const BOB = 'Novel/20_Character/Bob.md';
const CHAPTER = 'Novel/50_Manuscript/Chapter 1.md';

const source = (label: string, memberPath: string): MentionSource => ({
	label,
	entry: 'name',
	memberPath,
	memberName: label,
	group: 'character',
	groupRank: 0,
	rank: 0,
	insert: `[[${memberPath.replace(/\.md$/u, '')}|${label}]]`,
});

function feedOf(over: Partial<NoteMentionFeed> = {}): NoteMentionFeed {
	return {
		matcher: buildEntityMatcher([source('Alice', ALICE), source('Bob', BOB)]),
		ignores: [],
		sensitive: buildSensitiveMatcher([]),
		highlights: compileCustomHighlightRules([]),
		dialogue: { styles: [], presentation: 'off' },
		readOnly: false,
		...over,
	};
}

const FRONTMATTER = '---\nsnowflake-document: draft\naliases: Alice\n---\n';

/**
 * One note's marks over its whole text: the body read as the mention index
 * reads it, the offsets handed back the text's own, the plugin's sections
 * and the note itself never marked, and the dress under the stream's mode.
 */
describe('planNoteMentions', () => {
	const textOf = (marks: readonly MentionMark[], text: string): string[] =>
		marks.map((mark) => text.slice(mark.from, mark.to));

	it('reads the body below the frontmatter, in the text’s own offsets', () => {
		const text = `${FRONTMATTER}Alice met Bob. Alice left.\n`;
		const dress = planNoteMentions(CHAPTER, text, feedOf(), 'all', 'draft');
		expect(textOf(dress.marks, text)).toEqual(['Alice', 'Bob', 'Alice']);
		// The alias in the frontmatter is no prose.
		expect(dress.marks.every((mark) => mark.from >= FRONTMATTER.length)).toBe(true);
		// The occurrences ride along, in the same offsets, for an ignore's ordinal.
		expect(dress.occurrences.map((entry) => text.slice(entry.from, entry.to))).toEqual([
			'Alice',
			'Bob',
			'Alice',
		]);
		expect(dress.marks[0]?.occurrence).toMatchObject({ from: FRONTMATTER.length });
	});

	it('leaves out the sections the plugin writes, and the note itself', () => {
		const text = [
			'---',
			'snowflake-document: character',
			'---',
			'# Alice',
			'',
			'<!-- snowflake:section:character-fields:start -->',
			'',
			'> [!info] Character overview',
			'> **Friend**: Bob',
			'',
			'<!-- snowflake:section:character-fields:end -->',
			'',
			'Alice trusts Bob.',
		].join('\n');
		const dress = planNoteMentions(ALICE, text, feedOf(), 'all', 'character');
		// Bob once, in the author's prose; never Alice on her own page.
		expect(textOf(dress.marks, text)).toEqual(['Bob']);
		expect(dress.marks[0]?.from).toBe(text.lastIndexOf('Bob'));
	});

	it('marks as the stream’s mode says, and the dress beside it', () => {
		const text = 'Alice said, “Bob, the storm.” Alice ran.';
		const feed = feedOf({
			sensitive: buildSensitiveMatcher(['storm']),
			dialogue: { styles: [{ open: '“', close: '”' }], presentation: 'highlight' },
		});
		const first = planNoteMentions(CHAPTER, text, feed, 'first', null);
		expect(textOf(first.marks, text)).toEqual(['Alice', 'Bob', 'storm']);
		const off = planNoteMentions(CHAPTER, text, feed, 'off', null);
		expect(textOf(off.marks, text)).toEqual(['storm']);
		expect(off.occurrences).toEqual([]);
		// The quoted stretch, a layer of its own.
		expect(textOf(off.dialogue, text)).toEqual(['“Bob, the storm.”']);
		const quiet = planNoteMentions(
			CHAPTER,
			text,
			{ ...feed, dialogue: { ...feed.dialogue, presentation: 'off' } },
			'off',
			null,
		);
		expect(quiet.dialogue).toEqual([]);
	});
});

/**
 * The marks on the notes of Obsidian's own tabs, over plain elements: worn
 * once the project's feed answers, the dialogue's look on the leaf, the
 * reading view's sections wrapped as the app draws them and answering the
 * stream's menu, and the editor's right-click leading the app's menu.
 */
describe('NoteMentions', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		shown.menus.length = 0;
		shown.notices.length = 0;
		pointedMark.mark = null;
	});

	interface FakeNote extends MentionNote {
		reading: HTMLElement;
		sizer: HTMLElement;
		body: string;
		redrawn: number;
		view: EditorView | null;
	}

	function note(path: string | null, body = 'Alice met Bob.\n'): FakeNote {
		const containerEl = document.body.createDiv({ cls: 'workspace-leaf-content' });
		const reading = containerEl.createDiv({ cls: 'markdown-reading-view' });
		const sizer = reading.createDiv({ cls: 'markdown-preview-sizer markdown-preview-section' });
		const fake: FakeNote = {
			path,
			containerEl,
			reading,
			sizer,
			body,
			redrawn: 0,
			view: null,
			text: () => fake.body,
			editor: () => fake.view,
			rerender: () => {
				fake.redrawn += 1;
			},
		};
		return fake;
	}

	function harness(notes: FakeNote[], feed: () => NoteMentionFeed | null = () => feedOf()) {
		const calls: string[] = [];
		let mode: MentionHighlightMode = 'all';
		let reached = (path: string): string | null => (path.startsWith('Novel/') ? 'Novel' : null);
		let replaced = true;
		const mentions = new NoteMentions({
			projectOf: (path) => reached(path),
			feed: () => Promise.resolve(feed()),
			mode: () => mode,
			documentType: () => null,
			notes: () => notes,
			t: () => (key) => key,
			openMember: (memberPath) => {
				calls.push(`open:${memberPath}`);
				return Promise.resolve();
			},
			addIgnore: (projectPath, rule) => {
				calls.push(`ignore:${projectPath}:${rule.scope}:${rule.matchedText}`);
				return Promise.resolve();
			},
			replaceInFile: (path, from, to, expected, insert) => {
				calls.push(`replace:${path}:${String(from)}-${String(to)}:${expected}>${insert}`);
				return Promise.resolve(replaced);
			},
			showError: (error) => {
				calls.push(`error:${String(error)}`);
			},
		});
		return {
			mentions,
			calls,
			setMode: (next: MentionHighlightMode) => {
				mode = next;
			},
			reach: (rule: (path: string) => string | null) => {
				reached = rule;
			},
			refuseReplace: () => {
				replaced = false;
			},
		};
	}

	/** Lets every answer already given land. */
	const settle = async (): Promise<void> => {
		for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
	};

	/** One section of a note's reading view, as the app hands it to a post-processor. */
	function section(
		one: FakeNote,
		text: string,
		line: number,
		over: { sourcePath?: string; containerEl?: HTMLElement; noText?: boolean } = {},
	): { el: HTMLElement; ctx: MarkdownPostProcessorContext } {
		const el = one.sizer.createDiv({ cls: 'el-p' });
		el.createEl('p', { text: text.split('\n')[line] ?? '' });
		const ctx = {
			sourcePath: over.sourcePath ?? one.path ?? '',
			containerEl: over.containerEl ?? one.sizer,
			getSectionInfo: () => ({ text: over.noText === true ? '' : text, lineStart: line, lineEnd: line }),
		} as unknown as MarkdownPostProcessorContext;
		return { el, ctx };
	}

	it('wears its marks once the project’s feed answers, and draws its note again then', async () => {
		const chapter = note(CHAPTER);
		const { mentions } = harness([chapter]);
		// Asked before the feed has answered: nothing yet, and the feed asked for.
		expect(mentions.editorMarks(CHAPTER, chapter.body)).toEqual([]);
		await settle();
		expect(chapter.redrawn).toBe(1);
		expect(mentions.editorMarks(CHAPTER, chapter.body).map((mark) => mark.occurrence.matchedText)).toEqual([
			'Alice',
			'Bob',
		]);
		// A note of no project wears nothing, however often it asks.
		expect(mentions.editorMarks('Loose/Idea.md', 'Alice met Bob.')).toEqual([]);
	});

	it('marks the note’s editor with the stream’s own decorations', async () => {
		const chapter = note(CHAPTER);
		const { mentions } = harness([chapter]);
		chapter.view = new EditorView({
			state: EditorState.create({
				doc: chapter.body,
				extensions: [mentionHighlights({ marks: (body) => mentions.editorMarks(CHAPTER, body) })],
			}),
			parent: chapter.containerEl,
		});
		expect(chapter.view.dom.querySelectorAll('.snowflake-method-mention')).toHaveLength(0);
		await settle();
		// The feed's answer asks the editor again, at once.
		const marked = Array.from(chapter.view.dom.querySelectorAll('.snowflake-method-mention'));
		expect(marked.map((el) => el.textContent)).toEqual(['Alice', 'Bob']);
		chapter.view.destroy();
	});

	it('gives the dialogue’s look to a project’s note alone, and takes it off again', async () => {
		const chapter = note(CHAPTER);
		const loose = note('Loose/Idea.md');
		const feed = feedOf({ dialogue: { styles: [{ open: '“', close: '”' }], presentation: 'focus' } });
		const { mentions, reach } = harness([chapter, loose], () => feed);
		mentions.apply();
		await settle();
		expect(chapter.containerEl.classList.contains('snowflake-method-dialogue-focus')).toBe(true);
		expect(loose.containerEl.classList.contains('snowflake-method-dialogue-focus')).toBe(false);
		// The dress stops reaching the chapter: its look goes, and its pages are drawn again bare.
		const drawn = chapter.redrawn;
		reach(() => null);
		mentions.apply();
		expect(chapter.containerEl.classList.contains('snowflake-method-dialogue-focus')).toBe(false);
		expect(chapter.redrawn).toBe(drawn + 1);
		expect(mentions.editorMarks(CHAPTER, chapter.body)).toEqual([]);
	});

	it('leaves the pages alone when a feed answers as before, and draws them again when it moved', async () => {
		const chapter = note(CHAPTER);
		let feed = feedOf();
		const { mentions, setMode } = harness([chapter], () => feed);
		mentions.apply();
		await settle();
		const drawn = chapter.redrawn;
		mentions.refresh();
		await settle();
		expect(chapter.redrawn).toBe(drawn);
		// An ignore written: the feed moved.
		feed = feedOf({ ignores: [{ scope: 'manuscript', memberPath: BOB, matchedText: 'Bob' }] });
		mentions.refresh();
		await settle();
		expect(chapter.redrawn).toBe(drawn + 1);
		expect(mentions.editorMarks(CHAPTER, chapter.body).map((mark) => mark.occurrence.matchedText)).toEqual([
			'Alice',
		]);
		// The mode turned: every page drawn again under it.
		setMode('off');
		mentions.refresh();
		await settle();
		expect(chapter.redrawn).toBe(drawn + 2);
		expect(mentions.editorMarks(CHAPTER, chapter.body)).toEqual([]);
	});

	it('dresses a section of the tab’s own note, and answers a click with the stream’s menu', async () => {
		const text = `${FRONTMATTER}Alice met Bob.\n`;
		const chapter = note(CHAPTER, text);
		const { mentions, calls } = harness([chapter]);
		mentions.apply();
		await settle();
		const { el, ctx } = section(chapter, text, 4);
		mentions.dressSection(el, ctx);
		const spans = Array.from(el.querySelectorAll<HTMLElement>('.snowflake-method-mention'));
		expect(spans.map((span) => span.textContent)).toEqual(['Alice', 'Bob']);
		// A click on a mention not yet linked asks what to do about it.
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		spans[0]?.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		const items = shown.menus[0] ?? [];
		expect(items.map((item) => item.title)).toEqual([
			'manuscript.mention.convert',
			'manuscript.mention.open',
			'manuscript.mention.ignoreOccurrence',
			'manuscript.mention.ignoreNote',
			'manuscript.mention.ignoreManuscript',
		]);
		// Converted in the file, at the text's own offsets.
		items[0]?.click?.();
		await settle();
		const from = FRONTMATTER.length;
		expect(calls).toContain(`replace:${CHAPTER}:${String(from)}-${String(from + 5)}:Alice>[[Novel/20_Character/Alice|Alice]]`);
		items[1]?.click?.();
		items[3]?.click?.();
		await settle();
		expect(calls).toContain(`open:${ALICE}`);
		expect(calls).toContain('ignore:Novel:note:Alice');
		// A right-click asks the same.
		spans[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		expect(shown.menus).toHaveLength(2);
		// On a phone a finger held on the word while the system's selection
		// still moves is the selection's own, and asks nothing.
		Platform.isMobile = true;
		try {
			const range = document.createRange();
			range.selectNodeContents(spans[1] as Node);
			document.getSelection()?.removeAllRanges();
			document.getSelection()?.addRange(range);
			noteSelectionMoved(document);
			const held = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
			spans[1]?.dispatchEvent(held);
			expect(held.defaultPrevented).toBe(false);
			expect(shown.menus).toHaveLength(2);
		} finally {
			Platform.isMobile = false;
			document.getSelection()?.removeAllRanges();
		}
	});

	it('says so when the text moved before a conversion reached the file', async () => {
		const chapter = note(CHAPTER);
		const { mentions, refuseReplace } = harness([chapter]);
		mentions.apply();
		await settle();
		refuseReplace();
		const { el, ctx } = section(chapter, chapter.body, 0);
		mentions.dressSection(el, ctx);
		el.querySelector<HTMLElement>('.snowflake-method-mention')?.click();
		shown.menus[0]?.[0]?.click?.();
		await settle();
		expect(shown.notices).toEqual(['manuscript.mention.stale']);
	});

	it('offers no conversion in a project that cannot be written', async () => {
		const chapter = note(CHAPTER);
		const { mentions } = harness([chapter], () => feedOf({ readOnly: true }));
		mentions.apply();
		await settle();
		const { el, ctx } = section(chapter, chapter.body, 0);
		mentions.dressSection(el, ctx);
		el.querySelector<HTMLElement>('.snowflake-method-mention')?.click();
		expect(shown.menus[0]?.map((item) => item.title)).not.toContain('manuscript.mention.convert');
	});

	it('draws a section of a view drawn again whole from the view’s own text', async () => {
		const chapter = note(CHAPTER, 'Bob waits.\n');
		const { mentions } = harness([chapter]);
		mentions.apply();
		await settle();
		const { el, ctx } = section(chapter, chapter.body, 0, { noText: true });
		mentions.dressSection(el, ctx);
		expect(Array.from(el.querySelectorAll('.snowflake-method-mention')).map((span) => span.textContent)).toEqual([
			'Bob',
		]);
	});

	it('passes over a note embedded in another, a popover, and another tab’s note', async () => {
		const chapter = note(CHAPTER);
		const { mentions } = harness([chapter]);
		mentions.apply();
		await settle();
		const embed = chapter.sizer.createDiv({ cls: 'internal-embed markdown-embed' });
		const embedded = section(chapter, chapter.body, 0, { containerEl: embed });
		mentions.dressSection(embedded.el, embedded.ctx);
		expect(embedded.el.querySelector('.snowflake-method-mention')).toBeNull();
		const popover = document.body.createDiv({ cls: 'hover-popover' }).createDiv({ cls: 'markdown-reading-view' });
		const floating = section(chapter, chapter.body, 0, { containerEl: popover });
		mentions.dressSection(floating.el, floating.ctx);
		expect(floating.el.querySelector('.snowflake-method-mention')).toBeNull();
		const other = section(chapter, chapter.body, 0, { sourcePath: 'Novel/50_Manuscript/Chapter 2.md' });
		mentions.dressSection(other.el, other.ctx);
		expect(other.el.querySelector('.snowflake-method-mention')).toBeNull();
	});

	it('leads the editor’s menu with the mention under the right-click', async () => {
		const chapter = note(CHAPTER);
		const { mentions } = harness([chapter]);
		chapter.view = new EditorView({
			state: EditorState.create({ doc: chapter.body }),
			parent: chapter.containerEl,
		});
		mentions.apply();
		await settle();
		const view = chapter.view;
		const [alice] = mentions.editorMarks(CHAPTER, chapter.body);
		const menu = new (await import('obsidian')).Menu();
		const headed: string[] = [];
		// No right-click heard: nothing to add, and no heading put up.
		expect(mentions.addEditorMenuItems(menu, view, CHAPTER, 'snowflake-method', () => headed.push('head'))).toBe(false);
		pointedMark.mark = alice ?? null;
		mentions.pointAt(view, new MouseEvent('contextmenu', { clientX: 4, clientY: 4 }));
		expect(mentions.addEditorMenuItems(menu, view, CHAPTER, 'snowflake-method', () => headed.push('head'))).toBe(true);
		expect(headed).toEqual(['head']);
		const items = (menu as unknown as { items: ShownItem[] }).items;
		expect(items.map((item) => item.section)).toEqual(items.map(() => 'snowflake-method'));
		expect(items[0]?.title).toBe('manuscript.mention.convert');
		// Converted in the editor as the author's own edit.
		items[0]?.click?.();
		expect(view.state.doc.toString()).toBe('[[Novel/20_Character/Alice|Alice]] met Bob.\n');
		// A click heard once is spent: the next menu, without a click, adds nothing.
		expect(mentions.addEditorMenuItems(menu, view, CHAPTER, 'snowflake-method', () => headed.push('head'))).toBe(false);
		view.destroy();
	});

	it('takes every look back off, and draws its notes again, when the plugin goes away', async () => {
		const chapter = note(CHAPTER);
		const feed = feedOf({ dialogue: { styles: [{ open: '“', close: '”' }], presentation: 'highlight' } });
		const { mentions } = harness([chapter], () => feed);
		mentions.apply();
		await settle();
		expect(chapter.containerEl.classList.contains('snowflake-method-dialogue-highlight')).toBe(true);
		const drawn = chapter.redrawn;
		mentions.destroy();
		expect(chapter.containerEl.classList.contains('snowflake-method-dialogue-highlight')).toBe(false);
		expect(chapter.redrawn).toBe(drawn + 1);
		// A section drawn after that is left as the app drew it.
		const { el, ctx } = section(chapter, chapter.body, 0);
		mentions.dressSection(el, ctx);
		expect(el.querySelector('.snowflake-method-mention')).toBeNull();
	});
});
