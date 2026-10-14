import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Setting: class extends runtime.Setting {
			settingEl: CorkboardElement;
			infoEl: CorkboardElement;
			nameEl: CorkboardElement;
			controlEl: CorkboardElement;
			constructor(container: CorkboardElement) {
				super();
				this.settingEl = container.createDiv();
				this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
				this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
				this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
			}
		},
	};
});

import { galleryDraftOf, type GalleryDraft } from '../../src/domain';
import { galleryFieldState, type GalleryField } from '../../src/ui/gallery-field';
import { CreateCharacterModal, CreateSceneModal, EntityFormModal, type MemberFormContext } from '../../src/ui/modals';

const link = '[[Demo/20_Character/25_Gallery/portrait.png]]';
const app = {
	vault: {
		getFileByPath: () => null,
		getResourcePath: (file: { path: string }) => `app://fake/${file.path}`,
		getFiles: () => [],
	},
	metadataCache: {
		getFirstLinkpathDest: (target: string) => (target.endsWith('portrait.png') ? { path: target, name: 'portrait.png' } : null),
	},
} as unknown as App;

type Internals = {
	galleryField: GalleryField | null;
	galleryState: ReturnType<typeof galleryFieldState>;
	value: { gallery?: GalleryDraft };
	buildGallery(): void;
	syncEditors(): void;
};

function build(prototype: object, fields: Record<string, unknown>) {
	const dom = new CorkboardDom();
	const instance = Object.create(prototype) as Internals;
	Object.assign(instance, {
		app,
		contentEl: dom.container,
		t: (key: string) => key,
		galleryField: null,
		galleryState: galleryFieldState(galleryDraftOf([link], link)),
		value: {},
		aliasesField: null, categoryField: null, worldStatusEditor: null, relationshipsEditor: null,
		...fields,
	});
	instance.buildGallery();
	return { dom, instance };
}

const context = { projectPath: 'Demo/00_System/001_Project_Metadata.md' } as unknown as MemberFormContext;

describe('the gallery row of the member forms', () => {
	it('stands in the character form as a full-width setting named Gallery, with the way in beside the name', () => {
		const { dom, instance } = build(CreateCharacterModal.prototype, { formContext: context });
		const row = dom.container.querySelector('.snowflake-method-character-gallery-setting');
		expect(row?.classes.has('snowflake-method-character-setting')).toBe(true);
		const picture = row?.querySelector('.snowflake-method-gallery-picture');
		expect(picture?.getAttribute('src')).toBe('app://fake/Demo/20_Character/25_Gallery/portrait.png');
		const add = row?.querySelector('.snowflake-method-gallery-add');
		expect(add?.textContent).toBe('common.add');
		expect(add?.parent?.classes.has('setting-item-info')).toBe(true);
		expect(row?.querySelector('.setting-item-control')?.querySelector('.snowflake-method-gallery')).not.toBeNull();
		expect(instance.galleryField).not.toBeNull();
		instance.syncEditors();
		expect(instance.value.gallery).toEqual(galleryDraftOf([link], link));
	});

	it('is left out of a character form opened without a project context', () => {
		const { dom, instance } = build(CreateCharacterModal.prototype, { formContext: undefined });
		expect(dom.container.querySelector('.snowflake-method-gallery')).toBeNull();
		expect(instance.galleryField).toBeNull();
		instance.syncEditors();
		expect(instance.value.gallery).toBeUndefined();
	});

	it('wears the scene form classes in the scene form and carries the row state across a redraw', () => {
		const { dom, instance } = build(CreateSceneModal.prototype, { formContext: context });
		const row = dom.container.querySelector('.snowflake-method-scene-gallery-setting');
		expect(row?.classes.has('snowflake-method-scene-setting')).toBe(true);
		row!.querySelector('.snowflake-method-gallery-star')!.dispatch('click');
		instance.syncEditors();
		expect(instance.galleryState.mainIndex).toBeNull();
		expect(instance.galleryField?.value().mainIndex).toBeNull();
	});

	it('stands in the worldbuilding form under the character form classes', () => {
		const { dom } = build(EntityFormModal.prototype, { formContext: context });
		const row = dom.container.querySelector('.snowflake-method-character-gallery-setting');
		expect(row).not.toBeNull();
		expect(row?.querySelector('.snowflake-method-gallery-add')).not.toBeNull();
		expect(row?.querySelector('.snowflake-method-gallery-remove')).not.toBeNull();
	});
});
