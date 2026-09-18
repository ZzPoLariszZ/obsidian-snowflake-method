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
			'空白', '三幕式', '起承转合', '故事圈', '救猫咪', '英雄之旅', '言情节拍',
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

	it('lays the Story Circle out as three acts that wear their numbers alone', () => {
		expect(drawn(builtInBeatSheetTemplate('en', 'story-circle').structure)).toEqual([
			['', ['You', 'Need']],
			['', ['Go', 'Search', 'Find', 'Take']],
			['', ['Return', 'Change']],
		]);
	});

	it('lays Save the Cat out as its fifteen beats over three acts', () => {
		expect(drawn(builtInBeatSheetTemplate('en', 'save-the-cat').structure)).toEqual([
			['', ['Opening Image', 'Theme Stated', 'Setup', 'Catalyst', 'Debate']],
			['', ['Break into Two', 'B Story', 'Fun and Games', 'Midpoint', 'Bad Guys Close In', 'All Is Lost', 'Dark Night of the Soul']],
			['', ['Break into Three', 'Finale', 'Final Image']],
		]);
	});

	it('lays the Hero’s Journey out as its twelve stages over Departure, Initiation and Return', () => {
		expect(drawn(builtInBeatSheetTemplate('en', 'heros-journey').structure)).toEqual([
			['Departure', ['Ordinary World', 'Call to Adventure', 'Refusal of the Call', 'Meeting with the Mentor', 'Crossing the First Threshold']],
			['Initiation', ['Tests, Allies, and Enemies', 'Approach to the Inmost Cave', 'Ordeal', 'Reward']],
			['Return', ['The Road Back', 'Resurrection', 'Return with the Elixir']],
		]);
	});

	it('lays Romancing the Beat out as four acts of five beats', () => {
		expect(drawn(builtInBeatSheetTemplate('en', 'romancing-the-beat').structure)).toEqual([
			['Set Up', ['Introduce H1', 'Introduce H2', 'Meet Cute', 'No Way 1', 'Adhesion']],
			['Falling in Love', ['No Way 2', 'Inkling of Desire', 'Deepening Desire', 'Maybe This Could Work', 'Midpoint of Love']],
			['Retreating from Love', ['Inkling of Doubt', 'Deepening of Doubt', 'Retreat', 'Shields Up', 'Break Up']],
			['Fighting for Love', ['Dark Night', 'Wake Up', 'Grand Gesture', 'What Whole-Hearted Looks Like', 'Epilogue']],
		]);
	});

	it('says every preset in Chinese act for act and beat for beat, labelling the acts the English labels', () => {
		for (const id of BUILT_IN_BEAT_SHEET_TEMPLATE_IDS) {
			const english = builtInBeatSheetTemplate('en', id).structure.acts;
			const chinese = builtInBeatSheetTemplate('zh-CN', id).structure.acts;
			expect(chinese.map((act) => act.beats.length), id).toEqual(english.map((act) => act.beats.length));
			expect(chinese.map((act) => act.label.length > 0), id).toEqual(english.map((act) => act.label.length > 0));
			for (const act of chinese) {
				for (const beat of act.beats) expect(beat.name.trim().length, `${id}: ${beat.name}`).toBeGreaterThan(0);
			}
		}
	});

	it('says what each beat is called and leaves what it is for to the author', () => {
		for (const language of ['en', 'zh-CN'] as const) {
			for (const preset of builtInBeatSheetTemplates(language)) {
				for (const act of preset.structure.acts) {
					for (const beat of act.beats) expect(beat.description).toBe('');
				}
			}
		}
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
	});
});
