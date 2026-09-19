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
 * them, which is also why they are not interface strings. Under each beat's
 * name stands a sentence on what the beat is for, which becomes the beat's
 * main description: a prompt to write over, not a rule.
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

/** The same words in both languages, English then Chinese, so one cannot be changed without the other in sight. */
type Words = readonly [en: string, zh: string];

interface PresetBeat {
	readonly name: Words;
	readonly description: Words;
}

interface PresetAct {
	/** '' in a language whose act wears its number alone. */
	readonly label: Words;
	readonly beats: readonly PresetBeat[];
}

interface Preset {
	readonly name: Words;
	readonly acts: readonly PresetAct[];
}

const beat = (en: string, zh: string, enDescription: string, zhDescription: string): PresetBeat => ({
	name: [en, zh],
	description: [enDescription, zhDescription],
});

const act = (en: string, zh: string, beats: readonly PresetBeat[] = []): PresetAct => ({ label: [en, zh], beats });

const PRESETS: Readonly<Record<BuiltInBeatSheetTemplateId, Preset>> = {
	blank: { name: ['Blank', '空白'], acts: [] },
	'three-act': {
		name: ['Three Act', '三幕式'],
		acts: [
			act('Setup', '建立', [
				beat(
					'Setup',
					'开局铺垫',
					'Introduce the protagonist, world, key relationships, and the basic situation at the beginning of the story.',
					'介绍主角、世界、主要人物关系以及故事开始时的基本状态。',
				),
				beat(
					'Inciting Incident',
					'诱发事件',
					'An event disrupts the existing balance and draws the protagonist into the story’s central problem.',
					'一个事件打破原有平衡，使主角开始卷入故事的核心问题。',
				),
				beat(
					'First Turning Point',
					'第一转折',
					'The protagonist makes a crucial choice or crosses a threshold that fully commits them to the main conflict.',
					'主角做出关键选择或跨过重要门槛，正式进入故事的主要冲突。',
				),
			]),
			act('Confrontation', '对抗', [
				beat(
					'Rising Action',
					'冲突升级',
					'The protagonist keeps pursuing the goal while facing increasingly difficult and complicated obstacles.',
					'主角不断尝试实现目标，同时面对越来越复杂和严重的阻碍。',
				),
				beat(
					'Midpoint',
					'中点转折',
					'A major event changes the protagonist’s understanding of the situation and shifts the direction or stakes of the story.',
					'一次重大事件改变主角对局势的理解，并推动故事的方向或风险发生变化。',
				),
				beat(
					'Crisis',
					'遭遇危机',
					'The protagonist suffers a serious setback that makes the previous plan or approach no longer workable.',
					'主角遭遇严重挫折，使原有计划或解决方式开始失效。',
				),
				beat(
					'Second Turning Point',
					'第二转折',
					'The protagonist finds a new direction and makes the decision that leads into the final confrontation.',
					'主角找到新的方向并做出关键决定，为最终冲突做好准备。',
				),
			]),
			act('Resolution', '解决', [
				beat(
					'Pre-Climax',
					'高潮前奏',
					'The protagonist makes the final preparations and moves toward the decisive confrontation.',
					'主角完成最后的准备，并一步步走向决定性的最终对抗。',
				),
				beat(
					'Climax',
					'高潮阶段',
					'The story’s central conflict reaches its peak and is resolved through the protagonist’s decisive action or choice.',
					'故事的核心冲突达到顶点，并通过主角的关键行动或选择得到解决。',
				),
				beat(
					'Denouement',
					'最终收束',
					'Show how the characters, relationships, and world settle into a new state after the climax.',
					'展示高潮之后人物、关系和世界最终进入了怎样的新状态。',
				),
			]),
		],
	},
	// Four movements and no beats under them: the shape names its parts and asks for nothing between.
	kishotenketsu: {
		name: ['Kishōtenketsu', '起承转合'],
		acts: [
			act('Ki (Introduction)', '起'),
			act('Shō (Development)', '承'),
			act('Ten (Turn)', '转'),
			act('Ketsu (Conclusion)', '合'),
		],
	},
	'story-circle': {
		name: ['Story Circle', '故事循环'],
		acts: [
			act('', '原有世界', [
				beat(
					'You',
					'原本的你',
					'Introduce the protagonist in a familiar and relatively stable way of life.',
					'介绍主角以及主角当前熟悉而相对稳定的生活状态。',
				),
				beat(
					'Need',
					'需求出现',
					'The protagonist realizes that something is missing and begins to want or need a change.',
					'主角意识到自己缺少某样东西，并开始产生改变现状的需求。',
				),
			]),
			act('', '进入未知', [
				beat(
					'Go',
					'出发',
					'The protagonist leaves the familiar world and enters a new or challenging situation.',
					'主角离开熟悉的环境，进入一个陌生或充满挑战的新局面。',
				),
				beat(
					'Search',
					'探索',
					'The protagonist experiments, adapts, and struggles to find a way to achieve the goal.',
					'主角不断尝试、适应和探索，寻找实现目标的方法。',
				),
				beat(
					'Find',
					'得到',
					'The protagonist finally gains what they have been pursuing or reaches an important goal.',
					'主角终于得到一直追求的东西，或实现一个重要目标。',
				),
				beat(
					'Take',
					'付出代价',
					'The protagonist discovers that getting what they wanted comes with an unexpected cost or consequence.',
					'主角发现实现愿望伴随着意料之外的代价、损失或后果。',
				),
			]),
			act('', '回归改变', [
				beat(
					'Return',
					'回归',
					'The protagonist returns toward the familiar world carrying the consequences of the journey.',
					'主角带着旅程中的收获与后果，重新回到原来的世界或生活。',
				),
				beat(
					'Change',
					'改变',
					'The protagonist demonstrates a lasting internal or external change caused by the journey.',
					'主角展现出这段经历所带来的持久内在或外在变化。',
				),
			]),
		],
	},
	'save-the-cat': {
		name: ['Save the Cat', '救猫咪'],
		acts: [
			act('', '建立', [
				beat(
					'Opening Image',
					'开场画面',
					'Present a representative image that captures the protagonist and world at the beginning of the story.',
					'用一个具有代表性的画面展示故事开始时主角和世界的状态。',
				),
				beat(
					'Theme Stated',
					'点明主题',
					'Hint at the central idea or lesson the protagonist will eventually need to understand.',
					'暗示故事将要探讨的核心主题，以及主角最终需要理解的道理。',
				),
				beat(
					'Setup',
					'开局铺垫',
					'Establish the protagonist’s life, relationships, problems, and the areas that may need to change.',
					'建立主角的生活、关系、问题，以及之后可能需要改变的地方。',
				),
				beat(
					'Catalyst',
					'催化事件',
					'A disruptive event changes the protagonist’s normal life and creates a new problem or opportunity.',
					'一个突发事件打破主角的日常生活，并带来新的问题或机会。',
				),
				beat(
					'Debate',
					'犹豫抉择',
					'The protagonist hesitates, resists, or questions whether to step into the new situation.',
					'主角在行动之前犹豫、抗拒或怀疑自己是否应该迈出下一步。',
				),
			]),
			act('', '新世界', [
				beat(
					'Break into Two',
					'进入第二幕',
					'The protagonist makes a choice that moves them decisively into the story’s main situation.',
					'主角做出明确选择，真正进入故事的主要情境或新世界。',
				),
				beat(
					'B Story',
					'B 线故事',
					'A secondary relationship or storyline emerges that often helps explore the story’s central theme.',
					'一条通常围绕关系展开的副线出现，并进一步探索故事的核心主题。',
				),
				beat(
					'Fun and Games',
					'核心体验',
					'The story delivers the experiences, conflicts, and situations promised by its central premise.',
					'故事充分展现其核心设定所承诺的体验、冲突与趣味。',
				),
				beat(
					'Midpoint',
					'转折中点',
					'A major victory, defeat, or revelation significantly changes the goal, stakes, or direction of the story.',
					'一次重大胜利、失败或揭示明显改变故事的目标、风险或方向。',
				),
				beat(
					'Bad Guys Close In',
					'压力逼近',
					'External threats and internal problems intensify, steadily reducing the protagonist’s room to maneuver.',
					'外部威胁和内部矛盾不断加剧，使主角能够应对的空间越来越小。',
				),
				beat(
					'All Is Lost',
					'一切尽失',
					'The protagonist experiences a devastating defeat that makes success seem almost impossible.',
					'主角遭遇一次沉重失败，使成功看起来几乎已经不可能。',
				),
				beat(
					'Dark Night of the Soul',
					'至暗时刻',
					'At their lowest point, the protagonist confronts the emotional meaning of the failure and their deepest problem.',
					'在最低谷中，主角开始面对失败真正带来的情感冲击以及自身最深层的问题。',
				),
			]),
			act('', '解决', [
				beat(
					'Break into Three',
					'进入第三幕',
					'A new insight, idea, or combination of lessons gives the protagonist a path toward solving the final problem.',
					'新的认识、方案或经验整合让主角找到解决最终问题的方向。',
				),
				beat(
					'Finale',
					'最终决战',
					'The protagonist applies what they have learned to confront and resolve the story’s central conflict.',
					'主角运用一路获得的成长与经验，面对并解决故事的核心冲突。',
				),
				beat(
					'Final Image',
					'最终画面',
					'A closing image shows how the protagonist and world have changed compared with the opening.',
					'用最后一个画面展示主角和世界与故事开场相比发生了怎样的变化。',
				),
			]),
		],
	},
	'heros-journey': {
		name: ['Hero’s Journey', '英雄之旅'],
		acts: [
			act('Departure', '启程', [
				beat(
					'Ordinary World',
					'平凡世界',
					'Show the hero’s familiar life and normal condition before the journey begins.',
					'展示英雄踏上旅程之前熟悉的日常生活和原本状态。',
				),
				beat(
					'Call to Adventure',
					'冒险召唤',
					'An event, task, or problem invites the hero to leave ordinary life and begin a journey.',
					'一个事件、任务或问题召唤英雄离开日常生活并踏上旅程。',
				),
				beat(
					'Refusal of the Call',
					'拒绝召唤',
					'The hero resists the journey because of fear, doubt, responsibility, or attachment to the familiar.',
					'英雄因为恐惧、怀疑、责任或对熟悉生活的依恋而抗拒这段旅程。',
				),
				beat(
					'Meeting with the Mentor',
					'遇见导师',
					'The hero receives guidance, knowledge, tools, or confidence needed to continue the journey.',
					'英雄获得继续旅程所需的指导、知识、工具或信心。',
				),
				beat(
					'Crossing the First Threshold',
					'跨越第一道门槛',
					'The hero leaves the familiar world behind and fully enters the unfamiliar world of the adventure.',
					'英雄真正离开熟悉世界，并正式进入充满未知的冒险领域。',
				),
			]),
			act('Initiation', '试炼', [
				beat(
					'Tests, Allies, and Enemies',
					'试炼、盟友与敌人',
					'The hero faces challenges, forms alliances, and learns who or what stands in opposition.',
					'英雄经历各种挑战、结识盟友，并逐渐了解谁或什么正在与自己对抗。',
				),
				beat(
					'Approach to the Inmost Cave',
					'逼近核心险境',
					'The hero moves closer to the journey’s most dangerous or important challenge and prepares to face it.',
					'英雄逐渐逼近旅途中最危险或最重要的挑战，并开始为其做准备。',
				),
				beat(
					'Ordeal',
					'严峻考验',
					'The hero faces a major trial that brings them close to defeat, loss, or symbolic death.',
					'英雄面对一次重大考验，并经历接近失败、失去或象征性死亡的时刻。',
				),
				beat(
					'Reward',
					'获得奖赏',
					'After surviving the ordeal, the hero gains an important reward, truth, ability, or insight.',
					'熬过重大考验之后，英雄获得重要的成果、真相、能力或领悟。',
				),
			]),
			act('Return', '归来', [
				beat(
					'The Road Back',
					'踏上归途',
					'The hero begins the journey back while still facing the consequences of what has happened.',
					'英雄开始踏上归途，同时仍需要面对此前经历所带来的后果。',
				),
				beat(
					'Resurrection',
					'最终重生',
					'The hero faces one final and decisive test that proves how much they have changed.',
					'英雄经历最后一次决定性的考验，并证明自己已经真正发生改变。',
				),
				beat(
					'Return with the Elixir',
					'携宝归来',
					'The hero returns with knowledge, power, healing, or another benefit gained through the journey.',
					'英雄带着旅途中获得的知识、力量、疗愈或其他成果回到原来的世界。',
				),
			]),
		],
	},
	'romancing-the-beat': {
		name: ['Romancing the Beat', '爱情故事'],
		acts: [
			act('Set Up', '建立关系', [
				beat(
					'Introduce H1',
					'介绍主角一',
					'Introduce the first romantic lead, including their life, needs, and current attitude toward love.',
					'介绍第一位爱情主角的生活、需求以及当前对爱情的态度。',
				),
				beat(
					'Introduce H2',
					'介绍主角二',
					'Introduce the second romantic lead, including their life, needs, and current attitude toward love.',
					'介绍第二位爱情主角的生活、需求以及当前对爱情的态度。',
				),
				beat(
					'Meet Cute',
					'浪漫初遇',
					'The two romantic leads meet in a memorable situation that creates the first spark of connection.',
					'两位主角在一个令人印象深刻的情境中相遇，并产生最初的联系或火花。',
				),
				beat(
					'No Way 1',
					'不可能之一',
					'The first lead identifies a reason why a romantic relationship with the other person cannot or should not happen.',
					'第一位主角认为自己因为某种原因不可能或不应该与对方发展恋爱关系。',
				),
				beat(
					'Adhesion',
					'被迫靠近',
					'Circumstances force the two leads to keep interacting, cooperating, or spending time together.',
					'某种外部条件迫使两位主角继续接触、合作或相处。',
				),
			]),
			act('Falling in Love', '坠入爱河', [
				beat(
					'No Way 2',
					'不可能之二',
					'The second lead also identifies a reason why the relationship cannot or should not happen.',
					'第二位主角同样认为这段关系因为某种原因不可能或不应该发生。',
				),
				beat(
					'Inkling of Desire',
					'心动初现',
					'One or both leads first begin to recognize genuine romantic attraction toward the other.',
					'一方或双方第一次真正意识到自己已经开始被对方吸引。',
				),
				beat(
					'Deepening Desire',
					'情愫加深',
					'Continued intimacy and shared experiences strengthen the emotional and romantic connection between them.',
					'不断增加的相处和共同经历让两人的情感与浪漫吸引逐渐加深。',
				),
				beat(
					'Maybe This Could Work',
					'也许真的可以',
					'The leads begin to believe that the relationship they once considered impossible might actually succeed.',
					'两位主角开始相信，这段原本被认为不可能的关系也许真的能够成功。',
				),
				beat(
					'Midpoint of Love',
					'爱情中点',
					'The relationship reaches a new level of intimacy that makes a shared future temporarily feel possible.',
					'两人的关系达到新的亲密程度，让共同的未来暂时显得触手可及。',
				),
			]),
			act('Retreating from Love', '逃离爱情', [
				beat(
					'Inkling of Doubt',
					'疑虑初现',
					'The first signs of doubt appear as one or both leads begin questioning the security of the relationship.',
					'最初的疑虑出现，一方或双方开始怀疑这段关系是否真的可靠。',
				),
				beat(
					'Deepening of Doubt',
					'疑虑加深',
					'Internal fears and external problems intensify, making the relationship increasingly difficult to trust.',
					'内在恐惧和外部问题不断加剧，使两位主角越来越难以相信这段关系。',
				),
				beat(
					'Retreat',
					'退缩',
					'One or both leads begin pulling away emotionally or physically to protect themselves from possible hurt.',
					'一方或双方开始在情感或现实中主动拉开距离，以避免自己受到伤害。',
				),
				beat(
					'Shields Up',
					'封闭内心',
					'Emotional defenses return as the leads stop being fully vulnerable and honest with each other.',
					'两位主角重新建立情感防御，不再愿意向彼此完全坦诚和敞开心扉。',
				),
				beat(
					'Break Up',
					'分离',
					'The relationship breaks apart or reaches a separation that appears difficult or impossible to repair.',
					'两人的关系正式破裂，或进入一个看起来难以挽回的分离状态。',
				),
			]),
			act('Fighting for Love', '为爱争取', [
				beat(
					'Dark Night',
					'爱情至暗时刻',
					'After losing the relationship, the protagonist confronts the fear, wound, or belief that has been holding them back.',
					'失去这段关系之后，主角真正面对一直阻碍自己的恐惧、创伤或错误信念。',
				),
				beat(
					'Wake Up',
					'醒悟',
					'The protagonist realizes what they truly want and understands what must change for the relationship to work.',
					'主角终于明白自己真正想要什么，也意识到这段关系要继续必须改变什么。',
				),
				beat(
					'Grand Gesture',
					'爱的行动',
					'The protagonist takes a meaningful and potentially costly action that openly demonstrates commitment to the relationship.',
					'主角通过一次具有意义且需要付出代价的行动，明确表达自己对这段关系的选择与承诺。',
				),
				beat(
					'What Whole-Hearted Looks Like',
					'全心相爱',
					'The leads rebuild the relationship with greater honesty, vulnerability, and emotional maturity.',
					'两位主角以更加坦诚、开放和成熟的方式重新建立彼此的关系。',
				),
				beat(
					'Epilogue',
					'尾声',
					'Show the couple’s new relationship dynamic after the central romantic conflict has been resolved.',
					'展示核心感情冲突解决之后，两位主角进入了怎样的新关系状态。',
				),
			]),
		],
	},
};

const presetOf = (language: BeatSheetTemplateLanguage, id: BuiltInBeatSheetTemplateId): BuiltInBeatSheetTemplate => {
	const words = PRESETS[id];
	const at = language === 'en' ? 0 : 1;
	return {
		id,
		name: words.name[at],
		structure: {
			acts: words.acts.map((one) => ({
				label: one.label[at],
				beats: one.beats.map((entry) => ({ name: entry.name[at], description: entry.description[at] })),
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
