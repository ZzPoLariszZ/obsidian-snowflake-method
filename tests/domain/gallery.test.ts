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
