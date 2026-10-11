/**
 * The few helpers Obsidian adds to every element, put on a real document's
 * own elements for the one corner of the suite that runs on one. The canvas's
 * engine stands on a document and is raised by the plugin's own code, which
 * builds its elements the app's way; nothing here is more than what that
 * code reaches for.
 */

interface ElementSpec {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
}

type MigrationListener = (win: Window) => unknown;

const migrations = new WeakMap<Element, Set<MigrationListener>>();

/** Tells an element's own listeners that it stands in another window, as the app does when a view is moved out. */
export function migrate(element: Element, win: Window): void {
	for (const listener of [...(migrations.get(element) ?? [])]) listener(win);
}

/** How many of an element's listeners still wait to hear of a move. */
export function migrationListeners(element: Element): number {
	return migrations.get(element)?.size ?? 0;
}

export function installObsidianDom(win: Window & typeof globalThis): void {
	const node = win.Node.prototype as unknown as Record<string, unknown>;
	const element = win.Element.prototype as unknown as Record<string, unknown>;
	if (typeof node.instanceOf === 'function') return;

	const create = function (this: Element, tag: string, spec: ElementSpec = {}): Element {
		const child = this.ownerDocument.createElement(tag);
		for (const cls of (spec.cls ?? '').split(' ').filter(Boolean)) child.classList.add(cls);
		for (const [key, value] of Object.entries(spec.attr ?? {})) child.setAttribute(key, value);
		if (spec.text !== undefined) child.textContent = spec.text;
		this.appendChild(child);
		return child;
	};

	Object.defineProperties(win.Node.prototype, {
		win: { configurable: true, get(this: Node) { return this.ownerDocument?.defaultView ?? win; } },
		doc: { configurable: true, get(this: Node) { return this.ownerDocument ?? win.document; } },
	});
	node.instanceOf = function (this: Node, type: abstract new (...args: never[]) => unknown): boolean {
		return this instanceof type;
	};
	element.addClass = function (this: Element, ...names: string[]): void { this.classList.add(...names); };
	element.removeClass = function (this: Element, ...names: string[]): void { this.classList.remove(...names); };
	element.removeClasses = function (this: Element, names: string[]): void { this.classList.remove(...names); };
	element.toggleClass = function (this: Element, name: string, on: boolean): void { this.classList.toggle(name, on); };
	element.hasClass = function (this: Element, name: string): boolean { return this.classList.contains(name); };
	element.createEl = create;
	element.createDiv = function (this: Element, spec?: ElementSpec): Element { return create.call(this, 'div', spec); };
	element.createSpan = function (this: Element, spec?: ElementSpec): Element { return create.call(this, 'span', spec); };
	element.setText = function (this: Element, text: string): void { this.textContent = text; };
	element.empty = function (this: Element): void { this.replaceChildren(); };
	element.detach = function (this: Element): void { this.remove(); };
	// Hidden by the attribute here rather than the style the app writes:
	// what the code under test reads back is whether it is shown.
	element.hide = function (this: HTMLElement): void { this.hidden = true; };
	element.show = function (this: HTMLElement): void { this.hidden = false; };
	element.isShown = function (this: HTMLElement): boolean { return this.isConnected && !this.hidden; };
	element.onWindowMigrated = function (this: Element, listener: MigrationListener): () => void {
		const heard = migrations.get(this) ?? new Set<MigrationListener>();
		migrations.set(this, heard);
		heard.add(listener);
		return () => { heard.delete(listener); };
	};
	// And the loose builders the app puts on the window, which make an
	// element of nobody's until it is placed.
	const loose = {
		createSpan: (spec: ElementSpec = {}): HTMLSpanElement => {
			const holder = win.document.createElement('div');
			const span = create.call(holder, 'span', spec) as HTMLSpanElement;
			span.remove();
			return span;
		},
		createFragment: (): DocumentFragment => win.document.createDocumentFragment(),
	};
	for (const target of [win, globalThis] as Record<string, unknown>[]) {
		for (const [name, builder] of Object.entries(loose)) {
			if (typeof target[name] !== 'function') target[name] = builder;
		}
	}
}
