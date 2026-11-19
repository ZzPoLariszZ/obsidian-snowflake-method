import { ItemView, Scope, type WorkspaceLeaf } from 'obsidian';

import type { ContentsHub } from './contents-hub';
import { renderContentsWheel, type ContentsWheel } from './contents-wheel';
import { keepEscapeInView } from './escape-key';
import { relabelLeafHeader, type RelabelsHeader } from './leaf-header';
import type { Translate } from './modals';
import { renderEmptyLine } from './pane-parts';

export const CONTENTS_VIEW_TYPE = 'snowflake-method-contents';

export interface ContentsViewDeps {
	hub: ContentsHub;
	t: Translate;
	/** Whether the plugin holds its animations still. */
	still(): boolean;
	/**
	 * Called before a chapter is brought up. On mobile the sidebar is a
	 * drawer over the page, and it is put away first so the page is seen;
	 * on the desktop there is nothing to do.
	 */
	stepAside(): void;
	/**
	 * What the mounted wheel was written under, the language and the
	 * project the sidebar speaks for, so a rerender that finds it unchanged
	 * redraws nothing: the wheel keeps itself current through the hub.
	 */
	fingerprint(): string;
}

/**
 * The manuscript's contents in a sidebar of their own: the wheel of
 * chapters the stream stands in its left margin, for a pane whose margin is
 * too narrow to hold it, a phone's and most tablets' among them. It turns
 * to the stream in front, marks the chapter that stream's page stands in,
 * and a press on a row brings that chapter up there. It speaks the current
 * project's language, as the margin cards sidebar does.
 */
export class SnowflakeContentsView extends ItemView implements RelabelsHeader {
	private wheel: ContentsWheel | null = null;
	private release: (() => void) | null = null;
	private shownFingerprint: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: ContentsViewDeps,
	) {
		super(leaf);
		// F2 on a row renames its chapter. The app binds the key to its own
		// rename and reads it at the window, where a row never hears it, so
		// it is answered from the view's scope, which outranks that binding
		// while this leaf holds the keys.
		const scope = new Scope(this.app.scope);
		this.scope = scope;
		scope.register([], 'F2', () => {
			const path = this.wheel?.held() ?? null;
			if (path === null) return true;
			this.deps.hub.current()?.rename(path);
			return false;
		});
	}

	getViewType(): string {
		return CONTENTS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.deps.t('contents.viewTitle');
	}

	getIcon(): string {
		return 'table-of-contents';
	}

	onOpen(): Promise<void> {
		this.contentEl.addClass('snowflake-method-contents-view');
		keepEscapeInView(this);
		this.mount();
		return Promise.resolve();
	}

	/** Builds the column again when the language or the project has moved. */
	rerender(): void {
		if (this.wheel === null) return;
		if (this.deps.fingerprint() === this.shownFingerprint) return;
		this.unmount();
		this.mount();
		// The title speaks the same language, and stays in the tab until told.
		this.relabelHeader();
	}

	/** The title said again, in the language the sidebar speaks now. */
	relabelHeader(): void {
		relabelLeafHeader(this);
	}

	/**
	 * A drawer opening shows the column: a wheel that stood in a drawer put
	 * away had no layout to turn in, and is stood on the page's chapter now.
	 * A sidebar dragged wider or narrower changes the wheel's box as well.
	 */
	onResize(): void {
		if (this.contentEl.isShown()) this.wheel?.settle();
	}

	private mount(): void {
		this.shownFingerprint = this.deps.fingerprint();
		const { hub, t } = this.deps;
		const { line: empty, text: emptyText } = renderEmptyLine(this.contentEl, '');
		const wheel = renderContentsWheel(this.contentEl, {
			t,
			still: () => this.deps.still(),
			tooltip: 'left',
			go: (path) => {
				const feed = hub.current();
				if (feed === null) return;
				this.deps.stepAside();
				feed.go(path);
			},
			// What can be done to a chapter itself is the stream's to do: the
			// sidebar hands each ask on to the stream it is turned to.
			menu: (path, event) => hub.current()?.menu(path, event),
			rename: (path) => hub.current()?.rename(path),
			remove: (path) => hub.current()?.remove(path),
		});
		this.wheel = wheel;
		const paint = (): void => {
			const feed = hub.current();
			const rows = feed?.rows ?? [];
			if (rows.length === 0) {
				// A stream with nothing in it says so in the stream's own words.
				emptyText.setText(
					t(feed === null ? 'contents.noStream' : 'manuscript.empty'),
				);
				empty.show();
				wheel.el.hide();
				return;
			}
			empty.hide();
			const hidden = !wheel.el.isShown();
			wheel.el.show();
			wheel.sync({
				rows,
				active: feed?.active ?? null,
				reach: feed?.reach ?? 0,
				editable: feed?.editable ?? false,
			});
			// A wheel brought back from behind the empty line has no place.
			if (hidden) wheel.settle();
		};
		this.release = hub.subscribe(paint);
		paint();
	}

	private unmount(): void {
		this.release?.();
		this.release = null;
		this.wheel?.dispose();
		this.wheel = null;
		this.contentEl.empty();
	}

	onClose(): Promise<void> {
		this.unmount();
		return Promise.resolve();
	}
}
