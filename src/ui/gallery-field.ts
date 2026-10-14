/**
 * The gallery row of a character's, a scene's or a worldbuilding note's
 * form: the pictures the note keeps, one at a time in a square frame, stepped
 * through with the arrows at its sides, the star at its corner saying which
 * is the main one, and under it the ways to bring a picture in, from the
 * vault or from the device, and to take the shown one off. The row holds
 * what the author picked and nothing more: no file is read or written until
 * the form saves, when the draft it hands back is landed beside the note.
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
	/** A note that cannot be written shows its pictures and offers no change. */
	readOnly?: boolean;
}

const nameOfPath = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export class GalleryField {
	private readonly entries: GalleryFieldEntry[];
	private readonly removed: string[];
	private mainIndex: number | null;
	private at = 0;
	/** The address each device file is shown from, made once and let go of when the file leaves or the row is taken down. */
	private readonly urls = new Map<File, string>();
	private root: HTMLElement | null = null;
	private picture: HTMLImageElement | null = null;
	private empty: HTMLElement | null = null;
	private missing: HTMLElement | null = null;
	private missingWords: HTMLElement | null = null;
	private star: HTMLButtonElement | null = null;
	private prev: HTMLButtonElement | null = null;
	private next: HTMLButtonElement | null = null;
	private counter: HTMLElement | null = null;
	private name: HTMLElement | null = null;
	private remove: HTMLButtonElement | null = null;
	private input: HTMLInputElement | null = null;

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
			attr: { role: 'group', 'aria-label': t('form.gallery'), tabindex: '0' },
		});
		root.toggleClass('is-readonly', readOnly);
		const stack = root.createDiv({ cls: 'snowflake-method-gallery-stack' });
		const frame = stack.createDiv({ cls: 'snowflake-method-gallery-frame' });
		this.picture = frame.createEl('img', {
			cls: 'snowflake-method-gallery-picture',
			attr: { alt: '', loading: 'lazy' },
		});
		this.empty = frame.createDiv({ cls: 'snowflake-method-gallery-empty' });
		const emptyIcon = this.empty.createSpan({ attr: { 'aria-hidden': 'true' } });
		setIcon(emptyIcon, 'image');
		this.empty.createSpan({ text: t('form.gallery.empty') });
		this.missing = frame.createDiv({ cls: 'snowflake-method-gallery-missing' });
		const missingIcon = this.missing.createSpan({ attr: { 'aria-hidden': 'true' } });
		setIcon(missingIcon, 'image-off');
		this.missingWords = this.missing.createSpan();
		if (!readOnly) {
			this.star = frame.createEl('button', {
				cls: 'clickable-icon snowflake-method-gallery-star',
				attr: { type: 'button', 'aria-pressed': 'false' },
			});
			setIcon(this.star, 'star');
			this.star.addEventListener('click', (event) => {
				event.preventDefault();
				this.toggleMain();
			});
		}
		this.prev = frame.createEl('button', {
			cls: 'clickable-icon snowflake-method-gallery-prev',
			attr: { type: 'button', 'aria-label': t('form.gallery.previous') },
		});
		setIcon(this.prev, 'chevron-left');
		setTooltip(this.prev, t('form.gallery.previous'));
		this.prev.addEventListener('click', (event) => {
			event.preventDefault();
			this.step(-1);
		});
		this.next = frame.createEl('button', {
			cls: 'clickable-icon snowflake-method-gallery-next',
			attr: { type: 'button', 'aria-label': t('form.gallery.next') },
		});
		setIcon(this.next, 'chevron-right');
		setTooltip(this.next, t('form.gallery.next'));
		this.next.addEventListener('click', (event) => {
			event.preventDefault();
			this.step(1);
		});
		this.counter = frame.createSpan({ cls: 'snowflake-method-gallery-counter' });
		this.name = root.createDiv({ cls: 'snowflake-method-gallery-name' });
		if (!readOnly) {
			const actions = root.createDiv({ cls: 'snowflake-method-gallery-actions' });
			const fromVault = actions.createEl('button', {
				cls: 'snowflake-method-gallery-add-vault',
				text: t('form.gallery.addFromVault'),
				attr: { type: 'button' },
			});
			fromVault.addEventListener('click', (event) => {
				event.preventDefault();
				void this.pickVault();
			});
			const fromDevice = actions.createEl('button', {
				cls: 'snowflake-method-gallery-add-device',
				text: t('form.gallery.addFromDevice'),
				attr: { type: 'button' },
			});
			this.input = actions.createEl('input', {
				cls: 'snowflake-method-gallery-file-input',
				attr: { type: 'file', accept: 'image/*', multiple: '', tabindex: '-1', 'aria-hidden': 'true' },
			});
			this.input.addEventListener('change', () => {
				this.takeFiles();
			});
			fromDevice.addEventListener('click', (event) => {
				event.preventDefault();
				this.input?.click();
			});
			this.remove = actions.createEl('button', {
				cls: 'snowflake-method-gallery-remove',
				text: t('common.remove'),
				attr: { type: 'button' },
			});
			this.remove.addEventListener('click', (event) => {
				event.preventDefault();
				this.removeShown();
			});
		}
		root.addEventListener('keydown', (event) => {
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
			// A press inside a control of the row is the control's own.
			if (event.target !== root) return;
			event.preventDefault();
			this.step(event.key === 'ArrowLeft' ? -1 : 1);
		});
		this.root = root;
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

	/** Lets go of every address a device file was shown from; the row's elements go with their form. */
	destroy(): void {
		for (const url of this.urls.values()) this.revoke(url);
		this.urls.clear();
	}

	private step(by: number): void {
		if (this.entries.length === 0) return;
		const next = Math.min(this.entries.length - 1, Math.max(0, this.at + by));
		if (next === this.at) return;
		this.at = next;
		this.paint();
	}

	private toggleMain(): void {
		if (this.entries.length === 0) return;
		this.mainIndex = this.mainIndex === this.at ? null : this.at;
		this.paint();
	}

	private removeShown(): void {
		const entry = this.entries[this.at];
		if (entry === undefined) return;
		if (entry.kind === 'kept') this.removed.push(entry.link);
		if (entry.kind === 'file') {
			const url = this.urls.get(entry.file);
			if (url !== undefined) {
				this.revoke(url);
				this.urls.delete(entry.file);
			}
		}
		this.entries.splice(this.at, 1);
		if (this.mainIndex !== null) {
			if (this.mainIndex === this.at) this.mainIndex = null;
			else if (this.mainIndex > this.at) this.mainIndex -= 1;
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

	/** What the shown entry is called and where it is drawn from; no address for a picture that has gone. */
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

	private paint(): void {
		const { t } = this.context;
		const root = this.root;
		if (root === null) return;
		const count = this.entries.length;
		const entry = this.entries[this.at];
		root.toggleClass('is-empty', count === 0);
		root.toggleClass('has-stack', count > 1);
		const { name, source } = entry === undefined ? { name: '', source: null } : this.shown(entry);
		if (this.picture !== null) {
			if (source === null) this.picture.removeAttribute('src');
			else if (this.picture.getAttribute('src') !== source) this.picture.setAttribute('src', source);
			this.picture.setAttribute('alt', name);
			this.picture.toggleClass('is-hidden', source === null);
		}
		this.empty?.toggleClass('is-hidden', count > 0);
		this.missing?.toggleClass('is-hidden', entry === undefined || source !== null);
		if (entry !== undefined && source === null && this.missingWords !== null) {
			this.missingWords.setText(t('form.gallery.missing', { name }));
		}
		if (this.star !== null) {
			const main = entry !== undefined && this.mainIndex === this.at;
			this.star.toggleClass('is-main', main);
			this.star.setAttribute('aria-pressed', main ? 'true' : 'false');
			const label = t(main ? 'form.gallery.unsetMain' : 'form.gallery.setMain');
			this.star.setAttribute('aria-label', label);
			setTooltip(this.star, label);
			this.star.toggleClass('is-hidden', count === 0);
		}
		if (this.prev !== null) {
			this.prev.disabled = this.at <= 0;
			this.prev.toggleClass('is-hidden', count < 2);
		}
		if (this.next !== null) {
			this.next.disabled = this.at >= count - 1;
			this.next.toggleClass('is-hidden', count < 2);
		}
		if (this.counter !== null) {
			this.counter.setText(count === 0 ? '' : t('form.gallery.counter', { at: this.at + 1, count }));
			this.counter.toggleClass('is-hidden', count < 2);
		}
		this.name?.setText(name);
		if (this.remove !== null) {
			this.remove.disabled = entry === undefined;
			this.remove.setAttribute('aria-label', entry === undefined ? t('common.remove') : t('form.gallery.removePicture', { name }));
		}
	}
}
