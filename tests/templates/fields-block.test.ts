import { describe, expect, it } from 'vitest';

import {
	renderCharacterFieldsBlock,
	renderEntityFieldsBlock,
	renderSceneFieldsBlock,
} from '../../src/templates';

const COMMON = {
	progressStatus: null,
	aliases: [],
	categories: [],
} as const;

const CHARACTER = {
	...COMMON,
	categories: ['Character/Supporting'],
	oneSentenceStoryline: 'A smuggler trades her ship for a crown.',
	motivation: 'To belong somewhere.',
	goal: 'Take the harbor.',
	conflict: 'The fleet stands in the way.',
	growth: 'Learns to ask for help.',
};

describe('renderCharacterFieldsBlock', () => {
	it('renders an info callout with every valued field labeled in order', () => {
		const block = renderCharacterFieldsBlock('en', CHARACTER);
		expect(block).toBe(
			[
				'> [!info] Character overview',
				'> **Category**: Character/Supporting',
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

	it('shows the universal lines when they hold values', () => {
		const block = renderCharacterFieldsBlock('en', {
			...CHARACTER,
			progressStatus: 'in-progress',
			aliases: ['The Gull', 'Captain A'],
			categories: [
				'[[Novel/60_Worldbuilding/Category#Major|Character/Major]]',
				'[[Novel/60_Worldbuilding/Category#Elf|Character/Race/Elf]]',
			],
		});
		expect(block).toContain('> **Progress status**: In progress');
		expect(block).toContain('> **Aliases**: The Gull, Captain A');
		expect(block).toContain(
			'> **Category**: [[Novel/60_Worldbuilding/Category#Major|Character/Major]], [[Novel/60_Worldbuilding/Category#Elf|Character/Race/Elf]]',
		);
	});

	it('localizes labels and status in Chinese', () => {
		const block = renderCharacterFieldsBlock('zh-CN', {
			...CHARACTER,
			progressStatus: 'complete',
			categories: ['角色/主角'],
		});
		expect(block).toContain('> [!info] 角色概览');
		expect(block).toContain('> **进度**：已完成');
		expect(block).toContain('> **类别**：角色/主角');
		expect(block).toContain(
			'> **一句话故事概述**：A smuggler trades her ship for a crown.',
		);
	});

	it('hides a field whose value is empty', () => {
		const block = renderCharacterFieldsBlock('en', {
			...CHARACTER,
			motivation: '',
		});
		expect(block).not.toContain('Motivation');
		expect(block).toContain('> **Goal**: Take the harbor.');
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
		...COMMON,
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

	it('collapses to the bare title when nothing is chosen', () => {
		const block = renderSceneFieldsBlock('en', {
			...COMMON,
			pov: null,
			time: '',
			location: '',
			conflict: '',
			cast: [],
		});
		expect(block).toBe('> [!info] Scene overview');
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

describe('renderEntityFieldsBlock', () => {
	it('shows a period as start and end after the kind', () => {
		const block = renderEntityFieldsBlock('en', 'time', {
			...COMMON,
			progressStatus: 'in-progress',
			description: 'The three months the capital starved.',
			time: {
				kind: 'period',
				start: '[[Novel/60_Worldbuilding/61_Time/1024-03]]',
				end: '[[Novel/60_Worldbuilding/61_Time/1024-06]]',
			},
		});
		expect(block).toBe(
			[
				'> [!info] Time overview',
				'> **Progress status**: In progress',
				'>',
				'> **Type**: Period',
				'>',
				'> **Start**: [[Novel/60_Worldbuilding/61_Time/1024-03]]',
				'>',
				'> **End**: [[Novel/60_Worldbuilding/61_Time/1024-06]]',
				'>',
				'> **Description**: The three months the capital starved.',
			].join('\n'),
		);
	});

	it('shows an event with a single time as when', () => {
		const block = renderEntityFieldsBlock('zh-CN', 'time', {
			...COMMON,
			description: '',
			time: {
				kind: 'event',
				start: '[[小说/60_世界观/61_时间/1024-05]]',
				end: '',
			},
		});
		expect(block).toContain('> **类型**：事件');
		expect(block).toContain('> **时间**：[[小说/60_世界观/61_时间/1024-05]]');
		expect(block).not.toContain('**开始**');
	});

	it('keeps a location to its universal lines', () => {
		const block = renderEntityFieldsBlock('en', 'location', {
			...COMMON,
			aliases: ['The Old Port'],
			categories: ['[[Novel/60_Worldbuilding/Category#City|Location/City]]'],
			description: 'A harbor city.',
			time: null,
		});
		expect(block).toBe(
			[
				'> [!info] Location overview',
				'> **Aliases**: The Old Port',
				'>',
				'> **Category**: [[Novel/60_Worldbuilding/Category#City|Location/City]]',
				'>',
				'> **Description**: A harbor city.',
			].join('\n'),
		);
	});

	it('titles each kind in the project language', () => {
		expect(
			renderEntityFieldsBlock('zh-CN', 'item', {
				...COMMON,
				description: '',
				time: null,
			}),
		).toBe('> [!info] 物品概览');
	});
});
