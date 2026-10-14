/**
 * The gallery row of a character's, a scene's or a worldbuilding note's
 * form: the pictures the note keeps, fanned out as a coverflow with the
 * chosen one facing front and its neighbours turned away on either side. A
 * neighbour comes to the front when clicked, the arrow keys and a swipe
 * step through the row, and the front picture carries two buttons that show
 * under the pointer: the star at its left corner saying it is the main one,
 * the bin at its right corner taking it off. Pictures come in through the
 * Add button beside the row's name, from the vault or from the device. The
 * row holds what the author picked and nothing more: no file is read or
 * written until the form saves, when the draft it hands back is landed
 * beside the note.
 */

import { Notice, setIcon, setTooltip, type App, type TFile } from 'obsidian';

import { galleryLinkTarget, isImagePath, type GalleryDraft } from '../domain';
import { galleryPictureSource, resolveGalleryPicture } from './gallery-links';
import type { Translate } from './modals';

/** One picture as the row holds it: a stored link kept, a vault file picked, or a file brought from the device. */
export type GalleryFieldEntry =
	| { kind: 'kept'; link: string }
	| { kind: 'vault'; path: string }
	| { kind: 'file'; file: File };

/** What the row holds between two draws of its form, device files included. */
export interface GalleryFieldState {
	entries: GalleryFieldEntry[];
	removed: string[];
	mainIndex: number | null;
}

/** Where a picture is brought in from. */
export type GallerySource = 'vault' | 'device';

/** How far from the front a picture still stands in the fan; the rest wait out of sight. */
export const GALLERY_REACH = 2;

/** How far a pointer travels across the fan before the move counts as a swipe, in px. */
const SWIPE_PX = 32;

/** The row's first state from a note's draft: every link kept; a device file, having no form yet, cannot be carried in. */
export function galleryFieldState(draft: GalleryDraft): GalleryFieldState {
	const entries: GalleryFieldEntry[] = [];
	for (const entry of draft.entries) {
		if (entry.kind === 'kept') entries.push({ kind: 'kept', link: entry.link });
		else if (entry.kind === 'vault') entries.push({ kind: 'vault', path: entry.path });
	}
	return { entries, removed: [...draft.removed], mainIndex: draft.mainIndex };
}

export interface GalleryFieldContext {
	app: Pick<App, 'vault' | 'metadataCache'>;
	t: Translate;
	/** Where the note's stored links resolve from. */
	sourcePath: string;
	/** Offers the vault's pictures but the ones given; answers those picked, none for a dialog left. */
	pickFromVault: (exclude: ReadonlySet<string>) => Promise<TFile[]>;
	/** Asks where a picture comes from; null for a dialog left. */
	pickSource: () => Promise<GallerySource | null>;
	/** A note that cannot be written shows its pictures and offers no change. */
	readOnly?: boolean;
}

/** One picture's element and the parts a paint rewrites rather than remakes. */
interface GalleryItem {
	el: HTMLElement;
	picture: HTMLImageElement;
	missing: HTMLElement;
	missingWords: HTMLElement;
	star: HTMLButtonElement | null;
	remove: HTMLButtonElement | null;
}

const nameOfPath = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export class GalleryField {
	private readonly entries: GalleryFieldEntry[];
	private readonly removed: string[];
	private mainIndex: number | null;
	private at = 0;
	/** The address each device file is shown from, made once and let go of when the file leaves or the row is taken down. */
	private readonly urls = new Map<File, string>();
	private readonly items = new Map<GalleryFieldEntry, GalleryItem>();
	private root: HTMLElement | null = null;
	private stage: HTMLElement | null = null;
	private empty: HTMLElement | null = null;
	private counter: HTMLElement | null = null;
	private name: HTMLElement | null = null;
	private input: HTMLInputElement | null = null;
	/** Where a press on the fan began, until it lifts. */
	private swipeFrom: { x: number; pointerId: number } | null = null;
	/** When a swipe last stepped the fan, so the click that follows the lift does not step it again. */
	private swipedAt = 0;

	constructor(
		private readonly context: GalleryFieldContext,
		initial: GalleryFieldState,
	) {
		this.entries = [...initial.entries];
		this.removed = [...initial.removed];
		this.mainIndex = initial.mainIndex !== null && initial.mainIndex < this.entries.length ? initial.mainIndex : null;
	}

	attach(container: HTMLElement): void {
		const { t } = this.context;
		const readOnly = this.context.readOnly === true;
		const root = container.createDiv({
			cls: 'snowflake-method-gallery',
			attr: { role: 'group', 'aria-roledescription': 'carousel', 'aria-label': t('form.gallery'), tabindex: '0' },
		});
		root.toggleClass('is-readonly', readOnly);
		const stage = root.createDiv({ cls: 'snowflake-method-gallery-stage' });
		this.empty = stage.createDiv({ cls: 'snowflake-method-gallery-empty' });
		const emptyIcon = this.empty.createSpan({ attr: { 'aria-hidden': 'true' } });
		setIcon(emptyIcon, 'image');
		this.empty.createSpan({ text: t('form.gallery.empty') });
		const caption = root.createDiv({ cls: 'snowflake-method-gallery-caption' });
		this.name = caption.createSpan({ cls: 'snowflake-method-gallery-name' });
		this.counter = caption.createSpan({ cls: 'snowflake-method-gallery-counter' });
		if (!readOnly) {
			this.input = root.createEl('input', {
				cls: 'snowflake-method-gallery-file-input',
				attr: { type: 'file', accept: 'image/*', multiple: '', tabindex: '-1', 'aria-hidden': 'true' },
			});
			this.input.addEventListener('change', () => {
				this.takeFiles();
			});
		}
		root.addEventListener('keydown', (event) => {
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
			// A press inside a control of the row is the control's own.
			if (event.target !== root) return;
			event.preventDefault();
			this.step(event.key === 'ArrowLeft' ? -1 : 1);
		});
		// A pull across the fan steps it, the way a finger turns a row of cards.
		stage.addEventListener('pointerdown', (event) => {
			if (event.button !== 0) return;
			this.swipeFrom = { x: event.clientX, pointerId: event.pointerId };
		});
		stage.addEventListener('pointerup', (event) => {
			const from = this.swipeFrom;
			this.swipeFrom = null;
			if (from === null || from.pointerId !== event.pointerId) return;
			const travelled = event.clientX - from.x;
			if (Math.abs(travelled) < SWIPE_PX) return;
			this.swipedAt = Date.now();
			this.step(travelled < 0 ? 1 : -1);
		});
		stage.addEventListener('pointercancel', () => {
			this.swipeFrom = null;
		});
		this.root = root;
		this.stage = stage;
		this.paint();
	}

	/** What the row holds, for a form that redraws itself and builds the row again. */
	state(): GalleryFieldState {
		return { entries: [...this.entries], removed: [...this.removed], mainIndex: this.mainIndex };
	}

	/** What the row hands the save: a device file becomes bytes to read only then. */
	value(): GalleryDraft {
		return {
			entries: this.entries.map((entry) => {
				if (entry.kind === 'file') {
					const { file } = entry;
					return { kind: 'data', name: file.name, read: () => file.arrayBuffer() };
				}
				return entry;
			}),
			removed: [...this.removed],
			mainIndex: this.mainIndex,
		};
	}

	/** Asks where a picture comes from, then brings it in: from the vault's pictures, or from the device's file chooser. */
	async add(): Promise<void> {
		if (this.context.readOnly === true) return;
		const source = await this.context.pickSource();
		if (source === 'vault') await this.pickVault();
		else if (source === 'device') this.input?.click();
	}

	/** Lets go of every address a device file was shown from; the row's elements go with their form. */
	destroy(): void {
		for (const url of this.urls.values()) this.revoke(url);
		this.urls.clear();
		this.items.clear();
	}

	private step(by: number): void {
		this.show(this.at + by);
	}

	/** Brings the picture at the index to the front. */
	private show(index: number): void {
		if (this.entries.length === 0) return;
		const next = Math.min(this.entries.length - 1, Math.max(0, index));
		if (next === this.at) return;
		this.at = next;
		this.paint();
	}

	private toggleMain(index: number): void {
		if (this.entries[index] === undefined) return;
		this.mainIndex = this.mainIndex === index ? null : index;
		this.paint();
	}

	private removeAt(index: number): void {
		const entry = this.entries[index];
		if (entry === undefined) return;
		if (entry.kind === 'kept') this.removed.push(entry.link);
		if (entry.kind === 'file') {
			const url = this.urls.get(entry.file);
			if (url !== undefined) {
				this.revoke(url);
				this.urls.delete(entry.file);
			}
		}
		this.entries.splice(index, 1);
		const item = this.items.get(entry);
		if (item !== undefined) {
			item.el.remove();
			this.items.delete(entry);
		}
		if (this.mainIndex !== null) {
			if (this.mainIndex === index) this.mainIndex = null;
			else if (this.mainIndex > index) this.mainIndex -= 1;
		}
		this.at = Math.max(0, Math.min(this.at, this.entries.length - 1));
		this.paint();
	}

	private async pickVault(): Promise<void> {
		const exclude = new Set<string>();
		for (const entry of this.entries) {
			if (entry.kind === 'vault') exclude.add(entry.path);
			else if (entry.kind === 'kept') {
				const path = resolveGalleryPicture(this.context.app.metadataCache, entry.link, this.context.sourcePath)?.path;
				if (path !== undefined) exclude.add(path);
			}
		}
		const picked = await this.context.pickFromVault(exclude);
		const taken = new Set(exclude);
		let first: number | null = null;
		for (const file of picked) {
			if (taken.has(file.path)) continue;
			taken.add(file.path);
			this.entries.push({ kind: 'vault', path: file.path });
			first ??= this.entries.length - 1;
		}
		if (first === null) return;
		this.at = first;
		this.paint();
	}

	private takeFiles(): void {
		const input = this.input;
		if (input === null) return;
		let first: number | null = null;
		for (const file of Array.from(input.files ?? [])) {
			if (!isImagePath(file.name)) {
				new Notice(this.context.t('form.gallery.notPicture', { name: file.name }));
				continue;
			}
			this.entries.push({ kind: 'file', file });
			first ??= this.entries.length - 1;
		}
		// Cleared so the same file can be brought in again after being taken off.
		input.value = '';
		if (first === null) return;
		this.at = first;
		this.paint();
	}

	/** Where a device file is shown from, made on first sight. */
	private urlOf(file: File): string | null {
		const held = this.urls.get(file);
		if (held !== undefined) return held;
		if (typeof URL.createObjectURL !== 'function') return null;
		const url = URL.createObjectURL(file);
		this.urls.set(file, url);
		return url;
	}

	private revoke(url: string): void {
		if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
	}

	/** What an entry is called and where it is drawn from; no address for a picture that has gone. */
	private shown(entry: GalleryFieldEntry): { name: string; source: string | null } {
		const { app, sourcePath } = this.context;
		if (entry.kind === 'kept') {
			const file = resolveGalleryPicture(app.metadataCache, entry.link, sourcePath);
			return {
				name: file?.name ?? nameOfPath(galleryLinkTarget(entry.link) ?? entry.link),
				source: galleryPictureSource(app, entry.link, sourcePath),
			};
		}
		if (entry.kind === 'vault') {
			const file = app.vault.getFileByPath(entry.path);
			return { name: nameOfPath(entry.path), source: file === null ? null : app.vault.getResourcePath(file) };
		}
		return { name: entry.file.name, source: this.urlOf(entry.file) };
	}

	/** The element a picture stands in, built once and kept while the picture is held. */
	private itemOf(entry: GalleryFieldEntry): GalleryItem {
		const held = this.items.get(entry);
		if (held !== undefined) return held;
		const stage = this.stage;
		if (stage === null) throw new Error('The gallery row has no stage to stand a picture in.');
		const { t } = this.context;
		const el = stage.createDiv({ cls: 'snowflake-method-gallery-item' });
		// Not draggable: a pull across the picture is a swipe of the fan, which the browser's own image drag would cancel.
		const picture = el.createEl('img', {
			cls: 'snowflake-method-gallery-picture',
			attr: { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' },
		});
		const missing = el.createDiv({ cls: 'snowflake-method-gallery-missing' });
		const missingIcon = missing.createSpan({ attr: { 'aria-hidden': 'true' } });
		setIcon(missingIcon, 'image-off');
		const missingWords = missing.createSpan();
		let star: HTMLButtonElement | null = null;
		let remove: HTMLButtonElement | null = null;
		if (this.context.readOnly !== true) {
			star = el.createEl('button', {
				cls: 'clickable-icon snowflake-method-gallery-star',
				attr: { type: 'button', 'aria-pressed': 'false' },
			});
			setIcon(star, 'star');
			star.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.toggleMain(this.entries.indexOf(entry));
			});
			remove = el.createEl('button', {
				cls: 'clickable-icon snowflake-method-gallery-remove',
				attr: { type: 'button', 'aria-label': t('common.remove') },
			});
			setIcon(remove, 'trash-2');
			remove.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.removeAt(this.entries.indexOf(entry));
			});
		}
		// A neighbour comes to the front when clicked; the lift of a swipe is no click.
		el.addEventListener('click', () => {
			if (Date.now() - this.swipedAt < 400) return;
			this.show(this.entries.indexOf(entry));
		});
		const item: GalleryItem = { el, picture, missing, missingWords, star, remove };
		this.items.set(entry, item);
		return item;
	}

	private paint(): void {
		const { t } = this.context;
		const root = this.root;
		if (root === null) return;
		const count = this.entries.length;
		root.toggleClass('is-empty', count === 0);
		root.toggleClass('has-many', count > 1);
		this.empty?.toggleClass('is-hidden', count > 0);
		let frontName = '';
		this.entries.forEach((entry, index) => {
			const item = this.itemOf(entry);
			const offset = index - this.at;
			const distance = Math.abs(offset);
			const current = index === this.at;
			const main = this.mainIndex === index;
			const { name, source } = this.shown(entry);
			if (current) frontName = name;
			item.el.toggleClass('is-current', current);
			item.el.toggleClass('is-main', main);
			item.el.toggleClass('is-hidden', distance > GALLERY_REACH);
			item.el.setAttribute('data-offset', String(offset));
			item.el.setAttribute('aria-hidden', current ? 'false' : 'true');
			item.el.setCssProps({
				'--snowflake-method-gallery-offset': String(offset),
				'--snowflake-method-gallery-distance': String(distance),
			});
			if (source === null) item.picture.removeAttribute('src');
			else if (item.picture.getAttribute('src') !== source) item.picture.setAttribute('src', source);
			if (item.picture.getAttribute('alt') !== name) item.picture.setAttribute('alt', name);
			item.picture.toggleClass('is-hidden', source === null);
			item.missing.toggleClass('is-hidden', source !== null);
			if (source === null) item.missingWords.setText(t('form.gallery.missing', { name }));
			if (item.star !== null) {
				item.star.toggleClass('is-main', main);
				item.star.setAttribute('aria-pressed', main ? 'true' : 'false');
				const label = t(main ? 'form.gallery.unsetMain' : 'form.gallery.setMain');
				item.star.setAttribute('aria-label', label);
				setTooltip(item.star, label);
				item.star.tabIndex = current ? 0 : -1;
			}
			if (item.remove !== null) {
				const label = t('form.gallery.removePicture', { name });
				item.remove.setAttribute('aria-label', label);
				setTooltip(item.remove, label);
				item.remove.tabIndex = current ? 0 : -1;
			}
		});
		this.name?.setText(frontName);
		if (this.counter !== null) {
			this.counter.setText(count === 0 ? '' : t('form.gallery.counter', { at: this.at + 1, count }));
			this.counter.toggleClass('is-hidden', count < 2);
		}
	}
}
