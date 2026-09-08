/**
 * A small Obsidian element surface for the actual corkboard renderer. Layout
 * and animation frames are supplied explicitly; card construction, event
 * wiring, windowing and content writes all run through production code.
 */
export class CorkboardDom {
	width = 1_000;
	height = 600;
	geometryReads = 0;
	readonly operations: {
		kind: 'read' | 'style' | 'scroll';
		target: CorkboardElement;
		property: string;
	}[] = [];
	private sequence = 0;
	readonly frames = new Map<number, () => void>();
	readonly observers: { notify(): void; disconnected: boolean }[] = [];
	readonly doc: {
		activeElement: CorkboardElement | null;
		body: CorkboardElement | null;
		documentElement: CorkboardElement | null;
		defaultView: CorkboardDom['win'];
	};
	readonly win;
	readonly container: CorkboardElement;

	constructor() {
		const observers = this.observers;
		this.win = {
			requestAnimationFrame: (callback: () => void): number => {
				const id = ++this.sequence;
				this.frames.set(id, callback);
				return id;
			},
			cancelAnimationFrame: (id: number): void => { this.frames.delete(id); },
			getComputedStyle: (element: CorkboardElement) => {
				this.geometryReads++;
				this.operations.push({ kind: 'read', target: element, property: 'computedStyle' });
				return { fontSize: '16px', borderTopWidth: '1px', borderBottomWidth: '1px' };
			},
			setTimeout: (callback: () => void): number => {
				const id = ++this.sequence;
				this.frames.set(id, callback);
				return id;
			},
			clearTimeout: (id: number): void => { this.frames.delete(id); },
			addEventListener: (): void => undefined,
			removeEventListener: (): void => undefined,
			ResizeObserver: class {
				disconnected = false;
				constructor(private callback: () => void) { observers.push(this); }
				observe(): void {}
				disconnect(): void { this.disconnected = true; }
				notify(): void { if (!this.disconnected) this.callback(); }
			},
		};
		this.doc = { activeElement: null, body: null, documentElement: null, defaultView: this.win };
		this.container = new CorkboardElement(this, 'div');
		this.doc.body = this.container;
		this.doc.documentElement = this.container;
	}

	flushFrame(): void {
		const callbacks = [...this.frames.values()];
		this.frames.clear();
		for (const callback of callbacks) callback();
	}

	resize(width: number, height = this.height): void {
		this.width = width;
		this.height = height;
		for (const observer of this.observers) observer.notify();
	}
}

interface ElementSpec {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
}

type DomEvent = {
	target: CorkboardElement;
	preventDefault(): void;
	stopPropagation(): void;
};

export class CorkboardElement {
	readonly children: CorkboardElement[] = [];
	readonly dataset: Record<string, string> = {};
	readonly styles: Record<string, string> = {};
	readonly classList = { contains: (name: string): boolean => this.classes.has(name) };
	readonly classes = new Set<string>();
	readonly attributes = new Map<string, string>();
	readonly listeners = new Map<string, ((event: DomEvent) => void)[]>();
	parent: CorkboardElement | null = null;
	textContent = '';
	value = '';
	disabled = false;
	readOnly = false;
	private top = 0;
	textWrites = 0;
	attributeWrites = 0;
	styleWrites = 0;

	constructor(readonly dom: CorkboardDom, readonly tag: string) {}
	get doc(): CorkboardDom['doc'] { return this.dom.doc; }
	get ownerDocument(): CorkboardDom['doc'] { return this.doc; }
	get win(): CorkboardDom['win'] { return this.dom.win; }
	private readGeometry(property: string): void {
		this.dom.geometryReads++;
		this.dom.operations.push({ kind: 'read', target: this, property });
	}
	get clientWidth(): number { this.readGeometry('clientWidth'); return this.dom.width; }
	get clientHeight(): number { this.readGeometry('clientHeight'); return this.dom.height; }
	get scrollTop(): number { this.readGeometry('scrollTop'); return this.top; }
	set scrollTop(top: number) {
		this.dom.operations.push({ kind: 'scroll', target: this, property: 'scrollTop' });
		this.top = top;
	}
	get scrollHeight(): number {
		this.readGeometry('scrollHeight');
		const content = Math.max(0, ...this.children.map((child) => Number.parseFloat(child.styles.height ?? '0')));
		// The stylesheet gives the corkboard scroller 8px padding at either end.
		return Math.max(this.dom.height, content + 16);
	}
	get isConnected(): boolean { return this === this.dom.container || this.parent?.isConnected === true; }

	private create(tag: string, spec: ElementSpec): CorkboardElement {
		const child = new CorkboardElement(this.dom, tag);
		for (const cls of (spec.cls ?? '').split(' ').filter(Boolean)) child.classes.add(cls);
		for (const [key, value] of Object.entries(spec.attr ?? {})) child.setAttribute(key, value);
		if (spec.text !== undefined) child.setText(spec.text);
		child.parent = this;
		this.children.push(child);
		return child;
	}
	createEl(tag: string, spec: ElementSpec = {}): CorkboardElement { return this.create(tag, spec); }
	createDiv(spec: ElementSpec = {}): CorkboardElement { return this.create('div', spec); }
	createSpan(spec: ElementSpec = {}): CorkboardElement { return this.create('span', spec); }
	setText(text: string): void { this.textWrites++; this.textContent = text; }
	setAttribute(key: string, value: string): void {
		this.attributeWrites++;
		this.attributes.set(key, value);
		if (key.startsWith('data-')) this.dataset[key.slice(5)] = value;
	}
	getAttribute(key: string): string | null { return this.attributes.get(key) ?? null; }
	removeAttribute(key: string): void { this.attributeWrites++; this.attributes.delete(key); }
	addClass(name: string): void { this.classes.add(name); }
	removeClass(name: string): void { this.classes.delete(name); }
	toggleClass(name: string, on: boolean): void { if (on) this.classes.add(name); else this.classes.delete(name); }
	setCssStyles(styles: Record<string, string>): void {
		this.styleWrites++;
		for (const property of Object.keys(styles)) this.dom.operations.push({ kind: 'style', target: this, property });
		Object.assign(this.styles, styles);
	}
	setCssProps(styles: Record<string, string>): void { this.setCssStyles(styles); }
	getBoundingClientRect(): { height: number } { this.readGeometry('getBoundingClientRect'); return { height: 37 }; }
	matches(selector: string): boolean {
		return selector.startsWith('.') ? this.classes.has(selector.slice(1)) : this.tag === selector;
	}
	querySelector(selector: string): CorkboardElement | null { return this.querySelectorAll(selector)[0] ?? null; }
	querySelectorAll(selector: string): CorkboardElement[] {
		return this.children.flatMap((child) => [
			...(child.matches(selector) ? [child] : []),
			...child.querySelectorAll(selector),
		]);
	}
	closest(selector: string): CorkboardElement | null {
		return this.matches(selector) ? this : this.parent?.closest(selector) ?? null;
	}
	contains(element: CorkboardElement): boolean { return this === element || this.children.some((child) => child.contains(element)); }
	addEventListener(type: string, callback: (event: DomEvent) => void): void {
		this.listeners.set(type, [...this.listeners.get(type) ?? [], callback]);
	}
	dispatch(type: string): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener({ target: this, preventDefault: () => undefined, stopPropagation: () => undefined });
		}
	}
	focus(): void { this.doc.activeElement = this; }
	select(): void {}
	remove(): void {
		if (this.parent === null) return;
		this.parent.children.splice(this.parent.children.indexOf(this), 1);
		if (this.doc.activeElement !== null && this.contains(this.doc.activeElement)) this.doc.activeElement = this.doc.body;
		this.parent = null;
	}
	empty(): void { for (const child of [...this.children]) child.remove(); }
	insertBefore(child: CorkboardElement, before: CorkboardElement | null): void {
		child.remove();
		child.parent = this;
		this.children.splice(before === null ? this.children.length : this.children.indexOf(before), 0, child);
	}
}
