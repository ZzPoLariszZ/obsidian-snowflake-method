import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';

import { galleryDraftOf } from '../../src/domain';
import {
	GalleryField,
	galleryFieldState,
	type GalleryFieldContext,
	type GalleryFieldState,
} from '../../src/ui/gallery-field';
import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

const t = (key: string, vars?: Record<string, string | number>): string =>
	vars === undefined ? key : `${key}:${Object.values(vars).join('/')}`;

/** As much of a vault file as the row reads. */
interface FakeFile {
	path: string;
	name: string;
	stat: { mtime: number };
}

const portrait = '[[Demo/20_Character/25_Gallery/portrait.png]]';
const map = '[[Demo/20_Character/25_Gallery/map.png]]';
const files = new Map<string, FakeFile>([
	['Demo/20_Character/25_Gallery/portrait.png', { path: 'Demo/20_Character/25_Gallery/portrait.png', name: 'portrait.png', stat: { mtime: 3 } }],
	['Demo/20_Character/25_Gallery/map.png', { path: 'Demo/20_Character/25_Gallery/map.png', name: 'map.png', stat: { mtime: 4 } }],
	['Demo/80_Material/sketch.jpg', { path: 'Demo/80_Material/sketch.jpg', name: 'sketch.jpg', stat: { mtime: 5 } }],
]);
const app = {
	vault: {
		getFileByPath: (path: string) => files.get(path) ?? null,
		getResourcePath: (file: FakeFile) => `app://fake/${file.path}`,
	},
	metadataCache: {
		getFirstLinkpathDest: (target: string) => files.get(target) ?? null,
	},
} as unknown as Pick<App, 'vault' | 'metadataCache'>;

function mount(state: GalleryFieldState, options: { readOnly?: boolean; pick?: (exclude: ReadonlySet<string>) => Promise<FakeFile[]> } = {}) {
	const dom = new CorkboardDom();
	const pickFromVault = vi.fn(options.pick ?? (() => Promise.resolve([])));
	const field = new GalleryField(
		{
			app,
			t,
			sourcePath: 'Demo/20_Character/Alice.md',
			pickFromVault: pickFromVault as unknown as GalleryFieldContext['pickFromVault'],
			...(options.readOnly === undefined ? {} : { readOnly: options.readOnly }),
		},
		state,
	);
	field.attach(dom.container as unknown as HTMLElement);
	const one = (cls: string): CorkboardElement => {
		const found = dom.container.querySelector(`.${cls}`);
		if (found === null) throw new Error(`no .${cls}`);
		return found;
	};
	return {
		dom,
		field,
		pickFromVault,
		root: () => one('snowflake-method-gallery'),
		picture: () => one('snowflake-method-gallery-picture'),
		empty: () => one('snowflake-method-gallery-empty'),
		missing: () => one('snowflake-method-gallery-missing'),
		star: () => one('snowflake-method-gallery-star'),
		prev: () => one('snowflake-method-gallery-prev'),
		next: () => one('snowflake-method-gallery-next'),
		counter: () => one('snowflake-method-gallery-counter'),
		name: () => one('snowflake-method-gallery-name'),
		remove: () => one('snowflake-method-gallery-remove'),
		input: () => one('snowflake-method-gallery-file-input'),
		key: (key: string) => {
			const root = one('snowflake-method-gallery');
			for (const listener of root.listeners.get('keydown') ?? []) {
				(listener as unknown as (event: { key: string; target: CorkboardElement; preventDefault(): void }) => void)({
					key, target: root, preventDefault: () => undefined,
				});
			}
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GalleryField', () => {
	it('shows the empty state with nothing to step or star', () => {
		const shown = mount(galleryFieldState(galleryDraftOf([], null)));
		expect(shown.root().classes.has('is-empty')).toBe(true);
		expect(shown.empty().classes.has('is-hidden')).toBe(false);
		expect(shown.picture().classes.has('is-hidden')).toBe(true);
		expect(shown.star().classes.has('is-hidden')).toBe(true);
		expect(shown.prev().classes.has('is-hidden')).toBe(true);
		expect(shown.remove().disabled).toBe(true);
		expect(shown.field.value()).toEqual({ entries: [], removed: [], mainIndex: null });
	});

	it('shows the stored pictures one at a time and steps with the arrows and the keys', () => {
		const shown = mount(galleryFieldState(galleryDraftOf([portrait, map], map)));
		expect(shown.root().classes.has('has-stack')).toBe(true);
		expect(shown.picture().getAttribute('src')).toBe('app://fake/Demo/20_Character/25_Gallery/portrait.png');
		expect(shown.picture().getAttribute('alt')).toBe('portrait.png');
		expect(shown.name().textContent).toBe('portrait.png');
		expect(shown.counter().textContent).toBe('form.gallery.counter:1/2');
		expect(shown.prev().disabled).toBe(true);
		expect(shown.next().disabled).toBe(false);
		expect(shown.star().getAttribute('aria-pressed')).toBe('false');

		shown.next().dispatch('click');
		expect(shown.picture().getAttribute('src')).toBe('app://fake/Demo/20_Character/25_Gallery/map.png');
		expect(shown.counter().textContent).toBe('form.gallery.counter:2/2');
		expect(shown.next().disabled).toBe(true);
		expect(shown.star().getAttribute('aria-pressed')).toBe('true');
		expect(shown.star().classes.has('is-main')).toBe(true);
		expect(shown.star().getAttribute('aria-label')).toBe('form.gallery.unsetMain');

		shown.key('ArrowLeft');
		expect(shown.counter().textContent).toBe('form.gallery.counter:1/2');
		shown.key('ArrowLeft');
		expect(shown.counter().textContent).toBe('form.gallery.counter:1/2');
		shown.key('ArrowRight');
		expect(shown.counter().textContent).toBe('form.gallery.counter:2/2');
	});

	it('stars the shown picture as the main one and lets it go again', () => {
		const shown = mount(galleryFieldState(galleryDraftOf([portrait, map], null)));
		shown.star().dispatch('click');
		expect(shown.field.value().mainIndex).toBe(0);
		expect(shown.star().getAttribute('aria-pressed')).toBe('true');
		shown.next().dispatch('click');
		expect(shown.star().getAttribute('aria-pressed')).toBe('false');
		shown.star().dispatch('click');
		expect(shown.field.value().mainIndex).toBe(1);
		shown.star().dispatch('click');
		expect(shown.field.value().mainIndex).toBeNull();
	});

	it('removes the shown picture, remembers a stored link taken off, and keeps the main pointed right', () => {
		const shown = mount(galleryFieldState(galleryDraftOf([portrait, map], map)));
		shown.remove().dispatch('click');
		expect(shown.field.value()).toMatchObject({
			entries: [{ kind: 'kept', link: map }],
			removed: [portrait],
			mainIndex: 0,
		});
		expect(shown.picture().getAttribute('src')).toBe('app://fake/Demo/20_Character/25_Gallery/map.png');
		expect(shown.star().getAttribute('aria-pressed')).toBe('true');
		expect(shown.root().classes.has('has-stack')).toBe(false);
		shown.remove().dispatch('click');
		expect(shown.field.value()).toEqual({ entries: [], removed: [portrait, map], mainIndex: null });
		expect(shown.root().classes.has('is-empty')).toBe(true);
		expect(shown.remove().disabled).toBe(true);
	});

	it('takes pictures from the device, refuses what is no picture, and hands their bytes to the save', async () => {
		const shown = mount(galleryFieldState(galleryDraftOf([portrait], null)));
		const input = shown.input();
		const picture = new File([new Uint8Array([1, 2, 3])], 'new.png', { type: 'image/png' });
		const words = new File(['hello'], 'notes.txt', { type: 'text/plain' });
		Object.assign(input, { files: [picture, words] });
		input.dispatch('change');
		const draft = shown.field.value();
		expect(draft.entries).toHaveLength(2);
		expect(draft.entries[1]).toMatchObject({ kind: 'data', name: 'new.png' });
		const entry = draft.entries[1];
		if (entry?.kind !== 'data') throw new Error('expected a device picture');
		expect(new Uint8Array(await entry.read())).toEqual(new Uint8Array([1, 2, 3]));
		expect(shown.counter().textContent).toBe('form.gallery.counter:2/2');
		expect(shown.name().textContent).toBe('new.png');
		expect(shown.picture().getAttribute('src')).toMatch(/^blob:/u);
		expect(input.value).toBe('');
		// The row keeps the file itself for a form that draws the row again.
		expect(shown.field.state().entries[1]).toEqual({ kind: 'file', file: picture });
	});

	it('lets go of the addresses device files were shown from', () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		const shown = mount(galleryFieldState(galleryDraftOf([], null)));
		const input = shown.input();
		Object.assign(input, { files: [new File([new Uint8Array([1])], 'one.png'), new File([new Uint8Array([2])], 'two.png')] });
		input.dispatch('change');
		shown.next().dispatch('click');
		shown.remove().dispatch('click');
		expect(revoke).toHaveBeenCalledTimes(1);
		shown.field.destroy();
		expect(revoke).toHaveBeenCalledTimes(2);
		shown.field.destroy();
		expect(revoke).toHaveBeenCalledTimes(2);
	});

	it('offers the vault its pictures but the ones held, and shows the first picked', async () => {
		const sketch = files.get('Demo/80_Material/sketch.jpg')!;
		const shown = mount(galleryFieldState(galleryDraftOf([portrait], null)), {
			pick: () => Promise.resolve([sketch, files.get('Demo/20_Character/25_Gallery/portrait.png')!]),
		});
		shown.root().querySelector('.snowflake-method-gallery-add-vault')!.dispatch('click');
		await vi.waitFor(() => expect(shown.field.value().entries).toHaveLength(2));
		expect(shown.pickFromVault).toHaveBeenCalledWith(new Set(['Demo/20_Character/25_Gallery/portrait.png']));
		expect(shown.field.value().entries[1]).toEqual({ kind: 'vault', path: 'Demo/80_Material/sketch.jpg' });
		expect(shown.picture().getAttribute('src')).toBe('app://fake/Demo/80_Material/sketch.jpg');
		expect(shown.name().textContent).toBe('sketch.jpg');
	});

	it('says when a stored picture has gone and still lets it be taken off', () => {
		const shown = mount(galleryFieldState(galleryDraftOf(['[[Demo/20_Character/25_Gallery/lost.png]]'], null)));
		expect(shown.missing().classes.has('is-hidden')).toBe(false);
		expect(shown.missing().querySelectorAll('span')[1]?.textContent).toBe('form.gallery.missing:lost.png');
		expect(shown.picture().classes.has('is-hidden')).toBe(true);
		expect(shown.picture().getAttribute('src')).toBeNull();
		shown.remove().dispatch('click');
		expect(shown.field.value().removed).toEqual(['[[Demo/20_Character/25_Gallery/lost.png]]']);
	});

	it('shows a read-only note its pictures and offers no change', () => {
		const shown = mount(galleryFieldState(galleryDraftOf([portrait, map], portrait)), { readOnly: true });
		expect(shown.root().classes.has('is-readonly')).toBe(true);
		expect(shown.dom.container.querySelector('.snowflake-method-gallery-star')).toBeNull();
		expect(shown.dom.container.querySelector('.snowflake-method-gallery-actions')).toBeNull();
		expect(shown.counter().textContent).toBe('form.gallery.counter:1/2');
		shown.next().dispatch('click');
		expect(shown.counter().textContent).toBe('form.gallery.counter:2/2');
	});
});
