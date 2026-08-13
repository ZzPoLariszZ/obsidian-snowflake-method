import { describe, expect, it } from 'vitest';

import {
	SUPPORTED_LOCALES,
	en,
	isSupportedLocale,
	resolveGlobalLocale,
	resolveLocale,
	t,
	translate,
	zhCN,
} from '../../src/i18n';
import { PROJECT_STRUCTURE_ISSUE_CODES } from '../../src/services';

describe('translation resources', () => {
	it('describes every project structure issue code the checker can report', () => {
		for (const code of PROJECT_STRUCTURE_ISSUE_CODES) {
			expect(Object.keys(en)).toContain(`projectStructure.issue.${code}`);
		}
	});

	it('keeps English and Simplified Chinese key sets identical', () => {
		expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
		expect(en['dashboard.steps']).toBe('Steps');
		expect(zhCN['dashboard.steps']).toBe('步骤');
	});

	it('uses the health-checker command name without exposing a current-step command', () => {
		expect(en['commands.openHealthChecker']).toBe('Open health checker');
		expect(zhCN['commands.openHealthChecker']).toBe('打开健康检查器');
		expect(Object.keys(en)).not.toContain('commands.openCurrentStep');
		expect(Object.keys(zhCN)).not.toContain('commands.openCurrentStep');
	});

	it('avoids repeating the plugin name in command labels', () => {
		const commandKeys = Object.keys(en).filter(
			(key) =>
				key.startsWith('commands.') &&
				!key.endsWith('Enabled') &&
				!key.endsWith('Disabled'),
		) as (keyof typeof en)[];
		for (const key of commandKeys) {
			expect(en[key]).not.toContain('Snowflake');
			expect(zhCN[key]).not.toContain('雪花写作');
		}
		expect(en['commands.toggleReducedAnimations']).toBe(
			'Toggle reduced animations',
		);
		expect(zhCN['commands.toggleReducedAnimations']).toBe(
			'切换减少动画模式',
		);
		expect(en['commands.toggleNotesBesideDashboard']).toBe(
			'Toggle opening notes beside the dashboard',
		);
		expect(zhCN['commands.toggleNotesBesideDashboard']).toBe(
			'切换在工作台旁打开笔记',
		);
	});

	it('uses concise copy for opening notes beside the dashboard', () => {
		expect(en['settings.split.name']).toBe(
			'Open notes beside the dashboard',
		);
		expect(en['settings.split.desc']).toBe(
			'Open Snowflake notes in one pane beside the dashboard.',
		);
		expect(zhCN['settings.split.name']).toBe('在工作台旁打开笔记');
		expect(zhCN['settings.split.desc']).toBe(
			'在工作台旁的同一分栏中打开雪花写作笔记。',
		);
	});

	it('uses a clear bilingual empty-project state', () => {
		expect(en['dashboard.emptyTitle']).toBe('No projects');
		expect(en['dashboard.emptyDesc']).toBe(
			'Open the project manager to create your first project',
		);
		expect(zhCN['dashboard.emptyTitle']).toBe('暂无项目');
		expect(zhCN['dashboard.emptyDesc']).toBe(
			'打开项目管理器以创建第一个项目',
		);
	});

	it('keeps project management copy bilingual and local-only', () => {
		expect(en['dashboard.manageProjects']).toBe('Manage projects…');
		expect(zhCN['dashboard.manageProjects']).toBe('管理项目…');
		expect(en['modal.projectManager.title']).toBe(
			'Manage Snowflake projects',
		);
		expect(zhCN['modal.projectManager.title']).toBe('管理雪花写作项目');
		expect(en['modal.projectManager.createDesc']).toBe(
			'Create a new Snowflake Method project.',
		);
		expect(zhCN['modal.projectManager.createDesc']).toBe(
			'创建新的雪花写作项目。',
		);
		expect(en['modal.projectManager.language']).toBe(
			'Choose project language',
		);
		expect(zhCN['modal.projectManager.language']).toBe('选择项目语言');
		expect(en['modal.projectManager.languageDesc']).toBe(
			'Used for this project manager and new projects.',
		);
		expect(zhCN['modal.projectManager.languageDesc']).toBe(
			'用于当前项目管理器和新项目。',
		);
		expect(en['modal.projectManager.projectRoot']).toBe(
			'Set project root folder',
		);
		expect(zhCN['modal.projectManager.projectRoot']).toBe(
			'设置项目根目录',
		);
		expect(en['modal.projectManager.projectRootDesc']).toBe(
			'Vault-relative folder path for Snowflake projects.',
		);
		expect(zhCN['modal.projectManager.projectRootDesc']).toBe(
			'雪花写作项目文件夹的 Vault 相对路径。',
		);
		expect(
			t('en', 'modal.projectManager.version', { version: '0.1.0' }),
		).toBe('Version 0.1.0');
		const managerKeys = Object.keys(en).filter((key) =>
			key.startsWith('modal.projectManager.'),
		);
		expect(managerKeys).not.toContain('modal.projectManager.openTitle');
		expect(managerKeys).not.toContain('modal.projectManager.sync');
	});

	it('explains project language consistently in settings and creation', () => {
		expect(en['modal.project.language']).toBe('Project language');
		expect(zhCN['modal.project.language']).toBe('项目语言');
		expect(en['settings.projectRoot.desc']).toBe(
			'Vault-relative folder path for Snowflake projects.',
		);
		expect(zhCN['settings.projectRoot.desc']).toBe(
			'雪花写作项目文件夹的 Vault 相对路径。',
		);
		expect(en['settings.uiLocale.desc']).toBe(
			'Language used by the plugin interface.',
		);
		expect(zhCN['settings.uiLocale.desc']).toBe('插件界面使用的语言。');
		expect(en['settings.projectLocale.desc']).toBe(
			'Language used for new projects.',
		);
		expect(zhCN['settings.projectLocale.desc']).toBe('新项目使用的语言。');
		expect(en['settings.projectLocale.desc']).not.toContain(
			'This does not change the interface language',
		);
		expect(zhCN['settings.projectLocale.desc']).not.toContain('不影响界面语言');
	});

	it('provides a non-empty translation for every key', () => {
		for (const locale of SUPPORTED_LOCALES) {
			for (const key of Object.keys(en)) {
				expect(t(locale, key).trim(), `${locale}:${key}`).not.toBe('');
			}
		}
	});

	it('localizes managed-section protection and repair guidance', () => {
		expect(en['settings.protectBoundaries.name']).toBe(
			'Protect managed boundaries',
		);
		expect(zhCN['settings.protectBoundaries.name']).toBe(
			'保护托管区段边界',
		);
		expect(en['commands.toggleManagedBoundaries']).toContain(
			'boundary protection',
		);
		expect(zhCN['commands.toggleManagedBoundaries']).toContain('边界保护');
		expect(en['commands.boundaryProtectionEnabled']).toContain('enabled');
		expect(en['commands.boundaryProtectionDisabled']).toContain('disabled');
		expect(zhCN['commands.boundaryProtectionEnabled']).toContain('已开启');
		expect(zhCN['commands.boundaryProtectionDisabled']).toContain('已关闭');
		expect(en['commands.reducedAnimationsEnabled']).toContain('enabled');
		expect(en['commands.reducedAnimationsDisabled']).toContain('disabled');
		expect(zhCN['commands.reducedAnimationsEnabled']).toContain('已开启');
		expect(zhCN['commands.reducedAnimationsDisabled']).toContain('已关闭');
		expect(en['editor.managedSection.placeholder']).toBe('Write here…');
		expect(zhCN['editor.managedSection.placeholder']).toBe('在这里写作…');
		expect(en['editor.managedSection.boundaryTooltip']).toContain(
			'Do not edit or delete',
		);
		expect(zhCN['editor.managedSection.boundaryTooltip']).toContain(
			'请勿修改或删除',
		);
		expect(en['editor.managedSection.unlockConfirmDescription']).toContain(
			'Markdown data contract',
		);
		expect(
			zhCN['editor.managedSection.unlockConfirmDescription'],
		).toContain('Markdown 数据契约');
		expect(en['editor.managedSection.damagedDescription']).toContain(
			'cannot safely update',
		);
		expect(zhCN['editor.managedSection.damagedDescription']).toContain(
			'无法安全更新',
		);
	});

	it('covers every managed-section issue code in both languages', () => {
		const issueCodes = [
			'missing',
			'missing-start',
			'missing-end',
			'duplicate-start',
			'duplicate-end',
			'reversed',
			'overlap',
			'unknown-section',
		] as const;
		for (const code of issueCodes) {
			const key = `editor.managedSection.issue.${code}` as keyof typeof en;
			expect(en[key].trim(), `en:${key}`).not.toBe('');
			expect(zhCN[key].trim(), `zh-CN:${key}`).not.toBe('');
		}
	});

	it('names all nineteen managed Markdown sections', () => {
		const sectionIds = [
			'genre',
			'audience-reason-1',
			'one-sentence-summary',
			'candidate-title-1',
			'candidate-title-2',
			'candidate-title-3',
			'candidate-title-4',
			'candidate-title-5',
			'candidate-title-6',
			'one-paragraph-summary',
			'description',
			'plot-synopsis',
			'long-synopsis',
			'one-paragraph-storyline',
			'character-synopsis',
			'character-profile',
			'scene-conflict',
			'scene-events',
			'scene-planning',
		] as const;
		expect(sectionIds).toHaveLength(19);
		for (const sectionId of sectionIds) {
			const key =
				`editor.managedSection.name.${sectionId}` as keyof typeof en;
			expect(en[key].trim(), `en:${key}`).not.toBe('');
			expect(zhCN[key].trim(), `zh-CN:${key}`).not.toBe('');
		}
	});

	it('keeps the Step 1 title and non-blocking length guidance exact', () => {
		expect(en['steps.1.title']).toBe('One-sentence summary');
		expect(en['common.recommended']).toBe('Recommend');
		expect(zhCN['common.recommended']).toBe('推荐');
		expect(Object.values(en)).not.toContain(
			'As a novelist, your job is to delight your target readers.',
		);
		expect(en['fields.audienceReasonsPlaceholder']).toBe(
			'List two or three reasons.',
		);
		expect(zhCN['fields.audienceReasonsPlaceholder']).toBe(
			'列出两到三个理由',
		);
		const count = t('en', 'fields.oneSentenceSummaryCount', {
			count: 12,
			unit: 'words',
		});
		expect(en['step1.hints.shorter']).toContain('fewer than 15 words');
		expect(zhCN['step1.hints.shorter']).toContain('二十五字');
		expect(en['step1.hints.imagination']).toBe(
			'Hint is helpful. But don’t limit your imagination.',
		);
		expect(en['step1.hints.revision']).toBe(
			'Don’t strive for perfection. You can revise at any time.',
		);
		expect(count).toBe('Current length: 12 words.');
		expect(
			t('zh-CN', 'fields.oneSentenceSummaryCount', { count: 12, unit: 'words' }),
		).toBe('当前长度：12 字。');
		expect(en['step1.hints.shorter']).not.toContain('Aim for');
	});

	it('keeps the Step 2 copy and revision status exact', () => {
		expect(en['steps.2.title']).toBe('One-paragraph summary');
		expect(en['steps.2.description']).toBe(
			'Expand one-sentence summary to a full paragraph.',
		);
		expect(en['step2.hints.title']).toBe(
			'Hints for one-paragraph summary',
		);
		expect(en['status.in-revision']).toBe('In revision');
		expect(en['step2.hints.structure']).toBe(
			'Try a four-part structure, a three-act structure, or the Hero’s Journey.',
		);
		expect(en['step2.hints.structure']).not.toContain(
			'introduction, development, turn, and conclusion',
		);
		expect(en['step2.description.title']).toBe('Description');
		expect(en['step2.sourceSummary.title']).toBe('One-sentence summary');
		expect(zhCN['step2.sourceSummary.title']).toBe('一句话概述');
		expect(zhCN['steps.2.title']).toBe('一段式梗概');
		expect(zhCN['status.in-revision']).toBe('修订中');
		expect(zhCN['step2.hints.structure']).toContain('英雄之旅');
	});

	it('keeps the Step 3 character terminology exact', () => {
		expect(en['steps.3.title']).toBe('Major character sheet');
		expect(en['steps.3.description']).toBe(
			'Provide a storyline for each major character.\nRecord their motivation, goal, conflict, and growth.',
		);
		expect(en['modal.character.oneSentenceStoryline']).toBe('One-sentence storyline');
		expect(en['modal.character.oneSentenceStorylinePlaceholder']).toBe(
			'Summarize the entire story in one sentence from this character’s point of view.',
		);
		expect(en['modal.character.oneParagraphStoryline']).toBe('One-paragraph storyline');
		expect(en['modal.character.oneParagraphStorylinePlaceholder']).toBe(
			'Expand the one-sentence storyline into a full paragraph.',
		);
		expect(en['modal.character.growth']).toBe('Growth');
		expect(en['modal.character.motivationPlaceholder']).toBe(
			'What does he/she want abstractly?',
		);
		expect(en['modal.character.goalPlaceholder']).toBe(
			'What does he/she want concretely?',
		);
		expect(en['modal.character.conflictPlaceholder']).toBe(
			'What prevents him/her from reaching this goal?',
		);
		expect(en['modal.character.growthPlaceholder']).toBe(
			'What will he/she learn and how will he/she change?',
		);
		expect(zhCN['steps.3.title']).toBe('主要角色表');
		expect(zhCN['steps.3.description']).toBe(
			'提供每位主要角色的故事梗概。\n记录其动机、目标、冲突与成长。',
		);
		expect(zhCN['modal.character.oneSentenceStoryline']).toBe('一句话故事概述');
		expect(zhCN['table.oneSentenceStoryline']).toBe('一句话故事概述');
		expect(zhCN['modal.character.oneParagraphStoryline']).toBe('一段式故事梗概');
		expect(zhCN['modal.character.growth']).toBe('成长');
		expect(en['table.characterType']).toBe('Type');
		expect(en['table.characterTypeShort']).toBe('Type');
		expect(zhCN['table.characterType']).toBe('类型');
		expect(zhCN['table.characterTypeShort']).toBe('类型');
		expect(zhCN['character.major']).toBe('主角');
	});

	it('keeps the Step 4 plot synopsis terminology exact', () => {
		expect(en['steps.4.title']).toBe('Plot synopsis');
		expect(en['steps.4.description']).toBe(
			'Expand each sentence in the one-paragraph summary into a full paragraph.',
		);
		expect(en['step4.sourceSummary.title']).toBe('One-paragraph summary');
		expect(en['step4.hints.title']).toBe('Hints for plot synopsis');
		expect(en['step4.hints.openNote']).toBe(
			'Open the separate note to edit your plot synopsis.',
		);
		expect(en['step4.hints.structure']).not.toContain('Hero');
		expect(en['step4.hints.paragraphs']).toBe(
			'Let each paragraph develop one part of the story, with each ending leading naturally into the next paragraph.',
		);
		expect(en['step4.hints.revision']).toBe(
			'It’s perfectly fine to revisit steps 1 to 3. New discoveries are always useful.',
		);
		expect(zhCN['steps.4.title']).toBe('情节大纲');
		expect(zhCN['steps.4.description']).toBe(
			'将一段式梗概中的每个句子扩展成一个完整的段落。',
		);
		expect(zhCN['step4.sourceSummary.title']).toBe('一段式梗概');
		expect(zhCN['step4.hints.title']).toBe('情节大纲提示');
		expect(zhCN['step4.hints.openNote']).toBe('请打开独立笔记进行编辑。');
	});

	it('keeps the Step 5 character synopsis terminology exact', () => {
		expect(en['steps.5.title']).toBe('Character synopsis');
		expect(en['steps.5.description']).toBe(
			'Retell the story from each character’s point of view.\nExplain how their motivation, goal, conflict, and growth fit into the story.',
		);
		expect(en['step5.hints.title']).toBe('Hints for character synopsis');
		expect(en['step5.hints.reorder']).toBe(
			'Drag to reorder the characters. The row menu moves one to an exact position.',
		);
		expect(en['step5.hints.openNote']).toBe(
			'Open the separate note to edit the character synopsis.',
		);
		expect(en['step5.hints.expand']).toBe(
			'As with the plot synopsis, expand each character’s one-paragraph storyline.',
		);
		expect(en['step5.hints.revision']).toBe(
			'It’s perfectly fine to revisit steps 1 to 4 at any time. Your characters may help you discover something new about your story.',
		);
		expect(zhCN['steps.5.title']).toBe('人物大纲');
		expect(zhCN['steps.5.description']).toBe(
			'从每位角色的视角重新讲述故事。\n解释他们的动机、目标、冲突与成长是如何与故事融为一体的。',
		);
		expect(zhCN['step5.hints.title']).toBe('人物大纲提示');
		expect(zhCN['step5.hints.reorder']).toBe(
			'拖动可以调整角色顺序，行内菜单可将其移动到指定位置。',
		);
		expect(zhCN['step5.hints.openNote']).toBe('请打开独立笔记进行编辑。');
		expect(zhCN['step5.hints.expand']).toBe(
			'与第四步情节大纲类似，拓展角色的一段式故事梗概。',
		);
		expect(zhCN['step5.hints.revision']).toBe(
			'随时回到第一至四步修改也完全没问题。你的角色或许会让你对故事有新的发现。',
		);
	});

	it('formats all Chinese step headings with Chinese numerals', () => {
		const expectedNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
		for (const [index, number] of expectedNumbers.entries()) {
			expect(zhCN[`steps.number.${index + 1}` as keyof typeof zhCN]).toBe(
				number,
			);
		}
		expect(
			t('zh-CN', 'steps.titleFormat', {
				number: zhCN['steps.number.1'],
				title: zhCN['steps.1.title'],
			}),
		).toBe('一、一句话概述');
		expect(
			t('en', 'steps.titleFormat', {
				number: en['steps.number.1'],
				title: en['steps.1.title'],
			}),
		).toBe('1. One-sentence summary');
	});

	it('keeps the Step 6 long synopsis terminology and hints exact', () => {
		expect(en['steps.6.title']).toBe('Long synopsis');
		expect(en['steps.6.description']).toBe(
			'Expand each paragraph of the plot synopsis into full-page content.',
		);
		expect(en['step6.hints.title']).toBe('Hints for long synopsis');
		expect(en['step6.hints.pageLength']).toBe(
			'Full-page content is about 500 words.',
		);
		expect(en['step6.sourceSynopsis.title']).toBe('Plot synopsis');
		expect(en['step6.sourceSynopsis.empty']).toBe(
			'Complete step 4 and the plot synopsis will appear here.',
		);
		expect(zhCN['steps.6.title']).toBe('长篇大纲');
		expect(zhCN['steps.6.description']).toBe(
			'将情节大纲中的每个段落拓展成完整一页的内容。',
		);
		expect(zhCN['step6.hints.title']).toBe('长篇大纲提示');
		expect(zhCN['step6.hints.pageLength']).toBe(
			'完整一页的内容大概为八百字。',
		);
		expect(zhCN['step6.sourceSynopsis.title']).toBe('情节大纲');
		expect(zhCN['step6.sourceSynopsis.empty']).toBe(
			'完成第四步后，情节大纲会显示在这里。',
		);
		expect(zhCN['step6.hints.revision']).toBe(
			'随时回到第一至五步修改也完全没问题。这可以帮你补充更多的故事和人物细节。',
		);
	});

	it('keeps the Step 7 character profiles terminology and hints exact', () => {
		expect(en['steps.7.title']).toBe('Character profiles');
		expect(en['steps.7.description']).toBe(
			'Explore each character in your novel in depth.\nThis is where you can keep everything related to them.',
		);
		expect(en['step7.hints.title']).toBe('Hints for character profiles');
		expect(en['step7.hints.contents']).toBe(
			'Character profiles may include basic information, appearance and personality, personal background, relationships, status at different stages of the story, and more.',
		);
		expect(en['step7.hints.storyDetails']).toBe(
			'You can add any character details that help the story.',
		);
		expect(en['step7.hints.revision']).toBe(
			'It’s perfectly fine to revisit steps 1 to 6 at any time. New details may spark new ideas.',
		);
		expect(zhCN['steps.7.title']).toBe('角色档案');
		expect(zhCN['steps.7.description']).toBe(
			'深入研究小说中的每个人物。\n这里将保存与他们相关的所有信息。',
		);
		expect(zhCN['step7.hints.title']).toBe('角色档案提示');
		expect(zhCN['step7.hints.contents']).toBe(
			'档案可以包含：基本信息、外貌性格、成长环境、情感关系、阶段状态等。',
		);
		expect(zhCN['step7.hints.storyDetails']).toBe(
			'你可以添加任意对剧情有帮助的人物细节。',
		);
		expect(zhCN['step7.hints.revision']).toBe(
			'随时回到第一至六步修改也完全没问题。新的细节也许会激发你新的想法。',
		);
	});

	it('keeps the Step 8 scene list terminology and hints exact', () => {
		expect(en['modal.scene.time']).toBe('Time');
		expect(en['modal.scene.location']).toBe('Location');
		expect(en['modal.scene.characters']).toBe('Characters');
		expect(en['modal.scene.conflict']).toBe('Conflict');
		expect(en['modal.scene.pov']).toBe('Point-of-view character');
		expect(en['modal.scene.events']).toBe('Specific events');
		expect(zhCN['modal.scene.time']).toBe('时间');
		expect(zhCN['modal.scene.location']).toBe('地点');
		expect(zhCN['modal.scene.characters']).toBe('人物');
		expect(zhCN['modal.scene.conflict']).toBe('冲突');
		expect(zhCN['modal.scene.pov']).toBe('视点人物');
		expect(zhCN['modal.scene.events']).toBe('具体事件');
		expect(en['scenes.empty']).toBe('No scenes');
		expect(zhCN['scenes.empty']).toBe('尚未添加场景');
		expect(en['steps.8.title']).toBe('Scene list');
		expect(en['steps.8.description']).toBe(
			'Scenes are the fundamental building blocks of a novel.\nList as many scenes in the novel as possible.',
		);
		expect(en['step8.hints.title']).toBe('Hints for scene list');
		expect(en['step8.hints.conflict']).toBe('conflict');
		expect(en['step8.hints.elementsAfter']).toBe(
			' (don’t add a scene solely for exposition or atmosphere).',
		);
		expect(en['step8.hints.canvasBefore']).toBe(
			'You can use the following table or explore',
		);
		expect(en['step8.hints.canvasAction']).toBe('Obsidian Canvas');
		expect(en['step8.hints.canvasAfter']).toBe(
			'to create a “timeline” or “scene board”.',
		);
		expect(en['step8.hints.revision']).toBe(
			'It’s perfectly fine to revisit steps 1 to 7 at any time. Seeing your scenes take shape often helps you understand your story and characters more deeply.',
		);
		expect(zhCN['steps.8.title']).toBe('场景列表');
		expect(zhCN['steps.8.description']).toBe(
			'场景是小说中最基本的创作单位。\n尽可能罗列出小说中所有的场景。',
		);
		expect(zhCN['step8.hints.title']).toBe('场景列表提示');
		expect(zhCN['step8.hints.conflict']).toBe('冲突');
		expect(zhCN['step8.hints.canvasBefore']).toBe(
			'你可以使用下方表格，也可以利用',
		);
		expect(zhCN['step8.hints.canvasAction']).toBe('Obsidian Canvas');
		expect(zhCN['step8.hints.canvasAfter']).toBe(
			'构造「时间线」或者「场景看板」。',
		);
		expect(zhCN['step8.hints.revision']).toBe(
			'随时回到第一至七步修改也完全没问题。场景的展现往往会让你更深入地了解故事和人物。',
		);
		expect(en['steps.9.title']).toBe('Scene planning (optional)');
		expect(en['step9.hints.title']).toBe('Hints for scene list');
		expect(en['step9.hints.sceneTypes']).toContain(
			'goal → conflict → setback',
		);
		expect(zhCN['steps.9.title']).toBe('场景规划（可选）');
		expect(zhCN['steps.9.description']).toBe(
			'可选步骤：在正式创作前进一步设计场景内的冲突，\n包括你觉得需要强调的爽点、笑点、伏笔、精彩对话等。',
		);
		expect(zhCN['step9.hints.sceneTypes']).toContain(
			'反应 → 困境 → 决定',
		);
		expect(en['steps.10.title']).toBe('Write your novel!');
		expect(en['steps.10.description']).toBe(
			'Congratulations! You now have a thoughtfully designed story!\nWrite your novel! Remember to revisit and revise the earlier steps whenever you need to.',
		);
		expect(zhCN['steps.10.title']).toBe('开始创作吧！');
		expect(zhCN['steps.10.description']).toBe(
			'恭喜！你现在已经有了一个精心设计的故事了！\n开始创作吧！记得在需要的时候，继续回头修订之前的步骤。',
		);
	});

	it('interpolates known variables and preserves missing placeholders', () => {
		expect(t('en', 'messages.projectCreated', { name: 'North Star' })).toBe(
			'Created Snowflake project “North Star”.',
		);
		expect(t('en', 'messages.sceneCreated')).toContain('{name}');
	});

	it('falls back safely for incremental UI keys', () => {
		expect(t('zh-CN', 'future.untranslated')).toBe('future.untranslated');
		expect(translate('en', 'common.save')).toBe('Save');
	});
});

describe('locale resolution', () => {
	it('uses the Obsidian language for global UI without a project context', () => {
		expect(resolveGlobalLocale('project', 'zh-CN')).toBe('zh-CN');
		expect(resolveGlobalLocale('project', 'en-GB')).toBe('en');
		expect(resolveGlobalLocale('system', 'zh-CN')).toBe('zh-CN');
		expect(resolveGlobalLocale('en', 'zh-CN')).toBe('en');
	});

	it('follows the current project language when selected', () => {
		expect(resolveLocale('project', 'en-GB', 'zh-CN')).toBe('zh-CN');
		expect(resolveLocale('project', 'zh-CN', 'en')).toBe('en');
	});

	it('honors explicit language choices', () => {
		expect(resolveLocale('en', 'zh-CN')).toBe('en');
		expect(resolveLocale('zh-CN', 'en-GB')).toBe('zh-CN');
	});

	it('maps Chinese system locales to Simplified Chinese', () => {
		for (const locale of ['zh', 'zh-CN', 'zh_Hans', 'zh-TW']) {
			expect(resolveLocale('system', locale)).toBe('zh-CN');
		}
	});

	it('falls back to English for every other system locale', () => {
		expect(resolveLocale('system', 'en-GB')).toBe('en');
		expect(resolveLocale('system', 'fr-FR')).toBe('en');
		expect(resolveLocale('system', '')).toBe('en');
	});

	it('recognizes only public supported locale identifiers', () => {
		expect(isSupportedLocale('en')).toBe(true);
		expect(isSupportedLocale('zh-CN')).toBe(true);
		expect(isSupportedLocale('system')).toBe(false);
		expect(isSupportedLocale('zh-TW')).toBe(false);
	});
});
