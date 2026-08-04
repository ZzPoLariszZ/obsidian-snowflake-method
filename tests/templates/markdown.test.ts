import { describe, expect, it } from 'vitest';

import {
	STORY_ARTIFACTS,
	characterTemplate,
	getStoryArtifacts,
	getSystemTemplates,
	projectTemplate,
	storyArtifactTemplate,
	sceneTemplate,
} from '../../src/templates';

describe('story artifact Markdown templates', () => {
	it('uses the Step 2 title in its generated filename', () => {
		expect(STORY_ARTIFACTS.find(({ step }) => step === 2)?.relativePath).toBe(
			'10_Summary/12_One_Paragraph_Summary.md',
		);
	});

	it('localizes every Chinese plot artifact path', () => {
		expect(getStoryArtifacts('zh-CN').map(({ relativePath }) => relativePath)).toEqual([
			'10_概述/11_一句话概述.md',
			'10_概述/12_一段式梗概.md',
			'30_大纲/31_情节大纲.md',
			'30_大纲/32_长篇大纲.md',
		]);
	});

	it('uses one paragraph section plus one optional description section for Step 2', () => {
		const template = storyArtifactTemplate(2, 'en');

		expect(template.sections).toEqual([
			{
				id: 'one-paragraph-summary',
				heading: '## One-Paragraph Summary',
			},
			{
				id: 'description',
				heading: '## Description (Optional)',
			},
		]);
		expect(template.body).toContain('# Step 2 · One-Paragraph Summary');
		expect(template.body).toContain('snowflake:section:description:start');
		expect(template.body).not.toContain('snowflake:section:opening');
		expect(template.body).not.toContain('First disaster');
	});

	it('keeps the Chinese Step 2 title free of parenthetical English', () => {
		const template = storyArtifactTemplate(2, 'zh-CN');

		expect(template.body).toContain('# 第二步 · 一段式梗概');
		expect(template.sections[0]?.heading).toBe('## 一段式梗概');
		expect(template.sections[1]?.heading).toBe('## 简介（可选）');
		expect(template.body).not.toContain('(');
	});

	it('keeps Step 3 character headings title-cased and free of parenthetical English', () => {
		const english = characterTemplate('Ada', 'en');
		const chinese = characterTemplate('小岚', 'zh-CN');

		expect(english.sections[0]?.heading).toBe('## Step 3 · Major Character Sheet');
		expect(chinese.sections[0]?.heading).toBe('## 第三步 · 主要角色表');
		expect(chinese.sections[0]?.heading).not.toContain('(');
	});

	it('keeps Step 5 character headings title-cased and free of parenthetical English', () => {
		const english = characterTemplate('Ada', 'en');
		const chinese = characterTemplate('小岚', 'zh-CN');

		expect(english.sections[1]?.heading).toBe('## Step 5 · Character Synopsis');
		expect(chinese.sections[1]?.heading).toBe('## 第五步 · 人物大纲');
		expect(chinese.sections[1]?.heading).not.toContain('(');
	});

	it('keeps Step 7 character headings title-cased and free of parenthetical English', () => {
		const english = characterTemplate('Ada', 'en');
		const chinese = characterTemplate('小岚', 'zh-CN');

		expect(english.sections[2]?.heading).toBe('## Step 7 · Character Profiles');
		expect(chinese.sections[2]?.heading).toBe('## 第七步 · 角色档案');
		expect(chinese.sections[2]?.heading).not.toContain('(');
	});

	it('creates stable scene conflict and event sections', () => {
		const english = sceneTemplate('Arrival', 'en');
		const chinese = sceneTemplate('抵达', 'zh-CN');

		expect(english.sections.slice(0, 2)).toEqual([
			expect.objectContaining({ id: 'scene-conflict', heading: '## Step 8 · Conflict' }),
			expect.objectContaining({ id: 'scene-events', heading: '## Step 8 · Specific Events' }),
		]);
		expect(chinese.sections.slice(0, 2)).toEqual([
			expect.objectContaining({ id: 'scene-conflict', heading: '## 第八步 · 冲突' }),
			expect.objectContaining({ id: 'scene-events', heading: '## 第八步 · 具体事件' }),
		]);
		expect(english.sections[2]?.heading).toBe(
			'## Step 9 · Scene Planning (Optional)',
		);
		expect(chinese.sections[2]?.heading).toBe('## 第九步 · 场景规划（可选）');
	});

	it('keeps Step 4 titles title-cased and free of parenthetical English', () => {
		const english = storyArtifactTemplate(4, 'en');
		const chinese = storyArtifactTemplate(4, 'zh-CN');

		expect(english.body).toContain('# Step 4 · Plot Synopsis');
		expect(english.sections[0]?.heading).toBe('');
		expect(english.body).not.toContain('## Step 4 · Plot Synopsis');
		expect(chinese.body).toContain('# 第四步 · 情节大纲');
		expect(chinese.sections[0]?.heading).toBe('');
		expect(chinese.body).not.toContain('## 第四步 · 情节大纲');
		expect(chinese.sections[0]?.heading).not.toContain('(');
	});

	it('keeps Step 6 titles title-cased and free of parenthetical English', () => {
		const english = storyArtifactTemplate(6, 'en');
		const chinese = storyArtifactTemplate(6, 'zh-CN');

		expect(english.body).toContain('# Step 6 · Long Synopsis');
		expect(english.sections[0]?.heading).toBe('');
		expect(english.body).not.toContain('## Step 6 · Long Synopsis');
		expect(chinese.body).toContain('# 第六步 · 长篇大纲');
		expect(chinese.sections[0]?.heading).toBe('');
		expect(chinese.body).not.toContain('## 第六步 · 长篇大纲');
		expect(chinese.body).not.toContain('Long synopsis');
	});

	it('uses localized metadata guidance with a visually emphasized warning', () => {
		const english = projectTemplate('Novel', 'en').body;
		const chinese = projectTemplate('小说', 'zh-CN').body;

		expect(english).toContain('This note stores project metadata for the Snowflake Method plugin.');
		expect(english).toContain('**Do not modify any content in this metadata file!**');
		expect(english).not.toContain('color:');
		expect(english).toContain('Do not modify any content in this metadata file!');
		expect(chinese).toContain('本笔记保存雪花写作法插件的项目元数据。');
		expect(chinese).toContain('**请勿修改该元数据文件中的任何内容！**');
		expect(chinese).not.toContain('color:');
		expect(chinese).toContain('请勿修改该元数据文件中的任何内容！');
		expect(chinese).toContain('创作内容始终是普通 Markdown，停用插件后仍可直接编辑。');
	});

	it('stores localized repair templates generated from the canonical note templates', () => {
		const english = getSystemTemplates('en');
		const chinese = getSystemTemplates('zh-CN');

		expect(english.map(({ fileName }) => fileName)).toEqual([
			'011_Template_One_Sentence_Summary.md',
			'012_Template_One_Paragraph_Summary.md',
			'021_Template_Character.md',
			'031_Template_Plot_Synopsis.md',
			'032_Template_Long_Synopsis.md',
			'041_Template_Scene.md',
			'051_Template_Draft.md',
			'081_Template_Material.md',
			'091_Template_Archive.md',
		]);
		expect(chinese.map(({ fileName }) => fileName)).toEqual([
			'011_模板_一句话概述.md',
			'012_模板_一段式梗概.md',
			'021_模板_角色.md',
			'031_模板_情节大纲.md',
			'032_模板_长篇大纲.md',
			'041_模板_场景.md',
			'051_模板_初稿.md',
			'081_模板_素材.md',
			'091_模板_存档.md',
		]);
		expect(english.find(({ id }) => id === 'plot-synopsis')?.template.body).toBe(
			storyArtifactTemplate(4, 'en').body,
		);
		expect(chinese.find(({ id }) => id === 'one-sentence-summary')?.template.body).toBe(
			storyArtifactTemplate(1, 'zh-CN').body,
		);
	});
});
