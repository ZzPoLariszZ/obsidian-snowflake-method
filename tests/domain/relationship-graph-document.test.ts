import { describe, expect, it } from 'vitest';

import {
	defaultEntityGraphState,
	defaultRelationshipGraphDocument,
	forgetSceneManuscriptOptions,
	readNativeGraphOptions,
	readRelationshipGraphDocument,
	rememberSceneManuscriptOptions,
	serializeRelationshipGraphDocument,
	type NativeGraphOptions,
} from '../../src/domain';

const OPTIONS: NativeGraphOptions = {
	'collapse-filter': true,
	search: '(path:"Demo/40_Scene" OR path:"Demo/50_Manuscript")',
	showTags: false,
	showAttachments: false,
	hideUnresolved: true,
	showOrphans: true,
	'collapse-color-groups': false,
	colorGroups: [{ query: 'path:"Demo/40_Scene"', color: { a: 1, rgb: 0xe9973f } }],
	'collapse-display': true,
	showArrow: true,
	textFadeMultiplier: 0,
	nodeSizeMultiplier: 1,
	lineSizeMultiplier: 1,
	'collapse-forces': true,
	centerStrength: 0.5187,
	repelStrength: 10,
	linkStrength: 1,
	linkDistance: 250,
	scale: 1.5,
	close: false,
};

describe('the native graph options', () => {
	it('reads the fields the preset sets by shape and carries the rest', () => {
		const read = readNativeGraphOptions({ ...OPTIONS, 'collapse-local': true, scale: 'far', close: 'shut' });
		expect(read).not.toBeNull();
		expect(read).toMatchObject({
			search: OPTIONS.search,
			hideUnresolved: true,
			colorGroups: OPTIONS.colorGroups,
			linkDistance: 250,
			'collapse-filter': true,
			'collapse-local': true,
		});
		// A scale or a close of the wrong type is dropped rather than failing the whole.
		expect(read).not.toHaveProperty('scale');
		expect(read).not.toHaveProperty('close');
		expect(readNativeGraphOptions(OPTIONS)).toEqual(OPTIONS);
	});

	it('refuses an object missing a field the preset sets, and drops a colour group that will not read', () => {
		const { search: _search, ...withoutSearch } = OPTIONS;
		expect(readNativeGraphOptions(withoutSearch)).toBeNull();
		expect(readNativeGraphOptions({ ...OPTIONS, linkDistance: 'far' })).toBeNull();
		expect(readNativeGraphOptions({ ...OPTIONS, colorGroups: 'none' })).toBeNull();
		expect(readNativeGraphOptions(null)).toBeNull();
		expect(
			readNativeGraphOptions({
				...OPTIONS,
				colorGroups: [{ query: 'tag:x' }, { query: 'ok', color: { a: 1, rgb: 7 } }, 'group'],
			})?.colorGroups,
		).toEqual([{ query: 'ok', color: { a: 1, rgb: 7 } }]);
	});
});

describe('the relationship graph document', () => {
	it('starts empty, with the entity view at its defaults', () => {
		expect(defaultRelationshipGraphDocument()).toEqual({
			sceneManuscript: null,
			entities: defaultEntityGraphState(),
			strays: {},
		});
	});

	it('reads the memory of the native graph and the entity state, and keeps the keys it does not know', () => {
		const read = readRelationshipGraphDocument({
			schemaVersion: 1,
			sceneManuscript: { options: OPTIONS, rootPath: 'Demo', updatedAt: 1700 },
			entities: { display: { arrows: false } },
			laterKey: { kept: true },
		});
		expect(read).not.toBeNull();
		expect(read?.sceneManuscript).toEqual({ options: OPTIONS, rootPath: 'Demo', updatedAt: 1700 });
		expect(read?.entities.display.arrows).toBe(false);
		expect(read?.entities.filters).toEqual(defaultEntityGraphState().filters);
		expect(read?.strays).toEqual({ laterKey: { kept: true } });
	});

	it('reads a memory that will not read as none, and a missing stamp as zero', () => {
		expect(readRelationshipGraphDocument({ sceneManuscript: { options: {}, rootPath: 'Demo' } })?.sceneManuscript).toBeNull();
		expect(readRelationshipGraphDocument({ sceneManuscript: { options: OPTIONS } })?.sceneManuscript).toBeNull();
		expect(
			readRelationshipGraphDocument({ sceneManuscript: { options: OPTIONS, rootPath: 'Demo' } })?.sceneManuscript?.updatedAt,
		).toBe(0);
		expect(readRelationshipGraphDocument({})).toEqual(defaultRelationshipGraphDocument());
	});

	it('writes the known parts first and the strays after, never under a key of their own', () => {
		const held = readRelationshipGraphDocument({
			sceneManuscript: { options: OPTIONS, rootPath: 'Demo', updatedAt: 1 },
			laterKey: 7,
		});
		const written = serializeRelationshipGraphDocument(held!);
		expect(Object.keys(written)).toEqual(['sceneManuscript', 'entities', 'laterKey']);
		expect(written).not.toHaveProperty('strays');
		expect(readRelationshipGraphDocument(written)).toEqual(held);
		expect(serializeRelationshipGraphDocument(defaultRelationshipGraphDocument()).sceneManuscript).toBeNull();
	});

	it('remembers the native options once per change and forgets them once', () => {
		const empty = defaultRelationshipGraphDocument();
		const kept = rememberSceneManuscriptOptions(empty, OPTIONS, 'Demo', 5);
		expect(kept?.sceneManuscript).toEqual({ options: OPTIONS, rootPath: 'Demo', updatedAt: 5 });
		expect(rememberSceneManuscriptOptions(kept!, OPTIONS, 'Demo', 9)).toBeNull();
		expect(rememberSceneManuscriptOptions(kept!, OPTIONS, 'Novel', 9)?.sceneManuscript?.rootPath).toBe('Novel');
		expect(
			rememberSceneManuscriptOptions(kept!, { ...OPTIONS, linkDistance: 100 }, 'Demo', 9)?.sceneManuscript?.updatedAt,
		).toBe(9);
		expect(forgetSceneManuscriptOptions(kept!)?.sceneManuscript).toBeNull();
		expect(forgetSceneManuscriptOptions(empty)).toBeNull();
	});
});
