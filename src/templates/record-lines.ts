import type { DetailsPropertyId, ProjectLanguage } from "../domain";

/**
 * The record-line codec: the one grammar every compound property is written
 * in. Frontmatter can hold at most one wikilink per list entry, so a value
 * that mixes text and links, or several links, lives in the note body as one
 * record per line. The plugin is the only writer of these sections, which is
 * what makes parsing safe: the reader is reading its own normalized output.
 *
 * A record line is a label link followed by clauses that compound in one
 * canonical order, each optional:
 *
 *   - [[Relationship#Member|Member]] -> [[Guild]] at [[Capital]] from [[1023]] to [[1025]]
 *   - [[World_Status#Injured|Injured]] when [[Battle of Red Valley]]
 *
 * `when` and `from … to` are mutually exclusive. A Details line is the same
 * clause tail behind a built-in bold label instead of a taxonomy link:
 *
 *   - **Age**: 23 when [[Year 1003]]
 *   - **Owner**: [[Aria]] from [[Year 1020]] to [[Year 1022]]
 *
 * A line the grammar does not cover is kept verbatim and re-emitted after the
 * records on every rewrite, so nothing typed by other tools is dropped; the
 * health checker is what reports it.
 */

/** A clause value: a linked entity or plain text. */
export type RecordTerm =
  | { kind: "link"; path: string; name: string }
  | { kind: "text"; text: string };

export type RecordTime =
  | { kind: "when"; at: RecordTerm }
  | { kind: "span"; start: RecordTerm; end: RecordTerm };

/** The taxonomy heading a record points at: `[[path#heading|display]]`. */
export interface RecordLabel {
  path: string;
  heading: string;
  display: string;
}

export interface RecordLine {
  label: RecordLabel;
  target: RecordTerm | null;
  location: RecordTerm | null;
  time: RecordTime | null;
}

export interface DetailsLine {
  property: DetailsPropertyId;
  value: RecordTerm | null;
  location: RecordTerm | null;
  time: RecordTime | null;
}

export interface ParsedRecordSection {
  records: RecordLine[];
  /** Lines the grammar does not cover, re-emitted verbatim after the records. */
  unrecognized: string[];
}

export interface ParsedDetailsSection {
  details: DetailsLine[];
  unrecognized: string[];
}

interface RecordCopy {
  arrow: string;
  at: string;
  when: string;
  from: string;
  to: string;
  detailsSeparator: string;
  detailsLabels: Record<DetailsPropertyId, string>;
}

const COPY: Record<ProjectLanguage, RecordCopy> = {
  en: {
    arrow: "->",
    at: "at",
    when: "when",
    from: "from",
    to: "to",
    detailsSeparator: ": ",
    detailsLabels: { age: "Age", owner: "Owner" },
  },
  "zh-CN": {
    arrow: "->",
    at: "在",
    when: "于",
    from: "从",
    to: "至",
    detailsSeparator: "：",
    detailsLabels: { age: "年龄", owner: "所有者" },
  },
};

export function recordDetailsLabel(
  language: ProjectLanguage,
  property: DetailsPropertyId,
): string {
  return COPY[language].detailsLabels[property];
}

export function renderRecordLine(
  language: ProjectLanguage,
  record: RecordLine,
): string {
  const copy = COPY[language];
  const parts = [
    `- ${labelLink(record.label)}`,
    ...clauseTail(copy, record.target, record.location, record.time),
  ];
  return parts.join(" ");
}

export function renderDetailsLine(
  language: ProjectLanguage,
  details: DetailsLine,
): string {
  const copy = COPY[language];
  const tail = [
    ...(details.value === null ? [] : [renderTerm(details.value)]),
    ...clauseTail(copy, null, details.location, details.time),
  ].join(" ");
  return `- **${copy.detailsLabels[details.property]}**${copy.detailsSeparator}${tail}`.trimEnd();
}

export function renderRecordSection(
  language: ProjectLanguage,
  records: readonly RecordLine[],
  unrecognized: readonly string[] = [],
): string {
  return [
    ...records.map((record) => renderRecordLine(language, record)),
    ...unrecognized,
  ].join("\n");
}

export function renderDetailsSection(
  language: ProjectLanguage,
  details: readonly DetailsLine[],
  unrecognized: readonly string[] = [],
): string {
  return [
    ...details.map((line) => renderDetailsLine(language, line)),
    ...unrecognized,
  ].join("\n");
}

export function parseRecordLine(
  language: ProjectLanguage,
  line: string,
): RecordLine | null {
  const copy = COPY[language];
  const body = listItemBody(line);
  if (body === null) return null;
  const label = takeLabelLink(body);
  if (label === null) return null;
  const clauses = parseClauseTail(copy, label.rest);
  if (clauses === null || clauses.head.length > 0) return null;
  return {
    label: label.label,
    target: clauses.target,
    location: clauses.location,
    time: clauses.time,
  };
}

export function parseDetailsLine(
  language: ProjectLanguage,
  line: string,
): DetailsLine | null {
  const copy = COPY[language];
  const body = listItemBody(line);
  if (body === null) return null;
  const property = (
    Object.entries(copy.detailsLabels) as Array<[DetailsPropertyId, string]>
  ).find(([, text]) => body.startsWith(`**${text}**${copy.detailsSeparator}`));
  if (property === undefined) return null;
  const tail = body
    .slice(`**${property[1]}**${copy.detailsSeparator}`.length)
    .trim();
  const clauses = parseClauseTail(copy, tail);
  if (clauses === null || clauses.target !== null) return null;
  return {
    property: property[0],
    value: clauses.head.length === 0 ? null : parseTerm(clauses.head),
    location: clauses.location,
    time: clauses.time,
  };
}

export function parseRecordSection(
  language: ProjectLanguage,
  content: string,
): ParsedRecordSection {
  const records: RecordLine[] = [];
  const unrecognized: string[] = [];
  for (const line of contentLines(content)) {
    const record = parseRecordLine(language, line);
    if (record === null) unrecognized.push(line);
    else records.push(record);
  }
  return { records, unrecognized };
}

export function parseDetailsSection(
  language: ProjectLanguage,
  content: string,
): ParsedDetailsSection {
  const details: DetailsLine[] = [];
  const unrecognized: string[] = [];
  for (const line of contentLines(content)) {
    const parsed = parseDetailsLine(language, line);
    if (parsed === null) unrecognized.push(line);
    else details.push(parsed);
  }
  return { details, unrecognized };
}

const LENIENT_LANGUAGES: readonly ProjectLanguage[] = ["en", "zh-CN"];

/**
 * Reads a section line by line, trying the preferred language first and the
 * other one second. A project that changed its language keeps the records its
 * notes were written with, and the next rewrite normalizes every line to the
 * preferred language.
 */
export function parseRecordSectionLenient(
  preferred: ProjectLanguage,
  content: string,
): ParsedRecordSection {
  const languages = [
    preferred,
    ...LENIENT_LANGUAGES.filter((language) => language !== preferred),
  ];
  const records: RecordLine[] = [];
  const unrecognized: string[] = [];
  for (const line of contentLines(content)) {
    const record = languages
      .map((language) => parseRecordLine(language, line))
      .find((candidate) => candidate !== null);
    if (record === undefined || record === null) unrecognized.push(line);
    else records.push(record);
  }
  return { records, unrecognized };
}

export function parseDetailsSectionLenient(
  preferred: ProjectLanguage,
  content: string,
): ParsedDetailsSection {
  const languages = [
    preferred,
    ...LENIENT_LANGUAGES.filter((language) => language !== preferred),
  ];
  const details: DetailsLine[] = [];
  const unrecognized: string[] = [];
  for (const line of contentLines(content)) {
    const parsed = languages
      .map((language) => parseDetailsLine(language, line))
      .find((candidate) => candidate !== null);
    if (parsed === undefined || parsed === null) unrecognized.push(line);
    else details.push(parsed);
  }
  return { details, unrecognized };
}

function contentLines(content: string): string[] {
  return content
    .split(/\r\n|\r|\n/u)
    .map((line) => line.replace(/\s+$/u, ""))
    .filter((line) => line.trim().length > 0);
}

function clauseTail(
  copy: RecordCopy,
  target: RecordTerm | null,
  location: RecordTerm | null,
  time: RecordTime | null,
): string[] {
  const parts: string[] = [];
  if (target !== null) parts.push(copy.arrow, renderTerm(target));
  if (location !== null) parts.push(copy.at, renderTerm(location));
  if (time !== null) {
    if (time.kind === "when") parts.push(copy.when, renderTerm(time.at));
    else
      parts.push(
        copy.from,
        renderTerm(time.start),
        copy.to,
        renderTerm(time.end),
      );
  }
  return parts;
}

interface ClauseSplit {
  /** Text before the first connector: empty on records, the value on details. */
  head: string;
  target: RecordTerm | null;
  location: RecordTerm | null;
  time: RecordTime | null;
}

type ClauseKind = "arrow" | "at" | "when" | "from";

const CLAUSE_ORDER: Record<ClauseKind, number> = {
  arrow: 0,
  at: 1,
  when: 2,
  from: 2,
};

/**
 * Splits a clause tail at its connectors. Connectors count only with spaces on
 * both sides and outside wikilink brackets, so a link text may contain a
 * connector word without splitting the record, and only in canonical order:
 * anything else is not this grammar and the caller keeps the line verbatim.
 */
function parseClauseTail(copy: RecordCopy, tail: string): ClauseSplit | null {
  // Padded so a connector at the very start still sits between spaces.
  const padded = ` ${tail}`;
  const timePick = pickTime(
    connectorIndex(padded, copy.when),
    connectorIndex(padded, copy.from),
  );
  const marks: Array<{ kind: ClauseKind; index: number; token: string }> = [];
  const arrowIndex = connectorIndex(padded, copy.arrow);
  if (arrowIndex !== null) {
    marks.push({
      kind: "arrow",
      index: arrowIndex,
      token: connectorToken(copy.arrow),
    });
  }
  const atIndex = connectorIndex(padded, copy.at);
  if (atIndex !== null) {
    marks.push({ kind: "at", index: atIndex, token: connectorToken(copy.at) });
  }
  if (timePick !== null) {
    marks.push({
      kind: timePick.kind,
      index: timePick.index,
      token: connectorToken(timePick.kind === "when" ? copy.when : copy.from),
    });
  }
  marks.sort((left, right) => left.index - right.index);
  for (let index = 1; index < marks.length; index += 1) {
    const previous = marks[index - 1] as (typeof marks)[number];
    const current = marks[index] as (typeof marks)[number];
    if (CLAUSE_ORDER[current.kind] <= CLAUSE_ORDER[previous.kind]) return null;
  }

  const first = marks[0];
  const head = padded.slice(0, first?.index ?? padded.length).trim();

  let target: RecordTerm | null = null;
  let location: RecordTerm | null = null;
  let time: RecordTime | null = null;
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index] as (typeof marks)[number];
    const next = marks[index + 1];
    const text = padded
      .slice(mark.index + mark.token.length, next?.index ?? padded.length)
      .trim();
    if (text.length === 0) return null;
    switch (mark.kind) {
      case "arrow":
        target = parseTerm(text);
        break;
      case "at":
        location = parseTerm(text);
        break;
      case "when":
        time = { kind: "when", at: parseTerm(text) };
        break;
      case "from": {
        const span = ` ${text}`;
        const toIndex = connectorIndex(span, copy.to);
        if (toIndex === null) return null;
        const start = span.slice(0, toIndex).trim();
        const end = span.slice(toIndex + connectorToken(copy.to).length).trim();
        if (start.length === 0 || end.length === 0) return null;
        time = { kind: "span", start: parseTerm(start), end: parseTerm(end) };
        break;
      }
    }
  }

  return { head, target, location, time };
}

function pickTime(
  whenIndex: number | null,
  fromIndex: number | null,
): { kind: "when" | "from"; index: number } | null {
  if (whenIndex === null && fromIndex === null) return null;
  if (whenIndex !== null && (fromIndex === null || whenIndex < fromIndex)) {
    return { kind: "when", index: whenIndex };
  }
  return { kind: "from", index: fromIndex as number };
}

function connectorToken(connector: string): string {
  return ` ${connector} `;
}

/** First occurrence of ` connector ` outside wikilink brackets. */
function connectorIndex(text: string, connector: string): number | null {
  const token = connectorToken(connector);
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith("[[", index)) {
      depth += 1;
      index += 1;
      continue;
    }
    if (text.startsWith("]]", index)) {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth === 0 && text.startsWith(token, index)) return index;
  }
  return null;
}

function listItemBody(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) return null;
  return trimmed.slice(2).trim();
}

const LABEL_PATTERN = /^\[\[([^\]|#]*)#([^\]|]+)\|([^\]]+)\]\]/u;

function takeLabelLink(
  body: string,
): { label: RecordLabel; rest: string } | null {
  const match = LABEL_PATTERN.exec(body);
  if (match === null) return null;
  return {
    label: {
      path: (match[1] ?? "").trim(),
      heading: (match[2] ?? "").trim(),
      display: (match[3] ?? "").trim(),
    },
    rest: body.slice(match[0].length).trim(),
  };
}

function labelLink(label: RecordLabel): string {
  const target = label.path.trim().replace(/\.md$/u, "");
  return `[[${target}#${label.heading}|${sanitizeAlias(label.display)}]]`;
}

const TERM_LINK_PATTERN = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/u;

export function parseTerm(text: string): RecordTerm {
  const match = TERM_LINK_PATTERN.exec(text.trim());
  if (match === null) return { kind: "text", text: text.trim() };
  const path = (match[1] ?? "").trim();
  const alias = (match[2] ?? "").trim();
  return {
    kind: "link",
    path,
    name: alias.length > 0 ? alias : path.split("/").pop() ?? path,
  };
}

export function renderTerm(term: RecordTerm): string {
  if (term.kind === "text") return term.text.trim();
  const target = term.path.trim().replace(/\.md$/u, "");
  const name = sanitizeAlias(term.name);
  if (target.length === 0) return name;
  const tail = target.split("/").pop() ?? target;
  return name.length === 0 || name === tail
    ? `[[${target}]]`
    : `[[${target}|${name}]]`;
}

/**
 * Matches the alias handling of `toWikiLink` in the service layer: strip the
 * characters that would end the link early.
 */
function sanitizeAlias(alias: string): string {
  return alias.replace(/[|\]]/gu, "").trim();
}
