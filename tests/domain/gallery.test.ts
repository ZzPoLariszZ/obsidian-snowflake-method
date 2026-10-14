import { describe, expect, it } from 'vitest';

import { IMAGE_EXTENSIONS, fileExtensionOf, isImagePath } from '../../src/domain';

describe('fileExtensionOf', () => {
	it('reads the extension of the file name alone, lower case', () => {
		expect(fileExtensionOf('Demo/20_Character/25_Gallery/Portrait.PNG')).toBe('png');
		expect(fileExtensionOf('map.jpeg')).toBe('jpeg');
	});

	it('answers nothing for a name without one, a dot folder, or a leading dot', () => {
		expect(fileExtensionOf('Demo/80_Material/README')).toBe('');
		expect(fileExtensionOf('Demo/v1.2/notes')).toBe('');
		expect(fileExtensionOf('.hidden')).toBe('');
	});
});

describe('isImagePath', () => {
	it('knows every extension Obsidian draws as a picture', () => {
		for (const extension of IMAGE_EXTENSIONS) {
			expect(isImagePath(`a/b.${extension}`)).toBe(true);
			expect(isImagePath(`a/b.${extension.toUpperCase()}`)).toBe(true);
		}
	});

	it('refuses notes, players and bare names', () => {
		expect(isImagePath('a/b.md')).toBe(false);
		expect(isImagePath('a/b.mp4')).toBe(false);
		expect(isImagePath('a/png')).toBe(false);
	});
});

import {
	composeGallery,
	galleryCover,
	galleryDraftOf,
	galleryLinkTarget,
	galleryMainOf,
	galleryPicks,
	type GalleryDraft,
} from '../../src/domain';

const portrait = '[[Demo/20_Character/25_Gallery/portrait.png]]';
const map = '[[Demo/20_Character/25_Gallery/map.png|The map]]';

describe('galleryLinkTarget', () => {
	it('reads the path a link names and refuses words that are no link', () => {
		expect(galleryLinkTarget(portrait)).toBe('Demo/20_Character/25_Gallery/portrait.png');
		expect(galleryLinkTarget(map)).toBe('Demo/20_Character/25_Gallery/map.png');
		expect(galleryLinkTarget('portrait.png')).toBeNull();
		expect(galleryLinkTarget('[[]]')).toBeNull();
	});
});

describe('galleryMainOf', () => {
	it('answers the list entry the stored main points at, whatever its alias', () => {
		expect(galleryMainOf([portrait, map], '[[Demo/20_Character/25_Gallery/map.png]]')).toBe(map);
		expect(galleryMainOf([portrait, map], portrait)).toBe(portrait);
	});

	it('answers null for no main, a main outside the list, or a value that is no string', () => {
		expect(galleryMainOf([portrait], undefined)).toBeNull();
		expect(galleryMainOf([portrait], '[[Elsewhere/other.png]]')).toBeNull();
		expect(galleryMainOf([portrait], 7)).toBeNull();
		expect(galleryMainOf([], portrait)).toBeNull();
	});
});

describe('galleryCover', () => {
	it('shows the main picture, else the first, else nothing', () => {
		expect(galleryCover([portrait, map], map)).toBe(map);
		expect(galleryCover([portrait, map], null)).toBe(portrait);
		expect(galleryCover([], null)).toBeNull();
	});
});

describe('galleryDraftOf', () => {
	it('keeps every stored link and points the main at its entry', () => {
		expect(galleryDraftOf([portrait, map], map)).toEqual({
			entries: [{ kind: 'kept', link: portrait }, { kind: 'kept', link: map }],
			removed: [],
			mainIndex: 1,
		});
		expect(galleryDraftOf([portrait], null).mainIndex).toBeNull();
		expect(galleryDraftOf([], null)).toEqual({ entries: [], removed: [], mainIndex: null });
	});
});

describe('composeGallery', () => {
	const read = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(0));
	const draft: GalleryDraft = {
		entries: [
			{ kind: 'kept', link: portrait },
			{ kind: 'data', name: 'new.png', read },
			{ kind: 'kept', link: map },
			{ kind: 'vault', path: 'Demo/80_Material/sketch.jpg' },
		],
		removed: ['[[Demo/20_Character/25_Gallery/old.png]]'],
		mainIndex: 1,
	};

	it('lists the picks that land a file in the draft order', () => {
		expect(galleryPicks(draft)).toEqual([draft.entries[1], draft.entries[3]]);
	});

	it('interleaves kept links with the landed ones and lets the main follow its entry', () => {
		const landed = ['[[Demo/20_Character/25_Gallery/new.png]]', '[[Demo/20_Character/25_Gallery/sketch.jpg]]'];
		expect(composeGallery(draft, landed)).toEqual({
			gallery: [portrait, landed[0], map, landed[1]],
			galleryMain: landed[0],
		});
	});

	it('keeps each picture once and points the main at the surviving spelling', () => {
		const twice: GalleryDraft = {
			entries: [
				{ kind: 'kept', link: map },
				{ kind: 'vault', path: 'Demo/20_Character/25_Gallery/map.png' },
			],
			removed: [],
			mainIndex: 1,
		};
		expect(composeGallery(twice, ['[[Demo/20_Character/25_Gallery/map.png]]'])).toEqual({
			gallery: [map],
			galleryMain: map,
		});
	});

	it('drops a pick that landed nowhere and a main that pointed at it', () => {
		const short: GalleryDraft = {
			entries: [{ kind: 'kept', link: portrait }, { kind: 'data', name: 'lost.png', read }],
			removed: [],
			mainIndex: 1,
		};
		expect(composeGallery(short, [])).toEqual({ gallery: [portrait], galleryMain: null });
		expect(composeGallery({ ...short, mainIndex: null }, [])).toEqual({ gallery: [portrait], galleryMain: null });
	});
});
