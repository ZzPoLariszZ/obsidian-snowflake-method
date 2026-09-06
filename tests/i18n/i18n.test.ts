import { describe, expect, it } from 'vitest';

import {
	BAND_SPANS,
	DERIVED_TASK_KEYS,
	FORESHADOWING_STATUSES,
	HEATMAP_MEASURES,
	OCCURRENCE_ROLES,
	READING_MEASURES,
	WRITING_MODES,
	STICKY_NOTE_COLORS,
	TASK_PRIORITIES,
	TASK_STATUSES,
} from '../../src/domain';
import { TASKS_TABS } from '../../src/ui/dashboard-state';
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
		expect(en['commands.toggleDashboardRail']).toBe(
			'Toggle the dashboard rail',
		);
		expect(zhCN['commands.toggleDashboardRail']).toBe('切换工作台导航栏');
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
		// The character table names the category rather than the discarded
		// type, and the role reads as one category among them.
		expect(en['table.category']).toBe('Category');
		expect(zhCN['table.category']).toBe('类别');
		// Both tables head their first column with a plain name; only Chinese
		// tells a person's name from a thing's.
		expect(en['table.sceneName']).toBe('Name');
		expect(zhCN['table.sceneName']).toBe('名称');
		expect(zhCN['table.name']).toBe('姓名');
		expect(Object.keys(en)).not.toContain('table.characterType');
		expect(Object.keys(en)).not.toContain('character.major');
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

	/**
	 * The statistics pane names its tab through a built key, so nothing in the
	 * type checker points at this label. Parity only compares one locale to the
	 * other, and a label dropped from both would pass it.
	 */
	it('names the data statistics pane and every tab on it', () => {
		expect(en['dashboard.statistics']).toBe('Data statistics');
		expect(zhCN['dashboard.statistics']).toBe('数据统计');
		expect(Object.keys(en)).toContain('dashboard.statistics.description');
		expect(en['statistics.tab.sessions']).toBe('Writing sessions');
		expect(zhCN['statistics.tab.sessions']).toBe('写作时段');
		expect(en['statistics.tab.prose']).toBe('Prose analysis');
		expect(zhCN['statistics.tab.prose']).toBe('正文分析');
		expect(en['statistics.tab.entities']).toBe('Entity tracking');
		expect(zhCN['statistics.tab.entities']).toBe('实体追踪');
		expect(Object.keys(en)).toContain('statistics.tab.planned');
	});

	/**
	 * The manuscript toolbar builds its buttons from a spec loop, and the
	 * toggle command's name goes through the untyped global accessor, so the
	 * type checker never sees any of these keys. Dropped from both locales
	 * they would render as raw keys and every other check would pass.
	 */
	it('labels every manuscript toolbar control in both languages', () => {
		expect(en['commands.manuscriptStopEditing']).toBe(
			'Stop editing the current manuscript note',
		);
		expect(zhCN['commands.manuscriptStopEditing']).toBe('退出当前正文笔记的编辑');
		expect(en['manuscript.toolbar.undo']).toBe('Undo');
		expect(zhCN['manuscript.toolbar.undo']).toBe('撤销');
		expect(en['manuscript.toolbar.redo']).toBe('Redo');
		expect(zhCN['manuscript.toolbar.redo']).toBe('重做');
		expect(en['manuscript.toolbar.heading2']).toBe('Heading 2');
		expect(zhCN['manuscript.toolbar.heading2']).toBe('标题 2');
		expect(en['manuscript.toolbar.heading3']).toBe('Heading 3');
		expect(zhCN['manuscript.toolbar.heading3']).toBe('标题 3');
		expect(en['manuscript.toolbar.heading']).toBe('Heading levels');
		expect(zhCN['manuscript.toolbar.heading']).toBe('标题级别');
		expect(en['manuscript.toolbar.headingLevel']).toBe('Heading {level}');
		expect(zhCN['manuscript.toolbar.headingLevel']).toBe('标题 {level}');
		expect(en['manuscript.toolbar.bold']).toBe('Bold');
		expect(zhCN['manuscript.toolbar.bold']).toBe('粗体');
		expect(en['manuscript.toolbar.italic']).toBe('Italic');
		expect(zhCN['manuscript.toolbar.italic']).toBe('斜体');
		expect(en['manuscript.toolbar.strikethrough']).toBe('Strikethrough');
		expect(zhCN['manuscript.toolbar.strikethrough']).toBe('删除线');
		expect(en['manuscript.toolbar.underline']).toBe('Underline');
		expect(zhCN['manuscript.toolbar.underline']).toBe('下划线');
		expect(en['manuscript.toolbar.highlight']).toBe('Highlight');
		expect(zhCN['manuscript.toolbar.highlight']).toBe('高亮');
	});

	/**
	 * The hover-preview feeds register through the untyped global accessor
	 * and their names surface in Obsidian's own Page preview settings, where
	 * a raw key would look like a broken plugin.
	 */
	it('names both manuscript hover sources in both languages', () => {
		expect(en['manuscript.hoverSource.reading']).toBe(
			'Snowflake Method manuscript (reading)',
		);
		expect(zhCN['manuscript.hoverSource.reading']).toBe('雪花写作法正文（阅读）');
		expect(en['manuscript.hoverSource.editing']).toBe(
			'Snowflake Method manuscript (editing)',
		);
		expect(zhCN['manuscript.hoverSource.editing']).toBe('雪花写作法正文（编辑）');
	});

	/**
	 * The appearance rows, and the popover that repeats them over the
	 * manuscript, read their labels through the same untyped accessors, so
	 * every key is swept here in both locales.
	 */
	it('labels the manuscript appearance settings in both languages', () => {
		const keys = [
			'settings.manuscriptAppearance.heading',
			'settings.manuscriptAppearance.themeDefault',
			'settings.manuscriptAppearance.pixels',
			'settings.manuscriptAppearance.reset',
			'settings.manuscriptFontFamily.name',
			'settings.manuscriptFontFamily.desc',
			'settings.manuscriptFontFamily.placeholder',
			'settings.manuscriptFontFamily.use',
			'settings.manuscriptFontFamily.missing',
			'settings.manuscriptFontFamily.recent',
			'settings.manuscriptFontFamily.all',
			'settings.manuscriptFontSize.name',
			'settings.manuscriptFontSize.desc',
			'settings.manuscriptLineHeight.name',
			'settings.manuscriptLineHeight.desc',
			'settings.manuscriptContentWidth.name',
			'settings.manuscriptContentWidth.desc',
			'settings.manuscriptParagraphSpacing.name',
			'settings.manuscriptParagraphSpacing.desc',
			'settings.manuscriptParagraphSpacing.line',
			'settings.manuscriptParagraphSpacing.lines',
			'settings.manuscriptFirstLineIndent.name',
			'settings.manuscriptFirstLineIndent.desc',
			'settings.manuscriptFirstLineIndent.none',
			'settings.manuscriptFirstLineIndent.value',
			'settings.manuscriptTextAlign.name',
			'settings.manuscriptTextAlign.desc',
			'settings.manuscriptTextAlign.start',
			'settings.manuscriptTextAlign.justify',
			'settings.manuscriptHyphenation.name',
			'settings.manuscriptHyphenation.desc',
			'settings.manuscriptTintLight.name',
			'settings.manuscriptTintLight.desc',
			'settings.manuscriptTintDark.name',
			'settings.manuscriptTintDark.desc',
			'settings.manuscriptTint.themeDefault',
			'settings.manuscriptTint.custom',
			'settings.manuscriptGuide.name',
			'settings.manuscriptGuide.desc',
			'settings.manuscriptGuide.none',
			'settings.manuscriptGuide.solid',
			'settings.manuscriptGuide.dashed',
			'manuscript.toolbar.presentation',
		];
		for (const name of [
			'sageGreen',
			'parchmentBeige',
			'mistBlue',
			'mistPink',
			'midnightBlue',
			'slateGray',
			'plumPurple',
			'indigoBlue',
		]) {
			keys.push(`settings.manuscriptTint.${name}`);
		}
		for (const key of keys) {
			expect(Object.keys(en), key).toContain(key);
			expect(Object.keys(zhCN), key).toContain(key);
		}
		expect(en['settings.manuscriptAppearance.heading']).toBe('Typography');
		expect(zhCN['settings.manuscriptAppearance.heading']).toBe('排版');
		// The guides are named for what they draw rather than for how they run,
		// and each style is one word in both languages.
		expect(en['settings.manuscriptGuide.name']).toBe('Grid lines');
		expect(zhCN['settings.manuscriptGuide.name']).toBe('网格线');
		expect(en['settings.manuscriptGuide.solid']).toBe('Solid');
		expect(en['settings.manuscriptGuide.dashed']).toBe('Dashed');
		expect(zhCN['settings.manuscriptGuide.solid']).toBe('实线');
		expect(zhCN['settings.manuscriptGuide.dashed']).toBe('虚线');
	});

	/**
	 * Said from the stream through the project locale's untyped accessor when
	 * a note changed under a save, so both locales must carry it.
	 */
	it('labels the Enter setting in both languages', () => {
		expect(en['settings.manuscriptEnterParagraph.name']).toBe(
			'Enter starts a new paragraph',
		);
		expect(Object.keys(zhCN)).toContain('settings.manuscriptEnterParagraph.desc');
	});

	it('tells the author a note changed elsewhere, in both languages', () => {
		expect(en['manuscript.changedElsewhere']).toContain('kept');
		expect(Object.keys(zhCN)).toContain('manuscript.changedElsewhere');
	});

	/**
	 * The settings page reads its labels through an untyped accessor, so the
	 * auto-pair rows would render raw keys if these went missing from both
	 * locales at once.
	 */
	it('labels the auto-pair settings in both languages', () => {
		expect(en['settings.manuscriptAutoPairBrackets.name']).toBe(
			'Auto-pair brackets and quotes',
		);
		expect(zhCN['settings.manuscriptAutoPairBrackets.name']).toBe(
			'自动配对括号与引号',
		);
		expect(Object.keys(en)).toContain('settings.manuscriptAutoPairBrackets.desc');
		expect(en['settings.manuscriptAutoPairMarkdown.name']).toBe(
			'Auto-pair Markdown syntax',
		);
		expect(zhCN['settings.manuscriptAutoPairMarkdown.name']).toBe(
			'自动配对 Markdown 语法',
		);
		expect(Object.keys(en)).toContain('settings.manuscriptAutoPairMarkdown.desc');
	});

	/**
	 * The three session widgets build their row labels and their controls from
	 * keys the type checker never sees, so a rename that misses one shows up
	 * as a raw key on the pane rather than as a failure anywhere else.
	 */
	it('labels every part of the three session widgets', () => {
		const keys = [
			'sessionWidget.goal.title',
			'sessionWidget.goal.edit',
			'sessionWidget.goal.progress',
			'sessionWidget.goal.unset',
			'sessionWidget.timer.title',
			'sessionWidget.timer.edit',
			'sessionWidget.cycle',
			'sessionWidget.start',
			'sessionWidget.pause',
			'sessionWidget.resume',
			'sessionWidget.stop',
			'sessionWidget.today.title',
			'sessionWidget.today.sessions',
			'sessionWidget.today.total',
			'sessionWidget.today.focus',
			'sessionWidget.today.idle',
			'sessionWidget.today.words',
			'sessionWidget.today.pace',
			'sessionWidget.today.paceValue',
			'modal.dailyGoal.title',
			'modal.dailyGoal.words.project',
			'modal.dailyGoal.words.manuscript',
			'modal.dailyGoal.desc.project',
			'modal.dailyGoal.desc.manuscript',
			'modal.dailyGoal.scope',
			'modal.dailyGoal.scope.desc',
			'modal.sessionSetup.title',
			'modal.sessionSetup.type',
			'modal.sessionSetup.stage',
			'modal.sessionSetup.focus',
			'modal.sessionSetup.break',
			'modal.sessionSetup.expected',
			'modal.sessionSetup.expectedDesc',
		];
		for (const key of keys) {
			expect(Object.keys(en), key).toContain(key);
			expect(Object.keys(zhCN), key).toContain(key);
		}
		expect(
			t('en', 'sessionWidget.goal.progress', { net: '40', goal: '1,000' }),
		).toBe('40 / 1,000');
		expect(zhCN['session.type.stopwatch']).toBe('正计时');
		expect(t('en', 'sessionWidget.cycle', { cycle: '01' })).toBe('Cycle 01');
		expect(t('zh-CN', 'sessionWidget.cycle', { cycle: '01' })).toBe('周期 01');
		expect(t('zh-CN', 'sessionWidget.today.paceValue', { pace: 900 })).toBe(
			'900 字/小时',
		);
	});

	/**
	 * The two readings that span more than a day build their choosers and their
	 * tooltips from keys the type checker never sees either, and a tooltip with
	 * a raw key in it is only ever found by pointing at the right day.
	 */
	it('labels the recent trend and the writing heatmap', () => {
		const keys = [
			'sessionWidget.trend.title',
			'sessionWidget.trend.range',
			'sessionWidget.trend.measure',
			'sessionWidget.trend.days',
			'sessionWidget.trend.average',
			'sessionWidget.trend.highest',
			'sessionWidget.trend.total',
			'sessionWidget.trend.hours',
			'sessionWidget.trend.wordsDetail',
			'sessionWidget.trend.timeDetail',
			'sessionWidget.heatmap.title',
			'sessionWidget.heatmap.measure',
			'sessionWidget.heatmap.goal',
			'sessionWidget.heatmap.less',
			'sessionWidget.heatmap.more',
			'sessionWidget.heatmap.noGoalDetail',
			'sessionWidget.heatmap.completed',
			'sessionWidget.heatmap.uncompleted',
			'settings.sessionWeekStart.name',
			'settings.sessionWeekStart.desc',
			'settings.sessionDateFormat.name',
			'settings.sessionDateFormat.desc',
		];
		for (const key of keys) {
			expect(Object.keys(en), key).toContain(key);
			expect(Object.keys(zhCN), key).toContain(key);
		}
		// All four readings share one measure and therefore one set of names,
		// built from the vocabulary rather than from a list of their own, so a
		// measure added later is caught here. The year's own extra reading is
		// the only one named beside them.
		for (const measure of READING_MEASURES) {
			expect(Object.keys(en)).toContain(`sessionWidget.measure.${measure}`);
			expect(Object.keys(zhCN)).toContain(`sessionWidget.measure.${measure}`);
		}
		for (const measure of HEATMAP_MEASURES) {
			if (measure === 'goal') continue;
			expect(READING_MEASURES as readonly string[]).toContain(measure);
		}
		expect(Object.keys(en)).toContain('sessionWidget.heatmap.goal');
		expect(Object.keys(zhCN)).toContain('sessionWidget.heatmap.goal');
		expect(t('en', 'sessionWidget.trend.days', { days: 30 })).toBe(
			'Last 30 days',
		);
		expect(t('zh-CN', 'sessionWidget.trend.days', { days: 30 })).toBe(
			'最近 30 天',
		);
		expect(en['sessionWidget.heatmap.title']).toBe('Annual contribution');
		// Every part of a detail line is a reading in its own right, so each is
		// capitalized the same way rather than the first alone.
		for (const key of ['trend.wordsDetail', 'trend.timeDetail'] as const) {
			for (const part of (en[`sessionWidget.${key}`] as string).split(' · ')) {
				expect(part[0], part).toBe(part[0]?.toUpperCase());
			}
		}
		expect(zhCN['sessionWidget.heatmap.title']).toBe('年度贡献');
	});

	/**
	 * The five readings under them build their choosers from the vocabulary
	 * too, and two of them name a measure from a list they share, so a measure
	 * added to either is caught here rather than in a chooser.
	 */
	it('labels the calendar, the two goals, the hours and the modes', () => {
		const keys = [
			'sessionWidget.calendar.title',
			'sessionWidget.calendar.measure',
			'sessionWidget.calendar.previous',
			'sessionWidget.calendar.next',
			'sessionWidget.calendar.met',
			'sessionWidget.week.title',
			'sessionWidget.month.title',
			'sessionWidget.bands.title',
			'sessionWidget.bands.span',
			'sessionWidget.bands.measure',
			'sessionWidget.bands.share',
			'sessionWidget.modes.title',
			'sessionWidget.modes.focus',
			'sessionWidget.modes.share',
		];
		for (const key of keys) {
			expect(Object.keys(en), key).toContain(key);
			expect(Object.keys(zhCN), key).toContain(key);
		}
		for (const span of BAND_SPANS) {
			expect(Object.keys(en)).toContain(`sessionWidget.bands.${span}`);
			expect(Object.keys(zhCN)).toContain(`sessionWidget.bands.${span}`);
		}
		// The donut names its slices from the session vocabulary the start
		// dialog already speaks, so the two can never drift apart.
		for (const mode of WRITING_MODES) {
			expect(Object.keys(en)).toContain(`session.mode.${mode}`);
			expect(Object.keys(zhCN)).toContain(`session.mode.${mode}`);
		}
		expect(t('en', 'sessionWidget.bands.share', { share: '32.1' })).toBe(
			'32.1%',
		);
		// The gauges name the scope they are measuring, so a goal on the
		// project beside a day read as the manuscript reads as two questions.
		expect(en['sessionWidget.week.title']).toBe('Weekly goal ({scope})');
		expect(zhCN['sessionWidget.month.title']).toBe('每月目标（{scope}）');
		for (const scope of ['project', 'manuscript'] as const) {
			expect(Object.keys(en)).toContain(`session.scope.short.${scope}`);
			expect(Object.keys(zhCN)).toContain(`session.scope.short.${scope}`);
		}
		// A goal field and the scope it is aimed at are named the same way, so
		// the dialog reads as one question rather than two vocabularies.
		expect(en['modal.dailyGoal.words.project']).toContain(
			en['session.scope.project'].toLowerCase(),
		);
		expect(en['modal.dailyGoal.words.manuscript']).toContain(
			en['session.scope.manuscript'].toLowerCase(),
		);
		expect(zhCN['modal.dailyGoal.words.project']).toContain(
			zhCN['session.scope.project'],
		);
		expect(zhCN['modal.dailyGoal.words.manuscript']).toContain(
			zhCN['session.scope.manuscript'],
		);
		expect(en['sessionWidget.bands.title']).toBe('Temporal distribution');
		expect(zhCN['sessionWidget.bands.title']).toBe('时间分布');
		expect(en['sessionWidget.modes.title']).toBe('Writing stages');
		expect(zhCN['sessionWidget.modes.title']).toBe('写作阶段');
	});

	/**
	 * A writing session is a 时段 in Chinese, never a 会话: the second is what a
	 * chat or a login has, and it read as the wrong kind of thing everywhere a
	 * sitting at the desk was meant.
	 */
	it('calls a writing session a 时段 throughout the Chinese copy', () => {
		const offenders = Object.entries(zhCN).filter(([, value]) =>
			value.includes('会话'),
		);
		expect(offenders).toEqual([]);
		expect(zhCN['sessionWidget.today.sessions']).toBe('时段数');
		expect(zhCN['sessionWidget.timer.title']).toBe('专注计时');
		expect(zhCN['sessionWidget.today.title']).toBe('今日总结');
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

describe('word milestone copy', () => {
	it('labels the milestone settings and the label itself in both languages', () => {
		const keys = [
			'settings.milestones.heading',
			'settings.manuscriptMilestones.name',
			'settings.manuscriptMilestones.desc',
			'settings.manuscriptMilestoneMode.name',
			'settings.manuscriptMilestoneMode.desc',
			'settings.manuscriptMilestoneMode.manuscript',
			'settings.manuscriptMilestoneMode.chapter',
			'settings.manuscriptMilestoneInterval.name',
			'settings.manuscriptMilestoneInterval.desc',
			'settings.manuscriptMilestoneInterval.invalid',
			'manuscript.milestoneLabel',
		];
		for (const key of keys) {
			expect(Object.keys(en), key).toContain(key);
			expect(Object.keys(zhCN), key).toContain(key);
		}
		expect(en['settings.milestones.heading']).toBe('Word milestone');
		expect(zhCN['settings.milestones.heading']).toBe('字数里程碑');
		// The label reads as the mockup does: a count and its unit, and in
		// Chinese the two stand together.
		expect(en['manuscript.milestoneLabel']).toBe('{count} {unit}');
		expect(zhCN['manuscript.milestoneLabel']).toBe('{count}{unit}');
	});
});

describe('automatic chapter number copy', () => {
	it('labels the numbering settings, the rule dialog, the naming form and its messages in both languages', () => {
		const keys = [
			'settings.chapterNumbering.heading',
			'settings.manuscriptChapterNumbering.name',
			'settings.manuscriptChapterNumbering.off',
			'settings.manuscriptChapterNumbering.chinese',
			'settings.manuscriptChapterNumbering.chineseArabic',
			'settings.manuscriptChapterNumbering.english',
			'settings.manuscriptChapterNumbering.custom',
			'settings.chapterNumberRules.add',
			'settings.chapterNumberRules.kindFormat',
			'settings.chapterNumberRules.kindRegex',
			'settings.chapterNumberRules.pause',
			'settings.chapterNumberRules.resume',
			'modal.chapterNumberRule.createTitle',
			'modal.chapterNumberRule.editTitle',
			'modal.chapterNumberRule.kind',
			'modal.chapterNumberRule.format',
			'modal.chapterNumberRule.formatDesc',
			'modal.chapterNumberRule.formatInvalid',
			'modal.chapterNumberRule.pattern',
			'modal.chapterNumberRule.patternDesc',
			'modal.chapterNumberRule.patternInvalid',
			'modal.chapterNumberRule.seed',
			'modal.chapterNumberRule.seedDesc',
			'modal.chapterNumberRule.deleteTitle',
			'modal.chapterNumberRule.deleteBody',
			'manuscript.segmentNumber',
			'manuscript.renumberFollowers',
			'manuscript.renumberFollowersDown',
			'messages.segmentsRenumbered',
			'messages.segmentsRenumberedSkipped',
			'messages.segmentsNotRenumbered',
			'errors.renumberConflict',
		];
		for (const key of keys) {
			expect(Object.keys(en), key).toContain(key);
			expect(Object.keys(zhCN), key).toContain(key);
		}
		expect(en['settings.chapterNumbering.heading']).toBe('Automatic chapter number');
		expect(zhCN['settings.chapterNumbering.heading']).toBe('自动章节编号');
		// The dialog carries the two example patterns the rule was asked for,
		// and the format examples with each placeholder.
		for (const locale of [en, zhCN]) {
			expect(locale['modal.chapterNumberRule.patternDesc']).toContain(
				'^第\\s*(?!0000)\\d{4}\\s*章\\s+.+$',
			);
			expect(locale['modal.chapterNumberRule.patternDesc']).toContain(
				'^Chapter\\s*(?!0000)\\d{4}\\s+.+$',
			);
			expect(locale['modal.chapterNumberRule.formatDesc']).toContain('Chapter {nnnn}');
			expect(locale['modal.chapterNumberRule.formatDesc']).toContain('第{zh}章');
			expect(locale['modal.chapterNumberRule.deleteTitle']).toContain('{name}');
			expect(locale['manuscript.renumberFollowers']).toContain('{count}');
			expect(locale['manuscript.renumberFollowersDown']).toContain('{count}');
			expect(locale['errors.renumberConflict']).toContain('{path}');
			// The notes a renumbering could not touch are counted where it says
			// what it did, and said on their own when it did nothing.
			expect(locale['messages.segmentsRenumberedSkipped']).toContain('{count}');
			expect(locale['messages.segmentsRenumberedSkipped']).toContain('{skipped}');
			expect(locale['messages.segmentsNotRenumbered']).toContain('{skipped}');
		}
	});
});

describe('plaintext export copy', () => {
	it('labels the export section, the buttons, the commands and the messages in both languages', () => {
		const keys = [
			'settings.section.export',
			'settings.exportFolder.name',
			'settings.exportFolder.desc',
			'settings.exportFolder.placeholder',
			'settings.exportFolder.invalid',
			'settings.exportFormat.name',
			'settings.exportFormat.desc',
			'settings.exportFormat.md',
			'settings.exportFormat.txt',
			'settings.exportIndent.name',
			'settings.exportIndent.desc',
			'settings.exportParagraphSpacing.name',
			'settings.exportParagraphSpacing.desc',
			'settings.exportManuscript.heading',
			'settings.exportManuscriptLayout.name',
			'settings.exportManuscriptLayout.desc',
			'settings.exportManuscriptLayout.single',
			'settings.exportManuscriptLayout.folder',
			'settings.exportChapterSeparator.name',
			'settings.exportChapterSeparator.desc',
			'settings.exportChapterSeparator.blank',
			'settings.exportChapterSeparator.rule',
			'settings.exportChapterSeparator.asterisks',
			'manuscript.toolbar.export',
			'manuscript.exportNote',
			'manuscript.copyNote',
			'commands.exportManuscript',
			'commands.exportManuscriptNote',
			'commands.copyManuscriptNote',
			'modal.exportReplace.title',
			'modal.exportReplace.question',
			'modal.exportReplace.more',
			'modal.exportReplace.consequence',
			'modal.exportReplace.confirm',
			'messages.exported',
			'messages.exportedMany',
			'messages.exportNothing',
			'messages.copiedNote',
			'errors.exportIntoManuscript',
		];
		for (const key of keys) {
			expect(Object.keys(en), key).toContain(key);
			expect(Object.keys(zhCN), key).toContain(key);
		}
		expect(en['settings.section.export']).toBe('Export');
		expect(zhCN['settings.section.export']).toBe('导出');
		for (const locale of [en, zhCN]) {
			expect(locale['messages.exported']).toContain('{path}');
			expect(locale['messages.exportedMany']).toContain('{count}');
			expect(locale['modal.exportReplace.question']).toContain('{count}');
			expect(locale['errors.exportIntoManuscript']).toContain('{path}');
		}
	});
});

/**
 * The foreshadowing copy is read through untyped accessors -- a status or a
 * role interpolated into its key, a table column named by its id -- so the
 * type checker never sees a key go missing. The sweep does.
 */
describe('foreshadowing copy', () => {
	it('names every status and role in both languages, in the words the author fixed', () => {
		for (const status of FORESHADOWING_STATUSES) {
			expect(Object.keys(en), status).toContain(`foreshadowing.status.${status}`);
			expect(Object.keys(zhCN), status).toContain(`foreshadowing.status.${status}`);
		}
		for (const role of OCCURRENCE_ROLES) {
			expect(Object.keys(en), role).toContain(`foreshadowing.role.${role}`);
			expect(Object.keys(zhCN), role).toContain(`foreshadowing.role.${role}`);
		}
		expect(zhCN['tasks.tab.foreshadowing']).toBe('伏笔');
		expect(zhCN['foreshadowing.item']).toBe('伏笔');
		expect(zhCN['foreshadowing.occurrence']).toBe('落点');
		expect(zhCN['foreshadowing.role.plant']).toBe('埋设');
		expect(zhCN['foreshadowing.role.reinforce']).toBe('强化');
		expect(zhCN['foreshadowing.role.payoff']).toBe('回收');
		expect(zhCN['foreshadowing.status.resolved']).toBe('已回收');
	});

	it('labels the stream flows, the cards and the dialogs in both languages', () => {
		const keys = [
			'manuscript.foreshadowing.create',
			'manuscript.foreshadowing.addExisting',
			'manuscript.foreshadowing.relink',
			'manuscript.foreshadowing.addTitle',
			'manuscript.foreshadowing.relinkTitle',
			'manuscript.foreshadowing.role',
			'manuscript.foreshadowing.status',
			'manuscript.foreshadowing.name',
			'manuscript.foreshadowing.description',
			'manuscript.foreshadowing.note',
			'manuscript.foreshadowing.noteOptional',
			'manuscript.foreshadowing.notePlaceholder',
			'manuscript.foreshadowing.place',
			'manuscript.foreshadowing.passage',
			'manuscript.foreshadowing.pick',
			'manuscript.foreshadowing.pickPlaceholder',
			'manuscript.foreshadowing.pickEmpty',
			'manuscript.foreshadowing.pickRequired',
			'manuscript.foreshadowing.occurrencePick',
			'manuscript.foreshadowing.occurrencePlaceholder',
			'manuscript.foreshadowing.unresolved',
			'manuscript.foreshadowing.unresolvedHint',
			'manuscript.foreshadowing.noUnresolved',
			'manuscript.foreshadowing.text',
			'manuscript.foreshadowing.stale',
			'manuscript.foreshadowing.duplicate',
			'manuscript.foreshadowing.refused',
			'manuscript.foreshadowing.open',
			'manuscript.foreshadowing.delete',
			'manuscript.foreshadowing.previous',
			'manuscript.foreshadowing.next',
			'modal.foreshadowing.title',
			'modal.foreshadowing.editTitle',
			'modal.foreshadowing.name',
			'modal.foreshadowing.nameRequired',
			'modal.foreshadowing.nameTaken',
			'modal.foreshadowing.description',
			'modal.foreshadowing.related',
			'modal.foreshadowing.relatedPlaceholder',
			'modal.foreshadowing.relatedEmpty',
			'modal.foreshadowing.relatedRemove',
			'modal.foreshadowing.relatedMissing',
			'modal.foreshadowing.initialOccurrence',
			'modal.foreshadowing.occurrences',
			'modal.foreshadowing.occurrencesEmpty',
			'modal.foreshadowing.occurrenceDelete',
			'modal.foreshadowing.deleteTitle',
			'modal.foreshadowing.deleteDescription',
			'modal.occurrence.title',
		];
		for (const key of keys) {
			expect(Object.keys(en), key).toContain(key);
			expect(Object.keys(zhCN), key).toContain(key);
		}
		for (const key of [
			'modal.foreshadowing.relatedRemove',
			'modal.foreshadowing.relatedMissing',
			'modal.foreshadowing.deleteTitle',
		]) {
			expect(en[key as keyof typeof en]).toContain('{name}');
			expect(zhCN[key as keyof typeof zhCN]).toContain('{name}');
		}
		expect(en['modal.foreshadowing.deleteDescription']).toContain('{count}');
		expect(zhCN['modal.foreshadowing.deleteDescription']).toContain('{count}');
		// One verb for an occurrence's going, everywhere it is offered.
		expect(en['manuscript.foreshadowing.delete']).toBe('Delete');
		expect(zhCN['manuscript.foreshadowing.delete']).toBe('删除');
		expect(zhCN['modal.foreshadowing.occurrenceDelete']).toContain('删除');
	});

	it('labels the table, its funnel and its actions in both languages', () => {
		const keys = [
			'foreshadowingTable.name',
			'foreshadowingTable.description',
			'foreshadowingTable.related',
			'foreshadowingTable.role',
			'foreshadowingTable.place',
			'foreshadowingTable.empty',
			'foreshadowingTable.noProject',
			'foreshadowingTable.loading',
			'foreshadowingTable.loadFailed',
			'foreshadowingTable.refresh',
			'foreshadowingTable.searchPlaceholder',
			'foreshadowingTable.add',
			'foreshadowingTable.none',
			'foreshadowingTable.unresolved',
			'foreshadowingTable.editOccurrence',
			'foreshadowingTable.editItem',
			'foreshadowingTable.deleteOccurrence',
			'foreshadowingTable.deleteItem',
			'foreshadowingTable.filterAllStatuses',
			'foreshadowingTable.filterAllRoles',
			'foreshadowingTable.standing',
			'foreshadowingTable.filterAllStandings',
			'foreshadowingTable.unresolvedOnly',
			'foreshadowingTable.refused',
		];
		for (const key of keys) {
			expect(Object.keys(en), key).toContain(key);
			expect(Object.keys(zhCN), key).toContain(key);
		}
		// The Role column must never read as "Character" in Chinese.
		expect(zhCN['foreshadowingTable.role']).not.toBe(zhCN['form.group.character']);
	});

	it('labels the notices the stores raise in both languages', () => {
		const keys = [
			'manuscript.foreshadowing.newerSchema',
			'manuscript.foreshadowing.corruptPreserved',
		];
		for (const key of keys) {
			expect(Object.keys(en), key).toContain(key);
			expect(Object.keys(zhCN), key).toContain(key);
		}
		expect(en['manuscript.foreshadowing.corruptPreserved']).toContain('{path}');
		expect(zhCN['manuscript.foreshadowing.corruptPreserved']).toContain('{path}');
	});
});

/**
 * The sticky-note copy reaches the screen through built keys -- the tab
 * label, the colour names -- that the type checker never sees go missing.
 */
describe('sticky note copy', () => {
	it('names every task management tab in both languages', () => {
		for (const tab of TASKS_TABS) {
			expect(Object.keys(en), tab).toContain(`tasks.tab.${tab}`);
			expect(Object.keys(zhCN), tab).toContain(`tasks.tab.${tab}`);
		}
		expect(en['tasks.tab.stickyNotes']).toBe('Sticky notes');
		expect(zhCN['tasks.tab.stickyNotes']).toBe('便签');
	});

	it('names the commands, the sidebar and every macaron colour in both languages', () => {
		expect(en['commands.newStickyNote']).toBe('New sticky note');
		expect(zhCN['commands.newStickyNote']).toBe('新建便签');
		expect(en['commands.openStickyNotes']).toBe('Open sticky notes');
		expect(zhCN['commands.openStickyNotes']).toBe('打开便签');
		expect(zhCN['stickyNotes.viewTitle']).toBe('便签');
		for (const color of STICKY_NOTE_COLORS) {
			expect(Object.keys(en), color).toContain(`stickyNotes.color.${color}`);
			expect(Object.keys(zhCN), color).toContain(`stickyNotes.color.${color}`);
		}
		expect(zhCN['stickyNotes.color.macaron-8']).toBe('香芋');
		expect(zhCN['stickyNotes.archive']).toBe('归档');
		expect(zhCN['stickyNotes.float']).toBe('悬浮');
	});
});

/**
 * The task copy reaches the screen through built keys -- a column named by
 * its status, a badge by its priority, a derived card by its key -- that
 * the type checker never sees go missing. The sweep does.
 */
describe('task copy', () => {
	it('names every column, priority and derived card in both languages', () => {
		for (const status of TASK_STATUSES) {
			expect(Object.keys(en), status).toContain(`tasks.status.${status}`);
			expect(Object.keys(zhCN), status).toContain(`tasks.status.${status}`);
		}
		for (const priority of TASK_PRIORITIES) {
			expect(Object.keys(en), priority).toContain(`tasks.priority.${priority}`);
			expect(Object.keys(zhCN), priority).toContain(`tasks.priority.${priority}`);
		}
		for (const key of DERIVED_TASK_KEYS) {
			expect(Object.keys(en), key).toContain(`tasks.derived.${key}`);
			expect(Object.keys(zhCN), key).toContain(`tasks.derived.${key}`);
		}
		expect(en['tasks.tab.tasks']).toBe('Tasks');
		expect(zhCN['tasks.tab.tasks']).toBe('任务');
		expect(zhCN['tasks.status.todo']).toBe('待处理');
		expect(zhCN['tasks.status.in-review']).toBe('待检查');
		expect(zhCN['tasks.priority.urgent']).toBe('紧急');
		expect(zhCN['tasks.derived.stickyNotes']).toBe('待查看的便签');
	});

	it('labels the board, the funnel, the dialogs and the command in both languages', () => {
		const keys = [
			'commands.newTask',
			'taskBoard.empty',
			'taskBoard.noMatch',
			'taskBoard.noProject',
			'taskBoard.loading',
			'taskBoard.loadFailed',
			'taskBoard.derivedFailed',
			'taskBoard.refresh',
			'taskBoard.searchPlaceholder',
			'taskBoard.add',
			'taskBoard.refused',
			'taskBoard.edit',
			'taskBoard.more',
			'taskBoard.moveTo',
			'taskBoard.archive',
			'taskBoard.restore',
			'taskBoard.archiveTitle',
			'taskBoard.archiveEmpty',
			'taskBoard.archiveNoMatch',
			'taskBoard.emptyArchive',
			'taskBoard.emptyArchiveTitle',
			'taskBoard.emptyArchiveDescription',
			'taskBoard.deleteTitle',
			'taskBoard.deleteDescription',
			'taskBoard.due',
			'taskBoard.overdue',
			'taskBoard.filterOrigin',
			'taskBoard.filterAllOrigins',
			'taskBoard.origin.manual',
			'taskBoard.origin.derived',
			'taskBoard.priority',
			'taskBoard.filterAllPriorities',
			'taskBoard.filterAllStatuses',
			'taskBoard.filterDue',
			'taskBoard.filterAllDue',
			'taskBoard.due.overdue',
			'taskBoard.due.today',
			'taskBoard.due.week',
			'taskBoard.due.none',
			'tasks.derived.progress',
			'tasks.derived.tooltip',
			'tasks.newerSchema',
			'tasks.corruptPreserved',
			'modal.task.title',
			'modal.task.editTitle',
			'modal.task.name',
			'modal.task.nameRequired',
			'modal.task.nameTaken',
			'modal.task.description',
			'modal.task.status',
			'modal.task.priority',
			'modal.task.dueDate',
			'modal.task.dueInvalid',
			'modal.task.related',
			'modal.task.relatedPlaceholder',
			'modal.task.relatedEmpty',
			'modal.task.relatedRemove',
			'modal.task.relatedMissing',
			'modal.task.gone',
			'revisionTable.standing',
			'revisionTable.filterAllStandings',
			'revisionTable.conflictOnly',
			'revisionTable.filterAllTypes',
		];
		for (const key of keys) {
			expect(Object.keys(en), key).toContain(key);
			expect(Object.keys(zhCN), key).toContain(key);
		}
		for (const locale of [en, zhCN]) {
			expect(locale['taskBoard.moveTo']).toContain('{status}');
			expect(locale['taskBoard.due']).toContain('{date}');
			expect(locale['taskBoard.emptyArchiveDescription']).toContain('{count}');
			expect(locale['tasks.corruptPreserved']).toContain('{path}');
			expect(locale['tasks.derived.progress']).toContain('{net}');
			expect(locale['tasks.derived.progress']).toContain('{goal}');
			expect(locale['modal.task.relatedRemove']).toContain('{name}');
			expect(locale['modal.task.relatedMissing']).toContain('{name}');
		}
	});
});
