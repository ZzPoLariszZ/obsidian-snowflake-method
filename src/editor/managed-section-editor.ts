import {
	EditorState,
	StateEffect,
	StateField,
	Transaction,
	type Extension,
	type Range,
	type StateCommand,
} from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import {
	editorEditorField,
	editorInfoField,
	editorLivePreviewField,
	setIcon,
	type MarkdownFileInfo,
} from 'obsidian';

import { GENERATED_SECTION_IDS } from '../domain';
import {
	changeIntersectsReadOnlyContent,
	containsManagedMarkerText,
	findManagedBoundaryIntersections,
	pairManagedSections,
	scanManagedBoundaries,
	type ManagedBoundaryRange,
	type TextChangeRange,
} from './managed-section-ranges';
import {
	managedSectionHighlightLineStarts,
	resolveManagedMarkerIssueNavigationTarget,
	resolveManagedSectionNavigationTargets,
} from './managed-section-navigation';

export interface ManagedSectionEditorIdentity {
	state: EditorState;
	info: MarkdownFileInfo | undefined;
	filePath: string | null;
	livePreview: boolean;
}

export interface ManagedSectionEditorContext extends ManagedSectionEditorIdentity {
	content: string;
}

export interface ManagedSectionEditorStrings {
	emptyPlaceholder: string;
	protectedBoundary: string;
	unlockedBoundary: string;
}

export interface ManagedBoundaryBlockedEvent {
	context: ManagedSectionEditorContext;
	sectionIds: readonly string[];
	/** The subset hit inside a generated block's content, for a truer notice. */
	generatedSectionIds: readonly string[];
	userEvent: string;
}

export interface ManagedSectionEditorOptions {
	/** Fast file/frontmatter check that runs before copying or scanning the document. */
	isPotentiallyEnabled?: (context: ManagedSectionEditorIdentity) => boolean;
	/** Return true only for Markdown notes managed by this plugin. */
	isEnabled?: (context: ManagedSectionEditorContext) => boolean;
	/** Usually reads the `protectManagedBoundaries` plugin setting. */
	isProtectionEnabled?: (context: ManagedSectionEditorContext) => boolean;
	/** Resolve labels using the file's project locale, not one global current project. */
	getStrings?: (context: ManagedSectionEditorContext) => ManagedSectionEditorStrings;
	/** Canonical section ids for this document type. Unknown markers stay editable. */
	getSectionIds?: (context: ManagedSectionEditorContext) => readonly string[];
	/**
	 * True while the plugin itself is writing this file. A write to an open
	 * note arrives here as a transaction, and refusing it would strand the
	 * editor on the old text, which the next autosave would then write back
	 * over the plugin's change.
	 */
	isPluginWrite?: (context: ManagedSectionEditorIdentity) => boolean;
	onBoundaryBlocked?: (event: ManagedBoundaryBlockedEvent) => void;
	blockedNoticeThrottleMs?: number;
	now?: () => number;
}

const DEFAULT_STRINGS: ManagedSectionEditorStrings = {
	emptyPlaceholder: 'Write here…',
	protectedBoundary: 'This Snowflake section boundary is protected.',
	unlockedBoundary: 'This Snowflake section boundary is temporarily unlocked.',
};

export const setManagedBoundariesUnlockedEffect = StateEffect.define<boolean>();
export const refreshManagedSectionDecorationsEffect = StateEffect.define<null>();
type ManagedSectionFlashTarget =
	| { kind: 'sections'; sectionIds: readonly string[] }
	| { kind: 'marker-issue'; sectionId: string };

const flashManagedSectionEffect = StateEffect.define<ManagedSectionFlashTarget>();
const clearManagedSectionFlashEffect = StateEffect.define<number>();
const MANAGED_SECTION_FLASH_DURATION_MS = 1_000;

interface ManagedSectionFlashScheduler {
	setTimeout(callback: () => void, delay: number): number;
	clearTimeout(handle: number): void;
}

export class ManagedSectionFlashTimer {
	private handle: number | null = null;
	private cycle = 0;

	constructor(private readonly scheduler: ManagedSectionFlashScheduler) {}

	restart(onElapsed: (cycle: number) => void): number {
		this.cancel();
		const cycle = ++this.cycle;
		this.handle = this.scheduler.setTimeout(() => {
			this.handle = null;
			onElapsed(cycle);
		}, MANAGED_SECTION_FLASH_DURATION_MS);
		return cycle;
	}

	cancel(): void {
		if (this.handle === null) return;
		this.scheduler.clearTimeout(this.handle);
		this.handle = null;
	}
}

const managedBoundariesUnlockedField = StateField.define<boolean>({
	create: () => false,
	update: (unlocked, transaction) => {
		for (const effect of transaction.effects) {
			if (effect.is(setManagedBoundariesUnlockedEffect)) return effect.value;
		}
		return unlocked;
	},
});

export function areManagedBoundariesUnlocked(state: EditorState): boolean {
	return state.field(managedBoundariesUnlockedField, false) ?? false;
}

export function setManagedBoundariesUnlocked(view: EditorView, unlocked: boolean): void {
	view.dispatch({ effects: setManagedBoundariesUnlockedEffect.of(unlocked) });
}

export function toggleManagedBoundariesUnlocked(view: EditorView): boolean {
	const unlocked = !areManagedBoundariesUnlocked(view.state);
	setManagedBoundariesUnlocked(view, unlocked);
	return unlocked;
}

export const toggleManagedBoundariesStateCommand: StateCommand = ({ state, dispatch }) => {
	dispatch(
		state.update({
			effects: [
				setManagedBoundariesUnlockedEffect.of(!areManagedBoundariesUnlocked(state)),
			],
		}),
	);
	return true;
};

export function refreshManagedSectionDecorations(view: EditorView): void {
	view.dispatch({ effects: refreshManagedSectionDecorationsEffect.of(null) });
}

export function flashManagedSection(
	view: EditorView,
	sectionId: string,
	cursorOffset?: number,
): boolean {
	return flashManagedSections(view, [sectionId], cursorOffset);
}

export function flashManagedSections(
	view: EditorView,
	sectionIds: readonly string[],
	cursorOffset?: number,
): boolean {
	const targets = resolveManagedSectionNavigationTargets(
		view.state.doc.toString(),
		sectionIds,
	);
	if (targets === null) return false;
	view.dispatch({
		...(cursorOffset === undefined
			? {}
			: {
					selection: { anchor: cursorOffset },
					scrollIntoView: true,
				}),
		effects: flashManagedSectionEffect.of({
			kind: 'sections',
			sectionIds: targets.map((target) => target.sectionId),
		}),
	});
	if (cursorOffset !== undefined) view.focus();
	return true;
}

export function flashManagedMarkerIssue(
	view: EditorView,
	sectionId: string,
	cursorOffset?: number,
): boolean {
	const target = resolveManagedMarkerIssueNavigationTarget(
		view.state.doc.toString(),
		sectionId,
	);
	if (target === null) return false;
	view.dispatch({
		...(cursorOffset === undefined
			? {}
			: {
					selection: { anchor: cursorOffset },
					scrollIntoView: true,
				}),
		effects: flashManagedSectionEffect.of({ kind: 'marker-issue', sectionId }),
	});
	if (cursorOffset !== undefined) view.focus();
	return true;
}

/**
 * Resolves Obsidian's CodeMirror view without relying on the private
 * `Editor.cm` property. `editor-menu` can pass a lightweight
 * `MarkdownFileInfo`; those instances intentionally return null when they do
 * not expose a view container.
 */
export function findEditorViewForMarkdownInfo(info: MarkdownFileInfo): EditorView | null {
	const container = markdownInfoContainer(info);
	if (!container) return null;
	const editorElement = container.matches('.cm-editor')
		? container
		: container.querySelector<HTMLElement>('.cm-editor');
	if (!editorElement) return null;

	const discovered = EditorView.findFromDOM(editorElement);
	if (!discovered) return null;
	const registered = discovered.state.field(editorEditorField, false);
	if (!registered) return null;

	const registeredInfo = registered.state.field(editorInfoField, false);
	if (
		info.file?.path &&
		registeredInfo?.file?.path &&
		info.file.path !== registeredInfo.file.path
	) {
		return null;
	}
	return registered;
}

export function isManagedSectionEditorLivePreview(view: EditorView): boolean {
	return view.state.field(editorLivePreviewField, false) ?? false;
}

/**
 * Register the returned extension once with `Plugin.registerEditorExtension`.
 * Settings or locale changes are reflected after dispatching
 * `refreshManagedSectionDecorations` to each open Markdown editor.
 */
export function createManagedSectionEditorExtension(
	options: ManagedSectionEditorOptions = {},
): Extension {
	const lastBlockedNoticeByFile = new Map<string, number>();
	const throttleMs = options.blockedNoticeThrottleMs ?? 1_400;
	const now = options.now ?? Date.now;

	const transactionFilter = EditorState.transactionFilter.of((transaction) => {
		const userEvent = transaction.annotation(Transaction.userEvent);
		// Only changes a person makes are refused. Obsidian and plugins apply
		// programmatic edits with other event names, or none, and the plugin's
		// own writes to an open note arrive through here too.
		if (
			!transaction.docChanged ||
			!userEvent ||
			!isHumanUserEvent(userEvent)
		) {
			return transaction;
		}
		if (areManagedBoundariesUnlocked(transaction.startState)) return transaction;

		const identity = editorIdentity(transaction.startState);
		if (options.isPluginWrite?.(identity) === true) return transaction;
		if (options.isPotentiallyEnabled?.(identity) === false) return transaction;
		const context = editorContext(transaction.startState, identity);
		const boundaries = scanManagedBoundaries(
			context.content,
			options.getSectionIds?.(context),
		);
		if (!isEditorEnabled(options, context, boundaries)) return transaction;
		if (options.isProtectionEnabled?.(context) === false) return transaction;

		const changes: TextChangeRange[] = [];
		transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
			changes.push({ from, to, insertedText: inserted.toString() });
		});

		const intersections = findManagedBoundaryIntersections(changes, boundaries);
		// A generated block is read-only through its content as well: it only
		// ever says what the properties say, so a keystroke inside it would be
		// rewritten by the next reconcile pass anyway. Refusing it here is the
		// honest version of that.
		const generatedHits = new Set<string>();
		const generatedSections = pairManagedSections(
			context.content,
			boundaries,
		).filter((section) => GENERATED_SECTION_IDS.has(section.sectionId));
		for (const change of changes) {
			for (const section of generatedSections) {
				if (changeIntersectsReadOnlyContent(change, section)) {
					generatedHits.add(section.sectionId);
				}
			}
		}
		const insertsMarkerText = changes.some((change) =>
			containsManagedMarkerText(change.insertedText ?? ''),
		);
		if (
			intersections.length === 0 &&
			generatedHits.size === 0 &&
			!insertsMarkerText
		) {
			return transaction;
		}

		const sectionIds = [
			...new Set([
				...intersections.map(({ boundary }) => boundary.sectionId),
				...generatedHits,
			]),
		];
		const throttleKey = context.filePath ?? '__snowflake-unknown-editor__';
		const timestamp = now();
		const lastNotice = lastBlockedNoticeByFile.get(throttleKey) ?? Number.NEGATIVE_INFINITY;
		if (timestamp - lastNotice >= throttleMs) {
			lastBlockedNoticeByFile.set(throttleKey, timestamp);
			options.onBoundaryBlocked?.({
				context,
				sectionIds,
				generatedSectionIds: [...generatedHits],
				userEvent,
			});
		}

		return [];
	});

	const decorations = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private flashTarget: ManagedSectionFlashTarget | null = null;
			private flashCycle = 0;
			private readonly flashTimer: ManagedSectionFlashTimer;

			constructor(view: EditorView) {
				this.flashTimer = new ManagedSectionFlashTimer(view.dom.win);
				this.decorations = buildDecorations(view, options, null);
			}

			update(update: ViewUpdate): void {
				let rebuild =
					update.docChanged ||
					modeChanged(update) ||
					fileChanged(update) ||
					update.transactions.some((transaction) =>
						transaction.effects.some(
							(effect) =>
								effect.is(setManagedBoundariesUnlockedEffect) ||
								effect.is(refreshManagedSectionDecorationsEffect),
							),
					);

				if (fileChanged(update)) this.flashTimer.cancel();
				for (const transaction of update.transactions) {
					for (const effect of transaction.effects) {
						if (effect.is(flashManagedSectionEffect)) {
							this.flashTarget = effect.value;
							this.scheduleFlashClear(update.view);
							rebuild = true;
						} else if (
							effect.is(clearManagedSectionFlashEffect) &&
							effect.value === this.flashCycle
						) {
							this.flashTarget = null;
							rebuild = true;
						}
					}
				}

				if (fileChanged(update)) this.flashTarget = null;
				if (rebuild) {
					this.decorations = buildDecorations(update.view, options, {
						target: this.flashTarget,
						cycle: this.flashCycle,
					});
				}
			}

			destroy(): void {
				this.flashTimer.cancel();
			}

			private scheduleFlashClear(view: EditorView): void {
				this.flashCycle = this.flashTimer.restart((cycle) => {
					view.dispatch({ effects: clearManagedSectionFlashEffect.of(cycle) });
				});
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);

	return [managedBoundariesUnlockedField, transactionFilter, decorations];
}

function buildDecorations(
	view: EditorView,
	options: ManagedSectionEditorOptions,
	flash: { target: ManagedSectionFlashTarget | null; cycle: number } | null,
): DecorationSet {
	const identity = editorIdentity(view.state);
	if (options.isPotentiallyEnabled?.(identity) === false) return Decoration.none;
	const context = editorContext(view.state, identity);
	const boundaries = scanManagedBoundaries(
		context.content,
		options.getSectionIds?.(context),
	);
	if (!isEditorEnabled(options, context, boundaries)) return Decoration.none;

	const strings = options.getStrings?.(context) ?? DEFAULT_STRINGS;
	const protectionEnabled = options.isProtectionEnabled?.(context) !== false;
	const locked = protectionEnabled && !areManagedBoundariesUnlocked(view.state);
	const ranges: Range<Decoration>[] = [];

	for (const boundary of boundaries) {
		const tooltip = locked ? strings.protectedBoundary : strings.unlockedBoundary;
		const modifier = locked ? 'is-locked' : 'is-unlocked';
		const kindClass = `is-${boundary.kind}`;
		const markerText = context.content.slice(boundary.from, boundary.to);

		ranges.push(
			Decoration.line({
				class: `snowflake-managed-boundary-line ${kindClass} ${modifier}`,
			}).range(boundary.from),
		);

		if (context.livePreview) {
			ranges.push(
				Decoration.replace({
					widget: new ManagedBoundaryCommentWidget(markerText, tooltip, locked),
				}).range(boundary.from, boundary.to),
			);
		} else {
			ranges.push(
				Decoration.mark({
					class: `snowflake-managed-boundary-source ${kindClass} ${modifier}`,
					attributes: { title: tooltip },
				}).range(boundary.from, boundary.to),
				Decoration.widget({
					widget: new ManagedBoundaryLockWidget(tooltip, locked),
					side: -1,
				}).range(boundary.from),
			);
		}
	}

	for (const section of pairManagedSections(context.content, boundaries)) {
		if (GENERATED_SECTION_IDS.has(section.sectionId)) {
			// The whole block is a generated view of the properties: tint it in
			// source mode, where the raw quote lines need the hint, and never
			// invite writing into it with the empty placeholder. Live preview
			// needs neither, since the callout already reads as one made thing.
			if (!context.livePreview) {
				for (const lineStart of lineStartsBetween(
					context.content,
					section.start.from,
					section.end.protectedTo,
				)) {
					ranges.push(
						Decoration.line({
							class: 'snowflake-managed-generated-line',
						}).range(lineStart),
					);
				}
			}
			continue;
		}
		if (section.empty && section.contentFrom < section.end.from) {
			ranges.push(
				Decoration.widget({
					widget: new EmptyManagedSectionWidget(
						strings.emptyPlaceholder,
						section.contentFrom,
					),
					side: 1,
				}).range(section.contentFrom),
			);
		}
	}

	if (flash?.target !== null && flash?.target !== undefined) {
		const highlightRanges =
			flash.target.kind === 'sections'
				? resolveManagedSectionNavigationTargets(
						context.content,
						flash.target.sectionIds,
					)
				: resolveManagedMarkerIssueNavigationTarget(
						context.content,
						flash.target.sectionId,
					)?.highlightRanges ?? null;
		if (highlightRanges !== null) {
			const cycleClass = flash.cycle % 2 === 0 ? 'is-cycle-a' : 'is-cycle-b';
			const highlightedLineStarts = new Set<number>();
			for (const target of highlightRanges) {
				for (const lineStart of managedSectionHighlightLineStarts(
					context.content,
					target,
				)) {
					highlightedLineStarts.add(lineStart);
				}
			}
			for (const lineStart of highlightedLineStarts) {
				ranges.push(
					Decoration.line({
						class: `snowflake-managed-section-focus-flash ${cycleClass}`,
					}).range(lineStart),
				);
			}
		}
	}

	return Decoration.set(ranges, true);
}

function isEditorEnabled(
	options: ManagedSectionEditorOptions,
	context: ManagedSectionEditorContext,
	boundaries: readonly ManagedBoundaryRange[],
): boolean {
	return options.isEnabled?.(context) ?? boundaries.length > 0;
}

const HUMAN_USER_EVENT_PREFIXES = [
	'input',
	'delete',
	'move',
	'paste',
	'cut',
	'drop',
	'undo',
	'redo',
] as const;

/** Whether a transaction's user event names something a person did. */
function isHumanUserEvent(userEvent: string): boolean {
	return HUMAN_USER_EVENT_PREFIXES.some(
		(prefix) => userEvent === prefix || userEvent.startsWith(`${prefix}.`),
	);
}

/** Start offsets of every line that begins inside `[from, toExclusive)`. */
function lineStartsBetween(
	content: string,
	from: number,
	toExclusive: number,
): number[] {
	const starts: number[] = [];
	let lineStart = content.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
	while (lineStart < toExclusive) {
		starts.push(lineStart);
		const next = content.indexOf('\n', lineStart);
		if (next === -1) break;
		lineStart = next + 1;
	}
	return starts;
}

function editorIdentity(state: EditorState): ManagedSectionEditorIdentity {
	const info = state.field(editorInfoField, false);
	return {
		state,
		info,
		filePath: info?.file?.path ?? null,
		livePreview: state.field(editorLivePreviewField, false) ?? false,
	};
}

function editorContext(
	state: EditorState,
	identity = editorIdentity(state),
): ManagedSectionEditorContext {
	return { ...identity, content: state.doc.toString() };
}

function modeChanged(update: ViewUpdate): boolean {
	return (
		(update.startState.field(editorLivePreviewField, false) ?? false) !==
		(update.state.field(editorLivePreviewField, false) ?? false)
	);
}

function fileChanged(update: ViewUpdate): boolean {
	return (
		update.startState.field(editorInfoField, false)?.file?.path !==
		update.state.field(editorInfoField, false)?.file?.path
	);
}

function markdownInfoContainer(info: MarkdownFileInfo): HTMLElement | null {
	const candidate = info as MarkdownFileInfo & { containerEl?: unknown };
	const container = candidate.containerEl as Partial<HTMLElement> | undefined;
	return container !== undefined &&
		container.nodeType === 1 &&
		typeof container.matches === 'function'
		? (container as HTMLElement)
		: null;
}

class ManagedBoundaryCommentWidget extends WidgetType {
	constructor(
		private readonly markerText: string,
		private readonly tooltip: string,
		private readonly locked: boolean,
	) {
		super();
	}

	eq(other: ManagedBoundaryCommentWidget): boolean {
		return (
			other.markerText === this.markerText &&
			other.tooltip === this.tooltip &&
			other.locked === this.locked
		);
	}

	toDOM(): HTMLElement {
		const element = createSpan();
		element.className = 'snowflake-managed-boundary-comment';
		element.title = this.tooltip;
		element.setAttribute('aria-label', this.tooltip);
		element.setAttribute('contenteditable', 'false');

		const icon = element.createSpan({
			cls: `snowflake-managed-boundary-lock ${
				this.locked ? 'is-locked' : 'is-unlocked'
			}`,
		});
		setIcon(icon, this.locked ? 'lock-keyhole' : 'lock-keyhole-open');
		element.createSpan({
			cls: `snowflake-managed-boundary-source ${
				this.locked ? 'is-locked' : 'is-unlocked'
			}`,
			text: this.markerText,
		});
		return element;
	}
}

class ManagedBoundaryLockWidget extends WidgetType {
	constructor(
		private readonly tooltip: string,
		private readonly locked: boolean,
	) {
		super();
	}

	eq(other: ManagedBoundaryLockWidget): boolean {
		return other.tooltip === this.tooltip && other.locked === this.locked;
	}

	toDOM(): HTMLElement {
		const element = createSpan();
		element.className = `snowflake-managed-boundary-lock ${
			this.locked ? 'is-locked' : 'is-unlocked'
		}`;
		element.title = this.tooltip;
		element.setAttribute('aria-label', this.tooltip);
		element.setAttribute('contenteditable', 'false');
		setIcon(element, this.locked ? 'lock-keyhole' : 'lock-keyhole-open');
		return element;
	}
}

class EmptyManagedSectionWidget extends WidgetType {
	constructor(
		private readonly label: string,
		private readonly position: number,
	) {
		super();
	}

	eq(other: EmptyManagedSectionWidget): boolean {
		return other.label === this.label && other.position === this.position;
	}

	toDOM(view: EditorView): HTMLElement {
		const element = createSpan();
		element.className = 'snowflake-managed-section-placeholder';
		element.textContent = this.label;
		element.tabIndex = 0;
		element.setAttribute('role', 'button');
		element.setAttribute('aria-label', this.label);
		element.setAttribute('contenteditable', 'false');

		const activate = (): void => {
			view.dispatch({
				selection: { anchor: this.position },
				scrollIntoView: true,
			});
			view.focus();
		};
		element.addEventListener('mousedown', (event) => event.preventDefault());
		element.addEventListener('click', activate);
		element.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			activate();
		});
		return element;
	}

	ignoreEvent(): boolean {
		return false;
	}
}
