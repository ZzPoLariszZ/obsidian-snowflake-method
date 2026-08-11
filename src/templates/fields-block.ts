import {
  SCENE_POV_OMNISCIENT,
  isCharacterType,
  type ScenePovMode,
} from "../domain";

export type FieldsBlockLanguage = "en" | "zh-CN";

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

export interface CharacterFieldsView {
  type: string;
  oneSentenceStoryline: string;
  motivation: string;
  goal: string;
  conflict: string;
  growth: string;
}

export interface SceneFieldsView {
  pov: ScenePovField;
  time: string;
  location: string;
  conflict: string;
  cast: readonly { path: string; name: string }[];
}

interface FieldsCopy {
  characterTitle: string;
  sceneTitle: string;
  type: string;
  oneSentenceStoryline: string;
  motivation: string;
  goal: string;
  conflict: string;
  growth: string;
  pov: string;
  time: string;
  location: string;
  cast: string;
  typeLabels: Record<"major" | "supporting" | "minor", string>;
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
    type: "Type",
    oneSentenceStoryline: "One-sentence storyline",
    motivation: "Motivation",
    goal: "Goal",
    conflict: "Conflict",
    growth: "Growth",
    pov: "Point-of-view character",
    time: "Time",
    location: "Location",
    cast: "Characters",
    typeLabels: {
      major: "Major character",
      supporting: "Supporting character",
      minor: "Minor character",
    },
    povOmniscient: "Omniscient",
    povMultiple: "Multi-POV",
    separator: ": ",
    listSeparator: ", ",
  },
  "zh-CN": {
    characterTitle: "角色概览",
    sceneTitle: "场景概览",
    type: "类型",
    oneSentenceStoryline: "一句话故事概述",
    motivation: "动机",
    goal: "目标",
    conflict: "冲突",
    growth: "成长",
    pov: "视点人物",
    time: "时间",
    location: "地点",
    cast: "人物",
    typeLabels: {
      major: "主角",
      supporting: "配角",
      minor: "次要角色",
    },
    povOmniscient: "全知视角",
    povMultiple: "多人视角",
    separator: "：",
    listSeparator: "、",
  },
};

/**
 * The read-only block a character note shows for its properties. The stored
 * values stay language-neutral in the frontmatter; only this display is
 * localized, which is safe because the block is generated and never parsed.
 */
export function renderCharacterFieldsBlock(
  language: FieldsBlockLanguage,
  fields: CharacterFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.characterTitle, [
    {
      label: copy.type,
      value: isCharacterType(fields.type)
        ? copy.typeLabels[fields.type]
        : fields.type,
    },
    { label: copy.oneSentenceStoryline, value: fields.oneSentenceStoryline },
    { label: copy.motivation, value: fields.motivation },
    { label: copy.goal, value: fields.goal },
    { label: copy.conflict, value: fields.conflict },
    { label: copy.growth, value: fields.growth },
  ], copy.separator);
}

export function renderSceneFieldsBlock(
  language: FieldsBlockLanguage,
  fields: SceneFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.sceneTitle, [
    { label: copy.pov, value: renderPov(copy, fields.pov) },
    { label: copy.time, value: fields.time },
    { label: copy.location, value: fields.location },
    {
      label: copy.cast,
      value: fields.cast
        .map((member) => wikiLink(member.path, member.name))
        .filter((link) => link.length > 0)
        .join(copy.listSeparator),
    },
    { label: copy.conflict, value: fields.conflict },
  ], copy.separator);
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
 * than prose in every mode. One paragraph per field; a value's own line breaks
 * continue the paragraph as unlabeled callout lines.
 */
function renderCallout(
  title: string,
  entries: readonly FieldEntry[],
  separator: string,
): string {
  const lines = [`> [!info] ${title}`];
  entries.forEach((entry, index) => {
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
