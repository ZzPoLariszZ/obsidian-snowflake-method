import {
  STEP_ONE_SECTION_IDS,
  templateSectionsForDocument,
  type DefinitionFileId,
  type DocumentType,
  type ProjectLanguage,
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

export type TemplateLanguage = ProjectLanguage;

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
  "zh-TW": {
    projectTitle: "雪花寫作專案 (Snowflake Project)",
    projectIntro: [
      "本筆記儲存雪花寫作法外掛程式的專案中繼資料。",
      "請勿修改此中繼資料檔案中的任何內容！",
      "創作內容始終是一般的 Markdown，停用外掛程式後仍可直接編輯。",
    ],
    stepOneTitle: "第一步 · 一句話概述",
    oneSentenceSummaryHeading: "一句話概述",
    stepOneHint: "用一句話概括整個故事。",
    targetReadersTitle: "開始前的準備 · 確定目標讀者群",
    targetReadersIntro: "確定自己準備撰寫哪種類型的小說，並清楚界定你的目標讀者群。",
    targetReadersQuestions: "回答以下問題",
    genre: "我的小說類型",
    audienceAppeal: "這類故事之所以能取悅我的目標讀者群，原因在於",
    candidateTitles: "候選書名（選填）",
    candidateTitlesHint: "最多填寫六個小說暫定書名。",
    candidateTitle: "候選書名",
    paragraphTitle: "第二步 · 一段式梗概",
    descriptionTitle: "簡介（選填）",
    plotSynopsisTitle: "第四步 · 情節大綱",
    longSynopsisTitle: "第六步 · 長篇大綱",
    characterStoryline: "第三步 · 一段式故事梗概",
    characterSynopsis: "第五步 · 人物大綱",
    characterProfile: "第七步 · 角色檔案",
    sceneConflict: "第八步 · 衝突",
    sceneEvents: "第八步 · 具體事件",
    scenePlanning: "第九步 · 場景規劃（選用）",
    entityNotes: "備註",
    draftTitle: "初稿",
    blankHint: "在這裡寫作。",
    characterTemplateTitle: "角色",
    sceneTemplateTitle: "場景",
    worldbuildingTemplateTitle: "世界觀",
    materialTemplateTitle: "素材",
    archiveTemplateTitle: "封存",
  },
  // The step headings keep the separator " · " the other languages use: the
  // one-paragraph summary's section heading is read off its title by it.
  ja: {
    projectTitle: "スノーフレーク・メソッドのプロジェクト (Snowflake Project)",
    projectIntro: [
      "このノートには、プラグイン「スノーフレーク・メソッド」のプロジェクトメタデータが保存されています。",
      "このメタデータファイルの内容は一切変更しないでください！",
      "創作した内容はいつまでも通常のMarkdownのままで、プラグインを無効にした後もそのまま編集できます。",
    ],
    stepOneTitle: "ステップ1 · 一文要約",
    oneSentenceSummaryHeading: "一文要約",
    stepOneHint: "物語全体を一文で要約してください。",
    targetReadersTitle: "始める前に · ターゲット読者を決める",
    targetReadersIntro: "どんな種類の小説を書きたいのかを決め、ターゲット読者をはっきりさせてください。",
    targetReadersQuestions: "次の質問に答えてください",
    genre: "私の小説のジャンル",
    audienceAppeal: "この物語がターゲット読者を楽しませる理由",
    candidateTitles: "タイトル候補（任意）",
    candidateTitlesHint: "小説の仮タイトルを最大6つまで書いてください。",
    candidateTitle: "タイトル候補",
    paragraphTitle: "ステップ2 · 一段落要約",
    descriptionTitle: "紹介文（任意）",
    plotSynopsisTitle: "ステップ4 · プロットあらすじ",
    longSynopsisTitle: "ステップ6 · 詳細あらすじ",
    characterStoryline: "ステップ3 · 一段落ストーリーライン",
    characterSynopsis: "ステップ5 · キャラクターあらすじ",
    characterProfile: "ステップ7 · キャラクタープロフィール",
    sceneConflict: "ステップ8 · 葛藤",
    sceneEvents: "ステップ8 · 具体的な出来事",
    scenePlanning: "ステップ9 · シーン計画（任意）",
    entityNotes: "メモ",
    draftTitle: "初稿",
    blankHint: "ここに書いてください。",
    characterTemplateTitle: "キャラクター",
    sceneTemplateTitle: "シーン",
    worldbuildingTemplateTitle: "世界観",
    materialTemplateTitle: "資料",
    archiveTemplateTitle: "アーカイブ",
  },
  ko: {
    projectTitle: "스노우플레이크 프로젝트 (Snowflake Project)",
    projectIntro: [
      "이 노트에는 스노우플레이크 기법 플러그인의 프로젝트 메타데이터가 저장됩니다.",
      "이 메타데이터 파일의 내용은 절대 수정하지 마세요!",
      "창작한 내용은 언제나 일반 Markdown으로 남으며, 플러그인을 비활성화한 뒤에도 바로 편집할 수 있습니다.",
    ],
    stepOneTitle: "1단계 · 한 문장 요약",
    oneSentenceSummaryHeading: "한 문장 요약",
    stepOneHint: "이야기 전체를 한 문장으로 요약하세요.",
    targetReadersTitle: "시작하기 전에 · 타깃 독자 정하기",
    targetReadersIntro: "어떤 소설을 쓰고 싶은지 정하고, 타깃 독자를 명확히 정의하세요.",
    targetReadersQuestions: "다음 질문에 답하세요",
    genre: "내 소설의 장르",
    audienceAppeal: "이 이야기가 타깃 독자를 즐겁게 할 이유",
    candidateTitles: "제목 후보(선택 사항)",
    candidateTitlesHint: "소설의 가제를 최대 여섯 개까지 적으세요.",
    candidateTitle: "제목 후보",
    paragraphTitle: "2단계 · 한 문단 요약",
    descriptionTitle: "소개글(선택 사항)",
    plotSynopsisTitle: "4단계 · 플롯 시놉시스",
    longSynopsisTitle: "6단계 · 상세 시놉시스",
    characterStoryline: "3단계 · 한 문단 스토리라인",
    characterSynopsis: "5단계 · 캐릭터 시놉시스",
    characterProfile: "7단계 · 캐릭터 프로필",
    sceneConflict: "8단계 · 갈등",
    sceneEvents: "8단계 · 구체적 사건",
    scenePlanning: "9단계 · 장면 계획(선택 사항)",
    entityNotes: "메모",
    draftTitle: "초고",
    blankHint: "여기에 쓰세요.",
    characterTemplateTitle: "캐릭터",
    sceneTemplateTitle: "장면",
    worldbuildingTemplateTitle: "세계관",
    materialTemplateTitle: "자료",
    archiveTemplateTitle: "아카이브",
  },
  fr: {
    projectTitle: "Projet Flocon de neige (Snowflake Project)",
    projectIntro: [
      "Cette note contient les métadonnées du projet pour le module Méthode Flocon de neige.",
      "Ne modifiez rien dans ce fichier de métadonnées !",
      "Le contenu créatif reste toujours du Markdown ordinaire et peut être modifié directement une fois le module désactivé.",
    ],
    stepOneTitle: "Étape 1 · Résumé en une phrase",
    oneSentenceSummaryHeading: "Résumé en une phrase",
    stepOneHint: "Résumez toute l'histoire en une phrase.",
    targetReadersTitle: "Avant de commencer · Définissez votre lectorat cible",
    targetReadersIntro: "Décidez quel genre de roman vous voulez écrire et définissez clairement votre lectorat cible.",
    targetReadersQuestions: "Répondez à ces questions",
    genre: "Le genre de mon roman",
    audienceAppeal: "Pourquoi cette histoire plaira à mon lectorat cible",
    candidateTitles: "Titres possibles (facultatifs)",
    candidateTitlesHint: "Notez jusqu'à six titres provisoires pour le roman.",
    candidateTitle: "Titre possible",
    paragraphTitle: "Étape 2 · Résumé en un paragraphe",
    descriptionTitle: "Description (facultative)",
    plotSynopsisTitle: "Étape 4 · Synopsis de l'intrigue",
    longSynopsisTitle: "Étape 6 · Synopsis détaillé",
    characterStoryline: "Étape 3 · Parcours en un paragraphe",
    characterSynopsis: "Étape 5 · Synopsis du personnage",
    characterProfile: "Étape 7 · Fiche de personnage",
    sceneConflict: "Étape 8 · Conflit",
    sceneEvents: "Étape 8 · Événements précis",
    scenePlanning: "Étape 9 · Planification de la scène (facultative)",
    entityNotes: "Notes",
    draftTitle: "Brouillon",
    blankHint: "Écrivez ici.",
    characterTemplateTitle: "Personnage",
    sceneTemplateTitle: "Scène",
    worldbuildingTemplateTitle: "Univers",
    materialTemplateTitle: "Documentation",
    archiveTemplateTitle: "Archives",
  },
  de: {
    projectTitle: "Schneeflocken-Projekt (Snowflake Project)",
    projectIntro: [
      "Diese Notiz speichert die Projektmetadaten der Erweiterung Schneeflocken-Methode.",
      "Ändere nichts in dieser Metadatendatei!",
      "Deine kreativen Inhalte bleiben immer gewöhnliches Markdown und lassen sich auch nach dem Deaktivieren der Erweiterung direkt bearbeiten.",
    ],
    stepOneTitle: "Schritt 1 · Ein-Satz-Zusammenfassung",
    oneSentenceSummaryHeading: "Ein-Satz-Zusammenfassung",
    stepOneHint: "Fasse die ganze Geschichte in einem Satz zusammen.",
    targetReadersTitle: "Bevor du beginnst · Zielgruppe festlegen",
    targetReadersIntro: "Lege fest, was für einen Roman du schreiben willst, und bestimme deine Zielgruppe genau.",
    targetReadersQuestions: "Beantworte diese Fragen",
    genre: "Das Genre meines Romans",
    audienceAppeal: "Warum diese Geschichte meine Zielgruppe begeistern wird",
    candidateTitles: "Mögliche Titel (optional)",
    candidateTitlesHint: "Notiere bis zu sechs Arbeitstitel für den Roman.",
    candidateTitle: "Möglicher Titel",
    paragraphTitle: "Schritt 2 · Ein-Absatz-Zusammenfassung",
    descriptionTitle: "Klappentext (optional)",
    plotSynopsisTitle: "Schritt 4 · Handlungssynopsis",
    longSynopsisTitle: "Schritt 6 · Ausführliche Synopsis",
    characterStoryline: "Schritt 3 · Handlungsstrang in einem Absatz",
    characterSynopsis: "Schritt 5 · Figurensynopsis",
    characterProfile: "Schritt 7 · Figurenprofil",
    sceneConflict: "Schritt 8 · Konflikt",
    sceneEvents: "Schritt 8 · Konkrete Ereignisse",
    scenePlanning: "Schritt 9 · Szenenplanung (optional)",
    entityNotes: "Notizen",
    draftTitle: "Entwurf",
    blankHint: "Schreib hier.",
    characterTemplateTitle: "Figur",
    sceneTemplateTitle: "Szene",
    worldbuildingTemplateTitle: "Weltenbau",
    materialTemplateTitle: "Material",
    archiveTemplateTitle: "Archiv",
  },
  es: {
    projectTitle: "Proyecto Copo de nieve (Snowflake Project)",
    projectIntro: [
      "Esta nota guarda los metadatos del proyecto para el complemento Método del copo de nieve.",
      "¡No modifiques nada en este archivo de metadatos!",
      "El contenido creativo siempre sigue siendo Markdown normal y puedes editarlo directamente aunque desactives el complemento.",
    ],
    stepOneTitle: "Paso 1 · Resumen en una frase",
    oneSentenceSummaryHeading: "Resumen en una frase",
    stepOneHint: "Resume toda la historia en una frase.",
    targetReadersTitle: "Antes de empezar · Define tu público objetivo",
    targetReadersIntro: "Decide qué tipo de novela quieres escribir y define con claridad tu público objetivo.",
    targetReadersQuestions: "Responde a estas preguntas",
    genre: "El género de mi novela",
    audienceAppeal: "Por qué esta historia encantará a mi público objetivo",
    candidateTitles: "Títulos posibles (opcional)",
    candidateTitlesHint: "Anota hasta seis títulos provisionales para la novela.",
    candidateTitle: "Título posible",
    paragraphTitle: "Paso 2 · Resumen en un párrafo",
    descriptionTitle: "Descripción (opcional)",
    plotSynopsisTitle: "Paso 4 · Sinopsis de la trama",
    longSynopsisTitle: "Paso 6 · Sinopsis extensa",
    characterStoryline: "Paso 3 · Línea argumental en un párrafo",
    characterSynopsis: "Paso 5 · Sinopsis del personaje",
    characterProfile: "Paso 7 · Ficha de personaje",
    sceneConflict: "Paso 8 · Conflicto",
    sceneEvents: "Paso 8 · Acontecimientos concretos",
    scenePlanning: "Paso 9 · Planificación de la escena (opcional)",
    entityNotes: "Notas",
    draftTitle: "Borrador",
    blankHint: "Escribe aquí.",
    characterTemplateTitle: "Personaje",
    sceneTemplateTitle: "Escena",
    worldbuildingTemplateTitle: "Construcción de mundos",
    materialTemplateTitle: "Material",
    archiveTemplateTitle: "Archivo",
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
  "zh-TW": [
    {
      step: 1 as const,
      document: "one-sentence-summary" as const,
      relativePath: "10_概述/11_一句話概述.md",
    },
    { step: 2 as const, document: "one-paragraph-summary" as const, relativePath: "10_概述/12_一段式梗概.md" },
    { step: 4 as const, document: "plot-synopsis" as const, relativePath: "30_大綱/31_情節大綱.md" },
    { step: 6 as const, document: "long-synopsis" as const, relativePath: "30_大綱/32_長篇大綱.md" },
  ],
  ja: [
    {
      step: 1 as const,
      document: "one-sentence-summary" as const,
      relativePath: "10_概要/11_一文要約.md",
    },
    { step: 2 as const, document: "one-paragraph-summary" as const, relativePath: "10_概要/12_一段落要約.md" },
    { step: 4 as const, document: "plot-synopsis" as const, relativePath: "30_あらすじ/31_プロットあらすじ.md" },
    { step: 6 as const, document: "long-synopsis" as const, relativePath: "30_あらすじ/32_詳細あらすじ.md" },
  ],
  ko: [
    {
      step: 1 as const,
      document: "one-sentence-summary" as const,
      relativePath: "10_요약/11_한_문장_요약.md",
    },
    { step: 2 as const, document: "one-paragraph-summary" as const, relativePath: "10_요약/12_한_문단_요약.md" },
    { step: 4 as const, document: "plot-synopsis" as const, relativePath: "30_시놉시스/31_플롯_시놉시스.md" },
    { step: 6 as const, document: "long-synopsis" as const, relativePath: "30_시놉시스/32_상세_시놉시스.md" },
  ],
  fr: [
    {
      step: 1 as const,
      document: "one-sentence-summary" as const,
      relativePath: "10_Résumé/11_Résumé_en_une_phrase.md",
    },
    { step: 2 as const, document: "one-paragraph-summary" as const, relativePath: "10_Résumé/12_Résumé_en_un_paragraphe.md" },
    { step: 4 as const, document: "plot-synopsis" as const, relativePath: "30_Synopsis/31_Synopsis_de_l'intrigue.md" },
    { step: 6 as const, document: "long-synopsis" as const, relativePath: "30_Synopsis/32_Synopsis_détaillé.md" },
  ],
  de: [
    {
      step: 1 as const,
      document: "one-sentence-summary" as const,
      relativePath: "10_Zusammenfassung/11_Ein-Satz-Zusammenfassung.md",
    },
    { step: 2 as const, document: "one-paragraph-summary" as const, relativePath: "10_Zusammenfassung/12_Ein-Absatz-Zusammenfassung.md" },
    { step: 4 as const, document: "plot-synopsis" as const, relativePath: "30_Synopsis/31_Handlungssynopsis.md" },
    { step: 6 as const, document: "long-synopsis" as const, relativePath: "30_Synopsis/32_Ausführliche_Synopsis.md" },
  ],
  es: [
    {
      step: 1 as const,
      document: "one-sentence-summary" as const,
      relativePath: "10_Resumen/11_Resumen_en_una_frase.md",
    },
    { step: 2 as const, document: "one-paragraph-summary" as const, relativePath: "10_Resumen/12_Resumen_en_un_párrafo.md" },
    { step: 4 as const, document: "plot-synopsis" as const, relativePath: "30_Sinopsis/31_Sinopsis_de_la_trama.md" },
    { step: 6 as const, document: "long-synopsis" as const, relativePath: "30_Sinopsis/32_Sinopsis_extensa.md" },
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

type SystemTemplateFileKey =
  | "oneSentence"
  | "oneParagraph"
  | "character"
  | "plot"
  | "long"
  | "scene"
  | "draft"
  | "worldbuilding"
  | "material"
  | "archive";

const SYSTEM_TEMPLATE_FILE_NAMES: Record<
  TemplateLanguage,
  Record<SystemTemplateFileKey, string>
> = {
  en: {
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
  },
  "zh-CN": {
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
  },
  "zh-TW": {
    oneSentence: "011_模板_一句話概述.md",
    oneParagraph: "012_模板_一段式梗概.md",
    character: "021_模板_角色.md",
    plot: "031_模板_情節大綱.md",
    long: "032_模板_長篇大綱.md",
    scene: "041_模板_場景.md",
    draft: "051_模板_初稿.md",
    worldbuilding: "061_模板_世界觀.md",
    material: "081_模板_素材.md",
    archive: "091_模板_封存.md",
  },
  ja: {
    oneSentence: "011_テンプレート_一文要約.md",
    oneParagraph: "012_テンプレート_一段落要約.md",
    character: "021_テンプレート_キャラクター.md",
    plot: "031_テンプレート_プロットあらすじ.md",
    long: "032_テンプレート_詳細あらすじ.md",
    scene: "041_テンプレート_シーン.md",
    draft: "051_テンプレート_初稿.md",
    worldbuilding: "061_テンプレート_世界観.md",
    material: "081_テンプレート_資料.md",
    archive: "091_テンプレート_アーカイブ.md",
  },
  ko: {
    oneSentence: "011_템플릿_한_문장_요약.md",
    oneParagraph: "012_템플릿_한_문단_요약.md",
    character: "021_템플릿_캐릭터.md",
    plot: "031_템플릿_플롯_시놉시스.md",
    long: "032_템플릿_상세_시놉시스.md",
    scene: "041_템플릿_장면.md",
    draft: "051_템플릿_초고.md",
    worldbuilding: "061_템플릿_세계관.md",
    material: "081_템플릿_자료.md",
    archive: "091_템플릿_아카이브.md",
  },
  fr: {
    oneSentence: "011_Modèle_Résumé_en_une_phrase.md",
    oneParagraph: "012_Modèle_Résumé_en_un_paragraphe.md",
    character: "021_Modèle_Personnage.md",
    plot: "031_Modèle_Synopsis_de_l'intrigue.md",
    long: "032_Modèle_Synopsis_détaillé.md",
    scene: "041_Modèle_Scène.md",
    draft: "051_Modèle_Brouillon.md",
    worldbuilding: "061_Modèle_Univers.md",
    material: "081_Modèle_Documentation.md",
    archive: "091_Modèle_Archives.md",
  },
  de: {
    oneSentence: "011_Vorlage_Ein-Satz-Zusammenfassung.md",
    oneParagraph: "012_Vorlage_Ein-Absatz-Zusammenfassung.md",
    character: "021_Vorlage_Figur.md",
    plot: "031_Vorlage_Handlungssynopsis.md",
    long: "032_Vorlage_Ausführliche_Synopsis.md",
    scene: "041_Vorlage_Szene.md",
    draft: "051_Vorlage_Entwurf.md",
    worldbuilding: "061_Vorlage_Weltenbau.md",
    material: "081_Vorlage_Material.md",
    archive: "091_Vorlage_Archiv.md",
  },
  es: {
    oneSentence: "011_Plantilla_Resumen_en_una_frase.md",
    oneParagraph: "012_Plantilla_Resumen_en_un_párrafo.md",
    character: "021_Plantilla_Personaje.md",
    plot: "031_Plantilla_Sinopsis_de_la_trama.md",
    long: "032_Plantilla_Sinopsis_extensa.md",
    scene: "041_Plantilla_Escena.md",
    draft: "051_Plantilla_Borrador.md",
    worldbuilding: "061_Plantilla_Construcción_de_mundos.md",
    material: "081_Plantilla_Material.md",
    archive: "091_Plantilla_Archivo.md",
  },
};

/**
 * The names a project's starter character and scene notes take in its
 * language: the same words its system templates are titled with.
 */
export function starterMemberNames(
  language: TemplateLanguage,
): { character: string; scene: string } {
  const copy = COPY[language];
  return {
    character: copy.characterTemplateTitle,
    scene: copy.sceneTemplateTitle,
  };
}

export function getSystemTemplates(
  language: TemplateLanguage,
): SystemTemplateDefinition[] {
  const copy = COPY[language];
  const fileNames = SYSTEM_TEMPLATE_FILE_NAMES[language];
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
 * The first level-one heading a body carries, its inner whitespace collapsed
 * exactly as `updateFirstHeading` writes it, or null for a body with none.
 * Shared by everything that asks whether a note's heading is still the name
 * the note was made under.
 */
export function firstHeading(body: string): string | null {
  const match = /^#(?:[ \t]+)(.*)$/mu.exec(body);
  return match ? (match[1] ?? "").replace(/\s+/gu, " ").trim() : null;
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
