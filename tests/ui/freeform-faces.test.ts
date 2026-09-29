import { afterEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

const { renders, icons } = vi.hoisted(() => ({
	/** Every drawing asked for, with the way to end it: a test says when the words are drawn, and whether they could be. */
	renders: [] as { words: string; box: unknown; sourcePath: string; component: unknown; done: () => void; fail: (error: unknown) => void }[],
	icons: [] as { icon: string }[],
}));

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

import type { FreeformFrame, FreeformPlacement } from '../../src/domain';
import { CANVAS_FRAME_KIND, type PaintContext } from '../../src/ui/freeform-canvas-port';
import { createFreeformFaces, type FreeformFaceDeps } from '../../src/ui/freeform-faces';
import type { ResolvedNode } from '../../src/ui/freeform-resources';

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
	const deps = {
		app: { workspace: { openLinkText: vi.fn(() => Promise.resolve()) } } as unknown as App,
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
		...extra,
	} satisfies FreeformFaceDeps;
	const made = createFreeformFaces(deps);
	const mount = (kind: string, id: string, at: PaintContext = context()) => {
		const body = dom.container.createDiv();
		const painted = made.painter(kind).mount(body as unknown as HTMLElement, id, at);
		return { body, painted, face: body.children[0]! };
	};
	return {
		dom, deps, made, nodes, frames, mount,
		children: (component as unknown as { children: Set<unknown> }).children,
		edit: (id: string | null) => { editing = id; },
	};
}

afterEach(() => {
	renders.length = 0;
	icons.length = 0;
	vi.restoreAllMocks();
});

describe('the painters', () => {
	it('dresses a text node, a frame, and every other kind by a painter of its own', () => {
		const { made } = faces();
		const text = made.painter('text');
		const frame = made.painter(CANVAS_FRAME_KIND);
		const plain = made.painter('scene');
		expect(new Set([text, frame, plain]).size).toBe(3);
		for (const kind of ['character', 'worldbuilding', 'task', 'foreshadowing', 'revision', 'sticky-note', 'file', 'link', 'pending', 'missing']) {
			expect(made.painter(kind), kind).toBe(plain);
		}
		// The same painter every time it is asked for, so the engine raises a face once.
		expect(made.painter('text')).toBe(text);
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

	it('shows the face its author chose, or the fullest the canvas allows, and says when it is chosen', () => {
		const { nodes, mount } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		const { face, painted } = mount('text', 't1', context({ band: 'standard' }));
		expect(face.dataset.mode).toBe('standard');
		expect(face.classes.has('is-selected')).toBe(false);
		painted.dress(context({ band: 'far', selected: true }));
		expect(face.dataset.mode).toBe('compact');
		expect(face.classes.has('is-selected')).toBe(true);
		nodes.set('t1', textNode('t1', 'One', { displayMode: 'extended' }));
		painted.dress(context({ band: 'far' }));
		expect(face.dataset.mode).toBe('extended');
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
		frames.set('f1', { id: 'f1', title: 'Act', color: null, x: 0, y: 0, width: 400, height: 300, zIndex: 0 });
		for (const [kind, id] of [['text', 't1'], ['task', 's1'], [CANVAS_FRAME_KIND, 'f1']] as const) {
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

	it('is made before what the face says, so the words run round it and never under it', () => {
		const { nodes, mount } = faces();
		nodes.set('t1', textNode('t1', 'One'));
		nodes.set('s1', { type: 'pending', placement: placement('s1'), of: 'task' });
		expect(mount('text', 't1').face.children[0]!.classes.has('snowflake-method-freeform-node-more')).toBe(true);
		expect(mount('task', 's1').face.children[0]!.classes.has('snowflake-method-freeform-node-more')).toBe(true);
	});
});

describe('a frame’s face', () => {
	it('shows its title at its head, and the word for one that has none', () => {
		const { frames, mount } = faces();
		frames.set('f1', { id: 'f1', title: 'Act one', color: 'macaron-2', x: 0, y: 0, width: 400, height: 300, zIndex: 0 });
		const { face, painted } = mount(CANVAS_FRAME_KIND, 'f1', context({ selected: true }));
		expect(face.classes.has('is-frame')).toBe(true);
		expect(face.classes.has('is-selected')).toBe(true);
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
		painted.settle();
		painted.unmount();
		expect(face.parent).toBeNull();
	});
});

describe('the face of a kind that has none of its own yet', () => {
	it('shows the kind’s symbol and what the node is called, and draws neither again for nothing', () => {
		const { nodes, mount, deps } = faces();
		nodes.set('s1', { type: 'missing', placement: placement('s1', { displayMode: 'compact' }), of: 'entity', kind: 'scene', why: 'gone', name: 'Lost' });
		const { face, painted } = mount('missing', 's1');
		expect(face.classes.has('is-plain')).toBe(true);
		expect(face.dataset).toMatchObject({ type: 'missing', mode: 'compact' });
		const name = face.querySelector('.snowflake-method-freeform-face-name')!;
		expect(name.textContent).toBe('called s1');
		expect(face.querySelector('.snowflake-method-freeform-face-icon')!.getAttribute('aria-hidden')).toBe('true');
		// The way to the menu wears a symbol of its own, drawn once.
		expect(icons.map((entry) => entry.icon)).toEqual(['ellipsis', 'icon-missing']);
		const written = name.textWrites;
		painted.dress(context({ selected: true }));
		expect(icons).toHaveLength(2);
		expect(name.textWrites).toBe(written);
		expect(face.classes.has('is-selected')).toBe(true);
		vi.mocked(deps.icon).mockReturnValue('another');
		vi.mocked(deps.label).mockReturnValue('Found');
		painted.dress(context());
		expect(icons.map((entry) => entry.icon)).toEqual(['ellipsis', 'icon-missing', 'another']);
		expect(name.textContent).toBe('Found');
		painted.settle();
		painted.unmount();
		expect(face.parent).toBeNull();
	});

	it('leaves a face standing as it is when its node has gone from the view', () => {
		const { nodes, mount } = faces();
		nodes.set('s1', { type: 'pending', placement: placement('s1'), of: 'task' });
		const { face, painted } = mount('task', 's1');
		nodes.delete('s1');
		expect(() => { painted.dress(context()); }).not.toThrow();
		expect(face.querySelector('.snowflake-method-freeform-face-name')!.textContent).toBe('called s1');
	});
});
