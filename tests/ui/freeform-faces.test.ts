import { afterEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

const { renders, icons } = vi.hoisted(() => ({
	/** Every drawing asked for, with the way to end it: a test says when the words are drawn, and whether they could be. */
	renders: [] as { words: string; box: unknown; sourcePath: string; component: unknown; done: () => void; fail: (error: unknown) => void }[],
	icons: [] as { icon: string }[],
}));

// A panel hangs by the window's own measures, which the plain surface has none of: here it is simply laid in the surface.
vi.mock('../../src/ui/anchored-panel', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../../src/ui/anchored-panel')>();
	return {
		...runtime,
		hangPanel: (anchor: HTMLElement, spec: Parameters<typeof runtime.hangPanel>[1]) => {
			const el = (anchor as unknown as CorkboardElement).dom.container.createDiv({ cls: spec.cls, attr: { role: 'dialog' } });
			spec.build(el as unknown as HTMLElement);
			return { el, release: vi.fn() };
		},
	};
});

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Keymap: {
			isModifier: (event: { metaKey?: boolean }, modifier: string) => modifier === 'Mod' && event.metaKey === true,
			isModEvent: (event: { metaKey?: boolean }) => (event.metaKey === true ? 'tab' : false),
		},
		setIcon: (_element: unknown, icon: string) => { icons.push({ icon }); },
		Component: class {
			readonly children = new Set<unknown>();
			addChild(child: unknown): void { this.children.add(child); }
			removeChild(child: unknown): void { this.children.delete(child); }
		},
		MarkdownRenderer: {
			render: (_app: unknown, words: string, box: CorkboardElement, sourcePath: string, component: unknown): Promise<void> =>
				new Promise<void>((resolve, reject) => {
					renders.push({
						words, box, sourcePath, component,
						done: () => {
							box.setText(words);
							resolve();
						},
						fail: reject,
					});
				}),
		},
	};
});

import { Component, type App } from 'obsidian';

import type { DateFormat, FreeformFrame, FreeformPlacement } from '../../src/domain';
import { CANVAS_FAR_KIND, CANVAS_FRAME_KIND, type PaintContext } from '../../src/ui/freeform-canvas-port';
import { createFreeformFaces, type CardNode, type FreeformFaceDeps } from '../../src/ui/freeform-faces';
import type { ResolvedNode } from '../../src/ui/freeform-resources';
import type { Task } from '../../src/domain';
import type { StickyNoteRecord } from '../../src/services';
import type { FreeformFileReading } from '../../src/ui/freeform-resources';
import type { ForeshadowingTableItem } from '../../src/ui/foreshadowing-rows';
import type { RevisionRow } from '../../src/ui/revision-panel';
import type { SceneCard } from '../../src/ui/scene-card';
import type { CharacterViewModel, SceneViewModel, WorldbuildingEntityViewModel } from '../../src/ui/view-model';

async function settle(): Promise<void> {
	for (let at = 0; at < 20; at++) await Promise.resolve();
}

/** Calls an element's own listeners with the properties an event carries. */
function fire(element: CorkboardElement, type: string, properties: Record<string, unknown> = {}): { stopped: number; prevented: number } {
	const told = { stopped: 0, prevented: 0 };
	for (const listener of element.listeners.get(type) ?? []) {
		listener({
			target: element,
			preventDefault: () => { told.prevented += 1; },
			stopPropagation: () => { told.stopped += 1; },
			...properties,
		});
	}
	return told;
}

const placement = (id: string, extra: Partial<FreeformPlacement> = {}): FreeformPlacement => ({
	id,
	resource: { type: 'text', text: '' },
	x: 0,
	y: 0,
	width: 200,
	height: 160,
	displayMode: 'auto',
	zIndex: 0,
	frameId: null,
	...extra,
});

const textNode = (id: string, words: string, extra: Partial<FreeformPlacement> = {}): ResolvedNode => ({
	type: 'text', placement: placement(id, extra), text: words,
});

const context = (extra: Partial<PaintContext> = {}): PaintContext => ({
	selected: false, readOnly: false, band: 'extended', width: 200, height: 160, ...extra,
});

function faces(extra: Partial<FreeformFaceDeps> = {}) {
	const dom = new CorkboardDom();
	const nodes = new Map<string, ResolvedNode>();
	const frames = new Map<string, FreeformFrame>();
	const component = new Component();
	let editing: string | null = null;
	let today = '2026-09-30';
	/** A plain deck in the corkboard's place: it keeps what cards it dealt and what was asked of each. */
	const dealt = new Map<string, { el: CorkboardElement; scene: SceneViewModel; index: number; dressed: number; settled: number; retired: number }>();
	const scenes: FreeformFaceDeps['scenes'] = {
		mount: vi.fn((parent: HTMLElement, key: string, scene: SceneViewModel, index: number) => {
			const el = (parent as unknown as CorkboardElement).createDiv({ cls: 'snowflake-method-corkboard-card' });
			el.setAttribute('data-key', key);
			dealt.set(key, { el, scene, index, dressed: 0, settled: 0, retired: 0 });
			return { key, id: scene.id, el, scene, index } as unknown as SceneCard;
		}),
		dress: vi.fn((card: SceneCard, scene: SceneViewModel, index: number) => {
			const held = dealt.get(card.key)!;
			held.scene = scene;
			held.index = index;
			held.dressed += 1;
		}),
		settle: vi.fn((key: string) => { dealt.get(key)!.settled += 1; }),
		retire: vi.fn((key: string) => {
			const held = dealt.get(key)!;
			held.retired += 1;
			held.el.remove();
		}),
	};
	const deps = {
		app: {
			workspace: { openLinkText: vi.fn(() => Promise.resolve()) },
			// The vault holds the one picture, and serves it by its path.
			vault: {
				getFileByPath: (path: string) => (path === 'Novel/Material/map.png' ? { path } : null),
				getResourcePath: (file: { path: string }) => `app://vault/${file.path}`,
			},
		} as unknown as App,
		t: (key: string) => key,
		component,
		sourcePath: () => 'Novel',
		node: (id: string) => nodes.get(id),
		frame: (id: string) => frames.get(id),
		icon: vi.fn((node: ResolvedNode) => `icon-${node.type}`),
		label: vi.fn((node: ResolvedNode) => `called ${node.placement.id}`),
		frameLabel: (frame: FreeformFrame) => (frame.title.length > 0 ? frame.title : 'untitled'),
		editing: () => editing,
		textLimit: () => 500,
		menu: vi.fn(),
		keepText: vi.fn(),
		leaveText: vi.fn(),
		openOccurrence: vi.fn(),
		today: () => today,
		dateFormat: (): DateFormat => 'YYYY-MM-DD',
		locale: () => 'en',
		kindWord: vi.fn((node: CardNode) => `kind of ${node.placement.id}`),
		setColor: vi.fn(),
		setStatus: vi.fn(),
		setFrameColor: vi.fn(),
		scenes,
		...extra,
	} satisfies FreeformFaceDeps;
	const made = createFreeformFaces(deps);
	const mount = (kind: string, id: string, at: PaintContext = context()) => {
		const body = dom.container.createDiv();
		const painted = made.painter(kind).mount(body as unknown as HTMLElement, id, at);
		return { body, painted, face: body.children[0]! };
	};
	return {
		dom, deps, made, nodes, frames, mount, dealt,
		children: (component as unknown as { children: Set<unknown> }).children,
		edit: (id: string | null) => { editing = id; },
		setToday: (day: string) => { today = day; },
	};
}

afterEach(() => {
	renders.length = 0;
	icons.length = 0;
	vi.restoreAllMocks();
});

describe('the painters', () => {
	it('dresses each kind of node by a painter of its own, and the two kinds that wear one card by the same', () => {
		const { made } = faces();
		const text = made.painter('text');
		const scene = made.painter('scene');
		const card = made.painter('character');
		const task = made.painter('task');
		const thread = made.painter('foreshadowing');
		const revision = made.painter('revision');
		const missing = made.painter('missing');
		const frame = made.painter(CANVAS_FRAME_KIND);
		const sticky = made.painter('sticky-note');
		const file = made.painter('file');
		const link = made.painter('link');
		const plain = made.painter('pending');
		const far = made.painter(CANVAS_FAR_KIND);
		expect(new Set([text, scene, card, task, thread, revision, sticky, file, link, missing, frame, plain, far]).size).toBe(13);
		expect(made.painter('worldbuilding')).toBe(card);
		// The same painter every time it is asked for, so the engine raises a face once.
		expect(made.painter('text')).toBe(text);
		expect(made.painter('scene')).toBe(scene);
	});

	it('opens nothing and keeps nothing where no text node stands', () => {
		const { made } = faces();
		expect(made.edit('nowhere')).toBe(false);
		expect(made.keepFocused()).toBe(false);
	});
});

describe('a text node’s face', () => {
	it('draws its words as a note’s are, in a box and under a component of their own', async () => {
		const { nodes, mount, children } = faces();
		nodes.set('t1', textNode('t1', '# Heading'));
		const { face } = mount('text', 't1');
		expect(face.classes.has('is-text')).toBe(true);
		expect(renders).toHaveLength(1);
		expect(renders[0]).toMatchObject({ words: '# Heading', sourcePath: 'Novel' });
		const shown = face.querySelector('.snowflake-method-freeform-text')!;
		expect(shown.children).toEqual([renders[0]!.box]);
		expect((renders[0]!.box as CorkboardElement).classes.has('markdown-rendered')).toBe(true);
		expect(children.has(renders[0]!.component)).toBe(true);
		renders[0]!.done();
		await settle();
		expect(shown.children[0]!.textContent).toBe('# Heading');
	});

	it('draws nothing for a node that holds no word', () => {
		const { nodes, mount, children } = faces();
		nodes.set('t1', textNode('t1', '  \n'));
		const { face } = mount('text', 't1');
		expect(renders).toHaveLength(0);
		expect(children.size).toBe(0);
		expect(face.classes.has('is-blank')).toBe(true);
	});

	it('draws its words again only when they are other words, and lets the last drawing go', () => {
		const { nodes, mount, children } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face, painted } = mount('text', 't1');
		painted.dress(context({ selected: true }));
		painted.dress(context({ width: 400, height: 300 }));
		expect(renders).toHaveLength(1);
		nodes.set('t1', textNode('t1', 'Two'));
		painted.dress(context());
		expect(renders.map((render) => render.words)).toEqual(['One', 'Two']);
		expect(children.has(renders[0]!.component)).toBe(false);
		expect(children.has(renders[1]!.component)).toBe(true);
		// The box the first was drawn in has been taken out, so a drawing that ends late adds nothing.
		const shown = face.querySelector('.snowflake-method-freeform-text')!;
		renders[0]!.done();
		expect(shown.children).toEqual([renders[1]!.box]);
	});

	it('has one face, however near the canvas is looked at and whatever its author chose, and says when it is chosen', () => {
		const { nodes, mount } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face, painted } = mount('text', 't1', context({ band: 'standard' }));
		expect(face.dataset.mode).toBe('compact');
		expect(face.classes.has('is-selected')).toBe(false);
		painted.dress(context({ band: 'far', selected: true }));
		expect(face.dataset.mode).toBe('compact');
		expect(face.classes.has('is-selected')).toBe(true);
		nodes.set('t1', textNode('t1', 'One', { displayMode: 'extended' }));
		painted.dress(context({ band: 'extended' }));
		expect(face.dataset.mode).toBe('compact');
	});

	it('stands its symbol at the first line’s start and the way to its menu at its end, with the words between them', () => {
		const { nodes, mount } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face } = mount('text', 't1');
		expect(partsOf(face, { 'snowflake-method-freeform-face-icon': 'symbol', 'snowflake-method-freeform-text': 'words', 'snowflake-method-freeform-node-more': 'more' })).toEqual(['symbol', 'words', 'more']);
		expect(icons.map((entry) => entry.icon)).toEqual(['ellipsis', 'icon-text']);
	});

	it('opens for typing with its words in the field, the field named and holding the focus', () => {
		const { dom, nodes, made, mount } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face } = mount('text', 't1');
		expect(made.edit('t1')).toBe(true);
		const field = face.querySelector('textarea')!;
		expect(field.value).toBe('One');
		expect(field.getAttribute('aria-label')).toBe('freeformCanvas.text.label');
		expect(field.getAttribute('placeholder')).toBe('freeformCanvas.text.placeholder');
		expect(field.getAttribute('maxlength')).toBe('500');
		// The engine reads a press on the field as the field's own, by these classes.
		for (const cls of ['nodrag', 'nopan', 'nowheel']) expect(field.classes.has(cls), cls).toBe(true);
		expect(face.classes.has('is-editing')).toBe(true);
		expect(dom.doc.activeElement).toBe(field);
		// Asked again, it is the same field.
		expect(made.edit('t1')).toBe(true);
		expect(face.querySelectorAll('textarea')).toHaveLength(1);
	});

	it('opens as it is raised when the workspace says it is the node being typed into', () => {
		const { nodes, mount, edit } = faces();
		nodes.set('t1', textNode('t1', ''));
		edit('t1');
		const { face } = mount('text', 't1');
		expect(face.querySelector('textarea')).not.toBeNull();
	});

	it('opens nothing in a project that cannot be written, nor on a node that is no text', () => {
		const { nodes, made, mount } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face } = mount('text', 't1', context({ readOnly: true }));
		expect(made.edit('t1')).toBe(false);
		expect(face.querySelector('textarea')).toBeNull();
		nodes.set('t2', { type: 'link', placement: placement('t2'), url: 'https://example.com', label: '', host: 'example.com' });
		mount('text', 't2');
		expect(made.edit('t2')).toBe(false);
	});

	it('keeps what was typed once it is drawn, measured by the drawn words and the room about them', async () => {
		const { dom, nodes, made, mount, deps } = faces();
		Object.assign(dom.win, {
			getComputedStyle: () => ({ paddingTop: '12px', paddingBottom: '10px' }),
		});
		nodes.set('t1', textNode('t1', 'One'));
		const { face } = mount('text', 't1');
		face.offsetHeight = 158;
		made.edit('t1');
		const field = face.querySelector('textarea')!;
		field.value = 'One, and more';
		dom.height = 300;
		fire(field, 'blur');
		// The field has gone, and the words wait for their drawing.
		expect(face.querySelector('textarea')).toBeNull();
		expect(face.classes.has('is-editing')).toBe(false);
		expect(deps.keepText).not.toHaveBeenCalled();
		expect(renders[renders.length - 1]!.words).toBe('One, and more');
		dom.height = 420;
		renders[renders.length - 1]!.done();
		await settle();
		// The drawn words' height, the face's padding, and the node's own edge.
		expect(deps.keepText).toHaveBeenCalledExactlyOnceWith('t1', 'One, and more', 420 + 22 + 2);
	});

	it('keeps what was typed at once as the canvas goes, by the field’s own measure', () => {
		const { dom, nodes, made, mount, deps } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face, painted } = mount('text', 't1');
		made.edit('t1');
		face.querySelector('textarea')!.value = 'Kept in time';
		dom.height = 260;
		const drawn = renders.length;
		painted.settle();
		expect(deps.keepText).toHaveBeenCalledExactlyOnceWith('t1', 'Kept in time', 260);
		expect(renders).toHaveLength(drawn);
		// Settled again, there is nothing left to keep.
		painted.settle();
		expect(deps.keepText).toHaveBeenCalledOnce();
	});

	it('hands words over when their drawing fails, by the field’s own measure', async () => {
		const { dom, nodes, made, mount, deps } = faces();
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		nodes.set('t1', textNode('t1', 'One'));
		const { face } = mount('text', 't1');
		made.edit('t1');
		const field = face.querySelector('textarea')!;
		field.value = 'Words';
		dom.height = 280;
		fire(field, 'keydown', { key: 'Enter', metaKey: true });
		renders[renders.length - 1]!.fail(new Error('no renderer'));
		await settle();
		expect(deps.keepText).toHaveBeenCalledExactlyOnceWith('t1', 'Words', 280);
		expect(logged).toHaveBeenCalled();
	});

	it('hands over words still waiting for their drawing as the canvas goes, and once only', async () => {
		const { nodes, made, mount, deps } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face, painted } = mount('text', 't1');
		made.edit('t1');
		const field = face.querySelector('textarea')!;
		field.value = 'On their way';
		fire(field, 'blur');
		expect(deps.keepText).not.toHaveBeenCalled();
		painted.settle();
		expect(deps.keepText).toHaveBeenCalledOnce();
		renders[renders.length - 1]!.done();
		await settle();
		expect(deps.keepText).toHaveBeenCalledOnce();
	});

	it('goes on from words on their way when it is opened again before they are drawn', async () => {
		const { nodes, made, mount, deps } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face } = mount('text', 't1');
		made.edit('t1');
		const field = face.querySelector('textarea')!;
		field.value = 'Half';
		fire(field, 'blur');
		expect(made.edit('t1')).toBe(true);
		const again = face.querySelector('textarea')!;
		expect(again.value).toBe('Half');
		renders[renders.length - 1]!.done();
		await settle();
		// The words are in the field again, so they are not handed over behind its back.
		expect(deps.keepText).not.toHaveBeenCalled();
		again.value = 'Half, then whole';
		fire(again, 'blur');
		renders[renders.length - 1]!.done();
		await settle();
		expect(deps.keepText).toHaveBeenCalledOnce();
		expect(vi.mocked(deps.keepText).mock.calls[0]!.slice(0, 2)).toEqual(['t1', 'Half, then whole']);
	});

	it('draws nothing over what is being typed, nor over words on their way', () => {
		const { nodes, made, mount } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face, painted } = mount('text', 't1');
		made.edit('t1');
		const field = face.querySelector('textarea')!;
		field.value = 'Mine';
		const drawn = renders.length;
		nodes.set('t1', textNode('t1', 'Theirs'));
		painted.dress(context());
		expect(renders).toHaveLength(drawn);
		expect(face.querySelector('textarea')).toBe(field);
		expect(field.value).toBe('Mine');
		fire(field, 'blur');
		// On their way, the words typed are what is drawn, and the file's are not drawn over them.
		painted.dress(context());
		expect(renders.slice(drawn).map((render) => render.words)).toEqual(['Mine']);
	});

	it('leaves the node as it was on Escape, and keeps nothing as the field goes', () => {
		const { nodes, made, mount, deps } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face } = mount('text', 't1');
		made.edit('t1');
		const field = face.querySelector('textarea')!;
		field.value = 'Thrown away';
		const told = fire(field, 'keydown', { key: 'Escape' });
		// The key is the field's: it neither closes a dialog nor lets go of what is chosen.
		expect(told).toEqual({ stopped: 1, prevented: 1 });
		expect(deps.leaveText).toHaveBeenCalledExactlyOnceWith('t1');
		expect(face.querySelector('textarea')).toBeNull();
		// The field's going is a blur of its own, which keeps nothing.
		fire(field, 'blur');
		expect(deps.keepText).not.toHaveBeenCalled();
	});

	it('leaves the input method its keys, and a line its Enter', () => {
		const { nodes, made, mount, deps } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face } = mount('text', 't1');
		made.edit('t1');
		const field = face.querySelector('textarea')!;
		expect(fire(field, 'keydown', { key: 'Escape', isComposing: true })).toEqual({ stopped: 0, prevented: 0 });
		expect(fire(field, 'keydown', { key: 'Enter', metaKey: true, isComposing: true })).toEqual({ stopped: 0, prevented: 0 });
		expect(fire(field, 'keydown', { key: 'Enter' })).toEqual({ stopped: 0, prevented: 0 });
		expect(fire(field, 'keydown', { key: 'a' })).toEqual({ stopped: 0, prevented: 0 });
		expect(face.querySelector('textarea')).toBe(field);
		expect(deps.keepText).not.toHaveBeenCalled();
		expect(deps.leaveText).not.toHaveBeenCalled();
	});

	it('says whether it holds the focus, and keeps its words when it does', () => {
		const { dom, nodes, made, mount, deps } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		nodes.set('t2', textNode('t2', 'Two'));
		mount('text', 't1');
		const second = mount('text', 't2');
		made.edit('t2');
		second.face.querySelector('textarea')!.value = 'Two, kept';
		expect(made.keepFocused()).toBe(true);
		second.painted.settle();
		expect(vi.mocked(deps.keepText).mock.calls[0]!.slice(0, 2)).toEqual(['t2', 'Two, kept']);
		// Open, but the focus is elsewhere: the chord is not the node's.
		made.edit('t1');
		dom.container.createEl('button').focus();
		expect(made.keepFocused()).toBe(false);
	});

	it('keeps what is being typed when the project can no longer be written', () => {
		const { nodes, made, mount, deps } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face, painted } = mount('text', 't1');
		made.edit('t1');
		face.querySelector('textarea')!.value = 'Typed as it closed';
		painted.dress(context({ readOnly: true }));
		expect(face.querySelector('textarea')).toBeNull();
		expect(vi.mocked(deps.keepText).mock.calls[0]!.slice(0, 2)).toEqual(['t1', 'Typed as it closed']);
	});

	it('keeps its words and lets its drawing go as it is taken down, and is reached no more', () => {
		const { nodes, made, mount, deps, children } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { body, face, painted } = mount('text', 't1');
		made.edit('t1');
		face.querySelector('textarea')!.value = 'Kept on the way out';
		painted.unmount();
		expect(vi.mocked(deps.keepText).mock.calls[0]!.slice(0, 2)).toEqual(['t1', 'Kept on the way out']);
		expect(children.size).toBe(0);
		expect(body.children).toEqual([]);
		expect(made.edit('t1')).toBe(false);
	});

	it('leaves a face raised in its place standing when the one before it is taken down', () => {
		const { nodes, made, mount } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const first = mount('text', 't1');
		const second = mount('text', 't1');
		first.painted.unmount();
		expect(made.edit('t1')).toBe(true);
		expect(second.face.querySelector('textarea')).not.toBeNull();
	});

	it('opens a link into the vault itself, read from the project’s folder, and leaves any other link alone', () => {
		const { nodes, mount, deps } = faces();
		nodes.set('t1', textNode('t1', 'See [[Hero]]'));
		const { face } = mount('text', 't1');
		const shown = face.querySelector('.snowflake-method-freeform-text')!;
		const inner = shown.createEl('a', { cls: 'internal-link', attr: { 'data-href': 'Hero', href: 'Hero' } });
		const outer = shown.createEl('a', { cls: 'external-link', attr: { href: 'https://example.com' } });
		const open = vi.mocked((deps.app as unknown as { workspace: { openLinkText: () => Promise<void> } }).workspace.openLinkText);
		for (const listener of shown.listeners.get('click') ?? []) {
			listener({ target: outer, preventDefault: () => undefined, stopPropagation: () => undefined });
		}
		expect(open).not.toHaveBeenCalled();
		let prevented = 0;
		for (const listener of shown.listeners.get('click') ?? []) {
			listener({ target: inner, metaKey: true, preventDefault: () => { prevented += 1; }, stopPropagation: () => undefined } as never);
		}
		expect(prevented).toBe(1);
		expect(open).toHaveBeenCalledExactlyOnceWith('Hero', 'Novel', 'tab');
	});
});

describe('the way to a node’s menu', () => {
	it('stands on every face, named, and opens the node’s menu without choosing the node', () => {
		const { nodes, frames, mount, deps } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		nodes.set('s1', { type: 'pending', placement: placement('s1'), of: 'task' });
		nodes.set('c1', { type: 'character', placement: placement('c1'), character: characterModel() });
		nodes.set('k1', { type: 'task', placement: placement('k1'), task: taskModel });
		nodes.set('f2', { type: 'foreshadowing', placement: placement('f2'), item: threadModel });
		nodes.set('r1', { type: 'revision', placement: placement('r1'), row: revisionModel });
		nodes.set('n1', { type: 'sticky-note', placement: placement('n1'), note: noteModel });
		frames.set('f1', { id: 'f1', title: 'Act', color: null, x: 0, y: 0, width: 400, height: 300, zIndex: 0 });
		const faced = [
			['text', 't1'], ['pending', 's1'], ['character', 'c1'], ['task', 'k1'], ['foreshadowing', 'f2'], ['revision', 'r1'], ['sticky-note', 'n1'], [CANVAS_FRAME_KIND, 'f1'],
		] as const;
		for (const [kind, id] of faced) {
			const { face } = mount(kind, id);
			const more = face.querySelector('.snowflake-method-freeform-node-more')!;
			expect(more.tag, kind).toBe('button');
			expect(more.classes.has('clickable-icon'), kind).toBe(true);
			expect(more.getAttribute('aria-label'), kind).toBe('table.actions');
			expect(more.getAttribute('aria-haspopup'), kind).toBe('menu');
			expect(fire(more, 'click', { detail: 1 }).stopped, kind).toBe(1);
			const asked = vi.mocked(deps.menu).mock.calls;
			expect(asked[asked.length - 1]![0], kind).toBe(id);
			// Pressed twice, it opens no node.
			expect(fire(more, 'dblclick').stopped, kind).toBe(1);
		}
	});

	it('is made before what a one-line face says, so the words run round it and never under it', () => {
		const { nodes, mount } = faces();
		nodes.set('s1', { type: 'pending', placement: placement('s1'), of: 'task' });
		expect(mount('pending', 's1').face.children[0]!.classes.has('snowflake-method-freeform-node-more')).toBe(true);
	});
});

describe('a node’s face from far off', () => {
	it('shows the node’s symbol and its name alone, with no button, and follows the node as it changes', () => {
		const { nodes, deps, mount } = faces();
		nodes.set('t1', textNode('t1', 'First words\n\nand more'));
		const { face, painted } = mount(CANVAS_FAR_KIND, 't1', context({ band: 'far' }));
		expect(face.classes.has('is-far')).toBe(true);
		expect(face.querySelector('.snowflake-method-freeform-node-more')).toBeNull();
		expect(face.querySelector('.snowflake-method-freeform-face-name')?.textContent).toBe('called t1');
		expect(icons[icons.length - 1]).toMatchObject({ icon: 'icon-text' });
		expect(deps.icon).toHaveBeenCalledTimes(1);
		// Dressed again as the same, nothing is redrawn; as another, its symbol and its name follow.
		painted.dress(context({ band: 'far', selected: true }));
		expect(icons).toHaveLength(1);
		expect(face.classes.has('is-selected')).toBe(true);
		nodes.set('t1', { type: 'link', placement: textNode('t1', '').placement, url: 'https://a.example', label: 'A', host: 'a.example' });
		vi.mocked(deps.label).mockImplementation(() => 'renamed');
		painted.dress(context({ band: 'far' }));
		expect(icons[icons.length - 1]).toMatchObject({ icon: 'icon-link' });
		expect(face.querySelector('.snowflake-method-freeform-face-name')?.textContent).toBe('renamed');
		expect(face.classes.has('is-selected')).toBe(false);
		// A node that has gone leaves the face as it was; taken down, nothing is left.
		nodes.delete('t1');
		painted.dress(context({ band: 'far' }));
		expect(face.querySelector('.snowflake-method-freeform-face-name')?.textContent).toBe('renamed');
		painted.settle();
		painted.unmount();
		expect(face.parent).toBeNull();
	});
});

describe('a frame’s face', () => {
	it('shows its title at its head, and the word for one that has none', () => {
		const { frames, mount } = faces();
		frames.set('f1', { id: 'f1', title: 'Act one', color: 'macaron-2', x: 0, y: 0, width: 400, height: 300, zIndex: 0 });
		const { face, painted } = mount(CANVAS_FRAME_KIND, 'f1', context({ selected: true }));
		expect(face.classes.has('is-frame')).toBe(true);
		expect(face.classes.has('is-selected')).toBe(true);
		// Tinted from the sticky notes' own rules, by the same name.
		expect(face.classes.has('snowflake-method-sticky-tint')).toBe(true);
		expect(face.getAttribute('data-color')).toBe('macaron-2');
		const title = face.querySelector('.snowflake-method-freeform-frame-title')!;
		expect(title.textContent).toBe('Act one');
		expect(title.classes.has('is-untitled')).toBe(false);
		const written = title.textWrites;
		painted.dress(context());
		expect(title.textWrites).toBe(written);
		expect(face.classes.has('is-selected')).toBe(false);
		frames.set('f1', { id: 'f1', title: '  ', color: null, x: 0, y: 0, width: 400, height: 300, zIndex: 0 });
		painted.dress(context());
		expect(title.classes.has('is-untitled')).toBe(true);
		expect(face.getAttribute('data-color')).toBeNull();
		painted.settle();
		painted.unmount();
		expect(face.parent).toBeNull();
	});

	it('carries a palette before the way to its menu, which hangs the swatches a card’s does and gives the tint to the workspace to write', () => {
		const { frames, mount, deps, dom } = faces();
		frames.set('f1', { id: 'f1', title: 'Act one', color: 'macaron-2', x: 0, y: 0, width: 400, height: 300, zIndex: 0 });
		const { face, painted } = mount(CANVAS_FRAME_KIND, 'f1', context());
		const head = face.querySelector('.snowflake-method-freeform-frame-head')!;
		// Set after the menu's button, which stands at the end, so it takes the place before it.
		expect(head.children.map((child) => (child.classes.has('snowflake-method-freeform-frame-color') ? 'palette' : child.classes.has('snowflake-method-freeform-node-more') ? 'more' : 'title'))).toEqual(['more', 'palette', 'title']);
		const palette = face.querySelector('.snowflake-method-freeform-frame-color')!;
		expect(palette.getAttribute('aria-label')).toBe('corkboard.colorLabel');
		expect(palette.getAttribute('aria-haspopup')).toBe('dialog');
		expect(palette.disabled).toBe(false);
		const panelOf = () => dom.container.querySelector('.snowflake-method-corkboard-color-panel');
		expect(fire(palette, 'click').stopped).toBe(1);
		const swatches = panelOf()!.querySelector('.snowflake-method-sticky-swatches')!.querySelectorAll('.snowflake-method-sticky-swatch');
		expect(swatches.find((swatch) => swatch.classes.has('is-selected'))?.getAttribute('data-color')).toBe('macaron-2');
		swatches.find((swatch) => swatch.getAttribute('data-color') === 'macaron-6')!.dispatch('click');
		expect(deps.setFrameColor).toHaveBeenLastCalledWith('f1', 'macaron-6');
		expect(panelOf()).toBeNull();
		fire(palette, 'click');
		panelOf()!.querySelector('.snowflake-method-sticky-swatches')!.querySelectorAll('.snowflake-method-sticky-swatch')[0]!.dispatch('click');
		expect(deps.setFrameColor).toHaveBeenLastCalledWith('f1', null);
		// A press twice on the palette opens nothing of the frame's.
		expect(fire(palette, 'dblclick').stopped).toBe(1);
		// On a project that cannot be written the palette sleeps, and a panel hung from it goes.
		fire(palette, 'click');
		expect(panelOf()).not.toBeNull();
		painted.dress(context({ readOnly: true }));
		expect(palette.disabled).toBe(true);
		expect(panelOf()).toBeNull();
		painted.unmount();
	});
});

describe('the face of a kind that has none of its own yet', () => {
	it('shows the kind’s symbol and what the node is called, and draws neither again for nothing', () => {
		const { nodes, mount, deps } = faces();
		nodes.set('s1', { type: 'pending', placement: placement('s1', { displayMode: 'compact' }), of: 'task' });
		const { face, painted } = mount('pending', 's1');
		expect(face.classes.has('is-plain')).toBe(true);
		expect(face.dataset).toMatchObject({ type: 'pending', mode: 'compact' });
		const name = face.querySelector('.snowflake-method-freeform-face-name')!;
		expect(name.textContent).toBe('called s1');
		expect(face.querySelector('.snowflake-method-freeform-face-icon')!.getAttribute('aria-hidden')).toBe('true');
		// The way to the menu wears a symbol of its own, drawn once.
		expect(icons.map((entry) => entry.icon)).toEqual(['ellipsis', 'icon-pending']);
		const written = name.textWrites;
		painted.dress(context({ selected: true }));
		expect(icons).toHaveLength(2);
		expect(name.textWrites).toBe(written);
		expect(face.classes.has('is-selected')).toBe(true);
		vi.mocked(deps.icon).mockReturnValue('another');
		vi.mocked(deps.label).mockReturnValue('Found');
		painted.dress(context());
		expect(icons.map((entry) => entry.icon)).toEqual(['ellipsis', 'icon-pending', 'another']);
		expect(name.textContent).toBe('Found');
		painted.settle();
		painted.unmount();
		expect(face.parent).toBeNull();
	});

	it('leaves a face standing as it is when its node has gone from the view', () => {
		const { nodes, mount } = faces();
		nodes.set('s1', { type: 'pending', placement: placement('s1'), of: 'task' });
		const { face, painted } = mount('pending', 's1');
		nodes.delete('s1');
		expect(() => { painted.dress(context()); }).not.toThrow();
		expect(face.querySelector('.snowflake-method-freeform-face-name')!.textContent).toBe('called s1');
	});
});

const sceneModel = (id: string, title: string, revision = 'r1'): SceneViewModel => ({
	id, path: `Scenes/${title}.md`, title, rank: 0, progressStatus: 'in-progress', aliases: [], categoryPaths: [],
	povPath: '', povName: '', povMissing: false, times: [], locations: [], characterPaths: [], conflict: '', color: null,
	linkedManuscript: [], worldStatus: [], relationships: [], events: '', customFields: '', revision, readOnly: false, healthIssues: [],
});

describe('a scene’s face', () => {
	it('is the deck’s own card, dealt as the face is raised and dressed with it, in the style its box has room for', () => {
		const { nodes, mount, dealt, deps } = faces();
		nodes.set('p1', { type: 'scene', placement: placement('p1', { height: 100 }), scene: sceneModel('scene-1', 'Arrival'), index: 3 });
		const { face, painted } = mount('scene', 'p1', context({ height: 100 }));
		expect(face.classes.has('is-scene')).toBe(true);
		expect(deps.scenes.mount).toHaveBeenCalledWith(face, 'p1', expect.objectContaining({ id: 'scene-1' }), 3);
		const card = dealt.get('p1')!;
		expect(card.el.parent).toBe(face);
		expect(card.dressed).toBe(1);
		// The card is the deck's to dress, and the style is the face's word: a low box shows the barest.
		expect(face.dataset.mode).toBe('compact');
		nodes.set('p1', { type: 'scene', placement: placement('p1', { height: 250 }), scene: sceneModel('scene-1', 'Arrival again', 'r2'), index: 4 });
		painted.dress(context({ height: 250, selected: true }));
		expect(card.dressed).toBe(2);
		expect(card.scene.title).toBe('Arrival again');
		expect(card.index).toBe(4);
		expect(face.dataset.mode).toBe('standard');
		expect(face.classes.has('is-selected')).toBe(true);
		// A style chosen by hand is shown whatever the room.
		nodes.set('p1', { type: 'scene', placement: placement('p1', { height: 100, displayMode: 'extended' }), scene: sceneModel('scene-1', 'Arrival again'), index: 4 });
		painted.dress(context({ height: 100 }));
		expect(face.dataset.mode).toBe('extended');
		painted.settle();
		expect(card.settled).toBe(1);
		painted.unmount();
		expect(card.retired).toBe(1);
		expect(face.parent).toBeNull();
	});

	it('deals no card for a node that is no scene, and keeps nothing where none was dealt', () => {
		const { nodes, mount, deps } = faces();
		nodes.set('p1', textNode('p1', 'words'));
		const { painted } = mount('scene', 'p1');
		expect(deps.scenes.mount).not.toHaveBeenCalled();
		painted.settle();
		painted.unmount();
		expect(deps.scenes.settle).not.toHaveBeenCalled();
		expect(deps.scenes.retire).not.toHaveBeenCalled();
	});
});

const characterModel = (extra: Partial<CharacterViewModel> = {}): CharacterViewModel => ({
	id: 'char-1', path: 'Characters/Anna.md', name: 'Anna', rank: 0, type: null, progressStatus: 'complete', aliases: ['Nan', 'Annie'],
	categoryPaths: ['Cast/Leads'], oneSentenceStoryline: 'Wants out', oneParagraphStoryline: '', motivation: 'Fear', goal: '',
	conflict: 'Her brother', growth: '', color: null, worldStatus: [], relationships: [], customFields: '', revision: 'c1', readOnly: false, healthIssues: [],
	...extra,
});

const entityModel = (extra: Partial<WorldbuildingEntityViewModel> = {}): WorldbuildingEntityViewModel => ({
	id: 'loc-1', path: 'World/Harbour.md', name: 'Harbour', kind: 'location', rank: 0, progressStatus: null, aliases: [], categoryPaths: [],
	description: 'A harbour', timeKind: null, timeStart: '', timeEnd: '', timeStartMissing: false, timeEndMissing: false,
	color: null, worldStatus: [], relationships: [], customFields: '', revision: 'w1', readOnly: false, healthIssues: [],
	...extra,
});

const taskModel: Task = {
	id: 'task-1', title: 'Finish', description: 'All of it', status: 'in-progress', priority: 'urgent', dueDate: '2026-10-01',
	related: [{ kind: 'character', id: 'c1', name: 'Anna' }, { kind: 'scene', id: 's1', name: 'Arrival' }], archived: false, createdAt: 1, updatedAt: 1,
};
const threadModel: ForeshadowingTableItem = {
	id: 'fs-1', name: 'The locket', description: 'Seen early', status: 'planned', related: [], span: 2, createdAt: 1,
	occurrences: [
		{ id: 'oc-1', itemId: 'fs-1', role: 'plant', note: '', path: 'M/Two.md', title: 'Two', standing: 'live', from: 1, to: 2, reveal: { from: 1, to: 2 }, originalText: '' },
		{ id: 'oc-2', itemId: 'fs-1', role: 'payoff', note: '', path: 'M/Nine.md', title: 'Nine', standing: 'unresolved', from: 1, to: 2, reveal: null, originalText: '' },
	],
};
const revisionModel: RevisionRow = {
	id: 'rev-1', path: 'M/One.md', title: 'One', kind: 'replace', original: 'was', proposed: 'is', comment: 'Tighter',
	status: 'conflict', from: 1, to: 2, reveal: null,
};
const noteModel: StickyNoteRecord = {
	id: 'note-1', path: 'N/note.md', body: '# Remember\nthe tide', color: 'macaron-5', createdAt: 1, archived: false, revision: 'n1', stamp: '1:1', readOnly: false,
};

/** Which part of a card each child is, by the class it wears, so a card's shape can be read in one line. */
const partsOf = (host: CorkboardElement, names: Record<string, string>): string[] =>
	host.children.map((child) => Object.entries(names).find(([cls]) => child.classes.has(cls))?.[1] ?? '?');

describe('a card’s face', () => {
	const CARD_PARTS = { 'snowflake-method-corkboard-head': 'head', 'snowflake-method-corkboard-body': 'body', 'snowflake-method-corkboard-footer': 'foot' };

	it('shows a character in the scene card’s shape: symbol, name and standing at the head, the storyline as the body, and on the foot its kind, its palette and the way to its menu', () => {
		const { nodes, mount, deps } = faces();
		nodes.set('c1', { type: 'character', placement: placement('c1', { height: 400 }), character: characterModel() });
		const { face, painted } = mount('character', 'c1', context({ height: 400 }));
		expect(face.classes.has('is-card')).toBe(true);
		expect(face.dataset).toMatchObject({ type: 'character', kind: 'character', mode: 'standard' });
		const card = face.children[0]!;
		expect(card.classes.has('snowflake-method-corkboard-card')).toBe(true);
		expect(partsOf(card, CARD_PARTS)).toEqual(['head', 'body', 'foot']);
		expect(icons.map((entry) => entry.icon)).toEqual(['palette', 'ellipsis', 'icon-character']);
		// The foot says the kind the workspace names, and carries the palette ahead of the way to the menu.
		expect(deps.kindWord).toHaveBeenCalledWith(nodes.get('c1'));
		const actions = face.querySelector('.snowflake-method-corkboard-actions')!;
		expect(actions.children.map((child) => (child.classes.has('snowflake-method-corkboard-color') ? 'palette' : 'more'))).toEqual(['palette', 'more']);
		expect(card.querySelector('.snowflake-method-corkboard-symbol')).not.toBeNull();
		expect(face.querySelector('.snowflake-method-freeform-card-title')!.textContent).toBe('called c1');
		// The standing is the scene card's own select, which lists the statuses and is written to the note on a pick.
		const status = face.querySelector('.snowflake-method-freeform-card-status')!;
		expect(status.value).toBe('complete');
		expect(status.classes.has('is-complete')).toBe(true);
		expect(status.classes.has('snowflake-method-entity-status')).toBe(true);
		expect(status.classes.has('snowflake-method-corkboard-status-select')).toBe(true);
		expect(status.getAttribute('aria-label')).toBe('table.progressStatus');
		expect(status.children.map((option) => option.getAttribute('value'))).toEqual(['not-started', 'in-progress', 'in-revision', 'complete']);
		expect(status.disabled).toBe(false);
		status.value = 'in-progress';
		status.dispatch('change');
		expect(deps.setStatus).toHaveBeenLastCalledWith(nodes.get('c1'), 'in-progress');
		expect(face.querySelector('.snowflake-method-freeform-card-words')!.textContent).toBe('Wants out');
		expect(face.querySelector('.snowflake-method-freeform-card-extra')!.textContent).toBe('kind of c1');
		// The way to the menu stands at the foot's end, where a scene keeps its own; nothing else on the card is typed into.
		expect(face.querySelector('.snowflake-method-corkboard-actions')!.querySelector('.snowflake-method-freeform-node-more')).not.toBeNull();
		expect(face.querySelectorAll('textarea')).toEqual([]);
		expect(face.querySelectorAll('input')).toEqual([]);
		expect(face.querySelectorAll('select')).toHaveLength(1);
		painted.dress(context({ height: 400, selected: true }));
		expect(face.classes.has('is-selected')).toBe(true);
		// A note with no standing shows the blank the scene's shows, with the statuses still on offer; a project that cannot be written offers none.
		nodes.set('c1', { type: 'character', placement: placement('c1', { height: 400 }), character: characterModel({ progressStatus: null, oneSentenceStoryline: 'Wants in' }) });
		painted.dress(context({ height: 400 }));
		expect(face.querySelector('.snowflake-method-freeform-card-words')!.textContent).toBe('Wants in');
		expect(status.value).toBe('');
		expect(status.children.map((option) => option.getAttribute('value'))).toEqual(['', 'not-started', 'in-progress', 'in-revision', 'complete']);
		expect(status.classes.has('is-complete')).toBe(false);
		painted.dress(context({ height: 400, readOnly: true }));
		expect(status.disabled).toBe(true);
		painted.unmount();
		expect(face.parent).toBeNull();
	});

	it('shows a worldbuilding note’s description as the body, and its kind on the foot', () => {
		const { nodes, mount, deps } = faces();
		nodes.set('w1', { type: 'worldbuilding', placement: placement('w1', { height: 400 }), entity: entityModel() });
		const harbour = mount('worldbuilding', 'w1', context({ height: 400 }));
		expect(harbour.face.dataset).toMatchObject({ type: 'worldbuilding', kind: 'location' });
		expect(harbour.face.querySelector('.snowflake-method-freeform-card-words')!.textContent).toBe('A harbour');
		expect(harbour.face.querySelector('.snowflake-method-freeform-card-extra')!.textContent).toBe('kind of w1');
		expect(harbour.face.querySelector('.snowflake-method-freeform-card-status')!.value).toBe('');
		nodes.set('w2', {
			type: 'worldbuilding',
			placement: placement('w2', { height: 400 }),
			entity: entityModel({ id: 'time-1', kind: 'time', timeKind: 'period', description: 'The season', progressStatus: 'in-progress' }),
		});
		const season = mount('worldbuilding', 'w2', context({ height: 400 }));
		expect(season.face.dataset.kind).toBe('time');
		expect(season.face.querySelector('.snowflake-method-freeform-card-words')!.textContent).toBe('The season');
		expect(season.face.querySelector('.snowflake-method-freeform-card-extra')!.textContent).toBe('kind of w2');
		expect(season.face.querySelector('.snowflake-method-freeform-card-status')!.value).toBe('in-progress');
		season.face.querySelector('.snowflake-method-freeform-card-status')!.value = 'complete';
		season.face.querySelector('.snowflake-method-freeform-card-status')!.dispatch('change');
		expect(deps.setStatus).toHaveBeenLastCalledWith(nodes.get('w2'), 'complete');
	});

	it('wears the tint its note has, and hangs the swatches from its palette, which give the tint to the workspace to write', () => {
		const { nodes, mount, deps, dom, made } = faces();
		nodes.set('c1', { type: 'character', placement: placement('c1', { height: 400 }), character: characterModel({ color: 'macaron-3' }) });
		const { face, painted } = mount('character', 'c1', context({ height: 400 }));
		const card = face.children[0]!;
		expect(card.getAttribute('data-color')).toBe('macaron-3');
		const palette = face.querySelector('.snowflake-method-corkboard-color')!;
		expect(palette.getAttribute('aria-label')).toBe('corkboard.colorLabel');
		expect(palette.getAttribute('aria-haspopup')).toBe('dialog');
		expect(palette.disabled).toBe(false);
		const panelOf = () => dom.container.querySelector('.snowflake-method-corkboard-color-panel');
		// A press hangs the swatches, the tint worn among them chosen; a press again puts them away.
		expect(fire(palette, 'click').stopped).toBe(1);
		const panel = panelOf()!;
		expect(panel.getAttribute('role')).toBe('dialog');
		const swatches = panel.querySelector('.snowflake-method-sticky-swatches')!.querySelectorAll('.snowflake-method-sticky-swatch');
		expect(swatches.find((swatch) => swatch.classes.has('is-selected'))?.getAttribute('data-color')).toBe('macaron-3');
		fire(palette, 'click');
		expect(panelOf()).toBeNull();
		// A swatch picked is handed to the workspace with the node as it stands now, and the panel goes.
		fire(palette, 'click');
		const first = panelOf()!.querySelector('.snowflake-method-sticky-swatches')!.querySelectorAll('.snowflake-method-sticky-swatch');
		first[1]!.dispatch('click');
		expect(deps.setColor).toHaveBeenLastCalledWith(nodes.get('c1'), 'macaron-1');
		expect(panelOf()).toBeNull();
		fire(palette, 'click');
		panelOf()!.querySelector('.snowflake-method-sticky-swatches')!.querySelectorAll('.snowflake-method-sticky-swatch')[0]!.dispatch('click');
		expect(deps.setColor).toHaveBeenLastCalledWith(nodes.get('c1'), null);
		// The tint written comes back with the reading, and a note with none wears none.
		nodes.set('c1', { type: 'character', placement: placement('c1', { height: 400 }), character: characterModel({ color: null }) });
		painted.dress(context({ height: 400 }));
		expect(card.getAttribute('data-color')).toBeNull();
		// Read-only, the palette sleeps and any panel it hung goes; the workspace can put one away too.
		fire(palette, 'click');
		expect(panelOf()).not.toBeNull();
		painted.dress(context({ height: 400, readOnly: true }));
		expect(palette.disabled).toBe(true);
		expect(panelOf()).toBeNull();
		painted.dress(context({ height: 400 }));
		fire(palette, 'click');
		made.closeColorPanel();
		expect(panelOf()).toBeNull();
		fire(palette, 'click');
		painted.unmount();
		expect(panelOf()).toBeNull();
	});

	it('shows, on Auto, the fullest face the zoom allows that the box has room for', () => {
		const { nodes, mount } = faces();
		nodes.set('c1', { type: 'character', placement: placement('c1', { height: 200 }), character: characterModel() });
		const { face, painted } = mount('character', 'c1', context({ height: 200 }));
		// A card's fullest face is its standard one, however near the canvas is looked at.
		expect(face.dataset.mode).toBe('standard');
		painted.dress(context({ height: 40 }));
		expect(face.dataset.mode).toBe('compact');
		painted.dress(context({ height: 400, band: 'compact' }));
		expect(face.dataset.mode).toBe('compact');
		painted.dress(context({ height: 400, band: 'far' }));
		expect(face.dataset.mode).toBe('compact');
	});
});

describe('a missing node’s face', () => {
	it('says what kind of thing has gone, and what it was last called', () => {
		const { nodes, mount } = faces();
		nodes.set('m1', { type: 'missing', placement: placement('m1'), of: 'entity', kind: 'scene', why: 'gone', name: 'Lost scene' });
		const { face, painted } = mount('missing', 'm1');
		expect(face.classes.has('is-missing')).toBe(true);
		expect(face.querySelector('.snowflake-method-freeform-face-name')!.textContent).toBe('timeline.scene.missing');
		expect(face.querySelector('.snowflake-method-freeform-face-seen')!.textContent).toBe('freeformCanvas.missing.lastSeen');
		expect(icons.map((entry) => entry.icon)).toEqual(['ellipsis', 'triangle-alert']);
		for (const [kind, of, word] of [
			['time', 'entity', 'timeline.time.missing'],
			['character', 'entity', 'freeformCanvas.missing.character'],
			['location', 'entity', 'freeformCanvas.missing.location'],
			['item', 'entity', 'freeformCanvas.missing.item'],
			['Faction', 'entity', 'freeformCanvas.missing.entity'],
			[null, 'task', 'freeformCanvas.missing.task'],
			[null, 'sticky-note', 'freeformCanvas.missing.stickyNote'],
			[null, 'file', 'freeformCanvas.missing.file'],
		] as const) {
			nodes.set('m1', { type: 'missing', placement: placement('m1'), of, kind, why: 'gone', name: '' });
			painted.dress(context());
			expect(face.querySelector('.snowflake-method-freeform-face-name')!.textContent, `${of} ${String(kind)}`).toBe(word);
			// With no name kept, nothing is said of one.
			expect(face.querySelector('.snowflake-method-freeform-face-seen')!.classes.has('is-hidden')).toBe(true);
		}
		painted.unmount();
		expect(face.parent).toBeNull();
	});
});

describe('the task management cards', () => {
	it('shows a task as the board’s own card: its title with its symbol and its menu on the first row, its priority and due day on the second, wearing the column it stands in', () => {
		const { nodes, mount, setToday } = faces();
		nodes.set('p1', { type: 'task', placement: placement('p1', { height: 400 }), task: taskModel });
		const { face, painted } = mount('task', 'p1', context({ height: 400 }));
		expect(face.classes.has('is-task')).toBe(true);
		expect(face.dataset.mode).toBe('standard');
		const card = face.children[0]!;
		expect(card.classes.has('snowflake-method-task-card')).toBe(true);
		expect(card.getAttribute('data-priority')).toBe('urgent');
		expect(card.getAttribute('data-status')).toBe('in-progress');
		expect(card.getAttribute('data-origin')).toBe('manual');
		const head = card.querySelector('.snowflake-method-task-card-head')!;
		expect(partsOf(head, { 'snowflake-method-task-card-title': 'title', 'snowflake-method-freeform-rail-tools': 'tools' })).toEqual(['title', 'tools']);
		expect(partsOf(head.querySelector('.snowflake-method-freeform-rail-tools')!, { 'snowflake-method-freeform-face-icon': 'symbol', 'snowflake-method-freeform-node-more': 'more' })).toEqual(['symbol', 'more']);
		expect(head.querySelector('.snowflake-method-task-card-title')!.textContent).toBe('Finish');
		expect(icons.map((entry) => entry.icon)).toEqual(['ellipsis', 'icon-task', 'chevrons-up', 'calendar']);
		const meta = card.querySelector('.snowflake-method-task-card-meta')!;
		// Each mark is its glyph and the word after it.
		const priority = meta.querySelector('.snowflake-method-task-priority')!;
		expect(priority.children[0]!.classes.has('snowflake-method-task-glyph')).toBe(true);
		expect(priority.children[1]!.textContent).toBe('tasks.priority.urgent');
		const due = meta.querySelector('.snowflake-method-task-due')!;
		expect(due.children[1]!.textContent).toBe('2026-10-01');
		expect(due.classes.has('is-overdue')).toBe(false);
		// The second row is drawn again only when what it says moves, as the day passing moves it.
		const first = meta.children[0];
		painted.dress(context({ height: 400 }));
		expect(meta.children[0]).toBe(first);
		setToday('2026-10-02');
		painted.dress(context({ height: 400 }));
		expect(meta.children[0]).not.toBe(first);
		expect(meta.querySelector('.snowflake-method-task-due')!.classes.has('is-overdue')).toBe(true);
		// A task with no day due says only how pressing it is; nothing on the card is typed into.
		nodes.set('p1', { type: 'task', placement: placement('p1', { height: 400 }), task: { ...taskModel, dueDate: null, priority: 'low', status: 'done' } });
		painted.dress(context({ height: 400 }));
		expect(meta.querySelector('.snowflake-method-task-due')).toBeNull();
		expect(meta.querySelector('.snowflake-method-task-priority')!.children[1]!.textContent).toBe('tasks.priority.low');
		expect(card.getAttribute('data-status')).toBe('done');
		expect(face.querySelectorAll('textarea')).toEqual([]);
		painted.unmount();
		expect(face.parent).toBeNull();
	});

	it('shows a foreshadowing as the margin’s card: its name and standing at the head under the corner that holds its symbol and its menu, its description, and each occurrence as a way into the manuscript', () => {
		const { nodes, mount, deps } = faces();
		nodes.set('p2', { type: 'foreshadowing', placement: placement('p2', { height: 400 }), item: threadModel });
		const { face, painted } = mount('foreshadowing', 'p2', context({ height: 400 }));
		expect(face.classes.has('is-foreshadowing')).toBe(true);
		const card = face.children[0]!;
		expect(card.classes.has('snowflake-method-rail-card')).toBe(true);
		expect(card.classes.has('snowflake-method-foreshadowing-card')).toBe(true);
		const field = card.querySelector('.snowflake-method-rail-head')!.querySelector('.snowflake-method-rail-field')!;
		expect(field.classes.has('is-name')).toBe(true);
		expect(partsOf(field, { 'snowflake-method-rail-label': 'label', 'snowflake-method-freeform-rail-tools': 'tools', 'snowflake-method-rail-value': 'name', 'snowflake-method-rail-status': 'status' })).toEqual(['label', 'tools', 'name', 'status']);
		expect(field.querySelector('.snowflake-method-rail-label')!.textContent).toBe('manuscript.foreshadowing.name');
		expect(field.querySelector('.snowflake-method-rail-value')!.textContent).toBe('The locket');
		const status = field.querySelector('.snowflake-method-rail-status')!;
		expect(status.textContent).toBe('foreshadowing.status.planned');
		expect(status.classes.has('is-planned')).toBe(true);
		expect(status.classes.has('snowflake-method-entity-status')).toBe(true);
		expect(field.querySelector('.snowflake-method-freeform-rail-tools')!.querySelector('.snowflake-method-freeform-node-more')).not.toBeNull();
		expect(icons.map((entry) => entry.icon)).toEqual(['ellipsis', 'icon-foreshadowing']);
		// No compass and no row of buttons: what the card can do is its menu's.
		expect(card.querySelector('.snowflake-method-rail-nav')).toBeNull();
		expect(card.querySelector('.snowflake-method-rail-actions')).toBeNull();
		const fields = card.querySelector('.snowflake-method-rail-fields')!;
		const blocks = (): [string | null, string | null][] =>
			fields.children.map((block) => [block.getAttribute('data-from'), block.querySelector('.snowflake-method-rail-label')!.textContent]);
		expect(blocks()).toEqual([
			['standard', 'manuscript.foreshadowing.description'],
			['standard', 'freeformCanvas.face.occurrences'],
		]);
		expect(fields.children[0]!.querySelector('.snowflake-method-rail-value')!.textContent).toBe('Seen early');
		const occurrences = fields.children[1]!.querySelectorAll('button');
		expect(occurrences).toHaveLength(2);
		expect(occurrences[0]!.classes.has('snowflake-method-freeform-occurrence')).toBe(true);
		expect(occurrences[0]!.querySelector('.snowflake-method-foreshadowing-role')!.getAttribute('data-role')).toBe('plant');
		expect(occurrences[0]!.querySelector('.snowflake-method-foreshadowing-role')!.textContent).toBe('foreshadowing.role.plant');
		expect(occurrences[0]!.querySelector('.snowflake-method-rail-badge')).toBeNull();
		// An occurrence its chapter no longer answers for wears the rail's badge, in the rail's quiet ink.
		expect(occurrences[1]!.querySelector('.snowflake-method-foreshadowing-role')!.getAttribute('data-role')).toBe('unresolved');
		expect(occurrences[1]!.querySelector('.snowflake-method-rail-badge')!.textContent).toBe('manuscript.foreshadowing.unresolved');
		expect(occurrences[1]!.querySelector('.snowflake-method-freeform-occurrence-passage')).toBeNull();
		const told = fire(occurrences[1]!, 'click');
		expect(told.stopped).toBe(1);
		expect(deps.openOccurrence).toHaveBeenCalledWith(threadModel.occurrences[1]);
		// The passage moved on while the row reads the same: the row stands as drawn, and a click opens the occurrence as the thread has it now.
		const moved = { ...threadModel, occurrences: [threadModel.occurrences[0]!, { ...threadModel.occurrences[1]!, from: 101, to: 102 }] };
		nodes.set('p2', { type: 'foreshadowing', placement: placement('p2', { height: 400 }), item: moved });
		painted.dress(context({ height: 400 }));
		expect(fields.children[1]!.querySelectorAll('button')[1]).toBe(occurrences[1]);
		fire(occurrences[1]!, 'click');
		expect(deps.openOccurrence).toHaveBeenLastCalledWith(moved.occurrences[1]);
		// The words an occurrence marks stand under it; one occurrence is said in the singular; a thread with no description shows none.
		const one = { ...threadModel, description: '', occurrences: [{ ...threadModel.occurrences[0]!, originalText: 'the locket glinted' }] };
		nodes.set('p2', { type: 'foreshadowing', placement: placement('p2', { height: 400 }), item: one });
		painted.dress(context({ height: 400 }));
		expect(blocks()).toEqual([['standard', 'freeformCanvas.face.occurrencesOne']]);
		expect(fields.children[0]!.querySelector('.snowflake-method-freeform-occurrence-passage')!.textContent).toBe('the locket glinted');
		painted.unmount();
		expect(face.parent).toBeNull();
	});

	it('shows a revision as the margin’s card: what it would do at the head with a conflict’s badge, then its chapter, its words and the aside about them', () => {
		const { nodes, mount } = faces();
		nodes.set('p3', { type: 'revision', placement: placement('p3', { height: 400 }), row: revisionModel });
		const { face, painted } = mount('revision', 'p3', context({ height: 400 }));
		expect(face.classes.has('is-revision')).toBe(true);
		const card = face.children[0]!;
		expect(card.classes.has('snowflake-method-rail-card')).toBe(true);
		expect(card.classes.has('snowflake-method-revision-card')).toBe(true);
		expect(card.classes.has('is-conflict')).toBe(true);
		const head = card.querySelector('.snowflake-method-rail-head')!;
		expect(partsOf(head, { 'snowflake-method-rail-field': 'type', 'snowflake-method-freeform-rail-tools': 'tools' })).toEqual(['type', 'tools']);
		expect(head.querySelector('.snowflake-method-rail-label')!.textContent).toBe('manuscript.revision.type');
		const type = head.querySelector('.snowflake-method-rail-value')!;
		expect(type.getAttribute('data-kind')).toBe('conflict');
		expect(type.children[0]!.textContent).toBe('manuscript.revision.kind.replace');
		const badge = type.querySelector('.snowflake-method-rail-badge')!;
		expect(badge.textContent).toBe('manuscript.revision.conflict');
		expect(badge.classes.has('is-hidden')).toBe(false);
		expect(head.querySelector('.snowflake-method-freeform-rail-tools')!.querySelector('.snowflake-method-freeform-node-more')).not.toBeNull();
		expect(icons.map((entry) => entry.icon)).toEqual(['ellipsis', 'icon-revision']);
		expect(card.querySelector('.snowflake-method-rail-nav')).toBeNull();
		expect(card.querySelector('.snowflake-method-rail-actions')).toBeNull();
		const blocks = (): [string | null, string | null, string | null][] =>
			card.querySelector('.snowflake-method-rail-fields')!.children.map((block) => [
				block.getAttribute('data-from'),
				block.querySelector('.snowflake-method-rail-label')!.textContent,
				block.querySelector('.snowflake-method-rail-value')!.textContent,
			]);
		expect(blocks()).toEqual([
			['compact', 'revisionTable.place', 'One'],
			['standard', 'manuscript.revision.original', 'was'],
			['standard', 'manuscript.revision.proposed', 'is'],
			['standard', 'manuscript.revision.comment', 'Tighter'],
		]);
		// Anchored again, the badge goes and the kind wears its own ink; an insertion takes nothing, so shows no original, and an aside of nothing is not shown.
		nodes.set('p3', { type: 'revision', placement: placement('p3', { height: 400 }), row: { ...revisionModel, status: 'live', kind: 'insert', original: '', comment: '' } });
		painted.dress(context({ height: 400 }));
		expect(card.classes.has('is-conflict')).toBe(false);
		expect(type.getAttribute('data-kind')).toBe('insert');
		expect(type.children[0]!.textContent).toBe('manuscript.revision.kind.insert');
		expect(badge.classes.has('is-hidden')).toBe(true);
		expect(blocks()).toEqual([
			['compact', 'revisionTable.place', 'One'],
			['standard', 'manuscript.revision.proposed', 'is'],
		]);
		painted.unmount();
		expect(face.parent).toBeNull();
	});

	it('shows a sticky note as its own card: when it was made, with its symbol and its menu, at the head, and its words under it, the first line alone on the barest face', () => {
		const { nodes, mount, deps } = faces();
		nodes.set('p4', { type: 'sticky-note', placement: placement('p4', { height: 200 }), note: noteModel });
		const { face, painted } = mount('sticky-note', 'p4', context({ height: 200 }));
		expect(face.classes.has('is-sticky')).toBe(true);
		const card = face.children[0]!;
		expect(card.classes.has('snowflake-method-sticky-card')).toBe(true);
		expect(card.classes.has('snowflake-method-sticky-tint')).toBe(true);
		expect(card.getAttribute('data-color')).toBe('macaron-5');
		const head = card.querySelector('.snowflake-method-sticky-head')!;
		expect(partsOf(head, { 'snowflake-method-sticky-created': 'created', 'snowflake-method-sticky-tools': 'tools' })).toEqual(['created', 'tools']);
		expect(partsOf(head.querySelector('.snowflake-method-sticky-tools')!, { 'snowflake-method-freeform-face-icon': 'symbol', 'snowflake-method-freeform-node-more': 'more' })).toEqual(['symbol', 'more']);
		expect(icons.map((entry) => entry.icon)).toEqual(['ellipsis', 'icon-sticky-note']);
		const created = head.querySelector('.snowflake-method-sticky-created')!;
		expect(created.textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
		expect(created.getAttribute('aria-label')).toBe('stickyNotes.created');
		expect(head.querySelector('.snowflake-method-sticky-tools')!.querySelector('.snowflake-method-freeform-node-more')).not.toBeNull();
		expect(face.querySelector('.snowflake-method-freeform-sticky-first')!.textContent).toBe('called p4');
		// Drawn from the note itself, as the board draws it, and a link among its words read from there too.
		expect(renders.map((entry) => [entry.words, entry.sourcePath])).toEqual([['# Remember\nthe tide', 'N/note.md']]);
		expect((renders[0]!.box as CorkboardElement).classes.has('snowflake-method-sticky-rendered')).toBe(true);
		const shown = face.querySelector('.snowflake-method-freeform-text')!;
		const inner = shown.createEl('a', { cls: 'internal-link', attr: { 'data-href': 'Hero', href: 'Hero' } });
		const open = vi.mocked((deps.app as unknown as { workspace: { openLinkText: () => Promise<void> } }).workspace.openLinkText);
		for (const listener of shown.listeners.get('click') ?? []) {
			listener({ target: inner, preventDefault: () => undefined, stopPropagation: () => undefined });
		}
		expect(open).toHaveBeenCalledExactlyOnceWith('Hero', 'N/note.md', false);
		expect(face.dataset.mode).toBe('standard');
		// Dressed again over the same words, nothing is drawn again; over other words, they are.
		painted.dress(context({ height: 200 }));
		expect(renders).toHaveLength(1);
		nodes.set('p4', { type: 'sticky-note', placement: placement('p4', { height: 200 }), note: { ...noteModel, body: 'Other', color: 'macaron-1' } });
		painted.dress(context({ height: 200 }));
		expect(renders).toHaveLength(2);
		expect(card.getAttribute('data-color')).toBe('macaron-1');
		painted.dress(context({ height: 80 }));
		expect(face.dataset.mode).toBe('compact');
		painted.unmount();
		expect(face.parent).toBeNull();
	});
});

describe('a file’s face and a link’s', () => {
	const file = (relativePath: string, kind: FreeformFileReading['kind'], stamp = '1:1'): FreeformFileReading => ({
		path: `Novel/${relativePath}`, relativePath, name: relativePath.slice(relativePath.lastIndexOf('/') + 1).replace(/\.[^.]+$/u, ''),
		extension: relativePath.slice(relativePath.lastIndexOf('.') + 1), kind, stamp,
	});

	it('shows a file’s symbol and name on one face, and draws a picture from the vault once per file', () => {
		const { nodes, mount } = faces();
		nodes.set('f1', { type: 'file', placement: placement('f1', { height: 300 }), file: file('Material/map.png', 'image') });
		const { face, painted } = mount('file', 'f1', context({ height: 300 }));
		expect(face.classes.has('is-file')).toBe(true);
		expect(face.dataset).toMatchObject({ kind: 'image', mode: 'compact' });
		// The way to the menu stands at the head's end; the file's own symbol is drawn as the face is dressed.
		expect(icons.map((entry) => entry.icon)).toEqual(['ellipsis', 'image']);
		// The fake reads no descendant selector: the head holds the way to the menu.
		expect(face.querySelector('.snowflake-method-freeform-face-head')!.querySelector('.snowflake-method-freeform-node-more')).not.toBeNull();
		// The folder it stands in is not said: the face is its name, its extension and the file.
		expect(face.querySelector('.snowflake-method-freeform-file-folder')).toBeNull();
		const extension = face.querySelector('.snowflake-method-freeform-file-ext')!;
		expect(extension.textContent).toBe('png');
		expect(extension.classes.has('is-hidden')).toBe(false);
		const picture = face.querySelector('img')!;
		expect(face.querySelector('.snowflake-method-freeform-file-media')!.classes.has('is-hidden')).toBe(false);
		expect(picture.getAttribute('src')).toBe('app://vault/Novel/Material/map.png');
		expect(picture.getAttribute('alt')).toBe('map');
		painted.dress(context({ height: 300 }));
		expect(face.querySelectorAll('img')).toHaveLength(1);
		// Seen anew by the vault, it is drawn anew; a file at the root stands in no folder.
		nodes.set('f1', { type: 'file', placement: placement('f1', { height: 300 }), file: file('Material/map.png', 'image', '2:2') });
		painted.dress(context({ height: 300 }));
		expect(face.querySelectorAll('img')).toHaveLength(1);
		nodes.set('f1', { type: 'file', placement: placement('f1', { height: 300 }), file: file('notes.zip', 'other') });
		painted.dress(context({ height: 300 }));
		expect(face.querySelector('img')).toBeNull();
		expect(icons[icons.length - 1]!.icon).toBe('file');
		expect(extension.textContent).toBe('zip');
		// Nothing stands under the name of a file that is no picture, video or sound, so the name keeps the middle.
		expect(face.querySelector('.snowflake-method-freeform-file-media')!.classes.has('is-hidden')).toBe(true);
		// A file with no extension wears no tag.
		nodes.set('f1', { type: 'file', placement: placement('f1', { height: 300 }), file: { ...file('LICENSE', 'other'), extension: '' } });
		painted.dress(context({ height: 300 }));
		expect(extension.classes.has('is-hidden')).toBe(true);
		painted.unmount();
		expect(face.parent).toBeNull();
	});

	it('draws a sound and a video with their controls, and nothing for a file the vault no longer serves', () => {
		const { nodes, mount } = faces();
		nodes.set('f2', { type: 'file', placement: placement('f2'), file: file('Material/song.mp3', 'audio') });
		const sound = mount('file', 'f2');
		// The vault serves only the picture: a file it does not hold draws nothing, and says nothing wrong.
		expect(sound.face.querySelector('audio')).toBeNull();
		nodes.set('f3', { type: 'file', placement: placement('f3'), file: { ...file('Material/map.png', 'video'), kind: 'video' } });
		const video = mount('file', 'f3');
		expect(video.face.querySelector('video')?.getAttribute('controls')).toBe('');
		expect(video.face.querySelector('video')?.getAttribute('src')).toBe('app://vault/Novel/Material/map.png');
	});

	it('shows a link by what it is called, on one face, and the address nowhere on it', () => {
		const { nodes, mount } = faces();
		nodes.set('l1', { type: 'link', placement: placement('l1'), url: 'https://example.org/read', label: 'Read this', host: 'example.org' });
		const { face, painted } = mount('link', 'l1');
		expect(face.classes.has('is-link')).toBe(true);
		expect(face.dataset.mode).toBe('compact');
		// The symbol is drawn first, since the way to the menu stands at the head's end here.
		expect(icons.map((entry) => entry.icon)).toEqual(['link', 'ellipsis']);
		expect(face.querySelector('.snowflake-method-freeform-face-name')!.textContent).toBe('called l1');
		expect(face.querySelector('.snowflake-method-freeform-link-address')).toBeNull();
		nodes.set('l1', { type: 'link', placement: placement('l1', { displayMode: 'extended' }), url: 'https://example.org/other', label: '', host: 'example.org' });
		painted.dress(context({ selected: true }));
		expect(face.dataset.mode).toBe('compact');
		expect(face.classes.has('is-selected')).toBe(true);
	});
});
