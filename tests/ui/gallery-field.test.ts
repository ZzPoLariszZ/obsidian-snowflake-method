import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';

import { galleryDraftOf } from '../../src/domain';
import {
	GALLERY_CYCLE_FROM,
	GALLERY_FULL_FROM,
	GALLERY_REACH,
	GalleryField,
	galleryFieldState,
	type GalleryFieldContext,
	type GalleryFieldState,
	type GallerySource,
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
const seal = '[[Demo/20_Character/25_Gallery/seal.png]]';
const files = new Map<string, FakeFile>([
	['Demo/20_Character/25_Gallery/portrait.png', { path: 'Demo/20_Character/25_Gallery/portrait.png', name: 'portrait.png', stat: { mtime: 3 } }],
	['Demo/20_Character/25_Gallery/map.png', { path: 'Demo/20_Character/25_Gallery/map.png', name: 'map.png', stat: { mtime: 4 } }],
	['Demo/20_Character/25_Gallery/seal.png', { path: 'Demo/20_Character/25_Gallery/seal.png', name: 'seal.png', stat: { mtime: 6 } }],
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

type Listener = (event: Record<string, unknown>) => void;

function mount(
	state: GalleryFieldState,
	options: {
		readOnly?: boolean;
		pick?: (exclude: ReadonlySet<string>) => Promise<FakeFile[]>;
		source?: GallerySource | null;
	} = {},
) {
	const dom = new CorkboardDom();
	const pickFromVault = vi.fn(options.pick ?? (() => Promise.resolve([])));
	const pickSource = vi.fn(() => Promise.resolve(options.source ?? null));
	const field = new GalleryField(
		{
			app,
			t,
			sourcePath: 'Demo/20_Character/Alice.md',
			pickFromVault: pickFromVault as unknown as GalleryFieldContext['pickFromVault'],
			pickSource,
			...(options.readOnly === undefined ? {} : { readOnly: options.readOnly }),
		},
		state,
	);
	field.attach(dom.container as unknown as HTMLElement);
	const one = (cls: string, within: CorkboardElement = dom.container): CorkboardElement => {
		const found = within.querySelector(`.${cls}`);
		if (found === null) throw new Error(`no .${cls}`);
		return found;
	};
	const items = (): CorkboardElement[] => dom.container.querySelectorAll('.snowflake-method-gallery-item');
	const current = (): CorkboardElement => {
		const found = items().find((item) => item.classes.has('is-current'));
		if (found === undefined) throw new Error('no picture at the front');
		return found;
	};
	const fire = (element: CorkboardElement, type: string, event: Record<string, unknown>): void => {
		for (const listener of element.listeners.get(type) ?? []) (listener as unknown as Listener)(event);
	};
	return {
		dom,
		field,
		pickFromVault,
		pickSource,
		root: () => one('snowflake-method-gallery'),
		stage: () => one('snowflake-method-gallery-stage'),
		empty: () => one('snowflake-method-gallery-empty'),
		items,
		current,
		picture: () => one('snowflake-method-gallery-picture', current()),
		missing: () => one('snowflake-method-gallery-missing', current()),
		star: () => one('snowflake-method-gallery-star', current()),
		remove: () => one('snowflake-method-gallery-remove', current()),
		counter: () => one('snowflake-method-gallery-counter'),
		name: () => one('snowflake-method-gallery-name'),
		input: () => one('snowflake-method-gallery-file-input'),
		offsets: () => items().map((item) => item.getAttribute('data-offset')),
		key: (key: string) => {
			const root = one('snowflake-method-gallery');
			fire(root, 'keydown', { key, target: root, preventDefault: () => undefined });
		},
		swipe: (from: number, to: number) => {
			const stage = one('snowflake-method-gallery-stage');
			fire(stage, 'pointerdown', { button: 0, clientX: from, pointerId: 7 });
			fire(stage, 'pointerup', { clientX: to, pointerId: 7 });
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GalleryField', () => {
	it('shows the empty state with nothing fanned out', () => {
		const shown = mount(galleryFieldState(galleryDraftOf([], null)));
		expect(shown.root().classes.has('is-empty')).toBe(true);
		expect(shown.root().getAttribute('aria-roledescription')).toBe('carousel');
		expect(shown.empty().classes.has('is-hidden')).toBe(false);
		expect(shown.items()).toHaveLength(0);
		expect(shown.counter().textContent).toBe('');
		expect(shown.field.value()).toEqual({ entries: [], removed: [], mainIndex: null });
	});

	it('fans the stored pictures out around the front one and steps with the keys and a click', () => {
		const shown = mount(galleryFieldState(galleryDraftOf([portrait, map], map)));
		expect(shown.root().classes.has('has-many')).toBe(true);
		expect(shown.offsets()).toEqual(['0', '1']);
		expect(shown.current().styles['--snowflake-method-gallery-offset']).toBe('0');
		expect(shown.items()[1]?.styles['--snowflake-method-gallery-distance']).toBe('1');
		expect(shown.items()[1]?.getAttribute('aria-hidden')).toBe('true');
		expect(shown.picture().getAttribute('src')).toBe('app://fake/Demo/20_Character/25_Gallery/portrait.png');
		expect(shown.picture().getAttribute('alt')).toBe('portrait.png');
		expect(shown.name().textContent).toBe('portrait.png');
		expect(shown.counter().textContent).toBe('form.gallery.counter:1/2');
		expect(shown.star().getAttribute('aria-pressed')).toBe('false');

		shown.key('ArrowRight');
		expect(shown.offsets()).toEqual(['-1', '0']);
		expect(shown.picture().getAttribute('src')).toBe('app://fake/Demo/20_Character/25_Gallery/map.png');
		expect(shown.counter().textContent).toBe('form.gallery.counter:2/2');
		expect(shown.star().getAttribute('aria-pressed')).toBe('true');
		expect(shown.star().classes.has('is-main')).toBe(true);
		expect(shown.current().classes.has('is-main')).toBe(true);
		expect(shown.star().getAttribute('aria-label')).toBe('form.gallery.unsetMain');
		shown.key('ArrowRight');
		expect(shown.counter().textContent).toBe('form.gallery.counter:2/2');

		shown.key('ArrowLeft');
		expect(shown.counter().textContent).toBe('form.gallery.counter:1/2');
		// A neighbour clicked comes to the front; the front one clicked stays.
		shown.items()[1]?.dispatch('click');
		expect(shown.counter().textContent).toBe('form.gallery.counter:2/2');
		shown.items()[1]?.dispatch('click');
		expect(shown.counter().textContent).toBe('form.gallery.counter:2/2');
	});

	it('steps with a swipe across the stage and lets the lift of the swipe pass as no click', () => {
		const shown = mount(galleryFieldState(galleryDraftOf([portrait, map], null)));
		shown.swipe(200, 100);
		expect(shown.counter().textContent).toBe('form.gallery.counter:2/2');
		shown.items()[0]?.dispatch('click');
		expect(shown.counter().textContent).toBe('form.gallery.counter:2/2');
		shown.swipe(100, 200);
		expect(shown.counter().textContent).toBe('form.gallery.counter:1/2');
		// A short pull is no swipe.
		shown.swipe(100, 110);
		expect(shown.counter().textContent).toBe('form.gallery.counter:1/2');
	});

	it('keeps far pictures out of sight and brings them in as the front moves', () => {
		const links = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `[[Demo/20_Character/25_Gallery/${name}.png]]`);
		const shown = mount(galleryFieldState(galleryDraftOf(links, null)));
		const hidden = (): boolean[] => shown.items().map((item) => item.classes.has('is-hidden'));
		// Six cycle: the last two stand on the left of the first, and only the fourth waits out of sight.
		expect(hidden()).toEqual([false, false, false, true, false, false]);
		expect(GALLERY_REACH).toBe(2);
		for (let step = 0; step < 3; step += 1) shown.key('ArrowRight');
		expect(hidden()).toEqual([true, false, false, false, false, false]);
	});

	it('turns in a cycle from three pictures, three wide below five and five wide from there, and stops at the ends with two', () => {
		const five = ['a', 'b', 'c', 'd', 'e'].map((name) => `[[Demo/20_Character/25_Gallery/${name}.png]]`);
		const shown = mount(galleryFieldState(galleryDraftOf(five, null)));
		expect(GALLERY_CYCLE_FROM).toBe(3);
		expect(GALLERY_FULL_FROM).toBe(5);
		expect(shown.root().classes.has('is-cyclic')).toBe(true);
		// 4 5 [1] 2 3
		expect(shown.offsets()).toEqual(['0', '1', '2', '-2', '-1']);
		expect(shown.items().every((item) => !item.classes.has('is-hidden'))).toBe(true);
		shown.key('ArrowRight');
		// 5 1 [2] 3 4: the fourth comes round from the far left to the far right, set down out of sight on the right first.
		expect(shown.offsets()).toEqual(['-1', '0', '1', '2', '-2']);
		expect(shown.items()[3]?.styles['--snowflake-method-gallery-offset']).toBe('2');
		expect(shown.items()[3]?.classes.has('is-snapping')).toBe(false);
		shown.key('ArrowLeft');
		shown.key('ArrowLeft');
		// 3 4 [5] 1 2: before the first stands the last.
		expect(shown.counter().textContent).toBe('form.gallery.counter:5/5');
		expect(shown.offsets()).toEqual(['1', '2', '-2', '-1', '0']);
		shown.key('ArrowRight');
		expect(shown.counter().textContent).toBe('form.gallery.counter:1/5');

		const six = [...five, '[[Demo/20_Character/25_Gallery/f.png]]'];
		const more = mount(galleryFieldState(galleryDraftOf(six, null)));
		// 5 6 [1] 2 3, the fourth out of sight.
		expect(more.offsets()).toEqual(['0', '1', '2', '3', '-2', '-1']);
		expect(more.items().map((item) => item.classes.has('is-hidden'))).toEqual([false, false, false, true, false, false]);
		more.key('ArrowRight');
		// 6 1 [2] 3 4: the fifth left by the left side and waits there, whichever way round it is counted.
		expect(more.offsets()).toEqual(['-1', '0', '1', '2', '3', '-2']);
		expect(more.items().map((item) => item.classes.has('is-hidden'))).toEqual([false, false, false, false, true, false]);
		expect(more.items()[4]?.styles['--snowflake-method-gallery-offset']).toBe('-3');
		expect(more.items()[3]?.styles['--snowflake-method-gallery-offset']).toBe('2');

		// Four stand three wide and cycle: 4 [1] 2, the third out of sight; then 3 [4] 1.
		const four = mount(galleryFieldState(galleryDraftOf(five.slice(0, 4), null)));
		expect(four.root().classes.has('is-cyclic')).toBe(true);
		expect(four.offsets()).toEqual(['0', '1', '2', '-1']);
		expect(four.items().map((item) => item.classes.has('is-hidden'))).toEqual([false, false, true, false]);
		four.key('ArrowLeft');
		expect(four.counter().textContent).toBe('form.gallery.counter:4/4');
		expect(four.offsets()).toEqual(['1', '2', '-1', '0']);
		expect(four.items().map((item) => item.classes.has('is-hidden'))).toEqual([false, true, false, false]);
		expect(four.items()[1]?.styles['--snowflake-method-gallery-offset']).toBe('2');

		// Three stand three wide and cycle, the third coming round from one side to the other.
		const three = mount(galleryFieldState(galleryDraftOf(five.slice(0, 3), null)));
		expect(three.offsets()).toEqual(['0', '1', '-1']);
		expect(three.items().every((item) => !item.classes.has('is-hidden'))).toBe(true);
		three.key('ArrowRight');
		expect(three.offsets()).toEqual(['-1', '0', '1']);
		expect(three.items()[2]?.styles['--snowflake-method-gallery-offset']).toBe('1');
		three.key('ArrowRight');
		expect(three.counter().textContent).toBe('form.gallery.counter:3/3');
		expect(three.offsets()).toEqual(['1', '-1', '0']);

		// Two do not cycle: the ends stay ends.
		const two = mount(galleryFieldState(galleryDraftOf(five.slice(0, 2), null)));
		expect(two.root().classes.has('is-cyclic')).toBe(false);
		two.key('ArrowLeft');
		expect(two.counter().textContent).toBe('form.gallery.counter:1/2');
		expect(two.offsets()).toEqual(['0', '1']);
		expect(two.items().every((item) => !item.classes.has('is-hidden'))).toBe(true);
	});

	it('stars the front picture as the main one and lets it go again', () => {
		const shown = mount(galleryFieldState(galleryDraftOf([portrait, map], null)));
		shown.star().dispatch('click');
		expect(shown.field.value().mainIndex).toBe(0);
		expect(shown.star().getAttribute('aria-pressed')).toBe('true');
		shown.key('ArrowRight');
		expect(shown.star().getAttribute('aria-pressed')).toBe('false');
		shown.star().dispatch('click');
		expect(shown.field.value().mainIndex).toBe(1);
		shown.star().dispatch('click');
		expect(shown.field.value().mainIndex).toBeNull();
	});

	it('removes the front picture, remembers a stored link taken off, and keeps the main pointed right', () => {
		const shown = mount(galleryFieldState(galleryDraftOf([portrait, map], map)));
		expect(shown.remove().getAttribute('aria-label')).toBe('form.gallery.removePicture:portrait.png');
		shown.remove().dispatch('click');
		expect(shown.field.value()).toMatchObject({
			entries: [{ kind: 'kept', link: map }],
			removed: [portrait],
			mainIndex: 0,
		});
		expect(shown.items()).toHaveLength(1);
		expect(shown.picture().getAttribute('src')).toBe('app://fake/Demo/20_Character/25_Gallery/map.png');
		expect(shown.star().getAttribute('aria-pressed')).toBe('true');
		expect(shown.root().classes.has('has-many')).toBe(false);
		shown.remove().dispatch('click');
		expect(shown.field.value()).toEqual({ entries: [], removed: [portrait, map], mainIndex: null });
		expect(shown.root().classes.has('is-empty')).toBe(true);
		expect(shown.items()).toHaveLength(0);
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
		shown.key('ArrowRight');
		shown.remove().dispatch('click');
		expect(revoke).toHaveBeenCalledTimes(1);
		shown.field.destroy();
		expect(revoke).toHaveBeenCalledTimes(2);
		shown.field.destroy();
		expect(revoke).toHaveBeenCalledTimes(2);
	});

	it('asks where a picture comes from, offers the vault its pictures but the ones held, and shows the first picked', async () => {
		const sketch = files.get('Demo/80_Material/sketch.jpg')!;
		const shown = mount(galleryFieldState(galleryDraftOf([portrait], null)), {
			source: 'vault',
			pick: () => Promise.resolve([sketch, files.get('Demo/20_Character/25_Gallery/portrait.png')!]),
		});
		await shown.field.add();
		expect(shown.pickSource).toHaveBeenCalledOnce();
		expect(shown.pickFromVault).toHaveBeenCalledWith(new Set(['Demo/20_Character/25_Gallery/portrait.png']));
		expect(shown.field.value().entries[1]).toEqual({ kind: 'vault', path: 'Demo/80_Material/sketch.jpg' });
		expect(shown.picture().getAttribute('src')).toBe('app://fake/Demo/80_Material/sketch.jpg');
		expect(shown.name().textContent).toBe('sketch.jpg');
	});

	it('opens the device chooser when the device is chosen, and nothing when the asking is left', async () => {
		const shown = mount(galleryFieldState(galleryDraftOf([portrait], null)), { source: 'device' });
		const opened = vi.fn();
		Object.assign(shown.input(), { click: opened });
		await shown.field.add();
		expect(opened).toHaveBeenCalledOnce();
		expect(shown.pickFromVault).not.toHaveBeenCalled();
		const left = mount(galleryFieldState(galleryDraftOf([portrait], null)), { source: null });
		const untouched = vi.fn();
		Object.assign(left.input(), { click: untouched });
		await left.field.add();
		expect(untouched).not.toHaveBeenCalled();
		expect(left.pickFromVault).not.toHaveBeenCalled();
	});

	it('says when a stored picture has gone and still lets it be taken off', () => {
		const shown = mount(galleryFieldState(galleryDraftOf(['[[Demo/20_Character/25_Gallery/lost.png]]', seal], null)));
		expect(shown.missing().classes.has('is-hidden')).toBe(false);
		expect(shown.missing().querySelectorAll('span')[1]?.textContent).toBe('form.gallery.missing:lost.png');
		expect(shown.picture().classes.has('is-hidden')).toBe(true);
		expect(shown.picture().getAttribute('src')).toBeNull();
		shown.key('ArrowRight');
		expect(shown.missing().classes.has('is-hidden')).toBe(true);
		shown.key('ArrowLeft');
		shown.remove().dispatch('click');
		expect(shown.field.value().removed).toEqual(['[[Demo/20_Character/25_Gallery/lost.png]]']);
	});

	it('shows a read-only note its pictures and offers no change', async () => {
		const shown = mount(galleryFieldState(galleryDraftOf([portrait, map], portrait)), { readOnly: true, source: 'vault' });
		expect(shown.root().classes.has('is-readonly')).toBe(true);
		expect(shown.dom.container.querySelector('.snowflake-method-gallery-star')).toBeNull();
		expect(shown.dom.container.querySelector('.snowflake-method-gallery-remove')).toBeNull();
		expect(shown.dom.container.querySelector('.snowflake-method-gallery-file-input')).toBeNull();
		expect(shown.current().classes.has('is-main')).toBe(true);
		expect(shown.counter().textContent).toBe('form.gallery.counter:1/2');
		shown.items()[1]?.dispatch('click');
		expect(shown.counter().textContent).toBe('form.gallery.counter:2/2');
		await shown.field.add();
		expect(shown.pickSource).not.toHaveBeenCalled();
	});
});
