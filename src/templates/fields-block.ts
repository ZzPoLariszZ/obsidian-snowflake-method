import {
  SCENE_POV_OMNISCIENT,
  isWorldbuildingKind,
  type DefinitionFileId,
  type ProgressStatus,
  type ProjectLanguage,
  type ScenePovMode,
  type TimeKind,
  type WorldbuildingKindId,
} from "../domain";
import { parseTerm, renderTerm } from "./record-lines";

export type FieldsBlockLanguage = ProjectLanguage;

/**
 * The point of view a scene displays: a character resolved to a name, one of
 * the narrative modes, or nothing chosen yet. Resolution happens in the
 * service, which is the only layer that knows the project's characters; this
 * module only renders what it is handed.
 */
export type ScenePovField =
  | { kind: "character"; path: string; name: string }
  | { kind: "mode"; mode: ScenePovMode }
  | null;

/**
 * The universal lines every member note's overview opens with. Categories
 * arrive as their stored display form, link or plain path text, because the
 * stored form is already exactly what should be shown; a null status is a
 * note that never chose one, and the line is simply absent.
 */
export interface MemberFieldsCommon {
  progressStatus: ProgressStatus | null;
  aliases: readonly string[];
  categories: readonly string[];
}

export interface CharacterFieldsView extends MemberFieldsCommon {
  oneSentenceStoryline: string;
  motivation: string;
  goal: string;
  conflict: string;
  growth: string;
}

export interface SceneFieldsView extends MemberFieldsCommon {
  pov: ScenePovField;
  times: readonly string[];
  locations: readonly string[];
  conflict: string;
  cast: readonly { path: string; name: string }[];
}

export interface EntityTimeView {
  kind: TimeKind | null;
  start: string;
  end: string;
}

export interface EntityFieldsView extends MemberFieldsCommon {
  description: string;
  /** Present only for kinds that carry the time fields. */
  time: EntityTimeView | null;
}

/**
 * What a definition node's own note shows. The path is where the node sits
 * right now, read from its folders rather than stored, so this block is the
 * one place a taxonomy entry reads as its whole path, not its leaf alone.
 */
export interface DefinitionFieldsView {
  taxonomyPath: string;
  description: string;
}

interface FieldsCopy {
  characterTitle: string;
  sceneTitle: string;
  entityTitles: Record<"time" | "location" | "item", string>;
  definitionTitles: Record<DefinitionFileId, string>;
  definitionName: string;
  status: string;
  statusLabels: Record<ProgressStatus, string>;
  aliases: string;
  category: string;
  description: string;
  type: string;
  timeKindLabels: Record<TimeKind, string>;
  start: string;
  end: string;
  when: string;
  oneSentenceStoryline: string;
  motivation: string;
  goal: string;
  conflict: string;
  growth: string;
  pov: string;
  time: string;
  location: string;
  cast: string;
  povOmniscient: string;
  povMultiple: string;
  separator: string;
  listSeparator: string;
}

/**
 * The same wording the dashboard forms and the generated bases use for these
 * fields, kept here rather than read from the i18n layer so templates stay a
 * leaf module the services can import.
 */
const COPY: Record<FieldsBlockLanguage, FieldsCopy> = {
  en: {
    characterTitle: "Character overview",
    sceneTitle: "Scene overview",
    entityTitles: {
      time: "Time overview",
      location: "Location overview",
      item: "Item overview",
    },
    definitionTitles: {
      category: "Category",
      "world-status": "World status",
      relationship: "Relationship",
    },
    definitionName: "Name",
    status: "Progress status",
    statusLabels: {
      "not-started": "Not started",
      "in-progress": "In progress",
      "in-revision": "In revision",
      complete: "Complete",
    },
    aliases: "Aliases",
    category: "Category",
    description: "Description",
    type: "Type",
    timeKindLabels: {
      point: "Time point",
      period: "Time period",
    },
    start: "Start",
    end: "End",
    when: "When",
    oneSentenceStoryline: "One-sentence storyline",
    motivation: "Motivation",
    goal: "Goal",
    conflict: "Conflict",
    growth: "Growth",
    pov: "Point-of-view character",
    time: "Time",
    location: "Location",
    cast: "Characters",
    povOmniscient: "Omniscient",
    povMultiple: "Multi-POV",
    separator: ": ",
    listSeparator: ", ",
  },
  "zh-CN": {
    characterTitle: "角色概览",
    sceneTitle: "场景概览",
    entityTitles: {
      time: "时间概览",
      location: "地点概览",
      item: "物品概览",
    },
    definitionTitles: {
      category: "类别",
      "world-status": "状态",
      relationship: "关系",
    },
    definitionName: "名称",
    status: "进度",
    statusLabels: {
      "not-started": "未开始",
      "in-progress": "进行中",
      "in-revision": "修订中",
      complete: "已完成",
    },
    aliases: "别名",
    category: "类别",
    description: "描述",
    type: "类型",
    timeKindLabels: {
      point: "时间点",
      period: "时间段",
    },
    start: "开始",
    end: "结束",
    when: "时间",
    oneSentenceStoryline: "一句话故事概述",
    motivation: "动机",
    goal: "目标",
    conflict: "冲突",
    growth: "成长",
    pov: "视点人物",
    time: "时间",
    location: "地点",
    cast: "人物",
    povOmniscient: "全知视角",
    povMultiple: "多人视角",
    separator: "：",
    listSeparator: "、",
  },
  "zh-TW": {
    characterTitle: "角色概覽",
    sceneTitle: "場景概覽",
    entityTitles: {
      time: "時間概覽",
      location: "地點概覽",
      item: "物品概覽",
    },
    definitionTitles: {
      category: "類別",
      "world-status": "狀態",
      relationship: "關係",
    },
    definitionName: "名稱",
    status: "進度",
    statusLabels: {
      "not-started": "未開始",
      "in-progress": "進行中",
      "in-revision": "修訂中",
      complete: "已完成",
    },
    aliases: "別名",
    category: "類別",
    description: "描述",
    type: "類型",
    timeKindLabels: {
      point: "時間點",
      period: "時間區間",
    },
    start: "開始",
    end: "結束",
    when: "時間",
    oneSentenceStoryline: "一句話故事概述",
    motivation: "動機",
    goal: "目標",
    conflict: "衝突",
    growth: "成長",
    pov: "觀點人物",
    time: "時間",
    location: "地點",
    cast: "人物",
    povOmniscient: "全知觀點",
    povMultiple: "多重觀點",
    separator: "：",
    listSeparator: "、",
  },
  ja: {
    characterTitle: "キャラクターの概要",
    sceneTitle: "シーンの概要",
    entityTitles: {
      time: "時間の概要",
      location: "場所の概要",
      item: "アイテムの概要",
    },
    definitionTitles: {
      category: "カテゴリー",
      "world-status": "状態",
      relationship: "関係",
    },
    definitionName: "名前",
    status: "進捗",
    statusLabels: {
      "not-started": "未着手",
      "in-progress": "進行中",
      "in-revision": "推敲中",
      complete: "完了",
    },
    aliases: "エイリアス",
    category: "カテゴリー",
    description: "説明",
    type: "種別",
    timeKindLabels: {
      point: "時点",
      period: "期間",
    },
    start: "開始",
    end: "終了",
    when: "時期",
    oneSentenceStoryline: "一文ストーリーライン",
    motivation: "動機",
    goal: "目標",
    conflict: "葛藤",
    growth: "成長",
    pov: "視点人物",
    time: "時間",
    location: "場所",
    cast: "登場人物",
    povOmniscient: "全知視点",
    povMultiple: "複数視点",
    separator: "：",
    listSeparator: "、",
  },
  ko: {
    characterTitle: "캐릭터 개요",
    sceneTitle: "장면 개요",
    entityTitles: {
      time: "시간 개요",
      location: "장소 개요",
      item: "아이템 개요",
    },
    definitionTitles: {
      category: "카테고리",
      "world-status": "상태",
      relationship: "관계",
    },
    definitionName: "이름",
    status: "진행 상태",
    statusLabels: {
      "not-started": "시작 전",
      "in-progress": "진행 중",
      "in-revision": "수정 중",
      complete: "완료",
    },
    aliases: "별칭",
    category: "카테고리",
    description: "설명",
    type: "유형",
    timeKindLabels: {
      point: "시점",
      period: "기간",
    },
    start: "시작",
    end: "끝",
    when: "시기",
    oneSentenceStoryline: "한 문장 스토리라인",
    motivation: "동기",
    goal: "목표",
    conflict: "갈등",
    growth: "성장",
    pov: "시점 인물",
    time: "시간",
    location: "장소",
    cast: "등장인물",
    povOmniscient: "전지적 시점",
    povMultiple: "다중 시점",
    separator: ": ",
    listSeparator: ", ",
  },
  fr: {
    characterTitle: "Aperçu du personnage",
    sceneTitle: "Aperçu de la scène",
    entityTitles: {
      time: "Aperçu chronologique",
      location: "Aperçu du lieu",
      item: "Aperçu de l'objet",
    },
    definitionTitles: {
      category: "Catégorie",
      "world-status": "État",
      relationship: "Relation",
    },
    definitionName: "Nom",
    status: "Avancement",
    statusLabels: {
      "not-started": "Non commencé",
      "in-progress": "En cours",
      "in-revision": "En révision",
      complete: "Terminé",
    },
    aliases: "Alias",
    category: "Catégorie",
    description: "Description",
    type: "Type",
    timeKindLabels: {
      point: "Moment",
      period: "Période",
    },
    start: "Début",
    end: "Fin",
    when: "Quand",
    oneSentenceStoryline: "Parcours en une phrase",
    motivation: "Motivation",
    goal: "Objectif",
    conflict: "Conflit",
    growth: "Évolution",
    pov: "Personnage point de vue",
    time: "Temps",
    location: "Lieu",
    cast: "Personnages",
    povOmniscient: "Omniscient",
    povMultiple: "Points de vue multiples",
    // French sets a space before the colon.
    separator: " : ",
    listSeparator: ", ",
  },
  de: {
    characterTitle: "Figurenübersicht",
    sceneTitle: "Szenenübersicht",
    entityTitles: {
      time: "Zeitübersicht",
      location: "Ortsübersicht",
      item: "Gegenstandsübersicht",
    },
    definitionTitles: {
      category: "Kategorie",
      "world-status": "Status",
      relationship: "Beziehung",
    },
    definitionName: "Name",
    status: "Fortschritt",
    statusLabels: {
      "not-started": "Nicht begonnen",
      "in-progress": "In Arbeit",
      "in-revision": "In Überarbeitung",
      complete: "Fertig",
    },
    aliases: "Aliasse",
    category: "Kategorie",
    description: "Beschreibung",
    type: "Typ",
    timeKindLabels: {
      point: "Zeitpunkt",
      period: "Zeitraum",
    },
    start: "Beginn",
    end: "Ende",
    when: "Wann",
    oneSentenceStoryline: "Handlungsstrang in einem Satz",
    motivation: "Motivation",
    goal: "Ziel",
    conflict: "Konflikt",
    growth: "Entwicklung",
    pov: "Perspektivfigur",
    time: "Zeit",
    location: "Ort",
    cast: "Figuren",
    povOmniscient: "Allwissend",
    povMultiple: "Mehrere Perspektiven",
    separator: ": ",
    listSeparator: ", ",
  },
  es: {
    characterTitle: "Datos del personaje",
    sceneTitle: "Datos de la escena",
    entityTitles: {
      time: "Datos cronológicos",
      location: "Datos del lugar",
      item: "Datos del objeto",
    },
    definitionTitles: {
      category: "Categoría",
      "world-status": "Estado",
      relationship: "Relación",
    },
    definitionName: "Nombre",
    status: "Progreso",
    statusLabels: {
      "not-started": "Sin empezar",
      "in-progress": "En curso",
      "in-revision": "En revisión",
      complete: "Completado",
    },
    aliases: "Alias",
    category: "Categoría",
    description: "Descripción",
    type: "Tipo",
    timeKindLabels: {
      point: "Momento",
      period: "Período",
    },
    start: "Inicio",
    end: "Fin",
    when: "Cuándo",
    oneSentenceStoryline: "Línea argumental en una frase",
    motivation: "Motivación",
    goal: "Objetivo",
    conflict: "Conflicto",
    growth: "Evolución",
    pov: "Personaje del punto de vista",
    time: "Tiempo",
    location: "Lugar",
    cast: "Personajes",
    povOmniscient: "Omnisciente",
    povMultiple: "Múltiples puntos de vista",
    separator: ": ",
    listSeparator: ", ",
  },
};

/**
 * The read-only block a character note shows for its properties. The stored
 * values stay language-neutral in the frontmatter; only this display is
 * localized, which is safe because the block is generated and never parsed.
 *
 * The same order the properties read in everywhere else: what they are called,
 * what they are filed under, the story, and how far along it is last. The name
 * is not among them, because the note is already titled with it and the block
 * sits directly under that title.
 */
export function renderCharacterFieldsBlock(
  language: FieldsBlockLanguage,
  fields: CharacterFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.characterTitle, [
    { label: copy.aliases, value: joinList(copy, fields.aliases) },
    { label: copy.category, value: joinList(copy, fields.categories) },
    { label: copy.oneSentenceStoryline, value: fields.oneSentenceStoryline },
    { label: copy.motivation, value: fields.motivation },
    { label: copy.goal, value: fields.goal },
    { label: copy.conflict, value: fields.conflict },
    { label: copy.growth, value: fields.growth },
    { label: copy.status, value: statusLabel(copy, fields.progressStatus) },
  ], copy.separator);
}

/**
 * A scene's properties in the order they read everywhere else: what it is
 * called and filed under, who tells it and where, then how far along it is.
 * The title is not among them, for the same reason a character's name is not.
 */
export function renderSceneFieldsBlock(
  language: FieldsBlockLanguage,
  fields: SceneFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.sceneTitle, [
    { label: copy.aliases, value: joinList(copy, fields.aliases) },
    { label: copy.category, value: joinList(copy, fields.categories) },
    { label: copy.pov, value: renderPov(copy, fields.pov) },
    {
      label: copy.time,
      value: joinList(copy, fields.times),
    },
    {
      label: copy.location,
      value: joinList(copy, fields.locations),
    },
    {
      label: copy.cast,
      value: fields.cast
        .map((member) => wikiLink(member.path, member.name))
        .filter((link) => link.length > 0)
        .join(copy.listSeparator),
    },
    { label: copy.conflict, value: fields.conflict },
    { label: copy.status, value: statusLabel(copy, fields.progressStatus) },
  ], copy.separator);
}

/** The same order again: what it is called and filed under, what it is, how
 * far along it is. The name is the note's own title, as everywhere else. A
 * custom kind's callout wears the kind's own name: the author named it, so
 * there is nothing to translate. */
export function renderEntityFieldsBlock(
  language: FieldsBlockLanguage,
  kind: WorldbuildingKindId,
  fields: EntityFieldsView,
): string {
  const copy = COPY[language];
  const title = isWorldbuildingKind(kind) ? copy.entityTitles[kind] : kind;
  return renderCallout(title, [
    { label: copy.aliases, value: joinList(copy, fields.aliases) },
    { label: copy.category, value: joinList(copy, fields.categories) },
    ...timeEntries(copy, fields.time),
    { label: copy.description, value: fields.description },
    { label: copy.status, value: statusLabel(copy, fields.progressStatus) },
  ], copy.separator);
}

/**
 * The block a definition node's own note opens with. The note is named for
 * the file every node folder holds, so without this nothing on the page says
 * which entry it is. A node's name is its whole path, parents included, and
 * the callout's own title says which vocabulary that path belongs to: it is
 * here to be read, not to be stored.
 */
export function renderDefinitionFieldsBlock(
  language: FieldsBlockLanguage,
  id: DefinitionFileId,
  fields: DefinitionFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.definitionTitles[id], [
    { label: copy.definitionName, value: fields.taxonomyPath },
    { label: copy.description, value: fields.description },
  ], copy.separator);
}

function statusLabel(
  copy: FieldsCopy,
  status: ProgressStatus | null,
): string {
  return status === null ? "" : copy.statusLabels[status];
}

function timeEntries(
  copy: FieldsCopy,
  time: EntityTimeView | null,
): FieldEntry[] {
  if (time === null) return [];
  const entries: FieldEntry[] = [
    {
      label: copy.type,
      // A note can hold a kind this release no longer knows, and a line with
      // nothing to say is simply left out.
      value: time.kind === null ? "" : (copy.timeKindLabels[time.kind] ?? ""),
    },
  ];
  // A link with no display name is read out as the whole vault path, so what
  // the note stored is re-emitted through the codec before it is shown.
  const start = displayTerm(time.start);
  const end = displayTerm(time.end);
  if (start.length > 0 && end.length > 0) {
    entries.push({ label: copy.start, value: start });
    entries.push({ label: copy.end, value: end });
  } else if (start.length > 0) {
    entries.push({ label: copy.when, value: start });
  } else if (end.length > 0) {
    entries.push({ label: copy.end, value: end });
  }
  return entries;
}

/** A stored term as it should be read: a link keeps its name, text stays text. */
function displayTerm(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? "" : renderTerm(parseTerm(trimmed));
}

function joinList(copy: FieldsCopy, values: readonly string[]): string {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(copy.listSeparator);
}

function renderPov(copy: FieldsCopy, pov: ScenePovField): string {
  if (pov === null) return "";
  if (pov.kind === "mode") {
    return pov.mode === SCENE_POV_OMNISCIENT
      ? copy.povOmniscient
      : copy.povMultiple;
  }
  return wikiLink(pov.path, pov.name);
}

interface FieldEntry {
  label: string;
  value: string;
}

/**
 * An `[!info]` callout: boxed in reading view and live preview, an ordinary
 * blockquote everywhere else, so the block reads as generated matter rather
 * than prose in every mode. Only fields holding a value appear; one paragraph
 * per shown field, and a value's own line breaks continue the paragraph as
 * unlabeled callout lines.
 */
function renderCallout(
  title: string,
  entries: readonly FieldEntry[],
  separator: string,
): string {
  const lines = [`> [!info] ${title}`];
  const filled = entries.filter((entry) => entry.value.trim().length > 0);
  filled.forEach((entry, index) => {
    if (index > 0) lines.push(">");
    const valueLines = entry.value.split(/\r\n|\r|\n/u);
    lines.push(`> **${entry.label}**${separator}${valueLines[0] ?? ""}`.trimEnd());
    for (const rest of valueLines.slice(1)) {
      lines.push(rest.length > 0 ? `> ${rest}` : ">");
    }
  });
  return lines.join("\n");
}

/**
 * Writes a link the way Obsidian writes one, matching `toWikiLink` in the
 * service layer: the path without its ".md", the alias stripped of the
 * characters that would end the link early.
 */
function wikiLink(path: string, alias: string): string {
  const target = path.trim().replace(/\.md$/u, "");
  if (!target) return "";
  const safeAlias = alias.replace(/[|\]]/gu, "").trim();
  return safeAlias ? `[[${target}|${safeAlias}]]` : `[[${target}]]`;
}
