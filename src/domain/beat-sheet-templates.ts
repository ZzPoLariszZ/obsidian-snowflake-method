/**
 * The beat sheets the plugin ships as presets: the acts and beats a new
 * sheet may start from, and nothing more than a start, since the author
 * edits the sheet freely once it is made. They are stated here rather than
 * stored, so a project's file holds only what its author saved.
 *
 * The words are kept in both of the plugin's languages side by side and
 * chosen by the PROJECT's language, as the first timeline view's name and a
 * character tree's starter names are: once written they are the author's
 * data, standing in the author's file among the rest of the project's words,
 * whatever language the interface happens to speak. They are the published
 * names of each structure's parts, capitalised as their authors capitalise
 * them, which is also why they are not interface strings.
 */

import type { BeatSheetStructure } from './beat-sheet';

export const BUILT_IN_BEAT_SHEET_TEMPLATE_IDS = [
	'blank',
	'three-act',
	'kishotenketsu',
	'story-circle',
	'save-the-cat',
	'heros-journey',
	'romancing-the-beat',
] as const;
export type BuiltInBeatSheetTemplateId = (typeof BUILT_IN_BEAT_SHEET_TEMPLATE_IDS)[number];

export function isBuiltInBeatSheetTemplateId(value: unknown): value is BuiltInBeatSheetTemplateId {
	return (BUILT_IN_BEAT_SHEET_TEMPLATE_IDS as readonly unknown[]).includes(value);
}

export type BeatSheetTemplateLanguage = 'en' | 'zh-CN';

export interface BuiltInBeatSheetTemplate {
	readonly id: BuiltInBeatSheetTemplateId;
	readonly name: string;
	readonly structure: BeatSheetStructure;
}

/** One preset's words: its name, then each act's label ('' for an act that wears its number alone) over its beats' names. */
interface PresetWords {
	readonly name: string;
	readonly acts: readonly (readonly [label: string, beats: readonly string[]])[];
}

const COPY: Readonly<Record<BeatSheetTemplateLanguage, Readonly<Record<BuiltInBeatSheetTemplateId, PresetWords>>>> = {
	en: {
		blank: { name: 'Blank', acts: [] },
		'three-act': {
			name: 'Three Act',
			acts: [
				['Setup', ['Setup', 'Inciting Incident', 'First Turning Point']],
				['Confrontation', ['Rising Action', 'Midpoint', 'Crisis', 'Second Turning Point']],
				['Resolution', ['Pre-Climax', 'Climax', 'Denouement']],
			],
		},
		kishotenketsu: {
			name: 'Kishōtenketsu',
			acts: [
				['Ki (Introduction)', []],
				['Shō (Development)', []],
				['Ten (Turn)', []],
				['Ketsu (Conclusion)', []],
			],
		},
		'story-circle': {
			name: 'Story Circle',
			acts: [
				['', ['You', 'Need']],
				['', ['Go', 'Search', 'Find', 'Take']],
				['', ['Return', 'Change']],
			],
		},
		'save-the-cat': {
			name: 'Save the Cat',
			acts: [
				['', ['Opening Image', 'Theme Stated', 'Setup', 'Catalyst', 'Debate']],
				['', ['Break into Two', 'B Story', 'Fun and Games', 'Midpoint', 'Bad Guys Close In', 'All Is Lost', 'Dark Night of the Soul']],
				['', ['Break into Three', 'Finale', 'Final Image']],
			],
		},
		'heros-journey': {
			name: 'Hero’s Journey',
			acts: [
				['Departure', ['Ordinary World', 'Call to Adventure', 'Refusal of the Call', 'Meeting with the Mentor', 'Crossing the First Threshold']],
				['Initiation', ['Tests, Allies, and Enemies', 'Approach to the Inmost Cave', 'Ordeal', 'Reward']],
				['Return', ['The Road Back', 'Resurrection', 'Return with the Elixir']],
			],
		},
		'romancing-the-beat': {
			name: 'Romancing the Beat',
			acts: [
				['Set Up', ['Introduce H1', 'Introduce H2', 'Meet Cute', 'No Way 1', 'Adhesion']],
				['Falling in Love', ['No Way 2', 'Inkling of Desire', 'Deepening Desire', 'Maybe This Could Work', 'Midpoint of Love']],
				['Retreating from Love', ['Inkling of Doubt', 'Deepening of Doubt', 'Retreat', 'Shields Up', 'Break Up']],
				['Fighting for Love', ['Dark Night', 'Wake Up', 'Grand Gesture', 'What Whole-Hearted Looks Like', 'Epilogue']],
			],
		},
	},
	'zh-CN': {
		blank: { name: '空白', acts: [] },
		'three-act': {
			name: '三幕式',
			acts: [
				['建置', ['建置', '激励事件', '第一转折点']],
				['对抗', ['上升动作', '中点', '危机', '第二转折点']],
				['结局', ['高潮前夕', '高潮', '尾声']],
			],
		},
		kishotenketsu: {
			name: '起承转合',
			acts: [
				['起', []],
				['承', []],
				['转', []],
				['合', []],
			],
		},
		'story-circle': {
			name: '故事圈',
			acts: [
				['', ['你', '需要']],
				['', ['出发', '探索', '发现', '代价']],
				['', ['回归', '改变']],
			],
		},
		'save-the-cat': {
			name: '救猫咪',
			acts: [
				['', ['开场画面', '主题呈现', '铺垫', '催化剂', '争论']],
				['', ['第二幕衔接点', 'B 故事', '游戏', '中点', '坏人逼近', '一无所有', '灵魂黑夜']],
				['', ['第三幕衔接点', '结局', '终场画面']],
			],
		},
		'heros-journey': {
			name: '英雄之旅',
			acts: [
				['启程', ['正常世界', '冒险召唤', '拒斥召唤', '见导师', '越过第一道边界']],
				['启蒙', ['考验、伙伴、敌人', '接近最深的洞穴', '磨难', '报酬']],
				['归来', ['返回的路', '复活', '携万能药回归']],
			],
		},
		'romancing-the-beat': {
			name: '言情节拍',
			acts: [
				['铺垫', ['介绍 H1', '介绍 H2', '浪漫邂逅', '绝无可能 1', '羁绊']],
				['坠入爱河', ['绝无可能 2', '渴望萌生', '渴望加深', '也许可行', '爱情中点']],
				['退离爱情', ['疑虑萌生', '疑虑加深', '退缩', '筑起心防', '分手']],
				['为爱而战', ['暗夜', '醒悟', '盛大之举', '全心全意的模样', '尾声']],
			],
		},
	},
};

const presetOf = (language: BeatSheetTemplateLanguage, id: BuiltInBeatSheetTemplateId): BuiltInBeatSheetTemplate => {
	const words = COPY[language][id];
	return {
		id,
		name: words.name,
		structure: {
			// A preset says what each beat is called and leaves what it is for to the author.
			acts: words.acts.map(([label, beats]) => ({
				label,
				beats: beats.map((name) => ({ name, description: '' })),
			})),
		},
	};
};

/** One preset in a project's language. */
export function builtInBeatSheetTemplate(
	language: BeatSheetTemplateLanguage,
	id: BuiltInBeatSheetTemplateId,
): BuiltInBeatSheetTemplate {
	return presetOf(language, id);
}

/** Every preset in a project's language, in the order they are offered. */
export function builtInBeatSheetTemplates(language: BeatSheetTemplateLanguage): BuiltInBeatSheetTemplate[] {
	return BUILT_IN_BEAT_SHEET_TEMPLATE_IDS.map((id) => presetOf(language, id));
}
