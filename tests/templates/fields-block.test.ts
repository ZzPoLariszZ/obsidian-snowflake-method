import { describe, expect, it } from 'vitest';

import {
	renderCharacterFieldsBlock,
	renderSceneFieldsBlock,
} from '../../src/templates';

const CHARACTER = {
	type: 'supporting',
	oneSentenceStoryline: 'A smuggler trades her ship for a crown.',
	motivation: 'To belong somewhere.',
	goal: 'Take the harbor.',
	conflict: 'The fleet stands in the way.',
	growth: 'Learns to ask for help.',
};

describe('renderCharacterFieldsBlock', () => {
	it('renders an info callout with every field labeled in order', () => {
		const block = renderCharacterFieldsBlock('en', CHARACTER);
		expect(block).toBe(
			[
				'> [!info] Character overview',
				'> **Type**: Supporting character',
				'>',
				'> **One-sentence storyline**: A smuggler trades her ship for a crown.',
				'>',
				'> **Motivation**: To belong somewhere.',
				'>',
				'> **Goal**: Take the harbor.',
				'>',
				'> **Conflict**: The fleet stands in the way.',
				'>',
				'> **Growth**: Learns to ask for help.',
			].join('\n'),
		);
	});

	it('localizes the labels and the built-in type values in Chinese', () => {
		const block = renderCharacterFieldsBlock('zh-CN', {
			...CHARACTER,
			type: 'major',
		});
		expect(block).toContain('> [!info] 角色概览');
		expect(block).toContain('> **类型**：主角');
		expect(block).toContain(
			'> **一句话故事概述**：A smuggler trades her ship for a crown.',
		);
	});

	it('shows an unknown type value verbatim instead of inventing a label', () => {
		const block = renderCharacterFieldsBlock('zh-CN', {
			...CHARACTER,
			type: 'antagonist',
		});
		expect(block).toContain('> **类型**：antagonist');
	});

	it('keeps a bare label when a value is empty', () => {
		const block = renderCharacterFieldsBlock('en', {
			...CHARACTER,
			motivation: '',
		});
		expect(block).toContain('\n> **Motivation**:\n');
		expect(block).not.toContain('**Motivation**: \n');
	});

	it('continues a multiline value as unlabeled callout lines', () => {
		const block = renderCharacterFieldsBlock('en', {
			...CHARACTER,
			growth: 'First line.\n\nSecond paragraph.',
		});
		expect(block).toContain(
			['> **Growth**: First line.', '>', '> Second paragraph.'].join('\n'),
		);
	});

	it('never emits a line outside the callout', () => {
		const block = renderCharacterFieldsBlock('en', {
			...CHARACTER,
			conflict: 'Line one\nLine two',
		});
		for (const line of block.split('\n')) {
			expect(line.startsWith('>')).toBe(true);
		}
	});
});

describe('renderSceneFieldsBlock', () => {
	const SCENE = {
		pov: {
			kind: 'character',
			path: 'Projects/Novel/20_Characters/Aria.md',
			name: 'Aria',
		},
		time: 'Dawn, third day',
		location: 'The harbor',
		conflict: 'The tide turns before the cargo is loaded.',
		cast: [
			{ path: 'Projects/Novel/20_Characters/Aria.md', name: 'Aria' },
			{ path: 'Projects/Novel/20_Characters/Brin.md', name: 'Brin' },
		],
	} as const;

	it('links the point of view and the cast without the .md suffix', () => {
		const block = renderSceneFieldsBlock('en', SCENE);
		expect(block).toContain(
			'> **Point-of-view character**: [[Projects/Novel/20_Characters/Aria|Aria]]',
		);
		expect(block).toContain(
			'> **Characters**: [[Projects/Novel/20_Characters/Aria|Aria]], [[Projects/Novel/20_Characters/Brin|Brin]]',
		);
	});

	it('joins the Chinese cast with the Chinese list separator', () => {
		const block = renderSceneFieldsBlock('zh-CN', SCENE);
		expect(block).toContain('> [!info] 场景概览');
		expect(block).toContain(
			'> **人物**：[[Projects/Novel/20_Characters/Aria|Aria]]、[[Projects/Novel/20_Characters/Brin|Brin]]',
		);
	});

	it('localizes the narrative modes', () => {
		expect(
			renderSceneFieldsBlock('en', {
				...SCENE,
				pov: { kind: 'mode', mode: 'omniscient' },
			}),
		).toContain('> **Point-of-view character**: Omniscient');
		expect(
			renderSceneFieldsBlock('zh-CN', {
				...SCENE,
				pov: { kind: 'mode', mode: 'multiple' },
			}),
		).toContain('> **视点人物**：多人视角');
	});

	it('leaves the labels bare when nothing is chosen', () => {
		const block = renderSceneFieldsBlock('en', {
			pov: null,
			time: '',
			location: '',
			conflict: '',
			cast: [],
		});
		expect(block).toBe(
			[
				'> [!info] Scene overview',
				'> **Point-of-view character**:',
				'>',
				'> **Time**:',
				'>',
				'> **Location**:',
				'>',
				'> **Characters**:',
				'>',
				'> **Conflict**:',
			].join('\n'),
		);
	});

	it('strips link-breaking characters from a display name', () => {
		const block = renderSceneFieldsBlock('en', {
			...SCENE,
			pov: {
				kind: 'character',
				path: 'Projects/Novel/20_Characters/Aria.md',
				name: 'Ari|a]]',
			},
		});
		expect(block).toContain('[[Projects/Novel/20_Characters/Aria|Aria]]');
	});
});
