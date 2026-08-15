import {
  STEP_ONE_SECTION_IDS,
  templateSectionsForDocument,
  type DefinitionFileId,
  type DocumentType,
  type StepOneSectionId,
  type WorldbuildingKindId,
} from "../domain";
import {
  TEMPLATE_FIELDS_SECTION_ID,
  serializeCustomFields,
  type CustomField,
} from "./custom-fields";
import {
  renderCharacterFieldsBlock,
  renderDefinitionFieldsBlock,
  renderEntityFieldsBlock,
  renderSceneFieldsBlock,
  type DefinitionFieldsView,
} from "./fields-block";
import { renderMarkedSection } from "./markers";

export type TemplateLanguage = "en" | "zh-CN";

export interface ManagedSectionDefinition {
  id: string;
  heading: string;
  initialContent?: string;
}

export interface MarkdownTemplate {
  body: string;
  sections: ManagedSectionDefinition[];
}

export interface SystemTemplateDefinition {
  id:
    | "one-sentence-summary"
    | "one-paragraph-summary"
    | "character"
    | "plot-synopsis"
    | "long-synopsis"
    | "scene"
    | "draft"
    | "worldbuilding"
    | "material"
    | "archive";
  documentType: DocumentType;
  fileName: string;
  template: MarkdownTemplate;
}

export interface CharacterSectionContent {
  fieldsBlock?: string;
  oneParagraphStoryline?: string;
  characterSynopsis?: string;
  characterProfile?: string;
}

export interface SceneSectionContent {
  fieldsBlock?: string;
  events?: string;
  planning?: string;
}

export interface EntitySectionContent {
  fieldsBlock?: string;
  notes?: string;
}

interface Copy {
  projectTitle: string;
  projectIntro: readonly [opening: string, warning: string, closing: string];
  stepOneTitle: string;
  oneSentenceSummaryHeading: string;
  stepOneHint: string;
  targetReadersTitle: string;
  targetReadersIntro: string;
  targetReadersQuestions: string;
  genre: string;
  audienceAppeal: string;
  candidateTitles: string;
  candidateTitlesHint: string;
  candidateTitle: string;
  paragraphTitle: string;
  descriptionTitle: string;
  plotSynopsisTitle: string;
  longSynopsisTitle: string;
  characterStoryline: string;
  characterSynopsis: string;
  characterProfile: string;
  sceneConflict: string;
  sceneEvents: string;
  scenePlanning: string;
  entityNotes: string;
  draftTitle: string;
  blankHint: string;
  characterTemplateTitle: string;
  sceneTemplateTitle: string;
  worldbuildingTemplateTitle: string;
  materialTemplateTitle: string;
  archiveTemplateTitle: string;
}

const COPY: Record<TemplateLanguage, Copy> = {
  en: {
    projectTitle: "Snowflake Project",
    projectIntro: [
      "This note stores project metadata for the Snowflake Method plugin.",
      "Do not modify any content in this metadata file!",
      "Creative content always remains ordinary Markdown and can be edited directly after the plugin is disabled.",
    ],
    stepOneTitle: "Step 1 · One-Sentence Summary",
    oneSentenceSummaryHeading: "One-Sentence Summary",
    stepOneHint: "Summarize the whole story in one sentence.",
    targetReadersTitle: "Before You Begin · Define Your Target Readers",
    targetReadersIntro:
      "Decide what kind of novel you want to write and clearly define your target readers.",
    targetReadersQuestions: "Answer These Questions",
    genre: "My Novel's Genre",
    audienceAppeal: "Why This Story Will Delight My Target Readers",
    candidateTitles: "Candidate Titles (Optional)",
    candidateTitlesHint: "List up to six working titles for the novel.",
    candidateTitle: "Candidate Title",
    paragraphTitle: "Step 2 · One-Paragraph Summary",
    descriptionTitle: "Description (Optional)",
    plotSynopsisTitle: "Step 4 · Plot Synopsis",
    longSynopsisTitle: "Step 6 · Long Synopsis",
    characterStoryline: "Step 3 · One-Paragraph Storyline",
    characterSynopsis: "Step 5 · Character Synopsis",
    characterProfile: "Step 7 · Character Profiles",
    sceneConflict: "Step 8 · Conflict",
    sceneEvents: "Step 8 · Specific Events",
    scenePlanning: "Step 9 · Scene Planning (Optional)",
    entityNotes: "Notes",
    draftTitle: "Draft",
    blankHint: "Write here.",
    characterTemplateTitle: "Character",
    sceneTemplateTitle: "Scene",
    worldbuildingTemplateTitle: "Worldbuilding",
    materialTemplateTitle: "Material",
    archiveTemplateTitle: "Archive",
  },
  "zh-CN": {
    projectTitle: "雪花写作项目 (Snowflake Project)",
    projectIntro: [
      "本笔记保存雪花写作法插件的项目元数据。",
      "请勿修改该元数据文件中的任何内容！",
      "创作内容始终是普通 Markdown，停用插件后仍可直接编辑。",
    ],
    stepOneTitle: "第一步 · 一句话概述",
    oneSentenceSummaryHeading: "一句话概述",
    stepOneHint: "用一句话概括整个故事。",
    targetReadersTitle: "开始前的准备 · 确定目标读者群",
    targetReadersIntro: "确定自己准备撰写哪种类型的小说，并明确你的目标读者群。",
    targetReadersQuestions: "回答以下问题",
    genre: "我的小说类型",
    audienceAppeal: "这类故事之所以能取悦我的目标读者群，原因在于",
    candidateTitles: "候选书名（可选）",
    candidateTitlesHint: "最多填写六个小说暂定书名。",
    candidateTitle: "候选书名",
    paragraphTitle: "第二步 · 一段式梗概",
    descriptionTitle: "简介（可选）",
    plotSynopsisTitle: "第四步 · 情节大纲",
    longSynopsisTitle: "第六步 · 长篇大纲",
    characterStoryline: "第三步 · 一段式故事梗概",
    characterSynopsis: "第五步 · 人物大纲",
    characterProfile: "第七步 · 角色档案",
    sceneConflict: "第八步 · 冲突",
    sceneEvents: "第八步 · 具体事件",
    scenePlanning: "第九步 · 场景规划（可选）",
    entityNotes: "备注",
    draftTitle: "初稿",
    blankHint: "在这里写作。",
    characterTemplateTitle: "角色",
    sceneTemplateTitle: "场景",
    worldbuildingTemplateTitle: "世界观",
    materialTemplateTitle: "素材",
    archiveTemplateTitle: "存档",
  },
};

const STORY_ARTIFACTS_BY_LANGUAGE = {
  en: [
    {
      step: 1 as const,
      document: "one-sentence-summary" as const,
      relativePath: "10_Summary/11_One_Sentence_Summary.md",
    },
    { step: 2 as const, document: "one-paragraph-summary" as const, relativePath: "10_Summary/12_One_Paragraph_Summary.md" },
    { step: 4 as const, document: "plot-synopsis" as const, relativePath: "30_Synopsis/31_Plot_Synopsis.md" },
    { step: 6 as const, document: "long-synopsis" as const, relativePath: "30_Synopsis/32_Long_Synopsis.md" },
  ],
  "zh-CN": [
    {
      step: 1 as const,
      document: "one-sentence-summary" as const,
      relativePath: "10_概述/11_一句话概述.md",
    },
    { step: 2 as const, document: "one-paragraph-summary" as const, relativePath: "10_概述/12_一段式梗概.md" },
    { step: 4 as const, document: "plot-synopsis" as const, relativePath: "30_大纲/31_情节大纲.md" },
    { step: 6 as const, document: "long-synopsis" as const, relativePath: "30_大纲/32_长篇大纲.md" },
  ],
} as const satisfies Record<TemplateLanguage, readonly unknown[]>;

export function getStoryArtifacts(language: TemplateLanguage) {
  return STORY_ARTIFACTS_BY_LANGUAGE[language];
}

export const STORY_ARTIFACTS = STORY_ARTIFACTS_BY_LANGUAGE.en;

export function projectTemplate(projectName: string, language: TemplateLanguage): MarkdownTemplate {
  const copy = COPY[language];
  const [opening, warning, closing] = copy.projectIntro;
  return {
    body: [
      `# ${projectName}`,
      opening,
      `**${warning}**`,
      closing,
    ].join("\n\n") + "\n",
    sections: [],
  };
}

export function getSystemTemplates(
  language: TemplateLanguage,
): SystemTemplateDefinition[] {
  const copy = COPY[language];
  const fileNames = language === "zh-CN"
    ? {
        oneSentence: "011_模板_一句话概述.md",
        oneParagraph: "012_模板_一段式梗概.md",
        character: "021_模板_角色.md",
        plot: "031_模板_情节大纲.md",
        long: "032_模板_长篇大纲.md",
        scene: "041_模板_场景.md",
        draft: "051_模板_初稿.md",
        worldbuilding: "061_模板_世界观.md",
        material: "081_模板_素材.md",
        archive: "091_模板_存档.md",
      }
    : {
        oneSentence: "011_Template_One_Sentence_Summary.md",
        oneParagraph: "012_Template_One_Paragraph_Summary.md",
        character: "021_Template_Character.md",
        plot: "031_Template_Plot_Synopsis.md",
        long: "032_Template_Long_Synopsis.md",
        scene: "041_Template_Scene.md",
        draft: "051_Template_Draft.md",
        worldbuilding: "061_Template_Worldbuilding.md",
        material: "081_Template_Material.md",
        archive: "091_Template_Archive.md",
      };
  return [
    {
      id: "one-sentence-summary",
      documentType: "one-sentence-summary",
      fileName: fileNames.oneSentence,
      template: storyArtifactTemplate(1, language),
    },
    {
      id: "one-paragraph-summary",
      documentType: "one-paragraph-summary",
      fileName: fileNames.oneParagraph,
      template: storyArtifactTemplate(2, language),
    },
    {
      id: "character",
      documentType: "character",
      fileName: fileNames.character,
      template: characterTemplate(copy.characterTemplateTitle, language),
    },
    {
      id: "plot-synopsis",
      documentType: "plot-synopsis",
      fileName: fileNames.plot,
      template: storyArtifactTemplate(4, language),
    },
    {
      id: "long-synopsis",
      documentType: "long-synopsis",
      fileName: fileNames.long,
      template: storyArtifactTemplate(6, language),
    },
    {
      id: "scene",
      documentType: "scene",
      fileName: fileNames.scene,
      template: sceneTemplate(copy.sceneTemplateTitle, language),
    },
    {
      id: "draft",
      documentType: "draft",
      fileName: fileNames.draft,
      template: draftTemplate(language),
    },
    {
      id: "worldbuilding",
      documentType: "worldbuilding",
      fileName: fileNames.worldbuilding,
      template: entityTemplate(copy.worldbuildingTemplateTitle, "item", language),
    },
    {
      id: "material",
      documentType: "material",
      fileName: fileNames.material,
      template: plainDocumentTemplate(copy.materialTemplateTitle),
    },
    {
      id: "archive",
      documentType: "archive",
      fileName: fileNames.archive,
      template: plainDocumentTemplate(copy.archiveTemplateTitle),
    },
  ];
}

function plainDocumentTemplate(title: string): MarkdownTemplate {
  return {
    body: `# ${title}\n`,
    sections: [],
  };
}

export function storyArtifactTemplate(
  step: 1 | 2 | 4 | 6,
  language: TemplateLanguage,
): MarkdownTemplate {
  const copy = COPY[language];
  switch (step) {
    case 1:
      return stepOneTemplate(copy);
    case 2:
      return fromManagedSections("one-paragraph-summary", copy.paragraphTitle, [
        { id: "one-paragraph-summary", heading: `## ${copy.paragraphTitle.replace(/^.* · /u, "")}` },
        { id: "description", heading: `## ${copy.descriptionTitle}` },
      ]);
    case 4:
      return fromManagedSections("plot-synopsis", copy.plotSynopsisTitle, [
        { id: "plot-synopsis", heading: "" },
      ]);
    case 6:
      return fromManagedSections("long-synopsis", copy.longSynopsisTitle, [
        { id: "long-synopsis", heading: "" },
      ]);
  }
}

function stepOneTemplate(copy: Copy): MarkdownTemplate {
  const headings: Record<StepOneSectionId, string> = {
    genre: `### ${copy.genre}`,
    "audience-reason-1": `### ${copy.audienceAppeal}`,
    "one-sentence-summary": `## ${copy.oneSentenceSummaryHeading}`,
    "candidate-title-1": `### ${copy.candidateTitle} 1`,
    "candidate-title-2": `### ${copy.candidateTitle} 2`,
    "candidate-title-3": `### ${copy.candidateTitle} 3`,
    "candidate-title-4": `### ${copy.candidateTitle} 4`,
    "candidate-title-5": `### ${copy.candidateTitle} 5`,
    "candidate-title-6": `### ${copy.candidateTitle} 6`,
  };
  const repairHeadings: Record<StepOneSectionId, string> = {
    ...headings,
    genre: [
      `## ${copy.targetReadersTitle}`,
      copy.targetReadersIntro,
      `### ${copy.targetReadersQuestions}`,
      headings.genre,
    ].join("\n\n"),
    "candidate-title-1": [
      `## ${copy.candidateTitles}`,
      `> ${copy.candidateTitlesHint}`,
      headings["candidate-title-1"],
    ].join("\n\n"),
  };
  const sections = STEP_ONE_SECTION_IDS.map((id) => ({
    id,
    heading: repairHeadings[id],
  }));
  const render = (id: StepOneSectionId): string =>
    `${headings[id]}\n\n${renderMarkedSection(id)}`;
  const candidateTitles = ([1, 2, 3, 4, 5, 6] as const)
    .map((number) => render(`candidate-title-${number}`))
    .join("\n\n");

  assertManagedSectionContract("one-sentence-summary", sections);
  return {
    body: [
      `# ${copy.stepOneTitle}`,
      `> ${copy.stepOneHint}`,
      `## ${copy.targetReadersTitle}`,
      copy.targetReadersIntro,
      `### ${copy.targetReadersQuestions}`,
      render("genre"),
      render("audience-reason-1"),
      render("one-sentence-summary"),
      `## ${copy.candidateTitles}`,
      `> ${copy.candidateTitlesHint}`,
      candidateTitles,
    ].join("\n\n") + "\n",
    sections,
  };
}

export function characterTemplate(
  characterName: string,
  language: TemplateLanguage,
  content: CharacterSectionContent = {},
): MarkdownTemplate {
  const copy = COPY[language];
  return fromManagedSections("character", characterName, [
    {
      id: "character-fields",
      heading: "",
      initialContent:
        content.fieldsBlock ??
        renderCharacterFieldsBlock(language, {
          progressStatus: null,
          aliases: [],
          categories: [],
          oneSentenceStoryline: "",
          motivation: "",
          goal: "",
          conflict: "",
          growth: "",
        }),
    },
    {
      id: "one-paragraph-storyline",
      heading: `## ${copy.characterStoryline}`,
      initialContent: content.oneParagraphStoryline,
    },
    {
      id: "character-synopsis",
      heading: `## ${copy.characterSynopsis}`,
      initialContent: content.characterSynopsis,
    },
    {
      id: "character-profile",
      heading: `## ${copy.characterProfile}`,
      initialContent: content.characterProfile,
    },
  ]);
}

export function sceneTemplate(
  sceneTitle: string,
  language: TemplateLanguage,
  content: SceneSectionContent = {},
): MarkdownTemplate {
  const copy = COPY[language];
  return fromManagedSections("scene", sceneTitle, [
    {
      id: "scene-fields",
      heading: "",
      initialContent:
        content.fieldsBlock ??
        renderSceneFieldsBlock(language, {
          progressStatus: null,
          aliases: [],
          categories: [],
          pov: null,
          times: [],
          locations: [],
          conflict: "",
          cast: [],
        }),
    },
    {
      id: "scene-events",
      heading: `## ${copy.sceneEvents}`,
      initialContent: content.events,
    },
    {
      id: "scene-planning",
      heading: `## ${copy.scenePlanning}`,
      initialContent: content.planning,
    },
  ]);
}

export function entityTemplate(
  entityName: string,
  kind: WorldbuildingKindId,
  language: TemplateLanguage,
  content: EntitySectionContent = {},
): MarkdownTemplate {
  const copy = COPY[language];
  return fromManagedSections("worldbuilding", entityName, [
    {
      id: "entity-fields",
      heading: "",
      initialContent:
        content.fieldsBlock ??
        renderEntityFieldsBlock(language, kind, {
          progressStatus: null,
          aliases: [],
          categories: [],
          description: "",
          time: kind === "time" ? { kind: null, start: "", end: "" } : null,
        }),
    },
    {
      id: "entity-notes",
      heading: `## ${copy.entityNotes}`,
      initialContent: content.notes,
    },
  ]);
}

/**
 * A definition node's own note. Alone among the plugin's notes it carries no
 * H1: a heading would only repeat the note name
 * rather than the node, and the block below says which entry this is.
 */
export function definitionTemplate(
  id: DefinitionFileId,
  language: TemplateLanguage,
  fields: DefinitionFieldsView,
): MarkdownTemplate {
  const sections: ManagedSectionDefinition[] = [
    {
      id: "definition-fields",
      heading: "",
      initialContent: renderDefinitionFieldsBlock(language, id, fields),
    },
  ];
  assertManagedSectionContract("definition", sections);
  return {
    body: `${renderMarkedSection(
      "definition-fields",
      sections[0]?.initialContent ?? "",
    )}\n`,
    sections,
  };
}

/**
 * A custom-field template note. The whole body is the one protected block
 * that stores the fields the template seeds: the note is the plugin's own
 * storage, managed from the dashboard, so nothing outside the block exists
 * for an author to write.
 */
export function customFieldTemplateNote(
  fields: readonly CustomField[],
): MarkdownTemplate {
  const sections: ManagedSectionDefinition[] = [
    {
      id: TEMPLATE_FIELDS_SECTION_ID,
      heading: "",
      initialContent: serializeCustomFields("", fields),
    },
  ];
  assertManagedSectionContract("template", sections);
  return {
    body: `${renderMarkedSection(
      TEMPLATE_FIELDS_SECTION_ID,
      sections[0]?.initialContent ?? "",
    )}\n`,
    sections,
  };
}

/**
 * The headings older releases created the scene conflict section under, in
 * every language they wrote. Migration removes that section after moving its
 * text into the conflict property, and takes the heading with it only when
 * the heading is exactly one of these: anything else is the author's line.
 */
export function legacySceneConflictHeadings(): string[] {
  return (Object.keys(COPY) as TemplateLanguage[]).map(
    (language) => `## ${COPY[language].sceneConflict}`,
  );
}

/**
 * The heading names the note, not the project. A project's name is its own to
 * change, and nothing carries a change into a draft: the manuscript is the
 * author's prose from the first line, and rewriting a heading inside it to
 * follow a rename would be editing their writing.
 */
export function draftTemplate(language: TemplateLanguage): MarkdownTemplate {
  const copy = COPY[language];
  return {
    body: `# ${copy.draftTitle}\n\n${copy.blankHint}\n`,
    sections: [],
  };
}

/**
 * A new segment of the manuscript. The heading is the name the author just gave
 * the note, which is theirs to change afterwards -- nothing checks it, the way
 * nothing checks the draft's heading, because everything below the frontmatter
 * of a manuscript note is prose.
 */
export function manuscriptSegmentTemplate(
  title: string,
  language: TemplateLanguage,
): MarkdownTemplate {
  const copy = COPY[language];
  return {
    body: `# ${title}\n\n${copy.blankHint}\n`,
    sections: [],
  };
}

function fromSections(title: string, sections: ManagedSectionDefinition[]): MarkdownTemplate {
  const rendered = sections
    .map((section) =>
      [section.heading, renderMarkedSection(section.id, section.initialContent ?? "")]
        .filter((part) => part.length > 0)
        .join("\n\n"),
    )
    .join("\n\n");
  return { body: `# ${title}\n\n${rendered}\n`, sections };
}

function fromManagedSections(
  documentType: DocumentType,
  title: string,
  sections: ManagedSectionDefinition[],
): MarkdownTemplate {
  assertManagedSectionContract(documentType, sections);
  return fromSections(title, sections);
}

function assertManagedSectionContract(
  documentType: DocumentType,
  sections: readonly ManagedSectionDefinition[],
): void {
  const expected = templateSectionsForDocument(documentType).map((section) => section.id);
  const actual = sections.map((section) => section.id);
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error(
      `Template sections for ${documentType} do not match the managed section registry.`,
    );
  }
}
