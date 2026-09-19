import { describe, expect, it } from 'vitest';

import {
	BUILT_IN_BEAT_SHEET_TEMPLATE_IDS,
	beatSheetFromStructure,
	builtInBeatSheetTemplate,
	builtInBeatSheetTemplates,
	isBuiltInBeatSheetTemplateId,
	type BeatSheetStructure,
} from '../../src/domain';

/** A structure as the spec draws one: each act's label over its beats' names. */
const drawn = (structure: BeatSheetStructure): [string, string[]][] =>
	structure.acts.map((act) => [act.label, act.beats.map((beat) => beat.name)]);

describe('the beat sheets the plugin ships as presets', () => {
	it('offers the seven in one order, Blank first', () => {
		expect([...BUILT_IN_BEAT_SHEET_TEMPLATE_IDS]).toEqual([
			'blank', 'three-act', 'kishotenketsu', 'story-circle', 'save-the-cat', 'heros-journey', 'romancing-the-beat',
		]);
		expect(builtInBeatSheetTemplates('en').map((preset) => preset.name)).toEqual([
			'Blank', 'Three Act', 'Kishōtenketsu', 'Story Circle', 'Save the Cat', 'Hero’s Journey', 'Romancing the Beat',
		]);
		expect(builtInBeatSheetTemplates('zh-CN').map((preset) => preset.name)).toEqual([
			'空白', '三幕式', '起承转合', '故事循环', '救猫咪', '英雄之旅', '爱情故事',
		]);
		expect(isBuiltInBeatSheetTemplateId('save-the-cat')).toBe(true);
		expect(isBuiltInBeatSheetTemplateId('my-own')).toBe(false);
	});

	it('starts Blank on no act at all', () => {
		expect(builtInBeatSheetTemplate('en', 'blank').structure).toEqual({ acts: [] });
		expect(builtInBeatSheetTemplate('zh-CN', 'blank').structure).toEqual({ acts: [] });
	});

	it('lays Three Act out as three labelled acts over their common beats', () => {
		expect(drawn(builtInBeatSheetTemplate('en', 'three-act').structure)).toEqual([
			['Setup', ['Setup', 'Inciting Incident', 'First Turning Point']],
			['Confrontation', ['Rising Action', 'Midpoint', 'Crisis', 'Second Turning Point']],
			['Resolution', ['Pre-Climax', 'Climax', 'Denouement']],
		]);
		expect(drawn(builtInBeatSheetTemplate('zh-CN', 'three-act').structure)).toEqual([
			['建立', ['开局铺垫', '诱发事件', '第一转折']],
			['对抗', ['冲突升级', '中点转折', '遭遇危机', '第二转折']],
			['解决', ['高潮前奏', '高潮阶段', '最终收束']],
		]);
	});

	it('lays Kishōtenketsu out as four labelled acts with no beat under them', () => {
		expect(drawn(builtInBeatSheetTemplate('en', 'kishotenketsu').structure)).toEqual([
			['Ki (Introduction)', []],
			['Shō (Development)', []],
			['Ten (Turn)', []],
			['Ketsu (Conclusion)', []],
		]);
		expect(drawn(builtInBeatSheetTemplate('zh-CN', 'kishotenketsu').structure)).toEqual([
			['起', []], ['承', []], ['转', []], ['合', []],
		]);
	});

	it('lays the Story Circle out as three acts, which wear their numbers alone in English and a name in Chinese', () => {
		expect(drawn(builtInBeatSheetTemplate('en', 'story-circle').structure)).toEqual([
			['', ['You', 'Need']],
			['', ['Go', 'Search', 'Find', 'Take']],
			['', ['Return', 'Change']],
		]);
		expect(drawn(builtInBeatSheetTemplate('zh-CN', 'story-circle').structure)).toEqual([
			['原有世界', ['原本的你', '需求出现']],
			['进入未知', ['出发', '探索', '得到', '付出代价']],
			['回归改变', ['回归', '改变']],
		]);
	});

	it('lays Save the Cat out as its fifteen beats over three acts', () => {
		expect(drawn(builtInBeatSheetTemplate('en', 'save-the-cat').structure)).toEqual([
			['', ['Opening Image', 'Theme Stated', 'Setup', 'Catalyst', 'Debate']],
			['', ['Break into Two', 'B Story', 'Fun and Games', 'Midpoint', 'Bad Guys Close In', 'All Is Lost', 'Dark Night of the Soul']],
			['', ['Break into Three', 'Finale', 'Final Image']],
		]);
		expect(drawn(builtInBeatSheetTemplate('zh-CN', 'save-the-cat').structure)).toEqual([
			['建立', ['开场画面', '点明主题', '开局铺垫', '催化事件', '犹豫抉择']],
			['新世界', ['进入第二幕', 'B 线故事', '核心体验', '转折中点', '压力逼近', '一切尽失', '至暗时刻']],
			['解决', ['进入第三幕', '最终决战', '最终画面']],
		]);
	});

	it('lays the Hero’s Journey out as its twelve stages over Departure, Initiation and Return', () => {
		expect(drawn(builtInBeatSheetTemplate('en', 'heros-journey').structure)).toEqual([
			['Departure', ['Ordinary World', 'Call to Adventure', 'Refusal of the Call', 'Meeting with the Mentor', 'Crossing the First Threshold']],
			['Initiation', ['Tests, Allies, and Enemies', 'Approach to the Inmost Cave', 'Ordeal', 'Reward']],
			['Return', ['The Road Back', 'Resurrection', 'Return with the Elixir']],
		]);
		expect(drawn(builtInBeatSheetTemplate('zh-CN', 'heros-journey').structure)).toEqual([
			['启程', ['平凡世界', '冒险召唤', '拒绝召唤', '遇见导师', '跨越第一道门槛']],
			['试炼', ['试炼、盟友与敌人', '逼近核心险境', '严峻考验', '获得奖赏']],
			['归来', ['踏上归途', '最终重生', '携宝归来']],
		]);
	});

	it('lays Romancing the Beat out as four acts of five beats', () => {
		expect(drawn(builtInBeatSheetTemplate('en', 'romancing-the-beat').structure)).toEqual([
			['Set Up', ['Introduce H1', 'Introduce H2', 'Meet Cute', 'No Way 1', 'Adhesion']],
			['Falling in Love', ['No Way 2', 'Inkling of Desire', 'Deepening Desire', 'Maybe This Could Work', 'Midpoint of Love']],
			['Retreating from Love', ['Inkling of Doubt', 'Deepening of Doubt', 'Retreat', 'Shields Up', 'Break Up']],
			['Fighting for Love', ['Dark Night', 'Wake Up', 'Grand Gesture', 'What Whole-Hearted Looks Like', 'Epilogue']],
		]);
		expect(drawn(builtInBeatSheetTemplate('zh-CN', 'romancing-the-beat').structure)).toEqual([
			['建立关系', ['介绍主角一', '介绍主角二', '浪漫初遇', '不可能之一', '被迫靠近']],
			['坠入爱河', ['不可能之二', '心动初现', '情愫加深', '也许真的可以', '爱情中点']],
			['逃离爱情', ['疑虑初现', '疑虑加深', '退缩', '封闭内心', '分离']],
			['为爱争取', ['爱情至暗时刻', '醒悟', '爱的行动', '全心相爱', '尾声']],
		]);
	});

	it('says every preset in both languages act for act and beat for beat, every word of it written', () => {
		for (const id of BUILT_IN_BEAT_SHEET_TEMPLATE_IDS) {
			const english = builtInBeatSheetTemplate('en', id).structure.acts;
			const chinese = builtInBeatSheetTemplate('zh-CN', id).structure.acts;
			expect(chinese.map((act) => act.beats.length), id).toEqual(english.map((act) => act.beats.length));
			for (const act of [...english, ...chinese]) {
				for (const beat of act.beats) expect(beat.name.trim().length, `${id}: ${beat.name}`).toBeGreaterThan(0);
			}
			// A Chinese act is never left to its number where the English one has a name.
			for (const [at, act] of english.entries()) {
				if (act.label.length > 0) expect(chinese[at]!.label.length, `${id}: ${act.label}`).toBeGreaterThan(0);
			}
		}
	});

	it('says under each beat what the beat is for, one sentence in the language of the project', () => {
		const sentences = (language: 'en' | 'zh-CN'): string[] =>
			builtInBeatSheetTemplates(language).flatMap((preset) => preset.structure.acts.flatMap((act) => act.beats.map((beat) => beat.description)));
		const english = sentences('en');
		const chinese = sentences('zh-CN');
		expect(english).toHaveLength(65);
		expect(chinese).toHaveLength(65);
		for (const sentence of english) expect(sentence, sentence).toMatch(/^[A-Z][^\u4e00-\u9fff]+\.$/);
		for (const sentence of chinese) expect(sentence, sentence).toMatch(/^[^A-Za-z]*[\u4e00-\u9fff][\s\S]*。$/);
		// Each is a prompt of its own: none was pasted twice, and none under the wrong language.
		expect(new Set(english).size).toBe(65);
		expect(new Set(chinese).size).toBe(65);
		expect(builtInBeatSheetTemplate('en', 'save-the-cat').structure.acts[0]!.beats[3]).toEqual({
			name: 'Catalyst',
			description: 'A disruptive event changes the protagonist’s normal life and creates a new problem or opportunity.',
		});
		expect(builtInBeatSheetTemplate('zh-CN', 'save-the-cat').structure.acts[0]!.beats[3]).toEqual({
			name: '催化事件',
			description: '一个突发事件打破主角的日常生活，并带来新的问题或机会。',
		});
		expect(builtInBeatSheetTemplate('zh-CN', 'romancing-the-beat').structure.acts[3]!.beats[4]).toEqual({
			name: '尾声',
			description: '展示核心感情冲突解决之后，两位主角进入了怎样的新关系状态。',
		});
	});

	it('hands out a structure of its own each time, so a sheet made from one cannot reach the next', () => {
		const first = builtInBeatSheetTemplate('en', 'three-act').structure;
		const second = builtInBeatSheetTemplate('en', 'three-act').structure;
		expect(first).not.toBe(second);
		expect(first.acts[0]).not.toBe(second.acts[0]);
		let serial = 0;
		const made = beatSheetFromStructure({ id: 's', name: 'Mine', structure: first, now: 1 }, (kind) => `${kind}-${String(++serial)}`);
		const ids = made.acts.flatMap((act) => [act.id, ...act.beats.map((beat) => beat.id)]);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toHaveLength(3 + 10);
		// The sentence under a beat goes into the sheet with its name, as the beat's main description.
		expect(made.acts[0]!.beats[1]).toMatchObject({
			name: 'Inciting Incident',
			description: 'An event disrupts the existing balance and draws the protagonist into the story’s central problem.',
			rows: [],
		});
	});
});
