/**
 * The floating sticky notes of one window: cards standing over the workspace
 * in a layer of their own, dragged by the head, resized by any edge or corner,
 * pinned in place, faded, and closed without the note itself going anywhere. One layer
 * per document, so a popout carries its own; the plugin holds the layers and
 * hands each the bridge.
 *
 * What the layer remembers -- where a panel stands, how large, locked or not,
 * how transparent, which face it shows, and whether it is open -- is the
 * device's own (the hub's per-device state), written a moment after the last
 * move rather than on every pixel. Only the main window's layer remembers:
 * a popout's panels last the popout's own life. A note floats at most once
 * per window; a second request raises the panel that stands.
 */

import { Component, type App, type Plugin } from 'obsidian';

import type { StickyNoteFloatState } from '../domain';
import type { StickyNoteRecord } from '../services';
import { PublicCodeMirrorBackend } from './segment-editor-backend';
import type { StickyNoteBridge, StickyNoteFloatOptions } from './sticky-note-bridge';
import { renderStickyNoteCard, type StickyNoteCardHandle } from './sticky-note-card';
import {
	clampFloatGeometry,
	defaultFloatGeometry,
	defaultFloatState,
	dragGeometry,
	FLOAT_MIN_REM,
	resizeGeometry,
	type FloatGeometry,
	type PointerStart,
	type ResizeEdge,
	type Viewport,
} from './sticky-note-layout';

export interface StickyNoteFloatLayerDeps {
	app: App;
	/** The layer's rendered Markdown lives under a child of the plugin. */
	plugin: Plugin;
	bridge: StickyNoteBridge;
	locale(): string;
	/** Whether this layer writes and restores the device's memory of the panels: the main window's does. */
	remembers: boolean;
}

/** The project a panel's note belongs to, and whether the plugin may write in it. */
export interface StickyNoteFloatProject {
	path: string;
	readOnly: boolean;
}

interface FloatingPanel {
	card: StickyNoteCardHandle;
	state: StickyNoteFloatState;
	/** The project the note belongs to; a switch to another suspends the panel. */
	projectPath: string;
	persistTimer: number | null;
}

const PERSIST_DELAY_MS = 300;

let layerCount = 0;

export class StickyNoteFloatLayer {
	readonly component = new Component();

	private readonly backend = new PublicCodeMirrorBackend();

	private readonly root: HTMLElement;

	private readonly panels = new Map<string, FloatingPanel>();

	private order = 0;

	private readonly ownerId: string;

	private readonly unsubscribe: () => void;

	private readonly onResize: () => void;

	private destroyed = false;

	constructor(
		private readonly doc: Document,
		private readonly deps: StickyNoteFloatLayerDeps,
	) {
		layerCount += 1;
		this.ownerId = `floating-${String(layerCount)}`;
		deps.plugin.addChild(this.component);
		this.root = doc.body.createDiv({ cls: 'snowflake-method-sticky-layer' });
		this.onResize = () => {
			for (const [id, panel] of this.panels) {
				this.apply(id, panel, this.clamp(panel.state));
			}
		};
		this.root.win.addEventListener('resize', this.onResize);
		this.unsubscribe = deps.bridge.hub.subscribe(() => {
			void this.refresh();
		});
	}

	/** Shows a note as a panel, or raises the one already standing. */
	open(
		note: StickyNoteRecord,
		project: StickyNoteFloatProject,
		options: StickyNoteFloatOptions = {},
	): void {
		if (this.destroyed) return;
		const standing = this.panels.get(note.id);
		if (standing !== undefined) {
			this.raise(note.id);
			if (options.mode === 'editing') {
				void standing.card.setMode('editing', options.focus ?? false);
			} else if (options.focus === true) {
				standing.card.el.focus();
			}
			return;
		}
		const remembered = this.deps.bridge.hub.floatState(note.id);
		const geometry =
			remembered === null
				? defaultFloatGeometry(this.viewport(), this.panels.size, this.remPx())
				: this.clamp(remembered);
		const state: StickyNoteFloatState =
			remembered === null
				? defaultFloatState(geometry)
				: { ...remembered, ...geometry, open: true };
		if (options.mode !== undefined) state.mode = options.mode;
		const panel: Partial<FloatingPanel> & { state: StickyNoteFloatState } = {
			state,
			projectPath: project.path,
			persistTimer: null,
		};
		const card = renderStickyNoteCard(
			this.root,
			note,
			{
				app: this.deps.app,
				t: this.deps.bridge.t,
				bridge: this.deps.bridge,
				component: this.component,
				backend: this.backend,
				locale: this.deps.locale(),
				// The project's verdict as the boards have it, and the note's own.
				readOnly: project.readOnly || note.readOnly,
				ownerId: this.ownerId,
			},
			{
				surface: 'floating',
				initialMode: state.mode,
				initialFocus: options.focus === true,
				floating: {
					locked: state.locked,
					alpha: state.alpha,
					onLock: (next) => {
						panel.state.locked = next;
						card.setLocked(next);
						this.persist(note.id);
					},
					onAlpha: (next) => {
						panel.state.alpha = next;
						this.persist(note.id);
					},
					onClose: () => {
						this.close(note.id);
					},
				},
				onModeChange: (mode) => {
					panel.state.mode = mode;
					this.persist(note.id);
				},
			},
		);
		panel.card = card;
		const whole = panel as FloatingPanel;
		this.panels.set(note.id, whole);
		this.apply(note.id, whole, geometry);
		this.wireDrag(note.id, whole);
		this.wireResize(note.id, whole);
		card.el.addEventListener(
			'pointerdown',
			() => {
				this.raise(note.id);
			},
			true,
		);
		this.raise(note.id);
		if (this.deps.remembers) {
			this.deps.bridge.hub.patchFloatState(note.id, { ...whole.state, open: true });
		}
		if (options.focus === true && state.mode !== 'editing') card.el.focus();
		// The boards' float buttons show whether a note stands here.
		this.deps.bridge.hub.notify();
	}

	/** The author put the panel away, or the note was set aside: remembered as closed. */
	close(id: string): void {
		const panel = this.panels.get(id);
		if (panel === undefined) return;
		panel.state.open = false;
		this.flushPersist(id, panel);
		this.takeDown(id, panel);
	}

	has(id: string): boolean {
		return this.panels.has(id);
	}

	hasAny(): boolean {
		return this.panels.size > 0;
	}

	/** Brings a panel over the others. */
	raise(id: string): void {
		const panel = this.panels.get(id);
		if (panel === undefined) return;
		this.order += 1;
		panel.card.el.setCssProps({ '--snowflake-method-sticky-z': String(this.order) });
	}

	/**
	 * The project the window speaks for moved: panels of another project
	 * are put away without touching what the device remembers of them, and
	 * the notes of this project the device remembers open come back -- in
	 * the main window, whose layer keeps that memory; a popout restores
	 * nothing, since its panels were never written down.
	 */
	reconcile(
		project: StickyNoteFloatProject | null,
		notes: readonly StickyNoteRecord[],
	): void {
		if (this.destroyed) return;
		for (const [id, panel] of [...this.panels]) {
			if (panel.projectPath !== project?.path) this.suspend(id, panel);
		}
		if (project === null || !this.deps.remembers) return;
		for (const note of notes) {
			if (note.archived || this.panels.has(note.id)) continue;
			const remembered = this.deps.bridge.hub.floatState(note.id);
			if (remembered?.open === true) {
				this.open(note, project, { mode: remembered.mode });
			}
		}
	}

	/** Every panel put away with its memory intact: the window is closing. */
	closeAll(): void {
		for (const [id, panel] of [...this.panels]) this.suspend(id, panel);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.closeAll();
		this.unsubscribe();
		this.root.win.removeEventListener('resize', this.onResize);
		this.backend.destroyAll();
		this.root.remove();
		this.deps.plugin.removeChild(this.component);
	}

	/**
	 * The notes changed somewhere: each panel takes its note as the file now
	 * says it. A note set aside is closed, as the author might have closed
	 * it; a note that cannot be read -- deleted, or its frontmatter broken,
	 * or its project no longer the window's -- is put away with its memory
	 * kept, so it comes back once it can be read again.
	 */
	private async refresh(): Promise<void> {
		for (const [id, panel] of [...this.panels]) {
			if (this.destroyed) return;
			if (!this.panels.has(id)) continue;
			const held = panel.card.note;
			if (this.deps.bridge.stamp(held.path) === held.stamp) continue;
			let fresh = await this.deps.bridge.readNote(held.path);
			if (fresh === null) {
				// The path is gone; the note may stand under another name.
				const reading = await this.deps.bridge.read();
				fresh = reading?.notes.find((note) => note.id === id) ?? null;
			}
			if (this.destroyed) return;
			if (!this.panels.has(id)) continue;
			if (fresh === null) {
				this.suspend(id, panel);
				continue;
			}
			if (fresh.archived) {
				this.close(id);
				continue;
			}
			panel.card.update(fresh);
		}
	}

	private suspend(id: string, panel: FloatingPanel): void {
		this.flushPersist(id, panel);
		this.takeDown(id, panel);
	}

	private takeDown(id: string, panel: FloatingPanel): void {
		this.panels.delete(id);
		if (panel.persistTimer !== null) {
			this.root.win.clearTimeout(panel.persistTimer);
			panel.persistTimer = null;
		}
		void panel.card.dispose();
		if (!this.destroyed) this.deps.bridge.hub.notify();
	}

	private persist(id: string): void {
		if (!this.deps.remembers) return;
		const panel = this.panels.get(id);
		if (panel === undefined) return;
		if (panel.persistTimer !== null) this.root.win.clearTimeout(panel.persistTimer);
		panel.persistTimer = this.root.win.setTimeout(() => {
			panel.persistTimer = null;
			this.deps.bridge.hub.patchFloatState(id, panel.state);
		}, PERSIST_DELAY_MS);
	}

	private flushPersist(id: string, panel: FloatingPanel): void {
		if (panel.persistTimer !== null) {
			this.root.win.clearTimeout(panel.persistTimer);
			panel.persistTimer = null;
		}
		if (this.deps.remembers) this.deps.bridge.hub.patchFloatState(id, panel.state);
	}

	private apply(id: string, panel: FloatingPanel, geometry: FloatGeometry): void {
		panel.state.x = geometry.x;
		panel.state.y = geometry.y;
		panel.state.width = geometry.width;
		panel.state.height = geometry.height;
		panel.card.el.setCssProps({
			'--snowflake-method-sticky-x': `${String(geometry.x)}px`,
			'--snowflake-method-sticky-y': `${String(geometry.y)}px`,
			'--snowflake-method-sticky-w': `${String(geometry.width)}px`,
			'--snowflake-method-sticky-h': `${String(geometry.height)}px`,
		});
		// A colour or transparency panel hanging off the head moves with it.
		panel.card.followMove();
		void id;
	}

	private wireDrag(id: string, panel: FloatingPanel): void {
		const head = panel.card.head;
		head.addEventListener('pointerdown', (event) => {
			if (event.button !== 0 || panel.state.locked) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest('button, input, a') != null) return;
			event.preventDefault();
			// The card is marked as dragged only once the pointer moves, and
			// stays marked through the click that follows the release, so a
			// held-and-moved head is not read as a click into Editing while a
			// plain click on it still is.
			let moved = false;
			this.track(head, event, (start, pointer) => {
				if (!moved) {
					moved = true;
					panel.card.el.addClass('is-dragging');
				}
				this.apply(id, panel, this.clamp(dragGeometry(start, pointer)));
			}, () => {
				if (moved) {
					this.root.win.setTimeout(() => {
						panel.card.el.removeClass('is-dragging');
					}, 0);
				}
				this.persist(id);
			}, panel);
		});
	}

	private wireResize(id: string, panel: FloatingPanel): void {
		for (const grip of panel.card.resizeGrips) {
			const edge = (grip.getAttribute('data-edge') ?? 'se') as ResizeEdge;
			grip.addEventListener('pointerdown', (event) => {
				if (event.button !== 0 || panel.state.locked) return;
				event.preventDefault();
				const remPx = this.remPx();
				const floor = {
					width: FLOAT_MIN_REM.width * remPx,
					height: FLOAT_MIN_REM.height * remPx,
				};
				this.track(grip, event, (start, pointer) => {
					this.apply(
						id,
						panel,
						this.clamp(resizeGeometry(start, pointer, edge, floor)),
					);
				}, () => {
					this.persist(id);
				}, panel);
			});
		}
	}

	/** One pointer's travel from a press to its release, captured on the grip pressed. */
	private track(
		grip: HTMLElement,
		event: PointerEvent,
		move: (start: PointerStart, pointer: { x: number; y: number }) => void,
		done: () => void,
		panel: FloatingPanel,
	): void {
		const start: PointerStart = {
			pointer: { x: event.clientX, y: event.clientY },
			box: {
				x: panel.state.x,
				y: panel.state.y,
				width: panel.state.width,
				height: panel.state.height,
			},
		};
		try {
			grip.setPointerCapture(event.pointerId);
		} catch {
			// A pointer the browser will not capture still drags; it just may
			// let go early when it leaves the grip.
		}
		let over = false;
		const onMove = (next: PointerEvent): void => {
			move(start, { x: next.clientX, y: next.clientY });
		};
		const end = (): void => {
			if (over) return;
			over = true;
			grip.removeEventListener('pointermove', onMove);
			grip.removeEventListener('pointerup', end);
			grip.removeEventListener('pointercancel', end);
			grip.removeEventListener('lostpointercapture', end);
			done();
		};
		grip.addEventListener('pointermove', onMove);
		grip.addEventListener('pointerup', end);
		grip.addEventListener('pointercancel', end);
		grip.addEventListener('lostpointercapture', end);
	}

	private clamp(geometry: FloatGeometry): FloatGeometry {
		return clampFloatGeometry(geometry, this.viewport(), this.remPx());
	}

	private viewport(): Viewport {
		const win = this.root.win;
		return { width: win.innerWidth, height: win.innerHeight };
	}

	private remPx(): number {
		const size = Number.parseFloat(
			this.root.win.getComputedStyle(this.doc.documentElement).fontSize,
		);
		return Number.isFinite(size) && size > 0 ? size : 16;
	}
}
